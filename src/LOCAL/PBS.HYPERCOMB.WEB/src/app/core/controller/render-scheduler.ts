// src/app/core/controller/render-scheduler.ts
import { Injectable, inject, NgZone } from "@angular/core"
import { Application } from "pixi.js"
import { DebugService } from "src/app/core/diagnostics/debug-service"
import { Cell } from "src/app/cells/cell"
import { HIVE_HYDRATION } from "src/app/shared/tokens/i-comb-service.token"
import { HypercombState } from "src/app/state/core/hypercomb-state"
import { CellPayload } from "src/app/actions/action-contexts"
import { RenderTileAction } from "src/app/hive/rendering/render-tile.action"

/**
 * =====================================================================
 *  HYPERCOMB RENDER SCHEDULER — 2025 EDITION
 * =====================================================================
 * ✔ HOT-only render pipeline
 * ✔ no cold queue anywhere in the system
 * ✔ deterministic tile lifecycle
 * ✔ strictly additive rendering (removal handled by store)
 * ✔ frame-budget aware (6ms default)
 * ✔ idle yielding for smooth 60/120 FPS
 * ✔ UI remains 100% reactive and stable
 * =====================================================================
 */

@Injectable({ providedIn: "root" })
export class RenderScheduler {
  private readonly zone = inject(NgZone)
  private readonly debug = inject(DebugService)
  private readonly hydration = inject(HIVE_HYDRATION)
  private readonly renderTile = inject(RenderTileAction)
  private readonly hs = inject(HypercombState)

  /**
   * FIFO queue of tiles waiting to render
   */
  private readonly batchQueue: Cell[] = []

  /**
   * Prevent double-render of the same tile in a single scheduler job
   */
  private readonly inFlight = new Set<number>()

  /**
   * Tracks an active render job so we don't start two jobs at once
   */
  private renderJob: Promise<void> | null = null

  /**
   * Time budget per frame (ms)
   */
  private readonly frameBudget = 6.0

  /**
   * requestIdleCallback fallback
   */
  private readonly idle =
    typeof requestIdleCallback !== "undefined"
      ? requestIdleCallback
      : (cb: any) => setTimeout(cb, 0)

  // ─────────────────────────────────────────────────────────────
  // PUBLIC API — attach to PIXI ticker
  // ─────────────────────────────────────────────────────────────

  public hook(app: Application): void {
    this.zone.runOutsideAngular(() => {
      app.ticker.add(() => this.tick())
    })
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLIC API — queue tiles for render
  // ─────────────────────────────────────────────────────────────

  public queue(cells: Cell | Cell[]): void {
    const arr = Array.isArray(cells) ? cells : [cells]
    for (const c of arr) this.batchQueue.push(c)
  }

  // ─────────────────────────────────────────────────────────────
  // INTERNAL — drain hydration HOT queue
  // ─────────────────────────────────────────────────────────────

  private drainHot(): void {
    const flush = this.hydration.flush()
    if (!flush) return

    const hot = flush.hot ?? []
    for (const cell of hot) this.batchQueue.push(cell)
  }

  // ─────────────────────────────────────────────────────────────
  // MAIN TICK LOOP (runs once per PIXI frame)
  // ─────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    // Pull new HOT tiles from hydration
    this.drainHot()

    const nothingPending = this.batchQueue.length === 0
    const jobIdle = this.renderJob === null

    // If no items and not processing → mark batch complete
    if (nothingPending && jobIdle) {
      this.hs.setBatchComplete()
      return
    }

    // Start processing if nothing active
    if (jobIdle) {
      this.renderJob = this.process()
        .catch(err => this.debug.log("render", `error: ${err}`))
        .finally(() => (this.renderJob = null))
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PROCESS LOOP — renders until frame budget exceeded
  // ─────────────────────────────────────────────────────────────

  private async process(): Promise<void> {
    const start = performance.now()
    let rendered = 0

    while (this.batchQueue.length > 0) {
      const cell = this.batchQueue.shift()!
      const id = cell.cellId
      if (id == null) continue

      // avoid duplicate render of same tile in this frame cycle
      if (this.inFlight.has(id)) continue
      this.inFlight.add(id)

      try {
        await this.renderTile.run(<CellPayload>{ cell })
      } finally {
        this.inFlight.delete(id)
      }

      rendered++

      // frame budget exceeded → yield to idle callback
      if (performance.now() - start > this.frameBudget) {
        await new Promise<void>(resolve =>
          this.idle(() => resolve())
        )
        return
      }
    }

    // batch done
    this.debug.log("render", `processed=${rendered}`)
    this.hs.setBatchComplete()
  }
}
