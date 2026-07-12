// hypercomb-shared/core/websites-pool.ts
//
// The sign('websites:menu') POOL OF MEANING — the participant's website
// directory, kept as a HISTORY.
//
// Membership is never a mutable record set — it is an append-only chain of
// history items, the same shape a lineage sigbag keeps (numeric markers →
// content-addressed records) and the same doctrine pheromones pinned
// (deposits = histories in a pool). Flipping the Website beehavior on a tile
// literally appends one item:
//
//   marker 0000000N → { kind:'website', op:'enable'|'disable',
//                       appliesTo:[segments], payload:{label,icon}, at }
//
// The MENU is the fold of that chain (last op per path wins). Nothing is
// ever deleted or overwritten: turning a site off appends a compensating
// item — linear append-only, every past menu state remains walkable.
//
// Participant-local, like the hidden pool: a menu is a local view, so the
// pool is NOT in Store's syncable kinds and never rides the mesh.
//
// WHY THE COLON in the meaning: lineage bags and pools share the flat OPFS
// root, and a location bag is named sha256(lineageKey(segments)) — for the
// /websites launcher page that is sha256('websites'), byte-identical to a
// bare sign('websites') pool (verified live: the bag's 00000000 marker
// landed inside the pool). lineageKey folds every non-letter/number to '-',
// so no location can ever hash a colon-bearing string — ':' makes the pool
// address collision-proof against every possible tile path, forever.
//
// Shell-level: Store resolves through the global ioc at call time.

import { EffectBus, SignatureService, isSignature } from '@hypercomb/core'

const RECORD_KIND = 'website'
const SEEDED_KIND = 'websites-seeded'
/** The pool's meaning string — its address is sign('websites:menu'), derived. */
const MEANING = 'websites:menu'
/** Marker filenames: zero-padded ordinals, same convention as lineage bags. */
const MARKER_RE = /^\d{8}$/

type StoreLike = { getPool(meaning: string): Promise<FileSystemDirectoryHandle | null> }
type PoolDir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }

export interface WebsiteMenuEntry {
  /** Lineage path to the site's root cell. */
  segments: string[]
  label: string
  icon: string
  /** Head state after the fold — false when the last item is a disable. */
  enabled: boolean
  /** Timestamp of the item that produced this head state. */
  at: number
}

type WebsiteItem = {
  kind?: string
  op?: string
  appliesTo?: unknown
  payload?: { label?: unknown; icon?: unknown }
  at?: number
}

const norm = (segments: readonly string[]): string[] =>
  segments.map(s => String(s ?? '').trim()).filter(Boolean)

const pathKey = (segments: readonly string[]): string => norm(segments).join('/')

async function pool(): Promise<PoolDir | null> {
  const store = get<StoreLike>('@hypercomb.social/Store')
  if (!store?.getPool) return null
  return (await store.getPool(MEANING)) as PoolDir | null
}

async function writeBytes(dir: PoolDir, name: string, bytes: Uint8Array): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try { await writable.write(bytes as unknown as BlobPart) } finally { await writable.close() }
}

/** The chain, oldest first: each marker resolved to its record. Markers whose
 *  record is missing/malformed are skipped (the fold self-heals past them). */
async function readChain(): Promise<WebsiteItem[]> {
  const dir = await pool()
  if (!dir) return []
  const markers: string[] = []
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && MARKER_RE.test(name)) markers.push(name)
    }
  } catch { return [] }
  markers.sort()
  const out: WebsiteItem[] = []
  for (const name of markers) {
    try {
      const file = await (await dir.getFileHandle(name)).getFile()
      const marker = JSON.parse(await file.text()) as { record?: string }
      const sig = String(marker?.record ?? '')
      if (!isSignature(sig)) continue
      const rec = await (await dir.getFileHandle(sig)).getFile()
      out.push(JSON.parse(await rec.text()) as WebsiteItem)
    } catch { /* torn/missing item — the fold skips it */ }
  }
  return out
}

/** Fold the chain to head state: last op per path wins. Every path ever
 *  touched appears (enabled:false for delisted ones — nothing is lost). */
