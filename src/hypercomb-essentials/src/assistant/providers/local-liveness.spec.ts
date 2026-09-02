// @vitest-environment node
//
// local-liveness.spec.ts — "a model on this machine answers" is a claim about
// a running process, and the only honest way to hold it is to have asked.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const iocMap = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (key: string, value: unknown) => { if (!iocMap.has(key)) iocMap.set(key, value) },
    get: (key: string) => iocMap.get(key),
  },
}

// A device-local store the way a browser has one: `localLlmHost` and the
// remembered address are read through it.
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => store.clear(),
}

const { llmProviderRegistry } = await import('../llm-provider-registry.js')
const { LOCAL_PROVIDER, localLlmHost } = await import('./local.provider.js')
const {
  checkLocalServer,
  localModelServerUp,
  machineLocalEndpoint,
  modelsFromServer,
  recheckLocalServers,
} = await import('./local-liveness.js')
const { llmRouter, streamRoutedModel } = await import('../llm-dispatch.js')

type Descriptor = import('./llm-provider.types.js').LlmProviderDescriptor

const HOST = 'http://localhost:11999'

const localDescriptor = (endpoint = HOST): Descriptor => ({
  id: 'my-machine',
  label: 'My machine',
  vendor: 'local',
  transport: 'browser-http',
  endpoint,
  requiresKey: false,
  models: [{ name: 'suggested', id: 'suggested:7b', tier: 'fast' }],
  defaultModel: 'suggested:7b',
  docsUrl: 'https://example.test',
  toRequest: request => ({
    url: `${endpoint}/v1/chat/completions`,
    init: { method: 'POST', body: JSON.stringify({ model: request.model }) },
  }),
  fromResponse: () => ({ text: 'hi', stopReason: 'stop', inputTokens: 1, outputTokens: 1, model: 'suggested:7b' }),
})

/** A server that answers `/v1/models` with the ids it actually holds. */
const serverWith = (...ids: string[]) => vi.fn(async (url: string) => {
  if (url.endsWith('/v1/models')) {
    return new Response(JSON.stringify({ data: ids.map(id => ({ id })) }), { status: 200 })
  }
  throw new TypeError('unexpected call')
})

const registry = llmProviderRegistry()

beforeEach(() => {
  for (const provider of registry.all()) registry.unregister(provider.id)
  store.clear()
  recheckLocalServers()
  vi.restoreAllMocks()
})

describe('machineLocalEndpoint', () => {
  it('claims loopback HTTP providers and nothing else', () => {
    expect(machineLocalEndpoint(localDescriptor())).toBe(HOST)
    expect(machineLocalEndpoint(localDescriptor('http://127.0.0.1:1234'))).toBe('http://127.0.0.1:1234')
    expect(machineLocalEndpoint(localDescriptor('https://api.example.test'))).toBe('')
    // A descriptor that names no endpoint is not a local server by omission.
    expect(machineLocalEndpoint({ ...localDescriptor(), endpoint: undefined })).toBe('')
  })
})

describe('the readiness gate', () => {
  it('does not call a machine-local provider ready before anything answered', () => {
    registry.register(localDescriptor())
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('refused') }))
    // Unknown is not ready: the claim needs an answer, not an assumption.
    expect(localModelServerUp(registry.get('my-machine')!)).toBe(false)
    expect(llmRouter.ready({ need: { tier: 'fast', streaming: true } })).toBe(false)
  })

  it('reports a stopped server as down, and says so in one token', async () => {
    const provider = localDescriptor()
    registry.register(provider)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('connection refused') }))

    const report = await checkLocalServer(provider)
    expect(report.state).toBe('asleep')
    expect(localModelServerUp(provider)).toBe(false)
    expect(llmRouter.ready({ need: { tier: 'fast', streaming: true } })).toBe(false)
    expect(llmRouter.reason()).toBe('local-down')
  })

  it('separates a refused ORIGIN from a stopped server', async () => {
    const provider = localDescriptor()
    registry.register(provider)
    // CORS-mode reads fail; the opaque no-cors probe succeeds — something is
    // listening, it just will not talk to this page.
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      // A no-cors request resolves with an opaque response the page cannot
      // read; what matters is that it resolved at all.
      if (init?.mode === 'no-cors') return new Response(null, { status: 200 })
      throw new TypeError('blocked by CORS')
    }))

    expect((await checkLocalServer(provider)).state).toBe('blocked')
    expect(llmRouter.reason()).toBe('local-blocked')
  })

  it('counts a running server with no model pulled as unable to answer', async () => {
    const provider = localDescriptor()
    registry.register(provider)
    vi.stubGlobal('fetch', serverWith())

    expect((await checkLocalServer(provider)).state).toBe('empty')
    expect(localModelServerUp(provider)).toBe(false)
    expect(llmRouter.reason()).toBe('local-down')
  })

  it('is ready — and quiet — once the server answers with a model', async () => {
    const provider = localDescriptor()
    registry.register(provider)
    vi.stubGlobal('fetch', serverWith('qwen2.5-coder:7b'))

    expect((await checkLocalServer(provider)).state).toBe('awake')
    expect(localModelServerUp(registry.get('my-machine')!)).toBe(true)
    expect(llmRouter.ready({ need: { tier: 'fast', streaming: true } })).toBe(true)
    expect(llmRouter.reason()).toBe('')
  })
})

