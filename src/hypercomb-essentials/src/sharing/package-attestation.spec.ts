// package-attestation.spec.ts — who vouches for a package. Deps injected;
// no network, no real storage, no IoC.

import { describe, expect, it, vi } from 'vitest'
import { ATTESTED_PACKAGES_KEY, attestPackage, indexHostsFor, readWitnessed } from './package-attestation.js'
import { INSTALL_FOLLOW_KEY } from './update-scout.service.js'
import type { HiveIndexResult } from './hive-pointer.js'

const PUB = 'a'.repeat(64)
const OTHER_PUB = 'b'.repeat(64)
const CURRENT = 'c'.repeat(64)
const OLD = 'd'.repeat(64)
const STRANGER = 'e'.repeat(64)

const memory = (entries: Record<string, string> = {}) => {
  const m = new Map(Object.entries(entries))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    dump: () => Object.fromEntries(m),
  }
}

const follow = JSON.stringify({ pubkey: PUB, hosts: ['content.example.com'], channel: 'essentials' })
const following = (extra: Record<string, string> = {}) => memory({ [INSTALL_FOLLOW_KEY]: follow, ...extra })

const verified = (roots: Record<string, string>): HiveIndexResult =>
  ({ ok: true, manifest: { roots, createdAt: 1, pubkey: PUB } })
const indexAt = (answers: Record<string, HiveIndexResult>) =>
  vi.fn(async (host: string): Promise<HiveIndexResult> => answers[host] ?? { ok: false, reason: 'unreachable' })

describe('attestPackage', () => {

  it('follows nobody → no-follow, and asks no host', async () => {
    const fetchIndex = indexAt({})
    expect(await attestPackage(CURRENT, ['jwize.com'], { storage: memory(), publisher: null, fetchIndex }))
      .toEqual({ ok: false, reason: 'no-follow' })
    expect(fetchIndex).not.toHaveBeenCalled()
  })

  it('attests the root the followed key currently names, and witnesses it', async () => {
    const storage = following()
    const fetchIndex = indexAt({ 'content.example.com': verified({ 'install:essentials': CURRENT }) })
    expect(await attestPackage(CURRENT, ['jwize.com'], { storage, publisher: null, fetchIndex }))
      .toEqual({ ok: true, pubkey: PUB, witnessed: 'current' })
    expect(readWitnessed(storage)).toEqual({ [CURRENT]: PUB })
  })

  it('answers a witnessed root as held, without a fetch — rollback and pinning', async () => {
    const storage = following({ [ATTESTED_PACKAGES_KEY]: JSON.stringify({ [OLD]: PUB }) })
    const fetchIndex = indexAt({})
    expect(await attestPackage(OLD, ['jwize.com'], { storage, publisher: null, fetchIndex }))
      .toEqual({ ok: true, pubkey: PUB, witnessed: 'held' })
    expect(fetchIndex).not.toHaveBeenCalled()
  })

  it('a witness under a key you no longer follow is no witness', async () => {
    const storage = following({ [ATTESTED_PACKAGES_KEY]: JSON.stringify({ [OLD]: OTHER_PUB }) })
    const fetchIndex = indexAt({ 'content.example.com': verified({ 'install:essentials': CURRENT }) })
    const verdict = await attestPackage(OLD, [], { storage, publisher: null, fetchIndex })
    expect(verdict).toMatchObject({ ok: false, reason: 'not-named' })
    expect(fetchIndex).toHaveBeenCalled()
  })

  it("refuses a stranger's build by name, and still remembers what the publisher names", async () => {
    const storage = following()
    const fetchIndex = indexAt({ 'content.example.com': verified({ 'install:essentials': CURRENT }) })
    const verdict = await attestPackage(STRANGER, ['evil.example'], { storage, publisher: null, fetchIndex })
    expect(verdict).toMatchObject({ ok: false, reason: 'not-named' })
    expect((verdict as { detail?: string }).detail).toMatch(new RegExp(CURRENT.slice(0, 12)))
    // …and names it in full, so the host directory can offer THAT build.
    expect((verdict as { named?: string }).named).toBe(CURRENT)
    expect(readWitnessed(storage)).toEqual({ [CURRENT]: PUB })
  })

  it('reads EVERY verified copy before saying not-named — a stale host is not the last word', async () => {
    const storage = following()
    const fetchIndex = indexAt({
      'content.example.com': verified({ 'install:essentials': OLD }),
      'jwize.com': verified({ 'install:essentials': CURRENT }),
    })
    expect(await attestPackage(CURRENT, ['jwize.com'], { storage, publisher: null, fetchIndex }))
      .toEqual({ ok: true, pubkey: PUB, witnessed: 'current' })
    // Both roots the key named are now witnessed.
    expect(readWitnessed(storage)).toEqual({ [OLD]: PUB, [CURRENT]: PUB })
  })

  it('reports forged over silence, and unreachable when nobody answers', async () => {
    const storage = following()
    const forgedAt = indexAt({ 'jwize.com': { ok: false, reason: 'forged' } })
    expect(await attestPackage(CURRENT, ['jwize.com'], { storage, publisher: null, fetchIndex: forgedAt }))
      .toEqual({ ok: false, reason: 'forged' })
    expect(await attestPackage(CURRENT, ['jwize.com'], { storage, publisher: null, fetchIndex: indexAt({}) }))
      .toEqual({ ok: false, reason: 'unreachable' })
  })

  it('never throws — a fetch that throws is a host that did not answer', async () => {
    const storage = following()
    const fetchIndex = vi.fn(async () => { throw new Error('boom') })
    expect(await attestPackage(CURRENT, ['jwize.com'], { storage, publisher: null, fetchIndex }))
      .toEqual({ ok: false, reason: 'unreachable' })
  })

  it('rejects a non-signature without asking anyone', async () => {
    const fetchIndex = indexAt({})
    expect(await attestPackage('nope', [], { storage: following(), publisher: null, fetchIndex }))
      .toMatchObject({ ok: false, reason: 'not-named' })
    expect(fetchIndex).not.toHaveBeenCalled()
  })
})

describe('indexHostsFor', () => {
  it('asks the followed hosts first, then each offering zone and its content face', () => {
    expect(indexHostsFor({ pubkey: PUB, hosts: ['content.example.com'], channel: 'essentials' }, ['jwize.com', 'content.other.example', 'localhost:4270', '']))
      .toEqual(['content.example.com', 'jwize.com', 'content.jwize.com', 'content.other.example', 'localhost:4270'])
  })
})

describe('readWitnessed', () => {
  it('keeps only well-formed sig → pubkey pairs, and reads garbage as nothing', () => {
    expect(readWitnessed(memory({ [ATTESTED_PACKAGES_KEY]: JSON.stringify({ [OLD]: PUB, short: PUB, [CURRENT]: 'x' }) })))
      .toEqual({ [OLD]: PUB })
    expect(readWitnessed(memory({ [ATTESTED_PACKAGES_KEY]: '[1,2]' }))).toEqual({})
    expect(readWitnessed(memory({ [ATTESTED_PACKAGES_KEY]: 'not json' }))).toEqual({})
    expect(readWitnessed(memory())).toEqual({})
  })
})
