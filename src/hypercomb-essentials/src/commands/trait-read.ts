// commands/trait-read.ts
//
// Reading traits: what a tile has, what fills it, where the participant stands (documentation/traits.md).
// Shared by the `trait` and `fill` words, the silhouettes and the trait provider. No writes, no state,
// no registration: several bees import this, and each may carry its own copy. The `trait` word is the
// bee that registers the provider below under core's TRAITS_IOC_KEY.
//
// A tile's traits are the ones DECLARED by the view it opens as (its descriptor in the visual-bee
// registry) followed by the ones OPENED on it (`trait:want`). The rules are core's (core/trait.ts).

import {
  EffectBus, TRAIT_FILL_KIND, TRAIT_WANT_KIND, levelRoster, mergeTraits, resolveTrait, sameTraitWord, traitFiller, traitSpecs,
  type RosterHistory, type RosterStore, type TraitCandidate, type TraitDeclaration, type TraitFill,
  type TraitProvider, type TraitResolution, type TraitSpec, type TraitWant,
} from '@hypercomb/core'
import { listDecorations } from './decoration-manifest.js'
import { HEXAGONS_SURFACE, defaultViewWithinSegments, normalizeViewToken } from './decoration-kind-index.js'

type LineageLike = { explorerSegments?: () => readonly string[] }
type HistoryLike = RosterHistory & {
  headLayer?: (locationSig: string) => Promise<{ layerSig?: string } | null>
}
type SearchLike = {
  search?: (query: string, reach: 'hive', limit?: number) =>
    Promise<{ hits: readonly { sig: string; name: string; path: readonly string[] }[] }>
}
type RegistryLike = { get?: (view: string) => { traits?: readonly TraitDeclaration[] } | undefined }

const SIG = /^[0-9a-f]{64}$/
export const isSig = (v: unknown): v is string => typeof v === 'string' && SIG.test(v)

const history = (): HistoryLike | undefined => window.ioc.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
const store = (): RosterStore | undefined => window.ioc.get<RosterStore>('@hypercomb.social/Store')

export const say = (message: string, type: 'info' | 'error' = 'info'): void => {
  EffectBus.emit('activity:log', { message, icon: '⬡' })
  EffectBus.emit('toast:show', { type, message })
}

