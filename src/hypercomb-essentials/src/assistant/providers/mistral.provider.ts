// assistant/providers/mistral.provider.ts
//
// Mistral. OpenAI-shaped, on Mistral's host.

import { registerLlmProvider } from '../llm-provider-registry.js'
import type { LlmProviderDescriptor } from './llm-provider.types.js'
import { openAiRequest, openAiResponse, openAiStreamEvent } from './openai-shape.js'

const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions'

export const MISTRAL_PROVIDER: LlmProviderDescriptor = {
  id: 'mistral',
  label: 'Mistral',
  vendor: 'mistral',
  transport: 'browser-http',
  endpoint: ENDPOINT,
  models: [
    { name: 'mistral-large', id: 'mistral-large-latest', tier: 'deep' },
    { name: 'mistral', id: 'mistral-medium-latest', tier: 'balanced' },
    { name: 'mistral-small', id: 'mistral-small-latest', tier: 'fast' },
  ],
  defaultModel: 'mistral-medium-latest',
  docsUrl: 'https://console.mistral.ai/api-keys',
  toRequest: request => openAiRequest(ENDPOINT, request),
  fromResponse: openAiResponse,
  fromStreamEvent: openAiStreamEvent,
}

registerLlmProvider(MISTRAL_PROVIDER)
