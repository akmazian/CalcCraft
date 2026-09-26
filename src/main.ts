// Modified by akmazian (2026) in a fork of klaudyu/CalcCraft
// (https://github.com/klaudyu/CalcCraft), licensed under Apache 2.0.
// Changes: Table Master compatibility (recompute after its rebuild, merged-cell
// positions), precision setting for unit results, scientific display of results,
// no colour or border on computed cells, header-row detection, uppercase labels numbered from the first row
// after the header, dead label code and debug logging removed.
// See the "Fork of klaudyu/CalcCraft" section in CHANGELOG.md.

import { Plugin, MarkdownPostProcessorContext, MarkdownView, TFile } from "obsidian";
import { CalcCraftSettingsTab, DefaultSettings } from "./settings";
import { TableEvaluator, formatExponential, formatFixed, splitUnit } from "./table-evaluator";

const debug = false;

export default class CalcCraftPlugin extends Plugin {
	settings: any = {};
	settings_tab: CalcCraftSettingsTab;
	cssVariables: string[] = [];
	htmlTable: HTMLElement[][] = [];
	private suspendMutations = false;          // ignore MutationObserver notifications while we mutate
	private isEvaluating = false;              // prevent re-entrant recompute runs
	private recomputeTimer: number | null = null; // for debouncing recompute calls

	private lpCleanup: Array<() => void> = [];

	private cssClassCache = new Map<string, string[]>();

	private unloaded = false;

