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
   *
   * Warms the resource cache in the background for every signature
   * referenced by any historical layer at this location. Undo/redo
   * targets are in memory by the time the user presses the shortcut —
   * no cold load, no empty-texture flash.
   */
  async load(locationSig: string): Promise<void> {
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!historyService) return

    this.#layers = await historyService.listLayers(locationSig)

    if (this.#locationSig !== locationSig) {
      this.#locationSig = locationSig
      this.#cachedLayerSig = null
      this.#cachedContent = null
      // Always start a fresh page load at head, regardless of any
      // persisted rewound position. Restoring a rewound cursor from
      // localStorage would replay a historical layer at render time
      // (ShowCellDrone's rewound-render path), which caused the
      // "crunched tiles after refresh" regression when any of those
      // historical layers had incomplete layout state. Scrubbed
      // position as a convenience across refreshes can be reintroduced
      // once historical layers are verifiably consistent.
      this.#position = this.#layers.length
      // Background warmup: resolve every signature inside every
      // historical layer so undo/redo targets are already cached.
      // Failures are non-fatal — we just move on.
      void this.#warmupHistoricalResources()
    } else if (this.#position > this.#layers.length) {
      this.#position = this.#layers.length
    }

    this.#emit()
  }

  /**
   * Walk every historical layer at the current location and warm every
   * signature reachable through the layer graph — layer sigs, the
   * propsSigs they reference, the image/layout sigs inside those
   * propsSigs, and so on until fixed-point. Each resolve populates the
   * Store's signature cache, so by the end every past state is in
   * memory. Undo/redo never cold-loads.
   *
   * Traversal is iterative BFS over distinct signatures — a signature
   * is resolved at most once even if it appears in many layers.
   */
  async #warmupHistoricalResources(): Promise<void> {
    const store = get<{
      resolve: <T>(v: unknown) => Promise<T>
      collectSignatures: (v: unknown, out?: Set<string>) => Set<string>
    }>('@hypercomb.social/Store')
    if (!store?.resolve) return

    const visited = new Set<string>()
    const frontier: string[] = this.#layers.map(entry => entry.layerSig)

    while (frontier.length > 0) {
      const batch = frontier.splice(0, frontier.length)
      const fresh = batch.filter(signature => {
        if (visited.has(signature)) return false
        visited.add(signature)
        return true
      })
      if (fresh.length === 0) continue
      const resolved = await Promise.all(
        fresh.map(signature => store.resolve<unknown>(signature).catch(() => null))
      )
      const nextSignatures = new Set<string>()
      for (const content of resolved) {
        if (content && typeof content === 'object') {
          store.collectSignatures(content, nextSignatures)
        }
      }
      for (const signature of nextSignatures) {
        if (!visited.has(signature)) frontier.push(signature)
      }
    }
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

  /**
   * Move cursor to an absolute position (1-based, clamped).
   *
   * When layers exist, the cursor never sits below position 1 — "fully
   * rewound" reveals the oldest recorded state, not the pre-history
   * empty state. The UI's START anchor row is the visual terminator for
   * that floor; there is no reachable cursor position beyond it. If no
   * layers exist at all, position 0 is allowed (there's nothing to
   * show but empty).
   */
  seek(position: number): void {
    const floor = this.#layers.length > 0 ? 1 : 0
    const clamped = Math.max(floor, Math.min(position, this.#layers.length))
    if (clamped === this.#position) return
    this.#position = clamped
    this.#emit()
  }

  /** Step backward one layer, but never past the oldest recorded state. */
  undo(): void {
    const floor = this.#layers.length > 0 ? 1 : 0
    if (this.#position > floor) this.seek(this.#position - 1)
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
      // Stored layer resources may be sparse (missing fields that were
      // empty at commit time). Normalise with defaults so every consumer
      // can iterate Object.entries / Object.keys without null guards.
      const parsed = JSON.parse(await blob.text()) as Partial<LayerContent>
      const content: LayerContent = {
        version: 2,
        cells: parsed.cells ?? [],
        hidden: parsed.hidden ?? [],
        contentByCell: parsed.contentByCell ?? {},
        tagsByCell: parsed.tagsByCell ?? {},
        notesByCell: parsed.notesByCell ?? {},
        bees: parsed.bees ?? [],
        dependencies: parsed.dependencies ?? [],
        layoutSig: parsed.layoutSig ?? '',
        instructionsSig: parsed.instructionsSig ?? '',
      }
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
