// assistant/llm-hive-access.ts
//
// THE GATE. Which providers may READ the hive — receive the observation
// tool, and with it tree data — beyond the participant's own local model.
// Design: documentation/anatomy-context-need.md §4.
//
// Off for every provider until the participant turns it on, in the console,
// per provider. Nothing here ever turns itself on: not a probe, not a spec,
// not naming a model in the chat. Naming picks WHO ANSWERS; this decides
// WHAT THEY MAY SEE, and the two stay separate so a slip of the tongue can
// never ship a subtree to a vendor. Device-local, like the key it pairs with.
// Peer-lent models are refused at this door regardless of the flag: a peer
// is someone else's machine.

import { publishService } from './llm-provider-registry.js'

export const LLM_HIVE_ACCESS_IOC_KEY = '@hypercomb.social/LlmHiveAccess'

const KEY_PREFIX = 'hc:llm:'
const KEY_SUFFIX = ':hive'
const storageKey = (providerId: string): string => `${KEY_PREFIX}${providerId}${KEY_SUFFIX}`

export type LlmHiveAccessLike = {
  /** May this provider receive the observation tool? Never true for a peer. */
  mayRead(providerId: string): boolean
  /** The participant's decision, made in the console. Sticky. */
  setMayRead(providerId: string, allowed: boolean): void
  /** Every provider id the participant has granted, for the shell's routing. */
  granted(): readonly string[]
  /** How many characters of hive content may leave the machine per
   *  conversation through this provider — undefined means the shell's
   *  default. The only privacy control that is a number, not a promise. */
  budget(providerId: string): number | undefined
  setBudget(providerId: string, chars: number | undefined): void
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}

export class LlmHiveAccessStore extends EventTarget implements LlmHiveAccessLike {
  readonly #granted = new Set<string>()

  constructor() {
    super()
    try {
      const storage = globalThis.localStorage
      for (let i = 0; i < (storage?.length ?? 0); i++) {
        const key = storage.key(i) ?? ''
        if (key.startsWith(KEY_PREFIX) && key.endsWith(KEY_SUFFIX) && storage.getItem(key) === '1') {
          this.#granted.add(key.slice(KEY_PREFIX.length, -KEY_SUFFIX.length))
        }
      }
    } catch { /* session-only */ }
  }

  mayRead(providerId: string): boolean {
    const id = String(providerId ?? '').trim().toLowerCase()
    return !!id && !id.startsWith('peer:') && this.#granted.has(id)
  }

  setMayRead(providerId: string, allowed: boolean): void {
    const id = String(providerId ?? '').trim().toLowerCase()
    if (!id || this.#granted.has(id) === allowed) return
    if (allowed) this.#granted.add(id)
    else this.#granted.delete(id)
    try {
      if (allowed) globalThis.localStorage?.setItem(storageKey(id), '1')
      else globalThis.localStorage?.removeItem(storageKey(id))
    } catch { /* session-only */ }
    this.dispatchEvent(new CustomEvent('change'))
  }

  granted(): readonly string[] {
    return [...this.#granted].filter(id => this.mayRead(id))
  }

  budget(providerId: string): number | undefined {
    const id = String(providerId ?? '').trim().toLowerCase()
    if (!id) return undefined
    try {
      const raw = globalThis.localStorage?.getItem(budgetKey(id))
      const chars = raw ? Number(raw) : NaN
      return Number.isFinite(chars) && chars >= MIN_BUDGET ? Math.min(chars, MAX_BUDGET) : undefined
    } catch { return undefined }
  }

  setBudget(providerId: string, chars: number | undefined): void {
    const id = String(providerId ?? '').trim().toLowerCase()
    if (!id) return
    const next = chars !== undefined && Number.isFinite(chars) && chars >= MIN_BUDGET
      ? Math.min(Math.floor(chars), MAX_BUDGET)
      : undefined
    if (this.budget(id) === next) return
    try {
      if (next === undefined) globalThis.localStorage?.removeItem(budgetKey(id))
      else globalThis.localStorage?.setItem(budgetKey(id), String(next))
    } catch { /* session-only */ }
    this.dispatchEvent(new CustomEvent('change'))
  }
}

const BUDGET_SUFFIX = ':budget'
const budgetKey = (providerId: string): string => `${KEY_PREFIX}${providerId}${BUDGET_SUFFIX}`
/** Below this a single `/read` cannot fit; above it the point of a budget is lost. */
export const MIN_BUDGET = 2_000
export const MAX_BUDGET = 200_000

export const llmHiveAccess = new LlmHiveAccessStore()

// Both lines: the first is what `prepare` looks for to load this module at
// all; the second survives the early `window.ioc` map being replaced.
window.ioc?.register(LLM_HIVE_ACCESS_IOC_KEY, llmHiveAccess)
publishService(LLM_HIVE_ACCESS_IOC_KEY, llmHiveAccess)
