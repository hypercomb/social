// published-pools.spec.ts — what a domain may and may not talk this client into.
//
// The probe is the one place unverified bytes from a stranger's web server
// become live configuration, so its refusals matter more than its successes:
// a member whose bytes do not hash to the sig the index gave, an index that
// is not a list, a host that is a relay rather than a content root, an index
// long enough to be a denial of service.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const iocMap = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window = {
  ioc: {
    register: (k: string, v: unknown) => { if (!iocMap.has(k)) iocMap.set(k, v) },
    get: (k: string) => iocMap.get(k),
  },
}

const {
  originHost, probeDomain, probePublishedPool, publishedPoolMeanings, registerPublishedPool,
  offeredPools, placeOffers, _resetOffers,
} = await import('./published-pools.js')
const { EffectBus } = await import('@hypercomb/core')

/** The ids a host has offered — read off the held records, never off a handler. */
const idsOffered = (host: string): string[] =>
  offeredPools(host).map(o => String((o.record as { id?: unknown }).id)).sort()
const { SignatureService } = await import('@hypercomb/core')

const MEANING = 'test:things'

/** A tiny content host: sig-addressed members plus the published index. */
const domain = async (records: unknown[], options: { lie?: boolean } = {}) => {
  const members = new Map<string, string>()
  for (const record of records) {
    const body = JSON.stringify(record)
    const sig = await SignatureService.sign(new TextEncoder().encode(body).buffer as ArrayBuffer)
    // `lie` serves the right index but the WRONG bytes under each name.
    members.set(sig, options.lie ? JSON.stringify({ ...(record as object), tampered: true }) : body)
  }
  const poolSig = await SignatureService.sign(new TextEncoder().encode(MEANING).buffer as ArrayBuffer)
  return { members, poolSig, index: { meaning: MEANING, members: [...members.keys()] } }
}

const serve = (host: string, poolSig: string, index: unknown, members: Map<string, string>) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = String(url).replace(`https://${host}/`, '')
    if (path === poolSig) return new Response(JSON.stringify(index), { status: 200 })
    const body = members.get(path)
    return body
      ? new Response(new TextEncoder().encode(body), { status: 200 })
      : new Response('', { status: 404 })
  }))
}

let accepted: { record: unknown; origin: string }[] = []

beforeEach(() => {
  accepted = []
  _resetOffers()
  vi.unstubAllGlobals()
  registerPublishedPool({
    meaning: MEANING,
    accept: async (record, origin) => {
      accepted.push({ record, origin })
      return String((record as { id?: unknown })?.id ?? '')
    },
  })
})

describe('registerPublishedPool', () => {
  it('claims a meaning, and refuses a bare word (it would collide with a bag)', () => {
    expect(publishedPoolMeanings()).toContain(MEANING)
    expect(() => registerPublishedPool({ meaning: 'things', accept: async () => null }))
      .toThrow(/colon/)
  })
})

describe('originHost', () => {
  it('reduces anything host-shaped to a host', () => {
    expect(originHost('https://example.com/some/path')).toBe('example.com')
    expect(originHost('example.com')).toBe('example.com')
    expect(originHost('wss://relay.example.com')).toBe('relay.example.com')
    expect(originHost('localhost:4251')).toBe('localhost:4251')
  })

  it('refuses what is not an address', () => {
    expect(originHost('')).toBe('')
    expect(originHost('   ')).toBe('')
    expect(originHost('file:///etc/passwd')).toBe('')
  })
})

describe('probePublishedPool', () => {
  // A HOST DECLARES; THE PARTICIPANT PLACES. The probe verifies and HOLDS;
  // nothing reaches a handler until `placeOffers` — the gesture — is called.
  it('OFFERS every member whose bytes match the sig the index named, and places NONE of them', async () => {
    const { members, poolSig, index } = await domain([{ id: 'one' }, { id: 'two' }])
    serve('example.com', poolSig, index, members)

    const offered = await probePublishedPool('example.com', MEANING)
    expect(offered.sort()).toEqual([...members.keys()].sort())
    expect(accepted).toEqual([])
    expect(idsOffered('example.com')).toEqual(['one', 'two'])
  })

  it('places an offer only on the gesture, and only once', async () => {
    const { members, poolSig, index } = await domain([{ id: 'one' }, { id: 'two' }])
    serve('example.com', poolSig, index, members)
    await probePublishedPool('example.com', MEANING)

    expect(await placeOffers('example.com', MEANING)).toEqual(['one', 'two'])
    expect(accepted.map(a => a.origin)).toEqual(['example.com', 'example.com'])
    expect(offeredPools('example.com')).toEqual([])
    expect(await placeOffers('example.com', MEANING)).toEqual([])
    expect(accepted).toHaveLength(2)
  })

  it('learning a domain never places — the domain:learned trigger only probes', async () => {
    const { members, poolSig, index } = await domain([{ id: 'one' }])
    serve('learned.example', poolSig, index, members)
    EffectBus.emit('domain:learned', { host: 'learned.example' })
    await vi.waitFor(() => expect(idsOffered('learned.example')).toEqual(['one']))
    expect(accepted).toEqual([])
  })

  it('DROPS a member whose bytes do not hash to its sig', async () => {
    const { members, poolSig, index } = await domain([{ id: 'forged' }], { lie: true })
    serve('evil.example', poolSig, index, members)

    expect(await probePublishedPool('evil.example', MEANING)).toEqual([])
    expect(accepted).toEqual([])
  })

  it('is silent when the domain publishes nothing (the normal answer)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    expect(await probePublishedPool('plain.example', MEANING)).toEqual([])
  })

  it('survives an index that is not a list, and one full of nonsense', async () => {
    const poolSig = await SignatureService.sign(new TextEncoder().encode(MEANING).buffer as ArrayBuffer)
    serve('odd.example', poolSig, { members: 'not-a-list' }, new Map())
    expect(await probePublishedPool('odd.example', MEANING)).toEqual([])

    serve('odd2.example', poolSig, ['nope', 42, null, 'x'.repeat(64)], new Map())
    expect(await probePublishedPool('odd2.example', MEANING)).toEqual([])
  })

  it('caps how much one domain can make the client fetch', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}` }))
    const { members, poolSig, index } = await domain(many)
    serve('big.example', poolSig, index, members)

    const kept = await probePublishedPool('big.example', MEANING)
    expect(kept.length).toBe(64)
  })

  it('asks a given domain once per meaning, and again only when forced', async () => {
    const { members, poolSig, index } = await domain([{ id: 'once' }])
    serve('cached.example', poolSig, index, members)

    expect((await probePublishedPool('cached.example', MEANING)).length).toBe(1)
    expect(await probePublishedPool('cached.example', MEANING)).toEqual([])
    expect((await probePublishedPool('cached.example', MEANING, { force: true })).length).toBe(1)
    expect(idsOffered('cached.example')).toEqual(['once'])
  })

  it('does nothing for a meaning nobody claimed, or a host that is not one', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await probePublishedPool('example.com', 'unclaimed:meaning')).toEqual([])
    expect(await probeDomain('')).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('keeps the good members when one is bad', async () => {
    const { members, poolSig, index } = await domain([{ id: 'good' }])
    index.members.push('f'.repeat(64))          // named, never served
    serve('mixed.example', poolSig, index, members)

    expect((await probePublishedPool('mixed.example', MEANING)).length).toBe(1)
    expect(idsOffered('mixed.example')).toEqual(['good'])
  })
})
