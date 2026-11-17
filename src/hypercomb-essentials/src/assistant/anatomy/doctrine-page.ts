// assistant/anatomy/doctrine-page.ts
//
// THE DOCTRINE AS A PAGE (jwize, 2026-11-16: "we need a doctrine viewer like
// the md files so we can actually show them without some elaborate discovery
// mechanism"). The doctrine the hive's tiles hold, written as markdown the
// docs browser shows beside the documentation: a heading per tier, its
// argument's documents, then each rule with what it rests on. It is exactly
// what every model is sent — the same read, never a second copy — and when
// the tiles carry no doctrine the page says why, as `doctrine` does.
// Pure: the anatomy hands it the status and the tiers it read.

import type { CodexTier } from './codex.js'

export type DoctrinePageStatus =
  | { readonly kind: 'unread' | 'absent' }
  | { readonly kind: 'read'; readonly tiers: number; readonly rules: number }
  | { readonly kind: 'broken'; readonly problems: readonly string[] }

/** The page's markup is the docs browser's: it does not escape inline text,
 *  so a rule's own `<` (or any markup) is escaped here. */
const text = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const doctrineMarkdown = (status: DoctrinePageStatus, tiers: readonly CodexTier[]): string => {
  const out: string[] = ['# Doctrine', '']
  if (status.kind !== 'read' || !tiers.length) {
    if (status.kind === 'broken') {
      out.push('The doctrine tiles do not hold, so no model is taught them:', '')
      for (const problem of status.problems) out.push(`- ${text(problem)}`)
    } else {
      out.push('This hive carries no doctrine. Adopt a host\'s `doctrine` branch, or say `doctrine tiles` at the root to lay out the build\'s copy.')
    }
    return out.join('\n') + '\n'
  }
  out.push(`> Read from this hive's \`/doctrine\` tiles: ${status.tiers} tiers, ${status.rules} rules. Every model is sent exactly this, and Jev judges every change against it. A rule changes by editing its tile's note.`, '')
  for (const tier of tiers) {
    out.push(`## ${tier.index} · ${text(tier.title)}`, '')
    // A link the docs browser opens in place: the documents live under
    // documentation/, CLAUDE.md one level up (shown as a source, not opened).
    if (tier.sources.length) out.push(`Argument: ${tier.sources.map(doc => `[\`${doc}\`](${doc === 'CLAUDE.md' ? '../CLAUDE.md' : doc})`).join(', ')}`, '')
    for (const axiom of tier.axioms) {
      // A span, not *emphasis*: a rule's own text may emphasise, and the page
      // sets what a rule rests on apart by its class.
      const rests = axiom.needs.length ? ` <span class="rests">rests on ${axiom.needs.join(', ')}</span>` : ''
      out.push(`- **${axiom.id}**${rests} ${text(axiom.rule)}`)
    }
    out.push('')
  }
  return out.join('\n')
}
