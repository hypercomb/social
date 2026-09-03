// llm-routing.spec.ts — selection is not routing until failure has somewhere
// safe and deterministic to go.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const iocMap = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (key: string, value: unknown) => { if (!iocMap.has(key)) iocMap.set(key, value) },
    get: (key: string) => iocMap.get(key),
  },
}

const { llmProviderRegistry } = await import('./llm-provider-registry.js')
const { buildRequest, llmRouter, streamRoutedModel } = await import('./llm-dispatch.js')
const { openAiStreamEvent } = await import('./providers/openai-shape.js')
const { LOCAL_HOST_STORAGE_KEY } = await import('./providers/local.provider.js')

type Descriptor = import('./providers/llm-provider.types.js').LlmProviderDescriptor
type FunctionTool = import('./providers/llm-provider.types.js').LlmFunctionTool
type RoutedChunk = import('./llm-dispatch.js').LlmRoutedChunk

const descriptor = (id: string, text: string): Descriptor => ({
  id,
  label: id,
  vendor: 'local',
  transport: 'browser-http',
  requiresKey: false,
  models: [{ name: id, id: `${id}-model`, tier: 'fast' }],
  defaultModel: `${id}-model`,
  docsUrl: 'https://example.test',
  toRequest: () => ({ url: `https://${id}.example.test`, init: { method: 'POST' } }),
  fromResponse: () => ({ text, stopReason: 'stop', inputTokens: 1, outputTokens: 1, model: `${id}-model` }),
})

const registry = llmProviderRegistry()

beforeEach(() => {
  localStorage.clear()
  for (const provider of registry.all()) registry.unregister(provider.id)
  vi.restoreAllMocks()
})

