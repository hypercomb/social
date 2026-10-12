// @vitest-environment-options {"url": "https://hypercomb.io/"}
//
// sharing/swarm.fresh-join.spec.ts — A JOIN MADE IN THIS PAGE WAITS ON NO REPLAY.
//
// A reload's first walk waits (at most 600 ms) for the relay to replay what
// this tab said there before, so a full entry is never said again as a bare
// name (swarm.walk-reload.spec.ts). A join made in this page has said nothing
// in that zone: waiting for the page subscription's end-of-stored-events there
// was a round trip added to every join — and the owner's rule is that nothing
// is added to join or reconnect. Pinned here: a fresh join's first page event
// leaves as soon as the host's quick answer is in, whatever the relay is doing.

import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { EffectBus, lineageKey } from '@hypercomb/core'

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const ME = 'a'.repeat(64)
const ROOM = 'downtown'
const SECRET = 'downtown'

const state = vi.hoisted(() => ({ public: new Set<string>() }))

vi.mock('../presentation/tiles/tile-public.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCellPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
  isBranchPublic: (location: string, name: string) => state.public.has(`${location}|${name}`),
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

const ROOT = sha(`${lineageKey([])}\0${ROOM}\0${SECRET}`)
type Published = { kind: number; sig: string; at: number }
const published: Published[] = []
// The relay is slow to finish replaying: end-of-stored-events only at the
// caller's own cap. A fresh join must never sit on it.
const replayAsks: string[] = []
const mesh = {
  publish: vi.fn(async (kind: number, sig: string) => { published.push({ kind, sig, at: Date.now() }); return true }),
  subscribe: vi.fn(() => ({ close: () => undefined })),
  awaitReadyForSig: (sig: string, timeoutMs = 900) => {
    replayAsks.push(sig)
    return new Promise<void>(resolve => { setTimeout(resolve, timeoutMs) })
  },
  configureKinds: () => undefined,
  ensureStartedForSig: () => undefined,
  swarmHost: () => 'pluginthematrix.com',
  nowSec: () => Math.floor(Date.now() / 1000),
  setNetworkEnabled: () => undefined,
  connectAll: () => undefined,
  resubscribeAll: () => undefined,
}

const childSig = (name: string): string => sha(`child:/${name}`)
const history = {
  sign: async () => 'loc:',
  currentLayerAt: async () => ({ children: ['kite', 'note'].map(childSig) }),
  getLayerBySig: async (sig: string) => ({ name: sig === childSig('kite') ? 'kite' : 'note' }),
  sealSubtree: async (segments: readonly string[]) => sha(`seal:${segments.join('/')}`),
}

class FakeLineage extends EventTarget {
  explorerSegments = (): readonly string[] => []
  domain = (): string => 'hypercomb.io'
}

// The host answers at once: not held yet (the upload is still running).
const hostSync = {
  markPublic: vi.fn(async () => undefined),
  withdrawPublic: vi.fn(),
  isClosureAvailable: vi.fn(async () => false),
  isEnabled: () => false,
}

const registry: Record<string, unknown> = {
  '@diamondcoreprocessor.com/NostrMeshDrone': mesh,
  '@diamondcoreprocessor.com/NostrSigner': { getPublicKeyHex: async () => ME },
  '@hypercomb.social/TileSourceRegistry': { register: () => () => undefined },
  '@hypercomb.social/Lineage': new FakeLineage(),
  '@diamondcoreprocessor.com/HistoryService': history,
  '@hypercomb/SignatureStore': { signText: async (s: string) => sha(s) },
  '@hypercomb.social/Store': { hypercombRoot: null },
  '@hypercomb.social/RoomStore': Object.assign(new EventTarget(), { value: ROOM }),
  '@hypercomb.social/SecretStore': Object.assign(new EventTarget(), { value: SECRET }),
  '@diamondcoreprocessor.com/HostSyncService': hostSync,
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
}

state.public.add('/|kite')
state.public.add('/|note')

// NOT a reload: this tab was not in the swarm when the page loaded.
sessionStorage.removeItem('hc:mesh-session')
await import('./swarm.drone.js')
const swarm = registry['@diamondcoreprocessor.com/SwarmDrone'] as { markDisposed: () => void }
afterAll(() => { swarm.markDisposed(); vi.useRealTimers() })

describe('a join made in this page', () => {
  it('says its page as soon as the host has answered — no wait on the relay replaying a past it does not have', async () => {
    await vi.advanceTimersByTimeAsync(500)
    expect(published.filter(p => p.kind === 30200)).toEqual([])   // not joined: nothing said

    const joinedAt = Date.now()
    EffectBus.emit('mesh:public-changed', { public: true })
    await vi.advanceTimersByTimeAsync(1_000)
    const first = published.find(p => p.kind === 30200 && p.sig === ROOT)
    expect(first).toBeTruthy()
    // The relay's end-of-stored-events would have come at 600 ms.
    expect(first!.at - joinedAt).toBeLessThan(300)
    expect(replayAsks).not.toContain(ROOT)
  })
})
