import { afterEach, describe, expect, it } from 'vitest'
import { hostSlug, openRouterRouting, providerBlock } from './openrouter-routing.js'
import { OPENROUTER_PROVIDER } from './openrouter.provider.js'
import { llmModelChoice } from '../llm-model-choice.js'
import { modelForTier } from '../model-policy.js'

const MODEL = 'deepseek/deepseek-v4-flash-0731'
const body = (model = MODEL) => JSON.parse(String(OPENROUTER_PROVIDER.toRequest({
  model, messages: [{ role: 'user', content: 'hi' }], apiKey: 'sk-or-v1-test',
}).init.body)) as Record<string, unknown>

afterEach(() => {
  localStorage.removeItem('hc:llm:openrouter:routing')
  localStorage.removeItem('hc:llm:openrouter:model')
})

describe('OpenRouter host routing', () => {
  it('sends no provider block while every setting is OpenRouter default', () => {
    expect(providerBlock({}, MODEL)).toBeUndefined()
    expect(body()).not.toHaveProperty('provider')
  })

  it('turns ticked hosts, sort, fallbacks and privacy into the request provider block', () => {
    openRouterRouting.setHostsFor(MODEL, ['baidu', 'deepinfra'])
    openRouterRouting.setSort('price')
    openRouterRouting.setAllowFallbacks(false)
    openRouterRouting.setDenyDataCollection(true)
    expect(body()['provider']).toEqual({
      order: ['baidu', 'deepinfra'], only: ['baidu', 'deepinfra'],
      sort: 'price', allow_fallbacks: false, data_collection: 'deny',
    })
    // hosts are per model: another model gets the global switches only
    expect(body('google/gemini-2.5-flash-lite')['provider']).toEqual({
      sort: 'price', allow_fallbacks: false, data_collection: 'deny',
    })
    // the model the participant asked for is never overwritten by the block
    expect(body()['model']).toBe(MODEL)
  })

  it('drops junk from storage instead of sending it', () => {
    localStorage.setItem('hc:llm:openrouter:routing', JSON.stringify({
      only: { [MODEL]: ['Good-Host', 'bad host!', 42] }, sort: 'random', allowFallbacks: 'no',
    }))
    expect(openRouterRouting.get()).toEqual({ only: { [MODEL]: ['good-host'] } })
    localStorage.setItem('hc:llm:openrouter:routing', '{not json')
    expect(openRouterRouting.get()).toEqual({})
  })

  it('takes the routing slug from the base of an endpoint tag', () => {
    expect(hostSlug('open-inference/fp8')).toBe('open-inference')
    expect(hostSlug('DeepInfra')).toBe('deepinfra')
  })
})

describe('a chosen model', () => {
  it('answers every tier for its provider until cleared', () => {
    expect(modelForTier(OPENROUTER_PROVIDER, 'fast')).toBe('google/gemini-2.5-flash-lite')
    llmModelChoice.choose('openrouter', 'anthropic/claude-sonnet-4.5')
    expect(modelForTier(OPENROUTER_PROVIDER, 'fast')).toBe('anthropic/claude-sonnet-4.5')
    expect(modelForTier(OPENROUTER_PROVIDER, 'deep')).toBe('anthropic/claude-sonnet-4.5')
    llmModelChoice.choose('openrouter', undefined)
    expect(modelForTier(OPENROUTER_PROVIDER, 'deep')).toBe('deepseek/deepseek-r1')
  })
})
