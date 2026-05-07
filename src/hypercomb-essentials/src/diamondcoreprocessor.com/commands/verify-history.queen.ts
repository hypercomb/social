// diamondcoreprocessor.com/commands/verify-history.queen.ts
//
// /verify-history — automated walk over the current location's
// history that catches the "undo doesn't match the diff message"
// class of bug.
//
// At every cursor position (0..total) the walker captures the
// rendered tile count via `render:cell-count` after seeking. It does
// this twice:
//
//   forward  — walk 0 → 1 → 2 → … → total
//   backward — walk total → total-1 → … → 0
//
// At each position `i`, three numbers are recorded:
//   - declared   = layer.children.length (the JSON's truth)
//   - forward[i] = rendered count after redo-style seek
//   - backward[i]= rendered count after undo-style seek
//
// The PASS criterion is:
//
//     forward[i] === backward[i]  for every i
//
// That's the user-relevant invariant: after undoing to position i,
// the canvas should render the same set of tiles it rendered the
// first time the cursor passed through i. When forward != backward,
// the undo path is computing a different state from the redo path,
// and the history viewer's diff message will appear disconnected
// from the visual change.
//
// `declared` is reported as informational context — it is allowed
// to differ from forward/backward (the renderer also intersects with
// disk cells, so a layer can declare children that aren't currently
// rendered without that being a bug).
//
// Output:
//   - per-step toast on summary
//   - console.table of every position's three numbers + delta
//   - final success/warning toast with X/Y forward==backward summary

import { QueenBee, EffectBus } from '@hypercomb/core'

type LayerEntry = { layerSig: string; at: number }
type LayerContent = { name?: string; children?: string[]; [slot: string]: unknown }

type HistoryService = {
  listLayers(locationSig: string): Promise<LayerEntry[]>
  getLayerBySig?(layerSig: string): Promise<LayerContent | null>
  getLayerContent?(locationSig: string, layerSig: string): Promise<LayerContent | null>
}

type CursorState = {
  locationSig: string
  position: number
  total: number
}

type HistoryCursor = {
  state: CursorState
  seek(position: number): void
}

type SeekOutcome = {
  count: number
  timedOut: boolean
}

type WalkResult = {
  position: number
  layerSig: string
  declared: number
  forward: number
  backward: number
  forwardTimedOut: boolean
  backwardTimedOut: boolean
  undoConsistent: boolean
  declaredMatch: boolean
}

// Hard ceiling on a single seek+render cycle. If no `render:cell-count`
// arrives within this window we record the step as timedOut.
const SEEK_TIMEOUT_MS = 8000

// ShowCellDrone streams partial counts as tiles materialise. We treat
// the render as "settled" only after this much idle time since the
// most recent emit. Empirically 300ms is enough to capture the final
// count on warm OPFS — the streaming bursts are sub-50ms apart, then
// the stream stops. A larger window would just inflate walk time
// without changing the captured count.
const SETTLE_IDLE_MS = 300

const SHOW_HIDDEN_KEY = 'hc:show-hidden'

