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
    const contains = (part: string): boolean => source.messages.some(message =>
      message.content.includes(part) || message.content.includes(JSON.stringify(part).slice(1, -1)))
    // Refuse arbitrary additional material. Every field must already exist
    // verbatim in the worker's system text or conversation.
    if (!source.system.includes(input.doctrine) || !contains(input.request) || input.evidence.some(part => !contains(part))
      || input.rows.some(row => !contains(row.label) || row.lines.some(line => !contains(line)) || (row.why && !contains(row.why))))
      throw new Error('Jev may only judge context already shared with this worker')
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
