// diamondcoreprocessor.com/sharing/peer-images.ts
//
// "Everybody brings their own image for the tile."
//
// In a swarm the same tile is published by several participants, and each
// publisher inlines THEIR OWN image pointer in the visual they broadcast
// (`imageSig` / `small.image` / `flat.small.image` / `point.image` — the
// closed set the visual-sanitizer lets through). Today the render picks ONE
// of them (freshest publisher wins) and only for a tile you do not hold
// yourself; every other version is on the wire and invisible.
//
// This module turns that wire traffic into a CHOICE. The synchronous read is
// scoped to the live swarm signature (needed by the hover affordance). The
// chooser probes the HIVE ROOT for the fixed-name pool and unions the current
// lineage as a compatibility witness while older participants migrate.
//
// POINTERS ONLY. Nothing here fetches bytes, writes a layer, or touches
// OPFS — a candidate is a set of signatures plus who is publishing them.
// Pulling the bytes and committing a pick is the picker's job, on an
// explicit gesture. Reading this file can never move a byte of anyone's hive.

import { SignatureService } from '@hypercomb/core'

const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
const STORE_KEY = '@hypercomb.social/Store'
const SIG_RE = /^[0-9a-f]{64}$/
const MAX_POOL_MEMBERS = 256

/** The image-bearing fields of a peer visual — the ONLY keys copied when a
 *  candidate is applied. Everything else a peer publishes (index, tags,
 *  link, …) is theirs, not part of "which picture". */
export type PeerImageProps = {
  imageSig?: string
  small?: { image: string }
  flat?: { small: { image: string } }
  point?: { image: string }
}

export type PeerImageCandidate = {
  /** Signature to PREVIEW — the point-top hex thumbnail when the publisher
   *  sent one, otherwise whatever image pointer they did send. */
  previewSig: string
  /** The image pointers to write when this candidate is chosen. */
  props: PeerImageProps
  /** Participants publishing exactly this image, freshest first. `label` is
   *  the peer's chosen display name; '' when they haven't announced one. */
  peers: readonly { pubkey: string; label: string }[]
}

type SwarmLike = {
  peerTilesAtCurrentSig?: () => readonly ({ name: string; peerPubkey: string } & Record<string, unknown>)[]
  peerTilesAtSig?: (sig: string) => readonly ({ name: string; peerPubkey: string } & Record<string, unknown>)[]
  composeSigForSegments?: (segments: readonly string[]) => Promise<string>
  primePeerTilesAt?: (sig: string, opts?: { force?: boolean }) => Promise<void>
  labelFor?: (pubkey: string) => string
}

const swarm = (): SwarmLike | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(SWARM_KEY) as SwarmLike | undefined

type StoreLike = { getResource?: (sig: string) => Promise<Blob | null> }
type BrokerLike = { knownContentHosts?: () => readonly string[] }

const ioc = (key: string): unknown =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key)

const hostUrl = (host: string): string =>
  `${/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host) ? 'http' : 'https'}://${host}`

const poolMembers = (value: unknown): string[] => {
  const raw = Array.isArray(value)
    ? value
    : Array.isArray((value as { members?: unknown })?.members)
      ? (value as { members: unknown[] }).members
      : []
  return raw.map(String).map(value => value.trim().toLowerCase())
    .filter(value => SIG_RE.test(value)).slice(0, MAX_POOL_MEMBERS)
}

/** Ask every known server for sign(name), then resolve its canonical variant
 * records through the normal verified content broker. The pool index is the
 * discovery document; every member/layer/property/image byte remains
 * signature-addressed and SHA-gated by Store.getResource. */
const meaningPoolImageCandidates = async (name: string): Promise<readonly PeerImageCandidate[]> => {
  const broker = ioc(BROKER_KEY) as BrokerLike | undefined
  const store = ioc(STORE_KEY) as StoreLike | undefined
  if (!store?.getResource) return []
  const hosts = broker?.knownContentHosts?.() ?? []
  if (!hosts.length) return []

  const address = await SignatureService.sign(
    new TextEncoder().encode(name).buffer as ArrayBuffer,
  )
  const membersByHost = new Map<string, string[]>()
  await Promise.all(hosts.map(async host => {
    try {
      const response = await fetch(`${hostUrl(host)}/${address}`, {
        cache: 'no-cache',
        signal: AbortSignal.timeout(2_500),
      })
      if (!response.ok) return
      const members = poolMembers(await response.json())
      if (members.length) membersByHost.set(host, members)
    } catch { /* this server has no pool for the name */ }
  }))

  const candidates: PeerImageCandidate[] = []
  for (const [host, members] of membersByHost) {
    for (const recordSig of members) {
      try {
        const recordBlob = await store.getResource(recordSig)
        if (!recordBlob) continue
        const record = JSON.parse(await recordBlob.text()) as Record<string, unknown>
        const layerSig = sig((record['payload'] as Record<string, unknown> | undefined)?.['layerSig'])
        if (!layerSig) continue
        const layerBlob = await store.getResource(layerSig)
        if (!layerBlob) continue
        const layer = JSON.parse(await layerBlob.text()) as Record<string, unknown>
        const propsSig = Array.isArray(layer['properties']) ? sig(layer['properties'][0]) : undefined
        if (!propsSig) continue
        const propsBlob = await store.getResource(propsSig)
        if (!propsBlob) continue
        const props = imagePropsOf(JSON.parse(await propsBlob.text()) as Record<string, unknown>)
        if (!props) continue
        const previewSig = previewSigOf(props)
        if (!previewSig) continue
        candidates.push({
          previewSig,
          props,
          peers: [{ pubkey: host, label: host }],
        })
      } catch { /* malformed or incomplete variant — skip only this member */ }
    }
  }
  return mergeCandidates(candidates)
}

