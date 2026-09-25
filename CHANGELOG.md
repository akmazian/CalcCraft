# Changelog

All notable changes to CalcCraft will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Fork of klaudyu/CalcCraft

Versions from `2.3.7-fork.1` on are a fork of [klaudyu/CalcCraft](https://github.com/klaudyu/CalcCraft) 2.3.7 by akmazian, installed under the plugin ID `calc-craft-fork`. Everything below 2.3.7 is upstream history.

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
