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
} from './llm-provider.types.js'

/** Messages in OpenAI order: an optional system turn, then the conversation. */
export const openAiMessages = (request: LlmRequest): { role: string; content: string }[] => {
  const turns = request.messages.map(m => ({ role: m.role, content: m.content }))
  return request.system ? [{ role: 'system', content: request.system }, ...turns] : turns
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
): LlmHttpRequest => ({
  url,
  init: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(request.apiKey),
    },
    body: JSON.stringify({
      model: request.model,
      messages: openAiMessages(request),
      max_tokens: request.maxTokens ?? 4096,
      ...(request.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    }),
  },
})

type OpenAiBody = {
  choices?: { message?: { content?: string }; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  model?: string
}

export const openAiResponse = (json: unknown, request: LlmRequest): LlmCallResult => {
  const body = (json ?? {}) as OpenAiBody
  const choice = body.choices?.[0]
  return {
    text: choice?.message?.content ?? '',
    stopReason: choice?.finish_reason ?? 'stop',
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
    model: body.model ?? request.model,
  }
}

type OpenAiStreamFrame = { choices?: { delta?: { content?: string } }[] }

export const openAiStreamEvent = (event: unknown): string =>
  ((event ?? {}) as OpenAiStreamFrame).choices?.[0]?.delta?.content ?? ''
