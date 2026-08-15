// diamondcoreprocessor.com/assistant/providers/local.provider.ts
//
// A MODEL RUNNING ON YOUR OWN MACHINE. Ollama serves the OpenAI shape on
// localhost:11434, so the adapter is the shared one — but two fields make
// this descriptor different in kind from the six vendor ones:
//
//   requiresKey: false   there is nobody to bill, so there is no key to ask
//                        for, and the guided-setup step is skipped entirely.
//   endpoint             a HOST the participant may move. The override lives
//                        in localStorage, never in a layer — the address of
//                        someone's own machine is device-local truth in the
//                        same way a credential is.
//
// The model list is a starting suggestion, not a catalog: what is installed
// is whatever the participant pulled, and `resolveModelId` passes an
// unrecognised name straight through for exactly this case.

import { registerLlmProvider } from '../llm-provider-registry.js'
import type { LlmProviderDescriptor } from './llm-provider.types.js'
import { openAiRequest, openAiResponse, openAiStreamEvent } from './openai-shape.js'

export const LOCAL_HOST_STORAGE_KEY = 'hc:llm:local:host'
const DEFAULT_HOST = 'http://localhost:11434'

/** The participant's local server, or Ollama's default port. */
export const localLlmHost = (): string => {
  try {
    const stored = (globalThis.localStorage?.getItem(LOCAL_HOST_STORAGE_KEY) ?? '').trim()
    if (stored) return stored.replace(/\/+$/, '')
  } catch { /* storage unavailable — the default is right often enough */ }
  return DEFAULT_HOST
}

export const LOCAL_PROVIDER: LlmProviderDescriptor = {
  id: 'local',
  label: 'Local model',
  vendor: 'local',
  transport: 'browser-http',
  endpoint: DEFAULT_HOST,
  requiresKey: false,
  models: [
    { name: 'llama-70b', id: 'llama3.1:70b', tier: 'deep' },
    { name: 'llama', id: 'llama3.1', tier: 'balanced' },
    { name: 'llama-8b', id: 'llama3.1:8b', tier: 'fast' },
  ],
  defaultModel: 'llama3.1',
  docsUrl: 'https://ollama.com/download',
  // No Authorization header: a local server has no account behind it, and
  // sending `Bearer ` with an empty key makes some builds reject the call.
  toRequest: request => openAiRequest(`${localLlmHost()}/v1/chat/completions`, request, () => ({})),
  fromResponse: openAiResponse,
  fromStreamEvent: openAiStreamEvent,
}

registerLlmProvider(LOCAL_PROVIDER)
