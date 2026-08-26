// provider-spec.spec.ts — a spec that parses always compiles and registers.
//
// The compiler is the trust boundary for DISCOVERED providers: whatever a
// domain publishes goes through parseProviderSpec before it can ever build a
// request, so these tests are the contract of what the network may say.

import { describe, expect, it } from 'vitest'

// The compiler pulls in vendor adapters, which self-register in window.ioc at
// module load — stub it the way llm-provider-registry.spec.ts does.
const iocMap = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (k: string, v: unknown) => { if (!iocMap.has(k)) iocMap.set(k, v) },
    get: (k: string) => iocMap.get(k),
  },
}

const { PROVIDER_SPEC_FORMAT, compileProviderSpec, parseProviderSpec } = await import('./provider-spec.js')
type LlmProviderSpec = import('./provider-spec.js').LlmProviderSpec
type LlmRequest = import('./llm-provider.types.js').LlmRequest

const REQUEST: LlmRequest = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'hi' }],
  apiKey: 'secret-key',
}

const base = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: PROVIDER_SPEC_FORMAT,
  id: 'acme',
  label: 'Acme AI',
  shape: 'openai',
  endpoint: 'https://api.acme.ai/v1',
  models: [{ name: 'acme-large', id: 'acme-large-1', tier: 'deep' }],
  defaultModel: 'acme-large-1',
  docsUrl: 'https://acme.ai/keys',
  ...over,
})

describe('parseProviderSpec', () => {
  it('accepts a minimal openai-shape spec (and a JSON string)', () => {
    const spec = parseProviderSpec(JSON.stringify(base()))
    expect(spec.id).toBe('acme')
    expect(spec.defaultModel).toBe('acme-large-1')
  })

  it('rejects the wrong format tag', () => {
    expect(() => parseProviderSpec(base({ format: 'llm-provider@2' }))).toThrow(/format/)
  })

  it('rejects a plaintext endpoint off-machine, accepts localhost', () => {
    expect(() => parseProviderSpec(base({ endpoint: 'http://api.acme.ai/v1' }))).toThrow(/https/)
    expect(parseProviderSpec(base({ endpoint: 'http://localhost:8080/v1' })).endpoint)
      .toBe('http://localhost:8080/v1')
  })

  it('rejects a defaultModel outside the roster and an empty roster', () => {
    expect(() => parseProviderSpec(base({ defaultModel: 'ghost' }))).toThrow(/defaultModel/)
    expect(() => parseProviderSpec(base({ models: [] }))).toThrow(/model/)
  })

  it('defaults defaultModel to the first model when omitted', () => {
    expect(parseProviderSpec(base({ defaultModel: undefined })).defaultModel).toBe('acme-large-1')
  })

  it('rejects an auth style it does not know', () => {
    expect(() => parseProviderSpec(base({ auth: 'cookie' }))).toThrow(/auth/)
    expect(parseProviderSpec(base({ auth: { header: 'X-Custom' } })).auth)
      .toEqual({ header: 'X-Custom' })
  })

  it('rejects a keyPattern that does not compile', () => {
    expect(() => parseProviderSpec(base({ keyPattern: '[' }))).toThrow(/keyPattern/)
  })
})

