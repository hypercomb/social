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
/** Words that mean working on code: reading it, finding why it fails,
 *  changing it. That is the strongest model's work, never the lightest's. */
const CODE_WORDS = /\b(code|coding|module|modules|bug|bugs|debug\w*|diagnos\w*|broken|crash\w*|exception|stack ?trace|regression|preload\w*|agentic)\b/i

export const effortFor = (message: string): MessageEffort => {
  const text = String(message ?? '').trim()
  const lines = text.split('\n').filter(line => line.trim()).length
  if (text.length >= 600 || lines >= 3 || DEEP_WORDS.test(text) || CODE_WORDS.test(text)) return 'deep'
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

/**
 * CODE WORK IS DEEP WORK. Once a conversation has read the hive's code,
 * "okay find it" or "read what you need and do the work" is the same job
 * going on, not a lighter question — every message in it goes to the
 * strongest model, whatever the words or Jev's weight say.
 */
export const effortForWork = (tier: MessageEffort, codeWork: boolean): MessageEffort => codeWork ? 'deep' : tier

/** A message that is itself about code. Jev's weight replaces the word list
 *  when Jev is sure, and it weighed "fix these two bugs in the engine draft"
 *  as lighter work — so the cheap line took it, went busy, and the turn died
 *  with the deep line never asked (jwize's drive session, 2026-10-01). Code
 *  named in the message keeps the work deep, whatever the weight says. */
export const isCodeMessage = (message: string): boolean => CODE_WORDS.test(String(message ?? ''))

/**
 * THE WEIGHT JEV READ (essentials jev-front.ts). When Jev is on, it weighs the
 * request in any language, and when it is sure its weight replaces the word
 * list above; unsure, the word list stands. A request Jev reads as only
 * continuing the thread never drops below the thread's weight.
 */
export const effortFromJev = (
  own: MessageEffort,
  jev: { readonly weight?: MessageEffort; readonly carry: boolean },
  previous: MessageEffort | undefined,
): MessageEffort => {
  const weight = jev.weight ?? own
  return jev.carry && previous && RANK[previous] > RANK[weight] ? previous : weight
}

/** Tokens the request is likely to need: the anatomy and instructions, the
 *  transcript that travels, the message, and room for the reply. Four
 *  characters to a token is the usual estimate; it only has to rule out a
 *  model that clearly cannot hold the conversation. */
export const contextNeedFor = (transcriptChars: number, message: string, replyTokens = 4_096): number =>
  Math.ceil((Math.max(0, transcriptChars) + String(message ?? '').length + 12_000) / 4) + replyTokens
