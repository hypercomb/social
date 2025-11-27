// src/app/cells/storage/honeycomb-store.ts
import { Injectable, signal, computed, inject } from "@angular/core"
import { Container, Point } from "pixi.js"
import { Hypercomb } from "src/app/core/mixins/abstraction/hypercomb.base"
import { Cell } from "../cell"
import { Tile } from "../models/tile"
import { isSelected } from "../models/cell-filters"
import { IHoneycombStore, IStaging } from "src/app/shared/tokens/i-comb-store.token"
import { SearchFilterService } from "src/app/common/header/header-bar/search-filter-service"
import { DebugService } from "src/app/core/diagnostics/debug-service"

@Injectable()
export class HoneycombStore extends Hypercomb implements IHoneycombStore, IStaging {

  private readonly search = inject(SearchFilterService)

  // runtime registries
  private readonly tileRegistry = new Map<number, Tile>()
  private readonly dataRegistry = new Map<number, Cell>()

  // HOT queue
  private readonly hot = signal<Cell[]>([])

  // reactive lists
  private readonly _cells = signal<Cell[]>([])
  private readonly _tiles = signal<Tile[]>([])

  public readonly cells = this._cells.asReadonly()
  public readonly tiles = this._tiles.asReadonly()

  public readonly selectedCells = computed(() =>
    this._cells().filter(isSelected)
  )

  public readonly size = computed(() => this._cells().length)

  public readonly filteredCells = computed(() => {
    const q = this.search.delayValue().toLowerCase()
    if (!q) return this.cells()
    return this.cells().filter(c => (c.name ?? '').toLowerCase().includes(q))
  })

  private readonly _flushSeq = signal(0)
  public readonly flushSeq = this._flushSeq.asReadonly()

  constructor() {
    super()
    DebugService.expose("surfaceCells", this.cells)
  }

  private bump(): void {
    this._flushSeq.update(v => v + 1)
  }

  // ---------------------------------------------------------
  // FLUSH — HOT ONLY
  // ---------------------------------------------------------
  public flush(): { hot: Cell[] } {
    const out = [...this.hot()]
    this.hot.set([])
    return { hot: out }
  }

  // ---------------------------------------------------------
  // REGISTER / UNREGISTER
  // ---------------------------------------------------------
  public register(tile: Tile, cell: Cell): void {
    const id = cell.cellId
    if (!id) throw new Error("Cannot register tile without cellId")

    const existing = this.tileRegistry.get(id)
    if (existing && existing !== tile) {
      // remove old tile from stage and destroy it
      existing.parent?.removeChild(existing as unknown as Container)
      existing.destroy({ children: true })
    }

    this.tileRegistry.set(id, tile)
    this.dataRegistry.set(id, cell)

    this.refreshSurface()
  }


  public unregister(cellId: number): void {
    const tile = this.tileRegistry.get(cellId)
    if (tile) {
      tile.parent?.removeChild(tile as unknown as Container)
      tile.destroy({ children: true })
      this.tileRegistry.delete(cellId)
    }

    this.dataRegistry.delete(cellId)
    this.refreshSurface()
    this.bump()
  }

  // ---------------------------------------------------------
  // LOOKUP
  // ---------------------------------------------------------
  public lookupTile(cellId: number): Tile | undefined {
    return this.tileRegistry.get(cellId)
  }

  public lookupData(cellId: number): Cell | undefined {
    return this.dataRegistry.get(cellId)
  }

  // ---------------------------------------------------------
  // STAGING
  // ---------------------------------------------------------
  public stageCells(cells: Cell[]): void {
    this.dataRegistry.clear()
    for (const c of cells) this.dataRegistry.set(c.cellId!, c)
    this.refreshSurface()
    this.bump()
  }

  public stageAdd(cell: Cell): void {
    this.dataRegistry.set(cell.cellId!, cell)
    this.refreshSurface()
    this.bump()
  }

  public stageRemove(cellId: number): void {
    this.dataRegistry.delete(cellId)
    this.refreshSurface()
    this.bump()
  }

  public stageReplace(cell: Cell): void {
    this.dataRegistry.set(cell.cellId!, cell)
    this.refreshSurface()
    this.enqueueHot(cell)
    this.bump()
  }

  public stageMerge(cells: Cell[]): void {
    for (const c of cells) this.dataRegistry.set(c.cellId!, c)
    this.refreshSurface()
    this.bump()
  }

  // ---------------------------------------------------------
  // HOT QUEUE
  // ---------------------------------------------------------
  public enqueueHot(cells: Cell | Cell[]): void {
    const arr = Array.isArray(cells) ? cells : [cells]
    this.hot.update(v => [...v, ...arr])
  }

  // ---------------------------------------------------------
  // POSITION
  // ---------------------------------------------------------
  public updatePositionAndIndex(cellId: number, pos: Point, index?: number): void {
    const cell = this.dataRegistry.get(cellId)
    if (!cell) throw new Error(`Tile not found: ${cellId}`)

    cell.x = pos.x
    cell.y = pos.y

    if (index != null) cell.index = index

    this.refreshSurface()
  }

  // ---------------------------------------------------------
  // INTERNAL
  // ---------------------------------------------------------
  private refreshSurface(): void {
    const cells = Array.from(this.dataRegistry.values())
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

    const tiles = Array.from(this.tileRegistry.values())

    this._cells.set(cells)
    this._tiles.set(tiles)
  }

  // ---------------------------------------------------------
  // LEGACY COMPATIBILITY (required by app)
  // ---------------------------------------------------------
  public invalidate(): void {
    // remove all pixi tiles from the stage
    for (const tile of this.tileRegistry.values()) {
      tile.parent?.removeChild(tile as any)
      tile.destroy({ children: true })
    }

    this.tileRegistry.clear()
    this.dataRegistry.clear()

    // 🔥 critical: drop any queued renders from previous views
    this.hot.set([])

    this._cells.set([])
    this._tiles.set([])

    this.bump()
  }


  public hasCells(): boolean {
    return this._cells().length > 0
  }

  public setVisibility(cells: Cell[], visible: boolean): void {
    for (const c of cells) {
      const t = this.tileRegistry.get(c.cellId!)
      if (t) t.visible = visible
    }
  }

  public lookupTileByIndex(idx: number): Tile | undefined {
    const cell = this.lookupCellByIndex(idx)
    if (!cell) return undefined
    return this.tileRegistry.get(cell.cellId!)
  }

  public lookupCellByIndex(idx: number): Cell | undefined {
    return this._cells().find(c => c.index === idx)
  }
}
