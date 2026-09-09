// sharing/hive-link.ts
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

// ── Install channels (documentation/install-by-replication.md, steps 2+6) ──
//
// The package sentinel is NOT a second format: a domain's installable
// package (essentials bundle, module pack) is published as a root in the
// SAME kind-30564 index, under a reserved `install:<channel>` key, signed
// by the same publisher key and verified by the same fetchHiveIndex path.
// One index, one signature, one verification — sites and packages differ
// only in what the root sig names.
//
// Collision rule (the pool-meaning argument): lineageKey() folds every
// non-letter/number to `-`, so no site lineage can ever produce a key
// containing `:`. `install:`-prefixed keys are therefore reserved by
// construction — no allowlist needed, no census to drift.
//
// NARROWER THAN IT READS, stated exactly: canonicalizeLineageSegment falls
// back to the RAW segment when canonicalization empties it, so a tile named
// exactly `:` does produce a bare colon. The reservation is absolute only for
// a key carrying letters or digits on BOTH sides of the colon — which
// `install:<channel>` and `format:hive` both do, and a bare `:` prefix would
// not. Reserve accordingly.

export const INSTALL_CHANNEL_PREFIX = 'install:'

/** Index key for an install channel, e.g. installChannelKey('essentials')
 *  → 'install:essentials'. Channel names are single lowercase words. */
export function installChannelKey(channel: string): string {
  return `${INSTALL_CHANNEL_PREFIX}${channel.trim().toLowerCase()}`
}

/** The verified package root a hive index publishes for a channel, or null.
 *  Callers pass the `roots` of an ALREADY-VERIFIED index (fetchHiveIndex /
 *  the worker's verifiedIndex) — this helper adds no trust of its own. */
export function installRootOf(roots: Record<string, string>, channel: string): string | null {
  const sig = String(roots[installChannelKey(channel)] ?? '').trim().toLowerCase()
  return SIG_RE.test(sig) ? sig : null
}

// ── The hive FORMAT marker (documentation-free half: see hive-format.ts) ──
//
// A reserved roots key, for two reasons that are both hard constraints:
//
//   * The index cannot carry an extra TOP-LEVEL field. `putHiveManifest`
//     re-serializes `{ v, roots }` and its signature accepts only `roots`, so
//     anything else is erased by the very next publish from ANY client —
//     including an older one, which is precisely the silent divergence this
//     marker exists to prevent.
//   * A roots VALUE must be 64-hex or `fetchHiveIndex` rejects the WHOLE
//     index as malformed (and the host repeats the rule). So the version can
//     never be inlined; the key points at a content-addressed declaration.
//
// Same spelling as the pool meaning, deliberately: one word to remember, two
// places it means the same thing. The colon carries word characters on both
// sides, which is what makes the reservation hold — see the narrower
// statement of that rule below.

export const HIVE_FORMAT_ROOT_KEY = 'format:hive'

/** The format declaration a hive index publishes, or null. Callers pass the
 *  `roots` of an ALREADY-VERIFIED index — this helper adds no trust. */
export function formatRootOf(roots: Record<string, string>): string | null {
  const sig = String(roots[HIVE_FORMAT_ROOT_KEY] ?? '').trim().toLowerCase()
  return SIG_RE.test(sig) ? sig : null
}

// ── The signed VOCABULARY CLAIM (documentation/vocabulary-claim.md) ────────
//
// Same two hard constraints as `format:hive`, and for the same reasons: the
// index cannot carry an extra TOP-LEVEL field (the next publish from ANY
// client re-serializes `{v, roots}` and erases it), and a roots VALUE must be
// 64-hex or `fetchHiveIndex` rejects the WHOLE index as malformed — one bad
// value unpublishes every branch for every reader. So the vocabulary is a
// reserved KEY pointing at a content-addressed claim atom, never an inline
// word list.
//
// Same spelling as the pool meaning, deliberately, and it carries word
// characters on both sides of the colon — which is what makes the reservation
// hold.

export const VOCABULARY_ROOT_KEY = 'vocabulary:hive'

