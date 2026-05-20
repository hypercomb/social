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

import { Drone } from '@hypercomb/core'

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

const NOSTR_MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const TILE_SOURCE_REGISTRY_KEY = '@hypercomb.social/TileSourceRegistry'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
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
  // Two sig pointers per child, both content-addressed, both streamed
  // via the companion kind 30201 resource pipeline:
  //
  //   propsSig — sha256 of the child's `0000` file bytes. The
  //              canonical tile-properties blob (see memory: "0000
  //              canonical"). On adopt, written verbatim into the
  //              new local tile's `0000` so the adopted tile inherits
  //              the publisher's index/viewport/transient state.
  //
  //   imageSig — the value of `localStorage['hc:tile-props-index'][name]`
  //              on the publisher's side. This is the substrate-cache
  //              propsSig pointer — when the editor or substrate has
  //              applied an image to the tile, this blob contains the
  //              `small.image` / `flat.small.image` references. Streamed
  //              so the receiver can render the publisher's image
  //              without re-rolling substrate locally. On adopt, written
  //              into the local index entry so the renderer's tile-
  //              properties read finds the image references the
  //              publisher saw.
  //
  // The two often refer to the same blob; when they do the recursive
  // resource walk dedupes via `#publishedResources`. When they differ
  // (substrate has assigned an image but the canonical 0000 has not
  // been updated to record it), both are needed for the receiver to
  // recover the full visual.
  children: { name: string; index?: number; propsSig?: string; imageSig?: string }[]
}

interface MeshEvtLike {
  relay: string
  sig: string
  event: { kind?: number; pubkey?: string; tags?: string[][]; content?: string }
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
  // Note: we deliberately do NOT call lineage.explorerDir() here — its
  // result-cache stores `null` when Store isn't ready yet, and that
  // null is then served to every other caller (including show-cell)
  // until the next invalidate(). We walk Store.hypercombRoot ourselves
  // to avoid polluting that shared cache.
}

interface SignatureStoreLike {
  signText: (input: string) => Promise<string>
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
  protected override listens: string[] = ['mesh:ensure-started', 'mesh:public-changed', 'mesh:room', 'mesh:secret']
  protected override emits: string[] = ['swarm:peers-changed', 'swarm:resource-arrived', 'swarm:hide-changed']

  // Per-lineage subscription handle. We open one per visited sig and
  // never close (cheap — mesh dedupes by sig at the bucket layer).
  #subsBySig = new Map<string, MeshSubLike>()

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

  // Resource sigs we're currently subscribed to (waiting for bytes).
  // One sub per sig (mesh dedupes consumers, but the bookkeeping is
  // ours): keyed by sig, value is the mesh subscription handle so we
  // can close it once the bytes arrive and land in OPFS.
  #resourceSubs = new Map<string, MeshSubLike>()

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
    queueMicrotask(() => { void this.#resolveMyPubkey() })
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
  })

