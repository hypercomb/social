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
const { streamRoutedModel } = await import('./llm-dispatch.js')

type Descriptor = import('./providers/llm-provider.types.js').LlmProviderDescriptor

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
  it('falls through a failed automatic route and reports who actually answered', async () => {
    registry.register(descriptor('first', 'unused'))
    registry.register(descriptor('second', 'hello'))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('first')) throw new TypeError('offline')
      return new Response('{}', { status: 200 })
    }))

    const chunks = []
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

    const chunks = []
    for await (const chunk of streamRoutedModel({
      need: { tier: 'fast' }, messages: [{ role: 'user', content: 'hello' }],
    })) chunks.push(chunk)

    expect(chunks[0]?.providerId).toBe('visible-second')
    expect(chunks[0]?.text).toBe('visible')
  })

  it('treats the previous model as sticky preference, not a fallback veto', async () => {
    registry.register(descriptor('fallback', 'recovered'))
    registry.register(descriptor('sticky', 'unused'))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('sticky')) throw new TypeError('sticky provider is down')
      return new Response('{}', { status: 200 })
    }))

    const chunks = []
    for await (const chunk of streamRoutedModel({
      preferModel: 'sticky-model',
      need: { tier: 'fast' },
      messages: [{ role: 'user', content: 'continue' }],
    })) chunks.push(chunk)

    expect(chunks[0]?.providerId).toBe('fallback')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
