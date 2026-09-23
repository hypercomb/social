import { llmKeyStore } from '@hypercomb/core'
import { llmActivation } from './llm-activation.js'
import { llmModelChoice } from './llm-model-choice.js'
import { llmHiveAccess } from './llm-hive-access.js'
import { llmProviderRegistry } from './llm-provider-registry.js'
import { openRouterRouting, providerBlock } from './providers/openrouter-routing.js'
import { JEV_ENDPOINT, JEV_IOC_KEY, JEV_MODEL, jevInput, jevQuestions, jevResult, jevState, type JevInput, type JevResult } from './jev-decision.js'
import type { JevDirectInput } from './jev-direct.js'
import { jevFrontInput, jevFrontQuestions, jevFrontResult, jevFrontState, type JevFrontResult } from './jev-front.js'
import { jevVerifyInput, jevVerifyQuestions, jevVerifyResult, type JevVerifyResult } from './jev-verify.js'
import { jevFileInput, jevFileQuestions, jevFileResult, type JevFileResult } from './jev-file.js'

/** A subset of material ALREADY sent to / received from the worker whose
 * table is being judged. Never fetches hive content, accepts signatures to
 * expand, or forwards anything the worker did not see. */
export interface JevSource {
  readonly providerId: string
  readonly system: string
  readonly messages: readonly { readonly content: string }[]
}

/** A refusal at the source boundary or the budget: Jev is there, but this
 *  packet may not go to it, so the chat asks the participant. Any other
 *  failure means Jev is not there, and the regular model carries on
 *  (documentation/jev-decisions.md §5d). */
const boundary = (message: string): Error => Object.assign(new Error(message), { name: 'JevBoundaryError' })

/** THE SOURCE BOUNDARY. Every field must already exist in the worker's system
 * text or conversation; nothing new reaches Jev. Compared as the worker could
 * have written it: verbatim, JSON-escaped (a table is JSON in an assistant
 * turn), or without the leading slash the hive adds to canonical grammar.
 * Returns the first field it cannot find, in words, or null when all are seen. */
