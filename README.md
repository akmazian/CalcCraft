
# CalcCraft Revived

By Akmazian, adapted from [CalcCraft](https://github.com/klaudyu/CalcCraft) 2.3.7 by klaudyu, licensed under Apache 2.0 (see `LICENSE.txt`; `NOTICE` is math.js's).
It installs as its own plugin (ID `calc-craft-fork`), so Obsidian won't replace it with the original when it checks for updates.

Changes (see [CHANGELOG.md](CHANGELOG.md) for details):
- Scientific notation works in cells (`1.8e5`, `2e-3 M`) and in formulas (`=2*1.8e5`)
- Spaces between digits are ignored (`1 000` is 1000), and the `.` grouping separator is fixed
- References are uppercase (`A1`, `B2:C4`), and row 1 is the first row after the header. **Existing formulas need updating**, e.g. `=c2*d2` becomes `=C1*D1`
- Quoted quantities work in formulas: `="5 mL" * 3` gives `15 mL`
- Molar unit `M` (`mM`, `µM`, …) and `µ`/`μ` as the micro prefix
- Works with [Table Master](https://github.com/moranrs/table-master) in reading view, including merged cells and multiple header rows
- Test suite (`npm test`) and code cleanup

## Short Info

<a href="https://youtu.be/6nSSLsIng8k?autoplay=1)">
    <img src="./doc/images/calccraft.png" alt="Video Thumbnail" width="200px"/>
</a>

### Features
The plugin is intended to allow usage of formulas in tables, which are computed for the rendered version of the table.
In source mode, or while editing, the formulas are visibile, in live-preview or read mode, the formulas are replaced by computed values.
The plugin treats tables as spreadsheets, translating cells and ranges to the values, expanding and computing if necessary the referenced cells.
The table is divided in columns (labeled from 'A' to 'Z') and numbered rows. Row 1 is the first row after the header; the header itself is not numbered. If a table has several header rows (e.g. with the Table Extended or Table Master plugins), row 1 is the first row after all of them.

After expanding the expressions are evaluated using  [mathjs](https://mathjs.org/docs/reference/functions.html), therefore supporting many functions from there. Ranges between `[ ... ]` are expanded as matrices, and can be used for matrix operations.
### operations
Excel functions work in any case, with Excel's meaning: `SUM`, `AVERAGE`, `MIN`, `MAX`, `MEDIAN`, `PRODUCT`, `COUNT`, `COUNTA`, `STDEV`, `IF`, `AND`, `OR`, `NOT`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `INT`, `FLOOR`, `CEILING`, `MOD`, `SQRT`, `POWER`, `LN`, `LOG` (base 10), and more. Aggregates skip blank cells, `=IF(A1=0, "zero", "other")` / `A1<>0` compare like Excel (text too, ignoring case), and `&` joins text: `=A1 & "_" & B1 & "_48hr_rep" & C1`.
Most other functions from [mathjs](https://mathjs.org/docs/reference/functions.html) are supported too, in any case.
Errors show Excel codes (`#DIV/0!`, `#REF!`, `#NAME?`, `#VALUE!`, `#NUM!`, `#SPILL!`, `#CIRCULAR!`); hover the cell for the reason.
### Real-time Formula Evaluation in Edit Mode
- **Edit Mode**: Formulas remain visible while editing, with computed values shown as overlays
- **Reading Mode**: Clean display with computed results only

#### Spreadsheet like references
If the result is a vector or a matrix the output will be expanded to multiple cells, and the references for those cells are recomputed.
The references supported are in `[A-Z][0-9]+` format (uppercase, as in Excel), e.g. `A1` for the first column of the first row after the header. Lowercase `a1` is not a reference.
Besides this `A1` reference style, the cells can be referenced using colum-row notation: `[0-9]+c[0-9]r`, where `c` stands for column and `r` stands for row. So for addressing the `B3` cell we could also write `2c3r` (column 2, row 3).
The column-row notation supports also relative referencing by adding a `+` or `-` before the number. 
Combinations of the two are possible:
- `=B+3r` cell at column `B` , 3 rows down.
- `=2c7` cell at column 2 (which is B), row 7
the row-column notation is intended to be used mainly as a relative reference, for example getting the value above the curent cell: `=+0c-1r` (zero columns to the right, the row above)

summing all the values in the curent column from the first row to the cell above the curent one:  `=sum(+0c1:+0c-1r)`

#### Pointing at cells
In Live Preview you can build a formula by clicking, like in Excel: type `=` (or an operator such as `*`, or `(`), then click a cell to insert its reference. Click again to replace it, shift-click or drag for a range, or click a header cell for the whole column.

#### Inserting, deleting and moving rows and columns
References keep pointing at the same cells, like in Excel: insert a row above row 2 and `=C2*D2` becomes `=C3*D3`, while `=sum(C1:C3)` grows to `=sum(C1:C4)`. Moving a row takes its references with it; deleting a referenced row or column writes `#REF!` into the formula. Relative references (`+0c-1r`) stay positional, and sorting leaves references on their positions.

#### Highlight involved cells
The cells that influence the curent cell, are called `parents`, and the ones that depend on the curent cell are called `children`. Hovering the mouse over a cell, shows both the parents and the children, in customizable colors. This makes it easier to track the flow of data in the sheet. The colors can be customized for the dark theme and for the light theme.
### Highlighting errors
If a cell loops back to itself while trying to be computed, a `loop` error is thrown and displayed. This is also valid for matrix operations, where a cell influences multiple cells.

### Powered by MathJS with Units Support
Formulas are evaluated using [mathjs](https://mathjs.org/docs/reference/functions.html)
- **Native unit parsing**: `5 kg`,  `25 celsius`, `12 inch`
- **Scientific notation**: `1.8e5`, `2e-3 M` in cells and `=2*1.8e5` in formulas. Results are shown in scientific notation when their inputs are: `=C1*D1` with `D1` = `1.8e5` shows `3.6e5`
- **Quoted quantities**: `="5 mL" * 3` gives `15 mL`
- **Lab units**: molar `M` (`mM`, `µM`, `nM`), and `µ` or `μ` as the micro prefix (`12.5 µL`), e.g. `=D1 / (C1 g/mol) / B1 to µL`
- **Unit arithmetic**: `=5 kg + 3000 g` automatically converts and returns `8 kg`
- **Unit conversion**: `=5 inch to cm` converts between unit systems
- **Matrix operations with units**: Full support for unit calculations in ranges and matrices
### Matrix and Range Operations
Ranges between `[...]` are expanded as matrices and can be used for matrix operations:
- **Standard ranges**: `A1:C3` flattens to a 1D array for functions like `sum()`
- **Matrix ranges**: `[A1:C3]` preserves 2D structure for matrix operations
If the result is a vector or matrix, the output expands to multiple cells, and references for those cells are automatically recomputed.
### Smart Processing Options
- **Class filtering**: Only process tables in files with specific `cssclass` in frontmatter
## Examples
#### Expenses

| Month     | Income      | Rent        | Groceries   | Entertainment | Savings                              |
| --------- | ----------- | ----------- | ----------- | ------------- | ------------------------------------ |
| January   | 1800        | 1000        | 300         | 200           | =[B1:B98]-[C1:C98]-[D1:D98]-[E1:E98] |
| February  | 1700        | 1000        | 310         | 210           | =[B1:B98]-[C1:C98]-[D1:D98]-[E1:E98] |
| March     | 1880        | 1000        | 320         | 220           | =[B1:B98]-[C1:C98]-[D1:D98]-[E1:E98] |
| April     | 1720        | 1000        | 330         | 230           | =[B1:B98]-[C1:C98]-[D1:D98]-[E1:E98] |
| **Total** | =sum(B1:B4) | =sum(C1:C4) | =sum(D1:D4) | =sum(E1:E4)   |                                      |

![ ](./doc/images/README-20250912-1514-173.webp)

### simple sum, simple reference
| plums | bananas | fruits |
| ----- | ------- | ------ |
| 5     | 12      | =A1+B1 |
![ ](./doc/images/README-20250912-1514-208.webp)
### simple sum, relative reference
`[+-]?[0-9]+r[+-]?[0-9]+c`:
examples:
- `-2c+1r` : two columns left, one row down
- `-0c-1r`: same column, 1 row up

| plums | bananas | fruits             |
| ----- | ------- | ------------------ |
| 5     | 12      | =(-2c+0r)+(-1c+0r) |
| 7     | 5       | =(-2c+0r)+(-1c+0r) |
![ ](./doc/images/README-20250912-1515-274.webp)
### combination between letter and relative rows
examples:
`a+1r`: column a, 1 row down

### ranges
| plums | bananas | fruits          |
| ----- | ------- | --------------- |
| 5     | 12      | =sum(A1:B3)     |
| 7     | 5       | =sum(A1:B3) >20 |
| 9     | 7       |                 |
![ ](./doc/images/README-20250912-1515-799.webp)
### ranges with relative reference

| plums           | bananas       | fruits        |
| --------------- | ------------- | ------------- |
| 5               | 12            | =sum(1c1:2c3) |
| 7               | 5             | =sum(A1r:B3r) |
| 9               | 7             |               |
| =sum(A1:+0c-1r) | =sum(B1:B-1r) |               |
![ ](./doc/images/README-20250912-1516-737.webp)
### vector sum
`ranges in [ ... ]`
formula is only in one cell, but fills values outside of it's cell
values that don't fit in the existing table are disgarded

| plums | bananas | fruits           |
| ----- | ------- | ---------------- |
| 5     | 12      | =[A1:A3]+[B1:B3] |
| 7     | 5       |                  |
| 19    | 10      |                  |
![ ](./doc/images/README-20250912-1516-235.webp)
### matrix operations
#### transpose
| m1  |     |     |     |                     |     |     |
| --- | --- | --- | --- | ------------------- | --- | --- |
| 1   | 2   | 3   |     | =transpose([A1:C3]) |     |     |
| 4   | 5   | 6   |     |                     |     |     |
| 7   | 8   | 9   |     |                     |     |     |

![ ](./doc/images/README-20250912-1517-497.webp)
#### diagonal

| m1  |     |     |     |                |     |     |
| --- | --- | --- | --- | -------------- | --- | --- |
| 1   | 2   | 3   |     | =diag([A1:C3]) |     |     |
| 4   | 5   | 6   |     |                |     |     |
| 7   | 8   | 9   |     |                |     |     |
![ ](./doc/images/README-20250912-1517-329.webp)
#### matrix vector multiplication
| m1  |     |     |     | r1                |     | r2              |     |
| --- | --- | --- | --- | ----------------- | --- | --------------- | --- |
| 1   | 2   | 3   |     | =[A1:C3]\*[1,1,1] |     | =sum(A+0r:C+0r) |     |
| 4   | 5   | 6   |     |                   |     | =sum(A+0r:C+0r) |     |
| 7   | 8   | 9   |     |                   |     | =sum(A+0r:C+0r) |     |
![ ](./doc/images/README-20250912-1517-237.webp)
#### determinant
`=det([A1:C3])`

| m1  |     |     |     |               |     |
| --- | --- | --- | --- | ------------- | --- |
| 1   | 2   | 3   |     | =det([A1:C3]) |     |
| 4   | 5   | 7   |     |               |     |
| 7   | 8   | 9   |     |               |     |
![ ](./doc/images/README-20250912-1517-34.webp)
### conditionals

| m1  |     |     |     | r1                      |     |     |     |
| --- | --- | --- | --- | ----------------------- | --- | --- | --- |
| 1   | 2   | 3   |     | =([A1:C3]>=5).\*[A1:C3] |     |     |     |
| 4   | 5   | 6   |     |                         |     |     |     |
| 7   | 8   | 9   |     |                         |     |     |     |

![ ](./doc/images/README-20250912-1518-327.webp)
#### generate numbers and map them

| decimal                   | hex             | bin             | sin             | isprime             |
| ------------------------- | --------------- | --------------- | --------------- | ------------------- |
| =transpose(range(1,20,2)) | =map([A:A],hex) | =map([A:A],bin) | =map([A:A],sin) | =map([A:A],isPrime) |
|                           |                 |                 |                 |                     |
|                           |                 |                 |                 |                     |
|                           |                 |                 |                 |                     |
|                           |                 |                 |                 |                     |
|                           |                 |                 |                 |                     |
|                           |                 |                 |                 |                     |
|                           |                 |                 |                 |                     |
|                           |                 |                 |                 |                     |
|                           |                 |                 |                 |                     |
![ ](./doc/images/README-20250912-1518-573.webp)
### test if it's numeric
| label | number?           | total     |     |
| ----- | ----------------- | --------- | --- |
| 3     | =isNumeric([A:A]) | =sum(B:B) |     |
| not   |                   |           |     |
| 2     |                   |           |     |
| pen   |                   |           |     |
| apple |                   |           |     |
| =pi   |                   |           |     |

![ ](./doc/images/README-20250912-1518-848.webp)

### change units
| inch    | cm                  |     |
| ------- | ------------------- | --- |
| 12 inch | =to(unit(A1), "cm") |     |
| 5 inch  | =to(unit(A2), "cm") |     |

![ ](./doc/images/README-20250912-1519-906.webp)

### more complex units

| distance | time     | speed         |
| -------- | -------- | ------------- |
| 5 m      | 10 s     | =[A:A]./[B:B] |
| 5 inch   | 10 mins  |               |
| 100 km   | 7 day    |               |
| = 500km  | 0.5 year |               |
|          |          |               |

![ ](./doc/images/README-20250912-1519-976.webp)


| initial speed | final spped | time | acc                   |
| ------------- | ----------- | ---- | --------------------- |
| 10 km/h       | 100 km/h    | 10 s | =([B:B]-[A:A])./[C:C] |
| 20 m/s        | 10 m/s      | 5 s  |                       |

![ ](./doc/images/README-20250912-1519-155.webp)



|                     |                      |
| ------------------- | -------------------- |
| gravitationConstant | =gravitationConstant |
| planckConstant      | =planckConstant      |
![ ](./doc/images/README-20250912-1519-573.webp)

### more complicated dependencies with errors

|                  3                  | 0   | 0   | 0   | e                   | f   |             |
|:-----------------------------------:| --- | --- | --- | ------------------- | --- | ----------- |
|                  1                  | 3   | 4   | 8   | 8                   | 1   |             |
|                  2                  | 5   | 8   | 3   | 8                   | 1   |             |
|                  1                  | 4   | 8   | 3   | 1                   | 1   |             |
|             =sum(F6:G8)             | 3   | 1   |     |                     |     |             |
|                                     |     |     |     |                     |     |             |
|    =diag([A1:C3])\*diag([A1:C3])    |     |     |     | =transpose([A2:C4]) |     |             |
| =dotMultiply(diag([A1:C3]),[A1:A3]) |     |     | 3   |                     |     |             |
|                                     |     |     |     |                     |     |             |
|                                     |     |     |     |                     |     |             |
|    =dotMultiply([A1:C3],[D1:F3])    |     |     |     |                     |     | =sum(D6:F8) |
|                                     |     |     |     | =sum(A:F)           |     |             |
|                                     |     |     |     |                     |     |             |
|                                     |     |     |     |                     |     |             |

![ ](./doc/images/README-20250912-1519-473.webp)

## Configuration and Setup

### Class-based Processing
To not process all notes, you can enable in settings process only pages with a specific `cssclass`.
For that, rightclick on the tab, and select `add file property`, select `cssclasses` and add `calccraft` or the customized value you set in settings.
This allows selective processing - only notes with the specified `cssclasses` will have their tables processed.
### Plugin Settings
- **Decimal precision**: Control number of decimal places (-1 for default)
- **Show labels**: Display row numbers and column letters
- **Parent/children highlighting**: Colors for dependency visualization
- **Error cell styling**: Visual feedback for formula errors
- **Theme support**: Separate color schemes for light and dark themes
- **Class filtering**: Enable/disable selective processing by cssclass

### Visual Customization
- **Computed cells**: Look like normal cells; hover a cell to see its formula
- **Error cells**: Clear visual indication of calculation errors
- **Hover effects**: Dynamic highlighting of cell dependencies
- **Row/column labels**: Optional display of spreadsheet-style coordinates

## Advanced Features

### Edit Mode Support
CalcCraft now provides full edit mode support:
- Formulas remain visible while editing
- Computed values appear as overlays
### Live Preview Integration
- Integration with Obsidian's Live Preview
- Dynamic formula evaluation as you type
- Proper event handling for smooth performance
- Debounced updates to prevent excessive computation
### Performance Optimizations
- Smart caching to avoid unnecessary recalculations
- Edit-aware processing that respects active editing sessions
- Efficient dependency tracking for large tables
- Optimized matrix operations for better performance

### Error Recovery
- Handling of malformed formulas
- Visual indicators for problematic cells
- Prevention of infinite loops in complex dependencies

## Tips and Best Practices

1. **Use relative references** for formulas you want to copy across rows/columns
2. **Hover over cells** to understand dependencies and data flow
3. **Use `[A1:C3]` for matrix operations**, `A1:C3` for simple ranges
4. **Include units in your data** - the plugin handles conversions automatically
5. **Check the browser console** (F12) for detailed debugging information
6. **Use cssclass filtering** if you only need calccraft on specific pages
7. **Test complex formulas incrementally** to identify issues early