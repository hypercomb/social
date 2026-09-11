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
    // A host the participant typed after reading it off their own server's
    // startup line. `0.0.0.0` is where that server BOUND, not somewhere a
    // client goes: it never proves this machine, so it never earns the
    // execution tier — answer-only, exactly like a URL that left the machine.
    localStorage.setItem(LOCAL_HOST_STORAGE_KEY, 'http://0.0.0.0:11434')
    expect(llmRouter.providerIsMachineLocal('local')).toBe(false)
    expect(llmRouter.providerMachineEndpoint('local')).toBeUndefined()
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

// ── three knobs, one provider ─────────────────────────────────────────────
//
// The route flow asks the participant's local model to answer without a
// reasoning pass, in a fixed shape, at temperature 0 (chat-route.md §4.1.2).
// Only the local adapter may turn those into wire fields; every other vendor's
// body must stay byte for byte what it was, and a local call that sets none of
// them must too.

describe('the flow knobs reach the local body only', () => {
  const SCHEMA = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }
  const base = {
    model: 'qwen3:8b',
    messages: [{ role: 'user' as const, content: 'map these exchanges' }],
    system: 'You map a conversation.',
    maxTokens: 720,
    apiKey: '',
  }
  const bodyOf = (request: { init: RequestInit }): Record<string, unknown> => JSON.parse(String(request.init.body)) as Record<string, unknown>

  it('adds reasoning_effort, response_format and temperature only when set, and is byte-identical when unset', async () => {
    const { LOCAL_PROVIDER, localLlmHost } = await import('./providers/local.provider.js')
    const { openAiRequest } = await import('./providers/openai-shape.js')
    const plain = LOCAL_PROVIDER.toRequest(base)
    expect(plain.init.body).toBe(openAiRequest(`${localLlmHost()}/v1/chat/completions`, base, () => ({})).init.body)
    expect(bodyOf(plain)).not.toHaveProperty('reasoning_effort')
    expect(bodyOf(plain)).not.toHaveProperty('response_format')
    expect(bodyOf(plain)).not.toHaveProperty('temperature')

    const all = bodyOf(LOCAL_PROVIDER.toRequest({ ...base, thinking: false, jsonSchema: SCHEMA, temperature: 0 }))
    expect(all['reasoning_effort']).toBe('none')
    expect(all['response_format']).toEqual({ type: 'json_schema', json_schema: { name: 'answer', schema: SCHEMA } })
    expect(all['temperature']).toBe(0)
    expect(all['model']).toBe('qwen3:8b')
    expect(all['max_tokens']).toBe(720)

    expect(Object.keys(bodyOf(LOCAL_PROVIDER.toRequest({ ...base, thinking: false }))))
      .toEqual([...Object.keys(bodyOf(plain)), 'reasoning_effort'])
    expect(bodyOf(LOCAL_PROVIDER.toRequest({ ...base, temperature: 0.4 }))['temperature']).toBe(0.4)
    expect(bodyOf(LOCAL_PROVIDER.toRequest({ ...base, jsonSchema: SCHEMA }))).not.toHaveProperty('reasoning_effort')
  })

  it('leaves every other vendor\'s request unchanged when a call sets them', async () => {
    const vendors = ['anthropic', 'openai', 'google', 'xai', 'deepseek', 'mistral']
    for (const vendor of vendors) {
      const module = await import(`./providers/${vendor}.provider.js`) as Record<string, unknown>
      const descriptor = Object.values(module).find(value =>
        !!value && typeof value === 'object' && typeof (value as Descriptor).toRequest === 'function') as Descriptor
      expect(descriptor, vendor).toBeDefined()
      const keyed = { ...base, apiKey: 'sk-test' }
      const before = descriptor.toRequest(keyed)
      const after = descriptor.toRequest({ ...keyed, thinking: false, jsonSchema: SCHEMA, temperature: 0 })
      expect(after.url, vendor).toBe(before.url)
      expect(after.init.body, vendor).toBe(before.init.body)
    }
  })

  it('buildRequest passes the knobs through, and adds no key for a call that set none', () => {
    const provider = descriptor('knob-pass', 'unused')
    registry.register(provider)
    const set = buildRequest(provider, { providerId: provider.id, messages: base.messages, thinking: false, jsonSchema: SCHEMA, temperature: 0 })
    expect(set.thinking).toBe(false)
    expect(set.jsonSchema).toBe(SCHEMA)
    expect(set.temperature).toBe(0)
    const unset = buildRequest(provider, { providerId: provider.id, messages: base.messages })
    expect(unset).not.toHaveProperty('thinking')
    expect(unset).not.toHaveProperty('jsonSchema')
    expect(unset).not.toHaveProperty('temperature')
  })
})

// ── who is the participant ───────────────────────────────────────────────
//
// The route flow pauses only for the participant's OWN local chat, and names
// only the model that answered it. `callModel`'s callers are all automatic, so
// its stamp never says `interactive` and it never writes the stored choice;
// the routed stream — the chat window's local send — does both, and only once
// the server answered OK.

