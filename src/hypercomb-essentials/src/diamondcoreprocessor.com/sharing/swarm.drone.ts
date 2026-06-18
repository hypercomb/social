// diamondcoreprocessor.com/sharing/swarm.drone.ts
//
// Public swarm sync over the Nostr mesh.
//
// Wire shape: a parameterized replaceable Nostr event per peer per
// lineage. The relay holds exactly one event per (pubkey, kind, d-tag)
// triple — replaceability gives us late-joiner discovery in a single
// REQ without anyone having to republish, and updates from a peer
// overwrite their slot in place.
//
//   kind     SWARM_LAYER_KIND (30200) — parameterized replaceable range
//   tags     [['x', lineageSig], ['d', lineageSig]]
//                x = the existing mesh filter convention (NostrMeshDrone
//                    subscribes by `#x`); kept identical so the existing
//                    bucketing / fan-out works unchanged.
//                d = the canonical replaceable-event parameter; what the
//                    relay uses to dedupe by (pubkey, kind, d-tag).
//   content  JSON: { children: [{ name }] } — the publishing peer's
//                  tile-layer at this lineage. Empty children means
//                  "I'm here, contributing nothing" (a soft leave).
//
// Render path: the SwarmTileSource (registered with TileSourceRegistry
// at boot) reads peerTilesAtCurrentSig(). Show-cell calls
// registry.resolve() on every render, so any change to peer state
// surfaces on the next paint — and show-cell's existing mesh
// subscription on the same sig auto-triggers that paint when an event
// arrives, so we don't need to dispatch a render signal ourselves.

import { Drone, EffectBus } from '@hypercomb/core'
import { readTilePropertiesAt, writeTilePropertiesAt } from '../editor/tile-properties.js'
import { sanitizeVisual } from './visual-sanitizer.js'
import { sessionHideStore } from '../presentation/tiles/session-hide.store.js'
import { isCellPublic, setCellPublic } from '../presentation/tiles/tile-actions.drone.js'
import { listDecorations } from '../commands/decoration-manifest.js'
import { kindsForLabel } from '../commands/decoration-kind-index.js'
import { SWARM_INVITE_KIND } from './meeting-invite.js'

const SWARM_LAYER_KIND = 30200

// Per-pubkey-per-lineage hidden-tile list. Stored on the mesh — the
// session (room + secret) is the boundary. d-tag = composed lineage
// sig; content = JSON `{ hidden: [name, name, ...] }`. The publisher's
// own event echoes back via the relay, so on refresh / reload the
// filter is automatically restored from the receiver's own past
// publish. Switching zones (different room/secret) gives a fresh
// empty filter because the composed sig changes. NIP-40 expiration
// keeps the list alive while the user is active; stop publishing
// (close tab) and the hide list naturally evaporates from the relay
// at expiration time.
const SWARM_HIDE_KIND = 30202

// Companion event kind for content-addressed resource streaming.
// d-tag = resource sig (sha256 of bytes); content = base64 of bytes.
// Layer events reference resource sigs in child.imageSig; receivers
// that don't have a referenced sig locally subscribe by sig + write
// the bytes to OPFS via Store.putResource (which re-verifies the sig
// against the content — defence against a malicious peer publishing
// mismatched bytes). Parameterized-replaceable per (pubkey, kind, sig)
// so a peer that republishes the same image bytes doesn't fan out
// duplicates, and late subscribers always get the latest copy.
const SWARM_RESOURCE_KIND = 30201

// Interest events — "I'm clicking your tile, please come show me what's
// inside." Published at the PARENT lineage's composedSig (not the
// child's), so the tile owner (who is sitting at the parent and sees
// their own published tile there) gets the signal without needing to
// be subscribed to every sub-location ahead of time.
//
// Parameterized-replaceable per (pubkey, kind, d-tag) where the d-tag
// is `${parentSig}:${childName}` — each peer can express at most one
// current interest per (parent, child) pair. Re-clicking the same tile
// refreshes the expiration tag so the cue stays alive while the
// adventurer is genuinely waiting.
//
// Companion-effect on the receive side: the swarm exposes
// `interestedAt(childName)` so render paths can paint a visual cue on
// the tile ("X is interested in this"). The tile-clicker also
// navigates into the child as usual — interest is the side-channel
// signal, NOT a gate on navigation.
const SWARM_INTEREST_KIND = 30203

// Presence event — broadcasts the participant's CURRENT pathSegments
// to a per-pubkey sig (sha256(`presence:${pubkey}\0room\0secret`)).
// Distinct from the personal channel that carries layer visuals; this
// one carries WHERE the participant is. Used by FollowDrone (nav-sync)
// to navigate when the followed leader moves.
//
// Parameterized-replaceable per (pubkey, kind, d-tag=presenceSig),
// NIP-40 expiration. Out-of-date positions naturally evaporate.
const SWARM_PRESENCE_KIND = 30204

// Subscribe-request event. The would-be subscriber publishes one of
// these at the leader's "request channel" sig
// (sha256(`request:${leaderPubkey}\0room\0secret`)) so the leader,
// who is subscribed to their own request channel from boot, receives
// a notification: "X wants to subscribe to your broadcasts."
// Content { label } — leader's UI uses it to decide accept / no thanks.
//
// "Follow" (nav-sync) is a SEPARATE concept and doesn't carry a
// consent handshake — it's a local choice to mirror someone's
// navigation, no broadcast involved.
const SWARM_SUBSCRIBE_REQUEST_KIND = 30205

// Debug logging — gated on the same master flag the mesh uses
// (localStorage['hc:nostrmesh:debug'] = '1'). The publish walk logs PER
// NODE PER PASS and passes run on every heartbeat; ungated, a session
// accumulated 22,900+ retained console entries (DevTools pins every
// logged object — an effective memory leak). Default: silent.
const swarmDebugEnabled = ((): boolean => {
  try { return localStorage.getItem('hc:nostrmesh:debug') === '1' } catch { return false }
})()
const slog = (...args: unknown[]): void => { if (swarmDebugEnabled) console.log(...args) }

const NOSTR_MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const TILE_SOURCE_REGISTRY_KEY = '@hypercomb.social/TileSourceRegistry'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const HISTORY_SERVICE_KEY = '@diamondcoreprocessor.com/HistoryService'
const SIGNATURE_STORE_KEY = '@hypercomb/SignatureStore'
const STORE_KEY = '@hypercomb.social/Store'
const ROOM_STORE_KEY = '@hypercomb.social/RoomStore'
const SECRET_STORE_KEY = '@hypercomb.social/SecretStore'

// How deep we walk our local subtree on each publish. Capped so a
// publisher's entire OPFS isn't dumped onto the relay at boot — but
// deep enough that a receiver navigating into a peer tile actually
// sees the peer's children there. 3 = current + 3 descendant levels.
const MAX_PUBLISH_DEPTH = 3

// Hard cap on per-publish-burst event count. Defensive against a
// publisher with thousands of cells filling the relay in one wave.
const MAX_PUBLISH_NODES = 200

// NIP-40 event lifetime. Every publish carries an `expiration` tag set
// to (now + EVENT_TTL_SECS). NIP-40 compliant relays MUST drop the
// event after this timestamp, so peers that go offline disappear from
// the swarm without needing to send NIP-09 delete events. Republish
// cadence below keeps active peers alive in the relay's cache.
const EVENT_TTL_SECS = 90

// Heartbeat cadence — we re-run the current-lineage sync on this
// interval so our `expiration`-tagged event gets refreshed before it
// expires. Half the TTL gives one full safety margin: a missed
// heartbeat still leaves another full interval before our slot drops.
const HEARTBEAT_INTERVAL_MS = 30_000

// Unchanged-content refresh period for SUBTREE layer events — the only
// publish that multiplies by node count (≤ MAX_PUBLISH_NODES per pass).
// Refresh at half the TTL instead of every heartbeat tick: a node
// republishes on the first 30s tick after 45s elapsed (worst case ~75s,
// ≥15s before the 90s expiration), which halves steady-state layer
// traffic per participant. Single-event publishes (presence, hide,
// visuals channel) stay on the heartbeat cadence — they ARE the
// liveness signal. Same TTL-fraction shape as the interest-event
// refresh below.
const LAYER_REFRESH_MS = (EVENT_TTL_SECS * 1000) / 2

// Client-side peer freshness window. A peer whose last layer event
// is older than this gets evicted from the in-memory cache, even if
// the relay still has a stale copy. Matches EVENT_TTL_SECS so the
// receiver and the relay's NIP-40 sweep agree on when a peer is
// "gone." Slightly looser (TTL * 1.5) to absorb network jitter — a
// publisher whose heartbeat is a couple of seconds late shouldn't
// vanish, but one who actually closed their tab should within ~2
// minutes.
const PEER_STALE_MS = EVENT_TTL_SECS * 1500  // 90s * 1.5 = 135s

// How often to sweep stale peers from the cache. Tied to the same
// rhythm as the layer heartbeat so each pass either republishes our
// own slot or evicts a peer who hasn't kept theirs alive.
const PEER_STALE_SWEEP_INTERVAL_MS = 30_000

// Resource events get a longer TTL than layer events — image bytes
// are heavier and don't change with every navigation, so we want
// them to persist longer in the relay's cache for new joiners. A
// day's worth of headroom; the resource-heartbeat below republishes
// before the relay drops the slot.
const RESOURCE_TTL_SECS = 86_400

// Resource republish buffer: re-publish a resource event when its
// last-publish time is older than (TTL - buffer). 5 minutes gives a
// generous window for the layer heartbeat (30 s) to catch the
// approaching expiration on its next pass.
const RESOURCE_REPUBLISH_BUFFER_MS = 5 * 60 * 1000

// Cap on the inline base64 content size we'll publish per resource
// event. Larger blobs (e.g. raw multi-MB photos) should be referenced
// via an out-of-band URL field rather than streamed inline — we'd
// otherwise hit relay event-size limits. The downsampled point/flat
// variants substrate writes are well under this cap; this guards
// against an accidental publish of an unprocessed image.
const MAX_RESOURCE_BYTES = 256 * 1024  // 256 KB

interface SwarmLayerPayload {
  // Optional human-readable label the publisher set for themselves
  // (e.g. "Alice"). Per-participant identity affordance — UI uses it to
  // render a name next to peer tiles, sort participant lists, and let
  // the user pick who to auto-adopt. Pubkey remains the canonical
  // identity; label is decoration that can be changed any time. Length
  // capped + filtered through the visual-sanitizer's ident shape on
  // receive so a malicious peer can't inject markup or unbounded text.
  label?: string

  // The 0000 array — one entry per child at the publisher's current
  // location. Each entry is flat: `name` is the lineage leaf, and
  // every other field is a first-class cell property (index, imageSig,
  // small.image, tags, hideText, link, etc.) inlined directly. No
  // `props` wrapper — the visual IS the properties, plus the name
  // that identifies which child it belongs to.
  //
  // Image bytes (heavy binary content) still ride the companion kind
  // 30201 resource pipeline, referenced by sig inside the visual.
  // Receive-side auto-pull of those bytes was REMOVED — see #onEvent
  // and #maybeAutoAdoptForPubkey. Resources are only fetched when the
  // receiver has opted in (per-pubkey auto-adopt) or explicitly adopts
  // a tile; raw browsing of the visuals payload never touches the
  // resource pipeline.
  visuals: ({ name: string } & Record<string, unknown>)[]
}

interface MeshEvtLike {
  relay: string
  sig: string
  event: {
    kind?: number
    pubkey?: string
    tags?: string[][]
    content?: string
    // Nostr-stamped wall-clock seconds. Used by the freshness gate to
    // drop layer/hide events that a non-NIP-40 relay is still serving
    // past their expiration — without this, ghost tiles from past
    // sessions appear for up to PEER_STALE_MS after subscribing.
    created_at?: number
  }
  payload: unknown
}

interface MeshSubLike { close: () => void }

interface MeshApi {
  publish: (kind: number, sig: string, payload: unknown, extraTags?: string[][]) => Promise<boolean>
  subscribe: (sig: string, cb: (e: MeshEvtLike) => void) => MeshSubLike
  configureKinds: (kinds: number[] | null, persist?: boolean) => void
  ensureStartedForSig: (sig: string) => void
}

interface SignerApi {
  getPublicKeyHex: () => Promise<string | null>
}

interface LineageLike extends EventTarget {
  explorerSegments?: () => readonly string[]
  // HistoryService.sign(lineage) reads .domain() — leaving it optional
  // so callers that already have a partial LineageLike (e.g. constructed
  // from just segments) still typecheck. The real Lineage from IoC has
  // it; signing without it falls back to the global default.
  domain?: () => string
  // Note: we deliberately do NOT call lineage.explorerDir() here — its
  // result-cache stores `null` when Store isn't ready yet, and that
  // null is then served to every other caller (including show-cell)
  // until the next invalidate(). We walk Store.hypercombRoot ourselves
  // to avoid polluting that shared cache.
}

interface SignatureStoreLike {
  signText: (input: string) => Promise<string>
}

// Subset of HistoryService used here — resolve the current layer for
// a lineage and the names of its children. Layer-as-primitive doctrine:
// the layer's children list is the authoritative shareable tile set.
// OPFS dirs that aren't in the layer are local orphans (deletion-undone
// stubs, manual file-system poking, in-flight commits that didn't land)
// and MUST NOT travel to peers.
interface HistoryServiceLike {
  sign: (l: LineageLike) => Promise<string>
  currentLayerAt: (locationSig: string) => Promise<{ children?: readonly string[]; name?: string } | null>
  getLayerBySig: (sig: string) => Promise<{ name?: string } | null>
}

interface StoreLike {
  hypercombRoot?: FileSystemDirectoryHandle | null
  // Resource API — content-addressed read/write. putResource computes
  // the sig from bytes itself (sha256), so we get verification for
  // free when receiving over the wire: a mismatched payload from a
  // malicious peer yields a sig that differs from the d-tag and we
  // discard.
  getResource?: (sig: string) => Promise<Blob | null>
  putResource?: (blob: Blob) => Promise<string>
}

// Singleton credential stores (RoomStore + SecretStore) live in
// hypercomb-shared/core. They're the source of truth for room +
// secret; the older `mesh:room` / `mesh:secret` effects emit
// transient updates but the localStorage-backed stores are what
// survives reloads and what every other consumer reads.
interface CredentialStoreLike extends EventTarget {
  readonly value: string
}

interface TileSourceRegistryLike {
  register: (source: (loc: { segments: readonly string[]; dir: FileSystemDirectoryHandle | null }) =>
    Promise<readonly { name: string; kind: string; source: Record<string, unknown> }[]>) => () => void
}

const SYSTEM_DIR_NAMES = new Set([
  '__dependencies__', '__bees__', '__layers__', '__location__',
  '__history__', '__optimization__', '__resources__',
])

function isSystemDirName(name: string): boolean {
  if (!name) return true
  if (SYSTEM_DIR_NAMES.has(name)) return true
  return name.startsWith('__') && name.endsWith('__')
}

/** Deep-canonicalize a JSON-shaped value before signing. Object keys
 *  are sorted alphabetically recursively; arrays preserve their order
 *  (arrays are semantically ordered). JSON.stringify's compact default
 *  output handles whitespace deterministically — no extra trim needed.
 *
 *  The state-machine boundary uses this any time a sig-bound resource
 *  is produced. Same logical content → same canonical bytes → same
 *  sig across the network, regardless of which writer (editor save,
 *  AI bridge stamp, manual edit, swarm publish) touched the source.
 *  Prevents the "two peers ship the same tile, different sigs" drift
 *  that would otherwise cripple dedup and adoption. */
function canonicaliseValue(value: unknown): unknown {
  if (value === null) return null
  if (Array.isArray(value)) return value.map(canonicaliseValue)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicaliseValue((value as Record<string, unknown>)[k])
    }
    return out
  }
  return value
}

/** Read the lineage-keyed hide list from localStorage. Path strings of
 *  the form `parent/segments/name` — sync, fast, persistent across
 *  sessions, cross-zone (one personal preference list per device).
 *  Returns an empty Set on missing / malformed storage; the swarm
 *  tile source uses this as the canonical "skip these peer visuals
 *  forever" filter. */
function readHiddenLineages(): ReadonlySet<string> {
  try {
    // SESSION-ONLY (see session-hide.store.ts) — must match tile-actions'
    // write backing, or peer-hiding silently no-ops in public mode.
    const raw = sessionHideStore.getItem('hc:hidden-lineages')
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string' && x.length > 0))
  } catch {
    return new Set()
  }
}

// ── Resource encoding helpers ──────────────────────────────────────
// Nostr event content is a string, so binary resource payloads ride
// across the wire as base64. These helpers keep the codec local to
// the swarm pipeline (no fanning extra utility out to shared/) and
// roundtrip through a single Blob so the bytes the receiver writes
// to OPFS are byte-for-byte equal to the publisher's input.

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  // String.fromCharCode chunked to avoid argument-count limits on
  // large buffers (V8 caps spread args around 100k). 32k window is a
  // safe middle ground.
  let s = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)))
  }
  return btoa(s)
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

// Walk a JSON resource looking for signature-shaped values. Used on
// receive to discover any sub-resources a streamed propsSig blob
// references (e.g. `small.image = pointSig`), so the receiver can
// queue those for fetch too. Returns deduped sig strings; only fields
// that are exactly 64 lowercase hex chars qualify (matches OPFS
// __resources__ filename shape).
function collectNestedSigs(value: unknown, out: Set<string>): void {
  if (!value) return
  if (typeof value === 'string') {
    if (/^[0-9a-f]{64}$/.test(value)) out.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectNestedSigs(v, out)
    return
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectNestedSigs(v, out)
  }
}

async function listLocalChildren(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const out: string[] = []
  try {
    for await (const [name, h] of (dir as unknown as {
      entries: () => AsyncIterable<[string, FileSystemHandle]>
    }).entries()) {
      if (h.kind !== 'directory') continue
      if (isSystemDirName(name)) continue
      out.push(name)
    }
  } catch { /* ignore — return what we have */ }
  out.sort((a, b) => a.localeCompare(b))
  return out
}

// Lightweight 0000 reader. Mirrors readCellProperties() in
// editor/tile-properties.ts; kept local so swarm.drone has no
// presentation/editor import chain. Returns {} on missing/parse-fail
// — callers treat absence as "no index field".
async function readChildProperties(cellDir: FileSystemDirectoryHandle): Promise<Record<string, unknown>> {
  let fh: FileSystemFileHandle
  try { fh = await cellDir.getFileHandle('0000') }
  catch { return {} }
  try {
    const f = await fh.getFile()
    const txt = await f.text()
    const v = JSON.parse(txt)
    return (v && typeof v === 'object') ? v as Record<string, unknown> : {}
  } catch { return {} }
}

