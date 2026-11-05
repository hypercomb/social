// presentation/tiles/layout-report.ts
//
// WHAT THE SEATING PASS SAYS ABOUT ITSELF — ONE SHORT LINE.
//
// After a pinned page seats its tiles (show-cell #orderByIndexPinned), the
// pass used to print every tile with its slot: 192 cells, ~3,000 characters,
// on every layout, twice when the page re-seated. The diagnosis exists for one
// case — a tile score-filled past the map, or left with no seat at all, is the
// one that misses the first paint — and a participant reading the console on
// localhost (the quiet-console shim silences info only off loopback) had to
// scroll past the whole grid to see anything else. Now the pass says how many
// it seated and how; names only the tiles that are the problem; and lists
// every seat only when asked for (`hc:verbose=1`, the production switch).

export type LayoutReport = {
  /** `name@slot` for each tile seated at its persisted index. */
  readonly indexed: readonly string[]
  /** `name→slot` for each tile the pass seated by score (unindexed-seating.ts). */
  readonly scoreFilled: readonly string[]
  /** Every tile that had no slot of its own this pass (the pile). */
  readonly pile: readonly string[]
  /** The last slot the map can show. */
  readonly maxSlot: number
  /** `hc:verbose=1`: every seat, as before. */
  readonly verbose?: boolean
}

const slotOf = (entry: string): number => Number(entry.slice(entry.lastIndexOf('→') + 1))
const nameOf = (entry: string): string => entry.slice(0, entry.lastIndexOf('→'))

/** The lines the pass logs: always one with the counts; a second naming the
 *  tiles that will miss the first paint (seated past the map, or not seated
 *  at all), only when there are any; the full listing only when verbose. */
export function layoutReport(r: LayoutReport): string[] {
  const seated = r.indexed.length + r.scoreFilled.length
  const lines = [`[layout] ${seated} seated: ${r.indexed.length} indexed, ${r.scoreFilled.length} score-filled`]
  const past = r.scoreFilled.filter(e => slotOf(e) > r.maxSlot)
  const seatedNames = new Set(r.scoreFilled.map(nameOf))
  const unseated = r.pile.filter(n => !seatedNames.has(n))
  if (past.length || unseated.length) {
    const parts: string[] = []
    if (past.length) parts.push(`past slot ${r.maxSlot}: ${past.join(', ')}`)
    if (unseated.length) parts.push(`no seat (grid full): ${unseated.join(', ')}`)
    lines.push(`[layout] misses first paint — ${parts.join('; ')}`)
  }
  if (r.verbose) {
    lines.push(`[layout] indexed: ${r.indexed.join(', ') || '(none)'} | score-filled: ${r.scoreFilled.join(', ') || '(none)'}`)
  }
  return lines
}
