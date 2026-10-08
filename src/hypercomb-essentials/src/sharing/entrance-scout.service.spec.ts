// sharing/entrance-scout.service.spec.ts — the page your domain runs has a
// newer version: a notice, never a swap. Real index verification and real
// byte checks; only the network is stubbed, and every request is recorded so
// the spec can prove the scout never writes.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { SignatureService } from '@hypercomb/core'
import { EntranceScoutService, readEntranceScents, type EntranceUpdate } from './entrance-scout.service.js'
import { CARD_PAGE_KIND } from '../commands/card-wear.js'
import type { HiveIndexResult } from './hive-pointer.js'

const OWN_SECRET = new Uint8Array(32).fill(21)
const PUB_SECRET = new Uint8Array(32).fill(22)
const OWN = getPublicKey(OWN_SECRET)
const PUB = getPublicKey(PUB_SECRET)
const ZONE = 'jwize.com'
const RUNS = 'c'.repeat(64)
const NEWER_PAGE = 'd'.repeat(64)
const ALL = ['keep', 'camera', 'read']
/** The publisher's index is stamped 1_700_000_000; the turn-on saw an older one. */
const FOLLOWED = { pubkey: '', lineage: 'card', at: 1_699_999_000 }

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const sigOf = (bytes: Uint8Array): Promise<string> => SignatureService.sign(bytes.slice().buffer as ArrayBuffer)
const signed = (content: Record<string, unknown>, secret: Uint8Array): Record<string, unknown> =>
  finalizeEvent({ kind: 30564, created_at: 1_700_000_000, tags: [], content: JSON.stringify(content) }, secret) as unknown as Record<string, unknown>

let indexes: Record<string, Record<string, unknown>>
let atoms: Map<string, Uint8Array>
let requests: { url: string; method: string }[]
let head: string

const ownIndex = (entrance: Record<string, unknown>): Record<string, unknown> =>
  signed({ v: 1, roots: { 'jaime-weise': 'a'.repeat(64) }, addresses: { [ZONE]: 'jaime-weise' }, entrances: { [ZONE]: entrance } }, OWN_SECRET)

beforeEach(async () => {
  atoms = new Map()
  requests = []
  const record = encode({ kind: CARD_PAGE_KIND, payload: { htmlSig: NEWER_PAGE } })
  const recordSig = await sigOf(record)
  atoms.set(recordSig, record)
  const layer = encode({ name: 'card', decorations: [recordSig] })
  head = await sigOf(layer)
  atoms.set(head, layer)
  indexes = {
    [OWN]: ownIndex({ page: RUNS, powers: ALL, from: { ...FOLLOWED, pubkey: PUB } }),
    [PUB]: signed({ v: 1, roots: { card: head } }, PUB_SECRET),
  }
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, method: init?.method ?? 'GET' })
    const last = url.split('/').pop() ?? ''
    if (indexes[last]) return Response.json(indexes[last])
    const bytes = atoms.get(last)
    return bytes ? new Response(bytes.slice()) : new Response('', { status: 404 })
  }) as typeof fetch
})

const deps = (emitted: EntranceUpdate[], skipped: string[] = []) => ({
  hosts: async () => [ZONE],
  ownPubkey: async () => OWN,
  skipped: async () => new Set(skipped),
  emit: (update: EntranceUpdate) => { emitted.push(update) },
})

describe('the entrance scout', () => {
  it('announces a newer page the followed head wears — once', async () => {
    const scout = new EntranceScoutService()
    const emitted: EntranceUpdate[] = []
    const update = { zone: ZONE, current: RUNS, offered: NEWER_PAGE, at: 1_700_000_000, head }
    expect(await scout.check(deps(emitted))).toEqual([update])
    await scout.check(deps(emitted))
    expect(emitted).toEqual([update])
  })

  it('honours a skip', async () => {
    const emitted: EntranceUpdate[] = []
    expect(await new EntranceScoutService().check(deps(emitted, [NEWER_PAGE]))).toEqual([])
    expect(emitted).toEqual([])
  })

  it('is silent when the domain already runs that page, when powers are off, or when nothing is followed', async () => {
    for (const entrance of [
      { page: NEWER_PAGE, powers: ALL, from: { ...FOLLOWED, pubkey: PUB } },
      { page: RUNS, powers: [], from: { ...FOLLOWED, pubkey: PUB } },
      { page: RUNS, powers: ALL },
    ]) {
      indexes[OWN] = ownIndex(entrance)
      const emitted: EntranceUpdate[] = []
      expect(await new EntranceScoutService().check(deps(emitted))).toEqual([])
      expect(emitted).toEqual([])
    }
  })

  it('never offers a downgrade: a differing page counts only from an index stamped after the turn-on', async () => {
    // The turn-on recorded the publisher's index as it is now (or later), so
    // the different page its head wears is not newer than the one running.
    for (const at of [1_700_000_000, 1_700_000_500]) {
      indexes[OWN] = ownIndex({ page: RUNS, powers: ALL, from: { pubkey: PUB, lineage: 'card', at } })
      const emitted: EntranceUpdate[] = []
      expect(await new EntranceScoutService().check(deps(emitted))).toEqual([])
      expect(emitted).toEqual([])
    }
    // An entrance that never recorded what it followed offers nothing.
    indexes[OWN] = ownIndex({ page: RUNS, powers: ALL, from: { pubkey: PUB, lineage: 'card' } })
    expect(await new EntranceScoutService().check(deps([]))).toEqual([])
  })

  it('with a recorded head, a later stamp alone is not an update — the followed head must have moved', async () => {
    indexes[OWN] = ownIndex({ page: RUNS, powers: ALL, from: { ...FOLLOWED, pubkey: PUB, head } })
    expect(await new EntranceScoutService().check(deps([]))).toEqual([])
    indexes[OWN] = ownIndex({ page: RUNS, powers: ALL, from: { ...FOLLOWED, pubkey: PUB, head: 'f'.repeat(64) } })
    expect(await new EntranceScoutService().check(deps([]))).toEqual([expect.objectContaining({ offered: NEWER_PAGE, head })])
  })

  it('never writes — every request is a read, and nothing is signed', async () => {
    const scout = new EntranceScoutService()
    await scout.check(deps([]))
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.filter(r => r.method !== 'GET')).toEqual([])
  })
})

describe('readEntranceScents — read only', () => {
  it('reads each listed assessor\'s own signed pointer and the record it names, yours included', async () => {
    const record = encode({ kind: 'module-assessment', sandbox: 'card-door', root: RUNS, change: null, verdict: 'accept', note: 'f'.repeat(64), at: 5 })
    const recordSig = await sigOf(record)
    const other = 'e'.repeat(64)
    const roots: Record<string, Record<string, string>> = { [OWN]: { [`assess:${RUNS}`]: recordSig }, [other]: {} }
    const scents = await readEntranceScents(ZONE, RUNS, [OWN], {
      fetchText: async () => `${other}\nnot-a-key\n`,
      fetchIndex: async (_host: string, pubkey: string): Promise<HiveIndexResult> =>
        ({ ok: true, manifest: { roots: roots[pubkey] ?? {}, createdAt: 1, pubkey } }),
      bytes: async (_host: string, sig: string) => (sig === recordSig ? record : null),
    })
    expect(scents).toEqual([{ pubkey: OWN, verdict: 'accept', at: 5 }])
  })
})
