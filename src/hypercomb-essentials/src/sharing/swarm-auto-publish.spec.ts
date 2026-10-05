// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm-auto-publish.spec.ts — "IN A SWARM" MEANS THIS TAB IS JOINED
// (swarm.drone.ts #autoPublishInSwarm).
//
// A tile created in a swarm is public by default. The zone (room + secret) is
// remembered origin-wide in localStorage, so a tab that only REMEMBERS one —
// a new tab after yesterday's meeting, a tab that left, an unjoined second tab
// — is not in a swarm: its creates stay private, and a later join must not
// broadcast them. The join gesture flips membership synchronously, so the
// create that follows it is armed in the same turn.

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

const state = vi.hoisted(() => ({ public: new Set<string>() }))

vi.mock('../presentation/tiles/tile-public.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCellPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
  isBranchPublic: () => false,
  setCellPublic: (location: string, name: string, on: boolean) => {
    if (on) state.public.add(`${location}|${name}`)
    else state.public.delete(`${location}|${name}`)
    return []
  },
}))
vi.mock('../editor/tile-properties.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readTilePropertiesAt: async () => ({}),
  withoutSubstrateImage: <T>(p: T): T => p,
}))
vi.mock('../commands/decoration-kind-index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  titlesForSegments: () => ({}),
  kindsForLabel: () => [],
  referenceTargetForLabel: () => null,
}))

class FakeLineage extends EventTarget {
  explorerSegments = (): readonly string[] => []
  domain = (): string => 'hypercomb.io'
}

const registry: Record<string, unknown> = {
  '@diamondcoreprocessor.com/NostrMeshDrone': {
    publish: async () => true,
    subscribe: () => ({ close: () => undefined }),
    configureKinds: () => undefined,
    ensureStartedForSig: () => undefined,
    swarmHost: () => 'jwize.com',
    nowSec: () => Math.floor(Date.now() / 1000),
    setNetworkEnabled: () => undefined,
    connectAll: () => undefined,
    resubscribeAll: () => undefined,
  },
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
  // The zone a previous meeting left behind — remembered, not joined.
  '@hypercomb.social/RoomStore': Object.assign(new EventTarget(), { value: 'meetup' }),
  '@hypercomb.social/SecretStore': Object.assign(new EventTarget(), { value: '4417' }),
  '@diamondcoreprocessor.com/HostSyncService': {
    markPublic: async () => undefined,
    isClosureAvailable: async () => true,
    isEnabled: () => false,
  },
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
}

// A fresh tab: no session membership.
sessionStorage.removeItem('hc:mesh-session')
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as { markDisposed: () => void }
afterAll(() => swarm.markDisposed())
await new Promise(r => setTimeout(r, 0))   // the constructor arms its listeners in a microtask

const flips: { cell?: string; public?: boolean }[] = []
EffectBus.on<{ cell?: string; public?: boolean }>('tile:public-changed', (p) => { if (p) flips.push(p) })

describe('a create is public by default only in a tab that is joined', () => {
  it('a tab that remembers a zone but has not joined keeps its creates private', () => {
    EffectBus.emit('mesh:public-changed', { public: false })
    EffectBus.emit('cell:added', { cell: 'solo', segments: [] })
    expect(state.public.has('/|solo')).toBe(false)
    expect(flips.some(p => p.cell === 'solo')).toBe(false)
  })

  it('the join gesture arms the very next create, in the same turn', () => {
    EffectBus.emit('mesh:public-changed', { public: true })
    EffectBus.emit('cell:added', { cell: 'late', segments: [] })
    // No await: the late joiner's first tile is public before the turn ends.
    expect(state.public.has('/|late')).toBe(true)
    expect(flips.some(p => p.cell === 'late' && p.public === true)).toBe(true)
  })

  it('after leaving, creates are private again', () => {
    EffectBus.emit('mesh:public-changed', { public: false })
    EffectBus.emit('cell:added', { cell: 'after-leave', segments: [] })
    expect(state.public.has('/|after-leave')).toBe(false)
  })
})
