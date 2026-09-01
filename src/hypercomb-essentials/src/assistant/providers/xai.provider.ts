// assistant/providers/xai.provider.ts
//
// Grok. OpenAI-shaped wire format on xAI's own host.

import { registerLlmProvider } from '../llm-provider-registry.js'
import type { LlmProviderDescriptor } from './llm-provider.types.js'
import { openAiRequest, openAiResponse, openAiStreamEvent } from './openai-shape.js'

const ENDPOINT = 'https://api.x.ai/v1/chat/completions'

export const XAI_PROVIDER: LlmProviderDescriptor = {
  id: 'xai',
  label: 'Grok',
  vendor: 'xai',
  transport: 'browser-http',
  endpoint: ENDPOINT,
  models: [
    { name: 'grok', id: 'grok-4', tier: 'deep' },
    { name: 'grok-3', id: 'grok-3', tier: 'balanced' },
    { name: 'grok-mini', id: 'grok-3-mini', tier: 'fast' },
  ],
  defaultModel: 'grok-4',
  docsUrl: 'https://console.x.ai',
  keyPattern: /^xai-[A-Za-z0-9_-]{20,}$/,
  toRequest: request => openAiRequest(ENDPOINT, request),
  fromResponse: openAiResponse,
  fromStreamEvent: openAiStreamEvent,
}

registerLlmProvider(XAI_PROVIDER)
