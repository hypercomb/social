export type PreloadDepthStamp = {
  depth: number
  epoch: number
}

export type PreloadFrontierEntry = {
  depth: number
  score: number
}

/** A completed shallow warm never satisfies a later deeper request. */
export const preloadStampSatisfies = (
  stamp: PreloadDepthStamp | undefined,
  requestedDepth: number,
  epoch: number,
): boolean => !!stamp && stamp.epoch === epoch && stamp.depth >= requestedDepth

/** Keep the deepest completion only while it belongs to the same tree epoch. */
export const mergePreloadStamp = (
  prior: PreloadDepthStamp | undefined,
  completedDepth: number,
  epoch: number,
): PreloadDepthStamp => ({
  depth: prior?.epoch === epoch
    ? Math.max(prior.depth, completedDepth)
    : completedDepth,
  epoch,
})

/**
 * Walking upward spends one unit of radius per ancestor. The remaining radius
 * is then available for sideways/downward expansion from that ancestor.
 */
export const remainingAncestorPreloadDepth = (radius: number, levelsUp: number): number =>
  Math.max(1, radius - levelsUp + 1)

/**
 * Take work from exactly one depth. Usage orders peers at that depth but can
 * never promote a deeper node ahead of an unfinished sibling frontier.
 */
export const takePreloadBreadthSlice = <T extends PreloadFrontierEntry>(
  frontier: T[],
  concurrency: number,
): T[] => {
  frontier.sort((a, b) => (a.depth - b.depth) || (b.score - a.score))
  if (frontier.length === 0) return []
  const depth = frontier[0].depth
  let sameDepth = 0
  while (sameDepth < frontier.length && frontier[sameDepth].depth === depth) sameDepth++
  return frontier.splice(0, Math.min(Math.max(1, concurrency), sameDepth))
}

/** Only a drained, non-superseded pass may advertise completion. */
export const preloadPassCompleted = (input: {
  frontierRemaining: number
  incomplete: boolean
  generationAtStart: number
  generationNow: number
  epochAtStart: number
  epochNow: number
}): boolean => input.frontierRemaining === 0
  && !input.incomplete
  && input.generationAtStart === input.generationNow
  && input.epochAtStart === input.epochNow
