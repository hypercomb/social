// core/agent-stretch.ts
//
// ROUTE AND STRETCH, as shipped steps (documentation/agent-harness.md, step
// 3). `route` is how the loop asks the router each round — the call shape,
// the reaction to a hand-off, the pin after a round; the router itself owns
// the pick. `stretch` is one streamed round: the chunks come in, a work
// block is held back from the visible stream by the guard, the visible
// prose is yielded as it arrives, and the round comes back split into what
// the model said and what it asked for. Running what it asked for — the
// fences through the Execution window — is the caller's act; the queue,
// the census and the tree are the caller's.

import type {
  HandoffInput, HandoffOutput, RouteCall, RouteInput, RouteStep, StretchInput, StretchOutput, StretchStep,
} from './agent-steps.js'
import { WorkStreamGuard, splitWork } from './work-fence.js'

export const shippedRouteStep: RouteStep = {
  word: 'route',
  name: 'shipped',
  call<N extends { readonly tier: string }>(input: RouteInput<N>): RouteCall {
    return {
      ...(input.pinned ? { providerId: input.pinned } : {}),
      ...(input.continuationModel ? { model: input.continuationModel } : {}),
      ...(input.round === 0 && input.preferModel ? { preferModel: input.preferModel } : {}),
      need: input.need,
      ...(input.round === 0 && !input.pinned && input.fallbackWithin ? { fallbackWithin: input.fallbackWithin } : {}),
      ...(input.avoid.length ? { avoid: [...input.avoid] } : {}),
      ...(input.namedModel ? { effort: input.need.tier } : {}),
    }
  },
  handoff<N extends { readonly tier: string }>(input: HandoffInput<N>): HandoffOutput<N> {
    const avoid = [...input.avoid, input.providerId]
    const need = { ...input.need, tier: 'deep' } as N
    const another = avoid.length <= input.maxHandoffs && input.ready(need, avoid)
    return { avoid, need, another }
  },
  pin(input: { readonly pinned?: string; readonly providerId: string; readonly model: string }) {
    return { pinned: input.pinned ?? input.providerId, continuationModel: input.model }
  },
}

export const shippedStretchStep: StretchStep = {
  word: 'stretch',
  name: 'shipped',
  async *run(input: StretchInput): AsyncGenerator<string, StretchOutput, void> {
    const guard = new WorkStreamGuard()
    let lead = input.lead
    let roundText = ''
    let providerId = ''
    let model = input.model ?? ''
    let label = ''
    let vendor: string | undefined
    let wrote = false
    for await (const chunk of input.stream) {
      if (providerId && providerId !== chunk.providerId) throw new Error('a provider changed during one model round')
      if (input.pinned && chunk.providerId !== input.pinned) throw new Error('a different provider answered in the middle of the work')
      const first = !providerId
      providerId = chunk.providerId
      model = chunk.model
      label = chunk.providerLabel ?? ''
      vendor = chunk.vendor
      input.onProvider?.(chunk, first)
      if (chunk.text) {
        roundText += chunk.text
        const visible = guard.push(chunk.text)
        if (visible && !input.silent) {
          wrote = true
          yield `${lead}${visible}`
          lead = ''
        }
      }
    }
    const tail = guard.end()
    if (tail && !input.silent) {
      wrote = true
      yield `${lead}${tail}`
    }
    return { providerId, model, label, ...(vendor ? { vendor } : {}), roundText, wrote, work: splitWork(roundText) }
  },
}
