// src/app/clipboard/copy-service.ts

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
   * Clone one or more cells including full recursive hierarchy.
   * Returns newly created top-level clones.
   */
  public async copy(cells: Cell[]): Promise<Cell[]> {
    const db = this.database.db()
    if (!db) throw new Error("repository has no db")

    const results: Cell[] = []

    for (const source of cells) {
      // 1. Create root clone
      const rootClone = this.creator.newCell({
        ...source,
        cellId: undefined,
        sourceId: undefined,
        uniqueId: crypto.randomUUID(),   // important: new uniqueId
        // SIH: imageHash is preserved
      })


      // save so we have a new cellId for children to reference
      const rootEntity = await this.repository.add(
        toCellEntity(rootClone)
      )

      const root = <Cell>toCell(rootEntity)

      // 2. Recursively clone children
      await this.copyChildren(source, root)

      results.push(root)
    }

    return results
  }

  /**
   * Clone all children of source under parentClone.
   */
  private async copyChildren(source: Cell, parent: Cell): Promise<void> {
    const children = await this.repository.fetchBySourceId(source.cellId!) || []

    for (const childEntity of children) {
      const child = <Cell>toCell(childEntity)

      const clone = this.creator.newCell({
        ...child,
        cellId: undefined,
        sourceId: parent.cellId,
        uniqueId: crypto.randomUUID(),
        // keep same imageHash (SIH)
      })

      const newEntity = await this.repository.add(
        toCellEntity(clone)
      )

      const newChild = <Cell>toCell(newEntity)

      // recurse
      await this.copyChildren(child, newChild)
    }
  }
}
