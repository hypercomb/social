// provider-origin.spec.ts — what a DOMAIN is allowed to talk you into.
//
// A published spec names an endpoint your key would be sent to. When the
// domain points at itself it is offering its own models; when it points
// elsewhere it is asking you to trust a third party, and that arrives HELD.
// The rule has to survive the participant disagreeing with it: turning a held
// provider on must STICK across later probes, or the console argues with you.

import { beforeEach, describe, expect, it } from 'vitest'

const iocMap = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (k: string, v: unknown) => { if (!iocMap.has(k)) iocMap.set(k, v) },
    get: (k: string) => iocMap.get(k),
  },
}

const { importProviderSpec, providerOrigin } = await import('./provider-discovery.js')
const { llmActivation } = await import('../llm-activation.js')

const spec = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: 'llm-provider@1',
  id: 'offered',
  label: 'Offered models',
  shape: 'openai',
  endpoint: 'https://models.example/v1',
  models: [{ name: 'offered-1', id: 'offered-1', tier: 'balanced' }],
  defaultModel: 'offered-1',
  docsUrl: 'https://models.example/keys',
  ...over,
})

beforeEach(() => { localStorage.clear() })

describe('a provider a domain offered', () => {
  it('records where it came from', async () => {
    await importProviderSpec(spec(), { origin: 'models.example' })
    expect(providerOrigin('offered')).toBe('models.example')
  })

  it('arrives usable when the domain offers its OWN models', async () => {
    await importProviderSpec(spec(), { origin: 'models.example' })
    expect(llmActivation.isEnabled('offered')).toBe(true)
    expect(llmActivation.wasHeld('offered')).toBe(false)
  })

  it('arrives HELD when it sends your key to a different host', async () => {
    await importProviderSpec(spec({ id: 'third-party' }), { origin: 'someone-else.example' })
    expect(llmActivation.isEnabled('third-party')).toBe(false)
    expect(llmActivation.wasHeld('third-party')).toBe(true)
  })

  it('never re-holds one the participant switched on', async () => {
    await importProviderSpec(spec({ id: 'insisted' }), { origin: 'someone-else.example' })
    llmActivation.setEnabled('insisted', true)
    // the same domain (or another) offers it again on a later probe
    await importProviderSpec(spec({ id: 'insisted' }), { origin: 'someone-else.example' })
    expect(llmActivation.isEnabled('insisted')).toBe(true)
  })

  it('holds nothing for a spec the participant pasted in themselves', async () => {
    await importProviderSpec(spec({ id: 'pasted' }))
    expect(providerOrigin('pasted')).toBe('')
    expect(llmActivation.isEnabled('pasted')).toBe(true)
  })

  it('treats a bridge as pointing at nobody — no endpoint, no hold', async () => {
    await importProviderSpec({
      format: 'llm-provider@1',
      id: 'peer-bridge',
      label: 'A peer’s CLI',
      shape: 'agent-bridge',
      models: [{ name: 'peer', id: 'peer-1' }],
      defaultModel: 'peer-1',
      docsUrl: 'https://example.com/bridge',
    }, { origin: 'peer.example' })
    expect(llmActivation.isEnabled('peer-bridge')).toBe(true)
  })
})
