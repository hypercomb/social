// hive-pointer.roots.spec.ts — changeHiveRoots: several roots in ONE signed
// index write, under setHiveRoot's rules (documentation/open-entry-pools.md,
// "Ending, closing, recycling"). Collaborators injected; no network, no IoC.

import { describe, expect, it } from 'vitest'
import { ROOT_MOVED, changeHiveRoots, type HiveIndexResult, type PutHiveOptions, type PutHiveResult } from './hive-pointer.js'

const PUB = 'a'.repeat(64)
const O = 'b'.repeat(64)
const HIDDEN = 'c'.repeat(64)
const OTHER = 'd'.repeat(64)
const H = 'e'.repeat(64)
const HOST = 'content.example.com'
const OPEN = `entries:${H}`
const CLOSED = `entries-closed:${H}`
const HIDE = `entries-hidden:${H}`

type PutCall = {
  roots: Record<string, string>
  doors?: Record<string, string[]>
  replaces?: number
  previousContent?: Record<string, unknown>
  options?: PutHiveOptions
}

const harness = (read: HiveIndexResult, answer: PutHiveResult = { ok: true, pubkey: PUB, createdAt: 1700000000 }) => {
  const puts: PutCall[] = []
  const deps = {
    publicKey: async () => PUB,
    fetchIndex: async (): Promise<HiveIndexResult> => read,
    putManifest: async (_host: string, roots: Record<string, string>, doors?: Record<string, string[]>,
      replaces?: number, previousContent?: Record<string, unknown>, options?: PutHiveOptions): Promise<PutHiveResult> => {
      puts.push({ roots, doors, replaces, previousContent, options })
      return answer
    },
  }
  return { deps, puts }
}

const verified = (roots: Record<string, string>, extra: Partial<{ doors: Record<string, string[]>; signedContent: Record<string, unknown> }> = {}): HiveIndexResult =>
  ({ ok: true, manifest: { roots, createdAt: 1600000000, pubkey: PUB, ...extra } })

describe('changeHiveRoots — closing is one write', () => {
  it('takes entries:<H> out and names entries-closed:<H> in the same signed index, the rest untouched', async () => {
    const { deps, puts } = harness(verified({ [OPEN]: O, site: OTHER }))
    const result = await changeHiveRoots(HOST, { drop: [OPEN], set: { [CLOSED]: O } }, deps)
    expect(result).toMatchObject({ ok: true, pubkey: PUB, createdAt: 1700000000, dropped: { [OPEN]: O }, set: { [CLOSED]: O } })
    expect(puts).toHaveLength(1)
    expect(puts[0].roots).toEqual({ [CLOSED]: O, site: OTHER })
    expect(puts[0].replaces).toBe(1600000000)
  })

  it('recycling drops up to three keys and may name one, still in one write', async () => {
    const NEXT = 'f'.repeat(64)
    const { deps, puts } = harness(verified({ [CLOSED]: O, [HIDE]: HIDDEN, site: OTHER }))
    const result = await changeHiveRoots(HOST, { drop: [OPEN, CLOSED, HIDE], set: { [`entries:${NEXT}`]: OTHER } }, deps)
    expect(result.ok).toBe(true)
    // A key already absent is no change, and is not reported as dropped.
    expect(result.dropped).toEqual({ [CLOSED]: O, [HIDE]: HIDDEN })
    expect(puts).toHaveLength(1)
    expect(puts[0].roots).toEqual({ site: OTHER, [`entries:${NEXT}`]: OTHER })
  })

  it('carries the doors and the signed content of the index it read', async () => {
    const signedContent = { v: 1, roots: { [OPEN]: O }, offerings: { text: { location: OTHER } } }
    const doors = { site: ['example.com'] }
    const { deps, puts } = harness(verified({ [OPEN]: O }, { doors, signedContent }))
    await changeHiveRoots(HOST, { drop: [OPEN], set: { [CLOSED]: O } }, deps)
    expect(puts[0].doors).toEqual(doors)
    expect(puts[0].previousContent).toEqual(signedContent)
  })
})

