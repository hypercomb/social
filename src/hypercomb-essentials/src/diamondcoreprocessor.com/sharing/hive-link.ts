// diamondcoreprocessor.com/sharing/hive-link.ts
//
// The signature-addressed "static hive" link bundle.
//
// A statically-hosted hive is flat sig-named bytes on one or more hosts plus
// ONE mutable, publisher-signed index (`GET /hive/<pubkey>` — kind 30564)
// mapping public lineage keys to their current head sigs. To hand someone
// that hive we package the STABLE coordinates — the publisher's pubkey, the
// byte hosts, and the branch's path segments — into a content-addressed JSON
// resource, exactly like a meeting invite. Sharing the resource's signature
// as `https://<app-origin>/<sig>` gives a link that never goes stale: the
// head is NOT in the bundle; the recipient resolves "now" from the signed
// index and verifies it against the pinned pubkey, so any host can withhold
// the hive but never substitute it.
//
// `rootSig` is an optional mint-time hint: the head at the moment the link
// was minted, used only when the index cannot be fetched (cold KV, dead
// host). It may be stale by design — the closure under an old head stays
// hosted forever (content-addressed, never deleted).
//
// This module holds ONLY pure data + validation so the receive-side worker,
// the visitor drone, and the /host queen can import it without pulling in
// any runtime. It imports nothing.

export const HIVE_LINK_KIND = 'hypercomb.hive-link'
export const HIVE_LINK_VERSION = 1

/** Nostr event kind of the publisher-signed hive index (the mutable
 *  path→head pointer served at `/hive/<pubkey>`). Parameterized-replaceable
 *  range: latest created_at wins, monotonicity enforced by the host. */
export const HIVE_INDEX_EVENT_KIND = 30564

/** localStorage key recording which adopted roots follow a static
 *  publisher: `{ "<rootName>": { pubkey, hosts, lineageKey } }`.
 *  Participant-local — like hc:adopted-roots, never folded into lineage. */
export const STATIC_FOLLOWS_KEY = 'hc:static-follows'

/** The standing public content endpoint (Blossom worker over R2 —
 *  documentation/public-content-endpoint.md). Seeded as a byte source for
 *  link-bundle resolution so a fresh visitor on ANY origin can fetch a
 *  bundle minted to the public CDN — private mode, no relay flags. Same
 *  standing host HostSyncService drains public closures to. */
export const PUBLIC_CONTENT_HOSTS = ['content.jwize.com']

export interface HiveLinkBundle {
  kind: typeof HIVE_LINK_KIND
  /** Schema version — informational; older readers tolerate unknown extras. */
  v: number
  /** The publisher's path segments for the shared branch. Folded through
   *  lineageKey() they name the entry in the publisher's hive index. */
  segments: string[]
  /** Publisher pubkey (64-hex). Pins index verification end-to-end. */
  pubkey: string
  /** Byte hosts holding the closure + serving `/hive/<pubkey>`. Ordered by
   *  preference; entries are bare domains (no scheme). */
  hosts: string[]
  /** Optional mint-time head hint — fallback when the index is unreachable. */
  rootSig?: string
  /** Epoch ms the link was minted (informational only). */
  createdAt?: number
}

const SIG_RE = /^[a-f0-9]{64}$/
// Segments are single path components — reject anything carrying a slash so a
// malformed bundle can't smuggle extra path depth into navigation.
const SLASH_RE = /[\/\\]/
// Bare domain (or loopback host:port for dev). No scheme, no path — the
// consumer picks the scheme by the loopback rule.
const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/i

/** Structural validation — returns a normalized bundle or null. Never throws. */
export function validateHiveLinkBundle(raw: unknown): HiveLinkBundle | null {
  if (!raw || typeof raw !== 'object') return null
  // Bracket access throughout — the web/dev Angular build runs
  // noPropertyAccessFromIndexSignature, which forbids dot access on a Record.
  const o = raw as Record<string, unknown>
  if (o['kind'] !== HIVE_LINK_KIND) return null

  const pubkey = String(o['pubkey'] ?? '').trim().toLowerCase()
  if (!SIG_RE.test(pubkey)) return null

  const rawSegments = o['segments']
  const segments = Array.isArray(rawSegments)
    ? rawSegments
        .map(s => String(s ?? '').trim())
        .filter(s => s.length > 0 && !SLASH_RE.test(s))
    : []
  if (segments.length === 0) return null

  const rawHosts = o['hosts']
  const hosts = Array.isArray(rawHosts)
    ? rawHosts
        .map(h => String(h ?? '').trim().toLowerCase())
        .filter(h => h.length > 0 && HOST_RE.test(h))
    : []
  if (hosts.length === 0) return null

  const vRaw = o['v']
  const v = typeof vRaw === 'number' ? vRaw : HIVE_LINK_VERSION
  const rootSigRaw = String(o['rootSig'] ?? '').trim().toLowerCase()
  const rootSig = SIG_RE.test(rootSigRaw) ? rootSigRaw : undefined
  const createdAtRaw = o['createdAt']
  const createdAt = typeof createdAtRaw === 'number' ? createdAtRaw : undefined

  return {
    kind: HIVE_LINK_KIND,
    v,
    segments,
    pubkey,
    hosts,
    ...(rootSig ? { rootSig } : {}),
    ...(createdAt ? { createdAt } : {}),
  }
}

/** Canonical bytes for the bundle. Stable key order → stable signature, so
 *  the same (segments, pubkey, hosts) always content-addresses to the same
 *  sig — re-hosting the same branch re-mints the same link. `createdAt` is
 *  deliberately EXCLUDED from the canonical bytes for that reason, and
 *  `rootSig` is included only because it rides the mint; callers wanting a
 *  maximally stable link omit it. */
export function encodeHiveLinkBundle(b: HiveLinkBundle): Blob {
  const ordered = {
    kind: b.kind,
    v: b.v,
    segments: b.segments,
    pubkey: b.pubkey,
    hosts: b.hosts,
    ...(b.rootSig ? { rootSig: b.rootSig } : {}),
  }
  return new Blob([JSON.stringify(ordered)], { type: 'application/json' })
}
