import { Injectable, signal, computed, inject } from "@angular/core"
import { Point } from "pixi.js"
import { Hypercomb } from "src/app/core/mixins/abstraction/hypercomb.base"
import { StateDebugRegistry } from "src/app/unsorted/utility/debug-registry"
import { Cell, Ghost } from "../cell"
import { Tile } from "../models/tile"
import { isSelected } from "../models/cell-filters"
import { ICombStore, IStaging } from "src/app/shared/tokens/i-comb-store.token"
import { SearchFilterService } from "src/app/common/header/header-bar/search-filter-service"

/**
 * CombStore
 * simplified for single-hive databases
 * manages one hive’s cells, tiles, and runtime staging
 */
@Injectable() // provided in CombModule
export class CombStore extends Hypercomb implements ICombStore, IStaging {
  // registries
  private readonly search = inject(SearchFilterService)

  private readonly visibility = new Map<number, boolean>()
  private readonly tileRegistry = new Map<number, Tile>()
  private readonly dataRegistry = new Map<number, Cell>()

  // hot/cold queues for scheduler
  private readonly hot = signal<Cell[]>([])
  private readonly cold = signal<Cell[]>([])

  public readonly filteredCells = computed(() => {
    const q = this.search.delayValue().toLowerCase()
    if (!q) return this.cells()

    return this.cells().filter(c =>
      (c.name ?? '').toLowerCase().includes(q)
    )
  })


  // bump every time tiles are flushed/staged/reset
  private readonly _flushSeq = signal(0)
  public readonly flushSeq = this._flushSeq.asReadonly()

  public readonly recalculationSeq = signal(0)

  // active hive data (no per-hive map anymore)
  private readonly _cells = signal<Cell[]>([])
  private readonly _tiles = signal<Tile[]>([])
  public readonly cells = this._cells.asReadonly()
  public readonly tiles = this._tiles.asReadonly()

  // reactive selectors
  public readonly selectedCells = computed(() => this._cells().filter(isSelected))
  public readonly size = computed(() => this._cells().length)
  public readonly hasCells = computed(() => this._cells().length > 0)

  constructor() {
    super()
    // expose for debugging
    StateDebugRegistry.expose("surfaceCells", this.cells)
  }

  public cellsForComb(parentCellId: number): Cell[] {
    return this._cells().filter(c => c.sourceId === parentCellId)
  }

  // -----------------------------------------------------------
  // flush queues for scheduler
  // -----------------------------------------------------------
  public flush = (): { hot: Cell[]; cold: Cell[] } => {
    const hotTiles = [...this.hot()]
    const coldTiles = [...this.cold()]
    this.hot.set([])
    this.cold.set([])

    // keep cold until RenderScheduler confirms culling
    return { hot: hotTiles, cold: coldTiles }
  }

  // -----------------------------------------------------------
  // invalidate: mark current as cold
  // -----------------------------------------------------------
  public invalidate(): void {
    const current = Array.from(this.dataRegistry.values())
    if (current.length > 0) {
      this.cold.update(list => [...list, ...current])
    }
    this.dataRegistry.clear()
    this.tileRegistry.clear()
  }

  // -----------------------------------------------------------
  // single-tile invalidation
  // -----------------------------------------------------------
  public invalidateTile(cellId: number): void {
    const tile = this.tileRegistry.get(cellId)
    const cell = this.dataRegistry.get(cellId)

    if (!cell) return // nothing to invalidate

    // mark the tile dirty if it exists
    if (tile && typeof tile.invalidate === 'function') {
      tile.invalidate()
    }


    
    // enqueue the corresponding cell to cold queue for redraw
    this.cold.update(list => {
      // prevent duplicates
      if (list.some(c => c.cellId === cellId)) return list
      return [...list, cell]
    })

    this.bumpFlushSeq()
  }

  public isVisible(cellId: number): boolean {
    return this.visibility.get(cellId) !== false
  }

  
  public setVisibility = (cells: Cell[] | Cell, visible: boolean): void => {
    const list = Array.isArray(cells) ? cells : [cells]

    for (const c of list) {
      if (!c?.cellId) continue

      // pixi tile visibility
      const tile = this.lookupTile(c.cellId)
      if (tile) tile.visible = visible
    }
  }



