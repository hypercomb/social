// codex.ts — reads documentation/doctrine.codex, the one artifact every agent
// is taught from. Pure text in, structure out: no file access, so the build
// script, the spec and any runtime can share it.
//
// Format (one line per axiom, tiers ordered base to leaf):
//   @<n> <Title> [scope]? ~<doc>, <doc>
//   <Id><<dep>,<dep>>?: <rule>
// An axiom may cite only axioms that appear EARLIER, so the file read top to
// bottom is a build order and a model never meets a term before its ground.

export interface CodexAxiom {
  readonly id: string
  readonly needs: readonly string[]
  readonly rule: string
  readonly line: string
}

export interface CodexTier {
  readonly index: number
  readonly title: string
  readonly scope: string
  readonly sources: readonly string[]
  readonly axioms: readonly CodexAxiom[]
}

const TIER = /^@(\d+) (.+?)(?: \[(\w+)\])?(?: ~(.+))?$/
const AXIOM = /^([A-Z]\d+)(?:<([A-Z]\d+(?:,[A-Z]\d+)*))?: (.+)$/

export const parseCodex = (text: string): CodexTier[] => {
  const tiers: { index: number; title: string; scope: string; sources: string[]; axioms: CodexAxiom[] }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line || line.startsWith('HC-CODEX')) continue
    const tier = TIER.exec(line)
    if (tier) {
      tiers.push({
        index: Number(tier[1]),
        title: tier[2]!,
        scope: tier[3] ?? 'all',
        sources: (tier[4] ?? '').split(/[\s,]+/).filter(Boolean),
        axioms: [],
      })
      continue
    }
    const axiom = AXIOM.exec(line)
    if (axiom && tiers.length) {
      tiers[tiers.length - 1]!.axioms.push({ id: axiom[1]!, needs: axiom[2] ? axiom[2].split(',') : [], rule: axiom[3]!, line })
    }
  }
  return tiers
}

/** Everything wrong with a codex, as sentences; empty means it holds. Base to
 *  leaf is enforced here: an axiom may only cite an axiom that came before. */
export const validateCodex = (tiers: readonly CodexTier[], documentExists: (doc: string) => boolean): string[] => {
  const problems: string[] = []
  const seen = new Set<string>()
  tiers.forEach((tier, at) => {
    if (tier.index !== at) problems.push(`tier "${tier.title}" is numbered ${tier.index}, expected ${at}`)
    if (!tier.axioms.length) problems.push(`tier "${tier.title}" holds no axiom`)
    for (const doc of tier.sources) if (!documentExists(doc)) problems.push(`tier "${tier.title}" names a missing document ${doc}`)
    for (const axiom of tier.axioms) {
      if (seen.has(axiom.id)) problems.push(`${axiom.id} is defined twice`)
      for (const need of axiom.needs) if (!seen.has(need)) problems.push(`${axiom.id} cites ${need}, which does not come before it`)
      seen.add(axiom.id)
    }
  })
  return problems
}

/** One tier as the doctrine bag holds it: a heading, a source line, then the
 *  axiom lines. Any subset of a tier's axioms composes the same way. */
export const sectionOf = (tier: CodexTier, axioms: readonly CodexAxiom[] = tier.axioms): string =>
  `### ${tier.title}\n(source: doctrine.codex${tier.sources.length ? ` ~ ${tier.sources.join(', ')}` : ''})\n\n${axioms.map(axiom => axiom.line).join('\n')}`

/** The tiers a reader of the hive is taught, as doctrine sections in the shape
 *  the doctrine bag stores. Tiers scoped to builders are left to the agents
 *  that change code. */
export const codexSections = (tiers: readonly CodexTier[], scope = 'all'): string[] =>
  tiers.filter(tier => tier.scope === 'all' || tier.scope === scope).map(tier => sectionOf(tier))

// ── choosing parts ──────────────────────────────────────────────────────────
//
// Every axiom stands alone, so any set of them is a doctrine. Nothing here
// refuses a choice: a set that leaves out something a chosen axiom rests on is
// reported, never blocked. Selections are sets of ids; the catalog is the
// codex; the composed sections are what the doctrine bag stores.

const LINE_ID = /^([A-Z]\d+)(?:<[A-Z0-9,]+)?: /

const axiomsIn = (tiers: readonly CodexTier[]): CodexAxiom[] => tiers.flatMap(tier => [...tier.axioms])

/** The axiom ids a doctrine's sections carry, by the ids their lines open with. */
export const selectedIds = (sections: readonly string[], tiers: readonly CodexTier[]): Set<string> => {
  const known = new Set(axiomsIn(tiers).map(axiom => axiom.id))
  const ids = new Set<string>()
  for (const section of sections) {
    for (const line of section.split('\n')) {
      const id = LINE_ID.exec(line)?.[1]
      if (id && known.has(id)) ids.add(id)
    }
  }
  return ids
}

/** Sections the codex does not own — written in the hive — kept as they are. */
export const foreignSections = (sections: readonly string[], tiers: readonly CodexTier[]): string[] => {
  const titles = new Set(tiers.map(tier => tier.title))
  return sections.filter(section => !titles.has((section.split('\n', 1)[0] ?? '').replace(/^### /, '').trim()))
}

/** The doctrine for a chosen set: each tier with the axioms chosen, base to
 *  leaf, a tier with none left out, then the hive's own sections untouched. */
export const composeSelection = (tiers: readonly CodexTier[], ids: ReadonlySet<string>, foreign: readonly string[] = []): string[] => [
  ...tiers
    .map(tier => ({ tier, chosen: tier.axioms.filter(axiom => ids.has(axiom.id)) }))
    .filter(({ chosen }) => chosen.length)
    .map(({ tier, chosen }) => sectionOf(tier, chosen)),
  ...foreign,
]

/** Everything an axiom rests on, nearest first, transitively. */
export const groundOf = (tiers: readonly CodexTier[], id: string): string[] => {
  const byId = new Map(axiomsIn(tiers).map(axiom => [axiom.id, axiom]))
  const out: string[] = []
  const walk = (at: string): void => {
    for (const need of byId.get(at)?.needs ?? []) if (!out.includes(need)) { out.push(need); walk(need) }
  }
  walk(id)
  return out
}

/** Everything that rests on an axiom, transitively. */
export const restingOn = (tiers: readonly CodexTier[], id: string): string[] =>
  axiomsIn(tiers).filter(axiom => groundOf(tiers, axiom.id).includes(id)).map(axiom => axiom.id)

/** Chosen axioms that rest on axioms left out: advice, never a refusal. */
export const looseGround = (tiers: readonly CodexTier[], ids: ReadonlySet<string>): { id: string; missing: string[] }[] =>
  axiomsIn(tiers)
    .filter(axiom => ids.has(axiom.id))
    .map(axiom => ({ id: axiom.id, missing: groundOf(tiers, axiom.id).filter(need => !ids.has(need)) }))
    .filter(entry => entry.missing.length)

/** The set with everything its members rest on added. */
export const withGround = (tiers: readonly CodexTier[], ids: ReadonlySet<string>): Set<string> => {
  const out = new Set(ids)
  for (const id of ids) for (const need of groundOf(tiers, id)) out.add(need)
  return out
}
