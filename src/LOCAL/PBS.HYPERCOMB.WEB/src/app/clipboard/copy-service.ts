// src/app/clipboard/copy-service.ts

import { inject, Injectable } from "@angular/core"
import { async } from "rxjs"
import { Cell } from "../models/cell"


@Injectable({ providedIn: "root" })
export class CopyService {
  // private readonly creator = inject(CELL_CREATOR)
  // private readonly repository = inject(CELL_REPOSITORY)

  /**
   * Clone one or more cells including full recursive hierarchy.
   * Returns newly created top-level clones.
   */
  public async copy(cells: Cell[]): Promise<Cell[]> {

  //   const results: Cell[] = []

  //   for (const source of cells) {
  //     // 1. Create root clone
  //     const rootClone = this.creator.newCell({
  //       ...source,
  //       gene: undefined,
  //       sourceId: undefined,
  //       uniqueId: crypto.randomUUID(),   // important: new uniqueId
  //       // SIH: imageHash is preserved
  //     })


  //     // save so we have a new gene for children to reference
  //     const rootEntity = await this.repository.add(
  //       toCellEntity(rootClone)
  //     )

  //     const root = <Cell>toCell(rootEntity)

  //     // 2. Recursively clone children
  //     await this.copyChildren(source, root)

  //     results.push(root)
  //   }

    //return results
    return []
  }

  /**
   * Clone all children of source under parentClone.
   */
  // private async copyChildren(source: Cell, parent: Cell): Promise<void> {
  //   // const children = await this.repository.fetchBySourceId(source.gene!) || []

  //   // for (const childEntity of children) {
  //   //   const child = <Cell>toCell(childEntity)

  //   //   const clone = this.creator.newCell({
  //   //     ...child,
  //   //     gene: undefined,
  //   //     sourceId: parent.gene,
  //   //     uniqueId: crypto.randomUUID(),
  //   //     // keep same imageHash (SIH)
  //   //   })

  //   //   const newEntity = await this.repository.add(
  //   //     toCellEntity(clone)
  //   //   )

  //   //   const newChild = <Cell>toCell(newEntity)

  //   //   // recurse
  //   //   await this.copyChildren(child, newChild)
  //   }
  }
}
