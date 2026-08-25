// diamondcoreprocessor.com/search/hive-search.ts
//
// THE SEARCH RECORD AND ITS DERIVATION.
//
// Reach is spelled by the register the participant types — `term` here,
// `[term]` the branch, `@term` the hive — but all three are ONE mechanism
// with three starting signatures: the layer you stand on, the layer you
// stand on, and the root. What changes is which sig is read, never how.
//
// TRAVERSAL FOLLOWS MANIFESTS, NOT VISUALS. The children manifest in
// sign('manifests') is keyed by the parent layer's own sig and already
// inlines every child's name and properties, so one pool read yields a
// whole ring of searchable rows — cold children included. A "genome scan"
// that followed the visuals around the layer instead would make the answer
// depend on what happens to be painted, and marks classify, they never
// resolve. Visuals belong in the record as FIELDS (and in ranking); they
// are never the path.
//
// THE RECORD: a flattened subtree, keyed by the layer sig it derives from,
// living in sign('search:index'). Derived cache, never truth:
//
//   derive(layer) = own rows ⧺ derive(child) for each child
//
// so a parent's record is built from its children's records. That IS the
// incremental sync — a changed tile is a new sig with no record, its
// ancestors are new sigs with no record, and every untouched branch is
// still a hit at its unchanged sig. There is no update path and nothing to
// invalidate. Old records stay valid forever for the sigs they name.
//
// Complete-or-absent, like every other derived cache: a record that hit the
// row budget is marked `truncated` so a reader knows the answer it holds is
// partial and can say so rather than quietly under-reporting.

/** How far a row sits below the layer its record was derived for. Depth IS
 *  the path length — one truth, no second field to keep in step through a
 *  splice. */
export const depthOf = (row: SearchRow): number => row.path.length

/** The searchable projection of one tile. */
export type SearchRow = {
  /** The tile's layer sig — what a hit walks to. */
  readonly sig: string
  readonly name: string
  /** Names from the record's root down to this tile, for the result line. */
  readonly path: readonly string[]
  /** Everything matchable, already folded to lowercase. */
  readonly words: string
}

export type SearchRecord = {
  readonly v: 1
  readonly rows: readonly SearchRow[]
  /** True when the row budget cut the derivation short. */
  readonly truncated?: boolean
}

export type SearchHit = SearchRow & { readonly score: number }

/** How far a search reaches. One value per register. */
export type SearchReach = 'layer' | 'branch' | 'hive'

export const SEARCH_INDEX_MEANING = 'search:index'

/** A record holds at most this many rows. A hive far past it is still
 *  searchable — the record says `truncated` and the rows it does hold are
 *  the ones nearest the root, which is where a global search looks first. */
export const MAX_RECORD_ROWS = 4000

/** How deep a DERIVATION recurses — a guard on the shape of the walk, never
 *  a filter on the answer. Depth costs a read per level along the changed
 *  spine, and a cycle (a subtree re-homed into itself) would cost them
 *  forever; the node budget alone wouldn't catch it, because a cycle is
 *  cheap per step. Set far past any hand-built hive: hitting it means
 *  something is wrong, not that someone nested deeply. */
export const MAX_RECORD_DEPTH = 24

const SIG_RE = /^[0-9a-f]{64}$/

/** The matchable text of one tile: its name plus any short human string in
 *  its properties. Signatures are skipped — they are addresses, not words,
 *  and indexing them would make every tile match every other tile's sig. */
export const wordsOf = (
  name: string,
  props?: Record<string, unknown>,
): string => {
  const parts = [name]
  const collect = (value: unknown, depth: number): void => {
    if (depth > 3) return
    if (typeof value === 'string') {
      if (value.length > 200 || SIG_RE.test(value)) return
      parts.push(value)
      return
    }
    if (Array.isArray(value)) { for (const v of value) collect(v, depth + 1); return }
    if (value && typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) collect(v, depth + 1)
    }
  }
  collect(props, 0)
  return parts.join(' ').toLowerCase()
}

/**
 * Rank a row against a query. Higher is better; 0 means no match.
 *
 * Deliberately small: an exact name, then a name prefix, then a name
 * substring, then anything else the tile says. Ordering people can predict
 * beats scoring they cannot — and a shallower hit wins ties, because the
 * tile nearer where you are standing is the one you meant.
 */
export const scoreRow = (row: SearchRow, query: string): number => {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const name = row.name.toLowerCase()
  let base = 0
  if (name === q) base = 1000
  else if (name.startsWith(q)) base = 700
  else if (name.includes(q)) base = 500
  else if (row.words.includes(q)) base = 200
  if (!base) return 0
  // Depth costs, but never enough to cross a match class: a deep exact name
  // still beats a shallow substring. Ten a level, capped, against gaps of
  // two hundred between the classes above.
  return base - 10 * Math.min(row.path.length, 9)
}

/**
 * Every hit in a record, best first. Pure — the reader does the reads.
 *
 * NOTHING IS FILTERED OUT. A search is asked in order to see what is there,
 * so depth ranks a row down (a nearer tile is likelier the one meant) but
 * never removes it. The caller decides how many to SHOW; the count of what
 * was found is reported either way, so a trimmed list always says so.
 */
export const searchRecord = (record: SearchRecord, query: string): SearchHit[] => {
  const hits: SearchHit[] = []
  for (const row of record.rows) {
    const score = scoreRow(row, query)
    if (score > 0) hits.push({ ...row, score })
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return hits
}

/** Hits gathered by the branch they live in — the top segment of their path,
 *  or '' for the ring you are standing on. Grouping is how a long answer
 *  stays readable without dropping any of it: 300 hits across six branches
 *  read as six places to look. */
export const groupHits = (
  hits: readonly SearchHit[],
): Array<{ branch: string; hits: SearchHit[] }> => {
  const groups = new Map<string, SearchHit[]>()
  for (const hit of hits) {
    const branch = hit.path.length > 1 ? hit.path[0] : ''
    const bucket = groups.get(branch)
    if (bucket) bucket.push(hit)
    else groups.set(branch, [hit])
  }
  return [...groups.entries()]
    .map(([branch, group]) => ({ branch, hits: group }))
    .sort((a, b) => (b.hits[0]?.score ?? 0) - (a.hits[0]?.score ?? 0))
}

export type ManifestEntry = {
  sig: string
  layer: { name?: string; [k: string]: unknown }
  props?: Record<string, unknown>
}

/** One ring of rows from a parent's children manifest. */
export const rowsOfManifest = (
  manifest: readonly ManifestEntry[],
  parentPath: readonly string[],
): SearchRow[] => manifest.map(entry => {
  const name = typeof entry.layer?.name === 'string' ? entry.layer.name : ''
  return { sig: entry.sig, name, path: [...parentPath, name], words: wordsOf(name, entry.props) }
})

/** Re-root a child record's rows under the parent's path. THE COMPOSITION
 *  STEP, and the whole reason this is cheap: a record's paths are relative
 *  to the layer it was derived for, so a cached child record is spliced in
 *  whole — no descent, no re-derivation, no reads below it. This is the
 *  merkle tree paying out: the child's sig didn't change, so its record is
 *  still exactly true. */
export const spliceChildRows = (
  child: SearchRecord,
  childPath: readonly string[],
): SearchRow[] => child.rows.map(row => ({ ...row, path: [...childPath, ...row.path] }))
