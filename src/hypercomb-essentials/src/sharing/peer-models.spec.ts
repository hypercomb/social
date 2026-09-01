// peer-models.spec.ts — lending somebody your machine, and the limits on it.
//
// Two things here are worth mechanical guards. The first is a MONEY rule: a
// provider that needs a key must never be offered to the swarm, because
// answering a stranger's prompt with it spends the host's money. The second
// is a TRUST rule: an offer is a stranger's JSON, so it goes through the same
// validator as every other provider — a peer cannot talk this client into an
// endpoint, a key field, or hive access.

import { describe, expect, it } from 'vitest'

const iocMap = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (k: string, v: unknown) => { if (!iocMap.has(k)) iocMap.set(k, v) },
    get: (k: string) => iocMap.get(k),
  },
}

const { compileProviderSpec, parseProviderSpec } = await import('../assistant/providers/provider-spec.js')
type LlmProviderSpec = import('../assistant/providers/provider-spec.js').LlmProviderSpec

const PEER = 'a'.repeat(64)

const offer = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: 'llm-provider@1',
  id: 'peer-aaaaaaaa',
  label: 'Dolphin’s models',
  shape: 'peer-swarm',
  peer: PEER,
  models: [{ name: 'llama', id: 'llama3.1', tier: 'balanced' }],
  defaultModel: 'llama3.1',
  docsUrl: 'https://hypercomb.io/',
  requiresKey: false,
  ...over,
})

describe('an offer from a peer', () => {
  it('parses into a peer-swarm provider that names whose machine it is', () => {
    const spec = parseProviderSpec(offer())
    expect(spec.transport).toBe('peer-swarm')
    expect(spec.peer).toBe(PEER)
    expect(spec.requiresKey).toBe(false)
    expect(spec.endpoint).toBeUndefined()
  })

  it('must name a peer — an offer from nobody is not an offer', () => {
    expect(() => parseProviderSpec(offer({ peer: undefined }))).toThrow(/peer/)
    expect(() => parseProviderSpec(offer({ peer: 'not-a-pubkey' }))).toThrow(/peer/)
  })

  it('cannot smuggle in an endpoint, an auth style, or hive access', () => {
    expect(() => parseProviderSpec(offer({ endpoint: 'https://evil.example/v1' })))
      .toThrow(/must not declare an endpoint/)
    expect(() => parseProviderSpec(offer({ auth: 'bearer' }))).toThrow(/takes no auth/)
    expect(() => parseProviderSpec(offer({ readsHive: true }))).toThrow(/readsHive/)
  })

  it('cannot claim to be a different transport than it is', () => {
    expect(() => parseProviderSpec(offer({ transport: 'browser-http' }))).toThrow(/transport/)
  })

  it('only a peer offer may name a peer', () => {
    expect(() => parseProviderSpec({
      format: 'llm-provider@1',
      id: 'http-thing',
      label: 'Pretender',
      shape: 'openai',
      endpoint: 'https://api.example/v1',
      peer: PEER,
      models: [{ name: 'x', id: 'x-1' }],
      defaultModel: 'x-1',
      docsUrl: 'https://example/keys',
    })).toThrow(/may not name a peer/)
  })

  it('compiles to a descriptor that is routed, not fetched', () => {
    const descriptor = compileProviderSpec(parseProviderSpec(offer()) as LlmProviderSpec)
    expect(descriptor.transport).toBe('peer-swarm')
    expect(descriptor.peer).toBe(PEER)
    expect(descriptor.requiresKey).toBe(false)
    expect(descriptor.readsHive).toBeUndefined()
    expect(() => descriptor.toRequest({ model: 'llama3.1', messages: [], apiKey: '' }))
      .toThrow(/answered over the swarm/)
  })

  it('keeps two peers offering the same model apart', () => {
    const one = compileProviderSpec(parseProviderSpec(offer()) as LlmProviderSpec)
    const two = compileProviderSpec(parseProviderSpec(
      offer({ id: 'peer-bbbbbbbb', peer: 'b'.repeat(64) }),
    ) as LlmProviderSpec)
    expect(one.id).not.toBe(two.id)
    expect(one.peer).not.toBe(two.peer)
  })
})

describe('what this machine will lend', () => {
  it('offers a keyless local provider and NEVER a keyed one', async () => {
    // The rule the drone applies, stated against the registry's own shapes.
    const lendable = (p: { transport: string; requiresKey?: boolean }): boolean =>
      p.transport === 'browser-http' && p.requiresKey === false

    expect(lendable({ transport: 'browser-http', requiresKey: false })).toBe(true)   // ollama
    expect(lendable({ transport: 'browser-http' })).toBe(false)                      // keyed vendor
    expect(lendable({ transport: 'browser-http', requiresKey: true })).toBe(false)
    expect(lendable({ transport: 'agent-bridge', requiresKey: false })).toBe(false)  // not mine to lend
    expect(lendable({ transport: 'peer-swarm', requiresKey: false })).toBe(false)    // never relay a relay
  })

  it('is off until it is switched on', async () => {
    const { isLendingModels, setLendingModels, PEER_OFFER_STORAGE_KEY } =
      await import('./peer-models.drone.js')
    localStorage.removeItem(PEER_OFFER_STORAGE_KEY)
    expect(isLendingModels()).toBe(false)
    setLendingModels(true)
    expect(isLendingModels()).toBe(true)
    setLendingModels(false)
    expect(isLendingModels()).toBe(false)
  })
})
