import { llmKeyStore } from '@hypercomb/core'
import { llmActivation } from './llm-activation.js'
import { llmModelChoice } from './llm-model-choice.js'
import { llmHiveAccess } from './llm-hive-access.js'
import { llmProviderRegistry, publishService } from './llm-provider-registry.js'
import { credentialOwner } from './providers/credential-owner.js'
import { openRouterRouting, providerBlock } from './providers/openrouter-routing.js'
import { JEV_ENDPOINT, JEV_IOC_KEY, JEV_MODEL, jevInput, jevQuestions, jevResult, type JevInput, type JevResult } from './jev-decision.js'

/** A subset of material ALREADY sent to / received from this OpenRouter
 * worker. Never fetches hive content, accepts signatures to expand, or forwards
 * another provider's conversation. The user selected Jev via OpenRouter for
 * this decision workflow; the existing OpenRouter grant remains mandatory. */
export interface JevSource {
  readonly providerId: string
  readonly system: string
  readonly messages: readonly { readonly content: string }[]
}

export class JevDecisionService {
  /** Adding Jev in the model picker is the opt-in; its normal switch can revoke it. */
  enabled(): boolean {
    return llmModelChoice.saved('openrouter').includes(JEV_MODEL)
      && llmActivation.isEnabled(`openrouter:${JEV_MODEL}`)
      && llmActivation.isEnabled('openrouter') && !!llmKeyStore.get('openrouter')
  }

  ready(providerId: string): boolean {
    const provider = llmProviderRegistry().get(providerId)
    return this.enabled() && !!provider && !provider.decisionOnly && credentialOwner(provider) === 'openrouter'
      && !!llmKeyStore.get('openrouter') && llmActivation.isEnabled('openrouter')
      && llmActivation.isEnabled(providerId) && llmHiveAccess.mayRead('openrouter')
  }

  async evaluate(raw: unknown, source: JevSource, signal?: AbortSignal): Promise<JevResult> {
    signal?.throwIfAborted()
    if (!this.ready(source.providerId)) throw new Error('Jev requires a granted OpenRouter worker')
    const input = jevInput(raw)
    const contains = (text: string): boolean => source.messages.some(message => message.content.includes(text))
    // Refuse arbitrary additional material. Every field must already exist
    // verbatim in the current OpenRouter worker's system or conversation.
    const evidence = typeof input.evidence === 'string' ? [input.evidence] : input.evidence
    if (!source.system.includes(input.doctrine) || !contains(input.request) || evidence.some(part => !contains(part))
      || input.proposals.some(proposal => !contains(proposal.plan) && !contains(JSON.stringify(proposal.plan).slice(1, -1)))) throw new Error('Jev may only evaluate context already shared with this OpenRouter worker')
    if (JSON.stringify(input).length > (llmHiveAccess.budget('openrouter') ?? 24_000)) throw new Error('Jev context exceeds the OpenRouter read budget')
    const result = await this.#request(input, signal)
    if (!this.ready(source.providerId)) throw new Error('OpenRouter access changed during the decision')
    return result
  }

  /** Participant-triggered connection test, containing no hive material. */
  async test(signal?: AbortSignal): Promise<JevResult> {
    return this.#request(jevInput({
      request: 'Choose the blue circle.', doctrine: 'Follow the request.',
      evidence: 'A blue circle is available.',
      proposals: [{ id: 'blue', label: 'Blue circle', plan: 'Choose the blue circle.' }],
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
        body: JSON.stringify({ model: JEV_MODEL, state: input, questions: jevQuestions(input), ...(provider ? { provider } : {}) }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Jev decision failed (HTTP ${response.status})`)
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
