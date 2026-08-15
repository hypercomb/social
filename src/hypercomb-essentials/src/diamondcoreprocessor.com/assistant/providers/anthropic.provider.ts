// diamondcoreprocessor.com/assistant/providers/anthropic.provider.ts
//
// Claude. Extracted verbatim from what `llm-api.ts` used to do inline — the
// endpoint, `x-api-key`, the dated `anthropic-version` header, the
// browser-access opt-in, and the `cache_control` marker that makes a repeated
// system prompt roughly ten times cheaper. Nothing outside this file knows
// any of it any more; `llm-api.ts` is now a shim over the dispatch seam.
//
// Anthropic is the one vendor here that takes `system` as a TOP-LEVEL field
// rather than a first message, which is exactly why the descriptor owns
// request-building instead of the caller.

import { registerLlmProvider } from '../llm-provider-registry.js'
import type {
  LlmCallResult,
  LlmHttpRequest,
  LlmProviderDescriptor,
  LlmRequest,
} from './llm-provider.types.js'

export const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2023-06-01'

type AnthropicBody = {
  content?: { text?: string }[]
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
  model?: string
}

type AnthropicStreamFrame = { type?: string; delta?: { text?: string } }

const toRequest = (request: LlmRequest): LlmHttpRequest => ({
  url: ANTHROPIC_ENDPOINT,
  init: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': request.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      // A cached system prompt is billed once and read back cheaply on every
      // following call — worth it only for a prompt that really is stable,
      // hence the caller's explicit hint rather than always-on.
      ...(request.system
        ? {
            system: request.cacheSystem
              ? [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }]
              : request.system,
          }
        : {}),
      messages: request.messages.map(m => ({ role: m.role, content: m.content })),
      ...(request.stream ? { stream: true } : {}),
    }),
  },
})

const fromResponse = (json: unknown, request: LlmRequest): LlmCallResult => {
  const body = (json ?? {}) as AnthropicBody
  return {
    text: body.content?.[0]?.text ?? '',
    stopReason: body.stop_reason ?? 'end_turn',
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
    model: body.model ?? request.model,
  }
}

export const ANTHROPIC_PROVIDER: LlmProviderDescriptor = {
  id: 'anthropic',
  label: 'Claude',
  vendor: 'anthropic',
  transport: 'browser-http',
  endpoint: ANTHROPIC_ENDPOINT,
  models: [
    { name: 'opus', id: 'claude-opus-4-6', tier: 'deep' },
    { name: 'sonnet', id: 'claude-sonnet-4-6', tier: 'balanced' },
    { name: 'haiku', id: 'claude-haiku-4-5-20251001', tier: 'fast' },
  ],
  defaultModel: 'claude-sonnet-4-6',
  docsUrl: 'https://console.anthropic.com/settings/keys',
  keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  toRequest,
  fromResponse,
  fromStreamEvent: (event: unknown): string => {
    const frame = (event ?? {}) as AnthropicStreamFrame
    return frame.type === 'content_block_delta' ? frame.delta?.text ?? '' : ''
  },
}

registerLlmProvider(ANTHROPIC_PROVIDER)
