import { inject, Injectable } from "@angular/core"
import { Cell } from "../cells/cell"
import { CELL_CREATOR } from "../inversion-of-control/tokens/tile-factory.token"
import { CELL_REPOSITORY } from "../shared/tokens/i-cell-repository.token"
import { toCellEntity } from "../core/mappers/to-cell-entity"
import { toCell } from "../core/mappers/to-cell"
import { DatabaseService } from "../database/database-service"

@Injectable({ providedIn: "root" })
export class CopyService {
  private readonly creator = inject(CELL_CREATOR)
  private readonly repository = inject(CELL_REPOSITORY)
  private readonly database = inject(DatabaseService)

  /**
   * Copy one or more cells + full child hierarchy.
   * Entire operation runs inside ONE Dexie transaction.
   */
  public async copy(cells: Cell[]): Promise<Cell[]> {
    const db = this.database.db()
    if (!db) throw new Error("repository has no db")

    const results: Cell[] = []

    for (const source of cells) {

      const rootClone = this.creator.newCell({
        ...source,
        cellId: undefined,
        sourceId: undefined
      })

      const cloneEntity =    toCellEntity(rootClone)
      const rootEntity = await this.repository.add(
        cloneEntity,
        rootClone.image!
      )

      const root = <Cell>toCell(rootEntity)

      await this.copyChildren(source, root)
      results.push(root)
    }

    return results
  }

  /**
   * Recursive copy of child hierarchy.
   * IMPORTANT: must be called *inside* the parent's transaction.
   */
  private async copyChildren(source: Cell, parent: Cell): Promise<void> {
    const children = await this.repository.fetchBySourceId(source.cellId!) || []

    for (const childEntity of children) {
      const child = <Cell>toCell(childEntity)

      const clone = this.creator.newCell({
        ...child,
        cellId: undefined,
        sourceId: parent.cellId
      })

      const entity = await this.repository.add(
        toCellEntity(clone),
        clone.image!
      )

      const newChild = <Cell>toCell(entity)
      await this.copyChildren(child, newChild)
    }
  }
}
