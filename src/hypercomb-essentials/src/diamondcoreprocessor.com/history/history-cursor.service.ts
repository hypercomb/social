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
import { diffLayers } from './layer-diff.js'

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
  /**
   * When true, undo/redo jump by "group" — skipping edit-only layers and
   * landing on the earliest cell add/remove in the target group.
   * Off by default; toggled from the history viewer header.
   */
  groupStepEnabled: boolean
}

export class HistoryCursorService extends EventTarget {

  #locationSig = ''
  #position = 0
  #layers: Array<LayerEntry & { index: number }> = []

  // Last-fetched layer content, keyed by layer signature
  #cachedLayerSig: string | null = null
  #cachedContent: LayerContent | null = null

  // Per-signature content cache used by group-step walking so repeated
  // undo/redo presses never re-read OPFS for the same layer.
  readonly #contentBySig = new Map<string, LayerContent | null>()

  #groupStepEnabled: boolean = HistoryCursorService.#loadGroupStep()

  get state(): CursorState {
    const entry = this.#position > 0 ? this.#layers[this.#position - 1] : null
    return {
      locationSig: this.#locationSig,
      position: this.#position,
      total: this.#layers.length,
      rewound: this.#layers.length > 0 && this.#position < this.#layers.length,
      at: entry?.at ?? 0,
      groupStepEnabled: this.#groupStepEnabled,
    }
  }

  get groupStepEnabled(): boolean {
    return this.#groupStepEnabled
  }

