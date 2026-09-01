// model-policy.spec.ts — who answers when nobody said.
//
// The rules worth guarding are the ones a participant would be angry to
// discover by accident: a weaker model chosen only because it is free, a
// private prompt sent to a stranger's machine, or a pin they set being quietly
// ignored.

import { beforeEach, describe, expect, it } from 'vitest'

const iocMap = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (k: string, v: unknown) => { if (!iocMap.has(k)) iocMap.set(k, v) },
    get: (k: string) => iocMap.get(k),
  },
}

const { candidatesFor, chooseProvider, costOf, designate, llmPolicy, modelForTier, rankProviders } =
  await import('./model-policy.js')
const { llmProviderRegistry } = await import('./llm-provider-registry.js')
const { llmActivation } = await import('./llm-activation.js')
const { llmKeyStore } = await import('@hypercomb/core')

type Descriptor = import('./providers/llm-provider.types.js').LlmProviderDescriptor

const registry = llmProviderRegistry()

const descriptor = (over: Partial<Descriptor> & { id: string }): Descriptor => ({
  label: over.id,
  vendor: 'openai',
  transport: 'browser-http',
  models: [
    { name: `${over.id}-deep`, id: `${over.id}-deep`, tier: 'deep' },
    { name: `${over.id}-fast`, id: `${over.id}-fast`, tier: 'fast' },
  ],
  defaultModel: `${over.id}-deep`,
  docsUrl: 'https://example.test/keys',
  toRequest: () => ({ url: 'https://example.test', init: {} }),
  fromResponse: () => ({ text: '', stopReason: 'stop', inputTokens: 0, outputTokens: 0, model: '' }),
  ...over,
} as Descriptor)

/** A fresh roster per test — the registry is a singleton by design. */
const roster = (...providers: Descriptor[]): void => {
  for (const existing of registry.all()) registry.unregister(existing.id)
  for (const p of providers) registry.register(p)
}

const KEYED = descriptor({ id: 'keyed-vendor' })
const LOCAL = descriptor({ id: 'my-machine', vendor: 'local', requiresKey: false })
const PEER = descriptor({
  id: 'peer-abcd', vendor: 'local', transport: 'peer-swarm', requiresKey: false,
  peer: 'f'.repeat(64),
})
const BRIDGE = descriptor({
  id: 'claude-bridge', vendor: 'anthropic', transport: 'agent-bridge',
  requiresKey: false, readsHive: true,
})

beforeEach(() => {
  localStorage.clear()
  // The activation store mirrors localStorage in memory and only re-reads on
  // a cross-tab `storage` event, so clearing storage does NOT undo a switch
  // an earlier test flipped. Put every id used here back on deliberately.
  for (const id of ['keyed-vendor', 'my-machine', 'peer-abcd', 'claude-bridge', 'balanced-only']) {
    llmActivation.setEnabled(id, true)
  }
  llmKeyStore.set('keyed-vendor', 'sk-test-key')
})

describe('costOf', () => {
  it('separates whose money and whose eyes', () => {
    expect(costOf(LOCAL)).toBe('local')
    expect(costOf(PEER)).toBe('peer')
    expect(costOf(BRIDGE)).toBe('bridge')
    expect(costOf(KEYED)).toBe('keyed')
  })
})

