// grok-endpoint.spec.ts — the Grok subscription endpoint's contract with the hive.
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const iocMap = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (k: string, v: unknown) => { if (!iocMap.has(k)) iocMap.set(k, v) },
    get: (k: string) => iocMap.get(k),
  },
}

const require = createRequire(import.meta.url)
const { promptOf, originAllowed, providerSpec } = require('./grok-endpoint.cjs')
const { compileProviderSpec, parseProviderSpec } = await import('../../hypercomb-essentials/src/assistant/providers/provider-spec.js')
const { costOf } = await import('../../hypercomb-essentials/src/assistant/model-policy.js')

describe('the spec it serves', () => {
  it('passes the hive parser and lands as a subscription, not a local model', () => {
    const spec = parseProviderSpec(providerSpec({ defaultModel: 'grok-4.7', models: ['grok-4.7', 'grok-4.7-build-fast'] }))
    expect(spec.account).toMatch(/Grok subscription/)
    const descriptor = compileProviderSpec(spec)
    expect(costOf(descriptor)).toBe('bridge')
    expect(descriptor.models.find(m => m.id === 'grok-4.7-build-fast')?.tier).toBe('fast')
  })
})

describe('who may call it', () => {
  it('admits the hive and this machine, refuses any other site', () => {
    expect(originAllowed(undefined)).toBe(true)
    expect(originAllowed('http://localhost:4250')).toBe(true)
    expect(originAllowed('https://hypercomb.io')).toBe(true)
    expect(originAllowed('https://evil.example')).toBe(false)
    expect(originAllowed('https://someone.hypercomb.io')).toBe(false)
    expect(originAllowed('null')).toBe(false)
  })
})

describe('the prompt', () => {
  it('a lone question goes over as itself', () => {
    expect(promptOf([{ role: 'user', content: 'Hi?' }])).toMatch(/^Hi\?/)
  })
  it('a conversation carries its instructions and every turn', () => {
    const prompt = promptOf([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'One' },
      { role: 'assistant', content: [{ type: 'text', text: 'Two' }] },
      { role: 'user', content: 'Three' },
    ])
    expect(prompt).toContain('<instructions>\nBe brief.\n</instructions>')
    expect(prompt).toContain('User: One\n\nAssistant: Two\n\nUser: Three')
  })
})
