// presentation/tiles/division-group.ts
//
// The group a whole's division names — the question a VIEW asks ("what seats
// into my holes?"), apart from the act of dividing a picture. It lived in
// assistant/visual-distribution.ts, so the site view that renders a division
// (division-render.ts) pulled in the whole distribution — picture capture and
// the editor's crop math — on every published site's arrival (measured
// 2026-09-28). visual-distribution re-exports it; nothing else changes.

import { siteGroupFor } from '../../pheromones/enrollment-acts.js'
import { DIVISION_FAMILY } from './visual-division.js'

type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
}

/**
 * The relation a whole's division enrolls its parts under.
 *
 * Derived from the whole's LOCATION, not just its label: two tiles called
 * "engine" in different branches are different wholes and must not share one
 * set. The tail of the location signature makes that so without anyone having
 * to keep a register, and the readable prefix keeps `/enroll` legible.
 */
export async function divisionRelationName(wholeSegments: readonly string[]): Promise<string> {
  const label = wholeSegments[wholeSegments.length - 1] ?? 'whole'
  const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  try {
    const sig = await history?.sign({ explorerSegments: () => [...wholeSegments] })
    if (sig) return `${label}-${sig.slice(0, 12)}`
  } catch { /* history cold — the label alone still names a relation */ }
  return label
}

/** The group a whole's division names, for a reader that holds the whole's
 *  path. Exported so a view can ask "what seats into my holes?" without the
 *  distribution having to tell it. */
export async function divisionGroupOf(
  wholeSegments: readonly string[],
): Promise<{ sig: string; meaning: string } | null> {
  const relation = await divisionRelationName(wholeSegments)
  const group = await siteGroupFor(relation, DIVISION_FAMILY)
  return group ? { sig: group.sig, meaning: group.meaning } : null
}
