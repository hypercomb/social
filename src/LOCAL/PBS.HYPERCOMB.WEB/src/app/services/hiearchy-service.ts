import { inject, Injectable } from '@angular/core'
import { CELL_REPOSITORY } from '../shared/tokens/i-cell-repository.token'
import { Cell } from '../cells/cell'
import { toCell } from '../core/mappers/to-cell'
import { CellHierarchy } from '../models/cell-hierarchy-type'

@Injectable({ providedIn: 'root' })
export class HierarchyService {
  toStringHierarchy(tiles: never[]) {
    throw new Error('Method not implemented.')
  }
  private readonly repository = inject(CELL_REPOSITORY)

  /**
   * Build a hierarchy of ALL cells.
   * Returns an array of root nodes.
   */
  public async build(): Promise<CellHierarchy[]> {
    // step 1: fetch everything
    const allEntities = await this.repository.fetchAll()
    const allCells: Cell[] = allEntities.map(e => <Cell>toCell(e))

    // step 2: map id → hierarchy node
    const map = new Map<number, CellHierarchy>()

    for (const c of allCells) {
      map.set(c.cellId!, { cell: c, children: [] })
    }

    // step 3: build the tree
    const roots: CellHierarchy[] = []

    for (const node of map.values()) {
      const parentId = node.cell.sourceId
      if (parentId && map.has(parentId)) {
        // add to parent’s children
        map.get(parentId)!.children.push(node)
      } else {
        // this is a root
        roots.push(node)
      }
    }

    return roots
  }
}
