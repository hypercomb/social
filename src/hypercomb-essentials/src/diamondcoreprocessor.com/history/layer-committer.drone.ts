// diamondcoreprocessor.com/history/layer-committer.drone.ts
//
// Single commit site for history. Listens to one event — `synchronize` —
// assembles a full layer snapshot of the current location, and commits it
// via HistoryService.commitLayer(). Deduplication is automatic: if the
// assembled layer signature matches the current head, commitLayer returns
// null and nothing is written.
//
// Drones never name an op. They mutate state, the processor dispatches
// `synchronize`, and a new numbered layer falls out. Ops are a *view*
// derived by diffLayers, never storage.
import { EffectBus, SignatureService } from '@hypercomb/core'
import type { HistoryService, LayerContent } from './history.service.js'
import type { HistoryCursorService } from './history-cursor.service.js'
import type { OrderProjection } from './order-projection.js'

type Lineage = {
  domain?: () => string
  explorerLabel?: () => string
  // Async in the live lineage; resolves to the explorer's directory
  // handle (or null when not available yet).
  explorerDir?: () => Promise<FileSystemDirectoryHandle | null> | FileSystemDirectoryHandle | null | undefined
  explorerSegments?: () => string[]
  // Walk to an arbitrary ancestor — used by the cascade to pull each
  // ancestor's directory handle. Lineage exposes this for the file
  // explorer and we reuse it here.
  tryResolve?: (
    segments: readonly string[],
    start?: FileSystemDirectoryHandle | null,
  ) => Promise<FileSystemDirectoryHandle | null>
}

type LineageStore = { hypercombRoot?: FileSystemDirectoryHandle }

type LayoutSnapshot = {
  orientation: 'flat-top' | 'point-top'
  pivot: boolean
  accent: string
  gapPx: number
  textOnly: boolean
}

/**
 * Strict FIFO commit chain. One event = one commit slot, no
 * coalescing. Every `request()` appends to the tail of a Promise
 * chain that runs `#run(payload)` in order. Layer count grows by
 * exactly one per event — that's the contract.
 *
 * Why no coalescing: the user's mental model is "every action is
 * one undo step." A multi-select delete of 5 cells emits 5
 * `cell:removed` events; each must produce its own marker so the
 * user can undo cell-by-cell. Coalescing collapses the burst into
 * one marker that undoes all 5 at once — wrong granularity.
 *
 * Serialisation is still required because each commit allocates a
 * numeric marker name (max+1 of existing markers). Two parallel
 * commits would race on that allocation.
 *
 * `payload` carries the lineage segments where the event happened,
 * letting the cascade start at the correct depth (so `abc/123`
 * created from root cascades through /abc and /, not just /).
 */
type CommitRequest = { segments: string[] | null }

class CommitMachine {
  #chain: Promise<void> = Promise.resolve()
  readonly #run: (req: CommitRequest) => Promise<void>

  constructor(run: (req: CommitRequest) => Promise<void>) {
    this.#run = run
  }

  /** Fire-and-forget enqueue. Returned chain failures are swallowed. */
  request(req: CommitRequest = { segments: null }): void {
    this.#chain = this.#chain.then(() => this.#run(req)).catch(() => { /* failures don't break the chain */ })
  }

  /**
   * Same as `request` but returns a promise that resolves when this
   * specific request finishes (success or failure). Used by bootstrap
   * paths that need to read back the bag right after the commit lands.
   */
  requestAndWait(req: CommitRequest = { segments: null }): Promise<void> {
    const ran = this.#chain.then(() => this.#run(req))
    this.#chain = ran.catch(() => { /* don't break the chain */ })
    return ran.catch(() => { /* don't reject the awaiter either */ })
  }
}

export class LayerCommitter {

