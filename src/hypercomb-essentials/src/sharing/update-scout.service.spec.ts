// update-scout.service.spec.ts — the signed-sentinel update consumer's
// silence rules. Deps injected; no network, no EffectBus, no real storage.

import { describe, expect, it } from 'vitest'
import { INSTALL_FOLLOW_KEY, readInstallFollow, scoutVerdict, UpdateScoutService } from './update-scout.service.js'
import type { HiveManifest } from './hive-pointer.js'

const PUB = 'a'.repeat(64)
const INSTALLED = 'b'.repeat(64)
const PUBLISHED = 'c'.repeat(64)
const OTHER_PUB = 'd'.repeat(64)

const storageOf = (entries: Record<string, string>) =>
  ({ getItem: (key: string) => entries[key] ?? null })

const follow = JSON.stringify({ pubkey: PUB, hosts: ['content.example.com'], channel: 'essentials' })

const manifestOf = (roots: Record<string, string>): HiveManifest =>
  ({ roots, createdAt: 1700000000, pubkey: PUB })

describe('readInstallFollow', () => {
  it('parses a pinned follow and defaults hosts + channel', () => {
    const parsed = readInstallFollow(storageOf({ [INSTALL_FOLLOW_KEY]: JSON.stringify({ pubkey: PUB }) }), null)
    expect(parsed).toEqual({ pubkey: PUB, hosts: ['content.pluginthematrix.com'], channel: 'essentials' })
  })

  it('treats absence and malformation as no follow', () => {
    expect(readInstallFollow(storageOf({}), null)).toBeNull()
    // A broken record never falls through to the package's publisher.
    expect(readInstallFollow(storageOf({ [INSTALL_FOLLOW_KEY]: 'not json' }), { pubkey: PUB })).toBeNull()
    expect(readInstallFollow(storageOf({ [INSTALL_FOLLOW_KEY]: JSON.stringify({ pubkey: 'short' }) }), { pubkey: PUB })).toBeNull()
  })

  it('follows the publisher the package names when the participant has no record', () => {
    expect(readInstallFollow(storageOf({}), { pubkey: PUB, hosts: ['content.example.com'] }))
      .toEqual({ pubkey: PUB, hosts: ['content.example.com'], channel: 'essentials' })
    // No stamp has succeeded yet: the file names no key, and the scout is dormant.
    expect(readInstallFollow(storageOf({}), { pubkey: '', hosts: [], channel: 'essentials' })).toBeNull()
  })

  it("lets the participant's record override the package, and 'off' follow nobody", () => {
    expect(readInstallFollow(storageOf({ [INSTALL_FOLLOW_KEY]: JSON.stringify({ pubkey: OTHER_PUB }) }), { pubkey: PUB })?.pubkey)
      .toBe(OTHER_PUB)
    expect(readInstallFollow(storageOf({ [INSTALL_FOLLOW_KEY]: 'off' }), { pubkey: PUB })).toBeNull()
  })

  it('reads the bundled install-publisher.json as a follow or as nothing, never a throw', () => {
    const bundled = readInstallFollow(storageOf({}))
    expect(bundled === null || bundled.channel === 'essentials').toBe(true)
  })
})

describe('scoutVerdict', () => {
  it('announces only a genuine divergence', () => {
    expect(scoutVerdict({ 'install:essentials': PUBLISHED }, 'essentials', INSTALLED)).toBe(PUBLISHED)
  })

  it('is silent at genesis, at parity, and when the channel is absent', () => {
    expect(scoutVerdict({ 'install:essentials': PUBLISHED }, 'essentials', null)).toBeNull()
    expect(scoutVerdict({ 'install:essentials': INSTALLED }, 'essentials', INSTALLED)).toBeNull()
    expect(scoutVerdict({}, 'essentials', INSTALLED)).toBeNull()
  })
})

describe('UpdateScoutService.check', () => {
  it('emits the upgrade-indicator payload on divergence, tagged as a channel offer', async () => {
    const emitted: Record<string, unknown>[] = []
    const sig = await new UpdateScoutService().check({
      storage: storageOf({ [INSTALL_FOLLOW_KEY]: follow, 'sentinel.sync-signature': INSTALLED }),
      fetchManifest: async () => manifestOf({ 'install:essentials': PUBLISHED }),
      emit: payload => { emitted.push(payload) },
    })
    expect(sig).toBe(PUBLISHED)
    expect(emitted).toEqual([{ available: true, newCount: 0, newBees: [], packageSig: PUBLISHED, previous: null, label: '', source: 'channel' }])
  })

  it("follows the package's publisher when the participant has no record", async () => {
    const asked: string[] = []
    const emitted: Record<string, unknown>[] = []
    const sig = await new UpdateScoutService().check({
      storage: storageOf({ 'sentinel.sync-signature': INSTALLED }),
      publisher: { pubkey: PUB },
      fetchManifest: async (_hosts, pubkey) => { asked.push(pubkey); return manifestOf({ 'install:essentials': PUBLISHED }) },
      emit: payload => { emitted.push(payload) },
    })
    expect(asked).toEqual([PUB])
    expect(sig).toBe(PUBLISHED)
    expect(emitted).toHaveLength(1)
  })

  it('reads the shared installed stamp first, so an adopted channel update is not announced again', async () => {
    const emitted: Record<string, unknown>[] = []
    const sig = await new UpdateScoutService().check({
      storage: storageOf({
        [INSTALL_FOLLOW_KEY]: follow,
        'hc:shim:installed-package': PUBLISHED,
        'sentinel.sync-signature': INSTALLED,
      }),
      fetchManifest: async () => manifestOf({ 'install:essentials': PUBLISHED }),
      emit: payload => { emitted.push(payload) },
    })
    expect(sig).toBeNull()
    expect(emitted).toEqual([])
  })

  it('never emits when dormant, unverified, or current — silence is silence', async () => {
    const emitted: Record<string, unknown>[] = []
    const scout = new UpdateScoutService()
    const base = { emit: (payload: Record<string, unknown>) => { emitted.push(payload) } }
    // dormant: no follow record and no publisher named
    expect(await scout.check({ ...base, storage: storageOf({}), publisher: null, fetchManifest: async () => manifestOf({ 'install:essentials': PUBLISHED }) })).toBeNull()
    // unverified/unreachable: fetch yields null
    expect(await scout.check({ ...base, storage: storageOf({ [INSTALL_FOLLOW_KEY]: follow, 'sentinel.sync-signature': INSTALLED }), fetchManifest: async () => null })).toBeNull()
    // current: root equals installed
    expect(await scout.check({ ...base, storage: storageOf({ [INSTALL_FOLLOW_KEY]: follow, 'sentinel.sync-signature': INSTALLED }), fetchManifest: async () => manifestOf({ 'install:essentials': INSTALLED }) })).toBeNull()
    expect(emitted).toEqual([])
  })
})
