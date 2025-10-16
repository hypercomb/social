import { Cell, NewCell } from "src/app/cells/cell"
import { CellOptions } from "src/app/cells/models/cell-options"
import { CellEntity } from "src/app/database/model/i-tile-entity"

export function safeDate(val: any): string | undefined {
  if (!val) return undefined
  const d = new Date(val)
  return isNaN(d.getTime()) ? undefined : d.toISOString()
}

export function toCell(entity: CellEntity): Cell | NewCell {
  const base = {
    hive: entity.hive,
    name: entity.name ?? "",
    link: entity.link ?? "",
    sourceId: entity.sourceId,
    uniqueId: entity.uniqueId,
    index: entity.index ?? -1,
    smallImageId: entity.smallImageId ?? 0,
    largeImageId: entity.largeImageId,
    dateCreated: safeDate(entity.dateCreated),
    dateDeleted: safeDate(entity.dateDeleted),
    updatedAt: safeDate(entity.updatedAt),
    backgroundColor: entity.backgroundColor,
    borderColor: entity.borderColor,
    scale: entity.scale ?? 1,
    x: entity.x ?? 0,
    y: entity.y ?? 0,
    sourcePath: entity.sourcePath,
    blob: entity.blob,
    etag: entity.etag,
  }

  // ─────────────────────────────
  // case 1: new cell (not persisted)
  // ─────────────────────────────
  if (entity.cellId == null) {
    console.warn(`[toCell] entity missing cellId → returning NewCell`)
    const cell = new NewCell(base)
    cell.setKind(entity.kind ?? "Cell")
    return cell
  }

  // ─────────────────────────────
  // case 2: persisted cell
  // ─────────────────────────────
  const cell = new Cell({ ...base, cellId: entity.cellId })
  cell.setKind(entity.kind ?? "Cell")
  cell.options.update(o => entity.options! & ~CellOptions.Selected)
  return cell
}
