// Part of a fork of klaudyu/CalcCraft (https://github.com/klaudyu/CalcCraft), licensed under
// Apache 2.0. New file: keeps references pointing at the same cells when rows or columns are
// inserted, deleted or moved, like Excel.
//
// detectStructureChange compares a table before and after an edit and works out which old row
// and column became which new one. shiftReferences then rewrites a formula's A1-style
// references through that mapping. Relative references (+0c-1r) are positional and stay as
// they are; a reference to a deleted row or column becomes #REF!.

// Old index -> new index, null if deleted. Indices past the old table (A1:A98 in a 5-row
// table) shift by the change in length.
export interface Axis {
	map: (number | null)[];
	oldLength: number;
	newLength: number;
	// set when one row/column was moved: ranges then map as its removal plus its insertion
	move?: { from: number; to: number };
}

export interface StructureChange {
	rows: Axis;
	cols: Axis;
}

const identity = (n: number): Axis => ({ map: Array.from({ length: n }, (_, i) => i), oldLength: n, newLength: n });

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// Map for `from` moved to position `to`
function moveAxis(n: number, from: number, to: number): Axis {
	const order = Array.from({ length: n }, (_, i) => i);
	order.splice(to, 0, ...order.splice(from, 1));
	const map: number[] = [];
	order.forEach((oldIndex, newIndex) => (map[oldIndex] = newIndex));
	return { map, oldLength: n, newLength: n, move: { from, to } };
}



// If `newer` is `older` with items inserted or deleted (and nothing else changed), the mapping
function insertDeleteAxis<T>(older: T[], newer: T[], equal: (a: T, b: T) => boolean): Axis | null {
	const [short, long] = older.length < newer.length ? [older, newer] : [newer, older];
	// every item of the shorter list must appear in the longer one, in order
	const matched: number[] = [];
	let j = 0;
	for (const item of short) {
		while (j < long.length && !equal(item, long[j])) j++;
		if (j === long.length) return null;
		matched.push(j++);
	}
	const map: (number | null)[] = [];
	if (older.length < newer.length) {
		older.forEach((_, i) => (map[i] = matched[i]));
	} else {
		older.forEach((_, i) => (map[i] = null));
		matched.forEach((oldIndex, newIndex) => (map[oldIndex] = newIndex));
	}
	return { map, oldLength: older.length, newLength: newer.length };
}

// If `newer` is `older` with one item moved, the mapping. A move only changes the span
// between its two ends, so the first and last differing positions are the only candidates.
function singleMoveAxis<T>(older: T[], newer: T[], equal: (a: T, b: T) => boolean): Axis | null {
	const n = older.length;
	if (newer.length !== n) return null;
	let first = 0;
	while (first < n && equal(older[first], newer[first])) first++;
	if (first === n) return null;
	let last = n - 1;
	while (last > first && equal(older[last], newer[last])) last--;
	for (const [from, to] of [[first, last], [last, first]]) {
		const moved = [...older];
		moved.splice(to, 0, ...moved.splice(from, 1));
		if (moved.every((item, i) => equal(item, newer[i]))) return moveAxis(n, from, to);
	}
	return null;
}

// Rows and columns of a table as seen by an edit, or null if the edit didn't change the
// table's structure (typing in a cell) or did something else (a sort, several moves)
export function detectStructureChange(oldRows: string[][], newRows: string[][]): StructureChange | null {
	const oldCols = Math.max(0, ...oldRows.map(r => r.length));
	const newCols = Math.max(0, ...newRows.map(r => r.length));

	if (oldRows.length === newRows.length && oldCols === newCols) {
		if (oldRows.every((row, i) => same(row, newRows[i]))) return null;
		const rowMove = singleMoveAxis(oldRows, newRows, same);
		if (rowMove) return { rows: rowMove, cols: identity(oldCols) };
		const column = (rows: string[][], c: number) => rows.map(r => r[c] ?? "");
		const oldColumns = Array.from({ length: oldCols }, (_, c) => column(oldRows, c));
		const newColumns = Array.from({ length: newCols }, (_, c) => column(newRows, c));
		const colMove = singleMoveAxis(oldColumns, newColumns, same);
		if (colMove) return { rows: identity(oldRows.length), cols: colMove };
		return null;
	}

	if (oldCols === newCols) {
		const rows = insertDeleteAxis(oldRows, newRows, same);
		return rows && { rows, cols: identity(oldCols) };
	}

	if (oldRows.length === newRows.length) {
		const column = (rows: string[][], c: number) => rows.map(r => r[c] ?? "");
		const oldColumns = Array.from({ length: oldCols }, (_, c) => column(oldRows, c));
		const newColumns = Array.from({ length: newCols }, (_, c) => column(newRows, c));
		const cols = insertDeleteAxis(oldColumns, newColumns, same);
		return cols && { rows: identity(oldRows.length), cols };
	}

	return null;
}

