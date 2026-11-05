// assistant/glossary.ts
//
// THE GLOSSARY, READ. documentation/glossary.md is the terminology of
// Hypercomb: sections (`## …`), and in each section its terms (`### …`), each
// term's definition the prose under it. This module reads that text into
// sections and terms and answers "which term is this word?" — pure, with no
// imports, so the build script that bakes the text (scripts/build-glossary.ts)
// and the hive that answers from it read it the same way.
//
// The glossary is NOT anatomy. The anatomy rides every request under a fixed
// budget and the glossary does not fit in it; the hive is the AI's only
// context (C1) and it pulls what it needs on demand (C2, C3), so the glossary
// lives in the hive as tiles (glossary-tiles.ts), and a term is answered from
// its tile before any model is asked.

export type GlossaryTerm = {
  /** The heading as the glossary writes it: `history bag (sigbag)`. */
  readonly term: string
  /** The section the term sits in: `foundational terms`. */
  readonly section: string
  /** The prose under the heading, as written. */
  readonly definition: string
}

export type GlossarySection = {
  readonly title: string
  /** The prose between the section heading and its first term. */
  readonly intro: string
  readonly terms: readonly GlossaryTerm[]
}

const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** A text as a name: lowercase words joined by hyphens. `@hypercomb/core` is
 *  `hypercomb-core`, `link / unlink` is `link-unlink`. */
export const glossarySlug = (text: string): string => words(text).join('-')

/** The glossary as it is baked into a module. The doctrine names the retired
 *  typed folders in order to forbid them, and the typed-folder ratchet in
 *  doctrine.spec.ts scans `.ts` for exactly that token shape, so any such
 *  spelling becomes a quoted name. Line endings are made one shape, so the
 *  same document bakes to the same bytes on every machine. */
export const glossarySource = (markdown: string): string =>
  markdown
    .replace(/\r\n?/g, '\n')
    .replace(/`?__([a-z][a-z0-9_-]*?)__`?/gi, (_, name: string) => `"${name}" folder`)

const tidy = (lines: readonly string[]): string => lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()

/** Sections and their terms, in the glossary's own order. The title and the
 *  prose before the first section, and the horizontal rules between sections,
 *  are not terms. */
export const parseGlossary = (markdown: string): GlossarySection[] => {
  type Open = { title: string; intro: string[]; terms: { term: string; body: string[] }[] }
  const open: Open[] = []
  for (const line of glossarySource(markdown).split('\n')) {
    const section = /^##\s+(.+?)\s*$/.exec(line)
    if (section) { open.push({ title: section[1]!, intro: [], terms: [] }); continue }
    const current = open[open.length - 1]
    if (!current) continue
    const term = /^###\s+(.+?)\s*$/.exec(line)
    if (term) { current.terms.push({ term: term[1]!, body: [] }); continue }
    if (/^\s*-{3,}\s*$/.test(line)) continue
    const last = current.terms[current.terms.length - 1]
    if (last) last.body.push(line)
    else current.intro.push(line)
  }
  return open.map(section => ({
    title: section.title,
    intro: tidy(section.intro),
    terms: section.terms.map(term => ({ term: term.term, section: section.title, definition: tidy(term.body) })),
  }))
}

/** Every word a term answers to: the whole heading, the heading without what
 *  it says in parentheses, what it says in parentheses, and each side of a
 *  spaced slash. `history bag (sigbag)` answers to `history-bag-sigbag`,
 *  `history-bag` and `sigbag`. */
export const termKeys = (term: string): string[] => {
  const head = term.replace(/\([^)]*\)/g, ' ')
  const keys = [glossarySlug(term), glossarySlug(head)]
  for (const inside of term.matchAll(/\(([^)]*)\)/g)) keys.push(glossarySlug(inside[1] ?? ''))
  for (const side of head.split(/\s+\/\s+/)) keys.push(glossarySlug(side))
  return [...new Set(keys.filter(Boolean))]
}

export type GlossaryMatch = {
  /** The terms that answer to the word, in the glossary's order. */
  readonly exact: readonly GlossaryTerm[]
  /** When none does: the terms whose words hold it. */
  readonly near: readonly GlossaryTerm[]
}

/** Which term the participant means by what they typed. A word that names a
 *  term answers with it (`bee` is the bee of the metaphor and the bee of the
 *  architecture); a plural that names one answers as its singular; otherwise
 *  the terms whose words hold it are offered instead. */
export const matchGlossary = (sections: readonly GlossarySection[], typed: string): GlossaryMatch => {
  const asked = glossarySlug(typed)
  const terms = sections.flatMap(section => section.terms)
  if (!asked) return { exact: [], near: [] }
  const naming = (slug: string): GlossaryTerm[] => terms.filter(term => termKeys(term.term).includes(slug))
  const exact = naming(asked)
  if (exact.length) return { exact, near: [] }
  const singular = asked.endsWith('s') ? naming(asked.slice(0, -1)) : []
  if (singular.length) return { exact: singular, near: [] }
  const holds = (slug: string): boolean => `-${slug}-`.includes(`-${asked}-`)
  return { exact: [], near: terms.filter(term => termKeys(term.term).some(holds)) }
}
