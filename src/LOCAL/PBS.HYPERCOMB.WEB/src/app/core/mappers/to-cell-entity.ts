import { Cell, NewCell } from "src/app/cells/cell"
import { CellEntity } from "src/app/database/model/i-tile-entity"
import { CellOptions } from "../models/enumerations"
import { safeDate } from "./to-cell"

export function toCellEntity(cell: Cell | NewCell): CellEntity {
  const result =  {
    kind: cell.kind,
    cellId: (cell as Cell).cellId,
    hive: cell.hive,
    name: cell.name ?? "",
    options: cell.options(),
    dateCreated: safeDate(cell.dateCreated) || '',
    updatedAt: safeDate(cell.updatedAt) || '',
    borderColor: cell.borderColor ?? "",
    backgroundColor: cell.backgroundColor ?? "",
    link: cell.link ?? "",
    index: cell.index ?? 0,
    scale: cell.scale ?? 1,
    x: cell.x ?? 0,
    y: cell.y ?? 0,
    sourceId: cell.sourceId,
    sourcePath: cell.sourcePath ?? "",
    uniqueId: cell.uniqueId,
    etag: cell.etag,

    // 🔎 derived flags — keep in sync with CellOptions
    isActive: (cell.options() & CellOptions.Active) !== 0,
    isBranch: (cell.options() & CellOptions.Branch) !== 0,
    isDeleted: (cell.options() & CellOptions.Deleted) !== 0,
    isHidden: (cell.options() & CellOptions.Hidden) !== 0,
    ignoreBackground: (cell.options() & CellOptions.IgnoreBackground) !== 0,
    isLocked: (cell.options() & CellOptions.Locked) !== 0,
    hasNoImage: (cell.options() & CellOptions.NoImage) !== 0,
    smallImageId: cell.smallImageId ?? 0,
    largeImageId: cell.largeImageId,
    dateDeleted: safeDate(cell.dateDeleted) || undefined,
  }
  return result
}
