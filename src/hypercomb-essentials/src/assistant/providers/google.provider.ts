// assistant/providers/google.provider.ts
//
// Gemini. The odd one out on every axis: the model name is part of the URL
// PATH rather than the body, turns are `contents` with `parts`, the assistant
// role is spelled `model`, and the system prompt is its own
// `systemInstruction` object. All of that is why `toRequest` exists.

import { registerLlmProvider } from '../llm-provider-registry.js'
import type {
  LlmCallResult,
  LlmHttpRequest,
  LlmProviderDescriptor,
  LlmRequest,
} from './llm-provider.types.js'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

type GoogleBody = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  modelVersion?: string
}

export const googleStreamEvent = (event: unknown): string => textOf(event)

const textOf = (json: unknown): string =>
  ((json ?? {}) as GoogleBody).candidates?.[0]?.content?.parts
    ?.map(p => p.text ?? '').join('') ?? ''

/** Build a Gemini `generateContent` POST against any base that speaks the
 *  shape. Exported for the declarative spec compiler (`provider-spec.ts`). */
export const googleRequest = (base: string, request: LlmRequest): LlmHttpRequest => ({
  // `streamGenerateContent?alt=sse` is the streaming twin; the dispatch picks
  // it by asking for `stream`, and the SSE frames are the same shape.
  url: `${base}/${encodeURIComponent(request.model)}:`
    + (request.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'),
  init: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': request.apiKey,
    },
    body: JSON.stringify({
      contents: request.messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
      generationConfig: { maxOutputTokens: request.maxTokens ?? 4096 },
    }),
  },
})

export const googleResponse = (json: unknown, request: LlmRequest): LlmCallResult => {
  const body = (json ?? {}) as GoogleBody
  return {
    text: textOf(json),
    stopReason: body.candidates?.[0]?.finishReason ?? 'STOP',
    inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
    model: body.modelVersion ?? request.model,
  }
}

export const GOOGLE_PROVIDER: LlmProviderDescriptor = {
  id: 'google',
  label: 'Gemini',
  vendor: 'google',
  transport: 'browser-http',
  endpoint: BASE,
  models: [
    { name: 'gemini-pro', id: 'gemini-2.5-pro', tier: 'deep' },
    { name: 'gemini', id: 'gemini-2.5-flash', tier: 'balanced' },
    { name: 'gemini-lite', id: 'gemini-2.5-flash-lite', tier: 'fast' },
  ],
  defaultModel: 'gemini-2.5-flash',
  docsUrl: 'https://aistudio.google.com/app/apikey',
  keyPattern: /^AIza[A-Za-z0-9_-]{30,}$/,
  toRequest: request => googleRequest(BASE, request),
  fromResponse: googleResponse,
  fromStreamEvent: googleStreamEvent,
}

registerLlmProvider(GOOGLE_PROVIDER)
