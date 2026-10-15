// hypercomb-core/src/core/trait.ts
//
// TRAITS — the extension points of a creation (documentation/traits.md). A first-class primitive:
// every behaviour may declare traits, every view does, and every module on every platform resolves
// them the same way, so the rule lives here.
//
// A trait is one word a creation leaves open for a filler. The word does two jobs: it is the NAME of
// the next layer (the child that fills it is a tile called the word), and it is the LABEL of the
// extension point (a reader sees what the creation wants before anything fills it). Because the word
// is a molecule address, the same trait on two servers is the same address: implementations made by
// different communities line up against each other with no mapping table.
//
// A trait is not owed. Most traits already have a working version, the behaviour's OWN; a filler
// replaces it, and the alternatives others have made are offers, never automatic replacements. A
// trait declared with `needs` is the other case: a reminder that the behaviour works properly only
// once something is provided. A trait a participant opens on a tile with the `trait` word has no own
// version either, so it behaves as `needs`.
//
// Where a tile's traits come from, merged in this order (a word in both is one trait):
//   - DECLARED by the view it opens as (its registry descriptor), or by a behaviour (bee.base.ts);
//   - OPENED on the tile itself: a `trait:want` record, written by the `trait` word.
//
// How a trait fills, in order (resolveTrait):
//   1. FILL   the tile wears a `trait:fill` record for the word → that signature, as chosen.
//   2. CHILD  a child of the tile named the word → its head.
//   3. OWN    the behaviour's own working version. Tiles elsewhere named the word ride along as
//             offers; they never replace it unless the participant picks one with `fill`.
//   Only a trait with no own version goes on:
//   4. HIVE   tiles elsewhere in this hive named the word. One fills it; several are offered and the
//             participant picks — never first-wins.
//   5. MISS   nothing anywhere: the reminder stands.
// Followed hosts join the offers and the HIVE rung later (documentation/traits.md, step three).
//
// A trait is a requirement some tiles have, never a tile itself. The records are `trait:want` (a
// requirement given to a tile) and `trait:fill` (a filler chosen); both live on the tile. What can
// fill a trait lives in the word's pool, sign(word).

import { moleculeKey } from './molecule-address.js'

/** A trait a tile opens on itself. Payload `{ word }`, one record per word. */
export const TRAIT_WANT_KIND = 'trait:want'
/** The filler chosen for one word. Payload `{ word, sig }`, one record per word. */
export const TRAIT_FILL_KIND = 'trait:fill'

/** The trait provider's IoC key: any module asks it what a tile's traits are and what fills them. */
export const TRAITS_IOC_KEY = '@hypercomb/Traits'

const SIG = /^[0-9a-f]{64}$/

/** A trait given to a tile. `own: true` says the creation already fills it itself (a working version
 *  exists); absent, the trait is needed and a tile is made to fill it. */
export interface TraitWant { readonly word: string; readonly own?: boolean }
export interface TraitFill { readonly word: string; readonly sig: string }

/** How one trait is declared: a plain word (the behaviour has its own working version), or a word
 *  with `needs: true` (a reminder: it works properly only once something is provided). */
export type TraitDeclaration = string | { readonly word: string; readonly needs?: boolean }

/** One trait as a tile has it: the word, and whether a working version exists without a filler. */
export interface TraitSpec { readonly word: string; readonly own: boolean }

/** A tile that could fill a trait: its head layer signature and its route. */
export interface TraitCandidate { readonly sig: string; readonly route: readonly string[] }

export type TraitResolution =
  | { readonly word: string; readonly rung: 'fill'; readonly sig: string }
  | { readonly word: string; readonly rung: 'child'; readonly sig: string; readonly route: readonly string[] }
  | { readonly word: string; readonly rung: 'own'; readonly offers: readonly TraitCandidate[] }
  | { readonly word: string; readonly rung: 'hive'; readonly sig: string; readonly route: readonly string[] }
  | { readonly word: string; readonly rung: 'choose'; readonly candidates: readonly TraitCandidate[] }
  | { readonly word: string; readonly rung: 'miss' }

/** Two spellings of one word are one trait: the molecule fold decides, never the display text. */
export const sameTraitWord = (a: unknown, b: unknown): boolean => {
  const ka = moleculeKey(a)
  return ka !== '' && ka === moleculeKey(b)
}

