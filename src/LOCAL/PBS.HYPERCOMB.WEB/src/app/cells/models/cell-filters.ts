// file: src/app/models/tile-flags.ts

// NOTE: imports intentionally minimal; let your IDE add/fix as needed.
import { CellOptions } from "src/app/cells/models/cell-options"; // enum of flags
import { Cell } from "src/app/models/cell"

// -----------------------------------------------------------
// internal: resolve bitmask from modern 'options' or legacy 'flag'
// -----------------------------------------------------------
const maskOf = (
    cell: Cell): number => (cell as any).options() ?? (cell as any).options() ?? 0

// -----------------------------------------------------------
// id / key helpers
// -----------------------------------------------------------
export function cacheId(cell: Cell): string {
    return `texture-${cell.gene}`
}

export function isSelected(cell: Cell): boolean {
    return (maskOf(cell) & CellOptions.Selected) !== 0
}

// -----------------------------------------------------------
// grouped export for convenience
// -----------------------------------------------------------
export const tileFilters = {
    cacheId,
    isSelected
}
