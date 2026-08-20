// diamondcoreprocessor.com/presentation/tiles/tile-art.ts
//
// DEFAULT TILE ART — the picture a tile shows when it has none of its own.
//
// A tile picture is already a resolvable resource: `props.large.image` holds a
// SIGNATURE and the bytes live at the content root. This module adds one step
// behind that, for the case the properties cannot cover — a tile that stands
// for a BEHAVIOUR rather than for something an author photographed. The backup
// window, the tutor, the website builder: each should be able to arrive with a
// picture, and an author should be able to replace it, without either of them
// being a special case in the renderer.
//
// ── Where it lives ─────────────────────────────────────────────────────
//
//   sign('visual:tile-art')/<name>   →  bytes are a 64-hex signature
//   <content root>/<that signature>  →  the image itself
//
// The pool holds a POINTER, not the image. That is the composition rule the
// whole system runs on, and it is what makes this cost nothing: the picture is
// an ordinary content-addressed resource, so it dedupes against any other copy
// of the same bytes, caches by signature, travels in a backup, and is adopted
// by a peer exactly like every other resource. A pool full of image bytes
// would have none of that.
//
// ── Keyed by NAME, deliberately ────────────────────────────────────────
//
// The member name is the tile's own name — `folder-sync`, `tutor`, `website`.
// Not a location signature, because then the art would belong to one cell and
// every other instance of that behaviour would be bare. Not a registry entry,
// because that would put the mapping back in code and mean a new picture needs
// a release. A name is what an author already knows.
//
// The consequence is that two tiles sharing a name share a default. For
// behaviour tiles that is the point. For anything else, the tile's own
// `large.image` still wins — see the order in `tile-view.drone.ts`.
//
// ── Not a cache ────────────────────────────────────────────────────────
//
// This is TRUTH: an author's choice of picture cannot be re-derived from
// layers by a cold client, so by the optimize-phase litmus it is state, gets
// its own pool of meaning, and is never minted from the optimize phase.

const TILE_ART_MEANING = 'visual:tile-art'
const SIG_RE = /^[0-9a-f]{64}$/

type StoreLike = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
}

const store = (): StoreLike | undefined =>
  (window as { ioc?: { get?: <T>(k: string) => T | undefined } })
    .ioc?.get?.<StoreLike>('@hypercomb.social/Store')

/**
 * Names resolved this session, including the misses.
 *
 * A miss is the common answer — most tiles have no default art — and it is
 * asked on every render pass, so caching `''` matters more than caching a hit.
 * Cleared by `forgetTileArt` when a member is written, which is the only way
 * an answer can change: the pool is the sole writer of its own contents.
 */
const resolved = new Map<string, string>()

/**
 * The signature of the default picture for a tile of this name, or `''`.
 *
 * Never throws: art is decoration, and a tile that cannot find its picture
 * must still render. Every failure path is a miss.
 */
export async function tileArtSig(name: string): Promise<string> {
  const key = String(name ?? '').trim().toLowerCase()
  if (!key) return ''
  const known = resolved.get(key)
  if (known !== undefined) return known

  let sig = ''
  try {
    const pool = await store()?.getPool(TILE_ART_MEANING)
    if (pool) {
      const handle = await pool.getFileHandle(key, { create: false })
      const text = (await (await handle.getFile()).text()).trim().toLowerCase()
      // The member is a pointer. Anything else is a member someone wrote by
      // hand incorrectly, and a bad pointer must read as "no art" rather than
      // as a signature that will 404 on every render.
      if (SIG_RE.test(text)) sig = text
    }
  } catch { /* absent member, no pool, no OPFS — all of them mean no art */ }

  resolved.set(key, sig)
  return sig
}

/**
 * Point a name at a picture. `sig` must already be a stored resource.
 *
 * This is the whole authoring surface: put the image with `Store.putResource`,
 * then name it here. No build step, no registration, no release.
 */
export async function setTileArt(name: string, sig: string): Promise<boolean> {
  const key = String(name ?? '').trim().toLowerCase()
  const pointer = String(sig ?? '').trim().toLowerCase()
  if (!key || !SIG_RE.test(pointer)) return false
  try {
    const pool = await store()?.getPool(TILE_ART_MEANING)
    if (!pool) return false
    const handle = await pool.getFileHandle(key, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(pointer) } finally { await writable.close() }
    resolved.set(key, pointer)
    return true
  } catch {
    return false
  }
}

/** Drop a cached answer — for a writer that is not `setTileArt` (a restore, a
 *  peer's pool arriving) and for tests. No argument clears everything. */
export function forgetTileArt(name?: string): void {
  if (name === undefined) { resolved.clear(); return }
  resolved.delete(String(name).trim().toLowerCase())
}
