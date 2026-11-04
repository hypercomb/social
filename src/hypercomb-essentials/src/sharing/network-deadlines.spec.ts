// network-deadlines.spec.ts — a host that never answers costs its deadline, never the act.
//
// Every spec below stubs a fetch whose "hung" host accepts the request and
// then says nothing until its signal aborts. Each also counts the requests:
// bounding a read must not multiply it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { SignatureService } from '@hypercomb/core'

const registry = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry.set(key, value) },
  get: (key: string) => registry.get(key),
  whenReady: () => undefined,
}

const { _forceDeadlineMs, _resetBackoff } = await import('./bounded-fetch.js')
const { fetchHiveIndex, fetchHiveManifestFromAny } = await import('./hive-pointer.js')
const { resolveIndexDoor } = await import('./publish-branch.js')
const { scout } = await import('./scout.js')
const { SignatureReplicationService } = await import('./signature-replication.service.js')
const { _resetOffers, probePublishedPool, offeredPools, registerPublishedPool } = await import('./published-pools.js')

const DEADLINE = 60
/** Generous for a CI box, still far under the 8 s a real deadline would take. */
const WITHIN = 1_500

const secret = new Uint8Array(32).fill(5)
const PUB = getPublicKey(secret)
const HEAD = 'c'.repeat(64)
const index = () => finalizeEvent({ kind: 30564, created_at: 1_800_000_000, tags: [], content: JSON.stringify({ v: 1, roots: { garden: HEAD } }) }, secret)

/** Never answers; settles only when its signal aborts. */
const hang = (init?: RequestInit): Promise<Response> => new Promise((_, reject) => {
  init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
})

/** A fetch stub that routes by host: `hung.example` hangs, the rest answer `answer`. */
const hosts = (answer: (url: string) => Response | Promise<Response>) => {
  const stub = vi.fn((url: string, init?: RequestInit) => String(url).includes('hung.example') ? hang(init) : Promise.resolve(answer(String(url))))
  vi.stubGlobal('fetch', stub)
  return stub
}

beforeEach(() => { _resetBackoff(); _resetOffers(); _forceDeadlineMs(DEADLINE) })
afterEach(() => { vi.unstubAllGlobals(); _forceDeadlineMs(null) })

