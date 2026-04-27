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
// TYPE-ONLY import. The runtime instance is the single shared
// singleton registered with window.ioc by layer-slot-registry.ts —
// obtained below via get(). Importing the class symbol non-type-only
// would bundle the class definition into THIS bee's bytes (esbuild
// inlines relative imports), giving a different class identity from
// the shared instance and silently breaking the singleton.
import type { LayerSlotRegistry } from './layer-slot-registry.js'

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
/**
 * A commit request describes the user-intent that will produce one new
 * marker at every ancestor.
 *
 * - `segments` — the lineage where the change happened (the LEAF). The
 *   cascade walks from this depth up to root.
 * - `op` + `cell` — the delta (add or remove of one named cell at the
 *   leaf level). When present, the cascade is DELTA-DRIVEN: each new
 *   marker differs from the previous head by exactly one entry. The
 *   leaf gets +/- one cell sig; each ancestor gets ONE child-sig
 *   swapped for the just-committed-below sig. Sibling sigs at every
 *   level are preserved verbatim — no spurious churn.
 * - When `op` is absent (layout-mode change, etc.), fall back to a
 *   disk-snapshot rebuild of the leaf (no add/remove semantics to
 *   apply).
 */
type CommitRequest = {
  segments: string[] | null
  op?: 'add' | 'remove'
  cell?: string
}

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

  /** Lazy accessor: the registry instance lives on window.ioc and is
   *  registered by layer-slot-registry.ts at module-load. We always
   *  fetch via get() so a never-registered registry just yields
   *  undefined and the slot-pipeline becomes a no-op. */
  get #slotRegistry(): LayerSlotRegistry | undefined {
    return get<LayerSlotRegistry>('@diamondcoreprocessor.com/LayerSlotRegistry')
  }

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
    EffectBus.on<{ cell?: string; segments?: string[] }>('cell:added',   p => this.#queueCommit(p?.segments, 'add', p?.cell))
    EffectBus.on<{ cell?: string; segments?: string[] }>('cell:removed', p => this.#queueCommit(p?.segments, 'remove', p?.cell))
    EffectBus.on<{ cell?: string; segments?: string[] }>('tile:saved',   p => this.#queueCommit(p?.segments))
    EffectBus.on<{ cell?: string; segments?: string[] }>('tile:hidden',  p => this.#queueCommit(p?.segments))
    EffectBus.on<{ cell?: string; segments?: string[] }>('tile:unhidden',p => this.#queueCommit(p?.segments))

    // ── Slot-driven re-commit triggers ───────────────────────────────
    // Every registered LayerSlot declares the EffectBus events that
    // should cause a re-snapshot. Subscribe via the registry's
    // onTrigger callback so load order doesn't matter — slots that
    // register AFTER this committer instantiates still get their
    // trigger wired up the moment they call register(). A new
    // subsystem only has to register a slot; it does NOT also have
    // to teach LayerCommitter about its trigger event or worry about
    // import order in side-effects.ts.
    //
    // Each subscribed event is dedup'd (Set in the registry), so a
    // slot listing the same trigger twice or two slots sharing one
    // trigger only result in a single EffectBus subscription here.
    this.#slotRegistry?.onTrigger((trigger: string) => {
      EffectBus.on<{ cell?: string; segments?: string[] }>(trigger, p => this.#queueCommit(p?.segments))
    })

    // No preemptive bootstrap. cursor.load (called from show-cell on
    // first render) handles bootstrapping the visible lineage when
    // its bag is empty. Boot stays fast — all OPFS work is deferred
    // until the moment a lineage is actually viewed.
  }

  // All commit requests — batched or per-event — route through the
  // single CommitMachine. See the class above for the state transitions.
  #schedule(): void { this.#machine.request({ segments: null }) }
  #queueCommit(
    segments?: string[] | null,
    op?: 'add' | 'remove',
    cell?: string,
  ): void {
    const cleaned = Array.isArray(segments)
      ? segments.map(s => String(s ?? '').trim()).filter(Boolean)
      : null
    const trimmedCell = cell ? String(cell).trim() : undefined
    this.#machine.request({
      segments: cleaned,
      op: op && trimmedCell ? op : undefined,
      cell: op && trimmedCell ? trimmedCell : undefined,
    })
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
      // Empty bag → cascade the auto-mint of 00000000 + one marker for current state.
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

    const fallbackSegments = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const segments = req.segments ?? fallbackSegments

    // ───────────────────────────────────────────────────────────
    // Delta-driven cascade — the canonical path.
    //
    // Invariant: every commit produces a new marker that differs
    // from the previous head by EXACTLY ONE entry.
    //
    //   - LEAF (depth = segments.length, the lineage where the
    //     change happened): previous.children +/- the one cell sig.
    //   - ANCESTORS (depth = segments.length-1 down to 0): swap the
    //     just-committed-below sig in for the previous-head-below sig.
    //     Same logical child, different sig pointer — exactly one
    //     entry differs.
    //
    // Sibling sigs are PRESERVED VERBATIM at every level — no
    // re-pulling from latestMarkerSigFor (which would surface stale-
    // vs-current sig flips and produce spurious "+1 -1" diffs for
    // unrelated cells).
    // ───────────────────────────────────────────────────────────
    if (req.op && req.cell) {
      let belowOldSig: string | null = null    // sig of child-below in PREVIOUS ancestor's children
      let belowNewSig: string | null = null    // sig of child-below in NEW ancestor's children
      let belowName: string = req.cell         // child-below's display name

      for (let depth = segments.length; depth >= 0; depth--) {
        const sub = segments.slice(0, depth)
        const ancestorName = depth === 0 ? ROOT_NAME : sub[sub.length - 1]
        const ancestorLocSig = await history.sign({
          domain: lineage.domain,
          explorerSegments: () => sub,
        } as Lineage)

        // Read THIS ancestor's previous head bytes. We need its
        // children array so we can apply the one delta and otherwise
        // preserve order + sibling sigs verbatim.
        const prevSig = await history.latestMarkerSigFor(ancestorLocSig, ancestorName)
        const prevLayer = await history.getLayerBySig(prevSig)
        const prevChildren: string[] = prevLayer?.children?.slice() ?? []

        let nextChildren: string[] = prevChildren

        if (depth === segments.length) {
          // LEAF: append for 'add', remove for 'remove'.
          if (req.op === 'add') {
            // Compute the cell's current head sig (materializes its
            // bag's 00000000 if brand new).
            const cellLocSig = await history.sign({
              domain: lineage.domain,
              explorerSegments: () => [...sub, req.cell!],
            } as Lineage)
            const cellSig = await history.latestMarkerSigFor(cellLocSig, req.cell!)
            // Idempotent: if the cell sig is already in children, no-op.
            if (!prevChildren.includes(cellSig)) {
              nextChildren = [...prevChildren, cellSig]
            } else {
              nextChildren = prevChildren
            }
            belowOldSig = null
            belowNewSig = cellSig
            belowName = req.cell!
          } else {
            // remove: find the entry whose layer.name matches req.cell
            const filtered: string[] = []
            let foundOldSig: string | null = null
            for (const sig of prevChildren) {
              const child = await history.getLayerBySig(sig)
              if (child?.name === req.cell) {
                foundOldSig = sig
                continue
              }
              filtered.push(sig)
            }
            nextChildren = filtered
            belowOldSig = foundOldSig
            belowNewSig = null   // removed: nothing to swap in at the next level up
            belowName = req.cell!
          }
        } else {
          // ANCESTOR: swap belowOldSig → belowNewSig in children.
          // The "below" child is segments[depth] (the next segment
          // toward the leaf). Find its sig in prevChildren — prefer
          // matching belowOldSig if known, else fall back to a
          // name-based scan (covers the first-time-seen case).
          let swapped = false
          const out: string[] = []
          for (const sig of prevChildren) {
            if (!swapped && belowOldSig !== null && sig === belowOldSig) {
              if (belowNewSig !== null) out.push(belowNewSig)
              swapped = true
              continue
            }
            out.push(sig)
          }
          if (!swapped) {
            // Couldn't match by sig (parent layer was committed before
            // child's bag existed, or first cascade after a fresh boot).
            // Find by name.
            for (let i = 0; i < prevChildren.length; i++) {
              const child = await history.getLayerBySig(prevChildren[i])
              if (child?.name === belowName) {
                if (belowNewSig !== null) out[i] = belowNewSig
                else out.splice(i, 1)
                swapped = true
                break
              }
            }
            if (!swapped && belowNewSig !== null) {
              // Wasn't there at all (cascade reaches a parent that
              // didn't know about this child yet). Append.
              out.push(belowNewSig)
              swapped = true
            }
          }
          nextChildren = out
          // Track for the next-level-up swap.
          belowName = ancestorName
        }

        const slotValues = (await this.#slotRegistry?.readAll(ancestorLocSig, sub)) ?? {}
        const newLayer: LayerContent = nextChildren.length === 0
          ? { name: ancestorName, ...slotValues }
          : { name: ancestorName, children: nextChildren, ...slotValues }
        const newSig = await history.commitLayer(ancestorLocSig, newLayer)

        // For the next iteration up: this ancestor's old sig becomes
        // belowOldSig, its new sig becomes belowNewSig.
        belowOldSig = prevSig
        belowNewSig = newSig
      }

      const cursorAfter = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
      if (cursorAfter) await cursorAfter.onNewLayer()
      return
    }

    // ───────────────────────────────────────────────────────────
    // Fallback (no op+cell delta available): re-snapshot from disk
    // at every level. Used by non-cell events (layout-change, etc.)
    // and by bootstrapIfEmpty to mint the initial baseline.
    //
    // This path can produce spurious sig swaps for unrelated children
    // — it's a known correctness gap, kept ONLY for events that don't
    // carry delta info. Ideally those events grow op+cell payloads
    // too and this fallback dies.
    // ───────────────────────────────────────────────────────────
    for (let depth = segments.length; depth >= 0; depth--) {
      const sub = segments.slice(0, depth)
      const ancestorName = depth === 0 ? ROOT_NAME : sub[sub.length - 1]
      const ancestorLocSig = await history.sign({
        domain: lineage.domain,
        explorerSegments: () => sub,
      } as Lineage)

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

    const cursorAfter = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursorAfter) await cursorAfter.onNewLayer()
  }

  /**
   * Build a complete layer snapshot for the lineage at `segments` by
   * enumerating its on-disk children AND folding in every registered
   * LayerSlot's current value. Used only by the fallback path in
   * `#commit` (events without op+cell delta info). The delta path
   * preserves sibling sigs verbatim and folds slots inline there.
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
        if (handle.kind !== 'directory') continue
        if (n.startsWith('__')) continue
        onDiskNames.push(n)
      }
    }

    const locationSig = await history.sign({
      explorerSegments: () => segments,
    } as Lineage)
    const slotValues = (await this.#slotRegistry?.readAll(locationSig, segments)) ?? {}

    // No children → just `{ name, ...slots }`. Slots returning undefined
    // were already filtered by readAll, so empty slot bag = `{ name }`.
    if (onDiskNames.length === 0) return { name, ...slotValues }

    const children: string[] = []
    for (const childName of onDiskNames) {
      const childSegments = [...segments, childName]
      const childLocSig = await history.sign({
        explorerSegments: () => childSegments,
      } as Lineage)
      children.push(await history.latestMarkerSigFor(childLocSig, childName))
    }

    return { name, children, ...slotValues }
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
