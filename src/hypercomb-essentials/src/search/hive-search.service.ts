// search/hive-search.service.ts
//
// The reader half of search. Three registers, three reaches, one mechanism:
//
//   term     layer   — the children manifest of the layer you stand on
//   [term]   branch  — the record at that layer's own sig
//   @term    hive    — the record at the root's sig
//
// PERFORMANCE IS THE FEATURE, so every reach is a bounded number of reads
// and none of them is a walk on the keystroke path:
//
//   layer   — ONE pool read. The manifest is already the render's own cache
//             for the layer being painted, so this is effectively free.
//   branch  — ONE pool read on a hit. On a miss it answers from the ring it
//             can read for free plus each ring entry's own record (one read
//             each, never a walk) and lets the optimize phase mint the record.
//   hive    — ONE pool read at the root. A miss NEVER sweeps the hive; it
//             answers from what is indexed — the root's ring and each
//             branch's record — and reports `partial`.
//
// Nothing here writes truth. The records are a derived cache: delete the
// pool and every answer is identical, only slower to reach.

import { childSigsOfLayer } from '@hypercomb/core'
import { noteDerivedMint, noteDerivedUse } from '../history/optimization-use.js'
import {
  MAX_RECORD_DEPTH, MAX_RECORD_ROWS, SEARCH_INDEX_MEANING, groupHits, rowsOfManifest, searchRecord,
  spliceChildRows, type ManifestEntry, type SearchHit, type SearchReach,
  type SearchRecord, type SearchRow,
} from './hive-search.js'

const get = <T>(key: string): T | undefined => window.ioc?.get<T>(key)

type LayerLike = { name?: string; children?: unknown; [k: string]: unknown }

// No `getLayerBySig` here, on purpose: it fires a host fetch on a local miss,
// and this service is an optimize-phase reader of what is HERE (2026-10-11/12).
type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<LayerLike | null>
  /** The parsed-layer cache — memory only, never a read, never a fetch. */
  peekLayerBySig?(sig: string): LayerLike | null
  childrenManifestFor?(layer: LayerLike): Promise<ManifestEntry[] | null>
  headLayer(locationSig: string): Promise<{ layerSig: string } | null>
}

/** The manifest optimizer's one door: "this parent needs a manifest". */
type ManifestDoor = { enqueue?(parentSig: string, childSigs: readonly string[]): void }

/** What a derive found at one sig: a record (`held` when a held hole lies
 *  beneath it), or, for a sig with no manifest — `leaf` (its layer, here or
 *  inlined in its parent's manifest, declares no children), `unminted` (its
 *  layer declares children; the manifest was just asked for, so the next
 *  pass looks again), `hole` (what lies beneath cannot be read here; held,
 *  see #holes). */
type Derived = { record: SearchRecord; held: boolean } | 'leaf' | 'unminted' | 'hole'

type StoreLike = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  readChildrenManifest?(parentLayerSig: string): Promise<ManifestEntry[] | null>
  /** Local layer bytes with META ENVELOPES FOLLOWED — never a host fetch.
   *  Preferred over the raw reader below when the store has it. */
  getLayerBytes?(signature: string): Promise<Uint8Array | null>
  /** The LOCAL read of a layer's bytes — OPFS only, never a host. */
  getLayerLocalBytes?(signature: string): Promise<Uint8Array | null>
  /** Local resource bytes with envelopes followed; never a host fetch. */
  getResourceResolvedLocal?(signature: string): Promise<Blob | null>
  /** The LOCAL read of a resource's bytes — OPFS only, never a host. */
  getResourceLocal?(signature: string): Promise<Blob | null>
}

export type SearchAnswer = {
  /** The hits to show — the whole answer unless `limit` trimmed it. */
  readonly hits: readonly SearchHit[]
  /** How many were FOUND. Greater than `hits.length` means the list on
   *  screen is a window onto a bigger answer, and the surface says so
   *  rather than quietly showing forty of three hundred. */
  readonly total: number
  /** The same hits gathered by the branch they live in — a long answer read
   *  as a handful of places rather than one wall. */
  readonly groups: ReadonlyArray<{ branch: string; hits: readonly SearchHit[] }>
  readonly reach: SearchReach
  /** True when the answer came from an incomplete picture — a truncated
   *  record, or a reach served before its record exists. The rows are real;
   *  there may simply be more of them than were reachable this cheaply. */
  readonly partial: boolean
}

