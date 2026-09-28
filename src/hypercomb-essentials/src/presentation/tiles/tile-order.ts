// tile-order.ts — WHERE EACH TILE SITS. A branch of the tile renderer
// (documentation/tile-renderer-tree.md): given the names a layer holds, which
// axial slot each one takes. Pinned is the only mode — a tile keeps the slot
// index it was given, gaps stay gaps — so ordering is, in turn:
//
//   1. local tiles at their persisted index (collisions demoted);
//   2. peer tiles at the publisher's index where that slot is free here;
//   3. the rest score-filled (off-screen distance, whitespace, centre) and
//      remembered for the session — never persisted by a render;
//   4. a frame, if the location has one, re-reading that order through its
//      pattern.
//
// Durable indexes come only from deliberate acts: a new tile (placeNew), an
// explicit place-at (placeAt), and the move drone. The host is the renderer:
// it knows the axial grid, where the participant stands, its slot machine,
// and how to paint again.

import { writeTilePropertiesAt, readTilePropertiesAt, cellLocationSig } from '../../editor/tile-properties.js'
import { slotAt, type AxialLike } from '../../sequence/pattern.js'
import type { HistoryService } from '../../history/history.service.js'
import type { HistoryCursorService } from '../../history/history-cursor.service.js'
import { resolveChildNames } from './layer-membership.js'

/** A reference being composed: it owns its release slot while the
 *  References composition is open. */
export type ReferenceDraftPreview = {
  name: string
  imageSig?: string
  index: number
  parentSegments: readonly string[]
}

export interface OrderHost {
  axial(): any
  lineage(): any
  /** The renderer's slot machine: the page as placed, and a way to add one. */
  slots(): { snapshot(): { names: string[] }; addAt(name: string, slot: number, hasBranch: boolean): boolean }
  referenceDraft(): ReferenceDraftPreview | null
  /** The `>?` keyword narrowing tiles by name or mark. */
  keyword(): string
  tagsFor(label: string): string[]
  /** Indexes moved underneath the renderer: drop its caches and paint again. */
  invalidate(): void
}

export class TileOrder {
  /** Where a tile without a persisted index was placed this tab session, so
   *  pans, peer churn and synchronize passes never move it. Only a manual
   *  reorganize (or leaving the location) clears it. */
  readonly #sessionSlots = new Map<string, number>()

  constructor(private readonly host: OrderHost) {}

