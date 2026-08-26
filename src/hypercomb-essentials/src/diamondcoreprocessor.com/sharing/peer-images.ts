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
// This module turns that wire traffic into a CHOICE. The legacy synchronous
// read is scoped to the live swarm signature (needed by the hover affordance).
// The canonical read composes the HIVE ROOT signature and gathers the fixed
// name there: a portal at /project/people and the root /people therefore open
// the same image pool, independent of where either was discovered.
//
// POINTERS ONLY. Nothing here fetches bytes, writes a layer, or touches
// OPFS — a candidate is a set of signatures plus who is publishing them.
// Pulling the bytes and committing a pick is the picker's job, on an
// explicit gesture. Reading this file can never move a byte of anyone's hive.

const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const SIG_RE = /^[0-9a-f]{64}$/

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

/**
 * Every distinct image the swarm is offering for `label` at the live
 * signature, freshest publisher first (the order `peerTilesAtSig` walks).
 * This remains the synchronous overlay evidence check. The Image Hive itself
 * uses {@link canonicalPeerImageCandidates}.
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
 * Every distinct image published for the fixed name at the canonical hive
 * root. An explicit chooser gesture forces one witness probe first, so the
 * result does not depend on whether the participant happened to visit `/`
 * earlier in the session. Older swarm implementations fall back to the live
 * location read instead of making the chooser unusable.
 */
export const canonicalPeerImageCandidates = async (
  label: string,
): Promise<readonly PeerImageCandidate[]> => {
  const name = String(label ?? '').trim()
  if (!name) return []
  const drone = swarm()
  if (!drone) return []
  if (!drone.composeSigForSegments || !drone.peerTilesAtSig) return peerImageCandidates(name)

  try {
    const rootSig = await drone.composeSigForSegments([])
    if (!rootSig) return []
    await drone.primePeerTilesAt?.(rootSig, { force: true })
    return candidatesFrom(name, drone.peerTilesAtSig(rootSig), drone.labelFor)
  } catch { return [] }
}

/** Sync predicate for the overlay's `visibleWhen`: is there another version
 *  of this tile's picture in the room? */
export const hasPeerImages = (label: string): boolean => peerImageCandidates(label).length > 0
