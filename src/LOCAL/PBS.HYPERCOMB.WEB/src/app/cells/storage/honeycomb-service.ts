// src/app/cells/storage/honeycomb-service.ts
import { Injectable, inject, signal } from '@angular/core'
import { PointerState } from 'src/app/state/input/pointer-state'
import { effect } from 'src/app/performance/effect-profiler'
import { DataOrchestratorBase } from './data-orchestration-base'
import { Cell } from 'src/app/models/cell'
import { NewCell } from 'src/app/models/new-cell'
import { Ghost } from 'src/app/models/ghost-cell'
import { OpfsManager } from 'src/app/common/opfs/opfs-manager'

@Injectable({ providedIn: 'root' })
export class HoneycombService extends DataOrchestratorBase {

  private readonly ps = inject(PointerState)
  private readonly opfs = inject(OpfsManager)

  private readonly hydrated = new Set<string>()

  private readonly _ready = signal(false)
  public readonly ready = this._ready.asReadonly()

  private readonly _lastCreated = signal<Cell | null>(null)
  public readonly lastCreated = this._lastCreated.asReadonly()

  constructor() {
    super()
    this.setupHydrationEffect()
    this.setupPointerCleanup()
  }

  public setReady() {
    this._ready.set(true)
  }

  // ----------------------------------------------------------
  // AUTO-HYDRATION when navigating the hive
  // ----------------------------------------------------------
  private setupHydrationEffect() {
    effect(() => {
      if (!this.ready()) return

      const parent = this.stack.cell()
      if (!parent) return

      const gene = String(parent.cellId)
      if (this.hydrated.has(gene)) return

      this.hydrated.add(gene)
      this.hydrate()
    })
  }

  private async hydrate(): Promise<string[]> {
    const hive = this.state.hive()!
    const parentGene = await this.hashsvc.hash(hive)

    // hives/<parentGene>/
    const dir = await this.opfs.ensureDirs([
      "hives",
      parentGene
    ])

    const entries = await this.opfs.listEntries(dir)

    // genes = folders; strands = files
    const childGenes = entries
      .filter(e => e.handle.kind === "directory")
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b))

    return childGenes
  }


  // ----------------------------------------------------------
  // ADDING NEW GENES (CELLS)
  // ----------------------------------------------------------
  public async addCell(newCell: NewCell | Ghost): Promise<Cell> {
    const id = this.hash(newCell.name)
    const cell = new Cell({ ...newCell, cellId: id })
    cell.setKind("Cell")

    this.staging.stageAdd(cell)
    this._lastCreated.set(cell)
    return cell
  }

  public async removeCell(cell: Cell): Promise<void> {
    this.staging.stageRemove(cell.cellId!)
    this.honeycomb.store.unregister(cell.cellId!)
  }

  // no DB anymore — all updates are local to staging + store
  public async updateCell(cell: Cell): Promise<number> {
    this.staging.stageReplace(cell)
    this.honeycomb.store.enqueue(cell)
    return 0
  }

  public async bulkPut(cells: Cell[]) {
    this.staging.stageMerge(cells)
  }

  public async bulkDelete(ids: number[]) {
    for (const id of ids) {
      this.staging.stageRemove(id)
      this.honeycomb.store.unregister(id)
    }
  }

  // ----------------------------------------------------------
  // POINTER CLEANUP
  // ----------------------------------------------------------
  private setupPointerCleanup() {
    this.ps.onUp(() => {
      requestAnimationFrame(() => this.stack.doneNavigating())
    })
  }
}