describe('compileProviderSpec', () => {
  const compile = (over: Record<string, unknown> = {}) =>
    compileProviderSpec(parseProviderSpec(base(over)) as LlmProviderSpec)

  it('openai shape: bearer by default, /chat/completions appended once', () => {
    const { url, init } = compile().toRequest(REQUEST)
    expect(url).toBe('https://api.acme.ai/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')

    const explicit = compile({ endpoint: 'https://api.acme.ai/v1/chat/completions' })
    expect(explicit.toRequest(REQUEST).url).toBe('https://api.acme.ai/v1/chat/completions')
  })

  it('openai shape: custom auth header carries the key its own way', () => {
    const { init } = compile({ auth: { header: 'X-Acme-Key', prefix: 'k-' } }).toRequest(REQUEST)
    const headers = init.headers as Record<string, string>
    expect(headers['X-Acme-Key']).toBe('k-secret-key')
    expect(headers.Authorization).toBeUndefined()
  })

  it('requiresKey false sends no auth header at all', () => {
    const descriptor = compile({ requiresKey: false })
    expect(descriptor.requiresKey).toBe(false)
    const headers = descriptor.toRequest({ ...REQUEST, apiKey: '' }).init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('anthropic shape targets the spec endpoint with x-api-key', () => {
    const descriptor = compile({ shape: 'anthropic', endpoint: 'https://proxy.acme.ai/v1/messages' })
    const { url, init } = descriptor.toRequest(REQUEST)
    expect(url).toBe('https://proxy.acme.ai/v1/messages')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('secret-key')
  })

  it('google shape puts the model in the URL path', () => {
    const descriptor = compile({ shape: 'google', endpoint: 'https://gw.acme.ai/models' })
    expect(descriptor.toRequest(REQUEST).url).toContain('/models/test-model:generateContent')
  })

  it('an unknown vendor lands in a family the palette knows', () => {
    const descriptor = compile({ vendor: 'totally-new-startup' })
    expect(descriptor.vendor).toBe('local')
    expect(compile({ vendor: 'mistral' }).vendor).toBe('mistral')
  })

  it('fills missing tiers from the model name', () => {
    const descriptor = compile({
      models: [{ name: 'mini', id: 'acme-mini' }],
      defaultModel: 'acme-mini',
    })
    expect(descriptor.models[0].tier).toBe('fast')
  })
})

// ── the fourth shape: a frontier CLI parked on the broker ────────────────────
//
// A bridge is the only tier that can READ THE HIVE, and the only one that
// takes no key. Both facts are load-bearing in the console (badge, no key
// field), so both are guarded here — as is the refusal to be fetched, which
// is what stops the dispatch seam from inventing a URL for it.

const bridgeSpec = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: PROVIDER_SPEC_FORMAT,
  id: 'gemini-bridge',
  label: 'Gemini CLI',
  vendor: 'google',
  shape: 'agent-bridge',
  models: [{ name: 'gemini', id: 'gemini-2.5-flash', tier: 'balanced' }],
  defaultModel: 'gemini-2.5-flash',
  docsUrl: 'https://github.com/google-gemini/gemini-cli',
  ...over,
})

describe('agent-bridge specs', () => {
  it('needs no endpoint, no key, and reads the hive', () => {
    const spec = parseProviderSpec(bridgeSpec())
    expect(spec.transport).toBe('agent-bridge')
    expect(spec.requiresKey).toBe(false)
    expect(spec.readsHive).toBe(true)
    expect(spec.endpoint).toBeUndefined()
  })

  it('keeps a validated subscription availability snapshot', () => {
    const spec = parseProviderSpec(bridgeSpec({
      subscription: {
        status: 'limited', source: 'CLI status', checkedAt: 123,
        windows: [{ label: 'Weekly', remainingPercent: 12, resetsAt: 456 }],
      },
    }))
    expect(spec.subscription).toEqual({
      status: 'limited', source: 'CLI status', checkedAt: 123,
      windows: [{ label: 'Weekly', remainingPercent: 12, resetsAt: 456 }],
    })
    expect(compileProviderSpec(spec).subscription).toEqual(spec.subscription)
  })

  it('refuses an endpoint, an auth style, and a mismatched transport', () => {
    expect(() => parseProviderSpec(bridgeSpec({ endpoint: 'https://api.example/v1' })))
      .toThrow(/must not declare an endpoint/)
    expect(() => parseProviderSpec(bridgeSpec({ auth: 'bearer' }))).toThrow(/takes no auth/)
    expect(() => parseProviderSpec(bridgeSpec({ transport: 'browser-http' }))).toThrow(/transport/)
  })

  it('refuses an HTTP vendor claiming it reads the hive', () => {
    expect(() => parseProviderSpec(base({ readsHive: true }))).toThrow(/readsHive/)
  })

  it('compiles to a descriptor that refuses to be fetched', () => {
    const descriptor = compileProviderSpec(parseProviderSpec(bridgeSpec()) as LlmProviderSpec)
    expect(descriptor.transport).toBe('agent-bridge')
    expect(descriptor.readsHive).toBe(true)
    expect(descriptor.requiresKey).toBe(false)
    expect(descriptor.endpoint).toBeUndefined()
    expect(() => descriptor.toRequest(REQUEST)).toThrow(/cannot be called over HTTP/)
    expect(() => descriptor.fromResponse({}, REQUEST)).toThrow(/cannot be called over HTTP/)
  })

  it('keeps its vendor colour when the palette knows it', () => {
    const descriptor = compileProviderSpec(parseProviderSpec(bridgeSpec()) as LlmProviderSpec)
    expect(descriptor.vendor).toBe('google')
  })
})
