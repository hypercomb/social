import { beforeEach, describe, expect, it } from 'vitest'
import { llmKeyStore } from '@hypercomb/core'

// "You should be able to add as many OpenRouter instances as you like, not
// just one" — each model added through OpenRouter is its own provider.
const g = globalThis as unknown as { window: { ioc?: unknown } }
g.window.ioc ??= { register: () => {}, get: () => undefined, whenReady: () => {}, list: () => [] }

const { llmModelChoice } = await import('../llm-model-choice.js')
const { llmProviderRegistry } = await import('../llm-provider-registry.js')
await import('./builtin-providers.js')
const { instanceId } = await import('./openrouter-instances.js')
const { candidatesFor } = await import('../model-policy.js')
const { buildRequest } = await import('../llm-dispatch.js')
const { llmHiveAccess } = await import('../llm-hive-access.js')

const SONNET = 'anthropic/claude-sonnet-4.5'
const DEEPSEEK = 'deepseek/deepseek-v4-flash-0731'
const KEY = `sk-or-v1-${'c3'.repeat(32)}`

beforeEach(() => {
  for (const model of llmModelChoice.saved('openrouter')) llmModelChoice.drop('openrouter', model)
  llmKeyStore.clear('openrouter')
  llmHiveAccess.setMayRead('openrouter', false)
  llmHiveAccess.setBudget('openrouter', undefined)
  localStorage.removeItem('hc:llm:openrouter:stages')
})

