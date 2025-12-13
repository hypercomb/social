// file: src/app/models/tile-flags.ts

// NOTE: imports intentionally minimal; let your IDE add/fix as needed.
import { CellOptions } from "src/app/cells/models/cell-options" // enum of flags
import { CellEntity } from "src/app/database/model/i-tile-entity"
import { Cell } from "src/app/models/cell"
import { HivePortal } from "src/app/models/hive-portal"
import { NewCell } from "src/app/models/new-cell"

// -----------------------------------------------------------
// internal: resolve bitmask from modern 'options' or legacy 'flag'
// -----------------------------------------------------------
const maskOf = (
    cell: Cell): number => (cell as any).options() ?? (cell as any).options() ?? 0

// -----------------------------------------------------------
// id / key helpers
// -----------------------------------------------------------
export function cacheId(cell: Cell): string {
    return `texture-${cell.cellId}`
}

export function isSelected(cell: Cell): boolean {
    return (maskOf(cell) & CellOptions.Selected) !== 0
}

export function isInitialTile(cell: Cell): boolean {
    return (maskOf(cell) & CellOptions.InitialTile) !== 0
}
// -----------------------------------------------------------
// type helpers
// -----------------------------------------------------------
export function isClipboard(cell: Cell): boolean {
    return cell.kind === "Clipboard"
}


// -----------------------------------------------------------
// grouped export for convenience
// -----------------------------------------------------------
export const tileFilters = {
    cacheId,
    isSelected,
    isInitialTile,
    isClipboard
}
