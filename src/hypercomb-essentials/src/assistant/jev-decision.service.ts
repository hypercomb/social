import { llmKeyStore } from '@hypercomb/core'
import { llmActivation } from './llm-activation.js'
import { llmModelChoice } from './llm-model-choice.js'
import { llmHiveAccess } from './llm-hive-access.js'
import { llmProviderRegistry, publishService } from './llm-provider-registry.js'
import { openRouterRouting, providerBlock } from './providers/openrouter-routing.js'
import { JEV_ENDPOINT, JEV_IOC_KEY, JEV_MODEL, jevInput, jevQuestions, jevResult, jevState, type JevInput, type JevResult } from './jev-decision.js'

/** A subset of material ALREADY sent to / received from the worker whose
 * table is being judged. Never fetches hive content, accepts signatures to
 * expand, or forwards anything the worker did not see. */
export interface JevSource {
  readonly providerId: string
  readonly system: string
  readonly messages: readonly { readonly content: string }[]
}

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
  if (!source.system.includes(input.doctrine)) return 'the doctrine'
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
    if (missing) throw new Error(`Jev may only judge what this worker already saw, and it could not find ${missing} as written`)
    if (JSON.stringify(jevState(input)).length > (llmHiveAccess.budget('openrouter') ?? 24_000)) throw new Error('Jev context exceeds the OpenRouter read budget')
    const result = await this.#request(input, signal)
    if (!this.ready(source.providerId)) throw new Error('OpenRouter access changed during the decision')
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
    signal?.throwIfAborted()
    if (!this.enabled()) throw new Error('Add and enable Jev Latest with an OpenRouter key first')
    const key = llmKeyStore.get('openrouter')
    const provider = providerBlock(openRouterRouting.get(), JEV_MODEL)
    const controller = new AbortController()
    const cancel = (): void => controller.abort(signal?.reason)
    signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('Jev decision timed out')), 20_000)
    try {
      const response = await fetch(JEV_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: JEV_MODEL, state: jevState(input), questions: jevQuestions(input), ...(provider ? { provider } : {}) }),
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
      const result = jevResult(await response.json(), input)
      controller.signal.throwIfAborted()
      if (!this.enabled() || llmKeyStore.get('openrouter') !== key) throw new Error('OpenRouter access changed during the decision')
      return result
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
  }
}

// No completed-result cache across turns: a rolling model alias can change.
export const jevDecision = new JevDecisionService()
window.ioc?.register(JEV_IOC_KEY, jevDecision)
publishService(JEV_IOC_KEY, jevDecision)
