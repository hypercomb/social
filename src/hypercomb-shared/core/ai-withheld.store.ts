// hypercomb-shared/core/ai-withheld.store.ts
//
// WHAT AN OUTSIDE MODEL MAY NOT READ.
//
// Some tiles are about people and are nobody else's business — jwize's
// `susan` and `howard` are about a family member's recovery. The rule that
// their contents never go to an outside model lived only in an assistant's
// notes, so nothing enforced it: told "never open susan or howard", a hive
// model's first two reads were `list susan` and `read /howard` (the
// housekeeping manager's report, 2026-10-01). An instruction is not a guard.
//
// This is the guard's list: routes the participant withholds. The chat's read
// step (chat-window `runRead`) refuses a read at or under one for every
// provider except the participant's own local model, and leaves withheld
// tiles out of what a tree or a find returns. The names stay visible where
// a parent lists its children — that a tile exists is not its contents.
//
// One current document in the `ai:withheld` pool, per participant, never
// replicated (core/pool-kinds.ts). Managed with the `withhold` word.
import '@hypercomb/runtime/ioc.web'
import { EffectBus } from '@hypercomb/core'
import { ParticipantDocument, type ParticipantDocumentOptions } from './participant-document'

export const AI_WITHHELD_MEANING = 'ai:withheld'
export const AI_WITHHELD_IOC_KEY = '@hypercomb.social/AiWithheld'

/** A route as it is compared: lower-case segments, no empty parts. */
const segmentsOf = (route: string | readonly string[]): string[] =>
  (Array.isArray(route) ? route : String(route ?? '').split('/'))
    .map(part => String(part ?? '').trim().toLowerCase())
    .filter(Boolean)

const keyOf = (segments: readonly string[]): string => `/${segments.join('/')}`

const parse = (raw: unknown): string[] | null => {
  if (!Array.isArray(raw)) return null
  const out = new Set<string>()
  for (const entry of raw) {
    const segments = segmentsOf(String(entry ?? ''))
    if (segments.length) out.add(keyOf(segments))
  }
  return [...out].sort()
}

export class AiWithheldStore extends EventTarget {
  readonly #doc: ParticipantDocument<string[]>

  constructor(io: Pick<ParticipantDocumentOptions<string[]>, 'whenStore'> = {}) {
    super()
    this.#doc = new ParticipantDocument<string[]>({
      meaning: AI_WITHHELD_MEANING, parse, empty: [], whenStore: io.whenStore,
    })
    this.#doc.addEventListener('change', () => this.dispatchEvent(new CustomEvent('change')))
  }

  /** Every withheld route, sorted. */
  list(): readonly string[] { return [...this.#doc.value] }

  /** Is this location withheld — the route itself or anything under it? */
  covers(segments: readonly string[]): boolean {
    const here = segmentsOf(segments)
    if (!here.length) return false
    return this.#doc.value.some(route => {
      const held = segmentsOf(route)
      return held.length <= here.length && held.every((part, at) => part === here[at])
    })
  }

  /** Withhold a route. True when it was not withheld before. */
  add(route: string | readonly string[]): boolean {
    const segments = segmentsOf(route)
    if (!segments.length) return false
    const key = keyOf(segments)
    if (this.#doc.value.includes(key)) return false
    this.#doc.write([...this.#doc.value, key].sort())
    this.dispatchEvent(new CustomEvent('change'))
    return true
  }

  /** Stop withholding a route. True when it was withheld. */
  remove(route: string | readonly string[]): boolean {
    const key = keyOf(segmentsOf(route))
    if (!this.#doc.value.includes(key)) return false
    this.#doc.write(this.#doc.value.filter(entry => entry !== key))
    this.dispatchEvent(new CustomEvent('change'))
    return true
  }
}

export const aiWithheld = new AiWithheldStore()
register(AI_WITHHELD_IOC_KEY, aiWithheld)

// The `withhold` word lives in essentials and may not import the shell: it
// asks over the bus, and this store answers on the same bus.
EffectBus.on<{ op?: string; route?: string }>('ai:withhold', request => {
  const route = String(request?.route ?? '').trim()
  const op = request?.op
  const changed = op === 'add' ? aiWithheld.add(route) : op === 'remove' ? aiWithheld.remove(route) : false
  EffectBus.emit('ai:withheld', { routes: aiWithheld.list(), ...(op ? { op, route, changed } : {}) })
})
