// diamondcoreprocessor.com/presentation/tiles/tree-insight.ts
//
// INSIGHTS — a named cut-out of the tree.
//
// The name is the beekeeper's: an insight is the part of the comb you lift out,
// label, and hold up on its own. It is not a bookmark to one place — it is
// where the tree is rooted plus the branches you CALLED into it from any
// level. You name it first (the name is the starting point, not an
// afterthought) and keep calling branches in as you find them. Come back to
// the name later and the same insight is there.
//
// Because a called branch is held as a LAYER SIGNATURE, an insight is a set of
// signatures with a name on it — which makes it A INSIGHT OF COMPUTE. It is a
// bounded region of the tree, named, and handed to something as input:
// whatever is asked of an insight is asked of exactly those signatures and no
// others. That is why it is worth naming before it is worth filling.
// Identical insights dedupe to identical bytes, like everything else here.
//
// Storage: the whole catalog is ONE document in the sign('insights:catalog')
// pool via putPoolDoc/getPoolDoc — content-addressed, exactly one current
// member, no human filenames. The meaning carries a colon so it can never
// collide with a lineage bag named by a tile slug (a bare `tree` would have
// collided with a page called "tree").

/** Pool of meaning holding the insight catalog. The colon is REQUIRED —
 *  lineage bags share the flat root namespace and are named sha256(slug),
 *  which can never contain a colon. */
export const INSIGHTS_MEANING = 'insights:catalog'

export type InsightRoot = {
  readonly sig?: string
  readonly segments?: readonly string[]
  readonly label?: string
}

export type Insight = {
  readonly name: string
  readonly root: InsightRoot
  /** Layer sigs called into the fragment, from any level of the tree. */
  readonly calls: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

export type InsightCatalog = Record<string, Insight>

export type InsightStore = {
  initialize(): Promise<void>
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  putPoolDoc(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string): Promise<string | null>
  getPoolDoc(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
}

/** Names are handles people type — keep them to what a command line can
 *  complete against without quoting. */
export const INSIGHT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,47}$/

export function isValidInsightName(name: string): boolean {
  return INSIGHT_NAME.test(String(name ?? '').trim())
}

export async function loadInsights(store: InsightStore): Promise<InsightCatalog> {
  try {
    await store.initialize()
    const pool = await store.getPool(INSIGHTS_MEANING)
    if (!pool) return {}
    const bytes = await store.getPoolDoc(pool)
    if (!bytes) return {}
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: InsightCatalog = {}
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      const record = value as Partial<Insight>
      if (!record || typeof record !== 'object') continue
      out[name] = {
        name,
        root: (record.root ?? {}) as InsightRoot,
        calls: Array.isArray(record.calls) ? record.calls.map(String) : [],
        createdAt: Number(record.createdAt ?? 0),
        updatedAt: Number(record.updatedAt ?? record.createdAt ?? 0),
      }
    }
    return out
  } catch {
    return {}
  }
}

async function writeCatalog(store: InsightStore, catalog: InsightCatalog): Promise<boolean> {
  try {
    await store.initialize()
    const pool = await store.getPool(INSIGHTS_MEANING)
    if (!pool) return false
    const bytes = new TextEncoder().encode(JSON.stringify(catalog))
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return (await store.putPoolDoc(pool, buffer)) !== null
  } catch {
    return false
  }
}

/** Read-modify-write the catalog. The catalog is one small document and a
 *  insight edit is a deliberate user action, so a full rewrite is honest —
 *  and it keeps the pool at exactly one current member. */
export async function saveInsight(store: InsightStore, insight: Insight): Promise<InsightCatalog> {
  const catalog = await loadInsights(store)
  catalog[insight.name] = insight
  await writeCatalog(store, catalog)
  return catalog
}

export async function deleteInsight(store: InsightStore, name: string): Promise<InsightCatalog> {
  const catalog = await loadInsights(store)
  if (!(name in catalog)) return catalog
  delete catalog[name]
  await writeCatalog(store, catalog)
  return catalog
}

/** Add a branch to a fragment. Idempotent — calling the same branch twice is
 *  a no-op, so a double click never grows the set. */
export function withCall(insight: Insight, sig: string, at: number): Insight {
  if (insight.calls.includes(sig)) return insight
  return { ...insight, calls: [...insight.calls, sig], updatedAt: at }
}

export function withoutCall(insight: Insight, sig: string, at: number): Insight {
  if (!insight.calls.includes(sig)) return insight
  return { ...insight, calls: insight.calls.filter(s => s !== sig), updatedAt: at }
}

export function newInsight(name: string, root: InsightRoot, at: number): Insight {
  return { name, root, calls: [], createdAt: at, updatedAt: at }
}
