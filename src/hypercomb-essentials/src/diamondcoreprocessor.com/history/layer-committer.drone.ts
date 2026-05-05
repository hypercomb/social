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
  // layer: the layer-as-primitive update. The caller passes the full new
  // layer state — `{ name, ...slots }` where each slot value is an array
  // of sigs (or, for `children`, names that resolve at commit time). Empty
  // arrays cause the slot to be wiped (absent ≡ empty). One cascade per
  // parent. Conventional: no hardcoded slot names — the caller's keys are
  // the slot names. Name-resolution is opt-in via the `nameSlots` set.
  | {
      kind: 'layer'
      layer: { [slot: string]: readonly string[] }
      /** Keys in this set are interpreted as cell-NAME arrays and resolved
       *  to sigs at commit time. All other keys are treated as sig arrays. */
      nameSlots?: ReadonlySet<string>
    }

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

  /**
   * Layer-as-primitive update. Pass the full new layer state at this position
   * — `{ name, ...slots }` — and the committer applies every slot in one
   * cascade. Empty arrays wipe the slot (absent ≡ empty). Slot names are the
   * caller's convention; the committer adds no special handling beyond
   * optional name→sig resolution for slots listed in `nameSlots` (typically
   * just `'children'`).
   *
   * This is the canonical write surface — single API, single cascade per
   * parent, no fire-and-forget paths, no item-level synthesis. Add and
   * remove are special cases of "the new children list is X".
   */
  public async update(
    segments: readonly string[],
    layer: { name?: string; [slot: string]: unknown },
    nameSlots: ReadonlySet<string> = new Set(['children']),
  ): Promise<string> {
    // Strip the `name` key — it identifies the cell, not a slot.
    // Coerce every other entry to a string array (drop non-array values
    // since the convention is "lists in, lists out").
    const slots: { [slot: string]: readonly string[] } = {}
    for (const [key, value] of Object.entries(layer)) {
      if (key === 'name') continue
      if (Array.isArray(value)) {
        slots[key] = value.map(v => String(v))
      }
    }
    const cleaned = this.#cleanSegments(segments) ?? []
    await this.#machine.requestAndWait({
      segments: cleaned,
      delta: { kind: 'layer', layer: slots, nameSlots },
    })

    // Return the new layer sig so callers can use it to compose the merkle
    // graph. After the cascade, `#latestSigByLineage` holds the head; we
    // resolve through the same primitive renderers use.
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const lineageInst = get<Lineage>('@hypercomb.social/Lineage')
    if (!history || !lineageInst) return ''
    const ancestorName = layer.name
      ? String(layer.name)
      : (cleaned.length === 0 ? ROOT_NAME : cleaned[cleaned.length - 1])
    const locSig = await history.sign({
      domain: lineageInst.domain,
      explorerSegments: () => cleaned,
    } as Lineage)
    return history.latestMarkerSigFor(locSig, ancestorName)
  }

  /**
   * Multi-position layer-tree commit. Takes many `(segments, layer)` updates
   * and applies them with a SINGLE shared up-cascade — each affected ancestor
   * is committed exactly once with the union of changes from its descendants.
   *
   * Compared to N individual `update()` calls (each with its own cascade-up-
   * to-root):
   *   - root commits once, not N times
   *   - every shared ancestor commits once
   *   - total layer files written = |affected paths|, not |updates × depth|
   *
   * This is the bulk-import / compaction primitive. The boot-time preloader
   * walk scales with this count, so collapsing it is the perf-critical fix.
   */
  public importTree = async (
    updates: { segments: readonly string[]; layer: { name?: string } & { [slot: string]: unknown } }[],
    nameSlots: ReadonlySet<string> = new Set(['children']),
  ): Promise<void> => {
    if (updates.length === 0) return

    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursor?.state?.rewound) return

    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !history) return

    // Path encoding: segments joined by ' ' (NUL), or '' for root.
    const encode = (segs: readonly string[]) => segs.join(' ')
    const decode = (key: string) => key === '' ? [] : key.split(' ')

    // Index updates by path.
    const updateByPath = new Map<string, { segments: string[]; layer: { name?: string } & { [slot: string]: unknown } }>()
    for (const u of updates) {
      const segs = (this.#cleanSegments(u.segments) ?? [])
      updateByPath.set(encode(segs), { segments: segs, layer: u.layer })
    }

    // Affected paths = every update path AND every ancestor up to root.
    const affected = new Set<string>()
    for (const u of updateByPath.values()) {
      for (let d = u.segments.length; d >= 0; d--) {
        affected.add(encode(u.segments.slice(0, d)))
      }
    }

    // Build parent → direct-child paths index for ancestor swap pass.
    const childrenOf = new Map<string, string[]>()
    for (const pathKey of affected) {
      const segs = decode(pathKey)
      if (segs.length === 0) continue
      const parentKey = encode(segs.slice(0, -1))
      const list = childrenOf.get(parentKey) ?? []
      list.push(pathKey)
      childrenOf.set(parentKey, list)
    }

    // Sort affected paths by depth descending (deepest first).
    const ordered = [...affected].sort((a, b) => decode(b).length - decode(a).length)

    // transitions: pathKey → { prevSig, newSig, name } produced by this commit.
    const transitions = new Map<string, { prevSig: string; newSig: string; name: string }>()

    for (const pathKey of ordered) {
      const segments = decode(pathKey)
      const ancestorName = segments.length === 0 ? ROOT_NAME : segments[segments.length - 1]
      const ancestorLocSig = await history.sign({
        domain: lineage.domain,
        explorerSegments: () => segments,
      } as Lineage)

      const prevSig = await history.latestMarkerSigFor(ancestorLocSig, ancestorName)
      const prevLayer = await history.getLayerBySig(prevSig)
      const machine = LayerMachine.fromLayer(prevLayer, ancestorName, segments)

      // Apply this path's leaf update, if it has one.
      const update = updateByPath.get(pathKey)
      if (update) {
        for (const [slot, raw] of Object.entries(update.layer)) {
          if (slot === 'name') continue
          if (!Array.isArray(raw)) continue
          let sigs: string[]
          if (nameSlots.has(slot)) {
            sigs = []
            for (const cell of raw) {
              const trimmed = String(cell ?? '').trim()
              if (!trimmed) continue
              const cellLocSig = await history.sign({
                domain: lineage.domain,
                explorerSegments: () => [...segments, trimmed],
              } as Lineage)
              const cellSig = await history.latestMarkerSigFor(cellLocSig, trimmed)
              if (cellSig) sigs.push(cellSig)
            }
          } else {
            sigs = (raw as unknown[]).map(v => String(v)).filter(Boolean)
          }
          machine.apply({ slot, op: 'set', sigs })
        }
      }

      // Apply child sig swaps for any direct children that just transitioned.
      // After the layer-update above sets the children list (resolved from
      // names), the children sigs ARE the descendants' prevSig values; we
      // swap them to newSig values. If a child wasn't named in the update
      // (incremental import preserving existing children), its sig in the
      // current children list still needs swapping.
      for (const childPathKey of childrenOf.get(pathKey) ?? []) {
        const transition = transitions.get(childPathKey)
        if (!transition) continue
        if (transition.prevSig === transition.newSig) continue
        const swapResult = machine.apply({
          slot: 'children',
          op: 'swap',
          from: transition.prevSig,
          to: transition.newSig,
        })
        if (!swapResult.changed) {
          // Sig miss — the children list (post layer-update) doesn't have
          // the descendant's prevSig. Try by name; else append.
          const childSegs = decode(childPathKey)
          const childName = childSegs[childSegs.length - 1]
          const prevChildren = machine.getSlot('children') as readonly string[]
          let resolved = false
          for (const sig of prevChildren) {
            const child = await history.getLayerBySig(sig)
            if (child?.name === childName) {
              machine.apply({ slot: 'children', op: 'swap', from: sig, to: transition.newSig })
              resolved = true
              break
            }
          }
          if (!resolved) {
            machine.apply({ slot: 'children', op: 'append', sig: transition.newSig })
          }
        }
      }

      const newSig = await history.commitLayer(ancestorLocSig, machine.output())
      transitions.set(pathKey, { prevSig, newSig, name: ancestorName })
    }

    const cursorAfter = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursorAfter) await cursorAfter.onNewLayer()
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
        } else if (d.kind === 'layer') {
          // Layer-as-primitive: apply every slot in the supplied layer state
          // in one machine, all baked into one commit. Empty arrays write
          // empty slots — commitLayer's serialization strips them, so absent
          // ≡ empty. No hardcoded slot semantics here; the caller's keys are
          // the slot names by convention. Optional `nameSlots` opts a slot
          // into name→sig resolution (used for `children`).
          const nameSlots = d.nameSlots ?? new Set<string>()
          for (const [slot, raw] of Object.entries(d.layer)) {
            const values = Array.isArray(raw) ? raw : []
            let sigs: string[]
            if (nameSlots.has(slot)) {
              sigs = []
              for (const cell of values) {
                const trimmed = String(cell ?? '').trim()
                if (!trimmed) continue
                const cellLocSig = await history.sign({
                  domain: lineage.domain,
                  explorerSegments: () => [...sub, trimmed],
                } as Lineage)
                const cellSig = await history.latestMarkerSigFor(cellLocSig, trimmed)
                if (cellSig) sigs.push(cellSig)
              }
            } else {
              sigs = values.map(v => String(v)).filter(Boolean)
            }
            machine.apply({ slot, op: 'set', sigs })
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
