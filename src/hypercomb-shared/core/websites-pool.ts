// hypercomb-shared/core/websites-pool.ts
//
// The sign('websites:menu') POOL OF MEANING — the participant's website
// directory.
//
// Membership in the Websites menu is DECLARED TRUTH, not derived
// classification. The old model inferred sites by walking the tree for
// `visual:website:page` decorations; that made membership availability-
// dependent (an unresolvable decoration blob declassified a site root and
// promoted its sub-pages) and made it travel with adoption (copying a
// page-stamped subtree polluted the copier's menu). Run through the
// array-vs-folder table (documentation/pheromones.md): menu membership is
// ABOUT cells, extrinsic per context, and doesn't travel with the closure —
// pool side on every row that matters.
//
// One record per site:
//
//   { kind: 'website', appliesTo: <segments>, payload: { label, icon } }
//
// Records are content-addressed members of the pool (file name = sign(bytes),
// derived at runtime via Store.poolSignature — never hardcoded). Identical
// registration dedupes to one member; re-registering a path with a new
// label/icon replaces its prior record. A one-time seed sentinel
// ({ kind: 'websites-seeded' }) marks that the legacy discovery walk has been
// folded in, so the walk never runs again — after that, membership changes
// only through register/unregister (build events, explicit curation).
//
// Participant-local, like the hidden pool: a menu is a local view, so the
// pool is NOT in Store's syncable kinds and never rides the mesh.
//
// Shell-level: Store resolves through the global ioc at call time.

import { EffectBus, SignatureService, isSignature } from '@hypercomb/core'

const RECORD_KIND = 'website'
const SEEDED_KIND = 'websites-seeded'
/** The pool's meaning string — its address is sign('websites:menu'), derived.
 *
 *  WHY THE COLON: lineage bags and pools share the flat OPFS root, and a
 *  location bag is named sha256(lineageKey(segments)) — for the /websites
 *  launcher page that is sha256('websites'), byte-identical to a bare
 *  sign('websites') pool. The two would be ONE directory (verified live:
 *  the bag's 00000000 marker landed inside the pool). lineageKey folds
 *  every non-letter/number character to '-', so no location can ever hash
 *  a colon-bearing string — a ':' in the meaning makes the pool address
 *  collision-proof against every possible tile path, forever. */
const MEANING = 'websites:menu'

type StoreLike = { getPool(meaning: string): Promise<FileSystemDirectoryHandle | null> }
type PoolDir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }

export interface WebsiteRecord {
  /** The record's signature — the pool member name (remove handle). */
  recordSig: string
  /** Lineage path to the site's root cell. */
  segments: string[]
  label: string
  icon: string
}

const norm = (segments: readonly string[]): string[] =>
  segments.map(s => String(s ?? '').trim()).filter(Boolean)

const pathKey = (segments: readonly string[]): string => norm(segments).join('/')

async function pool(): Promise<PoolDir | null> {
  const store = get<StoreLike>('@hypercomb.social/Store')
  if (!store?.getPool) return null
  return (await store.getPool(MEANING)) as PoolDir | null
}

/** Every raw member of the pool, parsed. Malformed members are skipped. */
async function members(): Promise<Array<{ sig: string; rec: { kind?: string; appliesTo?: unknown; payload?: { label?: unknown; icon?: unknown } } }>> {
  const dir = await pool()
  if (!dir) return []
  const out: Array<{ sig: string; rec: { kind?: string; appliesTo?: unknown; payload?: { label?: unknown; icon?: unknown } } }> = []
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !isSignature(name)) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        out.push({ sig: name, rec: JSON.parse(await file.text()) })
      } catch { /* malformed member — skip */ }
    }
  } catch { /* pool unreadable — treat as empty */ }
  return out
}

/** Every registered website, one entry per record. */
export async function listWebsites(): Promise<WebsiteRecord[]> {
  return (await members())
    .filter(m => m.rec?.kind === RECORD_KIND)
    .map(m => {
      const segments = Array.isArray(m.rec.appliesTo) ? norm(m.rec.appliesTo as string[]) : []
      return {
        recordSig: m.sig,
        segments,
        label: String(m.rec.payload?.label ?? '').trim(),
        icon: String(m.rec.payload?.icon ?? '').trim(),
      }
    })
    .filter(r => r.segments.length > 0)
}

/** Register a site root. Content-idempotent; a prior record at the same path
 *  is replaced (new member fully written before the old is dropped). Returns
 *  the record sig, or null when the pool is unavailable. */
export async function registerWebsite(
  segments: readonly string[],
  meta: { label?: string; icon?: string } = {},
  opts: { silent?: boolean } = {},
): Promise<string | null> {
  const segs = norm(segments)
  if (segs.length === 0) return null
  const dir = await pool()
  if (!dir) return null
  const record = {
    kind: RECORD_KIND,
    appliesTo: segs,
    payload: {
      label: String(meta.label ?? '').trim() || segs[segs.length - 1],
      icon: String(meta.icon ?? '').trim(),
    },
  }
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(record))
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    const handle = await dir.getFileHandle(sig, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
    // Replace: drop other records claiming the same path.
    const key = pathKey(segs)
    for (const m of await members()) {
      if (m.sig === sig || m.rec?.kind !== RECORD_KIND) continue
      const other = Array.isArray(m.rec.appliesTo) ? pathKey(m.rec.appliesTo as string[]) : ''
      if (other === key) { try { await dir.removeEntry(m.sig) } catch { /* raced */ } }
    }
    if (!opts.silent) EffectBus.emit('websites:changed', { segments: segs, op: 'register' })
    return sig
  } catch { return null }
}

/** Remove every record at a path. True when at least one member was removed. */
export async function unregisterWebsite(segments: readonly string[]): Promise<boolean> {
  const key = pathKey(segments)
  if (!key) return false
  const dir = await pool()
  if (!dir) return false
  let removed = false
  for (const m of await members()) {
    if (m.rec?.kind !== RECORD_KIND) continue
    const other = Array.isArray(m.rec.appliesTo) ? pathKey(m.rec.appliesTo as string[]) : ''
    if (other !== key) continue
    try { await dir.removeEntry(m.sig); removed = true } catch { /* raced */ }
  }
  if (removed) EffectBus.emit('websites:changed', { segments: norm(segments), op: 'unregister' })
  return removed
}

/** Has the one-time legacy-walk seed already run on this profile? */
export async function isSeeded(): Promise<boolean> {
  return (await members()).some(m => m.rec?.kind === SEEDED_KIND)
}

/** Mark the seed done — the discovery walk never runs again after this. */
export async function markSeeded(): Promise<void> {
  const dir = await pool()
  if (!dir) return
  try {
    const bytes = new TextEncoder().encode(JSON.stringify({ kind: SEEDED_KIND }))
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    const handle = await dir.getFileHandle(sig, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
  } catch { /* best-effort — an unseeded pool just re-runs the walk */ }
}
