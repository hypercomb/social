// assistant/llm-model-choice.ts
//
// THE MODELS A PROVIDER OFFERS, AND WHICH ONE IS IN USE — when the
// participant chose them.
//
// An aggregator like OpenRouter reaches hundreds of models. The participant
// adds the ones they want from the console's search; each becomes one line
// under OpenRouter, and all of them use the one OpenRouter key. One of those
// lines is IN USE: `modelForTier` (model-policy.ts) asks `chosen` FIRST, so
// the in-use model answers every tier for that provider. Nothing added →
// the roster ladder, unchanged. Device-local.
//
// Naming a model in the chat still wins over this, as it always has.

import { publishService } from './llm-provider-registry.js'

export const LLM_MODEL_CHOICE_IOC_KEY = '@hypercomb.social/LlmModelChoice'

const chosenKey = (providerId: string): string => `hc:llm:${providerId}:model`
const listKey = (providerId: string): string => `hc:llm:${providerId}:models`
const clean = (value: unknown): string => String(value ?? '').trim()
const okModel = (value: string): boolean => !!value && value.length <= 200

export class LlmModelChoiceStore extends EventTarget {
  /** The model in use for this provider, or undefined for its roster. */
  chosen(providerId: string): string | undefined {
    const id = clean(providerId).toLowerCase()
    if (!id) return undefined
    try {
      const value = clean(globalThis.localStorage?.getItem(chosenKey(id)))
      return okModel(value) ? value : undefined
    } catch { return undefined }
  }

  /** Every model added for this provider, in the order added. The model in
   *  use is always among them, even if it was chosen before lists existed. */
  saved(providerId: string): readonly string[] {
    const id = clean(providerId).toLowerCase()
    if (!id) return []
    let list: string[] = []
    try {
      const raw = JSON.parse(globalThis.localStorage?.getItem(listKey(id)) ?? '[]')
      if (Array.isArray(raw)) list = raw.filter((m): m is string => typeof m === 'string' && okModel(m))
    } catch { /* unreadable ⇒ empty */ }
    const inUse = this.chosen(id)
    return inUse && !list.includes(inUse) ? [...list, inUse] : list
  }

  /** Put a model in use (or clear with undefined). Fires `change` only when it moves. */
  choose(providerId: string, modelId: string | undefined): void {
    const id = clean(providerId).toLowerCase()
    const next = clean(modelId) || undefined
    if (!id || this.chosen(id) === next) return
    try {
      if (next) globalThis.localStorage?.setItem(chosenKey(id), next)
      else globalThis.localStorage?.removeItem(chosenKey(id))
    } catch { /* session-only */ }
    this.dispatchEvent(new CustomEvent('change', { detail: { providerId: id, modelId: next } }))
  }

  /** Add a model line and put it in use. */
  add(providerId: string, modelId: string): void {
    const id = clean(providerId).toLowerCase()
    const model = clean(modelId)
    if (!id || !okModel(model)) return
    const list = this.saved(id)
    if (!list.includes(model)) this.#writeList(id, [...list, model])
    this.choose(id, model)
    this.dispatchEvent(new CustomEvent('change', { detail: { providerId: id, modelId: model } }))
  }

  /** Remove a model line. If it was in use, the first remaining line takes
   *  over — or none, and the provider falls back to its roster. */
  drop(providerId: string, modelId: string): void {
    const id = clean(providerId).toLowerCase()
    const model = clean(modelId)
    if (!id) return
    const rest = this.saved(id).filter(m => m !== model)
    this.#writeList(id, rest)
    if (this.chosen(id) === model) this.choose(id, rest[0])
    this.dispatchEvent(new CustomEvent('change', { detail: { providerId: id, modelId: undefined } }))
  }

  #writeList(providerId: string, list: readonly string[]): void {
    try {
      if (list.length) globalThis.localStorage?.setItem(listKey(providerId), JSON.stringify(list))
      else globalThis.localStorage?.removeItem(listKey(providerId))
    } catch { /* session-only */ }
  }
}

export const llmModelChoice = new LlmModelChoiceStore()

window.ioc?.register(LLM_MODEL_CHOICE_IOC_KEY, llmModelChoice)
publishService(LLM_MODEL_CHOICE_IOC_KEY, llmModelChoice)
