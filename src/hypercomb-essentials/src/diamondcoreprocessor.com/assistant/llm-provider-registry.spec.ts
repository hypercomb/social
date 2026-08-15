// llm-provider-registry.spec.ts — the roster's contract.
//
// The two rules worth a mechanical guard are the ones whose violation is
// silent: a vendor colour that agent-model.ts does not know (two palettes for
// one company), and a defaultModel that is not on the provider's own list (a
// call that 404s only when someone finally picks that provider).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const registryHarness = async () => {
  const ioc = new Map<string, unknown>()
  ;(globalThis as unknown as { window: unknown }).window = {
    ioc: {
      register: (k: string, v: unknown) => { if (!ioc.has(k)) ioc.set(k, v) },
      get: (k: string) => ioc.get(k),
    },
  }
  vi.resetModules()
  return import('./llm-provider-registry.js')
}

const descriptor = (over: Record<string, unknown> = {}) => ({
  id: 'probe',
  label: 'Probe',
  vendor: 'openai',
  transport: 'browser-http' as const,
  models: [{ name: 'probe', id: 'probe-1', tier: 'balanced' as const }],
  defaultModel: 'probe-1',
  docsUrl: 'https://example.invalid/keys',
  toRequest: () => ({ url: 'https://example.invalid', init: {} }),
  fromResponse: () => ({ text: '', stopReason: 'stop', inputTokens: 0, outputTokens: 0, model: 'probe-1' }),
  ...over,
})

describe('LlmProviderRegistry', () => {
  let mod: Awaited<ReturnType<typeof registryHarness>>

  beforeEach(async () => { mod = await registryHarness() })

  it('registers and looks up a provider', () => {
    const registry = mod.llmProviderRegistry()
    const probe = descriptor()
    registry.register(probe)
    expect(registry.get('probe')).toBe(probe)
    expect(registry.all()).toContain(probe)
  })

  it('rejects a vendor agent-model.ts does not know — never a second palette', () => {
    expect(() => mod.llmProviderRegistry().register(descriptor({ vendor: 'acme' })))
      .toThrow(/unknown vendor "acme"/)
  })

  it('rejects a defaultModel that is not one of its models', () => {
    expect(() => mod.llmProviderRegistry().register(descriptor({ defaultModel: 'nope' })))
      .toThrow(/defaultModel "nope" is not one of its models/)
  })

  it('rejects a provider with no docsUrl — guided setup has nowhere to send you', () => {
    expect(() => mod.llmProviderRegistry().register(descriptor({ docsUrl: '' })))
      .toThrow(/docsUrl/)
  })

  it('is idempotent for the same descriptor and ignores a rival for one id', () => {
    const registry = mod.llmProviderRegistry()
    const probe = descriptor()
    const rival = descriptor({ label: 'Rival' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registry.register(probe)
    registry.register(probe)
    registry.register(rival)
    expect(registry.all().filter(p => p.id === 'probe')).toHaveLength(1)
    expect(registry.get('probe')).toBe(probe)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('resolves a model name back to its provider, and refuses to guess', () => {
    const registry = mod.llmProviderRegistry()
    const probe = descriptor()
    registry.register(probe)
    expect(registry.providerForModel('probe-1')).toBe(probe)
    expect(registry.providerForModel('PROBE')).toBe(probe)     // human name
    expect(registry.providerForModel('something-else')).toBeUndefined()
  })

  it('resolves a human name to a wire id, defaults when unnamed, and passes an unknown through', () => {
    const registry = mod.llmProviderRegistry()
    const probe = descriptor()
    registry.register(probe)
    expect(registry.resolveModelId(probe, 'probe')).toBe('probe-1')
    expect(registry.resolveModelId(probe)).toBe('probe-1')
    // A vendor ships models faster than this repo learns them.
    expect(registry.resolveModelId(probe, 'probe-9-preview')).toBe('probe-9-preview')
  })
})

describe('the built-in roster', () => {
  it('registers every shipped vendor, each with a colour agent-model.ts knows', async () => {
    const mod = await registryHarness()
    const { KNOWN_VENDORS } = await import('../presentation/avatars/agent-model.js')
    await import('./providers/builtin-providers.js')

    const registry = mod.llmProviderRegistry()
    const ids = registry.all().map(p => p.id).sort()
    expect(ids).toEqual(
      ['anthropic', 'deepseek', 'google', 'local', 'mistral', 'openai', 'xai'],
    )
    for (const provider of registry.all()) {
      expect(KNOWN_VENDORS, provider.id).toContain(provider.vendor)
      expect(provider.models.length, provider.id).toBeGreaterThan(0)
    }
  })

  it('asks for no key only where there is nobody to bill', async () => {
    const mod = await registryHarness()
    await import('./providers/builtin-providers.js')
    const keyless = mod.llmProviderRegistry().all().filter(p => p.requiresKey === false)
    expect(keyless.map(p => p.id)).toEqual(['local'])
  })

  it('sends the Anthropic key in the header and never in the body', async () => {
    const mod = await registryHarness()
    await import('./providers/builtin-providers.js')
    const anthropic = mod.llmProviderRegistry().get('anthropic')!
    const { url, init } = anthropic.toRequest({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hello' }],
      system: 'be brief',
      apiKey: 'sk-ant-secret',
    })
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-secret')
    expect(String(init.body)).not.toContain('sk-ant-secret')
  })

  it('marks the system prompt for caching only when the caller asks', async () => {
    const mod = await registryHarness()
    await import('./providers/builtin-providers.js')
    const anthropic = mod.llmProviderRegistry().get('anthropic')!
    const plain = anthropic.toRequest({
      model: 'claude-sonnet-4-6', messages: [], system: 'stable', apiKey: 'k',
    })
    const cached = anthropic.toRequest({
      model: 'claude-sonnet-4-6', messages: [], system: 'stable', cacheSystem: true, apiKey: 'k',
    })
    expect(String(plain.init.body)).not.toContain('cache_control')
    expect(String(cached.init.body)).toContain('cache_control')
  })
})