export async function foldWebsites(): Promise<WebsiteMenuEntry[]> {
  const byPath = new Map<string, WebsiteMenuEntry>()
  for (const item of await readChain()) {
    if (item?.kind !== RECORD_KIND) continue
    const segments = Array.isArray(item.appliesTo) ? norm(item.appliesTo as string[]) : []
    if (segments.length === 0) continue
    const prev = byPath.get(pathKey(segments))
    byPath.set(pathKey(segments), {
      segments,
      // A disable item carries no payload refresh — keep the last known label/icon.
      label: String(item.payload?.label ?? '').trim() || prev?.label || segments[segments.length - 1],
      icon: String(item.payload?.icon ?? '').trim() || prev?.icon || '',
      enabled: item.op !== 'disable',
      at: typeof item.at === 'number' ? item.at : 0,
    })
  }
  return [...byPath.values()]
}

/** The menu: currently-enabled sites only. */
export async function listWebsites(): Promise<WebsiteMenuEntry[]> {
  return (await foldWebsites()).filter(e => e.enabled)
}

/** Append ONE history item to the pool: a content-addressed record plus the
 *  next numeric marker pointing at it. Returns the marker name, or null when
 *  the pool is unavailable. */
async function appendItem(
  op: 'enable' | 'disable',
  segments: readonly string[],
  meta: { label?: string; icon?: string } = {},
  opts: { silent?: boolean } = {},
): Promise<string | null> {
  const segs = norm(segments)
  if (segs.length === 0) return null
  const dir = await pool()
  if (!dir) return null
  try {
    const item = {
      kind: RECORD_KIND,
      op,
      appliesTo: segs,
      ...(op === 'enable'
        ? { payload: { label: String(meta.label ?? '').trim() || segs[segs.length - 1], icon: String(meta.icon ?? '').trim() } }
        : {}),
      at: Date.now(),
    }
    const bytes = new TextEncoder().encode(JSON.stringify(item))
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    await writeBytes(dir, sig, bytes)
    // Next ordinal. UI writes are serialized (single thread, one gesture at a
    // time); a same-name race would only re-point a marker at its own record.
    let max = 0
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && MARKER_RE.test(name)) max = Math.max(max, parseInt(name, 10))
    }
    const marker = String(max + 1).padStart(8, '0')
    await writeBytes(dir, marker, new TextEncoder().encode(JSON.stringify({ record: sig })))
    if (!opts.silent) EffectBus.emit('websites:changed', { segments: segs, op })
    return marker
  } catch { return null }
}

/** Enable a site in the menu — one history item. No-op when the head fold
 *  already has this path enabled with the same label/icon (a rebuilt site
 *  must not spam the chain). */
export async function enableWebsite(
  segments: readonly string[],
  meta: { label?: string; icon?: string } = {},
  opts: { silent?: boolean } = {},
): Promise<string | null> {
  const segs = norm(segments)
  if (segs.length === 0) return null
  const label = String(meta.label ?? '').trim() || segs[segs.length - 1]
  const icon = String(meta.icon ?? '').trim()
  const head = (await foldWebsites()).find(e => pathKey(e.segments) === pathKey(segs))
  if (head?.enabled && head.label === label && head.icon === icon) return null
  return appendItem('enable', segs, { label, icon }, opts)
}

/** Disable a site — one compensating history item. No-op when the path is
 *  already off (or was never enabled). */
export async function disableWebsite(
  segments: readonly string[],
  opts: { silent?: boolean } = {},
): Promise<string | null> {
  const segs = norm(segments)
  if (segs.length === 0) return null
  const head = (await foldWebsites()).find(e => pathKey(e.segments) === pathKey(segs))
  if (!head?.enabled) return null
  return appendItem('disable', segs, {}, opts)
}

/** Has the one-time legacy-walk seed already run on this profile? The
 *  sentinel is a bare content-addressed record (not part of the chain). */
export async function isSeeded(): Promise<boolean> {
  const dir = await pool()
  if (!dir) return false
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !isSignature(name)) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        if ((JSON.parse(await file.text()) as { kind?: string })?.kind === SEEDED_KIND) return true
      } catch { /* not the sentinel */ }
    }
  } catch { /* pool unreadable */ }
  return false
}

/** Mark the seed done — the discovery walk never runs again after this. */
export async function markSeeded(): Promise<void> {
  const dir = await pool()
  if (!dir) return
  try {
    const bytes = new TextEncoder().encode(JSON.stringify({ kind: SEEDED_KIND }))
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    await writeBytes(dir, sig, bytes)
  } catch { /* best-effort — an unseeded pool just re-runs the walk */ }
}
