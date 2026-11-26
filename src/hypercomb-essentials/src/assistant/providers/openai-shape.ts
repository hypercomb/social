// assistant/providers/openai-shape.ts
//
// THE SHAPE FOUR VENDORS AGREED ON.
//
// OpenAI's `/chat/completions` request and response became the de-facto wire
// format: xAI, DeepSeek, Mistral and Ollama all speak it, differing only in
// host, and in whether they want `Bearer` at all. So the adapter is written
// once here and each vendor file is then genuinely just a descriptor — the
// endpoint, the models, the docs link, the key pattern.
//
// This is a shared IMPLEMENTATION, not a base class: a vendor that drifts
// (adds a field, renames a usage counter) stops calling this and writes its
// own three lines, with nothing to un-inherit.

import type {
  LlmCallResult,
  LlmHttpRequest,
  LlmRequest,
  LlmStreamEvent,
  LlmTokenUsage,
} from './llm-provider.types.js'

/** A system turn as content PARTS, so one part can carry a vendor cache
 *  marker. Only routers that pass `cache_control` through (OpenRouter → the
 *  Anthropic and Gemini upstreams) are asked for this form; the plain string
 *  stays the default because several vendors on this shape reject arrays
 *  for the system role. Design: documentation/anatomy-context-need.md §7. */
type OpenAiTextPart = {
  readonly type: 'text'
  readonly text: string
  readonly cache_control?: { readonly type: 'ephemeral' }
}

type OpenAiImagePart = {
  readonly type: 'image_url'
  readonly image_url: { readonly url: string }
}

type OpenAiMessage = {
  readonly role: string
  readonly content: string | readonly (OpenAiTextPart | OpenAiImagePart)[]
}

/** Messages in OpenAI order: an optional system turn, then the conversation.
 *  The hive's work travels as text in fenced blocks, never as tool calls. */
export type OpenAiShapeOptions = {
  /** This endpoint passes `cache_control` through to an upstream that honours
   *  it. With `request.cacheSystem` set, the system turn is sent as parts
   *  with an ephemeral cache marker — the anatomy is billed once per window
   *  instead of once per call. */
  readonly cacheableSystem?: boolean
  /** Vendor fields added to the body as-is (OpenRouter's `provider` routing
   *  block). Never overrides `model`, `messages` or `stream`. */
  readonly extraBody?: Readonly<Record<string, unknown>>
}

const systemTurn = (system: string, request: LlmRequest, options: OpenAiShapeOptions): OpenAiMessage =>
  request.cacheSystem && options.cacheableSystem
    ? { role: 'system', content: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] }
    : { role: 'system', content: system }

export const openAiMessages = (request: LlmRequest, options: OpenAiShapeOptions = {}): OpenAiMessage[] => {
  const turns = request.messages.map((message): OpenAiMessage => {
    const attached = message.role === 'user' ? message.images : undefined
    const images = attached?.filter(image =>
      /^image\/[a-z0-9.+-]+$/i.test(image.mime) && /^[a-z0-9+/=\s]+$/i.test(image.base64))
    if (images?.length) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: message.content },
          ...images.map(image => ({
            type: 'image_url' as const,
            image_url: { url: `data:${image.mime};base64,${image.base64.replace(/\s/g, '')}` },
          })),
        ],
      }
    }
    return { role: message.role, content: message.content }
  })
  return request.system ? [systemTurn(request.system, request, options), ...turns] : turns
}

/**
 * Build a `/chat/completions` POST. `authHeader` is a hook for the one thing
 * these vendors disagree about: Ollama wants no Authorization header at all.
 */
export const openAiRequest = (
  url: string,
  request: LlmRequest,
  authHeader: (apiKey: string) => Record<string, string> =
    apiKey => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {} as Record<string, string>),
  options: OpenAiShapeOptions = {},
): LlmHttpRequest => ({
  url,
  init: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(request.apiKey),
    },
    body: JSON.stringify({
      ...(options.extraBody ?? {}),
      model: request.model,
      messages: openAiMessages(request, options),
      max_tokens: request.maxTokens ?? 4096,
      ...(request.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    }),
  },
})

type OpenAiBody = {
  choices?: {
    message?: { content?: string | null }
    finish_reason?: string
  }[]
  usage?: OpenAiUsage
  model?: string
}

type OpenAiUsage = {
  prompt_tokens?: unknown
  completion_tokens?: unknown
  total_tokens?: unknown
  prompt_tokens_details?: { cached_tokens?: unknown }
  completion_tokens_details?: { reasoning_tokens?: unknown }
  cache_read_input_tokens?: unknown
  cache_write_input_tokens?: unknown
}

const tokenCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

const openAiUsage = (value: OpenAiUsage | undefined): LlmTokenUsage | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const usage: LlmTokenUsage = {
    ...(tokenCount(value.prompt_tokens) !== undefined ? { inputTokens: tokenCount(value.prompt_tokens) } : {}),
    ...(tokenCount(value.completion_tokens) !== undefined ? { outputTokens: tokenCount(value.completion_tokens) } : {}),
    ...(tokenCount(value.prompt_tokens_details?.cached_tokens) !== undefined
      ? { cacheReadTokens: tokenCount(value.prompt_tokens_details?.cached_tokens) } : {}),
    ...(tokenCount(value.cache_read_input_tokens) !== undefined
      ? { cacheReadTokens: tokenCount(value.cache_read_input_tokens) } : {}),
    ...(tokenCount(value.cache_write_input_tokens) !== undefined
      ? { cacheWriteTokens: tokenCount(value.cache_write_input_tokens) } : {}),
    ...(tokenCount(value.completion_tokens_details?.reasoning_tokens) !== undefined
      ? { reasoningTokens: tokenCount(value.completion_tokens_details?.reasoning_tokens) } : {}),
    ...(tokenCount(value.total_tokens) !== undefined ? { totalTokens: tokenCount(value.total_tokens) } : {}),
  }
  return Object.keys(usage).length ? usage : undefined
}

export const openAiResponse = (json: unknown, request: LlmRequest): LlmCallResult => {
  const body = (json ?? {}) as OpenAiBody
  const choice = body.choices?.[0]
  return {
    text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
    stopReason: choice?.finish_reason ?? 'stop',
    inputTokens: tokenCount(body.usage?.prompt_tokens) ?? 0,
    outputTokens: tokenCount(body.usage?.completion_tokens) ?? 0,
    ...(openAiUsage(body.usage) ? { usage: openAiUsage(body.usage) } : {}),
    model: body.model ?? request.model,
  }
}

type OpenAiStreamFrame = {
  choices?: {
    delta?: { content?: unknown }
    finish_reason?: unknown
  }[]
  usage?: OpenAiUsage
}

export const openAiStreamEvent = (event: unknown): string | LlmStreamEvent => {
  const frame = (event ?? {}) as OpenAiStreamFrame
  const choice = frame.choices?.[0]
  const delta = choice?.delta
  const text = typeof delta?.content === 'string' ? delta.content : ''
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined
  const usage = openAiUsage(frame.usage)
  // A frame with nothing but text keeps the plain text-only adapter
  // contract; the terminal and usage frames carry the richer shape.
  if (finishReason === undefined && usage === undefined) return text
  return {
    ...(text ? { text } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
    ...(usage ? { usage } : {}),
  }
}
