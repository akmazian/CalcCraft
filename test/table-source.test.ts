// Tests for reading table cells from the markdown source

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitRow, tableAtLine, tablesInLines } from "../src/table-source";

describe("splitRow", () => {
	test("keeps formulas exactly, asterisks included", () => {
		assert.deepEqual(splitRow("| 2 | 3 | =A1*B1+A1*B1 |"), ["2", "3", "=A1*B1+A1*B1"]);
	});

	test("escaped pipes stay in the cell; rows without outer pipes work", () => {
		assert.deepEqual(splitRow("| a \\| b | c |"), ["a | b", "c"]);
		assert.deepEqual(splitRow("a | b"), ["a", "b"]);
		assert.deepEqual(splitRow("| a |  |"), ["a", ""]);
	});
});

describe("tablesInLines", () => {
	const note = [
		"intro text",
		"",
		"| a | b |",
		"| --- | :-: |",
		"| 1 | =A1*2*3 |",
		"| 2 | =A2==2 |",
		"",
		"between",
		"",
		"x | y",
		"--|--",
		"5 | =A1*B1",
	];

	test("finds each table, without the separator line", () => {
		assert.deepEqual(tablesInLines(note), [
			[["a", "b"], ["1", "=A1*2*3"], ["2", "=A2==2"]],
			[["x", "y"], ["5", "=A1*B1"]],
		]);
	});

	test("rows above the separator are header rows (Table Extended / Table Master)", () => {
		assert.deepEqual(tablesInLines(["| h1 | h2 |", "| s1 | s2 |", "| - | - |", "| 1 | 2 |"]), [
			[["h1", "h2"], ["s1", "s2"], ["1", "2"]],
		]);
	});

	test("no separator, no table", () => {
		assert.deepEqual(tablesInLines(["| a | b |", "| 1 | 2 |"]), []);
	});
});

describe("tableAtLine", () => {
	test("the table starting at a Live Preview widget's line", () => {
		const lines = ["# note", "", "| a |", "| - |", "| =1*2*3 |", "", "after"];
		assert.deepEqual(tableAtLine(lines, 2), [["a"], ["=1*2*3"]]);
		assert.equal(tableAtLine(lines, 6), null);
	});
});
