# Changelog

All notable changes to CalcCraft will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Fork of klaudyu/CalcCraft

Versions from `2.3.7-fork.1` on are a fork of [klaudyu/CalcCraft](https://github.com/klaudyu/CalcCraft) 2.3.7 by akmazian, installed under the plugin ID `calc-craft-fork`. Everything below 2.3.7 is upstream history.

## [Unreleased]

### Added
- **References follow inserted, deleted and moved rows and columns**, like Excel. Inserting a row above `s2` turns `=C2*D2` into `=C3*D3` and `=sum(C1:C3)` into `=sum(C1:C4)`; moving a row takes its references with it while totals keep covering the same rows; deleting a referenced row or column writes `#REF!` into the formula (`=C1*#REF!`). Works for Obsidian's table commands, the right-click menu, drag handles and rows pasted in source mode, and one undo reverts the edit and the rewrite together. Relative references (`+0c-1r`) stay positional, formulas in newly inserted rows are left as written, and a sort (many rows rearranged at once) leaves references on their positions
- **Click a cell to insert its reference** (Live Preview), like Excel: while editing a formula with the cursor right after `=`, an operator, `(`, `,` or `:`, clicking another cell of the table inserts its reference (`=B1*` + click C1 → `=B1*C1`). Clicking again straight away replaces it; shift-click or dragging makes a range (`C1:C3`); a header cell inserts the whole column (`C:C`). Otherwise a click moves to the cell as before

### Changed
- **Cells no longer widen while you type** (Live Preview): the cell keeps the size of what it showed, and the text you're typing runs over the neighbouring cells, like in Excel. The column resizes once, to the new result, when you finish
- **Excel function names, in any case**: `SUM`, `Sum` and `sum` are the same. Excel functions: `SUM`, `AVERAGE`, `MIN`, `MAX`, `MEDIAN`, `PRODUCT`, `COUNT`, `COUNTA`, `STDEV`, `STDEVP`, `VAR`, `VARP`, `IF`, `AND`, `OR`, `NOT`, `TRUE`, `FALSE`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `TRUNC`, `INT`, `FLOOR`, `CEILING`, `MOD`, `ABS`, `SIGN`, `SQRT`, `POWER`, `EXP`, `LN`, `LOG`, `LOG10`, `PI`. Other math.js functions keep working in any case (`TRANSPOSE`, `DotMultiply`)
- **Breaking: Excel's meaning wins whatever the case.** `log(100)` is now `2` (base 10, like Excel's `LOG`; it was the natural log, now `LN`), and `floor(7, 5)` is `5` (rounds down to a multiple, like Excel's `FLOOR`; math.js's second argument was a number of decimals). Check formulas that use `log`, `floor` or `count`
- **Excel comparisons**: `=IF(A1=0, …)` and `A1<>0` work (`=` compares, `<>` is "not equal"); `TRUE`/`FALSE` results are shown in capitals
- **Excel error codes**: errors show as `#DIV/0!`, `#REF!`, `#NAME?`, `#VALUE!`, `#NUM!`, `#SPILL!`, `#CIRCULAR!` (loops) or `#ERROR!` (formula syntax). Hovering the cell shows the formula and the full reason

### Fixed
- **`IF` only evaluates the branch it takes**, like Excel: `=IF(A1>0, LOG(A1), 0)` with `A1` = 0 is `0` (was `#NUM!`), and a cell with an error used only in the other branch no longer matters
- **Formulas with `*` were misread**: CalcCraft read formulas from the rendered cell, where Obsidian had already turned `*...*` into italics and dropped the asterisks, so `=A1*B1+A1*B1` was read as `=A1B1+A1B1` and gave a wrong number (`46` instead of `12`), and `=A2*B2*2` gave `#REF!`. Formulas are now read from the note's markdown source, in Live Preview and reading view
- **Errors propagate**: a formula using a cell with an error gets the same error (the hover text says where it came from). It used to treat the cell as `0`, and a reference outside the table was reported as a loop
- **`=1/0` is `#DIV/0!`**, not `Infinity`
- **Blank cells are skipped by aggregate functions**, as in Excel: `AVERAGE`/`mean` of 2, blank, 4 is `3` (was `2`), `MAX` of -2, blank, -4 is `-2` (was `0`), `PRODUCT` is `8` (was `0`). In arithmetic and matrices a blank still counts as `0`
- `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `TRUNC`, `INT`, `FLOOR` and `CEILING` work on quantities with units (`ROUND(1.2345 mL, 2)` → `1.23 mL`)
- **Percentages**: `50%` is read as `0.5` (it was read as `50`)
- **No more partial numbers**: a cell is only a number if all of it is one. Dates (`2026-09-25`) and ratios (`2.5:1`, `1:1`) were read as their first number (`2026`, `2.5`); they are now text, so arithmetic on them shows an error
- **`#SPILL!`**: an array result no longer overwrites cells that contain something else; it shows `#SPILL!` instead. Copies of the same array formula can still be overwritten, so repeating one down a column keeps working
- **Ambiguous signs**: `=A1-1c+0r` read the `-` as part of the relative reference and joined the two values (`10` and `2` became `102`). A signed relative reference right after a value is now an error asking for brackets: `A1 - (-1c+0r)`

### Removed
- The underline on the hovered cell

## [2.3.7-fork.2] - 2026-09-25

