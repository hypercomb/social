// sharing/swarm.drone.ts
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

import { Drone, EffectBus, normalizeCell, poolAddresses, SignatureService } from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools/pure'
import { readTilePropertiesAt, withoutSubstrateImage } from '../editor/tile-properties.js'
import { sanitizeVisual } from './visual-sanitizer.js'
import { noteVisualHosts, visualArtifactSigs } from './visual-hosts.js'
import { sessionHideStore } from '../presentation/tiles/session-hide.store.js'
import { hiddenAt, isBranchPublic, isCellPublic, setCellPublic } from '../presentation/tiles/tile-public.js'
import { referenceTargetForLabel, titlesForSegments } from '../commands/decoration-kind-index.js'
import { listDecorations } from '../commands/decoration-manifest.js'
import { kindsForLabel } from '../commands/decoration-kind-index.js'
import { SWARM_INVITE_KIND } from './meeting-invite.js'
import { lineageKey } from '../history/lineage-key.js'
import { isWithinAdoptedRoot } from './adopted-roots.js'
import { swarmFilterSelection } from './swarm-filter.service.js'
import { allowsHere } from '../pheromones/intake-filter.js'
import { withheldForShare, ENABLEMENT_CHANGED } from './behavior-enablement.js'
import { swarmFilterService } from './swarm-filter.service.js'
import { nameService } from './names.service.js'
import { isJoinedHere } from './membership.js'

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

// Swarm lifecycle (presence roster) event. ONE shared channel per zone
// (sha256(`lifecycle\0room\0secret`)) that EVERY participant subscribes
// to — so a single broadcast reaches the whole swarm regardless of which
// location each member is currently viewing. Two payload shapes, both
// replaceable per (pubkey, kind, d-tag=pubkey):
//
//   { alive: true, v: 2 }    — a periodic liveness beacon. Identity-level
//       presence DECOUPLED from location: it says who is in the ROOM (the
//       roster), never which tiles stay. `v` names the swarm generation, so
//       a room can say who still has to tap Update (peersOnOlderVersion).
//       Carries an `expiration` tag (EVENT_TTL_SECS); a peer whose beacon
//       lapses is marked AWAY, not evicted.
//
//   { left: true }           — a one-shot tombstone. SIGNED, it is the
//       participant's own leave (leaving, zone change): receivers run
//       evictPubkey() → every tile that participant contributed, at every
//       location, drops at once. UNSIGNED (sig ''), it is the relay's last
//       will for a socket that died — a phone lock, a wifi roam, a reload —
//       and only marks the participant away: their tiles stay until each
//       entry's own slot expires, exactly as the relay holds them.
//
// Tiles therefore leave on the participant's word (signed leave, private,
// delete) or on the relay slot's clock (expiration + grace) — never because
// a socket blinked, and never the navigation-coupled flush that made a
// peer's tiles vanish when YOU moved.
const SWARM_LIFECYCLE_KIND = 30206

// Withheld-behaviors event — the behavior axis of the share shortlist.
// The publisher broadcasts WHICH decoration kinds they hold back (their
// global-off roster: one switch, one meaning — off locally = withheld from
// the swarm), on the SAME zone lifecycle channel, replaceable per (pubkey,
// kind, d-tag=pubkey) with NIP-40 expiration. Layer bytes are SIGNED and
// never edited — the adopted snapshot arrives intact; receivers record the
// withheld kinds at the adopted root (behavior-enablement's
// `hc:withheld-at-roots`) and the enablement lens renders those behaviors
// inert there. 30207 belongs to client-presence; this is the next free slot.
const SWARM_BEHAVIOR_KIND = 30208

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

// How deep we walk our local subtree on each publish. ZERO — the
// CURRENT PAGE ONLY (Jaime's ruling, 2026-08-20: "you never give away
// the structure unless the participant navigates"). A publisher's
// proactive broadcast is exactly the tiles at the location they stand
// on; every DEEPER page is revealed one level at a time, in response
// to a visitor's drill request (#onDrillRequest), i.e. only when a
// participant actually walks in. Privacy and economy in one number.
const MAX_PUBLISH_DEPTH = 0

// Hard cap on per-publish-burst event count. Defensive against a
// publisher with thousands of cells filling the relay in one wave.
const MAX_PUBLISH_NODES = 200

// NIP-40 event lifetime. Every publish carries an `expiration` tag set
// to (now + EVENT_TTL_SECS). NIP-40 compliant relays MUST drop the
// event after this timestamp, so peers that go offline disappear from
// the swarm without needing to send NIP-09 delete events. Republish
// cadence below keeps active peers alive in the relay's cache.
const EVENT_TTL_SECS = 90

/** A layer entry's slot lifetime in relay seconds: its expiration tag,
 *  clamped to created_at + EVENT_TTL_SECS (no publisher holds a slot longer
 *  than the swarm's own TTL); created_at + TTL without a tag; `fallback()`
 *  + TTL without either (0 from a fallback of 0 means "unknown"). */
const expiryOf = (tags: readonly string[][] | undefined, createdAtSec: number, fallback: () => number): number => {
  const tag = Number((tags ?? []).find(t => Array.isArray(t) && t[0] === 'expiration')?.[1])
  const cap = createdAtSec > 0 ? createdAtSec + EVENT_TTL_SECS : Infinity
  if (Number.isFinite(tag) && tag > 0) return Math.min(tag, cap)
  if (createdAtSec > 0) return cap
  const base = fallback()
  return base > 0 ? base + EVENT_TTL_SECS : 0
}

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

// Client-side PRESENCE window. A peer heard from nowhere (no beacon, no
// layer event) for this long is marked AWAY on the roster — their tiles
// are not touched; those follow each entry's own slot (EXPIRY_GRACE_SECS
// below). Slightly looser than EVENT_TTL_SECS (TTL * 1.5) to absorb
// network jitter — a publisher whose heartbeat is a couple of seconds late
// shouldn't flicker to away.
const PEER_STALE_MS = EVENT_TTL_SECS * 1500  // 90s * 1.5 = 135s

// THE RELAY SLOT IS THE CLOCK. A peer's entry at a location lives until its
// own `expiration` tag plus this grace — the same instant for every receiver,
// late joiners included, because it is the relay's own slot lifetime. The
// grace absorbs clock skew between publisher and relay (the mesh corrects
// its own clock against the relay's hc:host card; this covers the rest).
const EXPIRY_GRACE_SECS = 30

// The swarm generation this build beacons (`{ alive: true, v }`). A beacon
// without `v` is an older generation — one that still holds tiles back
// until a host serves them; peersOnOlderVersion() names who must update.
const BEACON_VERSION = 2

// A landed host receipt re-walks every page still announcing a placeholder
// or a previous version within this window — fast enough that a picture and
// the ability to take a tile follow its name by about a second.
const RECEIPT_REWALK_MS = 150
// How long a walk waits on a host's answer about a child — the newest version,
// or whether an earlier one is still served — before it says what it has and
// walks again when the answer lands (see #entryFor). Never longer: a page's
// names must not wait on an upload.
const ENTRY_WAIT_MS = 250
// How long a walk waits for a public child's sealed handle (history re-runs the
// merkle cascade of its live subtree — seconds, for a big branch whose heads
// just moved) before it offers the child without the new handle, and walks
// again when the seal lands (#sealedHandle).
const SEAL_WAIT_MS = 250
// A page's first walk in this session also waits, at most this long, for the
// relay to replay what WE said there last (#replayReady): a reload's earlier
// full entries go out again instead of names. It runs beside the walk's own
// reads, so it rarely adds anything; the burst it waits on is one REQ's
// replay, settled REPLAY_SETTLE_MS after its first event.
const REPLAY_WAIT_MS = 600
const REPLAY_SETTLE_MS = 50
// ONLY A RELOAD HAS ANYTHING TO REPLAY. The wait is for what this tab said in
// this zone before the page loaded; a join made in this page (a fresh join, or
// a move into another room) has said nothing there yet, so it waits on no
// round trip at all — the owner's rule: nothing added to join or reconnect.
// Read once, when the module loads: membership has read the tab's own session
// by then, and a join made later in the page is no resume.
const RESUMED_AT_LOAD = ((): boolean => { try { return isJoinedHere() } catch { return false } })()
// A page walk still running after this long is taken as stuck (a read that
// never answers): the next trigger starts a fresh walk, and the stuck one may
// finish but never publishes over it.
const WALK_STALL_MS = 20_000
// The sticky refresh walks visited pages one after another; one that takes
// longer than this is left running and the next page goes.
const STICKY_PAGE_WAIT_MS = 2_000
// Walk telemetry kept for debug(): the last walk of this many pages.
const WALK_STATS_MAX = 64
// A host's `sync:state` words that mean it is not taking this page's bytes
// right now (#hostReport): another of the page's hosts that is, speaks.
const HOST_HELD_STATES: ReadonlySet<string> = new Set(['refused', 'full', 'unreachable', 'not-live', 'too-large'])
// Of those, the ones that hold a whole BRANCH (#blockedBranches): the host
// takes none of its bytes. `not-live` clears itself in a second, and
// `too-large` is one file's fate, never the branch's.
const BRANCH_HELD_STATES: ReadonlySet<string> = new Set(['refused', 'full', 'unreachable'])
// How many held branches a page's status line names — a line, not a list.
const BLOCKED_SHOWN_MAX = 3
// WHERE A PAGE'S BYTES GO still being read (a reload's first walk; a page
// whose branch marks were never read) is UNKNOWN, like a cold history read:
// the walk says nothing for that page — the relay keeps our last slot — and
// walks again when the answer lands. Bounded, so a page is never silent for
// longer than this.
const HOSTS_PENDING_WAIT_MS = 5_000
// A cold history read (stats.cold) is UNKNOWN, never "no layer" (see
// #knownLayerAt). Until history has answered once, the store root is still
// coming up — a reload's first walk — so the read is retried at this cadence
// for at most this long; once it has, a cold read is a head whose bytes are
// still landing and the walk skips the page at once rather than stall.
const COLD_LAYER_RETRY_MS = 25
const COLD_LAYER_WAIT_MS = 5_000

// A tab that wakes (phone unlock, tab switch back) has heard nothing while
// it slept; give the mesh this long to reopen and replay before any sweep
// judges a peer.
const SWEEP_RESUME_DEFER_MS = 15_000

// Spread of the visited-page re-announce after a socket reopens, so a relay
// restart does not get every participant's whole session in one instant.
const REASSERT_SPREAD_MS = 5_000

// Pages whose last walk announced a placeholder or a previous version — the
// set a receipt re-walks. Bounded; the oldest falls off (the heartbeat and
// sticky refresh still re-walk it).
const PENDING_PAGES_MAX = 128

// Page slots whose last word a relay took (#takenBySig). Bounded; the oldest
// falls off — its next walk says it again and is taken again.
const TAKEN_PAGES_MAX = 256

// Upper bound on resource subscriptions waiting for bytes at once (see
// #openResourceSub). The relay caps subscriptions per connection; ~14 are
// long-lived shell channels, so this keeps the shell well under it.
const RESOURCE_SUBS_MAX = 24

// How often to sweep stale peers from the cache. Tied to the same
// rhythm as the layer heartbeat so each pass either republishes our
// own slot or evicts a peer who hasn't kept theirs alive.
const PEER_STALE_SWEEP_INTERVAL_MS = 30_000

// Fast retry cadence for the first seconds after ARRIVING somewhere
// (join or navigation) with nobody found yet. #publishDrillRequest's own
// pageEmpty throttle is 5s, so a 3s tick yields a fresh drill roughly
// every other tick. Before this, a cold arrival's only retry path was the
// 30s heartbeat. Armed once per arrival, never by the heartbeat — a
// participant who is simply alone must not burst forever.
const JOIN_FAST_RETRY_MS = 3_000
const JOIN_FAST_RETRY_WINDOW_MS = 20_000

// Slow-phase pubkey resolve retry, after the ~10s fast poll at boot.
// The swarm is half-deaf without our own key (see
// #resolveMyPubkeyWithRetry), so it never stops trying.
const PUBKEY_SLOW_RETRY_MS = 5_000

// Cooldown between mesh probes for the SAME composed sig via
// primePeerTilesAt. The divergence scan re-runs on every peer burst,
// and a child location that answered (or answered empty) seconds ago
// won't answer differently now — without this every heartbeat would
// re-ask the mesh for every held tile's child slot.
const PRIME_COOLDOWN_MS = 60_000

// STICKY MODE — how many visited pages a participant keeps announced at
// once. Each costs one replaceable layer event per ~LAYER_REFRESH_MS on the
// heartbeat; the oldest visit falls off first.
const VISITED_PAGES_MAX = 64

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
  // the admitted 0000 fields are first-class cell properties (index,
  // imageSig, small.image, colors, tags, hideText, link, etc.) inlined
  // directly. `layerSig` is the atomic whole-layer handle and `titles` is the
  // locale->display-label projection. No `props` wrapper — the visual is the
  // immediate projection plus the stable name that identifies its pool.
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
    // The event's Schnorr signature. EMPTY on the relay's own last-will
    // tombstone (it cannot sign as the participant) — the one field that
    // tells "they left" from "their socket died".
    sig?: string
  }
  payload: unknown
}

interface MeshSubLike { close: () => void }

interface MeshApi {
  /** `onTaken`: once a relay has TAKEN the event (its OK) — the promise only
   *  says sent or queued. An older mesh never calls it. */
  publish: (kind: number, sig: string, payload: unknown, extraTags?: string[][], onTaken?: () => void) => Promise<boolean>
  subscribe: (sig: string, cb: (e: MeshEvtLike) => void) => MeshSubLike
  configureKinds: (kinds: number[] | null, persist?: boolean) => void
  ensureStartedForSig: (sig: string) => void
  /** host[:port] of the relay this tab meets at. '' when no relay can be
   *  dialled. Optional: an older mesh has none. */
  swarmHost?: () => string
  /** Relay-clock-corrected unix seconds (the hc:host card). */
  nowSec?: () => number
  /** Resolves once a sig's subscription has heard its first stored event or
   *  the relay's end-of-stored-events — or after `timeoutMs`. Optional. */
  awaitReadyForSig?: (sig: string, timeoutMs?: number) => Promise<void>
  /** The events cached for a sig, newest first (our own replays included).
   *  Optional. */
  getNonExpired?: (sig: string) => MeshEvtLike[]
}

/** The slice of HostSyncService the swarm uses: the `.public` marker
 *  writer (which stages uploads) and the availability question. */
interface HostSyncLike {
  /** `page`: where the walk offers it — its publish domains decide where the
   *  bytes go (swarm-hosts.ts). */
  markPublic: (sig: string, kind?: 'layer' | 'bee' | 'dependency' | 'resource', closure?: boolean, page?: readonly string[]) => Promise<void>
  isClosureAvailable?: (sig: string, kind?: 'layer' | 'bee' | 'dependency' | 'resource', closure?: boolean) => Promise<boolean>
  /** The same question asked of NAMED hosts only — the page's own. */
  isClosureAvailableOn?: (sig: string, kind: 'layer' | 'bee' | 'dependency' | 'resource', closure: boolean, domains: readonly string[]) => Promise<boolean>
  /** The swarm's gate: each part of the closure judged by the hosts of the
   *  page it is shown on (a branch's own publish domains below its tile).
   *  null = a page on the way is still being read. */
  isClosureAvailableAt?: (sig: string, kind: 'layer' | 'bee' | 'dependency' | 'resource', closure: boolean, page: readonly string[], extra?: readonly string[]) => Promise<boolean | null>
  /** Every swarm host a root's closure is shown on (synchronous). */
  closureHostsOf?: (sig: string) => string[]
  /** Where a page's offered tiles go, synchronously (swarm-hosts.ts):
   *  publish domains, else the hosts pool, else a relay that hosts
   *  participants. Optional: an older host-sync derives one from the relay. */
  swarmHostsFor?: (segments: readonly string[]) => SwarmHostChoiceLike
  /** Start reading a page's hosts before the walk asks. Never waits. */
  warmSwarmHosts?: (segments: readonly string[]) => void
  /** Is the self-domain backup target on? Only then is it advertised. */
  isEnabled?: () => boolean
  /** A child the walk pruned as private: what only it needed stops
   *  travelling to the swarm's host. */
  withdrawPublic?: (sig: string) => void
}

/** Where a page's bytes go — host-sync's SwarmHostChoice, structurally. */
interface SwarmHostChoiceLike { hosts: readonly string[]; source: string; pending: boolean; passedOver?: readonly string[] }

/** The connection state the mesh announces on every transition. */
interface MeshConnection {
  state?: 'off' | 'connecting' | 'open' | 'stalled' | 'retrying' | 'offline'
  reopened?: boolean
}

/** One child as the walk resolved it: its name and, once committed, its
 *  sealed layer handle. */
type ChildRef = { name: string; layerSig?: string }

/** One announced child — the flat visual: name, layerSig, inlined props,
 *  titles, inviteSig. */
type ChildEntry = { name: string; layerSig?: string } & Record<string, unknown>

/** How a child went out on a walk: its newest version (served), the last
 *  version a host served (newest still uploading), or its name alone. */
type EntryForm = 'full' | 'previous' | 'placeholder'

/** One page walk as debug() reports it: when it ran, how long it took, what
 *  it ended in, and how each public child went out. `said` = a page event
 *  left; `unchanged` = the content and its slot were current; `unknown` =
 *  history could not say; `held-for-hosts` = where its bytes go still being
 *  read; `superseded` = a newer walk of the page took over; `not-sent` = the
 *  mesh could not sign it. */
type WalkStat = {
  startedAtMs: number
  endedAtMs: number
  ms: number
  outcome: 'said' | 'unchanged' | 'unknown' | 'held-for-hosts' | 'superseded' | 'not-sent' | 'error'
  full: number
  previous: number
  placeholder: number
  private: number
  sealsLate: number
  answersLate: number
}

/** `value` when the promise settled within the wait, else `late` — the
 *  question keeps running and its answer is handled by the caller. */
type Within<T> = { late: false; value: T } | { late: true }

const HEX64_RE = /[0-9a-f]{64}/i

/** Strip every value that carries a signature, recursively. A string holding
 *  64 hex anywhere is dropped; an object or array left empty is dropped with
 *  it. What remains is inert: names, titles, colours, flags, numbers. */
function withoutSignatures(value: unknown): unknown {
  if (typeof value === 'string') return HEX64_RE.test(value) ? undefined : value
  if (Array.isArray(value)) {
    const out = value.map(withoutSignatures).filter(v => v !== undefined)
    return out.length > 0 ? out : undefined
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const kept = withoutSignatures(v)
      if (kept !== undefined) out[k] = kept
    }
    return Object.keys(out).length > 0 ? out : undefined
  }
  return value
}

/** Loopback host? `localhost`, `*.localhost`, 127.x, ::1 — with or without a
 *  port. A loopback host is only ever reachable from the same machine. */
function isLoopbackHost(hostPort: string): boolean {
  const h = String(hostPort ?? '').trim().toLowerCase()
  if (!h) return false
  const host = h.startsWith('[') ? h.slice(1, h.indexOf(']')) : h.replace(/:\d+$/, '')
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host)
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
  // Structural minimum: sign() reads explorerSegments (+ optional domain),
  // so ad-hoc path lineages (the drill response) can sign without carrying
  // the full EventTarget surface a live Lineage has.
  sign: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
  // `stats.cold` set on a null = a TRANSIENT miss (store root not ready, or a
  // head whose bytes aren't pooled yet); unset = authoritative absence.
  currentLayerAt: (locationSig: string, stats?: { cold?: boolean }) => Promise<{ children?: readonly string[]; name?: string } | null>
  getLayerBySig: (sig: string) => Promise<{ name?: string } | null>
  // Seal a subtree's LIVE location heads into a merkle-correct root sig for
  // sharing — leaf-only commit leaves parent.children frozen/stale. Optional so
  // an older HistoryService without it falls back to the raw child sig.
  sealSubtree?: (segments: readonly string[]) => Promise<string | null>
}