/** Where the participant stands, as segments. */
export const standing = (): string[] =>
  (window.ioc.get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
    .map(s => String(s ?? '').trim()).filter(Boolean)

/** The head layer signature at a route, or '' when nothing is there. */
export async function headAt(segments: readonly string[]): Promise<string> {
  const h = history()
  if (!h?.headLayer) return ''
  try {
    const loc = await h.sign({ explorerSegments: () => [...segments] })
    const sig = (await h.headLayer(loc))?.layerSig ?? ''
    return isSig(sig) ? sig : ''
  } catch { return '' }
}

export async function traitWantsAt(segments: readonly string[]) {
  return listDecorations<TraitWant>({ kind: TRAIT_WANT_KIND, segments })
}

export async function traitFillsAt(segments: readonly string[]) {
  return listDecorations<TraitFill>({ kind: TRAIT_FILL_KIND, segments })
}

/** The traits a view declares, by its token. Plain hexagons and an unknown token declare none. */
export function declaredByView(view: string): TraitSpec[] {
  const token = normalizeViewToken(String(view ?? '').trim())
  if (!token || token === HEXAGONS_SURFACE) return []
  const registry = window.ioc.get<RegistryLike>('@diamondcoreprocessor.com/VisualBeeRegistry')
  return traitSpecs(registry?.get?.(token)?.traits)
}

/** The traits the view a tile opens as declares (its own mark, else the nearest ancestor's). Read
 *  from the warm decoration index: synchronous, no storage. */
export const declaredAt = (segments: readonly string[]): TraitSpec[] =>
  declaredByView(defaultViewWithinSegments(segments))

/** The names of a tile's children, in roster order. */
export async function childNamesAt(segments: readonly string[]): Promise<string[]> {
  const h = history(); const s = store()
  if (!h || !s) return []
  try { return (await levelRoster(segments, h, s)).map(row => row.name) } catch { return [] }
}

/**
 * Every trait a tile has: declared by its view, then given to it. A trait is a requirement some
 * tiles have, an interface (jwize, 2026-10-13: "they are known as traits because they are an
 * interface … they aren't tiles … a requirement of some tiles"). An ordinary child is just a tile;
 * it fills a trait only when its layer has one by its name.
 */
export async function traitsAt(segments: readonly string[]): Promise<TraitSpec[]> {
  const opened = (await traitWantsAt(segments)).map(w => w.record.payload)
  return mergeTraits(declaredAt(segments), opened)
}

/** Every tile in this hive named the word, except the tile itself. */
async function hiveOffers(word: string, own: string): Promise<TraitCandidate[]> {
  const search = window.ioc.get<SearchLike>('@diamondcoreprocessor.com/HiveSearchService')
  if (!search?.search) return []
  try {
    const answer = await search.search(word, 'hive', 60)
    return answer.hits
      .filter(hit => sameTraitWord(hit.name, word) && hit.sig !== own)
      .map(hit => ({ sig: hit.sig, route: [...hit.path] }))
  } catch { return [] }
}

/**
 * Resolve every trait a tile has, in order. The hive is searched only where it can change the
 * answer: for a trait with no own version, and for the offers on one that has its own version when
 * `offers` is asked for (the `trait` word lists them; a view asking for its filler does not).
 */
export async function resolveTraitsAt(segments: readonly string[], opts: { offers?: boolean } = {}): Promise<TraitResolution[]> {
  const specs = await traitsAt(segments)
  if (specs.length === 0) return []
  const fills = (await traitFillsAt(segments)).map(f => f.record.payload)
  const h = history(); const s = store()
  const children = h && s ? await levelRoster(segments, h, s).catch(() => []) : []
  let own: string | null = null
  const out: TraitResolution[] = []
  for (const spec of specs) {
    const quick = resolveTrait(spec, { fills, children, hive: [] })
    const searchable = quick.rung === 'miss' || (quick.rung === 'own' && opts.offers === true)
    if (!searchable) { out.push(quick); continue }
    if (own === null) own = await headAt(segments)
    out.push(resolveTrait(spec, { fills, children, hive: await hiveOffers(spec.word, own) }))
  }
  return out
}

/**
 * THE TRAIT PROVIDER — what any behaviour or view asks about traits, under core's TRAITS_IOC_KEY.
 * A view reaches it through IoC and needs nothing but core:
 *
 *   const traits = window.ioc.get<TraitProvider>(TRAITS_IOC_KEY)
 *   const sig = await traits?.fillerAt(segments, 'portrait')   // null → use your own version
 *
 * It holds no state; every answer is read from the tile and the registry.
 */
export class TraitService implements TraitProvider {
  declaredByView(view: string): readonly TraitSpec[] { return declaredByView(view) }
  traitsAt(segments: readonly string[]): Promise<readonly TraitSpec[]> { return traitsAt(segments) }
  resolveAt(segments: readonly string[]): Promise<readonly TraitResolution[]> { return resolveTraitsAt(segments) }
  async fillerAt(segments: readonly string[], word: string): Promise<string | null> {
    const r = (await resolveTraitsAt(segments)).find(x => sameTraitWord(x.word, word))
    return r ? traitFiller(r) : null
  }
}

/** Create the child tile by that name in the layer the participant stands in, through the shell's own
 *  create commit (the one `create <name>` runs). Resolves true once it has committed, false when no
 *  command line is there to take it. */
export function createTile(name: string): Promise<boolean> {
  let accepted = false
  let finish!: (ok: boolean) => void
  const done = new Promise<boolean>(resolve => { finish = resolve })
  EffectBus.emitTransient('command:create-cells', {
    name,
    accept: () => { accepted = true },
    complete: (error?: unknown) => finish(error === undefined),
  })
  return accepted ? done : Promise.resolve(false)
}