describe('choosing without a pin', () => {
  it('uses live subscription headroom before cost preference', () => {
    const low = descriptor({
      id: 'low-headroom', vendor: 'local', requiresKey: false,
      subscription: { status: 'limited', source: 'test', checkedAt: Date.now(), windows: [{ label: 'Weekly', remainingPercent: 8 }] },
    })
    roster(low, KEYED)
    expect(chooseProvider({ tier: 'fast' })?.id).toBe('keyed-vendor')
  })

  it('never schedules a provider known to be exhausted', () => {
    const exhausted = descriptor({
      id: 'exhausted', vendor: 'local', requiresKey: false,
      subscription: { status: 'exhausted', source: 'test', checkedAt: Date.now(), windows: [{ label: 'Weekly', remainingPercent: 0 }] },
    })
    roster(exhausted, KEYED)
    expect(candidatesFor({ tier: 'fast' }).map(p => p.id)).toEqual(['keyed-vendor'])
  })

  it('uses intelligence first by default, not free first', () => {
    roster(KEYED, LOCAL)
    expect(llmPolicy.usagePlan).toBe('intelligence')
    expect(chooseProvider({ tier: 'fast' })?.id).toBe('keyed-vendor')
  })

  it('uses the local model when the participant selects economy', () => {
    roster(KEYED, LOCAL)
    llmPolicy.usagePlan = 'economy'
    expect(chooseProvider({ tier: 'fast' })?.id).toBe('my-machine')
  })

  it('keeps exact capability ahead of locality in intelligence-first mode', () => {
    const localBalanced = descriptor({
      id: 'local-balanced', vendor: 'local', requiresKey: false,
      models: [{ name: 'local-balanced', id: 'local-balanced', tier: 'balanced' }],
      defaultModel: 'local-balanced',
    })
    roster(localBalanced, KEYED)
    llmActivation.setEnabled('local-balanced', true)
    expect(chooseProvider({ tier: 'deep' })?.id).toBe('keyed-vendor')
  })

  it('NEVER sends a prompt to a peer automatically', () => {
    roster(PEER, KEYED)
    expect(llmPolicy.allowPeers).toBe(false)
    expect(chooseProvider({ tier: 'fast' })?.id).toBe('keyed-vendor')
  })

  it('will use a peer once the participant allows it', () => {
    roster(PEER, KEYED)
    llmPolicy.allowPeers = true
    llmPolicy.usagePlan = 'economy'
    expect(chooseProvider({ tier: 'fast' })?.id).toBe('peer-abcd')
  })

  it('would rather answer with a peer than not at all — only when allowed', () => {
    roster(PEER)
    expect(chooseProvider({ tier: 'fast' })).toBeUndefined()
    llmPolicy.allowPeers = true
    expect(chooseProvider({ tier: 'fast' })?.id).toBe('peer-abcd')
  })

  it('skips a provider whose key is missing', () => {
    llmKeyStore.clear('keyed-vendor')
    roster(KEYED, LOCAL)
    expect(candidatesFor().map(p => p.id)).toEqual(['my-machine'])
  })

  it('skips a provider the participant switched off', () => {
    roster(KEYED, LOCAL)
    llmActivation.setEnabled('my-machine', false)
    expect(chooseProvider({ tier: 'fast' })?.id).toBe('keyed-vendor')
  })

  it('says nothing rather than inventing a vendor when nothing is ready', () => {
    roster()
    expect(chooseProvider({ tier: 'deep' })).toBeUndefined()
  })
})

describe('usage plans', () => {
  it.each(['balanced', 'fast', 'private'] as const)(
    '%s may prefer local execution when capability and health are equal', plan => {
      roster(KEYED, LOCAL)
      llmPolicy.usagePlan = plan
      expect(chooseProvider({ tier: 'fast' })?.id).toBe('my-machine')
    },
  )

  it('economy is allowed to trade tier fit for no incremental cost', () => {
    const localBalanced = descriptor({
      id: 'local-balanced', vendor: 'local', requiresKey: false,
      models: [{ name: 'local-balanced', id: 'local-balanced', tier: 'balanced' }],
      defaultModel: 'local-balanced',
    })
    roster(KEYED, localBalanced)
    llmActivation.setEnabled('local-balanced', true)
    llmPolicy.usagePlan = 'economy'
    expect(chooseProvider({ tier: 'deep' })?.id).toBe('local-balanced')
  })

  it('migrates an explicitly stored legacy prefer-free choice', () => {
    localStorage.removeItem('hc:llm:usage-plan')
    localStorage.setItem('hc:llm:prefer-free', 'true')
    expect(llmPolicy.usagePlan).toBe('economy')
  })
})

describe('hive-reading work', () => {
  it('only a bridge may take it', () => {
    roster(KEYED, LOCAL, BRIDGE)
    expect(chooseProvider({ tier: 'deep', readsHive: true })?.id).toBe('claude-bridge')
  })

  it('and a bridge is never picked for work that does not need it', () => {
    roster(BRIDGE, KEYED)
    expect(chooseProvider({ tier: 'deep' })?.id).toBe('keyed-vendor')
  })

  it('nothing bridged means the work cannot be placed', () => {
    roster(KEYED, LOCAL)
    expect(chooseProvider({ readsHive: true })).toBeUndefined()
  })
})

