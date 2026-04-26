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
import { EffectBus } from '@hypercomb/core'
import type { HistoryService, LayerContent } from './history.service.js'
import { ROOT_NAME } from './history.service.js'
import type { HistoryCursorService } from './history-cursor.service.js'

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

    // No preemptive bootstrap. cursor.load (called from show-cell on
    // first render) handles bootstrapping the visible lineage when
    // its bag is empty. Boot stays fast — all OPFS work is deferred
    // until the moment a lineage is actually viewed.
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
      return
    }

    // Store registers synchronously but its OPFS handles populate async
    // via Store.initialize(). If `store.history` is still undefined, we
    // can't read the bag yet — back off and let a later Lineage 'change'
    // (or a manual cursor.load) re-trigger us.
    const store = get<{ history?: FileSystemDirectoryHandle; hypercombRoot?: FileSystemDirectoryHandle }>(
      '@hypercomb.social/Store'
    )
    if (!store?.history || !store?.hypercombRoot) return

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
        // Even on skip, push the bag's state into the cursor.
        if (cursor?.refreshForLocation) await cursor.refreshForLocation(locSig)
        return
      }
      // Empty bag → cascade the auto-seed + one marker for current state.
      await this.#machine.requestAndWait({ segments: segs })
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
    if (cursor?.state?.rewound) return

    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !history) return

    // Cascade: leaf → root.
    //
    // Each lineage has its own bag. A cell:added at /A/B/C produces a
    // new marker in /A/B/C's bag. Because /A/B's `children` array
    // captures /A/B/C's CURRENT marker sig, /A/B's marker bytes change
    // and /A/B needs a fresh marker too. Same up to the root.
    //
    // The new marker for each ancestor is computed by re-assembling
    // that ancestor's layer with its OWN explorer dir (its OPFS child
    // listing): every entry in `children` is that child's freshly-
    // pulled latest marker sig.
    //
    // Segments source: the event payload (when supplied — e.g. by
    // batch-create which fires per created lineage), else the global
    // Lineage (current explorer view). The payload form is what makes
    // `abc/123` typed from root cascade through /abc and /, not just /.
    const fallbackSegments = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const segments = req.segments ?? fallbackSegments

    // Walk every ancestor INCLUDING the leaf and INCLUDING root ("").
    // At every depth, re-assemble from disk so the children array
    // reflects whatever the on-disk layout is right now.
    for (let depth = segments.length; depth >= 0; depth--) {
      const sub = segments.slice(0, depth)
      // Every layer in a bag has the SAME name — the lineage's last
      // segment. Root has no segment, so use ROOT_NAME ('/') —
      // `name` is required and must be non-empty.
      const ancestorName = depth === 0 ? ROOT_NAME : sub[sub.length - 1]
      const ancestorLocSig = await history.sign({
        domain: lineage.domain,
        explorerSegments: () => sub,
      } as Lineage)

      // Resolve OPFS dir for this ancestor — required so we can
      // enumerate its children's names from disk.
      let ancestorDir: FileSystemDirectoryHandle | null = null
      const store = get<LineageStore>('@hypercomb.social/Store')
      const root = store?.hypercombRoot
      if (root && lineage.tryResolve) {
        ancestorDir = await lineage.tryResolve(sub, root).catch(() => null) as FileSystemDirectoryHandle | null
      } else if (depth === segments.length) {
        const dirOrPromise = lineage.explorerDir?.()
        ancestorDir = await Promise.resolve(dirOrPromise ?? null)
      }

      const ancestorLayer = await this.#assembleLayerFor(history, sub, ancestorName, ancestorDir)
      await history.commitLayer(ancestorLocSig, ancestorLayer)
    }

    // Notify the cursor so the slider / activity log / ShowCell see the new head
    const cursorAfter = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursorAfter) await cursorAfter.onNewLayer()
  }

  /**
   * Build a complete layer snapshot for the lineage at `segments`.
   *
   * - `name`     = the lineage's name (always present, never empty —
   *                ROOT_NAME for root, the last segment otherwise)
   * - `children` = each on-disk child's CURRENT marker sig. Omitted
   *                entirely when there are no children — same shape
   *                as the seed.
   *
   * The marker file IS this layer JSON; its sha256 is the layer's
   * merkle sig. When any child commits a new marker, the parent's
   * `children` entry for that child changes → parent's bytes change
   * → parent's sig changes — that's the cascade.
   */
  async #assembleLayerFor(
    history: HistoryService,
    segments: string[],
    name: string,
    explorerDir: FileSystemDirectoryHandle | null,
  ): Promise<LayerContent> {
    const onDiskNames: string[] = []
    if (explorerDir) {
      for await (const [n, handle] of (explorerDir as any).entries()) {
        if (handle.kind === 'directory') onDiskNames.push(n)
      }
    }

    // No children → seed shape: just `{ name }`, no children field.
    if (onDiskNames.length === 0) return { name }

    // latestMarkerSigFor is now pure compute when child has no bag
    // (returns the deterministic empty-seed sig). No I/O cascade.
    const children: string[] = []
    for (const childName of onDiskNames) {
      const childSegments = [...segments, childName]
      const childLocSig = await history.sign({
        explorerSegments: () => childSegments,
      } as Lineage)
      children.push(await history.latestMarkerSigFor(childLocSig, childName))
    }

    return { name, children }
  }

  // Layout signing / instruction-sig reading were both layer-driven —
  // the layer captured a `layoutSig` and `instructionsSig`. The slim
  // layer doesn't carry either; layout and instructions are bee-owned
  // primitives, and any per-position playback (e.g., undo of a layout
  // gap change) is the responsibility of the layout/instruction bee
  // tracking its own per-state primitive. Removed from the committer.
}

const _layerCommitter = new LayerCommitter()
window.ioc.register('@diamondcoreprocessor.com/LayerCommitter', _layerCommitter)
