// diamondcoreprocessor.com/history/global-time-clock.service.ts
import { EffectBus } from '@hypercomb/core'

/**
 * GlobalTimeClock — session-wide timestamp that synchronizes all locations.
 *
 * When a timestamp is set, every location visited will seek its cursor
 * to the last op at or before that timestamp. This turns the hive into
 * a frozen snapshot at any point in time — a perfect debugger.
 *
 * When timestamp is null, the system is in "live" mode — each location
 * shows its head state.
 */
export class GlobalTimeClock extends EventTarget {

  #timestamp: number | null = null

  /** null = live mode (no time override). number = frozen timestamp (ms epoch). */
  get timestamp(): number | null { return this.#timestamp }

  /** Whether the clock is in global time mode (not live). */
  get active(): boolean { return this.#timestamp !== null }

  /**
   * Set the global clock to a specific timestamp.
   * All locations will sync to show state at this moment.
   */
  setTime(timestamp: number): void {
    if (this.#timestamp === timestamp) return
    this.#timestamp = timestamp
    this.#emit()
  }

  /**
   * Return to live mode. All locations show head state.
   */
  goLive(): void {
    if (this.#timestamp === null) return
    this.#timestamp = null
    this.#emit()
  }

  /**
   * Step to the previous op timestamp across all known history bags.
   * Finds the nearest op timestamp that is strictly before the current timestamp.
   */
  stepBack(allOpsTimestamps: number[]): void {
    if (allOpsTimestamps.length === 0) return

    if (this.#timestamp === null) {
      // Not in time mode yet — enter at the last timestamp
      const last = allOpsTimestamps[allOpsTimestamps.length - 1]
      if (last !== undefined) this.setTime(last)
      return
    }

    // Find the latest timestamp strictly before current
    let candidate: number | null = null
    for (const t of allOpsTimestamps) {
      if (t < this.#timestamp) {
        if (candidate === null || t > candidate) candidate = t
      }
    }

    if (candidate !== null) {
      this.setTime(candidate)
    }
  }

  /**
   * Step to the next op timestamp across all known history bags.
   * Finds the nearest op timestamp that is strictly after the current timestamp.
   * If stepping past the last op, returns to live mode.
   */
  stepForward(allOpsTimestamps: number[]): void {
    if (this.#timestamp === null || allOpsTimestamps.length === 0) return

    // Find the earliest timestamp strictly after current
    let candidate: number | null = null
    for (const t of allOpsTimestamps) {
      if (t > this.#timestamp) {
        if (candidate === null || t < candidate) candidate = t
      }
    }

    if (candidate !== null) {
      this.setTime(candidate)
    } else {
      // Past the last op — return to live
      this.goLive()
    }
  }

  #emit(): void {
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit('time:changed', { timestamp: this.#timestamp })
  }
}

const _globalTimeClock = new GlobalTimeClock()
;(window as any).ioc.register('@diamondcoreprocessor.com/GlobalTimeClock', _globalTimeClock)
