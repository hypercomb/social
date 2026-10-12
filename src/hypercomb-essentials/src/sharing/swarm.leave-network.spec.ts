// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm.leave-network.spec.ts — A LEAVE TURNS THE NETWORK OFF, EVEN
// FROM A TAB THAT NEVER BEACONED.
//
// The swarm owns network-off on leave (the tombstone first, then the socket).
// It only did so for a tab that had reached its zone's lifecycle channel: a tab
// that joined with a zone still incomplete (or before its first sync finished)
// and then left stayed connected to the meeting point until something turned
// the network on again. A tab that never joined in this page — the boot replay
// of `{ public: false }` — keeps its warm socket: the owner chose connection
// speed, and that socket is the next join's head start.

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

vi.mock('../commands/decoration-kind-index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  titlesForSegments: () => ({}),
  kindsForLabel: () => [],
  referenceTargetForLabel: () => null,
}))

const setNetworkEnabled = vi.fn()
const mesh = {
  publish: vi.fn(async () => true),
  subscribe: vi.fn(() => ({ close: () => undefined })),
  configureKinds: () => undefined,
  ensureStartedForSig: () => undefined,
  swarmHost: () => 'pluginthematrix.com',
  nowSec: () => Math.floor(Date.now() / 1000),
  setNetworkEnabled,
  connectAll: () => undefined,
  resubscribeAll: () => undefined,
}

class FakeLineage extends EventTarget {
  explorerSegments = (): readonly string[] => []
  domain = (): string => 'hypercomb.io'
}

// A zone with no secret yet: joining reaches no lifecycle channel.
const registry: Record<string, unknown> = {
  '@diamondcoreprocessor.com/NostrMeshDrone': mesh,
  '@diamondcoreprocessor.com/NostrSigner': { getPublicKeyHex: async () => 'a'.repeat(64) },
  '@hypercomb.social/TileSourceRegistry': { register: () => () => undefined },
  '@hypercomb.social/Lineage': new FakeLineage(),
  '@diamondcoreprocessor.com/HistoryService': {
    sign: async () => 'loc:',
    currentLayerAt: async () => ({ children: [] }),
    getLayerBySig: async () => null,
  },
  '@hypercomb/SignatureStore': { signText: async (s: string) => sha(s) },
  '@hypercomb.social/Store': { hypercombRoot: null },
  '@hypercomb.social/RoomStore': Object.assign(new EventTarget(), { value: 'downtown' }),
  '@hypercomb.social/SecretStore': Object.assign(new EventTarget(), { value: '' }),
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
}

await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as { markDisposed: () => void }
afterAll(() => swarm.markDisposed())

const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)) }
const turnedOff = (): boolean => setNetworkEnabled.mock.calls.some(c => c[0] === false)

describe('leave turns the network off', () => {
  it('a tab that never joined keeps its warm socket through the boot replay of { public: false }', async () => {
    await settle()
    EffectBus.emit('mesh:public-changed', { public: false })
    await settle()
    expect(turnedOff()).toBe(false)
  })

  it('a tab that joined but never reached a lifecycle channel turns the network off when it leaves', async () => {
    EffectBus.emit('mesh:public-changed', { public: true })
    await settle()
    expect(turnedOff()).toBe(false)
    EffectBus.emit('mesh:public-changed', { public: false })
    await settle()
    expect(setNetworkEnabled).toHaveBeenLastCalledWith(false, false)
  })
})
