// diamondcoreprocessor.com/presentation/tiles/tree-stencil.ts
//
// STENCILS — a named cut-out of the tree.
//
// A stencil is not a bookmark to one place. It is a named fragment: where the
// tree is rooted, plus the branches you CALLED into it from any level. You
// name it first — the name is the starting point, not an afterthought — and
// then keep calling branches in as you find them. Come back to the name later
// and the same fragment is there.
//
// Because a called branch is held as a LAYER SIGNATURE, a stencil is a set of
// signatures with a name on it. That makes it portable in exactly the way the
// rest of the system is: the same sigs a stencil holds can be handed to any
// other tool as input, and identical fragments dedupe to identical bytes.
//
// Storage: the whole catalog is ONE document in the sign('tree:stencils')
// pool via putPoolDoc/getPoolDoc — content-addressed, exactly one current
// member, no human filenames. The meaning carries a colon so it can never
// collide with a lineage bag named by a tile slug (a bare `tree` would have
// collided with a page called "tree").

/** Pool of meaning holding the stencil catalog. The colon is REQUIRED —
 *  lineage bags share the flat root namespace and are named sha256(slug),
 *  which can never contain a colon. */
export const STENCILS_MEANING = 'tree:stencils'

export type StencilRoot = {
  readonly sig?: string
  readonly segments?: readonly string[]
  readonly label?: string
}

export type Stencil = {
  readonly name: string
  readonly root: StencilRoot
  /** Layer sigs called into the fragment, from any level of the tree. */
  readonly calls: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

export type StencilCatalog = Record<string, Stencil>

export type StencilStore = {
  initialize(): Promise<void>
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  putPoolDoc(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string): Promise<string | null>
  getPoolDoc(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
}

/** Names are handles people type — keep them to what a command line can
 *  complete against without quoting. */
export const STENCIL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,47}$/

export function isValidStencilName(name: string): boolean {
  return STENCIL_NAME.test(String(name ?? '').trim())
}

export async function loadStencils(store: StencilStore): Promise<StencilCatalog> {
  try {
    await store.initialize()
    const pool = await store.getPool(STENCILS_MEANING)
    if (!pool) return {}
    const bytes = await store.getPoolDoc(pool)
    if (!bytes) return {}
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: StencilCatalog = {}
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      const record = value as Partial<Stencil>
      if (!record || typeof record !== 'object') continue
      out[name] = {
        name,
        root: (record.root ?? {}) as StencilRoot,
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

async function writeCatalog(store: StencilStore, catalog: StencilCatalog): Promise<boolean> {
  try {
    await store.initialize()
    const pool = await store.getPool(STENCILS_MEANING)
    if (!pool) return false
    const bytes = new TextEncoder().encode(JSON.stringify(catalog))
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return (await store.putPoolDoc(pool, buffer)) !== null
  } catch {
    return false
  }
}

/** Read-modify-write the catalog. The catalog is one small document and a
 *  stencil edit is a deliberate user action, so a full rewrite is honest —
 *  and it keeps the pool at exactly one current member. */
export async function saveStencil(store: StencilStore, stencil: Stencil): Promise<StencilCatalog> {
  const catalog = await loadStencils(store)
  catalog[stencil.name] = stencil
  await writeCatalog(store, catalog)
  return catalog
}

export async function deleteStencil(store: StencilStore, name: string): Promise<StencilCatalog> {
  const catalog = await loadStencils(store)
  if (!(name in catalog)) return catalog
  delete catalog[name]
  await writeCatalog(store, catalog)
  return catalog
}

/** Add a branch to a fragment. Idempotent — calling the same branch twice is
 *  a no-op, so a double click never grows the set. */
export function withCall(stencil: Stencil, sig: string, at: number): Stencil {
  if (stencil.calls.includes(sig)) return stencil
  return { ...stencil, calls: [...stencil.calls, sig], updatedAt: at }
}

export function withoutCall(stencil: Stencil, sig: string, at: number): Stencil {
  if (!stencil.calls.includes(sig)) return stencil
  return { ...stencil, calls: stencil.calls.filter(s => s !== sig), updatedAt: at }
}

export function newStencil(name: string, root: StencilRoot, at: number): Stencil {
  return { name, root, calls: [], createdAt: at, updatedAt: at }
}
