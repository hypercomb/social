// diamondcoreprocessor.com/history/layer-committer.drone.ts
//
// Single commit site for history. Listens to user-event triggers
// (cell:added, cell:removed, slot triggers via LayerSlotRegistry) and
// commits PER-PAGE: read the leaf bag's current head, apply the request's
// slot delta, fold the registered slot values, commit one new marker at
// the leaf. Ancestors are NOT re-committed — the eager leaf→root cascade
// is retired (see per-page history). A parent's stored child sig is a
// stale hint; child liveness is resolved on demand from the child's own
// bag head.
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
import { isBareLayer, chooseChildSig } from './child-sig-guard.js'

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
 * Strict FIFO commit chain. Every `request()` appends to the tail of
 * a Promise chain that runs `#run(payload)` in order.
 *
 * Atomicity is the queen's responsibility, not the committer's. A
 * queen that mutates the layer via `committer.update(segments, full
 * new layer)` produces ONE marker for the whole user action — that's
 * the canonical commit path. The per-event listeners for `cell:added`
 * / `cell:removed` are a legacy convenience path for one-off
 * mutations; when a queen drives an atomic update they fire eagerly
 * for snappy UI feedback but must set `viaUpdate: true` so the
 * listeners SKIP queueing and don't produce N redundant markers for a
 * single multi-select action.
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
  // `revive` (add only): link the location bag's CURRENT head instead of
  // resetting it — the undo-a-remove gesture (activity log revert). A plain
  // add of a name the parent does not list is a CREATE and must yield a
  // fresh, childless tile even when the location bag holds a deleted
  // tile's history (delete never touches the child's bag).
  | { kind: 'name'; slot: 'children'; op: 'add' | 'remove'; cell: string; revive?: boolean }
  // deltas: N surgical sig-space edits against ONE slot in ONE commit —
  // the sig-native cut/copy/paste/move primitive. Unlike 'set'/'layer'
  // this never re-lists the slot, so a cold sibling can't be wiped and no
  // name→sig re-resolution (with its husk auto-mint) ever runs. Each
  // remove matches by sig against the hydrated head; a miss falls back
  // to `label` (per-page staleness can leave the caller's view of a sig
  // behind the head's). `swaps` re-points an existing entry IN PLACE
  // (order preserved) — a move commits the gaining node first, then folds
  // its new sig into the losing parent's same marker for free.
  | {
      kind: 'deltas'
      slot: string
      removes?: readonly { sig?: string; label?: string }[]
      appends?: readonly string[]
      swaps?: readonly { from: string; to: string }[]
    }
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

/** The CURRENT lineage segments, resolved synchronously. Used to BIND a
 *  commit's address at INTENT time (enqueue). A commit must never be
 *  addressed at queue-DRAIN time: the machine serialises requests, so a
 *  navigation between event and drain would re-address the commit to
 *  whatever location happens to be current — grafting one layer's
 *  values into another (observed live: a child created at /hello was
 *  appended to root's children minutes later by exactly this race). */
const segmentsAtIntent = (): string[] | null => {
  const lineage = get<Lineage>('@hypercomb.social/Lineage')
  const segs = lineage?.explorerSegments?.()
  if (!Array.isArray(segs)) return null
  return segs.map(s => String(s ?? '').trim()).filter(Boolean)
}

class CommitMachine {
  #chain: Promise<void> = Promise.resolve()
  readonly #run: (req: CommitRequest) => Promise<void>

  constructor(run: (req: CommitRequest) => Promise<void>) {
    this.#run = run
  }

