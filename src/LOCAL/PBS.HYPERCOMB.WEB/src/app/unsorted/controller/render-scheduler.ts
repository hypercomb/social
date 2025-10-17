import { Injectable, inject, NgZone } from "@angular/core"
import { Application } from "pixi.js"
import { DebugService } from "src/app/core/diagnostics/debug-service"
import { Cell } from "src/app/cells/cell"
import { CellContext } from "src/app/actions/action-contexts"
import { RenderTileAction } from "src/app/hive/rendering/render-tile.action"
import { HIVE_HYDRATION } from "src/app/shared/tokens/i-comb-service.token"
import { HypercombState } from "src/app/state/core/hypercomb-state"

interface RenderBatch {
  hot: Cell[]
  cold: Cell[]
  token?: string | null
}

@Injectable({ providedIn: "root" })
export class RenderScheduler {
  private readonly zone = inject(NgZone)
  private readonly debug = inject(DebugService)
  private readonly hydration = inject(HIVE_HYDRATION)
  private readonly renderAction = inject(RenderTileAction)
  private readonly hs = inject(HypercombState) // <- will call setBatchComplete()

  private currentToken: string | null = null
  private pendingToken: string | null = null // set when we see a NEW (non-null) token; cleared once we signal complete

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

  /** enqueue tiles manually (auto-tag with current token) */
  public queue(cell: Cell | Cell[]): void {
    const arr = Array.isArray(cell) ? cell : [cell]
    if (!this.activeBatch) this.activeBatch = { hot: [], cold: [], token: this.currentToken }
    if (this.activeBatch && this.activeBatch.token == null) {
      this.activeBatch.token = this.currentToken
    }
    this.activeBatch.hot.push(...arr)
  }

  private async tick(): Promise<void> {
    // pull any staged work from hydration layer
    const flushAny = this.hydration.flush() as any // keep interface backward-compatible
    if (flushAny) {
      const token: string | null = (flushAny.token ?? null) as string | null
      const flush: RenderBatch = { hot: flushAny.hot ?? [], cold: flushAny.cold ?? [], token }

      // context switch: a NEW non-null token replaces the old one
      if (token && this.currentToken && token !== this.currentToken) {
        this.debug.log("render", `token changed → clearing render queue`)
        this.cancelAll()
        this.currentToken = token
        this.pendingToken = token // track completion for this new token
        // do not return early if you want to also accept this flush this frame:
        // but we keep the early return to yield one frame for cleanliness
        return
      }

      // first token assignment (initial run may be null; we only track non-null tokens)
      if (!this.currentToken && token) {
        this.currentToken = token
        this.pendingToken = token
      }

      if ((flush.hot?.length ?? 0) > 0 || (flush.cold?.length ?? 0) > 0) {
        this.batchQueue.push(flush)
      }
    }

    // activate next batch
    if (!this.activeBatch && this.batchQueue.length > 0) {
      this.activeBatch = this.batchQueue.shift()!
    }

    // if nothing to do, check for completion (only for tracked non-null token)
    if (!this.activeBatch) {
      this.maybeNotifyCompletion()
      return
    }

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
          cell?.cellId ? this.renderAction.cull(cell.cellId) : Promise.resolve()
        )
      )
      this.debug.log("render", `culled=${cold.length}`)
      return
    }

    // render hot tiles within per-frame budget
    let processed = 0
    while (hot.length > 0) {
      const slice = hot.splice(0, this.budgetPerFrame)

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

      if (hot.length > 0) await new Promise(r => setTimeout(r, 40))
    }
  }

  private maybeNotifyCompletion(): void {
    // Only signal when:
    //  - we have a currentToken
    //  - that token is the one we're tracking (pendingToken)
    //  - no queued work remains
    //  - nothing is in-flight
    //  - no render job is active
    if (
      this.currentToken &&
      this.pendingToken === this.currentToken &&
      this.batchQueue.length === 0 &&
      !this.activeBatch &&
      !this.renderJob &&
      this.inFlight.size === 0
    ) {
      // Notify once per token, then clear pending flag
      try {
        this.hs.setBatchComplete()
      } finally {
        this.pendingToken = null
      }
    }
  }

  private cancelAll(): void {
    this.batchQueue.length = 0
    this.activeBatch = null
    this.inFlight.clear()
    this.renderJob = null
    // do not clear pendingToken here — the new token will be set immediately after
  }
}