/** The signed vocabulary claim a hive index publishes, or null. Callers pass
 *  the `roots` of an ALREADY-VERIFIED index — this helper adds no trust. */
export function vocabularyRootOf(roots: Record<string, string>): string | null {
  const sig = String(roots[VOCABULARY_ROOT_KEY] ?? '').trim().toLowerCase()
  return SIG_RE.test(sig) ? sig : null
}

/**
 * ROOT KEYS THE BRIDGE MAY NEVER SET.
 *
 * `claude-bridge.worker.ts`'s `hive-root-set` op advances the participant's
 * SIGNED index with no participant gesture at all — an agent or a deploy
 * script drives it — and it refuses only COLON-LESS keys, precisely so it
 * cannot clobber a site lineage. Every reserved key is therefore remotely
 * settable by construction, which is fine for `install:<channel>` (that IS a
 * deploy stamp) and fatal for a vocabulary claim: publishing what words you
 * hold is something the PARTICIPANT does, or the whole scope model is a
 * decoration.
 *
 * INVERTED TO AN ALLOW-LIST. A deny-list is only ever as complete as the
 * last person who remembered it: `format:hive` was settable over the bridge
 * for the same reason `vocabulary:hive` had been, by omission. The rule is
 * now positive — the bridge may stamp `install:<channel>` and NOTHING else.
 * Every other reserved key is a participant act. The deny-list is kept as
 * the named examples, so a test can say why each one is refused.
 */
export const BRIDGE_FORBIDDEN_ROOT_KEYS: readonly string[] = Object.freeze([
  VOCABULARY_ROOT_KEY,
  HIVE_FORMAT_ROOT_KEY,
])

/** May the bridge's `hive-root-set` write this key? Only an install stamp. */
export const bridgeMaySetRootKey = (key: string): boolean => {
  const k = String(key ?? '').trim()
  if (!k.startsWith(INSTALL_CHANNEL_PREFIX)) return false
  return /^[a-z][a-z0-9-]*$/.test(k.slice(INSTALL_CHANNEL_PREFIX.length))
}

/** localStorage key recording which adopted roots follow a static
 *  publisher: `{ "<rootName>": { pubkey, hosts, lineageKey } }`.
 *  Participant-local — like hc:adopted-roots, never folded into lineage. */
export const STATIC_FOLLOWS_KEY = 'hc:static-follows'

/** The standing public content endpoint (Blossom worker over R2 —
 *  documentation/public-content-endpoint.md). Seeded as a byte source for
 *  link-bundle resolution so a fresh visitor on ANY origin can fetch a
 *  bundle minted to the public CDN — private mode, no relay flags. Same
 *  standing host HostSyncService drains public closures to. */
export const PUBLIC_CONTENT_HOSTS = ['content.pluginthematrix.com']

// ── THE OUTSIDE-IN DOOR ─────────────────────────────────────────────────────
//
// Jaime: "I go to somebody's domain, I like that package, I click that link,
// and it brings me back to MY domain and redirects me to adopting that package
// from where I was originally."
//
// A published site is a read-only shell on somebody else's origin: it cannot
// write to your hive, cannot fetch across origins, and must not pretend to.
// So the door is a LINK and it carries COORDINATES, not bytes — the publisher's
// key, the hosts that answer for them, their route to the creation, and the
// route the reader was standing on. All four are already on the visitor's
// screen; none of them needs a fetch the read-only shell is not allowed to
// make, and none of them is trusted on arrival: the reader's own hive reads
// the publisher's SIGNED INDEX for the head, exactly as the invite link does.
//
// What arrives is therefore an OFFER — one creation, shaded, taken a tile at a
// time. A link can put a creation in front of you; only you can hold it.

/** Where a reader's hive lives when they have not said otherwise. ONE
 *  spelling in this package — hypercomb.io IS the app (the shim's welcome
 *  card carries the only other one, for a cold host with no code loaded). */
export const HIVE_APP_ORIGIN = 'https://hypercomb.io'

/** localStorage key naming the reader's OWN hive, when it is not the app's
 *  standing origin. Read on a published site, where nothing else about the
 *  reader is knowable; never written by anything here. */
