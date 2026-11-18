// tile-visibility.spec.ts — the two words: public stages and switches on, private switches off and seals to your own key.

import { describe, expect, it } from 'vitest'
import { makePrivate, makePublic, type Switched, type VisibilityDeps } from './tile-visibility.js'

const KEY = 'a'.repeat(64)
const ROOT = 'b'.repeat(64)

const world = (over: Partial<VisibilityDeps> & { roots?: Record<string, string | null> } = {}) => {
  const roots: Record<string, string | null> = over.roots ?? {}
  const calls: string[] = []
  const deps: VisibilityDeps = {
    hosts: async () => Object.keys(roots),
    pubkey: async () => KEY,
    root: async zone => roots[zone] ?? null,
    stage: async () => { calls.push('stage'); for (const zone of Object.keys(roots)) roots[zone] = ROOT; return true },
    toggle: async (zone, _pubkey, lineage, on): Promise<Switched> => { calls.push(`${on ? 'on' : 'off'} ${zone} ${lineage}`); return { ok: true, changed: true } },
    confirm: async () => { calls.push('confirm'); return true },
    keep: async () => { calls.push('keep'); return { ok: true, hosts: ['one.example'] } },
    withdraw: async () => { calls.push('withdraw'); return { ok: true } },
    forget: async () => { calls.push('forget'); return { ok: true, removed: 3 } },
    ...over,
  }
  return { deps, calls }
}

describe('public — staged and in the community', () => {
  it('switches a staged tile on in the community of each host that holds it, and stages nothing', async () => {
    const { deps, calls } = world({ roots: { 'one.example': ROOT, 'two.example': null } })
    expect(await makePublic(['recipes', 'bread'], deps)).toEqual({ ok: true, on: ['one.example'], refused: [] })
    expect(calls).toEqual(['on one.example recipes/bread'])
  })

  it('stages a tile that is on no host first, then switches it on', async () => {
    const { deps, calls } = world({ roots: { 'one.example': null } })
    expect(await makePublic(['bread'], deps)).toEqual({ ok: true, on: ['one.example'], refused: [] })
    expect(calls).toEqual(['stage', 'on one.example bread'])
  })

  it('is not public when the staging was declined, and switches nothing', async () => {
    const { deps, calls } = world({ roots: { 'one.example': null }, stage: async () => false })
    expect(await makePublic(['bread'], deps)).toEqual({ ok: false, reason: 'not-staged' })
    expect(calls).toEqual([])
  })

  it('refuses a tile that names no host, a place with no key, and the hive root', async () => {
    expect(await makePublic(['bread'], world().deps)).toEqual({ ok: false, reason: 'no-host' })
    expect(await makePublic(['bread'], world({ roots: { 'one.example': ROOT }, pubkey: async () => '' }).deps)).toEqual({ ok: false, reason: 'no-signer' })
    expect(await makePublic([], world({ roots: { 'one.example': ROOT } }).deps)).toEqual({ ok: false, reason: 'no-tile' })
  })

  it('names the host whose community would not take it', async () => {
    const { deps } = world({ roots: { 'one.example': ROOT }, toggle: async () => ({ ok: false, reason: 'could not read the showcase' }) })
    expect(await makePublic(['bread'], deps)).toEqual({ ok: true, on: [], refused: [{ zone: 'one.example', reason: 'could not read the showcase' }] })
  })
})

describe('private - kept sealed, out of the community, the plain copy withdrawn', () => {
  it('keeps a tile that was never staged, and asks nothing, switches nothing, withdraws nothing', async () => {
    const { deps, calls } = world({ roots: { 'one.example': null } })
    expect(await makePrivate(['bread'], deps)).toEqual({ ok: true, kept: ['one.example'], staged: [], off: [], refused: [], withdrawn: false })
    expect(calls).toEqual(['keep'])
  })

  it('asks first for a staged tile, then: community off, sealed copy kept, plain root withdrawn, bytes forgotten', async () => {
    const { deps, calls } = world({ roots: { 'one.example': ROOT, 'two.example': ROOT } })
    expect(await makePrivate(['bread'], deps)).toEqual({
      ok: true, kept: ['one.example'], staged: ['one.example', 'two.example'], off: ['one.example', 'two.example'], refused: [], withdrawn: true, forgotten: 3,
    })
    expect(calls).toEqual(['confirm', 'off one.example bread', 'off two.example bread', 'keep', 'withdraw', 'forget'])
  })

  it('changes nothing when the participant says no', async () => {
    const { deps, calls } = world({ roots: { 'one.example': ROOT }, confirm: async () => false })
    expect(await makePrivate(['bread'], deps)).toEqual({ ok: false, reason: 'declined' })
    expect(calls).toEqual([])
  })

  it('never withdraws the plain copy when the sealed one was not kept', async () => {
    const { deps, calls } = world({ roots: { 'one.example': ROOT }, keep: async () => ({ ok: false, reason: 'no-nip44' }) })
    expect(await makePrivate(['bread'], deps)).toMatchObject({ ok: true, kept: [], keepReason: 'no-nip44', off: ['one.example'], withdrawn: false })
    expect(calls).not.toContain('withdraw')
    expect(calls).not.toContain('forget')
  })

  it('does not ask the hosts to forget what the index still names', async () => {
    const { deps, calls } = world({ roots: { 'one.example': ROOT }, withdraw: async () => ({ ok: false, reason: 'index-unsafe' }) })
    expect(await makePrivate(['bread'], deps)).toMatchObject({ ok: true, kept: ['one.example'], withdrawn: false, withdrawReason: 'index-unsafe' })
    expect(calls).not.toContain('forget')
  })

  it('says when the hosts did not forget, and names a community that could not be switched off', async () => {
    const { deps } = world({
      roots: { 'one.example': ROOT },
      forget: async () => ({ ok: false, reason: 'keep-incomplete' }),
      toggle: async () => { throw new Error('down') },
    })
    expect(await makePrivate(['bread'], deps)).toMatchObject({
      ok: true, withdrawn: true, forgetReason: 'keep-incomplete', off: [], refused: [{ zone: 'one.example', reason: 'the community could not be signed' }],
    })
  })

  it('refuses the hive root and a place with no key', async () => {
    expect(await makePrivate([], world().deps)).toEqual({ ok: false, reason: 'no-tile' })
    expect(await makePrivate(['bread'], world({ pubkey: async () => '' }).deps)).toEqual({ ok: false, reason: 'no-signer' })
  })
})
