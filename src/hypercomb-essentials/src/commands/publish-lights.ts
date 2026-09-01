// hypercomb-essentials/src/commands/publish-lights.ts
//
// THE LIGHTS A PUBLICATION CARRIES — one record, one meaning: "these are the
// behaviours this creation was dressed in when it was published."
//
// It is a DECORATION on the branch root, exactly like `view:default`, and for
// the same reason: the lights are a fact about the PLACE, not a preference of
// whoever is looking. So they are undoable, they ride the layer commit to the
// root, they are sealed into the published closure, and they arrive verified
// with the tree rather than as a side-channel the worker would have to be
// taught about. Nothing in the signed index changes; nothing new is fetched.
//
// WHY IT EXISTS. A visitor's browser is a brand-new install with no roster
// and no history, so the opt-in model has nothing to opt in FROM. Left to
// itself it either sees nothing (the dark seed — every published site
// rendered as shaded hexagons with default art) or sees everything the module
// graph happened to bring, which is not what the publisher arranged either.
// The honest answer is the third one: show what the publisher lit.
//
// MUTUAL EXCLUSIVITY IS STRUCTURAL: the writer is `replaceDecoration`, which
// drops every prior record of the kind before appending. A branch carries one
// set of lights or none.
//
// The kind is `publish:lights`, deliberately NOT `visual:*`: show-features
// mints a "foreign behaviour" row for any unrecognized `visual:` kind, and
// this mark is not a behaviour — it is a note about which ones were on.

import {
  listDecorations,
  removeDecorationAndWait,
  replaceDecoration,
} from './decoration-manifest.js'
import { normalizeViewToken } from './decoration-kind-index.js'
import { WEBSITE_SLOT } from './website-slot.js'
import { WEBSITE_PAGE_KIND } from './website-binding.js'

/** The decoration kind. Read asynchronously on arrival only, so it does not
 *  need a synchronous index the way `view:default` does. */
export const PUBLISH_LIGHTS_DECORATION_KIND = 'publish:lights'

interface PublishLightsPayload {
  /** The decoration kinds whose global light was ON at publish time. */
  kinds?: string[]
}

const clean = (kinds: readonly string[]): string[] =>
  [...new Set(kinds.map(k => String(k ?? '').trim()).filter(Boolean))].sort()

/** The lights this branch was published with, or `null` when it carries no
 *  mark at all. An EMPTY array is a real answer — "the publisher lit nothing"
 *  — and must not be confused with "this publication predates the mark",
 *  which is what `null` says. */
export async function publishLightsAt(
  segments: readonly string[],
): Promise<string[] | null> {
  try {
    const records = await listDecorations<PublishLightsPayload>({
      kind: PUBLISH_LIGHTS_DECORATION_KIND,
      segments: [...segments],
    })
    for (const record of records) {
      const kinds = record.record?.payload?.kinds
      if (Array.isArray(kinds)) return clean(kinds)
    }
  } catch { /* cold read — the caller treats a miss as "no mark" */ }
  return null
}

/** THE CASCADE, cold side: the lights covering this location — its own mark,
 *  else the nearest ancestor's, walked one prefix at a time down to the root.
 *  A visitor lands on a nested lineage whose mark sits at the published
 *  branch root, so the walk is what makes a nested publication work. */
export async function publishLightsWithinAt(
  segments: readonly string[],
): Promise<string[] | null> {
  for (let d = segments.length; d >= 0; d--) {
    const lights = await publishLightsAt(segments.slice(0, d))
    if (lights) return lights
  }
  return null
}

// ── The dressing census ──────────────────────────────────────────────────────
//
// "The behaviours this creation was dressed in" is a fact about the BRANCH,
// not about the publisher's whole roster. A legacy hive's census seed lit
// every kind the module graph knows, so stamping the raw on-list dressed
// every publication in ~everything — and every visitor's Beehaviors list
// arrived fully lit ("sites turning them all on"). The census walks the
// branch and answers which kinds it actually WEARS; the publish routine
// stamps the intersection of that with the publisher's lights.

const SIG_RE = /^[0-9a-f]{64}$/
/** Depth guard — matches the website sweep's. */
const MAX_DEPTH = 24
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const STORE_KEY = '@hypercomb.social/Store'
const VISUAL_BEE_REGISTRY_KEY = '@diamondcoreprocessor.com/VisualBeeRegistry'
const DEFAULT_VIEW_KIND = 'view:default'

