import { Cell, NewCell } from "src/app/cells/cell"
import { CellEntity } from "src/app/database/model/i-tile-entity"
import { CellOptions } from "../models/enumerations"
import { safeDate } from "./to-cell"

export function toCellEntity(cell: Cell | NewCell): CellEntity {

  return {
    // ───────────────────────────────────────
    // identity
    // ───────────────────────────────────────
    kind: cell.kind,
    cellId: (cell as Cell).cellId,
    hive: cell.hive,
    uniqueId: cell.uniqueId,

    // ───────────────────────────────────────
    // metadata
    // ───────────────────────────────────────
    name: cell.name ?? "",
    link: cell.link ?? "",
    etag: cell.etag,
    sourceId: cell.sourceId,
    sourcePath: cell.sourcePath ?? "",

    dateCreated: safeDate(cell.dateCreated) || "",
    updatedAt: safeDate(cell.updatedAt) || "",
    dateDeleted: safeDate(cell.dateDeleted) || undefined,

    // ───────────────────────────────────────
    // core fields
    // ───────────────────────────────────────
    index: cell.index ?? 0,
    scale: cell.scale ?? 1,
    x: cell.x ?? 0,
    y: cell.y ?? 0,
    backgroundColor: cell.backgroundColor ?? "",
    borderColor: cell.borderColor ?? "",

    // ───────────────────────────────────────
    // 🔥 canonical image identity
    // never store Dexie IDs anymore
    // ───────────────────────────────────────
    imageHash: cell.imageHash,       // string | undefined
    blob: 'blob' in cell ? (cell as any).blob : undefined, // optional fallback (first-load only)

    // ───────────────────────────────────────
    // options & derived flags
    // ───────────────────────────────────────
    options: cell.options(),

    isActive:   (cell.options() & CellOptions.Active) !== 0,
    isBranch:   (cell.options() & CellOptions.Branch) !== 0,
    isDeleted:  (cell.options() & CellOptions.Deleted) !== 0,
    isHidden:   (cell.options() & CellOptions.Hidden) !== 0,
    ignoreBackground: (cell.options() & CellOptions.IgnoreBackground) !== 0,
    isLocked:   (cell.options() & CellOptions.Locked) !== 0,
  }
}