  /** Forget one tile's session slot (a reference draft that let go of it). */
  forget(label: string): void { this.#sessionSlots.delete(label) }

  /** Forget every session slot (the location changed underneath). */
  forgetAll(): void { this.#sessionSlots.clear() }

  layoutMode(_locationKey: string): 'dense' | 'pinned' {
    // Pinned is the canonical default: each cell keeps its slot index
    // permanently (stored in its 0000 properties). The spiral/contiguous
    // fill runs only once — to assign an index to a brand-new cell that
    // has none yet. Removal leaves a gap, never shifts neighbours.
    return 'pinned'
  }

  // `navPass`: true when this pass is a layer CHANGE (navigation). During a
  // nav the viewport still belongs to the OUTGOING page — the destination
  // pan/zoom is applied later in the pass, and ViewportPersistence/
  // CenterSlotTracker aren't synced forward on nav at all — so any
  // viewport-scored placement here would land tiles relative to the page
  // the user just LEFT. On nav passes, unindexed placement is therefore
  // deterministic (lowest free slot), never camera-relative. Same-page
  // passes (tile added while viewing) keep the viewport score: there the
  // camera is live and correct.
  // `orderStats.coldIndexNames`: out-param — tiles whose index read was
  // TRANSIENTLY unresolvable this pass (layer head cold, bytes not pooled).
  // The caller gates the paint on it: placing a cold tile means painting a
  // tile that HAS a durable slot at a wrong one.
  async pinned(dir: FileSystemDirectoryHandle, names: string[], localCellSet: Set<string>, readOnly = false, peerIndices?: Map<string, number>, passSegments?: readonly string[], navPass = false, orderStats?: { coldIndexNames: string[] }): Promise<string[]> {
    const axial = this.host.axial()
    const maxSlot = axial?.count ?? 60
    const sparse: string[] = new Array(maxSlot + 1).fill('')

    const unindexed: string[] = []

    // IndexNurse owns the index read path — layer-slot first, 0000
    // fallback (the legacy path; consulted only when the layer carries
    // no properties yet). Caches per cell; invalidates on
    // `cell:0000-changed` broadcast (both writeTilePropertiesAt and
    // writeCellProperties emit it). Cold misses fall through to either
    // the layer's properties slot or the 0000 file; warm reads are
    // constant-time. Registered eagerly in side-effects.
    const indexNurse = (window as any).ioc?.get?.('@diamondcoreprocessor.com/IndexNurse') as
      | { read: (parentSegments: readonly string[], cellName: string, cellDir?: FileSystemDirectoryHandle, cacheKey?: string, stats?: { cold?: boolean }) => Promise<number | undefined> }
      | undefined

    // Cache key is the cell's lineage signature, never its bare folder
    // name. Two cells in different parent folders can share a leaf
    // name (a "Notes" tile is common at many depths) and a name-keyed
    // cache returns the first-seen index for every subsequent read of
    // the same leaf — which on cold-load-at-subfolder + nav-back
    // resolves to the SUBFOLDER's index, collides with the parent's
    // real occupant, demotes the loser to unindexed, and persists it
    // to slot 0. The lineage signature is unique per location and the
    // same address inflate uses, so the in-memory cache, the on-disk
    // 0000.index, and the inflate tree all agree on which cell is
    // which.
    const lineage = this.host.lineage()
    // THE ADDRESS OF THIS PASS. Must come from the render pass that named
    // the cells (passSegments), never re-resolved from live lineage: the
    // index wave below spans many awaits, and a navigation mid-pass used
    // to re-key every read against the NEW location — all misses — then
    // fire-and-forget persist the OLD layer's every tile against the NEW
    // location. Each of those commits cascade-attached the old cell into
    // the new layer's children: the "whole layer copied into the next
    // layer" graft. Names and address now bind at the same instant.
    const parentSegments: readonly string[] = passSegments ?? lineage?.explorerSegments?.() ?? []

    // Pass 1 — place LOCAL indexed cells first so they own their persisted
    // slots before any peer-published index gets a chance to claim them.
    // Peer tiles deferred to Pass 2 below.
    //
    // The per-cell index reads are independent — resolve them in ONE
    // PARALLEL WAVE. Each read costs up to three awaited roundtrips (dir
    // probe, location-sig hash, nurse read); doing them serially made
    // this loop O(cells) in wall-time — measured ~275ms for a 120-tile
    // layer, the entire pre-stream stall of a navigation. PLACEMENT
    // stays strictly sequential in `names` order below, so collision
    // semantics are identical to the serial version.
    const peerNames: string[] = []
    const localNames: string[] = []
    for (const name of names) {
      if (!localCellSet.has(name)) peerNames.push(name)
      else localNames.push(name)
    }
    const idxByName = new Map<string, number | undefined>()
    // Per-name cold flags: a read is COLD when it was transiently
    // unresolvable (head not warmed, bytes not pooled, services booting) —
    // as opposed to an authoritative "tile has no index". Cold + undefined
    // means we do NOT know this tile's slot; the caller's index gate holds
    // the paint rather than score-filling a tile that owns a real slot.
    const coldByName = new Set<string>()
    await Promise.all(localNames.map(async (name) => {
      // The draft owns the release slot for the lifetime of the References
      // composition. Do not ask the layer for an index it cannot have yet and
      // do not score-fill it somewhere else.
      const draft = this.host.referenceDraft()
      const isDraftHere = !!draft
        && draft.name === name
        && draft.parentSegments.length === parentSegments.length
        && draft.parentSegments.every((segment, index) => String(segment) === String(parentSegments[index]))
      if (draft && isDraftHere && draft.index <= maxSlot) {
        idxByName.set(name, draft.index)
        return
      }
      try {
        // Layer-slot read with 0000 fallback. cellDir is opportunistic
        // — the dir may not exist for layer-only tiles, in which case
        // getDirectoryHandle throws and we still read from the layer.
        let cellDir: FileSystemDirectoryHandle | undefined
        try { cellDir = await dir.getDirectoryHandle(name, { create: false }) } catch { /* layer-only tile */ }
        const cacheKey = await cellLocationSig(parentSegments, name)
        const readStats = { cold: false }
        const idx = indexNurse
          ? await indexNurse.read(parentSegments, name, cellDir, cacheKey, readStats)
          : await readTilePropertiesAt(parentSegments, name, readStats).then(p =>
              typeof p['index'] === 'number' ? (p['index'] as number) : undefined,
            )
        idxByName.set(name, typeof idx === 'number' ? idx : undefined)
        if (readStats.cold && typeof idx !== 'number') coldByName.add(name)
      } catch {
        idxByName.set(name, undefined)
        // A throw is never an authoritative "no index" — treat as cold so
        // the gate retries instead of mis-placing the tile.
        coldByName.add(name)
      }
    }))
    if (orderStats) orderStats.coldIndexNames = [...coldByName].sort()
    for (const name of localNames) {
      const idx = idxByName.get(name)
      if (typeof idx === 'number' && idx >= 0 && idx <= maxSlot) {
        // collision detection: if slot is already occupied, demote to unindexed
        if (sparse[idx] !== '') {
          unindexed.push(name)
        } else {
          sparse[idx] = name
        }
      } else {
        unindexed.push(name)
      }
    }

    // Pass 2 — peer tiles. Honor the publisher's `index` when the
    // matching slot is free locally; otherwise demote to the unindexed
    // pile and let the score-based fill below pick a slot.
    //
    // Why honor it: when the receiver has no conflicting local tile at
    // the published index, using it preserves the visual identity the
    // publisher set (a tile at "their" slot 3 sits at slot 3 on every
    // receiver who has slot 3 free). On a fresh incognito canvas with
    // zero local tiles every peer index lands clean — exactly the
    // scenario the user called out: "there are most certainly no
    // indexes in the way with zero initial tiles."
    //
    // Why the collision check is enough: Pass 1 (above) has already
    // claimed every slot a local indexed tile owns. If a peer index
    // collides with one of those, sparse[peerIdx] !== '' and we fall
    // through to the unindexed queue. So local layout stays sovereign;
    // peer indices are only respected on otherwise-empty slots.
    //
    // Deterministic peer order: sort peer names before placement so
    // multi-peer rendering is stable across reruns and freshness
    // rotation. Without this, two peers republishing the same name
    // with different indices could flip the surviving slot every
    // render based on Map-iteration order.
    peerNames.sort((a, b) => a.localeCompare(b))
    for (const name of peerNames) {
      const peerIdx = peerIndices?.get(name)
      if (typeof peerIdx === 'number' && peerIdx >= 0 && peerIdx <= maxSlot && sparse[peerIdx] === '') {
        sparse[peerIdx] = name
      } else {
        unindexed.push(name)
      }
    }

    // Sort the unindexed pile alphabetically before the score-based
    // fill below. Same determinism reason: scoreMap is deterministic
    // (slots evaluate identically given the same viewport), so the
    // ONLY non-deterministic input is the iteration order of unindexed
    // — sort it and the whole layout becomes reproducible across
    // renders. Local-without-index and peers share the queue at this
    // point; both classes are stable name-keyed, which is what the
    // user-spec wants.
    unindexed.sort((a, b) => a.localeCompare(b))

    // Place each unindexed cell at the best free slot. #bestFreeSlotByScore
    // scores empty slots by off-screen distance, then whitespace, then
    // center proximity (lowest-free fallback when the viewport tracker isn't
    // ready) — the SAME helper the pinned incremental-add path uses, so a
    // cell created via the fast path and one placed in a full render land on
    // identical slots.
    const placedUnindexed: string[] = []
    for (const name of unindexed) {
      // Session-cache short-circuit. If this tile was already placed in a
      // prior render (local-no-index path during a persistence race, or any
      // peer tile) and the slot is still free, drop it back into the same
      // slot. Pans don't change cached assignments; only manual reorganize
      // clears this map.
      const cachedSlot = this.#sessionSlots.get(name)
      let placed: number
      if (typeof cachedSlot === 'number' && cachedSlot >= 0 && cachedSlot <= maxSlot && sparse[cachedSlot] === '') {
        placed = cachedSlot
      } else if (navPass) {
        // Navigation pass: the camera on screen (and the persisted
        // lastZoom/lastPan the CenterSlotTracker scores derive from) still
        // belongs to the OUTGOING page — the destination viewport is applied
        // AFTER ordering. Scoring against it places tiles relative to the
        // page the user just left. Take the lowest free slot instead:
        // deterministic, camera-independent, stable across re-renders (the
        // session cache above pins it for the rest of the tab session).
        placed = -1
        for (let i = 0; i <= maxSlot; i++) {
          const v = sparse[i]
          if (v === '' || v == null) { placed = i; break }
        }
        if (placed < 0) continue  // grid genuinely full
      } else {
        placed = this.#bestFreeSlotByScore(sparse, maxSlot)
        if (placed < 0) continue  // grid genuinely full
      }

      sparse[placed] = name
      placedUnindexed.push(`${name}→${placed}`)
      // TRANSIENT reindex only. The session cache keeps the placement
      // stable across re-renders (pan, peer churn, synchronize passes)
      // for the lifetime of the tab — but a render pass must NEVER
      // persist an index. Score-picked slots are a display decision,
      // not content: stamping them into the layer made accidental
      // placements permanent, generated a commit cascade per tile on
      // every cold render, and was the write vector behind the
      // cross-layer graft. Durable indexes come only from deliberate
      // actions — cell creation (placeNew), explicit
      // place-at (placeAt), and the move drone.
      this.#sessionSlots.set(name, placed)
    }

    // Stage diagnosis: which cells came in with a persisted index vs which
    // had to be score-filled this pass (lost/never-had index, or slot
    // collision). A tile in the score-fill list whose slot lands past the
    // axial map's size is the one that misses the first paint.
    const indexedPlaced = localNames.filter(n => !unindexed.includes(n)).map(n => `${n}@${idxByName.get(n)}`)
    console.info('[layout] indexed:', indexedPlaced.join(', ') || '(none)', '| score-filled:', placedUnindexed.join(', ') || '(none)')

    // A FRAME re-reads the whole placement through a pattern. Everything above
    // still runs, and is still what decides the tiles' RELATIVE ORDER — the
    // frame only decides where that order lands on screen. Nothing is
    // persisted here: a frame is a way of reading the layer, and the tiles'
    // own indexes survive underneath it untouched, so releasing the frame
    // returns the page exactly as it was arranged.
    const framed = this.#applyFrame(sparse, parentSegments, maxSlot)
    return framed ?? sparse
  }

  /**
   * Re-pack `sparse` onto the slots of the pattern framing this location, or
   * null when the location is not framed.
   *
   * The frame's slots never move and never resize — that is the whole promise
   * of it. What moves is the TILES: the ordered list slides through the slots
   * by the location's scroll offset, so tiles arrive at the leading edge and
   * leave at the trailing one, and a tile past the frame is simply not
   * painted this pass. There is no cap on how many tiles a framed layer may
   * hold; the ones off-frame are waiting, not refused.
   *
   * Synchronous by construction: FrameService keeps its resolver hot exactly
   * so a geometry build can ask it without awaiting, the same discipline the
   * sequence resolver follows.
   */
  /** Is the page being rendered read through a frame? Cheap synchronous
   *  lookup — the incremental paths ask it before assuming a new tile can be
   *  slotted without disturbing the others. */
  isFramed(): boolean {
    const frames = (window as any).ioc?.get?.('@FrameService') as
      | { isFramed?: (segs: readonly string[]) => boolean }
      | undefined
    if (!frames?.isFramed) return false
    const segments = this.host.lineage()?.explorerSegments?.() ?? []
    return frames.isFramed(segments)
  }

  #applyFrame(sparse: readonly string[], parentSegments: readonly string[], maxSlot: number): string[] | null {
    const frames = (window as any).ioc?.get?.('@FrameService') as
      | {
          activeFrameFor: (segs: readonly string[]) => { order: readonly AxialLike[]; stride: number } | null
          clampedOffsetFor: (segs: readonly string[], count?: number) => number
          noteTileCount: (segs: readonly string[], count: number) => void
        }
      | undefined
    const frame = frames?.activeFrameFor?.(parentSegments)
    if (!frame || frame.order.length === 0) return null

    // Slot order IS the tiles' relative order — the pass above already
    // resolved persisted indexes, peer indexes and score-fills into it.
    const ordered: string[] = []
    for (const name of sparse) if (name) ordered.push(name)
    if (ordered.length === 0) return null

    // The render is the only thing that knows the TOTAL, and the scroll
    // ceiling is computed from it. Note it before reading the offset back so
    // a page that lost tiles is not left scrolled past its last one.
    frames?.noteTileCount?.(parentSegments, ordered.length)
    const offset = frames?.clampedOffsetFor?.(parentSegments, ordered.length) ?? 0

    const axial = this.host.axial()
    const items = axial?.items as Map<number, { q: number; r: number }> | undefined
    if (!items || items.size === 0) return null
    const indexByCoord = new Map<string, number>()
    for (const [index, coord] of items) indexByCoord.set(`${coord.q},${coord.r}`, index)

    const out: string[] = new Array(maxSlot + 1).fill('')
    let placed = 0
    for (let position = 0; position < ordered.length; position++) {
      const coord = slotAt(frame.order, frame.stride, position, offset)
      if (!coord) continue                                   // off-frame — waiting
      const index = indexByCoord.get(`${coord.q},${coord.r}`)
      if (index === undefined || index > maxSlot) continue    // slot off the grid
      out[index] = ordered[position]
      placed++
    }
    // A frame that placed nothing is a broken frame, not an empty page — hand
    // back the unframed placement rather than blanking the layer.
    if (placed === 0) return null

    console.info('[layout] framed:', placed, 'of', ordered.length, 'tiles | offset', offset)
    return out
  }

  // #segmentsStillCurrent removed — render passes no longer persist ANY
  // per-tile writes (score-fill reindexing is transient, session-cache
  // only), so the stale-pass write guard has nothing left to guard.

  /**
   * Score every free slot in `sparse` and return the best one for a new
   * cell: minimal off-screen distance, then maximal whitespace, then closest
   * to center — the placement rule pinned layout uses for any cell without a
   * persisted index. Falls back to the lowest free slot when the viewport
   * tracker / axial adjacency isn't ready yet (early boot). Returns -1 when
   * the grid is full. Pure: no side effects, no persistence.
   *
   * Shared by pinned (batch full-render) and placeNew
   * (pinned incremental add) so both place new cells identically. A slot is
   * free when sparse[i] is '' or absent — the incremental caller passes the
   * slot machine's sparse array, which may be shorter than maxSlot+1, so
   * trailing indices are unoccupied.
   */
  #bestFreeSlotByScore(sparse: readonly string[], maxSlot: number): number {
    const free = (i: number): boolean => { const v = sparse[i]; return v === '' || v == null }

    const slotTracker = (window as any).ioc?.get?.('@diamondcoreprocessor.com/CenterSlotTracker') as
      | { scores: ReadonlyMap<number, { off: number; center: number }> }
      | undefined
    const axialAny = (window as any).ioc?.get?.('@diamondcoreprocessor.com/AxialService') as
      | { Adjacents: Map<number, { index: number }[]> }
      | undefined
    const scoreMap = slotTracker?.scores
    const adjacents = axialAny?.Adjacents

    let placed = -1
    if (scoreMap && adjacents) {
      let bestOff = Infinity
      let bestWhitespace = -1
      let bestCenter = Infinity
      for (let i = 0; i <= maxSlot; i++) {
        if (!free(i)) continue
        const s = scoreMap.get(i)
        if (!s) continue
        // Count neighbours that aren't occupied tiles — off-grid neighbours
        // at the rim of the grid count as whitespace because the visual area
        // beyond the grid edge is empty.
        let whitespace = 0
        const neighbours = adjacents.get(i) ?? []
        for (const adj of neighbours) {
          const ai = adj.index
          if (!Number.isFinite(ai) || ai < 0 || ai > maxSlot || free(ai)) whitespace++
        }
        if (
          s.off < bestOff ||
          (s.off === bestOff && whitespace > bestWhitespace) ||
          (s.off === bestOff && whitespace === bestWhitespace && s.center < bestCenter)
        ) {
          bestOff = s.off
          bestWhitespace = whitespace
          bestCenter = s.center
          placed = i
        }
      }
    }

    // Lowest-free fallback — tracker/adjacency missing (very early boot).
    if (placed < 0) {
      for (let i = 0; i <= maxSlot; i++) {
        if (free(i)) { placed = i; break }
      }
    }
    return placed
  }

