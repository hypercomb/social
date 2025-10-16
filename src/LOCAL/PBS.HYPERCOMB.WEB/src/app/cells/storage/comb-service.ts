import { Injectable, inject, signal } from '@angular/core'
import { Cell, Ghost, NewCell } from '../cell'
import { combId } from '../models/cell-filters'
import { PointerState } from 'src/app/state/input/pointer-state'
import { effect } from 'src/app/performance/effect-profiler'
import { DataOrchestratorBase } from './data-orchestration-base'
import { ICellService, IModifyComb, IHiveHydration } from 'src/app/shared/tokens/i-comb-service.token'
import { COMB_STORE } from 'src/app/shared/tokens/i-comb-store.token'
import { toCellEntity } from 'src/app/core/mappers/to-cell-entity'
import { CellOptions } from '../models/cell-options'
import { safeDate, toCell } from 'src/app/core/mappers/to-cell'
import { CellFactory } from 'src/app/inversion-of-control/factory/cell-factory'
import { CombQueryService } from './comb-query-service'

@Injectable({ providedIn: 'root' })
export class CombService extends DataOrchestratorBase implements ICellService, IModifyComb, IHiveHydration {
  // ─────────────────────────────────────────────
  // dependencies
  // ─────────────────────────────────────────────
  private readonly combstore = inject(COMB_STORE)
  private readonly query = inject(CombQueryService)
  private readonly ps = inject(PointerState)
  private readonly factory = inject(CellFactory)

  // ─────────────────────────────────────────────
  // internal state
  // ─────────────────────────────────────────────
  private readonly _ready = signal(false)
  private readonly _lastCreated = signal<Cell | null>(null)
  private readonly _selectedCells = signal<Cell[]>([])
  private hydratedEnqueued = new Set<number>()
  private lastHive: number = -1

  // ─────────────────────────────────────────────
  // public signals
  // ─────────────────────────────────────────────
  public readonly ready = this._ready.asReadonly()
  public readonly lastCreated = this._lastCreated.asReadonly()
  public readonly selectedCells = this._selectedCells.asReadonly()

  // ─────────────────────────────────────────────
  // lifecycle / initialization
  // ─────────────────────────────────────────────
  constructor() {
    super()

    // enqueue hive cells after hydration (once per comb)
    effect(() => {
      if (!this.ready()) return
      const top = this.stack.top()
      if (!top?.cell || this.lastHive === top.cell.cellId) return

      const cell = top.cell
      this.lastHive = cell.cellId

      // skip if already hydrated
      if (this.hydratedEnqueued.has(cell.cellId)) return

      // get any already-loaded children
      const children = this.combstore.cells().filter(c => c.sourceId === cell.cellId)

      // lazy hydrate if not loaded yet
      if (!children.length) {
        ;(async () => {
          const rows = await this.repository.fetchBySourceId(cell.cellId)
          const mapped = await Promise.all(rows.map(r => this.query.decorateWithImage(<Cell>toCell(r))))

          if (mapped.length) {
            this.staging.stageMerge(mapped)
            this.combstore.enqueueHot(mapped as Cell[])
          }
          this.hydratedEnqueued.add(cell.cellId)
        })()
        return
      }

      // already have children in memory
      this.combstore.enqueueHot(children)
      this.hydratedEnqueued.add(cell.cellId)
    })

    // cleanup navigation state on pointer up
    this.ps.onUp(() => this.stack.doneNavigating())
  }

  // ─────────────────────────────────────────────
  // state / lifecycle
  // ─────────────────────────────────────────────
  public setReady(): void {
    this._ready.set(true)
  }

  public flush(): { hot: any; cold: any } {
    return this.combStore.flush()
  }

  public invalidate(): void {
    const entry = this.stack.top()
    if (!entry?.cell) return
    this.combstore.invalidate()
    this.hydratedEnqueued.clear()
  }

  public reset(): void {
    this.hydratedEnqueued.clear()
  }

  // ─────────────────────────────────────────────
  // creation
  // ─────────────────────────────────────────────
  public async create(params: Partial<NewCell>): Promise<Cell> {
    const newCell = this.factory.newCell(params)
    this.ensureValidKind(newCell)
    const entity = this.factory.unmap(newCell)
    const newEntity = await this.repository.add(entity)
    return this.factory.map<Cell>(newEntity)
  }

  public async addCell(newcell: NewCell | Ghost): Promise<Cell> {
    this.ensureValidKind(newcell)
    const entity = toCellEntity(newcell)
    const cell =
      newcell.kind !== 'Ghost'
        ? <Cell>toCell(await this.repository.add(entity))
        : (newcell as unknown as Cell)

    this.staging.stageAdd(cell)
    this._lastCreated.set(cell)
    return cell
  }

  // ─────────────────────────────────────────────
  // updates
  // ─────────────────────────────────────────────
  public async updateCell(cell: Cell): Promise<number> {
    if (cell.kind === 'Ghost') return 0
    this.ensureValidKind(cell)
    const result = await this.repository.update(toCellEntity(cell))
    this.staging.stageReplace(cell)
    return result
  }

  public async updateSilent(cell: Cell): Promise<number> {
    if (cell.kind === 'Ghost') return 0
    this.ensureValidKind(cell)
    return this.repository.update(toCellEntity(cell))
  }

  // ─────────────────────────────────────────────
  // removal / cleanup
  // ─────────────────────────────────────────────
  public async removeCell(cell: Cell): Promise<void> {
    cell.options.update(o => o | CellOptions.Deleted)
    cell.dateDeleted = safeDate(new Date()) || ''
    await this.repository.update(toCellEntity(cell))
    this.staging.stageRemove(cell.cellId!)
  }

  public async deleteAll(root: Cell, hierarchy: Cell[], permanent = false): Promise<void> {
    const ids = hierarchy.map(h => h.cellId!).filter(Boolean)
    if (root.cellId && !ids.includes(root.cellId)) ids.push(root.cellId)
    if (!ids.length) return

    if (permanent) {
      await this.repository.bulkDelete(ids)
    } else {
      const nowUtc = new Date().toISOString()
      hierarchy.forEach(item => {
        item.options.update(o => o | CellOptions.Deleted)
        item.dateDeleted = nowUtc
      })
      if (!hierarchy.find(h => combId(h) === combId(root))) {
        root.options.update(o => o | CellOptions.Deleted)
        root.dateDeleted = nowUtc
      }
      await this.repository.bulkDelete(ids)
    }

    hierarchy.forEach(c => this.staging.stageRemove(c.cellId!))
    if (root.cellId) this.staging.stageRemove(root.cellId)
  }

  // ─────────────────────────────────────────────
  // move / replace / bulk ops
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
  // hydration
  // ─────────────────────────────────────────────
  public async hydrate(): Promise<Cell[]> {
    if (this.isFetching()) return []
    if (this.isHydrated()) return this.combstore.cells()

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

  // ─────────────────────────────────────────────
  // utility
  // ─────────────────────────────────────────────
  private ensureValidKind(cell: { kind?: string; name?: string }): void {
    if (!cell.kind) {
      const name = cell.name ?? '(unnamed cell)'
      this.debug.warn('comb', `[CombService] skipping cell '${name}' because kind is empty`)
      throw new Error(`[CombService] refusing to persist cell '${name}' with empty kind`)
    }
  }

  public invalidateTile(cellId: number): void {
    this.hydratedEnqueued.delete(cellId)
    this.staging.stageRemove(cellId)
    this.staging.invalidateTile(cellId)
  }
}
