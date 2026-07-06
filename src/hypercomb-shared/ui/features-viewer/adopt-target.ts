// hypercomb-shared/ui/features-viewer/adopt-target.ts
//
// Autocomplete for the features panel's "adopt to" field — the destination a
// peer branch folds under. SwarmAdoptDrone REFUSES a target that doesn't
// resolve ("create it first" — refuse, don't guess, so a typo can't conjure a
// phantom hierarchy). This helper turns that dead-end into a choice: complete
// against locations that DO exist, or CREATE the typed path so the adopt lands.
//
// Two module services, reached through IoC (this is shell UI — it must not
// import essentials):
//   • HistoryService — resolve the layer AT an absolute path and read its
//     child names. Resolution MIRRORS essentials' resolveLayerAt exactly
//     (own-bag read, then a parent-chain fallback for a location whose own bag
//     is cold), so the match/create decision agrees with the drone's own
//     existence check — never "match" for something the drone then rejects.
//   • LayerCommitter — mint a missing path via one atomic importTree cascade,
//     the same primitive plain cell creation uses (one marker per level;
//     already-present levels dedup to no-ops on identical bytes).
//
// `sign` derives the bag identity purely from the joined path segments (domain
// is discarded), so — like CellSuggestionProvider — we omit domain and still
// address the exact bag the drone validates against.

import { EffectBus, hypercomb } from '@hypercomb/core'

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'

/** How many existing matches to surface before the create row (a runaway
 *  parent with hundreds of children shouldn't fill the panel). */
const MAX_MATCHES = 8

type LayerLike = { name?: string; children?: readonly string[]; [slot: string]: unknown }

type HistoryLike = {
  sign: (lineage: { explorerSegments: () => readonly string[] }) => Promise<string>
  currentLayerAt: (locationSig: string) => Promise<LayerLike | null>
  getLayerBySig: (sig: string) => Promise<LayerLike | null>
}

type TreeUpdate = { segments: readonly string[]; layer: { name?: string; [slot: string]: unknown } }
type CommitterLike = {
  importTree?: (updates: TreeUpdate[]) => Promise<void>
}

/** One row of the dropdown: an existing child (`match`) or the typed path that
 *  doesn't exist yet (`create`). Both carry the absolute path they resolve to
 *  and its segments so picking one is a straight set / create-then-set. */
export interface AdoptTargetSuggestion {
  kind: 'match' | 'create'
  /** Leaf display name — the existing child, or the fragment being typed. */
  name: string
  /** Absolute display path this suggestion sets the field to ("/a/b/name"). */
  path: string
  /** Absolute parent+leaf segments (what `create` mints). */
  segments: string[]
}

/** Split a raw field value into the parent path and the (possibly-empty) leaf
 *  fragment being typed after the last '/'.  "/a/b/pre" → { parent:[a,b],
 *  fragment:'pre' };  "/a/b/" → { parent:[a,b], fragment:'' };  "/" or "" →
 *  { parent:[], fragment:'' }. */
export function parseAdoptTarget(raw: string): { parentSegments: string[]; fragment: string } {
  const parts = String(raw ?? '').split('/')
  const fragment = (parts[parts.length - 1] ?? '').trim()
  const parentSegments = parts.slice(0, -1).map(s => s.trim()).filter(Boolean)
  return { parentSegments, fragment }
}

/** Format absolute segments as a display path ('/' = the hive root). */
function toPath(segments: readonly string[]): string {
  return '/' + segments.join('/')
}

/** Resolve the layer AT an absolute path, robustly — mirrors essentials'
 *  resolveLayerAt. The own-bag read (currentLayerAt) is authoritative when
 *  warm; a location that exists only as a child sig in its parent (never
 *  committed into, or cold after a reload) falls back to the parent chain. */
async function resolveLayerAt(history: HistoryLike, segments: readonly string[]): Promise<LayerLike | null> {
  const locSig = await history.sign({ explorerSegments: () => segments })
  const direct = await history.currentLayerAt(locSig)
  if (direct) return direct
  if (segments.length === 0) return null
  const parent = await resolveLayerAt(history, segments.slice(0, -1))
  const childSigs = Array.isArray(parent?.children) ? parent!.children : []
  const leaf = segments[segments.length - 1]
  for (const sig of childSigs) {
    const child = await history.getLayerBySig(String(sig))
    if (child && child.name === leaf) return child
  }
  return null
}

/** Child display names of the layer at an absolute path, sorted. Empty when
 *  the path doesn't resolve or has no children — the field can still be typed
 *  and the create row still offered. */
export async function listAdoptTargetChildren(segments: readonly string[]): Promise<string[]> {
  const history = get<HistoryLike>(HISTORY_KEY)
  if (!history) return []
  const layer = await resolveLayerAt(history, segments)
  const childSigs = Array.isArray(layer?.children) ? layer!.children : []
  const names: string[] = []
  for (const sig of childSigs) {
    const child = await history.getLayerBySig(String(sig))
    if (child?.name) names.push(String(child.name))
  }
  names.sort((a, b) => a.localeCompare(b))
  return names
}

/** Build the dropdown rows for a raw field value: existing children of the
 *  typed parent whose name prefixes the fragment (capped), plus a `create` row
 *  when the fragment names something that doesn't already exist. */
export async function adoptTargetSuggestions(raw: string): Promise<AdoptTargetSuggestion[]> {
  const { parentSegments, fragment } = parseAdoptTarget(raw)
  const names = await listAdoptTargetChildren(parentSegments)
  const frag = fragment.toLowerCase()

  const out: AdoptTargetSuggestion[] = []
  for (const name of names) {
    if (frag && !name.toLowerCase().startsWith(frag)) continue
    const segments = [...parentSegments, name]
    out.push({ kind: 'match', name, path: toPath(segments), segments })
    if (out.length >= MAX_MATCHES) break
  }

  // Offer create only for a non-empty fragment that isn't already a child —
  // an exact hit needs no create row (the path is valid as typed).
  const exact = frag.length > 0 && names.some(n => n.toLowerCase() === frag)
  if (frag.length > 0 && !exact) {
    const segments = [...parentSegments, fragment]
    out.push({ kind: 'create', name: fragment, path: toPath(segments), segments })
  }
  return out
}

/** Mint an absolute path so an adopt can land there — one importTree cascade,
 *  a marker per level (existing levels dedup to no-ops). Emits cell:added per
 *  level (viaUpdate: true, so the committer's per-event listener skips it — the
 *  importTree IS the commit) and pulses the processor to synchronize the view.
 *  Returns false when the committer is unavailable or the path is empty. */
export async function createAdoptTargetPath(segments: readonly string[]): Promise<boolean> {
  const clean = segments.map(s => String(s ?? '').trim()).filter(Boolean)
  if (clean.length === 0) return false
  const committer = get<CommitterLike>(COMMITTER_KEY)
  if (!committer?.importTree) return false

  const updates: TreeUpdate[] = []
  const acc: string[] = []
  for (const part of clean) {
    EffectBus.emit('cell:added', { cell: part, segments: acc.slice(), viaUpdate: true })
    updates.push({ segments: [...acc, part], layer: { name: part } })
    acc.push(part)
  }
  await committer.importTree(updates)
  void new hypercomb().act()
  return true
}
