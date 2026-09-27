// Tests for keeping references on their cells when rows/columns change

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detectStructureChange, existedBefore, shiftReferences, StructureChange } from "../src/table-structure";

// A table: header, then rows 1-3 (grid rows 1-3), columns A-E
const T = [
	["Sample", "wells", "cells", "per well", "total"],
	["s1", "12w", "2", "1.8e5", "=C1*D1"],
	["s2", "12w", "3", "2e5", "=C2*D2"],
	["s3", "12w", "4", "1e5", "=C3*D3"],
];
const rows = (...idx: number[]) => idx.map(i => (i < 0 ? ["", "", "", "", ""] : [...T[i]]));
const withCol = (at: number) => T.map(r => [...r.slice(0, at), "", ...r.slice(at)]);
const withoutCol = (at: number) => T.map(r => r.filter((_, c) => c !== at));

function shift(change: StructureChange | null, ...formulas: string[]) {
	assert.ok(change, "structure change detected");
	return formulas.map(f => shiftReferences(f, change));
}

describe("detectStructureChange", () => {
	test("typing in a cell is not a structure change", () => {
		const edited = rows(0, 1, 2, 3); edited[2][2] = "30";
		assert.equal(detectStructureChange(T, edited), null);
		assert.equal(detectStructureChange(T, rows(0, 1, 2, 3)), null);
	});

	test("a sort (several rows rearranged) is left alone", () => {
		assert.equal(detectStructureChange(T, rows(0, 3, 1, 2).reverse()), null);
	});

	test("an insertion that also changes other cells is left alone", () => {
		const r = rows(0, 1, -1, 2, 3); r[1][0] = "changed";
		assert.equal(detectStructureChange(T, r), null);
	});
});

describe("rows inserted", () => {
	test("in the middle: references below shift down, ranges across it grow", () => {
		const c = detectStructureChange(T, rows(0, 1, -1, 2, 3));
		assert.deepEqual(shift(c, "=C1*D1", "=C2*D2", "=sum(E1:E3)", "=sum(A:B)", "=sum(B1:B98)"),
			["=C1*D1", "=C3*D3", "=sum(E1:E4)", "=sum(A:B)", "=sum(B1:B99)"]);
	});

	test("above the first row: everything shifts, the range moves rather than grows", () => {
		const c = detectStructureChange(T, rows(0, -1, 1, 2, 3));
		assert.deepEqual(shift(c, "=C1", "=sum(E1:E3)", "=sum(1:2)"), ["=C2", "=sum(E2:E4)", "=sum(2:3)"]);
	});

	test("below the last row: nothing shifts", () => {
		const c = detectStructureChange(T, rows(0, 1, 2, 3, -1));
		assert.deepEqual(shift(c, "=C3", "=sum(E1:E3)"), ["=C3", "=sum(E1:E3)"]);
	});

	test("several rows pasted at once", () => {
		const c = detectStructureChange(T, rows(0, 1, -1, -1, 2, 3));
		assert.deepEqual(shift(c, "=C2"), ["=C4"]);
	});
});

describe("rows deleted", () => {
	test("a deleted referenced row becomes #REF!, like Excel", () => {
		const c = detectStructureChange(T, rows(0, 1, 3));
		assert.deepEqual(shift(c, "=C2*D2", "=C3", "=C1"), ["=#REF!*#REF!", "=C2", "=C1"]);
	});

	test("ranges shrink; a range whose rows are all deleted becomes #REF!", () => {
		assert.deepEqual(shift(detectStructureChange(T, rows(0, 1, 2)), "=sum(E1:E3)"), ["=sum(E1:E2)"]);
		assert.deepEqual(shift(detectStructureChange(T, rows(0, 2, 3)), "=sum(E1:E3)", "=sum(C1:C1)"), ["=sum(E1:E2)", "=sum(#REF!)"]);
	});
});

