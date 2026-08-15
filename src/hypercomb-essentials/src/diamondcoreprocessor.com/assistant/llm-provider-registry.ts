// diamondcoreprocessor.com/assistant/llm-provider-registry.ts
//
// LlmProviderRegistry — the roster of AI vendors this hive can talk to.
//
// Pattern copied from `commands/visual-bee-registry.ts`: descriptors are
// declared in code by small per-vendor modules, one IoC singleton gathers
// them, and an EventTarget `change` lets every consumer rebuild when the
// roster moves. Nothing hardcodes a vendor list — the picker page, the
// command line's model words, the key indicators, and the dispatch seam all
// read this.
//
// ── why a registry ─────────────────────────────────────────────────────
//
// Four consumers need to enumerate providers, and they used to each keep
// their own list:
//
//   1. DISPATCH (`llm-dispatch.ts`) resolves `providerId` → descriptor →
//      adapter, and resolves a bare model name back to its provider.
//   2. The PICKER page (`/providers`, phase 3) draws one island per vendor
//      with its models clustered around it.
//   3. The COMMAND LINE offers `/opus`, `/gemini`, `/grok` — the day a
//      descriptor registers, its models are words you can type.
//   4. The KEY INDICATORS show one command-line light per configured
//      provider, so spend is never invisible.
//
// ── colour ─────────────────────────────────────────────────────────────
//
// `vendor` must be a family `presentation/avatars/agent-model.ts` knows. That
// file's VENDOR_BODY is the ONE vendor palette in this repo — a model bee
// flying over the hive and a provider tile on the picker page have to be the
// same clay. Registering an unknown vendor throws rather than silently
// getting a derived hue nobody chose, because the fix is one line in
// VENDOR_BODY and the failure mode is two colours for one company.
//
// ── usage ──────────────────────────────────────────────────────────────
//
// Registration (at module load — colocate with the vendor's adapter):
//
//     import { registerLlmProvider } from '../llm-provider-registry.js'
//     export const ANTHROPIC: LlmProviderDescriptor = { … }
//     registerLlmProvider(ANTHROPIC)
//
// Lookup:
//
//     const registry = window.ioc.get(
//       '@diamondcoreprocessor.com/LlmProviderRegistry'
//     ) as LlmProviderRegistry | undefined
//     registry?.get('anthropic')
//     registry?.providerForModel('claude-opus-4-6')
//
// You may import the TYPE relatively for typing only. NEVER instantiate
// LlmProviderRegistry yourself or import the class symbol non-type-only —
// that bundles a second copy into your bee and silently breaks the singleton.

import { KNOWN_VENDORS } from '../presentation/avatars/agent-model.js'
import type {
  LlmModelDescriptor,
  LlmProviderDescriptor,
  LlmTransport,
} from './providers/llm-provider.types.js'

export const LLM_PROVIDER_REGISTRY_IOC_KEY = '@diamondcoreprocessor.com/LlmProviderRegistry'

const TRANSPORTS: readonly LlmTransport[] = ['browser-http', 'host-relay', 'agent-bridge']

export class LlmProviderRegistry extends EventTarget {

  readonly #providers = new Map<string, LlmProviderDescriptor>()

