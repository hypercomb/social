// commands/trait.ts
//
// The grammar of the trait words: `trait` and `fill` (documentation/traits.md).
//
// The primitive itself — the records, the fold, the rungs — is core's (`@hypercomb/core`,
// core/trait.ts), because every behaviour and view on every platform resolves traits the same way.
// This module only parses what a participant types and says what a resolution means.
//
// Pure: the queens read the records, the roster and the search, and write what this returns.

import type { TraitResolution } from '@hypercomb/core'

export type TraitArgs =
  | { readonly verb: 'list' }
  | { readonly verb: 'open'; readonly words: readonly string[] }
  | { readonly verb: 'close'; readonly words: readonly string[] }

/** `trait` · `trait <word> [<word> …]` · `trait ~ <word> [<word> …]` (the `~` removal convention). */
export function parseTraitArgs(raw: string): TraitArgs | { error: 'unknown' } {
  const words = raw.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { verb: 'list' }
  if (words[0] === '~') {
    const rest = words.slice(1)
    return rest.length ? { verb: 'close', words: rest } : { error: 'unknown' }
  }
  if (words.some(w => w === '~')) return { error: 'unknown' }
  return { verb: 'open', words }
}

export type FillArgs =
  | { readonly verb: 'pin'; readonly word: string }
  | { readonly verb: 'with'; readonly word: string; readonly source: string }
  | { readonly verb: 'clear'; readonly word: string }

/** `fill <word>` · `fill <word> <route|signature>` · `fill ~ <word>`. */
export function parseFillArgs(raw: string): FillArgs | { error: 'unknown' } {
  const words = raw.trim().split(/\s+/).filter(Boolean)
  if (words[0] === '~') return words.length === 2 ? { verb: 'clear', word: words[1] } : { error: 'unknown' }
  if (words.length === 1) return { verb: 'pin', word: words[0] }
  if (words.length === 2) return { verb: 'with', word: words[0], source: words[1] }
  return { error: 'unknown' }
}

/** How a resolution reads on the command line, one trait per line. */
export function describeResolution(r: TraitResolution): string {
  switch (r.rung) {
    case 'fill': return `${r.word}: filled by its mark`
    case 'child': return `${r.word}: filled by the child "${r.route[r.route.length - 1] ?? r.word}"`
    case 'own': return r.offers.length
      ? `${r.word}: its own version — ${r.offers.length} other${r.offers.length === 1 ? '' : 's'} in this hive could replace it`
      : `${r.word}: its own version`
    case 'hive': return `${r.word}: filled by /${r.route.join('/')}`
    case 'choose': return `${r.word}: ${r.candidates.length} tiles in this hive offer it — fill ${r.word} <route> to choose`
    case 'miss': return `${r.word}: needs a filler — no tile by that name yet`
  }
}
