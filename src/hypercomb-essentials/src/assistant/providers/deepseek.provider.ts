// assistant/providers/deepseek.provider.ts
//
// DeepSeek. OpenAI-shaped. Two models rather than three: `deepseek-reasoner`
// and `deepseek-chat` are the whole line-up, so there is no fast tier to
// invent — a descriptor lists what a vendor actually sells.

import { registerLlmProvider } from '../llm-provider-registry.js'
import type { LlmProviderDescriptor } from './llm-provider.types.js'
import { openAiRequest, openAiResponse, openAiStreamEvent } from './openai-shape.js'

const ENDPOINT = 'https://api.deepseek.com/chat/completions'

export const DEEPSEEK_PROVIDER: LlmProviderDescriptor = {
  id: 'deepseek',
  label: 'DeepSeek',
  vendor: 'deepseek',
  transport: 'browser-http',
  endpoint: ENDPOINT,
  models: [
    { name: 'deepseek-reasoner', id: 'deepseek-reasoner', tier: 'deep' },
    { name: 'deepseek', id: 'deepseek-chat', tier: 'balanced' },
  ],
  defaultModel: 'deepseek-chat',
  docsUrl: 'https://platform.deepseek.com/api_keys',
  keyPattern: /^sk-[A-Za-z0-9]{20,}$/,
  toRequest: request => openAiRequest(ENDPOINT, request),
  fromResponse: openAiResponse,
  fromStreamEvent: openAiStreamEvent,
}

registerLlmProvider(DEEPSEEK_PROVIDER)