describe('pins', () => {
  it('beat the cost preference', () => {
    roster(KEYED, LOCAL)
    llmPolicy.setPin('fast', 'keyed-vendor')
    expect(chooseProvider({ tier: 'fast' })?.id).toBe('keyed-vendor')
  })

  it('are per tier, not global', () => {
    roster(KEYED, LOCAL)
    llmPolicy.usagePlan = 'economy'
    llmPolicy.setPin('deep', 'keyed-vendor')
    expect(chooseProvider({ tier: 'deep' })?.id).toBe('keyed-vendor')
    expect(chooseProvider({ tier: 'fast' })?.id).toBe('my-machine')
  })

  it('are a preference, not a veto — a pin that cannot do the work falls through', () => {
    roster(KEYED, LOCAL, BRIDGE)
    llmPolicy.setPin('deep', 'keyed-vendor')          // cannot read the hive
    expect(chooseProvider({ tier: 'deep', readsHive: true })?.id).toBe('claude-bridge')
  })

  it('clear back to letting the policy decide', () => {
    roster(KEYED, LOCAL)
    llmPolicy.usagePlan = 'economy'
    llmPolicy.setPin('fast', 'keyed-vendor')
    llmPolicy.setPin('fast', '')
    expect(chooseProvider({ tier: 'fast' })?.id).toBe('my-machine')
  })

  it('puts a usable pin first while retaining authorized fallbacks', () => {
    roster(LOCAL, KEYED)
    llmPolicy.setPin('fast', 'keyed-vendor')
    expect(rankProviders({ tier: 'fast' }).map(p => p.id)).toEqual(['keyed-vendor', 'my-machine'])
  })
})

describe('the tier actually asked for', () => {
  it('picks the provider offering that weight over one that does not', () => {
    const balancedOnly = descriptor({
      id: 'balanced-only', vendor: 'local', requiresKey: false,
      models: [{ name: 'mid', id: 'mid-1', tier: 'balanced' }],
      defaultModel: 'mid-1',
    })
    roster(balancedOnly, LOCAL)
    expect(chooseProvider({ tier: 'fast' })?.id).toBe('my-machine')
    expect(chooseProvider({ tier: 'balanced' })?.id).toBe('balanced-only')
  })

  it('resolves to that provider’s model at the tier, not its default', () => {
    expect(modelForTier(KEYED, 'fast')).toBe('keyed-vendor-fast')
    expect(modelForTier(KEYED, 'deep')).toBe('keyed-vendor-deep')
    // a tier the provider does not offer falls back to its own default
    expect(modelForTier(KEYED, 'balanced')).toBe('keyed-vendor-deep')
  })
})

// ── the designation ───────────────────────────────────────────────────────
//
// One provider, one model, in the words a bee is branded from. The rule worth
// guarding is the one the participant did not ask for and would still want:
// an account nearly spent answers one tier LIGHTER rather than jumping to a
// different company mid-conversation.

describe('designate', () => {
  const LOADED = descriptor({
    id: 'loaded-bridge', vendor: 'anthropic', transport: 'agent-bridge',
    requiresKey: false, readsHive: true,
    models: [
      { name: 'big', id: 'big-1', tier: 'deep' },
      { name: 'middle', id: 'middle-1', tier: 'balanced' },
    ],
    defaultModel: 'big-1',
    subscription: {
      status: 'limited', source: 'test', checkedAt: 0,
      windows: [{ label: 'weekly', remainingPercent: 4 }],
    },
  })

  it('names the wire model, the vendor and the declared tier', () => {
    roster(BRIDGE)
    llmActivation.setEnabled('claude-bridge', true)
    const chosen = designate({ tier: 'deep', readsHive: true })
    expect(chosen?.providerId).toBe('claude-bridge')
    expect(chosen?.model).toBe('claude-bridge-deep')
    expect(chosen?.vendor).toBe('anthropic')
    expect(chosen?.tier).toBe('deep')
  })

  it('steps DOWN a tier rather than out to another vendor under load', () => {
    roster(LOADED)
    llmActivation.setEnabled('loaded-bridge', true)
    const chosen = designate({ tier: 'deep', readsHive: true })
    expect(chosen?.providerId).toBe('loaded-bridge')
    expect(chosen?.tier).toBe('balanced')
    expect(chosen?.model).toBe('middle-1')
    expect(chosen?.availability).toBe('limited')
  })

  it('stays on the heavy model while headroom is healthy', () => {
    roster({
      ...LOADED, id: 'rested-bridge',
      subscription: { status: 'available', source: 'test', checkedAt: 0, windows: [] },
    } as Descriptor)
    llmActivation.setEnabled('rested-bridge', true)
    expect(designate({ tier: 'deep', readsHive: true })?.tier).toBe('deep')
  })

  it('is undefined when nothing can do the work', () => {
    roster()
    expect(designate({ tier: 'deep', readsHive: true })).toBeUndefined()
  })
})
