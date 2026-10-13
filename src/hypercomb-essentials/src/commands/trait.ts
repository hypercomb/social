// commands/trait.ts
//
// TRAITS — the extension points a creation leaves open (documentation/traits.md).
//
// A trait is a mark a tile wears naming one word: `portrait`, `tagline`, `contact-script`. The word is
// already an address, sign(word), so there is no query language: filling a trait is the lookup the hive
// already does for every molecule, asked from the creation's side.
//
// A trait fills by rungs, in order:
//   1. FILL   the tile wears a `trait:fill` mark for the word → that signature. Nothing is re-resolved;
//             what you read is exactly what was chosen.
//   2. CHILD  a child of the tile named the word → its head.
//   3. HIVE   tiles elsewhere in this hive named the word. One fills it; several are offered, and the
//             participant picks with `fill` — never first-wins.
//   4. MISS   nothing anywhere. Shown as a miss (an ask, later).
// Followed hosts are a later rung (step three); this module never reads the network.
//
// Nothing is minted for an empty trait. The only state in the primitive is the `trait:fill` mark.
//
// Pure: the queens read the records, the roster and the search, and write what this returns.

import { moleculeKey } from '@hypercomb/core'

/** The extension point a tile leaves open. Payload `{ word }`, one record per word. */
export const TRAIT_WANT_KIND = 'trait:want'
/** The filler chosen for one word. Payload `{ word, sig }`, one record per word. */
export const TRAIT_FILL_KIND = 'trait:fill'

const SIG = /^[0-9a-f]{64}$/

export interface TraitWant { readonly word: string }
export interface TraitFill { readonly word: string; readonly sig: string }

/** A tile that could fill a trait: its head layer signature and its route. */
export interface TraitCandidate { readonly sig: string; readonly route: readonly string[] }

export type TraitResolution =
  | { readonly word: string; readonly rung: 'fill'; readonly sig: string }
  | { readonly word: string; readonly rung: 'child'; readonly sig: string; readonly route: readonly string[] }
  | { readonly word: string; readonly rung: 'hive'; readonly sig: string; readonly route: readonly string[] }
  | { readonly word: string; readonly rung: 'choose'; readonly candidates: readonly TraitCandidate[] }
  | { readonly word: string; readonly rung: 'miss' }

/** Two spellings of one word are one trait: the molecule fold decides, never the display text. */
export const sameWord = (a: unknown, b: unknown): boolean => {
  const ka = moleculeKey(a)
  return ka !== '' && ka === moleculeKey(b)
}

export const isSig = (v: unknown): v is string => typeof v === 'string' && SIG.test(v)

/** The trait words a tile wears, first spelling kept, duplicates by fold dropped. */
export function traitWords(points: readonly (TraitWant | null | undefined)[]): string[] {
  const out: string[] = []
  for (const p of points) {
    const word = String(p?.word ?? '').trim()
    if (word && !out.some(w => sameWord(w, word))) out.push(word)
  }
  return out
}

/**
 * Resolve one trait. `children` are the tile's direct children; `hive` is every tile in this hive named
 * the word (the tile's own children may appear in it and are not counted twice).
 */
export function resolveTrait(
  word: string,
  sources: {
    readonly fills: readonly (TraitFill | null | undefined)[]
    readonly children: readonly { readonly name: string; readonly sig: string; readonly segments: readonly string[] }[]
    readonly hive: readonly TraitCandidate[]
  },
): TraitResolution {
  const fill = sources.fills.find(f => f && sameWord(f.word, word) && isSig(f.sig))
  if (fill) return { word, rung: 'fill', sig: fill.sig }

  const child = sources.children.find(c => sameWord(c.name, word) && isSig(c.sig))
  if (child) return { word, rung: 'child', sig: child.sig, route: [...child.segments] }

  const seen = new Set<string>()
  const candidates: TraitCandidate[] = []
  for (const c of sources.hive) {
    if (!isSig(c.sig) || seen.has(c.sig)) continue
    seen.add(c.sig)
    candidates.push({ sig: c.sig, route: [...c.route] })
  }
  if (candidates.length === 1) return { word, rung: 'hive', sig: candidates[0].sig, route: candidates[0].route }
  if (candidates.length > 1) return { word, rung: 'choose', candidates }
  return { word, rung: 'miss' }
}

// ── the words ───────────────────────────────────────────────────────────

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
    case 'hive': return `${r.word}: filled by /${r.route.join('/')}`
    case 'choose': return `${r.word}: ${r.candidates.length} tiles in this hive offer it — fill ${r.word} <route> to choose`
    case 'miss': return `${r.word}: open — no tile by that name yet`
  }
}
