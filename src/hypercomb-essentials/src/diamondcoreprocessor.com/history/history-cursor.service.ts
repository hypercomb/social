// diamondcoreprocessor.com/core/history-cursor.service.ts
import { EffectBus } from '@hypercomb/core'
import type { HistoryService, HistoryOp } from './history.service.js'

export type CursorState = {
  /** History bag signature for the current location. */
  locationSig: string
  /** Current cursor position (1-based index). 0 = no history. */
  position: number
  /** Total number of history ops in this bag. */
  total: number
  /** true when cursor is not at the latest op. */
  rewound: boolean
}

export type DivergenceInfo = {
  /** Seeds that exist at cursor position (normal rendering). */
  current: Set<string>
  /** Seeds that were added AFTER cursor position (ghost / future). */
  futureAdds: Set<string>
  /** Seeds that exist at cursor but are removed later (marked for removal). */
  futureRemoves: Set<string>
}

/**
 * Tracks a movable cursor within a location's history bag.
 * Moving the cursor does NOT mutate history — it only changes
 * what ShowCellDrone considers "visible" and what appears divergent.
 */
export class HistoryCursorService extends EventTarget {

  #locationSig = ''
  #position = 0
  #total = 0
  #allOps: HistoryOp[] = []

  get state(): CursorState {
    return {
      locationSig: this.#locationSig,
      position: this.#position,
      total: this.#total,
      rewound: this.#total > 0 && this.#position < this.#total,
    }
  }

  /**
   * Load (or reload) history for a location.
   * Resets cursor to latest unless it was already set for this sig.
   */
  async load(locationSig: string): Promise<void> {
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!historyService) return

    const ops = await historyService.replay(locationSig)
    this.#allOps = ops
    this.#total = ops.length

    if (this.#locationSig !== locationSig) {
      // new location — jump to latest
      this.#locationSig = locationSig
      this.#position = this.#total
    } else if (this.#position > this.#total) {
      // history grew shorter (shouldn't happen, but safety)
      this.#position = this.#total
    }

    this.#emit()
  }

  /**
   * Called when a new op is appended (e.g. by HistoryRecorder).
   * If cursor was at the latest, keep it at the latest.
   */
  async onNewOp(): Promise<void> {
    const wasAtLatest = this.#position >= this.#total
    await this.load(this.#locationSig)
    if (wasAtLatest) {
      this.#position = this.#total
      this.#emit()
    }
  }

  /** Move cursor to an absolute position (1-based, clamped). */
  seek(position: number): void {
    const clamped = Math.max(0, Math.min(position, this.#total))
    if (clamped === this.#position) return
    this.#position = clamped
    this.#emit()
  }

  /** Step backward one op. */
  undo(): void {
    this.seek(this.#position - 1)
  }

  /** Step forward one op. */
  redo(): void {
    this.seek(this.#position + 1)
  }

  /** Jump to latest (exit rewind mode). */
  jumpToLatest(): void {
    this.seek(this.#total)
  }

  /**
   * Compute divergence info: which seeds are current vs future.
   * Used by ShowCellDrone to decide ghost overlays.
   */
  computeDivergence(): DivergenceInfo {
    const current = new Set<string>()
    const futureAdds = new Set<string>()
    const futureRemoves = new Set<string>()

    if (this.#allOps.length === 0) {
      return { current, futureAdds, futureRemoves }
    }

    // Replay up to cursor position to get "current" seed set
    const seedStateAtCursor = new Map<string, string>()
    for (let i = 0; i < this.#position; i++) {
      const op = this.#allOps[i]
      if (op.op === 'add' || op.op === 'remove') {
        seedStateAtCursor.set(op.seed, op.op)
      }
    }

    for (const [seed, lastOp] of seedStateAtCursor) {
      if (lastOp !== 'remove') current.add(seed)
    }

    // If not rewound, no divergence
    if (this.#position >= this.#total) {
      return { current, futureAdds, futureRemoves }
    }

    // Replay ops AFTER cursor to find future changes
    const seedStateAtEnd = new Map(seedStateAtCursor)
    for (let i = this.#position; i < this.#total; i++) {
      const op = this.#allOps[i]
      if (op.op === 'add' || op.op === 'remove') {
        seedStateAtEnd.set(op.seed, op.op)
      }
    }

    for (const [seed, lastOp] of seedStateAtEnd) {
      const existsAtCursor = current.has(seed)
      const existsAtEnd = lastOp !== 'remove'

      if (!existsAtCursor && existsAtEnd) {
        // Added after cursor
        futureAdds.add(seed)
      } else if (existsAtCursor && !existsAtEnd) {
        // Exists at cursor but removed later
        futureRemoves.add(seed)
      }
    }

    return { current, futureAdds, futureRemoves }
  }

  #emit(): void {
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit<CursorState>('history:cursor-changed', this.state)
  }
}

const _historyCursorService = new HistoryCursorService()
;(window as any).ioc.register('@diamondcoreprocessor.com/HistoryCursorService', _historyCursorService)
