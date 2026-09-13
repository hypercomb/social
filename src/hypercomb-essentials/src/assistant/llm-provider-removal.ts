// assistant/llm-provider-removal.ts
//
// PROVIDERS THE PARTICIPANT REMOVED. There was no way to take an endpoint
// off the providers list (Jaime, 2026-09-13). Doctrine is hide first, delete
// second: a removed provider leaves the console and is switched off (the
// console does that through llm-activation), but nothing is destroyed — its
// descriptor stays registered, its key stays until Clear, and Restore at the
// foot of its tab puts it all back. Device-local, like the key it pairs with.

import { publishService } from './llm-provider-registry.js'

export const LLM_PROVIDER_REMOVAL_IOC_KEY = '@hypercomb.social/LlmProviderRemoval'
const STORAGE_KEY = 'hc:llm:removed'
const clean = (id: unknown): string => String(id ?? '').trim().toLowerCase()

export class LlmProviderRemovalStore extends EventTarget {
  #read(): string[] {
    try {
      const value = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '[]')
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
    } catch { return [] }
  }

  #write(ids: readonly string[]): void {
    try {
      if (ids.length) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(ids))
      else globalThis.localStorage?.removeItem(STORAGE_KEY)
    } catch { /* session-only */ }
    this.dispatchEvent(new CustomEvent('change'))
  }

  isRemoved(providerId: string): boolean {
    const id = clean(providerId)
    return !!id && this.#read().includes(id)
  }

  removed(): readonly string[] { return this.#read() }

  remove(providerId: string): void {
    const id = clean(providerId)
    const ids = this.#read()
    if (id && !ids.includes(id)) this.#write([...ids, id])
  }

  restore(providerId: string): void {
    const id = clean(providerId)
    const ids = this.#read()
    if (ids.includes(id)) this.#write(ids.filter(other => other !== id))
  }
}

export const llmProviderRemoval = new LlmProviderRemovalStore()

window.ioc?.register(LLM_PROVIDER_REMOVAL_IOC_KEY, llmProviderRemoval)
publishService(LLM_PROVIDER_REMOVAL_IOC_KEY, llmProviderRemoval)
