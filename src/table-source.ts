// Part of CalcCraft Revived, adapted from klaudyu/CalcCraft (https://github.com/klaudyu/CalcCraft), licensed under
// Apache 2.0. New file: reads table cells from the markdown source.
//
// Formulas have to be read from the markdown source, not the rendered cell: Obsidian renders
// markdown inside cells, so =A1*B1+A1*B1 shows as =A1<em>B1+A1</em>B1 and its text loses the
// asterisks (and ==...== would become a highlight).

const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const isTableLine = (line: string) => line.trim() !== "" && line.includes("|");

// Character spans of each cell's (trimmed) text in a table row; "| a | b |" -> a, b
export function cellSpans(line: string): { from: number; to: number }[] {
	let start = line.length - line.trimStart().length;
	let end = line.trimEnd().length;
	if (line[start] === "|") start++;
	if (end > start && line[end - 1] === "|" && line[end - 2] !== "\\") end--;
	const spans: { from: number; to: number }[] = [];
	let from = start;
	for (let i = start; i <= end; i++) {
		if (i === end || (line[i] === "|" && line[i - 1] !== "\\")) {
			let a = from;
			let b = i;
			while (a < b && /\s/.test(line[a])) a++;
			while (b > a && /\s/.test(line[b - 1])) b--;
			spans.push({ from: a, to: b });
			from = i + 1;
		}
	}
	return spans;
}

// Markdown backslash escapes mean the character itself: =A1\*B1 is =A1*B1
export function unescapeMarkdown(text: string): string {
	return text.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

// The raw text of each cell in a table row: "| a | b\|c |" -> ["a", "b|c"]
export function splitRow(line: string): string[] {
	return cellSpans(line).map(({ from, to }) => line.slice(from, to).replace(/\\\|/g, "|"));
}

export interface SourceTable {
	// line numbers (0-based) of each row, the separator line left out
	rowLines: number[];
	// rows above the separator
	headerRows: number;
	rows: string[][];
}

// Every table in these lines; `offset` is the line number of lines[0], or the line number of
// each line when they aren't consecutive
export function sourceTables(lines: string[], offset: number | number[] = 0): SourceTable[] {
	const lineNumber = (n: number) => (typeof offset === "number" ? n + offset : offset[n]);
	const tables: SourceTable[] = [];
	let i = 0;
	while (i < lines.length) {
		if (!SEPARATOR.test(lines[i]) || i === 0 || !isTableLine(lines[i - 1])) {
			i++;
			continue;
		}
		let start = i - 1;
		while (start > 0 && isTableLine(lines[start - 1]) && !SEPARATOR.test(lines[start - 1])) start--;
		let end = i + 1;
		while (end < lines.length && isTableLine(lines[end]) && !SEPARATOR.test(lines[end])) end++;
		// a line just before the next separator is that table's header, not this table's row
		if (end < lines.length && SEPARATOR.test(lines[end])) end--;
		const rowLines = [...range(start, i), ...range(i + 1, end)];
		tables.push({
			rowLines: rowLines.map(lineNumber),
			headerRows: i - start,
			rows: rowLines.map(n => splitRow(lines[n])),
		});
		i = end;
	}
	return tables;
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

// Every table in these lines, as rows of raw cell text (rows above the separator are header rows)
export function tablesInLines(lines: string[]): string[][][] {
	return sourceTables(lines).map(table => table.rows);
}

// The table whose first line is at `line` (a Live Preview table widget starts there)
export function tableAtLine(lines: string[], line: number): string[][] | null {
	let end = line;
	while (end < lines.length && isTableLine(lines[end])) end++;
	return tablesInLines(lines.slice(line, end))[0] ?? null;
}

export interface TableBlock {
	start: number;
	// line after the block's last line
	end: number;
	lines: string[];
	// line number of each entry of lines (blank lines are left out)
	lineNumbers: number[];
}

// The contiguous block of table lines around `line` (or the line above it, for an edit that
// removed a table's last row), read through getLine; null if there is none. Rows stranded
// below it by blank lines (pressing Enter at the end of a row in source mode splits the table
// until the new row is typed) are included, as long as they aren't a table of their own.
export function tableBlockAround(getLine: (n: number) => string, lineCount: number, line: number): TableBlock | null {
	if (line >= lineCount || !isTableLine(getLine(line))) line--;
	while (line > 0 && getLine(line).trim() === "") line--; // blank lines inside a split table
	if (line < 0 || !isTableLine(getLine(line))) return null;
	let start = line;
	while (start > 0 && isTableLine(getLine(start - 1))) start--;
	const lineNumbers: number[] = [];
	let end = start;
	for (;;) {
		while (end < lineCount && isTableLine(getLine(end))) lineNumbers.push(end++);
		// blank lines followed by stranded rows (table lines without a separator of their own)
		let next = end;
		while (next < lineCount && getLine(next).trim() === "") next++;
		let orphanEnd = next;
		while (orphanEnd < lineCount && isTableLine(getLine(orphanEnd))) orphanEnd++;
		const orphans = range(next, orphanEnd);
		if (next === end || !orphans.length || orphans.some(n => SEPARATOR.test(getLine(n)))) break;
		end = next;
	}
	return { start, end, lines: lineNumbers.map(getLine), lineNumbers };
}
