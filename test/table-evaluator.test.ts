// Tests for TableEvaluator. Grids are arrays of rows of cell strings with the
// header as the first row, exactly as main.ts builds them from the DOM.
// Values are asserted by grid index: values[row][col], row 0 = header.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TableEvaluator } from "../src/table-evaluator";

const LOCALE = { decimalSeparator: ".", groupingSeparator: "," };

// Markers for known bugs; removed once the bug is fixed
const BUG1 = true; // scientific notation in a referenced cell is read as a unit
const BUG2 = true; // a number typed into a formula is split; "e5" becomes a cell reference
const BUG3 = true; // spaces as thousands separators are silently dropped

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

const F1 = `
| Sample        | well format | # wells | # cells / well | # cells |
| ------------- | ----------- | ------- | -------------- | ------- |
| pFN214        | 12w         | 2       | 1.8e5          | =c2*d2  |
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
		assert.equal(ev.parsefunction("2*1.8e5", [1, 4]), "2*1.8e5");
		assert.deepEqual(ev.parents[1][4], []);
	});

	test("=c2*d2 references two cells", () => {
		const { ev } = run(grid);
		ev.parents[1][4] = [];
		ev.parsefunction("c2*d2", [1, 4]);
		assert.deepEqual(ev.parents[1][4], [[1, 2], [1, 3]]);
	});

	test("=2c1*3 references one cell (column 2, row 1)", () => {
		const { ev } = run(grid);
		ev.parents[1][4] = [];
		ev.parsefunction("2c1*3", [1, 4]);
		assert.deepEqual(ev.parents[1][4], [[0, 1]]);
	});

	test("=1.5*2 is passed through as 1.5*2", () => {
		const { ev } = run(grid);
		assert.equal(ev.parsefunction("1.5*2", [1, 4]), "1.5*2");
	});
});

describe("F1 cell counts", () => {
	test("exactly as written: =c2*d2 gives 360000", { todo: BUG1 ? "bug 1" : undefined }, () => {
		const { values, errors } = run(md(F1));
		assert.equal(errors[1][4], null);
		assert.equal(num(values[1][4]), 360000);
	});

	const extended = (literal: boolean) => {
		const grid = md(F1);
		for (let r = 2; r <= 4; r++) grid[r][4] = literal ? "3.6e5" : `=c${r + 1}*d${r + 1}`;
		grid[5][2] = "=sum(c2:c5)";
		grid[5][4] = "=sum(e2:e5)";
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
			// F1-shaped grid, so e5 exists and a mis-tokenized "e5" would not error out
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
		assert.equal(at([["a", "b", "c"], ["1", "2", "=a2+b2"]], 1, 2).value, 3);
	});

	test("decimals", () => {
		assert.equal(at([["a", "b", "c"], ["1.5", "2.25", "=a2*b2"]], 1, 2).value, 3.375);
	});

	test("range a2:b4", () => {
		const grid = [["a", "b", "c"], ["1", "2", ""], ["3", "4", ""], ["5", "6", "=sum(a2:b4)"]];
		assert.equal(at(grid, 3, 2).value, 21);
	});

	test("2c3: column 2, row 3", () => {
		const grid = [["a", "b", "c"], ["1", "2", ""], ["3", "4", "=2c3"]];
		assert.equal(at(grid, 2, 2).value, 4);
	});

	test("+0c-1r: the cell above", () => {
		const grid = [["a", "b"], ["1", "7"], ["3", "=+0c-1r"]];
		assert.equal(at(grid, 2, 1).value, 7);
	});

	test("sum(+0c2:+0c-1r): column total above", () => {
		const grid = [["a"], ["1"], ["2"], ["3"], ["=sum(+0c2:+0c-1r)"]];
		assert.equal(at(grid, 4, 0).value, 6);
	});

	test("whole-column range a:f skips the header", () => {
		const grid = [
			["a", "b", "c", "d", "e", "f", "g"],
			["1", "2", "3", "4", "5", "6", "=sum(a:f)"],
			["1", "1", "1", "1", "1", "1", ""],
		];
		assert.equal(at(grid, 1, 6).value, 27);
	});

	test("row range 2:2", () => {
		const grid = [["a", "b"], ["4", "5"], ["=sum(2:2)", ""]];
		assert.equal(at(grid, 2, 0).value, 9);
	});

	test("unit cell arithmetic: 500ng * 2", () => {
		assertUnit(at([["a", "b"], ["500ng", "=a2*2"]], 1, 1).value, 1000, "ng");
	});

	test("unit cell arithmetic: 714ng + 286ng", () => {
		assertUnit(at([["a", "b", "c"], ["714ng", "286ng", "=a2+b2"]], 1, 2).value, 1000, "ng");
	});

	test("unit conversion between cells: 5 mL + 250 uL", () => {
		assertUnit(at([["a", "b", "c"], ["5 mL", "250 uL", "=a2+b2"]], 1, 2).value, 5.25, "mL");
	});

	test("sum() over unit cells with an empty cell", () => {
		const grid = [["a"], ["1 cm"], ["3 cm"], [""], ["=sum(a2:a4)"]];
		assertUnit(at(grid, 4, 0).value, 4, "cm");
	});

	test("matrix formula expands into cells below", () => {
		const grid = [["a", "b"], ["5", "=[a2:a3]*2"], ["6", ""]];
		const { values } = run(grid);
		assert.equal(values[1][1], 10);
		assert.equal(values[2][1], 12);
	});

	test("circular reference is reported as a loop", () => {
		const { errors } = run([["a", "b"], ["=b2", "=a2"]]);
		assert.match(String(errors[1][0]), /loop/);
	});

	test("reference outside the table is an error", () => {
		assert.match(String(at([["a"], ["=z9"]], 1, 0).error), /out of/);
	});

	test("format() and scientific()", () => {
		const grid = [["a"], ["=format(1/3, 5)"], ["=scientific(123456789, 3)"]];
		const { values } = run(grid);
		assert.equal(values[1][0], "0.33333");
		assert.equal(values[2][0], "1.235e+8");
	});

	test("'= escapes a formula", () => {
		assert.equal(at([["a"], ["'=a1"]], 1, 0).value, "=a1");
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
