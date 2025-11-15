// src/app/cells/storage/honeycomb-service.ts
import { Injectable, inject, signal } from '@angular/core'
import { Cell, CellKind, Ghost, NewCell } from '../cell'
import { combId } from '../models/cell-filters'
import { PointerState } from 'src/app/state/input/pointer-state'
import { effect } from 'src/app/performance/effect-profiler'
import { DataOrchestratorBase } from './data-orchestration-base'
import {
  ICellService,
  IModifyComb,
  IHiveHydration,
} from 'src/app/shared/tokens/i-comb-service.token'
import { toCellEntity } from 'src/app/core/mappers/to-cell-entity'
import { CellOptions } from '../models/cell-options'
import { safeDate, toCell } from 'src/app/core/mappers/to-cell'
import { CombQueryService } from './comb-query-service'
import { BlobService } from 'src/app/hive/rendering/blob-service'

@Injectable({ providedIn: 'root' })
export class HoneycombService
  extends DataOrchestratorBase
  implements ICellService, IModifyComb, IHiveHydration {

  private readonly blobs = inject(BlobService)
  private readonly query = inject(CombQueryService)
  private readonly ps = inject(PointerState)

  private readonly _lastCreated = signal<Cell | null>(null)
  private readonly _ready = signal(false)
  private readonly _selectedCells = signal<Cell[]>([])
  private hydratedEnqueued = new Set<number>()
  private lastHive = -1

  public readonly lastCreated = this._lastCreated.asReadonly()
  public readonly ready = this._ready.asReadonly()
  public readonly selectedCells = this._selectedCells.asReadonly()

  constructor() {
    super()
    this.setupHydrationEffect()
    this.setupPointerCleanup()
  }

  // ─────────────────────────────────────────────
  // A. LIFECYCLE
  // ─────────────────────────────────────────────

  public flush() {
    return this.honeycomb.store.flush()
  }

  public invalidate(): void {
    const top = this.stack.top()
    if (!top?.cell) return
    this.honeycomb.store.invalidate()
    this.hydratedEnqueued.clear()
  }

  public reset(): void {
    this.hydratedEnqueued.clear()
  }

  public setReady(): void {
    this._ready.set(true)
  }

  // ─────────────────────────────────────────────
  // B. CREATION
  // ─────────────────────────────────────────────

  public async addCell(newCell: NewCell | Ghost): Promise<Cell> {
    this.ensureValidKind(newCell)

    const entity = toCellEntity(newCell)
    const cell =
      newCell.kind === 'Ghost'
        ? (newCell as unknown as Cell)
        : <Cell>toCell(await this.repository.add(entity))

    this.staging.stageAdd(cell)
    this._lastCreated.set(cell)
    return cell
  }

  public async create(params: Partial<NewCell>, kind: CellKind): Promise<Cell> {
    const nc = this.honeycomb.factory.newCell(params)

    nc.setKind(kind)
    this.ensureValidKind(nc)

    return <Cell>{}
  }

  // ─────────────────────────────────────────────
  // C. HYDRATION
  // ─────────────────────────────────────────────

  public async hydrate(): Promise<Cell[]> {
    if (this.isFetching()) return []
    if (this.isHydrated()) return this.honeycomb.store.cells()

    this.markFetching()
    try {
      const rows = await this.repository.fetchAll()
      const cells = rows.map(r => <Cell>toCell(r))
      this.staging.stageCells(cells)
      this.markHydrated()
      return cells
    } catch (err) {
      this.resetHydration()
      throw err
    }
  }

  private setupHydrationEffect(): void {
    effect(() => {
      if (!this.ready()) return

      const top = this.stack.top()
      if (!top?.cell) return

      const parent = top.cell
      if (this.hydratedEnqueued.has(parent.cellId)) return
      if (this.lastHive === parent.cellId) return

      this.lastHive = parent.cellId
      this.lazyLoadChildren(parent.cellId)
    })
  }

  private async lazyLoadChildren(parentId: number): Promise<void> {
    try {
      const rows = await this.repository.fetchBySourceId(parentId)
      this.state.setHoneycombStatus(rows.length < 1)

      if (!rows?.length) {
        this.hydratedEnqueued.add(parentId)
        return
      }

      const cells = rows.map(r => <Cell>toCell(r))

      this.staging.stageMerge(cells)
      this.honeycomb.store.enqueueHot(cells)

      this.hydratedEnqueued.add(parentId)
    } catch (err) {
      console.warn(`[HoneycombService] failed to hydrate hive ${parentId}:`, err)
    }
  }

  // ─────────────────────────────────────────────
  // E. REMOVAL
  // ─────────────────────────────────────────────

  public async removeCell(cell: Cell): Promise<void> {
    cell.options.update(o => o | CellOptions.Deleted)
    cell.dateDeleted = safeDate(new Date()) || ''

    if (cell.kind !== 'Ghost') {
      await this.repository.update(toCellEntity(cell))
    }

    this.staging.stageRemove(cell.cellId!)
  }

  public async deleteAll(root: Cell, hierarchy: Cell[], permanent = false): Promise<void> {
    const ids = hierarchy.map(h => h.cellId!).filter(Boolean)
    if (root.cellId && !ids.includes(root.cellId)) ids.push(root.cellId)
    if (!ids.length) return

    if (permanent) {
      await this.repository.bulkDelete(ids)
    } else {
      const stamp = new Date().toISOString()
      hierarchy.forEach(h => {
        h.options.update(o => o | CellOptions.Deleted)
        h.dateDeleted = stamp
      })
      if (!hierarchy.find(h => combId(h) === combId(root))) {
        root.options.update(o => o | CellOptions.Deleted)
        root.dateDeleted = stamp
      }
      await this.repository.bulkDelete(ids)
    }

    ids.forEach(id => this.staging.stageRemove(id))
  }

  // ─────────────────────────────────────────────
  // F. UPDATES
  // ─────────────────────────────────────────────

  public async moveCell(_: string, cell: Cell): Promise<void> {
    await this.repository.update(toCellEntity(cell))
    this.staging.stageRemove(cell.cellId!)
    this.staging.stageAdd(cell)
  }

  public async replaceCell(cell: Cell): Promise<void> {
    await this.repository.update(toCellEntity(cell))
    this.staging.stageReplace(cell)
  }

  private setupPointerCleanup(): void {
    this.ps.onUp(() => this.stack.doneNavigating())
  }

  public async updateCell(cell: Cell): Promise<number> {
    if (cell.kind === 'Ghost' || !cell.kind) return 0

    this.ensureValidKind(cell)

    const res = await this.repository.update(toCellEntity(cell))
    this.staging.stageReplace(cell)
    this.honeycomb.store.enqueueHot([cell])
    return res
  }

  public async updateSilent(cell: Cell): Promise<number> {
    if (cell.kind === 'Ghost') return 0
    this.ensureValidKind(cell)
    return this.repository.update(toCellEntity(cell))
  }

  public async bulkPut(cells: Cell[]): Promise<void> {
    if (!cells.length) return
    await this.repository.bulkPut(cells.map(c => toCellEntity(c)))
    this.staging.stageMerge(cells)
  }

  public async bulkDelete(ids: number[]): Promise<void> {
    await this.repository.bulkDelete(ids)
    ids.forEach(id => this.staging.stageRemove(id))
  }

  // ─────────────────────────────────────────────
  // G. HELPERS
  // ─────────────────────────────────────────────

  private ensureValidKind(cell: { kind?: string; name?: string }): void {
    if (!cell.kind) {
      const name = cell.name ?? '(unnamed cell)'
      this.debug.warn('comb', `[HoneycombService] skipping cell '${name}' because kind is empty`)
      throw new Error(`[HoneycombService] refusing to persist cell '${name}' with empty kind`)
    }
  }

  public invalidateTile(cellId: number): void {
    this.hydratedEnqueued.delete(cellId)
    this.staging.stageRemove(cellId)
    this.staging.invalidateTile(cellId)
  }
}
