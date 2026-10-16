// assistant/find.queen.ts
//
// `find` — which tiles carry a word in their name. The chat's models always
// had it as a read (`find betz /`); a participant, and a session speaking for
// one, had only a private bridge op (`hive-find`, 2026-10-15) — retired for
// this word the same day: "retire the bridge and fix the dialect whenever we
// reach for the bridge".
//
//   find betz          on this page and under it
//   find betz /        the whole hive
//   find betz /dolphin under a route
//
// It says what it found AND how the walk went — how many tiles it opened, in
// how long, and why it stopped short when it did — because a find that
// stopped early and a find that saw everything look the same otherwise, and
// the difference is the whole answer to "are there any others?".

import { QueenBee, EffectBus, type MachineGrammar } from '@hypercomb/core'
import { HIVE_TREE_READER_IOC_KEY, type HypercombFindRead } from './hive-tree-reader.js'

type LineageLike = { explorerSegments?: () => readonly string[] }
type ReaderLike = { find?: (query: string, segments: readonly string[], options?: { maxNodes?: number }) => Promise<HypercombFindRead> }

const get = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

/** The word and the route `find <args>` asks about, from where you stand. Pure. */
export const findArgs = (here: readonly string[], raw: string): { word: string; segments: string[] } | null => {
  const text = raw.trim()
  const at = text.search(/\s\/|^\//)
  const word = (at < 0 ? text : text.slice(0, at)).trim()
  if (!word || word.includes('/')) return null
  if (at < 0) return { word, segments: [...here] }
  return { word, segments: text.slice(at).trim().split('/').map(s => s.trim()).filter(Boolean) }
}

const STOPPED: Record<string, string> = {
  time: 'its time ran out',
  nodes: 'it reached its tile limit',
  bytes: 'it reached its size limit',
  depth: 'it reached its depth limit',
  pages: 'some pages could not be opened whole',
}

/** What `find` says, as lines. Pure. */
export const findLines = (word: string, route: string, found: HypercombFindRead, ms: number): string[] => {
  if (!found.ok) return [`Find "${word}" under ${route}: the search failed (${found.code})`]
  const seconds = ms < 1_000 ? `${(ms / 1_000).toFixed(1)} s` : `${Math.round(ms / 1_000)} s`
  const names = found.matches.map(match => match.path)
  const lines = [names.length
    ? `Find "${word}" under ${route}: ${names.length}${found.moreMatches ? '+' : ''} tile${names.length === 1 ? '' : 's'} — ${names.join(', ')}`
    : `Find "${word}" under ${route}: no tile's name holds it`]
  if (found.walkFailed) {
    lines.push(`  The walk failed (${found.walkFailed}); what is shown came from the search index and was checked live — there may be others.`)
  } else if (!found.truncated) {
    lines.push(`  Walked every tile under ${route}: ${(found.walked ?? 0).toLocaleString('en')} in ${seconds}.`)
  } else {
    const why = found.stoppedBy ? STOPPED[found.stoppedBy] ?? found.stoppedBy : 'it stopped early'
    const open = found.unfinished ?? []
    const more = (found.unfinishedCount ?? open.length) - open.length
    lines.push(`  Walked ${(found.walked ?? 0).toLocaleString('en')} tiles in ${seconds} and stopped — ${why}; there may be others`
      + (open.length ? ` under ${open.join(', ')}${more > 0 ? ` and ${more} more` : ''}` : '') + '.')
  }
  if (found.moreMatches) lines.push('  More tiles hold it than are listed; narrow the word or the route.')
  return lines
}

export class FindQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'find'
  override description = 'Find tiles whose name holds a word: here and below, / for the whole hive, or /<route>'
  override descriptionKey = 'slash.find'
  override options = ['<word>', '<word> /', '<word> /<route>']
  override examples = [
    { input: '/find betz /', result: 'Every tile in the hive whose name holds "betz", and whether the walk saw them all' },
  ]
  override rawArgs = true
  override machine: MachineGrammar = {
    forms: 'find <word> | find <word> / | find <word> /<route>',
    example: 'find betz /',
    reach: 'additive',
    scope: 'local',
  }

  protected async execute(args: string): Promise<void> {
    const here = (get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []).map(String)
    const asked = findArgs(here, args)
    if (!asked) { this.#say('Find: say a word, for example "find betz /" for the whole hive'); return }
    const reader = get<ReaderLike>(HIVE_TREE_READER_IOC_KEY)
    if (!reader?.find) { this.#say('Find: the hive reader is not ready yet'); return }
    const route = `/${asked.segments.join('/')}`
    const startedAt = Date.now()
    const found = await reader.find(asked.word, asked.segments, { maxNodes: 64 })
    for (const line of findLines(asked.word, route, found, Date.now() - startedAt)) this.#say(line)
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '🔍' })
  }
}

const _find = new FindQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FindQueenBee', _find)
