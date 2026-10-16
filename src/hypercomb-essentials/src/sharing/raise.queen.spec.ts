// sharing/raise.queen.spec.ts — raise offers another publisher's creation even
// when a different one of the same name is offered, and walks to our own
// creation when the door table does not know it yet.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const seam = vi.hoisted(() => ({
  head: null as null | { head: string; pubkey: string; lineage: string; title: string; host: string; publishedAt: number },
  ledger: new Map<string, Map<string, { sealed: string; record: { segments: string[]; lineageKey: string; pubkey: string } }>>(),
}))

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

vi.mock('./link-acts.js', () => ({
  resolveLink: async (what: string) => ({ kind: 'address', address: `https://${what}` }),
  readLinkHead: async () => seam.head ?? { error: 'no-door' },
}))
vi.mock('./publish-heads.js', () => ({
  latestByLineageKey: async (pubkey?: string) => seam.ledger.get(String(pubkey)) ?? new Map(),
}))

import { EffectBus } from '@hypercomb/core'
import { RaiseQueenBee } from './raise.queen.js'
import type { StaticOffer } from './static-peers.js'

const ALICE = 'a'.repeat(64), BOB = 'b'.repeat(64), ME = 'c'.repeat(64)
const run = (args: string) => (new RaiseQueenBee() as unknown as { execute(a: string): Promise<void> }).execute(args)

let offers: StaticOffer[]
let walked: (readonly string[])[]
const emitted: StaticOffer[] = []
EffectBus.on<StaticOffer>('community:offer', o => { if (o) emitted.push(o) })

beforeEach(() => {
  offers = []
  walked = []
  emitted.length = 0
  seam.ledger.clear()
  ;(globalThis as unknown as { ioc: unknown }).ioc = {
    register: () => {},
    whenReady: () => {},
    get: (key: string) => key === '@hypercomb.social/Navigation' ? { goRaw: (s: readonly string[]) => walked.push(s) }
      : key === '@diamondcoreprocessor.com/StaticPeersDrone' ? { offers: () => offers }
      : undefined,
  }
})

describe('raise', () => {
  it('offers another publisher\'s creation that shares a name with one already offered', async () => {
    offers = [{ name: 'card', pubkey: ALICE, hosts: ['card.alice.com'], lineageKey: 'card', segments: ['card'], head: 'd'.repeat(64) }]
    seam.head = { head: 'e'.repeat(64), pubkey: BOB, lineage: 'card', title: 'Bob', host: 'card.bob.com', publishedAt: 1 }
    await run('card.bob.com')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ name: 'card', pubkey: BOB })
    expect(walked).toEqual([['card']])
  })

  it('does not offer the same creation twice', async () => {
    offers = [{ name: 'card', pubkey: ALICE, hosts: ['card.alice.com'], lineageKey: 'card', segments: ['card'], head: 'd'.repeat(64) }]
    seam.head = { head: 'd'.repeat(64), pubkey: ALICE, lineage: 'card', title: 'Alice', host: 'card.alice.com', publishedAt: 1 }
    await run('card.alice.com')
    expect(emitted).toHaveLength(0)
    expect(walked).toEqual([['card']])
  })

  it('walks to our own creation the door table does not know, never offering it', async () => {
    seam.ledger.set(ME, new Map([['business-card', { sealed: 'f'.repeat(64), record: { segments: ['Business Card'], lineageKey: 'business-card', pubkey: ME } }]]))
    seam.head = { head: 'f'.repeat(64), pubkey: ME, lineage: 'business-card', title: 'Business Card', host: 'business-card.jwize.com', publishedAt: 1 }
    await run('business-card.jwize.com')
    expect(emitted).toHaveLength(0)
    expect(walked).toEqual([['Business Card']])
  })
})
