// A picture is described in words for a model that cannot see, by a model
// that can, on the participant's own key — once per picture.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { describePicture, describer, forgetDescriptions, type DescribeDeps } from './picture-describe.js'
import type { LlmProviderDescriptor } from './providers/llm-provider.types.js'

const IMAGE = { mime: 'image/jpeg', base64: 'AAAA' }
const line = (id: string, vision?: boolean): LlmProviderDescriptor =>
  ({ id, models: [{ name: id, id, tier: 'balanced', ...(vision ? { vision: true } : {}) }] }) as unknown as LlmProviderDescriptor

const deps = (over: Partial<DescribeDeps> = {}): DescribeDeps => ({
  ready: () => [line('or:deepseek/deepseek-v4-flash')],
  hasOpenRouterKey: () => true,
  catalogueSees: async model => model === 'google/gemini-2.5-flash-lite',
  call: vi.fn(async (_provider, model) => ({ text: 'A teal card with the words "Host your hive".', model, stopReason: 'stop', inputTokens: 1, outputTokens: 1 })),
  ...over,
})

beforeEach(() => forgetDescriptions())

describe('who describes a picture', () => {
  it('is the participant\'s own line that sees, first', async () => {
    expect(await describer(deps({ ready: () => [line('a/reads'), line('b/sees', true)] }))).toEqual({ providerId: 'b/sees', model: 'b/sees' })
  })

  it('else the OpenRouter line\'s lightest built-in model that the catalogue says sees', async () => {
    expect(await describer(deps())).toEqual({ providerId: 'openrouter', model: 'google/gemini-2.5-flash-lite' })
  })

  it('is nobody without an OpenRouter key or a seeing model', async () => {
    expect(await describer(deps({ hasOpenRouterKey: () => false }))).toBeUndefined()
    expect(await describer(deps({ catalogueSees: async () => false }))).toBeUndefined()
  })
})

describe('a picture described', () => {
  it('asks once per picture and remembers the answer', async () => {
    const call = vi.fn(deps().call)
    const first = await describePicture('s'.repeat(64), IMAGE, deps({ call }))
    expect(first).toEqual({ text: 'A teal card with the words "Host your hive".', model: 'google/gemini-2.5-flash-lite' })
    expect(call.mock.calls[0]![2]).toEqual(IMAGE)
    expect(await describePicture('s'.repeat(64), IMAGE, deps({ call }))).toEqual(first)
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('is nothing when the call fails or says nothing, and never throws', async () => {
    expect(await describePicture('t'.repeat(64), IMAGE, deps({ call: async () => { throw new Error('402') } }))).toBeUndefined()
    expect(await describePicture('u'.repeat(64), IMAGE, deps({ call: async () => ({ text: '  ', model: 'x', stopReason: 'stop', inputTokens: 0, outputTokens: 0 }) }))).toBeUndefined()
  })
})
