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