describe('streamRoutedModel', () => {
  it('resolves model ownership for shells without exposing the registry', () => {
    registry.register(descriptor('local-model-owner', 'unused'))
    expect(llmRouter.providerIdForModel('local-model-owner-model')).toBe('local-model-owner')
    expect(llmRouter.providerIdForModel('unknown-model')).toBeUndefined()
  })

  it('reports machine locality from the resolved endpoint rather than the provider id', () => {
    registry.register({ ...descriptor('loopback', 'unused'), endpoint: 'http://127.0.0.1:1234' })
    registry.register({ ...descriptor('local', 'unused'), endpoint: 'http://127.0.0.1:11434' })

    expect(llmRouter.providerIsMachineLocal('loopback')).toBe(true)
    expect(llmRouter.providerMachineEndpoint('loopback')).toBe('http://127.0.0.1:1234')
    localStorage.setItem(LOCAL_HOST_STORAGE_KEY, 'https://models.example.test')
    expect(llmRouter.providerIsMachineLocal('local')).toBe(false)
    expect(llmRouter.providerMachineEndpoint('local')).toBeUndefined()
    localStorage.setItem(LOCAL_HOST_STORAGE_KEY, 'http://127.0.0.1:11999')
    expect(llmRouter.providerIsMachineLocal('local')).toBe(true)
    expect(llmRouter.providerMachineEndpoint('local')).toBe('http://127.0.0.1:11999')
    expect(llmRouter.providerIsMachineLocal('missing')).toBe(false)
  })

  it('forwards function tools from a routed call into the provider request', () => {
    const first = descriptor('tool-request', 'unused')
    registry.register(first)
    const tools: readonly FunctionTool[] = [{
      type: 'function',
      function: {
        name: 'edit_hypercomb',
        parameters: { type: 'object', properties: { command: { type: 'string' } } },
      },
    }]

    expect(buildRequest(first, {
      providerId: first.id,
      messages: [{ role: 'user', content: 'make a tile' }],
      tools,
    }).tools).toBe(tools)
  })

  it('falls through a failed automatic route and reports who actually answered', async () => {
    registry.register(descriptor('first', 'unused'))
    registry.register(descriptor('second', 'hello'))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('first')) throw new TypeError('offline')
      return new Response('{}', { status: 200 })
    }))

    const chunks: RoutedChunk[] = []
    for await (const chunk of streamRoutedModel({
      need: { tier: 'fast', streaming: true },
      messages: [{ role: 'user', content: 'hello' }],
    })) chunks.push(chunk)

    expect(chunks.map(chunk => chunk.text).join('')).toBe('hello')
    expect(chunks[0]?.providerId).toBe('second')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not override an explicit provider choice', async () => {
    registry.register(descriptor('first', 'unused'))
    registry.register(descriptor('second', 'hello'))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))

    await expect(async () => {
      for await (const _chunk of streamRoutedModel({
        providerId: 'first',
        messages: [{ role: 'user', content: 'hello' }],
      })) { /* consume */ }
    }).rejects.toThrow('offline')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('treats an empty successful response as fallback-worthy', async () => {
    registry.register(descriptor('empty-first', ''))
    registry.register(descriptor('visible-second', 'visible'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))

    const chunks: RoutedChunk[] = []
    for await (const chunk of streamRoutedModel({
      need: { tier: 'fast' }, messages: [{ role: 'user', content: 'hello' }],
    })) chunks.push(chunk)

    expect(chunks[0]?.providerId).toBe('visible-second')
    expect(chunks[0]?.text).toBe('visible')
  })

  it('routes a non-streaming tool-only response without falling back', async () => {
    registry.register({
      ...descriptor('tool-only-first', ''),
      fromResponse: () => ({
        text: '',
        toolCalls: [{
          id: 'call_edit',
          name: 'edit_hypercomb',
          arguments: '{"command":"create"}',
        }],
        stopReason: 'tool_calls',
        inputTokens: 1,
        outputTokens: 1,
        model: 'tool-only-first-model',
      }),
    })
    registry.register(descriptor('tool-only-fallback', 'should not answer'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))

    const chunks: RoutedChunk[] = []
    for await (const chunk of streamRoutedModel({
      need: { tier: 'fast' },
      messages: [{ role: 'user', content: 'make a tile' }],
    })) chunks.push(chunk)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(chunks).toEqual([{
      text: '',
      toolCalls: [{
        id: 'call_edit',
        name: 'edit_hypercomb',
        arguments: '{"command":"create"}',
      }],
      providerId: 'tool-only-first',
      providerLabel: 'tool-only-first',
      vendor: 'local',
      model: 'tool-only-first-model',
    }])
  })

  it('assembles interleaved streamed tool calls by index before routing them', async () => {
    registry.register({
      ...descriptor('tool-stream-first', ''),
      fromStreamEvent: openAiStreamEvent,
    })
    registry.register(descriptor('tool-stream-fallback', 'should not answer'))
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":['
        + '{"index":0,"id":"call_a","type":"function","function":{"name":"edit_","arguments":"{\\"path\\":"}},'
        + '{"index":1,"id":"call_b","type":"function","function":{"name":"read_","arguments":"{\\"path\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":['
        + '{"index":1,"function":{"name":"file","arguments":"\\"b\\"}"}},'
        + '{"index":0,"function":{"name":"file","arguments":"\\"a\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse, { status: 200 })))

    const chunks: RoutedChunk[] = []
    for await (const chunk of streamRoutedModel({
      need: { tier: 'fast', streaming: true },
      messages: [{ role: 'user', content: 'work with two files' }],
    })) chunks.push(chunk)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(chunks).toEqual([{
      text: '',
      toolCalls: [
        {
          id: 'call_a',
          name: 'edit_file',
          arguments: '{"path":"a"}',
        },
        {
          id: 'call_b',
          name: 'read_file',
          arguments: '{"path":"b"}',
        },
      ],
      providerId: 'tool-stream-first',
      providerLabel: 'tool-stream-first',
      vendor: 'local',
      model: 'tool-stream-first-model',
    }])
  })

  it('never publishes a tool call when the stream ends without a terminal frame', async () => {
    registry.register({
      ...descriptor('incomplete-tool-stream', ''),
      fromStreamEvent: openAiStreamEvent,
    })
    const sse = 'data: {"choices":[{"delta":{"tool_calls":[{'
      + '"index":0,"id":"call_a","type":"function",'
      + '"function":{"name":"edit_hypercomb","arguments":"{}"}}]}}]}\n'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse, { status: 200 })))

    const chunks: RoutedChunk[] = []
    await expect(async () => {
      for await (const chunk of streamRoutedModel({
        providerId: 'incomplete-tool-stream',
        messages: [{ role: 'user', content: 'edit it' }],
      })) chunks.push(chunk)
    }).rejects.toThrow('incomplete tool call')
    expect(chunks).toEqual([])
  })

  it('rejects every streamed action when one completed call never names a function', async () => {
    registry.register({
      ...descriptor('nameless-tool-stream', ''),
      fromStreamEvent: openAiStreamEvent,
    })
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":['
        + '{"index":0,"id":"call_bad","type":"function","function":{"arguments":"{}"}},'
        + '{"index":1,"id":"call_good","type":"function","function":{"name":"edit_hypercomb","arguments":"{}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse, { status: 200 })))

    const chunks: RoutedChunk[] = []
    await expect(async () => {
      for await (const chunk of streamRoutedModel({
        providerId: 'nameless-tool-stream',
        messages: [{ role: 'user', content: 'edit it' }],
      })) chunks.push(chunk)
    }).rejects.toThrow('malformed tool call')
    expect(chunks).toEqual([])
  })

  it('rejects complete-looking streamed arguments stopped by the token limit', async () => {
    registry.register({
      ...descriptor('length-tool-stream', ''),
      fromStreamEvent: openAiStreamEvent,
    })
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{'
        + '"index":0,"id":"call_a","type":"function",'
        + '"function":{"name":"edit_hypercomb","arguments":"{}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse, { status: 200 })))

    await expect(async () => {
      for await (const _chunk of streamRoutedModel({
        providerId: 'length-tool-stream',
        messages: [{ role: 'user', content: 'edit it' }],
      })) { /* consume */ }
    }).rejects.toThrow('incomplete tool call')
  })

  it('discards accumulated tool arguments when the participant aborts', async () => {
    const controller = new AbortController()
    registry.register({
      ...descriptor('aborted-tool-stream', ''),
      fromStreamEvent: event => {
        const decoded = openAiStreamEvent(event)
        if (typeof decoded !== 'string' && decoded.toolCallDeltas?.length) controller.abort()
        return decoded
      },
    })
    const sse = [
      'data: {"choices":[{"delta":{"tool_calls":[{'
        + '"index":0,"id":"call_a","type":"function",'
        + '"function":{"name":"edit_hypercomb","arguments":"{}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse, { status: 200 })))

    const chunks: RoutedChunk[] = []
    await expect(async () => {
      for await (const chunk of streamRoutedModel({
        providerId: 'aborted-tool-stream',
        signal: controller.signal,
        messages: [{ role: 'user', content: 'edit it' }],
      })) chunks.push(chunk)
    }).rejects.toMatchObject({ name: 'AbortError' })
    expect(chunks).toEqual([])
  })

  it('treats the previous model as sticky preference, not a fallback veto', async () => {
    registry.register(descriptor('fallback', 'recovered'))
    registry.register(descriptor('sticky', 'unused'))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('sticky')) throw new TypeError('sticky provider is down')
      return new Response('{}', { status: 200 })
    }))

    const chunks: RoutedChunk[] = []
    for await (const chunk of streamRoutedModel({
      preferModel: 'sticky-model',
      need: { tier: 'fast' },
      messages: [{ role: 'user', content: 'continue' }],
    })) chunks.push(chunk)

    expect(chunks[0]?.providerId).toBe('fallback')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
