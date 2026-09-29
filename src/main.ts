// Modified by akmazian (2026) for CalcCraft Revived, adapted from klaudyu/CalcCraft
// (https://github.com/klaudyu/CalcCraft), licensed under Apache 2.0. Changes:
// - references follow inserted, deleted and moved rows/columns; formulas read from the
//   markdown source; header-row detection; uppercase labels
//   numbered from the first row after the header
// - Table Master compatibility (recompute after its rebuild, merged-cell positions)
// - precision setting for unit results; scientific display of results; error details on hover
// - no colour, border or hover underline on computed cells; cells keep their width while
//   edited; Enter in the last row leaves the table; click a cell to insert its reference
// - dead label code and debug logging removed
// See the "CalcCraft Revived" section in CHANGELOG.md.

import { Plugin, MarkdownPostProcessorContext, MarkdownView, TFile } from "obsidian";
import { EditorView } from "@codemirror/view";
import { EditorState, Transaction, TransactionSpec } from "@codemirror/state";
import { CalcCraftSettingsTab, DefaultSettings } from "./settings";
import { TableEvaluator, formatExponential, formatFixed, splitUnit } from "./table-evaluator";
import { cellSpans, sourceTables, tableAtLine, tableBlockAround, tablesInLines, unescapeMarkdown } from "./table-source";
import { detectStructureChange, existedBefore, shiftReferences } from "./table-structure";

const debug = false;