const sig = (value: unknown): string | undefined =>
  typeof value === 'string' && SIG_RE.test(value) ? value : undefined

const nested = (bag: unknown, key: string): string | undefined =>
  sig((bag as Record<string, unknown> | undefined)?.[key])

/** Extract the image pointers from one peer visual. Returns undefined when
 *  the publisher has no image on this tile — a label-only tile is not a
 *  candidate, it is an absence. */
export const imagePropsOf = (visual: Record<string, unknown>): PeerImageProps | undefined => {
  const props: PeerImageProps = {}
  const direct = sig(visual['imageSig'])
  if (direct) props.imageSig = direct
  const small = nested(visual['small'], 'image')
  if (small) props.small = { image: small }
  const flatSmall = nested((visual['flat'] as Record<string, unknown> | undefined)?.['small'], 'image')
  if (flatSmall) props.flat = { small: { image: flatSmall } }
  const point = nested(visual['point'], 'image')
  if (point) props.point = { image: point }
  return props.imageSig || props.small || props.flat || props.point ? props : undefined
}

/** The signature a picker should paint for these pointers: the point-top
 *  thumbnail the app draws by default, then the flat-top variant, then the
 *  bare pointer. */
export const previewSigOf = (props: PeerImageProps): string =>
  props.small?.image ?? props.point?.image ?? props.flat?.small.image ?? props.imageSig ?? ''

/** Identity of a candidate — two peers who carry the same picture are ONE
 *  choice with two names on it, not two identical hexagons. */
const candidateKey = (props: PeerImageProps): string =>
  [props.small?.image ?? '', props.flat?.small.image ?? '', props.point?.image ?? '', props.imageSig ?? ''].join('|')

const candidatesFrom = (
  name: string,
  tiles: readonly ({ name: string; peerPubkey: string } & Record<string, unknown>)[],
  labelFor?: (pubkey: string) => string,
): readonly PeerImageCandidate[] => {
  const byImage = new Map<string, PeerImageCandidate>()
  for (const tile of tiles) {
    if (tile.name !== name) continue
    const props = imagePropsOf(tile)
    if (!props) continue
    const preview = previewSigOf(props)
    if (!preview) continue
    const key = candidateKey(props)
    const peer = { pubkey: tile.peerPubkey, label: labelFor?.(tile.peerPubkey) ?? '' }
    const existing = byImage.get(key)
    if (existing) {
      if (!existing.peers.some(p => p.pubkey === peer.pubkey)) {
        (existing.peers as { pubkey: string; label: string }[]).push(peer)
      }
      continue
    }
    byImage.set(key, { previewSig: preview, props, peers: [peer] })
  }
  return [...byImage.values()]
}

/** Union candidate projections without losing publisher provenance. Root
 *  variants come first; live-lineage witnesses fill migration gaps. */
const mergeCandidates = (
  ...bags: (readonly PeerImageCandidate[])[]
): readonly PeerImageCandidate[] => {
  const merged = new Map<string, PeerImageCandidate>()
  for (const bag of bags) {
    for (const candidate of bag) {
      const key = candidateKey(candidate.props)
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, { ...candidate, peers: [...candidate.peers] })
        continue
      }
      const peers = existing.peers as { pubkey: string; label: string }[]
      for (const peer of candidate.peers) {
        if (!peers.some(p => p.pubkey === peer.pubkey)) peers.push(peer)
      }
    }
  }
  return [...merged.values()]
}

/**
 * Every distinct image the swarm is offering for `label` at the live
 * signature. This remains the synchronous overlay evidence check.
 */
export const peerImageCandidates = (label: string): readonly PeerImageCandidate[] => {
  const name = String(label ?? '').trim()
  if (!name) return []
  const drone = swarm()
  if (!drone?.peerTilesAtCurrentSig) return []
  try { return candidatesFrom(name, drone.peerTilesAtCurrentSig(), drone.labelFor) }
  catch { return [] }
}

/**
 * Every distinct image published for the fixed name at the canonical root,
 * plus current-lineage witnesses that have not reached that root yet. An
 * explicit chooser gesture forces the root probe; older swarm implementations
 * fall back to the live location instead of making the chooser unusable.
 */
export const canonicalPeerImageCandidates = async (
  label: string,
): Promise<readonly PeerImageCandidate[]> => {
  const name = String(label ?? '').trim()
  if (!name) return []
  const pooled = meaningPoolImageCandidates(name)
  const drone = swarm()
  if (!drone) return await pooled
  if (!drone.composeSigForSegments || !drone.peerTilesAtSig) {
    return mergeCandidates(await pooled, peerImageCandidates(name))
  }

  try {
    const rootSig = await drone.composeSigForSegments([])
    if (!rootSig) return peerImageCandidates(name)
    await drone.primePeerTilesAt?.(rootSig, { force: true })
    const canonical = candidatesFrom(name, drone.peerTilesAtSig(rootSig), drone.labelFor)
    const live = drone.peerTilesAtCurrentSig
      ? candidatesFrom(name, drone.peerTilesAtCurrentSig(), drone.labelFor)
      : []
    return mergeCandidates(await pooled, canonical, live)
  } catch { return mergeCandidates(await pooled, peerImageCandidates(name)) }
}

/** Sync predicate for the overlay's `visibleWhen`: is there another version
 *  of this tile's picture in the room? */
export const hasPeerImages = (label: string, tileAlreadyHasImage = false): boolean => {
  const offered = peerImageCandidates(label).length
  // The affordance represents a choice, never merely the existence of one
  // picture. A dressed local tile plus one offered picture is already two.
  return offered > 1 || (tileAlreadyHasImage && offered > 0)
}