export class VerifyHistoryQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'verify-history'
  override readonly aliases = ['vh', 'check-history']

  override description =
    "Walk the current location's history forward and backward; verify undo and redo render the same tile count at every position"

  protected async execute(_args: string): Promise<void> {
    const cursor = window.ioc.get<HistoryCursor>('@diamondcoreprocessor.com/HistoryCursorService')
    const history = window.ioc.get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!cursor || !history) {
      EffectBus.emit('toast:show', {
        type: 'warning',
        title: 'verify-history',
        message: 'history service unavailable',
      })
      return
    }

    const locationSig = cursor.state.locationSig
    if (!locationSig) {
      EffectBus.emit('toast:show', {
        type: 'warning',
        title: 'verify-history',
        message: 'no current location',
      })
      return
    }

    const entries = await history.listLayers(locationSig)
    if (entries.length === 0) {
      EffectBus.emit('toast:show', {
        type: 'info',
        title: 'verify-history',
        message: 'no history entries at this location',
      })
      return
    }

    const originalPosition = cursor.state.position
    const originalShowHidden = localStorage.getItem(SHOW_HIDDEN_KEY) === '1'

    EffectBus.emit('toast:show', {
      type: 'info',
      title: 'verify-history',
      message: `walking ${entries.length} entries (forward + backward)…`,
      duration: 2000,
    })

    // Force show-hidden ON so the rendered cell count includes every
    // child sig regardless of the user's hide preference. Restored in
    // the finally block — we never leave the UI in a different state
    // than we found it.
    localStorage.setItem(SHOW_HIDDEN_KEY, '1')
    EffectBus.emit('visibility:show-hidden', { active: true })

    const total = entries.length
    let results: WalkResult[] = []

    try {
      // Pre-resolve declared counts for every entry so we don't need
      // to interleave OPFS reads with the seeks.
      const declared: number[] = new Array(total + 1).fill(0)
      const layerSigs: string[] = new Array(total + 1).fill('')
      for (let i = 0; i < total; i++) {
        const entry = entries[i]
        const content = await this.#resolveLayer(history, locationSig, entry.layerSig)
        declared[i + 1] = Array.isArray(content?.children) ? content!.children!.length : 0
        layerSigs[i + 1] = entry.layerSig
      }

      // Forward walk: 0 → total. Each position bumped by one from the
      // previous so seek() can't early-return on equal positions.
      cursor.seek(0)
      await this.#waitIdle()
      const forward: SeekOutcome[] = new Array(total + 1)
      forward[0] = await this.#sampleAt(cursor, 0)
      for (let p = 1; p <= total; p++) {
        forward[p] = await this.#sampleAt(cursor, p)
      }

      // Backward walk: total → 0. Same idea in reverse.
      cursor.seek(total)
      await this.#waitIdle()
      const backward: SeekOutcome[] = new Array(total + 1)
      backward[total] = await this.#sampleAt(cursor, total)
      for (let p = total - 1; p >= 0; p--) {
        backward[p] = await this.#sampleAt(cursor, p)
      }

      // Assemble per-position results.
      for (let p = 0; p <= total; p++) {
        const f = forward[p]
        const b = backward[p]
        results.push({
          position: p,
          layerSig: layerSigs[p],
          declared: declared[p],
          forward: f.count,
          backward: b.count,
          forwardTimedOut: f.timedOut,
          backwardTimedOut: b.timedOut,
          undoConsistent: !f.timedOut && !b.timedOut && f.count === b.count,
          declaredMatch: !f.timedOut && f.count === declared[p],
        })
      }
    } finally {
      cursor.seek(originalPosition)
      localStorage.setItem(SHOW_HIDDEN_KEY, originalShowHidden ? '1' : '0')
      EffectBus.emit('visibility:show-hidden', { active: originalShowHidden })
    }

    const undoFailures = results.filter(r => !r.undoConsistent)
    const declaredFailures = results.filter(r => !r.declaredMatch)
    const undoSummary = `${results.length - undoFailures.length}/${results.length} undo-consistent`
    const declaredSummary = `${results.length - declaredFailures.length}/${results.length} match declared`

    // eslint-disable-next-line no-console
    console.group(`[verify-history] ${undoSummary} · ${declaredSummary}`)
    // eslint-disable-next-line no-console
    console.table(results.map(r => ({
      pos: r.position,
      declared: r.declared,
      fwd: r.forward,
      bwd: r.backward,
      undoOk: r.undoConsistent,
      declaredOk: r.declaredMatch,
      layer: r.layerSig ? r.layerSig.slice(0, 12) + '…' : '(start)',
    })))
    if (undoFailures.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[verify-history] undo-inconsistent positions:', undoFailures)
    }
    // eslint-disable-next-line no-console
    console.groupEnd()

    EffectBus.emit('toast:show', {
      type: undoFailures.length === 0 ? 'success' : 'warning',
      title: 'verify-history',
      message: undoFailures.length === 0
        ? `${undoSummary} (${declaredSummary})`
        : `${undoSummary} · ${declaredSummary} — see console for details`,
      duration: undoFailures.length === 0 ? 7000 : 14000,
    })
  }

  /**
   * Resolve a layer's content. Prefers `getLayerBySig` (cross-bag,
   * O(1) cache) and falls back to `getLayerContent`. Returns null on
   * resolution failure — caller defaults declared count to 0 in that
   * case.
   */
  #resolveLayer = async (
    history: HistoryService,
    locationSig: string,
    layerSig: string,
  ): Promise<LayerContent | null> => {
    if (history.getLayerBySig) {
      try {
        const c = await history.getLayerBySig(layerSig)
        if (c) return c
      } catch { /* fall through */ }
    }
    if (history.getLayerContent) {
      try {
        return await history.getLayerContent(locationSig, layerSig)
      } catch { /* fall through */ }
    }
    return null
  }

  /**
   * Seek to `position` and capture the post-seek rendered cell count.
   * If the cursor is already at `position`, jumps to a different
   * position first so the next seek triggers a fresh render — without
   * this dance the cursor's seek() would early-return on equal
   * positions and no `render:cell-count` would fire.
   */
  #sampleAt = async (cursor: HistoryCursor, position: number): Promise<SeekOutcome> => {
    if (cursor.state.position === position) {
      const total = cursor.state.total
      const away = position === 0 ? Math.min(1, total) : 0
      if (away !== position) {
        await this.#seekAndAwaitRender(cursor, away)
      }
    }
    return this.#seekAndAwaitRender(cursor, position)
  }

  /** Idle pause used between walk phases so the previous direction's
   *  trailing emits don't bleed into the next direction's first sample. */
  #waitIdle = (): Promise<void> => new Promise(r => setTimeout(r, SETTLE_IDLE_MS))

  #seekAndAwaitRender = async (
    cursor: HistoryCursor,
    position: number,
  ): Promise<SeekOutcome> => {
    return new Promise<SeekOutcome>((resolve) => {
      let hardTimer: ReturnType<typeof setTimeout> | null = null
      let settleTimer: ReturnType<typeof setTimeout> | null = null
      let settled = false
      // EffectBus.on replays the last emitted value SYNCHRONOUSLY
      // during subscription. That replay reflects the PRE-seek render
      // — ignore it and only consume emits that arrive AFTER our seek.
      let initialReplayDone = false
      // ShowCellDrone streams partial counts (0 → 1 → 2 → ... → N) as
      // tiles materialise. We track the most recent count and resolve
      // once the stream goes quiet for SETTLE_IDLE_MS.
      let lastCount = -1
      // Initialise unsub to a no-op so the synchronous replay
      // invocation of the handler — which can fire before EffectBus.on
      // returns — has a safe reference (avoids TDZ).
      let unsub: () => void = () => {}

      const finish = (count: number, timedOut: boolean): void => {
        if (settled) return
        settled = true
        if (hardTimer) clearTimeout(hardTimer)
        if (settleTimer) clearTimeout(settleTimer)
        unsub()
        resolve({ count, timedOut })
      }

      unsub = EffectBus.on<{ count: number }>('render:cell-count', (payload) => {
        if (!initialReplayDone) return
        const count = typeof payload?.count === 'number' ? payload.count : -1
        lastCount = count
        if (settleTimer) clearTimeout(settleTimer)
        settleTimer = setTimeout(() => finish(lastCount, false), SETTLE_IDLE_MS)
      })
      initialReplayDone = true

      hardTimer = setTimeout(() => finish(lastCount, lastCount === -1), SEEK_TIMEOUT_MS)
      cursor.seek(position)
    })
  }
}

const _verifyHistory = new VerifyHistoryQueenBee()
window.ioc.register('@diamondcoreprocessor.com/VerifyHistoryQueenBee', _verifyHistory)
