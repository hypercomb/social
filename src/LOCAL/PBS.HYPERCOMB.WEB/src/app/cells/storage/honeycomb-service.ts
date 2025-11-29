// src/app/cells/storage/honeycomb-service.ts
import { Injectable, inject, signal } from '@angular/core'
import { Cell, Ghost, NewCell } from '../cell'
import { PointerState } from 'src/app/state/input/pointer-state'
import { effect } from 'src/app/performance/effect-profiler'
import { DataOrchestratorBase } from './data-orchestration-base'
import {
  ICellService,
  IModifyComb,
  IHiveHydration,
} from 'src/app/shared/tokens/i-comb-service.token'
import { toCellEntity } from 'src/app/core/mappers/to-cell-entity'
import { safeDate, toCell } from 'src/app/core/mappers/to-cell'
import { CellOptions } from '../models/cell-options'

@Injectable({ providedIn: 'root' })
export class HoneycombService extends DataOrchestratorBase implements ICellService, IModifyComb, IHiveHydration {

  private readonly ps = inject(PointerState)

  // v1-compatible layer-hydration tracking
  private readonly hydratedLayers = new Set<string>()

  private readonly _lastCreated = signal<Cell | null>(null)
  public readonly lastCreated = this._lastCreated.asReadonly()

  private readonly _ready = signal(false)
  public readonly ready = this._ready.asReadonly()

  public readonly selectedCells = this.honeycomb.store.selectedCells

  constructor() {
    super()
    this.setupHydrationEffect()
    this.setupPointerCleanup()
  }


  // ---------------------------------------------------------
  // HOT-only flush (unchanged)
  // ---------------------------------------------------------
  public flush() {
    return this.honeycomb.store.flush()
  }

  public reset(): void {
    this.hydratedLayers.clear()
  }

  public setReady(): void {
    this._ready.set(true)
  }

  // =========================================================
  //   NEW / CLEAN LAYER HYDRATION (v1 correct behavior)
  // =========================================================

  private setupHydrationEffect(): void {
    effect(() => {
      if (!this.ready()) return

      const parent = this.stack.cell()
      if (!parent) return

      const layerKey = `${parent.hive}-${parent.cellId}`

      // already hydrated this honeycomb layer → do nothing
      if (this.hydratedLayers.has(layerKey)) return

      this.hydratedLayers.add(layerKey)

      this.hydrateLayer(parent.cellId!)
    })
  }

  // ---------------------------------------------------------
  // load ONLY this layer (children of parentId)
  // ---------------------------------------------------------
  private async hydrateLayer(parentId: number): Promise<void> {
    try {
      const rows = await this.repository.fetchBySourceId(parentId)
      const children = rows.map(r => <Cell>toCell(r))

      // ----- update parent flag -----
      const parent = this.honeycomb.store.lookupData(parentId)
      if (parent) {
        const hasChildren = children.length > 0
        const newFlag = hasChildren ? 'true' : 'false'

        if (parent.hasChildrenFlag !== newFlag) {
          parent.hasChildrenFlag = newFlag
          this.staging.stageReplace(parent)
        }
      }

      if (!children.length) return

      // ----- compute children flags -----
      const ids = children.map(c => c.cellId!)
      const counts = await Promise.all(
        ids.map(id => this.repository.fetchChildCount(id))
      )

      children.forEach((c, i) => {
        c.hasChildrenFlag = counts[i] > 0 ? 'true' : 'false'
      })

      // ----- merge into store & enqueue rendering -----
      this.staging.stageMerge(children)
      this.honeycomb.store.enqueueHot(children)

    } catch (err) {
      console.warn(`[HoneycombService] layer hydration failed:`, err)
    }
  }

  // =========================================================
  // CREATION
  // =========================================================
  private isPersistable(cell: Cell): boolean {
    return !['Ghost', 'Clipboard', 'Path'].includes(cell.kind as string)
  }

  public async addCell(newCell: NewCell | Ghost): Promise<Cell> {
    let cell: Cell

    if (this.isPersistable(newCell as Cell)) {
      newCell.setKind("Cell")
      const row = await this.repository.add(toCellEntity(newCell))
      cell = <Cell>toCell(row)
    } else {
      cell = newCell as unknown as Cell
    }

    this.staging.stageAdd(cell)
    this._lastCreated.set(cell)
    return cell
  }

  // deprecated but left intact
  public async create(): Promise<Cell> {
    throw new Error("create() is deprecated; use addCell()")
  }

  // =========================================================
  // REMOVAL
  // =========================================================
  public async removeCell(cell: Cell): Promise<void> {
    const id = cell.cellId!

    if (cell.kind !== 'Ghost') {
      cell.options.update(v => v | CellOptions.Deleted)
      cell.dateDeleted = safeDate(new Date()) || ''
      await this.repository.update(toCellEntity(cell))
    }

    this.staging.stageRemove(id)
    this.honeycomb.store.unregister(id)
  }

  public async deleteAll(root: Cell, hierarchy: Cell[]): Promise<void> {
    const ids = hierarchy.map(c => c.cellId!).filter(Boolean)
    if (root.cellId && !ids.includes(root.cellId)) ids.push(root.cellId)

    if (!ids.length) return

    await this.repository.bulkDelete(ids)
    for (const id of ids) {
      this.staging.stageRemove(id)
      this.honeycomb.store.unregister(id)
    }
  }

  // =========================================================
  // UPDATES
  // =========================================================
  public async updateCell(cell: Cell): Promise<number> {
    if (!this.isPersistable(cell)) {
      this.staging.stageReplace(cell)
      return 0
    }

    const res = await this.repository.update(toCellEntity(cell))
    this.staging.stageReplace(cell)
    this.honeycomb.store.enqueueHot(cell)
    return res
  }

  public async updateHasChildren(cell: Cell): Promise<void> {
    const count = await this.repository.fetchChildCount(cell.cellId!)
    cell.hasChildrenFlag = count > 0 ? 'true' : 'false'
    this.staging.stageReplace(cell)
  }

  public async updateSilent(cell: Cell): Promise<number> {
    if (!this.isPersistable(cell)) return 0
    return this.repository.update(toCellEntity(cell))
  }

  public async bulkPut(cells: Cell[]): Promise<void> {
    if (!cells.length) return
    await this.repository.bulkPut(cells.map(c => toCellEntity(c)))
    this.staging.stageMerge(cells)
  }

  public async bulkDelete(ids: number[]): Promise<void> {
    await this.repository.bulkDelete(ids)
    for (const id of ids) {
      this.staging.stageRemove(id)
      this.honeycomb.store.unregister(id)
    }
  }

  // =========================================================
  // POINTER CLEANUP
  // =========================================================
  private setupPointerCleanup(): void {
    this.ps.onUp(() => {
      requestAnimationFrame(() => this.stack.doneNavigating())
    })
  }

  // =========================================================
  // LEGACY API
  // =========================================================
  public invalidate(): void {
    const top = this.stack.top()
    const hive = top?.cell?.hive
    if (!hive) return
    this.reset()
    this.honeycomb.store.invalidate()
  }

  public invalidateTile(cellId: number): void {
    this.honeycomb.store.unregister(cellId)
  }
}
