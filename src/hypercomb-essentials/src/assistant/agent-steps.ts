// assistant/agent-steps.ts
//
// THE STEP REGISTRY (documentation/agent-harness.md, step 3). Every word of
// the agent loop that has been lifted out of the chat window resolves here:
// the shipped implementation (core/agent-leg.ts) under the bare word, and
// any bee that arrived as content under its signature. A harness record
// names the bees it wants in `steps`; `resolve(word, harness.steps)` answers
// the first of those registered under the word, else the shipped one. The
// window runs what it is handed and never knows which.
//
// A module registers a step by calling `agentSteps.register(step, sig)`;
// the bee that loaded it owns that act. chat.drone publishes this registry.

import {
  EffectBus, shippedFoldStep, shippedHandoverStep, shippedReceiptStep,
  type AgentStepListing, type AgentStepOf, type AgentStepRegistry, type ImplementedStepWord,
} from '@hypercomb/core'

export { AGENT_STEPS_IOC_KEY } from '@hypercomb/core'

const SHIPPED = ''

export class AgentStepRegistryStore extends EventTarget implements AgentStepRegistry {
  readonly #steps = new Map<ImplementedStepWord, Map<string, AgentStepOf[ImplementedStepWord]>>()

  register<W extends ImplementedStepWord>(step: AgentStepOf[W], sig?: string): void {
    const word = step.word as ImplementedStepWord
    const key = String(sig ?? '').trim()
    const under = this.#steps.get(word) ?? new Map<string, AgentStepOf[ImplementedStepWord]>()
    under.set(key, step as AgentStepOf[ImplementedStepWord])
    this.#steps.set(word, under)
    this.dispatchEvent(new Event('change'))
  }

  resolve<W extends ImplementedStepWord>(word: W, prefer: readonly string[] = []): AgentStepOf[W] | undefined {
    const under = this.#steps.get(word)
    if (!under) return undefined
    for (const sig of prefer) {
      const chosen = under.get(String(sig ?? '').trim())
      if (chosen) return chosen as AgentStepOf[W]
    }
    return under.get(SHIPPED) as AgentStepOf[W] | undefined
  }

  list(): AgentStepListing[] {
    const out: AgentStepListing[] = []
    for (const [word, under] of this.#steps) {
      for (const [sig, step] of under) out.push({ word, name: step.name, ...(sig ? { sig } : {}) })
    }
    return out
  }
}

export const agentSteps = new AgentStepRegistryStore()

/** The shipped three, under their bare words — offered by the bee that
 *  publishes the registry (chat.drone), never by this module. A community
 *  bee that offers a `fold` of its own registers beside them with its
 *  signature and waits for a harness to name it. */
export const shippedAgentSteps = (): readonly AgentStepOf[ImplementedStepWord][] => [
  shippedFoldStep,
  shippedHandoverStep,
  shippedReceiptStep((name, payload) => { EffectBus.emit(name, payload) }),
]
