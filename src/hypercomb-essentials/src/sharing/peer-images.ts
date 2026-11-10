// sharing/peer-images.ts
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

import { fetchHiveIndex } from './hive-pointer.js'
import { layerProps, picturesKey, picturesPoolAddress } from './picture-pools.js'
import { askPoolListing } from './pool-listing.js'

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
  /** The publisher's full picture, carried ONLY when it is the one pointer they
   *  sent — a tile that wears a picture straight from the wall, or one dropped
   *  before its thumbnails were cut, has `large` alone. */
  large?: { image: string }
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

// A scan (the badge, the images button) looks at every visible name. It asks
// only a host that has already answered a pool. Asking every learned
// publisher for a name that is not there is one console 404 per host, on
// every hive load. Choosing a picture still asks every host for that one
// name, and a host that answers joins later scans.
const POOL_SCAN_QUIET_MS = 5 * 60_000
const poolPublishers = new Set<string>()
const poolQuietUntil = new Map<string, number>()
const poolTail = new Map<string, Promise<void>>()

const poolQuiet = (host: string): boolean => {
  if (poolPublishers.has(host)) return false
  const until = poolQuietUntil.get(host) ?? 0
  if (until > Date.now()) return true
  if (until) poolQuietUntil.delete(host)
  return false
}

const notePoolMiss = (host: string): void => {
  if (!host || poolPublishers.has(host)) return
  poolQuietUntil.set(host, Date.now() + POOL_SCAN_QUIET_MS)
}

const afterPool = (host: string, job: () => Promise<void>): Promise<void> => {
  const next = (poolTail.get(host) ?? Promise.resolve()).then(job, job)
  poolTail.set(host, next)
  return next
}

/** Ask known hosts who offers a picture for this name, then read each one's
 *  word from their OWN signed index (pools-across-hosts.md, "What a host
 *  adds"). A tile's name pool is never listed by a host; a publisher names
 *  the picture in their index as `pictures:<sign(name)>` → the tile's own
 *  layer, and the host lists the keys that did at sign('pictures:<sign(name)>').
 *  Membership is never trusted on its own: a key whose index no longer names
 *  the entry is not counted, and every layer, properties and image byte is
 *  signature-addressed and SHA-gated by Store.getResource.
 *
 * `choose` is one name the participant opened — every host is asked.
 * `scan` is the badge walking the visible hive. It asks only hosts that
 * have already answered a pool, so a load does not 404 the whole list. */
export const meaningPoolImageCandidates = async (
  name: string,
  mode: 'scan' | 'choose' = 'choose',
): Promise<readonly PeerImageCandidate[]> => {
  const broker = ioc(BROKER_KEY) as BrokerLike | undefined
  const store = ioc(STORE_KEY) as StoreLike | undefined
  if (!store?.getResource) return []
  const known = broker?.knownContentHosts?.() ?? []
  const hosts = mode === 'scan' ? known.filter(host => poolPublishers.has(host)) : known
  if (!hosts.length) return []

  const key = await picturesKey(name)
  const address = key ? await picturesPoolAddress(name) : null
  if (!key || !address) return []
  const publishersByHost = new Map<string, string[]>()
  const ask = async (host: string): Promise<void> => {
    if (mode === 'scan' && poolQuiet(host)) return
    // Asked the one quiet way (pool-listing.ts): a host with no pool for this
    // name says so without a console error, and is not asked again for a while.
    const said = await askPoolListing(hostUrl(host), address, { timeoutMs: 2_500 })
    if (said.state !== 'listed') { notePoolMiss(host); return }
    const publishers = listedNames(said.text)
    poolPublishers.add(host)
    poolQuietUntil.delete(host)
    if (publishers.length) publishersByHost.set(host, publishers)
  }
  await Promise.all(hosts.map(host => mode === 'scan' ? afterPool(host, () => ask(host)) : ask(host)))

  const readJson = async (signature: string): Promise<Record<string, unknown> | null> => {
    const blob = await store.getResource!(signature)
    if (!blob) return null
    try { return JSON.parse(await blob.text()) as Record<string, unknown> } catch { return null }
  }
  const candidates: PeerImageCandidate[] = []
  for (const [host, publishers] of publishersByHost) {
    for (const pubkey of publishers) {
      try {
        // Their own word, from their own signed index — never the listing's.
        const index = await fetchHiveIndex(host, pubkey)
        if (!index.ok) continue
        const layerSig = sig(index.manifest.roots?.[key])
        if (!layerSig) continue
        const layer = await readJson(layerSig)
        // Through the Life Primitive hop: a hive's properties are an envelope.
        const props = layer ? await layerProps(layer, readJson) : null
        const pointers = props ? imagePropsOf(props) : undefined
        const previewSig = pointers ? previewSigOf(pointers) : ''
        if (!pointers || !previewSig) continue
        candidates.push({ previewSig, props: pointers, peers: [{ pubkey, label: host }] })
      } catch { /* an unreadable index or layer — skip only this publisher */ }
    }
  }
  return mergeCandidates(candidates)
}

/** A host's pool listing: newline-separated entry names, each a key. */
const listedNames = (text: string): string[] =>
  text.split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(line => SIG_RE.test(line)).slice(0, MAX_POOL_MEMBERS)

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
  if (props.imageSig || props.small || props.flat || props.point) return props
  const large = nested(visual['large'], 'image')
  return large ? { large: { image: large } } : undefined
}

/** The signature a picker should paint for these pointers: the point-top
 *  thumbnail the app draws by default, then the flat-top variant, then the
 *  bare pointer. */
export const previewSigOf = (props: PeerImageProps): string =>
  props.small?.image ?? props.point?.image ?? props.flat?.small.image ?? props.imageSig ?? props.large?.image ?? ''

/** Identity of a candidate — two peers who carry the same picture are ONE
 *  choice with two names on it, not two identical hexagons. */
const candidateKey = (props: PeerImageProps): string =>
  [props.small?.image ?? '', props.flat?.small.image ?? '', props.point?.image ?? '', props.imageSig ?? '', props.large?.image ?? ''].join('|')

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
