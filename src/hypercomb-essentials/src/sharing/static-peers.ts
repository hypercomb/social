// sharing/static-peers.ts
//
// STATIC PEERS — the swarm's model for public hosts.
//
// Jaime, 2026-09-06: "Adopt is identical to a swarm: they're shaded by
// default and as you navigate through them you adopt them. We're not adding
// branch adoption by default because we want to dissuade people from
// mindlessly adding stuff to their hive. Every action is a step towards your
// permanence, your desires, your hive."
//
// So a creation a public host publishes is OFFERED, never folded: it renders
// as a shaded tile exactly where a swarm peer's would — at the top level of
// your hive — and the first click takes THAT tile, the second click walks in,
// its children render shaded from the publisher's layer, and each step you
// take is the adopt (visit-driven adoption, swarm-adopt.drone.ts). The swarm
// feeds that machinery from relay events; this feeds it from the publisher's
// SIGNED INDEX and the bytes their hosts serve. Same tile kind (`peer`), same
// wand, same fold, same records.
//
// This module is the pure half: what an offer is, and how a location under
// an offered creation resolves to the publisher's tiles. Everything that
// touches the store, the broker or the network comes in through `io`, so the
// walk is testable with maps.

import { isMetaEnvelope, metaPayloadOf } from '@hypercomb/core'
import type { PublicationCard } from './publications-ledger.js'
import { recoverableTileImageSig } from '../editor/tile-properties.js'

const SIG_RE = /^[a-f0-9]{64}$/

/** A creation somebody publishes that you have asked to see in your hive. */
export interface StaticOffer {
  /** The tile's name at your top level — the last segment of the
   *  publisher's route, exactly as a participant hive-link mounts. */
  readonly name: string
  /** The publisher whose signed index names the head. */
  readonly pubkey: string
  /** Byte hosts, primary first — where the index and the closure live. */
  readonly hosts: readonly string[]
  /** The key in the publisher's index (`lineageKey` of their route). */
  readonly lineageKey: string
  /** The publisher's own route to the creation. */
  readonly segments: readonly string[]
  /** The verified head the last time the index was read. */
  readonly head: string
}

/** A plate on the community page, as an offer. */
export const offerFromCard = (card: PublicationCard): StaticOffer | null => {
  const segments = card.lineage.split('/').map(s => s.trim()).filter(Boolean)
  const name = segments[segments.length - 1] ?? ''
  const pubkey = String(card.pubkey ?? '').toLowerCase()
  const head = String(card.head ?? '').toLowerCase()
  if (!name || !SIG_RE.test(pubkey) || !SIG_RE.test(head)) return null
  const hosts = card.hosts.map(d => d.host.toLowerCase()).filter(Boolean)
  if (hosts.length === 0) return null
  return { name, pubkey, hosts, lineageKey: card.lineage, segments, head }
}

/** One of the publisher's tiles, as the wand and the renderer want it: the
 *  same fields a swarm peer tile carries (`peerPubkey`, `layerSig`, and the
 *  visual props that travel on a take). */
export interface StaticPeerEntry {
  readonly name: string
  readonly peerPubkey: string
  /** The tile's own layer — the envelope's TARGET, never the envelope. */
  readonly layerSig: string
  readonly imageSig?: string
  readonly index?: number
  /** Does the publisher's layer hold children? A TAKEN tile is childless
   *  locally (the take is one level), but if the publisher's inside exists
   *  the tile is a BRANCH: walking in is how the inside arrives, shaded. */
  readonly hasChildren: boolean
}

/** A layer as the walk reads it. */
export interface StaticLayer {
  readonly name?: unknown
  readonly children?: unknown
  readonly cells?: unknown
  readonly properties?: unknown
}

export interface StaticPeersIo {
  /** Bytes of a sig-named record (a layer, an envelope, a props blob). */
  readonly bytes: (sig: string) => Promise<Uint8Array | null>
}