// A CSS string literal, for use in content: var(--calc-size)
const cssString = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\A ")}"`;

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

	// The reference last inserted by clicking a cell while editing a formula (see pointAtCell)
	private pointer: { view: EditorView; from: number; text: string; anchor: [number, number] } | null = null;

	async onload() {
		await this.loadSettings();
		this.registerMarkdownPostProcessor(this.postProcessor.bind(this));
		this.registerEditorExtension(EditorState.transactionFilter.of(tr => this.followStructureChanges(tr)));

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

	// When an edit inserts, deletes or moves rows or columns of a table, rewrite the table's
	// formulas so their references keep pointing at the same cells (see table-structure.ts).
	// As a transaction filter the rewrite is part of the same edit, so one undo reverts both;
	// undo and redo themselves already restore the references.
	private followStructureChanges(tr: Transaction): Transaction | readonly TransactionSpec[] {
		if (!tr.docChanged || tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
		const oldDoc = tr.startState.doc;
		const newDoc = tr.newDoc;
		const changes: { from: number; to: number; insert: string }[] = [];
		const done = new Set<number>();
		try {
			tr.changes.iterChangedRanges((fromA, _toA, fromB) => {
				const oldBlock = tableBlockAround(n => oldDoc.line(n + 1).text, oldDoc.lines, oldDoc.lineAt(fromA).number - 1);
				const newBlock = tableBlockAround(n => newDoc.line(n + 1).text, newDoc.lines, newDoc.lineAt(fromB).number - 1);
				if (!oldBlock || !newBlock || done.has(newBlock.start)) return;
				// the edit must map the whole old table onto the whole new one; otherwise part of
				// a table could look like the table with rows deleted
				const lineStart = (doc: typeof oldDoc, n: number) => doc.line(n + 1).from;
				const lineEnd = (doc: typeof oldDoc, n: number) => doc.line(n).to;
				if (tr.changes.mapPos(lineStart(oldDoc, oldBlock.start), -1) !== lineStart(newDoc, newBlock.start)) return;
				if (tr.changes.mapPos(lineEnd(oldDoc, oldBlock.end), 1) !== lineEnd(newDoc, newBlock.end)) return;
				done.add(newBlock.start);
				const before = sourceTables(oldBlock.lines, oldBlock.lineNumbers);
				const after = sourceTables(newBlock.lines, newBlock.lineNumbers);
				if (before.length !== 1 || after.length !== 1) return;
				const change = detectStructureChange(before[0].rows, after[0].rows);
				if (!change) return;
				// only formulas that were there before; inserted rows/columns are new content
				const oldRows = existedBefore(change.rows);
				const oldCols = existedBefore(change.cols);
				after[0].rows.forEach((row, r) => {
					if (!oldRows[r]) return;
					const line = newDoc.line(after[0].rowLines[r] + 1);
					const spans = cellSpans(line.text);
					row.forEach((text, c) => {
						// cells with escaped pipes don't line up with their spans; leave them
						if (!oldCols[c] || !text.startsWith("=") || text.includes("|") || !spans[c]) return;
						const shifted = shiftReferences(text, change, before[0].headerRows, after[0].headerRows);
						if (shifted !== text) changes.push({ from: line.from + spans[c].from, to: line.from + spans[c].to, insert: shifted });
					});
				});
			});
		} catch (error) {
			console.error("CalcCraft: couldn't update references", error);
			return tr;
		}
		return changes.length ? [tr, { changes, sequential: true }] : tr;
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

		// The markdown source of the tables, to read formulas from (see table-source.ts).
		// Reading view: the section Obsidian rendered. Live Preview: the editor's lines.
		const section = ctx?.getSectionInfo?.(el);
		const sectionTables = section
			? tablesInLines(section.text.split("\n").slice(section.lineStart, section.lineEnd + 1))
			: [];
		tables.forEach((tableEl, index) => {
			const source = this.liveTableSource(tableEl) ?? sectionTables[index];
			if (source) (tableEl as any).calcCraftSource = source;
		});

		// Ignore our own DOM writes in the Live Preview MutationObserver
		this.safelyMutateDOM(() => {
			tables.forEach(tableEl => {
				this.processTable(tableEl);
				this.watchTableMaster(tableEl);
			});
		});
	}

	// Markdown rows of a Live Preview table, from the active editor
	private liveTableSource(tableEl: HTMLTableElement): string[][] | null {
		const widget = tableEl.closest(".cm-table-widget");
		const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		const cm = (editor as any)?.cm;
		if (!widget || !editor || !cm?.dom?.contains(widget)) return null;
		try {
			const line = editor.offsetToPos(cm.posAtDOM(widget)).line;
			return tableAtLine(editor.getValue().split("\n"), line);
		} catch {
			return null;
		}
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

			const gridData = this.extractTableGrid(cells, (tableEl as any).calcCraftSource);
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

	// Cell text as rendered, except formulas, which come from the markdown source when it
	// lines up with the table (rendering drops the * in =A1*B1+A1*B1)
	private extractTableGrid(cells: (HTMLElement | undefined)[][], source?: string[][]): string[][] {
		const useSource = source && source.length === cells.length;
		return cells.map((row, r) =>
			row.map((cellEl, c) => {
				if (!cellEl) return "";
				const raw = useSource ? source[r]?.[c] : undefined;
				// markdown escapes such as \* (so * doesn't turn into italics) mean the character itself
				if (raw !== undefined && (raw.startsWith("=") || raw.startsWith("'="))) return unescapeMarkdown(raw);
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
				const errorDetail = result.errorDetails?.[rowIndex]?.[colIndex];
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
					// Hover shows the formula, and for an error its full reason
					cellEl.setAttribute("title", error && errorDetail ? `${cellContent}\n${error} ${errorDetail}` : cellContent);

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

				// Live Preview: remember what the cell shows, so it keeps this size while being
				// edited (see styles.css) instead of widening as the formula is typed. Obsidian
				// edits in a new wrapper element, so this goes on the cell as a CSS variable.
				const sizeWrapper = cellEl.querySelector<HTMLElement>(".table-cell-wrapper");
				if (sizeWrapper && !cellEl.matches(":focus-within")) {
					const shown = sizeWrapper.dataset.calcDisplay ?? sizeWrapper.textContent ?? "";
					cellEl.dataset.calcSized = "true";
					cellEl.style.setProperty("--calc-size", cssString(shown));
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
		// TRUE/FALSE, as Excel shows them
		else if (typeof data === "boolean") {
			data = data ? "TRUE" : "FALSE";
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
				// "953.13 µL" from format(); text such as "12_48hr" is left as it is
				const unitMatch = data.match(/^(-?\d*\.?\d+(?:e[+-]?\d+)?)\s+(.+)$/);
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

		// Obsidian's table editor adds a row when Enter is pressed in the last row. While
		// editing a cell there, leave the table instead (captured before the cell editor sees it)
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
			const target = e.target as HTMLElement;
			if (!target?.closest?.(".cm-table-widget .table-cell-wrapper")) return;
			const row = target.closest("tr");
			const table = target.closest("table");
			if (!row || !table || row !== table.rows[table.rows.length - 1]) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			this.leaveTable(view as MarkdownView, table);
		};
		root.addEventListener("keydown", onKeyDown, true);
		this.lpCleanup.push(() => {
			root.removeEventListener("keydown", onKeyDown, true);
		});

		// Excel-style pointing: clicking a cell while editing a formula inserts its reference.
		// Obsidian's table editor moves to a cell on pointerdown, so act there and swallow the
		// rest of that click.
		let swallowing = false;
		const onPointerDown = (e: PointerEvent) => {
			swallowing = this.pointAtCell(e);
		};
		const swallow = (e: Event) => {
			if (!swallowing) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			if (e.type === "click") swallowing = false;
		};
		root.addEventListener("pointerdown", onPointerDown, true);
		const swallowed = ["mousedown", "pointerup", "mouseup", "click"];
		swallowed.forEach(type => root.addEventListener(type, swallow, true));
		this.lpCleanup.push(() => {
			root.removeEventListener("pointerdown", onPointerDown, true);
			swallowed.forEach(type => root.removeEventListener(type, swallow, true));
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

	// Like Excel: while editing a formula with the cursor right after =, an operator, ( , or :,
	// clicking another cell of the same table inserts its reference instead of moving there.
	// Clicking again straight away replaces it; shift-click or dragging makes a range. A
	// header cell inserts its whole column (A:A).
	// Returns whether the click was used for pointing
	private pointAtCell(e: PointerEvent): boolean {
		if (e.button !== 0) return false;
		const editingWrapper = (document.activeElement as HTMLElement | null)?.closest?.(".cm-table-widget .table-cell-wrapper");
		const target = (e.target as HTMLElement | null)?.closest?.("td, th") as HTMLElement | null;
		const table = target?.closest("table");
		const editingCell = editingWrapper?.closest("td, th");
		if (!editingWrapper || !target || !table || !editingCell || editingCell === target || editingCell.closest("table") !== table) return false;

		const view = EditorView.findFromDOM(editingWrapper as HTMLElement);
		const position = this.cellPosition(table, target);
		if (!view || !position) return false;
		const text = view.state.doc.toString();
		const head = view.state.selection.main.head;
		if (!text.trimStart().startsWith("=")) return false;

		let from = head;
		let to = head;
		let anchor = position;
		const last = this.pointer;
		if (last?.view === view && last.from + last.text.length === head && text.slice(last.from, head) === last.text) {
			// still right after the reference we inserted: replace it, or extend it with shift
			from = last.from;
			if (e.shiftKey) anchor = last.anchor;
		} else if (!/(^\s*=|[=+\-*/^(,:<>&;]\s*)$/.test(text.slice(0, head))) {
			return false; // not pointing: the click moves to that cell as usual
		}

		e.preventDefault();
		e.stopImmediatePropagation();
		const insert = (ref: string) => {
			view.dispatch({ changes: { from, to, insert: ref }, selection: { anchor: from + ref.length } });
			to = from + ref.length;
			this.pointer = { view, from, text: ref, anchor };
		};
		insert(this.rangeReference(table, anchor, position));

		// dragging across cells turns it into a range (pointer capture may retarget events,
		// so find the cell under the pointer)
		const onMove = (ev: PointerEvent) => {
			const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
			const over = under?.closest?.("td, th") as HTMLElement | null;
			const p = over && over.closest("table") === table ? this.cellPosition(table, over) : null;
			if (p) insert(this.rangeReference(table, anchor, p));
		};
		const onUp = () => {
			document.removeEventListener("pointermove", onMove, true);
			document.removeEventListener("pointerup", onUp, true);
		};
		document.addEventListener("pointermove", onMove, true);
		document.addEventListener("pointerup", onUp, true);
		return true;
	}

	// Grid position of a cell element
	private cellPosition(table: HTMLTableElement, cell: HTMLElement): [number, number] | null {
		const cells = this.tableCells(table);
		for (let r = 0; r < cells.length; r++) {
			const c = cells[r].indexOf(cell);
			if (c >= 0) return [r, c];
		}
		return null;
	}

	// A1, or A1:B3 between two grid positions; header cells mean whole columns (A:B)
	private rangeReference(table: HTMLTableElement, a: [number, number], b: [number, number]): string {
		const headerRows = this.countHeaderRows(table);
		const column = (c: number) => String.fromCharCode(65 + c);
		const [c1, c2] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
		if (a[0] < headerRows || b[0] < headerRows) return `${column(c1)}:${column(c2)}`;
		const [r1, r2] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])].map(r => r - headerRows + 1);
		const start = `${column(c1)}${r1}`;
		const end = `${column(c2)}${r2}`;
		return start === end ? start : `${start}:${end}`;
	}

	// Move the cursor to the start of the line below a Live Preview table, adding that
	// line if the table ends the note
	private leaveTable(view: MarkdownView, tableEl: HTMLTableElement) {
		const editor = view.editor;
		const cm = (editor as any).cm;
		const widget = tableEl.closest(".cm-table-widget");
		if (!cm || !widget) return;
		const firstLine = editor.offsetToPos(cm.posAtDOM(widget)).line;
		// header + separator + body rows
		const lastLine = Math.min(firstLine + tableEl.rows.length, editor.lineCount() - 1);
		if (lastLine + 1 >= editor.lineCount()) {
			editor.replaceRange("\n", { line: lastLine, ch: editor.getLine(lastLine).length });
		}
		// The cell has its own nested editor, and Obsidian's editor.focus() returns focus to
		// the active cell, so blur the cell and focus the note's CodeMirror view directly
		editor.setCursor({ line: lastLine + 1, ch: 0 });
		(document.activeElement as HTMLElement | null)?.blur();
		cm.focus();
	}

	private clearTableHighlights(tableEl: HTMLTableElement) {
		if (!tableEl) return;

		// Remove highlight classes and the "active" marker
		tableEl.querySelectorAll<HTMLElement>(
			'.cell-parents-highlight, .cell-children-highlight, .calc-overlay-cell'
		).forEach(el => {
			el.classList.remove('cell-parents-highlight', 'cell-children-highlight', 'calc-overlay-cell');

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