### Added
- **Results follow their inputs' notation**: a result is shown in scientific notation when its formula contains a number like `1.8e5` or references a cell written that way (or another such result). `=C1*D1` with `D1` = `1.8e5` shows `3.6e5`, and `=sum(E1:E4)` over those shows `1.44e6`; `=2*21` stays `42`. Results from 0.001 up to 1000 stay plain. The decimal-places setting sets the mantissa's decimals (`3.33e-5` at 2)

### Changed
- **Enter in the last row of a table no longer adds a row** while you're editing a cell (Live Preview). It finishes editing and moves the cursor to the line below the table, so a second Enter starts a new line in the note. Enter in other rows still moves down a row, and rows can still be added with Obsidian's + button or the right-click menu
- Computed values in Live Preview sit exactly where normal cell text does: the overlay no longer adds its own padding, font size, line height or vertical alignment
- **Removed** the background colour and the double border on formula and matrix (array-result) cells, and their settings ("formula's cells color", "matrix cell color", "show formula cell borders"). Error colouring and the hover highlighting of parents and children are kept
- The cell being edited is no longer underlined; the hover underline only marks cells you aren't editing
- `scientific()` writes exponents the way they are typed in cells: `1.235e8`, not `1.235e+8`

## [2.3.7-fork.1] - 2026-09-25

### Fork
- Own plugin ID `calc-craft-fork` and name "CalcCraft (fork)"
- Modification notices in changed source files, as required by Apache 2.0
- Test suite: `npm test` (node:test + tsx)

### Changed
- **References are uppercase**, as in Excel: `A1`, `B2:C4`, `A:F`, `[A1:C3]`. Lowercase `a1` is no longer a reference. The relative `c`/`r` notation (`2c1`, `+0c-1r`) is unchanged.
- **Row 1 is the first row after the header.** The header row is not numbered, and with several header rows (Table Extended, Table Master) row 1 is the first row after all of them. Existing formulas need updating: `=c2*d2` becomes `=C1*D1`.
- Column labels are shown uppercase and row labels start at 1 on the first data row
- References are no longer matched inside names, so `log2(8)`, `log10(100)` and `LN2` work

### Added
- Quoted quantities in formulas: `="5 mL" * 3` gives `15 mL`
- **Precision for units**: the decimal-places setting now applies to unit results (`953.1343824165767 µL` → `953.13 µL` at 2 decimals), and `format()` / `scientific()` accept units: `=format(D1 to µL, 1)` → `953.1 µL`. As before, `format()` takes precedence over the setting
- **Table Master compatibility in reading view**: Table Master rebuilds every table from the markdown source after CalcCraft has computed it, which left the raw formulas visible. CalcCraft now recomputes a table once Table Master marks it rendered (`data-tm-rendered`), and places cells by Table Master's recorded positions (`data-tm-row` / `data-tm-col`) so merged cells don't shift column letters
- Molar unit `M` with prefixes (`mM`, `µM`, `nM`), defined as `1 mol/L`
- `µ` (micro sign, Option-M on a Mac) and `μ` (Greek mu) work as the micro prefix, like `u`: `12.5 µL`, `25 μM`. Previously a cell like `1000 µM` was silently read as the bare number `1000`

### Fixed
- `scientific()` results were displayed with a space before the exponent (`1.235 e+8`)
- Scientific notation in a referenced cell (`1.8e5`, `2e-3 M`) was read as the number `1.8` with the unit `e5`, so formulas referencing it failed
- Scientific notation typed into a formula (`=2*1.8e5`) was split up and `e5` treated as a cell reference; decimals in formulas are now kept whole
- Spaces as thousands separators (`1 000`) were silently read as `1`; whitespace between two digits is now ignored (`5 mL` and `3 e5` are unaffected)
- Grouping separator `.` was not stripped when parsing cell values (e.g. `1.234,5` with decimal separator `,` was read as `1.234` instead of `1234.5`)
- Removed a leftover debug `console.log` that fired for every labelled column on each render

## [2.3.7] - 2026-02-16

### Added
- scientific(value, precision) for exponential notation (e.g. 1.23e+9)

### Fixed
- sum() now filters empty cells to work with units (e.g. sum(1 cm, 3 cm, empty))

## [2.3.6] - 2026-02-16

### Fixed
- Display trailing zeros when value exceeds display precision (e.g. for a precision of 3: 3.00005 -> 3.000 but 3.0000 -> 3)
- format() takes precedence over the options (e.g. precision is set to 3 in options, but we have =format(1/3,5) -> 0.33333)

## [2.3.5] - 2026-02-16

### Fixed
- isNumeric() fixed

## [2.3.4] - 2026-02-16

### Fixed
- **Cell sizing in Live Preview**: Cells adapt their size to the computed value display instead of the underlying formula text. Fixes long formulas like =2^64 not fitting in the cell, and long formulas that compute to short values (e.g. "42") making cells unnecessarily wide.

## [2.3.3] - 2026-02-16

### Changed
- **Label Display**: Refactored table labels to use CSS pseudo-elements instead of adding physical rows and columns to the DOM
    - Labels now displayed via `::before` and `::after` CSS pseudo-elements to avoid row/column switch when selecting a row or a column

### Fixed
- Removing the "'" from the beginning of a formula was not returning the cell to a formula

## [2.3.1] - 2026-02-16

### Added
- **Escape character for literal equals signs**: Use `'=` prefix to display text starting with `=` without triggering formula evaluation. The apostrophe will be hidden in the display but preserved when editing.
  - Example: `'=value` displays as `=value` but is not treated as a formula

## [2.3.0] - 2026-02-16

### Added
- Configurable decimal separator (e.g., '.' or ',')
- Configurable grouping separator (e.g., ',', '.', or ' ')
- CHANGELOG.md