  /**
   * Next free slot dictated by a bound `sequence:target` decoration (self or
   * an ancestor — cascading, position→leaf), or -1 when none is bound / the
   * sequence is exhausted. Synchronous: reads SequenceService's in-memory
   * resolver, which is kept hot off `decorations:changed` + cell-count
   * hydration. The free-slot guard keeps a stale index from colliding.
   */
  #sequenceSlot(
    eventSegments: readonly string[] | undefined,
    maxSlot: number,
    free: (i: number) => boolean,
  ): number {
    const seq = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SequenceService') as
      | { nextFreeIndex?: (segs: readonly string[], isFree: (i: number) => boolean) => number | undefined }
      | undefined
    if (!seq?.nextFreeIndex) return -1
    const lineage = this.host.lineage()
    const parentSegments: readonly string[] = eventSegments ?? lineage?.explorerSegments?.() ?? []
    const next = seq.nextFreeIndex(parentSegments, (i) => i >= 0 && i <= maxSlot && free(i))
    return (typeof next === 'number' && next >= 0 && next <= maxSlot && free(next)) ? next : -1
  }

  /**
   * Pinned-mode incremental placement for a brand-new cell. Picks a slot the
   * same way pinned would for an unindexed cell — reuse the
   * session-cached slot if still free, else the best free slot by viewport
   * score — injects it into the slot machine at that index, and persists the
   * index fire-and-forget so the next full render reads it back from Pass 1
   * (the tile never jumps). Returns the slot, or -1 when the grid is full /
   * axial isn't ready, signalling the caller to fall back to a full render.
   */
  placeNew(name: string, eventSegments?: readonly string[]): number {
    const axial = this.host.axial()
    if (!axial?.items) return -1
    const maxSlot = axial?.count ?? 60
    const sparse = this.host.slots().snapshot().names

    // Already placed — a re-emitted cell:added for a tile that's already on
    // screen (e.g. a tag/marker refresh re-fires the event to repaint). Keep
    // its slot; never relocate or re-persist, or the tile would jump on the
    // next full render.
    const existing = sparse.indexOf(name)
    if (existing >= 0) return existing

    const cachedSlot = this.#sessionSlots.get(name)
    const free = (i: number): boolean => { const v = sparse[i]; return v === '' || v == null }
    // Drop-target sequence (cascading, position→leaf): when this location or
    // an ancestor is bound to a sequence, a new tile fills the next free
    // sequence slot before any score-based placement. No-op when nothing is
    // bound or the sequence is exhausted.
    const seqSlot = this.#sequenceSlot(eventSegments, maxSlot, free)
    const slot = seqSlot >= 0
      ? seqSlot
      : (typeof cachedSlot === 'number' && cachedSlot >= 0 && cachedSlot <= maxSlot && free(cachedSlot))
        ? cachedSlot
        : this.#bestFreeSlotByScore(sparse, maxSlot)
    if (slot < 0) return -1

    if (!this.host.slots().addAt(name, slot, false)) return -1
    this.#sessionSlots.set(name, slot)

    // Persist against the EVENT's address (captured synchronously with
    // the cell:added that triggered this placement), never a live lineage
    // re-read — the microtask defer between event and here is a real
    // navigation window, and a wrong-location index write cascades the
    // cell into the wrong layer's children.
    const lineage = this.host.lineage()
    const parentSegments: readonly string[] = eventSegments ?? lineage?.explorerSegments?.() ?? []
    void writeTilePropertiesAt(parentSegments, name, { index: slot }).catch(err =>
      console.warn('[show-cell] failed to persist index for new cell', name, err),
    )
    return slot
  }

  /**
   * Central ordering strategy — all render paths route through here.
   * Pinned is the only mode: each cell sits at its persisted `index`
   * slot, gaps are preserved, and collision is resolved by moving the
   * loser to the next free slot (persisted on write). Returns a sparse
   * array where cellNames[i] → axial position i, with empty-string
   * entries marking unoccupied slots.
   */
  async order(
    _mode: string,
    dir: FileSystemDirectoryHandle,
    union: Set<string>,
    localCellSet: Set<string>,
    _lineage: any,
    peerIndices?: Map<string, number>,
    passSegments?: readonly string[],
    navPass = false,
    orderStats?: { coldIndexNames: string[] },
  ): Promise<string[]> {
    // When cursor is rewound, use cursor-aware ordering so deletions
    // that happened later don't leave stale slot indices in OPFS
    // overlapping the rewound cell set.
    const cursor = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryCursorService') as
      HistoryCursorService | undefined
    const isRewound = cursor?.state?.rewound ?? false

    let cellNames: string[]
    if (isRewound && cursor) {
      const content = await cursor.layerContentAtCursor()
      // Resolve child sigs → names by enumerating parent dir +
      // matching against each child's bag markers. Falls back to
      // live disk ordering when the past layer can't be resolved.
      const historyService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
      const parentSegments = passSegments ?? (_lineage as { explorerSegments?: () => readonly string[] })?.explorerSegments?.() ?? []
      const orderedNames = (content && historyService)
        ? [...await resolveChildNames(historyService, parentSegments, dir, content)]
        : []
      if (orderedNames.length > 0) {
        const unionSet = new Set(union)
        const filtered = orderedNames.filter(s => unionSet.has(s))
        for (const s of union) {
          if (!filtered.includes(s)) filtered.push(s)
        }
        // Slot index is the cell's stable visual position. Even when
        // rewound, place each cell at its persisted `index` so x/y/scale
        // don't shift across undo — only membership (which slots are
        // occupied) changes between history points. readOnly: rewound
        // viewing must not mutate disk indices.
        cellNames = await this.pinned(dir, filtered, localCellSet, true, peerIndices, passSegments, navPass, orderStats)
      } else {
        cellNames = await this.pinned(dir, Array.from(union), localCellSet, false, peerIndices, passSegments, navPass, orderStats)
      }
    } else {
      cellNames = await this.pinned(dir, Array.from(union), localCellSet, false, peerIndices, passSegments, navPass, orderStats)
    }

    if (this.host.keyword()) {
      const kw = this.host.keyword()
      // Name OR mark: a pheromone is as good a handle on a tile as its
      // name, so `>?` narrows on either. Marks come from the decoration
      // index (already built, location-independent), so this holds on the
      // very first pass — before any per-cell property read has run.
      const matches = (s: string): boolean =>
        s.toLowerCase().includes(kw)
        || this.host.tagsFor(s).some(t => t.toLowerCase().includes(kw))
      cellNames = cellNames.map(s => s && matches(s) ? s : '')
    }
    return cellNames
  }

  // #orderByIndex (dense-packed) removed — pinned is the only layout
  // mode. pinned handles index assignment, collision
  // detection, and next-available-slot fallback in one pass.

  async placeAt(cell: string, targetIndex: number): Promise<void> {
    // Index is the source of truth. Place this one cell at the target
    // index — do not renumber anyone else. Render-time collision heal
    // (in pinned) demotes any prior occupant to the next
    // free slot.
    const lineage = this.host.lineage()
    if (!lineage) return

    const parentSegments: readonly string[] = lineage?.explorerSegments?.() ?? []
    try {
      await writeTilePropertiesAt(parentSegments, cell, { index: targetIndex })
    } catch (err) {
      console.warn('[show-cell] place-at failed for', cell, err)
    }

    this.host.invalidate()
  }

  reorder(): void {
    // Cell index is the source of truth — written per-cell by the move
    // drone (and similar). This handler only invalidates the renderer's
    // caches so the next pass re-reads the persisted indices. It MUST
    // NOT renumber indices densely — that was the snap-back bug.
    this.host.invalidate()
  }
}
