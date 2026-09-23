// assistant/providers/builtin-providers.ts
//
// THE ROSTER THAT SHIPS. Every vendor adapter that comes in the box, in the
// order the registry keeps them. The descriptors are data; the llm bee
// (llm.drone.ts) calls `startBuiltinLlmProviders()` once, and that is the one
// act that registers them (atomic-modules-plan.md: a dependency never
// registers — the bee does).
//
// Adding a vendor is one import and one list entry here plus its descriptor
// file — nothing else in the codebase learns the name.

import { registerLlmProvider } from '../llm-provider-registry.js'
import type { LlmProviderDescriptor } from './llm-provider.types.js'
import { ANTHROPIC_PROVIDER } from './anthropic.provider.js'
import { OPENAI_PROVIDER } from './openai.provider.js'
import { GOOGLE_PROVIDER } from './google.provider.js'
import { XAI_PROVIDER } from './xai.provider.js'
import { DEEPSEEK_PROVIDER } from './deepseek.provider.js'
import { MISTRAL_PROVIDER } from './mistral.provider.js'
import { OPENROUTER_PROVIDER } from './openrouter.provider.js'
import { LOCAL_PROVIDER } from './local.provider.js'
// Not a vendor: one provider per model added through OpenRouter.
import { watchOpenRouterInstances } from './openrouter-instances.js'
// Not a vendor either: the heartbeat that asks the machine's own model server
// whether it is actually running.
import { startLocalLivenessWatch } from './local-liveness.js'
// Not a vendor: the sweep that adds every DISCOVERED provider (specs in the
// `llm:providers` pool) to the same roster, the moment the store is ready.
import { startProviderDiscovery } from './provider-discovery.js'

/** The vendors, in the order the Providers console lists them. */
export const BUILTIN_LLM_PROVIDERS: readonly LlmProviderDescriptor[] = [
  ANTHROPIC_PROVIDER,
  OPENAI_PROVIDER,
  GOOGLE_PROVIDER,
  XAI_PROVIDER,
  DEEPSEEK_PROVIDER,
  MISTRAL_PROVIDER,
  OPENROUTER_PROVIDER,
]

let started = false

/** Register the roster, once: the vendors, then the OpenRouter instances
 *  after their configurator, then the machine's own model. The liveness
 *  watch starts after every descriptor so its first sweep sees the whole
 *  roster; discovery adds what the pool holds last. */
export const startBuiltinLlmProviders = (): void => {
  if (started) return
  started = true
  for (const provider of BUILTIN_LLM_PROVIDERS) registerLlmProvider(provider)
  watchOpenRouterInstances()
  registerLlmProvider(LOCAL_PROVIDER)
  startLocalLivenessWatch()
  startProviderDiscovery()
}
