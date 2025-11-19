// file: src/app/models/tile-flags.ts

// NOTE: imports intentionally minimal; let your IDE add/fix as needed.
import type { Sprite } from "pixi.js"
import { Cell, EditCell, Hive, NewCell } from "src/app/cells/cell"
import { CellOptions } from "src/app/cells/models/cell-options" // enum of flags
import { CellEntity } from "src/app/database/model/i-tile-entity"

// -----------------------------------------------------------
// internal: resolve bitmask from modern 'options' or legacy 'flag'
// -----------------------------------------------------------
const maskOf = (
    cell: Cell): number => (cell as any).options() ?? (cell as any).options() ?? 0

// -----------------------------------------------------------
// blob helpers
// -----------------------------------------------------------
export function blobUrlForSprite(blob: Blob, sprite: Sprite): string | null {
    if (!blob) return null

    const url = URL.createObjectURL(blob)

    const originalDestroy = sprite.destroy.bind(sprite)
    sprite.destroy = (...args: any[]) => {
        try { URL.revokeObjectURL(url) } catch { /* ignore revoke errors */ }
        originalDestroy(...args)
    }

    return url
}

// -----------------------------------------------------------
// id / key helpers
// -----------------------------------------------------------
export function cacheId(cell: Cell): string {
    return `texture-${cell.cellId}`
}

export function combId(cell: Cell): string
export function combId(cell: CellEntity): string
export function combId(cell: Cell | CellEntity): string {
    if ("hive" in cell && "cellId" in cell) {
        if ((cell as Cell).cellId == null) throw new Error("cellId missing")
        return `${(cell as Cell).hive}-${(cell as Cell).cellId}`
    }
    if ("Hive" in cell && "cellId" in cell) {
        if ((cell as CellEntity).cellId == null) throw new Error("TileId missing")
        return `${(cell as CellEntity).hive}-${(cell as CellEntity).cellId}`
    }
    throw new Error("Invalid cell type for combId")
}

export function sourceKey(cell: Cell): string {
    return `${cell.hive}-${cell.sourceId}`
}

export function noImage(cell: Cell): boolean {
    return !cell.image
}

// -----------------------------------------------------------
// flag helpers (uses maskOf for options/flag compatibility)
// -----------------------------------------------------------
export function isHive(cell: Cell): boolean {
    return cell.kind === "Hive"
}

export function isPathway(cell: Cell): boolean {
    return cell.kind === "Path"
}

export function isSelected(cell: Cell): boolean {
    return (maskOf(cell) & CellOptions.Selected) !== 0
}

export function isInitialTile(cell: Cell): boolean {
    return (maskOf(cell) & CellOptions.InitialTile) !== 0
}

export function isNew(domain: Cell | Hive | NewCell): boolean {
    return !!domain.cellId
}

export function isNewHive(domain: Cell | Hive | NewCell): domain is Hive | NewCell {
    return isNew(domain) && isHive(domain as Cell)
}

// -----------------------------------------------------------
// type helpers
// -----------------------------------------------------------
export function isClipboard(cell: Cell): boolean {
    return cell.kind === "Clipboard"
}

export function isHiveTile(cell: Cell): boolean {
    return isHive(cell)
}

export function isPathwayTile(cell: Cell): boolean {
    return isPathway(cell)
}

// -----------------------------------------------------------
// grouped export for convenience
// -----------------------------------------------------------
export const tileFilters = {
    blobUrlForSprite,
    cacheId,
    combId,
    sourceKey,
    noImage,
    isHive,
    isPathway,
    isSelected,
    isInitialTile,
    isNew,
    isNewHive,
    isClipboard,
    isHiveTile,
    isPathwayTile,
}