  setGroupStepEnabled(on: boolean): void {
    const next = !!on
    if (next === this.#groupStepEnabled) return
    this.#groupStepEnabled = next
    HistoryCursorService.#saveGroupStep(next)
    this.#emit()
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
    if (!historyService) {
      console.log('[cursor.load] skip: no HistoryService', { locationSig: locationSig?.slice(0, 8) })
      return
    }

    this.#layers = await historyService.listLayers(locationSig)
    console.log('[cursor.load] read', this.#layers.length, 'markers', { locationSig: locationSig?.slice(0, 8), prevSig: this.#locationSig?.slice(0, 8), prevPos: this.#position })

    // Self-heal: lineages with on-disk tiles but no recorded history
    // (e.g. data created before the merkle commits existed) get their
    // first marker captured on first view. The committer's
    // bootstrapIfEmpty inspects the bag and only commits when it's
    // truly empty — non-destructive, idempotent, and silently a no-op
    // on subsequent loads.
    //
    // Synchronous attempt first (covers the typical case where Store
    // is already initialised). If that doesn't populate the bag (e.g.
    // Store.initialize() hasn't completed yet), kick off a background
    // poll-and-retry that wakes the cursor up the moment markers exist.
    if (this.#layers.length === 0) {
      const committer = get<{ bootstrapIfEmpty: (segments?: string[]) => Promise<void> }>(
        '@diamondcoreprocessor.com/LayerCommitter'
      )
      if (committer?.bootstrapIfEmpty) {
        try {
          await committer.bootstrapIfEmpty()
          this.#layers = await historyService.listLayers(locationSig)
        } catch { /* best-effort — never block navigation on bootstrap */ }
      }
      // Background retry loop: store may not be initialised yet, or
      // an earlier auto-bootstrap may still be in flight. Poll up to
      // ~10s; the moment markers appear, refresh the cursor.
      if (this.#layers.length === 0) {
        void this.#retryUntilMarkersAppear(locationSig)
      }
    }

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

    console.log('[cursor.load] done', { total: this.#layers.length, position: this.#position, locationSig: locationSig?.slice(0, 8) })
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
   * Externally-triggered refresh for a given lineage. Called by
   * LayerCommitter immediately after every bootstrap (whether the
   * bootstrap committed or skipped because the bag was already
   * populated). Solves the race where the cursor was loaded BEFORE
   * markers existed and never re-read after they appeared.
   *
   * Adoption: if cursor has no locationSig yet, we adopt the one we
   * were called with — this lets the committer's auto-bootstrap
   * (which runs from Lineage 'change' before any cursor.load) seed
   * the cursor with the right lineage immediately.
   *
   * If cursor is currently bound to a different lineage, this is a
   * no-op — the user navigated away.
   */
  async refreshForLocation(locSig: string): Promise<void> {
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!historyService) return
    if (this.#locationSig && this.#locationSig !== locSig) return

    const fresh = await historyService.listLayers(locSig)

    // Cheap no-op check: same lineage, same marker count, same head sig →
    // nothing changed since last refresh, skip the emit. Critical for
    // avoiding an emit storm when bootstrap fires for every one of the
    // ~20 Lineage 'change' events that cascade through boot.
    const sameSig = this.#locationSig === locSig
    const sameLength = this.#layers.length === fresh.length
    const sameHead = sameLength && fresh.length > 0
      && this.#layers[fresh.length - 1].layerSig === fresh[fresh.length - 1].layerSig
    if (sameSig && sameLength && (fresh.length === 0 || sameHead)) {
      // No state change — return silently, no emit, no log noise.
      return
    }

    const wasAtLatest = this.#position >= this.#layers.length
    const adopted = !this.#locationSig
    if (adopted) this.#locationSig = locSig
    this.#layers = fresh
    if (wasAtLatest || adopted) this.#position = this.#layers.length
    console.log('[cursor.refreshForLocation]', { locSig: locSig.slice(0, 8), total: fresh.length, position: this.#position, adopted })
    this.#emit()
  }

  /**
   * Background retry: poll listLayers every 250 ms (capped at ~10 s).
   * The moment markers appear (e.g. an auto-bootstrap landed slightly
   * after this cursor.load returned), refresh the cursor and emit so
   * the history viewer updates without requiring further user action.
   *
   * Idempotent and capped — no leaked timers.
   */
  async #retryUntilMarkersAppear(locationSig: string): Promise<void> {
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!historyService) return
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250))
      // Bail if cursor moved to a different lineage — the new
      // load() will run its own retry if needed.
      if (this.#locationSig !== locationSig) return
      // Re-trigger a bootstrap attempt: harmless if bag is now
      // populated (no-op), critical if Store just became ready.
      const committer = get<{ bootstrapIfEmpty: (segments?: string[]) => Promise<void> }>(
        '@diamondcoreprocessor.com/LayerCommitter'
      )
      if (committer?.bootstrapIfEmpty) {
        try { await committer.bootstrapIfEmpty() } catch { /* */ }
      }
      const fresh = await historyService.listLayers(locationSig)
      if (fresh.length > 0) {
        const wasAtLatest = this.#position >= this.#layers.length
        this.#layers = fresh
        if (wasAtLatest) this.#position = this.#layers.length
        this.#emit()
        return
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
   * Position 0 is the pre-history / empty state. Layers exist above it;
   * undo can walk all the way back to 0 so the user returns to the
   * default. At 0, layerContentAtCursor() returns an empty snapshot and
   * the renderer clears the grid.
   */
  seek(position: number): void {
    const clamped = Math.max(0, Math.min(position, this.#layers.length))
    if (clamped === this.#position) return
    this.#position = clamped
    this.#emit()
  }

  /**
   * Step backward. Minimal step (one layer) by default; when group-step is
   * on, skip edit-only layers and land on the earliest cell add/remove in
   * the preceding group. Walks all the way down to position 0 (empty
   * pre-history state).
   */
  undo(): void {
    if (this.#groupStepEnabled) {
      void this.#undoGroupStep()
      return
    }
    if (this.#position > 0) this.seek(this.#position - 1)
  }

  /**
   * Step forward. Minimal step by default; when group-step is on, skip
   * edit-only layers and land on the earliest cell add/remove of the next
   * group.
   */
  redo(): void {
    if (this.#groupStepEnabled) {
      void this.#redoGroupStep()
      return
    }
    if (this.#position < this.#layers.length) this.seek(this.#position + 1)
  }

  /**
   * Group-step undo. Walk backward from the current position skipping
   * edit-only layers (content, tags, notes, layout). When a cell
   * add/remove is hit, land there — then continue walking back while
   * the preceding layer is ALSO a cell-op AND its timestamp is within
   * GROUP_TIME_WINDOW_MS. That coalesces a multi-select burst (N tiles
   * added in one gesture = N adjacent cell-op layers ~microseconds
   * apart) into a single jump, but keeps separate gestures on separate
   * groups even when they're both cell ops.
   */
  async #undoGroupStep(): Promise<void> {
    if (this.#position <= 0) return

    // Walk back skipping edit-only layers until we find a cell add/remove.
    // If we walk off the bottom (no cell ops between here and floor), land
    // at position 0 (pre-history / empty state) — stepping is allowed to
    // reach "before anything" via group-step too.
    let target = this.#position - 1
    while (target >= 1 && !(await this.#isCellsAtPosition(target))) {
      target -= 1
    }
    if (target < 1) {
      this.seek(0)
      return
    }
    while (target > 1 && (await this.#inSameCellsBurst(target))) {
      target -= 1
    }
    this.seek(target)
  }

  /**
   * Group-step redo. Walk forward skipping edit-only layers until we hit
   * a cell add/remove. That position IS the earliest of the next burst
   * (we just crossed the boundary into it); further redoes step past the
   * rest of the burst.
   */
  async #redoGroupStep(): Promise<void> {
    const total = this.#layers.length
    if (this.#position >= total) return

    let target = this.#position + 1
    while (target <= total && !(await this.#isCellsAtPosition(target))) {
      target += 1
    }
    if (target > total) {
      this.seek(total)
      return
    }
    this.seek(target)
  }

  /**
   * True when both the layer at `position` and the layer at `position-1`
   * are cell add/remove layers AND their timestamps are within the group
   * burst window. This is how we distinguish "multi-select added 3 tiles
   * in one gesture" (all adjacent in time) from "user added a tile
   * earlier, then added another one ten seconds later" (same kind of op,
   * different gestures).
   */
  async #inSameCellsBurst(position: number): Promise<boolean> {
    if (position < 2) return false
    const current = this.#layers[position - 1]
    const previous = this.#layers[position - 2]
    if (!current || !previous) return false
    if (Math.abs(current.at - previous.at) > HistoryCursorService.#GROUP_BURST_WINDOW_MS) return false
    if (!(await this.#isCellsAtPosition(position))) return false
    if (!(await this.#isCellsAtPosition(position - 1))) return false
    return true
  }

  /**
   * True when the layer at the given 1-based cursor position introduces
   * or removes a cell relative to the preceding layer (or relative to
   * empty, for the first-ever layer).
   */
  async #isCellsAtPosition(position: number): Promise<boolean> {
    if (position < 1 || position > this.#layers.length) return false
    const currentSig = this.#layers[position - 1].layerSig
    const currentContent = await this.#loadContentForSig(currentSig)
    if (!currentContent) return false
    let previousContent: LayerContent | null = null
    if (position > 1) {
      const prevSig = this.#layers[position - 2].layerSig
      previousContent = await this.#loadContentForSig(prevSig)
    }
    const diffs = diffLayers(previousContent, currentContent)
    for (const diff of diffs) {
      if (diff.kind === 'cell-added' || diff.kind === 'cell-removed') return true
    }
    return false
  }

  /**
   * Resolve layer content by signature, memoized per-instance.
   *
   * Routes through HistoryService.getLayerContent which reads marker
   * files directly from the lineage's bag. Falls back to the legacy
   * Store.getResource pool only if the bag lookup misses (covers
   * pre-merkle layers that are still pool-resident).
   */
  async #loadContentForSig(signature: string): Promise<LayerContent | null> {
    if (this.#contentBySig.has(signature)) return this.#contentBySig.get(signature) ?? null
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (historyService && this.#locationSig) {
      const fromBag = await historyService.getLayerContent(this.#locationSig, signature)
      if (fromBag) {
        this.#contentBySig.set(signature, fromBag)
        return fromBag
      }
    }
    // Legacy fallback: Store pool
    const store = get<{ getResource: (sig: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
    if (!store) { this.#contentBySig.set(signature, null); return null }
    try {
      const blob = await store.getResource(signature)
      if (!blob) { this.#contentBySig.set(signature, null); return null }
      const parsed = JSON.parse(await blob.text()) as Partial<LayerContent>
      const content: LayerContent = {
        name: parsed.name ?? '',
        cells: parsed.cells ?? [],
        merkles: parsed.merkles ?? [],
        hidden: parsed.hidden ?? [],
      }
      this.#contentBySig.set(signature, content)
      return content
    } catch {
      this.#contentBySig.set(signature, null)
      return null
    }
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
   * Reads directly from the bag (the source of truth in the new
   * layout) so undo/redo never blanks out on a cold Store cache.
   * Cached by layer signature so repeated reads during a single
   * render hit memory, not OPFS.
   */
  async layerContentAtCursor(): Promise<LayerContent | null> {
    // Position 0 with existing layers = pre-history / "default empty"
    // state the user reached by undoing past the first layer. Return a
    // concrete empty snapshot so ShowCellDrone's rewound-render path
    // clears the grid instead of falling through to live-state tiles.
    if (this.#position === 0) {
      if (this.#layers.length === 0) return null
      const empty: LayerContent = { name: '', cells: [], merkles: [], hidden: [] }
      this.#cachedLayerSig = null
      this.#cachedContent = empty
      return empty
    }
    const entry = this.#layers[this.#position - 1]

    if (this.#cachedLayerSig === entry.layerSig && this.#cachedContent) {
      return this.#cachedContent
    }

    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!historyService) return null

    const content = await historyService.getLayerContent(this.#locationSig, entry.layerSig)
    if (!content) return null

    this.#cachedLayerSig = entry.layerSig
    this.#cachedContent = content
    return content
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

  // ── Group-step toggle persistence (localStorage) ───────────
  //
  // Setting is global (not per-location). Off by default — the minimal
  // per-layer step is the canonical behaviour; group-step is an opt-in
  // coarser walk layered on top.

  static readonly #GROUP_STEP_KEY = 'hc:history-group-step'

  // Two cell-op layers whose timestamps are within this window are
  // treated as the same multi-select burst (one group). Anything beyond
  // this is a separate user gesture — a new group boundary. 500ms is
  // comfortably wider than the microtask-scheduled commit path used by
  // LayerCommitter but narrow enough that two independent clicks seconds
  // apart stay distinct.
  static readonly #GROUP_BURST_WINDOW_MS = 500

  static #loadGroupStep(): boolean {
    try {
      return localStorage.getItem(HistoryCursorService.#GROUP_STEP_KEY) === '1'
    } catch {
      return false
    }
  }

  static #saveGroupStep(on: boolean): void {
    try {
      if (on) localStorage.setItem(HistoryCursorService.#GROUP_STEP_KEY, '1')
      else localStorage.removeItem(HistoryCursorService.#GROUP_STEP_KEY)
    } catch { /* storage unavailable */ }
  }
}

const _historyCursorService = new HistoryCursorService()
;(window as any).ioc.register('@diamondcoreprocessor.com/HistoryCursorService', _historyCursorService)
