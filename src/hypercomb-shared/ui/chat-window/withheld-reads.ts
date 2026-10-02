// hypercomb-shared/ui/chat-window/withheld-reads.ts
//
// THE READ STEP'S HALF OF WITHHOLDING (core/ai-withheld.store.ts holds the
// list). A model other than the participant's own may not read a withheld
// tile or anything under it: a read aimed there is refused before it runs,
// and a tree or a find that walked past one comes back without it.
//
// Pure, so it can be run by a spec rather than only read as source.
import type { HypercombObservation, HypercombObservationReceipt } from './hypercomb-observation'

export type Covers = (segments: readonly string[]) => boolean

const segmentsOfPath = (path: string): string[] => String(path ?? '').split('/').filter(Boolean)

/** The first read in a block aimed at a withheld route, if any. A read by
 *  signature or of code names no route; it is not this guard's to judge. */
export const withheldObservation = (
  observations: readonly HypercombObservation[],
  covers: Covers,
): HypercombObservation | undefined =>
  observations.find(observation => observation.verb !== 'code' && !observation.sig && covers(observation.segments))

/** The receipt with every withheld tile left out of trees and finds. */
export const withoutWithheld = (receipt: HypercombObservationReceipt, covers: Covers): HypercombObservationReceipt => ({
  ...receipt,
  results: receipt.results.map(result => {
    if (result.kind === 'tree' && result.read.ok) {
      const nodes = result.read.nodes.filter(node => !covers(segmentsOfPath(node.path)))
      return nodes.length === result.read.nodes.length ? result : { ...result, read: { ...result.read, nodes, truncated: true } }
    }
    if (result.kind === 'find' && result.read.ok) {
      const matches = result.read.matches.filter(match => !covers(segmentsOfPath(match.path)))
      return matches.length === result.read.matches.length ? result : { ...result, read: { ...result.read, matches } }
    }
    return result
  }),
})

export const withheldMessage = (grammar: string): string =>
  `${grammar}: the participant withholds that tile from outside models. Do not read it or anything under it, and do not try another way in; carry on with the rest of the work`