  // -----------------------------------------------------------
  // registry
  // -----------------------------------------------------------
  public register = (tile: Tile, cell: Cell) => {
    if (cell.cellId == null) throw new Error("cannot register tile without a cellId")
    if (tile.cellId !== cell.cellId) throw new Error(`TileId mismatch: ${tile.cellId} vs ${cell.cellId}`)

    this.tileRegistry.set(tile.cellId, tile)
    this.dataRegistry.set(cell.cellId, cell)
    this.refreshSurface()
  }

  public unregister = (cellId: number) => {
    this.tileRegistry.delete(cellId)
    this.dataRegistry.delete(cellId)
    this.refreshSurface()
    this.bumpFlushSeq()
  }

  public clearAll(): void {
    this.tileRegistry.clear()
    this.dataRegistry.clear()
    this._cells.set([])
    this._tiles.set([])
    this.bumpFlushSeq()
  }

  private refreshSurface(): void {
    this._cells.set(Array.from(this.dataRegistry.values()))
    this._tiles.set(Array.from(this.tileRegistry.values()))
  }

  // -----------------------------------------------------------
  // lookups
  // -----------------------------------------------------------
  public lookupTile = (cellId: number): Tile | undefined =>
    this.tileRegistry.get(cellId)

  public lookupCellByIndex = (index: number): Cell | undefined => {
    const cell = Array.from(this.dataRegistry.values()).find(t => t.index === index)
    return cell
  }
  public lookupTileByIndex = (index: number): Tile | undefined => {
    const cell = Array.from(this.dataRegistry.values()).find(t => t.index === index)
    return cell ? this.tileRegistry.get(cell.cellId) : undefined
  }

  public lookupData = (cellId: number): Cell | undefined =>
    this.dataRegistry.get(cellId)

  public hasTile = (cellId: number): boolean =>
    this.tileRegistry.has(cellId)

  // -----------------------------------------------------------
  // staging (single hive only)
  // -----------------------------------------------------------
  private bumpFlushSeq(): void {
    this._flushSeq.update(v => v + 1)
  }


  public stageCells(cells: Cell[]): void {
    this._cells.set(cells)
    this.bumpFlushSeq()
  }

  public stageAdd(cell: Cell): void {
    this._cells.update(arr => [...arr, cell])
    this.bumpFlushSeq()
  }

  public stageRemove(cellId: number): void {
    this._cells.update(arr => arr.filter(c => c.cellId !== cellId))
    this.bumpFlushSeq()
  }

  public stageReplace(cell: Cell): void {

    const tile = this.lookupTile(cell.cellId)
    if (tile) {
      tile.invalidate()
    }

    this._cells.update(arr => {
      const idx = arr.findIndex(t => t.cellId === cell.cellId)
      const updated = [...arr]
      if (idx !== -1) updated[idx] = cell
      else updated.push(cell)
      return updated
    })

    this.enqueueHot(cell)
    this.bumpFlushSeq()
  }

  public stageMerge(cells: Cell[]): void {
    if (!cells?.length) return
    this._cells.update(existing => {
      const incomingMap = new Map(cells.map(c => [c.cellId, c]))
      const merged = existing.map(c => incomingMap.get(c.cellId) ?? c)
      for (const cell of cells) {
        if (!existing.some(c => c.cellId === cell.cellId)) merged.push(cell)
      }
      return merged
    })
    this.bumpFlushSeq()
  }

  // -----------------------------------------------------------
  // enqueue for runtime
  // -----------------------------------------------------------
  public enqueueHot = (cells: Cell | Ghost | Cell[] | Ghost[]): void => {
    const items = Array.isArray(cells) ? cells : [cells]
    this.hot.update(h => [...h, ...items])
  }

  public enqueueCold = (cells: Cell | Cell[]): void => {
    const items = Array.isArray(cells) ? cells : [cells]
    this.cold.update(c => [...c, ...items])
  }

  // -----------------------------------------------------------
  // position/index update
  // -----------------------------------------------------------
  public updatePositionAndIndex(cellId: number, pos: Point, index?: number): void {
    const td = this.lookupData(cellId)
    if (!td) throw new Error(`tile not found in store: ${cellId}`)

    const tiles = [...this._cells()]
    const i = tiles.findIndex(t => t.cellId === cellId)
    if (i === -1) throw new Error(`tile not found in cell list: ${cellId}`)

    Object.assign(td, { x: pos.x, y: pos.y })
    if (index != null) td.index = index

    tiles[i] = td
    if (index != null) {
      tiles.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    }
    this._cells.set(tiles)
  }
}