describe('the participant\'s own local chat', () => {
  const localish = (id: string, over: Partial<Descriptor> = {}): Descriptor => ({
    ...descriptor(id, 'hi'),
    fromResponse: () => ({ text: 'hi', stopReason: 'stop', inputTokens: 1, outputTokens: 1, model: `${id}-model` }),
    ...over,
  })
  const heard = async (): Promise<{ payloads: Array<Record<string, unknown>>; off: () => void }> => {
    const { EffectBus } = await import('@hypercomb/core')
    const payloads: Array<Record<string, unknown>> = []
    const off = EffectBus.on<Record<string, unknown>>('llm:local-used', payload => { payloads.push(payload) })
    payloads.length = 0   // the replayed last value is not this test's
    return { payloads, off }
  }
  const drainStream = async (call: Parameters<typeof streamRoutedModel>[0]): Promise<void> => {
    for await (const _chunk of streamRoutedModel(call)) { /* consume */ }
  }

  it('callModel stamps { providerId, at } and never interactive, and remembers nothing', async () => {
    const { callModel, LOCAL_MODEL_STORAGE_KEY } = await import('./llm-dispatch.js')
    registry.register(localish('automatic'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const { payloads, off } = await heard()
    try {
      await callModel({ providerId: 'automatic', messages: [{ role: 'user', content: 'label this' }] })
      expect(payloads).toHaveLength(1)
      expect(Object.keys(payloads[0]!).sort()).toEqual(['at', 'providerId'])
      expect(payloads[0]!['providerId']).toBe('automatic')
      expect(typeof payloads[0]!['at']).toBe('number')
      expect(localStorage.getItem(LOCAL_MODEL_STORAGE_KEY)).toBeNull()
    } finally { off() }
  })

  it('the routed stream stamps interactive and writes hc:llm:local:model once the send is OK — both stream paths', async () => {
    const { LOCAL_MODEL_STORAGE_KEY, participantLocalChoice } = await import('./llm-dispatch.js')
    expect(LOCAL_MODEL_STORAGE_KEY).toBe('hc:llm:local:model')
    registry.register(localish('own-local'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const { payloads, off } = await heard()
    try {
      await drainStream({ providerId: 'own-local', messages: [{ role: 'user', content: 'hello' }] })
      expect(payloads.map(p => p['interactive'])).toEqual([true])
      expect(typeof payloads[0]!['at']).toBe('number')
      expect(JSON.parse(localStorage.getItem(LOCAL_MODEL_STORAGE_KEY)!)).toMatchObject({ providerId: 'own-local', model: 'own-local-model' })
      expect(participantLocalChoice()).toMatchObject({ providerId: 'own-local', model: 'own-local-model', at: expect.any(Number) })

      localStorage.clear()
      registry.register(localish('own-streaming', { fromStreamEvent: openAiStreamEvent }))
      vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n', { status: 200 })))
      await drainStream({ providerId: 'own-streaming', model: 'own-streaming-model', messages: [{ role: 'user', content: 'hello' }] })
      expect(participantLocalChoice()).toMatchObject({ providerId: 'own-streaming', model: 'own-streaming-model' })
    } finally { off() }
  })

  it('never writes the choice after a failed send, or for a keyed provider', async () => {
    const { LOCAL_MODEL_STORAGE_KEY, participantLocalChoice } = await import('./llm-dispatch.js')
    const { llmKeyStore } = await import('@hypercomb/core')
    registry.register(localish('down-local'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('model not loaded', { status: 500 })))
    await expect(drainStream({ providerId: 'down-local', messages: [{ role: 'user', content: 'hello' }] })).rejects.toThrow('500')
    expect(localStorage.getItem(LOCAL_MODEL_STORAGE_KEY)).toBeNull()

    registry.register(localish('keyed-vendor', { requiresKey: true }))
    llmKeyStore.set('keyed-vendor', 'sk-test')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const { payloads, off } = await heard()
    try {
      await drainStream({ providerId: 'keyed-vendor', messages: [{ role: 'user', content: 'hello' }] })
      expect(localStorage.getItem(LOCAL_MODEL_STORAGE_KEY)).toBeNull()
      expect(participantLocalChoice()).toBeNull()
      expect(payloads, 'a keyed vendor is not the participant\'s machine').toEqual([])
    } finally { off() }
  })

  it('reads a malformed stored choice as none', async () => {
    const { LOCAL_MODEL_STORAGE_KEY, participantLocalChoice } = await import('./llm-dispatch.js')
    for (const stored of ['{not json', '"qwen3:8b"', '{"providerId":"local"}', '{"providerId":"","model":"qwen3:8b"}']) {
      localStorage.setItem(LOCAL_MODEL_STORAGE_KEY, stored)
      expect(participantLocalChoice(), stored).toBeNull()
    }
  })
})
