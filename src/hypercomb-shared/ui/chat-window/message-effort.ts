// hypercomb-shared/ui/chat-window/message-effort.ts
//
// HOW MUCH WORK A MESSAGE IS. The mediator has always ranked providers by the
// weight of a job, but the chat asked every message for 'fast' — so the
// strongest model added was never chosen for the work that needed it
// (model-mediation-and-the-training-prompt.md §3.1, "nothing derives the
// tier"). This reads the message once, cheaply and visibly, and names a tier.
// A pin, or a model named in the chat, still overrides whatever it says.

export type MessageEffort = 'fast' | 'balanced' | 'deep'

/** Words that mean thinking before doing. */
const DEEP_WORDS = /\b(plan|design|architect\w*|refactor\w*|restructur\w*|reorgani[sz]\w*|organi[sz]e|analy[sz]\w*|compare|research|investigat\w*|audit|migrat\w*|break (?:it |this |them )?apart|step by step|strategy)\b/i
/** Words that mean changing something in the hive. */
const CHANGE_WORDS = /\b(create|add|make|move|rename|remove|delete|tag|note|update|change|fix|build|write|put|link|group)\b/i

export const effortFor = (message: string): MessageEffort => {
  const text = String(message ?? '').trim()
  const lines = text.split('\n').filter(line => line.trim()).length
  if (text.length >= 600 || lines >= 3 || DEEP_WORDS.test(text)) return 'deep'
  if (text.length <= 160 && !CHANGE_WORDS.test(text)) return 'fast'
  return 'balanced'
}

/** Words that carry a thread on rather than start a new subject. */
const FOLLOW_UP = /^(?:and|but|so|also|then|why|how come|what about|more|go on|continue|keep going|explain|elaborate|again|same|ok(?:ay)?|yes|no)\b/i
const RANK: Record<MessageEffort, number> = { fast: 0, balanced: 1, deep: 2 }

/**
 * THE WEIGHT OF A MESSAGE IN A CONVERSATION (Jaime, 2026-09-13: "change models
 * on the fly if a question gets harder or simpler in the same chat"). Each
 * message is weighed on its own, so the work moves up or down as the
 * questions do; only a short follow-up ("why?", "go on", "yes") keeps the
 * level the thread was last answered at, so it is never handed to a lighter
 * model in the middle of a heavier thought.
 */
export const effortInThread = (message: string, previous: MessageEffort | undefined): MessageEffort => {
  const own = effortFor(message)
  const text = String(message ?? '').trim()
  if (!previous || text.length > 160 || !FOLLOW_UP.test(text)) return own
  return RANK[previous] > RANK[own] ? previous : own
}

/** Tokens the request is likely to need: the anatomy and instructions, the
 *  transcript that travels, the message, and room for the reply. Four
 *  characters to a token is the usual estimate; it only has to rule out a
 *  model that clearly cannot hold the conversation. */
export const contextNeedFor = (transcriptChars: number, message: string, replyTokens = 4_096): number =>
  Math.ceil((Math.max(0, transcriptChars) + String(message ?? '').length + 12_000) / 4) + replyTokens
