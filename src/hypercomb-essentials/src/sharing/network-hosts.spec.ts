// The hosts a model's network reads ask. A managed site door asks its own
// site; every other page's address stays out of the list. The public content
// host is always asked, and a door's public community is read one hop.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./community-hosts.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./community-hosts.js')>()),
  listCommunityHosts: async () => [],
}))

import { SignatureService } from '@hypercomb/core'
import { hostArtifactRecord } from './community-hosts.js'
import { PUBLIC_CONTENT_HOSTS } from './hive-link.js'
import { forgetPublicCommunityHosts, networkHosts, PUBLIC_COMMUNITY_MAX, readPublicCommunityHosts, type PublicCommunityDeps } from './network-hosts.js'
import { forgetPoolMisses } from './pool-listing.js'

const markDoor = (): void => {
  const record = document.createElement('script')
  record.type = 'application/json'
  record.id = 'hc-manage'
  record.textContent = JSON.stringify({ lineage: 'business-card' })
  document.head.appendChild(record)
}

const sha = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

beforeEach(() => {
  // No host answers: a fresh profile's door whose broker knows nothing.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
})

afterEach(() => {
  document.getElementById('hc-manage')?.remove()
  forgetPublicCommunityHosts()
  forgetPoolMisses()
  vi.unstubAllGlobals()
})

describe('network hosts', () => {
  it('a managed site door asks its own site', async () => {
    markDoor()
    expect(await networkHosts()).toContain(location.host.toLowerCase())
  })

  it('any other page never puts its own address in the list', async () => {
    expect(await networkHosts()).not.toContain(location.host.toLowerCase())
  })

  it('a door whose broker learned nothing asks its own site AND the public content host (reach A3)', async () => {
    markDoor()
    const hosts = await networkHosts()
    expect(hosts).toContain(location.host.toLowerCase())
    for (const host of PUBLIC_CONTENT_HOSTS) expect(hosts).toContain(host)
  })

  it('the public content host is asked even beside hosts the broker knows', async () => {
    ;(globalThis as { ioc?: unknown }).ioc = { get: () => ({ knownContentHosts: () => ['one.example'] }) }
    try {
      const hosts = await networkHosts()
      expect(hosts).toContain('one.example')
      for (const host of PUBLIC_CONTENT_HOSTS) expect(hosts).toContain(host)
    } finally { delete (globalThis as { ioc?: unknown }).ioc }
  })
})

describe("a door's public community, one hop (reach A7)", () => {
  const world = async () => {
    const good = new TextEncoder().encode(JSON.stringify(hostArtifactRecord('friend.example')))
    const goodSig = await sha(good)
    const forged = new TextEncoder().encode(JSON.stringify(hostArtifactRecord('stranger.example')))
    const forgedName = 'f'.repeat(64)
    const pool = await SignatureService.sign(new TextEncoder().encode('community:hosts').buffer as ArrayBuffer)
    const listed: string[] = []
    const fetched: string[] = []
    const deps: PublicCommunityDeps = {
      address: async meaning => SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer),
      listing: async (host, address) => {
        listed.push(`${host} ${address}`)
        return host === 'door.example' ? `${goodSig}\n${forgedName}\n00000000\n` : ''
      },
      member: async (host, _address, sig) => {
        fetched.push(`${host} ${sig}`)
        return sig === goodSig ? good : sig === forgedName ? forged : null
      },
      sign: sha,
    }
    return { deps, listed, fetched, pool }
  }

  it('adds only the member whose bytes hash to its name, and never asks a found zone', async () => {
    const { deps, listed, pool } = await world()
    expect(await readPublicCommunityHosts(['door.example'], deps)).toEqual(['friend.example'])
    // One listing GET, at the door, for the one pool: friend.example is not asked.
    expect(listed).toEqual([`door.example ${pool}`])
  })

  it('takes at most PUBLIC_COMMUNITY_MAX zones', async () => {
    const records = await Promise.all(Array.from({ length: PUBLIC_COMMUNITY_MAX + 4 }, async (_, i) => {
      const bytes = new TextEncoder().encode(JSON.stringify(hostArtifactRecord(`z${i}.example`)))
      return { bytes, sig: await sha(bytes) }
    }))
    const deps: PublicCommunityDeps = {
      address: async () => 'a'.repeat(64),
      listing: async () => records.map(record => record.sig).join('\n'),
      member: async (_host, _address, sig) => records.find(record => record.sig === sig)?.bytes ?? null,
      sign: sha,
    }
    expect((await readPublicCommunityHosts(['door.example'], deps)).length).toBe(PUBLIC_COMMUNITY_MAX)
  })

  it("a door's list gains the zones its own site's public community names", async () => {
    const good = new TextEncoder().encode(JSON.stringify(hostArtifactRecord('friend.example')))
    const goodSig = await sha(good)
    const pool = await SignatureService.sign(new TextEncoder().encode('community:hosts').buffer as ArrayBuffer)
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      asked.push(String(url))
      const path = new URL(String(url)).pathname
      if (new URL(String(url)).host !== location.host) return new Response(null, { status: 404 })
      if (path === `/${pool}/`) return new Response(`${goodSig}
`, { status: 200, headers: { 'content-type': 'text/plain' } })
      if (path === `/${pool}/${goodSig}`) return new Response(good, { status: 200 })
      return new Response(null, { status: 404 })
    }))
    markDoor()
    expect(await networkHosts()).toContain('friend.example')
    // One hop: the zone found is never asked for its own community.
    expect(asked.some(url => url.includes('friend.example'))).toBe(false)
  })

  it('a listing that will not answer adds nothing and does not throw', async () => {
    const deps: PublicCommunityDeps = {
      address: async () => 'a'.repeat(64),
      listing: async () => { throw new Error('down') },
      member: async () => null,
      sign: sha,
    }
    expect(await readPublicCommunityHosts(['door.example'], deps)).toEqual([])
  })
})