describe('every model added through OpenRouter is its own provider', () => {
  it('registers Jev only after opt-in and never offers it as a chat worker', async () => {
    const jev = '~typesafe/jev-latest'
    const { OPENROUTER_PROVIDER } = await import('./openrouter.provider.js')
    const { modelForTier } = await import('../model-policy.js')
    const { callModel, routeCandidates } = await import('../llm-dispatch.js')
    expect(llmProviderRegistry().get(instanceId(jev))).toBeUndefined()
    llmModelChoice.add('openrouter', SONNET)
    llmModelChoice.add('openrouter', jev, false)
    llmKeyStore.set('openrouter', KEY)
    const provider = llmProviderRegistry().get(instanceId(jev))!
    expect(provider.decisionOnly).toBe(true)
    expect(llmModelChoice.chosen('openrouter')).toBe(SONNET)
    expect(candidatesFor().map(p => p.id)).not.toContain(provider.id)
    expect(routeCandidates({ fallbackWithin: 'openrouter' }).map(p => p.id)).not.toContain(provider.id)
    await expect(callModel({ providerId: provider.id, messages: [{ role: 'user', content: 'hello' }] })).rejects.toThrow()
    expect(() => OPENROUTER_PROVIDER.toRequest({ model: jev, apiKey: KEY, messages: [] })).toThrow('Decisions API')
    // Legacy persisted choices must not turn the OpenRouter key Test into chat with Jev.
    llmModelChoice.choose('openrouter', jev)
    expect(modelForTier(OPENROUTER_PROVIDER)).not.toBe(jev)
    llmModelChoice.drop('openrouter', jev)
    expect(llmProviderRegistry().get(provider.id)).toBeUndefined()
  })
  it('registers on add and goes away on remove, offering every tier with that one model', () => {
    llmModelChoice.add('openrouter', SONNET)
    const provider = llmProviderRegistry().get(instanceId(SONNET))
    expect(provider?.credentialsFrom).toBe('openrouter')
    expect(provider?.models.map(model => model.tier).sort()).toEqual(['balanced', 'deep', 'fast'])
    expect(new Set(provider?.models.map(model => model.id))).toEqual(new Set([SONNET]))

    llmModelChoice.drop('openrouter', SONNET)
    expect(llmProviderRegistry().get(instanceId(SONNET))).toBeUndefined()
  })

  it('makes every added model a candidate at once, never the configurator itself', () => {
    llmModelChoice.add('openrouter', SONNET)
    llmModelChoice.add('openrouter', DEEPSEEK)
    llmKeyStore.set('openrouter', KEY)
    const ids = candidatesFor({ tier: 'fast', streaming: true }).map(provider => provider.id)
    expect(ids).toContain(instanceId(SONNET))
    expect(ids).toContain(instanceId(DEEPSEEK))
    expect(ids).not.toContain('openrouter')
  })

  it('pays with the OpenRouter key and asks for its own model, whatever the tier', () => {
    llmModelChoice.add('openrouter', SONNET)
    llmKeyStore.set('openrouter', KEY)
    const request = buildRequest(llmProviderRegistry().get(instanceId(SONNET))!, {
      messages: [{ role: 'user', content: 'hi' }],
      need: { tier: 'deep' },
    })
    expect(request.apiKey).toBe(KEY)
    expect(request.model).toBe(SONNET)
  })

  it.each([
    'google/gemini-2.5-flash-lite:batch',
    DEEPSEEK,
  ])('sends %s to authenticated OpenRouter chat completions', model => {
    llmModelChoice.add('openrouter', model)
    llmKeyStore.set('openrouter', KEY)
    const provider = llmProviderRegistry().get(instanceId(model))!
    const request = buildRequest(provider, { messages: [{ role: 'user', content: 'hi' }] })
    const wire = provider.toRequest(request)
    expect(wire.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(wire.init.method).toBe('POST')
    expect(wire.init.headers).toMatchObject({ Authorization: `Bearer ${KEY}` })
    expect(JSON.parse(String(wire.init.body))).toMatchObject({ model, messages: [{ role: 'user', content: 'hi' }] })
  })

  it('reads under the OpenRouter grant and budget', () => {
    llmModelChoice.add('openrouter', SONNET)
    expect(llmHiveAccess.mayRead(instanceId(SONNET))).toBe(false)
    llmHiveAccess.setMayRead('openrouter', true)
    llmHiveAccess.setBudget('openrouter', 9_000)
    expect(llmHiveAccess.mayRead(instanceId(SONNET))).toBe(true)
    expect(llmHiveAccess.granted()).toContain(instanceId(SONNET))
    expect(llmHiveAccess.budget(instanceId(SONNET))).toBe(9_000)
  })
})

describe('the orchestrator chooses among added models by fit', () => {
  it('sends fast work to the cheapest, deep work to the most capable, rules out a window too small, and falls back only within OpenRouter', async () => {
    const CATALOGUE = { data: [
      { id: SONNET, name: 'Anthropic: Claude Sonnet 4.5', pricing: { prompt: '0.000003', completion: '0.000015' }, context_length: 1_000_000 },
      { id: DEEPSEEK, name: 'DeepSeek: DeepSeek V4 Flash 0731', pricing: { prompt: '0.00000004', completion: '0.00000008' }, context_length: 32_000 },
    ] }
    ;(globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: true, status: 200, json: async () => CATALOGUE })
    const { clearOpenRouterCatalogCache, fetchOpenRouterCatalog } = await import('./openrouter-catalog.js')
    const { rankProviders } = await import('../model-policy.js')
    const { routeCandidates } = await import('../llm-dispatch.js')

    const { openRouterStages } = await import('./openrouter-stages.js')
    openRouterStages.set({ fast: 0.1, balanced: 1, deep: 20 }) // DeepSeek fast stage, Sonnet deep stage
    clearOpenRouterCatalogCache()
    llmModelChoice.add('openrouter', SONNET)   // added first…
    llmModelChoice.add('openrouter', DEEPSEEK) // …and yet the cheaper one wins fast work
    llmKeyStore.set('openrouter', KEY)
    await fetchOpenRouterCatalog()

    expect(llmProviderRegistry().get(instanceId(DEEPSEEK))?.label).toBe('DeepSeek V4 Flash 0731')
    expect(rankProviders({ tier: 'fast' })[0]?.id).toBe(instanceId(DEEPSEEK))
    expect(rankProviders({ tier: 'deep' })[0]?.id).toBe(instanceId(SONNET))
    expect(rankProviders({ tier: 'fast', minContext: 100_000 }).map(p => p.id)).not.toContain(instanceId(DEEPSEEK))

    const within = routeCandidates({ need: { tier: 'fast' }, fallbackWithin: 'openrouter' })
    expect(within.length).toBeGreaterThan(0)
    expect(within.every(provider => provider.credentialsFrom === 'openrouter')).toBe(true)
  })
})

describe('a harder or simpler question changes models', () => {
  it('lets the last model keep its place only while it offers the weight now asked for', async () => {
    const CATALOGUE = { data: [
      { id: SONNET, name: 'Anthropic: Claude Sonnet 4.5', pricing: { prompt: '0.000003', completion: '0.000015' }, context_length: 1_000_000 },
      { id: DEEPSEEK, name: 'DeepSeek: DeepSeek V4 Flash 0731', pricing: { prompt: '0.00000004', completion: '0.00000008' }, context_length: 1_310_720 },
    ] }
    ;(globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: true, status: 200, json: async () => CATALOGUE })
    const { clearOpenRouterCatalogCache, fetchOpenRouterCatalog } = await import('./openrouter-catalog.js')
    const { openRouterStages } = await import('./openrouter-stages.js')
    const { routeCandidates } = await import('../llm-dispatch.js')
    openRouterStages.set({ fast: 0.1, balanced: 1, deep: 20 }) // DeepSeek quick, Sonnet heavy
    clearOpenRouterCatalogCache()
    llmModelChoice.add('openrouter', SONNET)
    llmModelChoice.add('openrouter', DEEPSEEK)
    llmKeyStore.set('openrouter', KEY)
    await fetchOpenRouterCatalog()

    const first = (tier: 'fast' | 'deep', preferModel: string): string | undefined =>
      routeCandidates({ need: { tier }, preferModel, fallbackWithin: 'openrouter' })[0]?.id
    // simpler: Sonnet answered last, but quick work goes to DeepSeek
    expect(first('fast', SONNET)).toBe(instanceId(DEEPSEEK))
    // harder: DeepSeek answered last, but heavy work goes to Sonnet
    expect(first('deep', DEEPSEEK)).toBe(instanceId(SONNET))
    // the same weight: the last model is still preferred
    expect(first('deep', SONNET)).toBe(instanceId(SONNET))
  })
})

