# TODO: gaps between CalcCraft (fork) and an Excel-like table

Behaviour described as of `2.3.7-fork.2`. Difficulty is a rough guess.

## Reported annoyances

- [x] 1. **Hover underline.** Hovering a cell underlines it (CalcCraft's `td.cell-active` style, not Obsidian's). *Easy.*
- [ ] 2. **Cell width jumps.** While editing, a cell widens to fit the formula, then shrinks to the result after it is computed. Excel keeps column widths fixed. Options: never shrink below the width the formula needed, or don't widen while typing (let the formula scroll inside the cell). *Medium.*
- [ ] 3. **`=` then click a cell to insert its reference.** Clicking another cell while editing just moves editing there. While editing a formula, a click should insert the clicked cell's reference (shift-click or drag for a range). Depends on Obsidian's undocumented table editor. *Medium.*

## Silently wrong numbers

- [ ] 4. **Inserting, deleting or moving rows/columns doesn't update references.** Add a row above and `=C1*D1` points at different cells without any error. Excel rewrites references. *Hard.*
- [x] 5. **`50%` is read as 50**, so `=A1*2` gives `100` instead of `1`. *Easy.*
- [x] 6. **Dates are read as their year**: `2026-09-25` becomes `2026`, so `=A1+1` gives `2027`. *Easy to make an error; medium to support dates.* Now text, so arithmetic on a date is an error; actual date support is still open.
- [x] 7. **Array results overwrite typed cells without warning.** `=[1;2;3]` writes over the cells below even if they contain values. Excel shows `#SPILL!`. *Easy.*
- [x] 8. **A sign after a reference glues into a relative reference**: `=A1-1c+0r` gives `102` (10 followed by 2) instead of 8. *Easy.*
- [x] 9. **Ratios like `2.5:1` are read as `2.5`** (and `1:1` as `1`). *Easy.*

## Excel formula compatibility

- [ ] 10. **Function names are lowercase math.js names.** `SUM`, `IF`, `AVERAGE` are "undefined function"; `sum` and `mean` work, and conditions need `A1>1 ? 2 : 3`. Accept any case and map Excel names to math.js. *Easy.*
- [ ] 11. **Missing Excel functions.** `COUNT` over a range errors; no `COUNTIF`/`SUMIF`, `VLOOKUP`/`XLOOKUP`, `ROUND` on units, text functions. *Medium, one at a time.*
- [ ] 12. **Errors aren't Excel-style.** `=1/0` shows `Infinity` instead of `#DIV/0!`; messages like "cell out of table" or "Undefined symbol" instead of `#REF!` / `#NAME?`. *Easy.*
- [ ] 13. **No `$A$1` absolute references, and no fill down / fill right.** Copying a formula doesn't shift its references. *Medium.*
- [ ] 14. **Only columns A–Z.** `AA1` is an error. *Easy-medium.*
- [ ] 15. **No references to other tables or notes.** *Medium-hard.*

## Look and editing

- [ ] 16. **No formula bar.** A formula is only visible while editing it, or in the hover tooltip. *Medium.*
- [ ] 17. **Numbers are left-aligned**; Excel right-aligns them. *Easy (CSS), maybe as a setting.*
- [ ] 18. **No help while typing a formula**: no function-name autocomplete, and referenced cells aren't highlighted until you hover. *Medium.*
- [ ] 19. **Arrow keys move the text cursor inside a cell**, not between cells, and there's no F2-style edit mode (Obsidian's table editor). *Medium-hard.*
- [ ] 20. **No per-cell number formats** (currency, percent, fixed decimals for one column). `$12.50` errors. *Medium.*
