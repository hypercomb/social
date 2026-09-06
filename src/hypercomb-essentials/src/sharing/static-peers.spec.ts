// sharing/static-peers.spec.ts — a public host's creation is OFFERED, never folded.
//
// The swarm model for static content: a shaded tile at your top level, its
// children shaded from the publisher's layer as you walk in, each step the
// adopt. These pin the pure half: what an offer is, and how a route under an
// offered creation resolves to the publisher's tiles — through the meta
// envelopes every child slot holds since the Life write boundary.

import { describe, expect, it } from 'vitest'
import { mintMetaEnvelope } from '@hypercomb/core'
import {
  childEntriesOf, entryFor, layerAtRoute, offerFromCard, offersFromLegacyFollows, readThrough,
  type StaticPeersIo,
} from './static-peers.js'
import type { PublicationCard } from './publications-ledger.js'

const sig = (c: string) => c.repeat(64)
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))

/** A heap: sig → record. Envelopes are minted the way the writer mints them. */
const heap = (records: Record<string, unknown>): StaticPeersIo => ({
  bytes: async (s) => (s in records ? enc(records[s]) : null),
})
const envelope = (layer: string, slot: number) => mintMetaEnvelope({ layer, relation: 'children', slot })
const propsEnvelope = (resource: string) => mintMetaEnvelope({ resource, relation: 'properties', slot: 0 })

const card = (over: Partial<PublicationCard> = {}): PublicationCard => ({
  host: 'revolucion.pluginthematrix.com', url: 'https://revolucion.pluginthematrix.com/',
  title: 'Revolución', lineage: 'revolucion', publisherLabel: 'Jaime',
  pubkey: sig('e'), head: sig('a'), publishedAt: 1,
  hosts: [{ host: 'revolucion.pluginthematrix.com', url: 'https://revolucion.pluginthematrix.com/', primary: true, implicit: false }],
  ...over,
})

describe('offerFromCard', () => {
  it('names the tile by the last segment of the publisher’s route and keeps every door', () => {
    const offer = offerFromCard(card({ lineage: 'revolucion/meetup', hosts: [
      { host: 'meetup.pluginthematrix.com', url: 'x', primary: true, implicit: false },
      { host: 'meetup.hypercomb.com', url: 'y', primary: false, implicit: true },
    ] }))
    expect(offer).toMatchObject({
      name: 'meetup', pubkey: sig('e'), head: sig('a'), lineageKey: 'revolucion/meetup',
      segments: ['revolucion', 'meetup'], hosts: ['meetup.pluginthematrix.com', 'meetup.hypercomb.com'],
    })
  })

  it('refuses a plate with no verified head or key', () => {
    expect(offerFromCard(card({ head: '' }))).toBeNull()
    expect(offerFromCard(card({ pubkey: 'nope' }))).toBeNull()
  })
})

describe('the walk through envelopes', () => {
  const HEAD = sig('a'), ENV1 = sig('1'), ENV2 = sig('2'), KID1 = sig('b'), KID2 = sig('c')
  const PENV = sig('3'), PROPS = sig('d'), IMG = sig('f'), GRANDKID = sig('9'), GENV = sig('8')
  const io = heap({
    [HEAD]: { name: 'revolucion', children: [ENV1, ENV2] },
    [ENV1]: envelope(KID1, 0),
    [ENV2]: envelope(KID2, 1),
    [KID1]: { name: 'cigars', children: [GENV], properties: [PENV] },
    [KID2]: { name: 'humidor', children: [] },
    [PENV]: propsEnvelope(PROPS),
    [PROPS]: { index: 4, imageSig: IMG },
    [GENV]: envelope(GRANDKID, 0),
    [GRANDKID]: { name: 'cohiba', children: [] },
  })

  it('readThrough lands on the TARGET, and reports the target sig — never the envelope', async () => {
    const hit = await readThrough(ENV1, io)
    expect(hit?.sig).toBe(KID1)
    expect(hit?.record['name']).toBe('cigars')
  })

  it('children become peer entries carrying the tile’s own layer sig and its visual', async () => {
    const root = (await readThrough(HEAD, io))!
    const kids = await childEntriesOf(root.record, sig('e'), io)
    expect(kids).toEqual([
      { name: 'cigars', peerPubkey: sig('e'), layerSig: KID1, imageSig: IMG, index: 4, hasChildren: true },
      { name: 'humidor', peerPubkey: sig('e'), layerSig: KID2, hasChildren: false },
    ])
  })

  it('a route walks by name to the publisher’s layer standing there', async () => {
    const here = await layerAtRoute(HEAD, ['cigars'], io)
    expect(here?.sig).toBe(KID1)
    const deeper = await childEntriesOf(here!.layer, sig('e'), io)
    expect(deeper.map(e => e.name)).toEqual(['cohiba'])
    expect(await layerAtRoute(HEAD, ['nowhere'], io)).toBeNull()
  })

  it('a missing byte anywhere on the hop is a null, never a guess', async () => {
    const holed = heap({ [HEAD]: { name: 'r', children: [ENV1] }, [ENV1]: envelope(KID1, 0) })
    expect(await childEntriesOf((await readThrough(HEAD, holed))!.record, sig('e'), holed)).toEqual([])
    expect(await entryFor(KID1, { name: '' }, sig('e'), holed)).toBeNull()
  })
})

describe('legacy follows become offers', () => {
  it('one offer per followed root, head unknown until the index is read; malformed records dropped', () => {
    const offers = offersFromLegacyFollows({
      revolucion: { pubkey: sig('e'), hosts: ['Revolucion.pluginthematrix.com'], lineageKey: 'revolucion' },
      meetup: { pubkey: sig('e'), hosts: ['meetup.pluginthematrix.com'], lineageKey: 'revolucion/meetup' },
      broken: { pubkey: 'nope', hosts: [], lineageKey: '' },
    })
    expect(offers).toEqual([
      { name: 'revolucion', pubkey: sig('e'), hosts: ['revolucion.pluginthematrix.com'], lineageKey: 'revolucion', segments: ['revolucion'], head: '' },
      { name: 'meetup', pubkey: sig('e'), hosts: ['meetup.pluginthematrix.com'], lineageKey: 'revolucion/meetup', segments: ['revolucion', 'meetup'], head: '' },
    ])
    expect(offersFromLegacyFollows(null)).toEqual([])
  })
})
