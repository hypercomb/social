// commands/trait-read.ts
//
// Reading traits: what a tile wears, what fills it, where the participant stands. Shared by the `trait`
// and `fill` words (documentation/traits.md). No writes here; the queens commit.

import { EffectBus, levelRoster, type RosterHistory, type RosterStore } from '@hypercomb/core'
import { listDecorations } from './decoration-manifest.js'
import {
  TRAIT_FILL_KIND, TRAIT_WANT_KIND, isSig, resolveTrait, sameWord, traitWords,
  type TraitCandidate, type TraitFill, type TraitWant, type TraitResolution,
} from './trait.js'

type LineageLike = { explorerSegments?: () => readonly string[] }
type HistoryLike = RosterHistory & {
  headLayer?: (locationSig: string) => Promise<{ layerSig?: string } | null>
}
type SearchLike = {
  search?: (query: string, reach: 'hive', limit?: number) =>
    Promise<{ hits: readonly { sig: string; name: string; path: readonly string[] }[] }>
}

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

/** Every tile in this hive named the word, except the tile itself. */
async function hiveOffers(word: string, own: string): Promise<TraitCandidate[]> {
  const search = window.ioc.get<SearchLike>('@diamondcoreprocessor.com/HiveSearchService')
  if (!search?.search) return []
  try {
    const answer = await search.search(word, 'hive', 60)
    return answer.hits
      .filter(hit => sameWord(hit.name, word) && hit.sig !== own)
      .map(hit => ({ sig: hit.sig, route: [...hit.path] }))
  } catch { return [] }
}

/** Resolve every trait a tile wears, in the order it opened them. */
export async function resolveTraitsAt(segments: readonly string[]): Promise<TraitResolution[]> {
  const words = traitWords((await traitWantsAt(segments)).map(p => p.record.payload))
  if (words.length === 0) return []
  const fills = (await traitFillsAt(segments)).map(f => f.record.payload)
  const h = history(); const s = store()
  const children = h && s ? await levelRoster(segments, h, s).catch(() => []) : []
  const own = await headAt(segments)
  const out: TraitResolution[] = []
  for (const word of words) {
    const quick = resolveTrait(word, { fills, children, hive: [] })
    out.push(quick.rung === 'miss' ? resolveTrait(word, { fills, children, hive: await hiveOffers(word, own) }) : quick)
  }
  return out
}
