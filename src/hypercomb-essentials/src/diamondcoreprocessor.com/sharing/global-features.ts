// diamondcoreprocessor.com/sharing/global-features.ts
//
// GLOBAL features — domain-level capabilities that belong to the DOMAIN, not
// to any tile — organized as a FOLDER TREE, not a flat list. `games` is a
// folder; each game is a leaf inside it; future families (tools, dashboards)
// are sibling folders. Publishing and adopting happen AT EVERY LEVEL: mark a
// folder public and everything in it is public; mark one leaf public and its
// ancestor folders come along implicitly (a leaf without its folder is
// meaningless — the parent is a dependency of the child).
//
// Each published node is a decoration of kind `feature:global` on the HIVE
// ROOT (segments []), payload `{ path, label, icon }` — the node's own
// identity only, so the same node published by any domain produces ONE
// content-addressed resource. The marks ride the root layer — the first
// thing a peer fetches in the adopt window — so the tree travels with the
// domain through the existing share/adopt pipeline. No manifest field, no
// new sync path.
//
// Publishing is a MARK, not a delivery: adopters see the tree listed (names +
// meta only) in the features panel's Globals section. Nothing executes from a
// mark — a module only runs after it arrives through the installer's own
// consent path, so globals stay inert-by-construction.
//
// Writes use LayerCommitter's AWAITABLE slot API (not the fire-and-forget
// `decorations:changed` trigger): callers re-read the root immediately after
// a toggle to refresh the panel, so resolve must mean the commit landed.

import {
  listDecorations,
  DECORATIONS_SLOT,
} from '../commands/decoration-manifest.js'

/** Decoration kind that marks a PUBLIC domain-level feature on the root. */
export const GLOBAL_FEATURE_KIND = 'feature:global'

/** Content-addressed payload of a `feature:global` record — one NODE of the
 *  globals tree. `path` places it (`['games']` = the folder, `['games',
 *  'arkanoid']` = a leaf); a leaf's tail segment is its stable id (a game's
 *  toggle key). Identity only — identical nodes dedup network-wide. */
export interface GlobalFeaturePayload {
  readonly path: readonly string[]
  readonly label: string
  /** Material Symbols glyph for the panel row. */
  readonly icon: string
}

/** One node of a globals tree, resolved for the panel: local or published,
 *  with its children attached. */
export interface GlobalNode {
  readonly path: readonly string[]
  readonly label: string
  readonly icon: string
  readonly children: GlobalNode[]
}

/** A locally-registered game's launch surface (id / label / icon). */
export interface LocalGame {
  readonly id: string
  readonly label: string
  readonly icon: string
}

type GameLike = {
  genotype?: string
  gameId?: unknown
  gameLabel?: unknown
  gameIcon?: unknown
}

type IocLike = {
  list(): readonly string[]
  get(key: string): unknown
}

const ioc = (): IocLike | undefined => (window as unknown as { ioc?: IocLike }).ioc

/** Every `genotype:'game'` bee registered in IoC that carries a launch
 *  descriptor — the live pool of local games, no roster (mirrors the games
 *  launch group's enumeration; a community game module appears here the
 *  moment it registers). */
export function localGames(): LocalGame[] {
  const c = ioc()
  if (!c) return []
  const seen = new Set<string>()
  const out: LocalGame[] = []
  for (const key of c.list()) {
    const g = c.get(key) as GameLike | undefined
    if (!g || g.genotype !== 'game') continue
    const id = typeof g.gameId === 'string' ? g.gameId.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      label: typeof g.gameLabel === 'string' && g.gameLabel.trim() ? g.gameLabel.trim() : id,
      icon: typeof g.gameIcon === 'string' && g.gameIcon.trim() ? g.gameIcon.trim() : 'sports_esports',
    })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

/** The LOCAL globals tree — every family folder this participant's modules
 *  populate. Today: the `games` folder with one leaf per registered game.
 *  A future family (tools, dashboards) adds a sibling folder here, or a
 *  registry replaces this function — the shape stays a tree either way. */
export function localGlobalTree(): GlobalNode[] {
  const games = localGames()
  if (games.length === 0) return []
  return [{
    path: ['games'],
    label: 'Games',
    icon: 'sports_esports',
    children: games.map(g => ({
      path: ['games', g.id],
      label: g.label,
      icon: g.icon,
      children: [],
    })),
  }]
}

/** Does a local module answer to this leaf id (a game's toggle key)?
 *  Presence means the participant can launch it right now. */
export function isGlobalInstalled(id: string): boolean {
  if (!id) return false
  return localGames().some(g => g.id === id)
}

// ── path helpers ──────────────────────────────────────────────────────

export const pathKey = (path: readonly string[]): string => path.join('/')

export const samePath = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((s, i) => s === b[i])

/** Is `a` strictly inside `b` (a descendant, not b itself)? */
export const isUnder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length > b.length && b.every((s, i) => s === a[i])