interface StoreLike {
  hypercombRoot?: FileSystemDirectoryHandle | null
  // Resource API — content-addressed read/write. Bytes that arrive over
  // the wire are hashed HERE, before any write: a payload that does not
  // hash to the d-tag it claims is discarded without touching the store
  // (`#onResourceEvent`). `emit: false` keeps a peer's bytes out of the
  // content:wrote publish trigger — they are not this participant's act.
  getResource?: (sig: string) => Promise<Blob | null>
  putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
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

// Publish-exclusion FIREWALL for the OPFS-fallback walk. The user tree
// root IS the OPFS root now, so an enumeration there sees — besides
// tile dirs — legacy `__x__` drain sources, the legacy `hypercomb.io/`
// content root, the i18n `overrides/` dir, lineage sigbags and every
// sign(meaning) pool. None of those are tiles and none may ever
// publish to peers as one.
const SYSTEM_DIR_NAMES = new Set([
  // LEGACY `__x__` drain sources — read-fallback dirs until their
  // self-cleaning absorb removes them. The generic `__*__` test in
  // isSystemDirName covers these too; listed for documentation.
  '__dependencies__', '__bees__', '__layers__', '__location__',
  '__history__', '__optimization__', '__resources__',
  // Legacy pre-`__hive__` content root (drain source) and the legacy
  // non-signed i18n dirs — the non-sig, non-underscore root residents,
  // all self-cleaning drain sources now.
  'hypercomb.io', 'overrides', 'translations',
])

// POOLS OF MEANING are signature-addressed — dir name = sign(meaning).
// Every known pool is excluded: pool records never ride the swarm.
// Sourced from the core POOL REGISTRY rather than a local list, which
// went stale as new pools appeared (it was missing `registry`,
// `viewport`, `authored` and `visual-optimization`). The registry
// self-extends — addressing a pool registers it.
//
// The derivations are async, but the synchronous 64-hex rule in
// isSystemDirName already excludes every sig-named dir (pools AND
// lineage sigbags), so a walk racing these additions cannot leak a pool
// onto the wire — this set is defence in depth + documentation.
void poolAddresses().then((sigs) => { for (const sig of sigs) SYSTEM_DIR_NAMES.add(sig) })

const SIG_DIR_RE = /^[0-9a-f]{64}$/

function isSystemDirName(name: string): boolean {
  if (!name) return true
  if (SYSTEM_DIR_NAMES.has(name)) return true
  // Legacy `__x__` dirs — drain sources only, never tiles.
  if (name.startsWith('__') && name.endsWith('__')) return true
  // Sig-named dirs: lineage sigbags and sign(meaning) pools live at the
  // root as 64-hex names. Tiles are human-named — a 64-hex dir is never
  // a publishable tile. Synchronous, so the publish walk cannot race
  // the async pool derivations above.
  return SIG_DIR_RE.test(name)
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
// that are exactly 64 lowercase hex chars qualify (matches the flat
// root's sig-named content files).
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
// — callers treat absence as "no index field". NOTE: lineage sigbag
// MARKER files are also named 0000/0001/… — safe here only because
// isSystemDirName keeps sig-named dirs out of the walk entirely, so a
// dir reaching this helper is always a tile dir.
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
  protected override listens: string[] = ['mesh:ensure-started', 'mesh:public-changed', 'mesh:room', 'mesh:secret', 'cell:0000-changed', 'cell:added', 'tile:public-changed', 'host:receipt', 'behavior:enablement-changed', 'swarm:visit-folded', 'mesh:connection', 'mesh:rejected', 'sync:state', 'swarm:hosts-changed']
  protected override emits: string[] = ['swarm:peers-changed', 'swarm:presence-changed', 'swarm:resource-arrived', 'swarm:hide-changed', 'swarm:interest-changed', 'swarm:label-changed', 'swarm:subscription-changed', 'swarm:subscribe-request-received', 'swarm:following-changed', 'swarm:leader-moved', 'swarm:open-for-subscribers-changed', 'swarm:follow-updated', 'tile:public-changed', 'swarm:withheld-changed', 'swarm:zone-incomplete', 'swarm:zone-complete', 'swarm:tile-visited', 'swarm:share-status', 'swarm:page-announced', 'swarm:roster-changed']

  // Per-lineage subscription handle. We open one per visited sig and
  // never close (cheap — mesh dedupes by sig at the bucket layer).
  #subsBySig = new Map<string, MeshSubLike>()

  // Late-joiner visuals recovery (#48): sigs with an in-flight
  // fetchVisualsAt, so concurrent #syncForSig passes don't double-fetch.
  #visualsRecoveryInFlight = new Set<string>()

  // STICKY MODE (Jaime, 2026-09-02: "as soon as you visited the tile once it
  // should be in memory for all of the participants until the end of the
  // swarm or leaving and coming back"). Receivers already RETAIN what they
  // witnessed across navigation; the gap was the PUBLISHER, which only kept
  // the page it stood on alive — everything left behind lapsed on the relay
  // at EVENT_TTL_SECS, so whoever arrived after that found nothing. This is
  // every page this participant stood on in the current swarm session,
  // keyed by lineageKey with the raw segments the walk needs; the heartbeat
  // re-announces each one (#refreshVisitedPages) until the session ends —
  // leave or zone change clears it. Ephemeral mode leaves it empty.
  #visitedPages = new Map<string, readonly string[]>()

  // DEPARTED — pubkey → created_at (s) of the tombstone we honoured. A
  // tombstone evicts a participant's tiles, but the relay keeps their last
  // LAYER slot until it expires (EVENT_TTL_SECS), and any REQ in that window
  // replays it: our own resubscribe, and the late-joiner recovery that the
  // eviction's empty bag invites on the next heartbeat. Without a memory of
  // the tombstone the departed tiles came back ~30s after the leave. Only
  // an event NEWER than the tombstone is a return (a genuine rejoin beacons
  // and republishes with fresh timestamps); a cache read never is.
  #departedAtSec = new Map<string, number>()

  // AWAY — pubkey → ms we last heard them leave without saying so (the
  // relay's unsigned will, or a lapsed beacon). The roster shows them
  // hollow; their tiles stay until each entry's slot expires. Their next
  // event of any kind brings them back.
  #awayPubkeys = new Map<string, number>()

  // Swarm generation per pubkey, from their alive beacon's `v` (1 = absent).
  #versionByPubkey = new Map<string, number>()

  // Per-(sig, pubkey) expiry in relay seconds — the entry's own `expiration`
  // tag (else created_at + EVENT_TTL_SECS). The sweep and the read filter
  // both honour it plus EXPIRY_GRACE_SECS: a receiver mirrors the relay slot.
  #peerExpirySecBySig = new Map<string, Map<string, number>>()

  // NEVER RETRACT FOR BEING NEWER. `${pageSig}\0${name}` → the last FULL
  // entry this participant announced for that child while a host served its
  // closure. When an edit mints a new sealed handle that no host serves yet,
  // the walk re-announces this one byte-for-byte instead of dropping the
  // tile; the receipt for the new handle swaps it. Cleared on zone change and
  // on leave. Consulted only for children that are public right now.
  #lastHostedEntry = new Map<string, ChildEntry>()

  // OUR OWN WORD, REPLAYED. pageSig → child name → the newest FULL entry (one
  // carrying a layerSig) the relay replayed to us under our own key, with its
  // created_at. A reload starts with an empty #lastHostedEntry, yet the relay
  // still serves every receiver what we said there before it: this is that
  // earlier version, so the reload's first walk can say it again instead of a
  // name (#entryFor) — re-asked like any earlier version, never assumed.
  // Only a signature that verifies as ours is kept (a relay cannot put words
  // in our mouth). Falls with the zone.
  readonly #ownReplay = new Map<string, Map<string, { entry: ChildEntry; atSec: number }>>()
  // Page sigs whose replay this session has already been waited for, and the
  // waits in progress (#replayReady).
  readonly #replaySettled = new Set<string>()
  readonly #replayWaits = new Map<string, Promise<void>>()
  // Page sigs whose last walk sent at least one name alone: a replay that
  // lands for one of them walks it again.
  readonly #placeholderSigs = new Set<string>()

  // Every handle this session marked public for a child (`${pageSig}\0name`).
  // Made private, the child's staged uploads are withdrawn by these — the walk
  // never seals a private child just to learn its handle.
  readonly #markedHandles = new Map<string, Set<string>>()

  // ONE QUESTION AT A TIME. A capped wait leaves the question running; the
  // next walk (a receipt lands every second during a drain) joins it instead
  // of stacking another closure walk or another seal. Keys name the question.
  readonly #asking = new Map<string, Promise<boolean | null>>()
  readonly #sealing = new Map<string, Promise<string | null>>()
  // The last seal that landed per child path — what a walk offers while a
  // newer seal is still running, so a branch whose heads keep moving still
  // reaches its full entry.
  readonly #lastSeal = new Map<string, string>()
  // Bumped by every receipt and every hosts change: an answer that lands after
  // one of them may already be stale, and its page is walked again.
  #answerSeq = 0

  // WALK TELEMETRY (debug()): the last walk per page, and how long after the
  // join (and after boot) the first page event left.
  readonly #walkStats = new Map<string, WalkStat>()
  #joinedAtMs = 0
  #firstAnnounce: { page: string; atMs: number; afterJoinMs: number; afterBootMs: number; full: number; previous: number; placeholder: number } | null = null
  // This tab joined in this page — so a { public: false } is a leave, not
  // the boot replay of a tab that never joined.
  #wasJoined = false
  // Still in the zone this tab was in before the page loaded (#replayReady):
  // cleared by a leave or a move to another zone, never set again.
  #resumedZone = RESUMED_AT_LOAD

  // Pages (lineageKey → segments) whose last walk sent a placeholder or a
  // previous version. Every landed receipt re-walks them; a page leaves the
  // set when a walk finds nothing pending.
  #pendingPages = new Map<string, readonly string[]>()

  // Each swarm host's last reported state (`sync:state`) — the reason a
  // name-only tile is name-only, for the sharer's status line. Keyed by host:
  // a page names the state of the host ITS tiles go to. `why` is the reason
  // as a person acts on it (host-sync's HostWhy: page, unresolved, …).
  readonly #hostStates = new Map<string, { state: string; reason: string; why: string }>()

  // Pages the walk is holding while their hosts are being read: since when,
  // and the one timer that walks them again when the wait runs out.
  readonly #hostsHeldSince = new Map<string, number>()
  readonly #hostsHeldTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // Private children at the page this tab stands on, from its last walk —
  // privateCountHere() reads it synchronously.
  #privateHere = 0

  // Page slot → the word for it the relay last TOOK (its OK). An unchanged
  // walk of a page says the page is in the room only when the relay took the
  // very word the memo holds — sent or queued is not in the room.
  readonly #takenBySig = new Map<string, string>()

  // Sweep pacing — see #sweepStalePeers.
  #lastSweepMs = Date.now()
  #sweepDeferUntilMs = 0

  // Visited-page re-announces scheduled by a socket reopen.
  readonly #reassertSpread = new Set<ReturnType<typeof setTimeout>>()

  /** Sticky (default) keeps every page you visited announced for the life
   *  of the session; ephemeral announces only where you stand, so what you
   *  leave lapses for the people there. Participant-local like the public
   *  list — never in a layer. `/swarm-mode` flips it. */
  public stickyMode = (): boolean => {
    try { return localStorage.getItem('hc:swarm:sticky') !== '0' } catch { return true }
  }

  // Per-lineage peer state. Outer key = lineage sig, inner key = peer
  // pubkey. Updated on every incoming event; replaceability means the
  // last write wins per peer, which matches what we want at render.
  #peerLayersBySig = new Map<string, Map<string, SwarmLayerPayload>>()

  // Wall-clock time (ms) we last saw an event from each peer at each
  // sig. Retained for freshest-first ORDERING in peerTilesAtSig. Whether a
  // peer's tiles render at all, and when they're swept, is the entry's own
  // slot lifetime (#peerExpirySecBySig) — never this per-location stamp.
  #peerLastSeenMsBySig = new Map<string, Map<string, number>>()

  // Identity-level liveness (pubkey -> last-seen ms), DECOUPLED from
  // location. Fed by the shared lifecycle-channel alive beacon (and any
  // other event from the peer). It is the ROOM ROSTER — who is here right
  // now — and nothing else: a peer whose stamp lapses, or whose socket dies
  // (the relay's unsigned will), is marked AWAY (#awayPubkeys), and their
  // tiles stay until their slots expire. Cleared for a pubkey on their
  // signed leave, and wholesale on zone change / going private.
  #participantAliveMs = new Map<string, number>()

  // Subscription to the shared per-zone lifecycle channel + the channel's
  // composed sig (cached so leave/teardown can publish a tombstone to the
  // SAME sig even after the zone credentials are about to change).
  #lifecycleSub: { close: () => void } | null = null
  #lifecycleSig = ''
  // Wall-clock (ms) of our last alive beacon. Throttles the beacon to the
  // NIP-40 refresh cadence instead of firing on every navigation — the
  // heartbeat keeps it alive; nav-time calls within the window no-op.
  #lastBeaconMs = 0

  /** Last withheld-list JSON we broadcast (kind 30208) — republish only on
   *  actual change; '' = never published this zone. */
  #lastWithheldJson = ''

  /** Per-peer withheld decoration kinds (from their 30208 broadcasts).
   *  Consulted by the adopt fold to record `hc:withheld-at-roots`. */
  readonly #withheldByPubkey = new Map<string, string[]>()

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

  // ── Visit-driven acquisition state ────────────────────────────────
  // Wall-clock of our last withheld-list send. The 30208 slot carries the
  // same 90s NIP-40 expiration as every other event, so it must refresh on
  // the beacon cadence or late joiners never learn the publisher's
  // withheld behaviors (they'd render withheld kinds as enabled).
  #lastWithheldSentMs = 0

  // Path key of the location the last visit signal fired for — dedupes
  // the heartbeat's re-sync (same location, no new visit) from a real
  // navigation. Reset on zone teardown / going private.
  #lastVisitKey = ''

  // lineageKey()s of paths whose leaf we witnessed as a PEER offering —
  // i.e. names the swarm itself taught us. Broadcasting such a segment
  // back (presence, drill requests) discloses nothing new, unlike a
  // locally-held private name. Bounded; oldest dropped first.
  #foreignPathKeys = new Set<string>()

  // Our own drill-request send times, keyed by path key. While the page
  // we're standing on is still EMPTY the re-ask runs on a short clock —
  // the publisher's first answer can be blank (a fresh tile's bytes still
  // draining past the availability gate), and stalling a whole minute on
  // a blank first answer reads as a dead tunnel. A filled page relaxes to
  // the TTL-refresh cadence.
  #myDrillSentMs = new Map<string, number>()

  // Publisher-side cooldown for answered drill requests: pathKey → last
  // response walk ms. Short — a page response is ONE event; the cooldown
  // exists to coalesce a crowd, not to starve a waiting visitor.
  #drillServedMs = new Map<string, number>()

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
    // Effect listeners arm HERE, not on the first processor pulse. The
    // pulse can be 10-60 s after load, and a tile created in that window
    // never became public, a join waited out the 30 s interval, and a
    // receipt that landed meanwhile woke nothing (swarm-listeners-armed-
    // late). Last-value replay hands each listener what it missed.
    queueMicrotask(() => this.#armListeners())
    // Heartbeat: every HEARTBEAT_INTERVAL_MS, refresh our current
    // lineage's NIP-40 expiration by republishing. The dedupe in
    // #publishSubtree now considers wall-clock elapsed alongside
    // content equality, so an unchanged layer still re-fires its
    // expiration tag. Without this loop, peers who sit idle on a
    // single lineage would self-expire from the relay within
    // EVENT_TTL_SECS even though they're still present.
    this.#heartbeatTimer = setInterval(() => {
      if (!this.#currentSig) {
        // No current sig despite the heartbeat running. Normally that
        // means private mode / incomplete zone — but a transient failure
        // inside #syncForCurrentLineage (signText hiccup during boot) can
        // ALSO leave it empty with no retry path while the user idles:
        // permanent deafness until navigation. When public with a
        // complete zone, retry the sync; otherwise stay quiet.
        if (isJoinedHere()
          && this.#getRoomStore()?.value?.trim()
          && this.#getSecretStore()?.value?.trim()) {
          void this.#syncForCurrentLineage()
        }
        return
      }
      void this.#syncForCurrentLineage()
      // Sticky mode — keep every page visited this session on the relay.
      void this.#refreshVisitedPages()
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

    // Slot sweep — evicts cached layer entries whose relay slot has
    // expired, and marks peers we haven't heard from in PEER_STALE_MS
    // away. Without it, tiles a peer published before disconnecting would
    // linger on every receiver's canvas until something else replaced the
    // entry — could be hours, or forever for a peer who never returns.
    // The renderer is told to repaint after any eviction so the
    // disappearance is immediate.
    this.#peerSweepTimer = setInterval(() => this.#sweepStalePeers(),
      PEER_STALE_SWEEP_INTERVAL_MS)
  }

  #heartbeatTimer: ReturnType<typeof setInterval> | null = null
  #peerSweepTimer: ReturnType<typeof setInterval> | null = null
  #joinRetryTimer: ReturnType<typeof setInterval> | null = null
  #joinRetryDeadlineMs = 0

