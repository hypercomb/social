// diamondcoreprocessor.com/history/layer-committer.drone.ts
//
// Single commit site for history. Listens to user-event triggers
// (cell:added, cell:removed, slot triggers via LayerSlotRegistry) and
// runs the unified cascade: per ancestor depth, read the previous
// head's children, apply a child delta if any, fold every registered
// slot's value, commit a new marker, propagate the prevSig→newSig
// swap up to root.
//
// One commit path. No disk enumeration. The merkle tree is the source
// of truth; folders on disk are incidental. Deduplication is automatic
// — commitLayer short-circuits when assembled bytes match the bag's
// current head.
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
  explorerSegments?: () => string[]
}

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
   * Ensure the bag at `segments` has at least 00000000 (the empty
   * layer `{name}`) materialized on disk. `latestMarkerSigFor` auto-
   * mints on first touch, so this reduces to a single call —
   * deterministic, idempotent, no commit cascade required for empty
   * lineages.
   *
   * Real markers grow only through canonical cascades (cell:added,
   * slot triggers). No disk-enumeration synthesis: if a cell exists,
   * it got there by riding through cell:added at some point. Legacy
   * on-disk-only data is intentionally not surfaced — the merkle tree
   * is the source of truth.
   */
  readonly #bootstrapInFlight = new Map<string, Promise<void>>()

  public async bootstrapIfEmpty(segments?: string[] | null): Promise<void> {
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    if (!history || !lineage) return

    const store = get<{ history?: FileSystemDirectoryHandle }>('@hypercomb.social/Store')
    if (!store?.history) return

    const cleaned = Array.isArray(segments)
      ? segments.map(s => String(s ?? '').trim()).filter(Boolean)
      : null
    const fallback = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const segs = cleaned ?? fallback

    const locSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => segs,
    } as Lineage)

    const existing = this.#bootstrapInFlight.get(locSig)
    if (existing) return existing

    const ancestorName = segs.length === 0 ? ROOT_NAME : segs[segs.length - 1]
    const run = (async () => {
      // latestMarkerSigFor auto-mints 00000000 if the bag is empty.
      // No commit, no cascade — just ensure the empty layer exists.
      await history.latestMarkerSigFor(locSig, ancestorName)
      const cursor = get<{
        onNewLayer?: () => Promise<void>
        refreshForLocation?: (locSig: string) => Promise<void>
      }>('@diamondcoreprocessor.com/HistoryCursorService')
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
    // Unified cascade — ONE path for every commit type.
    //
    // Per ancestor depth (leaf → root):
    //   1. Read the previous head's bytes → prev children verbatim.
    //   2. LEAF only: apply child delta if present:
    //         op='add'    → append cell sig if not already present
    //         op='remove' → drop the entry whose layer.name matches
    //         no op       → preserve children (slot-driven re-commit;
    //                       only slot values change → new bytes → new sig)
    //   3. ANCESTORS: swap (belowOldSig → belowNewSig) in children.
    //      If sig swap misses (legacy / first cascade through), match
    //      by name; if neither matches, append (orphan auto-attach —
    //      the child clearly exists, we just committed its layer).
    //   4. Fold every registered slot's value via LayerSlotRegistry.
    //   5. Commit. commitLayer dedups identical bytes against the bag's
    //      current head, so no-op cascades don't churn markers.
    //   6. Track this ancestor's prevSig→newSig for the next iteration's
    //      swap.
    //
    // Source of truth: the bag's previous head + slot reads. NEVER
    // disk enumeration — folders are incidental, layers are canonical.
    // First-time-touched bags auto-mint 00000000 (the empty layer)
    // via latestMarkerSigFor; their children start [] and grow only
    // through cell:added events. No disk-derived "what should be here"
    // — it either rode through the cascade, or it doesn't exist.
    // ───────────────────────────────────────────────────────────

    let belowOldSig: string | null = null
    let belowNewSig: string | null = null
    let belowName: string | null = null

    for (let depth = segments.length; depth >= 0; depth--) {
      const sub = segments.slice(0, depth)
      const ancestorName = depth === 0 ? ROOT_NAME : sub[sub.length - 1]
      const ancestorLocSig = await history.sign({
        domain: lineage.domain,
        explorerSegments: () => sub,
      } as Lineage)

      const prevSig = await history.latestMarkerSigFor(ancestorLocSig, ancestorName)
      const prevLayer = await history.getLayerBySig(prevSig)
      const prevChildren: string[] = prevLayer?.children?.slice() ?? []

      let nextChildren: string[] = prevChildren

      if (depth === segments.length) {
        // LEAF: apply delta if present, else preserve.
        if (req.op === 'add' && req.cell) {
          const cellLocSig = await history.sign({
            domain: lineage.domain,
            explorerSegments: () => [...sub, req.cell!],
          } as Lineage)
          const cellSig = await history.latestMarkerSigFor(cellLocSig, req.cell!)
          if (!prevChildren.includes(cellSig)) nextChildren = [...prevChildren, cellSig]
        } else if (req.op === 'remove' && req.cell) {
          const filtered: string[] = []
          for (const sig of prevChildren) {
            const child = await history.getLayerBySig(sig)
            if (child?.name === req.cell) continue
            filtered.push(sig)
          }
          nextChildren = filtered
        }
      } else if (belowOldSig !== null) {
        // ANCESTOR: swap (belowOldSig → belowNewSig) in children.
        let swapped = false
        const out: string[] = []
        for (const sig of prevChildren) {
          if (!swapped && sig === belowOldSig) {
            if (belowNewSig !== null) out.push(belowNewSig)
            swapped = true
            continue
          }
          out.push(sig)
        }
        if (!swapped && belowName) {
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
            // Auto-attach: ancestor never knew this child existed
            // (legacy cascade gap or first commit through this lineage).
            // Since we just committed the child's layer, append.
            out.push(belowNewSig)
            swapped = true
          }
        }
        nextChildren = out
      }

      const slotValues = (await this.#slotRegistry?.readAll(ancestorLocSig, sub)) ?? {}
      const newLayer: LayerContent = nextChildren.length === 0
        ? { name: ancestorName, ...slotValues }
        : { name: ancestorName, children: nextChildren, ...slotValues }
      const newSig = await history.commitLayer(ancestorLocSig, newLayer)

      belowOldSig = prevSig
      belowNewSig = newSig
      belowName = ancestorName
    }

    const cursorAfter = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursorAfter) await cursorAfter.onNewLayer()
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
