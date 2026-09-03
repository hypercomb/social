import { describe, expect, it } from 'vitest'

import type { LlmFunctionTool, LlmRequest } from './llm-provider.types.js'
import { openAiRequest, openAiResponse, openAiStreamEvent } from './openai-shape.js'

const request = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  model: 'qwen3:8b',
  messages: [{ role: 'user', content: 'make a roadmap' }],
  apiKey: '',
  ...over,
})

const editTool: LlmFunctionTool = {
  type: 'function',
  function: {
    name: 'edit_hypercomb',
    description: 'Propose one validated Hypercomb edit.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: ['create', 'postit'] },
        args: { type: 'string' },
      },
      required: ['command', 'args'],
      additionalProperties: false,
    },
  },
}

describe('the OpenAI-compatible request shape', () => {
  it('forwards function tools unchanged and selects them automatically', () => {
    const built = openAiRequest('http://localhost/v1/chat/completions', request({ tools: [editTool] }))
    const body = JSON.parse(String(built.init.body)) as Record<string, unknown>

    expect(body['tools']).toEqual([editTool])
    expect(body['tool_choice']).toBe('auto')
  })

  it('omits both tool fields when no functions are available', () => {
    for (const tools of [undefined, []] as const) {
      const built = openAiRequest('http://localhost/v1/chat/completions', request({ tools }))
      const body = JSON.parse(String(built.init.body)) as Record<string, unknown>
      expect(body).not.toHaveProperty('tools')
      expect(body).not.toHaveProperty('tool_choice')
    }
  })

  it('serializes an observation call and its matching tool result for a continuation', () => {
    const built = openAiRequest('http://localhost/v1/chat/completions', request({
      messages: [
        { role: 'user', content: 'explore projects' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_read', name: 'hypercomb_observe', arguments: '{"grammars":["/tree /projects"]}' }],
        },
        { role: 'tool', toolCallId: 'call_read', content: '{"kind":"hypercomb-tree-observation"}' },
      ],
      tools: [editTool],
    }))
    const body = JSON.parse(String(built.init.body)) as { messages: unknown[] }

    expect(body.messages).toEqual([
      { role: 'user', content: 'explore projects' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_read',
          type: 'function',
          function: { name: 'hypercomb_observe', arguments: '{"grammars":["/tree /projects"]}' },
        }],
      },
      { role: 'tool', content: '{"kind":"hypercomb-tree-observation"}', tool_call_id: 'call_read' },
    ])
  })
})

describe('the OpenAI-compatible response shape', () => {
  it('normalizes a tool-only answer while preserving raw argument JSON', () => {
    const result = openAiResponse({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'edit_hypercomb', arguments: '{not valid yet}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 17, completion_tokens: 9 },
      model: 'qwen3:8b-q4',
    }, request())

    expect(result).toEqual({
      text: '',
      toolCalls: [{
        id: 'call_1',
        name: 'edit_hypercomb',
        arguments: '{not valid yet}',
      }],
      stopReason: 'tool_calls',
      inputTokens: 17,
      outputTokens: 9,
      model: 'qwen3:8b-q4',
    })
  })

  it('rejects the entire action response when one sibling call is malformed', () => {
    expect(() => openAiResponse({
      choices: [{
        message: {
          content: 'I can do that.',
          tool_calls: [
            { id: 'bad-type', type: 'custom', function: { name: 'nope', arguments: '{}' } },
            { id: 'bad-args', type: 'function', function: { name: 'nope', arguments: {} } },
            { id: 'call_2', type: 'function', function: { name: 'first', arguments: '{"n":1}' } },
            { type: 'function', function: { name: 'second', arguments: '{}' } },
          ],
        },
        finish_reason: 'tool_calls',
      }],
    }, request())).toThrow('non-function tool call')
  })

  it('does not authorize complete-looking calls from a truncated answer', () => {
    const result = openAiResponse({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'cut-off', type: 'function',
            function: { name: 'edit_hypercomb', arguments: '{}' },
          }],
        },
        finish_reason: 'length',
      }],
    }, request())

    expect(result.toolCalls).toBeUndefined()
    expect(result.stopReason).toBe('length')
  })
})

describe('the OpenAI-compatible stream shape', () => {
  it('normalizes text and indexed tool fragments from the same frame', () => {
    expect(openAiStreamEvent({
      choices: [{
        delta: {
          content: 'Working…',
          tool_calls: [
            {
              index: 1,
              id: 'call_b',
              type: 'function',
              function: { name: 'read_', arguments: '{"path":' },
            },
            {
              index: 0,
              id: 'call_a',
              type: 'function',
              function: { name: 'edit_', arguments: '{"path":' },
            },
          ],
        },
      }],
    })).toEqual({
      text: 'Working…',
      toolCallDeltas: [
        {
          index: 1,
          id: 'call_b',
          name: 'read_',
          arguments: '{"path":',
        },
        {
          index: 0,
          id: 'call_a',
          name: 'edit_',
          arguments: '{"path":',
        },
      ],
    })
  })

  it('rejects malformed deltas instead of dropping their sibling action', () => {
    expect(() => openAiStreamEvent({
      choices: [{
        delta: {
          tool_calls: [
            { index: -1, type: 'function', function: { name: 'invalid', arguments: '{}' } },
            { index: 0, type: 'function', function: { name: 'valid', arguments: '{}' } },
          ],
        },
      }],
    })).toThrow('malformed tool-call index')
  })

  it('marks a terminal tool frame and ignores usage frames that carry no output', () => {
    expect(openAiStreamEvent({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
      .toEqual({ finishReason: 'tool_calls' })
    expect(openAiStreamEvent({ usage: { prompt_tokens: 4 } })).toBe('')
  })

  it('preserves the original string result for text-only frames', () => {
    expect(openAiStreamEvent({ choices: [{ delta: { content: 'hello' } }] })).toBe('hello')
  })
})