  /**
   * Register a provider. Idempotent for the same descriptor reference
   * (hot-reload safe); a DIFFERENT object under the same id logs a warning
   * and is ignored — two modules competing for one vendor identity is a
   * programming error, not a merge.
   */
  register(provider: LlmProviderDescriptor): void {
    if (!provider?.id || typeof provider.id !== 'string') {
      throw new Error('[LlmProviderRegistry] provider.id must be a non-empty string')
    }
    if (!provider.label || typeof provider.label !== 'string') {
      throw new Error(`[LlmProviderRegistry] provider "${provider.id}" must declare a label`)
    }
    if (!KNOWN_VENDORS.includes(provider.vendor)) {
      throw new Error(
        `[LlmProviderRegistry] provider "${provider.id}" declares unknown vendor "${provider.vendor}". ` +
        `Add it to VENDOR_BODY in presentation/avatars/agent-model.ts — never mint a second palette. ` +
        `Known: ${KNOWN_VENDORS.join(', ')}`,
      )
    }
    if (!TRANSPORTS.includes(provider.transport)) {
      throw new Error(
        `[LlmProviderRegistry] provider "${provider.id}" declares unknown transport "${provider.transport}"`,
      )
    }
    if (!provider.models?.length) {
      throw new Error(`[LlmProviderRegistry] provider "${provider.id}" must declare at least one model`)
    }
    if (!provider.models.some(m => m.id === provider.defaultModel)) {
      throw new Error(
        `[LlmProviderRegistry] provider "${provider.id}" defaultModel "${provider.defaultModel}" ` +
        `is not one of its models`,
      )
    }
    if (!provider.docsUrl) {
      throw new Error(
        `[LlmProviderRegistry] provider "${provider.id}" must declare a docsUrl — ` +
        `"get your key here" is the whole guided setup`,
      )
    }
    if (typeof provider.toRequest !== 'function' || typeof provider.fromResponse !== 'function') {
      throw new Error(`[LlmProviderRegistry] provider "${provider.id}" must declare toRequest and fromResponse`)
    }

    const existing = this.#providers.get(provider.id)
    if (existing === provider) return                       // idempotent
    if (existing) {
      console.warn(`[llm-provider-registry] duplicate provider "${provider.id}" — ignoring re-registration`)
      return
    }
    this.#providers.set(provider.id, provider)
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** Unregister by id. No-op if absent. */
  unregister(id: string): void {
    if (!this.#providers.delete(id)) return
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** Every provider, in registration order. */
  all(): LlmProviderDescriptor[] {
    return [...this.#providers.values()]
  }

  /** Look up by id. */
  get(id: string): LlmProviderDescriptor | undefined {
    return this.#providers.get(String(id ?? '').trim().toLowerCase())
  }

  /** Providers on one transport — e.g. every tier that can read the hive. */
  byTransport(transport: LlmTransport): LlmProviderDescriptor[] {
    return this.all().filter(p => p.transport === transport)
  }

  /** Providers sharing a vendor colour family. */
  byVendor(vendor: string): LlmProviderDescriptor[] {
    return this.all().filter(p => p.vendor === vendor)
  }

  /** Every model on the roster, each tagged with the provider offering it. */
  models(): { provider: LlmProviderDescriptor; model: LlmModelDescriptor }[] {
    return this.all().flatMap(provider => provider.models.map(model => ({ provider, model })))
  }

  /**
   * Resolve a model NAME to its provider — the seam that lets a caller say
   * `claude-opus-4-6` (or `opus`) without naming a vendor. Exact wire id
   * first, then the human name, then a case-insensitive match on either.
   * Returns undefined rather than guessing across vendors.
   */
  providerForModel(model: string): LlmProviderDescriptor | undefined {
    const wanted = String(model ?? '').trim().toLowerCase()
    if (!wanted) return undefined
    for (const provider of this.#providers.values()) {
      if (provider.models.some(m => m.id.toLowerCase() === wanted)) return provider
    }
    for (const provider of this.#providers.values()) {
      if (provider.models.some(m => m.name.toLowerCase() === wanted)) return provider
    }
    return undefined
  }

  /**
   * Resolve a model name to its WIRE id within a provider. An unrecognised
   * name is passed through untouched — a vendor ships models faster than this
   * repo learns them, and refusing an id the participant knows is real would
   * make the roster a cage instead of a convenience.
   */
  resolveModelId(provider: LlmProviderDescriptor, model?: string): string {
    const wanted = String(model ?? '').trim()
    if (!wanted) return provider.defaultModel
    const lower = wanted.toLowerCase()
    const hit =
      provider.models.find(m => m.id.toLowerCase() === lower)
      ?? provider.models.find(m => m.name.toLowerCase() === lower)
    return hit?.id ?? wanted
  }
}

// Singleton: one instance per app, registered with window.ioc so every
// consumer (across bees, namespaces) shares it.
const _llmProviderRegistry = new LlmProviderRegistry()
window.ioc.register(LLM_PROVIDER_REGISTRY_IOC_KEY, _llmProviderRegistry)

/**
 * Resolve the singleton. Prefers the shell registry (what every other module
 * sees) and falls back to the module-local instance for node-side tests where
 * no shell has booted.
 */
export const llmProviderRegistry = (): LlmProviderRegistry =>
  (window.ioc?.get?.(LLM_PROVIDER_REGISTRY_IOC_KEY) as LlmProviderRegistry | undefined)
  ?? _llmProviderRegistry

/** Colocation helper — what a vendor adapter calls at module load. */
export const registerLlmProvider = (provider: LlmProviderDescriptor): void => {
  llmProviderRegistry().register(provider)
}