  // Layout state is scattered across EffectBus effects. We subscribe at
  // construction and keep the latest value locally. Late subscribers get
  // the last-emitted value automatically (EffectBus replay).
  #layout: LayoutSnapshot = {
    orientation: 'point-top',
    pivot: false,
    accent: '',
    gapPx: 0,
    textOnly: false,
  }

  // Single serialised commit machine for this committer. Every event
  // source — per-event lifecycle, microtask-batched layout changes,
  // synchronize — calls machine.request(). The machine collapses
  // same-turn requests and serialises cross-turn ones; commitLayer
  // dedup then absorbs any redundant identical content. Together
  // they guarantee one commit per distinct state change, no more.
  //
  // Leaf + ancestors still commit as one atomic #commit() call
  // inside the machine's #run — each ancestor is a merkle-chain
  // update cascading up from the leaf.
  readonly #machine = new CommitMachine(req => this.#commit(req))

  constructor() {
    // layout:mode subscription removed — dense/spiral mode is phased
    // out. The layer's layout signature no longer carries a mode field;
    // the renderer operates only in pinned mode.
    EffectBus.on<{ flat: boolean }>('render:set-orientation', p => {
      if (p) { this.#layout = { ...this.#layout, orientation: p.flat ? 'flat-top' : 'point-top' }; this.#schedule() }
    })
    EffectBus.on<{ pivot: boolean }>('render:set-pivot', p => {
      if (p != null) { this.#layout = { ...this.#layout, pivot: !!p.pivot }; this.#schedule() }
    })
    EffectBus.on<{ name: string }>('overlay:neon-color', p => {
      if (p?.name) { this.#layout = { ...this.#layout, accent: p.name }; this.#schedule() }
    })
    EffectBus.on<{ gapPx: number }>('render:set-gap', p => {
      if (p?.gapPx != null) { this.#layout = { ...this.#layout, gapPx: p.gapPx }; this.#schedule() }
    })
    EffectBus.on<{ textOnly: boolean }>('render:set-text-only', p => {
      if (p?.textOnly != null) { this.#layout = { ...this.#layout, textOnly: !!p.textOnly }; this.#schedule() }
    })

    // Layers are minted ONLY when a real thing happens — a cell is
    // added/removed/edited/hidden/unhidden, or a tag/saved event.
    // No `synchronize` subscription, no `render:cell-count` baseline,
    // no batched "wait until things settle" commits. One event = one
    // commit attempt. The bag's per-event timeline IS the user's
    // actions; nothing speculative is allowed in.
    //
    // Payload may carry `segments` — the lineage where the event
    // happened. When present, cascade starts at THAT depth so a tile
    // created at /abc cascades through /abc → / regardless of which
    // page the user is currently looking at.
    EffectBus.on<{ cell?: string; segments?: string[] }>('cell:added',   p => this.#queueCommit(p?.segments))
    EffectBus.on<{ cell?: string; segments?: string[] }>('cell:removed', p => this.#queueCommit(p?.segments))
    EffectBus.on<{ cell?: string; segments?: string[] }>('tile:saved',   p => this.#queueCommit(p?.segments))
    EffectBus.on<{ cell?: string; segments?: string[] }>('tags:changed', p => this.#queueCommit(p?.segments))
    EffectBus.on<{ cell?: string; segments?: string[] }>('tile:hidden',  p => this.#queueCommit(p?.segments))
    EffectBus.on<{ cell?: string; segments?: string[] }>('tile:unhidden',p => this.#queueCommit(p?.segments))

    // Self-heal trigger: poll for both Lineage and a fully-initialised
    // Store to be available, then subscribe to Lineage 'change' so every
    // navigation re-triggers a bootstrap check. Polling is needed because
    // the Store registers synchronously but populates its OPFS handles
    // (store.history, store.hypercombRoot) async via Store.initialize() —
    // there's no event signal for that completion. Capped at ~10s; if
    // services never appear, the explicit cursor.load path still triggers
    // bootstrap on the next user interaction.
    void this.#waitForServicesAndStartBootstrap()
  }

  async #waitForServicesAndStartBootstrap(): Promise<void> {
    console.log('[bootstrap] polling for Lineage + Store init...')
    for (let attempt = 0; attempt < 100; attempt++) {
      const lineage = get<Lineage & EventTarget>('@hypercomb.social/Lineage')
      const store = get<{ history?: FileSystemDirectoryHandle; hypercombRoot?: FileSystemDirectoryHandle }>(
        '@hypercomb.social/Store'
      )
      if (lineage && store?.history && store?.hypercombRoot) {
        console.log('[bootstrap] services ready, subscribing to Lineage changes', { attempt })
        // Throttle: Lineage emits 'change' many times during boot/nav
        // (followLocation + materialization + URL syncs). Without a
        // throttle each one fires a bootstrap which fires a cursor
        // refresh — emit storm + redundant OPFS reads. Coalesce to one
        // bootstrap per ~150 ms tail, which is faster than any human
        // navigation but cheap compared to per-event firing.
        let throttleTimer: ReturnType<typeof setTimeout> | null = null
        const tryBootstrap = () => { void this.bootstrapIfEmpty().catch(err => console.warn('[bootstrap] failed', err)) }
        const throttledBootstrap = () => {
          if (throttleTimer) clearTimeout(throttleTimer)
          throttleTimer = setTimeout(() => { throttleTimer = null; tryBootstrap() }, 150)
        }
        try { lineage.addEventListener?.('change', throttledBootstrap) } catch { /* not an EventTarget */ }
        tryBootstrap()   // fire once for current state immediately (no throttle)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    console.warn('[bootstrap] gave up waiting for services after ~10s')
  }

  // All commit requests — batched or per-event — route through the
  // single CommitMachine. See the class above for the state transitions.
  #schedule(): void { this.#machine.request({ segments: null }) }
  #queueCommit(segments?: string[] | null): void {
    const cleaned = Array.isArray(segments)
      ? segments.map(s => String(s ?? '').trim()).filter(Boolean)
      : null
    this.#machine.request({ segments: cleaned })
  }

  /**
   * Self-heal: ensure the lineage at `segments` has a marker reflecting
   * the current on-disk state. Inspects the bag first — only commits
   * when the bag has no canonical markers yet. Idempotent: a populated
   * bag yields a no-op, no redundant markers.
   *
   * Called from HistoryCursorService.load() so that any lineage with
   * tiles on disk but no recorded history (e.g. data created before
   * the merkle commits existed) gets its first marker captured the
   * moment it's first viewed. NON-DESTRUCTIVE: only ever appends.
   */
  // Per-locSig in-flight bootstrap promise. Coalesces concurrent
  // bootstrap calls for the same lineage so cursor.load and the
  // Lineage 'change' subscription don't both fire commits.
  readonly #bootstrapInFlight = new Map<string, Promise<void>>()

  public async bootstrapIfEmpty(segments?: string[] | null): Promise<void> {
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    if (!history || !lineage) {
      console.log('[bootstrap] skip: missing services', { history: !!history, lineage: !!lineage })
      return
    }

    // Store registers synchronously but its OPFS handles populate async
    // via Store.initialize(). If `store.history` is still undefined, we
    // can't read the bag yet — back off and let a later Lineage 'change'
    // (or a manual cursor.load) re-trigger us.
    const store = get<{ history?: FileSystemDirectoryHandle; hypercombRoot?: FileSystemDirectoryHandle }>(
      '@hypercomb.social/Store'
    )
    if (!store?.history || !store?.hypercombRoot) {
      console.log('[bootstrap] skip: store not initialized yet')
      return
    }

    const cleaned = Array.isArray(segments)
      ? segments.map(s => String(s ?? '').trim()).filter(Boolean)
      : null
    const fallback = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const segs = cleaned ?? fallback

    const locSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => segs,
    } as Lineage)

    // Coalesce concurrent calls for the same lineage.
    const existing = this.#bootstrapInFlight.get(locSig)
    if (existing) return existing

    const run = (async () => {
      const markers = await history.listLayers(locSig)
      const cursor = get<{
        onNewLayer?: () => Promise<void>
        refreshForLocation?: (locSig: string) => Promise<void>
      }>('@diamondcoreprocessor.com/HistoryCursorService')

      if (markers.length > 0) {
        console.log('[bootstrap] skip: bag has', markers.length, 'markers', { segments: segs })
        // CRITICAL: even on skip, push the bag's state into the cursor.
        // Without this, a cursor that loaded BEFORE the bag was visible
        // (e.g. before Store.initialize() finished) stays stuck at 0
        // markers despite the bag being populated. refreshForLocation
        // adopts the locSig if cursor hasn't been bound yet, so the
        // slider/history viewer wake up immediately on first bootstrap.
        if (cursor?.refreshForLocation) await cursor.refreshForLocation(locSig)
        return
      }
      // Empty bag → request a commit and await it. The cascade mints
      // the auto-seed and one marker reflecting current on-disk state,
      // then walks up to root (which also bootstraps any ancestor
      // bags along the way).
      console.log('[bootstrap] running cascade', { segments: segs })
      await this.#machine.requestAndWait({ segments: segs })
      const after = await history.listLayers(locSig)
      console.log('[bootstrap] done, bag now has', after.length, 'markers')

      // Push the new state into the cursor (same call as the skip
      // branch). refreshForLocation handles both adoption and
      // existing-cursor refresh in one method.
      if (cursor?.refreshForLocation) await cursor.refreshForLocation(locSig)
      else if (cursor?.onNewLayer) await cursor.onNewLayer()
    })()
    this.#bootstrapInFlight.set(locSig, run)
    try { await run } finally { this.#bootstrapInFlight.delete(locSig) }
  }

  async #commit(req: CommitRequest = { segments: null }): Promise<void> {
    // Never commit while cursor is rewound — the assembled state reflects
    // the past view, not a new user intent.
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursor?.state?.rewound) {
      console.log('[commit] skip: cursor rewound')
      return
    }

    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !history) {
      console.log('[commit] skip: missing lineage or history', { lineage: !!lineage, history: !!history })
      return
    }

    // Cascade: leaf → root.
    //
    // Each lineage has its own bag. A cell:added at /A/B/C produces a
    // new marker in /A/B/C's bag. Because /A/B's `merkles` array
    // captures /A/B/C's CURRENT marker sig, /A/B's marker bytes change
    // and /A/B needs a fresh marker too. Same up to the root.
    //
    // The new marker for each ancestor is computed by re-assembling
    // that ancestor's layer with its OWN explorer dir (its OPFS
    // children listing) and its OWN merkles array (re-pulled per
    // child). That fixes the previous "layers mixed up / wrong
    // lineage" symptom: each ancestor is shaped by its own state, not
    // the leaf's.
    //
    // Segments source: the event payload (when supplied — e.g. by
    // batch-create which fires per created lineage), else the global
    // Lineage (current explorer view). The payload form is what makes
    // `abc/123` typed from root cascade through /abc and /, not just /.
    const fallbackSegments = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const segments = req.segments ?? fallbackSegments

    // Walk every ancestor INCLUDING the leaf and INCLUDING root ("").
    //
    // The TARGET LINEAGE (depth === segments.length) is where the
    // event happened — re-read its disk listing so cells reflects
    // the add/remove. ANCESTORS preserve their previous cells list
    // and only swap the merkle for the immediate child that just
    // changed. That keeps the cascade strictly merkle-only at each
    // ancestor: same cells, same hidden, only one merkles entry
    // differs (pointing at the new child sig). Critical so a child
    // change doesn't drop sibling tiles from ancestor layers.
    //
    // Track the just-committed child's name + sig so each next-up
    // ancestor knows which entry to swap.
    let lastCommittedName: string | null = null
    let lastCommittedSig: string | null = null

    for (let depth = segments.length; depth >= 0; depth--) {
      const sub = segments.slice(0, depth)
      const ancestorName = depth === 0 ? '' : sub[sub.length - 1]
      const ancestorLocSig = await history.sign({
        domain: lineage.domain,
        explorerSegments: () => sub,
      } as Lineage)

      // Resolve OPFS dir for this ancestor. Only the leaf truly
      // needs it (to re-read its child listing). Ancestors preserve
      // their previous cells list, so the dir is informational only
      // (used as a fallback when no previous head exists).
      let ancestorDir: FileSystemDirectoryHandle | null = null
      const store = get<LineageStore>('@hypercomb.social/Store')
      const root = store?.hypercombRoot
      if (root && lineage.tryResolve) {
        ancestorDir = await lineage.tryResolve(sub, root).catch(() => null) as FileSystemDirectoryHandle | null
      } else if (depth === segments.length) {
        const dirOrPromise = lineage.explorerDir?.()
        ancestorDir = await Promise.resolve(dirOrPromise ?? null)
      }

      const isTargetLineage = depth === segments.length
      const ancestorLayer = isTargetLineage
        ? await this.#assembleLayerFor(history, sub, ancestorName, ancestorLocSig, ancestorDir)
        : await this.#cascadeMerkleSwap(history, sub, ancestorName, ancestorLocSig, ancestorDir, lastCommittedName, lastCommittedSig)

      const sig = await history.commitLayer(ancestorLocSig, ancestorLayer)
      console.log('[commit]', {
        depth,
        segments: sub,
        name: ancestorName || '(root)',
        cells: ancestorLayer.cells.length,
        sig: sig?.slice(0, 8) ?? '(none)',
        mode: isTargetLineage ? 'target (re-read disk)' : 'cascade (merkle swap)',
      })

      // Advance the cascade: the next ancestor up needs to know that
      // THIS ancestor's name now points at THIS new sig.
      lastCommittedName = ancestorName
      lastCommittedSig = sig
    }

    // Notify the cursor so the slider / activity log / ShowCell see the new head
    const cursorAfter = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursorAfter) await cursorAfter.onNewLayer()
  }

  /**
   * Build a complete layer snapshot for the lineage at `segments`.
   *
   * - `name`     = last segment ("" for root)
   * - `cells`    = on-disk subdirectory names (intersected w/ projection
   *                order if this is the leaf and we have one)
   * - `merkles`  = parallel to cells; each entry is the CURRENT marker
   *                sig of that child's bag (its merkle composition)
   * - `hidden`   = subset of cells (by name) hidden from rendering
   *
   * The marker file IS this layer JSON; its sha256 is the layer's
   * merkle sig. When any child commits a new marker, the parent's
   * `merkles` entry for that child changes → parent's bytes change
   * → parent's sig changes — that's the cascade.
   */
  async #assembleLayerFor(
    history: HistoryService,
    segments: string[],
    name: string,
    locationSig: string,
    explorerDir: FileSystemDirectoryHandle | null,
  ): Promise<LayerContent> {
    const onDisk = new Set<string>()
    if (explorerDir) {
      for await (const [n, handle] of (explorerDir as any).entries()) {
        if (handle.kind === 'directory') onDisk.add(n)
      }
    }

    // Order: only meaningful for the lineage that actually has a
    // projection. For ancestors we just take directory enumeration order.
    const order = get<OrderProjection>('@diamondcoreprocessor.com/OrderProjection')
    const ordered = order?.peek(locationSig) ?? await order?.hydrate(locationSig) ?? []

    const cells: string[] = []
    const seen = new Set<string>()
    for (const cell of ordered) {
      if (onDisk.has(cell) && !seen.has(cell)) { cells.push(cell); seen.add(cell) }
    }
    for (const cell of onDisk) {
      if (!seen.has(cell)) { cells.push(cell); seen.add(cell) }
    }

    // Merkle composition: pull each child's CURRENT marker sig.
    // Children that have no bag yet get the empty-seed sig for their
    // own name (latestMarkerSigFor handles this).
    const merkles: string[] = []
    for (const childName of cells) {
      const childSegments = [...segments, childName]
      const childLocSig = await history.sign({
        explorerSegments: () => childSegments,
      } as Lineage)
      const childMerkle = await history.latestMarkerSigFor(childLocSig, childName)
      merkles.push(childMerkle)
    }

    // Hidden is location-keyed in localStorage; only meaningful at the
    // visible lineage. For ancestors, no hides apply.
    const hidden = this.#readHiddenFor(segments)
    return { name, cells, merkles, hidden }
  }

  /**
   * Cascade-only assembly: keep this ancestor's previous cells +
   * hidden EXACTLY as they were, only swap the merkle entry for
   * the child whose sig just changed.
   *
   * This is the key invariant the user asked for:
   * "the parent tiles should never be affected, only pointing to
   *  the new sig changing from the old. This happens all the way
   *  to the root."
   *
   * If `childName` isn't in the previous cells (e.g. the child
   * is a freshly-created lineage from the same batch — root just
   * gained `abc` via `abc/123`), append it. We don't drop existing
   * cells just because a new child appeared.
   *
   * Falls back to a fresh disk-read assembly if there's no previous
   * head — first commit ever for this ancestor.
   */
  async #cascadeMerkleSwap(
    history: HistoryService,
    segments: string[],
    name: string,
    locationSig: string,
    explorerDir: FileSystemDirectoryHandle | null,
    childName: string | null,
    childSig: string | null,
  ): Promise<LayerContent> {
    const existing = await history.listLayers(locationSig)
    const headEntry = existing.length > 0 ? existing[existing.length - 1] : null
    const prev = headEntry
      ? await history.getLayerContent(locationSig, headEntry.layerSig)
      : null

    // No previous head → fall back to a fresh disk-read assembly.
    // This happens on first-ever commit for this ancestor (e.g.,
    // ancestor's bag was just auto-seeded by ensureSeed and we're
    // about to append commit #1).
    if (!prev || prev.cells.length === 0) {
      return await this.#assembleLayerFor(history, segments, name, locationSig, explorerDir)
    }

    const cells = prev.cells.slice()
    const merkles = prev.merkles.slice()

    if (childName && childSig) {
      const idx = cells.indexOf(childName)
      if (idx === -1) {
        // Child wasn't in previous cells — append it.
        cells.push(childName)
        merkles.push(childSig)
      } else {
        // Child was already there — only swap its merkle.
        // Pad merkles[] if it's somehow shorter than cells[]
        // (older bags with only the cells field).
        while (merkles.length < cells.length) merkles.push('')
        merkles[idx] = childSig
      }
    }

    return { name, cells, merkles, hidden: prev.hidden }
  }

  /**
   * Read the set of hidden cells for the lineage at `segments`. The
   * key matches what ShowCellDrone writes on `tile:hidden` /
   * `tile:unhidden`. Only the visible lineage will have a non-empty
   * value — ancestors return [].
   */
  #readHiddenFor(segments: string[]): string[] {
    const locationKey = segments.length === 0 ? '/' : '/' + segments.join('/')
    try {
      const raw = localStorage.getItem(`hc:hidden-tiles:${locationKey}`)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }

  // Layout signing / instruction-sig reading were both layer-driven —
  // the layer captured a `layoutSig` and `instructionsSig`. The slim
  // layer doesn't carry either; layout and instructions are bee-owned
  // primitives, and any per-position playback (e.g., undo of a layout
  // gap change) is the responsibility of the layout/instruction bee
  // tracking its own per-state primitive. Removed from the committer.
}

console.log('[LayerCommitter] module loaded — instantiating')
const _layerCommitter = new LayerCommitter()
window.ioc.register('@diamondcoreprocessor.com/LayerCommitter', _layerCommitter)
console.log('[LayerCommitter] registered in IoC')
