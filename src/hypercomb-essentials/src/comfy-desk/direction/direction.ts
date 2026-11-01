// comfy-desk/direction/direction.ts
//
// THE AGENTS, AND JEV. Ideas are speculative on the prompt so far: a fast
// model writes a handful of directions it could take. When one is chosen,
// reviewers each write the next chunk in that direction, Jev picks one, and
// the participant's own words are never replaced, only added to. A hive with
// no agent still gets ideas, from the common picture words, and says so.

import { parsePromptOption } from '../../comfy/comfy-help.js'
import { rollDirections } from '../../comfy/comfy-roll.js'
import type { DirectionPart, Idea } from '../parts.js'

export const IDEA_COUNT = 6
const IDEA_MAX_TOKENS = 320
const CHUNK_MAX_TOKENS = 80

export const IDEAS_SYSTEM = 'You suggest directions a picture prompt could take next. Answer with one direction per line, written as "title: one sentence". A title is two or three words. No numbering, no preamble, no blank lines.'

export const ideasAsk = (prompt: string, count: number): string => [
  `The prompt so far:\n${prompt.trim() || '(nothing yet)'}`,
  `Suggest ${count} different directions it could unfold: a detail of the subject, the setting, the light, the palette, the mood, the manner.`,
  'Each builds on the prompt. None replaces it. None repeats what it already says.',
].join('\n\n')

/** `title: text` lines, cleaned. Anything else on a line is dropped. */
export const parseIdeas = (raw: string, count = IDEA_COUNT): Idea[] => {
  const ideas: Idea[] = []
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const clean = line.replace(/^[\s\-*•\d.)]+/, '').replace(/^["'`]+|["'`]+$/g, '').trim()
    const at = clean.indexOf(':')
    if (at <= 0) continue
    const unquote = (part: string): string => part.replace(/\*+/g, '').replace(/^["'`]+|["'`]+$/g, '').trim()
    const title = unquote(clean.slice(0, at))
    const text = unquote(clean.slice(at + 1))
    if (!title || !text || title.length > 40) continue
    if (ideas.some(held => held.title.toLowerCase() === title.toLowerCase())) continue
    ideas.push({ id: `idea:${ideas.length}:${title.toLowerCase().replace(/\W+/g, '-')}`, title, text })
    if (ideas.length >= count) break
  }
  return ideas
}

export const CHUNK_SYSTEM = 'You add to a picture prompt. Answer with the new words only: one phrase or clause, under twenty words, no full stop, no quotation marks, no preamble.'

const ASKS = {
  take: 'Write the next words of the prompt that take this direction.',
  describe: 'Write a description for this direction: what is seen, in concrete nouns and materials.',
  visual: 'Write the visual objectives for this direction: composition, light, palette, lens or manner.',
} as const

/** Three ways to write the same chunk; the reviewer count says how many run. */
export const CHUNK_STANCES = [
  'Stay literal and spare.',
  'Be vivid, but add only what the direction needs.',
  'Prefer the concrete over the abstract.',
  'Name light and material before mood.',
  'Keep it to the fewest words that say it.',
  'Let the direction change one thing and keep the rest.',
  'Write it as a photographer would.',
  'Write it as a painter would.',
] as const

export const unfoldAsk = (prompt: string, idea: Idea, action: keyof typeof ASKS, stance: string): string => [
  `Stance: ${stance}`,
  `The prompt so far:\n${prompt.trim() || '(nothing yet)'}`,
  `The direction: ${idea.title} — ${idea.text}`,
  ASKS[action],
  'Do not repeat words the prompt already has.',
].join('\n\n')

/** A chunk is a clause, not a paragraph. */
export const cleanChunk = (raw: string): string =>
  parsePromptOption(raw).replace(/[.。]+$/g, '').replace(/^(the prompt|next|add|chunk)\s*:\s*/i, '').trim().slice(0, 160)

type Model = { callModel(call: Record<string, unknown>): Promise<{ text: string }> }
type Jev = { jevDecision: { readyForHive(): boolean; pickComfy(raw: unknown, signal?: AbortSignal): Promise<{ index: number }> } }

const model = (): Promise<Model> => import('../../assistant/llm-dispatch.js') as unknown as Promise<Model>
const jev = (): Promise<Jev> => import('../../assistant/jev-decision.service.js') as unknown as Promise<Jev>

export const directionPart: DirectionPart = {
  async ideas(prompt, signal) {
    try {
      const { callModel } = await model()
      const result = await callModel({
        need: { tier: 'fast' },
        maxTokens: IDEA_MAX_TOKENS,
        system: IDEAS_SYSTEM,
        messages: [{ role: 'user', content: ideasAsk(prompt, IDEA_COUNT) }],
        ...(signal ? { signal } : {}),
      })
      const ideas = parseIdeas(result.text)
      if (ideas.length >= 3) return { ideas, source: 'agents' }
    } catch (error) {
      if (signal?.aborted) throw error
    }
    const rolled = rollDirections(IDEA_COUNT).map((idea, index) => ({ id: `words:${index}:${idea.text.replace(/\W+/g, '-')}`, ...idea }))
    return { ideas: rolled, source: 'words' }
  },

  async unfold(prompt, idea, action, reviewers, signal) {
    const stances = CHUNK_STANCES.slice(0, Math.min(CHUNK_STANCES.length, Math.max(1, Math.round(reviewers))))
    let options: string[] = []
    try {
      const { callModel } = await model()
      const written = await Promise.all(stances.map(async stance => {
        try {
          const result = await callModel({
            need: { tier: 'fast' },
            maxTokens: CHUNK_MAX_TOKENS,
            system: CHUNK_SYSTEM,
            messages: [{ role: 'user', content: unfoldAsk(prompt, idea, action, stance) }],
            ...(signal ? { signal } : {}),
          })
          return cleanChunk(result.text)
        } catch { return '' }
      }))
      for (const option of written) {
        if (option && !options.some(held => held.toLowerCase() === option.toLowerCase())) options.push(option)
      }
    } catch (error) {
      if (signal?.aborted) throw error
    }
    if (signal?.aborted) throw new DOMException('stopped', 'AbortError')
    if (!options.length) return idea.text
    if (options.length === 1) return options[0] as string
    try {
      const { jevDecision } = await jev()
      if (jevDecision.readyForHive()) {
        const picked = await jevDecision.pickComfy({ tile: '', own: prompt, brief: `${idea.title}: ${idea.text}`, options }, signal)
        if (picked.index >= 0 && picked.index < options.length) return options[picked.index] as string
      }
    } catch { /* Jev away: the first reviewer's words */ }
    return options[0] as string
  },
}