describe('the hive index', () => {
  it('a hung host is unreachable within the deadline, in one request', async () => {
    const stub = hosts(() => Response.json(index()))
    const started = Date.now()
    const read = await fetchHiveIndex('hung.example', PUB)
    expect(read).toEqual({ ok: false, reason: 'unreachable' })
    expect(Date.now() - started).toBeLessThan(WITHIN)
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('three hosts, one hung: the walk returns the index at once, one request per host', async () => {
    _forceDeadlineMs(2_000)   // long enough that only the winner, never the deadline, can end the walk
    const stub = hosts(() => Response.json(index()))
    const started = Date.now()
    const manifest = await fetchHiveManifestFromAny(['hung.example', 'a.example', 'b.example'], PUB)
    expect(manifest?.roots).toEqual({ garden: HEAD })
    expect(Date.now() - started).toBeLessThan(1_000)   // the winner does not wait for the hung host
    expect(stub).toHaveBeenCalledTimes(3)
  })

  it('every host hung: the walk ends at the deadline with nothing', async () => {
    const stub = hosts(() => Response.json(index()))
    const started = Date.now()
    expect(await fetchHiveManifestFromAny(['hung.example', 'hung.example'], PUB)).toBeNull()
    expect(Date.now() - started).toBeLessThan(WITHIN)
    expect(stub.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('the publish door walk finds the index past a hung door, and past a 404', async () => {
    const stub = hosts(url => url.includes('absent.example') ? new Response('', { status: 404 }) : Response.json(index()))
    const found = await resolveIndexDoor(['hung.example', 'absent.example', 'a.example'], PUB)
    expect(found.host).toBe('a.example')
    expect(found.read.ok).toBe(true)
    expect(stub).toHaveBeenCalledTimes(3)
  })

  it('the publish door walk still reports an honest 404 when the rest are hung or down', async () => {
    hosts(url => url.includes('absent.example') ? new Response('', { status: 404 }) : new Response('', { status: 500 }))
    const found = await resolveIndexDoor(['hung.example', 'absent.example'], PUB)
    expect(found.host).toBe('absent.example')
    expect(found.read).toMatchObject({ ok: false, reason: 'http', status: 404 })
  })
})

describe('the scout', () => {
  const SIG = 'd'.repeat(64)
  const ask = (followed: string[]) => scout(['test:things'], { followed: async () => followed, allows: async () => true })

  it('three hosts, one hung: the other two are heard, one request each', async () => {
    const stub = hosts(() => new Response(JSON.stringify([SIG]), { status: 200 }))
    const started = Date.now()
    const offers = await ask(['hung.example', 'a.example', 'b.example'])
    expect(Date.now() - started).toBeLessThan(WITHIN)
    expect(offers).toHaveLength(1)
    expect(offers[0]!.hosts).toEqual(['a.example', 'b.example'])
    expect(stub).toHaveBeenCalledTimes(3)
  })

  it('a host that timed out is asked last the next round — and is still asked', async () => {
    const stub = hosts(() => new Response('[]', { status: 200 }))
    await ask(['hung.example', 'a.example', 'b.example'])
    stub.mockClear()
    await ask(['hung.example', 'a.example', 'b.example'])
    const order = stub.mock.calls.map(([url]) => new URL(String(url)).host)
    expect(order).toHaveLength(3)
    expect(order.at(-1)).toBe('hung.example')
  })
})

describe('a pool probe', () => {
  const MEANING = 'test:deadlines'
  beforeEach(() => { registerPublishedPool({ meaning: MEANING, accept: async () => 'x' }) })

  it('a timeout leaves the pair unmarked, so the next probe asks again', async () => {
    const stub = hosts(() => new Response('', { status: 404 }))
    expect(await probePublishedPool('hung.example', MEANING)).toEqual([])
    expect(await probePublishedPool('hung.example', MEANING)).toEqual([])
    expect(stub).toHaveBeenCalledTimes(2)
  })

  it('a 404 is an answer: the pair is marked and not asked again', async () => {
    const stub = hosts(() => new Response('', { status: 404 }))
    await probePublishedPool('a.example', MEANING)
    await probePublishedPool('a.example', MEANING)
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('a host that was slow and then answers is probed once more, and offers what it holds', async () => {
    const member = JSON.stringify({ id: 'one' })
    const memberSig = await SignatureService.sign(new TextEncoder().encode(member).buffer as ArrayBuffer)
    let slow = true
    const stub = vi.fn((url: string, init?: RequestInit) => {
      if (slow) return hang(init)
      return Promise.resolve(String(url).endsWith(`/${memberSig}`)
        ? new Response(new TextEncoder().encode(member), { status: 200 })
        : new Response(JSON.stringify({ members: [memberSig] }), { status: 200 }))
    })
    vi.stubGlobal('fetch', stub)
    expect(await probePublishedPool('a.example', MEANING)).toEqual([])
    slow = false
    expect(await probePublishedPool('a.example', MEANING)).toEqual([memberSig])
    expect(offeredPools('a.example')).toHaveLength(1)
    // pool index (hung) + pool index + one member: nothing multiplied.
    expect(stub).toHaveBeenCalledTimes(3)
  })

  it('two probes at once send one request', async () => {
    const stub = hosts(() => new Response('', { status: 404 }))
    await Promise.all([probePublishedPool('a.example', MEANING), probePublishedPool('a.example', MEANING)])
    expect(stub).toHaveBeenCalledTimes(1)
  })
})

describe('the replication client (what the passive queue drives)', () => {
  it('status and verify give up on a hung host within the deadline, one request each', async () => {
    const stub = hosts(() => new Response('{}', { status: 200 }))
    const client = new SignatureReplicationService(() => ({ signEvent: async event => ({ ...event, id: 'e', pubkey: 'p', sig: 's' }) }))
    const sig = 'e'.repeat(64)
    const started = Date.now()
    expect(await client.status('hung.example', sig)).toBeNull()
    expect(await client.verify('hung.example', sig)).toBe(false)
    expect(Date.now() - started).toBeLessThan(WITHIN)
    expect(stub).toHaveBeenCalledTimes(2)
  })
})

describe('a commit', () => {
  it('publishAtoms against a hung host fails within the deadline instead of waiting forever', async () => {
    registry.set('@diamondcoreprocessor.com/NostrSigner', {
      signEvent: async (event: Record<string, unknown>) => ({ ...event, id: 'e', pubkey: 'p'.repeat(64), sig: 's' }),
    })
    const { hostSyncService } = await import('./host-sync.service.js')
    const publishAtoms = (hostSyncService as unknown as {
      publishAtoms: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) => Promise<{ ok: boolean; error?: string }>
    }).publishAtoms
    const bytes = new TextEncoder().encode('export {}')
    const sig = await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
    const stub = hosts(() => new Response(null, { status: 201 }))
    const started = Date.now()
    const outcome = await publishAtoms('hung.example', [sig], async () => bytes)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('could not be reached')
    expect(Date.now() - started).toBeLessThan(WITHIN)
    expect(stub).toHaveBeenCalledTimes(2)   // the HEAD, then the PUT — no retry
  })
})
