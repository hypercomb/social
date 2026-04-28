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
import type { HistoryService } from './history.service.js'
import { ROOT_NAME } from './history.service.js'
import type { HistoryCursorService } from './history-cursor.service.js'
// TYPE-ONLY import. The runtime instance is the single shared
// singleton registered with window.ioc by layer-slot-registry.ts —
// obtained below via get(). Importing the class symbol non-type-only
// would bundle the class definition into THIS bee's bytes (esbuild
// inlines relative imports), giving a different class identity from
// the shared instance and silently breaking the singleton.
import type { LayerSlotRegistry } from './layer-slot-registry.js'
import { LayerMachine } from './layer-machine.js'

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
 * - `delta` — an OPTIONAL single-slot mutation applied at the leaf:
 *     • `kind: 'sig'` — pure sig delta. The slot machinery already has
 *       the resource/layer signature in hand (e.g. NotesService just
 *       committed its participant layer and emits `notes:append/sig`).
 *     • `kind: 'name'` — name-keyed delta resolved to a sig at commit
 *       time. Used by `cell:added`/`cell:removed` which carry a cell
 *       label; the leaf step looks up / signs the cell's lineage to
 *       produce the children sig.
 *
 *   When `delta` is absent the leaf does a bare re-snapshot (machine
 *   hydrate → output → commitLayer). If nothing changed,
 *   commitLayer's byte dedup makes it a no-op — no spurious markers.
 *
 *   The cascade is DELTA-DRIVEN at every level: leaf applies its slot
 *   delta to its hydrated machine; each ancestor swaps the prevSig of
 *   the level below for the freshly-committed sig in its `children`
 *   slot. Sibling sigs at every level are preserved verbatim — no
 *   spurious churn.
 */
type CommitDelta =
  | { kind: 'sig'; slot: string; op: 'append' | 'removeSig'; sig: string }
  | { kind: 'sig-swap'; slot: string; from: string; to: string }
  | { kind: 'set'; slot: string; sigs: readonly string[] }
  | { kind: 'name'; slot: 'children'; op: 'add' | 'remove'; cell: string }

type CommitRequest = {
  segments: string[] | null
  delta?: CommitDelta
}

class CommitMachine {
  #chain: Promise<void> = Promise.resolve()
  readonly #run: (req: CommitRequest) => Promise<void>

  constructor(run: (req: CommitRequest) => Promise<void>) {
    this.#run = run
  }