describe('the background helper', () => {
  it('runs automatically on a model available to the orchestrator, never the local model, and follows the switch', async () => {
    const { organizerGate } = await import('../chat-route.js')
    const { llmActivation } = await import('../llm-activation.js')
    const { clearOpenRouterCatalogCache } = await import('./openrouter-catalog.js')
    clearOpenRouterCatalogCache()
    localStorage.removeItem('hc:llm:orchestrator-provider')
    llmModelChoice.add('openrouter', DEEPSEEK)
    llmKeyStore.set('openrouter', KEY)

    const gate = await organizerGate()
    expect(gate.state === 'awake' ? gate.provider.id : gate.state).toBe(instanceId(DEEPSEEK))

    llmActivation.setEnabled(instanceId(DEEPSEEK), false)
    expect((await organizerGate()).state).toBe('off')
    llmActivation.setEnabled(instanceId(DEEPSEEK), true)
  })
})

describe('a key OpenRouter refuses', () => {
  it('is not tried again on the next model that pays with the same key', async () => {
    const { clearOpenRouterCatalogCache } = await import('./openrouter-catalog.js')
    const { routeCandidates, streamRoutedModel } = await import('../llm-dispatch.js')
    clearOpenRouterCatalogCache()
    llmModelChoice.add('openrouter', SONNET)
    llmModelChoice.add('openrouter', DEEPSEEK)
    llmKeyStore.set('openrouter', KEY)
    expect(routeCandidates({ need: { tier: 'fast' }, fallbackWithin: 'openrouter' }).length).toBeGreaterThan(1)

    const calls: string[] = []
    ;(globalThis as unknown as { fetch: unknown }).fetch = async (url: unknown) => {
      calls.push(String(url))
      return { ok: false, status: 401, text: async () => '{"error":{"message":"User not found.","code":401}}' }
    }
    const run = async (): Promise<void> => {
      for await (const _chunk of streamRoutedModel({
        messages: [{ role: 'user', content: 'hi' }],
        need: { tier: 'fast', streaming: true },
        fallbackWithin: 'openrouter',
      })) { /* a refusal yields nothing */ }
    }
    await expect(run()).rejects.toThrow(/401/)
    expect(calls.filter(url => url.includes('openrouter.ai'))).toHaveLength(1)
  })
})

describe('price stages give each model one level of work', () => {
  it('offers only the tier its price falls in, and leaves a model above the last stop unregistered until the cap rises', async () => {
    const CATALOGUE = { data: [
      { id: SONNET, name: 'Anthropic: Claude Sonnet 4.5', pricing: { prompt: '0.000003', completion: '0.000015' }, context_length: 1_000_000 },
      { id: DEEPSEEK, name: 'DeepSeek: DeepSeek V4 Flash 0731', pricing: { prompt: '0.00000004', completion: '0.00000008' }, context_length: 1_310_720 },
    ] }
    ;(globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: true, status: 200, json: async () => CATALOGUE })
    const { clearOpenRouterCatalogCache, fetchOpenRouterCatalog } = await import('./openrouter-catalog.js')
    const { openRouterStages } = await import('./openrouter-stages.js')
    clearOpenRouterCatalogCache()
    llmModelChoice.add('openrouter', DEEPSEEK)
    llmModelChoice.add('openrouter', SONNET)
    await fetchOpenRouterCatalog()

    // default stages: DeepSeek ($0.08) is fast work; Sonnet ($15) is above the cap
    expect(llmProviderRegistry().get(instanceId(DEEPSEEK))?.models.map(m => m.tier)).toEqual(['fast'])
    expect(llmProviderRegistry().get(instanceId(SONNET))).toBeUndefined()

    openRouterStages.set({ fast: 0.1, balanced: 1, deep: 20 })
    expect(llmProviderRegistry().get(instanceId(SONNET))?.models.map(m => m.tier)).toEqual(['deep'])
  })
})