export const jevUnseen = (input: JevInput, source: JevSource): string | null => {
  const forms = (part: string): string[] => {
    const bare = part.replace(/^\//, '')
    return [...new Set([part, bare, JSON.stringify(part).slice(1, -1), JSON.stringify(bare).slice(1, -1)])]
  }
  const seen = (part: string): boolean =>
    forms(part).some(form => source.messages.some(message => message.content.includes(form)))
  const section = input.doctrine.findIndex(part => !source.system.includes(part))
  if (section >= 0) return `doctrine section ${section + 1}`
  if (!seen(input.request)) return 'the request'
  const evidence = input.evidence.findIndex(part => !seen(part))
  if (evidence >= 0) return `evidence ${evidence + 1}`
  for (const row of input.rows) {
    if (!seen(row.label)) return `the label of row ${row.id}`
    const line = row.lines.find(part => !seen(part))
    if (line !== undefined) return `the line "${line.slice(0, 80)}" of row ${row.id}`
    if (row.why && !seen(row.why)) return `the why of row ${row.id}`
  }
  return null
}

/** THE BOUNDARY FOR THE DIRECT PATH. No worker has spoken yet, so the source
 *  is what the participant said, the census catalogue the worker WOULD be sent,
 *  and the page's tile names under the OpenRouter read grant. Every behaviour
 *  must be verbatim in that catalogue, every tile in the listing, every span a
 *  part of the request (checked in jevDirectInput). */
export const jevDirectUnseen = (input: JevDirectInput, source: JevSource): string | null => {
  const seen = (part: string): boolean => source.messages.some(message => message.content.includes(part))
  if (!seen(input.request)) return 'the request'
  const behaviour = input.behaviours.find(b => !source.system.includes(`/${b.name}`) || !source.system.includes(b.description))
  if (behaviour) return `the behaviour ${behaviour.name}`
  const tile = input.tiles.find(t => !seen(t))
  if (tile !== undefined) return `the tile "${tile.slice(0, 60)}"`
  return null
}

/** JEV SERVES THE WHOLE PROVIDER SUITE. Any worker — local, direct vendor,
 * OpenRouter — lists the possibilities; Jev, reached through OpenRouter,
 * decides. The one disclosure gate is therefore OpenRouter's own "may read
 * the hive" grant: what a worker read of the hive travels to Jev only when
 * the participant already lets OpenRouter read it. */
export class JevDecisionService {
  /** Adding Jev in the model picker is the opt-in; its normal switch can revoke it. */
  enabled(): boolean {
    return llmModelChoice.saved('openrouter').includes(JEV_MODEL)
      && llmActivation.isEnabled(`openrouter:${JEV_MODEL}`)
      && llmActivation.isEnabled('openrouter') && !!llmKeyStore.get('openrouter')
  }

  ready(providerId: string): boolean {
    const provider = llmProviderRegistry().get(providerId)
    return this.enabled() && !!provider && !provider.decisionOnly
      && llmActivation.isEnabled(providerId) && llmHiveAccess.mayRead('openrouter')
  }

  async evaluate(raw: unknown, source: JevSource, signal?: AbortSignal): Promise<JevResult> {
    signal?.throwIfAborted()
    if (!this.ready(source.providerId)) throw new Error('Jev requires an enabled worker and the OpenRouter hive read grant')
    const input = jevInput(raw)
    const missing = jevUnseen(input, source)
    if (missing) throw boundary(`Jev may only judge what this worker already saw, and it could not find ${missing} as written`)
    if (JSON.stringify(jevState(input)).length > (llmHiveAccess.budget('openrouter') ?? 24_000)) throw boundary('Jev context exceeds the OpenRouter read budget')
    const result = await this.#request(input, signal)
    if (!this.ready(source.providerId)) throw new Error('OpenRouter access changed during the decision')
    return result
  }

  /** THE FRONT DOOR (jev-front.ts): one call per message, before any worker
   *  is asked — is it one census step (the direct path), does it need the
   *  hive at all, and how much thinking does it need? */
  async front(raw: unknown, source: JevSource, signal?: AbortSignal): Promise<JevFrontResult> {
    signal?.throwIfAborted()
    if (!this.ready(source.providerId)) throw new Error('Jev requires an enabled worker and the OpenRouter hive read grant')
    const input = jevFrontInput(raw)
    const missing = input.direct ? jevDirectUnseen(input.direct, source)
      : source.messages.some(message => message.content.includes(input.request)) ? null : 'the request'
    if (missing) throw boundary(`Jev may only judge what the participant said and the hive listed, and it could not find ${missing} as written`)
    // The whole turn waits on the door, and Jev answers in well under a
    // second; past JEV_FRONT_TIMEOUT_MS the turn goes on without it.
    const result = await this.#post({ state: jevFrontState(input), questions: jevFrontQuestions(input) }, body => jevFrontResult(body, input), signal, JEV_FRONT_TIMEOUT_MS)
    if (!this.ready(source.providerId)) throw new Error('OpenRouter access changed during the decision')
    return result
  }

  /** JEV CHECKS THE ANSWER (jev-verify.ts): is the worker's final answer
   *  supported by what the hive read, and complete? The answer, the request
   *  and every piece of evidence must already be in the worker's exchange. */
  async verify(raw: unknown, source: JevSource, signal?: AbortSignal): Promise<JevVerifyResult> {
    signal?.throwIfAborted()
    if (!this.ready(source.providerId)) throw new Error('Jev requires an enabled worker and the OpenRouter hive read grant')
    const input = jevVerifyInput(raw)
    const seen = (part: string): boolean => source.messages.some(message => message.content.includes(part))
    const missing = !seen(input.request) ? 'the request' : !seen(input.answer) ? 'the answer'
      : input.evidence.findIndex(part => !seen(part)) >= 0 ? `evidence ${input.evidence.findIndex(part => !seen(part)) + 1}` : null
    if (missing) throw boundary(`Jev may only judge what this worker already saw, and it could not find ${missing} as written`)
    if (JSON.stringify(input).length > (llmHiveAccess.budget('openrouter') ?? 24_000) + 8_000) throw boundary('Jev verification exceeds the OpenRouter read budget')
    const result = await this.#post({ state: input, questions: jevVerifyQuestions() }, jevVerifyResult, signal)
    if (!this.ready(source.providerId)) throw new Error('OpenRouter access changed during the decision')
    return result
  }

  /** For a word the participant says directly (no worker): Jev switched on,
   *  and OpenRouter allowed to read the hive, because hive names travel. */
  readyForHive(): boolean {
    return this.enabled() && llmHiveAccess.mayRead('openrouter')
  }

  /** JEV FILES A NOTE (jev-file.ts): which tile on this page does the
   *  participant's note belong under? Only their words and the page's tile
   *  names travel; the answer only chooses where to write. */
  async place(raw: unknown, signal?: AbortSignal): Promise<JevFileResult> {
    signal?.throwIfAborted()
    if (!this.readyForHive()) throw new Error('Filing needs Jev switched on and OpenRouter allowed to read the hive')
    const input = jevFileInput(raw)
    const result = await this.#post({ state: input, questions: jevFileQuestions(input) }, body => jevFileResult(body, input), signal)
    if (!this.readyForHive()) throw new Error('OpenRouter access changed during the decision')
    return result
  }

  /** Participant-triggered connection test, containing no hive material. */
  async test(signal?: AbortSignal): Promise<JevResult> {
    return this.#request(jevInput({
      request: 'Choose the blue circle.', doctrine: 'Follow the request.',
      evidence: 'A blue circle and a red circle are available.',
      rows: [
        { id: 'blue', kind: 'do', label: 'Blue circle', lines: ['choose blue'] },
        { id: 'red', kind: 'do', label: 'Red circle', lines: ['choose red'] },
      ],
    }), signal)
  }

  async #request(input: JevInput, signal?: AbortSignal): Promise<JevResult> {
    return this.#post({ state: jevState(input), questions: jevQuestions(input) }, body => jevResult(body, input), signal)
  }

  async #post<T>(packet: { state: unknown; questions: unknown }, parse: (body: unknown) => T, signal?: AbortSignal, timeoutMs = 20_000): Promise<T> {
    signal?.throwIfAborted()
    if (!this.enabled()) throw new Error('Add and enable Jev Latest with an OpenRouter key first')
    const key = llmKeyStore.get('openrouter')
    const provider = providerBlock(openRouterRouting.get(), JEV_MODEL)
    const controller = new AbortController()
    const cancel = (): void => controller.abort(signal?.reason)
    signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('Jev decision timed out')), timeoutMs)
    try {
      const response = await fetch(JEV_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: JEV_MODEL, state: packet.state, questions: packet.questions, ...(provider ? { provider } : {}) }),
        signal: controller.signal,
      })
      if (!response.ok) {
        let detail = ''
        try {
          const error = await response.json() as { error?: { message?: unknown } }
          if (typeof error?.error?.message === 'string') detail = error.error.message.slice(0, 500)
        } catch { /* HTTP status remains actionable without a JSON body. */ }
        throw new Error(`Jev decision failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`)
      }
      const result = parse(await response.json())
      controller.signal.throwIfAborted()
      if (!this.enabled() || llmKeyStore.get('openrouter') !== key) throw new Error('OpenRouter access changed during the decision')
      return result
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
  }
}

/** How long a turn waits at the front door before running without Jev. */
export const JEV_FRONT_TIMEOUT_MS = 5_000

// No completed-result cache across turns: a rolling model alias can change.
export const jevDecision = new JevDecisionService()