describe('changeHiveRoots — the baseline rules of setHiveRoot', () => {
  it('a 404 is the sanctioned empty baseline', async () => {
    const { deps, puts } = harness({ ok: false, reason: 'http', status: 404 })
    expect((await changeHiveRoots(HOST, { drop: [OPEN], set: { [CLOSED]: O } }, deps)).ok).toBe(true)
    expect(puts[0].roots).toEqual({ [CLOSED]: O })
    expect(puts[0].replaces).toBe(0)
  })

  it('refuses to write over an index it cannot see: unreachable, malformed, forged, another status', async () => {
    for (const read of [
      { ok: false, reason: 'unreachable' }, { ok: false, reason: 'malformed' }, { ok: false, reason: 'forged' },
      { ok: false, reason: 'http', status: 500 },
    ] as HiveIndexResult[]) {
      const { deps, puts } = harness(read)
      const result = await changeHiveRoots(HOST, { drop: [OPEN], set: { [CLOSED]: O } }, deps)
      expect(result.ok).toBe(false)
      expect(result.reason).toMatch(/^index-unsafe: /)
      expect(puts).toHaveLength(0)
    }
  })

  it('an index already as asked no-ops without re-signing', async () => {
    const { deps, puts } = harness(verified({ [CLOSED]: O }))
    const result = await changeHiveRoots(HOST, { drop: [OPEN], set: { [CLOSED]: O.toUpperCase() } }, deps)
    expect(result).toMatchObject({ ok: true, reason: 'unchanged', dropped: {}, set: {} })
    expect(puts).toHaveLength(0)
  })

  it('refuses what it cannot write, before reading anything', async () => {
    const { deps, puts } = harness(verified({}))
    expect((await changeHiveRoots(HOST, {}, deps)).reason).toBe('no key named')
    expect((await changeHiveRoots(HOST, { drop: [' '] }, deps)).reason).toBe('empty key')
    expect((await changeHiveRoots(HOST, { set: { ' ': O } }, deps)).reason).toBe('empty key')
    expect((await changeHiveRoots(HOST, { set: { [CLOSED]: 'nope' } }, deps)).reason).toBe('sig is not a 64-hex signature')
    expect((await changeHiveRoots(HOST, { drop: [CLOSED], set: { [CLOSED]: O } }, deps)).reason).toBe('a key is named twice')
    expect((await changeHiveRoots(HOST, { set: { [CLOSED]: O } }, { ...deps, publicKey: async () => null })).reason).toBe('no signer')
    expect(puts).toHaveLength(0)
  })

  it('a refused write is answered with the host\'s reason', async () => {
    const { deps } = harness(verified({ [OPEN]: O }), { ok: false, pubkey: '', createdAt: 0, reason: 'host refused' })
    expect(await changeHiveRoots(HOST, { drop: [OPEN], set: { [CLOSED]: O } }, deps))
      .toMatchObject({ ok: false, reason: 'host refused', dropped: {}, set: {} })
  })
})

describe('changeHiveRoots — a moved key is refused', () => {
  it('every touched key rides expectRoots at the signature this read found, absent as null', async () => {
    const { deps, puts } = harness(verified({ [OPEN]: O, [HIDE]: HIDDEN }))
    await changeHiveRoots(HOST, { drop: [OPEN, CLOSED], set: { [HIDE]: OTHER } }, deps)
    expect(puts[0].options).toEqual({ expectRoots: { [OPEN]: O, [CLOSED]: null, [HIDE]: HIDDEN } })
  })

  it('what the caller counted on, touched or not, is checked against the read and rides the write', async () => {
    const moved = harness(verified({ [OPEN]: O, [HIDE]: OTHER }))
    expect(await changeHiveRoots(HOST, { set: { [HIDE]: HIDDEN.replace('c', 'a') }, expect: { [HIDE]: HIDDEN } }, moved.deps))
      .toMatchObject({ ok: false, reason: ROOT_MOVED })
    const gone = harness(verified({ [CLOSED]: O }))
    expect(await changeHiveRoots(HOST, { drop: [CLOSED], expect: { [OPEN]: O } }, gone.deps))
      .toMatchObject({ ok: false, reason: ROOT_MOVED })
    expect([...moved.puts, ...gone.puts]).toHaveLength(0)

    const held = harness(verified({ [OPEN]: O, [HIDE]: HIDDEN }))
    expect((await changeHiveRoots(HOST, { set: { [HIDE]: OTHER }, expect: { [OPEN]: O, [CLOSED]: null } }, held.deps)).ok).toBe(true)
    expect(held.puts[0].options).toEqual({ expectRoots: { [OPEN]: O, [CLOSED]: null, [HIDE]: HIDDEN } })
  })

  it('when the write\'s own fresh read finds a key moved, ROOT_MOVED comes back and nothing is reported changed', async () => {
    const { deps } = harness(verified({ [OPEN]: O }), { ok: false, pubkey: '', createdAt: 0, reason: ROOT_MOVED })
    expect(await changeHiveRoots(HOST, { drop: [OPEN], set: { [CLOSED]: O } }, deps))
      .toMatchObject({ ok: false, reason: ROOT_MOVED, dropped: {}, set: {} })
  })
})
