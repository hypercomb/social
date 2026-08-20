// diamondcoreprocessor.com/commands/website-binding.ts
//
// WEBSITES BELONG TO A TILE (Jaime, 2026-08-20). A website divorced from
// its tile is just a row in the Behaviors panel — no meaning. Every website
// therefore follows the behaviour-binding protocol (behavior-binding.md):
// the site's ROOT tile is what the website belongs to, recorded as a binding
// of `visual:website:page` to that root's LOCATION signature. The
// consequences are the binding's own, nothing website-specific:
//
//   - the website row SHOWS anywhere within the bound branch and is
//     withdrawn everywhere else (bindingAt / isWithdrawnByBinding);
//   - acting on it acts at THAT parent — the tile it belongs to — never at
//     wherever the participant happens to be standing (the panel routes the
//     website row's control to its scope root);
//   - sharing needs no extra carrier: the attachment is DERIVED from where
//     the pages live (a page decoration or a first-class `website` slot), so
//     an adopted or received website re-attaches on the receiving side from
//     content alone. The binding record itself is a participant-local lens
//     and never travels.
//
// FIRST-BINDING SWEEP. The binding model withdraws a bound kind everywhere
// outside its bindings — so the FIRST website bound would silently withdraw
// every OTHER site until each happened to be visited. Before the first
// binding lands, one full-tree sweep binds every existing site root
// together; after that, each newly discovered root simply joins the list.
// (Same reason the pool registry is seeded with a census: a partial list of
// an untagged union is worse than none.)

import { bindingsFor, bindBehaviorTo, behaviorPath } from '../sharing/behavior-enablement.js'
import { WEBSITE_SLOT } from './website-slot.js'

export const WEBSITE_PAGE_KIND = 'visual:website:page'

const SIG_RE = /^[0-9a-f]{64}$/
/** Depth guard for the sweep walk — matches the build queue's. */
const MAX_DEPTH = 24
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const STORE_KEY = '@hypercomb.social/Store'

type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<{ name?: unknown } | null>
}
type StoreLike = { getResource(sig: string): Promise<Blob | null> }

const get = <T>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** Does this layer carry the website feature — a non-empty first-class
 *  `website` slot, or a `visual:website:page` decoration? Same predicate as
 *  show-features' scope-root probe. */
async function layerHasWebsite(layer: Record<string, unknown>, store: StoreLike): Promise<boolean> {
  const slot = layer[WEBSITE_SLOT]
  if (Array.isArray(slot) && slot.some(s => SIG_RE.test(String(s ?? '')))) return true
  const decos = Array.isArray(layer['decorations']) ? layer['decorations'] : []
  for (const entry of decos) {
    const sig = String(entry ?? '')
    if (!SIG_RE.test(sig)) continue
    const blob = await store.getResource(sig).catch(() => null)
    if (!blob) continue
    try {
      const rec = JSON.parse(await blob.text()) as { kind?: string }
      if (rec?.kind === WEBSITE_PAGE_KIND) return true
    } catch { /* malformed — skip */ }
  }
  return false
}

/** Every OUTERMOST site root in the tree — a tile carrying the website
 *  feature whose ancestors carry none. Descent stops at a root: pages
 *  beneath it are part of that site, never sites of their own. */
async function sweepSiteRoots(history: HistoryLike, store: StoreLike): Promise<string[][]> {
  const roots: string[][] = []
  const visited = new Set<string>()

  const childNames = async (layer: Record<string, unknown>): Promise<string[]> => {
    const children = Array.isArray(layer['children']) ? layer['children'] : []
    const names: string[] = []
    for (const entry of children) {
      const s = String(entry ?? '').trim()
      if (!s) continue
      if (SIG_RE.test(s)) {
        const child = await history.getLayerBySig(s).catch(() => null)
        const n = child?.name
        if (typeof n === 'string' && n) names.push(n)
      } else {
        names.push(s)
      }
    }
    return names
  }

  const walk = async (segments: string[], depth: number): Promise<void> => {
    if (depth < 0) return
    const pathKey = segments.join('/')
    if (visited.has(pathKey)) return
    visited.add(pathKey)
    const locSig = await history.sign({ explorerSegments: () => segments }).catch(() => null)
    if (!locSig) return
    const layer = await history.currentLayerAt(locSig).catch(() => null)
    if (!layer) return
    if (segments.length > 0 && await layerHasWebsite(layer, store)) {
      roots.push([...segments])
      return   // the subtree is this site's — no nested roots
    }
    for (const name of await childNames(layer)) await walk([...segments, name], depth - 1)
  }

  await walk([], MAX_DEPTH)
  return roots
}

async function bindRoot(history: HistoryLike, segments: readonly string[]): Promise<void> {
  const path = behaviorPath(segments)
  if (bindingsFor(WEBSITE_PAGE_KIND).some(b => b.path === path)) return
  const sig = await history.sign({ explorerSegments: () => [...segments] }).catch(() => null)
  if (!sig) return
  bindBehaviorTo(WEBSITE_PAGE_KIND, {
    sig,
    path,
    name: segments[segments.length - 1] ?? '/',
  })
}

/** Serialized so a burst of discoveries (panel open + build pass + adopt)
 *  runs one sweep, not three. */
let chain: Promise<void> = Promise.resolve()
let sweptThisSession = false

/** Attach the website at `rootSegments` to its tile: ensure a binding of
 *  the website kind to that root's location. Idempotent and cheap when the
 *  attachment already exists; the first attachment of a session that finds
 *  NO bindings at all runs the full-tree sweep first, so every existing
 *  site binds together and none is silently withdrawn. Fire-and-forget
 *  from discovery paths — never load-bearing (a cold client re-derives
 *  everything from the layers). */
export function ensureWebsiteBoundAt(rootSegments: readonly string[]): Promise<void> {
  const segments = rootSegments.map(s => String(s ?? '').trim()).filter(Boolean)
  if (segments.length === 0) return chain   // the hive root is not a site root
  chain = chain.then(async () => {
    const path = behaviorPath(segments)
    if (bindingsFor(WEBSITE_PAGE_KIND).some(b => b.path === path)) return
    const history = get<HistoryLike>(HISTORY_KEY)
    const store = get<StoreLike>(STORE_KEY)
    if (!history?.sign) return
    if (!sweptThisSession && bindingsFor(WEBSITE_PAGE_KIND).length === 0 && store?.getResource) {
      sweptThisSession = true
      const roots = await sweepSiteRoots(history, store).catch(() => [] as string[][])
      for (const root of roots) await bindRoot(history, root)
    }
    await bindRoot(history, segments)
  }).catch(() => undefined)
  return chain
}

/** Test seam — resets the once-per-session sweep guard. */
export function _resetWebsiteBindingSweep(): void {
  sweptThisSession = false
  chain = Promise.resolve()
}
