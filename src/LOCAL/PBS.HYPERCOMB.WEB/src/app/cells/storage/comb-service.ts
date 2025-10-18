import { Injectable, inject, signal } from '@angular/core'
import { Cell, CellKind, Ghost, NewCell } from '../cell'
import { combId } from '../models/cell-filters'
import { PointerState } from 'src/app/state/input/pointer-state'
import { effect } from 'src/app/performance/effect-profiler'
import { DataOrchestratorBase } from './data-orchestration-base'
import { ICellService, IModifyComb, IHiveHydration } from 'src/app/shared/tokens/i-comb-service.token'
import { toCellEntity } from 'src/app/core/mappers/to-cell-entity'
import { CellOptions } from '../models/cell-options'
import { safeDate, toCell } from 'src/app/core/mappers/to-cell'
import { CombQueryService } from './comb-query-service'
import { IHiveImage } from 'src/app/core/models/i-hive-image'
import { BlobService } from 'src/app/hive/rendering/blob-service'
import { PositionSynchronizer } from 'src/app/hive/position-synchronizer'

@Injectable({ providedIn: 'root' })
export class CombService extends DataOrchestratorBase implements ICellService, IModifyComb, IHiveHydration {
  // ─────────────────────────────────────────────
  // dependencies
  // ─────────────────────────────────────────────
  private blobs = inject(BlobService)
  private readonly query = inject(CombQueryService)
  private readonly ps = inject(PointerState)
  private readonly synchronizer = inject(PositionSynchronizer)

  // ─────────────────────────────────────────────
  // internal state
  // ─────────────────────────────────────────────
  private currentToken: string | null = null
  private readonly _ready = signal(false)
  private readonly _lastCreated = signal<Cell | null>(null)
  private readonly _selectedCells = signal<Cell[]>([])
  private lastHive: number = -1

  // ─────────────────────────────────────────────
  // public signals
  // ─────────────────────────────────────────────
  public readonly ready = this._ready.asReadonly()
  public readonly lastCreated = this._lastCreated.asReadonly()
  public readonly selectedCells = this._selectedCells.asReadonly()

  // ─────────────────────────────────────────────
  // lifecycle - MAIN ENTRY POINT for hive display 
  // ─────────────────────────────────────────────
  constructor() {
    super()
    effect(() => {
      if (!this.ready()) return
      const top = this.stack.top()
      if (!top?.cell) return

      const cell = top.cell
      // only react when the "hive" truly changes
      if (this.lastHive === cell.cellId) return

      // rotate render context + invalidate visual registries
      this.lastHive = cell.cellId
      this.comb.store.invalidate()
      this.rotateToken()


      // check memory first
      const children = this.comb.store.cells().filter(c => c.sourceId === cell.cellId)
      if (children.length) {
        this.staging.stageCells(children)
        this.comb.store.enqueueHot(children)
        return
      }

      // lazy hydrate children
      ;(async () => {
        const rows = await this.repository.fetchBySourceId(cell.cellId)
        const mapped = await Promise.all(rows.map(r => this.query.decorateWithImage(<Cell>toCell(r))))
        if (mapped.length) {
          this.staging.stageMerge(mapped)
          this.comb.store.enqueueHot(mapped as Cell[])
        }
      })()
    })

    // cleanup navigation state on pointer up
    this.ps.onUp(() => this.stack.doneNavigating())
  }

  // ─────────────────────────────────────────────
  // token control
  // ─────────────────────────────────────────────
  private rotateToken(): void {
    // first run can stay null; next runs carry real tokens
    this.currentToken = (globalThis as any)?.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  }

  public getToken(): string | null {
    return this.currentToken
  }

  // ─────────────────────────────────────────────
  // state / lifecycle
  // ─────────────────────────────────────────────
  public setReady(): void {
    this._ready.set(true)
  }

  // scheduler reads token off this flush
  public flush(): { hot: any; cold: any; token?: string | null } {
    const result = this.comb.store.flush()
    return { ...result, token: this.currentToken }
  }

  // responsive invalidation: rotate token; scheduler will cancel on next flush
  public invalidate(): void {
    const entry = this.stack.top()
    if (!entry?.cell) return
    this.rotateToken()
    this.comb.store.invalidate()
  }

  // optional soft reset (keep data, just rotate context if needed)
  public reset(): void {
    this.rotateToken()
  }

  // ─────────────────────────────────────────────
  // creation
  // ─────────────────────────────────────────────
  public async create(params: Partial<NewCell>, kind: CellKind): Promise<Cell> {
    const newCell = this.comb.factory.newCell(params)
    const initial = await this.blobs.getInitialBlob()
    const image = <IHiveImage>{ blob: initial, scale: 1, x: 0, y: 0, getBlob: async () => initial }
    newCell.image = image
    newCell.setKind(kind)
    this.ensureValidKind(newCell)
    return <Cell>{} // call addCell(newCell, image) elsewhere when ready to persist
  }

  public async addCell(newcell: NewCell | Ghost, image: IHiveImage): Promise<Cell> {
    this.ensureValidKind(newcell)
    const entity = toCellEntity(newcell)
    const cell = newcell.kind === 'Ghost'
      ? (newcell as unknown as Cell)
      : <Cell>toCell(await this.repository.add(entity, image))

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
    this.comb.store.enqueueHot([cell])
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
  public async removeCell(cell: Cell) {
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
    if (this.isHydrated()) return this.comb.store.cells()

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
    // no hydratedEnqueued any more — scheduler token handles context
    this.staging.stageRemove(cellId)
    this.staging.invalidateTile(cellId)
  }
}
