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

    // ✔ NEW canonical hashed image identity
    imageHash: entity.imageHash ?? undefined,

    dateCreated: safeDate(entity.dateCreated),
    dateDeleted: safeDate(entity.dateDeleted),
    updatedAt: safeDate(entity.updatedAt),

    backgroundColor: entity.backgroundColor,
    borderColor: entity.borderColor,
    scale: entity.scale ?? 1,
    x: entity.x ?? 0,
    y: entity.y ?? 0,

    sourcePath: entity.sourcePath,
    etag: entity.etag,
  }

  // ─────────────────────────────
  // A. New Cell (not persisted)
  // ─────────────────────────────
  if (entity.cellId == null) {
    console.warn(`[toCell] entity missing cellId → returning NewCell`)
    const cell = new NewCell(base)
    cell.setKind(entity.kind ?? "Cell")
    return cell
  }

  // ─────────────────────────────
  // B. Persisted Cell
  // ─────────────────────────────
  const cell = new Cell({ ...base, cellId: entity.cellId })
  cell.setKind(entity.kind ?? "Cell")

  // clear "Selected" flag on load
  cell.options.update(o => entity.options! & ~CellOptions.Selected)

  return cell
}
