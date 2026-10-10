// host-packages.channel.spec.ts — a first install follows what the publisher
// SIGNED, not whatever a host last staged.
//
// The incident these pin (2026-09-30 → 2026-10-09): hypercomb.com's packages
// pool held one Sep 30 member while the signed `install:essentials` named a
// newer package, and every cold install took the stale pool head. The signed
// index is read here exactly as the update scout reads it — same address
// (sign('hive:indexes')/<pubkey>), same doors, same checks — with real schnorr
// signatures, so a forged or tampered index is refused by the real maths.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { registerPoolMeaning } from '@hypercomb/core'
import {
  INSTALL_FOLLOW_KEY, indexDoors, installCandidates, readInstallChannel, readInstallFollow, type InstallFollow,
} from './host-packages'

const PUBLISHER_KEY = generateSecretKey()
const PUBLISHER = getPublicKey(PUBLISHER_KEY)
const STRANGER_KEY = generateSecretKey()
const SIGNED_ROOT = 'a'.repeat(64)
const POOL_HEAD = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)

const verify = (event: Record<string, unknown>): boolean => verifyEvent(event as never)

/** A kind-30564 index event, signed by `key`. */
const index = (key: Uint8Array, roots: Record<string, string>): Record<string, unknown> =>
  finalizeEvent({ kind: 30564, created_at: 1_791_578_080, tags: [], content: JSON.stringify({ v: 1, roots }) }, key) as unknown as Record<string, unknown>

/** A fetch that answers only the URLs it was given; everything else 404s. */
const serving = (routes: Record<string, { body: string; type?: string }>) =>
  vi.fn(async (url: string) => {
    const hit = routes[String(url)]
    if (!hit) return { ok: false, status: 404, text: async () => 'not found' } as unknown as Response
    return { ok: true, status: 200, text: async () => hit.body } as unknown as Response
  })

const indexUrl = async (door: string, pubkey = PUBLISHER): Promise<string> =>
  `https://${door}/${await registerPoolMeaning('hive:indexes')}/${pubkey}`

/** What hypercomb.com's apex answers for any path it does not hold: its page. */
const PAGE = { body: '<!doctype html><html><title>Hypercomb</title></html>', type: 'text/html' }

const FOLLOW: InstallFollow = { pubkey: PUBLISHER, hosts: ['hypercomb.com'], channel: 'essentials' }

beforeEach(() => { vi.unstubAllGlobals() })

describe('readInstallFollow — the same record the update scout reads', () => {
  const storage = (value: string | null): Pick<Storage, 'getItem'> => ({ getItem: () => value })
  const shipped = { pubkey: PUBLISHER, hosts: ['content.hypercomb.com'], channel: 'essentials' }

  it('follows the publisher the shell names when the participant recorded nothing', () => {
    expect(readInstallFollow(storage(null), shipped))
      .toEqual({ pubkey: PUBLISHER, hosts: ['hypercomb.com'], channel: 'essentials' })
  })

  it("follows nobody when the participant said 'off'", () => {
    expect(readInstallFollow(storage('off'), shipped)).toBeNull()
  })

  it("takes the participant's own record over the shell's publisher", () => {
    const own = getPublicKey(STRANGER_KEY)
    expect(readInstallFollow(storage(JSON.stringify({ pubkey: own, hosts: ['https://Example.org/'], channel: 'Beta' })), shipped))
      .toEqual({ pubkey: own, hosts: ['example.org'], channel: 'beta' })
  })

  it('reads a malformed record as no follow — never a fall-through to the shell publisher', () => {
    expect(readInstallFollow(storage('{not json'), shipped)).toBeNull()
    expect(readInstallFollow(storage(JSON.stringify({ pubkey: 'nope' })), shipped)).toBeNull()
  })

  it('follows the public install host when a follow names none', () => {
    expect(readInstallFollow(storage(JSON.stringify({ pubkey: PUBLISHER })), null)?.hosts).toEqual(['hypercomb.com'])
  })

  it('reads the key the scout writes', () => {
    expect(INSTALL_FOLLOW_KEY).toBe('hc:install-follow')
  })
})

describe('indexDoors', () => {
  it('reads each zone root first, then its retired content face', () => {
    expect(indexDoors(['content.hypercomb.com', 'example.org']))
      .toEqual(['hypercomb.com', 'example.org', 'content.hypercomb.com', 'content.example.org'])
  })

  it('gives a loopback zone no content face', () => {
    expect(indexDoors(['localhost:4270'])).toEqual(['localhost:4270'])
  })
})

