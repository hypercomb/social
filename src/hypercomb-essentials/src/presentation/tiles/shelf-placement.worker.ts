// presentation/tiles/shelf-placement.worker.ts
//
// THE SHELF'S DROP — where a reference carried on the shelf lands on a page
// (documentation/recents-and-the-quick-tray.md, codex A7 and A9). The shelf
// itself writes nothing; a row let go over the hive says `shelf:place`, and
// this worker makes the one write:
//
//   appearance  append the tile's collection sig to the target's children —
//               one surgical commit, the source untouched (A7: an incidence).
//   custody     the same append, then the source page stops listing it, in
//               that order, so a tile is never unlisted everywhere at once.
//
// It answers `shelf:placed` with what landed and what did not, and frames the
// work with `shelf:place-start` / `shelf:place-done` for the readers that
// hold still meanwhile (the substrate, the activity log).
//
// The placement itself is the sig-native engine that served the clipboard
// (clipboard-sig-native.md): a name already on the page COMBINES, the owner's
// tile winning every conflict; heads at the landing route are aligned; a
// peer's words stay marked as theirs where they land. The clipboard is gone;
// this is the part of it that was never about cut, copy or paste.

import { Worker, EffectBus, hypercomb } from '@hypercomb/core'
import { childEntriesOf, childLayerOf, resolveLayerAt, captureCollectionSig, alignPlacedHeads, combineLayerTree, advanceRoute } from '../../history/layer-placement.js'
import { seedLayerKeyedEntries } from '../../editor/tile-properties.js'
import { isPeerContentAt, markCarriedRoot } from '../../sharing/adopted-roots.js'

/** One reference to place: a tile's name, the page it stands on, and — for an
 *  atom no page lists — the exact sig to place, since there is nothing to seal. */
export interface ShelfEntry {
  label: string
  sourceSegments: readonly string[]
  sig?: string
  /** Taken from a peer's branch: the words stay marked as theirs where they land. */
  fromPeer?: boolean
}

interface LineageLike {
  explorerSegments(): readonly string[]
  readonly domain?: unknown
}

/** Minimal layer shape — `name` identifies the cell, `children` holds
 *  child-layer sigs; other slots ride along unchanged. */
interface LayerLike {
  name?: string
  children?: readonly string[]
  [slot: string]: unknown
}

interface HistoryServiceLike {
  sign(lineage: { domain?: unknown; explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<LayerLike | null>
  commitLayer(locationSig: string, layer: LayerLike): Promise<string>
  getLayerBySig(sig: string): Promise<LayerLike | null>
  childrenManifestFor?(layer: LayerLike): Promise<Array<{ sig: string; layer: { name?: string; [k: string]: unknown } }> | null>
  /** Merkle fold of a subtree's live heads into one pool-written root sig. */
  sealSubtree?(segments: readonly string[]): Promise<string | null>
  /** Pool-write a derived layer (canonicalize → sign → write, no marker). */
  materializeLayer?(layer: { name?: string; [k: string]: unknown }): Promise<string>
}

interface LayerCommitterLike {
  commitChildrenDeltas(
    segments: readonly string[],
    changes: {
      removes?: readonly { sig?: string; label?: string }[]
      appends?: readonly string[]
      swaps?: readonly { from: string; to: string }[]
      order?: { set?: Record<string, number>; remove?: readonly string[] }
    },
  ): Promise<void | string>
}

interface StoreLike {
  getResource?: (sig: string) => Promise<Blob | null>
}

const SIG = /^[0-9a-f]{64}$/

export class ShelfPlacementWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'

  public override description =
    'Places a reference from the shelf on a page: an appearance, or a move when Shift is held.'

  protected override listens = ['shelf:place']

  protected override emits = [
    'shelf:place-start',
    'shelf:place-done',
    'shelf:placed',
    'cell:added',
    'cell:removed',
  ]

  constructor() {
    super()
    // A row let go over the hive. The target is BOUND by the shelf at release
    // time, so a placement never drifts to wherever navigation is by the time
    // the async work runs. A `sig` is an atom no page lists: nothing to seal
    // from, so it places as given.
    EffectBus.on<{ entries?: { label?: string; sourceSegments?: string[]; sig?: string }[]; targets?: Record<string, number>; targetSegments?: string[]; custody?: boolean }>(
      'shelf:place',
      (payload) => {
        const raw = Array.isArray(payload?.entries) ? payload!.entries! : []
        const entries: ShelfEntry[] = raw
          .filter((e): e is { label: string; sourceSegments?: string[]; sig?: string } => !!e && typeof e.label === 'string')
          .map(e => ({
            label: e.label,
            sourceSegments: Array.isArray(e.sourceSegments) ? [...e.sourceSegments] : [],
            ...(typeof e.sig === 'string' && SIG.test(e.sig) ? { sig: e.sig } : {}),
          }))
        const targets = (payload?.targets && typeof payload.targets === 'object') ? payload.targets : undefined
        if (entries.length > 0) void this.#placeEntries(entries, targets, this.#boundTarget(payload?.targetSegments), payload?.custody === true)
      },
    )
  }

  protected override act = async (): Promise<void> => { }

  // ── helpers ───────────────────────────────────────────

  get #lineage(): LineageLike | undefined {
    return get('@hypercomb.social/Lineage') as LineageLike | undefined
  }

