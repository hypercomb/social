// diamondcoreprocessor.com/assistant/providers/openai.provider.ts
//
// ChatGPT. The vendor whose wire format the others copied, so the whole
// adapter is `openai-shape.ts` and this file is pure declaration.

import { registerLlmProvider } from '../llm-provider-registry.js'
import type { LlmProviderDescriptor } from './llm-provider.types.js'
import { openAiRequest, openAiResponse, openAiStreamEvent } from './openai-shape.js'

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

export const OPENAI_PROVIDER: LlmProviderDescriptor = {
  id: 'openai',
  label: 'ChatGPT',
  vendor: 'openai',
  transport: 'browser-http',
  endpoint: ENDPOINT,
  models: [
    { name: 'o3', id: 'o3', tier: 'deep' },
    { name: 'gpt', id: 'gpt-4o', tier: 'balanced' },
    { name: 'gpt-mini', id: 'gpt-4o-mini', tier: 'fast' },
  ],
  defaultModel: 'gpt-4o',
  docsUrl: 'https://platform.openai.com/api-keys',
  keyPattern: /^sk-[A-Za-z0-9_-]{20,}$/,
  toRequest: request => openAiRequest(ENDPOINT, request),
  fromResponse: openAiResponse,
  fromStreamEvent: openAiStreamEvent,
}

registerLlmProvider(OPENAI_PROVIDER)
