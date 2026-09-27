// Tests for TableEvaluator. Grids are arrays of rows of cell strings with the
// header as the first row, exactly as main.ts builds them from the DOM.
// Values are asserted by grid index: values[row][col], row 0 = header.
// References use uppercase columns and number rows from the first row after
// the header, so A1 is values[1][0].

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TableEvaluator, formatExponential, formatFixed, splitUnit } from "../src/table-evaluator";

const LOCALE = { decimalSeparator: ".", groupingSeparator: "," };

// Markers for known bugs; removed once the bug is fixed
const BUG1 = false; // scientific notation in a referenced cell is read as a unit
const BUG2 = false; // a number typed into a formula is split; "e5" becomes a cell reference
const BUG3 = false; // spaces as thousands separators are silently dropped

function run(grid: string[][], settings: any = LOCALE) {
	const ev = new TableEvaluator();
	const result = ev.evaluateTable(grid, settings);
	return { ev, result, values: result.values, errors: result.errors };
}

// Parse a markdown table (header, separator, rows) into a grid
function md(table: string): string[][] {
	return table
		.trim()
		.split("\n")
		.filter((line, i) => i !== 1)
		.map(line => line.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
}

// What CalcCraft writes into a formula when a formula references this cell
function written(cell: string, settings: any = LOCALE): string {
	const { ev } = run([["x"], [cell]], settings);
	return String(ev.getValueByCoordinates(1, 0));
}

const num = (v: any) => (typeof v === "number" ? v : Number(v));

// Compare a mathjs Unit numerically (unit arithmetic has float noise, e.g. 1000.0000000000001 ng)
function assertUnit(value: any, expected: number, unit: string) {
	assert.ok(value && typeof value.toNumber === "function", `not a unit: ${value}`);
	assert.ok(Math.abs(value.toNumber(unit) - expected) < 1e-9, `got ${value}`);
}

// ---------------------------------------------------------------- fixtures

// F1 is verbatim from the notebook except its formula, =c2*d2 there, which is
// written =C1*D1 in the fork's reference style
const F1 = `
| Sample        | well format | # wells | # cells / well | # cells |
| ------------- | ----------- | ------- | -------------- | ------- |
| pFN214        | 12w         | 2       | 1.8e5          | =C1*D1  |
| pFN223        | 12w         | 2       | 1.8e5          | 3.6e5   |
| pFN228        | 12w         | 2       | 1.8e5          | 3.6e5   |
| piggybac only | 12w         | 2       | 1.8e5          | 3.6e5   |
| Total         |             | 8       |                | 1.44e6  |
`;

const F2 = `
| Sample | Ratio | m pSample | m phyPBase | P3000 | L3000 |
| --- | --- | --- | --- | --- | --- |
| pFN214 | 1:1 | 500ng | 500ng | 4 | 3 |
| pFN223 | 1:1 | 500ng | 500ng | 4 | 3 |
| pFN228 | 1:1 | 500ng | 500ng | 4 | 3 |
| pFN214 | 2.5:1 | 714ng | 286ng | 4 | 3 |
| pFN223 | 2.5:1 | 714ng | 286ng | 4 | 3 |
| pFN228 | 2.5:1 | 714ng | 286ng | 4 | 3 |
| piggybac only |  |  | 1000ng | 4 | 3 |
| -ctrl |  |  |  | 4 | 3 |
| Total (x8.5) |  |  |  | 34 µL P3000 + 391 µL OptiMEM | 25.5 µL L3000 + 399.5 µL OptiMEM |
`;

const F3 = `
| Sample | well format | # wells | # cells / well | # cells |
| --- | --- | --- | --- | --- |
| Branaplam | 12w | 3 | 50k | 1.5e5 |
| Risdiplam | 12w | 3 | 50k | 1.5e5 |
| dTAG13 | 12w | 3 | 50k | 1.5e5 |
| DMSO | 12w | 3 | 50k | 1.5e5 |
`;

const F4 = `
| Drug | C 10,000x | Molecular Weight | Weight | V DMSO |
| --- | --- | --- | --- | --- |
| dTAG-13 | 1000 µM | 1049.17 | 1 mg | 953 µL |
| Risdiplam | 2500 µM | 401.46 | 5 mg | 4980 µL |
`;

const F5 = `
| Drug | V 1000x | C 1000x | C stock | V stock | V DMSO |
| --- | --- | --- | --- | --- | --- |
| Branaplam | 5 mL | 25 µM | 10 mM | 12.5 µL | 4.9875 mL |
| Risdiplam | 5 mL | 250 µM | 2500 µM | 500 µL | 4.5 mL |
| dTAG-13 | 5 mL | 100 µM | 1000 µM | 500 µL | 4.5 mL |
`;

const F6 = `
| Sample | well format | # wells | V total | drug |
| --- | --- | --- | --- | --- |
| Branaplam | 12w | 3 | 3 mL | 3 µL |
| Risdiplam | 12w | 3 | 3 mL | 3 µL |
| dTAG13 | 12w | 3 | 3 mL | 3 µL |
| DMSO | 12w | 3 | 3 mL | 3 µL |
`;

// ------------------------------------------------------------------ tests

describe("referenced cell values (what is written into the formula)", () => {
	const cases: [string, string, boolean][] = [
		// cell, expected, affected by bug 1
		["1.8e5", "180000", BUG1],
		["1.8E5", "180000", BUG1],
		["-1.8e5", "-180000", BUG1],
		["2e-3", "0.002", BUG1],
		[".5e3", "500", BUG1],
		["2e-3 M", "0.002 M", BUG1],
		["180,000", "180000", false],
		["500ng", "500 ng", false],
		["5 mL", "5 mL", false],
		["5 eq", "5 eq", false],
		["12w", "12 w", false],
		["3 e5", "3 e5", false], // must not silently become 3
	];
	for (const [cell, expected, bug] of cases) {
		test(`${cell} -> ${expected}`, { todo: bug ? "bug 1" : undefined }, () => {
			assert.equal(written(cell), expected);
		});
	}
});

describe("formula tokenization", () => {
	const grid = md(F1);

	test("=2*1.8e5 keeps the number whole, no cell reference", { todo: BUG2 ? "bug 2" : undefined }, () => {
		const { ev } = run(grid);
		ev.parents[1][4] = [];
		assert.equal(ev.parsefunction("2*1.8e5", [1, 4]), "2*1.8e5");
		assert.deepEqual(ev.parents[1][4], []);
	});

	test("=C1*D1 references two cells", () => {
		const { ev } = run(grid);
		ev.parents[1][4] = [];
		ev.parsefunction("C1*D1", [1, 4]);
		assert.deepEqual(ev.parents[1][4], [[1, 2], [1, 3]]);
	});

	test("=2c1*3 references one cell (column 2, row 1)", () => {
		const { ev } = run(grid);
		ev.parents[1][4] = [];
		ev.parsefunction("2c1*3", [1, 4]);
		assert.deepEqual(ev.parents[1][4], [[1, 1]]);
	});

	test("=1.5*2 is passed through as 1.5*2", () => {
		const { ev } = run(grid);
		assert.equal(ev.parsefunction("1.5*2", [1, 4]), "1.5*2");
	});
});

describe("F1 cell counts", () => {
	test("exactly as written: =C1*D1 gives 360000", { todo: BUG1 ? "bug 1" : undefined }, () => {
		const { values, errors } = run(md(F1));
		assert.equal(errors[1][4], null);
		assert.equal(num(values[1][4]), 360000);
	});

	const extended = (literal: boolean) => {
		const grid = md(F1);
		for (let r = 2; r <= 4; r++) grid[r][4] = literal ? "3.6e5" : `=C${r}*D${r}`;
		grid[5][2] = "=sum(C1:C4)";
		grid[5][4] = "=sum(E1:E4)";
		return run(grid);
	};

	for (const literal of [false, true]) {
		test(`extended, E3-E5 as ${literal ? "literal 3.6e5" : "formulas"}: sums give 8 and 1440000`, { todo: BUG1 ? "bug 1" : undefined }, () => {
			const { values, errors } = extended(literal);
			for (let r = 1; r <= 4; r++) assert.equal(num(values[r][4]), 360000, `row ${r}`);
			assert.equal(num(values[5][2]), 8);
			assert.equal(errors[5][4], null);
			assert.equal(num(values[5][4]), 1440000);
		});
	}
});

describe("numbers typed into formulas", () => {
	const cases: [string, number, boolean][] = [
		["=2*1.8e5", 360000, BUG2],
		["=2*1.8E5", 360000, false], // uppercase E is not a cell reference, so this already works
		["=1.8e-3*1000", 1.8, false], // "e-" is not a cell reference, so this already works
		["=1.5*2", 3, false],
	];
	for (const [formula, expected, bug] of cases) {
		test(`${formula} -> ${expected}`, { todo: bug ? "bug 2" : undefined }, () => {
			// F1-shaped grid, so E5 exists and a mis-tokenized "e5" would not error out
			const grid = md(F1);
			grid[1][4] = formula;
			const { values, errors } = run(grid);
			assert.equal(errors[1][4], null);
			assert.ok(Math.abs(num(values[1][4]) - expected) < 1e-9, `got ${values[1][4]}`);
		});
	}
});

describe("regression: behaviour that must not change", () => {
	const at = (grid: string[][], row: number, col: number, settings?: any) => {
		const { values, errors } = run(grid, settings);
		return { value: values[row][col], error: errors[row][col] };
	};

	test("whole numbers", () => {
		assert.equal(at([["a", "b", "c"], ["1", "2", "=A1+B1"]], 1, 2).value, 3);
	});

	test("decimals", () => {
		assert.equal(at([["a", "b", "c"], ["1.5", "2.25", "=A1*B1"]], 1, 2).value, 3.375);
	});

	test("range A1:B3", () => {
		const grid = [["a", "b", "c"], ["1", "2", ""], ["3", "4", ""], ["5", "6", "=sum(A1:B3)"]];
		assert.equal(at(grid, 3, 2).value, 21);
	});

	test("2c2: column 2, row 2", () => {
		const grid = [["a", "b", "c"], ["1", "2", ""], ["3", "4", "=2c2"]];
		assert.equal(at(grid, 2, 2).value, 4);
	});

	test("+0c-1r: the cell above", () => {
		const grid = [["a", "b"], ["1", "7"], ["3", "=+0c-1r"]];
		assert.equal(at(grid, 2, 1).value, 7);
	});

	test("sum(+0c1:+0c-1r): column total above", () => {
		const grid = [["a"], ["1"], ["2"], ["3"], ["=sum(+0c1:+0c-1r)"]];
		assert.equal(at(grid, 4, 0).value, 6);
	});

	test("whole-column range A:F skips the header", () => {
		const grid = [
			["a", "b", "c", "d", "e", "f", "g"],
			["1", "2", "3", "4", "5", "6", "=sum(A:F)"],
			["1", "1", "1", "1", "1", "1", ""],
		];
		assert.equal(at(grid, 1, 6).value, 27);
	});

	test("row range 1:1", () => {
		const grid = [["a", "b"], ["4", "5"], ["=sum(1:1)", ""]];
		assert.equal(at(grid, 2, 0).value, 9);
	});

	test("unit cell arithmetic: 500ng * 2", () => {
		assertUnit(at([["a", "b"], ["500ng", "=A1*2"]], 1, 1).value, 1000, "ng");
	});

	test("unit cell arithmetic: 714ng + 286ng", () => {
		assertUnit(at([["a", "b", "c"], ["714ng", "286ng", "=A1+B1"]], 1, 2).value, 1000, "ng");
	});

	test("unit conversion between cells: 5 mL + 250 uL", () => {
		assertUnit(at([["a", "b", "c"], ["5 mL", "250 uL", "=A1+B1"]], 1, 2).value, 5.25, "mL");
	});

	test("sum() over unit cells with an empty cell", () => {
		const grid = [["a"], ["1 cm"], ["3 cm"], [""], ["=sum(A1:A3)"]];
		assertUnit(at(grid, 4, 0).value, 4, "cm");
	});

	test("matrix formula expands into cells below", () => {
		const grid = [["a", "b"], ["5", "=[A1:A2]*2"], ["6", ""]];
		const { values } = run(grid);
		assert.equal(values[1][1], 10);
		assert.equal(values[2][1], 12);
	});

	test("circular reference is reported as a loop", () => {
		const { errors, result } = run([["a", "b"], ["=B1", "=A1"]]);
		assert.equal(errors[1][0], "#CIRCULAR!");
		assert.match(String(result.errorDetails[1][0]), /circular reference through [AB]1/);
	});

	test("reference outside the table is an error", () => {
		const { errors, result } = run([["a"], ["=Z9"]]);
		assert.equal(errors[1][0], "#REF!");
		assert.equal(result.errorDetails[1][0], "Z9 is outside the table");
	});

	test("format() and scientific()", () => {
		const grid = [["a"], ["=format(1/3, 5)"], ["=scientific(123456789, 3)"]];
		const { values } = run(grid);
		assert.equal(values[1][0], "0.33333");
		assert.equal(values[2][0], "1.235e8");
	});

	test("'= escapes a formula", () => {
		assert.equal(at([["a"], ["'=A1"]], 1, 0).value, "=A1");
	});

	test("text cells are passed as strings", () => {
		assert.equal(written("pFN214"), '"pFN214"');
	});
});

describe("locale", () => {
	const EU = { decimalSeparator: ",", groupingSeparator: "." };

	test("1,8e5 with decimal ',' -> 180000", { todo: BUG1 ? "bug 1" : undefined }, () => {
		assert.equal(written("1,8e5", EU), "180000");
	});

	test("1.234,5 with grouping '.' -> 1234.5", () => {
		assert.equal(written("1.234,5", EU), "1234.5");
	});
});

describe("bug 3: spaces as thousands separators", () => {
	const cases: [string, string, boolean][] = [
		["1 000", "1000", BUG3],
		["1 000 000", "1000000", BUG3],
		["5 mL", "5 mL", false],
		["3 e5", "3 e5", false],
	];
	for (const [cell, expected, bug] of cases) {
		test(`${cell} -> ${expected}`, { todo: bug ? "bug 3" : undefined }, () => {
			assert.equal(written(cell), expected);
		});
	}

	test("1 000 mL -> 1000 mL", () => {
		assert.equal(written("1 000 mL"), "1000 mL");
	});

	test("1 000,5 with decimal ',' -> 1000.5", () => {
		assert.equal(written("1 000,5", { decimalSeparator: ",", groupingSeparator: "." }), "1000.5");
	});
});

describe("notebook fixtures evaluate without errors", () => {
	for (const [name, table] of Object.entries({ F1, F2, F3, F4, F5, F6 })) {
		test(name, { todo: name === "F1" && BUG1 ? "bug 1" : undefined }, () => {
			const { errors } = run(md(table));
			assert.deepEqual(errors.flat().filter(e => e !== null), []);
		});
	}

	test("F3: 1.5e5 cell counts", { todo: BUG1 ? "bug 1" : undefined }, () => {
		assert.equal(written("1.5e5"), "150000");
	});
});

describe("references: uppercase columns, rows numbered after the header", () => {
	test("A1 is the first row after the header", () => {
		const { values } = run([["h"], ["7"], ["=A1*2"]]);
		assert.equal(values[2][0], 14);
	});

	test("A0 (the header) is out of the table", () => {
		const { errors } = run([["h"], ["=A0"]]);
		assert.equal(errors[1][0], "#REF!");
	});

	test("lowercase a1 is not a reference", () => {
		const { values, errors, result } = run([["h"], ["7"], ["=a1"]]);
		assert.equal(values[2][0], null);
		assert.equal(errors[2][0], "#NAME?");
		assert.match(String(result.errorDetails[2][0]), /a1/);
	});

	test("function names with digits are not references: log2, log10", () => {
		const { values } = run([["h", "i"], ["=log2(8)", "=log10(100)"]]);
		assert.equal(values[1][0], 3);
		assert.equal(values[1][1], 2);
	});

	test("constants with digits are not references: LN2", () => {
		const { values } = run([["h"], ["=LN2"]]);
		assert.ok(Math.abs(values[1][0] - Math.LN2) < 1e-12);
	});

	test("two header rows: A1 is the first row after both", () => {
		const grid = [["h1", "x"], ["h2", "y"], ["5", "=A1*2"], ["6", "=sum(A:A)"]];
		const { values } = run(grid, { ...LOCALE, headerRows: 2 });
		assert.equal(values[2][1], 10);
		assert.equal(values[3][1], 11);
	});

	test("no header row: A1 is the first row", () => {
		const { values } = run([["5", "=A1*2"]], { ...LOCALE, headerRows: 0 });
		assert.equal(values[0][1], 10);
	});
});

describe("quoted quantities in formulas", () => {
	test('="5 mL" * 3 -> 15 mL', () => {
		assertUnit(run([["h"], ['="5 mL" * 3']]).values[1][0], 15, "mL");
	});

	test('="500ng" * 2 -> 1000 ng', () => {
		assertUnit(run([["h"], ['="500ng" * 2']]).values[1][0], 1000, "ng");
	});

	test("plain text in quotes stays a string", () => {
		assert.equal(run([["h"], ['="pFN214"']]).values[1][0], "pFN214");
	});

	test("an unknown unit stays a string", () => {
		assert.equal(run([["h"], ['="3 e5"']]).values[1][0], "3 e5");
	});
});

describe("micro prefix and molar units", () => {
	test("µ (micro sign) and μ (Greek mu) cells keep their unit", () => {
		assert.equal(written("1000 µM"), "1000 µM");
		assert.equal(written("12.5 μL"), "12.5 μL");
		assert.equal(written("10 mM"), "10 mM");
	});

	test("text starting with a µ quantity is no longer read as a bare number", () => {
		assert.notEqual(written("34 µL P3000 + 391 µL OptiMEM"), "34");
	});

	test("5 mL + 250 µL -> 5.25 mL", () => {
		assertUnit(run([["a", "b", "c"], ["5 mL", "250 µL", "=A1+B1"]]).values[1][2], 5.25, "mL");
	});

	test("Greek mu converts like u: 12.5 μL to uL", () => {
		assertUnit(run([["a", "b"], ["12.5 μL", "=A1 to uL"]]).values[1][1], 12.5, "uL");
	});

	test("molar: 1000 µM to mM, 2e-3 M to mM", () => {
		const { values } = run([["a", "b"], ["1000 µM", "=A1 to mM"], ["2e-3 M", "=A2 to mM"]]);
		assertUnit(values[1][1], 1, "mM");
		assertUnit(values[2][1], 2, "mM");
	});

	test('quoted: ="25 µM" * 2 -> 50 µM', () => {
		assertUnit(run([["h"], ['="25 µM" * 2']]).values[1][0], 50, "uM");
	});

	test("F4: V DMSO = Weight / MW / C gives 953 µL and 4980 µL", () => {
		const grid = md(F4);
		for (let r = 1; r <= 2; r++) grid[r][4] = `=D${r} / (C${r} g/mol) / B${r} to µL`;
		const { values, errors } = run(grid);
		assert.equal(errors[1][4], null);
		assertUnit(values[1][4], 1 / 1049.17 / 1000e-6 * 1e3, "uL"); // 953.13 µL
		assertUnit(values[2][4], 5 / 401.46 / 2500e-6 * 1e3, "uL"); // 4981.8 µL
	});

	test("F5: V stock = V 1000x * C 1000x / C stock gives 12.5, 500, 500 µL", () => {
		const grid = md(F5);
		for (let r = 1; r <= 3; r++) grid[r][4] = `=B${r} * C${r} / D${r} to µL`;
		const { values, errors } = run(grid);
		assert.deepEqual([errors[1][4], errors[2][4], errors[3][4]], [null, null, null]);
		assertUnit(values[1][4], 12.5, "uL");
		assertUnit(values[2][4], 500, "uL");
		assertUnit(values[3][4], 500, "uL");
	});
});

describe("precision for numbers and units", () => {
	test("formatFixed keeps zeros only when the value was rounded", () => {
		assert.equal(formatFixed(3.00005, 3), "3.000");
		assert.equal(formatFixed(3, 3), "3");
		assert.equal(formatFixed(953.1343824165767, 2), "953.13");
		assert.equal(formatFixed(1 / 3, -1), String(1 / 3));
		assert.equal(formatFixed(1 / 3, undefined as any), String(1 / 3));
	});

	test("splitUnit uses the unit mathjs displays", () => {
		const { values } = run([["a", "b"], ["1 mg", "=A1 / (1049.17 g/mol) / (1000 µM) to µL"]]);
		const parts = splitUnit(values[1][1]);
		assert.ok(parts);
		assert.ok(Math.abs(parts[0] - 953.1343824165767) < 1e-9);
		assert.equal(parts[1], "µL");
	});

	test("format() on a unit: =format(A1 to µL, 2) -> 953.13 µL", () => {
		const { values } = run([["a", "b"], ["1 mg", "=format(A1 / (1049.17 g/mol) / (1000 µM) to µL, 2)"]]);
		assert.equal(values[1][1], "953.13 µL");
	});

	test("format() on a unit keeps zeros when rounded: 5.25 mL at 3 decimals", () => {
		const { values } = run([["a"], ['=format("5.25 mL", 3)'], ['=format("5.2501 mL", 3)']]);
		assert.equal(values[1][0], "5.25 mL");
		assert.equal(values[2][0], "5.250 mL");
	});

	test("scientific() on a unit, with and without a fixed unit", () => {
		const { values } = run([["a"], ['=scientific("180000 mL" to mL, 2)'], ['=scientific("180000 mL", 2)']]);
		assert.equal(values[1][0], "1.8e5 mL");
		assert.equal(values[2][0], "1.8e2 L"); // mathjs picks the prefix unless fixed with "to"
	});

	test("format() and scientific() on numbers are unchanged", () => {
		const { values } = run([["a"], ["=format(1/3, 5)"], ["=format(2, 3)"], ["=format(1/3, 99)"], ["=scientific(123456789, 3)"]]);
		assert.deepEqual(values.slice(1).map(r => r[0]), ["0.33333", "2", (1 / 3).toFixed(15), "1.235e8"]);
	});
});

describe("scientific notation follows the inputs", () => {
	const sci = (grid: string[][]) => run(grid).result.scientific;

	test("F1: =C1*D1 with D1 = 1.8e5 is scientific; the sum of such results is too", () => {
		const grid = md(F1);
		for (let r = 2; r <= 4; r++) grid[r][4] = `=C${r}*D${r}`;
		grid[5][2] = "=sum(C1:C4)";
		grid[5][4] = "=sum(E1:E4)";
		const flags = sci(grid);
		assert.equal(flags[1][4], true);
		assert.equal(flags[5][4], true); // sum(E1:E4) -> 1.44e6
		assert.equal(flags[5][2], false); // sum of plain well counts -> 8
	});

	test("a literal in the formula: =2*1.8e5 is scientific, =2*21 is not", () => {
		const flags = sci([["h"], ["=2*1.8e5"], ["=2*21"], ["=2*1.8E5"], ["=1.8e-3*1000"]]);
		assert.deepEqual(flags.slice(1).map(r => r[0]), [true, false, true, true]);
	});

	test("plain inputs stay plain: =A1*2 with A1 = 360000", () => {
		assert.equal(sci([["h", "i"], ["360000", "=A1*2"]])[1][1], false);
	});

	test("unit cells: =A1 to mM with A1 = 2e-3 M is scientific", () => {
		assert.equal(sci([["h", "i"], ["2e-3 M", "=A1 to mM"]])[1][1], true);
	});

	test("matrix results inherit from their formula", () => {
		const flags = sci([["a", "b"], ["1e5", "=[A1:A2]*2"], ["2e5", ""]]);
		assert.equal(flags[1][1], true);
		assert.equal(flags[2][1], true);
	});

	test("circular references don't hang", () => {
		assert.deepEqual(sci([["a", "b"], ["=B1*1e5", "=A1"]])[1], [true, true]);
	});

	test("text and escaped cells are not scientific", () => {
		assert.deepEqual(sci([["h"], ["pFN2e5"], ["'=2e5"]]).slice(1).map(r => r[0]), [false, false]);
	});
});

describe("formatExponential", () => {
	test("written like cell input: 3.6e5, 3.33e-5", () => {
		assert.equal(formatExponential(360000, -1), "3.6e5");
		assert.equal(formatExponential(1440000, -1), "1.44e6");
		assert.equal(formatExponential(1 / 3e4, 2), "3.33e-5");
		assert.equal(formatExponential(-360000, -1), "-3.6e5");
	});

	test("precision keeps mantissa zeros only when rounded", () => {
		assert.equal(formatExponential(360000, 2), "3.6e5");
		assert.equal(formatExponential(360001, 2), "3.60e5");
	});

	test("numbers from 0.001 up to 1000 stay plain", () => {
		assert.equal(formatExponential(1, -1), "1");
		assert.equal(formatExponential(999.5, -1), "999.5");
		assert.equal(formatExponential(0.002, -1), "2e-3");
		assert.equal(formatExponential(0.0125, 3), "0.013");
		assert.equal(formatExponential(0, -1), "0");
	});

	test("the output reads back as the same number", () => {
		for (const x of [360000, 1440000, 1 / 3e4, 6.02214076e23]) {
			assert.equal(Number(formatExponential(x, -1)), x);
		}
	});
});

describe("TODO 5-9: no more silently wrong numbers", () => {
	test("5. percentages: 50% -> 0.5, 12,5% with decimal ',' -> 0.125", () => {
		assert.equal(written("50%"), "0.5");
		assert.equal(written("-2.5 %"), "-0.025");
		assert.equal(written("12,5%", { decimalSeparator: ",", groupingSeparator: "." }), "0.125");
		assert.equal(run([["a", "b"], ["50%", "=A1*2"]]).values[1][1], 1);
	});

	test("6. a date is text, not its year: =A1+1 is an error", () => {
		assert.equal(written("2026-09-25"), '"2026-09-25"');
		const { values, errors } = run([["a", "b"], ["2026-09-25", "=A1+1"]]);
		assert.equal(values[1][1], null);
		assert.ok(errors[1][1]);
	});

	test("9. a ratio is text, not its first number", () => {
		assert.equal(written("2.5:1"), '"2.5:1"');
		assert.equal(written("1:1"), '"1:1"');
		assert.ok(run([["a", "b"], ["2.5:1", "=A1*2"]]).errors[1][1]);
	});

	test("strict numbers still accept the usual forms", () => {
		for (const [cell, expected] of [["42", "42"], ["-3.5", "-3.5"], [".5", "0.5"], ["5.", "5"], ["+7", "7"], ["1,234.5", "1234.5"], ["1 000", "1000"], ["1.8e5", "180000"]]) {
			assert.equal(written(cell), expected, cell);
		}
		assert.equal(written("1.234,5", { decimalSeparator: ",", groupingSeparator: "." }), "1234.5");
		assert.notEqual(written("0x10"), "16"); // 0 with unit "x10", like 12w
	});

	test("7. an array result doesn't overwrite typed cells: #SPILL!", () => {
		const { values, errors } = run([["a", "b"], ["=[1;2;3]", ""], ["", ""], ["keep me", ""]]);
		assert.equal(errors[1][0], "#SPILL!");
		assert.equal(values[3][0], "keep me");
	});

	test("7. an array result may overwrite copies of its own formula", () => {
		const f = "=[A1:A2]*2";
		const { values, errors } = run([["a", "b"], ["1", f], ["2", f]]);
		assert.equal(errors[1][1], null);
		assert.deepEqual([values[1][1], values[2][1]], [2, 4]);
	});

	test("7. an array result still fills empty cells", () => {
		const { values, errors } = run([["a", "b"], ["=[1;2;3]", ""], ["", ""], ["", ""]]);
		assert.equal(errors[1][0], null);
		assert.deepEqual([values[1][0], values[2][0], values[3][0]], [1, 2, 3]);
	});

	test("8. a sign right after a value is ambiguous: =A1-1c+0r is an error, not 102", () => {
		const grid = (f: string) => [["A", "B", "C"], ["10", "2", f]];
		const bad = run(grid("=B1-1c+0r"));
		assert.equal(bad.errors[1][2], "#ERROR!");
		assert.match(String(bad.result.errorDetails[1][2]), /ambiguous "-1c\+0r"/);
		assert.equal(run(grid("=A1 - (-1c+0r)")).values[1][2], 8);
		assert.equal(run(grid("=A1 - -1c+0r")).values[1][2], 8);
		assert.equal(run(grid("=-2c+0r * -1c+0r")).values[1][2], 20);
		assert.equal(run(grid("=sum(-2c1:-1c1)")).values[1][2], 12); // after "(" is fine
	});
});

describe("TODO 10: Excel function names", () => {
	const one = (formula: string, grid: string[][] = [["a", "b", "c"], ["", "", ""]]) => {
		const g = grid.map(r => [...r]);
		g[g.length - 1][g[0].length - 1] = formula;
		const res = run(g);
		const r = g.length - 1, c = g[0].length - 1;
		return { value: res.values[r][c], error: res.errors[r][c], detail: res.result.errorDetails[r][c] };
	};
	const val = (formula: string, grid?: string[][]) => one(formula, grid).value;
	const nums = [["a", "b", "x"], ["2", "-2", ""], ["", "", ""], ["4", "-4", ""]];

	test("any capitalisation: SUM, Sum, sum", () => {
		for (const f of ["=SUM(A1:A3)", "=Sum(A1:A3)", "=sum(A1:A3)"]) assert.equal(val(f, nums), 6, f);
	});

	test("math.js functions in any case: TRANSPOSE, DotMultiply", () => {
		assert.equal(val("=DotMultiply(2, 3)"), 6);
		const t = one("=TRANSPOSE([7,8])"); // spills; the formula cell holds the first value
		assert.equal(t.error, null);
		assert.equal(t.value, 7);
	});

	test("blank cells are skipped: AVERAGE, MIN, MAX, PRODUCT, COUNT, and math.js mean", () => {
		assert.equal(val("=AVERAGE(A1:A3)", nums), 3);
		assert.equal(val("=mean(A1:A3)", nums), 3);
		assert.equal(val("=MAX(B1:B3)", nums), -2);
		assert.equal(val("=MIN(A1:A3)", nums), 2);
		assert.equal(val("=PRODUCT(A1:A3)", nums), 8);
		assert.equal(val("=COUNT(A1:B3)", nums), 4);
		assert.equal(val("=AVERAGE(A1, A2, A3)", nums), 3); // single blank references too
	});

	test("blank cells still count as 0 in arithmetic and matrices", () => {
		assert.equal(val("=A2 + 1", nums), 1);
		assert.equal(String(val("=[A1:A3]*1", [["a", "x"], ["2", ""], ["", ""], ["4", ""]])), "2");
	});

	test("COUNT counts numbers (with units), COUNTA anything non-blank", () => {
		const g = [["a", "x"], ["2", ""], ["pFN214", ""], ["5 mL", ""], ["", ""]];
		assert.equal(val("=COUNT(A1:A4)", g), 2);
		assert.equal(val("=COUNTA(A1:A4)", g), 3);
	});

	test("IF, AND, OR, NOT, TRUE, FALSE and Excel comparisons (=, <>)", () => {
		const g = [["a", "x"], ["0", ""]];
		assert.equal(val('=IF(A1=0, "zero", "not zero")', g), "zero");
		assert.equal(val('=IF(A1<>0, "not zero", "zero")', g), "zero");
		assert.equal(val("=IF(A1>1, 2)", g), false);
		assert.equal(val("=AND(1, TRUE, 2>1)"), true);
		assert.equal(val("=OR(FALSE, 0)"), false);
		assert.equal(val("=NOT(A1)", g), true);
		assert.equal(val("=TRUE()"), true);
		assert.equal(val('=IF(A1 == 0, "eq")', g), "eq"); // math.js == still works
	});

	test("Excel meanings win whatever the case: LOG is base 10, FLOOR/CEILING use a multiple", () => {
		assert.equal(val("=LOG(100)"), 2);
		assert.equal(val("=log(100)"), 2);
		assert.equal(val("=LOG(8, 2)"), 3);
		assert.ok(Math.abs(val("=LN(EXP(1))") - 1) < 1e-12);
		assert.equal(val("=FLOOR(7, 5)"), 5);
		assert.equal(val("=floor(7, 5)"), 5);
		assert.equal(val("=FLOOR(0.3, 0.1)"), 0.3);
		assert.equal(val("=CEILING(4.2, 0.5)"), 4.5);
		assert.equal(val("=FLOOR(-2.5)"), -3);
	});

	test("rounding: ROUND (halves away from zero, negative digits), ROUNDUP, ROUNDDOWN, TRUNC, INT", () => {
		assert.equal(val("=ROUND(-2.5)"), -3);
		assert.equal(val("=ROUND(1.005, 2)"), 1.01);
		assert.equal(val("=ROUND(1234.5678, -2)"), 1200);
		assert.equal(val("=ROUNDUP(1.21, 1)"), 1.3);
		assert.equal(val("=ROUNDDOWN(-1.29, 1)"), -1.2);
		assert.equal(val("=TRUNC(-2.7)"), -2);
		assert.equal(val("=INT(-2.5)"), -3);
	});

	test("ROUND keeps units: ROUND(1.2345 mL, 2) -> 1.23 mL", () => {
		assertUnit(val('=ROUND("1.2345 mL", 2)'), 1.23, "mL");
	});

	test("MOD, POWER, SQRT, ABS, PI", () => {
		assert.equal(val("=MOD(-3, 2)"), 1);
		assert.equal(val("=POWER(2, 10)"), 1024);
		assert.equal(val("=SQRT(16)"), 4);
		assert.equal(val("=ABS(-3)"), 3);
		assert.equal(val("=PI()"), Math.PI);
	});
});

describe("TODO 12: Excel error codes", () => {
	const cell = (grid: string[][], r: number, c: number) => {
		const res = run(grid);
		return { error: res.errors[r][c], detail: res.result.errorDetails[r][c] };
	};

	test("=1/0 is #DIV/0!, not Infinity; unit division too", () => {
		assert.equal(cell([["a"], ["=1/0"]], 1, 0).error, "#DIV/0!");
		assert.equal(cell([["a"], ['="1 cm"/0']], 1, 0).error, "#DIV/0!");
		assert.equal(cell([["a"], ["=MOD(1, 0)"]], 1, 0).error, "#DIV/0!");
		assert.equal(cell([["a", "x"], ["", "=AVERAGE(A1:A1)"]], 1, 1).error, "#DIV/0!");
	});

	test("#NAME? for unknown functions and names", () => {
		const e = cell([["a"], ["=COUNTIFS(1)"]], 1, 0);
		assert.equal(e.error, "#NAME?");
		assert.match(String(e.detail), /COUNTIFS/);
	});

	test("#VALUE! for wrong types; #NUM! for impossible maths; #ERROR! for syntax", () => {
		assert.equal(cell([["a", "b"], ["pFN214", "=A1*2"]], 1, 1).error, "#VALUE!");
		assert.equal(cell([["a"], ['="1 cm" + "1 s"']], 1, 0).error, "#VALUE!");
		assert.equal(cell([["a"], ["=SQRT(-1)"]], 1, 0).error, "#NUM!");
		assert.equal(cell([["a"], ["=LOG(0)"]], 1, 0).error, "#NUM!");
		assert.equal(cell([["a"], ["=1+"]], 1, 0).error, "#ERROR!");
	});

	test("#SPILL! names the cell in the way", () => {
		const e = cell([["a"], ["=[1;2]"], ["x"]], 1, 0);
		assert.equal(e.error, "#SPILL!");
		assert.equal(e.detail, "the result would overwrite A2");
	});

	test("errors propagate to formulas that use the cell (was 0)", () => {
		const res = run([["a", "b", "c", "d"], ["pFN214", "=A1*2", "=B1*2", "=C1+1"]]);
		assert.deepEqual(res.errors[1].slice(1), ["#VALUE!", "#VALUE!", "#VALUE!"]);
		assert.match(String(res.result.errorDetails[1][2]), /^B1: /);
		assert.match(String(res.result.errorDetails[1][3]), /^C1: B1: /);
	});

	test("a reference outside the table propagates as #REF!, not a loop", () => {
		const res = run([["a", "b", "c"], ["1", "=Z9", "=B1+1"]]);
		assert.deepEqual([res.errors[1][1], res.errors[1][2]], ["#REF!", "#REF!"]);
	});

	test("errors inside a sum propagate too", () => {
		assert.equal(cell([["a", "b"], ["=1/0", "=SUM(A1:A2)"], ["2", ""]], 1, 1).error, "#DIV/0!");
	});
});

describe("TODO 4: #REF! written into a formula", () => {
	test("a formula containing #REF! shows #REF!", () => {
		const res = run([["a", "b"], ["2", "=A1*#REF!"]]);
		assert.equal(res.errors[1][1], "#REF!");
		assert.match(String(res.result.errorDetails[1][1]), /deleted/);
	});
});

describe("IF evaluates only the branch it takes", () => {
	const at = (grid: string[][], r: number, c: number) => {
		const res = run(grid);
		return res.errors[r][c] ?? res.values[r][c];
	};

	test("=IF(A1>0, LOG(A1), 0) with A1 = 0 is 0 (was #NUM!)", () => {
		assert.equal(at([["a", "b"], ["0", "=IF(A1>0, LOG(A1), 0)"]], 1, 1), 0);
		assert.equal(at([["a", "b"], ["100", "=IF(A1>0, LOG(A1), 0)"]], 1, 1), 2);
	});

	test("a cell with an error in the branch not taken doesn't matter", () => {
		const grid = [["a", "b", "c"], ["0", "=1/0", "=IF(A1=0, 0, B1*2)"]];
		assert.equal(at(grid, 1, 2), 0);
		grid[1][0] = "1";
		assert.equal(at(grid, 1, 2), "#DIV/0!");
	});

	test("errors in the condition, and IF with the wrong number of arguments", () => {
		assert.equal(at([["a", "b"], ["=1/0", "=IF(A1, 1, 2)"]], 1, 1), "#DIV/0!");
		assert.equal(at([["a"], ["=IF(1)"]], 1, 0), "#VALUE!");
	});
});