// REVIEW 2026-11-25: the read was one request at a time with no deadline over
// it, every first list read waited on all of it, and an empty first answer was
// kept for the page.
describe('the public community read is bounded and off the critical path', () => {
  const recordOf = async (zone: string) => {
    const bytes = new TextEncoder().encode(JSON.stringify(hostArtifactRecord(zone)))
    return { bytes, sig: await sha(bytes) }
  }

  it('asks every host and member at once and answers at its deadline with what it verified', async () => {
    const good = await recordOf('friend.example')
    const slow = await recordOf('slow.example')
    const deps: PublicCommunityDeps = {
      address: async () => 'a'.repeat(64),
      // The first host never answers its listing; the second answers at once.
      listing: async host => host === 'stuck.example' ? new Promise<string>(() => void 0) : `${slow.sig}\n${good.sig}\n`,
      member: async (_host, _address, sig) => sig === good.sig ? good.bytes : new Promise<Uint8Array>(() => void 0),
      sign: sha,
    }
    const started = Date.now()
    expect(await readPublicCommunityHosts(['stuck.example', 'door.example'], deps, 80)).toEqual(['friend.example'])
    expect(Date.now() - started).toBeLessThan(1_500)
  }, 5_000)

  it('a list read on a door does not wait out a community listing that never answers', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => new URL(String(url)).host === location.host
      ? new Promise<Response>(() => void 0)
      : Promise.resolve(new Response(null, { status: 404 }))))
    markDoor()
    const started = Date.now()
    expect(await networkHosts()).toContain(location.host.toLowerCase())
    expect(Date.now() - started).toBeLessThan(2_500)
  }, 10_000)

  it('an empty first answer is asked again, never kept for the page', async () => {
    const good = await recordOf('friend.example')
    const pool = await SignatureService.sign(new TextEncoder().encode('community:hosts').buffer as ArrayBuffer)
    let serving = false
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const at = new URL(String(url))
      if (!serving || at.host !== location.host) return new Response(null, { status: 404 })
      if (at.pathname === `/${pool}/`) return new Response(`${good.sig}\n`, { status: 200, headers: { 'content-type': 'text/plain' } })
      if (at.pathname === `/${pool}/${good.sig}`) return new Response(good.bytes, { status: 200 })
      return new Response(null, { status: 404 })
    }))
    markDoor()
    expect(await networkHosts()).not.toContain('friend.example')
    serving = true
    forgetPoolMisses()
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 60_000)
    try { expect(await networkHosts()).toContain('friend.example') } finally { clock.mockRestore() }
  })
})
