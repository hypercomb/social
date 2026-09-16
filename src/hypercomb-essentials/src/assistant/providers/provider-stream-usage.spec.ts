import { describe, expect, it } from 'vitest'
import { anthropicResponse, anthropicStreamEvent } from './anthropic.provider.js'
import { googleResponse, googleStreamEvent } from './google.provider.js'
import type { LlmRequest } from './llm-provider.types.js'

const request: LlmRequest = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'hello' }],
  apiKey: 'test-key',
}

describe('provider streaming usage normalization', () => {
  it('keeps Anthropic cache and token counts from stream lifecycle frames', () => {
    expect(anthropicStreamEvent({
      type: 'message_start',
      message: { usage: { input_tokens: 12, cache_read_input_tokens: 8, cache_creation_input_tokens: 2 } },
    })).toEqual({ usage: { inputTokens: 12, cacheReadTokens: 8, cacheWriteTokens: 2 } })

    expect(anthropicStreamEvent({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 5 },
    })).toEqual({ usage: { outputTokens: 5 }, finishReason: 'end_turn' })
  })

  it('keeps Anthropic non-stream usage in the normalized result', () => {
    expect(anthropicResponse({
      content: [{ text: 'done' }],
      usage: { input_tokens: 12, output_tokens: 5, cache_read_input_tokens: 8 },
    }, request)).toMatchObject({
      inputTokens: 12,
      outputTokens: 5,
      usage: { inputTokens: 12, outputTokens: 5, cacheReadTokens: 8 },
    })
  })

  it('keeps Gemini cumulative, cached, and reasoning counts', () => {
    const frame = {
      candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 4,
        totalTokenCount: 17,
        cachedContentTokenCount: 6,
        thoughtsTokenCount: 3,
      },
    }
    expect(googleStreamEvent(frame)).toEqual({
      text: 'done',
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 17,
        cacheReadTokens: 6,
        reasoningTokens: 3,
      },
      finishReason: 'STOP',
    })
    expect(googleResponse(frame, request)).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      usage: { totalTokens: 17, cacheReadTokens: 6, reasoningTokens: 3 },
    })
  })
})
