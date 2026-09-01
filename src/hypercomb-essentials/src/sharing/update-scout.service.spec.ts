// update-scout.service.spec.ts — the signed-sentinel update consumer's
// silence rules. Deps injected; no network, no EffectBus, no real storage.

import { describe, expect, it } from 'vitest'
import { INSTALL_FOLLOW_KEY, readInstallFollow, scoutVerdict, UpdateScoutService } from './update-scout.service.js'
import type { HiveManifest } from './hive-pointer.js'

const PUB = 'a'.repeat(64)
const INSTALLED = 'b'.repeat(64)
const PUBLISHED = 'c'.repeat(64)

const storageOf = (entries: Record<string, string>) =>
  ({ getItem: (key: string) => entries[key] ?? null })

const follow = JSON.stringify({ pubkey: PUB, hosts: ['content.example.com'], channel: 'essentials' })

const manifestOf = (roots: Record<string, string>): HiveManifest =>
  ({ roots, createdAt: 1700000000, pubkey: PUB })

describe('readInstallFollow', () => {
  it('parses a pinned follow and defaults hosts + channel', () => {
    const parsed = readInstallFollow(storageOf({ [INSTALL_FOLLOW_KEY]: JSON.stringify({ pubkey: PUB }) }))
    expect(parsed).toEqual({ pubkey: PUB, hosts: ['content.pluginthematrix.com'], channel: 'essentials' })
  })

  it('treats absence and malformation as no follow', () => {
    expect(readInstallFollow(storageOf({}))).toBeNull()
    expect(readInstallFollow(storageOf({ [INSTALL_FOLLOW_KEY]: 'not json' }))).toBeNull()
    expect(readInstallFollow(storageOf({ [INSTALL_FOLLOW_KEY]: JSON.stringify({ pubkey: 'short' }) }))).toBeNull()
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
  it('emits the upgrade-indicator payload on divergence', async () => {
    const emitted: Record<string, unknown>[] = []
    const sig = await new UpdateScoutService().check({
      storage: storageOf({ [INSTALL_FOLLOW_KEY]: follow, 'sentinel.sync-signature': INSTALLED }),
      fetchManifest: async () => manifestOf({ 'install:essentials': PUBLISHED }),
      emit: payload => { emitted.push(payload) },
    })
    expect(sig).toBe(PUBLISHED)
    expect(emitted).toEqual([{ available: true, newCount: 0, newBees: [], packageSig: PUBLISHED, previous: null, label: '' }])
  })

  it('never emits when dormant, unverified, or current — silence is silence', async () => {
    const emitted: Record<string, unknown>[] = []
    const scout = new UpdateScoutService()
    const base = { emit: (payload: Record<string, unknown>) => { emitted.push(payload) } }
    // dormant: no follow record
    expect(await scout.check({ ...base, storage: storageOf({}), fetchManifest: async () => manifestOf({ 'install:essentials': PUBLISHED }) })).toBeNull()
    // unverified/unreachable: fetch yields null
    expect(await scout.check({ ...base, storage: storageOf({ [INSTALL_FOLLOW_KEY]: follow, 'sentinel.sync-signature': INSTALLED }), fetchManifest: async () => null })).toBeNull()
    // current: root equals installed
    expect(await scout.check({ ...base, storage: storageOf({ [INSTALL_FOLLOW_KEY]: follow, 'sentinel.sync-signature': INSTALLED }), fetchManifest: async () => manifestOf({ 'install:essentials': INSTALLED }) })).toBeNull()
    expect(emitted).toEqual([])
  })
})
