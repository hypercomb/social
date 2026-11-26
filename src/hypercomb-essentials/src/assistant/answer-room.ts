// assistant/answer-room.ts
//
// ROOM FOR THE ANSWER (jwize's card page, 2026-11-15).
//
// A model that thinks before it answers is charged for the thinking out of
// the same allowance as the answer. A call that names no allowance is sent
// 4096 tokens by every adapter, and on business-card.jwize.com the model
// spent all 4096 on thought in 14 of 186 asks. Each of those came back with
// nothing written, after 23 to 70 seconds, and the one retry asked the same
// thing with the same allowance and came back empty again.
//
// The allowance is for the answer, so thinking gets room of its own:
//
//   - A model seen to think (its usage reports reasoning tokens) is asked
//     with THINKING_ROOM from then on, when the caller named no allowance.
//   - An answer that was all thought teaches that at once, so the retry that
//     already follows a blank answer is asked with the room it lacked.
//   - That retry is also asked to think less (the lowest reasoning effort the
//     adapter knows). Room alone was not enough: the same model, given 16384
//     and a small coding question, thought for all 16384 twice and failed
//     after 324 seconds; asked with low effort it thought for 4769 and
//     answered in 41. The ask after that is the model's own effort again.
//   - A host that refuses the larger allowance is asked again plainly, and a
//     plain answer after a refusal turns the room off for that model.
//
// A caller that named its own allowance is never overruled. What is learned
// lasts for the page's session and is learned again from the first answer.
//
// ROOM FOR THE WORK (2026-11-25). A round that may write several files in one
// reply cannot fit six of them in 4096 tokens. Such a call asks for room
// (`wanted`) rather than naming an allowance, so it is the same request a
// host already refused larger allowances from: a 400 or 422 asks again
// plainly, and that host is not asked for room again.

/** What every adapter sends when a call names no allowance. */
export const ANSWER_TOKENS = 4096
/** Thought and answer together, for a model seen to think. */
export const THINKING_ROOM = 16_384

type Usage = { readonly outputTokens?: number; readonly reasoningTokens?: number } | undefined

const thinkers = new Set<string>()
const refused = new Set<string>()
const keyOf = (providerId: string, model: string): string => `${providerId}\n${model}`

/** A settled attempt's usage: a model that reports thought is a thinker. */
export const noteThinking = (providerId: string, model: string, usage: Usage): void => {
  if ((usage?.reasoningTokens ?? 0) > 0) thinkers.add(keyOf(providerId, model))
}

/** The allowance to send for a call that named `named` (or none). Undefined
 *  leaves the request exactly as the caller built it. */
export const answerRoom = (providerId: string, model: string, named: number | undefined, wanted?: number): number | undefined => {
  if (named !== undefined) return undefined
  const key = keyOf(providerId, model)
  if (refused.has(key)) return undefined
  const room = Math.max(thinkers.has(key) ? THINKING_ROOM : 0, wanted && wanted > ANSWER_TOKENS ? wanted : 0)
  return room || undefined
}

/** An answer with nothing written whose whole output was thought. OpenAI's
 *  shape counts thought inside the output; Gemini counts it beside it. */
export const allThought = (usage: Usage): boolean => {
  const thought = usage?.reasoningTokens ?? 0
  return thought > 0 && thought >= (usage?.outputTokens ?? 0)
}

/** The host answered plainly after refusing the room: stop asking for it. */
export const refuseAnswerRoom = (providerId: string, model: string): void => {
  refused.add(keyOf(providerId, model))
}

/** Tests only: what was learned is the module's, so a spec starts clean. */
export const forgetAnswerRoom = (): void => {
  thinkers.clear()
  refused.clear()
}