export class HiveSearchService {

  /** Records read this session, by layer sig. A record for a sig can never
   *  go stale — the sig names the exact content it was derived from — so
   *  this needs no invalidation, only a size cap. */
  #memo = new Map<string, SearchRecord>()

  #pool: FileSystemDirectoryHandle | null | undefined

  /**
   * HOLES, HELD (2026-10-11/12): sig → when a walk may look at it again. A
   * sig lands here when its subtree has a hole this device cannot fill — a
   * layer or child-slot pointer that is not here, or a manifest asked for on
   * an earlier look that still has not come. Its record is never written
   * (complete or absent), so without this every idle pass walked the same
   * spine down to the same hole, and in `warmBranches` the shared budget went
   * to it first, pass after pass, so the branches after it never got a
   * record (the 2026-10-05 starvation, back). While held, a hole costs its
   * row and no reads. Memory only: a reload looks again.
   */
  #holes = new Map<string, number>()
  static readonly #HOLD_MS = 30_000

  /** Parents this session has asked the manifest optimizer for, and when.
   *  Asked RARELY: the door restarts a waiting parent's count on every ask,
   *  so asking on each look would keep a parent whose children are cold from
   *  ever parking (it parks after 5 passes). But not once per session
   *  (2026-10-12): the optimizer may FORGET an ask — past its 256 waiters it
   *  drops the longest one, leaving the re-ask to "the next paint", which a
   *  branch nobody opens never gets; its write can also fail quietly — and a
   *  forgotten parent would stay a hole all session, every ancestor's record
   *  with it. So an ask is repeated once #REASK_MS has passed. */
  #asked = new Map<string, number>()
  static readonly #REASK_MS = 300_000

  /**
   * THE DERIVATION, STAMPED (2026-10-12). A record is keyed by the sig it was
   * derived from, which makes it self-invalidating only while the deriving
   * function stays the same: the real key is (sig, derivation). Before
   * 2026-10-11/12 a missing manifest was read as a leaf, and records sealed
   * "complete" without whole subtrees (/dolphin without associates/betz) are
   * still in the pool. Every write carries this stamp and `readRecord`
   * refuses a record without it, so those are misses and are derived again.
   * Bump it whenever `derive` changes its answer.
   */
  static readonly #DERIVATION = 2

  get history(): HistoryLike | undefined {
    return get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  }

  get store(): StoreLike | undefined {
    return get<StoreLike>('@hypercomb.social/Store')
  }