export class SwarmDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Public swarm sync. Each peer publishes their layer at every visited lineage as a parameterized replaceable Nostr event; subscribers cache a Map<pubkey, layer> per lineage and surface peer tiles to the renderer via TileSourceRegistry.'

  public override effects = ['network'] as const

  protected override deps = {
    mesh: NOSTR_MESH_KEY,
    signer: NOSTR_SIGNER_KEY,
  }
  // Listens to mesh:ensure-started purely for backward-compat — show-cell
  // emits it on every render; if it fires before our lineage-change hook
  // resolves, we still subscribe + publish on time. The primary trigger is
  // the Lineage `change` event we wire up in the constructor below.
  protected override listens: string[] = ['mesh:ensure-started', 'mesh:public-changed', 'mesh:room', 'mesh:secret', 'cell:0000-changed', 'cell:added', 'tile:public-changed']
  protected override emits: string[] = ['swarm:peers-changed', 'swarm:presence-changed', 'swarm:resource-arrived', 'swarm:hide-changed', 'swarm:interest-changed', 'swarm:label-changed', 'swarm:subscription-changed', 'swarm:subscribe-request-received', 'swarm:following-changed', 'swarm:leader-moved', 'swarm:open-for-subscribers-changed', 'swarm:follow-updated', 'tile:public-changed']

  // Per-lineage subscription handle. We open one per visited sig and
  // never close (cheap — mesh dedupes by sig at the bucket layer).
  #subsBySig = new Map<string, MeshSubLike>()

  // Late-joiner visuals recovery (#48): sigs with an in-flight
  // fetchVisualsAt, so concurrent #syncForSig passes don't double-fetch.
  #visualsRecoveryInFlight = new Set<string>()

  // Per-lineage peer state. Outer key = lineage sig, inner key = peer
  // pubkey. Updated on every incoming event; replaceability means the
  // last write wins per peer, which matches what we want at render.
  #peerLayersBySig = new Map<string, Map<string, SwarmLayerPayload>>()

  // Wall-clock time (ms) we last saw an event from each peer at each
  // sig. Drives the staleness eviction below — a peer that hasn't
  // republished within PEER_STALE_MS is assumed offline and gets
  // evicted from the cache + the renderer is told to repaint without
  // their tiles. Mirrors the relay's NIP-40 expiration on the client
  // side so we don't keep showing a peer's tiles after their event
  // has lapsed in the relay's cache.
  #peerLastSeenMsBySig = new Map<string, Map<string, number>>()

  // Per-pubkey-per-lineage hidden-tile names. Populated from kind-
  // 30202 events (SWARM_HIDE_KIND). The publisher's own hide event
  // echoes back from the relay and seeds this map on refresh; that's
  // how the filter survives reloads without any client-side storage.
  // Outer key = composed lineage sig; inner key = peer pubkey; value
  // = Set of tile names that pubkey wants hidden at that lineage.
  #hiddenByPubkeyBySig = new Map<string, Map<string, Set<string>>>()

  // Interest cache. Outer key = parent composedSig (the lineage where
  // the interest was expressed). Inner key = child tile name. Value =
  // Set of pubkeys currently interested in that child tile at that
  // lineage. Populated by inbound kind-30203 events; consumers read
  // via interestedAt(name).
  #interestByChildBySig = new Map<string, Map<string, Set<string>>>()

  // Per-(sig, childName, pubkey) last-seen ms for interest/presence
  // pings. Parallel to #interestByChildBySig, which only ever grows
  // (it has no per-pubkey expiry). presenceGlowSnapshot() prunes against
  // this so the presence glow reflects who is LIVE inside each child,
  // not everyone who ever pinged it this session. Flushed with the
  // interest cache on lineage change / teardown.
  #interestSeenBySig = new Map<string, Map<string, Map<string, number>>>()

  // What we ourselves currently have interest in — per parent sig,
  // map of childName → expirationMs. Drives heartbeat-style refresh
  // so a long click-hover holds the cue alive; also drives the dedupe
  // (don't re-publish identical interest within the heartbeat window).
  #myInterestBySig = new Map<string, Map<string, number>>()

  // Our own live "I'm inside <leaf>" presence pings, keyed by
  // `${parentSig}:${leaf}`. While we sit inside a child we re-announce
  // ourselves to the PARENT's sig on the heartbeat so peers viewing the
  // parent see a presence glow on the tile we're exploring. Value =
  // expirationMs; deduped so we only republish past 2/3 TTL.
  #myParentPresenceExpMs = new Map<string, number>()

  // Peer label cache. Each participant can stamp a human-readable
  // label on their published payload ("Alice", "Bob's bee-keep") so
  // UI can render names alongside pubkeys. Pubkey stays the canonical
  // identity; label is decoration that can change at any time. Latest
  // event per peer wins; the older-event guard in #onEvent keeps stale
  // labels from clobbering newer ones.
  #labelByPubkey = new Map<string, string>()

  // Open subscription to a followed leader's personal channel sig.
  // Closed and reopened whenever setFollowing changes.
  #subscribeSub: { close: () => void } | null = null

  // Per-lineage local memo of what we last published as our hidden
  // list. Drives the dedupe + heartbeat for hide events: skip a
  // republish when the list is unchanged AND the NIP-40 expiration
  // is still comfortably in the future.
  #lastPublishedHideBySig = new Map<string, string>()
  #lastHidePublishTimeMsBySig = new Map<string, number>()

  // Per-lineage memo of the last children list we published. Used to
  // skip republishing when nothing about our local layer changed.
  #lastPublishedBySig = new Map<string, string>()

  // Wall-clock time (ms) of the last publish per sig. Drives the
  // heartbeat — if a peer's payload hasn't changed in EVENT_TTL_SECS,
  // we still republish so the NIP-40 `expiration` tag stays in the
  // future and the relay doesn't drop our slot. Without this we'd
  // self-expire even while the user is actively present at this
  // lineage.
  #lastPublishTimeMsBySig = new Map<string, number>()

  // Resource sigs we've published as kind 30201 in this session.
  // Resources are immutable (content-addressed), so once we've fanned
  // out the bytes we don't republish UNLESS the relay's NIP-40
  // expiration is about to lapse for that resource — at which point
  // we re-assert so late joiners can still fetch. Map value is the
  // wall-clock time (ms) of the last publish; the heartbeat checks
  // against (now - RESOURCE_TTL_SECS + RESOURCE_REPUBLISH_BUFFER_MS)
  // to decide when to refresh. Cleared on dispose.
  #publishedResources = new Map<string, number>()

  // (Derived parse cache removed — props are now inlined on the wire,
  // so receivers have the parsed object directly in #peerLayersBySig.
  // No separate sig→derived map needed.)

  // Resource sigs we're currently subscribed to (waiting for bytes).
  // One sub per sig (mesh dedupes consumers, but the bookkeeping is
  // ours): keyed by sig, value is the mesh subscription handle so we
  // can close it once the bytes arrive and land in OPFS.
  #resourceSubs = new Map<string, MeshSubLike>()

  // Last-APPLIED layer-event created_at per `${sig} ${pubkey}`. Replay
  // from a relay that doesn't honour replaceable semantics arrives
  // newest-first; applying in arrival order would let the publisher's
  // OLDEST event (their empty join publish) land last and clobber their
  // real tile list. Strictly-older events drop; equal-or-newer apply.
  // Publisher-stamped seconds compared per publisher only, so clock
  // skew between peers never factors in. Entries are tiny and refusing
  // ever-seen-older events stays correct across evictions, so this map
  // is never cleared.
  #peerLayerAppliedAtBySigPubkey = new Map<string, number>()

  // Resolved lazily from NostrSigner. Until it lands, incoming events
  // aren't filtered for self — which is harmless because show-cell
  // already dedupes peer entries against its OPFS-owned set, so our
  // own tiles still surface as `kind: 'opfs'` not `kind: 'peer'`.
  #myPubkey: string | null = null

  // The most recent COMPOSED swarm sig (= sha256(lineageSig + room +
  // secret)) we're subscribed/publishing to. Different from the raw
  // lineage sig: the swarm gates membership on (room, secret) so
  // peers in different rooms or with wrong secrets don't see each
  // other's tiles even though they're at the same lineage path.
  #currentSig = ''

  // Privacy credentials are sourced from the canonical RoomStore +
  // SecretStore singletons (one source of truth, also read by show-
  // cell and any future consumer). The mesh:room / mesh:secret
  // effects are kept as a fast-path notification, but the stores are
  // queried at the moment of subscribe/publish to avoid drift.
  //
  // Both must be non-empty to enable swarm publish/subscribe —
  // otherwise the drone stays silent regardless of mesh-public state.

  // Debounce token for swarm:peers-changed emission. Each peer's
  // subtree publish fans out ~10–30 events to subscribers in a burst;
  // emitting on every one made show-cell reset its render cache faster
  // than it could complete a render, leaving local tiles unsurfaced.
  // Coalesced to one emit per ~150ms so the canvas settles between
  // bursts but live updates still feel responsive.
  #peersChangedTimer: ReturnType<typeof setTimeout> | null = null

  #initialized = false

  constructor() {
    super()
    // Boot wiring — needs the IoC singletons to be registered, which
    // happens during module load. Defer to next tick so module load
    // order doesn't matter (NostrMeshDrone, NostrSigner, the
    // TileSourceRegistry, and Lineage may register after us). Each
    // setup task retries until its dependency is reachable; one-shot
    // boot is fragile because module-load race windows are real.
    queueMicrotask(() => this.#configureMeshKinds(0))
    queueMicrotask(() => this.#registerTileSource(0))
    queueMicrotask(() => this.#resolveMyPubkeyWithRetry(0))
    queueMicrotask(() => this.#hookLineageChanges(0))
    // Seed the zone key from whatever credentials are persisted at
    // boot. Without this, the first hide/unhide on page load would
    // see no `hc:current-zone` in localStorage and fall back to the
    // bare key — meaning hides written before the zone key landed
    // would orphan when the swarm finally computes it.
    queueMicrotask(() => this.#updateZoneKey())
    // Heartbeat: every HEARTBEAT_INTERVAL_MS, refresh our current
    // lineage's NIP-40 expiration by republishing. The dedupe in
    // #publishSubtree now considers wall-clock elapsed alongside
    // content equality, so an unchanged layer still re-fires its
    // expiration tag. Without this loop, peers who sit idle on a
    // single lineage would self-expire from the relay within
    // EVENT_TTL_SECS even though they're still present.
    this.#heartbeatTimer = setInterval(() => {
      if (!this.#currentSig) return
      void this.#syncForCurrentLineage()
      // Re-assert our own hide list — the same heartbeat cadence as
      // layer events. Without this, a user who hides a tile and then
      // sits idle would let their hide-event NIP-40 expiration lapse,
      // and on next reload the filter would not be restored from the
      // relay. Reading from #lastPublishedHideBySig (rather than
      // re-deriving from localStorage every tick) means heartbeats
      // are silent unless we actually published a hide list this
      // session — non-hiding users pay nothing.
      const lastHide = this.#lastPublishedHideBySig.get(this.#currentSig)
      if (lastHide !== undefined) {
        try {
          const parsed = JSON.parse(lastHide) as { hidden?: string[] }
          if (Array.isArray(parsed.hidden)) {
            void this.publishHide(parsed.hidden)
          }
        } catch { /* corrupt memo, skip */ }
      }
    }, HEARTBEAT_INTERVAL_MS)

    // Stale-peer eviction sweep — evicts cached layer entries from
    // peers we haven't heard from in PEER_STALE_MS. Without this,
    // tiles a peer published before disconnecting would linger on
    // every receiver's canvas until something else replaced the
    // entry — could be hours, or forever for a peer who never
    // returns. The renderer is told to repaint after any eviction
    // so the disappearance is immediate.
    this.#peerSweepTimer = setInterval(() => this.#sweepStalePeers(),
      PEER_STALE_SWEEP_INTERVAL_MS)
  }

  #heartbeatTimer: ReturnType<typeof setInterval> | null = null
  #peerSweepTimer: ReturnType<typeof setInterval> | null = null

  // Walk every sig in the peer cache and drop entries from peers whose
  // last event is older than PEER_STALE_MS. Emits swarm:peers-changed
  // once per sig that lost a peer so show-cell repaints. Cheap — runs
  // every PEER_STALE_SWEEP_INTERVAL_MS and only touches sigs with
  // actual peers.
  #sweepStalePeers = (): void => {
    const nowMs = Date.now()
    for (const [sig, bag] of this.#peerLayersBySig) {
      const lastSeenBag = this.#peerLastSeenMsBySig.get(sig)
      if (!lastSeenBag) continue
      let evicted = false
      for (const [pubkey] of bag) {
        const lastMs = lastSeenBag.get(pubkey)
        if (lastMs === undefined) continue
        if (nowMs - lastMs > PEER_STALE_MS) {
          bag.delete(pubkey)
          lastSeenBag.delete(pubkey)
          evicted = true
        }
      }
      if (evicted) {
        this.#schedulePeersChangedEmit({ sig, pubkey: '', reason: 'stale-peer-evicted' })
      }
    }
  }

  // Zone key — a sync-readable identifier for the current (room,
  // secret) pair, written to localStorage so other drones can scope
  // their session-local data (hide list, future per-zone caches)
  // without having to consult the SignatureStore async. base64url
  // of `room\0secret` — unique per zone, sync, no hash collisions
  // possible. Empty when either credential is missing.
  static computeZoneKey(room: string, secret: string): string {
    const r = (room ?? '').trim()
    const s = (secret ?? '').trim()
    if (!r || !s) return ''
    // btoa is sync. Replace base64 chars that need escaping in
    // localStorage / URL contexts so the resulting key is safe to
    // embed in storage keys.
    return btoa(`${r}\0${s}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  #updateZoneKey = (): void => {
    const room = this.#getRoomStore()?.value ?? ''
    const secret = this.#getSecretStore()?.value ?? ''
    const key = SwarmDrone.computeZoneKey(room, secret)
    if (key) {
      localStorage.setItem('hc:current-zone', key)
    } else {
      localStorage.removeItem('hc:current-zone')
    }
  }

  /** Force-refresh the current lineage's swarm state: drop every
   *  cached peer at the current sig, close + reopen the subscription,
   *  re-publish our own layer. Useful when the user wants to manually
   *  flush a stale view ("the mesh is showing tiles I deleted") —
   *  the relay's NIP-40 eviction handles the publisher-side cleanup
   *  but receivers that loaded events before the cleanup ran still
   *  have them in memory; this clears that.
   *  Public so a UI control or slash command can invoke it. */
  public refresh = (): void => {
    const sig = this.#currentSig
    if (!sig) return
    const sub = this.#subsBySig.get(sig)
    if (sub) {
      try { sub.close() } catch { /* ignore */ }
      this.#subsBySig.delete(sig)
    }
    this.#peerLayersBySig.delete(sig)
    this.#peerLastSeenMsBySig.delete(sig)
    this.#lastPublishedBySig.delete(sig)
    this.#lastPublishTimeMsBySig.delete(sig)
    this.emitEffect('swarm:peers-changed', { sig, pubkey: '', reason: 'manual-refresh' })
    void this.#syncForCurrentLineage()
  }

  /** Host-driven clear. Wipes EVERY cached peer + publish memo across
   *  every sig (not just the current one), so the local view drops to
   *  empty immediately and the next sync re-fetches fresh. Companion to
   *  NostrMeshDrone#sendHcClear — the relay-side wipe is paired with
   *  this client-side wipe so we don't keep showing peer tiles whose
   *  events the relay just dropped.
   *  Re-emits peers-changed for every sig that lost peers so show-cell
   *  repaints. Public so MeshClearQueenBee can invoke it. */
  /** Evict every cached peer entry for a given pubkey (full or
   *  short-prefix), across every sig the swarm is tracking. Companion
   *  to NostrMeshDrone#sendHcBlock — the relay-side block stops new
   *  events from the pubkey, this drops what we'd already cached.
   *  Returns the count of entries cleared so callers can report it. */
  public evictPubkey = (pubkey: string): { sigsAffected: number; entriesEvicted: number } => {
    const pk = String(pubkey ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{8,64}$/.test(pk)) return { sigsAffected: 0, entriesEvicted: 0 }
    const matches = (candidate: string): boolean =>
      pk.length === 64 ? candidate === pk : candidate.startsWith(pk)
    let entriesEvicted = 0
    const affectedSigs: string[] = []
    for (const [sig, bag] of this.#peerLayersBySig) {
      const before = bag.size
      for (const candidate of [...bag.keys()]) {
        if (matches(candidate)) {
          bag.delete(candidate)
          const lastSeenBag = this.#peerLastSeenMsBySig.get(sig)
          lastSeenBag?.delete(candidate)
          entriesEvicted++
        }
      }
      if (bag.size !== before) affectedSigs.push(sig)
    }
    for (const sig of affectedSigs) {
      this.emitEffect('swarm:peers-changed', { sig, pubkey: pk, reason: 'host-blocked-peer' })
    }
    return { sigsAffected: affectedSigs.length, entriesEvicted }
  }

  public clearAllPeers = (): { sigsCleared: number; peerEntriesCleared: number } => {
    let peers = 0
    for (const bag of this.#peerLayersBySig.values()) peers += bag.size
    const sigsCleared = this.#peerLayersBySig.size
    const affectedSigs = [...this.#peerLayersBySig.keys()]
    this.#peerLayersBySig.clear()
    this.#peerLastSeenMsBySig.clear()
    this.#lastPublishedBySig.clear()
    this.#lastPublishTimeMsBySig.clear()
    for (const sig of affectedSigs) {
      this.emitEffect('swarm:peers-changed', { sig, pubkey: '', reason: 'host-clear-mesh' })
    }
    // Re-publish our own state at the current sig so other receivers
    // see a fresh slot under our pubkey on relays that didn't honour
    // HC_CLEAR (e.g. public relays the user later configures).
    void this.#syncForCurrentLineage()
    return { sigsCleared, peerEntriesCleared: peers }
  }

  // markDisposed() on the Bee base calls our protected dispose hook;
  // we clear timers so they stop firing once the drone is gone,
  // close any pending resource subs (their callbacks would otherwise
  // outlive the drone and try to write to a torn-down store), and
  // drop the published-resource memo so a re-mount re-asserts.
  // Effect subscriptions are auto-cleaned by the base.
  protected override dispose(): void {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer)
      this.#heartbeatTimer = null
    }
    if (this.#peerSweepTimer) {
      clearInterval(this.#peerSweepTimer)
      this.#peerSweepTimer = null
    }
    for (const sub of this.#resourceSubs.values()) {
      try { sub.close() } catch { /* ignore */ }
    }
    this.#resourceSubs.clear()
    this.#publishedResources.clear()
  }

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // Backup trigger — if show-cell happens to be running its render
    // loop, ride its emit. The primary trigger is lineage `change`
    // (wired up in the constructor) which fires the same logic without
    // depending on processor pulses or any other drone.
    this.onEffect<{ signature: string }>('mesh:ensure-started', ({ signature }) => {
      void this.#syncForSig(String(signature ?? '').trim())
    })

    // Credential change wiring — listen directly to the stores so a
    // localStorage write by ANY UI (controls-bar, mesh-header, future
    // settings panel) triggers a teardown + resync immediately. The
    // `mesh:room` / `mesh:secret` effects still flow but the stores
    // are the authoritative source we read at sync time.
    const roomStore = this.#getRoomStore()
    const secretStore = this.#getSecretStore()
    if (roomStore) {
      roomStore.addEventListener('change', () => this.#teardownAndResync('room-store-change'))
    }
    if (secretStore) {
      secretStore.addEventListener('change', () => this.#teardownAndResync('secret-store-change'))
    }
    // Effect listeners retained as a belt-and-braces path — UI may
    // emit the effect before/instead of writing the store.
    this.onEffect<{ room?: string }>('mesh:room', () => this.#teardownAndResync('mesh:room-effect'))
    this.onEffect<{ secret?: string }>('mesh:secret', () => this.#teardownAndResync('mesh:secret-effect'))

    // Tile properties changed — any writer that updates a child's 0000
    // (layout index write, editor save, AI bridge stamp, substrate
    // apply) should reach the swarm wire promptly so peers see the
    // full props rather than the snapshot captured at the moment the
    // tile was first added. Without this, a tile added then enriched
    // 50ms later would publish empty props in the swarm event and
    // only catch up at the next 30s heartbeat.
    //
    // Debounced to coalesce bursts (a single user action may fire
    // multiple 0000 writes across several tiles in the same turn) —
    // ~250ms is comfortably under perceived-instant and well above
    // the layer cascade settle time.
    this.onEffect('cell:0000-changed', () => this.#schedulePropsRepublish())
    // Also covers the bare cell:added → layout cascade race; if the
    // initial publish caught a child mid-write, the property edit that
    // follows triggers cell:0000-changed and we re-publish.
    //
    // Tiles brought into existence while in a swarm are made public by
    // default (#autoPublishInSwarm) so the swarm can collaborate on them —
    // without it a freshly created tile stays private (the self-facing
    // world-mode default) and never reaches peers. cell:added fires only on
    // create / import / tag, never on plain navigation, so browsing a swarm
    // publishes nothing; the room+secret gate inside keeps non-swarm creates
    // private.
    this.onEffect<{ cell?: string; segments?: readonly string[] }>('cell:added', (payload) => {
      this.#autoPublishInSwarm(payload)
      this.#schedulePropsRepublish()
    })
    // Public/private flip — full re-sync so BOTH the broadcast layer slot
    // (kind 30200) AND the personal subscribe channel re-publish with the new
    // public subset. (#schedulePropsRepublish alone only refreshes the layer
    // path, leaving followers' channel view stale.) The publish paths re-apply
    // the filter; a tile going private shrinks the slot, going public adds it.
    this.onEffect('tile:public-changed', () => { void this.#syncForCurrentLineage() })

    // Mesh-public toggle handler. Going OFF tears down state so temp
    // shared tiles disappear from the canvas. Going ON re-runs the
    // current-lineage sync so subscriptions reattach + we publish
    // without the user having to navigate first — without this the
    // toggle felt like sync was broken (mesh comes back online but
    // nothing happens until a 'change' event fires).
    this.onEffect<{ public: boolean }>('mesh:public-changed', (payload) => {
      // Mesh.networkEnabled is gated on BOTH hc:mesh-public AND
      // hc:nostrmesh:network. The drone reads those at construction
      // time, so a toggle to public AFTER boot leaves networkEnabled
      // false — REQs are silently dropped, no events flow, swarm
      // appears dead. Flipping setNetworkEnabled here closes the
      // race: any time the user enables public mode, the mesh
      // immediately opens its sockets and resubscribes to the bucket
      // for the current sig.
      const mesh = this.#getMesh() as (MeshApi & {
        setNetworkEnabled?: (enabled: boolean) => void
        connectAll?: () => void
        resubscribeAll?: () => void
      }) | undefined
      if (payload?.public === true && mesh?.setNetworkEnabled) {
        mesh.setNetworkEnabled(true)
        mesh.connectAll?.()
        mesh.resubscribeAll?.()
      }

      if (payload?.public === false) {
        for (const sub of this.#subsBySig.values()) {
          try { sub.close() } catch { /* ignore */ }
        }
        this.#subsBySig.clear()
        this.#peerLayersBySig.clear()
        this.#peerLastSeenMsBySig.clear()
        this.#lastPublishedBySig.clear()
        this.#lastPublishTimeMsBySig.clear()
        // Resource subs ride the same mesh socket as layer subs; tear
        // them down with the rest of swarm state when going private
        // so callbacks don't fire after the user toggles back to
        // public expecting a clean slate.
        for (const sub of this.#resourceSubs.values()) {
          try { sub.close() } catch { /* ignore */ }
        }
        this.#resourceSubs.clear()
        // Drop the zone key so hide reads/writes fall back to
        // device-scoped storage while in private mode.
        this.#updateZoneKey()
        this.emitEffect('swarm:peers-changed', { sig: this.#currentSig, reason: 'mode-private' })
        return
      }
      // public === true → wake the swarm at the current lineage.
      // Re-publish the zone key so localStorage hide writes (which
      // may have happened in private mode between toggles) land in
      // the zone's namespace going forward.
      this.#updateZoneKey()
      void this.#syncForCurrentLineage()
    })
  }

  // -----------------------------------------------------------------
  // Public — the SwarmTileSource queries this on every render.
  // -----------------------------------------------------------------

  // Track last sync input/output for diagnostics. Set by #syncForCurrentLineage.
  #lastSyncInput: { segments: readonly string[]; room: string; secretLen: number; key: string } | null = null

  /** Debug snapshot of every private field so callers can see exactly
   *  what state the drone is in. Used for diagnostics when sync
   *  doesn't behave; safe to expose since it only returns shapes
   *  callers already have to know about (sigs, pubkeys). */
  public debug = (): object => ({
    lastSyncInput: this.#lastSyncInput,
    currentSig: this.#currentSig.slice(0, 12),
    myPubkey: this.#myPubkey?.slice(0, 8) ?? null,
    room: this.#getRoomStore()?.value ?? null,
    secretSet: !!this.#getSecretStore()?.value,
    subsCount: this.#subsBySig.size,
    subsBySig: Array.from(this.#subsBySig.keys()).map(s => s.slice(0, 12)),
    peerLayersCount: this.#peerLayersBySig.size,
    peerLayersBySig: Object.fromEntries(
      Array.from(this.#peerLayersBySig.entries()).map(([sig, bag]) => [
        sig.slice(0, 12),
        { peerCount: bag.size, peers: Array.from(bag.keys()).map(p => p.slice(0, 8)) },
      ]),
    ),
    lastPublishedSigCount: this.#lastPublishedBySig.size,
    lastPublishedBySig: Array.from(this.#lastPublishedBySig.keys()).map(s => s.slice(0, 12)),
    // Publish-walk telemetry — replaces the per-node console logging
    // (now debug-gated). A runaway republish loop shows up here as
    // walkNodeVisits growing far faster than wire events; check this
    // via swarm.debug() instead of counting console lines.
    publishStats: { ...this.#publishStats },
  })

  /** Cumulative publish-walk counters since boot. nodeVisits counts
   *  every #publishSubtree invocation (one per tree node per pass);
   *  wireEvents counts events actually handed to mesh.publish. */
  #publishStats = { walkNodeVisits: 0, wireEvents: 0 }

  /** All visuals any peer is currently publishing at #currentSig,
   *  excluding our own slot. Delegates to `peerTilesAtSig` — same
   *  shape, same cache reads, same staleness filter.
   *
   *  Each entry carries:
   *    - name        : the cell's lineage leaf
   *    - peerPubkey  : for mine-vs-theirs render treatment
   *    - ...rest     : every other first-class cell property from the
   *                    publisher's inlined 0000 (index, imageSig,
   *                    small.image, tags, link, etc.). Adopt spreads
   *                    these straight into writeTilePropertiesAt.
   *    - imageSig?   : convenience pointer extracted from the entry
   *                    (top-level → small.image → flat.small.image).
   *                    Render binds sync via the existing imageAtlas.
   */
  public peerTilesAtCurrentSig = (): readonly ({ name: string; peerPubkey: string; imageSig?: string } & Record<string, unknown>)[] => {
    return this.peerTilesAtSig(this.#currentSig)
  }

  /** Ordered list of pubkeys currently publishing at the live sig,
   *  excluding self and stale (last-seen older than PEER_STALE_MS).
   *  Sorted freshness-first — most recent activity at index 0.
   *
   *  Backing for SpotlightService.participants() and the layer-cycle
   *  strip UI. Reads in-memory cache live; multiple peer updates
   *  during a debounce window all reflect in the returned list. */
  public participantsAtCurrentSig = (): readonly string[] => {
    const sig = this.#currentSig
    if (!sig) return []
    const peerLayers = this.#peerLayersBySig.get(sig)
    if (!peerLayers || peerLayers.size === 0) return []
    const lastSeenBag = this.#peerLastSeenMsBySig.get(sig) ?? new Map<string, number>()
    const nowMs = Date.now()
    const out: string[] = []
    for (const pubkey of peerLayers.keys()) {
      if (this.#myPubkey && pubkey === this.#myPubkey) continue
      const lastMs = lastSeenBag.get(pubkey)
      if (lastMs !== undefined && nowMs - lastMs > PEER_STALE_MS) continue
      out.push(pubkey)
    }
    // Freshness-first — newest activity at index 0. Tie-breaks fall
    // through to insertion order (Map iteration order).
    out.sort((a, b) => (lastSeenBag.get(b) ?? 0) - (lastSeenBag.get(a) ?? 0))
    return out
  }

  // -----------------------------------------------------------------
  // Boot
  // -----------------------------------------------------------------

  #configureMeshKinds = (attempts: number): void => {
    const mesh = this.#getMesh()
    if (!mesh?.configureKinds) {
      if (attempts >= 50) return  // ~5s of retries — give up silently
      setTimeout(() => this.#configureMeshKinds(attempts + 1), 100)
      return
    }
    // Explicit allowlist (legacy 29010 from paired-channel + show-cell's
    // sync-request workaround, plus our swarm kind 30200). Setting `null`
    // here would make the mesh route ALL kinds to every subscriber's
    // callback — show-cell's callback then runs requestRender on every
    // kind 30200 arrival, churning its render loop and visibly
    // suppressing local tiles.
    //
    // CRITICAL: without our kind in the list, the mesh's REQ filter pins
    // to the legacy default [29010] and our swarm events get filtered
    // out at the relay — silent miss.
    // Includes BROKER kinds 20400 (fetch request) + 30401 (fetch
    // response) — the content-broker drone subscribes to BROADCAST_TAG
    // expecting these to arrive, but the mesh narrows its relay filter
    // to whatever's in this list. Omitting them is a silent miss: the
    // broker subscription registers but never receives events, so
    // swarm.requestSubtree() always times out with "no responder."
    mesh.configureKinds([29010, SWARM_LAYER_KIND, SWARM_RESOURCE_KIND, SWARM_HIDE_KIND, SWARM_INTEREST_KIND, SWARM_PRESENCE_KIND, SWARM_SUBSCRIBE_REQUEST_KIND, 20400, 30401], true)
  }

  /**
   * Compose the swarm sig for an arbitrary set of segments. Same
   * algorithm as #syncForCurrentLineage: sha256 of `lineageKey + ' ' +
   * room + ' ' + secret`. Returns '' when room/secret are not set or
   * when the signature store isn't ready — caller treats that as
   * "no peer tiles to surface."
   */
  public composeSigForSegments = async (segments: readonly string[]): Promise<string> => {
    const sigStore = this.#getSignatureStore()
    if (!sigStore?.signText) return ''
    const room = this.#getRoomStore()?.value?.trim() ?? ''
    const secret = this.#getSecretStore()?.value?.trim() ?? ''
    if (!room || !secret) return ''
    const segs = (Array.isArray(segments) ? segments : [])
      .map((x: unknown) => String(x ?? '').trim())
      .filter((x: string) => x.length > 0)
    const lineageKey = segs.join('/')
    // NUL separators — must match #publishSubtree (line ~1352) exactly so
    // subscribers and publishers address the same slot. A SPACE separator
    // here was the bug behind months of "incognito sees nothing": the
    // subscribe-side composed sig differed from the publish-side, so the
    // relay stored A's event under one #x tag while B subscribed on
    // another. Both A's local fanout (mesh.fanoutToSig keys by sig) and
    // the relay's #x tag filter use the publish sig — so the subscriber
    // must compose the SAME bytes the publisher does.
    try { return await sigStore.signText(`${lineageKey}\0${room}\0${secret}`) }
    catch { return '' }
  }

  /**
   * Same shape as peerTilesAtCurrentSig() but bound to a specific
   * composed sig instead of the drone's internal #currentSig. Used
   * by the tile source so the source can honor the LOCATION the
   * renderer asked about, not whatever lineage the drone last
   * synced to. Without this split, peer events from a previously-
   * visited location leak into the current view whenever the source
   * is called before #currentSig has caught up.
   *
   * Reads the in-memory cache `#peerLayersBySig` — the wire payload
   * already contains parsed props inline, so there's no second cache
   * to merge. The cache is the source of truth — debounced render
   * emits notify subscribers WHEN to read, but the data they read is
   * always live. Multiple peer updates inside one debounce window all
   * land in the cache; the render that follows sees the latest
   * aggregate state.
   *
   * `imageSig` + `index` are pulled out of the inlined props for
   * consumer convenience (show-cell binds images sync without
   * reaching into the props shape).
   */
  public peerTilesAtSig = (sig: string): readonly ({ name: string; peerPubkey: string; imageSig?: string } & Record<string, unknown>)[] => {
    if (!sig) return []
    const peerLayers = this.#peerLayersBySig.get(sig)
    if (!peerLayers || peerLayers.size === 0) return []
    const out: ({ name: string; peerPubkey: string; imageSig?: string } & Record<string, unknown>)[] = []

    // Walk peers in freshest-first order so downstream consumers that
    // first-write-wins (peerImageSigByLabel in show-cell) prefer the
    // most-recent peer's data. A stale peer still cached in the relay
    // from before they disconnected gets superseded by any live peer.
    const lastSeenBag = this.#peerLastSeenMsBySig.get(sig) ?? new Map<string, number>()
    const nowMs = Date.now()
    const sortedPeers = [...peerLayers.entries()].sort(([pkA], [pkB]) => {
      const tA = lastSeenBag.get(pkA) ?? 0
      const tB = lastSeenBag.get(pkB) ?? 0
      return tB - tA
    })

    const sigRe = /^[0-9a-f]{64}$/
    for (const [pubkey, layer] of sortedPeers) {
      if (this.#myPubkey && pubkey === this.#myPubkey) continue
      // Stale-peer filter — skip any peer whose last event is older
      // than PEER_STALE_MS. Same threshold the sweep uses for hard
      // eviction; doing the check here too means a peer that's gone
      // stale between sweeps still doesn't leak through to the
      // renderer.
      const lastMs = lastSeenBag.get(pubkey)
      if (lastMs !== undefined && nowMs - lastMs > PEER_STALE_MS) continue
      const visuals = Array.isArray(layer?.visuals) ? layer.visuals : []
      for (const v of visuals) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) continue
        const name = String((v as Record<string, unknown>)['name'] ?? '').trim()
        if (!name) continue
        // Convenience extraction — imageSig is checked in priority
        // order (top-level → small.image → flat.small.image) so the
        // renderer's atlas binds to the first valid sig it finds.
        const flat = v as Record<string, unknown>
        let imageSig: string | undefined
        const direct = flat['imageSig']
        if (typeof direct === 'string' && sigRe.test(direct)) imageSig = direct
        if (!imageSig) {
          const small = flat['small'] as Record<string, unknown> | undefined
          const smImg = small?.['image']
          if (typeof smImg === 'string' && sigRe.test(smImg)) imageSig = smImg
        }
        if (!imageSig) {
          const flatBag = flat['flat'] as Record<string, unknown> | undefined
          const flSmall = flatBag?.['small'] as Record<string, unknown> | undefined
          const flImg = flSmall?.['image']
          if (typeof flImg === 'string' && sigRe.test(flImg)) imageSig = flImg
        }
        out.push({
          ...flat,                // spread all first-class properties
          name,                   // overwrite with the trimmed/validated value
          peerPubkey: pubkey,
          ...(imageSig ? { imageSig } : {}),
        })
      }
    }
    return out
  }

  /** Peer tiles grouped per participant at the live sig — the adoption
   *  panel's read model. Same gates as peerTilesAtSig (self-excluded,
   *  stale-filtered, freshness-first), but WITHOUT collapsing same-named
   *  tiles across peers: each participant's group carries their own full
   *  visual list, so an overlapping name appears once per publisher and
   *  the user can pick whose version to adopt. Group order matches the
   *  render's top-tile-wins rule — the freshest publisher is index 0, so
   *  the first group containing a name is the one currently rendering it. */
  public peerTilesGroupedAtCurrentSig = (): readonly {
    pubkey: string
    label: string
    tiles: readonly ({ name: string; peerPubkey: string; imageSig?: string } & Record<string, unknown>)[]
  }[] => {
    const tiles = this.peerTilesAtSig(this.#currentSig)
    if (tiles.length === 0) return []
    // peerTilesAtSig walks peers freshest-first, so Map insertion order
    // preserves that ordering for the groups.
    const groups = new Map<string, ({ name: string; peerPubkey: string; imageSig?: string } & Record<string, unknown>)[]>()
    for (const t of tiles) {
      const bag = groups.get(t.peerPubkey)
      if (bag) bag.push(t)
      else groups.set(t.peerPubkey, [t])
    }
    return [...groups.entries()].map(([pubkey, peerTiles]) => ({
      pubkey,
      label: this.#labelByPubkey.get(pubkey) ?? '',
      tiles: peerTiles,
    }))
  }

  #registerTileSource = (attempts: number): void => {
    const registry = this.#getRegistry()
    if (registry?.register) {
      const source = async (loc: { segments: readonly string[]; dir: FileSystemDirectoryHandle | null }) => {
        // Resolve the swarm sig for THIS location, not the drone's
        // internal #currentSig. Show-cell calls tile sources with the
        // location being rendered; the drone's #currentSig lags behind
        // navigation by at least one async tick (it updates inside
        // #syncForSig, which runs from a lineage 'change' listener).
        // Without using the caller's location, a render that lands
        // mid-nav surfaces the OLD location's peer tiles in the NEW
        // location's grid — the cross-location leak Jaime hit.
        const sig = await this.composeSigForSegments(loc.segments)
        if (!sig) return []
        const tiles = this.peerTilesAtSig(sig)
        // Lineage-keyed hide filter — drop any peer visual whose path
        // (currentSegments + name) is in the local hide list. Path-keyed
        // is sync (no sign() needed) and matches the user-visible
        // identity of the tile, so a hide at /foo/bar/baz stays hidden
        // forever regardless of which swarm surfaces it later.
        const hiddenLineages = readHiddenLineages()
        const locKey = loc.segments
          .map(s => String(s ?? '').trim())
          .filter(Boolean)
          .join('/')
        return tiles
          .filter(({ name }) => !hiddenLineages.has(locKey ? `${locKey}/${name}` : name))
          .map(({ name, peerPubkey, imageSig, index }) => ({
            name,
            kind: 'peer' as const,
            source: {
              peerPubkey,
              ...(imageSig ? { imageSig } : {}),
              ...(typeof index === 'number' ? { peerIndex: index } : {}),
            },
          }))
      }
      registry.register(source)
      return
    }
    if (attempts >= 50) return  // ~5s of retries is enough; give up silently
    setTimeout(() => this.#registerTileSource(attempts + 1), 100)
  }

  #resolveMyPubkey = async (): Promise<boolean> => {
    const signer = this.#getSigner()
    if (!signer?.getPublicKeyHex) return false
    try {
      const pk = await signer.getPublicKeyHex()
      if (!pk) return false
      this.#myPubkey = pk.toLowerCase()
      // Pubkey is resolved — subscribe to our own follow-request
      // channel so we receive "X wants to follow you" notifications.
      // Idempotent: re-subscribe attempts no-op if already subscribed.
      void this.#subscribeToMyRequests()
      // Retroactive self-eviction: any cached peer entries arriving
      // before our pubkey resolved bypassed the self-skip filter at
      // line ~1036 and may include OUR OWN relay-echoed publishes
      // (the relay fans every kind-30200 event with d=ourSig to all
      // subscribers, including the publisher). Once we know our key,
      // walk every per-sig bag and drop the entry stamped with it,
      // emitting peers-changed so show-cell repaints without those
      // pseudo-peer tiles.
      let evicted = 0
      for (const [sig, bag] of this.#peerLayersBySig) {
        if (bag.delete(this.#myPubkey)) {
          evicted++
          const lastSeenBag = this.#peerLastSeenMsBySig.get(sig)
          lastSeenBag?.delete(this.#myPubkey)
          this.#schedulePeersChangedEmit({ sig, pubkey: this.#myPubkey, reason: 'self-evicted-after-pubkey-resolve' })
        }
      }
      if (evicted > 0) {
        slog(`[swarm] resolved myPubkey ${this.#myPubkey.slice(0, 8)}; evicted ${evicted} self-echo entr${evicted === 1 ? 'y' : 'ies'} from peer cache`)
      }
      return true
    } catch {
      return false
    }
  }

  // Boot-time retry wrapper. Signer registers via IoC during module
  // load; depending on bundle order it may not be ready when this
  // drone's constructor schedules the first resolve. Without retry,
  // a missed resolve leaves #myPubkey null for the session and the
  // self-skip at #onEvent never fires — every relay-echoed publish
  // of ours surfaces as a peer tile. Polls until the signer answers
  // or we hit the attempt cap (~10s).
  #resolveMyPubkeyWithRetry = async (attempts: number): Promise<void> => {
    if (this.#myPubkey) return  // already resolved by another caller
    if (await this.#resolveMyPubkey()) return
    if (attempts >= 100) return  // ~10s of retries; give up silently
    setTimeout(() => { void this.#resolveMyPubkeyWithRetry(attempts + 1) }, 100)
  }

  // Wire ourselves to Lineage's `change` events so we follow navigation
  // independently of show-cell's render loop. This is the primary trigger
  // for "current location changed" — fires whenever the user navigates,
  // even before any user input has caused a processor pulse.
  //
  // Gating: also waits for NostrMeshDrone before firing the boot sync.
  // If mesh isn't ready when we fire, #ensureSubscribed silently skips
  // and we'd never subscribe (no further `change` events to retry on
  // when the user is idle on a freshly-loaded location).
  #hookLineageChanges = (attempts: number): void => {
    const lineage = this.#getLineage()
    const sigStore = this.#getSignatureStore()
    const mesh = this.#getMesh()
    if (!lineage || !sigStore || !mesh) {
      if (attempts >= 50) return  // ~5s of retries — give up silently
      setTimeout(() => this.#hookLineageChanges(attempts + 1), 100)
      return
    }
    lineage.addEventListener('change', () => { void this.#syncForCurrentLineage() })
    // Fire once for the current location at boot so we're already
    // subscribed + published before the user navigates anywhere.
    void this.#syncForCurrentLineage()
  }

  #syncForCurrentLineage = async (): Promise<void> => {
    const lineage = this.#getLineage()
    const sigStore = this.#getSignatureStore()
    if (!lineage || !sigStore) { slog('[swarm] syncForCurrentLineage: missing', { lineage: !!lineage, sigStore: !!sigStore }); return }

    // Privacy gate — require BOTH a room and a secret before any swarm
    // network activity. Read live from the canonical stores so we
    // never act on stale local state. Empty either → silent (no
    // subscribe, no publish, no peer entries surface).
    const room = this.#getRoomStore()?.value?.trim() ?? ''
    const secret = this.#getSecretStore()?.value?.trim() ?? ''
    if (!room || !secret) {
      const meshPublic = typeof localStorage !== 'undefined' ? localStorage.getItem('hc:mesh-public') : null
      slog('[swarm] syncForCurrentLineage: room/secret missing — broadcast skipped', { hasRoom: !!room, hasSecret: !!secret, meshPublic })
      return
    }
    slog('[swarm] syncForCurrentLineage: proceeding', { roomLen: room.length, secretLen: secret.length })

    const segsRaw = lineage.explorerSegments?.() ?? []
    // Match show-cell's lineage derivation exactly: trim, drop empty,
    // join with '/'. Then mix in room + secret to form the swarm sig
    // so two peers must share BOTH the path AND the credentials.
    const segments = (Array.isArray(segsRaw) ? segsRaw : [])
      .map((x: unknown) => String(x ?? '').trim())
      .filter((x: string) => x.length > 0)
    const lineageKey = segments.join('/')

    let composedSig = ''
    try {
      // sha256(lineage + '\0' + room + '\0' + secret) — NUL separators
      // prevent any one field bleeding into another (e.g. room='a:b'
      // and secret='' colliding with room='a' and secret='b').
      composedSig = await sigStore.signText(`${lineageKey}\0${room}\0${secret}`)
    } catch { return }
    if (!composedSig) return

    this.#lastSyncInput = { segments, room, secretLen: secret.length, key: `${lineageKey}\0${room}\0${secret}` }
    
    await this.#syncForSig(composedSig)

    // Personal channel publish (subscribe mechanism) — same kind-30200
    // visuals, second sig (`channel:pubkey\0room\0secret`). Subscribers
    // see your tiles wherever you go.
    void this.#publishCurrentVisualsToMyChannel(segments)

    // Presence publish (follow mechanism) — broadcasts our CURRENT
    // pathSegments to our presence channel sig
    // (`presence:pubkey\0room\0secret`). Followers listen here and
    // navigate when we move. Subscribe and follow are independent —
    // either, both, or neither. Subscribe is data-flow; follow is
    // navigation-sync.
    void this.#publishMyPresence(segments)

    // Presence-glow publish — while we're inside a child, re-announce
    // ourselves to the PARENT's sig so peers viewing the parent see a
    // glow on the tile we're exploring. No-op at root. Fire-and-forget.
    void this.#publishPresenceToParent(segments)

    // Initial presence emit — fires once per location after sync sets
    // up, even when nobody else is here. The UI presence banner needs
    // this to render the "first one here" state on cold arrival;
    // without it the banner stays hidden until SOMEONE causes a
    // peer-cache event, and a user alone in a swarm sees nothing.
    // Subsequent peer joins/leaves come through #emitPeersChanged on
    // the normal debounce.
    const peers = this.participantsAtCurrentSig()
    this.emitEffect('swarm:presence-changed', {
      sig: composedSig,
      peerCount: peers.length,
      alone: peers.length === 0,
      peers,
      reason: 'initial-sync',
    })
  }

  // Tear down all per-sig state at the OLD #currentSig (subscriptions,
  // peer cache, last-published memo) and re-run sync at the new
  // composed sig. Called on room/secret changes. Emits
  // swarm:peers-changed so show-cell repaints without the now-orphaned
  // peer entries from the previous credential pair.
  #teardownAndResync = (reason: string): void => {
    for (const sub of this.#subsBySig.values()) {
      try { sub.close() } catch { /* ignore */ }
    }
    this.#subsBySig.clear()
    this.#peerLayersBySig.clear()
    this.#peerLastSeenMsBySig.clear()
    this.#lastPublishedBySig.clear()
    this.#lastPublishTimeMsBySig.clear()
    this.#hiddenByPubkeyBySig.clear()
    this.#lastPublishedHideBySig.clear()
    this.#lastHidePublishTimeMsBySig.clear()
    this.#interestByChildBySig.clear()
    this.#interestSeenBySig.clear()
    this.#myInterestBySig.clear()
    this.#myParentPresenceExpMs.clear()
    // Tear down resource subs and the published-resource memo too —
    // a zone change means a different audience for our resources, so
    // we want to re-assert them in the new zone (and stop fetching
    // resources keyed to the old zone's referrals).
    for (const sub of this.#resourceSubs.values()) {
      try { sub.close() } catch { /* ignore */ }
    }
    this.#resourceSubs.clear()
    this.#publishedResources.clear()
    // Recompute and publish the new zone key so localStorage hide
    // reads + writes land in the new zone's namespace. Empty
    // credentials clear the key so private-mode hides fall back to
    // the (device-scoped) bare key. Synchronous — important so the
    // swarm:peers-changed emit below triggers a render that reads
    // the new zone key, not the stale one.
    this.#updateZoneKey()
    this.emitEffect('swarm:peers-changed', { sig: this.#currentSig, reason })
    this.#currentSig = ''
    void this.#syncForCurrentLineage()
  }

  #syncForSig = async (sig: string): Promise<void> => {
    if (!sig) return

    // Flush state from the OUTGOING lineage when navigation moves us to
    // a different sig. Without this, every visited lineage accumulates a
    // permanent subscription + peer cache, and peer events received at
    // an earlier lineage stay subscribed forever — paying relay
    // bandwidth + memory for state the user can no longer see, and
    // (more visibly) keeping stale tiles in peerLayersBySig for old
    // composed sigs that show-cell's lineage-keyed render cache may
    // surface on a quick nav back. Location change must mean: stop
    // listening here, drop peer state here, then pick up at the new
    // location.
    const prevSig = this.#currentSig
    if (prevSig && prevSig !== sig) {
      const prevSub = this.#subsBySig.get(prevSig)
      if (prevSub) {
        try { prevSub.close() } catch { /* ignore */ }
        this.#subsBySig.delete(prevSig)
      }
      this.#peerLayersBySig.delete(prevSig)
      this.#peerLastSeenMsBySig.delete(prevSig)
      this.#lastPublishedBySig.delete(prevSig)
      this.#lastPublishTimeMsBySig.delete(prevSig)
      this.#hiddenByPubkeyBySig.delete(prevSig)
      this.#interestByChildBySig.delete(prevSig)
      this.#interestSeenBySig.delete(prevSig)
      this.#myInterestBySig.delete(prevSig)
      this.#lastPublishedHideBySig.delete(prevSig)
      this.#lastHidePublishTimeMsBySig.delete(prevSig)
      // Tell show-cell to drop any peer tiles it surfaced for the OLD
      // sig so the render that follows the lineage change starts from
      // a clean peer slate. Without this emit, a render that lands
      // before the new sig's subscription returns events would still
      // see the previous lineage's peer tiles in show-cell's tracked
      // peerCellSet (cleared on next pass but a single stale frame is
      // enough to be visible during fast navigation).
      this.emitEffect('swarm:peers-changed', { sig: prevSig, reason: 'lineage-change-flush' })
    }

    this.#currentSig = sig
    this.#ensureSubscribed(sig)
    // Late-joiner recovery (#48): the live subscription only delivers
    // broadcasts published AFTER we subscribe. If no peer has broadcast at
    // this sig yet, any peers already present here published before us and
    // the relay won't replay those to a new subscriber — so ask the swarm
    // for their cached visuals. Fire-and-forget: never block navigation
    // (real-time supersedes the preloader); injected results emit
    // swarm:peers-changed when they land, and show-cell repaints.
    const existingBag = this.#peerLayersBySig.get(sig)
    if (!existingBag || existingBag.size === 0) void this.#recoverVisualsAt(sig)
    await this.#publishMyLayerAt(sig)
  }

  // -----------------------------------------------------------------
  // Subscribe / receive
  // -----------------------------------------------------------------

  #ensureSubscribed = (sig: string): void => {
    if (this.#subsBySig.has(sig)) return
    const mesh = this.#getMesh()
    if (!mesh?.subscribe) return
    const sub = mesh.subscribe(sig, (evt) => this.#onEvent(sig, evt))
    this.#subsBySig.set(sig, sub)
  }

  // -----------------------------------------------------------------
  // Late-joiner visuals recovery (#48)
  // -----------------------------------------------------------------

  // Ask the swarm for cached visuals at `sig` and inject them as if the
  // original publishes had just arrived. Closes the late-joiner gap: a
  // participant arriving AFTER present peers published never receives
  // those broadcasts over the live subscription. Fire-and-forget;
  // coalesced per sig; visuals only (no bytes — witness, not adopt).
  #recoverVisualsAt = async (sig: string): Promise<void> => {
    if (!sig || this.#visualsRecoveryInFlight.has(sig)) return
    this.#visualsRecoveryInFlight.add(sig)
    try {
      const broker = this.#getBroker()
      if (!broker?.fetchVisualsAt) return
      const entries = await broker.fetchVisualsAt(sig)
      if (!entries || entries.length === 0) return
      // The user may have navigated away during the await — only inject if
      // this is still the current location (matches the flush model: peer
      // state is kept for the current location only).
      if (this.#currentSig !== sig) return
      this.#injectRecoveredVisuals(sig, entries)
    } catch { /* best-effort — recovery is an optimization, never fatal */ }
    finally { this.#visualsRecoveryInFlight.delete(sig) }
  }

  // Inject recovered visuals into the peer cache, mirroring the live
  // #onEvent cache write. Sanitization is MANDATORY here: fetchVisualsAt
  // does none (the broker defers it to "the swarm cache injection point" —
  // this). Live data wins: a pubkey already cached from a live broadcast
  // is left untouched.
  #injectRecoveredVisuals = (
    sig: string,
    entries: readonly { pubkey: string; content: string; tags?: string[][] }[],
  ): void => {
    let bag = this.#peerLayersBySig.get(sig)
    let injected = 0
    const broker = this.#getBroker()
    for (const entry of entries) {
      const pubkey = String(entry.pubkey ?? '').toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(pubkey)) continue
      if (this.#myPubkey && pubkey === this.#myPubkey) continue   // self-echo
      if (bag?.has(pubkey)) continue                              // live data wins
      let raw: unknown
      try { raw = JSON.parse(entry.content) } catch { continue }
      const visualsRaw = (raw as { visuals?: unknown })?.visuals
      if (!Array.isArray(visualsRaw)) continue
      const cleanVisuals: ({ name: string } & Record<string, unknown>)[] = []
      for (const v of visualsRaw) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) continue
        const cleaned = sanitizeVisual(v as Record<string, unknown>)
        if (cleaned) cleanVisuals.push(cleaned)
      }
      if (cleanVisuals.length === 0) continue

      // Domain attribution — recovered entries are the ORIGINAL layer
      // events (pubkey/content/tags preserved by the responder), so the
      // publisher's ['domain', …] tag is attributed per layerSig exactly
      // like the live #onEvent path. A late joiner receives peer tiles
      // through THIS path, not a live broadcast — without this, their
      // adopt had no capture-source host and the tile fell to a root
      // folder instead of jwize.com/<tile>.
      const domainTags = (entry.tags ?? [])
        .filter((t): t is string[] => Array.isArray(t) && String(t[0]) === 'domain' && !!String(t[1] ?? '').trim())
        .map(t => String(t[1]).trim())
      if (domainTags.length && broker?.noteDomainsForSig) {
        for (const v of cleanVisuals) {
          const ls = String(v['layerSig'] ?? '').trim().toLowerCase()
          if (/^[a-f0-9]{64}$/.test(ls)) broker.noteDomainsForSig(ls, domainTags)
        }
      }
      if (!bag) { bag = new Map(); this.#peerLayersBySig.set(sig, bag) }
      bag.set(pubkey, { visuals: cleanVisuals })
      let lastSeenBag = this.#peerLastSeenMsBySig.get(sig)
      if (!lastSeenBag) { lastSeenBag = new Map(); this.#peerLastSeenMsBySig.set(sig, lastSeenBag) }
      lastSeenBag.set(pubkey, Date.now())
      const incomingLabel = typeof (raw as { label?: unknown }).label === 'string'
        ? (raw as { label: string }).label.trim().slice(0, 64).replace(/[\x00-\x1f]/g, '')
        : ''
      if (incomingLabel && incomingLabel !== this.#labelByPubkey.get(pubkey)) {
        this.#labelByPubkey.set(pubkey, incomingLabel)
        this.emitEffect('swarm:label-changed', { pubkey, label: incomingLabel })
      }
      injected++
    }
    if (injected > 0) {
      slog(`[swarm] late-join recovery injected ${injected} peer visual(s) at ${sig.slice(0, 8)}`)
      this.emitEffect('swarm:peers-changed', { sig, reason: 'late-join-recovery' })
    }
  }

  #onEvent = (sig: string, evt: MeshEvtLike): void => {
    // Three kinds reach this callback: layer events (30200) carrying
    // a peer's children list, resource events (30201) carrying image
    // bytes the layer references, and hide events (30202) carrying
    // a peer's per-lineage hide filter. Route each to its own handler;
    // anything else (legacy 29010 paired-channel) falls through.
    const kind = Number(evt?.event?.kind ?? 0)
    slog('[swarm] onEvent received:', { sig: sig.slice(0, 8), kind, fromPubkey: evt?.event?.pubkey?.slice(0, 8), isSelf: this.#myPubkey && evt?.event?.pubkey === this.#myPubkey })

    // ── Freshness gate (layer + hide only) ─────────────────────────
    // Public Nostr relays often ignore NIP-40 expiration and keep
    // events in their REQ cache past `expiration`. Without a client-
    // side check, every new subscriber sees ghost tiles from past
    // sessions until the 135s memory sweep evicts them — exactly the
    // "where do these test tiles come from?" symptom.
    //
    // Two checks, either sufficient to drop the event:
    //   1. Publisher-stamped `expiration` tag is in the past (NIP-40
    //      contract — events with expired tags are no longer valid).
    //   2. `created_at` is older than EVENT_TTL_SECS (fallback for
    //      legacy publishers that didn't tag expiration, or for the
    //      odd relay that strips tags).
    //
    // Resources are content-addressed and putResource verifies sha256
    // on write — a stale resource event is harmless and may still be
    // wanted (an older publish of bytes a newer layer references).
    // So we DON'T gate resources here; gate only layer + hide which
    // carry session-scoped membership state.
    if (kind === SWARM_LAYER_KIND || kind === SWARM_HIDE_KIND || kind === SWARM_INTEREST_KIND || kind === SWARM_SUBSCRIBE_REQUEST_KIND || kind === SWARM_PRESENCE_KIND) {
      const nowSec = Math.floor(Date.now() / 1000)
      const tags = evt?.event?.tags ?? []
      const expirationTag = tags.find(t => t[0] === 'expiration')?.[1]
      if (expirationTag) {
        const expirationSec = Number(expirationTag)
        if (Number.isFinite(expirationSec) && expirationSec <= nowSec) {
          slog('[swarm] onEvent DROPPED: expired', { kind, fromPubkey: evt?.event?.pubkey?.slice(0,8), expirationSec, nowSec, delta: expirationSec - nowSec })
          return
        }
      } else {
        const createdAt = Number(evt?.event?.created_at ?? 0)
        if (Number.isFinite(createdAt) && createdAt > 0 && createdAt + EVENT_TTL_SECS < nowSec) {
          slog('[swarm] onEvent DROPPED: stale created_at', { kind, fromPubkey: evt?.event?.pubkey?.slice(0,8), createdAt, nowSec, ageS: nowSec - createdAt })
          return
        }
      }
    }

    if (kind === SWARM_RESOURCE_KIND) {
      void this.#onResourceEvent(evt)
      return
    }
    if (kind === SWARM_HIDE_KIND) {
      this.#onHideEvent(sig, evt)
      return
    }
    if (kind === SWARM_INTEREST_KIND) {
      this.#onInterestEvent(sig, evt)
      return
    }
    if (kind === SWARM_SUBSCRIBE_REQUEST_KIND) {
      this.#onSubscribeRequest(evt)
      return
    }
    if (kind === SWARM_PRESENCE_KIND) {
      this.#onPresenceEvent(evt)
      return
    }
    if (kind !== SWARM_LAYER_KIND) return

    // Local fanout has no pubkey on the event (the mesh fans the
    // unsigned event before signing). Skip — our own publish already
    // updated #lastPublishedBySig and a self entry doesn't add value.
    const pubkey = String(evt?.event?.pubkey ?? '').trim().toLowerCase()
    if (!pubkey) { slog('[swarm] onEvent DROPPED: no pubkey (local fanout)'); return }

    // Self-skip via relay echo. Until #myPubkey resolves this is a
    // no-op; show-cell's localCellSet dedup catches the overlap.
    if (this.#myPubkey && pubkey === this.#myPubkey) { return }

    // Ordering guard — drop layer events strictly older than the newest
    // we've already applied from this publisher at this sig. See
    // #peerLayerAppliedAtBySigPubkey for the replay-scramble this closes.
    const createdAtSec = Number(evt?.event?.created_at ?? 0)
    if (createdAtSec > 0) {
      const guardKey = `${sig} ${pubkey}`
      const lastApplied = this.#peerLayerAppliedAtBySigPubkey.get(guardKey) ?? 0
      if (createdAtSec < lastApplied) {
        slog('[swarm] onEvent DROPPED: older than applied', { pubkey: pubkey.slice(0, 8), createdAtSec, lastApplied })
        return
      }
      this.#peerLayerAppliedAtBySigPubkey.set(guardKey, createdAtSec)
    }

    const payload = evt?.payload
    if (!payload || typeof payload !== 'object') { slog('[swarm] onEvent DROPPED: payload not object', { pubkey: pubkey.slice(0,8), payloadType: typeof payload }); return }
    const raw = payload as SwarmLayerPayload
    if (!Array.isArray(raw.visuals)) { slog('[swarm] onEvent DROPPED: visuals not array', { pubkey: pubkey.slice(0,8), visualsType: typeof raw.visuals }); return }

    // Sanitize at the trust boundary. Every peer visual is filtered
    // through the closed-shape whitelist BEFORE landing in cache —
    // visualsanitizer drops unknown keys, validates value shapes (sig
    // strings, scalars, length-bounded labels, javascript-URL-rejecting
    // links). Output is a fresh object with only inert content; the
    // raw inbound JSON never reaches any downstream consumer. This
    // applies the user's "visuals can carry no possibility of code
    // injection" invariant at one mechanical chokepoint.
    const cleanVisuals: ({ name: string } & Record<string, unknown>)[] = []
    let droppedCount = 0
    for (const v of raw.visuals) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) { droppedCount++; continue }
      const cleaned = sanitizeVisual(v as Record<string, unknown>)
      if (cleaned) cleanVisuals.push(cleaned)
      else droppedCount++
    }
    if (droppedCount > 0) {
      slog('[swarm] onEvent sanitized', { pubkey: pubkey.slice(0,8), kept: cleanVisuals.length, dropped: droppedCount })
    }
    const layer: SwarmLayerPayload = { visuals: cleanVisuals }

    let bag = this.#peerLayersBySig.get(sig)
    if (!bag) { bag = new Map(); this.#peerLayersBySig.set(sig, bag) }
    const previousLayer = bag.get(pubkey)
    const isNewPeer = previousLayer === undefined
    const layerChanged = isNewPeer ||
      JSON.stringify(previousLayer) !== JSON.stringify(layer)
    bag.set(pubkey, layer)
    slog('[swarm] onEvent CACHED', { sig: sig.slice(0,8), pubkey: pubkey.slice(0,8), visualCount: layer.visuals.length, isNewPeer, layerChanged })

    // Stamp this peer's last-seen time at this sig. Drives the
    // staleness sweep below — peers whose last event is older than
    // PEER_STALE_MS get evicted so their tiles disappear from the
    // canvas without waiting for the user to navigate. The sweep
    // also handles the relay-restart case: stale events in the relay
    // get dropped server-side, but our in-memory cache wouldn't
    // notice without this tracking.
    let lastSeenBag = this.#peerLastSeenMsBySig.get(sig)
    if (!lastSeenBag) { lastSeenBag = new Map(); this.#peerLastSeenMsBySig.set(sig, lastSeenBag) }
    lastSeenBag.set(pubkey, Date.now())

    // Domain attribution — the publisher advertised their host as a
    // ['domain', …] tag (mirroring the broker's 30401 responses). Record it
    // against each visual's layerSig in the broker's address graph, so an
    // adopt-click's getKnownDomains(layerSig) answers "which host serves
    // this tile" — that's what files the adopt under its capture-source
    // folder (jwize.com/dolphin) and gives the installer an HTTP-direct
    // byte path. Must run BEFORE the auto-adopt emit below, which reads the
    // attribution synchronously. Untrusted input: it only ever adds a
    // Tier-2 fetch candidate; sha256 still gates every byte.
    const domainTags = (evt?.event?.tags ?? [])
      .filter((t): t is string[] => Array.isArray(t) && String(t[0]) === 'domain' && !!String(t[1] ?? '').trim())
      .map(t => String(t[1]).trim())
    if (domainTags.length) {
      const broker = this.#getBroker()
      if (broker?.noteDomainsForSig) {
        for (const v of cleanVisuals) {
          const ls = String(v['layerSig'] ?? '').trim().toLowerCase()
          if (/^[a-f0-9]{64}$/.test(ls)) broker.noteDomainsForSig(ls, domainTags)
        }
      }
    }

    // Auto-resource-pull DISABLED for the exploration-first model.
    // Visuals carry only inert metadata (names, accents, tags, hideText),
    // which is safe to render from any peer in the swarm. Image bytes,
    // layer bytes, and dependency code are gated behind explicit user
    // action (adopt, or per-participant auto-adopt opt-in below) — a
    // peer publishing a malicious imageSig should NOT trigger us to
    // fetch their bytes into our OPFS just because we saw their visuals.

    // Label parse + cache. Length-capped, non-control-char string.
    // Empty / oversized / nested values are dropped silently. The cache
    // is keyed by pubkey only — same label across every sig the peer
    // appears at (it's per-participant, not per-location).
    const incomingLabel = typeof (raw as { label?: unknown }).label === 'string'
      ? (raw as { label: string }).label.trim().slice(0, 64).replace(/[\x00-\x1f]/g, '')
      : ''
    if (incomingLabel && incomingLabel !== this.#labelByPubkey.get(pubkey)) {
      this.#labelByPubkey.set(pubkey, incomingLabel)
      this.emitEffect('swarm:label-changed', { pubkey, label: incomingLabel })
    }

    // Follow is DETECTION-ONLY (safety layer — nothing auto-adopts). When a
    // peer we follow republishes, SURFACE that they have updates; never commit.
    // Acceptance is a participant action in the installer — this only lights the
    // signal. (Was "Follow == auto-adopt", which folded the followed peer's
    // content into our tree on every republish with zero gesture in the moment;
    // removed per the manual-update safety rule — same class as the dropped
    // RegistrySnapshot auto-fold, but worse since not even a per-item click.)
    if (layerChanged && this.subscribedTo() === pubkey) {
      const names = layer.visuals
        .map(v => String((v as { name?: unknown }).name ?? '').trim())
        .filter(n => n.length > 0)
      if (names.length > 0) {
        this.emitEffect('swarm:follow-updated', { pubkey, sig, names })
      }
    }
    void layerChanged  // silence unused if neither branch ran

    // Tell renderers about the new/changed peer so they repaint without
    // waiting for the user to navigate or interact. Show-cell's mesh
    // callback was previously the trigger, but it now ignores swarm-
    // kind events to avoid render churn — so the swarm has to surface
    // its own state-changed signal here. Suppressed when nothing about
    // this peer's layer actually changed (replaceability echoes), and
    // debounced so a publisher's subtree-publish burst (~10–30 events)
    // collapses to a single render trigger instead of cancelling
    // show-cell's render mid-flight on each event.
    if (layerChanged) {
      this.#schedulePeersChangedEmit({
        sig,
        pubkey,
        reason: isNewPeer ? 'peer-arrived' : 'layer-updated',
      })
    }
  }

  #schedulePeersChangedEmit = (payload: { sig: string; pubkey: string; reason: string }): void => {
    if (this.#peersChangedTimer !== null) return  // already queued for this burst
    this.#peersChangedTimer = setTimeout(() => {
      this.#peersChangedTimer = null
      this.emitEffect('swarm:peers-changed', payload)
      // Convenience presence signal — UI doesn't have to compute the
      // count itself or know about peerLayersBySig. Emitted alongside
      // peers-changed; same debounce window so a burst of joins/leaves
      // collapses to one presence emit per ~150ms.
      //
      // `alone` = no live peers at this sig OTHER than ourselves
      // (participantsAtCurrentSig already excludes self + stale).
      // UI uses this for "you're the first one in here" indicators
      // when a user navigates into an empty location, and updates
      // when a host arrives.
      if (payload.sig === this.#currentSig) {
        const peers = this.participantsAtCurrentSig()
        this.emitEffect('swarm:presence-changed', {
          sig: payload.sig,
          peerCount: peers.length,
          alone: peers.length === 0,
          peers,
          reason: payload.reason,
        })
      }
    }, 150)
  }

  /** Debounce token for "republish my current layer because something
   *  changed in a child's 0000 (or a cell was added)." Bursts of
   *  writes coalesce into one publish at the trailing edge. */
  #propsRepublishTimer: ReturnType<typeof setTimeout> | null = null

  // A tile created in a swarm is public by default so the swarm can
  // collaborate on it. Gated on the SAME room+secret check as every other
  // swarm network action (see #syncForCurrentLineage): outside a swarm a
  // create leaves the tile private — the per-tile public/private flag is
  // a self-facing world-mode marker and must stay opt-in there. The
  // isCellPublic guard makes this idempotent: a re-emitted cell:added (e.g.
  // tagging an already-public tile) or a tile already covered by a public
  // branch is a no-op, so we never churn a resync for nothing.
  #autoPublishInSwarm = (payload: { cell?: string; segments?: readonly string[] }): void => {
    const cell = String(payload?.cell ?? '').trim()
    if (!cell) return
    const room = this.#getRoomStore()?.value?.trim() ?? ''
    const secret = this.#getSecretStore()?.value?.trim() ?? ''
    if (!room || !secret) return  // not in a swarm — stay private by default
    const segsRaw = payload?.segments
    const segments = (Array.isArray(segsRaw) ? segsRaw : [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    // Same location string the publish paths feed isCellPublic (see
    // #publishCurrentVisualsToMyChannel) so the marker and the broadcast
    // filter agree on the key.
    const location = '/' + segments.join('/')
    if (isCellPublic(location, cell)) return
    setCellPublic(location, cell, true)
    // Reuse the world-mode make-public signal: our own listener runs a full
    // #syncForCurrentLineage (kind 30200 layer slot + personal channel), and
    // show-cell / tile-overlay drop the world-mode dim on the now-public tile.
    EffectBus.emit('tile:public-changed', { cell, location, public: true })
  }

  #schedulePropsRepublish = (): void => {
    if (!this.#currentSig) return
    if (this.#propsRepublishTimer !== null) return  // already queued
    this.#propsRepublishTimer = setTimeout(() => {
      this.#propsRepublishTimer = null
      void this.#publishMyLayerAt(this.#currentSig)
    }, 250)
  }

  // -----------------------------------------------------------------
  // Publish
  // -----------------------------------------------------------------

  // Re-entry/coalesce guard for the subtree-sign publish walk. The walk is
  // CPU-heavy (SHA-256 per node) and fires TWICE per navigation (Lineage
  // 'change' + the per-render mesh:ensure-started heartbeat); unguarded,
  // concurrent walks stacked up and starved the main thread — compounding the
  // atlas GPU leak into the root↔content navigation lock-up.
  #publishInFlight = false
  #publishPending = false

  #publishMyLayerAt = async (sig: string): Promise<void> => {
    const mesh = this.#getMesh()
    const sigStore = this.#getSignatureStore()
    if (!mesh?.publish || !sigStore) { slog('[swarm] publishMyLayerAt: missing mesh/sigStore', { mesh: !!mesh?.publish, sigStore: !!sigStore }); return }

    // A walk is already running — don't start a second. Mark pending so we
    // re-run ONCE when it finishes, with fresh location/state.
    if (this.#publishInFlight) { this.#publishPending = true; return }

    // Resolve the lineage's directory ourselves from Store.hypercombRoot
    // rather than calling lineage.explorerDir() — see LineageLike comment.
    // When the current lineage has no OPFS dir (sub-layer that exists in
    // the layer tree but never got a physical directory), we still want
    // to publish — #publishSubtree reads children from the layer, not the
    // OPFS dir, so name+props transport works without a dir. Recursion
    // into child subtrees is gated downstream; null dir just stops the
    // walk at this level, which is the correct behavior.
    const dir = await this.#resolveLineageDir()
    slog('[swarm] publishMyLayerAt:', { sig: sig.slice(0, 8), dirName: dir?.name ?? '(no-opfs-dir)' })

    const lineage = this.#getLineage()
    const segsRaw = lineage?.explorerSegments?.() ?? []
    const segments = (Array.isArray(segsRaw) ? segsRaw : [])
      .map((x: unknown) => String(x ?? '').trim())
      .filter((x: string) => x.length > 0)

    // Critical: pass the SAME room + secret used to compute the swarm
    // subscription sig down into the subtree publisher. Without this,
    // #publishSubtree would compute raw lineage sigs (sha256(path))
    // while my subscription is at the composed sig (sha256(path room
    // secret)), and the two would never align — publisher writes one
    // address, subscriber listens on another. Bug observed in test:
    // both peers subscribed to 02448d19, both published to e3b0c442,
    // peer caches stayed empty forever.
    const room = this.#getRoomStore()?.value?.trim() ?? ''
    const secret = this.#getSecretStore()?.value?.trim() ?? ''
    if (!room || !secret) return

    const counter = { count: 0 }
    // Hold the in-flight flag for the WHOLE walk (it's fire-and-forget, so we
    // clear it in finally, not at method return). On completion, if another
    // trigger arrived mid-walk, re-run exactly once with the CURRENT sig.
    this.#publishInFlight = true
    this.#publishSubtree(dir, segments, 0, counter, sigStore, mesh, room, secret)
      .catch(() => undefined)
      .finally(() => {
        this.#publishInFlight = false
        if (this.#publishPending) {
          this.#publishPending = false
          void this.#publishMyLayerAt(this.#currentSig)
        }
      })
    void sig  // sig recomputed inside #publishSubtree from segments+room+secret
  }

  #publishSubtree = async (
    dir: FileSystemDirectoryHandle | null,
    segments: readonly string[],
    depth: number,
    counter: { count: number },
    sigStore: SignatureStoreLike,
    mesh: MeshApi,
    room: string,
    secret: string,
  ): Promise<void> => {
    if (counter.count >= MAX_PUBLISH_NODES) return
    this.#publishStats.walkNodeVisits++

    // Composed sig — must match the formula in #syncForCurrentLineage
    // exactly so subscribers and publishers address the same slot.
    const key = `${segments.join("/")}\0${room}\0${secret}`
    let sig = ''
    try { sig = await sigStore.signText(key) } catch { return }
    if (!sig) return

    // Source of truth for what to publish: the layer's children list,
    // NOT a raw OPFS walk. Reasoning (memory: project_layer_is_primitive):
    //
    //   The layer holds canonical primitives (children, notes, etc.) — it's
    //   what survives across history scrubs, undo/redo, peer adoption, and
    //   merkle cascades. OPFS dirs are secondary storage: they may include
    //   orphans that were never committed (failed add flow, manual file
    //   poking) or stale dirs from undone deletions whose entry in the
    //   layer was dropped but whose folder lingers. Publishing those
    //   leaks "rogue tiles" to peers — exactly the symptom the user has
    //   been seeing: an InPrivate window joining the mesh fills with
    //   tiles the host never canonically shared.
    //
    // Fallback: if the lineage has no committed layer yet (a brand-new
    // location), fall back to listLocalChildren so first-publish still
    // works before any commit lands. Subsequent commits replace this
    // path with the layer-driven list.
    // {name, layerSig?} — layerSig is only known on the layer-driven
    // path. OPFS-fallback children have no sig (the layer hasn't been
    // committed yet), so the wire payload omits layerSig for those.
    // Subscribers tolerate either shape. Shared with the retraction walk
    // (#wipeSubtree) so both honour the exact same source of truth.
    let childRefs = await this.#resolveChildRefs(dir, segments)

    // ── PUBLIC FILTER ─────────────────────────────────────────────────
    // Broadcast ONLY the public subset. Private children (and private
    // branches) are pruned here — and because childNames (recursion) derives
    // from childRefs, private branches are never walked or published either,
    // so private content never leaves the device. Public is participant-local
    // and is NEVER folded into the signed layer (keeps the rendezvous sig
    // stable across peers — same invariant as `hidden`). isCellPublic is
    // branch-aware: a public-branch root covers all its descendants.
    //
    // Capture the PRUNED names too. A child that just flipped
    // public→private would otherwise simply vanish from the recursion,
    // leaving any slot we already published for its subtree lingering on
    // the relay until its ~90s NIP-40 expiry — a peer sitting inside the
    // branch keeps seeing our retracted tiles. We recurse into those in
    // retraction mode (#wipeSubtree) below to replace them with empty
    // payloads at once.
    const publicLocation = '/' + segments.join('/')
    const prunedNames: string[] = []
    const filteredRefs: { name: string; layerSig?: string }[] = []
    for (const c of childRefs) {
      if (isCellPublic(publicLocation, c.name)) filteredRefs.push(c)
      else prunedNames.push(c.name)
    }
    childRefs = filteredRefs
    const childNames = childRefs.map(c => c.name)  // legacy local var — still used by recursion + log

    // Publish one entry per child — flat: { name, ...0000_fields }.
    //   name        — lineage leaf, identifies which child this is
    //   ...rest     — every first-class cell property from the child's
    //                 canonical 0000 (index, imageSig, small.image, tags,
    //                 link, …) inlined directly. No `props` wrapper —
    //                 these ARE the cell properties; nesting them under
    //                 `props` would be dead weight on the wire AND force
    //                 every receiver (render, adopt) to do an extra
    //                 unwrap before reaching the actual data.
    //
    // Image bytes referenced inside the 0000 (typically as `small.image`
    // or top-level `imageSig`) still ride kind 30201 as separate
    // resource events — heavy binary content doesn't get inlined. The
    // resource walk below (`collectNestedSigs(c, referenced)`) finds
    // every sig in the flat visual and ships the bytes ahead of the
    // layer event so subscribers see referenced resources land first.
    //
    // The substrate-fallback imageSig synthesis is gone. A peer running
    // pure substrate fill on a label-only tile no longer ships an
    // arbitrary chosen image across the wire; the receiver sees a
    // label-only tile until adopt, then their own substrate picks.
    // Matches user intent: only intentionally-placed images travel.
    //
    // Read each child's properties through the canonical preloaded
    // path — same primitive (`readTilePropertiesAt`) that show-cell
    // uses for render. Mechanical integrity: render and share read the
    // same bytes from the same cache, so the same logical tile produces
    // the same on-wire props. The chain `history.sign → currentLayerAt
    // → store.getResource` is preloader-warmed for the current
    // location's children (the user is here, they've been rendered),
    // so this is a string of cache hits in the normal case.
    //
    // canonicaliseValue is kept as belt-and-braces — bytes written
    // through writeTilePropertiesAt are already canonical (it sorts
    // shallow at write time), so re-canonicalizing the parsed object
    // is a no-op for that path and recovers any legacy 0000 written
    // before the canonicalizer existed.
    type ChildEntry = { name: string; layerSig?: string } & Record<string, unknown>
    const children: ChildEntry[] = await Promise.all(childRefs.map(async ({ name, layerSig }): Promise<ChildEntry> => {
      const base = layerSig ? { name, layerSig } : { name }
      let visual: ChildEntry = base
      try {
        const props = await readTilePropertiesAt(segments, name)
        if (props && Object.keys(props).length > 0) {
          // Canonicalize the merged shape so the whole visual entry
          // is deterministic, not just the props portion.
          visual = canonicaliseValue({ ...base, ...props }) as ChildEntry
        }
      } catch { /* no props yet — name-only publish */ }
      // Surface a swarm:invite junction's bundle sig on the wire so observers
      // can show the invite icon and switch in. Gated by the SYNC decoration
      // index so the (cold) listDecorations read only fires for tiles that
      // actually carry one — sig-only, like every other field here.
      try {
        if (kindsForLabel(name).includes(SWARM_INVITE_KIND)) {
          const decos = await listDecorations<{ bundleSig?: string }>({ kind: SWARM_INVITE_KIND, segments: [...segments, name] })
          const bundleSig = String(decos[0]?.record?.payload?.bundleSig ?? '').toLowerCase()
          if (/^[0-9a-f]{64}$/.test(bundleSig)) visual = { ...visual, inviteSig: bundleSig } as ChildEntry
        }
      } catch { /* no invite on this tile */ }
      return visual
    }))
    // Stamp our chosen label onto the payload so participants can render
// "Alice's tiles" next to peer entries without a separate subscription.
// Length-capped + plain-text (no nested objects/arrays), so the worst
// a malicious peer can do is spoof someone else's chosen text — they
// can't escape the visual sanitizer that filters this on receive.
const myLabel = this.#readMyLabel()
const payload: SwarmLayerPayload = myLabel
  ? { label: myLabel, visuals: children }
  : { visuals: children }

    // Empty-visual publishes only matter where they can REMOVE something
    // (a peer may hold our earlier non-empty layer at this sig — "empty-
    // array = wiped slot") or at the CURRENT location (depth 0), where
    // the event doubles as presence: "I'm here, contributing nothing."
    // A descendant level with nothing to share and nothing previously
    // shared says nothing to anyone — and these were 78% of a content-
    // rich navigation burst (142 of 182 layer events in a live capture),
    // the bulk of what blew the relay's per-IP message budget.
    if (children.length === 0 && depth > 0 && !this.#lastPublishedBySig.has(sig)) return

    // Dedupe — only publish if our local layer at this sig has actually
    // changed since the last publish, OR enough wall-clock time has
    // passed that our NIP-40 expiration is about to lapse. Without the
    // time check, an idle peer's event would expire from the relay
    // even while the peer is still present at the lineage, because
    // unchanged payloads were silently skipped.
    const serialized = JSON.stringify(payload)
    const nowMs = Date.now()
    const lastTimeMs = this.#lastPublishTimeMsBySig.get(sig) ?? 0
    const elapsedSinceLast = nowMs - lastTimeMs
    const heartbeatDue = elapsedSinceLast >= LAYER_REFRESH_MS
    const contentChanged = this.#lastPublishedBySig.get(sig) !== serialized
    slog('[swarm] publishSubtree:', { sig: sig.slice(0, 8), depth, childCount: children.length, childNames, contentChanged, heartbeatDue, willPublish: contentChanged || heartbeatDue })
    if (contentChanged || heartbeatDue) {
      this.#lastPublishedBySig.set(sig, serialized)
      this.#lastPublishTimeMsBySig.set(sig, nowMs)
      counter.count++

      // SIG-ONLY ON THE WIRE. The visuals inline each child's 0000, and any
      // image inside it travels as a SIGNATURE (small.image / flat.small.
      // image / imageSig) — never bytes. Receivers pick the bytes up at
      // RUNTIME on request: getResource resolves memory → OPFS → host
      // HTTP-direct, so only images someone actually asked for move, and
      // they come from a host, not the mesh. The previous proactive
      // kind-30201 broadcast (ship every referenced resource's bytes ahead
      // of the layer event) bloated the relay with content nobody may ever
      // request and violated the layer-sigs-only mesh doctrine — removed.
      // (#publishResource below is retained for a future REQUEST-driven
      // ship path only; it has no proactive callers.)

      // Now the layer itself. d-tag = lineage sig
      // (parameterized-replaceable per pubkey+kind+lineage). NIP-40
      // expiration drops the slot if our heartbeat lapses, so a
      // peer who closes their tab silently disappears from the
      // swarm within EVENT_TTL_SECS.
      const expirationSecs = Math.floor(nowMs / 1000) + EVENT_TTL_SECS
      const tags: string[][] = [
        ['d', sig],
        ['expiration', String(expirationSecs)],
      ]
      // Attribute our advertised host so receivers learn WHERE these tiles'
      // bytes live (the adopt's capture-source folder + byte path).
      const selfDomain = this.#readSelfDomain()
      if (selfDomain) tags.push(['domain', selfDomain])
      this.#publishStats.wireEvents++
      await mesh.publish(SWARM_LAYER_KIND, sig, payload, tags)
    }

    if (depth >= MAX_PUBLISH_DEPTH) return

    // Walk children in parallel. Each child's subtree publish is
    // independent (different lineage sig, different referenced
    // resources). Sequential awaiting was the second cause of
    // "only the top tile shows": at root with five children, each
    // taking ~500ms to publish its own resources+layer, the depth-3
    // node didn't see its layer event for 2-3 seconds. Promise.all
    // fires every subtree concurrently. The shared MAX_PUBLISH_NODES
    // counter may overshoot slightly (each recursion checks the cap
    // at its own start), but that's a soft bound, not a hard one.
    const subtreeWork: Promise<void>[] = []
    for (const childName of childNames) {
      if (counter.count >= MAX_PUBLISH_NODES) break
      // When the parent has no OPFS dir, child recursion can't walk
      // physical directories — pass null and let the child level read
      // its layer-state directly. Same layer-as-primitive treatment as
      // the level we're publishing now.
      let childDir = null
      if (dir) {
        try { childDir = await dir.getDirectoryHandle(childName, { create: false }) }
        catch { childDir = null }
      }
      subtreeWork.push(this.#publishSubtree(
        childDir,
        [...segments, childName],
        depth + 1,
        counter,
        sigStore,
        mesh,
        room,
        secret,
      ))
    }
    // Retraction pass — walk children the public filter pruned. Each call
    // self-gates on #lastPublishedBySig, so children we never shared cost a
    // single sign and stop without a layer resolve; only a branch that was
    // actually published (it just flipped public→private) gets an empty
    // (wipe) payload that retracts it from peers immediately.
    for (const prunedName of prunedNames) {
      if (counter.count >= MAX_PUBLISH_NODES) break
      let prunedDir: FileSystemDirectoryHandle | null = null
      if (dir) {
        try { prunedDir = await dir.getDirectoryHandle(prunedName, { create: false }) }
        catch { prunedDir = null }
      }
      subtreeWork.push(this.#wipeSubtree(
        prunedDir,
        [...segments, prunedName],
        depth + 1,
        counter,
        sigStore,
        mesh,
        room,
        secret,
      ))
    }
    await Promise.all(subtreeWork)
  }

  // Resolve the children to publish at `segments`: the current layer's
  // children list (layer-as-primitive), each child sig resolved to its
  // name AND its layerSig (the merkle handle peers pull deeper with).
  // Fallback: a brand-new location with no committed layer yet reads OPFS
  // dirs so the first publish works before the history cascade lands; an
  // OPFS-fallback child has no sig, so its layerSig is omitted. Shared by
  // the publish walk (#publishSubtree) and the retraction walk
  // (#wipeSubtree) so both honour the exact same source of truth.
  #resolveChildRefs = async (
    dir: FileSystemDirectoryHandle | null,
    segments: readonly string[],
  ): Promise<{ name: string; layerSig?: string }[]> => {
    const lineage = this.#getLineage()
    const history = this.#getHistory()
    if (history?.sign && history?.currentLayerAt && history?.getLayerBySig) {
      try {
        const locationSig = await history.sign({
          domain: lineage?.domain,
          explorerSegments: () => segments,
        } as LineageLike)
        const layer = await history.currentLayerAt(locationSig)
        const childSigs = Array.isArray(layer?.children) ? layer.children : []
        slog('[swarm] resolveChildRefs: layer resolve', { segments, locationSig: locationSig?.slice(0, 8), layerExists: layer !== null, childSigCount: childSigs.length })
        if (childSigs.length === 0 && layer == null) {
          // No layer yet — first publish at this location. Fall back to
          // OPFS so the initial commit's tiles propagate before history
          // cascade lands. When the lineage has no OPFS dir either
          // (sub-layer never minted a physical directory) there's
          // literally nothing to publish at this level — empty list.
          const names = dir ? await listLocalChildren(dir) : []
          slog('[swarm] resolveChildRefs: layer null → OPFS fallback', { childNames: names, hadDir: !!dir })
          return names.map(name => ({ name }))
        }
        // Layer exists (possibly empty children). Resolve each child sig
        // to its `name` AND preserve the sig as the merkle handle — peers
        // receive {name, layerSig} and can call swarm.requestSubtree(
        // layerSig) to pull deeper via broker.
        const resolved = await Promise.all(childSigs.map(async (cs) => {
          try {
            const child = await history.getLayerBySig(cs)
            return typeof child?.name === 'string' && child.name.length > 0
              ? { name: child.name, layerSig: cs }
              : null
          } catch { return null }
        }))
        const refs = resolved.filter((n): n is { name: string; layerSig: string } => n !== null)
        const droppedCount = resolved.length - refs.length
        if (droppedCount > 0) {
          slog('[swarm] resolveChildRefs: dropped unresolved child sigs', { droppedCount, totalChildSigs: childSigs.length, resolvedNames: refs.map(c => c.name) })
        }
        return refs
      } catch (err) {
        // History resolve failed for any reason — fall back to OPFS so
        // we don't silently stop publishing.
        slog('[swarm] resolveChildRefs: history resolve threw → OPFS fallback', { err: String(err) })
        const names = dir ? await listLocalChildren(dir) : []
        return names.map(name => ({ name }))
      }
    }
    slog('[swarm] resolveChildRefs: no history service → OPFS fallback', { dirName: dir?.name ?? '(none)' })
    const names = dir ? await listLocalChildren(dir) : []
    return names.map(name => ({ name }))
  }

  // Retract a subtree we previously published but that just became private
  // (the parent's public filter pruned it). Walks the SAME nodes we
  // published when the branch was public — public/private is participant-
  // local, so the layer's child lists are unchanged — and replaces each
  // previously-published slot with an empty payload (the agreed "wiped
  // slot / soft leave" signal, same shape the existing depth>0 wipe guard
  // emits). A peer sitting inside the branch (subscribed to a deeper
  // slot's sig) drops our tiles on receipt instead of waiting out the
  // ~90s NIP-40 expiry.
  //
  // Cheap by construction: a node whose sig we never published self-gates
  // and returns before any layer resolve. And because publishing any
  // descendant requires having published the whole path to it, a node we
  // never published can have no published descendants either — so we stop
  // the walk there without missing a deeper slot. This also makes a
  // public grandchild under a now-private parent retract correctly: it was
  // unreachable for publishing while the ancestor is private (the parent
  // filter stops the publish walk there), so wiping its slot matches the
  // going-public direction, which never published it.
  #wipeSubtree = async (
    dir: FileSystemDirectoryHandle | null,
    segments: readonly string[],
    depth: number,
    counter: { count: number },
    sigStore: SignatureStoreLike,
    mesh: MeshApi,
    room: string,
    secret: string,
  ): Promise<void> => {
    if (counter.count >= MAX_PUBLISH_NODES) return
    this.#publishStats.walkNodeVisits++

    const key = `${segments.join("/")}\0${room}\0${secret}`
    let sig = ''
    try { sig = await sigStore.signText(key) } catch { return }
    if (!sig) return
    // Never published here → nothing of ours lingers on the relay, and
    // nothing below was published either (a descendant publish implies a
    // published path to it). Stop without resolving the layer.
    if (!this.#lastPublishedBySig.has(sig)) return

    // Replace our slot with the empty "wiped slot" payload. Keep our label
    // so peers attribute the now-empty slot to us rather than treating it
    // as a brand-new participant.
    const myLabel = this.#readMyLabel()
    const payload: SwarmLayerPayload = myLabel ? { label: myLabel, visuals: [] } : { visuals: [] }
    const nowMs = Date.now()
    const expirationSecs = Math.floor(nowMs / 1000) + EVENT_TTL_SECS
    const tags: string[][] = [
      ['d', sig],
      ['expiration', String(expirationSecs)],
    ]
    const selfDomain = this.#readSelfDomain()
    if (selfDomain) tags.push(['domain', selfDomain])
    counter.count++
    this.#publishStats.wireEvents++
    await mesh.publish(SWARM_LAYER_KIND, sig, payload, tags)
    // Forget the slot so the next pass self-gates here (the membership
    // check above) and we never re-walk this now-private branch. The empty
    // event we just sent already retracted it for live + late subscribers.
    this.#lastPublishedBySig.delete(sig)
    this.#lastPublishTimeMsBySig.delete(sig)

    if (depth >= MAX_PUBLISH_DEPTH) return
    // Recurse into the same children we published when this branch was
    // public and wipe their slots too. Each self-gates, so never-published
    // private descendants cost one sign and stop.
    const childRefs = await this.#resolveChildRefs(dir, segments)
    const wipeWork: Promise<void>[] = []
    for (const { name } of childRefs) {
      if (counter.count >= MAX_PUBLISH_NODES) break
      let childDir: FileSystemDirectoryHandle | null = null
      if (dir) {
        try { childDir = await dir.getDirectoryHandle(name, { create: false }) }
        catch { childDir = null }
      }
      wipeWork.push(this.#wipeSubtree(
        childDir,
        [...segments, name],
        depth + 1,
        counter,
        sigStore,
        mesh,
        room,
        secret,
      ))
    }
    await Promise.all(wipeWork)
  }

  // -----------------------------------------------------------------
  // Resource streaming
  // -----------------------------------------------------------------

  // Publish the bytes for `sig` as a kind-30201 event so peers
  // subscribed to that sig get the content. Skips when we've already
  // published this sig recently enough that the relay's NIP-40
  // expiration is still in the future with buffer to spare — the
  // relay's parameterized-replaceable slot still has the latest copy.
  // Re-fires when the buffer threshold elapses so a long-running
  // publisher's resources don't disappear from the relay.
  //
  // If the bytes parse as a JSON object that references further
  // signature-shaped strings (the substrate's propsSig blob does
  // exactly this — it lists pointSig + flatSig in its body), we
  // recursively publish each sub-resource too. Without recursion the
  // receiver would get a propsSig blob with dangling references.
  #publishResource = async (sig: string, mesh: MeshApi): Promise<void> => {
    if (!sig) return
    const nowMs = Date.now()
    const lastMs = this.#publishedResources.get(sig)
    // Skip when the last publish is recent enough that the relay
    // still has the slot with comfortable buffer remaining.
    if (lastMs !== undefined && (nowMs - lastMs) < (RESOURCE_TTL_SECS * 1000 - RESOURCE_REPUBLISH_BUFFER_MS)) return
    const store = this.#getStore()
    if (!store?.getResource) return
    let blob: Blob | null = null
    try { blob = await store.getResource(sig) } catch { return }
    if (!blob) return
    const buf = await blob.arrayBuffer()
    if (buf.byteLength > MAX_RESOURCE_BYTES) {
      console.warn('[swarm] skipping resource publish — exceeds cap', { sig: sig.slice(0, 12), bytes: buf.byteLength })
      // Mark as "published" with a far-future timestamp so we don't
      // retry every layer change for an oversized blob.
      this.#publishedResources.set(sig, nowMs + RESOURCE_TTL_SECS * 1000)
      return
    }
    // Mark BEFORE the network publish — without this, concurrent
    // layer-fanout passes for the same sig would race past the skip
    // check above and re-publish the same content.
    this.#publishedResources.set(sig, nowMs)
    const content = arrayBufferToBase64(buf)
    const expirationSecs = Math.floor(nowMs / 1000) + RESOURCE_TTL_SECS
    try {
      await mesh.publish(SWARM_RESOURCE_KIND, sig, content, [
        ['d', sig],
        ['expiration', String(expirationSecs)],
      ])
    } catch (err) {
      console.warn('[swarm] publishResource failed', { sig: sig.slice(0, 12), err })
      // Roll back so a future call retries instead of indefinitely
      // marking this sig as published.
      this.#publishedResources.delete(sig)
      return
    }

    // Recurse into nested signature references. Only valid for JSON
    // payloads; non-JSON blobs (images, binary) fail the parse and
    // we stop. The walk is bounded by the propsSig graph shape —
    // there's no cycle risk because resources are content-addressed
    // (a sig that referenced itself would be a sha256 fixed point).
    //
    // IMPORTANT: await the nested chain. The whole bundle (layer +
    // every resource transitively referenced) must be in the relay
    // before the layer event publishes. Without await, a synthesized
    // propsBlob containing `small.image: <imageSig>` would publish,
    // the parent #publishSubtree would move on to publish the layer,
    // and a clean receiver (incognito, empty OPFS) would land the
    // layer + propsBlob, fire REQ for <imageSig>, get EOSE because
    // the image publish hadn't started yet. Promise.all keeps the
    // siblings parallel; await makes the parent wait for the
    // whole subtree.
    try {
      const text = new TextDecoder().decode(buf)
      const parsed = JSON.parse(text)
      const nested = new Set<string>()
      collectNestedSigs(parsed, nested)
      nested.delete(sig)
      await Promise.all([...nested].map(sub => this.#publishResource(sub, mesh)))
    } catch { /* not JSON — leaf resource */ }
  }

  // Walk a received layer's inlined props for image sigs (or any
  // other nested content-addressed reference); for each we don't
  // already have locally, subscribe by sig so the companion resource
  // event lands and `#onResourceEvent` writes the bytes to OPFS. The
  // subscription is closed inside the handler once the resource is
  // persisted, keeping the per-shell sub count bounded.
  //
  // The 0000 itself is inlined in the layer event — no fetch needed.
  // Only the binary content the 0000 references (images, future
  // attachments) ride kind 30201.
  #pullResourcesFromLayer = async (layer: SwarmLayerPayload): Promise<void> => {
    const store = this.#getStore()
    const mesh = this.#getMesh()
    if (!store?.getResource || !mesh?.subscribe) return
    const needed = new Set<string>()
    for (const v of layer.visuals) {
      if (v && typeof v === 'object') {
        // Walk the whole flat visual entry for nested image sigs.
        // collectNestedSigs handles arbitrary depth so small.image,
        // flat.small.image, etc. all get found in one pass.
        collectNestedSigs(v, needed)
      }
    }
    for (const sig of needed) {
      if (this.#resourceSubs.has(sig)) continue
      let existing: Blob | null = null
      try { existing = await store.getResource(sig) } catch { /* fall through */ }
      if (existing) continue
      const sub = mesh.subscribe(sig, (evt) => void this.#onResourceEvent(evt))
      this.#resourceSubs.set(sig, sub)
    }
  }

  // Resource arrival path. Verifies the bytes against the d-tag sig
  // (Store.putResource computes its own sha256 — a mismatch tells us
  // the peer published bad bytes and we discard rather than persist).
  // On success, emits `swarm:resource-arrived` so substrate / show-
  // cell can re-resolve any tile that was waiting on this sig.
  #onResourceEvent = async (evt: MeshEvtLike): Promise<void> => {
    const kind = Number(evt?.event?.kind ?? 0)
    if (kind !== SWARM_RESOURCE_KIND) return
    const tags = evt?.event?.tags ?? []
    const dTag = tags.find(t => t[0] === 'd')?.[1] ?? ''
    if (!dTag) return
    const sig = String(dTag).toLowerCase()

    const content = String(evt?.event?.content ?? '')
    if (!content) return

    const store = this.#getStore()
    if (!store?.putResource) return

    let bytes: ArrayBuffer
    try { bytes = base64ToArrayBuffer(content) } catch { return }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESOURCE_BYTES) return

    const blob = new Blob([bytes])
    let writtenSig = ''
    try { writtenSig = await store.putResource(blob) } catch { return }
    if (writtenSig !== sig) {
      // Defence: malicious peer published bytes whose sig doesn't
      // match the d-tag they claimed. OPFS now holds the bytes under
      // their REAL sig (which is fine — content-addressed), but we
      // keep the subscription open since the actual sig we wanted
      // hasn't arrived. A correct publisher will re-send.
      console.warn('[swarm] resource sig mismatch', { claimed: sig.slice(0, 12), actual: writtenSig.slice(0, 12) })
      return
    }

    // Close our one-shot sub for this sig — bytes are now in OPFS.
    const sub = this.#resourceSubs.get(sig)
    if (sub) {
      try { sub.close() } catch { /* ignore */ }
      this.#resourceSubs.delete(sig)
    }

    // Recurse: if the bytes are a JSON resource referencing further
    // sigs, queue those for fetch too. Same shape as #publishResource.
    try {
      const text = new TextDecoder().decode(bytes)
      const parsed = JSON.parse(text)
      const nested = new Set<string>()
      collectNestedSigs(parsed, nested)
      nested.delete(sig)
      const mesh = this.#getMesh()
      const getResource = store.getResource
      if (mesh?.subscribe && getResource) {
        for (const sub of nested) {
          if (this.#resourceSubs.has(sub)) continue
          let existing: Blob | null = null
          try { existing = await getResource(sub) } catch { /* fall through */ }
          if (existing) continue
          const sh = mesh.subscribe(sub, (ev) => void this.#onResourceEvent(ev))
          this.#resourceSubs.set(sub, sh)
        }
      }
    } catch { /* leaf resource */ }

    this.emitEffect('swarm:resource-arrived', { sig })
  }

  // -----------------------------------------------------------------
  // Hide events (kind 30202)
  // -----------------------------------------------------------------

  // Reads the hide event's `{ hidden: [...] }` payload and stores it
  // per (sig, pubkey). NOTE the self-pubkey filter that layer events
  // use does NOT apply here — we WANT our own hide events to come
  // back on relay echo so the filter survives reloads. The publisher
  // (us) and the consumer (us) are the same client; the mesh is just
  // the persistence layer.
  #onHideEvent = (sig: string, evt: MeshEvtLike): void => {
    const pubkey = String(evt?.event?.pubkey ?? '').trim().toLowerCase()
    if (!pubkey) return
    const payload = evt?.payload
    if (!payload || typeof payload !== 'object') return
    const rawHidden = (payload as { hidden?: unknown }).hidden
    if (!Array.isArray(rawHidden)) return
    const hidden = new Set<string>(
      rawHidden
        .map(x => String(x ?? '').trim())
        .filter(x => x.length > 0)
    )
    let bag = this.#hiddenByPubkeyBySig.get(sig)
    if (!bag) { bag = new Map(); this.#hiddenByPubkeyBySig.set(sig, bag) }
    const previous = bag.get(pubkey)
    const changed = !previous || previous.size !== hidden.size ||
      [...hidden].some(x => !previous.has(x))
    bag.set(pubkey, hidden)
    if (changed) {
      this.emitEffect('swarm:hide-changed', { sig, pubkey })
    }
  }

  /** All tile names this client (own pubkey) has hidden at the
   *  current lineage. Merged into show-cell's local hidden filter
   *  so the renderer drops them from the union before laying out.
   *  Returns an empty set when myPubkey hasn't resolved yet OR
   *  when no hide event has echoed back from the relay. */
  public hiddenAtCurrentSig = (): ReadonlySet<string> => {
    if (!this.#myPubkey) return new Set()
    const bag = this.#hiddenByPubkeyBySig.get(this.#currentSig)
    return bag?.get(this.#myPubkey) ?? new Set()
  }

  /** Publish a hide event for the current lineage with the given
   *  set of names. Idempotent with heartbeat — skips a republish
   *  when the list is unchanged AND we're not approaching NIP-40
   *  expiration. Pass an empty set to clear the filter (publishes
   *  `{ hidden: [] }` which the relay-echo will then store as the
   *  cleared state). */
  public publishHide = async (names: Iterable<string>): Promise<void> => {
    const sig = this.#currentSig
    if (!sig) return
    const mesh = this.#getMesh()
    if (!mesh?.publish) return
    const hidden = [...new Set([...names].map(n => String(n).trim()).filter(n => n.length > 0))].sort()
    const payload = { hidden }
    const serialized = JSON.stringify(payload)
    const nowMs = Date.now()
    const lastTimeMs = this.#lastHidePublishTimeMsBySig.get(sig) ?? 0
    const heartbeatDue = (nowMs - lastTimeMs) >= HEARTBEAT_INTERVAL_MS
    const contentChanged = this.#lastPublishedHideBySig.get(sig) !== serialized
    if (!contentChanged && !heartbeatDue) return
    this.#lastPublishedHideBySig.set(sig, serialized)
    this.#lastHidePublishTimeMsBySig.set(sig, nowMs)
    const expirationSecs = Math.floor(nowMs / 1000) + EVENT_TTL_SECS
    try {
      await mesh.publish(SWARM_HIDE_KIND, sig, payload, [
        ['d', sig],
        ['expiration', String(expirationSecs)],
      ])
    } catch (err) {
      console.warn('[swarm] publishHide failed', { sig: sig.slice(0, 12), err })
      this.#lastHidePublishTimeMsBySig.delete(sig)
    }
  }

  // -----------------------------------------------------------------
  // Interest events (kind 30203)
  // -----------------------------------------------------------------

  // Inbound interest from a peer at the parent sig. The d-tag carries
  // `${parentSig}:${childName}` so the relay's parameterized-replaceable
  // store keeps exactly one interest per (peer, parent, child); the
  // 'n' tag carries the bare child name so we can read it without
  // re-parsing the d-tag.
  //
  // Self-event is NOT skipped here — a host watching their own tile
  // wants to see their own interest cue come back from the relay too
  // (it confirms the publish landed). The render layer can choose to
  // hide self-interest if desired.
  #onInterestEvent = (sig: string, evt: MeshEvtLike): void => {
    const pubkey = String(evt?.event?.pubkey ?? '').trim().toLowerCase()
    if (!pubkey) return  // local fanout, pre-sign — wait for relay echo

    const tags = evt?.event?.tags ?? []
    const childName = tags.find(t => t[0] === 'n')?.[1]
    if (typeof childName !== 'string' || childName.length === 0 || childName.length > 256) return

    let bag = this.#interestByChildBySig.get(sig)
    if (!bag) { bag = new Map(); this.#interestByChildBySig.set(sig, bag) }
    let set = bag.get(childName)
    if (!set) { set = new Set(); bag.set(childName, set) }

    // Stamp the live last-seen so a re-ping keeps the presence glow alive
    // and a peer who stops pinging (left the child) ages out of the count.
    let seenBag = this.#interestSeenBySig.get(sig)
    if (!seenBag) { seenBag = new Map(); this.#interestSeenBySig.set(sig, seenBag) }
    let seenChild = seenBag.get(childName)
    if (!seenChild) { seenChild = new Map(); seenBag.set(childName, seenChild) }
    seenChild.set(pubkey, Date.now())

    const wasNew = !set.has(pubkey)
    set.add(pubkey)
    if (wasNew) {
      this.emitEffect('swarm:interest-changed', { sig, childName, pubkey, joined: true })
    }
  }

  /** Per-child LIVE peer count at the current sig, excluding self and
   *  peers who have aged out (no ping within PEER_STALE_MS). This is the
   *  presence-glow read model: how many OTHER participants are currently
   *  inside / entering each child tile here. Stronger glow = bigger crowd.
   *  Sync map read; safe to call once per render. */
  public presenceGlowSnapshot = (): ReadonlyMap<string, number> => {
    const sig = this.#currentSig
    const out = new Map<string, number>()
    if (!sig) return out
    const bag = this.#interestByChildBySig.get(sig)
    if (!bag || bag.size === 0) return out
    const seenBag = this.#interestSeenBySig.get(sig)
    const nowMs = Date.now()
    const me = this.#myPubkey
    for (const [childName, pubkeys] of bag) {
      let count = 0
      for (const pk of pubkeys) {
        if (me && pk === me) continue                       // exclude self
        const lastMs = seenBag?.get(childName)?.get(pk)
        if (lastMs !== undefined && nowMs - lastMs > PEER_STALE_MS) continue  // aged out
        count++
      }
      if (count > 0) out.set(childName, count)
    }
    return out
  }

  /** Keep a live "I'm inside <leaf>" cue alive at the PARENT location's
   *  sig while we sit inside a child, so peers viewing the parent see a
   *  presence glow on the tile we're exploring (and it grows with the
   *  crowd). Reuses the interest channel (kind 30203) the parent already
   *  subscribes to — published at the PARENT sig, not our current child
   *  sig, exactly like a click-through interest. Called from the
   *  current-lineage sync (nav + heartbeat); deduped past 2/3 TTL. */
  #publishPresenceToParent = async (segments: readonly string[]): Promise<void> => {
    const segs = (Array.isArray(segments) ? segments : [])
      .map(s => String(s ?? '').trim()).filter(s => s.length > 0)
    if (segs.length === 0) return  // at root — no parent to announce to
    const leaf = segs[segs.length - 1]
    const parentSig = await this.composeSigForSegments(segs.slice(0, -1))
    if (!parentSig) return
    const mesh = this.#getMesh()
    if (!mesh?.publish) return

    const key = `${parentSig}:${leaf}`
    const nowMs = Date.now()
    const lastExpMs = this.#myParentPresenceExpMs.get(key) ?? 0
    if (lastExpMs - nowMs > Math.floor(EVENT_TTL_SECS * 1000 / 3)) return  // still fresh

    const expirationSecs = Math.floor(nowMs / 1000) + EVENT_TTL_SECS
    this.#myParentPresenceExpMs.set(key, expirationSecs * 1000)
    try {
      await mesh.publish(SWARM_INTEREST_KIND, parentSig, { name: leaf }, [
        ['d', key],
        ['n', leaf],
        ['expiration', String(expirationSecs)],
      ])
    } catch {
      this.#myParentPresenceExpMs.delete(key)  // allow retry next heartbeat
    }
  }

  /** Express interest in a child tile at the current lineage. Publishes
   *  a parameterized-replaceable kind-30203 event so the publisher of
   *  this view (and any other participant subscribed at the current
   *  sig) sees the cue. Auto-refreshes the NIP-40 expiration if called
   *  repeatedly with the same name (idle hover holds the cue alive).
   *
   *  Side-channel only — the caller is still expected to navigate into
   *  the child themselves. The interest event is the SIGNAL to others
   *  that "I'm going in there, please join me." */
  public publishInterest = async (childName: string): Promise<void> => {
    const sig = this.#currentSig
    if (!sig) return
    const mesh = this.#getMesh()
    if (!mesh?.publish) return
    const name = String(childName ?? '').trim()
    if (!name || name.length > 256) return

    const nowMs = Date.now()
    let myBag = this.#myInterestBySig.get(sig)
    if (!myBag) { myBag = new Map(); this.#myInterestBySig.set(sig, myBag) }
    const lastExpMs = myBag.get(name) ?? 0
    // Refresh interval — re-publish only if our current interest event
    // is past 2/3 of its TTL. Same shape as the layer-event heartbeat.
    if (lastExpMs - nowMs > Math.floor(EVENT_TTL_SECS * 1000 / 3)) return

    const expirationSecs = Math.floor(nowMs / 1000) + EVENT_TTL_SECS
    myBag.set(name, expirationSecs * 1000)

    try {
      await mesh.publish(SWARM_INTEREST_KIND, sig, { name }, [
        ['d', `${sig}:${name}`],
        ['n', name],
        ['expiration', String(expirationSecs)],
      ])
    } catch (err) {
      console.warn('[swarm] publishInterest failed', { sig: sig.slice(0, 12), name, err })
      myBag.delete(name)  // allow retry on next call
    }
  }

  /** Pubkeys currently interested in `childName` at the current sig.
   *  Includes self when self has expressed interest (UI decides whether
   *  to render self separately). Empty Set when no one is interested.
   *
   *  Bound to #currentSig so the data follows the navigation surface
   *  show-cell renders against. */
  public interestedAt = (childName: string): ReadonlySet<string> => {
    const bag = this.#interestByChildBySig.get(this.#currentSig)
    return bag?.get(childName) ?? new Set()
  }

  /** Full snapshot — every child name at #currentSig with at least one
   *  interested peer, mapped to the peer pubkeys. Useful for render
   *  paths that want to render all interest cues in one pass without
   *  one lookup per tile. */
  public interestSnapshotAtCurrentSig = (): ReadonlyMap<string, ReadonlySet<string>> => {
    return this.#interestByChildBySig.get(this.#currentSig) ?? new Map()
  }

  // ─────────────────────────────────────────────────────────────────
  // Participant labels — human-readable per-pubkey identity
  // ─────────────────────────────────────────────────────────────────

  /** This participant's chosen label, persisted across sessions so the
   *  identity is sticky. Set via setMyLabel(); stamped onto every
   *  outgoing visuals payload. Empty string when unset. */
  public myLabel = (): string => this.#readMyLabel()

  /** Choose / change the participant's own label. Writes to localStorage
   *  AND forces a fresh publish so peers see the new name immediately
   *  rather than waiting for the next heartbeat. */
  public setMyLabel = (label: string): void => {
    const clean = String(label ?? '').trim().slice(0, 64).replace(/[\x00-\x1f]/g, '')
    try { localStorage.setItem('hc:user-label', clean) } catch { /* ignore */ }
    // Invalidate publish memo so the next sync re-emits with the new label
    // (the publish dedup compares serialized payload; changing label
    // changes the bytes, so this is belt-and-braces).
    this.#lastPublishedBySig.clear()
    void this.#syncForCurrentLineage()
  }

  /** A peer's last-seen label, or empty string when we haven't received
   *  one yet. UI uses this to render names in participant lists,
   *  participant indicators on peer tiles, etc. */
  public labelFor = (pubkey: string): string => this.#labelByPubkey.get(pubkey) ?? ''

  #readMyLabel = (): string => {
    try { return String(localStorage.getItem('hc:user-label') ?? '').trim().slice(0, 64) }
    catch { return '' }
  }

  /** The operator's advertised domain (`hc:nostrmesh:self-domain` — the same
   *  key the broker stamps onto its 30401 responses). Rides every swarm
   *  layer publish as a ['domain', …] tag so receivers can attribute our
   *  tiles' layerSigs to a fetchable host — that attribution is what lets an
   *  adopt file the tile under its capture-source folder (jwize.com/dolphin)
   *  and HTTP-direct-fetch the bytes from us. */
  #readSelfDomain = (): string => {
    try { return String(localStorage.getItem('hc:nostrmesh:self-domain') ?? '').trim() }
    catch { return '' }
  }

  // ─────────────────────────────────────────────────────────────────
  // Follow — auto-adopt one participant's broadcasts
  // ─────────────────────────────────────────────────────────────────
  //
  // Follow IS auto-adopt — same concept, single API. When you follow X,
  // you subscribe to their personal channel sig and their tiles flow
  // into your view via the same #onEvent path as any other peer event.
  // You can adopt anything they publish (one tile at a time, or via
  // selection menu), and the swarm-adopt drone fetches resources for
  // adopted tiles via the broker.
  //
  // Consent: setFollowing publishes a follow-request event on the
  // leader's request channel; the leader subscribes to that channel
  // from boot and receives a swarm:subscribe-request-received effect so
  // their UI can show "X wants to follow you. Accept / No thanks."

  /** The cached followed channel sig — what swarm.followedTiles reads
   *  from. Computed when setFollowing is called; null when not following. */
  #subscribedChannelSig: string | null = null

  /** Open subscription to followed leader's request-acknowledgement
   *  channel (the leader publishes an accept to this for the follower
   *  to know they've been accepted). Closed and reopened by setFollowing. */
  #subscribeAckSub: { close: () => void } | null = null

  /** Sub to OUR OWN follow-request channel — populated on boot so we
   *  receive notifications when participants ask to follow us. */
  #subscribeRequestSub: { close: () => void } | null = null

  /** Compute the deterministic channel sig for a participant's
   *  personal layer broadcasts, scoped to the active room+secret.
   *  Same algorithm both sides use, so leader and follower address
   *  the same channel without any out-of-band handshake. */
  #computeChannelSig = async (pubkey: string): Promise<string> => {
    const sigStore = this.#getSignatureStore()
    if (!sigStore?.signText) return ''
    const room = this.#getRoomStore()?.value?.trim() ?? ''
    const secret = this.#getSecretStore()?.value?.trim() ?? ''
    if (!room || !secret) return ''
    try { return await sigStore.signText(`channel:${pubkey}\0${room}\0${secret}`) }
    catch { return '' }
  }

  /** Compute the deterministic follow-request channel sig for a
   *  participant. The participant subscribes to this sig to receive
   *  follow requests; would-be followers publish there. */
  #computeFollowRequestSig = async (pubkey: string): Promise<string> => {
    const sigStore = this.#getSignatureStore()
    if (!sigStore?.signText) return ''
    const room = this.#getRoomStore()?.value?.trim() ?? ''
    const secret = this.#getSecretStore()?.value?.trim() ?? ''
    if (!room || !secret) return ''
    try { return await sigStore.signText(`request:${pubkey}\0${room}\0${secret}`) }
    catch { return '' }
  }

  /** Republish the current location's children at our PERSONAL channel
   *  sig so followers see what we're seeing wherever we go. Same flat
   *  visuals payload as the location publish — only the sig differs. */
  #publishCurrentVisualsToMyChannel = async (segments: readonly string[]): Promise<void> => {
    const mesh = this.#getMesh()
    if (!mesh?.publish) return
    const myPubkey = this.#myPubkey
    if (!myPubkey) return
    const channelSig = await this.#computeChannelSig(myPubkey)
    if (!channelSig) return

    // Resolve current children — same source-of-truth as publishSubtree
    // (the lineage's layer at this location). Empty children publishes
    // an empty visuals array; followers see we have nothing here, which
    // is correct.
    // Resolve {name, layerSig} for each child. The layerSig is the
    // merkle handle — subscribers receive it and can call
    // `swarm.requestSubtree(layerSig)` to pull deeper subtrees via the
    // content broker, even subtrees the publisher never personally
    // navigated into. Wire-side cost is +64 hex chars per child; the
    // sig is inert by itself (no code, no bytes), but functions as a
    // best-effort dial-tone for merkle exploration.
    const history = this.#getHistory()
    const lineage = this.#getLineage()
    let childEntries: { name: string; layerSig: string }[] = []
    try {
      if (history?.sign && history?.currentLayerAt && history?.getLayerBySig) {
        const locationSig = await history.sign({
          domain: lineage?.domain,
          explorerSegments: () => segments,
        } as LineageLike)
        const layer = await history.currentLayerAt(locationSig)
        const childSigs = Array.isArray(layer?.children) ? layer.children : []
        const resolved = await Promise.all(childSigs.map(async (cs) => {
          try {
            const child = await history.getLayerBySig(cs)
            return typeof child?.name === 'string' && child.name.length > 0
              ? { name: child.name, layerSig: cs }
              : null
          } catch { return null }
        }))
        childEntries = resolved.filter((n): n is { name: string; layerSig: string } => n !== null)
      }
    } catch { /* fall through with empty children */ }

    // PUBLIC FILTER — same rule as #publishSubtree: the personal subscribe
    // channel must also carry only the public subset, or private tiles leak
    // through this second path.
    const publicLocation = '/' + segments.join('/')
    childEntries = childEntries.filter(c => isCellPublic(publicLocation, c.name))

    type ChildEntry = { name: string; layerSig: string } & Record<string, unknown>
    const children: ChildEntry[] = await Promise.all(childEntries.map(async ({ name, layerSig }): Promise<ChildEntry> => {
      let visual: ChildEntry = { name, layerSig }
      try {
        const props = await readTilePropertiesAt(segments, name)
        if (props && Object.keys(props).length > 0) {
          visual = canonicaliseValue({ name, layerSig, ...props }) as ChildEntry
        }
      } catch { /* name-only + sig */ }
      return visual
    }))

    const myLabel = this.#readMyLabel()
    const payload: SwarmLayerPayload = myLabel
      ? { label: myLabel, visuals: children }
      : { visuals: children }
    const expirationSecs = Math.floor(Date.now() / 1000) + EVENT_TTL_SECS
    try {
      const tags: string[][] = [
        ['d', channelSig],
        ['expiration', String(expirationSecs)],
      ]
      // Same domain attribution as #publishSubtree — followers adopting from
      // our personal channel get the capture-source host too.
      const selfDomain = this.#readSelfDomain()
      if (selfDomain) tags.push(['domain', selfDomain])
      await mesh.publish(SWARM_LAYER_KIND, channelSig, payload, tags)
    } catch (err) {
      console.warn('[swarm] publish to personal channel failed', { err })
    }
  }

  /** Subscribe to OUR follow-request channel so we receive
   *  notifications when participants ask to follow us. Called once on
   *  boot after the pubkey resolves. */
  #subscribeToMyRequests = async (): Promise<void> => {
    if (this.#subscribeRequestSub) return  // already subscribed
    const mesh = this.#getMesh()
    if (!mesh?.subscribe) return
    const myPubkey = this.#myPubkey
    if (!myPubkey) return
    const reqSig = await this.#computeFollowRequestSig(myPubkey)
    if (!reqSig) return
    this.#subscribeRequestSub = mesh.subscribe(reqSig, (evt) => this.#onSubscribeRequest(evt))
  }

  #onSubscribeRequest = (evt: MeshEvtLike): void => {
    if (Number(evt.event?.kind) !== SWARM_SUBSCRIBE_REQUEST_KIND) return
    const requesterPubkey = String(evt.event?.pubkey ?? '').trim().toLowerCase()
    if (!requesterPubkey) return
    if (this.#myPubkey && requesterPubkey === this.#myPubkey) return  // ignore self

    // Consent gate. Pre-decisions silence the toast:
    //   declined → drop, no surface (user already said no)
    //   allowed  → still emit so UI can show a benign info notice,
    //              but tag pre-allowed so the consent drone uses a
    //              non-modal variant (no Accept/No-thanks buttons).
    if (this.isSubscribeDeclined(requesterPubkey)) return

    const payload = evt.payload
    const requesterLabel = (payload && typeof payload === 'object')
      ? String((payload as { label?: unknown }).label ?? '').trim().slice(0, 64)
      : ''

    this.emitEffect('swarm:subscribe-request-received', {
      requesterPubkey,
      requesterLabel,
      preApproved: this.isSubscribeAllowed(requesterPubkey),
    })
  }

  /** Follow ONE participant (single follow for now). Side effects:
   *    - Closes any prior follow subscription
   *    - Subscribes to the leader's personal channel sig (their layer
   *      broadcasts arrive via the standard #onEvent path)
   *    - Publishes a follow request to the leader's request channel
   *      so they see "X wants to follow you"
   *    - Stores 'hc:subscribed-to' = pubkey for persistence across reloads
   *  Pass null to unfollow. */
  public subscribeTo = async (pubkey: string | null): Promise<void> => {
    // Tear down old
    if (this.#subscribeSub) { try { this.#subscribeSub.close() } catch { /* ignore */ } this.#subscribeSub = null }
    if (this.#subscribeAckSub) { try { this.#subscribeAckSub.close() } catch { /* ignore */ } this.#subscribeAckSub = null }
    this.#subscribedChannelSig = null

    const pk = pubkey ? String(pubkey).trim().toLowerCase() : ''
    try {
      if (pk && /^[0-9a-f]{64}$/.test(pk)) localStorage.setItem('hc:subscribed-to', pk)
      else localStorage.removeItem('hc:subscribed-to')
    } catch { /* ignore */ }
    this.emitEffect('swarm:subscription-changed', { pubkey: pk })
    if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return

    const mesh = this.#getMesh()
    if (!mesh?.subscribe || !mesh?.publish) return

    // Subscribe to leader's layer broadcasts on their personal channel.
    // Events arrive via #onEvent → cached in #peerLayersBySig at the
    // leader channel sig keyed by the leader's pubkey.
    const channelSig = await this.#computeChannelSig(pk)
    if (channelSig) {
      this.#subscribedChannelSig = channelSig
      this.#subscribeSub = mesh.subscribe(channelSig, (evt) => this.#onEvent(channelSig, evt))
    }

    // Publish a follow request so the leader sees a notification.
    const requestSig = await this.#computeFollowRequestSig(pk)
    if (requestSig) {
      const myLabel = this.#readMyLabel()
      const expirationSecs = Math.floor(Date.now() / 1000) + EVENT_TTL_SECS
      try {
        await mesh.publish(SWARM_SUBSCRIBE_REQUEST_KIND, requestSig, { label: myLabel }, [
          ['d', `${requestSig}:${this.#myPubkey ?? ''}`],
          ['expiration', String(expirationSecs)],
        ])
      } catch (err) {
        console.warn('[swarm] follow request publish failed', err)
      }
    }
  }

  /** Who we're currently following — pubkey hex or empty string. */
  public subscribedTo = (): string => {
    try { return String(localStorage.getItem('hc:subscribed-to') ?? '') } catch { return '' }
  }

  /** Tiles the subscribed leader is currently broadcasting on their
   *  personal channel — whatever children they have at THEIR current
   *  location, irrespective of where the local user is. UI uses this
   *  to surface "what is the broadcaster looking at right now." Empty
   *  array when not subscribed or the leader hasn't broadcast yet. */
  public subscribedTiles = (): readonly ({ name: string; peerPubkey: string; imageSig?: string; layerSig?: string } & Record<string, unknown>)[] => {
    const sig = this.#subscribedChannelSig
    if (!sig) return []
    return this.peerTilesAtSig(sig)
  }

  /**
   * Merkle pull. Given any layer signature you've seen on the wire,
   * ask the content broker for the bytes and recursively walk the
   * subtree, committing each found layer under the caller's current
   * location. "You are always free to send out a layer request based
   * on the merkle tree — you might not get it but you can always try."
   *
   * Behavior:
   *  - Best effort. A sig with no responding peer fails silently
   *    (recorded in the failed counter) but doesn't throw.
   *  - sha256-verified end-to-end by the broker. Tampered responses
   *    are dropped at the broker layer.
   *  - Capped by maxNodes (default 256) to bound runaway pulls. Each
   *    visited sig is deduped so cycles can't loop.
   *  - Structure-only for v1: only the names are committed. Tile
   *    properties (images, accent, link, …) ride a separate fetch
   *    pipeline keyed by their own sigs — invoke that path after
   *    requestSubtree if you want a fully painted subtree.
   *  - Idempotent: re-adopting a name that's already at this location
   *    is a no-op via the layer's name-keyed deduplication.
   *  - Side effect: writeTilePropertiesAt commits trigger a normal
   *    layer cascade, so the new subtree integrates with history,
   *    undo/redo, and downstream peers' merkle roots.
   */
  public requestSubtree = async (
    parentSig: string,
    opts?: { maxNodes?: number; timeoutMs?: number },
  ): Promise<{ adopted: number; failed: number }> => {
    const max = Math.max(1, Math.min(opts?.maxNodes ?? 256, 1024))
    const timeoutMs = Math.max(500, opts?.timeoutMs ?? 5000)

    const sigClean = String(parentSig ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(sigClean)) return { adopted: 0, failed: 0 }

    const broker = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
      '@diamondcoreprocessor.com/ContentBrokerDrone',
    ) as { fetchBySig?: (sig: string, type: string, timeoutMs?: number) => Promise<Uint8Array | null> } | undefined
    if (!broker?.fetchBySig) {
      console.warn('[swarm] requestSubtree: no content broker available')
      return { adopted: 0, failed: 0 }
    }

    const lineage = this.#getLineage()
    const baseSegmentsRaw = lineage?.explorerSegments?.() ?? []
    const baseSegments = (Array.isArray(baseSegmentsRaw) ? baseSegmentsRaw : [])
      .map((x: unknown) => String(x ?? '').trim())
      .filter((x: string) => x.length > 0)

    const seen = new Set<string>()
    let adopted = 0, failed = 0

    /** Adopt one layer at parentSegments + [its name], then recurse
     *  into its grandchildren. Hard cap via `seen.size` so cycles or
     *  pathological fan-outs can't run away. */
    const adoptChild = async (childSig: string, parentSegments: readonly string[]): Promise<void> => {
      if (seen.size >= max) return
      if (seen.has(childSig)) return
      seen.add(childSig)

      let bytes: Uint8Array | null = null
      try { bytes = await broker.fetchBySig!(childSig, 'layer', timeoutMs) }
      catch { /* network error — count as failed */ }
      if (!bytes) { failed++; return }

      let layer: { name?: string; children?: string[] }
      try { layer = JSON.parse(new TextDecoder().decode(bytes)) }
      catch { failed++; return }

      const name = typeof layer.name === 'string' ? layer.name.trim() : ''
      if (!name || name.length > 256) { failed++; return }

      try {
        await writeTilePropertiesAt(parentSegments, name, {})
        adopted++
      } catch (err) {
        console.warn('[swarm] requestSubtree: writeTilePropertiesAt failed', { name, err })
        failed++
        return
      }

      const childSegments = [...parentSegments, name]
      const grandSigs = Array.isArray(layer.children) ? layer.children : []
      for (const gs of grandSigs) {
        if (seen.size >= max) break
        await adoptChild(gs, childSegments)
      }
    }

    // Top level: fetch the parent layer (whose CHILDREN we want),
    // iterate its children. Each child gets adopted under baseSegments
    // and recursed into for grandchildren — matching the publisher's
    // own layout where parentSig describes "what's at this location."
    seen.add(sigClean)
    let parentBytes: Uint8Array | null = null
    try { parentBytes = await broker.fetchBySig(sigClean, 'layer', timeoutMs) }
    catch {}
    if (!parentBytes) { failed++; return { adopted, failed } }

    let parentLayer: { children?: string[] }
    try { parentLayer = JSON.parse(new TextDecoder().decode(parentBytes)) }
    catch { failed++; return { adopted, failed } }

    const childSigs = Array.isArray(parentLayer.children) ? parentLayer.children : []
    for (const cs of childSigs) {
      if (seen.size >= max) break
      await adoptChild(cs, baseSegments)
    }

    this.emitEffect('swarm:subtree-requested', {
      parentSig: sigClean, adopted, failed, atSegments: baseSegments,
    })
    return { adopted, failed }
  }

  // ─────────────────────────────────────────────────────────────────
  // Follow — navigation sync (independent of subscribe / auto-adopt)
  // ─────────────────────────────────────────────────────────────────
  //
  // "Follow" literally means YOU GO WHERE THEY GO. Local choice; no
  // request/accept handshake. The leader broadcasts their pathSegments
  // on their presence channel every time they navigate; followers
  // subscribe to that channel and navigation rides on inbound events
  // via the FollowDrone.

  #followSub: { close: () => void } | null = null
  #segmentsByPubkey = new Map<string, readonly string[]>()

  #computePresenceSig = async (pubkey: string): Promise<string> => {
    const sigStore = this.#getSignatureStore()
    if (!sigStore?.signText) return ''
    const room = this.#getRoomStore()?.value?.trim() ?? ''
    const secret = this.#getSecretStore()?.value?.trim() ?? ''
    if (!room || !secret) return ''
    try { return await sigStore.signText(`presence:${pubkey}\0${room}\0${secret}`) }
    catch { return '' }
  }

  #publishMyPresence = async (segments: readonly string[]): Promise<void> => {
    const mesh = this.#getMesh()
    if (!mesh?.publish) return
    const myPubkey = this.#myPubkey
    if (!myPubkey) return
    const mySig = await this.#computePresenceSig(myPubkey)
    if (!mySig) return
    const segs = (Array.isArray(segments) ? segments : [])
      .map(s => String(s ?? '').trim()).filter(s => s.length > 0)
    const expirationSecs = Math.floor(Date.now() / 1000) + EVENT_TTL_SECS
    try {
      await mesh.publish(SWARM_PRESENCE_KIND, mySig, { pathSegments: segs }, [
        ['d', mySig],
        ['expiration', String(expirationSecs)],
      ])
    } catch (err) {
      console.warn('[swarm] publishPresence failed', err)
    }
  }

  #onPresenceEvent = (evt: MeshEvtLike): void => {
    if (Number(evt.event?.kind) !== SWARM_PRESENCE_KIND) return
    const pubkey = String(evt.event?.pubkey ?? '').trim().toLowerCase()
    if (!pubkey) return

    const payload = evt.payload
    if (!payload || typeof payload !== 'object') return
    const rawSegs = (payload as { pathSegments?: unknown }).pathSegments
    const segments: string[] = Array.isArray(rawSegs)
      ? rawSegs
          .map(s => (typeof s === 'string' ? s.trim() : ''))
          .filter(s => s.length > 0 && s.length <= 256)
          .slice(0, 16)
      : []

    const previous = this.#segmentsByPubkey.get(pubkey)
    const changed = !previous || previous.length !== segments.length ||
      segments.some((s, i) => previous[i] !== s)
    this.#segmentsByPubkey.set(pubkey, segments)

    if (changed) {
      this.emitEffect('swarm:leader-moved', { pubkey, segments })
    }
  }

  /** Start following a participant's NAVIGATION — your view literally
   *  goes where they go. Local choice; no broadcast or handshake.
   *  Pass null to unfollow. */
  public follow = async (pubkey: string | null): Promise<void> => {
    if (this.#followSub) {
      try { this.#followSub.close() } catch { /* ignore */ }
      this.#followSub = null
    }
    const pk = pubkey ? String(pubkey).trim().toLowerCase() : ''
    try {
      if (pk && /^[0-9a-f]{64}$/.test(pk)) localStorage.setItem('hc:following', pk)
      else localStorage.removeItem('hc:following')
    } catch { /* ignore */ }
    this.emitEffect('swarm:following-changed', { pubkey: pk })
    if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return

    const mesh = this.#getMesh()
    if (!mesh?.subscribe) return
    const presenceSig = await this.#computePresenceSig(pk)
    if (!presenceSig) return
    this.#followSub = mesh.subscribe(presenceSig, (evt) => this.#onPresenceEvent(evt))
  }

  /** Who we're currently following — pubkey hex or '' when not. */
  public following = (): string => {
    try { return String(localStorage.getItem('hc:following') ?? '') } catch { return '' }
  }

  /** Last known pathSegments for a peer — populated by presence events.
   *  FollowDrone reads this when deciding where to navigate; UI can
   *  surface "X is at /dolphin/team" if it wants. */
  public segmentsFor = (pubkey: string): readonly string[] => {
    return this.#segmentsByPubkey.get(pubkey) ?? []
  }

  // ─────────────────────────────────────────────────────────────────
  // Open-for-subscribers toggle (UI command-line icon binds to this)
  // ─────────────────────────────────────────────────────────────────

  public openForSubscribers = (): boolean => {
    try { return localStorage.getItem('hc:open-for-subscribers') !== '0' }
    catch { return true }  // default open
  }

  public setOpenForSubscribers = (on: boolean): void => {
    try { localStorage.setItem('hc:open-for-subscribers', on ? '1' : '0') }
    catch { /* ignore */ }
    this.emitEffect('swarm:open-for-subscribers-changed', { open: !!on })
  }

  // ─────────────────────────────────────────────────────────────────
  // Per-pubkey subscribe consent (allow / decline lists)
  // ─────────────────────────────────────────────────────────────────
  //
  // Decisions persist in two localStorage keys:
  //   hc:subscribe-allowed   — comma-separated pubkey hex list
  //   hc:subscribe-declined  — comma-separated pubkey hex list
  //
  // The channel publish (#publishCurrentVisualsToMyChannel) is the
  // same bytes for every subscriber — Nostr broadcasts can't be
  // truly per-recipient. So "decline" doesn't prevent the bytes from
  // reaching that peer once openForSubscribers is on. What these
  // lists DO drive: the consent toast pipeline. When a subscribe-
  // request fires, we check both lists first — already allowed →
  // silent auto-accept; already declined → silent ignore; otherwise
  // → swarm:subscribe-request-received fires and the UI surfaces a
  // toast. Accept calls #setSubscribeAllowed, decline calls
  // #setSubscribeDeclined; both dispatch swarm:subscribe-consent-
  // changed for any UI mirroring the lists.

  #readPubkeyList = (key: string): Set<string> => {
    try {
      const raw = String(localStorage.getItem(key) ?? '').trim()
      if (!raw) return new Set()
      return new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(s => /^[0-9a-f]{64}$/.test(s)))
    } catch { return new Set() }
  }
  #writePubkeyList = (key: string, set: Set<string>): void => {
    try { localStorage.setItem(key, Array.from(set).join(',')) }
    catch { /* ignore */ }
  }

  /** Is this peer pre-approved? Returns true when their pubkey is in
   *  hc:subscribe-allowed. Used by the consent flow to skip the toast
   *  on returning subscribers. */
  public isSubscribeAllowed = (pubkey: string): boolean => {
    const pk = String(pubkey ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return false
    return this.#readPubkeyList('hc:subscribe-allowed').has(pk)
  }

  /** Is this peer pre-declined? Returns true when their pubkey is in
   *  hc:subscribe-declined. Used by the consent flow to silently
   *  ignore repeat requests from someone the user already said no to. */
  public isSubscribeDeclined = (pubkey: string): boolean => {
    const pk = String(pubkey ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return false
    return this.#readPubkeyList('hc:subscribe-declined').has(pk)
  }

  /** Mark a peer as allowed to subscribe (called from the consent
   *  toast's Accept button). Removes from declined list if present —
   *  the user's most recent decision wins. */
  public acceptSubscribeRequest = (pubkey: string): void => {
    const pk = String(pubkey ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return
    const allowed = this.#readPubkeyList('hc:subscribe-allowed')
    const declined = this.#readPubkeyList('hc:subscribe-declined')
    allowed.add(pk); declined.delete(pk)
    this.#writePubkeyList('hc:subscribe-allowed', allowed)
    this.#writePubkeyList('hc:subscribe-declined', declined)
    this.emitEffect('swarm:subscribe-consent-changed', {
      pubkey: pk, decision: 'allowed',
    })
  }

  /** Mark a peer as declined (the consent toast's No-thanks button).
   *  Future subscribe requests from this pubkey are silently ignored
   *  (no toast) until the user clears their decision. */
  public declineSubscribeRequest = (pubkey: string): void => {
    const pk = String(pubkey ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return
    const allowed = this.#readPubkeyList('hc:subscribe-allowed')
    const declined = this.#readPubkeyList('hc:subscribe-declined')
    declined.add(pk); allowed.delete(pk)
    this.#writePubkeyList('hc:subscribe-allowed', allowed)
    this.#writePubkeyList('hc:subscribe-declined', declined)
    this.emitEffect('swarm:subscribe-consent-changed', {
      pubkey: pk, decision: 'declined',
    })
  }

  /** Clear all decisions for a given pubkey — future requests from
   *  them surface the consent toast again. */
  public clearSubscribeDecision = (pubkey: string): void => {
    const pk = String(pubkey ?? '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk)) return
    const allowed = this.#readPubkeyList('hc:subscribe-allowed')
    const declined = this.#readPubkeyList('hc:subscribe-declined')
    const wasInAny = allowed.delete(pk) || declined.delete(pk)
    if (!wasInAny) return
    this.#writePubkeyList('hc:subscribe-allowed', allowed)
    this.#writePubkeyList('hc:subscribe-declined', declined)
    this.emitEffect('swarm:subscribe-consent-changed', {
      pubkey: pk, decision: 'cleared',
    })
  }

  // -----------------------------------------------------------------
  // IoC resolvers
  // -----------------------------------------------------------------

  #getMesh = (): MeshApi | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(NOSTR_MESH_KEY) as MeshApi | undefined

  // Content broker — late-joiner visuals recovery (#48). Resolved at
  // runtime via IoC (no import); inert until the broker registers.
  #getBroker = () =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone') as {
      fetchVisualsAt?: (sig: string, timeoutMs?: number) =>
        Promise<readonly { pubkey: string; content: string; created_at: number; tags: string[][] }[] | null>
      noteDomainsForSig?: (sig: string, domains: string[]) => void
    } | undefined

  #getSigner = (): SignerApi | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(NOSTR_SIGNER_KEY) as SignerApi | undefined

  #getRegistry = (): TileSourceRegistryLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(TILE_SOURCE_REGISTRY_KEY) as TileSourceRegistryLike | undefined

  #getLineage = (): LineageLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(LINEAGE_KEY) as LineageLike | undefined

  #getHistory = (): HistoryServiceLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(HISTORY_SERVICE_KEY) as HistoryServiceLike | undefined

  #getSignatureStore = (): SignatureStoreLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(SIGNATURE_STORE_KEY) as SignatureStoreLike | undefined

  #getStore = (): StoreLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(STORE_KEY) as StoreLike | undefined

  #getRoomStore = (): CredentialStoreLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(ROOM_STORE_KEY) as CredentialStoreLike | undefined

  #getSecretStore = (): CredentialStoreLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(SECRET_STORE_KEY) as CredentialStoreLike | undefined

  // Resolve the FileSystemDirectoryHandle for the current lineage by
  // walking from Store.hypercombRoot using the segments — bypasses
  // lineage's explorerDir cache so a too-early call here can never
  // pollute show-cell's later reads with a cached null.
  #resolveLineageDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    const store = this.#getStore()
    const root = store?.hypercombRoot
    if (!root) return null

    const lineage = this.#getLineage()
    const segs = lineage?.explorerSegments?.() ?? []
    const segments = (Array.isArray(segs) ? segs : [])
      .map((x: unknown) => String(x ?? '').trim())
      .filter((x: string) => x.length > 0)

    let dir: FileSystemDirectoryHandle = root
    for (const seg of segments) {
      try {
        dir = await dir.getDirectoryHandle(seg, { create: false })
      } catch {
        return null
      }
    }
    return dir
  }
}

const _swarmDrone = new SwarmDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/SwarmDrone',
  _swarmDrone,
)