describe('readInstallChannel — the signed install root', () => {
  it('takes the root the publisher signed, read past an apex that answers with its page', async () => {
    const fetchMock = serving({
      [await indexUrl('hypercomb.com')]: PAGE,
      [await indexUrl('content.hypercomb.com')]: { body: JSON.stringify(index(PUBLISHER_KEY, { 'install:essentials': SIGNED_ROOT, site: OTHER })) },
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await readInstallChannel(FOLLOW, verify))
      .toEqual({ state: 'named', packageSig: SIGNED_ROOT, zone: 'hypercomb.com', createdAt: 1_791_578_080 })
    expect(fetchMock.mock.calls.map(call => String(call[0])))
      .toEqual([await indexUrl('hypercomb.com'), await indexUrl('content.hypercomb.com')])
  })

  it('reads the channel the follow names', async () => {
    vi.stubGlobal('fetch', serving({
      [await indexUrl('hypercomb.com')]: { body: JSON.stringify(index(PUBLISHER_KEY, { 'install:essentials': OTHER, 'install:beta': SIGNED_ROOT })) },
    }))
    expect(await readInstallChannel({ ...FOLLOW, channel: 'beta' }, verify))
      .toMatchObject({ state: 'named', packageSig: SIGNED_ROOT })
  })

  it('is unreachable when no door serves a readable index', async () => {
    vi.stubGlobal('fetch', serving({ [await indexUrl('hypercomb.com')]: PAGE }))
    expect(await readInstallChannel(FOLLOW, verify)).toEqual({ state: 'unreachable' })

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    expect(await readInstallChannel(FOLLOW, verify)).toEqual({ state: 'unreachable' })
  })

  it("calls an index signed by another key at the publisher's address forged", async () => {
    const stranger = index(STRANGER_KEY, { 'install:essentials': OTHER })
    vi.stubGlobal('fetch', serving({ [await indexUrl('hypercomb.com')]: { body: JSON.stringify(stranger) } }))
    expect(await readInstallChannel(FOLLOW, verify)).toEqual({ state: 'forged', door: 'hypercomb.com' })
  })

  it('calls a tampered index forged — the declared key alone proves nothing', async () => {
    const tampered = { ...index(PUBLISHER_KEY, { 'install:essentials': SIGNED_ROOT }), content: JSON.stringify({ v: 1, roots: { 'install:essentials': OTHER } }) }
    vi.stubGlobal('fetch', serving({ [await indexUrl('hypercomb.com')]: { body: JSON.stringify(tampered) } }))
    expect(await readInstallChannel(FOLLOW, verify)).toEqual({ state: 'forged', door: 'hypercomb.com' })
  })

  it('lets a verified door answer even when another door substituted the index', async () => {
    vi.stubGlobal('fetch', serving({
      [await indexUrl('hypercomb.com')]: { body: JSON.stringify(index(STRANGER_KEY, { 'install:essentials': OTHER })) },
      [await indexUrl('content.hypercomb.com')]: { body: JSON.stringify(index(PUBLISHER_KEY, { 'install:essentials': SIGNED_ROOT })) },
    }))
    expect(await readInstallChannel(FOLLOW, verify)).toMatchObject({ state: 'named', packageSig: SIGNED_ROOT })
  })

  it('says so when the verified index names nothing for the channel', async () => {
    vi.stubGlobal('fetch', serving({ [await indexUrl('hypercomb.com')]: { body: JSON.stringify(index(PUBLISHER_KEY, { site: OTHER })) } }))
    expect(await readInstallChannel(FOLLOW, verify)).toEqual({ state: 'unnamed', zone: 'hypercomb.com' })
  })

  it('asks nothing when nobody is followed', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await readInstallChannel(null, verify)).toEqual({ state: 'unfollowed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('installCandidates — the order a cold shell tries', () => {
  const pool = { packageSig: POOL_HEAD, zone: 'hypercomb.com' }
  const named = { state: 'named' as const, packageSig: SIGNED_ROOT, zone: 'hypercomb.com', createdAt: 1 }

  it('tries the signed root before the staged pool head', () => {
    expect(installCandidates(named, pool).candidates).toEqual([
      { packageSig: SIGNED_ROOT, zone: 'hypercomb.com', via: 'channel' },
      { packageSig: POOL_HEAD, zone: 'hypercomb.com', via: 'pool' },
    ])
  })

  it('asks once when the pool already holds the signed root', () => {
    expect(installCandidates(named, { ...pool, packageSig: SIGNED_ROOT }).candidates)
      .toEqual([{ packageSig: SIGNED_ROOT, zone: 'hypercomb.com', via: 'channel' }])
  })

  it('falls back to the pool head when the index cannot be read, names nothing, or nobody is followed', () => {
    for (const channel of [{ state: 'unreachable' as const }, { state: 'unnamed' as const, zone: 'hypercomb.com' }, { state: 'unfollowed' as const }]) {
      expect(installCandidates(channel, pool).candidates).toEqual([{ packageSig: POOL_HEAD, zone: 'hypercomb.com', via: 'pool' }])
    }
  })

  it('refuses both when the index was forged', () => {
    const verdict = installCandidates({ state: 'forged', door: 'hypercomb.com' }, pool)
    expect(verdict.candidates).toEqual([])
    expect(verdict.refused).toMatch(/not the followed publisher's/)
  })
})
