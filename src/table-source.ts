// Part of a fork of klaudyu/CalcCraft (https://github.com/klaudyu/CalcCraft), licensed under
// Apache 2.0. New file: reads table cells from the markdown source.
//
// Formulas have to be read from the markdown source, not the rendered cell: Obsidian renders
// markdown inside cells, so =A1*B1+A1*B1 shows as =A1<em>B1+A1</em>B1 and its text loses the
// asterisks (and ==...== would become a highlight).

const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const isTableLine = (line: string) => line.trim() !== "" && line.includes("|");

// The raw text of each cell in a table row: "| a | b\|c |" -> ["a", "b|c"]
export function splitRow(line: string): string[] {
	let text = line.trim();
	if (text.startsWith("|")) text = text.slice(1);
	if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
	return text.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
}

// Every table in these lines, as rows of raw cell text (the separator line is left out; rows
// above it are header rows)
export function tablesInLines(lines: string[]): string[][][] {
	const tables: string[][][] = [];
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
		tables.push([...lines.slice(start, i), ...lines.slice(i + 1, end)].map(splitRow));
		i = end;
	}
	return tables;
}

// The table whose first line is at `line` (a Live Preview table widget starts there)
export function tableAtLine(lines: string[], line: number): string[][] | null {
	let end = line;
	while (end < lines.length && isTableLine(lines[end])) end++;
	return tablesInLines(lines.slice(line, end))[0] ?? null;
}
