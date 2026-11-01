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

/** The tiers a reader of the hive is taught, as doctrine sections in the shape
 *  the doctrine bag stores: heading, source line, then the axiom lines. Tiers
 *  scoped to builders are left to the agents that change code. */
export const codexSections = (tiers: readonly CodexTier[], scope = 'all'): string[] =>
  tiers
    .filter(tier => tier.scope === 'all' || tier.scope === scope)
    .map(tier => `### ${tier.title}\n(source: doctrine.codex${tier.sources.length ? ` ~ ${tier.sources.join(', ')}` : ''})\n\n${tier.axioms.map(axiom => axiom.line).join('\n')}`)