type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<{ name?: unknown } | null>
}
type StoreLike = { getResource(sig: string): Promise<{ text(): Promise<string> } | null> }
type RegistryLike = { all?(): readonly { view: string; decorationKind: string; slot?: string }[] }

const iocGet = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const slotWorn = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(s => SIG_RE.test(String(s ?? '')))
    : typeof value === 'string' && SIG_RE.test(value)

/** Every decoration kind the branch at `segments` WEARS — its own layer and
 *  every descendant's: decoration records, slot-backed bees (a first-class
 *  slot is how tutor decks and website pages ride), and the kind behind each
 *  `view:default` mark (a pinned view must be able to mount even when no
 *  tile in the branch carries its record — publications derives its plates).
 *  `null` when the branch cannot be read at all, so the caller can fall back
 *  rather than stamp an empty dressing over a live creation. */
export async function wornKindsWithin(
  segments: readonly string[],
): Promise<ReadonlySet<string> | null> {
  const history = iocGet<HistoryLike>(HISTORY_KEY)
  const store = iocGet<StoreLike>(STORE_KEY)
  if (!history?.sign || !history.currentLayerAt || !store?.getResource) return null
  const bees = iocGet<RegistryLike>(VISUAL_BEE_REGISTRY_KEY)?.all?.() ?? []
  const kindByView = new Map(bees.map(b => [b.view, b.decorationKind]))
  const slotted = bees.filter(b => b.slot)

  const worn = new Set<string>()
  const visited = new Set<string>()
  let layersRead = 0

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

  const collect = async (layer: Record<string, unknown>): Promise<void> => {
    for (const bee of slotted) {
      if (slotWorn(layer[bee.slot as string])) worn.add(bee.decorationKind)
    }
    // The website bee declares no slot of its own — same special as
    // show-features' scope-root probe and website-binding's layerHasWebsite.
    if (slotWorn(layer[WEBSITE_SLOT])) worn.add(WEBSITE_PAGE_KIND)
    const decos = Array.isArray(layer['decorations']) ? layer['decorations'] : []
    for (const entry of decos) {
      const sig = String(entry ?? '')
      if (!SIG_RE.test(sig)) continue
      const blob = await store.getResource(sig).catch(() => null)
      if (!blob) continue
      try {
        const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: { view?: unknown } }
        if (typeof rec?.kind !== 'string' || !rec.kind) continue
        worn.add(rec.kind)
        if (rec.kind === DEFAULT_VIEW_KIND) {
          const view = normalizeViewToken(String(rec.payload?.view ?? '').trim())
          const kind = kindByView.get(view)
          if (kind) worn.add(kind)
        }
      } catch { /* malformed record — skip */ }
    }
  }

  const walk = async (segs: string[], depth: number): Promise<void> => {
    if (depth < 0) return
    const pathKey = segs.join('/')
    if (visited.has(pathKey)) return
    visited.add(pathKey)
    const locSig = await history.sign({ explorerSegments: () => segs }).catch(() => null)
    if (!locSig) return
    const layer = await history.currentLayerAt(locSig).catch(() => null)
    if (!layer) return
    layersRead++
    await collect(layer)
    for (const name of await childNames(layer)) await walk([...segs, name], depth - 1)
  }

  await walk([...segments], MAX_DEPTH)
  return layersRead > 0 ? worn : null
}

/** Stamp this branch with the lights it is being published under. Replaces
 *  any prior stamp here.
 *
 *  This CHANGES THE HEAD, which is why the publish routine writes it before
 *  it seals rather than after: the mark has to be inside the closure it
 *  describes, or the visitor would be handed a tree that does not contain its
 *  own dressing. */
export function writePublishLights(
  segments: readonly string[],
  kinds: readonly string[],
): Promise<string> {
  return replaceDecoration<PublishLightsPayload>({
    kind: PUBLISH_LIGHTS_DECORATION_KIND,
    appliesTo: [...segments],
    segments: [...segments],
    payload: { kinds: clean(kinds) },
    mark: 'persistent',
  })
}

/** Drop this branch's stamp — it publishes without carrying its lights.
 *  Awaited to the root so a re-read sees it gone. */
export async function clearPublishLights(segments: readonly string[]): Promise<boolean> {
  const records = await listDecorations<PublishLightsPayload>({
    kind: PUBLISH_LIGHTS_DECORATION_KIND,
    segments: [...segments],
  })
  if (records.length === 0) return false
  for (const record of records) {
    await removeDecorationAndWait({ sig: record.sig, segments: [...segments] })
  }
  return true
}
