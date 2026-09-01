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
//             can read for free and lets the optimize phase mint the record.
//   hive    — ONE pool read at the root. A miss NEVER sweeps the hive; it
//             answers from what is indexed and reports `partial`.
//
// Nothing here writes truth. The records are a derived cache: delete the
// pool and every answer is identical, only slower to reach.

import {
  MAX_RECORD_DEPTH, MAX_RECORD_ROWS, SEARCH_INDEX_MEANING, groupHits, rowsOfManifest, searchRecord,
  spliceChildRows, type ManifestEntry, type SearchHit, type SearchReach,
  type SearchRecord, type SearchRow,
} from './hive-search.js'

const get = <T>(key: string): T | undefined => window.ioc?.get<T>(key)

type LayerLike = { name?: string; children?: unknown; [k: string]: unknown }

type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<LayerLike | null>
  getLayerBySig(sig: string): Promise<LayerLike | null>
  childrenManifestFor?(layer: LayerLike): Promise<ManifestEntry[] | null>
  headLayer(locationSig: string): Promise<{ layerSig: string } | null>
}

type StoreLike = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  readChildrenManifest?(parentLayerSig: string): Promise<ManifestEntry[] | null>
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
    if (memo) return memo
    if (this.#pool === undefined) this.#pool = (await this.store?.getPool(SEARCH_INDEX_MEANING)) ?? null
    if (!this.#pool) return null
    try {
      const handle = await this.#pool.getFileHandle(layerSig, { create: false })
      const parsed = JSON.parse(await (await handle.getFile()).text()) as SearchRecord
      if (parsed?.v !== 1 || !Array.isArray(parsed.rows)) return null
      if (this.#memo.size > 64) this.#memo.clear()
      this.#memo.set(layerSig, parsed)
      return parsed
    } catch { return null }
  }

  /** The manifest of a layer — the render's own cache, read as rows. */
  async #manifestOf(layerSig: string): Promise<ManifestEntry[] | null> {
    const direct = await this.store?.readChildrenManifest?.(layerSig).catch(() => null)
    if (direct?.length) return direct
    const layer = await this.history?.getLayerBySig(layerSig).catch(() => null)
    if (!layer) return null
    return (await this.history?.childrenManifestFor?.(layer).catch(() => null)) ?? null
  }

  async #layerRows(layerSig: string): Promise<SearchRow[]> {
    const manifest = await this.#manifestOf(layerSig)
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
    const rows = await this.#layerRows(start)
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
   * Derive the record for a layer sig — the optimize phase's worker.
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
    // DEPTH STOPS THE SHAPE, the node budget stops the size. A cycle in the
    // graph (a subtree that re-homes into itself) is bounded by this and
    // nothing else — the node budget would let it eat the whole pass first.
    if (depth >= MAX_RECORD_DEPTH) return { v: 1, rows: [], truncated: true }
    const manifest = await this.#manifestOf(layerSig)
    if (!manifest) return null

    const rows: SearchRow[] = []
    let truncated = false

    for (const entry of manifest) {
      if (budget.cancelled?.() || budget.nodes <= 0 || rows.length >= MAX_RECORD_ROWS) {
        truncated = true
        break
      }
      const [own] = rowsOfManifest([entry], [])
      rows.push(own)
      budget.nodes--

      const cached = await this.readRecord(entry.sig)
      const child = cached ?? await this.derive(entry.sig, budget, depth + 1)
      if (child) {
        rows.push(...spliceChildRows(child, [own.name]))
        if (child.truncated) truncated = true
        if (!cached) await this.writeRecord(entry.sig, child)
      }
    }

    if (rows.length > MAX_RECORD_ROWS) {
      rows.length = MAX_RECORD_ROWS
      truncated = true
    }
    return { v: 1, rows, ...(truncated ? { truncated: true } : {}) }
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
    if (this.#pool === undefined) this.#pool = (await this.store?.getPool(SEARCH_INDEX_MEANING)) ?? null
    if (!this.#pool) return
    try {
      const handle = await this.#pool.getFileHandle(layerSig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(JSON.stringify(record)) } finally { await writable.close() }
      this.#memo.set(layerSig, record)
    } catch { /* derived cache — a miss next time is the only cost */ }
  }
}

window.ioc.register('@diamondcoreprocessor.com/HiveSearchService', new HiveSearchService())