  /** Bind the request's address NOW. `segments: null` means "where the
   *  user is acting" — that is a fact about the present, not about
   *  whenever the queue drains. Unresolvable address (no lineage yet)
   *  → the request is refused loudly; committing to a guessed location
   *  is the one thing this machine must never do. */
  #addressed(req: CommitRequest): CommitRequest | null {
    if (req.segments !== null) return req
    const bound = segmentsAtIntent()
    if (bound === null) {
      console.warn('[LayerCommitter] commit refused — no address resolvable at intent time', req)
      return null
    }
    return { ...req, segments: bound }
  }

  /** Fire-and-forget enqueue. Errors are logged (so they're visible
   *  in the console) but do not break the chain — the next request
   *  still runs. */
  request(req: CommitRequest = { segments: null }): void {
    const addressed = this.#addressed(req)
    if (!addressed) return
    this.#chain = this.#chain.then(() => this.#run(addressed)).catch(err => {
      console.error('[LayerCommitter] cascade failed (request):', err, addressed)
    })
  }

  /**
   * Same as `request` but returns a promise that REJECTS when this
   * specific commit fails — so awaiting callers (HiveParticipant et
   * al.) see the failure and can react. The chain itself absorbs the
   * error so subsequent requests still proceed.
   */
  requestAndWait(req: CommitRequest = { segments: null }): Promise<void> {
    const addressed = this.#addressed(req)
    if (!addressed) return Promise.resolve()
    const ran = this.#chain.then(() => this.#run(addressed))
    this.#chain = ran.catch(err => {
      console.error('[LayerCommitter] cascade failed (requestAndWait):', err, addressed)
    })
    return ran
  }

  /**
   * Run an arbitrary commit task in the SAME serialisation chain as
   * request()/requestAndWait(). importTree (create / paste / adopt) commits
   * OUTSIDE the per-event #commit path — it reads each affected bag's current
   * layer, then writes an updated one. That read-modify-write is NOT atomic:
   * if a machine-driven #commit (or another importTree) on the same bag
   * interleaves — reading the parent BEFORE this task's write and writing
   * AFTER — it clobbers the freshly-appended child, so a created tile never
   * "sticks". Chaining the whole task here makes every commit path share one
   * FIFO, so no two read-modify-write cycles overlap. Returns a promise that
   * settles with the task's result; the chain absorbs the error so later
   * requests still run.
   */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const ran = this.#chain.then(task)
    this.#chain = ran.then(() => {}, err => {
      console.error('[LayerCommitter] enqueued task failed:', err)
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
  // #commit writes exactly one marker, at the leaf — no ancestor walk.
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
    // The `fromCascade` flag is set by THIS drone when it emits
    // cell:added / cell:removed during the slot-machine reconciliation
    // path below (post-commit children-set diff). Skipping the queue on
    // fromCascade prevents an infinite loop: cascade emits → handler
    // queues another commit → that commit's diff emits again → ...
    //
    // The `viaUpdate` flag is set by queens (e.g. RemoveQueenBee) that
    // drive an atomic layer mutation via `committer.update(...)` and
    // ALSO eager-emit cell:added/cell:removed for snappy UI. The
    // upcoming update() call is the canonical commit for the whole
    // action; queueing here would mint one redundant marker per event,
    // turning a single multi-select delete into N history entries.
    //
    // Listeners that DON'T originate commits (show-cell's slot machine,
    // activity log, etc.) don't care about either flag and process the
    // event normally, which is exactly the reconciliation we want.
    EffectBus.on<{ cell?: string; segments?: string[]; fromCascade?: boolean; viaUpdate?: boolean; revive?: boolean }>('cell:added',   p => {
      if (p?.fromCascade || p?.viaUpdate) return
      this.#queueChildName(p?.segments, 'add', p?.cell, p?.revive)
    })
    EffectBus.on<{ cell?: string; segments?: string[]; fromCascade?: boolean; viaUpdate?: boolean }>('cell:removed', p => {
      if (p?.fromCascade || p?.viaUpdate) return
      this.#queueChildName(p?.segments, 'remove', p?.cell)
    })
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
    revive?: boolean,
  ): void {
    const trimmed = cell ? String(cell).trim() : ''
    if (!trimmed) {
      this.#machine.request({ segments: this.#cleanSegments(segments) })
      return
    }
    this.#machine.request({
      segments: this.#cleanSegments(segments),
      delta: { kind: 'name', slot: 'children', op, cell: trimmed, ...(revive ? { revive } : {}) },
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
  // NOTE: segments pass through #cleanSegments WITHOUT a `?? []` default.
  // Defaulting malformed input to [] silently addressed ROOT — the same
  // cross-layer-graft hazard the intent-time binding exists to prevent.
  // A null result lets CommitMachine bind to the caller's CURRENT
  // location at enqueue, which is what the intent actually was.
  public commitSlotSet(segments: readonly string[], slot: string, sigs: readonly string[]): Promise<void> {
    return this.#machine.requestAndWait({
      segments: this.#cleanSegments(segments),
      delta: { kind: 'set', slot, sigs: sigs.slice() },
    })
  }
  public commitSlotAppend(segments: readonly string[], slot: string, sig: string): Promise<void> {
    return this.#machine.requestAndWait({
      segments: this.#cleanSegments(segments),
      delta: { kind: 'sig', slot, op: 'append', sig },
    })
  }
  public commitSlotRemove(segments: readonly string[], slot: string, sig: string): Promise<void> {
    return this.#machine.requestAndWait({
      segments: this.#cleanSegments(segments),
      delta: { kind: 'sig', slot, op: 'removeSig', sig },
    })
  }
  public commitSlotSwap(segments: readonly string[], slot: string, from: string, to: string): Promise<void> {
    return this.#machine.requestAndWait({
      segments: this.#cleanSegments(segments),
      delta: { kind: 'sig-swap', slot, from, to },
    })
  }

  /**
   * The sig-native cut/copy/paste/move commit: N surgical children edits
   * in ONE marker at `segments`. Cut = removes (the detached child's
   * bytes, markers and bag all survive — nothing is ever deleted, the new
   * head merely stops listing it). Paste = appends (the sig IS the
   * collection; the subtree needs no re-commit because its bytes are
   * pool-addressed and position-independent). Move = the gaining node
   * commits first, then the losing parent's marker carries `removes` plus
   * a `swap` of the gaining node's now-stale sig. No name re-resolution,
   * no re-listing — cold siblings ride through verbatim.
   *
   * Returns the location's new head sig, so a caller can fold it into its
   * parent's delta (the move ordering above).
   */
  public async commitChildrenDeltas(
    segments: readonly string[],
    changes: {
      removes?: readonly { sig?: string; label?: string }[]
      appends?: readonly string[]
      swaps?: readonly { from: string; to: string }[]
    },
  ): Promise<string> {
    const cleaned = this.#cleanSegments(segments) ?? segmentsAtIntent()
    if (cleaned === null) {
      console.error('[LayerCommitter] children deltas refused — no address resolvable')
      return ''
    }
    await this.#machine.requestAndWait({
      segments: cleaned,
      delta: {
        kind: 'deltas',
        slot: 'children',
        removes: changes.removes?.slice(),
        appends: changes.appends?.slice(),
        swaps: changes.swaps?.slice(),
      },
    })
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const lineageInst = get<Lineage>('@hypercomb.social/Lineage')
    if (!history || !lineageInst) return ''
    const name = cleaned.length === 0 ? ROOT_NAME : cleaned[cleaned.length - 1]
    const locSig = await history.sign({
      domain: lineageInst.domain,
      explorerSegments: () => cleaned,
    } as Lineage)
    return history.latestMarkerSigFor(locSig, name)
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
    // Bind malformed/absent segments to the CURRENT location (intent
    // time), never to root — `?? []` here silently re-addressed a
    // queen's update to ROOT, grafting the full layer state across.
    const cleaned = this.#cleanSegments(segments) ?? segmentsAtIntent()
    if (cleaned === null) {
      console.error('[LayerCommitter] update refused — no address resolvable', layer?.name)
      return ''
    }
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
   * Multi-position layer-tree commit — the bulk import / paste / adopt
   * primitive. Takes many `(segments, layer)` updates and commits each node
   * plus its DIRECT parent (so a pasted/adopted node lands in its parent's
   * children slot), deepest-first.
   *
   * PER-PAGE: like #commit, this does NOT cascade up to root. Ancestors above
   * the paste/adopt target keep their stale child sigs (resolved live). A deep
   * paste touches the pasted subtree + the target parent only — root is left
   * alone, exactly as a normal deep edit is.
   *   - total layer files written = |updates ∪ their direct parents|
   */
  // Public entry: run the import on the shared commit FIFO so its
  // read-modify-write can't interleave with a #commit (or another
  // importTree) on the same bag — the lost-child race. See CommitMachine.enqueue.
  public importTree = (
    updates: { segments: readonly string[]; layer: { name?: string } & { [slot: string]: unknown } }[],
    nameSlots: ReadonlySet<string> = new Set(['children']),
  ): Promise<void> => this.#machine.enqueue(() => this.#importTree(updates, nameSlots))

  readonly #importTree = async (
    updates: { segments: readonly string[]; layer: { name?: string } & { [slot: string]: unknown } }[],
    nameSlots: ReadonlySet<string> = new Set(['children']),
  ): Promise<void> => {
    if (updates.length === 0) return

    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursor?.state?.rewound) {
      // Never commit while the cursor is rewound (the assembled state reflects
      // the past view) — but never SILENTLY: a caller that resolves this void
      // as success (paste/adopt fold) would report committed while nothing was
      // written, and the work vanishes on the next refresh.
      console.warn('[LayerCommitter] importTree skipped — history cursor is rewound; nothing was committed', { updates: updates.length })
      return
    }

    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !history) return

    // Never commit while an "adopt for review" preview is active — the
    // rendered state includes a FOREIGN branch the visitor hasn't adopted;
    // a commit now could materialize preview seeds into real markers.
    // (hive-visit drops the preview before its own adopt fold.)
    if (history.previewActive) {
      console.warn('[LayerCommitter] importTree skipped — a preview is active; adopt or dismiss it first', { updates: updates.length })
      return
    }

    // Path encoding: segments joined by NUL, or '' for root. The separator
    // MUST be the escape sequence '\u0000' — never a literal NUL byte in
    // source. A literal byte was silently stripped by tooling once
    // (22d905a0), turning this into per-CHARACTER splitting: every create
    // committed its child under a bogus /z/t/i/l/e path named by the last
    // letter, and the parent linkage dedup'd away — tiles vanished on
    // creation.
    const encode = (segs: readonly string[]) => segs.join('\u0000')
    const decode = (key: string) => key === '' ? [] : key.split('\u0000')

    // Index updates by path.
    const updateByPath = new Map<string, { segments: string[]; layer: { name?: string } & { [slot: string]: unknown } }>()
    for (const u of updates) {
      const segs = (this.#cleanSegments(u.segments) ?? [])
      updateByPath.set(encode(segs), { segments: segs, layer: u.layer })
    }

    // Affected paths = every update path AND its DIRECT parent only — never
    // every ancestor up to root. Linking a pasted/adopted node commits its
    // immediate parent (whose children slot gains it); the parent's own
    // ancestors are NOT re-committed (per-page — the leaf→root cascade is
    // retired). Nodes deeper in the imported subtree already have their
    // parents in the update set; the shallowest update's direct parent is
    // the paste/adopt target.
    const affected = new Set<string>()
    for (const u of updateByPath.values()) {
      affected.add(encode(u.segments))
      if (u.segments.length > 0) affected.add(encode(u.segments.slice(0, -1)))
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

    // PRE-batch child names under a parent path — memoised per run. Read
    // during leaf processing (deepest-first, so every parent is read before
    // it commits) to decide whether a bare `{name}` update is a CREATE (the
    // parent does not list the name) or a pass-through of a live tile
    // (nested create `a/b/c` walking through an existing `a`).
    const parentChildNames = new Map<string, Promise<Set<string>>>()
    const namesUnder = (parentSegs: string[]): Promise<Set<string>> => {
      const key = encode(parentSegs)
      let pending = parentChildNames.get(key)
      if (!pending) {
        pending = (async () => {
          const parentName = parentSegs.length === 0 ? ROOT_NAME : parentSegs[parentSegs.length - 1]
          const parentLoc = await history.sign({
            domain: lineage.domain,
            explorerSegments: () => parentSegs,
          } as Lineage)
          const head = await history.getLayerBySig(await history.latestMarkerSigFor(parentLoc, parentName))
          const names = new Set<string>()
          const children = Array.isArray(head?.children) ? head.children as readonly unknown[] : []
          await Promise.all(children.map(async raw => {
            const child = await history.getLayerBySig(String(raw))
            if (child?.name) names.add(child.name)
          }))
          return names
        })()
        parentChildNames.set(key, pending)
      }
      return pending
    }

    for (const pathKey of ordered) {
      const segments = decode(pathKey)
      const ancestorName = segments.length === 0 ? ROOT_NAME : segments[segments.length - 1]
      const ancestorLocSig = await history.sign({
        domain: lineage.domain,
        explorerSegments: () => segments,
      } as Lineage)

      const prevSig = await history.latestMarkerSigFor(ancestorLocSig, ancestorName)
      const prevLayer = await history.getLayerBySig(prevSig)

      const update = updateByPath.get(pathKey)

      // Fresh-create guard: a bare `{name}` update (no slot arrays — the
      // typed-create shape) for a name the parent does NOT currently list
      // is a CREATE, and a create yields a fresh tile. The location bag
      // may still hold a previously-deleted tile's full history (delete
      // only unlinks from the parent; the bag survives for undo) — so
      // hydrating from its head would resurrect the old subtree, notes,
      // and tags into the "new" tile. Hydrate empty instead; the commit
      // below appends a bare marker (old markers stay — undo inside the
      // tile still walks back). Updates that carry slot arrays are
      // explicit layer state (move / adopt / paste) and hydrate from the
      // head as before, as do bare updates for live names (nested create
      // passing through an existing tile must not touch it).
      const fresh = update !== undefined
        && segments.length > 0
        && Object.entries(update.layer).every(([k, v]) => k === 'name' || !Array.isArray(v))
        && !(await namesUnder(segments.slice(0, -1))).has(ancestorName)
      const machine = LayerMachine.fromLayer(fresh ? null : prevLayer, ancestorName, segments)
      if (update) {
        for (const [slot, raw] of Object.entries(update.layer)) {
          if (slot === 'name') continue
          if (!Array.isArray(raw)) continue
          let sigs: string[]
          if (nameSlots.has(slot)) {
            // Snapshot prior (name→live sig) before the set so a paste / adopt
            // that re-lists this parent's children by name can't let a cold
            // bag auto-mint an existing child into an empty {name} husk — the
            // reference-tile disappearance guard (see #resolveChildName).
            const priorByName = await this.#priorChildSigByName(history, machine.getSlot(slot))
            sigs = []
            for (const cell of raw) {
              const trimmed = String(cell ?? '').trim()
              if (!trimmed) continue
              const cellSig = await this.#resolveChildName(history, lineage, segments, trimmed, priorByName)
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
      //
      // We can't early-skip when prevSig === newSig: that condition fires
      // both when "child is already linked under this exact sig" (no-op
      // desired) AND when "child is brand new and its bytes happened to
      // match the auto-minted seed sig" (must still append into parent.
      // children). Always run swap + name-fallback + append; the machine
      // ops are themselves no-ops when nothing actually needs to change,
      // and commitLayer dedup absorbs unchanged ancestor bytes.
      for (const childPathKey of childrenOf.get(pathKey) ?? []) {
        const transition = transitions.get(childPathKey)
        if (!transition) continue
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
              if (sig !== transition.newSig) {
                machine.apply({ slot: 'children', op: 'swap', from: sig, to: transition.newSig })
              }
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

      // A fresh create that actually RESET a rich head: participant-local
      // caches keyed by this location (props index, nurses) must drop, or
      // the deleted tile's image resurrects onto the fresh tile.
      // Transient: a point-in-time event; replaying it to a late
      // subscriber could clear an entry written AFTER the reset.
      if (fresh && !isBareLayer(prevLayer)) {
        EffectBus.emitTransient('cell:fresh', { cell: ancestorName, segments: segments.slice(0, -1) })
      }

      // Post-commit reconcile — mirror what #commit emits so subscribers
      // (show-cell's slot machine, activity log, substrate, tile-overlay)
      // see the children-set delta in name-space against the freshly
      // committed layer. Without this, the eager cell:added events that
      // queens emit BEFORE the import run against a still-stale layer and
      // the visual mount/unmount never reconciles to the new truth. Same
      // shape as the leaf-reconcile in #commit at lines 802-835.
      try {
        const prevChildSigs: readonly string[] = Array.isArray(prevLayer?.children)
          ? prevLayer.children as readonly string[]
          : []
        const newChildSigs = machine.getSlot('children') as readonly string[]
        const prevNames = new Set<string>()
        const newNames = new Set<string>()
        await Promise.all([
          ...prevChildSigs.map(async sig => {
            const c = await history.getLayerBySig(sig)
            if (c?.name) prevNames.add(c.name)
          }),
          ...newChildSigs.map(async sig => {
            const c = await history.getLayerBySig(sig)
            if (c?.name) newNames.add(c.name)
          }),
        ])
        for (const n of newNames) if (!prevNames.has(n)) {
          EffectBus.emit('cell:added', { cell: n, segments, fromCascade: true })
        }
        for (const n of prevNames) if (!newNames.has(n)) {
          EffectBus.emit('cell:removed', { cell: n, segments, fromCascade: true })
        }
      } catch (err) {
        console.warn('[LayerCommitter] importTree post-commit reconcile failed:', err)
      }
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

  // ── Cold-mint preserve guard ─────────────────────────────────────────
  //
  // `latestMarkerSigFor` auto-mints an empty `{name}` layer for any bag
  // that reads cold (see history.service.ts) — so any commit that re-lists
  // a parent's children BY NAME (paste, cut, move-into, promote, adopt,
  // any `nameSlots` layer update) can silently swap a live child's sig for
  // an empty husk. For a REFERENCE tile — whose entire identity is its
  // `decorations` slot, with no image fallback — that is fatal: it stops
  // portaling and renders blank; ordinary tiles merely go imageless. Undo
  // recovers (the prior marker still holds the real sig), but the next
  // same op re-breaks it. These helpers make name-resolution refuse to let
  // a cold husk overwrite a live child.

  /** name → its current live child sig, built from a parent's prior
   *  children sigs (the hydrated machine's slot, read BEFORE the set). */
  async #priorChildSigByName(
    history: HistoryService,
    priorChildSigs: readonly unknown[],
  ): Promise<Map<string, string>> {
    const byName = new Map<string, string>()
    await Promise.all(priorChildSigs.map(async (raw) => {
      const sig = String(raw ?? '')
      if (!/^[0-9a-f]{64}$/.test(sig)) return
      const layer = await history.getLayerBySig(sig)
      const name = typeof layer?.name === 'string' ? layer.name : ''
      if (name) byName.set(name, sig)
    }))
    return byName
  }

  /** True when a sig resolves to a bare `{name}` layer — no slot carries
   *  content. That is exactly the shape `latestMarkerSigFor` mints for a
   *  cold bag, so a bare result for an EXISTING child is the auto-mint
   *  fingerprint (a live child always carries children / notes / tags /
   *  decorations / properties). A missing layer counts as bare, so a read
   *  miss also prefers the known-live prior sig. */
  async #isBareHusk(history: HistoryService, sig: string): Promise<boolean> {
    return isBareLayer(await history.getLayerBySig(sig))
  }

  /** Resolve ONE child name to its live sig, guarding the cold-mint case:
   *  if `latestMarkerSigFor` degenerated to a bare `{name}` husk for a name
   *  we already hold a RICH sig for, keep the prior sig — never let a
   *  transient cold read blank a reference/tile. A legitimate edit yields a
   *  non-bare sig and is trusted verbatim; a genuinely new child (no prior)
   *  mints exactly as before. */
  async #resolveChildName(
    history: HistoryService,
    lineage: Lineage,
    parentSegs: readonly string[],
    name: string,
    priorByName: Map<string, string>,
  ): Promise<string> {
    const cellLocSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => [...parentSegs, name],
    } as Lineage)
    const resolved = await history.latestMarkerSigFor(cellLocSig, name)
    const prior = priorByName.get(name)
    // Fast path: brand-new child (no prior), or the resolve matched the
    // prior sig — trust the resolve, no extra reads.
    if (!prior || prior === resolved) return resolved
    // The resolve moved an existing child's sig. Fetch both layers' bareness
    // and let the pure guard decide — it keeps the prior only when a bare
    // {name} husk (cold-mint) would otherwise replace a live child.
    return chooseChildSig({
      resolvedSig: resolved,
      resolvedBare: await this.#isBareHusk(history, resolved),
      priorSig: prior,
      priorBare: await this.#isBareHusk(history, prior),
    })
  }

  async #commit(req: CommitRequest = { segments: null }): Promise<void> {
    // Never commit while cursor is rewound — the assembled state reflects
    // the past view, not a new user intent.
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursor?.state?.rewound) return

    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !history) return

    // Never commit while an "adopt for review" preview is active — the
    // assembled state includes a FOREIGN branch the visitor hasn't adopted.
    if (history.previewActive) {
      console.warn('[LayerCommitter] commit skipped — a preview is active; adopt or dismiss it first')
      return
    }

    // The address was BOUND at enqueue (CommitMachine.#addressed). A
    // drain-time fallback to the current lineage is forbidden: the queue
    // serialises across navigations, so "current" here can be a different
    // layer than the one the user acted on — that exact fallback grafted
    // one layer's children into another. Unaddressed = bug = refuse.
    if (req.segments === null) {
      console.error('[LayerCommitter] BUG: unaddressed commit reached #commit — refused', req)
      return
    }
    const segments = req.segments

    // ───────────────────────────────────────────────────────────
    // Per-page commit — LEAF ONLY. No cascade.
    //
    // We commit exactly the location where the change happened. Ancestors
    // are NOT re-committed: a parent's stored child sig is left as a stale
    // hint. The child's NAME stays valid (immutable; there is no rename
    // op), and any liveness/branch-status is resolved on demand from the
    // child's OWN bag head — never from the parent's stale sig. This
    // retires the eager leaf→root cascade (see per-page history): cost is
    // now one marker at the leaf, not segment-count markers up the spine.
    //
    //   1. Hydrate a LayerMachine from the leaf bag's current head.
    //   2. Apply the request's slot delta (sig or name-resolved).
    //   3. Output the layer JSON and commit. commitLayer dedups identical
    //      bytes — a bare re-snapshot that changes nothing writes no marker.
    // ───────────────────────────────────────────────────────────

    // Single leaf commit. `depth`/`sub` retain the cascade-era names so the
    // delta + reconcile guards below read unchanged; both are simply the
    // full leaf path now.
    {
      const depth = segments.length
      const sub = segments
      const ancestorName = depth === 0 ? ROOT_NAME : sub[sub.length - 1]
      const ancestorLocSig = await history.sign({
        domain: lineage.domain,
        explorerSegments: () => sub,
      } as Lineage)

      const prevSig = await history.latestMarkerSigFor(ancestorLocSig, ancestorName)
      const prevLayer = await history.getLayerBySig(prevSig)
      const machine = LayerMachine.fromLayer(prevLayer, ancestorName, sub)

      if (req.delta) {
        // Apply the request's slot delta at the leaf.
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
        } else if (d.kind === 'deltas') {
          // Swaps FIRST: a move's losing parent re-points the gaining
          // node's stale sig in place, and the removes below must run
          // against the settled list.
          for (const s of d.swaps ?? []) {
            if (typeof s?.from === 'string' && typeof s?.to === 'string' && s.from !== s.to) {
              machine.apply({ slot: d.slot, op: 'swap', from: s.from, to: s.to })
            }
          }
          for (const r of d.removes ?? []) {
            let hit = false
            if (r.sig) hit = machine.apply({ slot: d.slot, op: 'removeSig', sig: r.sig }).changed
            if (!hit && r.label) {
              // Sig miss — the caller's view of the child sig lags the
              // head (per-page staleness). Resolve by name against the
              // hydrated slot; bounded reads, only on the miss path.
              const present = machine.getSlot(d.slot) as readonly string[]
              for (const sig of present) {
                const child = await history.getLayerBySig(String(sig))
                if (child?.name === r.label) {
                  machine.apply({ slot: d.slot, op: 'removeSig', sig: String(sig) })
                  break
                }
              }
            }
          }
          for (const sig of d.appends ?? []) {
            if (typeof sig === 'string' && sig.length > 0) {
              machine.apply({ slot: d.slot, op: 'append', sig })
            }
          }
        } else if (d.kind === 'name') {
          // Legacy children name → sig resolution at commit time.
          if (d.op === 'add') {
            const cellLocSig = await history.sign({
              domain: lineage.domain,
              explorerSegments: () => [...sub, d.cell],
            } as Lineage)
            const headSig = await history.latestMarkerSigFor(cellLocSig, d.cell)
            let cellSig = headSig
            // Adding a name the parent does NOT list is a CREATE, and a
            // create yields a fresh tile. The location bag may still hold
            // a previously-deleted tile's full history (delete only
            // unlinks from the parent; the bag survives for undo) — so
            // linking the bag head would resurrect the old subtree.
            // Reset the head to the bare {name} layer instead; the old
            // markers stay (undo inside the tile still walks back).
            // `revive` opts back into head-linking — the undo-a-remove
            // gesture, where resurrection is exactly the point.
            if (!d.revive) {
              let listed = false
              for (const sig of machine.getSlot('children') as readonly string[]) {
                const child = await history.getLayerBySig(String(sig))
                if (child?.name === d.cell) { listed = true; break }
              }
              if (!listed) {
                cellSig = await history.commitLayer(cellLocSig, { name: d.cell })
                if (cellSig !== headSig) {
                  // A real reset happened (head was rich) — participant-
                  // local caches keyed by this location must drop.
                  // Transient: a point-in-time event; replaying it to a
                  // late subscriber could clear an entry written AFTER
                  // the reset.
                  EffectBus.emitTransient('cell:fresh', { cell: d.cell, segments: sub })
                }
              }
            }
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
              // Snapshot this slot's prior (name→live sig) map BEFORE the set,
              // so #resolveChildName can PRESERVE a live child sig that a cold
              // bag would otherwise auto-mint into an empty {name} husk — the
              // reference-tile / imageless-tile disappearance guard.
              const priorByName = await this.#priorChildSigByName(history, machine.getSlot(slot))
              // Each child's sign + latestMarkerSigFor pair is independent —
              // pure compute (memoized) and a bag head read respectively, with
              // no shared mutable state. Running them sequentially was O(N)
              // OPFS round-trips on cold cache (multi-second for large layers);
              // Promise.all collapses the wall-clock to ~one round-trip while
              // preserving order. filter() drops empty names and miss-resolves.
              const resolved = await Promise.all(values.map(async (cell) => {
                const trimmed = String(cell ?? '').trim()
                if (!trimmed) return ''
                return await this.#resolveChildName(history, lineage, sub, trimmed, priorByName)
              }))
              sigs = resolved.filter(Boolean)
            } else {
              sigs = values.map(v => String(v)).filter(Boolean)
            }
            machine.apply({ slot, op: 'set', sigs })
          }
        }
      }

      await history.commitLayer(ancestorLocSig, machine.output())

      // Slot-machine reconciliation. When a commit
      // replaces the children slot (e.g. via 'set' or 'layer' deltas,
      // or even when 'name' ops add/remove a child the slot-machine
      // listener didn't already know about), every other tab's
      // show-cell has a stale #slots state — names that were dropped
      // are still in the slot machine, names that were added aren't.
      // Without this, a fresh tab inheriting a previously-large
      // OPFS would render every dir it ever saw forever, until the
      // user navigates away (which is the only thing that re-seeds
      // the slot machine from layer truth).
      //
      // Diff the previous layer's children names vs the new layer's,
      // and emit cell:added / cell:removed for the deltas with the
      // fromCascade flag set so the committer's OWN listeners don't
      // re-queue them. Other listeners (show-cell, activity log, the
      // notes pane) process them normally and update their state.
      // Targeted reconcile for 'deltas' on children: the delta names the
      // exact sigs that changed, so resolve names for THOSE only —
      // O(delta) reads, never the O(prev + new) full re-read below.
      //
      // Reconciliation is in NAME space (subscribers are name-keyed), so
      // the sig diff is folded to names first: a SWAP re-points the same
      // tile to a new sig, yielding an added+removed pair for ONE name —
      // that is a cascade, not membership churn, and must emit nothing
      // (an emit pair would unmount then remount a live tile).
      if (req.delta?.kind === 'deltas' && req.delta.slot === 'children') {
        try {
          const prevSet = new Set(
            (Array.isArray(prevLayer?.children) ? prevLayer.children as readonly string[] : []).map(String),
          )
          const newSet = new Set((machine.getSlot('children') as readonly string[]).map(String))
          const changed: { sig: string; dir: 'added' | 'removed' }[] = []
          for (const s of newSet) if (!prevSet.has(s)) changed.push({ sig: s, dir: 'added' })
          for (const s of prevSet) if (!newSet.has(s)) changed.push({ sig: s, dir: 'removed' })
          const named = await Promise.all(changed.map(async ({ sig, dir }) => {
            const layer = await history.getLayerBySig(sig)
            return { cell: layer?.name ?? '', dir }
          }))
          const addedNames = new Set(named.filter(n => n.dir === 'added' && n.cell).map(n => n.cell))
          const removedNames = new Set(named.filter(n => n.dir === 'removed' && n.cell).map(n => n.cell))
          for (const cell of addedNames) {
            if (removedNames.has(cell)) continue  // sig swap of a live tile
            EffectBus.emit('cell:added', { cell, segments: sub, fromCascade: true })
          }
          for (const cell of removedNames) {
            if (addedNames.has(cell)) continue
            EffectBus.emit('cell:removed', { cell, segments: sub, fromCascade: true })
          }
        } catch (err) {
          console.warn('[LayerCommitter] deltas reconcile failed:', err)
        }
      }

      if (req.delta && (
        req.delta.kind === 'set' || req.delta.kind === 'layer' || req.delta.kind === 'name'
      )) {
        try {
          const prevChildSigs: readonly string[] = Array.isArray(prevLayer?.children)
            ? prevLayer.children as readonly string[]
            : []
          const newChildSigs = machine.getSlot('children') as readonly string[]
          const prevNames = new Set<string>()
          const newNames = new Set<string>()
          await Promise.all([
            ...prevChildSigs.map(async sig => {
              const c = await history.getLayerBySig(sig)
              if (c?.name) prevNames.add(c.name)
            }),
            ...newChildSigs.map(async sig => {
              const c = await history.getLayerBySig(sig)
              if (c?.name) newNames.add(c.name)
            }),
          ])
          const added: string[] = []
          const removed: string[] = []
          for (const n of newNames) if (!prevNames.has(n)) added.push(n)
          for (const n of prevNames) if (!newNames.has(n)) removed.push(n)
          for (const name of added) {
            EffectBus.emit('cell:added', { cell: name, segments: sub, fromCascade: true })
          }
          for (const name of removed) {
            EffectBus.emit('cell:removed', { cell: name, segments: sub, fromCascade: true })
          }
        } catch (err) {
          console.warn('[LayerCommitter] post-commit reconcile failed:', err)
        }
      }

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