describe('the roster the server actually holds', () => {
  it('replaces the suggested model list with what is installed', async () => {
    const provider = localDescriptor()
    registry.register(provider)
    vi.stubGlobal('fetch', serverWith('qwen2.5-coder:7b', 'qwen3:32b'))

    await checkLocalServer(provider)

    const live = registry.get('my-machine')!
    expect(live.models.map(model => model.id)).toEqual(['qwen2.5-coder:7b', 'qwen3:32b'])
    // The suggestion that is not installed can no longer be designated.
    expect(live.defaultModel).toBe('qwen2.5-coder:7b')
    expect(registry.providerForModel('qwen3:32b')?.id).toBe('my-machine')
  })

  it('keeps a still-installed default across a restart', async () => {
    const provider = { ...localDescriptor(), defaultModel: 'kept:7b', models: [{ name: 'kept', id: 'kept:7b', tier: 'fast' as const }] }
    registry.register(provider)
    vi.stubGlobal('fetch', serverWith('other:7b', 'kept:7b'))

    await checkLocalServer(provider)
    expect(registry.get('my-machine')!.defaultModel).toBe('kept:7b')
  })

  it('reads size off the tag and names the family when it is unambiguous', () => {
    expect(modelsFromServer(['qwen2.5-coder:7b', 'llama3.3:70b', 'mystery'])).toEqual([
      { name: 'qwen2.5-coder', id: 'qwen2.5-coder:7b', tier: 'fast', label: 'qwen2.5-coder:7b' },
      { name: 'llama3.3', id: 'llama3.3:70b', tier: 'deep', label: 'llama3.3:70b' },
      { name: 'mystery', id: 'mystery', tier: 'balanced', label: 'mystery' },
    ])
    // Two tags of one family: the family word would be ambiguous, so neither takes it.
    expect(modelsFromServer(['qwen3:8b', 'qwen3:32b']).map(model => model.name))
      .toEqual(['qwen3:8b', 'qwen3:32b'])
  })
})

describe('a call that finds nothing listening', () => {
  it('fails with the fix instead of "Failed to fetch"', async () => {
    const provider = localDescriptor()
    registry.register(provider)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    const run = async (): Promise<void> => {
      for await (const _chunk of streamRoutedModel({
        providerId: 'my-machine',
        messages: [{ role: 'user', content: 'hello' }],
      })) { /* nothing arrives */ }
    }

    await expect(run()).rejects.toThrow(/did not answer at http:\/\/localhost:11999/)
    await expect(run()).rejects.toThrow(/OLLAMA_ORIGINS/)
  })
})

describe('the other loopback spellings', () => {
  /** A server bound to ONE spelling: the classic Windows shape, where Ollama
   *  holds 127.0.0.1 and `localhost` resolves to a dead ::1 first. */
  const boundTo = (live: string) => vi.fn(async (url: string, init?: RequestInit) => {
    if (!url.startsWith(live)) throw new TypeError('connection refused')
    if (init?.mode === 'no-cors') return new Response(null, { status: 200 })
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'qwen3:8b' }] }), { status: 200 })
    }
    throw new TypeError('not here')
  })

  it('finds the server at a sibling address and stays there', async () => {
    registry.register(LOCAL_PROVIDER)
    vi.stubGlobal('fetch', boundTo('http://localhost:11434'))

    const report = await checkLocalServer(LOCAL_PROVIDER)
    expect(report.state).toBe('awake')
    expect(report.host).toBe('http://localhost:11434')
    // Remembered, so the next boot knocks on the right door first.
    expect(localLlmHost()).toBe('http://localhost:11434')
    expect(localModelServerUp(registry.get('local')!)).toBe(true)
  })

  it('never walks away from an address the participant typed', async () => {
    store.set('hc:llm:local:host', 'http://127.0.0.1:9999')
    registry.register(LOCAL_PROVIDER)
    const fetchMock = boundTo('http://localhost:11434')
    vi.stubGlobal('fetch', fetchMock)

    expect((await checkLocalServer(LOCAL_PROVIDER)).state).toBe('asleep')
    expect(localLlmHost()).toBe('http://127.0.0.1:9999')
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url).startsWith('http://127.0.0.1:9999')).toBe(true)
    }
  })
})

describe('the browser barrier', () => {
  /** A page on the public web: Chromium gates local-network requests behind a
   *  permission, and until it is answered the fetch HANGS rather than fails. */
  const onPublicOrigin = (state: string): void => {
    ;(globalThis as unknown as { location: unknown }).location =
      { protocol: 'https:', hostname: 'hypercomb.io', origin: 'https://hypercomb.io' }
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { permissions: { query: async () => ({ state, onchange: null }) } },
    })
  }

  const offPublicOrigin = (): void => {
    ;(globalThis as unknown as { location: unknown }).location =
      { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:4250' }
  }

  it('says the browser is in the way, not that the server is down', async () => {
    onPublicOrigin('prompt')
    const provider = localDescriptor()
    registry.register(provider)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    expect((await checkLocalServer(provider)).state).toBe('needs-permission')
    expect(llmRouter.reason()).toBe('local-permission')
    offPublicOrigin()
  })

  it('still calls a stopped server stopped once the permission is granted', async () => {
    onPublicOrigin('granted')
    const provider = localDescriptor()
    registry.register(provider)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('connection refused') }))

    expect((await checkLocalServer(provider)).state).toBe('asleep')
    expect(llmRouter.reason()).toBe('local-down')
    offPublicOrigin()
  })
})