const isSig = (v: unknown): v is string => typeof v === 'string' && SIG.test(v)

const wordOf = (item: TraitDeclaration | TraitWant | null | undefined): string =>
  String((typeof item === 'string' ? item : item?.word) ?? '').trim()

/** Trait words, first spelling kept, duplicates by fold dropped, blanks dropped. Accepts words,
 *  declarations or `trait:want` payloads. */
export function traitWords(items: readonly (TraitDeclaration | TraitWant | null | undefined)[]): string[] {
  const out: string[] = []
  for (const item of items) {
    const word = wordOf(item)
    if (word && !out.some(w => sameTraitWord(w, word))) out.push(word)
  }
  return out
}

/** Declarations as specs: a plain word has its own version; `needs: true` has none. */
export function traitSpecs(declared: readonly (TraitDeclaration | null | undefined)[] | null | undefined): TraitSpec[] {
  const out: TraitSpec[] = []
  for (const d of declared ?? []) {
    const word = wordOf(d)
    if (!word || out.some(s => sameTraitWord(s.word, word))) continue
    out.push({ word, own: !(typeof d === 'object' && d?.needs === true) })
  }
  return out
}

/** A tile's traits: the declared ones first, then the ones given to the tile itself. A given trait
 *  has its own version only when its record says `own: true`; a word already declared keeps its
 *  declared spec. */
export function mergeTraits(declared: readonly TraitSpec[], opened: readonly (string | TraitWant | null | undefined)[]): TraitSpec[] {
  const out = [...declared]
  for (const item of opened) {
    const word = wordOf(item)
    if (!word || out.some(s => sameTraitWord(s.word, word))) continue
    out.push({ word, own: typeof item === 'object' && item?.own === true })
  }
  return out
}

/** Resolve one trait from what is known about the tile. `children` are its direct children; `hive`
 *  is every tile in this hive named the word. A bare word resolves as a trait with no own version. */
export function resolveTrait(
  trait: string | TraitSpec,
  sources: {
    readonly fills: readonly (TraitFill | null | undefined)[]
    readonly children: readonly { readonly name: string; readonly sig: string; readonly segments: readonly string[] }[]
    readonly hive: readonly TraitCandidate[]
  },
): TraitResolution {
  const word = typeof trait === 'string' ? trait : trait.word
  const own = typeof trait === 'string' ? false : trait.own

  const fill = sources.fills.find(f => f && sameTraitWord(f.word, word) && isSig(f.sig))
  if (fill) return { word, rung: 'fill', sig: fill.sig }

  const child = sources.children.find(c => sameTraitWord(c.name, word) && isSig(c.sig))
  if (child) return { word, rung: 'child', sig: child.sig, route: [...child.segments] }

  const seen = new Set<string>()
  const candidates: TraitCandidate[] = []
  for (const c of sources.hive) {
    if (!isSig(c.sig) || seen.has(c.sig)) continue
    seen.add(c.sig)
    candidates.push({ sig: c.sig, route: [...c.route] })
  }
  if (own) return { word, rung: 'own', offers: candidates }
  if (candidates.length === 1) return { word, rung: 'hive', sig: candidates[0]!.sig, route: candidates[0]!.route }
  if (candidates.length > 1) return { word, rung: 'choose', candidates }
  return { word, rung: 'miss' }
}

/** The filler a resolution settled on, or null when the behaviour's own version stands, the trait is
 *  open, or several are offered. */
export const traitFiller = (r: TraitResolution): string | null =>
  r.rung === 'fill' || r.rung === 'child' || r.rung === 'hive' ? r.sig : null

/**
 * What a module may ask about traits. Registered under TRAITS_IOC_KEY by the hive; a view reaches it
 * through IoC, never by import, so a community module needs nothing but core.
 */
export interface TraitProvider {
  /** The traits a view declares, by its token ('' or unknown → none). */
  declaredByView(view: string): readonly TraitSpec[]
  /** Every trait a tile has: declared by the view it opens as, then opened on it. */
  traitsAt(segments: readonly string[]): Promise<readonly TraitSpec[]>
  /** Every trait a tile has, resolved. */
  resolveAt(segments: readonly string[]): Promise<readonly TraitResolution[]>
  /** The filler for one word on a tile, or null when the behaviour's own version stands, the trait
   *  is open, or several are offered. */
  fillerAt(segments: readonly string[], word: string): Promise<string | null>
}
