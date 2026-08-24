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
