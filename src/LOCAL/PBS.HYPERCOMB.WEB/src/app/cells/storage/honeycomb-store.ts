// src/app/cells/storage/honeycomb-store.ts
import { Injectable, signal, computed, inject, effect } from "@angular/core"
import { Container, Point } from "pixi.js"
import { Hypercomb } from "src/app/core/mixins/abstraction/hypercomb.base"
import { Tile } from "../models/tile"
import { isSelected } from "../models/cell-filters"
import { IHoneycombStore, IStaging } from "src/app/shared/tokens/i-honeycomb-store.token"
import { SearchFilter } from "src/app/common/header/search-filter"
import { DebugService } from "src/app/core/diagnostics/debug-service"
import { Cell } from "src/app/models/cell"
import { gen } from "fast-check"

@Injectable()
export class HoneycombStore extends Hypercomb implements IHoneycombStore, IStaging {

  private readonly filter = inject(SearchFilter)

  // runtime registries
  private readonly tileRegistry = new Map<string, Tile>()
  private readonly dataRegistry = new Map<string, Cell>()

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
    const q = this.filter.delayValue().toLowerCase()
    if (!q) return this.cells()
    return this.cells().filter(c => (c.name ?? '').toLowerCase().includes(q))
  })

  private readonly _flushSeq = signal(0)
  public readonly flushSeq = this._flushSeq.asReadonly()

  constructor() {
    super()
    DebugService.expose("surfaceCells", this.cells)

    // tile visibility logic (unchanged)
    effect(() => {
      const q = this.filter.value().toLowerCase()
      const all = this.cells()
      const match = this.filteredCells()

      if (!q) {
        this.setVisibility(all, true)
        return
      }

      this.setVisibility(all, false)
      this.setVisibility(match, true)
    })
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
  public register(cell: Cell, tile: Tile): void {

    if (!gene) throw new Error("Cannot register tile without gene")

    const existing = this.tileRegistry.get(gene)
    if (existing && existing !== tile) {
      // remove old tile from stage and destroy it
      existing.parent?.removeChild(existing as unknown as Container)
      existing.destroy({ children: true })
    }

    this.tileRegistry.set(gene, tile)
    this.dataRegistry.set(get, cell)

    this.refreshSurface()
  }


  public unregister(gene: string): void {
    const tile = this.tileRegistry.get(gene)
    if (tile) {
      tile.parent?.removeChild(tile as unknown as Container)
      tile.destroy({ children: true })
      this.tileRegistry.delete(gene)
    }

    this.dataRegistry.delete(gene)
    this.refreshSurface()
    this.bump()
  }

  // ---------------------------------------------------------
  // LOOKUP
  // ---------------------------------------------------------
  public lookupTile(gene: string): Tile | undefined {
    return this.tileRegistry.get(gene)
  }

  public lookupData(gene: string): Cell | undefined {
    return this.dataRegistry.get(gene)
  }

  // new implementation: find by cell.index instead of array slot
  public lookupCellByIndex(idx: number): Cell | undefined {
    if (idx == null) return undefined
    const cells = this._cells()
    return cells.find(c => c.index === idx)
  }

  public lookupTileByIndex(idx: number): Tile | undefined {
    if (idx == null) return undefined

    const cells = this._cells()
    const cell = cells.find(c => c.index === idx)
    if (!cell?.gene) return undefined

    return this.tileRegistry.get(cell.gene)
  }

  // ---------------------------------------------------------
  // STAGING
  // ---------------------------------------------------------
  public stageCells(cells: Cell[]): void {
    this.dataRegistry.clear()
    for (const c of cells) this.dataRegistry.set(c.gene!, c)
    this.refreshSurface()
    this.bump()
  }

  public stageAdd(cell: Cell): void {
    this.dataRegistry.set(cell.gene!, cell)
    this.refreshSurface()
    this.bump()
  }

  public stageRemove(gene: string): void {
    this.dataRegistry.delete(gene)
    this.refreshSurface()
    this.bump()
  }

  public stageReplace(cell: Cell): void {
    this.dataRegistry.set(cell.gene!, cell)
    this.refreshSurface()
    this.enqueue(cell)
    this.bump()
  }

  public stageMerge(cells: Cell[]): void {
    for (const c of cells) this.dataRegistry.set(c.gene!, c)
    this.refreshSurface()
    this.bump()
  }

  // ---------------------------------------------------------
  // HOT QUEUE
  // ---------------------------------------------------------
  public enqueue(cells: Cell | Cell[]): void {
    const arr = Array.isArray(cells) ? cells : [cells]
    this.hot.update(v => [...v, ...arr])
  }

  // ---------------------------------------------------------
  // POSITION
  // ---------------------------------------------------------
  public updatePositionAndIndex(gene: string, pos: Point, index?: number): void {
    const cell = this.dataRegistry.get(gene)
    if (!cell) throw new Error(`Tile not found: ${gene}`)

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
      const t = this.tileRegistry.get(c.gene!)
      if (t) t.visible = visible
    }
  }
}