// ── root records ──────────────────────────────────────────────────────

type StoreLike = {
  putResource(blob: Blob): Promise<string>
}

type CommitterLike = {
  commitSlotAppend(segments: readonly string[], slot: string, sig: string): Promise<void>
  commitSlotRemove(segments: readonly string[], slot: string, sig: string): Promise<void>
}

const committer = (): CommitterLike | undefined =>
  window.ioc.get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')

/** A published node read back from the root: its record sig + normalized
 *  payload. Legacy flat records (`{ id, family }`, the pre-tree shape) are
 *  normalized to `['games', id]` so they stay visible and withdrawable. */
export interface PublishedGlobal {
  readonly sig: string
  readonly path: readonly string[]
  readonly label: string
  readonly icon: string
}

/** The `feature:global` nodes currently published on the hive root. */
export async function publishedGlobals(): Promise<PublishedGlobal[]> {
  const raw = await listDecorations<Record<string, unknown>>({ kind: GLOBAL_FEATURE_KIND, segments: [] })
  const out: PublishedGlobal[] = []
  for (const { sig, record } of raw) {
    const p = record.payload
    if (!p || typeof p !== 'object') continue
    const path = Array.isArray(p['path'])
      ? p['path'].map(s => String(s ?? '').trim()).filter(Boolean)
      : (typeof p['id'] === 'string' && p['id'] ? ['games', p['id']] : [])
    if (path.length === 0) continue
    out.push({
      sig,
      path,
      label: typeof p['label'] === 'string' && p['label'] ? p['label'] : path[path.length - 1],
      icon: typeof p['icon'] === 'string' && p['icon'] ? p['icon'] : 'sports_esports',
    })
  }
  return out
}

async function writeNode(node: { path: readonly string[]; label: string; icon: string }): Promise<string> {
  const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
  const commit = committer()
  if (!store?.putResource || !commit) {
    throw new Error('[global-features] Store / LayerCommitter not available')
  }
  const record = {
    kind: GLOBAL_FEATURE_KIND,
    appliesTo: [],
    payload: { path: [...node.path], label: node.label, icon: node.icon },
  }
  const sig = await store.putResource(new Blob([JSON.stringify(record)], { type: 'application/json' }))
  await commit.commitSlotAppend([], DECORATIONS_SLOT, sig)
  return sig
}

async function removeNode(sig: string): Promise<void> {
  const commit = committer()
  if (!commit) throw new Error('[global-features] LayerCommitter not available')
  await commit.commitSlotRemove([], DECORATIONS_SLOT, sig)
}

/** Find a node (and implicitly its subtree) in a tree by path. */
function findNode(nodes: readonly GlobalNode[], path: readonly string[]): GlobalNode | undefined {
  for (const n of nodes) {
    if (samePath(n.path, path)) return n
    if (isUnder(path, n.path)) return findNode(n.children, path)
  }
  return undefined
}

function selfAndDescendants(node: GlobalNode): GlobalNode[] {
  return [node, ...node.children.flatMap(selfAndDescendants)]
}

/** Flip the PUBLIC state of the node at `path` — hierarchically.
 *
 *  ON: publish the node, everything under it, AND its ancestors (a leaf's
 *  folder is its dependency — publishing `games/arkanoid` implies `games`).
 *  OFF: withdraw the node and everything under it, then prune any ancestor
 *  folder left with nothing inside (a childless folder mark is meaningless).
 *  Idempotent both ways; every write awaits its root commit. */
export async function setGlobalPublic(path: readonly string[], on: boolean): Promise<void> {
  if (path.length === 0) return
  const published = await publishedGlobals()

  if (on) {
    const tree = localGlobalTree()
    const target = findNode(tree, path)
    // Ancestors first (parents are the dependencies), then the subtree. A
    // published-but-not-local node (module gone) republishes nothing new.
    const want: { path: readonly string[]; label: string; icon: string }[] = []
    for (let depth = 1; depth < path.length; depth++) {
      const anc = findNode(tree, path.slice(0, depth))
      if (anc) want.push(anc)
    }
    if (target) want.push(...selfAndDescendants(target))
    for (const node of want) {
      if (!published.some(p => samePath(p.path, node.path))) await writeNode(node)
    }
    return
  }

  const doomed = published.filter(p => samePath(p.path, path) || isUnder(p.path, path))
  for (const d of doomed) await removeNode(d.sig)
  let remaining = published.filter(p => !doomed.includes(p))
  for (let depth = path.length - 1; depth >= 1; depth--) {
    const anc = path.slice(0, depth)
    if (remaining.some(p => isUnder(p.path, anc))) break   // still inhabited
    const folder = remaining.find(p => samePath(p.path, anc))
    if (!folder) continue
    await removeNode(folder.sig)
    remaining = remaining.filter(p => p !== folder)
  }
}