export const MY_HIVE_KEY = 'hc:my-hive'

/** sessionStorage key the shell's boot capture stashes a door under. The
 *  capture lives in the shell (hypercomb-shared/core/invite-capture.ts) and
 *  MUST NOT import essentials, so this literal is mirrored there with a
 *  comment pointing back here. Keep the two in sync — as PENDING_INVITE_KEY is. */
export const PENDING_DOOR_KEY = 'hc:pending-door'

/** The query parameter that makes a URL a door. */
export const HIVE_DOOR_PARAM = 'hive'

/** What a door says: a creation, and where its reader was standing. */
export interface HiveDoor {
  readonly bundle: HiveLinkBundle
  readonly at: readonly string[]
}

// The bundle validator's own host rule, one definition below — a door and a
// bundle must agree on what a host is or a link can mint one the other
// refuses.
const DOOR_HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/

const cleanHost = (raw: unknown): string => {
  const bare = String(raw ?? '').trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0] ?? ''
  return DOOR_HOST_RE.test(bare) ? bare : ''
}

const cleanRoute = (raw: unknown): string[] => {
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').split('/')
  return parts.map(p => String(p ?? '').trim()).filter(Boolean).slice(0, 24)
}

/**
 * THE DOOR'S ADDRESS, on the reader's own hive.
 *
 * Every part is encoded whole, so a tile named with a slash or an ampersand
 * cannot smuggle a second parameter. An origin that is not a plain web
 * address falls back to the app's — a door must land somewhere real.
 */
export const hiveDoorUrl = (
  appOrigin: string,
  bundle: Pick<HiveLinkBundle, 'pubkey' | 'hosts' | 'segments'>,
  at: readonly string[] = [],
): string => {
  const pubkey = String(bundle?.pubkey ?? '').toLowerCase()
  const hosts = (bundle?.hosts ?? []).map(cleanHost).filter(Boolean)
  const of = cleanRoute(bundle?.segments)
  if (!/^[0-9a-f]{64}$/.test(pubkey) || hosts.length === 0 || of.length === 0) return ''
  let origin: URL
  try { origin = new URL(String(appOrigin ?? '') || HIVE_APP_ORIGIN) } catch { origin = new URL(HIVE_APP_ORIGIN) }
  if (origin.protocol !== 'https:' && origin.protocol !== 'http:') origin = new URL(HIVE_APP_ORIGIN)
  const url = new URL('/', origin.origin)
  url.searchParams.set(HIVE_DOOR_PARAM, pubkey)
  url.searchParams.set('on', hosts.join(','))
  url.searchParams.set('of', of.join('/'))
  const route = cleanRoute(at)
  if (route.length) url.searchParams.set('at', route.join('/'))
  return url.toString()
}

/**
 * A door back out of a URL's query, or null when the query is not one.
 *
 * The bundle it builds goes through `validateHiveLinkBundle` like any other,
 * so a door can never be a shape the rest of the path has not already agreed
 * to. `rootSig` is deliberately absent: a door names WHO and WHERE, and the
 * head comes from the publisher's signed index at arrival — the one place it
 * is true at the moment it is read.
 */
export const hiveDoorFrom = (search: unknown): HiveDoor | null => {
  let params: URLSearchParams
  try { params = new URLSearchParams(String(search ?? '')) } catch { return null }
  const pubkey = String(params.get(HIVE_DOOR_PARAM) ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return null
  const hosts = String(params.get('on') ?? '').split(',').map(cleanHost).filter(Boolean)
  const segments = cleanRoute(params.get('of'))
  const bundle = validateHiveLinkBundle({
    kind: HIVE_LINK_KIND, v: HIVE_LINK_VERSION, pubkey, hosts, segments,
  })
  return bundle ? { bundle, at: cleanRoute(params.get('at')) } : null
}

/** The same door out of what the boot capture stashed. Validated HERE and not
 *  there: the capture runs before anything else and holds the query verbatim,
 *  so this is the only place that decides what it means. */
export const hiveDoorOf = (raw: unknown): HiveDoor | null =>
  hiveDoorFrom(String(raw ?? ''))

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
