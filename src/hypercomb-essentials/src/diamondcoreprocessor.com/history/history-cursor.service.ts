// diamondcoreprocessor.com/history/history-cursor.service.ts
//
// Layer-based history cursor. Every user-intent boundary produces a new
// layer via LayerCommitter (synchronize → commitLayer). History is the
// list of layer entries; undo/redo is just walking that list.
//
// Undo/redo is naturally safe: edits always append a new layer at head,
// so previous layers are immutable and can be re-read any time. Nothing
// rewrites history. Resources referenced by past layers are never GC'd,
// so rewinding always resolves to real content.
import { EffectBus } from '@hypercomb/core'
import type { HistoryService, LayerContent, LayerEntry } from './history.service.js'

export type CursorState = {
  /** History bag signature for the current location. */
  locationSig: string
  /** Current cursor position (1-based index into layers). 0 = no history. */
  position: number
  /** Total number of layer entries in this bag. */
  total: number
  /** true when cursor is not at the latest layer. */
  rewound: boolean
  /** Timestamp (ms epoch) of the layer entry at cursor position. 0 = no history. */
  at: number
}

export class HistoryCursorService extends EventTarget {

  #locationSig = ''
  #position = 0
  #layers: Array<LayerEntry & { index: number }> = []

  // Last-fetched layer content, keyed by layer signature
  #cachedLayerSig: string | null = null
  #cachedContent: LayerContent | null = null

  get state(): CursorState {
    const entry = this.#position > 0 ? this.#layers[this.#position - 1] : null
    return {
      locationSig: this.#locationSig,
      position: this.#position,
      total: this.#layers.length,
      rewound: this.#layers.length > 0 && this.#position < this.#layers.length,
      at: entry?.at ?? 0,
    }
  }

  /**
   * Load (or reload) layer history for a location. Restores persisted
   * cursor position so rewound state survives page refresh.
   */
  async load(locationSig: string): Promise<void> {
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!historyService) return

    this.#layers = await historyService.listLayers(locationSig)

    if (this.#locationSig !== locationSig) {
      this.#locationSig = locationSig
      this.#cachedLayerSig = null
      this.#cachedContent = null
      const saved = this.#loadPersistedPosition(locationSig)
      this.#position = (saved !== null && saved < this.#layers.length) ? saved : this.#layers.length
    } else if (this.#position > this.#layers.length) {
      this.#position = this.#layers.length
    }

    this.#emit()
  }

  /**
   * Called after LayerCommitter appends a new layer. If cursor was at
   * head, stay at head (absorb the new layer). Otherwise keep the
   * rewound position — the user is viewing history.
   *
   * Single emit — no intermediate rewound flash.
   */
  async onNewLayer(): Promise<void> {
    const wasAtLatest = this.#position >= this.#layers.length
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!historyService) return

    this.#layers = await historyService.listLayers(this.#locationSig)
    if (wasAtLatest) this.#position = this.#layers.length
    this.#emit()
  }

  /** Move cursor to an absolute position (1-based, clamped). */
  seek(position: number): void {
    const clamped = Math.max(0, Math.min(position, this.#layers.length))
    if (clamped === this.#position) return
    this.#position = clamped
    this.#emit()
  }

  /** Step backward one layer. */
  undo(): void {
    if (this.#position > 0) this.seek(this.#position - 1)
  }

  /** Step forward one layer. */
  redo(): void {
    if (this.#position < this.#layers.length) this.seek(this.#position + 1)
  }

  /** Jump to latest (exit rewind mode). */
  jumpToLatest(): void {
    this.seek(this.#layers.length)
  }

  /**
   * Seek to the last layer at or before the given timestamp.
   * Returns the position it landed on (0 if no layers before timestamp).
   */
  seekToTime(timestamp: number): number {
    if (this.#layers.length === 0) return 0

    let pos = 0
    for (let i = 0; i < this.#layers.length; i++) {
      if (this.#layers[i].at <= timestamp) pos = i + 1
      else break
    }

    this.seek(pos)
    return pos
  }

  /**
   * All layer timestamps for this location, in order.
   * Used by GlobalTimeClock for stepping across locations.
   */
  get allTimestamps(): number[] {
    return this.#layers.map(entry => entry.at)
  }

  /**
   * Resolve the LayerContent for the entry at the cursor position.
   * Cached by layer signature so repeated reads during a single render
   * hit memory, not OPFS.
   */
  async layerContentAtCursor(): Promise<LayerContent | null> {
    if (this.#position === 0) return null
    const entry = this.#layers[this.#position - 1]

    if (this.#cachedLayerSig === entry.layerSig && this.#cachedContent) {
      return this.#cachedContent
    }

    const store = get<{ getResource: (sig: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
    if (!store) return null

    try {
      const blob = await store.getResource(entry.layerSig)
      if (!blob) return null
      const content = JSON.parse(await blob.text()) as LayerContent
      this.#cachedLayerSig = entry.layerSig
      this.#cachedContent = content
      return content
    } catch {
      return null
    }
  }

  /** Last-fetched layer content, for synchronous reads after a prior await. */
  peekContent(): LayerContent | null {
    return this.#cachedContent
  }

  #emit(): void {
    this.#persistPosition()
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit<CursorState>('history:cursor-changed', this.state)
  }

  // ── Cursor persistence (localStorage) ──────────────────────

  static readonly #STORAGE_PREFIX = 'hc:history-cursor:'

  #persistPosition(): void {
    if (!this.#locationSig) return
    const key = HistoryCursorService.#STORAGE_PREFIX + this.#locationSig
    if (this.#position >= this.#layers.length) {
      // At head — drop the persisted entry
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, String(this.#position))
    }
  }

  #loadPersistedPosition(locationSig: string): number | null {
    const raw = localStorage.getItem(HistoryCursorService.#STORAGE_PREFIX + locationSig)
    if (raw === null) return null
    const n = parseInt(raw, 10)
    return isNaN(n) ? null : n
  }
}

const _historyCursorService = new HistoryCursorService()
;(window as any).ioc.register('@diamondcoreprocessor.com/HistoryCursorService', _historyCursorService)
