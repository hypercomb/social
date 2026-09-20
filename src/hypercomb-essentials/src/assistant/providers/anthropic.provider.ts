// assistant/providers/anthropic.provider.ts
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
  LlmStreamEvent,
  LlmTokenUsage,
} from './llm-provider.types.js'

export const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2023-06-01'

type AnthropicBody = {
  content?: { text?: string }[]
  stop_reason?: string
  usage?: AnthropicUsage
  model?: string
}

type AnthropicUsage = {
  input_tokens?: unknown
  output_tokens?: unknown
  cache_read_input_tokens?: unknown
  cache_creation_input_tokens?: unknown
}

type AnthropicStreamFrame = {
  type?: string
  message?: { usage?: AnthropicUsage }
  usage?: AnthropicUsage
  delta?: { text?: string; stop_reason?: string }
}

const tokenCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

const anthropicUsage = (value: AnthropicUsage | undefined): LlmTokenUsage | undefined => {
  if (!value) return undefined
  const inputTokens = tokenCount(value.input_tokens)
  const outputTokens = tokenCount(value.output_tokens)
  const cacheReadTokens = tokenCount(value.cache_read_input_tokens)
  const cacheWriteTokens = tokenCount(value.cache_creation_input_tokens)
  const usage: LlmTokenUsage = {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
  }
  return Object.keys(usage).length ? usage : undefined
}

export const anthropicStreamEvent = (event: unknown): string | LlmStreamEvent => {
  const frame = (event ?? {}) as AnthropicStreamFrame
  const text = frame.type === 'content_block_delta' ? frame.delta?.text ?? '' : ''
  const usage = anthropicUsage(frame.message?.usage ?? frame.usage)
  const finishReason = typeof frame.delta?.stop_reason === 'string' ? frame.delta.stop_reason : undefined
  if (!usage && finishReason === undefined) return text
  return {
    ...(text ? { text } : {}),
    ...(usage ? { usage } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
  }
}

/** Build an Anthropic `/v1/messages` POST against any endpoint that speaks
 *  the shape — the official API, or a proxy a spec names. Exported so the
 *  declarative spec compiler (`provider-spec.ts`) can reuse the family. */
export const anthropicRequest = (url: string, request: LlmRequest): LlmHttpRequest => ({
  url,
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

export const anthropicResponse = (json: unknown, request: LlmRequest): LlmCallResult => {
  const body = (json ?? {}) as AnthropicBody
  const usage = anthropicUsage(body.usage)
  return {
    text: body.content?.[0]?.text ?? '',
    stopReason: body.stop_reason ?? 'end_turn',
    inputTokens: tokenCount(body.usage?.input_tokens) ?? 0,
    outputTokens: tokenCount(body.usage?.output_tokens) ?? 0,
    ...(usage ? { usage } : {}),
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
  toRequest: request => anthropicRequest(ANTHROPIC_ENDPOINT, request),
  fromResponse: anthropicResponse,
  fromStreamEvent: anthropicStreamEvent,
}

registerLlmProvider(ANTHROPIC_PROVIDER)
