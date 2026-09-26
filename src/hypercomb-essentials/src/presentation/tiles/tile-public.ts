// presentation/tiles/tile-public.ts
//
// The per-tile hide list, the per-tile public flag and the branch-public
// list — all zone-scoped localStorage. A dependency atom: tile-actions.drone.ts,
// show-cell, the swarm and publishing read and write through it; a bee is
// never imported for a value (atomic-modules-plan.md).

import { normalizeCell, SignatureService } from '@hypercomb/core'

/** Zone-scoped localStorage key for the hide list at this location.
 *  SwarmDrone writes `hc:current-zone` on every room/secret change
 *  (or clears it when going private), so we read it sync here and
 *  append it to the key when present. Bleed-protection: switching
 *  zone changes the suffix, so the new zone reads from an empty key
 *  even if the old zone's data is still on disk. Block list never
 *  uses this helper — block is device-scoped on purpose.
 *  Exported so show-cell uses the same key for its render-time read. */
export function hideStorageKey(location: string): string {
  const zone = localStorage.getItem('hc:current-zone') ?? ''
  return zone
    ? `hc:hidden-tiles:${location}:z${zone}`
    : `hc:hidden-tiles:${location}`
}

// ── Per-tile public/private flag ──────────────────────────────────
// A SELF-FACING marker: each tile is private by default; the owner can
// flip individual tiles to public. Persistent + device-scoped (like the
// block list), NOT zone-scoped and NOT in the layer — it's a participant-
// local annotation, so it must never enter the signed lineage (that would
// skew the layer signature across peers, same rule as hide/clipboard).
// Absence from the set means private. We store only the PUBLIC exceptions.
export function publicStorageKey(location: string): string {
  // Normalize every location segment so the key is identical whether the
  // location arrives as a RAW nav path (explorerLabel, e.g. "/My Folder") or
  // a NORMALIZED descent path the publish walk builds ("/my-folder"). Without
  // this, an individually-public tile is silently dropped from the broadcast
  // when the publisher reaches its folder by descent. Branches already match
  // because tilePath() normalizes; this brings the individual key in line.
  const norm = location.split('/').map(s => s.trim()).filter(Boolean).map(s => normalizeCell(s) || s).join('/')
  return `hc:public-tiles:/${norm}`
}

