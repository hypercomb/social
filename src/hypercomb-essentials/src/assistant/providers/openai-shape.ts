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
  LlmToolCall,
  LlmToolCallDelta,
} from './llm-provider.types.js'

type OpenAiMessage = {
  readonly role: string
  readonly content: string | null
  readonly tool_calls?: readonly {
    readonly id: string
    readonly type: 'function'
    readonly function: { readonly name: string; readonly arguments: string }
  }[]
  readonly tool_call_id?: string
}

/** Messages in OpenAI order: an optional system turn, then the conversation.
 *  Native observation results travel in the protocol's ordinary assistant
 *  tool-call/tool-result pair; no provider-specific state leaks above here. */
export const openAiMessages = (request: LlmRequest): OpenAiMessage[] => {
  const turns = request.messages.map((message): OpenAiMessage => {
    if (message.role === 'tool') {
      return { role: 'tool', content: message.content, tool_call_id: message.toolCallId }
    }
    if (message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call, index) => ({
          id: call.id ?? `call_${index + 1}`,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      }
    }
    return { role: message.role, content: message.content }
  })
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
      ...(request.tools?.length ? { tools: request.tools, tool_choice: 'auto' } : {}),
      ...(request.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    }),
  },
})

type OpenAiBody = {
  choices?: {
    message?: { content?: string | null; tool_calls?: unknown }
    finish_reason?: string
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  model?: string
}

type OpenAiToolCall = {
  id?: unknown
  type?: unknown
  function?: { name?: unknown; arguments?: unknown }
}

const openAiToolCalls = (value: unknown): LlmToolCall[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('OpenAI-compatible provider returned malformed tool calls')
  }
  const calls: LlmToolCall[] = []
  for (const raw of value) {
    const call = (raw ?? {}) as OpenAiToolCall
    if (call.type !== undefined && call.type !== 'function') {
      throw new Error('OpenAI-compatible provider returned a non-function tool call')
    }
    if (typeof call.function?.name !== 'string' || !call.function.name.trim()
      || typeof call.function.arguments !== 'string') {
      throw new Error('OpenAI-compatible provider returned malformed tool calls')
    }
    calls.push({
      ...(typeof call.id === 'string' ? { id: call.id } : {}),
      name: call.function.name,
      arguments: call.function.arguments,
    })
  }
  return calls
}

export const openAiResponse = (json: unknown, request: LlmRequest): LlmCallResult => {
  const body = (json ?? {}) as OpenAiBody
  const choice = body.choices?.[0]
  // Arguments can look complete on a length/content-filter stop. Only the
  // protocol's tool_calls terminal reason authorizes them as a finished call.
  const toolCalls = choice?.finish_reason === 'tool_calls'
    ? openAiToolCalls(choice?.message?.tool_calls)
    : []
  return {
    text: typeof choice?.message?.content === 'string' ? choice.message.content : '',
    ...(toolCalls.length ? { toolCalls } : {}),
    stopReason: choice?.finish_reason ?? 'stop',
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
    model: body.model ?? request.model,
  }
}

type OpenAiStreamFrame = {
  choices?: {
    delta?: { content?: unknown; tool_calls?: unknown }
    finish_reason?: unknown
  }[]
}

type OpenAiToolCallDelta = OpenAiToolCall & { index?: unknown }

const openAiToolCallDeltas = (value: unknown): LlmToolCallDelta[] => {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Error('OpenAI-compatible provider returned malformed tool-call deltas')
  }
  const calls: LlmToolCallDelta[] = []
  for (const raw of value) {
    const call = (raw ?? {}) as OpenAiToolCallDelta
    if (!Number.isInteger(call.index) || (call.index as number) < 0) {
      throw new Error('OpenAI-compatible provider returned a malformed tool-call index')
    }
    if (call.type !== undefined && call.type !== 'function') {
      throw new Error('OpenAI-compatible provider returned a non-function tool-call delta')
    }
    if (call.id !== undefined && typeof call.id !== 'string') {
      throw new Error('OpenAI-compatible provider returned a malformed tool-call id')
    }
    if (call.function !== undefined && (!call.function || typeof call.function !== 'object')) {
      throw new Error('OpenAI-compatible provider returned malformed tool-call deltas')
    }
    if (call.function?.name !== undefined && typeof call.function.name !== 'string') {
      throw new Error('OpenAI-compatible provider returned a malformed tool-call name')
    }
    if (call.function?.arguments !== undefined && typeof call.function.arguments !== 'string') {
      throw new Error('OpenAI-compatible provider returned malformed tool-call arguments')
    }
    const name = typeof call.function?.name === 'string' ? call.function.name : undefined
    const args = typeof call.function?.arguments === 'string' ? call.function.arguments : undefined
    const hasFunction = name !== undefined || args !== undefined
    if (typeof call.id !== 'string' && call.type !== 'function' && !hasFunction) {
      throw new Error('OpenAI-compatible provider returned an empty tool-call delta')
    }
    calls.push({
      index: call.index as number,
      ...(typeof call.id === 'string' ? { id: call.id } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(args !== undefined ? { arguments: args } : {}),
    })
  }
  return calls
}

export const openAiStreamEvent = (event: unknown): string | LlmStreamEvent => {
  const choice = ((event ?? {}) as OpenAiStreamFrame).choices?.[0]
  const delta = choice?.delta
  const text = typeof delta?.content === 'string' ? delta.content : ''
  const toolCallDeltas = openAiToolCallDeltas(delta?.tool_calls)
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined
  // Preserve the long-standing text-only adapter contract for every frame
  // that carries no calls. Dispatch also accepts the richer union below.
  if (!toolCallDeltas.length && finishReason === undefined) return text
  return {
    ...(text ? { text } : {}),
    ...(toolCallDeltas.length ? { toolCallDeltas } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
  }
}
