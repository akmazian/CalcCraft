# Changelog

All notable changes to CalcCraft will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
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