  /** Fire-and-forget enqueue. Errors are logged (so they're visible
   *  in the console) but do not break the chain — the next request
   *  still runs. */
  request(req: CommitRequest = { segments: null }): void {
    this.#chain = this.#chain.then(() => this.#run(req)).catch(err => {
      console.error('[LayerCommitter] cascade failed (request):', err, req)
    })
  }

  /**
   * Same as `request` but returns a promise that REJECTS when this
   * specific commit fails — so awaiting callers (HiveParticipant et
   * al.) see the failure and can react. The chain itself absorbs the
   * error so subsequent requests still proceed.
   */
  requestAndWait(req: CommitRequest = { segments: null }): Promise<void> {
    const ran = this.#chain.then(() => this.#run(req))
    this.#chain = ran.catch(err => {
      console.error('[LayerCommitter] cascade failed (requestAndWait):', err, req)
    })
    return ran
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
    EffectBus.on<{ cell?: string; segments?: string[] }>('cell:added',   p => this.#queueChildName(p?.segments, 'add', p?.cell))
    EffectBus.on<{ cell?: string; segments?: string[] }>('cell:removed', p => this.#queueChildName(p?.segments, 'remove', p?.cell))
    EffectBus.on<{ cell?: string; segments?: string[] }>('tile:saved',   p => this.#queueBare(p?.segments))
    EffectBus.on<{ cell?: string; segments?: string[] }>('tile:hidden',  p => this.#queueBare(p?.segments))
    EffectBus.on<{ cell?: string; segments?: string[] }>('tile:unhidden',p => this.#queueBare(p?.segments))

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
    //
    // whenReady — bee load order is not deterministic across
    // hypercomb-dev (direct import) and hypercomb-web (OPFS bee load).
    // If LayerCommitter constructs before LayerSlotRegistry is on ioc,
    // a `this.#slotRegistry?.onTrigger` call at construction silently
    // no-ops (optional chaining), and slot triggers (notes:changed,
    // tags:changed, ...) never reach the committer — slots stop
    // appearing in cell layers. Defer until the registry exists.
    window.ioc.whenReady<LayerSlotRegistry>(
      '@diamondcoreprocessor.com/LayerSlotRegistry',
      (registry) => {
        registry.onTrigger((trigger: string, slotName: string) => {
          // Trigger payload contract:
          //   { segments, op?: 'append'|'removeSig', sig? }
          // op + sig present  → leaf applies a sig delta to the named slot
          // op + sig absent   → bare re-snapshot at segments (idempotent
          //                     via commitLayer dedup)
          EffectBus.on<{
            segments?: string[]
            op?: 'append' | 'removeSig' | 'swap' | 'set'
            sig?: string
            from?: string
            to?: string
            sigs?: readonly string[]
          }>(trigger, p => {
            if (p?.op === 'set' && Array.isArray(p?.sigs)) {
              this.#queueSlotSet(p?.segments, slotName, p.sigs)
            } else if (p?.op === 'swap' && typeof p?.from === 'string' && typeof p?.to === 'string') {
              this.#queueSlotSwap(p?.segments, slotName, p.from, p.to)
            } else if ((p?.op === 'append' || p?.op === 'removeSig') && typeof p?.sig === 'string' && p.sig.length > 0) {
              this.#queueSlotSig(p?.segments, slotName, p.op, p.sig)
            } else {
              this.#queueBare(p?.segments)
            }
          })
        })
      },
    )

    // No preemptive bootstrap. cursor.load (called from show-cell on
    // first render) handles bootstrapping the visible lineage when
    // its bag is empty. Boot stays fast — all OPFS work is deferred
    // until the moment a lineage is actually viewed.
  }

  // All commit requests — batched or per-event — route through the
  // single CommitMachine. See the class above for the state transitions.
  #schedule(): void { this.#machine.request({ segments: null }) }

  /** Bare re-snapshot at `segments`. The leaf hydrates from prev,
   *  applies no delta, outputs identical bytes — commitLayer dedup
   *  drops the marker. Used as an idempotent ping for events that
   *  signal "something changed" without a structural delta. */
  #queueBare(segments?: string[] | null): void {
    this.#machine.request({ segments: this.#cleanSegments(segments) })
  }

  /** Legacy by-name child delta: `cell:added` / `cell:removed`. The
   *  leaf step resolves the cell's lineage to a sig at commit time
   *  before applying to the children slot. */
  #queueChildName(
    segments: string[] | null | undefined,
    op: 'add' | 'remove',
    cell?: string,
  ): void {
    const trimmed = cell ? String(cell).trim() : ''
    if (!trimmed) {
      this.#machine.request({ segments: this.#cleanSegments(segments) })
      return
    }
    this.#machine.request({
      segments: this.#cleanSegments(segments),
      delta: { kind: 'name', slot: 'children', op, cell: trimmed },
    })
  }

  /** Sig delta against an arbitrary slot. Wired up by every registered
   *  slot's trigger event when the payload carries `{ op, sig }`. */
  #queueSlotSig(
    segments: string[] | null | undefined,
    slot: string,
    op: 'append' | 'removeSig',
    sig: string,
  ): void {
    this.#machine.request({
      segments: this.#cleanSegments(segments),
      delta: { kind: 'sig', slot, op, sig },
    })
  }

  /** Strict sig swap on an arbitrary slot. */
  #queueSlotSwap(
    segments: string[] | null | undefined,
    slot: string,
    from: string,
    to: string,
  ): void {
    this.#machine.request({
      segments: this.#cleanSegments(segments),
      delta: { kind: 'sig-swap', slot, from, to },
    })
  }

  /** Full-replace of a slot's sigs. Used by HiveParticipant when the
   *  subsystem holds the canonical sorted list and just needs the layer
   *  to mirror it (idempotent — commitLayer dedups identical bytes). */
  #queueSlotSet(
    segments: string[] | null | undefined,
    slot: string,
    sigs: readonly string[],
  ): void {
    this.#machine.request({
      segments: this.#cleanSegments(segments),
      delta: { kind: 'set', slot, sigs: sigs.slice() },
    })
  }

  #cleanSegments(segments?: readonly string[] | null): string[] | null {
    return Array.isArray(segments)
      ? segments.map(s => String(s ?? '').trim()).filter(Boolean)
      : null
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

  /**
   * Public API for slot-aware drones (HiveParticipant et al.) that
   * want to drive the cascade WITHOUT going through EffectBus and want
   * an awaitable promise that resolves only when every ancestor up to
   * root has committed.
   *
   * Use these instead of emitting a trigger event when the caller
   * needs strict "after-commit" sequencing — emitting a trigger is
   * fire-and-forget and races with subscribers that read back the
   * layer state immediately.
   */
  public commitSlotSet(segments: readonly string[], slot: string, sigs: readonly string[]): Promise<void> {
    return this.#machine.requestAndWait({
      segments: this.#cleanSegments(segments) ?? [],
      delta: { kind: 'set', slot, sigs: sigs.slice() },
    })
  }
  public commitSlotAppend(segments: readonly string[], slot: string, sig: string): Promise<void> {
    return this.#machine.requestAndWait({
      segments: this.#cleanSegments(segments) ?? [],
      delta: { kind: 'sig', slot, op: 'append', sig },
    })
  }
  public commitSlotRemove(segments: readonly string[], slot: string, sig: string): Promise<void> {
    return this.#machine.requestAndWait({
      segments: this.#cleanSegments(segments) ?? [],
      delta: { kind: 'sig', slot, op: 'removeSig', sig },
    })
  }
  public commitSlotSwap(segments: readonly string[], slot: string, from: string, to: string): Promise<void> {
    return this.#machine.requestAndWait({
      segments: this.#cleanSegments(segments) ?? [],
      delta: { kind: 'sig-swap', slot, from, to },
    })
  }

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
    // The layer is the source of truth. At each ancestor depth we:
    //   1. Hydrate a LayerMachine from the bag's current head.
    //   2. Apply ONE delta:
    //         LEAF:    the request's slot delta (sig or name-resolved)
    //         ANCESTOR: swap children sig of the level below (prev →
    //                   freshly-committed). If the sig isn't found,
    //                   resolve by name; if still not found, append
    //                   (orphan auto-attach for legacy cascade gaps).
    //   3. Output the layer JSON and commit. commitLayer dedups
    //      identical bytes against the bag's current head — bare
    //      re-snapshots that change nothing produce no marker.
    //   4. Track prevSig → newSig for the next ancestor's swap.
    //
    // The cascade is slot-agnostic. `children` is just the slot used to
    // hold the merkle backbone; LayerMachine doesn't know its name.
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
      const machine = LayerMachine.fromLayer(prevLayer, ancestorName, sub)

      if (depth === segments.length && req.delta) {
        // LEAF: apply the request's delta.
        const d = req.delta
        if (d.kind === 'sig') {
          if (d.op === 'append') {
            machine.apply({ slot: d.slot, op: 'append', sig: d.sig })
          } else if (d.op === 'removeSig') {
            machine.apply({ slot: d.slot, op: 'removeSig', sig: d.sig })
          }
        } else if (d.kind === 'sig-swap') {
          machine.apply({ slot: d.slot, op: 'swap', from: d.from, to: d.to })
        } else if (d.kind === 'set') {
          machine.apply({ slot: d.slot, op: 'set', sigs: d.sigs })
        } else if (d.kind === 'name') {
          // Legacy children name → sig resolution at commit time.
          if (d.op === 'add') {
            const cellLocSig = await history.sign({
              domain: lineage.domain,
              explorerSegments: () => [...sub, d.cell],
            } as Lineage)
            const cellSig = await history.latestMarkerSigFor(cellLocSig, d.cell)
            machine.apply({ slot: 'children', op: 'append', sig: cellSig })
          } else if (d.op === 'remove') {
            const prevChildren = machine.getSlot('children') as readonly string[]
            for (const sig of prevChildren) {
              const child = await history.getLayerBySig(sig)
              if (child?.name === d.cell) {
                machine.apply({ slot: 'children', op: 'removeSig', sig })
                break
              }
            }
          }
        }
      } else if (belowOldSig !== null && belowNewSig !== null) {
        // ANCESTOR: swap children sig of the level below.
        const swapResult = machine.apply({
          slot: 'children',
          op: 'swap',
          from: belowOldSig,
          to: belowNewSig,
        })
        if (!swapResult.changed && belowName) {
          // sig miss — resolve by name, then retry. If still absent,
          // auto-attach (the child layer exists, we just committed it).
          const prevChildren = machine.getSlot('children') as readonly string[]
          let resolved = false
          for (const sig of prevChildren) {
            const child = await history.getLayerBySig(sig)
            if (child?.name === belowName) {
              machine.apply({ slot: 'children', op: 'swap', from: sig, to: belowNewSig })
              resolved = true
              break
            }
          }
          if (!resolved) {
            machine.apply({ slot: 'children', op: 'append', sig: belowNewSig })
          }
        }
      }

      const newSig = await history.commitLayer(ancestorLocSig, machine.output())

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
