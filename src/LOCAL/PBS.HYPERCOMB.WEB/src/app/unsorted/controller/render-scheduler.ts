import { Injectable, inject, NgZone } from "@angular/core"
import { Application } from "pixi.js"
import { DebugService } from "src/app/core/diagnostics/debug-service"
import { Cell } from "src/app/cells/cell"
import { CellContext } from "src/app/actions/action-contexts"
import { RenderTileAction } from "src/app/hive/rendering/render-tile.action"
import { HIVE_HYDRATION } from "src/app/shared/tokens/i-comb-service.token"

interface RenderBatch {
  hot: Cell[]
  cold: Cell[]
}

@Injectable({ providedIn: "root" })
export class RenderScheduler {
  private readonly zone = inject(NgZone)
  private readonly debug = inject(DebugService)
  private readonly hydration = inject(HIVE_HYDRATION)
  private readonly renderAction = inject(RenderTileAction)

  private readonly batchQueue: RenderBatch[] = []
  private activeBatch: RenderBatch | null = null
  private readonly inFlight = new Set<number>()

  private renderJob: Promise<void> | null = null
  private budgetPerFrame = 4

  /** hook scheduler into pixi ticker */
  public hook(app: Application): void {
    this.zone.runOutsideAngular(() => {
      app.ticker.add(() => void this.tick())
    })
  }

  /** enqueue tiles manually */
  public queue(cell: Cell | Cell[]): void {
    const arr = Array.isArray(cell) ? cell : [cell]
    if (!this.activeBatch) this.activeBatch = { hot: [], cold: [] }
    this.activeBatch.hot.push(...arr)
  }

  private async tick(): Promise<void> {
    // create new batch from hydration if nothing active or queued
    if (!this.activeBatch && this.batchQueue.length === 0) {
      const flush = this.hydration.flush()
      if (flush.hot.length > 0 || flush.cold.length > 0) {
        this.batchQueue.push(flush)
      }
    }

    // if active batch complete, dequeue next
    if (!this.activeBatch && this.batchQueue.length > 0) {
      this.activeBatch = this.batchQueue.shift()!
    }

    // nothing to process
    if (!this.activeBatch) return

    if (!this.renderJob) {
      this.renderJob = this.processBatch(this.activeBatch)
        .then(() => {
          this.activeBatch = null
          this.renderJob = null
        })
        .catch(err => {
          this.debug.log("render", `batch failed: ${err}`)
          this.activeBatch = null
          this.renderJob = null
        })
    }
  }

  /** process one layer (hot + cold) */
  private async processBatch(batch: RenderBatch): Promise<void> {
    const { hot, cold } = batch

    // cull cold tiles first
    if (cold.length > 0) {
      await Promise.all(
        cold.map(cell =>
          cell?.cellId
            ? this.renderAction.cull(cell.cellId)
            : Promise.resolve()
        )
      )
      this.debug.log("render", `culled=${cold.length}`)
    }

    // render hot tiles sequentially within budget
    let processed = 0
    while (hot.length > 0) {
      let budget = this.budgetPerFrame
      const slice = hot.splice(0, budget)

      for (const cell of slice) {
        const id = cell.cellId
        if (!id || this.inFlight.has(id)) continue
        this.inFlight.add(id)
        try {
          await this.renderAction.run(<CellContext>{ kind: "cell", cell })
        } finally {
          this.inFlight.delete(id)
        }
        processed++
      }

      this.debug.log(
        "render",
        `processed=${processed}, remaining=${hot.length}, batches=${this.batchQueue.length}`
      )

      // pause a bit between slices to yield to next frame
      if (hot.length > 0) await new Promise(r => setTimeout(r, 40))
    }
  }
}
