// Tests for reading table cells from the markdown source

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sourceTables, splitRow, tableAtLine, tableBlockAround, tablesInLines, unescapeMarkdown } from "../src/table-source";
import { detectStructureChange, shiftReferences } from "../src/table-structure";

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

describe("unescapeMarkdown", () => {
	test("\\* and other escapes mean the character itself", () => {
		assert.equal(unescapeMarkdown("=A1\\*B1"), "=A1*B1");
		assert.equal(unescapeMarkdown("=[A1:C3]\\*[1,1,1]"), "=[A1:C3]*[1,1,1]");
		assert.equal(unescapeMarkdown("=A1 \\= B1"), "=A1 = B1");
		assert.equal(unescapeMarkdown("=A1*B1"), "=A1*B1");
	});
});

describe("source mode: Enter at the end of a row splits the table until the row is typed", () => {
	// what followStructureChanges compares: the tables around the edited line, before and after
	const tablesAround = (lines: string[], line: number) => {
		const block = tableBlockAround(n => lines[n], lines.length, line)!;
		return sourceTables(block.lines, block.lineNumbers)[0].rows;
	};
	const table = ["| a | b |", "| - | - |", "| top | =B2+B3 |", "| s2 | 3 |", "| s3 | 4 |", "", "after"];
	const split = ["| a | b |", "| - | - |", "| top | =B2+B3 |", "", "| s2 | 3 |", "| s3 | 4 |", "", "after"];
	const joined = ["| a | b |", "| - | - |", "| top | =B2+B3 |", "| new | 5 |", "| s2 | 3 |", "| s3 | 4 |", "", "after"];

	test("the split itself is no structure change (was: =#REF!+#REF!)", () => {
		assert.equal(detectStructureChange(tablesAround(table, 2), tablesAround(split, 2)), null);
	});

	test("typing the new row is an insertion, and references below shift", () => {
		const change = detectStructureChange(tablesAround(split, 3), tablesAround(joined, 3));
		assert.ok(change);
		assert.equal(shiftReferences("=B2+B3", change), "=B3+B4");
	});

	test("a separate table below a blank line is not merged in", () => {
		const two = ["| a |", "| - |", "| 1 |", "", "| x |", "| - |", "| 2 |"];
		assert.deepEqual(tableBlockAround(n => two[n], two.length, 2)!.lineNumbers, [0, 1, 2]);
	});
});