  /** All children any peer is currently publishing at #currentSig,
   *  excluding our own slot. Each entry carries:
   *    - peerPubkey  : for mine-vs-theirs render treatment
   *    - index?      : peer-published slot so the receiver places at
   *                    the same axial position the publisher rendered
   *                    at (vs. drifting to next-free)
   *    - propsSig?   : sha256 of the publisher's child `0000`. On
   *                    adopt, the bytes (already in our OPFS by the
   *                    time the user clicks adopt, thanks to the pull
   *                    pipeline) are copied verbatim into the new
   *                    local tile's `0000` — same image, same index,
   *                    same viewport state as the publisher saw. */
  public peerTilesAtCurrentSig = (): readonly { name: string; peerPubkey: string; index?: number; propsSig?: string; imageSig?: string }[] => {
    const peerLayers = this.#peerLayersBySig.get(this.#currentSig)
    if (!peerLayers || peerLayers.size === 0) return []
    const out: { name: string; peerPubkey: string; index?: number; propsSig?: string; imageSig?: string }[] = []

    // Walk peers in freshest-first order so downstream consumers that
    // first-write-wins (peerImageSigByLabel in show-cell, peerIndices
    // in the slot resolver) prefer the most-recent peer's data. A
    // stale peer who shipped an outdated index, or who's still cached
    // in the relay from before they disconnected, gets superseded by
    // any live peer.
    const lastSeenBag = this.#peerLastSeenMsBySig.get(this.#currentSig) ?? new Map<string, number>()
    const nowMs = Date.now()
    const sortedPeers = [...peerLayers.entries()].sort(([pkA], [pkB]) => {
      const tA = lastSeenBag.get(pkA) ?? 0
      const tB = lastSeenBag.get(pkB) ?? 0
      return tB - tA  // newest first
    })

    for (const [pubkey, layer] of sortedPeers) {
      if (this.#myPubkey && pubkey === this.#myPubkey) continue

      // Stale-peer filter — skip any peer whose last event is older
      // than PEER_STALE_MS. Same threshold the sweep uses for hard
      // eviction; doing the check here too means a peer that's gone
      // stale between sweeps still doesn't leak through to the
      // renderer.
      const lastMs = lastSeenBag.get(pubkey)
      if (lastMs !== undefined && nowMs - lastMs > PEER_STALE_MS) continue

      const children = Array.isArray(layer?.children) ? layer.children : []
      for (const c of children) {
        const name = String(c?.name ?? '').trim()
        if (!name) continue
        const idx = typeof c?.index === 'number' && Number.isFinite(c.index) && c.index >= 0
          ? c.index
          : undefined
        const propsSig = typeof c?.propsSig === 'string' && /^[0-9a-f]{64}$/.test(c.propsSig)
          ? c.propsSig
          : undefined
        const imageSig = typeof c?.imageSig === 'string' && /^[0-9a-f]{64}$/.test(c.imageSig)
          ? c.imageSig
          : undefined
        out.push({
          name,
          peerPubkey: pubkey,
          ...(idx !== undefined ? { index: idx } : {}),
          ...(propsSig !== undefined ? { propsSig } : {}),
          ...(imageSig !== undefined ? { imageSig } : {}),
        })
      }
    }
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
    mesh.configureKinds([29010, SWARM_LAYER_KIND, SWARM_RESOURCE_KIND, SWARM_HIDE_KIND], true)
  }

  #registerTileSource = (attempts: number): void => {
    const registry = this.#getRegistry()
    if (registry?.register) {
      const source = async (_loc: { segments: readonly string[]; dir: FileSystemDirectoryHandle | null }) => {
        const tiles = this.peerTilesAtCurrentSig()
        return tiles.map(({ name, peerPubkey, index }) => ({
          name,
          kind: 'peer' as const,
          source: {
            peerPubkey,
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

  #resolveMyPubkey = async (): Promise<void> => {
    const signer = this.#getSigner()
    if (!signer?.getPublicKeyHex) return
    try {
      const pk = await signer.getPublicKeyHex()
      if (pk) this.#myPubkey = pk.toLowerCase()
    } catch { /* ignore — left null, no self-filter applied */ }
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
    if (!lineage || !sigStore) return

    // Privacy gate — require BOTH a room and a secret before any swarm
    // network activity. Read live from the canonical stores so we
    // never act on stale local state. Empty either → silent (no
    // subscribe, no publish, no peer entries surface).
    const room = this.#getRoomStore()?.value?.trim() ?? ''
    const secret = this.#getSecretStore()?.value?.trim() ?? ''
    if (!room || !secret) return

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
      composedSig = await sigStore.signText(`${lineageKey} ${room} ${secret}`)
    } catch { return }
    if (!composedSig) return

    this.#lastSyncInput = { segments, room, secretLen: secret.length, key: `${lineageKey} ${room} ${secret}` }
    
    await this.#syncForSig(composedSig)
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

  #onEvent = (sig: string, evt: MeshEvtLike): void => {
    // Three kinds reach this callback: layer events (30200) carrying
    // a peer's children list, resource events (30201) carrying image
    // bytes the layer references, and hide events (30202) carrying
    // a peer's per-lineage hide filter. Route each to its own handler;
    // anything else (legacy 29010 paired-channel) falls through.
    const kind = Number(evt?.event?.kind ?? 0)
    if (kind === SWARM_RESOURCE_KIND) {
      void this.#onResourceEvent(evt)
      return
    }
    if (kind === SWARM_HIDE_KIND) {
      this.#onHideEvent(sig, evt)
      return
    }
    if (kind !== SWARM_LAYER_KIND) return

    // Local fanout has no pubkey on the event (the mesh fans the
    // unsigned event before signing). Skip — our own publish already
    // updated #lastPublishedBySig and a self entry doesn't add value.
    const pubkey = String(evt?.event?.pubkey ?? '').trim().toLowerCase()
    if (!pubkey) return

    // Self-skip via relay echo. Until #myPubkey resolves this is a
    // no-op; show-cell's localCellSet dedup catches the overlap.
    if (this.#myPubkey && pubkey === this.#myPubkey) return

    const payload = evt?.payload
    if (!payload || typeof payload !== 'object') return
    const layer = payload as SwarmLayerPayload
    if (!Array.isArray(layer.children)) return

    let bag = this.#peerLayersBySig.get(sig)
    if (!bag) { bag = new Map(); this.#peerLayersBySig.set(sig, bag) }
    const previousLayer = bag.get(pubkey)
    const isNewPeer = previousLayer === undefined
    const layerChanged = isNewPeer ||
      JSON.stringify(previousLayer) !== JSON.stringify(layer)
    bag.set(pubkey, layer)

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

    // Resource pull — for any child the peer references an imageSig
    // for, ensure we have the bytes locally. Skipped when this peer's
    // layer hasn't changed (the imageSig set is the same).
    if (layerChanged) {
      void this.#pullResourcesFromLayer(layer)
    }

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
    }, 150)
  }

  // -----------------------------------------------------------------
  // Publish
  // -----------------------------------------------------------------

  #publishMyLayerAt = async (sig: string): Promise<void> => {
    const mesh = this.#getMesh()
    const sigStore = this.#getSignatureStore()
    if (!mesh?.publish || !sigStore) return

    // Resolve the lineage's directory ourselves from Store.hypercombRoot
    // rather than calling lineage.explorerDir() — see LineageLike comment.
    const dir = await this.#resolveLineageDir()
    if (!dir) return

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
    void this.#publishSubtree(dir, segments, 0, counter, sigStore, mesh, room, secret)
    void sig  // sig recomputed inside #publishSubtree from segments+room+secret
  }

  #publishSubtree = async (
    dir: FileSystemDirectoryHandle,
    segments: readonly string[],
    depth: number,
    counter: { count: number },
    sigStore: SignatureStoreLike,
    mesh: MeshApi,
    room: string,
    secret: string,
  ): Promise<void> => {
    if (counter.count >= MAX_PUBLISH_NODES) return

    // Composed sig — must match the formula in #syncForCurrentLineage
    // exactly so subscribers and publishers address the same slot.
    const key = `${segments.join("/")}\0${room}\0${secret}`
    let sig = ''
    try { sig = await sigStore.signText(key) } catch { return }
    if (!sig) return

    const childNames = await listLocalChildren(dir)

    // Read each child's index from its 0000 file in parallel — gives
    // followers (peers in follow-host mode) a (name, index) map they
    // can apply to their own pinned-layout slot machine. Children with
    // no 0000 or no index field publish without `index` (downstream
    // assigns next-free slot).
    // For each child we publish:
    //   index    — slot ordering (from 0000.index)
    //   propsSig — sha256 of the canonical 0000 bytes (whole file)
    //   imageSig — sha256 of a props-shaped blob that points at the
    //              tile's visible image. Three sources, in priority:
    //                1. localStorage['hc:tile-props-index'][name] when
    //                   it points at a blob that already contains
    //                   `small.image` or `flat.small.image` refs (the
    //                   editor-saved or substrate-applied case).
    //                2. substrate.pickImageForLabel(name) — the
    //                   deterministic per-label fallback the renderer
    //                   uses for label-only tiles. We synthesize a
    //                   {small: {image}} blob, store it, and ship its
    //                   sig. Without this, MOST tiles' images would
    //                   never cross the wire because their props
    //                   blob has only {index, viewport}.
    //                3. Skipped — no imageSig field if neither source
    //                   yields anything (no substrate pool, no editor
    //                   image, no fallback).
    let propsIndex: Record<string, unknown> = {}
    try {
      propsIndex = JSON.parse(localStorage.getItem('hc:tile-props-index') ?? '{}')
    } catch { /* malformed — treat as empty */ }

    const store = this.#getStore()
    type ChildEntry = { name: string; index?: number; propsSig?: string; imageSig?: string }
    const children: ChildEntry[] = await Promise.all(childNames.map(async (name): Promise<ChildEntry> => {
      try {
        const childDir = await dir.getDirectoryHandle(name, { create: false })
        const props = await readChildProperties(childDir)
        const idx = Number(props['index'])
        const out: ChildEntry = { name }
        if (Number.isFinite(idx) && idx >= 0) out.index = idx
        if (store?.putResource) {
          try {
            const fileHandle = await childDir.getFileHandle('0000', { create: false })
            const blob = await fileHandle.getFile()
            if (blob.size > 0) {
              out.propsSig = await store.putResource(blob)
            }
          } catch { /* no 0000 file yet */ }
        }

        // Only forward an imageSig when the publisher's tile-props-
        // index points to a blob that contains REAL image refs — i.e.
        // the user has actually placed/saved an image on this tile
        // (editor save, substrate apply, AI bridge stamp). The
        // substrate's deterministic per-label picker is NOT a real
        // image — it's a display-time fallback the renderer uses for
        // label-only tiles, picked from the local pool every render.
        // Forwarding that across the wire would paint a peer-only
        // tile with what amounts to a default image the publisher
        // never intentionally chose, which is misleading to the
        // receiver. So: editor-saved or substrate-applied → carry
        // imageSig. Label-only tile → no imageSig, receiver renders
        // blank until the user explicitly adopts.
        const rawCached = propsIndex[name]
        if (typeof rawCached === 'string' && /^[0-9a-f]{64}$/.test(rawCached) && store?.getResource) {
          try {
            const cachedBlob = await store.getResource(rawCached)
            if (cachedBlob) {
              const text = await cachedBlob.text()
              const parsed = JSON.parse(text)
              const hasImage = (parsed && (
                (parsed.small && typeof parsed.small.image === 'string') ||
                (parsed.flat && parsed.flat.small && typeof parsed.flat.small.image === 'string') ||
                typeof parsed.imageSig === 'string'
              ))
              if (hasImage) {
                out.imageSig = rawCached
              }
            }
          } catch { /* not JSON / no image refs — leave imageSig unset */ }
        }

        return out
      } catch {
        return { name }
      }
    }))
    const payload: SwarmLayerPayload = { children }

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
    const heartbeatDue = elapsedSinceLast >= HEARTBEAT_INTERVAL_MS
    const contentChanged = this.#lastPublishedBySig.get(sig) !== serialized
    if (contentChanged || heartbeatDue) {
      this.#lastPublishedBySig.set(sig, serialized)
      this.#lastPublishTimeMsBySig.set(sig, nowMs)
      counter.count++

      // A "share" is the layer payload AND every resource it
      // references — they're one logical unit. Publish resources
      // FIRST so by the time a subscriber receives the layer event
      // and starts fetching referenced sigs, the relay already has
      // those resources cached and serves them on the REQ.
      //
      // Resources are independent of each other — fire them in
      // parallel via Promise.all, but await the whole batch before
      // the layer publish so the strict ordering guarantee survives.
      // Sequential await was correct but slowed each subtree level
      // to N × per-resource-publish-time, which delayed the deeper
      // recursion enough that the user's experience was "only the
      // top tile shows, children come much later." Parallel resource
      // publishes restore the speed without giving up the contract.
      const referenced = new Set<string>()
      for (const c of children) {
        if (c.propsSig) referenced.add(c.propsSig)
        if (c.imageSig) referenced.add(c.imageSig)
      }
      await Promise.all([...referenced].map(s => this.#publishResource(s, mesh)))

      // Now the layer itself. d-tag = lineage sig
      // (parameterized-replaceable per pubkey+kind+lineage). NIP-40
      // expiration drops the slot if our heartbeat lapses, so a
      // peer who closes their tab silently disappears from the
      // swarm within EVENT_TTL_SECS.
      const expirationSecs = Math.floor(nowMs / 1000) + EVENT_TTL_SECS
      await mesh.publish(SWARM_LAYER_KIND, sig, payload, [
        ['d', sig],
        ['expiration', String(expirationSecs)],
      ])
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
      try {
        const childDir = await dir.getDirectoryHandle(childName, { create: false })
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
      } catch { /* child dir gone — skip */ }
    }
    await Promise.all(subtreeWork)
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

  // Walk a received layer's children for propsSig references; for
  // each we don't already have locally, subscribe by sig so the
  // companion resource event lands and `#onResourceEvent` writes the
  // bytes to OPFS. The subscription is closed inside the handler once
  // the resource is persisted, keeping the per-shell sub count bounded.
  // The propsSig blob is the publisher's child `0000` — the receiver
  // needs it on disk so that adopting the peer tile can copy it
  // straight into the new local tile's `0000` and bring the same
  // visual state along.
  #pullResourcesFromLayer = async (layer: SwarmLayerPayload): Promise<void> => {
    const store = this.#getStore()
    const mesh = this.#getMesh()
    if (!store?.getResource || !mesh?.subscribe) return
    const needed = new Set<string>()
    for (const child of layer.children) {
      if (typeof child?.propsSig === 'string') needed.add(child.propsSig)
      if (typeof child?.imageSig === 'string') needed.add(child.imageSig)
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
  // IoC resolvers
  // -----------------------------------------------------------------

  #getMesh = (): MeshApi | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(NOSTR_MESH_KEY) as MeshApi | undefined

  #getSigner = (): SignerApi | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(NOSTR_SIGNER_KEY) as SignerApi | undefined

  #getRegistry = (): TileSourceRegistryLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(TILE_SOURCE_REGISTRY_KEY) as TileSourceRegistryLike | undefined

  #getLineage = (): LineageLike | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(LINEAGE_KEY) as LineageLike | undefined

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