const decode = (bytes: Uint8Array): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
  } catch { return null }
}

/** Read a record by sig, stepping THROUGH a meta envelope to its target.
 *  Returns the target's sig with it, because the fold wants the tile's own
 *  layer sig, not the edge that named it. */
export const readThrough = async (
  sig: string,
  io: StaticPeersIo,
  hops = 4,
): Promise<{ sig: string; record: Record<string, unknown> } | null> => {
  let current = String(sig ?? '').toLowerCase()
  for (let i = 0; i <= hops; i++) {
    if (!SIG_RE.test(current)) return null
    const bytes = await io.bytes(current)
    if (!bytes) return null
    const record = decode(bytes)
    if (!record) return null
    if (!isMetaEnvelope(record)) return { sig: current, record }
    const payload = metaPayloadOf(record)
    if (!payload || !SIG_RE.test(String(payload.sig ?? ''))) return null
    current = String(payload.sig).toLowerCase()
  }
  return null
}

const childSigsOf = (layer: StaticLayer): string[] => {
  const pick = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(x => String(x ?? '').toLowerCase()).filter(s => SIG_RE.test(s)) : []
  const cells = pick(layer.cells)
  return cells.length ? cells : pick(layer.children)
}

/** The publisher's tile-properties for a layer: `properties[0]`, read
 *  through its envelope. Null when the layer carries none. */
export const propsOf = async (layer: StaticLayer, io: StaticPeersIo): Promise<Record<string, unknown> | null> => {
  const slot = Array.isArray(layer.properties) ? layer.properties : []
  const ref = String(slot[0] ?? '').toLowerCase()
  if (!SIG_RE.test(ref)) return null
  return (await readThrough(ref, io))?.record ?? null
}

/** The entry a peer tile becomes: name from the layer, visual from its props. */
export const entryFor = async (
  layerSig: string,
  layer: StaticLayer,
  pubkey: string,
  io: StaticPeersIo,
): Promise<StaticPeerEntry | null> => {
  const name = typeof layer.name === 'string' ? layer.name.trim() : ''
  if (!name) return null
  const props = await propsOf(layer, io)
  const imageSig = props ? recoverableTileImageSig(props) : undefined
  const index = props && typeof props['index'] === 'number' && Number.isFinite(props['index']) ? props['index'] as number : undefined
  return {
    name, peerPubkey: pubkey, layerSig,
    ...(imageSig ? { imageSig } : {}),
    ...(index !== undefined ? { index } : {}),
    hasChildren: childSigsOf(layer).length > 0,
  }
}

/** The publisher's children at a layer, as peer entries, in slot order. */
export const childEntriesOf = async (
  layer: StaticLayer,
  pubkey: string,
  io: StaticPeersIo,
): Promise<StaticPeerEntry[]> => {
  const out: StaticPeerEntry[] = []
  for (const ref of childSigsOf(layer)) {
    const hit = await readThrough(ref, io)
    if (!hit) continue
    const entry = await entryFor(hit.sig, hit.record as StaticLayer, pubkey, io)
    if (entry) out.push(entry)
  }
  return out
}

/** Walk from a head down a route of names, through envelopes, to the layer
 *  standing there — or null when any hop is missing or unresolvable. */
export const layerAtRoute = async (
  headSig: string,
  route: readonly string[],
  io: StaticPeersIo,
): Promise<{ sig: string; layer: StaticLayer } | null> => {
  let here = await readThrough(headSig, io)
  if (!here) return null
  for (const step of route) {
    const want = String(step ?? '').trim()
    let next: { sig: string; record: Record<string, unknown> } | null = null
    for (const ref of childSigsOf(here.record as StaticLayer)) {
      const hit = await readThrough(ref, io)
      if (hit && typeof hit.record['name'] === 'string' && hit.record['name'].trim() === want) { next = hit; break }
    }
    if (!next) return null
    here = next
  }
  return { sig: here.sig, layer: here.record as StaticLayer }
}
