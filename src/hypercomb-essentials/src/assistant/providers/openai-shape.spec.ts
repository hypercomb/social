import { describe, expect, it } from 'vitest'

import type { LlmRequest } from './llm-provider.types.js'
import { openAiRequest, openAiResponse, openAiStreamEvent } from './openai-shape.js'

const request = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  model: 'qwen3:8b',
  messages: [{ role: 'user', content: 'make a roadmap' }],
  apiKey: '',
  ...over,
})

describe('the OpenAI-compatible request shape', () => {
  // KEEP TEXT ONLY (jwize 2026-11-19): the hive's work travels as fenced
  // text, so no request carries a tool or asks the model to choose one.
  it('never sends tools or a tool choice', () => {
    const body = JSON.parse(String(openAiRequest('http://localhost/v1/chat/completions', request()).init.body))
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
    expect(body.messages).toEqual([{ role: 'user', content: 'make a roadmap' }])
  })
})

describe('the OpenAI-compatible answer shape', () => {
  it('reads the text of an answer and ignores any tool call a server adds', () => {
    const result = openAiResponse({
      choices: [{ message: { content: 'done', tool_calls: [{ id: 'x', type: 'function', function: { name: 'f', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
      model: 'qwen3:8b',
    }, request())
    expect(result.text).toBe('done')
    expect(result).not.toHaveProperty('toolCalls')
  })

  it('keeps the text of a stream frame that also carries a tool delta, and never throws on it', () => {
    expect(openAiStreamEvent({ choices: [{ delta: { content: 'hi', tool_calls: [{ index: 'bad' }] } }] })).toBe('hi')
  })
})

describe('the cacheable system turn', () => {
  const body = (url: string, over: Partial<LlmRequest>, options?: { cacheableSystem?: boolean }) =>
    JSON.parse(String(openAiRequest(url, request(over), undefined, options).init.body)) as { messages: { role: string; content: unknown }[] }

  it('marks the system turn ephemeral only when both the request and the endpoint ask for it', () => {
    const cached = body('https://openrouter.ai/x', { system: 'anatomy', cacheSystem: true }, { cacheableSystem: true })
    expect(cached.messages[0]).toEqual({
      role: 'system',
      content: [{ type: 'text', text: 'anatomy', cache_control: { type: 'ephemeral' } }],
    })
  })

  it('sends a user picture as an image part and leaves a text turn as a string', () => {
    const seen = body('http://localhost/v1/chat/completions', {
      messages: [{ role: 'user', content: 'the tile', images: [{ mime: 'image/jpeg', base64: 'aGVsbG8=' }] }],
    })
    expect(seen.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'the tile' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aGVsbG8=' } },
      ],
    })
  })

  it('keeps the plain string form for every vendor that did not opt in, whatever the request says', () => {
    expect(body('https://api.deepseek.com/x', { system: 'anatomy', cacheSystem: true }).messages[0])
      .toEqual({ role: 'system', content: 'anatomy' })
    expect(body('https://openrouter.ai/x', { system: 'anatomy' }, { cacheableSystem: true }).messages[0])
      .toEqual({ role: 'system', content: 'anatomy' })
  })
})

describe('the OpenAI-compatible stream shape', () => {
  it('marks terminal frames and normalizes the usage-only frame', () => {
    expect(openAiStreamEvent({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
      .toEqual({ finishReason: 'tool_calls' })
    expect(openAiStreamEvent({ usage: {
      prompt_tokens: 4,
      completion_tokens: 6,
      total_tokens: 10,
      prompt_tokens_details: { cached_tokens: 2 },
      completion_tokens_details: { reasoning_tokens: 3 },
    } })).toEqual({
      usage: {
        inputTokens: 4,
        outputTokens: 6,
        cacheReadTokens: 2,
        reasoningTokens: 3,
        totalTokens: 10,
      },
    })
  })

  it('keeps usage and finish reason together when a server combines them', () => {
    expect(openAiStreamEvent({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    })).toEqual({
      finishReason: 'stop',
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    })
  })

  it('preserves the original string result for text-only frames', () => {
    expect(openAiStreamEvent({ choices: [{ delta: { content: 'hello' } }] })).toBe('hello')
  })
})