  #segments(): readonly string[] {
    const lineage = get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    try { return lineage?.explorerSegments?.() ?? [] } catch { return [] }
  }

  /** The layer sig a reach starts from. Where the participant stands is the
   *  cursor's own answer — already resolved, no read at all — and anywhere
   *  else is the head layer at that location. */
  async #sigAt(segments: readonly string[]): Promise<string | null> {
    const history = this.history
    if (!history) return null
    const here = this.#segments()
    if (segments.length === here.length && segments.every((s, i) => s === here[i])) {
      const cursor = get<{ currentLayerSig?: string }>('@diamondcoreprocessor.com/HistoryCursorService')
      if (cursor?.currentLayerSig) return cursor.currentLayerSig
    }
    try {
      const locationSig = await history.sign({ explorerSegments: () => [...segments] })
      return (await history.headLayer(locationSig))?.layerSig ?? null
    } catch { return null }
  }

  /** Read a record. Memo, then the pool. NEVER derives — a reader that
   *  derived would put a whole-subtree walk on the keystroke path, which is
   *  exactly the cost this design refuses to pay. */
  readRecord = async (layerSig: string): Promise<SearchRecord | null> => {
    const memo = this.#memo.get(layerSig)
    if (memo) {
      noteDerivedUse(this.store, SEARCH_INDEX_MEANING, layerSig)
      return memo
    }
    if (this.#pool === undefined) this.#pool = (await this.store?.getPool(SEARCH_INDEX_MEANING)) ?? null
    if (!this.#pool) return null
    try {
      const handle = await this.#pool.getFileHandle(layerSig, { create: false })
      const parsed = JSON.parse(await (await handle.getFile()).text()) as SearchRecord & { derivation?: unknown }
      if (parsed?.v !== 1 || !Array.isArray(parsed.rows)) return null
      // A record from another derivation is a miss, never an answer (#DERIVATION).
      if (parsed.derivation !== HiveSearchService.#DERIVATION) return null
      if (this.#memo.size > 64) this.#memo.clear()
      this.#memo.set(layerSig, parsed)
      noteDerivedUse(this.store, SEARCH_INDEX_MEANING, layerSig)
      return parsed
    } catch { return null }
  }

  /** The manifest of a layer — the render's own cache — read from THIS DEVICE
   *  alone (2026-10-11/12). Its fallback used to be `history.getLayerBySig`,
   *  which fires a host fetch on a local miss; a parent left incomplete is
   *  derived again on a later pass, so a layer that never arrived was asked
   *  of a host over and over by a derived-cache pass. The layer read here is
   *  handed back too, so a sig with no manifest is judged on the same object
   *  instead of a second read.
   *
   *  `inlined` is the copy of this layer its PARENT's manifest carries
   *  (2026-10-12) — the child's full layer, which history trusts when the
   *  bytes are cold (`childrenManifestFor`, `seedParsedLayer`). Without it a
   *  childless child whose bytes are not here was a hole, and the hold spread
   *  to every ancestor; with it that child is the leaf it is. */
  async #manifestOf(
    layerSig: string,
    inlined?: LayerLike,
  ): Promise<{ manifest: ManifestEntry[] | null; layer: LayerLike | null }> {
    const direct = await this.store?.readChildrenManifest?.(layerSig).catch(() => null)
    if (direct?.length) return { manifest: direct, layer: null }
    const layer = (await this.#layerLocal(layerSig)) ?? inlined ?? null
    if (!layer) return { manifest: null, layer: null }
    // A meta envelope's manifest is keyed by the layer it names, which only
    // the layer object can sign.
    const manifest = (await this.history?.childrenManifestFor?.(layer).catch(() => null)) ?? null
    return { manifest, layer }
  }

  /** A layer from this device alone: the parsed cache, then the bytes, meta
   *  envelopes followed when the store can (the raw reader can hand back an
   *  envelope, which is not a layer and proves nothing). Null on a miss. */
  async #layerLocal(layerSig: string): Promise<LayerLike | null> {
    const warm = this.history?.peekLayerBySig?.(layerSig)
    if (warm) return warm
    const store = this.store
    const bytes = await (store?.getLayerBytes
      ? store.getLayerBytes(layerSig)
      : store?.getLayerLocalBytes?.(layerSig))?.catch(() => null)
    if (!bytes?.byteLength) return null
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      return parsed && typeof parsed === 'object' && typeof (parsed as LayerLike).name === 'string'
        ? parsed as LayerLike
        : null
    } catch { return null }
  }

  /** A layer's declared child sigs across the canonical child slots (core
   *  `childSigsOfLayer`, the canvas's own definition). A slot that is a
   *  pointer resolves from this device only; a pointer not here gives null —
   *  unknown, never "no children". */
  async #declaredChildren(layer: LayerLike): Promise<string[] | null> {
    const store = this.store
    let blind = false
    const sigs = await childSigsOfLayer(layer, {
      getResource: async (sig: string) => {
        const blob = await (store?.getResourceResolvedLocal
          ? store.getResourceResolvedLocal(sig)
          : store?.getResourceLocal?.(sig))?.catch(() => null)
        if (!blob) blind = true
        return blob ?? null
      },
    }).catch(() => { blind = true; return [] as string[] })
    return blind ? null : sigs
  }

  /**
   * A SIG WITH NO MANIFEST IS NOT A LEAF (2026-10-11/12). The manifest is a
   * derived cache, minted when a layer is committed or painted here, so a
   * branch that arrived any other way (replicated, adopted, never opened)
   * may have none. `derive` used to read that absence as "no children",
   * sealed the parent's record as complete, and the hole was permanent — the
   * key is the parent's sig — so "find betz /" answered a confident "not
   * found" for /dolphin/associates/betz.
   *
   * A leaf only when its layer — here, or inlined in its parent's manifest —
   * declares no children. A layer that declares children has its manifest
   * ASKED FOR through the manifest optimizer's one door — nothing else mints
   * a manifest for a branch nobody commits or paints — and the next pass
   * looks again. Not readable here, or asked recently and still missing: a
   * hole, held (#holes).
   */
  async #unindexed(layerSig: string, layer: LayerLike | null): Promise<'leaf' | 'unminted' | 'hole'> {
    const declared = layer ? await this.#declaredChildren(layer) : null
    if (declared?.length === 0) return 'leaf'
    if (declared && this.#askForManifest(layerSig, declared)) return 'unminted'
    this.#hold(layerSig)
    return 'hole'
  }

  /** Ask the manifest optimizer for a parent's manifest, at most once per
   *  #REASK_MS (#asked). True when this call asked. It only queues: the
   *  optimizer mints in its own pass, so this service still writes nothing
   *  but its records. */
  #askForManifest(layerSig: string, childSigs: readonly string[]): boolean {
    const askedAt = this.#asked.get(layerSig)
    if (askedAt !== undefined && Date.now() - askedAt < HiveSearchService.#REASK_MS) return false
    const door = get<ManifestDoor>('@diamondcoreprocessor.com/ManifestOptimizerDrone')
    if (!door?.enqueue) return false
    if (this.#asked.size > 4096) this.#asked.clear()
    this.#asked.set(layerSig, Date.now())
    door.enqueue(layerSig, childSigs)
    return true
  }

  #hold(layerSig: string): void {
    if (this.#holes.size > 4096) this.#holes.clear()
    this.#holes.set(layerSig, Date.now() + HiveSearchService.#HOLD_MS)
  }

  #isHeld(layerSig: string): boolean {
    const until = this.#holes.get(layerSig)
    if (until === undefined) return false
    if (until > Date.now()) return true
    this.#holes.delete(layerSig)
    return false
  }

  async #layerRows(layerSig: string): Promise<SearchRow[]> {
    const { manifest } = await this.#manifestOf(layerSig)
    return manifest?.length ? rowsOfManifest(manifest, []) : []
  }

  /**
   * Answer a query at a reach. The one entry point — the command line calls
   * this and nothing else.
   */
  search = async (query: string, reach: SearchReach, limit = 60): Promise<SearchAnswer> => {
    const q = query.trim().toLowerCase()
    if (!q) return this.#answer([], reach, false, limit)

    const segments = this.#segments()
    const start = await this.#sigAt(reach === 'hive' ? [] : segments)
    if (!start) return this.#answer([], reach, reach !== 'layer', limit)

    if (reach === 'layer') {
      const rows = await this.#layerRows(start)
      return this.#answer(searchRecord({ v: 1, rows }, q), reach, false, limit)
    }

    const record = await this.readRecord(start)
    if (record) {
      return this.#answer(searchRecord(record, q), reach, record.truncated === true, limit)
    }

    // No record yet. Answer with the ring that reads for free rather than
    // walking: the optimize phase owes this sig a record, and the next
    // search at the same place is the fast one. Partial, and it says so.
    //
    // Plus each ring entry's OWN record, spliced under its name — one read
    // per child, never a walk (2026-10-12). A hole anywhere keeps every
    // ancestor's record unwritten, the root's included, while the branches
    // beside it keep theirs (warmBranches); the ring alone dropped every name
    // below it. The same per-branch read hive-tree-reader #indexedNames makes.
    const ring = await this.#layerRows(start)
    const branches = await Promise.all(ring.map(row => this.readRecord(row.sig)))
    const rows = ring.flatMap((row, at) => {
      const branch = branches[at]
      return branch ? [row, ...spliceChildRows(branch, [row.name])] : [row]
    })
    return this.#answer(searchRecord({ v: 1, rows }, q), reach, true, limit)
  }

  /** Shape an answer: everything found is counted and grouped, and only the
   *  list on screen is trimmed. */
  #answer(found: SearchHit[], reach: SearchReach, partial: boolean, limit: number): SearchAnswer {
    return {
      hits: found.slice(0, limit),
      total: found.length,
      groups: groupHits(found).map(g => ({ branch: g.branch, hits: g.hits })),
      reach,
      partial,
    }
  }

  /**
   * THE BRANCHES OF A LAYER, EACH ITS OWN RECORD. A hive past the row cap
   * gets no record at its root (a truncated record is never kept), and the
   * root's derive stops adding branches when its rows reach the cap — so the
   * branches after that point were never derived at all, pass after pass,
   * and a hive-wide find never saw /dolphin (2026-10-05). This derives each
   * branch that has no record, within the budget; a branch too big for one
   * pass still keeps every complete record beneath it, so the next pass
   * starts further on. A branch held on a hole is passed over, so the budget
   * reaches the branches after it (2026-10-11/12). Derived cache only —
   * nothing here is truth.
   */
  warmBranches = async (layerSig: string, budget: { nodes: number; cancelled?: () => boolean }): Promise<void> => {
    const { manifest } = await this.#manifestOf(layerSig)
    if (!manifest) return
    for (const entry of manifest) {
      if (budget.cancelled?.() || budget.nodes <= 0) return
      if (this.#isHeld(entry.sig)) continue
      if (await this.readRecord(entry.sig)) continue
      const record = await this.derive(entry.sig, budget)
      if (record) await this.writeRecord(entry.sig, record)
    }
  }

  /**
   * Derive the record for a layer sig — the optimize phase's worker. Null
   * when the sig has no manifest (a leaf, or a branch not readable here).
   *
   * COMPOSITION, NOT TRAVERSAL: a child that already has a record
   * contributes its rows whole (`spliceChildRows`) and is never descended
   * into. Only the changed spine of a hive is ever read, which is what makes
   * this cheap enough to run on every idle pass. That is the merkle tree
   * paying out — an unchanged child has an unchanged sig, and its record is
   * therefore still exactly true.
   */
  derive = async (
    layerSig: string,
    budget: { nodes: number; cancelled?: () => boolean },
    depth = 0,
  ): Promise<SearchRecord | null> => {
    const found = await this.#derive(layerSig, budget, depth)
    return typeof found === 'string' ? null : found.record
  }

  async #derive(
    layerSig: string,
    budget: { nodes: number; cancelled?: () => boolean },
    depth: number,
    inlined?: LayerLike,
  ): Promise<Derived> {
    // DEPTH STOPS THE SHAPE, the node budget stops the size. A cycle in the
    // graph (a subtree that re-homes into itself) is bounded by this and
    // nothing else — the node budget would let it eat the whole pass first.
    if (depth >= MAX_RECORD_DEPTH) return { record: { v: 1, rows: [], truncated: true }, held: false }
    const { manifest, layer } = await this.#manifestOf(layerSig, inlined)
    if (!manifest) return this.#unindexed(layerSig, layer)

    const rows: SearchRow[] = []
    let truncated = false
    let held = false

    for (const entry of manifest) {
      if (budget.cancelled?.() || budget.nodes <= 0 || rows.length >= MAX_RECORD_ROWS) {
        truncated = true
        break
      }
      const [own] = rowsOfManifest([entry], [])
      rows.push(own)
      budget.nodes--

      // A held hole keeps its row and costs no reads (#holes). A held sig was
      // never written — a write releases the hold — so no record is skipped.
      if (this.#isHeld(entry.sig)) {
        truncated = held = true
        continue
      }
      const cached = await this.readRecord(entry.sig)
      // The entry inlines the child's layer: a cold child is judged on it (#manifestOf).
      const child: Derived = cached
        ? { record: cached, held: false }
        : await this.#derive(entry.sig, budget, depth + 1, entry.layer)
      if (child === 'leaf') continue
      if (typeof child === 'string') {
        // NO MANIFEST IS NOT A LEAF (2026-10-11/12). The child keeps its own
        // row, but what lies beneath it is not known here, so the parent is
        // incomplete: `writeRecord` refuses it and a search says `partial`.
        // An `unminted` child's manifest was just asked for and the next pass
        // finds it; a `hole` is held and looked at again when the hold ends.
        truncated = true
        if (child === 'hole') held = true
        continue
      }
      rows.push(...spliceChildRows(child.record, [own.name]))
      if (child.record.truncated) truncated = true
      if (child.held) held = true
      if (!cached) await this.writeRecord(entry.sig, child.record)
    }

    if (rows.length > MAX_RECORD_ROWS) {
      rows.length = MAX_RECORD_ROWS
      truncated = true
    }
    // A held hole beneath holds this sig too, so its own parent passes over
    // it rather than walking down to the same hole on the next pass.
    if (held) this.#hold(layerSig)
    return { record: { v: 1, rows, ...(truncated ? { truncated: true } : {}) }, held }
  }

  /**
   * EVERY NAME IN THE HIVE — the vocabulary, not just an answer.
   *
   * Voice makes this load-bearing in a way typing never did. A typed line
   * can be corrected letter by letter until it finds the place; a spoken one
   * either matches a name the system knows or it reaches nothing, and the
   * participant has no way to tell which. So the reachable set has to be
   * KNOWN, in full, at all times — not discovered by walking toward it.
   * That is why the root record is minted every idle pass rather than on
   * demand: it is the vocabulary, and a partial vocabulary is a hive with
   * places you cannot say.
   *
   * Cheap for the same reason everything else here is: the record is already
   * derived, so this is a read and a fold.
   */
  vocabulary = async (): Promise<ReadonlyMap<string, SearchRow>> => {
    const vocabulary = new Map<string, SearchRow>()
    const rootSig = await this.#sigAt([])
    if (!rootSig) return vocabulary
    const record = await this.readRecord(rootSig)
    if (!record) return vocabulary
    // Nearest wins a collision: two tiles may share a name, and the shallower
    // one is the one a spoken word means.
    for (const row of record.rows) {
      if (!row.name) continue
      const key = row.name.toLowerCase()
      const held = vocabulary.get(key)
      if (!held || row.path.length < held.path.length) vocabulary.set(key, row)
    }
    return vocabulary
  }

  /** Write a derived record into sign('search:index'), keyed by the sig it
   *  was derived from. Best-effort — a failed write costs a slower search
   *  and nothing else. */
  writeRecord = async (layerSig: string, record: SearchRecord): Promise<void> => {
    // COMPLETE OR ABSENT (optimize-phase.md rule 3). A truncated record is
    // not a function of the layer sig — it is a function of where the walk
    // happened to stop, which is the budget, the depth cap and the order of
    // the pass. Keyed by the sig, it would be read back as THE record for
    // that content forever, and `readRecord` would then never re-derive it
    // (write-conformance, hive-search.service.ts:213). Not to disk, not to
    // the memo: the next pass derives again, and a search meanwhile answers
    // from the free ring and says it is partial.
    if (record.truncated === true) return
    // Complete, so no longer a hole: the walk may read it again at once.
    this.#holes.delete(layerSig)
    if (this.#pool === undefined) this.#pool = (await this.store?.getPool(SEARCH_INDEX_MEANING)) ?? null
    if (!this.#pool) return
    // Stamped with the derivation that made it, the half of the key the sig is not (#DERIVATION).
    const stamped = { ...record, derivation: HiveSearchService.#DERIVATION }
    try {
      const handle = await this.#pool.getFileHandle(layerSig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(JSON.stringify(stamped)) } finally { await writable.close() }
      this.#memo.set(layerSig, stamped)
      noteDerivedMint(this.store, SEARCH_INDEX_MEANING, layerSig)
    } catch { /* derived cache — a miss next time is the only cost */ }
  }
}

// search-index.drone.ts registers this service (atomic-modules-plan.md).
