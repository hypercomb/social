import { inject, Injectable } from '@angular/core'
import { Assets } from 'pixi.js'
import { cacheId } from '../models/cell-filters'
import { HypercombData } from 'src/app/actions/hypercomb-data'
import { Cell } from '../cell'
import { HONEYCOMB_STORE, SELECTIONS } from 'src/app/shared/tokens/i-comb-store.token'
import { CELL_REPOSITORY } from 'src/app/shared/tokens/i-cell-repository.token'

@Injectable({ providedIn: 'root' })
export class CellManager extends HypercombData {
  private readonly repository = inject(CELL_REPOSITORY)
  private readonly selections = inject(SELECTIONS)
  private readonly store = inject(HONEYCOMB_STORE)

  constructor() {
    super()

    let prev = new Set<Cell>()

    // SOME MORE RESEARCH NEEDED HERE
    // we want to react to changes in the selection state
    // and refresh the visual representation of newly selected tiles
    // effect(() => {
    //   const curr = new Set(this.ss.items())
    //   untracked(() => {        
    //     for (const tile of curr) {
    //        if (!prev.has(tile)) void this.helper.refreshTile(tile)
    //     }
    //     prev = curr
    //   })
    // })  
  }

  public remove = async (cell: Cell) => {
    if (!cell?.uniqueId) return

    try {
      // // refresh cache for new visual
      // const id = cacheId(cell)
      // if (id) {
      //   Assets.cache.remove(id)
      // }

      // const hive = cell.hive
      // const tiles = await this.repository.fetchByHive(hive)

      // // find all instances of this tile in the container
      // const tilesToRemove = tiles.map(t => this.store.lookupTile(t.cellId))

      // // remove each instance
      // for (const tile of tilesToRemove) {
      //   if (tile?.parent) {
      //     tile.parent.removeChild(tile)
      //   }
      // }

    } catch (error) {
      console.error('Error removing tile:', error)
    }
  }
}


