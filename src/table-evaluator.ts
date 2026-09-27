// Modified by akmazian (2026) in a fork of klaudyu/CalcCraft
// (https://github.com/klaudyu/CalcCraft), licensed under Apache 2.0.
// Changes: scientific notation in cells and formulas, whitespace digit grouping,
// grouping-separator fix, uppercase references, rows numbered after the header,
// quoted quantities (="5 mL" * 3), format()/scientific() for units, scientific results
// that follow their inputs, strict number parsing, percentages, #SPILL!, Excel
// functions and error codes, molar unit M, µ/μ micro prefix, dead code removed.
// See the "Fork of klaudyu/CalcCraft" section in CHANGELOG.md.

import { create, all } from 'mathjs';

const debug = false;

const math = create(all);

// Fixed decimals. Trailing zeros are kept only when the value was rounded, to show
// the precision limit: with 3 decimals, 3.00005 -> "3.000" but 3 -> "3"
export function formatFixed(value: number, precision: number): string {
    if (!(precision >= 0)) return value.toString();
    const formatted = value.toFixed(precision);
    if (parseFloat(formatted) !== value) return formatted;
    return formatted.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

// Exponents are written the way they are typed in cells: 3.6e5, 3.33e-5
const shortExponent = (s: string) => s.replace("e+", "e");

function formatScientific(value: number, precision: number): string {
    // Use toExponential for scientific notation, dropping trailing zeros
    return shortExponent(value
        .toExponential(precision)
        .replace(/(\.\d*?)0+(e[+-]?\d+)$/, '$1$2')
        .replace(/\.(e[+-]?\d+)$/, '$1'));
}

// Scientific notation for displaying results, following the precision setting like
// formatFixed: the mantissa keeps trailing zeros only when it was rounded.
// Numbers from 0.001 up to 1000 stay plain (1.8e5 / 1.8e5 shows 1, not 1e0).
export function formatExponential(value: number, precision: number): string {
    if (!isFinite(value) || value === 0) return value.toString();
    const exponent = Math.floor(Math.log10(Math.abs(value)));
    if (exponent > -3 && exponent < 3) return formatFixed(value, precision);
    if (!(precision >= 0)) return shortExponent(value.toExponential());
    const formatted = value.toExponential(Math.min(precision, 100));
    if (parseFloat(formatted) !== value) return shortExponent(formatted);
    return formatScientific(value, Math.min(precision, 100));
}

// A mathjs Unit as [number, unit], using the unit mathjs displays (best prefix),
// e.g. 953.13 µL -> [953.13, "µL"]; null for a valueless unit such as unit("cm")
export function splitUnit(unit: any): [number, string] | null {
    const match = unit.toString().match(/^(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*(.*)$/);
    return match ? [Number(match[1]), match[2]] : null;
}

// Apply a number formatter to a plain number or to the number part of a Unit
function formatValue(value: any, formatNumber: (n: number) => string): string {
    if (typeof value === 'number') return formatNumber(value);
    if (math.isUnit(value)) {
        const parts = splitUnit(value);
        if (parts) return `${formatNumber(parts[0])} ${parts[1]}`;
    }
    return String(value);
}

// Custom format(), scientific() and a unit-aware sum() that skips empty cells
math.import({
    // Cap precision at 15 (realistic for JavaScript doubles)
    format: (value: any, precision: number) =>
        formatValue(value, n => formatFixed(n, Math.min(precision, 15))),
    scientific: (value: any, precision = 2) =>
        formatValue(value, n => formatScientific(n, precision)),
    sum: function(...args: any[]) {
        // Flatten arguments
        const flattened = args.flat(Infinity);
        
        // Filter out null, undefined, and zero (from empty cells)
        const filtered = flattened.filter((v: any) => {
            if (v === null || v === undefined) return false;
            if (v === 0) return false; // Skip zero from empty cells
            return true;
        });
        
        // If nothing left, return 0
        if (filtered.length === 0) return 0;
        
        // Build an add expression and evaluate it
        // This lets mathjs handle units naturally
        const expression = filtered.join(' + ');
        try {
            return math.evaluate(expression);
        } catch (e) {
            // Fallback to regular sum if evaluation fails
            return filtered.reduce((sum: number, val: any) => {
                const num = typeof val === 'number' ? val : parseFloat(val);
                return sum + (isNaN(num) ? 0 : num);
            }, 0);
        }
    }
}, { override: true });

// Micro sign (µ, U+00B5, typed with Option-M on a Mac) and Greek mu (μ, U+03BC)
// work like the "u" micro prefix: 12.5 µL, 25 μM
const MICRO = ["\u00B5", "\u03BC"];
const isAlpha = math.parse.isAlpha;
math.parse.isAlpha = (c: string, cPrev: string, cNext: string) => isAlpha(c, cPrev, cNext) || MICRO.includes(c);
const Unit = (math as any).Unit;
const isValidAlpha = Unit.isValidAlpha;
Unit.isValidAlpha = (c: string) => isValidAlpha(c) || MICRO.includes(c);
for (const prefixes of Object.values(Unit.PREFIXES) as any[]) {
    if (prefixes.u) MICRO.forEach(m => (prefixes[m] = { ...prefixes.u, name: m }));
}

// Molar concentration, with prefixes: M, mM, µM, nM
math.createUnit("M", { definition: "1 mol/L", prefixes: "short" });

// ---------------------------------------------------------------- Excel functions

// An error with an Excel code, e.g. new Error("#DIV/0!: no numbers to average")
const excelError = (code: string, reason: string) => new Error(`${code}: ${reason}`);

// Blank cells arrive as null inside aggregate functions (see BLANK_SKIPPING); drop them,
// and flatten ranges and matrices into a plain list
const flatValues = (args: any[]): any[] => args
    .flatMap(a => (math.isMatrix(a) ? (a as any).toArray().flat(Infinity) : Array.isArray(a) ? a.flat(Infinity) : [a]))
    .filter(v => v !== null && v !== undefined);
// Like Excel, text and TRUE/FALSE in ranges are ignored by numeric aggregates
const numbers = (args: any[]) => flatValues(args).filter(v => typeof v === "number" || math.isUnit(v));

// Apply a numeric function to a number, or to a unit's value in its own unit (1.2345 mL)
const onValue = (x: any, f: (n: number) => number) => {
    if (math.isUnit(x)) {
        const units = (x as any).formatUnits();
        return math.unit(f((x as any).toNumber(units)), units);
    }
    return f(x);
};

// Round a quotient that is a whole number up to float noise (0.3 / 0.1 = 2.9999999999999996)
const cleanQuotient = (q: number) => (Math.abs(q - Math.round(q)) < 1e-9 ? Math.round(q) : q);
const toMultiple = (x: number, significance: number, round: (q: number) => number) => {
    if (significance === 0) return 0;
    return math.round(round(cleanQuotient(x / significance)) * significance, 12) as number;
};
const roundAway = (n: number, digits: number, up: boolean) => {
    const f = Math.pow(10, digits);
    const scaled = math.round(Math.abs(n) * f, 9) as number;
    return (Math.sign(n) * (up ? Math.ceil(scaled) : Math.floor(scaled))) / f;
};
const excelRound = (n: number, digits: number) =>
    digits >= 0 ? (math.round(n, digits) as number) : (math.round(n / Math.pow(10, -digits)) as number) * Math.pow(10, -digits);

const EXCEL_FUNCTIONS: Record<string, (...args: any[]) => any> = {
    SUM: (...args: any[]) => (math as any).sum(...args),
    AVERAGE: (...args: any[]) => {
        const v = numbers(args);
        if (!v.length) throw excelError("#DIV/0!", "no numbers to average");
        return math.mean(v);
    },
    MIN: (...args: any[]) => { const v = numbers(args); return v.length ? math.min(v) : 0; },
    MAX: (...args: any[]) => { const v = numbers(args); return v.length ? math.max(v) : 0; },
    MEDIAN: (...args: any[]) => {
        const v = numbers(args);
        if (!v.length) throw excelError("#NUM!", "no numbers");
        return math.median(v);
    },
    PRODUCT: (...args: any[]) => { const v = numbers(args); return v.length ? math.prod(v) : 0; },
    COUNT: (...args: any[]) => numbers(args).length,
    COUNTA: (...args: any[]) => flatValues(args).length,
    STDEV: (...args: any[]) => {
        const v = numbers(args);
        if (v.length < 2) throw excelError("#DIV/0!", "STDEV needs at least two numbers");
        return math.std(v);
    },
    STDEVP: (...args: any[]) => {
        const v = numbers(args);
        if (!v.length) throw excelError("#DIV/0!", "no numbers");
        return math.std(v, "uncorrected");
    },
    VAR: (...args: any[]) => {
        const v = numbers(args);
        if (v.length < 2) throw excelError("#DIV/0!", "VAR needs at least two numbers");
        return math.variance(v);
    },
    VARP: (...args: any[]) => {
        const v = numbers(args);
        if (!v.length) throw excelError("#DIV/0!", "no numbers");
        return math.variance(v, "uncorrected");
    },
    IF: (condition: any, ifTrue: any, ifFalse: any = false) => (condition ? ifTrue : ifFalse),
    AND: (...args: any[]) => {
        const v = flatValues(args).filter(x => typeof x !== "string");
        if (!v.length) throw excelError("#VALUE!", "no values");
        return v.every(Boolean);
    },
    OR: (...args: any[]) => {
        const v = flatValues(args).filter(x => typeof x !== "string");
        if (!v.length) throw excelError("#VALUE!", "no values");
        return v.some(Boolean);
    },
    NOT: (x: any) => !x,
    TRUE: () => true,
    FALSE: () => false,
    ROUND: (x: any, digits = 0) => onValue(x, n => excelRound(n, digits)),
    ROUNDUP: (x: any, digits = 0) => onValue(x, n => roundAway(n, digits, true)),
    ROUNDDOWN: (x: any, digits = 0) => onValue(x, n => roundAway(n, digits, false)),
    TRUNC: (x: any, digits = 0) => onValue(x, n => roundAway(n, digits, false)),
    INT: (x: any) => onValue(x, Math.floor),
    FLOOR: (x: any, significance = 1) => onValue(x, n => toMultiple(n, significance, Math.floor)),
    CEILING: (x: any, significance = 1) => onValue(x, n => toMultiple(n, significance, Math.ceil)),
    MOD: (n: any, d: any) => {
        if (d === 0) throw excelError("#DIV/0!", "MOD by zero");
        return math.mod(n, d);
    },
    ABS: (x: any) => math.abs(x),
    SIGN: (x: any) => math.sign(x),
    SQRT: (x: any) => {
        if (typeof x === "number" && x < 0) throw excelError("#NUM!", "square root of a negative number");
        return math.sqrt(x);
    },
    POWER: (x: any, y: any) => math.pow(x, y),
    EXP: (x: any) => math.exp(x),
    LN: (x: any) => {
        if (typeof x === "number" && x <= 0) throw excelError("#NUM!", "logarithm of a number that isn't positive");
        return math.log(x);
    },
    LOG: (x: any, base = 10) => {
        if (typeof x === "number" && x <= 0) throw excelError("#NUM!", "logarithm of a number that isn't positive");
        return math.log(x, base);
    },
    LOG10: (x: any) => {
        if (typeof x === "number" && x <= 0) throw excelError("#NUM!", "logarithm of a number that isn't positive");
        return math.log10(x);
    },
    PI: () => Math.PI,
};

// math.js aggregates without an Excel name also skip blank cells
const MATHJS_AGGREGATES: Record<string, (...args: any[]) => any> = {
    mean: (...args: any[]) => math.mean(flatValues(args)),
    prod: (...args: any[]) => math.prod(flatValues(args)),
    std: (...args: any[]) => math.std(flatValues(args)),
    variance: (...args: any[]) => math.variance(flatValues(args)),
    mode: (...args: any[]) => math.mode(flatValues(args)),
};

math.import({
    ...Object.fromEntries(Object.entries(EXCEL_FUNCTIONS).map(([name, f]) => [`excel_${name}`, f])),
    ...Object.fromEntries(Object.entries(MATHJS_AGGREGATES).map(([name, f]) => [`cc_${name}`, f])),
    TRUE: true,
    FALSE: false,
}, { override: true });

// Functions whose ranges skip blank cells instead of reading them as 0
const BLANK_SKIPPING = new Set([
    "sum",
    ...["SUM", "AVERAGE", "MIN", "MAX", "MEDIAN", "PRODUCT", "COUNT", "COUNTA", "STDEV", "STDEVP", "VAR", "VARP", "AND", "OR"].map(n => `excel_${n}`),
    ...Object.keys(MATHJS_AGGREGATES).map(n => `cc_${n}`),
]);

// math.js functions by lowercase name, so any capitalisation works (TRANSPOSE, DotMultiply)
const MATHJS_FUNCTIONS = new Map(
    Object.keys(math)
        .filter(name => typeof (math as any)[name] === "function" && /^[a-z]/.test(name))
        .map(name => [name.toLowerCase(), name])
);

// The function a name in a formula refers to: Excel's meaning whatever the case (LOG is base
// 10, like log), then math.js's functions in any case
export function resolveFunction(name: string): string {
    const upper = name.toUpperCase();
    if (EXCEL_FUNCTIONS[upper]) return upper === "SUM" ? "sum" : `excel_${upper}`;
    const lower = name.toLowerCase();
    if (MATHJS_AGGREGATES[lower]) return `cc_${lower}`;
    return MATHJS_FUNCTIONS.get(lower) ?? name;
}

// Excel-style comparisons: A1=0 and A1<>0 become math.js's == and != (outside quoted text)
function excelComparisons(formula: string): string {
    return formula.replace(/"[^"]*"|<>|(?<![<>!=])=(?!=)/g, m => (m.startsWith('"') ? m : m === "<>" ? "!=" : "=="));
}

// The Excel error code for an error message
export function errorCode(message: string): string {
    const code = message.match(/^#[A-Z0-9/]+[!?]/);
    if (code) return code[0];
    if (/outside the table|invalid (cell|range) reference/i.test(message)) return "#REF!";
    if (/loop|circular/i.test(message)) return "#CIRCULAR!";
    if (/Undefined (function|symbol)/.test(message)) return "#NAME?";
    if (/ambiguous|Syntax error|Unexpected end|Parenthesis|Value expected|Unexpected operator|Unexpected character|recursivity/.test(message)) return "#ERROR!";
    return "#VALUE!";
}

// Error messages without our internal function names
const readableReason = (message: string) => message
    .replace(/^#[A-Z0-9/]+[!?]: /, "")
    .replace(/excel_([A-Z0-9]+)/g, "$1")
    .replace(/cc_(\w+)/g, "$1");

enum celltype {
    number = 1,
    formula,
    matrix,
    escaped_text
}
enum cellstatus {
    none = 1,
    computing,
    iscomputed
}

// Thrown to a formula that uses a cell with an error, so the error propagates like in Excel
class CellError extends Error {
    constructor(public code: string, public reason: string) {
        super(`${code}: ${reason}`);
        this.name = "CellError";
    }
}

class InfiniteLoop extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InfiniteLoop";
    }
}


export interface TableResult {
    values: any[][];
    // Excel error codes (#DIV/0!, #REF!, ...), with the full reason in errorDetails
    errors: (string | null)[][];
    errorDetails: (string | null)[][];
    cellTypes: celltype[][];
    // Show this cell's result in scientific notation (its inputs are written that way)
    scientific: boolean[][];
}

export class TableEvaluator {
    tableData: any[][] = [];
    formulaData: any[][] = [];
    celltype: celltype[][] = [];
    cellstatus: cellstatus[][] = [];
    errors: (string | null)[][] = [];
    errorDetails: (string | null)[][] = [];
    parents: [number, number][][][] = [];
    children: [number, number][][][] = [];
    maxcols = 0;
    maxrows = 0;
    useBool = false;
    settings: any;
    // Rows 1, 2, ... are numbered from the first row after the header rows
    headerRows = 1;

    private parseLocaleNumber(str: string): number {
        const decimal = this.settings.decimalSeparator || ".";
        const grouping = this.settings.groupingSeparator || ",";

        // Remove grouping separators (and spaces between digits, e.g. "1 000"),
        // replace decimal with dot for parseFloat
        const normalized = String(str)
            .replace(/(\d)\s+(?=\d)/g, "$1")
            .replace(new RegExp(grouping.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
            .replace(decimal, '.')
            .trim();

        // The whole string must be a number: parseFloat alone would read "2026-09-25" as
        // 2026 and "2.5:1" as 2.5
        if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(normalized)) return NaN;
        return parseFloat(normalized);
    }

    // The cell contents as typed, before any array results are written into the table
    private gridData: string[][] = [];

    evaluateTable(gridData: string[][], settings?: any): TableResult {
        this.gridData = gridData;
        // Set settings with defaults
        this.settings = settings || {
            decimalSeparator: ".",
            groupingSeparator: ","
        };
        this.headerRows = this.settings.headerRows ?? 1;

        // Reset all arrays
        this.tableData = [];
        this.formulaData = [];
        this.celltype = [];
        this.cellstatus = [];
        this.errors = [];
        this.errorDetails = [];
        this.parents = [];
        this.children = [];
        this.maxcols = 0;
        this.maxrows = 0;

        // Initialize arrays
        this.initializeArrays(gridData);

        // Parse grid
        this.parseGridData(gridData);

        // Compute all cells
        this.computeAllCells();

        return {
            values: this.tableData,
            errors: this.errors,
            errorDetails: this.errorDetails,
            cellTypes: this.celltype,
            scientific: this.markScientific(gridData)
        };
    }

    // A result is shown in scientific notation when its inputs are: the formula contains a
    // number like 1.8e5, or a cell it references is written that way or is itself such a
    // result (so a sum over scientific results is scientific too)
    private markScientific(gridData: string[][]): boolean[][] {
        const memo: (boolean | undefined)[][] = gridData.map(row => row.map(() => undefined));
        const visiting = new Set<string>();

        const visit = (row: number, col: number): boolean => {
            const known = memo[row]?.[col];
            if (known !== undefined) return known;
            const key = `${row},${col}`;
            if (visiting.has(key)) return false; // circular reference
            visiting.add(key);

            const raw = gridData[row]?.[col] || "";
            let scientific;
            if (this.celltype[row][col] === celltype.formula) {
                scientific = /\d[eE][+-]?\d/.test(raw);
            } else if (this.celltype[row][col] === celltype.escaped_text) {
                scientific = false;
            } else {
                scientific = /^-?[\d,.\s]*\d[eE][+-]?\d/.test(raw);
            }
            // formula and matrix cells inherit from what they reference
            scientific = scientific || this.parents[row][col].some(([r, c]) => visit(r, c));

            visiting.delete(key);
            memo[row][col] = scientific;
            return scientific;
        };

        return gridData.map((row, r) => row.map((_, c) => visit(r, c)));
    }

    private initializeArrays(gridData: string[][]) {
        this.maxrows = gridData.length;
        this.maxcols = gridData[0]?.length || 0;

        for (let rowIndex = 0; rowIndex < this.maxrows; rowIndex++) {
            this.tableData[rowIndex] = [];
            this.formulaData[rowIndex] = [];
            this.celltype[rowIndex] = [];
            this.cellstatus[rowIndex] = [];
            this.errors[rowIndex] = [];
            this.errorDetails[rowIndex] = [];
            this.parents[rowIndex] = [];
            this.children[rowIndex] = [];

            for (let colIndex = 0; colIndex < this.maxcols; colIndex++) {
                this.cellstatus[rowIndex][colIndex] = cellstatus.none;
                this.errors[rowIndex][colIndex] = null;
                this.errorDetails[rowIndex][colIndex] = null;
                this.parents[rowIndex][colIndex] = [];
                this.children[rowIndex][colIndex] = [];
                this.tableData[rowIndex][colIndex] = null;
            }
        }
    }

    private parseGridData(gridData: string[][]) {
        for (let rowIndex = 0; rowIndex < this.maxrows; rowIndex++) {
            for (let colIndex = 0; colIndex < this.maxcols; colIndex++) {
                const cellContent = gridData[rowIndex]?.[colIndex] || "";

                if (cellContent.startsWith("'=")) {
                    // Store the content WITHOUT the apostrophe for display
                    this.formulaData[rowIndex][colIndex] = null;
                    this.cellstatus[rowIndex][colIndex] = cellstatus.iscomputed;
                    this.celltype[rowIndex][colIndex] = celltype.escaped_text;
                    this.tableData[rowIndex][colIndex] = cellContent.substring(1); // Remove '
                } else if (cellContent.startsWith("=")) {
                    // Formula cell
                    this.formulaData[rowIndex][colIndex] = cellContent;
                    this.cellstatus[rowIndex][colIndex] = cellstatus.none;
                    this.celltype[rowIndex][colIndex] = celltype.formula;
                    this.tableData[rowIndex][colIndex] = cellContent;
                } else if (cellContent === "") {
                    // Empty cell
                    this.formulaData[rowIndex][colIndex] = null;
                    this.cellstatus[rowIndex][colIndex] = cellstatus.iscomputed;
                    this.celltype[rowIndex][colIndex] = celltype.number;
                    this.tableData[rowIndex][colIndex] = null;
                } else {
                    // Value cell - could be number, unit, or text
                    this.formulaData[rowIndex][colIndex] = null;
                    this.cellstatus[rowIndex][colIndex] = cellstatus.iscomputed;
                    this.celltype[rowIndex][colIndex] = celltype.number;

                    // Parse for units
                    const parsed = this.parseUnitValue(cellContent);
                    if (parsed.unit) {
                        // Store the original string to preserve unit info
                        this.tableData[rowIndex][colIndex] = cellContent;
                    } else if (!isNaN(parsed.value) && isFinite(parsed.value)) {
                        // Pure number
                        this.tableData[rowIndex][colIndex] = parsed.value;
                    } else {
                        // Text
                        this.tableData[rowIndex][colIndex] = cellContent;
                    }
                }
            }
        }
    }

    private computeAllCells() {
        for (let i = 0; i < this.tableData.length; i++) {
            for (let j = 0; j < this.tableData[i].length; j++) {
                try {
                    this.getValueByCoordinates(i, j);
                } catch (error) {
                    // cell errors and loops are recorded on the cells themselves
                    if (!(error instanceof CellError || error instanceof InfiniteLoop)) console.log(error);
                }
            }
        }
    }





    // Record an error on a cell: its Excel code, and the reason shown on hover
    private setError(row: number, col: number, message: string) {
        this.errors[row][col] = errorCode(message);
        this.errorDetails[row][col] = readableReason(message);
        this.cellstatus[row][col] = cellstatus.iscomputed;
        this.tableData[row][col] = null;
    }

    // The error to throw to a formula that uses this (errored) cell
    private propagatedError(row: number, col: number): CellError {
        return new CellError(this.errors[row][col] as string, `${this.cords2ref(row, col)}: ${this.errorDetails[row][col]}`);
    }

    private isBlank(row: number, col: number): boolean {
        return this.tableData[row][col] === null && !this.errors[row][col];
    }

    bool2nr(value: any): any {
        return typeof value === "boolean" ? +value : value;
    }

    cords2ref(row: number, col: number): string {
        const colStr = String.fromCharCode("A".charCodeAt(0) + col);
        return colStr + (row - this.headerRows + 1);
    }

    // Absolute row number (1 = first row after the header) to grid index; -1 if out of range
    rowIndex(rowNumber: number): number {
        return rowNumber < 1 ? -1 : rowNumber + this.headerRows - 1;
    }

    ref2cords(ref: string, formulaRow = 0, formulaCol = 0): [number, number] | null {
        const match = ref.match(/^([A-Z]+|([+-]?)\d+c)(\d+|([+-]?)\d+r)$/);

        if (!match) return null;

        const [, colPart, altColPart, rowPart, altRowPart] = match;

        let col, row;

        if (colPart && colPart[0].match(/[A-Z]/)) {
            col = this.letter2col(colPart);
        } else if (colPart.endsWith("c")) {
            col = parseInt(colPart.replace("c", "")) + (altColPart ? formulaCol : -1);
        } else {
            col = parseInt(colPart);
        }

        if (rowPart && rowPart.includes("r")) {
            const rw = parseInt(rowPart.replace("r", ""));
            row = altRowPart ? formulaRow + rw : this.rowIndex(rw);
        } else {
            row = this.rowIndex(parseInt(rowPart));
        }

        return [row, col];
    }

    letter2col(letter: string): number {
        return letter.charCodeAt(0) - "A".charCodeAt(0);
    }

    copyArrayValues(sourceArray: any[][], targetArray: any[][], row: number, col: number): void {
        for (let i = 0; i < sourceArray.length; i++) {
            for (let j = 0; j < sourceArray[i].length; j++) {
                if (row + i < targetArray.length && col + j < targetArray[row + i].length) {
                    targetArray[row + i][col + j] = this.useBool
                        ? sourceArray[i][j]
                        : this.bool2nr(sourceArray[i][j]);
                }
            }
        }
    }


    private parseUnitValue(cellContent: string): { value: number; unit: string | null } {
        if (typeof cellContent !== 'string') {
            return { value: this.parseLocaleNumber(cellContent), unit: null };
        }

        // 50% -> 0.5
        const percentMatch = cellContent.trim().match(/^(-?[\d,.\s]*\d(?:[eE][+-]?\d+)?)\s*%$/);
        if (percentMatch) {
            const value = this.parseLocaleNumber(percentMatch[1]) / 100;
            if (isFinite(value)) return { value, unit: null };
        }

        // The exponent must follow a digit, so "1.8e5" is a number but "3 e5" stays a (bad) unit
        const unitMatch = cellContent.trim().match(/^(-?[\d,.\s]*\d(?:[eE][+-]?\d+)?)\s*([a-zA-Zµμ]+.*)?$/);
        if (unitMatch) {
            const [, numberPart, unitPart] = unitMatch;
            const value = this.parseLocaleNumber(numberPart);
            if (!isNaN(value) && isFinite(value)) {
                return { value, unit: unitPart ? unitPart.trim() : null };
            }
        }

        // Try to parse as plain number
        const numValue = this.parseLocaleNumber(cellContent);
        if (!isNaN(numValue) && isFinite(numValue)) {
            return { value: numValue, unit: null };
        }

        return { value: NaN, unit: null };
    }

    getValueByCoordinates(row: number, col: number) {
        const r = this.cords2ref(row, col);
        this.debug(`getValueByCoordinates ${r}`);

        if (this.cellstatus[row][col] == cellstatus.iscomputed) {
            this.debug(`getValueByCoordinates giving the value ${this.tableData[row][col]}`);
            if (this.errors[row][col]) throw this.propagatedError(row, col);
            const val = this.tableData[row][col];

            if (val === null) return 0;

            // Handle unit values
            if (typeof val === "string") {
                const parsed = this.parseUnitValue(val);
                if (parsed.unit) {
                    // Return as mathjs unit format: "value unit"
                    return `${parsed.value} ${parsed.unit}`;
                }
                // Check if it's a number string
                const parsedNum = this.parseLocaleNumber(val);
                if (!isNaN(parsedNum) && isFinite(parsedNum)) {
                    return parsedNum;
                }
                // Return as quoted string for mathjs
                return `"${val}"`;
            }

            if (typeof val === "number" || (!isNaN(parseFloat(val)) && isFinite(val))) {
                return val;
            }

            if (this.useBool) return val;
            return this.bool2nr(val);
        } else {
            if (this.cellstatus[row][col] == cellstatus.computing) {
                this.debug("********infinite loop*************");
                const ref = this.cords2ref(row, col);
                this.debug(`${ref}`);
                throw new InfiniteLoop(`${ref}`);
            }

            this.cellstatus[row][col] = cellstatus.computing;
            const formula = this.formulaData[row][col].slice(1);

            if (debug) {
                this.debug(`we are asked to fill in at ${row},${col} with formula: ${formula}`);
            }

            let processedformula;
            try {
                processedformula = this.unquoteUnits(this.parsefunction(excelComparisons(formula), [row, col]));
            } catch (error) {
                if (error instanceof InfiniteLoop) {
                    this.setError(row, col, `circular reference through ${error.message}`);
                    throw new InfiniteLoop(`${r}`);
                }
                this.setError(row, col, error.message);
                throw this.propagatedError(row, col);
            }

            try {
                this.debug(`we will evaluate the formula: ${processedformula}`);
                const result = math.evaluate(processedformula);

                this.debug(
                    `we were asked to fill in at ${this.cords2ref(
                        row,
                        col
                    )} with formula: ${formula} ; the result is ${result}`
                );

                // Handle mathjs Matrix objects (like DenseMatrix2)
                if (result && typeof result === "object" && result.constructor?.name?.includes("Matrix")) {
                    // Convert mathjs Matrix to plain array using toArray()
                    const matrixArray = result.toArray();
                    return this.fillInMatrix(row, col, matrixArray);
                }

                // Handle mathjs Unit objects
                if (result && typeof result === "object" && result.constructor?.name === "Unit") {
                    if (result.value !== null && !isFinite(result.value)) throw excelError("#DIV/0!", "division by zero");
                    this.cellstatus[row][col] = cellstatus.iscomputed;
                    this.tableData[row][col] = result;
                    return result;
                }

                // Check if result is already a plain JavaScript array
                if (Array.isArray(result)) {
                    return this.fillInMatrix(row, col, result);
                }

                // Try to parse as JSON only if it's a string (legacy support)
                if (typeof result === "string") {
                    try {
                        const parsed = JSON.parse(result);
                        if (Array.isArray(parsed)) {
                            return this.fillInMatrix(row, col, parsed);
                        }
                    } catch {
                        // Not JSON, continue with regular handling
                    }
                }

                // Regular scalar result; 1/0 is Infinity in math.js but #DIV/0! in Excel
                if (typeof result === "number" && !isFinite(result)) {
                    throw isNaN(result) ? excelError("#NUM!", "not a number") : excelError("#DIV/0!", "division by zero");
                }
                this.cellstatus[row][col] = cellstatus.iscomputed;
                this.tableData[row][col] = result;
                return result;
            } catch (error) {
                this.debug(`error computing cell ${r}`);
                const message = error instanceof InfiniteLoop ? `circular reference through ${error.message}` : error.message;
                this.setError(row, col, message);
                throw this.propagatedError(row, col);
            }
        }
    }

    fillInMatrix(row: number, col: number, parsed: any[][]): any {
        //now we got a matrix or vector we have to clear recompute the values of all the
        // children of these cells, but not on the main cell
        // normally if a cell depends on another cell first it asks it to calculate itself
        // but these matrices were not taken into account, as they expand more than one cell
        // Another solution would have been to parse the whole table first, to find the matrices
        // and compute the dependencies, and then again to compute

        //FIXME: if a cell is asked to recompute it's values
        // now we add the children twice. should keep track, of
        // how many times we compute and only first time add children
        const ismatrix = parsed.every((item: any[]) => Array.isArray(item));
        //if (!ismatrix) parsed=[parsed];
        if (!ismatrix) parsed = parsed.map((n: any) => [n]);

        // Like Excel's #SPILL!: don't overwrite cells that aren't empty. Copies of the same
        // formula may be overwritten (nothing is lost), which keeps the pattern of repeating an
        // array formula down a column working
        const own = (this.gridData[row]?.[col] ?? "").trim();
        parsed.forEach((parsedRow: any[], i: number) => parsedRow.forEach((_: any, j: number) => {
            const content = (this.gridData[row + i]?.[col + j] ?? "").trim();
            if ((i || j) && content !== "" && content !== own) {
                throw new CellError("#SPILL!", `the result would overwrite ${this.cords2ref(row + i, col + j)}`);
            }
        }));

        this.copyArrayValues(parsed, this.tableData, row, col);
        //we assume here that this cell is computed
        this.cellstatus[row][col] = cellstatus.iscomputed;

        //then we clean all the children of the values that were
        //overwritten by writing the matrix
        parsed.forEach((parsedrow: any[], i: number) => {
            parsedrow.forEach((_: any, j: number) => {
                if (row + i < this.tableData.length && col + j < this.tableData[0].length) {
                    if (i || j) {
                        //if this cell contained a formula we delete it and also the parents
                        this.parents[row + i][col + j] = [];
                        this.formulaData[row + i][col + j] = null;
                        this.cellstatus[row + i][col + j] = cellstatus.iscomputed;

                        try {
                            this.cleanupchildren([row + i, col + j], [row, col]); //the children of this (and their children...) will be marked as not computed
                        } catch (error) {
                            if (error instanceof InfiniteLoop) {
                                this.errors[row][col] = "#CIRCULAR!";
                                this.errorDetails[row][col] = readableReason(error.message);
                            } else {
                                throw error;
                            }
                        }
                        //the formula cell becomes the parent of every matrix cell (i!=0 and j!=0)
                        this.parents[row + i][col + j].push([row, col]);
                        this.children[row][col].push([row + i, col + j]);

                        this.celltype[row + i][col + j] = celltype.matrix;
                        this.debug(
                            `parents of ${this.cords2ref(row + i, col + j)} are ${this.parents[row + i][col + j]
                            }`
                        );
                    }
                }
            });
        });

        //if at this point our main cell status is not computed,
        // then it means that this cell matrix is affecting
        //the value of the formula so we throw an error
        // this should not happen though, as we implemented
        //another error checking with cleanupchildren, where we
        //pass the address of the root formula for the matrix,
        // and if a child tries to clean that, it throws an error
        if (this.cellstatus[row][col] != cellstatus.iscomputed) {
            throw new Error("matrix\nloop");
        }

        //now that we filled the values in, we can recompute the children
        //we only have to call getValueByCoordinates for each child and child's child
        //basically all cells that depend on this range that got overwritten by the matrix
        parsed.forEach((tmprow: any[], i: number) => {
            tmprow.forEach((tmpcell: any, j: number) => {
                if (
                    (i || j) &&
                    row + i < this.tableData.length &&
                    col + j < this.tableData[0].length
                ) {
                    this.computechildren(row + i, col + j); //the children of this (and their children...)
                }
            });
        });

        //this.celltype[row][col]=celltype.formula;
        return parsed[0][0];
    }




    cleanupchildren([row, col]: [number, number], [rootRow, rootCol]: [number, number], i = 0): void {
        //set the parents for [row,col] and its parents computed to none
        //the whole process was initiated by the matrix formula at rootRow,rootCol
        //so if, one of the children or children of chilren,...
        //wants to cleanup the rootcell, it means there is a loop
        if (i++ > 10) {
            throw new Error(`too high recursivity on cleanupchildren`);
        }
        //we already cleand it up
        this.children[row][col].forEach(([r, c]) => {
            this.debug(`cleanup? status for ${this.cords2ref(r, c)} is ${this.cellstatus[r][c]} `);
            if (this.cellstatus[r][c] === cellstatus.iscomputed) {
                if (r === rootRow && c === rootCol) {
                    //we are trying to clean up the matrix cell
                    //which would force it to recompute
                    throw new InfiniteLoop(`matrix\nloop ${this.cords2ref(row, col)}`);
                }
                this.debug("yes, cleanup");
                this.cellstatus[r][c] = cellstatus.none;
                this.cleanupchildren([r, c], [rootRow, rootCol], i);
            } else {
                this.debug("nope");
            }
        });
    }
    computechildren(row: number, col: number, i = 0): void {
        this.debug(
            `recomputing the children of ${this.cords2ref(row, col)}: ${this.children[row][col]
                .map(([r, c]) => this.cords2ref(r, c))
                .join(", ")}`
        );

        if (i++ > 100) {
            throw new Error(`too high recursivity on computechildren`);
        }
        this.children[row][col].forEach(([r, c]) => {
            if (this.cellstatus[r][c] !== cellstatus.iscomputed) {
                let res;
                try {
                    res = this.getValueByCoordinates(r, c);
                } catch (error) {
                    if (!(error instanceof CellError)) throw error; // recorded on that cell
                }
                this.debug(`value for ${this.cords2ref(r, c)} is ${res} `);
                this.debug(`status for ${this.cords2ref(r, c)} is ${this.cellstatus[r][c]} `);
                this.computechildren(r, c);
            }
        });
    }


    getValuebyReference(ref: string, formulaRow = 0, formulaCol = 0, skipBlanks = false): string | number {
        const coords = this.ref2cords(ref, formulaRow, formulaCol);
        if (!coords) throw new Error(`invalid cell reference ${ref}`);
        const [row, col] = coords;
        if (row < 0 || row > this.maxrows - 1 || col < 0 || col > this.maxcols - 1) {
            throw new Error(`${ref} is outside the table`);
        }
        this.parents[formulaRow][formulaCol].push([row, col]);

        //this.debug(`{cords2ref[row,col]} is a parent of {cords2ref(formulaRow,formulaCol)}`);
        this.children[row][col].push([formulaRow, formulaCol]);
        const value = this.getValueByCoordinates(row, col);
        return skipBlanks && this.isBlank(row, col) ? "null" : value;
    }

    findclosingbracket(formula: string): string {
        let counter = 1;
        let pos = 0;

        while (counter > 0 && pos < formula.length) {
            if (formula[pos] === "(") counter++;
            else if (formula[pos] === ")") counter--;

            pos++;
        }
        const contentInsideParenthesis = formula.substring(0, pos - 1);
        return contentInsideParenthesis;
    }

    // skipBlanks: inside an aggregate function, blank cells become null and are skipped
    parsefunction(formula: string, pos: [number, number] = [0, 0], skipBlanks = false): string {
        //these are the position of the calling cell; useful for relative coordinates
        //also for puting asside the reference list for higlighting
        const [formulaRow, formulaCol] = pos;

        this.debug(`we parsefunction; ${this.cords2ref(formulaRow, formulaCol)} (location:${formulaRow},${formulaCol})`);
        let i = 0;
        let results = "";

        while (i < formula.length) {
            if (formula[i] === "(") {
                //look inside paranthesis, end expand them, recursively
                const contentInsideParenthesis = this.findclosingbracket(formula.slice(i + 1));
                //we call here the same function with the parantheses contents
                const res = this.parsefunction(contentInsideParenthesis, [formulaRow, formulaCol], skipBlanks);
                results += "(" + res + ")";
                i += contentInsideParenthesis.length + 2;
                this.debug(`${contentInsideParenthesis}`);
                this.debug(`the rest is ${formula.slice(i)}`);
            } else {
                const restformula = formula.slice(i);
                this.debug(`rest formula is:${restformula}`);
                // written by table-structure.ts when a referenced row or column was deleted
                if (restformula.startsWith("#REF!")) {
                    throw new Error("#REF!: refers to a row or column that was deleted");
                }
                // a letter or _ before this point means we are inside a name such as log2 or LN2
                const inName = i > 0 && /[A-Za-z_]/.test(formula[i - 1]);
                const matchRef = (re: RegExp) => (inName ? null : restformula.match(re));

                const matchCell = matchRef(/^([A-Z]|[+-]?\d+c)([+-]?\d+r|\d+)/);

                const matchRange = matchRef(
                    /^([A-Z]|[+-]?\d+c)([+-]?\d+r|\d+):([A-Z]|[+-]?\d+c)([+-]?\d+r|\d+)/
                );

                const matchMatrix = restformula.match(
                    //basically matchRange but between `[` `]`
                    /^\[([A-Z]|[+-]\d+c)([+-]\d+r|\d+):([A-Z]|[+-]\d+c)([+-]\d+r|\d+)\]/
                );

                const matchformula = inName ? null : restformula.match(/^[a-zA-Z]{2,}[a-zA-Z0-9_]*\(/);

                const matchNum = restformula.match(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);

                const matchRangeCol = matchRef(/^[A-Z]:[A-Z]/); //column range
                const matchRangeColMatrix = restformula.match(/^\[[A-Z]:[A-Z]\]/); //column range
                const matchRangeRow = matchRef(/^\d+:\d+/); //row range

                // A1-1c+0r: after a value, is "-" a minus or the sign of the relative reference?
                // It used to be read as the sign, gluing 10 and 2 into 102; ask for brackets
                const signedRef = (matchRange || matchCell)?.[0];
                if (signedRef && /^[+-]/.test(signedRef) && /[A-Za-z0-9_.)\]]\s*$/.test(formula.slice(0, i))) {
                    throw new Error(`ambiguous "${signedRef}": put it in brackets, e.g. ${signedRef[0]} (${signedRef})`);
                }

                if (matchRange) {
                    /* normal range a3:b7 or a-3:b+7, or anything in between;
                        the rows and columns are mentioned, either absolute or relative */
                    this.debug(`we matched a range`);
                    i += matchRange[0].length - 1;
                    const [start, end] = matchRange[0].split(":"); // Split the range into start and end
                    const startCoords = this.ref2cords(start, formulaRow, formulaCol);
                    const endCoords = this.ref2cords(end, formulaRow, formulaCol);
                    if (!startCoords || !endCoords) throw new Error("invalid range reference");
                    const [startRow, startCol] = startCoords;
                    const [endRow, endCol] = endCoords;
                    this.debug(`we look for range till ${this.cords2ref(endRow, endCol)}`);
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos, false, skipBlanks);
                } else if (matchMatrix) {
                    this.debug(`we matched a matrix`);
                    i += matchMatrix[0].length - 1;
                    const [start, end] = matchMatrix[0].slice(1, -1).split(":"); // Split the range into start and end
                    const startCoords = this.ref2cords(start, formulaRow, formulaCol);
                    const endCoords = this.ref2cords(end, formulaRow, formulaCol);
                    if (!startCoords || !endCoords) throw new Error("invalid range reference");
                    const [startRow, startCol] = startCoords;
                    const [endRow, endCol] = endCoords;
                    this.debug(`we look for range till ${this.cords2ref(endRow, endCol)}`);
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos, true);
                } else if (matchRangeCol) {
                    this.debug(`we matched a column range`);
                    i += matchRangeCol[0].length - 1;
                    const [start, end] = matchRangeCol[0].split(":"); // Split the range into start and end
                    const [startCol, startRow] = [this.letter2col(start), this.headerRows]; // we skip the header
                    const [endCol, endRow] = [this.letter2col(end), this.maxrows - 1];
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos, false, skipBlanks);
                } else if (matchRangeColMatrix) {
                    this.debug(`we matched a column range Matrix`);
                    i += matchRangeColMatrix[0].length - 1;
                    const [start, end] = matchRangeColMatrix[0].slice(1, -1).split(":"); // Split the range into start and end
                    const [startCol, startRow] = [this.letter2col(start), this.headerRows]; // we skip the header
                    const [endCol, endRow] = [this.letter2col(end), this.maxrows - 1];
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos, true);
                } else if (matchRangeRow) {
                    this.debug(`we matched a row range`);
                    i += matchRangeRow[0].length - 1;
                    const [start, end] = matchRangeRow[0].split(":"); // Split the range into start and end
                    const startCol = 0;
                    const endCol = this.maxcols - 1;
                    const startRow = this.rowIndex(parseInt(start));
                    const endRow = this.rowIndex(parseInt(end));
                    results += this.unfoldRange(startRow, endRow, startCol, endCol, pos, false, skipBlanks);
                } else if (matchformula) {
                    this.debug(`we matched formula ${matchformula}`);
                    const contentInsideParenthesis = this.findclosingbracket(
                        restformula.slice(matchformula[0].length)
                    );
                    this.debug(`contentInsideParenthesis ${contentInsideParenthesis}`);
                    const fn = resolveFunction(matchformula[0].slice(0, -1));
                    const res = this.parsefunction(contentInsideParenthesis, [
                        formulaRow,
                        formulaCol //this keeps the referencing cell; for highlighting
                    ], BLANK_SKIPPING.has(fn));
                    results += fn + "(" + res + ")";
                    i += matchformula[0].length + contentInsideParenthesis.length;
                } else if (matchCell) {
                    this.debug(`we matched a cell`);
                    const ref = this.getValuebyReference(matchCell[0], formulaRow, formulaCol, skipBlanks);
                    results += ref.toString();
                    i += matchCell[0].length - 1;
                } else if (matchNum) {
                    this.debug(`we matched a number`);
                    results += matchNum[0];
                    i += matchNum[0].length - 1;
                } else {
                    results += restformula[0];
                    this.debug(`we didn't match anything`);
                }

                i++;
            }
        }
        this.debug(`results are:${results}`);

        return results;
    }


    unfoldRange(startRow: number, endRow: number, startCol: number, endCol: number, formulaPos: [number, number] = [0, 0], matrix = false, skipBlanks = false): string {
        const [formulaRow, formulaCol] = formulaPos;
        [startRow, endRow] = startRow > endRow ? [endRow, startRow] : [startRow, endRow];
        [startCol, endCol] = startCol > endCol ? [endCol, startCol] : [startCol, endCol];

        endRow = Math.min(endRow, this.maxrows - 1);
        endCol = Math.min(endCol, this.maxcols - 1);

        // For matrix notation [a2:c4], preserve 2D structure
        const rowArray = [];

        for (let r = startRow; r <= endRow; r++) {
            const colArray = [];

            for (let c = startCol; c <= endCol; c++) {
                this.parents[formulaRow][formulaCol].push([r, c]);
                this.children[r][c].push([formulaRow, formulaCol]);

                const val = this.getValueByCoordinates(r, c);
                // blanks are null (skipped) in aggregates; matrices keep them as 0
                colArray.push(!matrix && skipBlanks && this.isBlank(r, c) ? null : val);
            }
            rowArray.push(colArray);
        }

        const fmt = (v: any) => {
            if (v === null) return "null";
            // for string values wrapped in quotes, change this to: return typeof v === "string" ? `"${v}"` : String(v);
            return String(v);
        };

        if (matrix) {
            // produce e.g. [[1,2,3],[4,5,6]]
            const matrixString = rowArray
                .map(row => `[${row.map(v => fmt(v)).join(",")}]`)
                .join(",");
            return `[${matrixString}]`;
        } else {
            // flatten and produce e.g. 1,2,3,4,5
            const flat: any[] = rowArray.flat();
            return flat.map(v => fmt(v)).join(",");
        }
    }


    // ="5 mL" * 3 -> (5 mL) * 3: a quoted quantity with a valid unit behaves like a unit cell
    private unquoteUnits(formula: string): string {
        return formula.replace(/"([^"]*)"/g, (match, content: string) => {
            const parsed = this.parseUnitValue(content);
            if (!parsed.unit) return match;
            const quantity = `${parsed.value} ${parsed.unit}`;
            try {
                math.unit(quantity);
                return `(${quantity})`;
            } catch {
                return match;
            }
        });
    }

    debug(message: any): void {
        if (debug) {
            console.log(message);
        }
    }
}