const mapIndex = (axis: Axis, i: number): number | null =>
	i < axis.oldLength ? axis.map[i] : i + axis.newLength - axis.oldLength;

// A range's new ends: a deleted end moves inwards to the nearest surviving row/column. After
// a move, a range covers where its rows went: moving a row within it (even to its first or
// last position) keeps it whole, moving one out shrinks it, a one-cell range follows its cell.
function mapRange(axis: Axis, a: number, b: number): [number, number] | null {
	const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
	if (axis.move) {
		const members = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
		const at = (list: number[]) => list.map(i => mapIndex(axis, i) as number);
		let positions = at(members);
		const contiguous = Math.max(...positions) - Math.min(...positions) === positions.length - 1;
		const movedInside = axis.move.from >= lo && axis.move.from <= hi;
		if (movedInside && !contiguous) positions = at(members.filter(i => i !== axis.move?.from));
		return [Math.min(...positions), Math.max(...positions)];
	}
	let start: number | null = null;
	for (let i = lo; i <= hi && start === null; i++) start = mapIndex(axis, i);
	let end: number | null = null;
	for (let i = hi; i >= lo && end === null; i--) end = mapIndex(axis, i);
	return start === null || end === null ? null : [start, end];
}

const REF = "([A-Z]|[+-]?\\d+c)([+-]?\\d+r|\\d+)";
const RANGE = new RegExp(`^${REF}:${REF}`);
const CELL = new RegExp(`^${REF}`);
const COLUMN_RANGE = /^([A-Z]):([A-Z])/;
const ROW_RANGE = /^(\d+):(\d+)/;
const NAME = /^[a-zA-Z]{2,}[a-zA-Z0-9_]*\(/;
const NUMBER = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const DELETED = "#REF!";

// Rewrite the references in a formula for a structure change. Row numbers count from the
// first row after the header rows, as in formulas.
export function shiftReferences(formula: string, change: StructureChange, oldHeaderRows = 1, newHeaderRows = 1): string {
	const toGrid = (n: number) => (n < 1 ? null : n + oldHeaderRows - 1);
	const fromGrid = (i: number) => i - newHeaderRows + 1;
	// a row that ends up among the header rows (the header was moved) can't be referenced
	const inHeader = (i: number | null) => i !== null && i < newHeaderRows;

	// one end of a reference: [column part, row part] -> new text, or null if deleted
	const colPart = (part: string, newIndex: number) => (/^[A-Z]$/.test(part) ? String.fromCharCode(65 + newIndex) : `${newIndex + 1}c`);
	const rowPart = (part: string, newIndex: number) => (part.endsWith("r") ? `${fromGrid(newIndex)}r` : `${fromGrid(newIndex)}`);
	const colOf = (part: string) => (/^[A-Z]$/.test(part) ? part.charCodeAt(0) - 65 : /^\d+c$/.test(part) ? parseInt(part) - 1 : null);
	const rowOf = (part: string) => (/^\d+r?$/.test(part) ? toGrid(parseInt(part)) : null);

	const cell = (c: string, r: string): string | null => {
		const col = colOf(c), row = rowOf(r);
		const newCol = col === null ? null : mapIndex(change.cols, col);
		const newRow = row === null ? null : mapIndex(change.rows, row);
		if ((col !== null && newCol === null) || (row !== null && (newRow === null || inHeader(newRow)))) return null;
		return (col === null ? c : colPart(c, newCol as number)) + (row === null ? r : rowPart(r, newRow as number));
	};

	// Both ends absolute on an axis: map as a range (a deleted end moves inwards). Otherwise map
	// each absolute part on its own; relative parts stay as they are.
	const axisEnds = (a: number | null, b: number | null, axis: Axis): [number | null, number | null] | null => {
		if (a !== null && b !== null) {
			const r = mapRange(axis, a, b);
			return r && (a <= b ? r : [r[1], r[0]]);
		}
		const na = a === null ? null : mapIndex(axis, a);
		const nb = b === null ? null : mapIndex(axis, b);
		return (a !== null && na === null) || (b !== null && nb === null) ? null : [na, nb];
	};

	const range = (c1: string, r1: string, c2: string, r2: string): string | null => {
		const cols = axisEnds(colOf(c1), colOf(c2), change.cols);
		const rows = axisEnds(rowOf(r1), rowOf(r2), change.rows);
		if (!cols || !rows) return null;
		// rows that became header rows drop out of the range, like deleted ones
		if (rows[0] !== null && rows[1] !== null) {
			const lo = rows[0] <= rows[1] ? 0 : 1;
			if (inHeader(rows[1 - lo])) return null;
			if (inHeader(rows[lo])) rows[lo] = newHeaderRows;
		} else if (inHeader(rows[0]) || inHeader(rows[1])) {
			return null;
		}
		const end = (c: string, r: string, nc: number | null, nr: number | null) =>
			(nc === null ? c : colPart(c, nc)) + (nr === null ? r : rowPart(r, nr));
		return `${end(c1, r1, cols[0], rows[0])}:${end(c2, r2, cols[1], rows[1])}`;
	};

	let out = "";
	let i = 0;
	while (i < formula.length) {
		const rest = formula.slice(i);
		if (formula[i] === '"') {
			const close = formula.indexOf('"', i + 1);
			const end = close < 0 ? formula.length : close + 1;
			out += formula.slice(i, end);
			i = end;
			continue;
		}
		// inside a name such as log2 or LN2 nothing is a reference
		if (i > 0 && /[A-Za-z_]/.test(formula[i - 1])) {
			out += formula[i++];
			continue;
		}
		let m: RegExpMatchArray | null;
		if ((m = rest.match(RANGE))) {
			out += range(m[1], m[2], m[3], m[4]) ?? DELETED;
		} else if ((m = rest.match(COLUMN_RANGE))) {
			const r = mapRange(change.cols, m[1].charCodeAt(0) - 65, m[2].charCodeAt(0) - 65);
			out += r ? `${String.fromCharCode(65 + r[0])}:${String.fromCharCode(65 + r[1])}` : DELETED;
		} else if ((m = rest.match(ROW_RANGE))) {
			const [a, b] = [toGrid(parseInt(m[1])), toGrid(parseInt(m[2]))];
			const r = a !== null && b !== null ? mapRange(change.rows, a, b) : null;
			const clamped = r && !inHeader(r[1]) ? [Math.max(r[0], newHeaderRows), r[1]] : null;
			out += clamped ? `${fromGrid(clamped[0])}:${fromGrid(clamped[1])}` : a === null || b === null ? m[0] : DELETED;
		} else if ((m = rest.match(NAME))) {
			out += m[0];
		} else if ((m = rest.match(CELL))) {
			out += cell(m[1], m[2]) ?? DELETED;
		} else if ((m = rest.match(NUMBER))) {
			out += m[0];
		} else {
			m = [formula[i]];
			out += formula[i];
		}
		i += m[0].length;
	}
	return out;
}

// Whether a row/column of the new table existed before the edit (inserted ones are new, and
// their formulas are already written for the new layout)
export function existedBefore(axis: Axis): boolean[] {
	const existed = Array.from({ length: axis.newLength }, () => false);
	axis.map.forEach(newIndex => {
		if (newIndex !== null) existed[newIndex] = true;
	});
	return existed;
}