  get #store(): StoreLike | undefined {
    return get('@hypercomb.social/Store') as StoreLike | undefined
  }

  get #history(): HistoryServiceLike | undefined {
    return get('@diamondcoreprocessor.com/HistoryService') as HistoryServiceLike | undefined
  }

  get #committer(): LayerCommitterLike | undefined {
    return get('@diamondcoreprocessor.com/LayerCommitter') as LayerCommitterLike | undefined
  }

  get #cursor(): { currentLayerSig?: string; state?: { rewound?: boolean } } | undefined {
    return get('@diamondcoreprocessor.com/HistoryCursorService') as
      { currentLayerSig?: string; state?: { rewound?: boolean } } | undefined
  }

  /** The target as the shelf bound it at release; the live page otherwise. */
  #boundTarget(explicit?: readonly string[]): string[] {
    if (Array.isArray(explicit)) return [...explicit]
    return [...(this.#lineage?.explorerSegments() ?? [])]
  }

  /** Editing is refused while the history cursor is rewound — scrub-back is
   *  view-only. The committer would silently decline, so say so and decline
   *  BEFORE anything half-runs. True when blocked. */
  #blockedByRewound(verb: string): boolean {
    if (!this.#cursor?.state?.rewound) return false
    EffectBus.emit('toast:show', {
      type: 'info',
      title: 'Viewing history',
      message: `Can't ${verb} while scrubbed back — return to the latest (Restore) to edit.`,
    })
    return true
  }

  /** The layer at `segs`: the parent chain, then — for the page on screen —
   *  the cursor, which proves the tiles are rendered even when the chain's
   *  cache is cold. */
  async #resolveParentLayer(
    history: HistoryServiceLike,
    segs: readonly string[],
    currentSegs: readonly string[],
  ): Promise<LayerLike | null> {
    const viaChain = await resolveLayerAt(history, this.#lineage?.domain, segs)
    if (viaChain) return viaChain
    const sameLocation =
      segs.length === currentSegs.length && segs.every((s, i) => s === currentSegs[i])
    if (sameLocation) {
      const sig = this.#cursor?.currentLayerSig
      if (sig) {
        const layer = await history.getLayerBySig(sig)
        if (layer) return layer
      }
    }
    return null
  }

  async #placeEntries(entries: readonly ShelfEntry[], targets?: Record<string, number>, boundTarget?: readonly string[], custody = false): Promise<void> {
    const lineage = this.#lineage
    const store = this.#store
    const history = this.#history
    const committer = this.#committer
    if (!lineage || !store || !history || !committer || entries.length === 0) return
    // Commits at the target; refused while rewound. Feedback, don't half-run.
    if (this.#blockedByRewound('place')) return

    const targetSegments = boundTarget ? [...boundTarget] : [...lineage.explorerSegments()]
    EffectBus.emit('shelf:place-start', { count: entries.length })
    const { placed, failed } = await this.#placeItems(history, lineage, committer, entries, targetSegments, targets)
    // CUSTODY releases the source only AFTER the append landed, so a tile is
    // never unlisted everywhere at once.
    if (custody && placed.length > 0) await this.#releaseSource(history, committer, placed, targetSegments)
    EffectBus.emit('shelf:place-done', { count: placed.length, failed })
    EffectBus.emit('shelf:placed', {
      placed: placed.map(e => ({ label: e.label, sourceSegments: [...e.sourceSegments] })),
      failed,
      custody,
    })
  }

  /** The drop that MOVES (codex A9: custody). The incidence has landed at the
   *  target; now each source page stops listing it — one surgical commit per
   *  source parent, exactly the cut's commit, made after the append. A tile
   *  dropped back on its own page is an appearance and is never released. */
  async #releaseSource(
    history: HistoryServiceLike,
    committer: LayerCommitterLike,
    placed: readonly ShelfEntry[],
    targetSegments: readonly string[],
  ): Promise<void> {
    const groups = new Map<string, { parentSegs: string[]; leaves: string[] }>()
    for (const entry of placed) {
      const samePlace = entry.sourceSegments.length === targetSegments.length
        && entry.sourceSegments.every((s, i) => s === targetSegments[i])
      if (samePlace) continue
      const key = entry.sourceSegments.join('/')
      const group = groups.get(key) ?? { parentSegs: [...entry.sourceSegments], leaves: [] }
      group.leaves.push(entry.label)
      groups.set(key, group)
    }
    const liveCurrent = [...(this.#lineage?.explorerSegments() ?? [])]
    for (const { parentSegs, leaves } of groups.values()) {
      const parent = await this.#resolveParentLayer(history, parentSegs, liveCurrent)
      if (!parent) {
        console.warn(`[shelf] custody release skipped — parent layer unresolved at /${parentSegs.join('/')}`)
        continue
      }
      const { entries } = await childEntriesOf(history, parent)
      const sigByName = new Map(entries.map(e => [e.name, e.sig]))
      const removes = leaves.map(leaf => {
        const stored = sigByName.get(leaf)
        return { ...(stored ? { sig: stored } : {}), label: leaf }
      })
      for (const leaf of leaves) {
        EffectBus.emit('cell:removed', { cell: leaf, segments: [...parentSegs], viaUpdate: true })
      }
      await committer.commitChildrenDeltas(parentSegs, { removes })
      EffectBus.emit('fs:changed', { segments: [...parentSegs] })
    }
  }

  // ── placement ─────────────────────────────────────────
  // Sig-native: each item resolves to ONE collection sig (the loose atom's
  // own, or the live subtree sealed now), and the whole drop is ONE surgical
  // commit appending those sigs to the target's `children`.
  // The subtree is never re-committed — its bytes are pool-addressed and
  // position-independent, and navigation into it resolves lazily through
  // the parent chain (HistoryService seeds the bag on first visit/edit).

  async #placeItems(
    history: HistoryServiceLike,
    lineage: LineageLike,
    committer: LayerCommitterLike,
    items: readonly ShelfEntry[],
    targetSegments: readonly string[],
    targets?: Record<string, number>,
  ): Promise<{ placed: ShelfEntry[]; failed: string[] }> {
    // Phase stopwatch — one summary line per paste (repo perf-log style).
    const tStart = performance.now()
    let tParent = 0, tCapture = 0, tPrep = 0, tSeed = 0, tCommit = 0

    // Resolve the BOUND target layer for the collision check only — the
    // commit below is delta-shaped (append), hydrates from the bag head
    // itself, and never re-lists children, so a cold/unresolved target no
    // longer risks wiping anything. The cursor fallback inside
    // #resolveParentLayer is gated on the bound target being the page
    // currently on screen; the target itself was frozen at intent.
    const liveCurrent = [...lineage.explorerSegments()]
    const parent = await this.#resolveParentLayer(history, targetSegments, liveCurrent)
    // Collision names: manifest-first, tolerant. An append can't wipe a
    // cold sibling, so the strict-read refusals ("paste deferred — cold
    // sibling") are structurally unnecessary; a cold miss at worst lets a
    // duplicate name through, and the head is the final word on membership.
    // A name already here is a COMBINE, never a skip: the owner's tile wins
    // every conflict and the incoming one only fills what is absent. `missing`
    // children are names we cannot see, so a name not found is resolved by
    // name through the parent before it is appended as new.
    const { entries: existingEntries, missing } = await childEntriesOf(history, parent)
    tParent = performance.now() - tStart
    const existingByName = new Map(existingEntries.map(e => [e.name, e.sig] as const))
    const swaps: { from: string; to: string }[] = []
    const combined: string[] = []
    // Same-named children combined one level down, by path: their ROUTES may hold a head.
    const merges: { segments: string[]; layer: LayerLike }[] = []
    const pending = new Map<string, number>() // label -> index in appends

    const placed: ShelfEntry[] = []
    const appends: string[] = []
    // Hover-number targets: seats in the target page's order, same marker.
    const seats: Record<string, number> = {}
    const failed: string[] = []
    // A peer's tile landing outside any peer branch: marked once it commits.
    const carried: string[][] = []
    for (const entry of items) {
      // Self / descendant guard: never place a cell into its own subtree
      // (e.g. dropping `/a/X` at `/a/X/sub`) — pure path check; location
      // sigs are path-derived so equal paths ⇔ equal locations. Paste
      // back in place (identical paths) is allowed.
      const srcPath = [...entry.sourceSegments, entry.label]
      const dstPath = [...targetSegments, entry.label]
      const samePlace = srcPath.length === dstPath.length && srcPath.every((s, i) => s === dstPath[i])
      if (!samePlace &&
          dstPath.length >= srcPath.length &&
          srcPath.every((s, i) => s === dstPath[i])) {
        console.warn(`[shelf] skipped self/descendant place of '${entry.label}' → /${targetSegments.join('/')}`)
        failed.push(entry.label)
        continue
      }

      const tCap0 = performance.now()
      // The collection sig: captured at cut/copy intent. Sig-less entries
      // (side-panel drilled children, legacy restores) seal at place time
      // — same primitive, applied late; the source parent's stored child
      // sig backs it up inside captureCollectionSig.
      let sig = entry.sig ?? null
      if (!sig) sig = await captureCollectionSig(history, srcPath)
      let layer = sig ? await history.getLayerBySig(sig) : null
      tCapture += performance.now() - tCap0
      if (!sig || !layer) {
        console.warn(`[shelf] source missing for '${entry.label}': /${entry.sourceSegments.join('/')}`)
        failed.push(entry.label)
        continue
      }
      // Name assertion: the sig MUST name the cell we intend to place —
      // if capture drifted to a parent/sibling, refuse this item rather
      // than link the wrong subtree in.
      if (typeof layer.name === 'string' && layer.name !== entry.label) {
        console.warn(`[shelf] source mismatch for '${entry.label}': resolved '${layer.name}'; skipping`)
        failed.push(entry.label)
        continue
      }

      const tPrep0 = performance.now()
      // Hover-number paste target: a seat in the TARGET page's order
      // (history/tile-order.ts), written in the same marker as the append.
      // The placed tile is appended as it is — never re-minted to carry it.
      const target = targets?.[entry.label]
      if (typeof target === 'number' && Number.isFinite(target) && target >= 0) seats[entry.label] = Math.trunc(target)
      tPrep += performance.now() - tPrep0

      // Collision: fold the incoming tile INTO the one already here.
      let ownSig: string | undefined = pending.has(entry.label) ? appends[pending.get(entry.label)!] : existingByName.get(entry.label)
      if (!ownSig && missing > 0) ownSig = (await childLayerOf(history, parent, entry.label))?.sig
      if (ownSig && ownSig !== sig) {
        const inPending = pending.has(entry.label)
        // The route's own head outranks the parent's listed sig — it is the owner.
        let ownLayer = await history.getLayerBySig(ownSig)
        if (!inPending) {
          const locSig = await history.sign({ domain: lineage.domain, explorerSegments: () => [...targetSegments, entry.label] }).catch(() => '')
          const head = locSig ? await history.currentLayerAt(locSig).catch(() => null) : null
          if (head) ownLayer = head
        }
        // Own wins, incoming fills what is absent, nothing own is dropped; same-named
        // children combine one level down (the shared seam, layer-placement.ts).
        const merged = ownLayer ? (await combineLayerTree(history, ownLayer, layer, [...targetSegments, entry.label], merges)).layer : null
        const mergedSig = merged ? await history.materializeLayer?.(merged) : undefined
        if (!mergedSig) {
          // Cannot combine: it stays on the shelf rather than drop or duplicate.
          console.warn(`[shelf] could not combine '${entry.label}' into the existing tile; it stays on the shelf`)
          failed.push(entry.label)
          continue
        }
        if (inPending) appends[pending.get(entry.label)!] = mergedSig
        else if (mergedSig !== ownSig) { swaps.push({ from: ownSig, to: mergedSig }); existingByName.set(entry.label, mergedSig) }
        combined.push(mergedSig)
        placed.push({ label: entry.label, sourceSegments: entry.sourceSegments })
        continue
      }
      if (ownSig === sig) {
        placed.push({ label: entry.label, sourceSegments: entry.sourceSegments })
        continue
      }

      pending.set(entry.label, appends.length)
      appends.push(sig)
      placed.push({ label: entry.label, sourceSegments: entry.sourceSegments })
      if ((entry.fromPeer === true || isPeerContentAt(srcPath)) && !isPeerContentAt(dstPath)) carried.push(dstPath)
    }

    if (placed.length === 0) return { placed, failed }

    EffectBus.emit('fs:changed', { segments: [...targetSegments] })

    // Eager visual mount; `viaUpdate` makes the committer's per-event
    // listener skip queueing — the delta commit below is the atomic commit.
    for (const entry of placed) {
      EffectBus.emit('cell:added', { cell: entry.label, segments: [...targetSegments], viaUpdate: true })
    }

    // Seed the LAYER-keyed render index for the pasted subtree — a pure
    // sig-walk over warm pool bytes, no commits, keys are the pasted
    // layers' own sigs (valid before or after the delta commit below).
    // Show-cell paints layer-first and derives from canonical on a miss,
    // so this is a warm-up, not a requirement.
    const tSeed0 = performance.now()
    try {
      await this.#seedPropsIndex(history, [...appends, ...combined], targetSegments)
    } catch (err) {
      console.warn('[shelf] props-index seed skipped', err)
    }
    tSeed = performance.now() - tSeed0

    // ONE surgical commit: the target's children gain the collection sigs.
    // Existing children (warm or cold) ride through verbatim.
    const tCommit0 = performance.now()
    await committer.commitChildrenDeltas(targetSegments, {
      appends,
      ...(swaps.length > 0 ? { swaps } : {}),
      ...(Object.keys(seats).length > 0 ? { order: { set: seats } } : {}),
    })
    // A route that already has a head of that name would open the OLD tile.
    // The append has already landed: a stale head here (another tab moved it)
    // must not abort placement bookkeeping (consume, paste-done, act).
    try {
      await alignPlacedHeads(history, lineage.domain, targetSegments, [...appends, ...combined])
    } catch (err) {
      console.warn('[shelf] head alignment skipped after append landed', err)
    }
    // A child combined one level down whose own route has a head would still open it.
    for (const m of merges) {
      try { await advanceRoute(history, lineage.domain, m.segments, m.layer) }
      catch (err) { console.warn('[shelf] child head alignment skipped', err) }
    }
    tCommit = performance.now() - tCommit0
    // THE WORDS STAY THEIRS where they land (adopted-roots.ts, carried roots).
    for (const path of carried) markCarriedRoot(path)
    console.log(
      `[shelf] place: total=${Math.round(performance.now() - tStart)}ms ` +
      `parent=${Math.round(tParent)}ms capture=${Math.round(tCapture)}ms prep=${Math.round(tPrep)}ms ` +
      `seed=${Math.round(tSeed)}ms commit=${Math.round(tCommit)}ms ` +
      `(${placed.length} placed, ${existingEntries.length} existing children)`
    )
    await new hypercomb().act()

    // No forced full re-render: the eager cell:added above covers it.

    return { placed, failed }
  }

  // Walk a placed collection (pool-warm, sig-addressed) and seed the
  // LAYER-keyed render index (Phase C sweep, visuals-across-lineages.md):
  // the walk's `sig` IS each node's committed head, so `index[sig] =
  // properties[0]` is a pure derivation — no location keys, no signing.
  // Read-only over layers; one localStorage write at the end.
  async #seedPropsIndex(
    history: HistoryServiceLike,
    rootSigs: readonly string[],
    _targetSegments: readonly string[],
  ): Promise<void> {
    const pairs: Array<[string, string]> = []
    const seen = new Set<string>()
    const queue: string[] = [...rootSigs]
    while (queue.length > 0) {
      const sig = queue.shift()!
      if (seen.has(sig)) continue
      seen.add(sig)
      const layer = await history.getLayerBySig(sig)
      if (!layer) continue
      const props = (layer as { properties?: unknown }).properties
      const propSig = Array.isArray(props) && typeof props[0] === 'string' ? props[0] : undefined
      if (propSig && /^[0-9a-f]{64}$/.test(propSig)) pairs.push([sig, propSig])
      const children = Array.isArray(layer.children) ? layer.children : []
      for (const c of children) queue.push(String(c))
    }
    if (pairs.length > 0) seedLayerKeyedEntries(pairs)
  }

  /** Canonical props-resource sig for the cell at `segments` — `properties[0]`
   *  in the cell's head layer (editor/tile-properties.ts). The shelf's and the
   *  chat's thumbnails fall back to this when the participant-local render
   *  index has no entry, so a picture shows without a render and a generated
   *  image is never lost. The warm PARENT-slot path first (the parent still
   *  lists the cell), then the cell's OWN bag (a moved tile leaves a non-empty
   *  bag in place, so this is not the cold read that triggers preloadAllBags).
   *  Best-effort. */
  async propsSigAt(segments: readonly string[]): Promise<string | null> {
    const history = this.#history
    const lineage = this.#lineage
    if (!history || segments.length === 0) return null
    const label = segments[segments.length - 1]
    const parent = await resolveLayerAt(history, lineage?.domain, segments.slice(0, -1))
    let layer: unknown = (await childLayerOf(history, parent, label))?.layer ?? null
    if (!layer) {
      const ownSig = await history.sign({ domain: lineage?.domain, explorerSegments: () => segments })
      layer = await history.currentLayerAt(ownSig)
    }
    const slot = (layer as { properties?: readonly unknown[] } | null | undefined)?.properties
    const sig = Array.isArray(slot) && slot.length > 0 ? slot[0] : undefined
    return (typeof sig === 'string' && /^[0-9a-f]{64}$/.test(sig)) ? sig : null
  }
}

const _shelfPlacement = new ShelfPlacementWorker()
window.ioc.register('@diamondcoreprocessor.com/ShelfPlacementWorker', _shelfPlacement)