describe("columns", () => {
	test("inserted before C: C and later shift right, ranges across it grow", () => {
		const c = detectStructureChange(T, withCol(2));
		assert.deepEqual(shift(c, "=C1*D1", "=sum(A:B)", "=sum(B:D)", "=A1"), ["=D1*E1", "=sum(A:B)", "=sum(B:E)", "=A1"]);
	});

	test("deleted: references to it become #REF!, later ones shift left", () => {
		const c = detectStructureChange(T, withoutCol(3));
		assert.deepEqual(shift(c, "=C1*D1", "=E1", "=sum(C1:E1)"), ["=C1*#REF!", "=D1", "=sum(C1:D1)"]);
	});

	test("the numbered form (2c3) shifts too", () => {
		assert.deepEqual(shift(detectStructureChange(T, withCol(1)), "=2c3", "=2c3r"), ["=3c3", "=3c3r"]);
		assert.deepEqual(shift(detectStructureChange(T, rows(0, -1, 1, 2, 3)), "=2c3"), ["=2c4"]);
	});
});

describe("moves", () => {
	test("a moved row takes its references with it", () => {
		const c = detectStructureChange(T, rows(0, 3, 1, 2)); // row 3 dragged to the top
		assert.deepEqual(shift(c, "=C3", "=C1", "=C2"), ["=C1", "=C2", "=C3"]);
	});

	test("ranges keep covering the same rows: a move within a range leaves it, a move out shrinks it", () => {
		assert.deepEqual(shift(detectStructureChange(T, rows(0, 2, 1, 3)), "=sum(C1:C3)", "=sum(C1:C1)"), ["=sum(C1:C3)", "=sum(C2:C2)"]);
		assert.deepEqual(shift(detectStructureChange(T, rows(0, 2, 3, 1)), "=sum(C1:C2)"), ["=sum(C1:C1)"]);
		assert.deepEqual(shift(detectStructureChange(T, rows(0, 3, 1, 2)), "=sum(C1:C2)"), ["=sum(C2:C3)"]);
		// the last row dragged to the top of the range (what Obsidian's drag handle does)
		assert.deepEqual(shift(detectStructureChange(T, rows(0, 3, 1, 2)), "=sum(C1:C3)"), ["=sum(C1:C3)"]);
	});

	test("a moved column takes its references with it", () => {
		const moved = T.map(r => [r[0], r[3], r[1], r[2], r[4]]); // D dragged before B
		const c = detectStructureChange(T, moved);
		assert.deepEqual(shift(c, "=C1*D1", "=B1"), ["=D1*B1", "=C1"]);
	});
});

describe("what doesn't change", () => {
	const insertAbove = () => detectStructureChange(T, rows(0, -1, 1, 2, 3));
	const insertColC = () => detectStructureChange(T, withCol(2));

	test("relative references stay positional", () => {
		assert.deepEqual(shift(insertAbove(), "=+0c-1r", "=-2c+0r*-1c+0r"), ["=+0c-1r", "=-2c+0r*-1c+0r"]);
	});

	test("mixed references shift only their absolute part", () => {
		assert.deepEqual(shift(insertColC(), "=C+0r", "=+0c2"), ["=D+0r", "=+0c2"]);
		assert.deepEqual(shift(insertAbove(), "=C+0r", "=+0c2", "=sum(+0c1:+0c-1r)"), ["=C+0r", "=+0c3", "=sum(+0c2:+0c-1r)"]);
	});

	test("names, numbers and quoted text are not references", () => {
		assert.deepEqual(shift(insertColC(), "=LOG10(C1)", "=1e5*C1", '=IF(C1>0, "C1", "no")', "=LN2*C1"),
			["=LOG10(D1)", "=1e5*D1", '=IF(D1>0, "C1", "no")', "=LN2*D1"]);
	});
});

describe("edge cases", () => {
	test("a referenced row moved into the header becomes #REF!", () => {
		const c = detectStructureChange(T, rows(1, 0, 2, 3)); // header dragged below s1
		assert.deepEqual(shift(c, "=C1", "=sum(C1:C3)", "=C2"), ["=#REF!", "=sum(C1:C3)", "=C2"]);
	});

	test("inserted rows and columns are marked new (their formulas aren't rewritten)", () => {
		const r = detectStructureChange(T, rows(0, 1, -1, 2, 3));
		assert.deepEqual(existedBefore(r!.rows), [true, true, false, true, true]);
		const c = detectStructureChange(T, withCol(2));
		assert.deepEqual(existedBefore(c!.cols), [true, true, false, true, true, true]);
	});
});