  // Fast-retry the sync while freshly public and alone — see
  // JOIN_FAST_RETRY_MS. Idempotent: a call while already running just
  // extends nothing (the running loop keeps its own deadline), so every
  // #syncForCurrentLineage pass can call this unconditionally.
  #startJoinFastRetry = (): void => {
    if (this.#joinRetryTimer) return
    this.#joinRetryDeadlineMs = Date.now() + JOIN_FAST_RETRY_WINDOW_MS
    this.#joinRetryTimer = setInterval(() => {
      if (Date.now() >= this.#joinRetryDeadlineMs || this.participantsAtCurrentSig().length > 0) {
        this.#stopJoinFastRetry()
        return
      }
      void this.#syncForCurrentLineage()
    }, JOIN_FAST_RETRY_MS)
  }

  #stopJoinFastRetry = (): void => {
    if (this.#joinRetryTimer) {
      clearInterval(this.#joinRetryTimer)
      this.#joinRetryTimer = null
    }
  }

  // TWO CLOCKS, TWO MEANINGS.
  //
  // CONTENT follows the relay slot: a peer's entry at a sig is dropped once
  // its own expiration (+ EXPIRY_GRACE_SECS) has passed — the moment the
  // relay drops it for everyone, so a late joiner and a veteran see the same
  // room. A socket that dies never removes a tile; the slot does.
  //
  // PRESENCE follows identity: a pubkey heard from nowhere for PEER_STALE_MS
  // (no beacon, no layer) is marked AWAY on the roster. Nothing is evicted.
  //
  // A sleeping tab heard nothing while it slept, so its stamps lie. A pass
  // that runs more than 2× late (the tab was frozen or throttled) skips, and
  // a tab that just became visible waits SWEEP_RESUME_DEFER_MS for the mesh
  // to reopen and replay before any pass judges — a waking phone never
  // wipes the room (presence-lapse-evicts-everything).
  #sweepStalePeers = (): void => {
    const nowMs = Date.now()
    const late = nowMs - this.#lastSweepMs > 2 * PEER_STALE_SWEEP_INTERVAL_MS
    this.#lastSweepMs = nowMs
    if (late || nowMs < this.#sweepDeferUntilMs) return
    const nowSec = this.#nowSec()
    for (const [sig, expiries] of [...this.#peerExpirySecBySig]) {
      let evicted = ''
      for (const [pk, exp] of [...expiries]) {
        if (nowSec <= exp + EXPIRY_GRACE_SECS) continue
        expiries.delete(pk)
        this.#peerLastSeenMsBySig.get(sig)?.delete(pk)
        if (this.#peerLayersBySig.get(sig)?.delete(pk)) evicted = pk
      }
      if (expiries.size === 0) this.#peerExpirySecBySig.delete(sig)
      if (evicted) this.emitEffect('swarm:peers-changed', { sig, pubkey: evicted, reason: 'slot-expired' })
    }
    let rosterChanged = false
    for (const [pk, ms] of [...this.#participantAliveMs]) {
      if (nowMs - ms > PEER_STALE_MS && this.#markAway(pk, nowSec)) rosterChanged = true
    }
    // An away participant with nothing left anywhere has left the room.
    for (const [pk] of [...this.#awayPubkeys]) {
      if (this.#hasEntries(pk)) continue
      this.#awayPubkeys.delete(pk)
      this.#segmentsByPubkey.delete(pk)
      rosterChanged = true
    }
    if (rosterChanged) this.#scheduleRosterEmit()
  }

  /** Relay-clock seconds — the mesh's hc:host-corrected clock when it has
   *  one, this device's otherwise. Every freshness and expiry judgement
   *  uses it, so a device whose clock is off still agrees with the room. */
  #nowSec = (): number => {
    const v = this.#getMesh()?.nowSec?.()
    return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : Math.floor(Date.now() / 1000)
  }

  /** Record the slot lifetime of `pubkey`'s entry at `sig` — its own
   *  expiration tag, else created_at + EVENT_TTL_SECS, else now + TTL.
   *  The tag is the PUBLISHER's word and now decides alone when its tiles
   *  leave (a will only marks it away), so it is never trusted past
   *  created_at + EVENT_TTL_SECS: a client that stamps a day ahead must not
   *  keep its tiles on every screen for a day after its socket dies. Nor
   *  past now + TTL: a created_at stamped ahead (the relay allows 15 min)
   *  buys no more than one TTL from the moment we heard it. */
  #noteExpiry = (sig: string, pubkey: string, tags: readonly string[][] | undefined, createdAtSec: number): void => {
    const now = this.#nowSec()
    const exp = Math.min(expiryOf(tags, createdAtSec, () => now), now + EVENT_TTL_SECS)
    let bag = this.#peerExpirySecBySig.get(sig)
    if (!bag) { bag = new Map(); this.#peerExpirySecBySig.set(sig, bag) }
    bag.set(pubkey, exp)
  }

  /** Has `pubkey`'s entry at `sig` outlived its relay slot? */
  #isExpired = (sig: string, pubkey: string, nowSec: number): boolean => {
    const exp = this.#peerExpirySecBySig.get(sig)?.get(pubkey)
    return exp !== undefined && nowSec > exp + EXPIRY_GRACE_SECS
  }

  /** Does `pubkey` still hold an entry anywhere we witnessed? */
  #hasEntries = (pubkey: string): boolean => {
    for (const bag of this.#peerLayersBySig.values()) if (bag.has(pubkey)) return true
    return false
  }

  /** Proof of life. `createdAtSec` is the event's own stamp: an event no
   *  newer than the moment they went away is a replay of the past, never a
   *  return. A live participant's first word of any kind brings them back. */
  #markAlive = (pubkey: string, createdAtSec: number): void => {
    const awaySince = this.#awayPubkeys.get(pubkey)
    if (awaySince !== undefined && createdAtSec > 0 && createdAtSec <= awaySince) return
    const known = this.#participantAliveMs.has(pubkey)
    this.#participantAliveMs.set(pubkey, Date.now())
    if (this.#awayPubkeys.delete(pubkey) || !known) this.#scheduleRosterEmit()
  }

  /** Away — off the live roster, tiles untouched. `atSec` is when (relay
   *  seconds); later events revive them. Returns whether the roster moved. */
  #markAway = (pubkey: string, atSec: number): boolean => {
    const wasAlive = this.#participantAliveMs.delete(pubkey)
    const prior = this.#awayPubkeys.get(pubkey)
    this.#awayPubkeys.set(pubkey, Math.max(prior ?? 0, atSec))
    return wasAlive || prior === undefined
  }

  // Roster emits coalesce like peers-changed: a reopen replays every
  // member's beacon in one burst, and the strip needs one repaint.
  #rosterTimer: ReturnType<typeof setTimeout> | null = null
  #scheduleRosterEmit = (): void => {
    if (this.#rosterTimer !== null) return
    this.#rosterTimer = setTimeout(() => {
      this.#rosterTimer = null
      this.emitEffect('swarm:roster-changed', {
        participants: this.participantsInZone(),
        away: this.awayInZone(),
        older: this.peersOnOlderVersion(),
      })
      this.#emitPresence('roster')
    }, 150)
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
    this.#peerExpirySecBySig.delete(sig)
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
          this.#peerExpirySecBySig.get(sig)?.delete(candidate)
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
    this.#peerExpirySecBySig.clear()
    this.#participantAliveMs.clear()
    this.#awayPubkeys.clear()
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
    // Best-effort graceful leave on teardown — only from a zone we beaconed.
    if (this.#lifecycleSig) void this.#publishLeave()
    if (this.#lifecycleSub) { try { this.#lifecycleSub.close() } catch { /* ignore */ } this.#lifecycleSub = null }
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer)
      this.#heartbeatTimer = null
    }
    if (this.#peerSweepTimer) {
      clearInterval(this.#peerSweepTimer)
      this.#peerSweepTimer = null
    }
    this.#stopJoinFastRetry()
    if (this.#pubkeyRetryTimer) {
      clearTimeout(this.#pubkeyRetryTimer)
      this.#pubkeyRetryTimer = null
    }
    if (this.#reassertTimer) {
      clearTimeout(this.#reassertTimer)
      this.#reassertTimer = null
    }
    if (this.#receiptRepublishTimer) {
      clearTimeout(this.#receiptRepublishTimer)
      this.#receiptRepublishTimer = null
    }
    if (this.#rosterTimer) {
      clearTimeout(this.#rosterTimer)
      this.#rosterTimer = null
    }
    this.#cancelReassertSpread()
    for (const sub of this.#resourceSubs.values()) {
      try { sub.close() } catch { /* ignore */ }
    }
    this.#resourceSubs.clear()
    this.#publishedResources.clear()
  }

  protected override sense = () => true

  // The constructor arms the listeners; a pulse that reaches us first does
  // the same (idempotent), so arming never depends on which comes first.
  protected override heartbeat = async (): Promise<void> => {
    this.#armListeners()
  }

  #armListeners = (): void => {
    if (this.#initialized) return
    this.#initialized = true

    // NO PAGEHIDE LEAVE. A reload, a phone's app switch and a bfcache round
    // trip all fire pagehide, and none of them is the participant leaving:
    // the leave that went out here withdrew every tile they shared until the
    // new page booted — and for good when the reload lost its host
    // (reload-drops-session-host). A tab that really closed is covered by
    // the relay's will (graced, unsigned → away) and by each slot's own
    // expiry. Leaving is the leave gesture, and only that.

    // A tab that wakes heard nothing while it slept — hold the sweep until
    // the mesh has reopened and replayed (see #sweepStalePeers).
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const deferSweep = (): void => { this.#sweepDeferUntilMs = Date.now() + SWEEP_RESUME_DEFER_MS }
      window.addEventListener('pageshow', deferSweep)
      document.addEventListener?.('visibilitychange', () => {
        if (document.visibilityState === 'visible') deferSweep()
      })
    }

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
    // are the authoritative source we read at sync time. Arming now runs
    // at construction, before the shell may have registered the stores, so
    // each attaches when its store arrives.
    this.#whenReady<CredentialStoreLike>(ROOM_STORE_KEY, (roomStore) => {
      roomStore.addEventListener('change', () => this.#teardownAndResync('room-store-change'))
    })
    this.#whenReady<CredentialStoreLike>(SECRET_STORE_KEY, (secretStore) => {
      secretStore.addEventListener('change', () => this.#teardownAndResync('secret-store-change'))
    })
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
    // publishes nothing; the membership gate inside (this tab joined, not
    // merely a remembered room+secret) keeps non-swarm creates private.
    this.onEffect<{ cell?: string; segments?: readonly string[] }>('cell:added', (payload) => {
      this.#autoPublishInSwarm(payload)
      this.#schedulePropsRepublish()
    })
    // A visit-fold landed (SwarmAdoptDrone): mark the visited tile public —
    // acquired FROM the zone, it stays visible TO the zone, the same default
    // a tile CREATED in a swarm gets — and republish so the frontier updates.
    // The availability gate still decides which version it announces.
    this.onEffect<{ parentSegments?: string[]; name?: string }>('swarm:visit-folded', (p) => {
      const name = String(p?.name ?? '').trim()
      const parent = Array.isArray(p?.parentSegments)
        ? p!.parentSegments!.map(s => String(s ?? '').trim()).filter(Boolean) : []
      if (!name) return
      try { setCellPublic('/' + parent.join('/'), name, true) } catch { /* participant-local nicety */ }
      this.#schedulePropsRepublish()
    })
    // Public/private flip — full re-sync so BOTH the broadcast layer slot
    // (kind 30200) AND the personal subscribe channel re-publish with the new
    // public subset. (#schedulePropsRepublish alone only refreshes the layer
    // path, leaving followers' channel view stale.) The publish paths re-apply
    // the filter; a tile going private shrinks the slot, going public adds it.
    this.onEffect('tile:public-changed', () => { void this.#syncForCurrentLineage() })

    // The global behavior roster changed — rebroadcast the withheld list so
    // peers' enablement lenses follow at once (flipping a behavior back on
    // publishes the shrunken list, which is the wake signal). No-op when the
    // zone credentials aren't set / we're not public.
    this.onEffect(ENABLEMENT_CHANGED, () => { void this.#publishWithheld() })

    // Host receipt landed — a child announced as a placeholder or as its
    // previous version may just have become served. Re-walk the page we
    // stand on AND every page still waiting (#pendingPages) — the branch
    // tile at root that lagged while its owner built inside it — within
    // RECEIPT_REWALK_MS, one walk per burst (a drain lands receipts in runs).
    this.onEffect('host:receipt', () => { this.#answerSeq++; this.#scheduleReceiptRewalk() })

    // The swarm hosts' states, for the status line: why a tile is name-only
    // (refused, full, too large, unreachable) or that it is uploading. Only a
    // swarm host's report counts — another target's backup is not what this
    // room can fetch from — and a page reads its own host's.
    this.onEffect<{ host?: string; state?: string; status?: string; reason?: string; why?: string; swarm?: boolean }>('sync:state', (s) => {
      const host = String(s?.host ?? '').trim()
      if (!host || s?.swarm !== true) return
      const before = this.#hostStates.get(host)
      const next = { state: String(s?.state ?? s?.status ?? ''), reason: String(s?.reason ?? ''), why: String(s?.why ?? '') }
      this.#hostStates.set(host, next)
      // A host that just stopped (or started again) taking a branch's bytes
      // changes what the status line names (#blockedBranches): walk once,
      // rather than leave "uploading" standing until the heartbeat.
      if (BRANCH_HELD_STATES.has(next.state) !== BRANCH_HELD_STATES.has(before?.state ?? '')) this.#scheduleReceiptRewalk()
    })

    // A page's hosts became known or moved (the pool, a branch's marks, the
    // relay's card): walk again, so a name that waited on the read — or went
    // to the old host — is offered where its bytes now go.
    this.onEffect('swarm:hosts-changed', () => { this.#answerSeq++; this.#scheduleReceiptRewalk() })

    // A FINAL REFUSAL (rate-limited past its re-sends, invalid, a far-off
    // clock): the relay does not hold what the memo says was sent. Un-stamp
    // it, so the next walk or heartbeat sends the slot again instead of
    // skipping it as delivered for a whole refresh period. No republish
    // from here — a refusal that is permanent must not become a loop.
    this.onEffect<{ kind?: number; d?: string }>('mesh:rejected', (r) => {
      const d = String(r?.d ?? '')
      if (!d) return
      if (r.kind === SWARM_LAYER_KIND) {
        this.#lastPublishedBySig.delete(d)
        this.#lastPublishTimeMsBySig.delete(d)
      } else if (r.kind === SWARM_HIDE_KIND) {
        this.#lastPublishedHideBySig.delete(d)
        this.#lastHidePublishTimeMsBySig.delete(d)
      } else if (r.kind === SWARM_LIFECYCLE_KIND) {
        this.#lastBeaconMs = 0
      }
    })

    // THE SOCKET CAME BACK. The mesh re-sent its REQs and flushed what it
    // owed before saying so; what it cannot know is that the room may have
    // marked us away meanwhile, or that the relay restarted empty.
    this.onEffect<MeshConnection>('mesh:connection', (c) => {
      if (c?.state === 'open' && c.reopened === true) this.#reassertOnReopen()
    })

    // Mesh-public toggle handler. Going OFF tears down state so temp
    // shared tiles disappear from the canvas. Going ON re-runs the
    // current-lineage sync so subscriptions reattach + we publish
    // without the user having to navigate first — without this the
    // toggle felt like sync was broken (mesh comes back online but
    // nothing happens until a 'change' event fires).
    this.onEffect<{ public: boolean }>('mesh:public-changed', (payload) => {
      // Mesh.networkEnabled is read at construction time, so a toggle to
      // public AFTER boot leaves networkEnabled false — REQs are silently
      // dropped, no events flow, swarm appears dead. Flipping
      // setNetworkEnabled here closes the race: any time the user enables
      // public mode, the mesh immediately opens its sockets and
      // resubscribes to the bucket for the current sig.
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

      // JOINING IS ENOUGH TO SHARE (2026-10-04; hosts by pool 2026-10-07).
      // Joining needs no host pick: each page's tiles go to its publish
      // domains, else the participant's hosts pool, else a relay that hosts
      // participants — resolved by host-sync (swarmHostsFor) while this tab
      // is joined. A tile goes out by name at once and with its signatures
      // once its host serves them — so there is no "watching only" state to
      // warn about, and the status line (swarm:share-status) says why a tile
      // is still name-only, and which host it waits on.

      if (payload?.public === false) {
        // Graceful leave — a SIGNED tombstone, so peers drop our tiles in one
        // shot. Only a tab that beaconed into a zone has anything to take
        // back: the boot replay of `{ public: false }` in a tab that never
        // joined must not announce a departure.
        //
        // LEAVE FIRST, THEN THE NETWORK. The shells used to turn the network
        // off before announcing the leave, so the tombstone — signed a moment
        // later — found no socket and sat in the mesh's queue: the relay's
        // graced will fired 15 s on as a soft "away", peers kept our tiles
        // for up to two minutes, and the queued {left} went out on the NEXT
        // join, perhaps into another room. Now the swarm owns network-off:
        // the tombstone is handed to the socket first (a socket sends what it
        // holds before its close frame), and only then does the mesh go
        // quiet — unless this tab joined again meanwhile.
        this.#stopJoinFastRetry()
        const networkOff = (): void => {
          if (isJoinedHere()) return
          const m = this.#getMesh() as { setNetworkEnabled?: (enabled: boolean, persist?: boolean) => void } | undefined
          m?.setNetworkEnabled?.(false, false)
        }
        const wasJoined = this.#wasJoined
        this.#wasJoined = false
        this.#resumedZone = false
        this.#joinedAtMs = 0
        this.#firstAnnounce = null
        if (this.#lifecycleSig) {
          void this.#publishLeave().finally(networkOff)
        } else if (wasJoined) {
          // Joined, but never reached a lifecycle channel (a zone still
          // incomplete, a first sync not yet through): no tombstone to send,
          // and the meeting point is left all the same. A tab that never
          // joined in this page (the boot replay) keeps its warm socket.
          networkOff()
        }
        // Nothing announces into the room this tab left: no props or receipt
        // re-walk queued before the leave, no page to republish.
        if (this.#propsRepublishTimer) { clearTimeout(this.#propsRepublishTimer); this.#propsRepublishTimer = null }
        if (this.#receiptRepublishTimer) { clearTimeout(this.#receiptRepublishTimer); this.#receiptRepublishTimer = null }
        if (this.#lifecycleSub) { try { this.#lifecycleSub.close() } catch { /* ignore */ } this.#lifecycleSub = null }
        this.#lifecycleSig = ''
        for (const sub of this.#subsBySig.values()) {
          try { sub.close() } catch { /* ignore */ }
        }
        this.#subsBySig.clear()
        this.#peerLayersBySig.clear()
        this.#peerLastSeenMsBySig.clear()
        this.#participantAliveMs.clear()
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
        // Visit/drill state falls with the rest of the swarm session.
        this.#lastVisitKey = ''
        this.#foreignPathKeys.clear()
        this.#myDrillSentMs.clear()
        this.#drillServedMs.clear()
        this.#visitedPages.clear()
        this.#departedAtSec.clear()
        this.#clearZoneMemory()
        // Drop the zone key so hide reads/writes fall back to
        // device-scoped storage while in private mode.
        this.#updateZoneKey()
        this.emitEffect('swarm:peers-changed', { sig: this.#currentSig, reason: 'mode-private' })
        this.#currentSig = ''
        return
      }
      // public === true → wake the swarm at the current lineage.
      // Re-publish the zone key so localStorage hide writes (which
      // may have happened in private mode between toggles) land in
      // the zone's namespace going forward.
      if (payload?.public === true) this.#noteJoined()
      this.#updateZoneKey()
      void this.#syncForCurrentLineage()
    })
  }

  /** Run `cb` with the IoC value under `key` as soon as it is registered —
   *  at once when it already is. */
  #whenReady = <T>(key: string, cb: (value: T) => void): void => {
    const ioc = (window as { ioc?: { get?: (k: string) => unknown; whenReady?: (k: string, cb: (v: unknown) => void) => void } }).ioc
    if (typeof ioc?.whenReady === 'function') { ioc.whenReady(key, (v) => cb(v as T)); return }
    const v = ioc?.get?.(key) as T | undefined
    if (v) cb(v)
  }

  /** The zone-scoped memory beyond the peer cache — roster marks, slot
   *  clocks, the last-hosted entries and our own replayed ones, the handles
   *  marked public, pages waiting on a receipt. Falls with the zone (leave,
   *  zone change). */
  #clearZoneMemory = (): void => {
    this.#awayPubkeys.clear()
    this.#versionByPubkey.clear()
    this.#peerExpirySecBySig.clear()
    this.#lastHostedEntry.clear()
    this.#ownReplay.clear()
    this.#replaySettled.clear()
    this.#placeholderSigs.clear()
    this.#markedHandles.clear()
    this.#lastSeal.clear()
    this.#channelPending = false
    this.#lastChannelJson = ''
    this.#pendingPages.clear()
    this.#privateHere = 0
    this.#cancelReassertSpread()
  }

  /** This tab is in the swarm in this page: remember it (a later
   *  { public: false } is a leave) and when it joined (debug()'s first
   *  announce is measured from here). */
  #noteJoined = (): void => {
    this.#wasJoined = true
    if (!this.#joinedAtMs) this.#joinedAtMs = Date.now()
  }

  // REASSERT ON REOPEN. Say we're here FIRST — the beacon also cancels any
  // will the relay still holds for the dead socket — then the page we stand
  // on, then every page we visited, each at a random offset inside
  // REASSERT_SPREAD_MS so a relay restart is not a thundering herd. The
  // publish memos are cleared so nothing is skipped as "already sent" to a
  // relay that may have lost it.
  #reassertOnReopen = (): void => {
    if (!isJoinedHere()) return
    this.#lastBeaconMs = 0
    this.#lastWithheldSentMs = 0
    this.#lastPublishedBySig.clear()
    this.#lastPublishTimeMsBySig.clear()
    this.#myParentPresenceExpMs.clear()
    this.#cancelReassertSpread()
    void (async () => {
      try { await this.#ensureLifecycle() } catch { /* the sync below beacons again */ }
      void this.#syncForCurrentLineage()
      const currentKey = this.#currentPageKey()
      for (const [key, segments] of [...this.#visitedPages]) {
        if (key === currentKey) continue
        const timer = setTimeout(() => {
          this.#reassertSpread.delete(timer)
          void this.#walkPage(segments)
        }, Math.random() * REASSERT_SPREAD_MS)
        this.#reassertSpread.add(timer)
      }
    })()
  }

  #cancelReassertSpread = (): void => {
    for (const timer of this.#reassertSpread) clearTimeout(timer)
    this.#reassertSpread.clear()
  }

  /** lineageKey of the page this tab last synced — '' before the first. */
  #currentPageKey = (): string => this.#lastSyncInput ? lineageKey(this.#lastSyncInput.segments) : ''

  /** The relay this tab meets at, as a host — '' when none is dialable. */
  #swarmHost = (): string => {
    try { return String(this.#getMesh()?.swarmHost?.() ?? '').trim() } catch { return '' }
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
    lastVisitSignal: this.#lastVisitSignal,
    lastDrillRequest: this.#lastDrillRequest,
    lastDrillServed: this.#lastDrillServed,
    stickyMode: this.stickyMode(),
    visitedPages: [...this.#visitedPages.keys()],
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
    // WALK TIMINGS — what a silent sharer's walks are doing, readable from
    // one read-only call (no second tab): per page ('/' = the root), the last
    // walk's start, end and duration in ms, how it ended, and how its public
    // children went out (full / previous / placeholder), how many stayed
    // private, and how many seals or host answers it had to leave running.
    walks: Object.fromEntries([...this.#walkStats].map(([key, s]) => ['/' + key, { ...s }])),
    // Join → the first page event this session ('null' while none has left).
    joinedAtMs: this.#joinedAtMs || null,
    firstAnnounce: this.#firstAnnounce ? { ...this.#firstAnnounce, page: '/' + this.#firstAnnounce.page } : null,
    inFlight: {
      pages: [...this.#walkingPages.keys()].map(k => '/' + k),
      channel: this.#channelFlight ? '/' + lineageKey(this.#channelFlight.segments) : null,
      questions: this.#asking.size,
      seals: this.#sealing.size,
    },
    // Our own replayed entries held per page sig (names only, never handles).
    ownReplay: Object.fromEntries([...this.#ownReplay].map(([sig, bag]) => [sig.slice(0, 12), [...bag.keys()].length])),
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
   *  excluding self and entries past their relay slot (expiration +
   *  EXPIRY_GRACE_SECS). Sorted freshness-first — most recent activity at
   *  index 0.
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
    const nowSec = this.#nowSec()
    const out: string[] = []
    for (const pubkey of peerLayers.keys()) {
      if (this.#myPubkey && pubkey === this.#myPubkey) continue
      if (this.#isExpired(sig, pubkey, nowSec)) continue
      out.push(pubkey)
    }
    // Freshness-first — newest activity at index 0. Tie-breaks fall
    // through to insertion order (Map iteration order).
    out.sort((a, b) => (lastSeenBag.get(b) ?? 0) - (lastSeenBag.get(a) ?? 0))
    return out
  }

  // ── The room — roster reads for the status line ──────────────────

  /** Everyone live in this zone right now (beacon or event within
   *  PEER_STALE_MS, not away), wherever they stand. Excludes self. */
  public participantsInZone = (): readonly string[] => {
    const nowMs = Date.now()
    const out: string[] = []
    for (const [pk, ms] of this.#participantAliveMs) {
      if (this.#myPubkey && pk === this.#myPubkey) continue
      if (nowMs - ms > PEER_STALE_MS || this.#awayPubkeys.has(pk)) continue
      out.push(pk)
    }
    return out
  }

  /** Members whose socket is gone (the relay's will, or a lapsed beacon)
   *  but whose tiles are still in the room — their slots have not expired.
   *  Excludes self. */
  public awayInZone = (): readonly string[] =>
    [...this.#awayPubkeys.keys()].filter(pk =>
      !(this.#myPubkey && pk === this.#myPubkey) && !this.#participantAliveMs.has(pk) && this.#hasEntries(pk))

  /** Live members whose beacon says an older swarm generation — the ones
   *  who still hold their tiles back until a host serves them, and need to
   *  tap Update to share. */
  public peersOnOlderVersion = (): readonly string[] =>
    this.participantsInZone().filter(pk => {
      const v = this.#versionByPubkey.get(pk)
      return v !== undefined && v < BEACON_VERSION
    })

  /** The page this tab stands on, as the swarm hashes it — what a meeting
   *  link carries so everyone lands on the same composed sig. */
  public currentSegments = (): readonly string[] => [...(this.#lastSyncInput?.segments ?? [])]

  /** Own tiles at this page that stay private — from its last walk. */
  public privateCountHere = (): number => this.#privateHere

  /** A relay took this tab's word for a page (mesh publish's onTaken). The
   *  page this tab stands on is in the room from now: `swarm:page-announced`
   *  {location, segments} — its address only. */
  #pageTaken = (sig: string, word: string, segments: readonly string[], location: string): void => {
    // Only the word the memo still holds: a late OK for an older word must
    // not stand in for the newer one the relay has (or has not) taken.
    if (this.#lastPublishedBySig.get(sig) === word) {
      this.#takenBySig.delete(sig)
      this.#takenBySig.set(sig, word)
    }
    while (this.#takenBySig.size > TAKEN_PAGES_MAX) {
      const oldest = this.#takenBySig.keys().next().value
      if (oldest === undefined) break
      this.#takenBySig.delete(oldest)
    }
    if (lineageKey(segments) === this.#currentPageKey() && isJoinedHere()) {
      this.emitEffect('swarm:page-announced', { location, segments: [...segments] })
    }
  }

  /** What offerPrivateHere offers at the page this tab stands on: its own
   *  tiles still private here — collection items, the sets page and the tiles
   *  the participant HID left out (the page shows them no more, so "the tiles
   *  on this page" never counts or shares them), one per name as setCellPublic
   *  keys it. Names only, read locally: nothing is sealed and nothing leaves.
   *  null = the page could not be read (history cold) — never taken for
   *  "none". */
  #privateToOffer = async (): Promise<{ location: string; names: string[] } | null> => {
    if (!isJoinedHere()) return { location: '', names: [] }
    const segments = this.currentSegments()
    if (segments[0] === 'sets') return { location: '', names: [] }
    const location = '/' + segments.join('/')
    const refs = await this.#resolveChildRefs(await this.#resolveLineageDir(), segments, () => false)
    if (refs === null) return null
    const hidden = hiddenAt(segments)
    const hiddenByRelay = this.hiddenAtCurrentSig()
    const seen = new Set<string>()
    const names: string[] = []
    for (const { name } of refs) {
      if (isCellPublic(location, name) || referenceTargetForLabel(name) !== null) continue
      if (hidden(name) || hiddenByRelay.has(name)) continue
      // Two names one public key would name: the first flip covers both.
      const key = normalizeCell(name) || name
      if (seen.has(key)) continue
      seen.add(key)
      names.push(name)
    }
    return { location, names }
  }

  /** How many tiles offerPrivateHere would offer here right now — the same
   *  reading, nothing flipped (share-ask.worker.ts asks with it). null = the
   *  page could not be read yet. */
  public privateToOfferHere = async (): Promise<number | null> =>
    (await this.#privateToOffer())?.names.length ?? null

  /** Offer every private tile at the page this tab stands on to the room —
   *  TILE BY TILE (setCellPublic, never a branch: what is inside each stays
   *  private), then one tile:public-changed so the walk announces them.
   *  Collection items keep the same exemption a create in a swarm has.
   *  Returns how many were offered. */
  public offerPrivateHere = async (): Promise<number> => {
    const found = await this.#privateToOffer()
    if (!found || found.names.length === 0) return 0
    for (const name of found.names) setCellPublic(found.location, name, true)
    const offered = found.names.length
    EffectBus.emit('tile:public-changed', { location: found.location, public: true, offered })
    return offered
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
    // 20400/20402/30401 = the content broker's fetch REQUEST, fetch CANCEL and
    // fetch RESPONSE. The cancel was missing from this list until 2026-09-19:
    // the relay dropped every one, so no holder ever heard that another had
    // already answered, and with N participants holding the same bytes all N
    // published a copy (drive-swarm-scale measured 9/9). The broker's
    // stand-down ranking only works because the cancel now arrives.
    // 30213 = the durable feedback-loop channel item (FeedbackChannelDrone).
    // Same rule as above: omit it and the relay filter drops the events as a
    // silent miss. (30210/30211/30212 were the feedback consent handshake and
    // 30214 the per-recipient reply; both drones retired with the feedback
    // window on 2026-09-04 - documentation/annotate-the-screen.md. A kind
    // nobody publishes and nobody handles has no business in the filter.)
    mesh.configureKinds([29010, SWARM_LAYER_KIND, SWARM_RESOURCE_KIND, SWARM_HIDE_KIND, SWARM_INTEREST_KIND, SWARM_PRESENCE_KIND, SWARM_SUBSCRIBE_REQUEST_KIND, SWARM_LIFECYCLE_KIND, SWARM_BEHAVIOR_KIND, 20400, 20402, 30401, 30207, 30213, 30215, 30216, 30217], true)
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
    // Canonical lineage key — folds punctuation/hyphens so two peers who read
    // the path the same way converge on one slot. MUST match #publishSubtree
    // and #syncForCurrentLineage byte-for-byte (see the NUL-separator note);
    // all three derive the key through the same lineageKey() helper.
    const pathKey = lineageKey(segments)
    // NUL separators — must match #publishSubtree (line ~1352) exactly so
    // subscribers and publishers address the same slot. A SPACE separator
    // here was the bug behind months of "incognito sees nothing": the
    // subscribe-side composed sig differed from the publish-side, so the
    // relay stored A's event under one #x tag while B subscribed on
    // another. Both A's local fanout (mesh.fanoutToSig keys by sig) and
    // the relay's #x tag filter use the publish sig — so the subscriber
    // must compose the SAME bytes the publisher does.
    try { return await sigStore.signText(`${pathKey}\0${room}\0${secret}`) }
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
    const nowSec = this.#nowSec()
    const sortedPeers = [...peerLayers.entries()].sort(([pkA], [pkB]) => {
      const tA = lastSeenBag.get(pkA) ?? 0
      const tB = lastSeenBag.get(pkB) ?? 0
      return tB - tA
    })

    const sigRe = /^[0-9a-f]{64}$/
    for (const [pubkey, layer] of sortedPeers) {
      if (this.#myPubkey && pubkey === this.#myPubkey) continue
      // Slot filter — the entry lives exactly as long as the relay holds it
      // (expiration + EXPIRY_GRACE_SECS), the same answer the sweep gives.
      // A peer who went AWAY (socket died, beacon lapsed) keeps their tiles
      // here until then; only their signed leave removes them sooner.
      if (this.#isExpired(sig, pubkey, nowSec)) continue
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
        // Participant filter — applied HERE, before the tile-source
        // registry's kind:name dedup, so a name two peers both publish
        // resolves to a SELECTED publisher's entry (layerSig/image/index
        // included). Empty selection = no filter, everyone shows.
        const selectedParticipants = swarmFilterSelection()
        return tiles
          .filter(({ peerPubkey }) => selectedParticipants.size === 0 || selectedParticipants.has(peerPubkey))
          .filter(({ name }) => !hiddenLineages.has(locKey ? `${locKey}/${name}` : name))
          // Intake gate — the marks the participant is watching for, and the
          // ones they never want. SYNCHRONOUS on purpose, exactly like the two
          // filters above: this runs per peer tile per render, so an awaited
          // OPFS hit each would be a storm. `allowsHere` reads only marks
          // already in memory and kicks the read for the rest, so an unseen
          // signature costs one round trip ever and is refused from the next
          // render on. The authoritative refusal runs at ADOPT, at the commit.
          //
          // BY THE PEER'S LAYER SIG, NEVER BY THE PATH. `[...loc.segments,
          // name]` is where the offering would LAND, and the marks there are
          // the participant's own tile's — a peer publishing a name you
          // already use at this location was judged by YOUR marks, in both
          // directions. Co-located same-name is the ordinary case: it is what
          // the tile source's `kind:name` dedup below exists to resolve.
          .filter(tile => allowsHere({ sig: String(tile['layerSig'] ?? '') }))
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
      // Those echoes were our own earlier word: a page that went out as names
      // while our key was unknown files it now (the mesh still caches it), and
      // walks again (#noteOwnReplay).
      for (const sig of [...this.#placeholderSigs]) {
        try { for (const evt of this.#getMesh()?.getNonExpired?.(sig) ?? []) this.#noteOwnReplay(sig, evt) } catch { /* nothing cached */ }
      }
      // Everything stamped with our identity (alive beacon, drill request,
      // presence channel, withheld list) bails silently while the key is
      // unknown. If a zone sync already ran, re-run it now so those go out
      // immediately instead of on the next heartbeat tick.
      if (this.#currentSig) void this.#syncForCurrentLineage()
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
  // of ours surfaces as a peer tile (a lone participant then counts
  // THEMSELVES as a peer), and every identity-stamped publish (alive
  // beacon, presence, drill request) bails, so real peers never see
  // us. Polls fast for ~10s, then keeps polling slowly for the life
  // of the session — a signer that registers late must still land.
  #resolveMyPubkeyWithRetry = async (attempts: number): Promise<void> => {
    this.#pubkeyRetryTimer = null
    if (this.#myPubkey) return  // already resolved by another caller
    if (await this.#resolveMyPubkey()) return
    const delayMs = attempts < 100 ? 100 : PUBKEY_SLOW_RETRY_MS
    this.#pubkeyRetryTimer = setTimeout(() => { void this.#resolveMyPubkeyWithRetry(attempts + 1) }, delayMs)
  }
  #pubkeyRetryTimer: ReturnType<typeof setTimeout> | null = null

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

  // Whether the last gate decision was "incomplete zone". Sync runs on
  // every lineage change and every store change, so the announcement is
  // edge-triggered: one report when the swarm goes dead, one when it
  // recovers, nothing in between.
  #zoneIncomplete = false

  /** Report a public-but-unreachable swarm. `hasRoom`/`hasSecret` name the
   *  field that is missing so the shell can open the selector focused on it
   *  rather than asking the participant to guess. */
  #announceZoneIncomplete = (hasRoom: boolean, hasSecret: boolean): void => {
    if (this.#zoneIncomplete) return
    this.#zoneIncomplete = true
    this.emitEffect('swarm:zone-incomplete', { hasRoom, hasSecret })
  }

  #announceZoneComplete = (): void => {
    if (!this.#zoneIncomplete) return
    this.#zoneIncomplete = false
    this.emitEffect('swarm:zone-complete', {})
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
      const joined = isJoinedHere()
      slog('[swarm] syncForCurrentLineage: room/secret missing — broadcast skipped', { hasRoom: !!room, hasSecret: !!secret, joined })
      // Declining is correct — never broadcast without an explicit zone.
      // Declining SILENTLY is not. A hive that flipped public with a
      // half-set zone opens a relay socket, paints the swarm chrome, and
      // then drops every subscribe and publish on this line: no sig, no
      // peers, no adopt affordance, no error. It reads exactly like a dead
      // relay, and on a bare-domain origin (nothing seeds a room there) it
      // is the DEFAULT outcome of joining any way but through the selector.
      // Say so, once per transition, so the shell can route the participant
      // back to the selector instead of leaving them in a dead swarm.
      if (joined) { this.#noteJoined(); this.#announceZoneIncomplete(!!room, !!secret) }
      return
    }
    this.#announceZoneComplete()
    slog('[swarm] syncForCurrentLineage: proceeding', { roomLen: room.length, secretLen: secret.length })

    const segsRaw = lineage.explorerSegments?.() ?? []
    // Same lineage derivation as composeSigForSegments / #publishSubtree: the
    // CANONICAL key (via lineageKey — folds punctuation so equivalent paths
    // converge), then mix in room + secret so two peers must share BOTH the
    // path AND the credentials. `segments` (trimmed, uncanonicalized) is kept
    // for #lastSyncInput / downstream walks; only the hashed key canonicalizes.
    const segments = (Array.isArray(segsRaw) ? segsRaw : [])
      .map((x: unknown) => String(x ?? '').trim())
      .filter((x: string) => x.length > 0)
    const pathKey = lineageKey(segments)
    // Where this page's tiles go (its publish domains, the hosts pool) starts
    // being read now, so the walk below finds it cached. Never waited on.
    try { this.#getHostSync()?.warmSwarmHosts?.(segments) } catch { /* an older host-sync */ }

    let composedSig = ''
    try {
      // sha256(lineage + '\0' + room + '\0' + secret) — NUL separators
      // prevent any one field bleeding into another (e.g. room='a:b'
      // and secret='' colliding with room='a' and secret='b').
      composedSig = await sigStore.signText(`${pathKey}\0${room}\0${secret}`)
    } catch { return }
    if (!composedSig) return

    this.#lastSyncInput = { segments, room, secretLen: secret.length, key: `${pathKey}\0${room}\0${secret}` }
    // PRIVATE = SILENT. Only #syncForSig used to read the mesh flag; every
    // publish after it — the lifecycle beacon, presence, the personal
    // channel, the drill request, the visit — ran on every navigation and
    // every heartbeat regardless. So a participant who had LEFT (tombstone
    // sent, subscriptions closed) was re-armed by the next heartbeat tick:
    // #ensureLifecycle re-subscribed and beaconed {alive} over its own
    // tombstone, and it kept answering drill requests — peers saw the
    // departed tiles come back. Leaving must be the last word.
    //
    // THIS TAB's membership (membership.ts), never the origin-wide flag: a
    // second tab that booted unjoined used to rewrite that flag and silence
    // this one mid-meeting while its UI still said joined.
    if (!isJoinedHere()) return
    this.#noteJoined()

    if (this.stickyMode()) {
      // Re-insert so the freshest visit sits last; the FIFO trim drops the
      // page visited longest ago.
      this.#visitedPages.delete(pathKey)
      this.#visitedPages.set(pathKey, segments)
      while (this.#visitedPages.size > VISITED_PAGES_MAX) {
        const oldest = this.#visitedPages.keys().next().value
        if (oldest === undefined) break
        this.#visitedPages.delete(oldest)
      }
    }

    // Shared lifecycle channel — subscribe once + beacon our presence on
    // the per-zone roster sig, so every member learns when we leave
    // regardless of where they are. Identity-level liveness lives here.
    // STARTED BEFORE the page walk (not awaited — nothing waits on it): the
    // relay must see this key live before the walk's first upload PUT, and
    // the room hears "here" before it hears "here is what I have".
    void this.#ensureLifecycle()

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

    // Visit signal — visit-driven acquisition's trigger. When the tile
    // just entered is offered by a peer at the parent location, announce
    // the visit; SwarmAdoptDrone folds it (one level, props from the
    // wire) and records it in the visit genome. Fired once per actual
    // location change — the heartbeat's re-sync of the same location is
    // not a new visit.
    //
    // ORDER MATTERS: the visit runs BEFORE the drill request below —
    // #announceVisit is what records the entered tile as swarm-taught
    // (#noteForeignPath), and the drill request's privacy prefix reads
    // that record. Reversed, every FIRST entry into a foreign tile
    // computed an empty broadcastable prefix and silently sent no drill
    // request — with page-only publishing, that stalled the whole
    // tunnel one level in.
    if (pathKey !== this.#lastVisitKey) {
      this.#lastVisitKey = pathKey
      await this.#announceVisit(segments)
    }

    // Drill request — tell the zone (lifecycle channel, which every
    // member hears regardless of location) which path we are standing
    // on, so a publisher who holds it can extend their broadcast
    // frontier to us. With page-only publishing this is THE deep
    // transport: each level entered re-requests, the publisher answers
    // with that one page, and the drill never goes dark. Fire-and-forget.
    void this.#publishDrillRequest(segments)

    // Initial presence emit — fires once per location after sync sets
    // up, even when nobody else is here. The UI presence banner needs
    // this to render the "first one here" state on cold arrival;
    // without it the banner stays hidden until SOMEONE causes a
    // peer-cache event, and a user alone in a swarm sees nothing.
    // Subsequent peer joins/leaves come through #emitPeersChanged on
    // the normal debounce.
    const peers = this.participantsAtCurrentSig()
    this.#emitPresence('initial-sync', composedSig)
    // Nobody found yet — fall back to the fast retry cadence instead of
    // the 30s heartbeat until someone shows up or the window elapses.
    if (peers.length === 0) this.#startJoinFastRetry()
  }

  // STICKY MODE refresh — rides the heartbeat and re-announces every page
  // this participant visited in the session except the current one (the
  // normal sync owns that). Each is the same page-only walk the current page
  // gets (dir=null reads the children from the layer); #publishSubtree's own
  // memo dedupes unchanged content to one publish per LAYER_REFRESH_MS, so N
  // visited pages cost N replaceable events per ~60s, and pictures ride their
  // own 24h memo. The public filter and the availability gate apply exactly
  // as they do for the current page — this changes WHEN a page is announced,
  // never WHAT.
  #refreshVisitedPages = async (): Promise<void> => {
    if (!this.stickyMode() || this.#visitedPages.size === 0) return
    if (!isJoinedHere()) return
    const currentKey = this.#currentPageKey()
    for (const [key, segments] of [...this.#visitedPages]) {
      if (key === currentKey) continue
      // One page after another, so N pages are not one burst — but a page
      // whose walk will not finish never holds the pages after it.
      await this.#within(this.#walkPage(segments), STICKY_PAGE_WAIT_MS)
    }
  }

  /** One page-only walk of `segments` — THE walk every page gets: the page
   *  this tab stands on (#publishMyLayerAt, with its OPFS dir), the sticky
   *  refresh, the receipt re-walk of waiting pages, the reopen reassert and a
   *  drill answer. Silent unless this tab is joined with a complete zone. */
  //
  // ONE WALK PER PAGE AT A TIME — NEVER ONE FOR ALL. A drain lands receipts in
  // runs, and each walk asks host-sync about every child's closure, so walks
  // stacked on one page only repeat that work: a trigger that arrives
  // mid-walk is owed ONE more walk when it ends, with whatever has landed by
  // then. But a walk of one page never holds another's: the single global
  // flag that used to guard the current page's walk let one slow walk (a
  // first walk waiting on an upload) silence every page after it for as long
  // as it ran. A walk still running after WALK_STALL_MS is taken as stuck: a
  // new trigger starts a fresh one, and the stuck one never publishes.
  #walkingPages = new Map<string, { again: boolean; sinceMs: number }>()

  #walkPage = async (segments: readonly string[], dir: FileSystemDirectoryHandle | null = null): Promise<void> => {
    if (!isJoinedHere()) return
    const key = lineageKey(segments)
    const held = this.#walkingPages.get(key)
    if (held && Date.now() - held.sinceMs < WALK_STALL_MS) { held.again = true; return }
    const flight = { again: false, sinceMs: Date.now() }
    this.#walkingPages.set(key, flight)
    const live = (): boolean => this.#walkingPages.get(key) === flight && isJoinedHere()
    try {
      do {
        flight.again = false
        flight.sinceMs = Date.now()
        if (!isJoinedHere()) return
        const sigStore = this.#getSignatureStore()
        const mesh = this.#getMesh()
        if (!sigStore || !mesh?.publish) return
        const room = this.#getRoomStore()?.value?.trim() ?? ''
        const secret = this.#getSecretStore()?.value?.trim() ?? ''
        if (!room || !secret) return
        try { await this.#publishSubtree(dir, segments, MAX_PUBLISH_DEPTH, { count: 0 }, sigStore, mesh, room, secret, live) }
        catch { /* next heartbeat */ }
      } while (flight.again && this.#walkingPages.get(key) === flight)
    } finally {
      if (this.#walkingPages.get(key) === flight) this.#walkingPages.delete(key)
    }
  }

  // Tear down all per-sig state at the OLD #currentSig (subscriptions,
  // peer cache, last-published memo) and re-run sync at the new
  // composed sig. Called on room/secret changes. Emits
  // swarm:peers-changed so show-cell repaints without the now-orphaned
  // peer entries from the previous credential pair.
  #teardownAndResync = (reason: string): void => {
    // Leaving this zone — tombstone ourselves on the OLD lifecycle channel
    // before the credentials change, so members of the zone we're leaving
    // drop our tiles at once. Capture the sig first; #ensureLifecycle will
    // recompute + resubscribe for the new zone via #syncForCurrentLineage.
    const leavingLifecycleSig = this.#lifecycleSig
    if (leavingLifecycleSig) void this.#publishLeave(leavingLifecycleSig)
    // A new zone: nothing of ours to replay there (#replayReady).
    this.#resumedZone = false
    if (this.#lifecycleSub) { try { this.#lifecycleSub.close() } catch { /* ignore */ } this.#lifecycleSub = null }
    this.#lifecycleSig = ''
    this.#participantAliveMs.clear()
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
    // Visit/drill state is zone-scoped: names learned from zone A's peers
    // must never make a path broadcastable in zone B, and the next zone's
    // first location is a fresh visit.
    this.#lastVisitKey = ''
    this.#foreignPathKeys.clear()
    this.#myDrillSentMs.clear()
    this.#drillServedMs.clear()
    this.#visitedPages.clear()
    this.#departedAtSec.clear()
    this.#clearZoneMemory()
    // A new zone is a new meeting: its first page event is timed afresh.
    this.#joinedAtMs = 0
    this.#firstAnnounce = null
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

    // Defence in depth for the private-mode boundary. ShowCellDrone normally
    // suppresses mesh:ensure-started while private, but other producers also
    // emit that shared effect. A delayed warm-up/synchronize event must never
    // subscribe, recover peer visuals, walk a publish closure, or resurface
    // retained peer tiles while the user is in private mode.
    if (!isJoinedHere()) return

    // Leaving a lineage closes our live subscription there (bandwidth —
    // stop listening at locations we can no longer see) but RETAINS the
    // peer state we witnessed. Peer tiles at a filter location are
    // STICKY: per the lineage-filter doctrine ("empty layer = removal"),
    // a participant's tiles vanish only when THAT participant posts an
    // empty layer there (explicit retract, applied in #onEvent) or their
    // session goes stale (#sweepStalePeers + the read-time filter in
    // peerTilesAtSig, both keyed on PEER_STALE_MS). The user's OWN
    // navigation must never remove them — deleting #peerLayersBySig here
    // was the "go into a tile and back and the participant's tiles are
    // gone" bug. Only our own per-sig publish/interest bookkeeping is
    // cleared for the outgoing sig; the witnessed peer state persists.
    //
    // No cross-location leak: the TileSourceRegistry source resolves peer
    // tiles by the RENDERED location's sig (composeSigForSegments), not
    // #currentSig, so retained state for other sigs never surfaces here.
    const prevSig = this.#currentSig
    if (prevSig && prevSig !== sig) {
      const prevSub = this.#subsBySig.get(prevSig)
      if (prevSub) {
        try { prevSub.close() } catch { /* ignore */ }
        this.#subsBySig.delete(prevSig)
      }
      // RETAINED across navigation (deliberately NOT deleted):
      //   #peerLayersBySig, #peerLastSeenMsBySig, #hiddenByPubkeyBySig
      // — the witnessed peer tiles + their freshness stamps + peer hide
      // filters, which must persist until the peer retracts or goes stale.
      this.#lastPublishedBySig.delete(prevSig)
      this.#lastPublishTimeMsBySig.delete(prevSig)
      this.#interestByChildBySig.delete(prevSig)
      this.#interestSeenBySig.delete(prevSig)
      this.#myInterestBySig.delete(prevSig)
      this.#lastPublishedHideBySig.delete(prevSig)
      this.#lastHidePublishTimeMsBySig.delete(prevSig)
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
    entries: readonly { pubkey: string; content: string; tags?: string[][]; created_at?: number }[],
  ): void => {
    let bag = this.#peerLayersBySig.get(sig)
    let injected = 0
    const broker = this.#getBroker()
    const nowSec = this.#nowSec()
    for (const entry of entries) {
      const pubkey = String(entry.pubkey ?? '').toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(pubkey)) continue
      if (this.#myPubkey && pubkey === this.#myPubkey) continue   // self-echo
      if (this.#departedAtSec.has(pubkey)) continue                // tombstoned — a cache read is never a return
      // Live data wins — but only while its slot is alive. A cached entry
      // past its expiration is already invisible to peerTilesAtSig's
      // read-time filter; skipping it here would make a once-primed
      // location permanently unrefreshable (the stale husk blocks every
      // re-inject while the read filter hides it). Recovered visuals are a
      // live mesh answer from just now, so they replace a stale husk.
      if (bag?.has(pubkey) && !this.#isExpired(sig, pubkey, nowSec)) continue
      // A recovered entry whose own slot has already lapsed is a memory of
      // the past, never a tile to show.
      const createdAtSec = Number(entry.created_at ?? 0)
      const expSec = expiryOf(entry.tags, createdAtSec, () => 0)
      if (expSec > 0 && nowSec > expSec + EXPIRY_GRACE_SECS) continue
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
      // publisher's ['domain', …] tag is attributed to layers and images exactly
      // like the live #onEvent path. A late joiner receives peer tiles
      // through THIS path, not a live broadcast — without this, their
      // adopt had no capture-source host and the tile fell to a root
      // folder instead of jwize.com/<tile>.
      const domainTags = (entry.tags ?? [])
        .filter((t): t is string[] => Array.isArray(t) && String(t[0]) === 'domain' && !!String(t[1] ?? '').trim())
        .map(t => String(t[1]).trim())
      if (domainTags.length && broker?.noteDomainsForSig) {
        noteVisualHosts(cleanVisuals, domainTags, broker.noteDomainsForSig)
      }
      // NOT where their name is asked: a recovered entry is a responder's
      // unsigned JSON, so it could tie any key to any host. Only the key's own
      // signed layer event (#onEvent) hints its host to the name service.
      // A recovered entry is a LIVE answer from a participant who is in the
      // zone right now — the late-joiner path, which is the exact moment the
      // user means by "it should be immediate when participants connect".
      // Same unconditional claim as #onEvent, same per-claim idempotence.
      if (broker?.notePeerLiveness) {
        const refs = visualArtifactSigs(cleanVisuals)
        if (refs.length) broker.notePeerLiveness(pubkey, refs)
      }
      if (!bag) { bag = new Map(); this.#peerLayersBySig.set(sig, bag) }
      bag.set(pubkey, { visuals: cleanVisuals })
      this.#noteExpiry(sig, pubkey, entry.tags, createdAtSec)
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

  // -----------------------------------------------------------------
  // On-demand peer-cache priming (the divergence probe)
  // -----------------------------------------------------------------

  // Fill the peer cache at an ARBITRARY composed sig from the swarm's
  // cached-visuals protocol — the read the divergence scan and additive
  // adopt need to look one level INTO a held tile without navigating
  // there. Publishers broadcast MAX_PUBLISH_DEPTH levels deep, but a
  // receiver only ever subscribed at its CURRENT sig, so a child
  // location's cache was empty unless the user happened to walk into it
  // — which made the held-tile adopt affordance almost never light.
  //
  // Same fetch + inject as late-joiner recovery (#recoverVisualsAt),
  // minus the current-sig pin. WITNESS ONLY — visuals land in the peer
  // cache; no byte is ever adopted here. Injection emits
  // swarm:peers-changed, which re-triggers the debounced scan — the
  // convergence loop that turns a cold probe into a lit adopt icon.
  // Coalesced per sig (shared in-flight set) and cooled down so a scan
  // re-running on every heartbeat doesn't re-ask locations that just
  // answered; `force` (a user gesture behind it) skips the cooldown,
  // never the in-flight dedup.
  #lastPrimeMsBySig = new Map<string, number>()

  public primePeerTilesAt = async (sig: string, opts?: { force?: boolean }): Promise<void> => {
    const s = String(sig ?? '').trim().toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(s)) return
    // Private mode witnesses nothing — same gate as the sync path.
    if (!isJoinedHere()) return
    if (this.#visualsRecoveryInFlight.has(s)) return
    if (!opts?.force) {
      const last = this.#lastPrimeMsBySig.get(s) ?? 0
      if (Date.now() - last < PRIME_COOLDOWN_MS) return
    }
    this.#lastPrimeMsBySig.set(s, Date.now())
    this.#visualsRecoveryInFlight.add(s)
    try {
      const broker = this.#getBroker()
      if (!broker?.fetchVisualsAt) return
      const entries = await broker.fetchVisualsAt(s)
      if (entries && entries.length > 0) this.#injectRecoveredVisuals(s, entries)
    } catch { /* witness-only optimization — never fatal */ }
    finally { this.#visualsRecoveryInFlight.delete(s) }
  }

  // A LIVE layer event under our own pubkey that we did not publish this
  // session, naming tiles inside an ADOPTED root, is the signature of an
  // identity collision — another install signing with this key (the
  // pre-per-origin shared-constant fossil). The self-skip in #onEvent
  // silences it completely: that publisher can never register as a peer,
  // so adopted branches never auto-sync. Warn once per session so the
  // collision is never silent. A second tab of THIS origin trips it too
  // (same key, legitimately) — the message covers both readings.
  #warnedSelfSkipAdopted = false
  readonly #bootMs = Date.now()
  #noteSelfSkippedLayerEvent = (sig: string, createdAtSec: number, payload: unknown): void => {
    if (this.#warnedSelfSkipAdopted) return
    if (!sig || sig !== this.#currentSig) return
    if (createdAtSec * 1000 <= this.#bootMs) return            // relay replay of our own past
    if (this.#lastPublishedBySig.has(sig)) return              // our own live echo
    const visuals = payload && typeof payload === 'object' && Array.isArray((payload as SwarmLayerPayload).visuals)
      ? (payload as SwarmLayerPayload).visuals
      : []
    const at = (this.#getLineage()?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const adopted = visuals
      .map(v => (v && typeof v === 'object' && !Array.isArray(v)) ? String((v as Record<string, unknown>)['name'] ?? '').trim() : '')
      .filter(name => name.length > 0 && isWithinAdoptedRoot([...at, name]))
    if (adopted.length === 0) return
    this.#warnedSelfSkipAdopted = true
    console.warn(
      `[swarm] identity collision? live broadcast under OUR pubkey ${this.#myPubkey?.slice(0, 8)} names adopted tile(s) ` +
      `[${adopted.join(', ')}] and was self-skipped — these can never auto-sync from this publisher. If another ` +
      `machine/origin signs with this key, rotate localStorage['hc:nostr:secret-key'] on this consumer (a fresh ` +
      `identity mints on reload). Another tab of THIS origin also trips this — harmless in that case.`,
    )
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
    //
    // Judged on the RELAY's clock (the mesh's hc:host-corrected nowSec) with
    // EXPIRY_GRACE_SECS of slack: a device whose own clock runs 90 s slow
    // used to see every fresh event as already expired, and a peer the room
    // could see was invisible to it (clock-skew-zero-tolerance).
    if (kind === SWARM_LAYER_KIND || kind === SWARM_HIDE_KIND || kind === SWARM_INTEREST_KIND || kind === SWARM_SUBSCRIBE_REQUEST_KIND || kind === SWARM_PRESENCE_KIND) {
      const nowSec = this.#nowSec()
      const tags = evt?.event?.tags ?? []
      const expirationTag = tags.find(t => t[0] === 'expiration')?.[1]
      if (expirationTag) {
        const expirationSec = Number(expirationTag)
        if (Number.isFinite(expirationSec) && expirationSec + EXPIRY_GRACE_SECS <= nowSec) {
          slog('[swarm] onEvent DROPPED: expired', { kind, fromPubkey: evt?.event?.pubkey?.slice(0,8), expirationSec, nowSec, delta: expirationSec - nowSec })
          return
        }
      } else {
        const createdAt = Number(evt?.event?.created_at ?? 0)
        if (Number.isFinite(createdAt) && createdAt > 0 && createdAt + EVENT_TTL_SECS + EXPIRY_GRACE_SECS < nowSec) {
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
    if (this.#myPubkey && pubkey === this.#myPubkey) {
      // Never a peer — but what we said here before (a reload's earlier
      // full entries), which the reload's first walk may say again.
      this.#noteOwnReplay(sig, evt)
      this.#noteSelfSkippedLayerEvent(sig, Number(evt?.event?.created_at ?? 0), evt?.payload)
      return
    }

    // Ordering guard — drop layer events strictly older than the newest
    // we've already applied from this publisher at this sig. See
    // #peerLayerAppliedAtBySigPubkey for the replay-scramble this closes.
    const createdAtSec = Number(evt?.event?.created_at ?? 0)
    // Departed guard — see #departedAtSec: the relay replays a departed
    // participant's last layer slot to any REQ until it expires.
    const departedAtSec = this.#departedAtSec.get(pubkey)
    if (departedAtSec !== undefined) {
      if (createdAtSec > departedAtSec) this.#departedAtSec.delete(pubkey)
      else { slog('[swarm] onEvent DROPPED: departed (older than tombstone)', { pubkey: pubkey.slice(0, 8), createdAtSec, departedAtSec }); return }
    }
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
    this.#noteExpiry(sig, pubkey, evt?.event?.tags, createdAtSec)
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
    // Also feed identity-level liveness — a layer event is proof of life
    // regardless of which location it came from (unless it is a replay
    // from before the participant went away). The lifecycle beacon is the
    // primary signal, but stamping here keeps pre-beacon / legacy peers on
    // the roster while their tiles are on screen.
    this.#markAlive(pubkey, createdAtSec)

    // Domain attribution — the publisher advertised their host as a
    // ['domain', …] tag (mirroring the broker's 30401 responses). Record it
    // against each visual's layer and image refs in the address graph, so an
    // adopt-click's getKnownDomains(layerSig) answers "which host serves
    // this tile" — that's what files the adopt under its capture-source
    // folder (jwize.com/dolphin) and gives the installer an HTTP-direct
    // byte path. Image attribution also clears prior preview miss windows.
    // Must run BEFORE the auto-adopt emit below, which reads the
    // attribution synchronously. Untrusted input: it only ever adds a
    // Tier-2 fetch candidate; sha256 still gates every byte.
    const domainTags = (evt?.event?.tags ?? [])
      .filter((t): t is string[] => Array.isArray(t) && String(t[0]) === 'domain' && !!String(t[1] ?? '').trim())
      .map(t => String(t[1]).trim())
    const broker = this.#getBroker()
    if (domainTags.length && broker?.noteDomainsForSig) {
      noteVisualHosts(cleanVisuals, domainTags, broker.noteDomainsForSig)
    }
    const refs = visualArtifactSigs(cleanVisuals)
    // The same host is where their NAME is asked (names.service.ts) — this
    // event is the key's own, signed and relay-verified, and only when it
    // names bytes is the host on the byte path the attribution above opened.
    if (refs.length) for (const host of domainTags) nameService.hint(pubkey, host)

    // THE PUBLISHER IS HERE, AND THEY HAVE THE BYTES. Unconditional — the
    // attribution above only fires for a peer who advertises a host, which
    // most participants never do, so a plain peer's arrival used to clear
    // nothing. Every sig of theirs that had already missed stayed on the
    // broker's exponential ladder (60s doubling toward 30 min) even though the
    // one participant who could answer it had just announced themselves. That
    // is why tiles trickled in for minutes instead of resolving on connect.
    // Idempotent per (pubkey, sig) inside the broker, so the 30s heartbeat
    // re-announce costs nothing and the crowd cannot turn this into a storm.
    if (broker?.notePeerLiveness) {
      if (refs.length) broker.notePeerLiveness(pubkey, refs)
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
    // Acceptance is a participant action — this only lights the signal. (Was
    // "Follow == auto-adopt", which folded the followed peer's content into our
    // tree on every republish with zero gesture in the moment; removed per the
    // manual-update safety rule.)
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
      if (payload.sig === this.#currentSig) this.#emitPresence(payload.reason)
    }, 150)
  }

  /** swarm:presence-changed — who publishes at the page we stand on
   *  (`peers`, excluding self and expired slots), plus the whole room
   *  (`zonePeers`): every member with their place — here, elsewhere, or
   *  away (socket gone, tiles kept until their slots expire). */
  #emitPresence = (reason: string, sig: string = this.#currentSig): void => {
    const peers = this.participantsAtCurrentSig()
    this.emitEffect('swarm:presence-changed', {
      sig,
      peerCount: peers.length,
      alone: peers.length === 0,
      peers,
      zonePeers: this.#zonePeers(peers),
      reason,
    })
  }

  #zonePeers = (here: readonly string[]): { pubkey: string; label: string; state: 'here' | 'elsewhere' | 'away' }[] => {
    const hereSet = new Set(here)
    const out: { pubkey: string; label: string; state: 'here' | 'elsewhere' | 'away' }[] = []
    const seen = new Set<string>()
    const add = (pubkey: string, state: 'here' | 'elsewhere' | 'away'): void => {
      if (seen.has(pubkey) || pubkey === this.#myPubkey) return
      seen.add(pubkey)
      out.push({ pubkey, label: this.#labelByPubkey.get(pubkey) ?? '', state })
    }
    for (const pk of this.participantsInZone()) add(pk, hereSet.has(pk) ? 'here' : 'elsewhere')
    for (const pk of here) add(pk, this.#awayPubkeys.has(pk) ? 'away' : 'here')
    for (const pk of this.awayInZone()) add(pk, 'away')
    return out
  }

  /** Debounce token for "republish my current layer because something
   *  changed in a child's 0000 (or a cell was added)." Bursts of
   *  writes coalesce into one publish at the trailing edge. */
  #propsRepublishTimer: ReturnType<typeof setTimeout> | null = null

  /** Debounce token for the receipt-driven re-walk: each landed host
   *  receipt can turn a placeholder or a previous version into the newest
   *  one, and a drain confirms receipts in runs — one walk per
   *  RECEIPT_REWALK_MS window (the current page's walk also single-flights). */
  #receiptRepublishTimer: ReturnType<typeof setTimeout> | null = null

  // A tile created in a swarm is public by default so the swarm can
  // collaborate on it. Gated on the SAME membership + room+secret checks as
  // every other swarm network action (see #syncForCurrentLineage): outside a swarm a
  // create leaves the tile private — the per-tile public/private flag is
  // a self-facing world-mode marker and must stay opt-in there. The
  // isCellPublic guard makes this idempotent: a re-emitted cell:added (e.g.
  // tagging an already-public tile) or a tile already covered by a public
  // branch is a no-op, so we never churn a resync for nothing.
  //
  // COLLECTION ITEMS ARE EXEMPT — private by default even inside a swarm. A
  // personal collection (reference set) must never auto-publish just because
  // you happen to be sharing elsewhere. Three race-free signals:
  //   • payload.reference — the creator flags it (the decoration index warms
  //     async, so it can't be trusted at create time; the flag can);
  //   • the /sets index location — tiles minted on the collections page;
  //   • referenceTargetForLabel — a WARM reference being re-touched (tag edit).
  // This only suppresses the AUTOMATIC publish; you can still make a collection
  // item public deliberately in world mode.
  #autoPublishInSwarm = (payload: { cell?: string; segments?: readonly string[]; reference?: boolean }): void => {
    const cell = String(payload?.cell ?? '').trim()
    if (!cell) return
    // In a swarm means THIS TAB is joined (per-tab membership). A zone
    // remembered in origin-wide localStorage by a solo tab, a tab that left,
    // or an unjoined second tab is not membership: its creates stay private,
    // and a later join never broadcasts them. The join gesture flips
    // membership synchronously, so a late joiner's first create is armed in
    // the same turn.
    if (!isJoinedHere()) return
    const room = this.#getRoomStore()?.value?.trim() ?? ''
    const secret = this.#getSecretStore()?.value?.trim() ?? ''
    if (!room || !secret) return  // not in a swarm — stay private by default
    const segsRaw = payload?.segments
    const segments = (Array.isArray(segsRaw) ? segsRaw : [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    // Collection-item exemption (see method comment) — leave it private.
    if (payload?.reference === true) return
    if (segments[0] === 'sets') return
    if (referenceTargetForLabel(cell) !== null) return
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

  /** One re-walk per burst, RECEIPT_REWALK_MS after the first trigger, of
   *  the page we stand on and every page still waiting on a host. */
  #scheduleReceiptRewalk = (): void => {
    if (!this.#currentSig || !isJoinedHere()) return
    if (this.#receiptRepublishTimer !== null) return
    this.#receiptRepublishTimer = setTimeout(() => {
      this.#receiptRepublishTimer = null
      void this.#publishMyLayerAt(this.#currentSig)
      // The personal channel says the same page: while it still carries names
      // or earlier versions, it follows the page up (only if its word moved).
      if (this.#channelPending) void this.#publishCurrentVisualsToMyChannel(this.currentSegments(), true)
      const currentKey = this.#currentPageKey()
      for (const [key, segments] of [...this.#pendingPages]) {
        if (key !== currentKey) void this.#walkPage(segments)
      }
    }, RECEIPT_REWALK_MS)
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

  // The walk of the page this tab stands on. It fires TWICE per navigation
  // (Lineage 'change' + the per-render mesh:ensure-started heartbeat) and on
  // every props change and receipt; unguarded, concurrent walks stacked up and
  // starved the main thread. #walkPage single-flights it PER PAGE — never one
  // guard for all pages, which let one slow walk silence every other.
  #publishMyLayerAt = async (sig: string): Promise<void> => {
    // Never into a room this tab has left — a timer or a receipt queued
    // before the leave must find nothing to say.
    if (!isJoinedHere()) return
    const mesh = this.#getMesh()
    const sigStore = this.#getSignatureStore()
    if (!mesh?.publish || !sigStore) { slog('[swarm] publishMyLayerAt: missing mesh/sigStore', { mesh: !!mesh?.publish, sigStore: !!sigStore }); return }

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

    // Fire-and-forget: presence and the rest of the sync never wait on it.
    void this.#walkPage(segments, dir)
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
    // Still the walk this page wants? A superseded walk (#walkPage's stall
    // guard) or one that outlived the join never publishes.
    live: () => boolean = () => true,
  ): Promise<void> => {
    if (counter.count >= MAX_PUBLISH_NODES) return
    this.#publishStats.walkNodeVisits++
    const stat: WalkStat = {
      startedAtMs: Date.now(), endedAtMs: 0, ms: 0, outcome: 'error',
      full: 0, previous: 0, placeholder: 0, private: 0, sealsLate: 0, answersLate: 0,
    }
    try {
      await this.#publishPage(dir, segments, depth, counter, sigStore, mesh, room, secret, live, stat)
    } finally {
      if (depth === 0) this.#noteWalk(lineageKey(segments), stat)
    }
  }

  /** debug()'s record of a page walk — the last per page, bounded. */
  #noteWalk = (pageKey: string, stat: WalkStat): void => {
    stat.endedAtMs = Date.now()
    stat.ms = stat.endedAtMs - stat.startedAtMs
    this.#walkStats.delete(pageKey)
    this.#walkStats.set(pageKey, stat)
    while (this.#walkStats.size > WALK_STATS_MAX) {
      const oldest = this.#walkStats.keys().next().value
      if (oldest === undefined) break
      this.#walkStats.delete(oldest)
    }
  }

  #publishPage = async (
    dir: FileSystemDirectoryHandle | null,
    segments: readonly string[],
    depth: number,
    counter: { count: number },
    sigStore: SignatureStoreLike,
    mesh: MeshApi,
    room: string,
    secret: string,
    live: () => boolean,
    stat: WalkStat,
  ): Promise<void> => {
    // Composed sig — must match the formula in #syncForCurrentLineage /
    // composeSigForSegments exactly so subscribers and publishers address the
    // same slot. Canonical key via lineageKey() (folds punctuation) — the walk
    // still resolves dirs/children by RAW name; only the hashed key normalizes.
    const key = `${lineageKey(segments)}\0${room}\0${secret}`
    let sig = ''
    try { sig = await sigStore.signText(key) } catch { return }
    if (!sig) return
    // What we said here before a reload starts arriving with the page's
    // subscription; waited on (bounded) only by a child with nothing newer to
    // say — beside the reads below, never after them.
    const replayReady = this.#replayReady(sig)
    const publicLocation = '/' + segments.join('/')

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
    //
    // PUBLIC FIRST, THEN SEAL: only a child that is public here is sealed. A
    // private subtree (thousands of nodes in a big hive) is never sealed,
    // walked or uploaded for the swarm.
    const known = await this.#resolveChildRefs(dir, segments, name => isCellPublic(publicLocation, name), stat)
    // Unknown (history cold): say NOTHING here and stamp no memo — the relay
    // keeps our last slot, and the heartbeat, a receipt or a navigation walks
    // again. Never an empty page for a page we could not read.
    if (known === null) { stat.outcome = 'unknown'; return }
    let childRefs: ChildRef[] = known

    // ── PUBLIC FILTER ─────────────────────────────────────────────────
    // Broadcast ONLY the public subset. Private children (and private
    // branches) are pruned here — and because childNames (recursion) derives
    // from childRefs, private branches are never walked or published either,
    // so private content never leaves the device. Public is participant-local
    // and is NEVER folded into the signed layer (keeps the rendezvous sig
    // stable across peers — same invariant as `hidden`). isCellPublic is
    // branch-aware: a public-branch root covers all its descendants. A
    // private child is never announced in ANY form — not even its name.
    //
    // Capture the PRUNED names too. A child that just flipped
    // public→private would otherwise simply vanish from the recursion,
    // leaving any slot we already published for its subtree lingering on
    // the relay until its ~90s NIP-40 expiry — a peer sitting inside the
    // branch keeps seeing our retracted tiles. We recurse into those in
    // retraction mode (#wipeSubtree) below to replace them with empty
    // payloads at once.
    const prunedNames: string[] = []
    const publicRefs: ChildRef[] = []
    const hostSync = this.#getHostSync()
    for (const c of childRefs) {
      if (!isCellPublic(publicLocation, c.name)) {
        prunedNames.push(c.name)
        // Made private again: an upload of its bytes still waiting in the
        // queue (a 'full' host, a backlog) no longer goes to the room's host —
        // withdrawn by every handle this session marked for it (it is never
        // sealed again to learn one).
        const markedKey = `${sig}\0${c.name}`
        const marked = this.#markedHandles.get(markedKey)
        if (marked) {
          this.#markedHandles.delete(markedKey)
          for (const handle of marked) { try { hostSync?.withdrawPublic?.(handle) } catch { /* never disturb the walk */ } }
        }
        continue
      }
      // CDN doctrine-gate feed: this walk enumerates EXACTLY the public
      // subset, so it is the sanctioned writer of `.public` markers
      // (host-sync markPublic) — and marking is what stages the upload to
      // this page's swarm hosts (its publish domains, else the hosts pool,
      // else a relay that hosts participants). A public-BRANCH root vouches
      // for its whole closure; an individually-public tile marks only its own
      // layer + resources (closure=false) — private descendants must never
      // acquire a marker. Fire-and-forget: never awaited in the walk, never
      // throws into it.
      if (c.layerSig && hostSync) {
        try {
          void hostSync.markPublic(c.layerSig, 'layer', isBranchPublic(publicLocation, c.name), segments)
            .catch(() => undefined)
          const markedKey = `${sig}\0${c.name}`
          const marked = this.#markedHandles.get(markedKey) ?? new Set<string>()
          marked.add(c.layerSig)
          this.#markedHandles.set(markedKey, marked)
        } catch { /* never disturb the publish walk */ }
      }
      publicRefs.push(c)
    }
    childRefs = publicRefs
    stat.private = prunedNames.length
    const childNames = childRefs.map(c => c.name)  // legacy local var — still used by recursion + log
    const pageKey = lineageKey(segments)
    // Unknown hosts: say NOTHING here and stamp no memo (HOSTS_PENDING_WAIT_MS).
    if (this.#perPage(hostSync) && this.#pageHosts(segments)?.pending && this.#holdForHosts(pageKey, segments)) { stat.outcome = 'held-for-hosts'; return }

    // One entry per public child — its newest version when a host serves
    // it, else the last version one did, else its name (see #entryFor).
    // What the last walk remembered of a child that is gone (deleted, renamed
    // away, made private) goes with it: a later tile of the same name must
    // never be offered the deleted one's handle and picture — not from this
    // session's memory, not from a replay, not from a seal still landing.
    const here = new Set(childRefs.map(c => `${sig}\0${c.name}`))
    for (const key of [...this.#lastHostedEntry.keys()]) {
      if (key.startsWith(`${sig}\0`) && !here.has(key)) this.#lastHostedEntry.delete(key)
    }
    const replayed = this.#ownReplay.get(sig)
    for (const name of [...(replayed?.keys() ?? [])]) if (!here.has(`${sig}\0${name}`)) replayed!.delete(name)
    const childPaths = new Set(childRefs.map(c => [...segments, c.name].join('\0')))
    for (const path of [...this.#lastSeal.keys()]) {
      const parts = path.split('\0')
      const underThisPage = parts.length === segments.length + 1 && segments.every((s, i) => parts[i] === s)
      if (underThisPage && !childPaths.has(path)) this.#lastSeal.delete(path)
    }
    const announced = await Promise.all(childRefs.map(c => this.#entryFor(c, segments, sig, hostSync, replayReady)))
    for (const a of announced) {
      stat[a.form]++
      if (a.late) stat.answersLate++
    }
    // A child whose closure reaches a page still being read, with nothing
    // hosted to say for it yet: the same hold as above, rather than a name
    // where a hosted entry may already stand.
    if (announced.some(a => a.unknown) && this.#holdForHosts(pageKey, segments)) { stat.outcome = 'held-for-hosts'; return }
    this.#releaseHostsHold(pageKey)
    const children: ChildEntry[] = announced.map(a => a.entry)
    const nameOnly = announced.filter(a => a.form === 'placeholder').length
    const uploading = announced.filter(a => a.form !== 'full').length
    // A replay of our own earlier word that lands after this walk may turn
    // these names back into what we said before (#noteOwnReplay).
    if (nameOnly > 0) this.#placeholderSigs.add(sig)
    else this.#placeholderSigs.delete(sig)
    if (uploading > 0) {
      // Re-insert so the freshest waiting page sits last; the oldest falls off.
      this.#pendingPages.delete(pageKey)
      this.#pendingPages.set(pageKey, [...segments])
      while (this.#pendingPages.size > PENDING_PAGES_MAX) {
        const oldest = this.#pendingPages.keys().next().value
        if (oldest === undefined) break
        this.#pendingPages.delete(oldest)
      }
    } else {
      this.#pendingPages.delete(pageKey)
    }
    if (pageKey === this.#currentPageKey()) {
      // The sharer's status line for the page they stand on: how many go
      // out, how many are still on their way to the host (and of those, how
      // many as a name alone), how many stay private, WHICH host this page's
      // tiles go to and why that one (publish domains, the hosts pool, the
      // relay), and what it last said — the reason a name-only tile is
      // name-only. No host at all is said as 'no-host'. A branch held by a
      // host that takes none of its bytes is NAMED, with the host and why
      // (`blocked`), and is not counted as uploading: it is not on its way.
      this.#privateHere = prunedNames.length
      const { blocked, heldChildren } = this.#blockedBranches(segments, hostSync, childRefs, announced.map(a => a.form))
      const stillUploading = heldChildren.size === 0 ? uploading
        : announced.filter((a, i) => a.form !== 'full' && !heldChildren.has(childRefs[i]!.name)).length
      this.emitEffect('swarm:share-status', {
        location: publicLocation,
        offered: children.length,
        uploading: stillUploading,
        nameOnly,
        private: prunedNames.length,
        ...this.#hostReport(segments),
        ...(blocked.length > 0 ? { blocked } : {}),
      })
    }
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
    stat.outcome = 'unchanged'
    if (contentChanged || heartbeatDue) {
      // A newer walk of this page took over, or this tab left meanwhile:
      // what this one learned is no longer the page's word.
      if (!live()) { stat.outcome = 'superseded'; return }
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
      // Attribute the hosts that hold these tiles' bytes so receivers learn
      // WHERE they live (the adopt's capture-source folder + byte path) —
      // this page's swarm hosts first, then where the offered branches'
      // subtrees went (#domainTags).
      tags.push(...this.#domainTags(segments, this.#closureHosts(hostSync, childRefs)))
      this.#publishStats.wireEvents++
      // The page this tab stands on is in the room once the relay TAKES its
      // word (not when it is sent or queued, which a fresh join's connecting
      // socket does first). What waits on that — the ask about tiles from
      // before the meeting, share-ask.worker.ts — runs after it, never
      // before: the page's address only, no count, no name of anything on it.
      const delivered = await mesh.publish(SWARM_LAYER_KIND, sig, payload, tags,
        () => this.#pageTaken(sig, serialized, segments, publicLocation))
      // Publish honesty: `false` means signing failed — NOTHING reached
      // (or was queued for) a relay. Un-stamp the memo so the next walk
      // retries instead of believing the slot is live for 45s while
      // peers see nothing.
      if (delivered === false) {
        this.#lastPublishedBySig.delete(sig)
        this.#lastPublishTimeMsBySig.delete(sig)
        stat.outcome = 'not-sent'
      } else {
        stat.outcome = 'said'
        if (depth === 0 && this.#joinedAtMs > 0 && !this.#firstAnnounce) {
          const atMs = Date.now()
          this.#firstAnnounce = {
            page: lineageKey(segments), atMs,
            afterJoinMs: atMs - this.#joinedAtMs, afterBootMs: atMs - this.#bootMs,
            full: stat.full, previous: stat.previous, placeholder: stat.placeholder,
          }
        }
      }
    } else if (pageKey === this.#currentPageKey() && isJoinedHere() && this.#takenBySig.get(sig) === serialized) {
      // Unchanged: this meeting's word for the page went out within
      // LAYER_REFRESH_MS and the relay took it, so arriving back here is an
      // arrival all the same — the page is in the room.
      this.emitEffect('swarm:page-announced', { location: publicLocation, segments: [...segments] })
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
        live,
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

  // ── ANNOUNCE WHAT THE HOST SERVES; FOR ANYTHING ELSE, ONLY THE NAME ──
  // (jwize, 2026-10-04 — supersedes the 09-25 hold-back.) Hosting stays the
  // truth: no signature goes out that no host serves, so a take never 404s.
  // But a tile is never TAKEN BACK for being new, edited, uploading, refused
  // or reloaded — the hold-back blinked every edited tile out for the whole
  // room (edit-churn-retracts-shared-tiles) and withdrew a reloaded sharer's
  // tiles for good (reload-drops-session-host). Per public child, per walk:
  //
  //   (a) its closure is served — a receipt on any current target, which
  //       while joined always includes the swarm host (the relay this tab
  //       meets at) → the FULL entry, remembered in #lastHostedEntry;
  //   (b) not served, but an earlier version was → that earlier entry,
  //       byte-for-byte: its old handle and old picture are still served;
  //   (c) neither → a PLACEHOLDER: the name, titles and inert props, with
  //       layerSig, inviteSig and every value carrying a signature removed,
  //       recursively. It renders as a label tile; it cannot be taken
  //       until (a) lands, because a take needs a layerSig.
  //
  // A sig-less child (layer not committed yet) has nothing a host could
  // serve, so it goes out as (b) or (c) until its first commit. Without a
  // gate service at all (a shell with no host-sync) there is nothing to wait
  // for, and every child is (a).
  //
  // (b) is RE-ASKED, never assumed: the earlier entry goes out only while
  // the current targets still serve its closure (a memoized yes, cheap). A
  // relay switch that kept the zone, or a host that lost the bytes, must not
  // send handles nothing reachable serves.
  //
  // NO ANSWER IS WAITED ON PAST ENTRY_WAIT_MS (jwize 2026-10-09, "make it so
  // it never breaks"). A first walk used to wait for the newest version's
  // verdict with no cap whenever it had no earlier version to say — every
  // walk after a join or a reload — and a big hive's first page stayed
  // silent until its slowest public closure had uploaded and verified:
  // eleven minutes, live. Now a late answer is treated as "not yet": the
  // child goes out as (b) or (c), and the answer, when it lands, walks the
  // page again. A late re-ask of an earlier version keeps it (late is not
  // "no", like unknown); a "no" that lands later walks the page again and
  // drops it there. The question keeps running and the next walk joins it
  // (#askOnce) — capped waits never stack closure walks.
  //
  // And (b) survives a reload: with nothing of this session to say, the
  // earlier version is what the relay replayed to us under our own key at
  // this page (#ownReplay, waited on at most REPLAY_WAIT_MS) — re-asked the
  // same way. A placeholder would take back what the page said before the
  // reload.
  #entryFor = async (
    child: ChildRef,
    segments: readonly string[],
    pageSig: string,
    hostSync: HostSyncLike | undefined,
    replayReady?: Promise<void>,
  ): Promise<{ entry: ChildEntry; form: EntryForm; unknown?: boolean; late?: boolean }> => {
    const location = '/' + segments.join('/')
    const memoKey = `${pageSig}\0${child.name}`
    const closure = isBranchPublic(location, child.name)
    let previous = this.#lastHostedEntry.get(memoKey)
    let available = typeof hostSync?.isClosureAvailable !== 'function'
    // HOSTED = served WHERE IT IS SHOWN: the tile by this page's swarm hosts,
    // its subtree by the hosts of the pages below (a branch's own publish
    // domains) — every one of them named in this page's event — or by our own
    // backup host. A receipt on some other target would announce a handle the
    // receiver is never told where to fetch. Unjoined (a follower channel) or
    // an older host-sync: any target. null = a page's hosts still being read.
    const perPage = this.#perPage(hostSync)
    const self = this.#advertisedSelf()
    const advertised = perPage ? this.#advertisedHosts(segments) : []
    const scope = perPage ? `${segments.join('\0')}|${self.join(',')}|${advertised.join(',')}` : '*'
    const servedHere = (sig: string): Promise<boolean | null> => this.#askOnce(`${sig}\0${closure ? 'c' : 't'}\0${scope}`, () => !perPage
      ? hostSync!.isClosureAvailable!(sig, 'layer', closure)
      : typeof hostSync!.isClosureAvailableAt === 'function'
        ? hostSync!.isClosureAvailableAt(sig, 'layer', closure, segments, self)
        : (advertised.length > 0 ? hostSync!.isClosureAvailableOn!(sig, 'layer', closure, advertised) : Promise.resolve(false)))
    let unknown = false
    let late = false
    if (!available && child.layerSig) {
      const seq = this.#answerSeq
      const verdict = servedHere(child.layerSig)
      const r = await this.#within(verdict, ENTRY_WAIT_MS)
      if (r.late) {
        late = true
        // The answer lands after the walk moved on: a yes — or any answer to
        // a question a receipt has overtaken — walks the page again.
        void verdict.then(ok => { if (ok === true || this.#answerSeq !== seq) this.#scheduleReceiptRewalk() })
      } else {
        available = r.value === true
        unknown = r.value === null
      }
    }
    if (available) {
      const entry = await this.#visualFor(child, segments)
      if (child.layerSig) this.#lastHostedEntry.set(memoKey, entry)
      return { entry, form: 'full' }
    }
    // Nothing newer to say: what was said before — this session, or what the
    // relay replayed to us under our own key (a reload).
    let replayed = false
    if (!previous) {
      if (replayReady) await replayReady
      previous = this.#ownReplay.get(pageSig)?.get(child.name)?.entry
      replayed = previous !== undefined
    }
    if (previous && typeof previous.layerSig === 'string' && hostSync?.isClosureAvailable) {
      const seq = this.#answerSeq
      const asked = servedHere(previous.layerSig)
      const r = await this.#within(asked, ENTRY_WAIT_MS)
      if (r.late) {
        late = true
        void asked.then(ok => { if (ok === false || this.#answerSeq !== seq) this.#scheduleReceiptRewalk() })
      }
      // Unknown is not "no", and neither is late: what was hosted stands
      // until the hosts answer.
      const still = r.late ? null : r.value
      if (still === false) {
        this.#lastHostedEntry.delete(memoKey)
        this.#ownReplay.get(pageSig)?.delete(child.name)
        previous = undefined
      } else if (replayed && still === true) {
        this.#lastHostedEntry.set(memoKey, previous)
      }
    }
    if (previous) return { entry: previous, form: 'previous', ...(late ? { late: true } : {}) }
    const { name, layerSig: _layerSig, inviteSig: _inviteSig, ...rest } = await this.#visualFor(child, segments)
    void _layerSig; void _inviteSig
    const inert = withoutSignatures(rest) as Record<string, unknown> | undefined
    return {
      entry: canonicaliseValue({ ...(inert ?? {}), name }) as ChildEntry,
      form: 'placeholder',
      ...(unknown ? { unknown: true } : {}),
      ...(late ? { late: true } : {}),
    }
  }

  /** `promise` if it settles within `ms`, else `late` — the question keeps
   *  running; the caller decides what its answer does when it lands. */
  #within = async <T>(promise: Promise<T>, ms: number): Promise<Within<T>> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise.then((value): Within<T> => ({ late: false, value })),
        new Promise<Within<T>>(resolve => { timer = setTimeout(() => resolve({ late: true }), ms) }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /** One host question per key at a time: a walk that finds it running joins
   *  it. A throw answers "no". */
  #askOnce = (key: string, ask: () => Promise<boolean | null>): Promise<boolean | null> => {
    const held = this.#asking.get(key)
    if (held) return held
    const asked: Promise<boolean | null> = Promise.resolve()
      .then(ask)
      .catch((): boolean | null => false)
      .finally(() => { if (this.#asking.get(key) === asked) this.#asking.delete(key) })
    this.#asking.set(key, asked)
    return asked
  }

  /** A public child's sealed handle — history's merkle seal of its live
   *  subtree (the raw sig when history cannot seal it now, or has no seal).
   *  Not waited on past SEAL_WAIT_MS: a late seal keeps running, the walk
   *  offers the last seal that landed for that path (or no handle at all),
   *  and the seal, when it lands, walks the page again. One seal per path at
   *  a time. */
  #sealedHandle = async (
    history: HistoryServiceLike,
    childSegments: readonly string[],
    raw: string,
    stat?: WalkStat,
  ): Promise<string | undefined> => {
    if (!history.sealSubtree) return raw
    const key = childSegments.join('\0')
    let sealing = this.#sealing.get(key)
    if (!sealing) {
      const started: Promise<string | null> = Promise.resolve()
        .then(() => history.sealSubtree ? history.sealSubtree(childSegments) : null)
        .catch((): string | null => null)
        .then((sealed) => { if (sealed) this.#lastSeal.set(key, sealed); return sealed })
        .finally(() => { if (this.#sealing.get(key) === started) this.#sealing.delete(key) })
      this.#sealing.set(key, started)
      sealing = started
    }
    const r = await this.#within(sealing, SEAL_WAIT_MS)
    if (!r.late) return r.value || raw
    if (stat) stat.sealsLate++
    void sealing.then(() => this.#scheduleReceiptRewalk())
    return this.#lastSeal.get(key)
  }

  /** Wait — once per page per session, at most REPLAY_WAIT_MS — for the
   *  relay to replay what WE said at `sig` before (#ownReplay). Ends at the
   *  page subscription's first stored event or end-of-stored-events (plus a
   *  frame for the rest of the burst), or at once on a mesh that cannot say.
   *  Then reads the mesh's cache once for what the live path could not file
   *  (our key resolved after the replay arrived). */
  #replayReady = (sig: string): Promise<void> => {
    if (this.#replaySettled.has(sig)) return Promise.resolve()
    // Joined in this page: nothing of ours is there to wait for. A replay
    // that does arrive still restores earlier entries on the next walk.
    if (!this.#resumedZone) return Promise.resolve()
    const held = this.#replayWaits.get(sig)
    if (held) return held
    const mesh = this.#getMesh()
    const wait: Promise<void> = (async (): Promise<void> => {
      if (typeof mesh?.awaitReadyForSig !== 'function') return
      const startMs = Date.now()
      await this.#within(mesh.awaitReadyForSig(sig, REPLAY_WAIT_MS).catch(() => undefined), REPLAY_WAIT_MS)
      const left = REPLAY_WAIT_MS - (Date.now() - startMs)
      if (!this.#ownReplay.has(sig) && left > 0) {
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(REPLAY_SETTLE_MS, left)))
      }
    })().catch(() => undefined).finally(() => {
      if (this.#replayWaits.get(sig) === wait) this.#replayWaits.delete(sig)
      this.#replaySettled.add(sig)
      if (this.#ownReplay.has(sig)) return
      try { for (const evt of mesh?.getNonExpired?.(sig) ?? []) this.#noteOwnReplay(sig, evt) } catch { /* nothing cached */ }
    })
    this.#replayWaits.set(sig, wait)
    return wait
  }

  /** File an event the relay replayed under OUR key at page `sig`: each full
   *  entry (one with a layerSig) it names, the newest per child. Only from a
   *  relay (never our local fanout), only while its slot is alive, and only
   *  when its signature verifies — a relay cannot put words in our mouth.
   *  A page whose last walk sent names alone is walked again. */
  #noteOwnReplay = (sig: string, evt: MeshEvtLike): void => {
    const event = evt?.event
    if (!sig || !event || Number(event.kind) !== SWARM_LAYER_KIND) return
    const me = this.#myPubkey
    if (!me || String(event.pubkey ?? '').toLowerCase() !== me) return
    if (!evt.relay || evt.relay === 'local') return
    const atSec = Number(event.created_at ?? 0)
    if (!(atSec > 0)) return
    const expSec = expiryOf(event.tags, atSec, () => 0)
    if (expSec > 0 && this.#nowSec() > expSec + EXPIRY_GRACE_SECS) return
    let visuals: unknown
    try {
      if (!verifyEvent(event as never)) return
      visuals = (JSON.parse(String(event.content ?? '')) as { visuals?: unknown } | null)?.visuals
    } catch { return }
    if (!Array.isArray(visuals)) return
    let bag = this.#ownReplay.get(sig)
    let added = false
    for (const v of visuals) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue
      const entry = v as ChildEntry
      if (typeof entry.name !== 'string' || !entry.name) continue
      if (typeof entry.layerSig !== 'string' || !SIG_DIR_RE.test(entry.layerSig)) continue
      const held = bag?.get(entry.name)
      if (held && held.atSec >= atSec) continue
      if (!bag) { bag = new Map(); this.#ownReplay.set(sig, bag) }
      bag.set(entry.name, { entry, atSec })
      added = true
    }
    while (this.#ownReplay.size > PENDING_PAGES_MAX) {
      const oldest = this.#ownReplay.keys().next().value
      if (oldest === undefined) break
      this.#ownReplay.delete(oldest)
    }
    if (added && this.#placeholderSigs.has(sig)) this.#scheduleReceiptRewalk()
  }

  /** Does this host-sync answer where each PAGE's bytes go (and is this tab
   *  joined, so it has swarm hosts)? */
  #perPage = (hostSync: HostSyncLike | undefined): boolean =>
    isJoinedHere() && typeof hostSync?.swarmHostsFor === 'function'
    && (typeof hostSync.isClosureAvailableAt === 'function' || typeof hostSync.isClosureAvailableOn === 'function')

  /** Hold a page while its hosts are being read (HOSTS_PENDING_WAIT_MS):
   *  true = say nothing this walk. The answer landing walks it again
   *  (swarm:hosts-changed); so does the end of the wait, after which the walk
   *  goes on with what it has. */
  #holdForHosts = (pageKey: string, segments: readonly string[]): boolean => {
    const now = Date.now()
    const since = this.#hostsHeldSince.get(pageKey)
    if (since === undefined) this.#hostsHeldSince.set(pageKey, now)
    const waited = now - (since ?? now)
    if (waited >= HOSTS_PENDING_WAIT_MS) return false
    this.#pendingPages.delete(pageKey)
    this.#pendingPages.set(pageKey, [...segments])
    if (!this.#hostsHeldTimers.has(pageKey)) {
      this.#hostsHeldTimers.set(pageKey, setTimeout(() => {
        this.#hostsHeldTimers.delete(pageKey)
        this.#scheduleReceiptRewalk()
      }, HOSTS_PENDING_WAIT_MS - waited + 20))
    }
    return true
  }

  #releaseHostsHold = (pageKey: string): void => {
    this.#hostsHeldSince.delete(pageKey)
    const timer = this.#hostsHeldTimers.get(pageKey)
    if (timer !== undefined) { clearTimeout(timer); this.#hostsHeldTimers.delete(pageKey) }
  }

  /** Where the offered tiles' subtrees went, beyond this page's own hosts:
   *  the hosts of the pages below each offered branch (host-sync learns them
   *  re-staging). A receiver taking a branch from this page is told. */
  #closureHosts = (hostSync: HostSyncLike | undefined, refs: readonly ChildRef[]): string[] => {
    if (!this.#perPage(hostSync) || typeof hostSync?.closureHostsOf !== 'function') return []
    const out: string[] = []
    for (const c of refs) {
      if (!c.layerSig) continue
      try { for (const h of hostSync.closureHostsOf(c.layerSig)) if (!out.includes(h)) out.push(h) } catch { /* an older host-sync */ }
    }
    return out
  }

  // One child's visual — flat: { name, layerSig?, ...0000_fields, titles?,
  // inviteSig? }.
  //   name        — lineage leaf, identifies which child this is
  //   ...rest     — every first-class cell property from the child's
  //                 canonical 0000 (index, imageSig, small.image, tags,
  //                 link, …) inlined directly. No `props` wrapper —
  //                 these ARE the cell properties; nesting them under
  //                 `props` would be dead weight on the wire AND force
  //                 every receiver (render, adopt) to do an extra
  //                 unwrap before reaching the actual data.
  //
  // Image bytes referenced inside the 0000 (typically as `small.image` or
  // top-level `imageSig`) travel as SIGNATURES only; a receiver fetches the
  // bytes from a host when it asks for them.
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
  #visualFor = async ({ name, layerSig }: ChildRef, segments: readonly string[]): Promise<ChildEntry> => {
    const base: ChildEntry = layerSig ? { name, layerSig } : { name }
    let visual: ChildEntry = base
    try {
      // A SUBSTRATE DEFAULT DOES NOT TRAVEL. The fallback synthesis was
      // removed for exactly this reason — only intentionally-placed
      // images should be on the wire — but a default can reach canonical
      // by another door: the re-dress restamps the canonical slot when it
      // moves a default, and canonical is what publishes. So the filler
      // is stripped HERE, where props become a visual. The receiver's own
      // substrate dresses a pictureless tile with their own set, which is
      // what a default is for: a fallback, per participant.
      const props = withoutSubstrateImage(await readTilePropertiesAt(segments, name))
      if (props && Object.keys(props).length > 0) {
        // Canonicalize the merged shape so the whole visual entry
        // is deterministic, not just the props portion.
        visual = canonicaliseValue({ ...base, ...props }) as ChildEntry
      }
    } catch { /* no props yet — name-only publish */ }
    // The lineage name is the stable identity/pool key. The participant's
    // editable label is a property of THEIR complete variant and therefore
    // travels separately. Keep every locale so a receiver does not have to
    // display the publisher's English title while reading in Japanese.
    const titles = titlesForSegments([...segments, name])
    if (Object.keys(titles).length > 0) {
      visual = canonicaliseValue({ ...visual, titles }) as ChildEntry
    }
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
  }

  /** Where THIS page's offered tiles go (host-sync, synchronous — caches
   *  only), or null from an older host-sync that has no per-page answer. */
  #pageHosts = (segments: readonly string[]): SwarmHostChoiceLike | null => {
    try { return this.#getHostSync()?.swarmHostsFor?.(segments) ?? null } catch { return null }
  }

  /** The hosts a page's layer event names, in order — WHERE these tiles'
   *  bytes went: the page's swarm hosts (its publish domains, else the hosts
   *  pool, else a relay that hosts participants), then our own self-domain
   *  only while its backup target is actually on — advertising the page's
   *  origin named a host that never received the bytes (hypercomb.io answers
   *  every /<sig> with the app page). An older host-sync names the relay, as
   *  it did. A loopback host is never advertised from a non-loopback origin:
   *  nobody else can reach it. */
  #advertisedHosts = (segments: readonly string[], below: readonly string[] = []): string[] => {
    const choice = this.#pageHosts(segments)
    const hosts: string[] = choice ? [...choice.hosts] : [this.#swarmHost()].filter(Boolean)
    for (const h of below) if (h && !hosts.includes(h)) hosts.push(h)
    for (const h of this.#advertisedSelf()) if (!hosts.includes(h)) hosts.push(h)
    let originLoopback = false
    try { originLoopback = isLoopbackHost(window.location.host) } catch { /* no location — treat as public */ }
    return hosts.filter(h => originLoopback || !isLoopbackHost(h))
  }

  /** Our own self-domain, while its backup target is actually on — the one
   *  host our events name besides the swarm's. */
  #advertisedSelf = (): string[] => {
    let selfOn = false
    try { selfOn = this.#getHostSync()?.isEnabled?.() === true } catch { /* off */ }
    const self = selfOn ? this.#readSelfDomain() : ''
    if (!self) return []
    let originLoopback = false
    try { originLoopback = isLoopbackHost(window.location.host) } catch { /* no location — treat as public */ }
    return originLoopback || !isLoopbackHost(self) ? [self] : []
  }

  /** ['domain', …] tags for a page's layer event — the receiver's fetch
   *  candidates and the adopt's capture-source folder (#advertisedHosts):
   *  the page's own hosts first, then `below` (where the offered branches'
   *  subtrees went). */
  #domainTags = (segments: readonly string[], below: readonly string[] = []): string[][] =>
    this.#advertisedHosts(segments, below).map(h => ['domain', h])

  /** WHICH host a page's status line speaks for, why that one, and what it
   *  last said. Of the page's hosts, the first that is taking bytes — a
   *  second publish domain that refuses says nothing while the first serves
   *  the room — else the primary's refusal. A page with no host at all, once
   *  its hosts have been read, is 'no-host'. */
  #hostReport = (segments: readonly string[]): { host: string; hosts: string[]; hostSource: string; hostState: string; reason: string; why?: string; passedOver?: string[] } => {
    const choice = this.#pageHosts(segments)
    const hosts = choice ? [...choice.hosts] : [this.#swarmHost()].filter(Boolean)
    const hostSource = choice ? choice.source : (hosts.length ? 'relay' : 'none')
    // Pool hosts passed over this session (refused, full, silent): the line
    // can say why the bytes went elsewhere.
    const passedOver = choice?.passedOver?.length ? { passedOver: [...choice.passedOver] } : {}
    if (hosts.length === 0) {
      return { host: '', hosts, hostSource, hostState: choice && !choice.pending ? 'no-host' : '', reason: '', ...passedOver }
    }
    const states = hosts.map(host => ({ host, ...(this.#hostStates.get(host) ?? { state: '', reason: '', why: '' }) }))
    const shown = states.find(x => !HOST_HELD_STATES.has(x.state)) ?? states[0]!
    return { host: shown.host, hosts, hostSource, hostState: shown.state, reason: shown.reason, ...(shown.why ? { why: shown.why } : {}), ...passedOver }
  }

  /** WHICH BRANCH A HOST HOLDS, BY NAME (jwize 2026-10-10). A publish domain
   *  that can never take a write — a name that does not resolve (the
   *  `hyperccomb.com` typo), a host answering a web page, one that refuses or
   *  is full — is never passed over: it was the participant's choice. So it
   *  is NAMED, with the branch that waits on it and why, rather than that
   *  branch reading as "uploading" for ever: this page itself when it wears
   *  the host as its publish domain and none of its hosts takes bytes, and
   *  each tile here still on its way whose subtree's pages go to a held host
   *  this page's own tiles do not. From host-sync's last word per host
   *  (`sync:state`) — synchronous, no network. `heldChildren`: the tiles
   *  here that wait on such a host, which are not counted as uploading. */
  #blockedBranches = (
    segments: readonly string[],
    hostSync: HostSyncLike | undefined,
    refs: readonly ChildRef[],
    forms: readonly EntryForm[],
  ): { blocked: { branch: string; host: string; state: string; why: string }[]; heldChildren: Set<string> } => {
    const blocked: { branch: string; host: string; state: string; why: string }[] = []
    const heldChildren = new Set<string>()
    const heldOf = (host: string): { state: string; why: string } | null => {
      const s = this.#hostStates.get(host)
      return s && BRANCH_HELD_STATES.has(s.state) ? s : null
    }
    const name = (branch: string, host: string, s: { state: string; why: string }): void => {
      if (blocked.some(b => b.branch === branch && b.host === host)) return
      blocked.push({ branch, host, state: s.state, why: s.why || s.state })
    }
    const choice = this.#pageHosts(segments)
    const pageHosts = choice ? [...choice.hosts] : []
    if (choice?.source === 'publish' && segments.length > 0 && pageHosts.length > 0) {
      const held = pageHosts.map(heldOf)
      if (held.every(Boolean)) name(this.#branchWearing(segments, choice), pageHosts[0]!, held[0]!)
    }
    if (this.#perPage(hostSync) && typeof hostSync?.closureHostsOf === 'function') {
      refs.forEach((c, i) => {
        if (forms[i] === 'full' || !c.layerSig) return
        let below: string[] = []
        try { below = hostSync.closureHostsOf!(c.layerSig) } catch { below = [] }
        for (const host of below) {
          if (pageHosts.includes(host)) continue
          const s = heldOf(host)
          if (!s) continue
          heldChildren.add(c.name)
          name(c.name, host, s)
        }
      })
    }
    return { blocked: blocked.slice(0, BLOCKED_SHOWN_MAX), heldChildren }
  }

  /** The branch whose publish domains this page wears: up from the page for
   *  as long as the page above answers the same publish domains. */
  #branchWearing = (segments: readonly string[], choice: SwarmHostChoiceLike): string => {
    const same = (c: SwarmHostChoiceLike | null): boolean =>
      !!c && c.source === 'publish' && c.hosts.length === choice.hosts.length && c.hosts.every((h, i) => h === choice.hosts[i])
    let n = segments.length
    while (n > 1 && same(this.#pageHosts(segments.slice(0, n - 1)))) n--
    return segments[n - 1]!
  }

  // Resolve the children to publish at `segments`: the current layer's
  // children list (layer-as-primitive), each child sig resolved to its
  // name AND its layerSig (the merkle handle peers pull deeper with).
  // Fallback: a brand-new location with no committed layer yet reads OPFS
  // dirs so the first publish works before the history cascade lands; an
  // OPFS-fallback child has no sig, so its layerSig is omitted. Shared by
  // the publish walk (#publishSubtree) and the retraction walk
  // (#wipeSubtree) so both honour the exact same source of truth.
  //
  // null = UNKNOWN: history could not say (a cold read — a reload's first
  // walk before the store root is up, or a head whose bytes are still
  // landing — or the resolve threw). Never read that as "no children": an
  // empty answer goes out as {visuals: []}, the relay replaces our slot with
  // it, and every peer on the page drops our tiles until a later walk.
  //
  // `sealIf(name)` decides which children get a handle at all — the caller's
  // public filter, which needs only the name and the location. A child it
  // turns down comes back as its name alone and is NEVER SEALED: the seal
  // recurses through the whole subtree (fetching what is missing, and its
  // memo falls with any head that moves anywhere), and sealing every private
  // branch of a big hive on every walk is what kept a page silent. A sealed
  // handle is waited on at most SEAL_WAIT_MS (#sealedHandle).
  #resolveChildRefs = async (
    dir: FileSystemDirectoryHandle | null,
    segments: readonly string[],
    sealIf: (name: string) => boolean,
    stat?: WalkStat,
  ): Promise<ChildRef[] | null> => {
    const lineage = this.#getLineage()
    const history = this.#getHistory()
    if (history?.sign && typeof history?.currentLayerAt === 'function' && history?.getLayerBySig) {
      try {
        const locationSig = await history.sign({
          domain: lineage?.domain,
          explorerSegments: () => segments,
        } as LineageLike)
        const layer = await this.#knownLayerAt(history, locationSig)
        if (layer === undefined) {
          slog('[swarm] resolveChildRefs: history cold → unknown, nothing said', { segments, locationSig: locationSig?.slice(0, 8) })
          return null
        }
        const childSigs = Array.isArray(layer?.children) ? layer.children : []
        slog('[swarm] resolveChildRefs: layer resolve', { segments, locationSig: locationSig?.slice(0, 8), layerExists: layer !== null, childSigCount: childSigs.length })
        if (childSigs.length === 0 && layer == null) {
          // AUTHORITATIVE absence — no layer yet, first publish at this
          // location. Fall back to OPFS so the initial commit's tiles
          // propagate before history cascade lands. When the lineage has no
          // OPFS dir either (sub-layer never minted a physical directory)
          // there's literally nothing to publish at this level — empty list.
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
            const nm = typeof child?.name === 'string' && child.name.length > 0 ? child.name : null
            if (!nm) return null
            // Private here: the name alone — never sealed, never walked.
            if (!sealIf(nm)) return { name: nm }
            // Publish the SEALED (merkle-consolidated) handle, not the raw
            // parent.children sig. Under leaf-only commit `cs` is frozen at THIS
            // parent's last commit and omits any descendant added since (a page
            // added under a site re-commits the site's own head, never this
            // parent), so a peer pulling `cs` gets the tile but none of its
            // pages. sealSubtree re-runs the merkle cascade from live location
            // heads so the handle names the WHOLE current subtree. Falls back to
            // the raw sig if the seal can't fully resolve right now (a cold child).
            const handle = await this.#sealedHandle(history, [...segments, nm], cs, stat)
            return handle ? { name: nm, layerSig: handle } : { name: nm }
          } catch { return null }
        }))
        const refs = resolved.filter((n): n is ChildRef => n !== null)
        const droppedCount = resolved.length - refs.length
        if (droppedCount > 0) {
          slog('[swarm] resolveChildRefs: dropped unresolved child sigs', { droppedCount, totalChildSigs: childSigs.length, resolvedNames: refs.map(c => c.name) })
        }
        return refs
      } catch (err) {
        // A throw is not knowledge — unknown, like a cold read. (The OPFS
        // fallback it used to take yields [] when the page has no dir, which
        // is every page in the sig-named root, and announced an empty page.)
        // The relay keeps our last slot; the next walk asks again.
        slog('[swarm] resolveChildRefs: history resolve threw → unknown', { err: String(err) })
        return null
      }
    }
    slog('[swarm] resolveChildRefs: no history service → OPFS fallback', { dirName: dir?.name ?? '(none)' })
    const names = dir ? await listLocalChildren(dir) : []
    return names.map(name => ({ name }))
  }

  /** Whether history has answered a read authoritatively in this session —
   *  from then on its store root is up, and a cold read means a head whose
   *  bytes are still landing, not a boot to wait out. */
  #historyWarm = false

  /** The layer at `locationSig` as history KNOWS it: the layer, null for an
   *  authoritative absence, or undefined when history cannot say (cold).
   *  Before history has answered once (a reload's first walk races the store
   *  root coming up) a cold read is retried every COLD_LAYER_RETRY_MS for up
   *  to COLD_LAYER_WAIT_MS — the relay keeps serving our previous slot all
   *  the while, so peers see no change. Once warm, a cold read is unknown at
   *  once: waiting there would hold the walk (and every walk queued behind
   *  it) on one page whose bytes may take far longer to land. */
  #knownLayerAt = async (
    history: HistoryServiceLike,
    locationSig: string,
  ): Promise<{ children?: readonly string[]; name?: string } | null | undefined> => {
    const deadline = Date.now() + COLD_LAYER_WAIT_MS
    for (;;) {
      const stats: { cold?: boolean } = {}
      const layer = await history.currentLayerAt(locationSig, stats)
      if (layer != null || !stats.cold) { this.#historyWarm = true; return layer }
      if (this.#historyWarm || Date.now() >= deadline) return undefined
      await new Promise(r => setTimeout(r, COLD_LAYER_RETRY_MS))
    }
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

    // Canonical key via lineageKey() — must match #publishSubtree byte-for-byte.
    const key = `${lineageKey(segments)}\0${room}\0${secret}`
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
    tags.push(...this.#domainTags(segments))
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
    // Unknown (history cold) recurses into nothing: a deeper slot we can't
    // name now is retracted by a later walk, or lapses at its expiry.
    // Names only — a retraction needs no handle, so nothing is sealed.
    const childRefs = await this.#resolveChildRefs(dir, segments, () => false)
    const wipeWork: Promise<void>[] = []
    for (const { name } of childRefs ?? []) {
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
      this.#openResourceSub(sig, mesh)
    }
  }

  // The only door onto #resourceSubs. A sub closes itself when the bytes
  // land — but bytes for a peer who has since left NEVER land, and those
  // subs used to pile up for the life of the session until the relay's
  // per-connection cap refused every new REQ (the next location walked
  // into went deaf). Bounded here: past the cap the OLDEST waiting sub is
  // closed; the sig is still wanted, so the next layer pass re-opens it
  // and the relay replays any response that arrived meanwhile.
  #openResourceSub = (sig: string, mesh: { subscribe: (sig: string, cb: (evt: MeshEvtLike) => void) => MeshSubLike }): void => {
    while (this.#resourceSubs.size >= RESOURCE_SUBS_MAX) {
      const oldest = this.#resourceSubs.keys().next().value
      if (oldest === undefined) break
      const stale = this.#resourceSubs.get(oldest)
      this.#resourceSubs.delete(oldest)
      try { stale?.close() } catch { /* ignore */ }
    }
    const sub = mesh.subscribe(sig, (evt) => void this.#onResourceEvent(evt))
    this.#resourceSubs.set(sig, sub)
  }

  // Resource arrival path. HASH FIRST, WRITE ON MATCH. The bytes used to be
  // handed to Store.putResource and the verdict read off the sig it
  // returned — so a peer's mismatching payload was already ON DISK under its
  // real hash before we "discarded" it, and, worse, putResource's
  // content:wrote had already enqueued a stranger's bytes for THIS
  // participant's public host (write-conformance, swarm.drone.ts:3225). Now
  // nothing is written until the bytes prove they are the sig the d-tag
  // names, and a verified write is marked emit:false: it is a peer's atom
  // arriving, never this participant authoring.
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

    let actual = ''
    try { actual = (await SignatureService.sign(bytes)).toLowerCase() } catch { return }
    if (actual !== sig) {
      // A peer published bytes that are not the sig they claimed. Nothing
      // was written; the one-shot subscription stays open because the sig
      // we asked for has not arrived. A correct publisher will re-send.
      console.warn('[swarm] resource sig mismatch — discarded unwritten', { claimed: sig.slice(0, 12), actual: actual.slice(0, 12) })
      return
    }
    try { await store.putResource(new Blob([bytes]), { emit: false }) } catch { return }

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
          this.#openResourceSub(sub, mesh)
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
    if (!isJoinedHere()) return
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
    // PRIVACY: never announce a leaf name that is neither public nor
    // swarm-taught — same rule as full-path presence above.
    if (this.#broadcastablePrefix(segs).length < segs.length) return
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

  // ─────────────────────────────────────────────────────────────────
  // Visit-driven acquisition + drill tunneling
  // ─────────────────────────────────────────────────────────────────

  /** The longest prefix of `segments` that is safe to broadcast. A
   *  segment is safe when it is a locally-held PUBLIC tile (the walk's
   *  own filter), or when the swarm itself taught us the name (a
   *  witnessed peer offering — broadcasting it back discloses nothing).
   *  Locally-held PRIVATE names stop the prefix: presence and drill
   *  requests must never stream a private branch's names to the zone,
   *  even though the layer walk correctly prunes the tiles themselves. */
  #broadcastablePrefix = (segments: readonly string[]): string[] => {
    const out: string[] = []
    for (let i = 0; i < segments.length; i++) {
      const leaf = segments[i]
      const location = '/' + segments.slice(0, i).join('/')
      const foreign = this.#foreignPathKeys.has(lineageKey(segments.slice(0, i + 1)))
      if (!foreign && !isCellPublic(location, leaf)) break
      out.push(leaf)
    }
    return out
  }

  /** Remember that `segments` names a path whose leaf a PEER offered —
   *  see #foreignPathKeys. Bounded FIFO. */
  #noteForeignPath = (segments: readonly string[]): void => {
    if (segments.length === 0) return
    const key = lineageKey(segments)
    if (this.#foreignPathKeys.has(key)) return
    if (this.#foreignPathKeys.size >= 4096) {
      const first = this.#foreignPathKeys.values().next().value
      if (first !== undefined) this.#foreignPathKeys.delete(first)
    }
    this.#foreignPathKeys.add(key)
  }

  /** Visit signal — fires once per real location change. When the tile
   *  just entered is a live PEER offering at the parent location, emit
   *  `swarm:tile-visited` with the witnessed entry (sanitized wire
   *  visual + publisher pubkey + sealed layerSig). SwarmAdoptDrone owns
   *  what happens next (the one-level fold + genome record); this drone
   *  only witnesses and signals. */
  // Last visit-signal decision — exposed via debug() so a dead drill names
  // its failing stage from the console instead of reading as "broken".
  #lastVisitSignal: Record<string, unknown> | null = null

  #announceVisit = async (segments: readonly string[]): Promise<void> => {
    if (segments.length === 0) { this.#lastVisitSignal = { stage: 'root', atMs: Date.now() }; return }
    const leaf = segments[segments.length - 1]
    const parentSegments = segments.slice(0, -1)
    let parentSig = ''
    try { parentSig = await this.composeSigForSegments(parentSegments) } catch { /* fall through */ }
    if (!parentSig) {
      this.#lastVisitSignal = { stage: 'no-parent-sig', at: [...segments], atMs: Date.now() }
      return
    }
    const bag = this.peerTilesAtSig(parentSig)
    const offer = bag.find(t => t.name === leaf)
    if (!offer) {
      this.#lastVisitSignal = {
        stage: 'not-offered', at: [...segments], parentSig: parentSig.slice(0, 12),
        offered: bag.map(t => t.name), atMs: Date.now(),
      }
      return
    }
    // The swarm taught us this name (and every ancestor was recorded at
    // ITS entry moment) — safe for presence/drill broadcasts from now on.
    this.#noteForeignPath(segments)
    this.#lastVisitSignal = {
      stage: 'emitted', at: [...segments], peer: String(offer.peerPubkey ?? '').slice(0, 8), atMs: Date.now(),
    }
    this.emitEffect('swarm:tile-visited', {
      segments: [...segments],
      parentSegments: [...parentSegments],
      name: leaf,
      entry: offer,
    })
  }

  /** Drill request (kind 30203 on the zone-wide lifecycle sig, d-tag
   *  `drill:<pubkey>` — its own replaceable slot, never colliding with
   *  the alive beacon). Interest events at a deep location's sig are
   *  heard by NOBODY when the publisher is elsewhere — they subscribe
   *  only at their own location. The lifecycle channel is the one sig
   *  every zone member listens on, so the drill request always lands;
   *  any member who publicly holds the path answers by publishing that
   *  location's layer event (see #onDrillRequest). Refreshes past 2/3
   *  TTL so an idle visitor keeps the frontier alive under them. */
  /** Last drill decision on each side — debug()-visible so a stalled
   *  tunnel names its leg from the console. */
  #lastDrillRequest: Record<string, unknown> | null = null
  #lastDrillServed: Record<string, unknown> | null = null

  #publishDrillRequest = async (segments: readonly string[]): Promise<void> => {
    const mesh = this.#getMesh()
    if (!mesh?.publish) return
    const myPubkey = this.#myPubkey
    if (!myPubkey) return
    // ROOT IS A PAGE TOO. Publishing is page-only (MAX_PUBLISH_DEPTH), so a
    // publisher who has walked into a tile stops refreshing their ROOT slot
    // and the relay forgets it at EVENT_TTL_SECS. A member arriving at root
    // after that has nothing to replay — and with root excluded here, no
    // way to ask. Whether you saw a publisher's root then depended on who
    // got there first. An empty path IS the root drill: it names nothing,
    // so there is no privacy prefix to compute, and every holder answers
    // with their public root subset exactly like any other page.
    const share = segments.length === 0 ? [] : this.#broadcastablePrefix(segments)
    if (segments.length > 0 && share.length === 0) {
      this.#lastDrillRequest = { stage: 'no-sharable-prefix', at: [...segments], atMs: Date.now() }
      return
    }
    const sig = this.#lifecycleSig || await this.#computeLifecycleSig()
    if (!sig) { this.#lastDrillRequest = { stage: 'no-lifecycle-sig', atMs: Date.now() }; return }

    // Fast clock while this page is still empty (the publisher's first
    // answer may have been blank mid-drain); TTL cadence once filled.
    const pageEmpty = this.peerTilesAtSig(this.#currentSig).length === 0
    const minGapMs = pageEmpty ? 5_000 : Math.floor(EVENT_TTL_SECS * 1000 * 2 / 3)
    const pathKey = lineageKey(share)
    const nowMs = Date.now()
    if (nowMs - (this.#myDrillSentMs.get(pathKey) ?? 0) < minGapMs) return
    this.#myDrillSentMs.set(pathKey, nowMs)

    const expirationSecs = Math.floor(nowMs / 1000) + EVENT_TTL_SECS
    try {
      await mesh.publish(SWARM_INTEREST_KIND, sig, { pathSegments: share }, [
        ['d', `drill:${myPubkey}`],
        ['expiration', String(expirationSecs)],
      ])
      this.#lastDrillRequest = { stage: 'sent', share: [...share], pageEmpty, atMs: nowMs }
    } catch (err) {
      this.#myDrillSentMs.delete(pathKey)  // allow retry next sync
      this.#lastDrillRequest = { stage: 'publish-threw', err: String(err).slice(0, 80), atMs: nowMs }
    }
  }

  /** Publisher side of the drill tunnel: a zone member asked for the
   *  frontier at a path. If WE publicly hold that path, publish its
   *  layer event so the driller's live subscription at that sig fills.
   *  One level per request — the driller re-requests as they descend,
   *  so the frontier follows them level by level. Throttled per path
   *  to the layer-refresh cadence; a crowd drilling one branch costs
   *  one walk. Never answers for private paths (every segment must be
   *  public on OUR side) and never invents an empty location (a path
   *  we don't hold is silently ignored — absence of an answer, never
   *  a false empty slot). */
  #onDrillRequest = async (evt: MeshEvtLike): Promise<void> => {
    const from = String(evt.event?.pubkey ?? '').trim().toLowerCase()
    if (!from || (this.#myPubkey && from === this.#myPubkey)) return
    const payload = evt.payload as { pathSegments?: unknown } | undefined
    const rawSegs = payload?.pathSegments
    if (!Array.isArray(rawSegs)) return
    const segments: string[] = rawSegs
      .map(s => (typeof s === 'string' ? s.trim() : ''))
      .filter(s => s.length > 0 && s.length <= 256)
      .slice(0, 16)
    // An explicit EMPTY list is the root drill (see #publishDrillRequest);
    // a list that filtered down to nothing was malformed — never answer it.
    if (segments.length === 0 && rawSegs.length > 0) return

    // Only answer for paths that are public from OUR side, at every level.
    for (let i = 0; i < segments.length; i++) {
      if (!isCellPublic('/' + segments.slice(0, i).join('/'), segments[i])) {
        this.#lastDrillServed = { stage: 'not-public-here', at: [...segments], level: i, atMs: Date.now() }
        return
      }
    }

    // SHORT cooldown — one page event per answer; the cooldown coalesces
    // a crowd, it must never starve a visitor whose first answer was
    // blank (fresh children mid-drain past the availability gate).
    const pathKey = lineageKey(segments)
    const nowMs = Date.now()
    const lastMs = this.#drillServedMs.get(pathKey) ?? 0
    if (nowMs - lastMs < 5_000) return
    this.#drillServedMs.set(pathKey, nowMs)
    if (this.#drillServedMs.size > 512) {
      const oldest = this.#drillServedMs.keys().next().value
      if (oldest !== undefined) this.#drillServedMs.delete(oldest)
    }

    const sigStore = this.#getSignatureStore()
    const mesh = this.#getMesh()
    const history = this.#getHistory()
    if (!sigStore || !mesh?.publish || !history) return
    const room = this.#getRoomStore()?.value?.trim() ?? ''
    const secret = this.#getSecretStore()?.value?.trim() ?? ''
    if (!room || !secret) return
    // A private participant answers nobody — the lifecycle subscription is
    // closed on leave, but a request already in flight must not be served.
    if (!isJoinedHere()) return

    // Hold the path? Resolve OUR layer there — a location we don't hold
    // is not ours to answer for (and must never be announced as empty).
    // A drill that lands in a reload's cold window waits for history to
    // warm (#knownLayerAt) and is answered, rather than read as "not held".
    // Still cold = unknown: no answer, and no cooldown held against a retry.
    try {
      const locSig = await history.sign({ explorerSegments: () => [...segments] })
      const layer = await this.#knownLayerAt(history, locSig)
      if (layer === undefined) {
        this.#drillServedMs.delete(pathKey)
        this.#lastDrillServed = { stage: 'history-cold', at: [...segments], atMs: nowMs }
        return
      }
      if (!layer) { this.#lastDrillServed = { stage: 'not-held-here', at: [...segments], atMs: nowMs }; return }
    } catch { this.#lastDrillServed = { stage: 'resolve-threw', at: [...segments], atMs: nowMs }; return }

    // Publish that location's slot (one node — dir=null stops recursion,
    // which is exactly one frontier level per drill step). The walk stamps
    // its own dedupe memo, so a re-serve of unchanged content is one
    // no-op sign, not a re-publish. The page's own single flight: a walk of
    // it already running owes one more, never a second alongside.
    try {
      await this.#walkPage(segments)
      this.#lastDrillServed = { stage: 'served', at: [...segments], from: from.slice(0, 8), atMs: nowMs }
    } catch (err) {
      this.#lastDrillServed = { stage: 'walk-threw', err: String(err).slice(0, 80), atMs: nowMs }
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
    // Tell the shell too. The presence strip mirrors its own label from a
    // one-time read at mount, and the mesh selector saves through THIS
    // method — without a self-tagged emit a name typed in the selector
    // never reached the badge, which kept offering "+" until a reload.
    this.emitEffect('swarm:label-changed', { pubkey: this.#myPubkey ?? '', label: clean, self: true })
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
   *  key the broker stamps onto its 30401 responses). Rides swarm layer
   *  publishes as a ['domain', …] tag, after the swarm host and only while
   *  the self-domain backup target is on (#domainTags), so receivers can
   *  attribute our tiles' layerSigs to a host that actually holds them. */
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
   *  visuals payload as the location publish — only the sig differs.
   *
   *  One publish at a time: a call for the page already being published owes
   *  it one more run when it ends; a call for ANOTHER page takes over at once
   *  (the channel says where we stand now), and the walk it replaced never
   *  publishes. A run older than WALK_STALL_MS is taken as stuck.
   *
   *  `onlyIfChanged` (the receipt re-walk, and every re-run): say nothing
   *  when the channel would say exactly what it last said — the sync's own
   *  calls always publish, they keep the slot alive. */
  #channelFlight: { segments: readonly string[]; again: boolean; sinceMs: number } | null = null
  // The channel's last word still carries names or earlier versions: a
  // receipt re-walk refreshes it too (it no longer waits on the host).
  #channelPending = false
  #lastChannelJson = ''

  #publishCurrentVisualsToMyChannel = async (segments: readonly string[], onlyIfChanged = false): Promise<void> => {
    if (!isJoinedHere()) return
    const held = this.#channelFlight
    if (held && lineageKey(held.segments) === lineageKey(segments) && Date.now() - held.sinceMs < WALK_STALL_MS) {
      held.again = true
      return
    }
    const flight = { segments: [...segments], again: false, sinceMs: Date.now() }
    this.#channelFlight = flight
    const live = (): boolean => this.#channelFlight === flight && isJoinedHere()
    let changedOnly = onlyIfChanged
    try {
      do {
        flight.again = false
        flight.sinceMs = Date.now()
        try { await this.#publishChannelOnce(flight.segments, live, changedOnly) } catch { /* the next sync */ }
        changedOnly = true
      } while (flight.again && this.#channelFlight === flight)
    } finally {
      if (this.#channelFlight === flight) this.#channelFlight = null
    }
  }

  #publishChannelOnce = async (segments: readonly string[], live: () => boolean, onlyIfChanged: boolean): Promise<void> => {
    if (!isJoinedHere()) return
    const mesh = this.#getMesh()
    if (!mesh?.publish) return
    const myPubkey = this.#myPubkey
    if (!myPubkey) return
    const channelSig = await this.#computeChannelSig(myPubkey)
    if (!channelSig) return

    // Resolve current children — the same source of truth, and the same
    // resolve, as the page walk (#resolveChildRefs: the lineage's layer at
    // this location). Empty children publishes an empty visuals array;
    // followers see we have nothing here, which is correct — but only when
    // history KNOWS it: a cold read or a throw is unknown (null), and
    // followers are never told "nothing" for a page we could not read.
    // Each public child carries {name, layerSig}: the layerSig is the merkle
    // handle subscribers pull deeper with. PUBLIC FILTER FIRST — the personal
    // channel carries only the public subset, or private tiles leak through
    // this second path — and only a public child is sealed.
    const publicLocation = '/' + segments.join('/')
    const isPublicHere = (name: string): boolean => isCellPublic(publicLocation, name)
    const resolved = await this.#resolveChildRefs(null, segments, isPublicHere)
    if (resolved === null) return /* unknown — never an empty page for followers */
    const childEntries = resolved.filter(c => isPublicHere(c.name))
    // Same CDN doctrine-gate feed as #publishSubtree — this is the second
    // enumeration of the public subset, and both must mark: a closure a
    // follower sees only via the personal channel would otherwise never
    // acquire its `.public` markers. Branch roots vouch for their closure;
    // tile-only public marks the layer + resources alone (closure=false).
    // Fire-and-forget — never awaited, never throws into the publish.
    const hostSync = this.#getHostSync()
    if (hostSync) {
      for (const c of childEntries) {
        if (!c.layerSig) continue
        try {
          void hostSync.markPublic(c.layerSig, 'layer', isBranchPublic(publicLocation, c.name), segments)
            .catch(() => undefined)
        } catch { /* never disturb the publish */ }
      }
    }
    // The SAME announce rule as #publishSubtree (#entryFor): a follower
    // adopting a sealed handle no host serves would 404 identically, and a
    // follower must not see a tile blink out on every edit either. The
    // last-hosted memory (and our own replayed word) is keyed by the PAGE's
    // composed sig, so both surfaces re-announce the same previous version.
    const pageSig = await this.composeSigForSegments(segments)
    if (!pageSig) return
    const replayReady = this.#replayReady(pageSig)
    const announced = await Promise.all(
      childEntries.map(c => this.#entryFor(c, segments, pageSig, hostSync, replayReady)),
    )
    const children: ChildEntry[] = announced.map(a => a.entry)

    // We stood somewhere else by now, or left: this page is not the
    // channel's word any more.
    if (!live()) return
    this.#channelPending = announced.some(a => a.form !== 'full')
    const myLabel = this.#readMyLabel()
    const payload: SwarmLayerPayload = myLabel
      ? { label: myLabel, visuals: children }
      : { visuals: children }
    const said = JSON.stringify([channelSig, payload])
    if (onlyIfChanged && said === this.#lastChannelJson) return
    this.#lastChannelJson = said
    const expirationSecs = Math.floor(Date.now() / 1000) + EVENT_TTL_SECS
    try {
      const tags: string[][] = [
        ['d', channelSig],
        ['expiration', String(expirationSecs)],
      ]
      // Same domain attribution as #publishSubtree — followers adopting from
      // our personal channel get the capture-source host too.
      tags.push(...this.#domainTags(segments, this.#closureHosts(hostSync, childEntries)))
      // Nothing reached a relay: never remembered as said.
      if (await mesh.publish(SWARM_LAYER_KIND, channelSig, payload, tags) === false) this.#lastChannelJson = ''
    } catch (err) {
      this.#lastChannelJson = ''
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

  // `requestSubtree` — the recursive merkle pull that committed a peer's
  // ENTIRE subtree (as husks) under the caller's location — is DELETED
  // (Jaime's ruling, 2026-08-20: "you never give away the structure unless
  // the participant navigates", and the audit had already flagged it as an
  // ungated fold entry point: no code consent, no receipts, no committer
  // cascade). Structure now travels one PAGE at a time: the publisher
  // broadcasts only the current page, drill requests reveal each deeper
  // page as a visitor walks in, and the visit fold acquires per-tile.

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
    const segsRaw = (Array.isArray(segments) ? segments : [])
      .map(s => String(s ?? '').trim()).filter(s => s.length > 0)
    // PRIVACY: broadcast only the public/foreign prefix of the path. The
    // layer walk prunes private TILES, but presence used to stream the
    // NAMES of every segment — navigating your own private branch while
    // public leaked its folder names to the whole zone. Followers land on
    // the nearest broadcastable ancestor instead (they could never enter
    // the private tile anyway).
    const segs = this.#broadcastablePrefix(segsRaw)
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

  // ─────────────────────────────────────────────────────────────────
  // Swarm lifecycle channel — shared per-zone presence roster
  // ─────────────────────────────────────────────────────────────────
  //
  // One sig per (room, secret) that EVERY participant subscribes to, so a
  // single broadcast reaches the whole swarm regardless of location. See
  // SWARM_LIFECYCLE_KIND for the wire shape. This is what makes removal
  // event-driven + identity-scoped instead of navigation-coupled.

  #computeLifecycleSig = async (): Promise<string> => {
    const sigStore = this.#getSignatureStore()
    if (!sigStore?.signText) return ''
    const room = this.#getRoomStore()?.value?.trim() ?? ''
    const secret = this.#getSecretStore()?.value?.trim() ?? ''
    if (!room || !secret) return ''
    try { return await sigStore.signText(`lifecycle\0${room}\0${secret}`) }
    catch { return '' }
  }

  // Subscribe to the current zone's lifecycle channel (once) and beacon
  // our presence. Idempotent — safe on every sync + heartbeat. Re-points
  // the subscription if the zone sig changed.
  #ensureLifecycle = async (): Promise<void> => {
    const mesh = this.#getMesh()
    if (!mesh?.subscribe) return
    const sig = await this.#computeLifecycleSig()
    if (!sig) return
    if (sig !== this.#lifecycleSig) {
      if (this.#lifecycleSub) { try { this.#lifecycleSub.close() } catch { /* ignore */ } this.#lifecycleSub = null }
      this.#lifecycleSig = sig
      this.#lastBeaconMs = 0  // new zone — beacon immediately
      this.#lastWithheldJson = ''  // new zone — broadcast the withheld list afresh
    }
    if (!this.#lifecycleSub) {
      this.#lifecycleSub = mesh.subscribe(sig, (evt) => this.#onLifecycleEvent(evt))
    }
    // Awaited so a caller that needs "beacon first" (the reopen reassert)
    // can have it; every other caller fires and forgets.
    await this.#publishAlive()
    void this.#publishWithheld()
  }

  // Withheld-behaviors broadcast (kind 30208, same channel) — the behavior
  // axis of the share shortlist. Replaceable per (pubkey, kind, d=pubkey);
  // sent on zone entry and whenever the global roster changes, and only when
  // the list actually differs from what's already on the relay. An EMPTY
  // list is still published after a change — that's the retraction that
  // wakes a previously-withheld behavior for peers.
  #publishWithheld = async (force = false): Promise<void> => {
    const mesh = this.#getMesh()
    if (!mesh?.publish) return
    const myPubkey = this.#myPubkey
    if (!myPubkey) return
    const sig = this.#lifecycleSig || await this.#computeLifecycleSig()
    if (!sig) return
    const withheld = withheldForShare()
    const json = JSON.stringify(withheld)
    // Refresh like the alive beacon, not only on change: the slot expires
    // in EVENT_TTL_SECS on a NIP-40 relay, and a change-only send meant a
    // visitor joining >90s after the last roster change never learned the
    // publisher's withheld list — withheld behaviors then rendered as
    // ENABLED under adopted/visited roots. Time-based re-send keeps the
    // slot alive for late joiners; unchanged-and-fresh still no-ops.
    const nowMs = Date.now()
    const fresh = nowMs - this.#lastWithheldSentMs < LAYER_REFRESH_MS
    if (!force && json === this.#lastWithheldJson && fresh) return
    this.#lastWithheldJson = json
    this.#lastWithheldSentMs = nowMs
    try {
      await mesh.publish(SWARM_BEHAVIOR_KIND, sig, { withheld }, [
        ['d', myPubkey],
        ['expiration', String(Math.floor(nowMs / 1000) + EVENT_TTL_SECS)],
      ])
    } catch (err) { console.warn('[swarm] publishWithheld failed', err) }
  }

  /** The decoration kinds `pubkey` withholds from this swarm (their global
   *  roster's off list) — empty when they withhold nothing / haven't said. */
  public withheldByPeer(pubkey: string): readonly string[] {
    return this.#withheldByPubkey.get(String(pubkey ?? '').trim().toLowerCase()) ?? []
  }

  // Liveness beacon — replaceable per (pubkey, kind, d-tag=pubkey) with a
  // NIP-40 expiration so a crashed peer's presence lapses on its own.
  // `v` is this build's swarm generation (BEACON_VERSION). The beacon also
  // cancels a will the relay still holds for this slot from a socket of ours
  // that died — the relay takes that word only from a connection that
  // beaconed the slot, which is why a reopen beacons FIRST (#reassertOnReopen).
  #publishAlive = async (): Promise<void> => {
    const mesh = this.#getMesh()
    if (!mesh?.publish) return
    const myPubkey = this.#myPubkey
    if (!myPubkey) return
    const sig = this.#lifecycleSig || await this.#computeLifecycleSig()
    if (!sig) return
    // Throttle to the NIP-40 refresh cadence — no point re-beaconing on
    // every navigation when the slot is still comfortably alive.
    const nowMs = Date.now()
    if (nowMs - this.#lastBeaconMs < LAYER_REFRESH_MS) return
    this.#lastBeaconMs = nowMs
    const expirationSecs = Math.floor(nowMs / 1000) + EVENT_TTL_SECS
    try {
      await mesh.publish(SWARM_LIFECYCLE_KIND, sig, { alive: true, v: BEACON_VERSION }, [
        ['d', myPubkey],
        ['expiration', String(expirationSecs)],
      ])
    } catch (err) { console.warn('[swarm] publishAlive failed', err) }
  }

  // One-shot SIGNED tombstone on an explicit leave — replaces our beacon
  // slot with { left: true }; every receiver evicts all our tiles at once.
  // Sent on the leave gesture, a zone change and dispose — never on
  // pagehide (a reload is not a leave). `explicitSig` lets teardown
  // tombstone the OLD zone before its credentials change.
  #publishLeave = async (explicitSig?: string): Promise<void> => {
    const mesh = this.#getMesh()
    if (!mesh?.publish) return
    const myPubkey = this.#myPubkey
    if (!myPubkey) return
    const sig = explicitSig || this.#lifecycleSig || await this.#computeLifecycleSig()
    if (!sig) return
    try {
      await mesh.publish(SWARM_LIFECYCLE_KIND, sig, { left: true }, [
        ['d', myPubkey],
        ['expiration', String(Math.floor(Date.now() / 1000) + EVENT_TTL_SECS)],
      ])
    } catch (err) { console.warn('[swarm] publishLeave failed', err) }
  }

  #onLifecycleEvent = (evt: MeshEvtLike): void => {
    // Drill requests ride the same zone-wide channel as interest events
    // (kind 30203, d-tag `drill:<pubkey>`) — a member is asking whoever
    // holds a path to publish its frontier. Answer best-effort.
    if (Number(evt.event?.kind) === SWARM_INTEREST_KIND) {
      void this.#onDrillRequest(evt)
      return
    }
    // Withheld-behaviors broadcast rides the same channel — record the
    // peer's list (replaceable slot: latest wins) and tell the adopt path.
    if (Number(evt.event?.kind) === SWARM_BEHAVIOR_KIND) {
      const from = String(evt.event?.pubkey ?? '').trim().toLowerCase()
      if (!from || (this.#myPubkey && from === this.#myPubkey)) return
      const payload = evt.payload as { withheld?: unknown } | undefined
      const kinds = Array.isArray(payload?.withheld)
        ? payload!.withheld!.map(k => String(k ?? '').trim()).filter(Boolean)
        : []
      this.#withheldByPubkey.set(from, kinds)
      EffectBus.emit('swarm:withheld-changed', { pubkey: from, withheld: [...kinds] })
      return
    }
    if (Number(evt.event?.kind) !== SWARM_LIFECYCLE_KIND) return
    const pubkey = String(evt.event?.pubkey ?? '').trim().toLowerCase()
    if (!pubkey) return

    const payload = evt.payload
    const left = !!(payload && typeof payload === 'object' && (payload as { left?: unknown }).left === true)

    if (this.#myPubkey && pubkey === this.#myPubkey) {
      // A tombstone under OUR key that we are still here to read is not ours
      // to honour — see #reassertAfterStaleTombstone.
      if (left && evt.sig === this.#lifecycleSig) this.#reassertAfterStaleTombstone(Number(evt.event?.created_at ?? 0))
      return  // our own echo
    }

    const createdAtSec = Number(evt.event?.created_at ?? 0)
    if (left) {
      // UNSIGNED — the relay's last will for a socket that died (it cannot
      // sign as them): a phone lock, a wifi roam, a reload. That is not the
      // participant leaving. Mark them AWAY on the roster and keep every
      // tile they shared until its own slot expires, exactly as the relay
      // keeps it — a late joiner sees the same room. Their next event of any
      // kind brings them back.
      if (!String(evt.event?.sig ?? '')) {
        if (this.#markAway(pubkey, createdAtSec || this.#nowSec())) this.#scheduleRosterEmit()
        slog('[swarm] lifecycle will — away', { pubkey: pubkey.slice(0, 8) })
        return
      }
      // SIGNED — their own leave. Drop everything this participant
      // contributed, at every location, in one shot (evictPubkey walks all
      // sigs + repaints).
      this.#departedAtSec.set(pubkey, createdAtSec || this.#nowSec())
      this.#participantAliveMs.delete(pubkey)
      this.#awayPubkeys.delete(pubkey)
      this.#segmentsByPubkey.delete(pubkey)
      const res = this.evictPubkey(pubkey)
      this.#scheduleRosterEmit()
      slog('[swarm] lifecycle tombstone', { pubkey: pubkey.slice(0, 8), ...res })
      return
    }

    // Alive beacon — refresh identity-level liveness. Drop a beacon that's
    // already past its own expiration / TTL (on the relay's clock, with
    // EXPIRY_GRACE_SECS of slack) so a stale relay replay can't resurrect a
    // departed peer.
    const nowSec = this.#nowSec()
    const expTag = (evt.event?.tags ?? []).find(t => t[0] === 'expiration')?.[1]
    if (expTag) {
      const exp = Number(expTag)
      if (Number.isFinite(exp) && exp + EXPIRY_GRACE_SECS <= nowSec) return
    } else {
      if (createdAtSec > 0 && createdAtSec + EVENT_TTL_SECS + EXPIRY_GRACE_SECS < nowSec) return
    }
    const departedAt = this.#departedAtSec.get(pubkey)
    if (departedAt !== undefined) {
      if (createdAtSec > departedAt) this.#departedAtSec.delete(pubkey)
      else return  // a replayed beacon older than the tombstone — still gone
    }
    // The generation they run — a beacon without `v` predates v2.
    const v = Number((payload as { v?: unknown } | null)?.v)
    const version = Number.isFinite(v) && v > 0 ? v : 1
    if (this.#versionByPubkey.get(pubkey) !== version) {
      this.#versionByPubkey.set(pubkey, version)
      this.#scheduleRosterEmit()
    }
    this.#markAlive(pubkey, createdAtSec)
  }

  // A tombstone for OUR pubkey on the live zone channel means members have
  // just marked us away (the relay's will for a socket of ours that died)
  // or dropped us (a leave signed by this key elsewhere) while we're still
  // here. The usual source is a refresh or a blip: the old socket dies, and
  // the relay's will fires with created_at = now. Reassert at once, one
  // second past the tombstone so members see a strictly newer return.
  // NEWER OR OLDER, it reasserts: the old "older than our beacon" guard
  // assumed our beacon had reached the relay, and a beacon swallowed by a
  // dead socket then blocked recovery for minutes. A spurious reassert costs
  // one refresh; a missed one costs the room.
  // Private mode stays silent — #syncForCurrentLineage owns that gate.
  #reassertTimer: ReturnType<typeof setTimeout> | null = null
  #reassertAfterStaleTombstone = (tombstoneSec: number): void => {
    if (!this.#lastBeaconMs) return  // never beaconed this zone — nothing to reassert
    if (this.#reassertTimer) return
    const nowSec = this.#nowSec()
    const delayMs = (Math.max(tombstoneSec, nowSec) + 1 - nowSec) * 1000 + 50
    this.#reassertTimer = setTimeout(() => {
      this.#reassertTimer = null
      slog('[swarm] reasserting after stale tombstone under our pubkey', { tombstoneSec })
      this.#lastBeaconMs = 0
      this.#lastPublishedBySig.clear()
      this.#lastPublishTimeMsBySig.clear()
      void this.#syncForCurrentLineage()
      void this.#refreshVisitedPages()
    }, Math.max(0, delayMs))
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
      notePeerLiveness?: (pubkey: string, sigs: readonly string[]) => void
    } | undefined

  #getSigner = (): SignerApi | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(NOSTR_SIGNER_KEY) as SignerApi | undefined

  // Host sync — the `.public` marker writer (CDN doctrine gate) AND the
  // availability question (isClosureAvailable — receipts-backed "announce
  // a signature only once a host serves it"). Resolved at runtime via IoC
  // (no import). While this tab is joined its targets include the swarm
  // host, derived from the relay it meets at.
  #getHostSync = (): HostSyncLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.('@diamondcoreprocessor.com/HostSyncService') as HostSyncLike | undefined

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

// THE BEE WIRES (atomic-modules-plan.md): a dependency registers nothing;
// its owner bee registers it.
window.ioc.register('@diamondcoreprocessor.com/SwarmFilterService', swarmFilterService)

const _swarmDrone = new SwarmDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/SwarmDrone',
  _swarmDrone,
)