/** Public tile labels at `location`. Empty array on any parse failure. */
export function readPublicLabels(location: string): string[] {
  try {
    const raw = localStorage.getItem(publicStorageKey(location))
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Flip a tile public/private at `location`. Returns the updated label set. */
export function setCellPublic(location: string, label: string, makePublic: boolean): string[] {
  const l = normalizeCell(label) || label
  const list = readPublicLabels(location)
  const has = list.includes(l)
  let next = list
  if (makePublic && !has) next = [...list, l]
  else if (!makePublic && has) next = list.filter(x => x !== l)
  try {
    localStorage.setItem(publicStorageKey(location), JSON.stringify(next))
  } catch { /* private-browsing edge case — flag won't persist */ }
  return next
}

// ── Branch-public ─────────────────────────────────────────────────
// "Make branch public" shares a tile AND its entire sub-tree in one click.
// Rather than walk (and load) the whole tree at click time, we store the
// branch ROOT's canonical path; a tile counts as public-via-branch when any
// stored branch path is a prefix of (or equal to) the tile's own path. O(1)
// per tile at render time, and it covers descendants that aren't loaded yet.
//
// THE POOL IS THE SET (jwize 2026-09-25: state lives only in pools of
// meaning). Each public branch is one record in the `public:branches` pool,
// named by its own content, like a trusted domain (sharing/code-trust.ts).
// `hc:public-branches` stays as the synchronous read cache every renderer
// and the publish scope already read: a toggle writes it first so the tile
// repaints at once, and the pool record follows. `reconcilePublicBranches`
// (sharing.boot.drone.ts, once the store is up) unions the two into each
// other, so a cleared browser gets its public branches back from the pool
// and an older writer's cache-only entry is backfilled.
export const PUBLIC_BRANCHES_MEANING = 'public:branches'
const PUBLIC_BRANCHES_KEY = 'hc:public-branches'
const BRANCH_RECORD_KIND = 'public:branch'
const STORE_KEY = '@hypercomb.social/Store'

type PoolStore = { getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null> }

const encoder = new TextEncoder()
/** The record's exact bytes: it is named by them and written as them. */
const branchRecordBytes = (path: string): ArrayBuffer => {
  const bytes = encoder.encode(JSON.stringify({ kind: BRANCH_RECORD_KIND, path }))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
const branchRecordName = (path: string): Promise<string> => SignatureService.sign(branchRecordBytes(path))

const branchPool = async (): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const store = (window as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(STORE_KEY) as PoolStore | undefined
    return (await store?.getPool?.(PUBLIC_BRANCHES_MEANING)) ?? null
  } catch { return null }
}

const writeBranchRecord = async (dir: FileSystemDirectoryHandle, path: string): Promise<void> => {
  const handle = await dir.getFileHandle(await branchRecordName(path), { create: true })
  const writable = await handle.createWritable()
  try { await writable.write(branchRecordBytes(path)) } finally { await writable.close() }
}

const readBranchPool = async (dir: FileSystemDirectoryHandle): Promise<Set<string>> => {
  const out = new Set<string>()
  try {
    for await (const [, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (handle.kind !== 'file') continue
      try {
        const record = JSON.parse(await (await (handle as FileSystemFileHandle).getFile()).text()) as { kind?: unknown; path?: unknown }
        if (record?.kind === BRANCH_RECORD_KIND && typeof record.path === 'string' && record.path.startsWith('/')) out.add(record.path)
      } catch { /* not a record — skip it */ }
    }
  } catch { /* unreadable pool — treat as empty */ }
  return out
}

const writeBranchCache = (paths: readonly string[]): void => {
  try {
    localStorage.setItem(PUBLIC_BRANCHES_KEY, JSON.stringify(paths))
  } catch { /* private-browsing edge case — the pool still holds it */ }
}

/** Record or withdraw one branch in the pool. A failure is left for the next
 *  reconcile, which backfills a missing record. */
const markBranch = async (path: string, makePublic: boolean): Promise<void> => {
  const dir = await branchPool()
  if (!dir) return
  try {
    if (makePublic) await writeBranchRecord(dir, path)
    else await dir.removeEntry(await branchRecordName(path))
  } catch { /* no record to remove, or the write failed */ }
}

/** Union the pool and the read cache into each other. Returns how many
 *  branches are public. */
export async function reconcilePublicBranches(): Promise<number> {
  const dir = await branchPool()
  const cached = readPublicBranches()
  if (!dir) return cached.length
  const held = await readBranchPool(dir)
  const missing = [...held].filter(p => !cached.includes(p))
  if (missing.length) writeBranchCache([...cached, ...missing])
  for (const path of cached) {
    if (held.has(path)) continue
    try { await writeBranchRecord(dir, path) } catch { /* the next reconcile backfills it */ }
  }
  return cached.length + missing.length
}

/** Canonical absolute path of a tile, with EVERY segment normalized so the
 *  stored branch-root path and a descendant's path agree even though nav
 *  segments are raw (Lineage keeps them un-normalized). Without normalizing
 *  the whole path, a branch rooted at "My Folder" (stored `/my-folder`) never
 *  matched a descendant whose location prefix carried the raw "My Folder". */
export function tilePath(location: string, label: string): string {
  const segs = location.split('/').map(s => s.trim()).filter(Boolean).map(s => normalizeCell(s) || s)
  const l = normalizeCell(label) || label
  return '/' + [...segs, l].join('/')
}

/** True when this tile is marked public INDIVIDUALLY (ignores branch cover).
 *  The make-public icon's tint uses this so it matches what its click toggles. */
export function isIndividuallyPublic(location: string, label: string): boolean {
  const l = normalizeCell(label) || label
  return readPublicLabels(location).includes(l)
}

/** Lineage paths whose whole branch is public. Empty on any parse failure. */
export function readPublicBranches(): string[] {
  try {
    const raw = localStorage.getItem(PUBLIC_BRANCHES_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** True when this exact tile is itself a public-branch root. */
export function isBranchPublic(location: string, label: string): boolean {
  return readPublicBranches().includes(tilePath(location, label))
}

/** Toggle the whole branch rooted at this tile public/private. */
export function setBranchPublic(location: string, label: string, makePublic: boolean): string[] {
  const p = tilePath(location, label)
  const list = readPublicBranches()
  const has = list.includes(p)
  let next = list
  if (makePublic && !has) next = [...list, p]
  else if (!makePublic && has) next = list.filter(x => x !== p)
  writeBranchCache(next)
  void markBranch(p, makePublic)
  return next
}

/** True when this tile is public — either marked individually, or covered by
 *  a public branch rooted at it or any ancestor. */
export function isCellPublic(location: string, label: string): boolean {
  const l = normalizeCell(label) || label
  if (readPublicLabels(location).includes(l)) return true
  const p = tilePath(location, label)
  return readPublicBranches().some(b => p === b || p.startsWith(b + '/'))
}

/** The public-BRANCH roots that are direct children of `location` — what a
 *  swarm join publishes from your host (documentation/deployment-stages.md
 *  §4.2: per public-branch root, never a single public tile). Each entry is
 *  the branch's segments. The root location has no branch of its own; its
 *  public branches are its children and are returned. */
export function publicBranchRootsAt(location: string): string[][] {
  const here = location.split('/').map(s => s.trim()).filter(Boolean).map(s => normalizeCell(s) || s)
  const prefix = '/' + here.join('/')
  const out: string[][] = []
  const seen = new Set<string>()
  const take = (segs: string[]): void => {
    const k = segs.join('/')
    if (seen.has(k)) return
    seen.add(k)
    out.push(segs)
  }
  for (const path of readPublicBranches()) {
    const segs = path.split('/').filter(Boolean)
    if (segs.length === 0) continue
    // Standing INSIDE a public branch: that branch is the one you offer.
    if (prefix === path || prefix.startsWith(path + '/')) { take(segs); continue }
    if (segs.length !== here.length + 1) continue
    if ('/' + segs.slice(0, -1).join('/') !== prefix) continue
    take(segs)
  }
  return out
}