	async onload() {
		await this.loadSettings();
		this.registerMarkdownPostProcessor(this.postProcessor.bind(this));

		// edit mode support:
		this.settings_tab = new CalcCraftSettingsTab(this.app, this);
		this.addSettingTab(this.settings_tab);
		this.debug("table formula plugin loaded");
		this.settings_tab.reloadPages();

		// Add Live Preview support:
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.attachLivePreviewHooks()));
		this.registerEvent(this.app.workspace.on("layout-change", () => this.attachLivePreviewHooks()));
		this.attachLivePreviewHooks();

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				// Only refresh if class filter is enabled AND cssclass actually changed
				if (this.settings.enableClassFilter) {
					this.checkCssClassChange(file);
				}
			})
		);
	}

	onunload() {
		// Table Master observers stay attached to rendered tables; make them no-ops
		this.unloaded = true;
	}

	private extractCssClasses(frontmatter: any): string[] {
		const classes: string[] = [];

		if (frontmatter?.cssclass) {
			if (typeof frontmatter.cssclass === 'string') {
				classes.push(...frontmatter.cssclass.split(/\s+/));
			} else if (Array.isArray(frontmatter.cssclass)) {
				classes.push(...frontmatter.cssclass);
			}
		}

		if (frontmatter?.cssclasses) {
			if (typeof frontmatter.cssclasses === 'string') {
				classes.push(...frontmatter.cssclasses.split(/\s+/));
			} else if (Array.isArray(frontmatter.cssclasses)) {
				classes.push(...frontmatter.cssclasses);
			}
		}

		return classes.filter(cls => typeof cls === 'string' && cls.trim().length > 0);
	}

	private checkCssClassChange(file: TFile) {
		const cache = this.app.metadataCache.getFileCache(file);
		const newClasses = cache?.frontmatter ? this.extractCssClasses(cache.frontmatter) : [];
		const oldClasses = this.cssClassCache.get(file.path) || [];

		// Sort both arrays for comparison
		const newSorted = [...newClasses].sort();
		const oldSorted = [...oldClasses].sort();

		// Check if cssclasses actually changed
		const hasChanged = newSorted.length !== oldSorted.length ||
			!newSorted.every((cls, i) => cls === oldSorted[i]);

		if (hasChanged) {
			this.debug(`CSS classes changed for ${file.name}: [${oldClasses.join(', ')}] -> [${newClasses.join(', ')}]`);

			// Update cache
			this.cssClassCache.set(file.path, newClasses);

			// Only refresh if this is the active file
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile && activeFile.path === file.path) {
				this.refreshPageIfNeeded(file);
			}
		} else {
			this.debug(`CSS classes unchanged for ${file.name}, skipping refresh`);
		}
	}

	private refreshPageIfNeeded(file: TFile) {
		this.debug("CSS classes changed, refreshing page");
		setTimeout(() => {
			this.app.workspace.getLeavesOfType("markdown").forEach((e: any) => e.rebuildView());
		}, 100); // Small delay to ensure frontmatter is fully processed
	}

	async postProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		// Check if class filter is enabled
		if (this.settings.enableClassFilter) {
			const requiredClass = this.settings.requiredClass || "calccraft";

			try {
				let file = null;

				// For edit mode, we need to get the file from the active view
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					file = activeView.file;
				}

				// Fallback methods
				if (!file && ctx.sourcePath) {
					file = this.app.vault.getAbstractFileByPath(ctx.sourcePath) as TFile;
				}

				if (!file) {
					file = this.app.workspace.getActiveFile();
				}

				if (!file) {
					this.debug("Could not determine current file, processing all tables");
					// Process anyway if we can't determine the file
				} else {
					// Get frontmatter from cache
					const fileCache = this.app.metadataCache.getFileCache(file);

					if (fileCache && fileCache.frontmatter) {
						const classes = this.extractCssClasses(fileCache.frontmatter);
						const hasRequiredClass = classes.includes(requiredClass);

						this.debug(`File: ${file.name}, Required: ${requiredClass}, Found: ${hasRequiredClass}`);
						this.debug(`Mode: ${activeView?.getMode()}, classes: ${classes.join(', ')}`);

						if (!hasRequiredClass) {
							this.debug(`Skipping page - missing cssclass '${requiredClass}'`);
							return;
						}
					} else {
						this.debug("No frontmatter found, skipping page");
						return;
					}
				}
			} catch (error) {
				console.error("CalcCraft: Error checking cssclass:", error);
				// If we can't check the class, process anyway to avoid breaking functionality
			}
		}

		const tables = el.querySelectorAll("table");
		if (tables.length === 0) return;

		// Ignore our own DOM writes in the Live Preview MutationObserver
		this.safelyMutateDOM(() => {
			tables.forEach(tableEl => {
				this.processTable(tableEl);
				this.watchTableMaster(tableEl);
			});
		});
	}

	private processTable(tableEl: HTMLTableElement) {
		try {
			this.clearTableHighlights(tableEl);
			(tableEl as any).CalcCraft = { settings: this.settings };

			const cells = this.tableCells(tableEl);
			const headerRows = this.countHeaderRows(tableEl);

			if (this.settings.showLabels) {
				this.addSimpleLabels(cells, headerRows);
			}

			const gridData = this.extractTableGrid(cells);
			const evaluator = new TableEvaluator();
			const result = evaluator.evaluateTable(gridData, { ...this.settings, headerRows });

			this.applyResultsToHTML(tableEl, cells, result, gridData, evaluator);
		} catch (error) {
			console.error("CalcCraft: Error processing table:", error);
			tableEl.setAttribute('data-calccraft-error', 'true');
		}
	}

	// Table Master rebuilds tables in reading view (asynchronously, from the markdown
	// source) and marks the finished table with data-tm-rendered. Its rebuild replaces
	// our computed values, so recompute the table when that marker is set.
	private watchTableMaster(tableEl: HTMLTableElement) {
		if ((tableEl as any).calcCraftTableMasterObserver) return;
		const observer = new MutationObserver(() => {
			if (this.unloaded) return;
			this.safelyMutateDOM(() => this.processTable(tableEl));
		});
		observer.observe(tableEl, { attributes: true, attributeFilter: ["data-tm-rendered"] });
		(tableEl as any).calcCraftTableMasterObserver = observer;
	}

	// Cell elements by grid position, padded to a rectangle (undefined where there is no
	// element). Table Master's reading view leaves out cells covered by a merge and records
	// each cell's real position in data-tm-row / data-tm-col, so use that when present.
	private tableCells(tableEl: HTMLTableElement): (HTMLElement | undefined)[][] {
		const cells: HTMLElement[][] = [];
		Array.from(tableEl.rows).forEach((rowEl, i) => {
			cells[i] = cells[i] || [];
			Array.from(rowEl.cells).forEach((cellEl, j) => {
				const row = cellEl.dataset.tmRow !== undefined ? Number(cellEl.dataset.tmRow) : i;
				const col = cellEl.dataset.tmCol !== undefined ? Number(cellEl.dataset.tmCol) : j;
				cells[row] = cells[row] || [];
				cells[row][col] = cellEl;
			});
		});
		const cols = Math.max(0, ...cells.map(row => (row ? row.length : 0)));
		return Array.from({ length: cells.length }, (_, i) =>
			Array.from({ length: cols }, (_, j) => cells[i]?.[j])
		);
	}

	private extractTableGrid(cells: (HTMLElement | undefined)[][]): string[][] {
		return cells.map(row =>
			row.map(cellEl => {
				if (!cellEl) return "";
				const wrapper = cellEl.querySelector('.table-cell-wrapper');
				const cellContent = wrapper ? wrapper.textContent : cellEl.textContent;
				return (cellContent || "").trim();
			})
		);
	}

	private applyResultsToHTML(tableEl: HTMLTableElement, cells: (HTMLElement | undefined)[][], result: any, gridData: string[][], evaluator: TableEvaluator) {
		this.htmlTable = cells as HTMLElement[][];

		// Apply computed values and styling
		for (let rowIndex = 0; rowIndex < this.htmlTable.length; rowIndex++) {
			for (let colIndex = 0; colIndex < this.htmlTable[rowIndex].length; colIndex++) {
				const cellEl = this.htmlTable[rowIndex][colIndex];
				if (!cellEl) continue; // covered by a merged cell
				const cellContent = gridData[rowIndex]?.[colIndex] || "";
				const computedValue = result.values[rowIndex]?.[colIndex];
				const error = result.errors[rowIndex]?.[colIndex];
				const cellType = result.cellTypes[rowIndex]?.[colIndex];
				const scientific = result.scientific[rowIndex]?.[colIndex] || false;

				// Clear all previous styling classes
				cellEl.classList.remove(
					"formula-cell",
					"formula-cell-borderenabled",
					"formula-cell-colorenabled",
					"matrix-cell",
					"matrix-cell-colorenabled",
					"error-cell",
					"error-cell-colorenabled"
				);

				// Clear overlay data for non-formula cells
				const wrapper = cellEl.querySelector<HTMLElement>(".table-cell-wrapper");
				if (wrapper) {
					wrapper.classList.remove("calc-overlay-cell");
					wrapper.removeAttribute("data-calc-display");
				}

				// Initialize CalcCraft metadata
				(cellEl as any).CalcCraft = {
					parents: [],
					children: [],
					settings: this.settings
				};

				// Get parents from evaluator and convert to HTML elements
				const parentCoords = evaluator.parents[rowIndex][colIndex];
				parentCoords.forEach(([parentRow, parentCol]: [number, number]) => {
					if (this.htmlTable[parentRow] && this.htmlTable[parentRow][parentCol]) {
						(cellEl as any).CalcCraft.parents.push(this.htmlTable[parentRow][parentCol]);
					}
				});

				// Get children from evaluator and convert to HTML elements
				const childrenCoords = evaluator.children[rowIndex][colIndex];
				childrenCoords.forEach(([childRow, childCol]: [number, number]) => {
					if (this.htmlTable[childRow] && this.htmlTable[childRow][childCol]) {
						(cellEl as any).CalcCraft.children.push(this.htmlTable[childRow][childCol]);
					}
				});

				// Apply styling and content based on cell type
				if (cellType === 2) { // formula
					cellEl.classList.add("formula-cell");
					cellEl.setAttribute("title", cellContent);

					if (error) {
						cellEl.classList.add("error-cell");
						if (this.settings.formula_background_error_toggle) {
							cellEl.classList.add("error-cell-colorenabled");
						}
						// Pass error as separate parameter
						this.setFormattedCellValue(cellEl, computedValue, scientific, error);
					} else {
						this.setFormattedCellValue(cellEl, computedValue, scientific);
					}

				} else if (cellType === 3) { // matrix
					cellEl.classList.add("matrix-cell");
					this.setFormattedCellValue(cellEl, computedValue, scientific);
				} else if (cellType === 4) { // escaped_text
					cellEl.classList.add("escaped-text-cell");

					const wrapper = cellEl.querySelector<HTMLElement>(".table-cell-wrapper");
					if (wrapper) {
						// Don't modify textContent - keep '=value
						wrapper.dataset.calcDisplay = String(computedValue); // =value (without ')
						wrapper.classList.add("calc-overlay-cell");
						cellEl.setAttribute("title", cellContent); // Shows '=value
					} else {
						// Reading view
						cellEl.textContent = String(computedValue);
					}
				}
			}
		}

		this.addTableEventListeners(tableEl);
	}

	// Header rows are the leading rows made only of <th>. Markdown tables have one;
	// plugins such as Table Extended and Table Master allow several.
	private countHeaderRows(tableEl: HTMLTableElement): number {
		let count = 0;
		for (const row of Array.from(tableEl.rows)) {
			const cells = Array.from(row.cells);
			if (cells.length === 0 || !cells.every(cell => cell.tagName === "TH")) break;
			count++;
		}
		return count;
	}

	// Labels are rendered by CSS pseudo-elements from these data attributes (see styles.css)
	private addSimpleLabels(cells: (HTMLElement | undefined)[][], headerRows: number): void {
		// Column letters on the first row
		(cells[0] || []).forEach((cell, colIndex) => {
			if (cell) cell.dataset.colLetter = String.fromCharCode(65 + colIndex); // 'A' + index
		});

		// Row numbers start at 1 on the first row after the header
		cells.forEach((row, rowIndex) => {
			const firstCell = row[0];
			if (!firstCell) return;
			if (rowIndex < headerRows) {
				delete firstCell.dataset.rowNumber;
			} else {
				firstCell.dataset.rowNumber = String(rowIndex - headerRows + 1);
			}
		});
	}

	// Apply the global precision setting and separators, in scientific notation if asked
	private formatNumber(num: number, scientific = false): string {
		const precision = this.settings.precision;
		return this.applySeparators(scientific ? formatExponential(num, precision) : formatFixed(num, precision));
	}

	private applySeparators(numString: string): string {
		const parts = numString.split('.');
		let integerPart = parts[0];
		const decimalPart = parts[1];

		if (this.settings.digitGrouping) {
			integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, this.settings.groupingSeparator || ',');
		}

		const result = decimalPart !== undefined
			? integerPart + (this.settings.decimalSeparator || '.') + decimalPart
			: integerPart;

		return result;
	}

	private setFormattedCellValue(cellEl: HTMLElement, value: any, scientific: boolean, error?: string): void {
		let data = value;

		// Handle mathjs Unit objects
		if (typeof data === "object" && data !== null &&
			(data.constructor?.name === "Unit" ||
			(data.value !== undefined && data.units !== undefined))) {
			// Applies global precision + separators to the number part
			const parts = splitUnit(data);
			data = parts ? `${this.formatNumber(parts[0], scientific)} ${parts[1]}` : data.toString();
		}
		// Handle numbers (NOT pre-formatted)
		else if (typeof data === "number") {
			data = this.formatNumber(data, scientific); // Applies global precision + separators
		}
		// Handle strings (from format() - already has precision applied)
		else if (typeof data === "string") {
			const numMatch = data.match(/^(-?\d*\.?\d+(?:e[+-]?\d+)?)$/);
			if (numMatch) {
				// String number from format() - ONLY apply separators, NO precision change
				data = this.applySeparators(data);
			} else {
				const unitMatch = data.match(/^(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*(.+)$/);
				if (unitMatch) {
					const [, numberPart, unitPart] = unitMatch;
					data = this.applySeparators(numberPart) + ' ' + unitPart;
				}
			}
		}

		const wrapper = cellEl.querySelector<HTMLElement>('.table-cell-wrapper');
		if (wrapper) {
			wrapper.dataset.calcDisplay = error || String(data);
			wrapper.classList.add('calc-overlay-cell');
			return;
		}
		cellEl.textContent = error || String(data);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DefaultSettings, await this.loadData());
		this.updatecssvars();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	updatecssvars() {
		for (const variable in this.settings) {
			if (
				typeof this.settings[variable] === "string" &&
				this.settings[variable].startsWith("#")
			) {
				document.documentElement.style.setProperty(
					"--CalcCraft_" + variable,
					this.settings[variable]
				);
			}
		}

	}

	
	private addTableEventListeners(tableEl: HTMLTableElement): void {

		// Attach a single 'mouseover' event listener to the table
		tableEl.addEventListener("mouseover", function (event) {
			const target = event.target as HTMLElement;
			const cellEl = target.closest("td, th") as HTMLElement; // Get the closest cell element to the event target
			if (!cellEl) return; // No cell? Get outta here.
			cellEl.classList.add("cell-active");
			if ((cellEl as any)?.CalcCraft == undefined) return;

			if (
				cellEl.classList.contains("formula-cell") ||
				cellEl.classList.contains("matrix-cell")
			) {
				if ((tableEl as any).CalcCraft.settings.formula_background_parents_toggle) {
					(cellEl as any).CalcCraft.parents.forEach((depCellEl: HTMLElement) => {
						depCellEl.classList.add("cell-parents-highlight");
					});
				}
			}
			if ((tableEl as any).CalcCraft.settings.formula_background_children_toggle) {
				(cellEl as any).CalcCraft.children?.forEach((depCellEl: HTMLElement) => {
					depCellEl.classList.add("cell-children-highlight");
				});
			}
		});

		// Similar approach for 'mouseout'
		tableEl.addEventListener("mouseout", function (event) {
			const target = event.target as HTMLElement;
			const cellEl = target.closest("td, th") as HTMLElement; // Get the closest cell element to the event target
			if (!cellEl) return; // No cell? Get outta here.
			cellEl.classList.remove("cell-active");

			if ((cellEl as any)?.CalcCraft == undefined) return;
			if (
				cellEl.classList.contains("formula-cell") ||
				cellEl.classList.contains("matrix-cell")
			) {
				if ((tableEl as any).CalcCraft.settings.formula_background_parents_toggle) {
					(cellEl as any).CalcCraft.parents.forEach((depCellEl: HTMLElement) => {
						depCellEl.classList.remove("cell-parents-highlight");
					});
				}
			}
			if ((tableEl as any).CalcCraft.settings.formula_background_children_toggle) {
				(cellEl as any).CalcCraft.children?.forEach((depCellEl: HTMLElement) => {
					depCellEl.classList.remove("cell-children-highlight");
				});
			}
		});
	}

	debug(message: any): void {
		if (debug) {
			console.log(message);
		}
	}

	private scheduleRecompute = (delay = 40) => {
		// simple debounce so many mutations collapse into one recompute
		if (this.recomputeTimer) {
			window.clearTimeout(this.recomputeTimer);
		}
		this.recomputeTimer = window.setTimeout(() => {
			this.recomputeTimer = null;
			requestAnimationFrame(() => this.recomputeLivePreview());
		}, delay);
	};

	private recomputeLivePreview = () => {
		// don't start a recompute if one is already running
		if (this.isEvaluating) {
			this.debug("Recompute already running — skipping.");
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const root = (view as any)?.editor?.cm?.contentDOM as HTMLElement | undefined;
		if (!root) return;

		// mark we are running and temporarily suspend reacting to mutations
		this.isEvaluating = true;
		this.suspendMutations = true;

		try {
			this.debug("Recomputing Live Preview tables");
			// perform the work (this.postProcessor mutates DOM)
			this.postProcessor(root, {} as any);
		} catch (err) {
			console.error("CalcCraft: recomputeLivePreview error", err);
		} finally {
			// re-enable observing on the next frame so we don't catch our own writes
			requestAnimationFrame(() => {
				this.suspendMutations = false;
				this.isEvaluating = false;
			});
		}
	};

	private attachLivePreviewHooks = () => {
		this.detachLivePreviewHooks();

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const root = (view as any)?.editor?.cm?.contentDOM as HTMLElement | undefined;
		if (!root) {
			this.debug("No Live Preview root found");
			return;
		}

		this.debug("Attaching Live Preview hooks");

		// Only trigger on blur (when user finishes editing), not on input
		const onCellBlur = (e: Event) => {
			const target = e.target as HTMLElement;
			if (target?.closest(".cm-table-widget")) {
				this.debug("Table cell blur detected, triggering recompute");
				// Add a small delay to ensure the DOM is stable
				setTimeout(() => this.recomputeLivePreview(), 50);
			}
		};

		root.addEventListener("blur", onCellBlur, true);
		this.lpCleanup.push(() => {
			root.removeEventListener("blur", onCellBlur, true);
		});

		// Recompute on DOM changes (childList only, debounced)
		const mo = new MutationObserver((mutations) => {
			// if editing inside a table widget, do not recompute
			const hasActiveEdit = root.querySelector('.cm-table-widget .table-cell-wrapper:focus-within');
			if (hasActiveEdit) return;

			// if we ourselves suspended mutations (we're applying programmatic changes), ignore
			if (this.suspendMutations) {
				this.debug("Mutation ignored while suspendMutations is true");
				return;
			}

			this.debug("DOM mutation detected (no active edit)");
			// debounce and schedule recompute to collapse many mutations
			this.scheduleRecompute();
		});
		mo.observe(root, { childList: true, subtree: true });
		this.lpCleanup.push(() => mo.disconnect());

		// Initial pass
		this.recomputeLivePreview();
	};

	private clearTableHighlights(tableEl: HTMLTableElement) {
		if (!tableEl) return;

		// Remove highlight classes and the "active" marker
		tableEl.querySelectorAll<HTMLElement>(
			'.cell-parents-highlight, .cell-children-highlight, .cell-active, .calc-overlay-cell'
		).forEach(el => {
			el.classList.remove('cell-parents-highlight', 'cell-children-highlight', 'cell-active', 'calc-overlay-cell');

			// remove overlay dataset if present
			const wrapper = el.querySelector<HTMLElement>('.table-cell-wrapper');
			if (wrapper) {
				wrapper.removeAttribute('data-calc-display');
				wrapper.classList.remove('calc-overlay-cell');
			}

			// clear any CalcCraft bookkeeping on the element to avoid stale references
			if ((el as any).CalcCraft) {
				try {
					(el as any).CalcCraft.parents = [];
					(el as any).CalcCraft.children = [];
					delete (el as any).CalcCraft;
				} catch (e) {
					// silence any unexpected structure
				}
			}
		});
	}

	private detachLivePreviewHooks = () => {
		this.debug("Detaching Live Preview hooks");
		this.lpCleanup.forEach(fn => fn());
		this.lpCleanup = [];
	};

	private safelyMutateDOM(fn: () => void) {
		this.suspendMutations = true;
		try {
			fn();
		} finally {
			requestAnimationFrame(() => {
				this.suspendMutations = false;
			});
		}
	}
}
