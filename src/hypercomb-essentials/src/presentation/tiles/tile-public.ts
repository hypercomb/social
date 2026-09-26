// presentation/tiles/tile-public.ts
//
// The per-tile hide list, the per-tile public flag and the branch-public
// list — all zone-scoped localStorage. A dependency atom: tile-actions.drone.ts,
// show-cell, the swarm and publishing read and write through it; a bee is
// never imported for a value (atomic-modules-plan.md).

import { normalizeCell } from '@hypercomb/core'

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
const PUBLIC_BRANCHES_KEY = 'hc:public-branches'

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
  try {
    localStorage.setItem(PUBLIC_BRANCHES_KEY, JSON.stringify(next))
  } catch { /* private-browsing edge case — flag won't persist */ }
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
