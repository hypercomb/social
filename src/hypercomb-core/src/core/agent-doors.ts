// core/agent-doors.ts
//
// THE TWO DOORS JEV KEEPS, as shipped steps (documentation/agent-harness.md,
// step 3). `front` reads the request once before any model runs — answer at
// once, weigh the tier, or step aside; `verify` checks a finished answer
// against what the hive read. Neither knows where Jev lives: the judge, the
// receipt writer and the emitter come in on the input, so these objects are
// pure with respect to their host and a community judge registers beside
// them by signature (assistant/agent-steps.ts).
//
// What stays with the caller: listing the behaviours and tiles the door is
// shown (the window owns the census and the tree), running a direct
// sentence Jev chose (that is the stretch's act), and recording the attempt
// in the turn's ledger (the caller holds the ledger).

import type {
  FrontDecisionLike, FrontInput, FrontOutput, FrontStep, VerifyDecisionLike, VerifyInput, VerifyOutput, VerifyStep,
} from './agent-steps.js'

const silent = (): void => { /* no door was asked, so there is nothing to report */ }

const stay = (): FrontOutput => ({ door: 'stay', aside: false, down: false, carry: false, ms: 0, report: silent })
const without = (ms = 0): FrontOutput => ({ door: 'without', aside: true, down: true, carry: false, ms, report: silent })

export const shippedFrontStep: FrontStep = {
  word: 'front',
  name: 'shipped',
  async run(input: FrontInput): Promise<FrontOutput> {
    const jev = input.jev
    if (!jev?.front) return stay()
    if (!jev.ready(input.providerId)) return without()
    const startedAt = Date.now()
    let decision: FrontDecisionLike
    try {
      decision = await jev.front(
        { request: input.request, behaviours: input.behaviours, tiles: input.tiles, carrying: input.carrying },
        { providerId: input.providerId, system: input.vocabulary, messages: [{ content: input.request }, { content: input.tiles.join('\n') }] },
        input.signal,
      )
    } catch (error) {
      if (input.signal?.aborted) throw error
      console.warn('[agent] Jev did not answer at the front door; this turn runs on the regular model:', error)
      return without(Date.now() - startedAt)
    }
    const ms = Date.now() - startedAt
    let receipt: string | undefined
    try { receipt = await input.persist?.(decision) } catch { receipt = undefined }
    const report = (outcome: string): void => {
      input.emit('jev:outcome', {
        decision: receipt, plan: 'front', outcome, at: Date.now(),
        ...(decision.weight ? { weight: decision.weight } : {}),
        ...(decision.direct?.reach ? { reach: decision.direct.reach } : {}),
      })
    }
    return {
      door: 'asked',
      aside: decision.aside,
      down: false,
      carry: decision.carry,
      ...(decision.weight ? { weight: decision.weight } : {}),
      decision,
      ...(receipt ? { receipt } : {}),
      ms,
      report,
    }
  },
}

export const shippedVerifyStep: VerifyStep = {
  word: 'verify',
  name: 'shipped',
  async run(input: VerifyInput): Promise<VerifyOutput | undefined> {
    const jev = input.jev
    if (!jev?.verify || !input.evidence.length || !jev.ready(input.providerId)) return undefined
    const startedAt = Date.now()
    let decision: VerifyDecisionLike
    try {
      decision = await jev.verify(
        { request: input.request, evidence: input.evidence, answer: input.answer },
        { providerId: input.providerId, system: input.system, messages: input.messages },
        input.signal,
      )
    } catch (error) {
      if (input.signal?.aborted) throw error
      console.warn('[agent] Jev could not check the answer:', error)
      return undefined
    }
    const ms = Date.now() - startedAt
    let receipt: string | undefined
    try { receipt = await input.persist?.(decision) } catch { receipt = undefined }
    input.emit('jev:outcome', { decision: receipt, plan: 'verify', outcome: decision.verified ? 'verified' : 'unverified', at: Date.now() })
    return {
      verified: decision.verified,
      reason: decision.reason,
      model: decision.model,
      decision,
      ...(receipt ? { receipt } : {}),
      ms,
      ...(decision.verified ? {} : { note: `\n\nJev could not confirm this answer against what the hive read (${decision.reason}).` }),
    }
  },
}
