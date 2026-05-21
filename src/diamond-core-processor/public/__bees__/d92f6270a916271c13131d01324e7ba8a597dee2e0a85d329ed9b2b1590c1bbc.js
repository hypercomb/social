// src/diamondcoreprocessor.com/sharing/swarm.drone.ts
import { Drone } from "@hypercomb/core";
var SWARM_LAYER_KIND = 30200;
var SWARM_HIDE_KIND = 30202;
var SWARM_RESOURCE_KIND = 30201;
var NOSTR_MESH_KEY = "@diamondcoreprocessor.com/NostrMeshDrone";
var NOSTR_SIGNER_KEY = "@diamondcoreprocessor.com/NostrSigner";
var TILE_SOURCE_REGISTRY_KEY = "@hypercomb.social/TileSourceRegistry";
var LINEAGE_KEY = "@hypercomb.social/Lineage";
var HISTORY_SERVICE_KEY = "@diamondcoreprocessor.com/HistoryService";
var SIGNATURE_STORE_KEY = "@hypercomb/SignatureStore";
var STORE_KEY = "@hypercomb.social/Store";
var ROOM_STORE_KEY = "@hypercomb.social/RoomStore";
var SECRET_STORE_KEY = "@hypercomb.social/SecretStore";
var MAX_PUBLISH_DEPTH = 3;
var MAX_PUBLISH_NODES = 200;
var EVENT_TTL_SECS = 90;
var HEARTBEAT_INTERVAL_MS = 3e4;
var PEER_STALE_MS = EVENT_TTL_SECS * 1500;
var PEER_STALE_SWEEP_INTERVAL_MS = 3e4;
var RESOURCE_TTL_SECS = 86400;
var RESOURCE_REPUBLISH_BUFFER_MS = 5 * 60 * 1e3;
var MAX_RESOURCE_BYTES = 256 * 1024;
var SYSTEM_DIR_NAMES = /* @__PURE__ */ new Set([
  "__dependencies__",
  "__bees__",
  "__layers__",
  "__location__",
  "__history__",
  "__optimization__",
  "__resources__"
]);
function isSystemDirName(name) {
  if (!name) return true;
  if (SYSTEM_DIR_NAMES.has(name)) return true;
  return name.startsWith("__") && name.endsWith("__");
}
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  const chunkSize = 32768;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(s);
}
function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function collectNestedSigs(value, out) {
  if (!value) return;
  if (typeof value === "string") {
    if (/^[0-9a-f]{64}$/.test(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectNestedSigs(v, out);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) collectNestedSigs(v, out);
  }
}
async function listLocalChildren(dir) {
  const out = [];
  try {
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== "directory") continue;
      if (isSystemDirName(name)) continue;
      out.push(name);
    }
  } catch {
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}
async function readChildProperties(cellDir) {
  let fh;
  try {
    fh = await cellDir.getFileHandle("0000");
  } catch {
    return {};
  }
  try {
    const f = await fh.getFile();
    const txt = await f.text();
    const v = JSON.parse(txt);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
var SwarmDrone = class _SwarmDrone extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "sharing";
  description = "Public swarm sync. Each peer publishes their layer at every visited lineage as a parameterized replaceable Nostr event; subscribers cache a Map<pubkey, layer> per lineage and surface peer tiles to the renderer via TileSourceRegistry.";
  effects = ["network"];
  deps = {
    mesh: NOSTR_MESH_KEY,
    signer: NOSTR_SIGNER_KEY
  };
  // Listens to mesh:ensure-started purely for backward-compat — show-cell
  // emits it on every render; if it fires before our lineage-change hook
  // resolves, we still subscribe + publish on time. The primary trigger is
  // the Lineage `change` event we wire up in the constructor below.
  listens = ["mesh:ensure-started", "mesh:public-changed", "mesh:room", "mesh:secret"];
  emits = ["swarm:peers-changed", "swarm:resource-arrived", "swarm:hide-changed"];
  // Per-lineage subscription handle. We open one per visited sig and
  // never close (cheap — mesh dedupes by sig at the bucket layer).
  #subsBySig = /* @__PURE__ */ new Map();
  // Per-lineage peer state. Outer key = lineage sig, inner key = peer
  // pubkey. Updated on every incoming event; replaceability means the
  // last write wins per peer, which matches what we want at render.
  #peerLayersBySig = /* @__PURE__ */ new Map();
  // Wall-clock time (ms) we last saw an event from each peer at each
  // sig. Drives the staleness eviction below — a peer that hasn't
  // republished within PEER_STALE_MS is assumed offline and gets
  // evicted from the cache + the renderer is told to repaint without
  // their tiles. Mirrors the relay's NIP-40 expiration on the client
  // side so we don't keep showing a peer's tiles after their event
  // has lapsed in the relay's cache.
  #peerLastSeenMsBySig = /* @__PURE__ */ new Map();
  // Per-pubkey-per-lineage hidden-tile names. Populated from kind-
  // 30202 events (SWARM_HIDE_KIND). The publisher's own hide event
  // echoes back from the relay and seeds this map on refresh; that's
  // how the filter survives reloads without any client-side storage.
  // Outer key = composed lineage sig; inner key = peer pubkey; value
  // = Set of tile names that pubkey wants hidden at that lineage.
  #hiddenByPubkeyBySig = /* @__PURE__ */ new Map();
  // Per-lineage local memo of what we last published as our hidden
  // list. Drives the dedupe + heartbeat for hide events: skip a
  // republish when the list is unchanged AND the NIP-40 expiration
  // is still comfortably in the future.
  #lastPublishedHideBySig = /* @__PURE__ */ new Map();
  #lastHidePublishTimeMsBySig = /* @__PURE__ */ new Map();
  // Per-lineage memo of the last children list we published. Used to
  // skip republishing when nothing about our local layer changed.
  #lastPublishedBySig = /* @__PURE__ */ new Map();
  // Wall-clock time (ms) of the last publish per sig. Drives the
  // heartbeat — if a peer's payload hasn't changed in EVENT_TTL_SECS,
  // we still republish so the NIP-40 `expiration` tag stays in the
  // future and the relay doesn't drop our slot. Without this we'd
  // self-expire even while the user is actively present at this
  // lineage.
  #lastPublishTimeMsBySig = /* @__PURE__ */ new Map();
  // Resource sigs we've published as kind 30201 in this session.
  // Resources are immutable (content-addressed), so once we've fanned
  // out the bytes we don't republish UNLESS the relay's NIP-40
  // expiration is about to lapse for that resource — at which point
  // we re-assert so late joiners can still fetch. Map value is the
  // wall-clock time (ms) of the last publish; the heartbeat checks
  // against (now - RESOURCE_TTL_SECS + RESOURCE_REPUBLISH_BUFFER_MS)
  // to decide when to refresh. Cleared on dispose.
  #publishedResources = /* @__PURE__ */ new Map();
  // Resource sigs we're currently subscribed to (waiting for bytes).
  // One sub per sig (mesh dedupes consumers, but the bookkeeping is
  // ours): keyed by sig, value is the mesh subscription handle so we
  // can close it once the bytes arrive and land in OPFS.
  #resourceSubs = /* @__PURE__ */ new Map();
  // Resolved lazily from NostrSigner. Until it lands, incoming events
  // aren't filtered for self — which is harmless because show-cell
  // already dedupes peer entries against its OPFS-owned set, so our
  // own tiles still surface as `kind: 'opfs'` not `kind: 'peer'`.
  #myPubkey = null;
  // The most recent COMPOSED swarm sig (= sha256(lineageSig + room +
  // secret)) we're subscribed/publishing to. Different from the raw
  // lineage sig: the swarm gates membership on (room, secret) so
  // peers in different rooms or with wrong secrets don't see each
  // other's tiles even though they're at the same lineage path.
  #currentSig = "";
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
  #peersChangedTimer = null;
  #initialized = false;
  constructor() {
    super();
    queueMicrotask(() => this.#configureMeshKinds(0));
    queueMicrotask(() => this.#registerTileSource(0));
    queueMicrotask(() => this.#resolveMyPubkeyWithRetry(0));
    queueMicrotask(() => this.#hookLineageChanges(0));
    queueMicrotask(() => this.#updateZoneKey());
    this.#heartbeatTimer = setInterval(() => {
      if (!this.#currentSig) return;
      void this.#syncForCurrentLineage();
      const lastHide = this.#lastPublishedHideBySig.get(this.#currentSig);
      if (lastHide !== void 0) {
        try {
          const parsed = JSON.parse(lastHide);
          if (Array.isArray(parsed.hidden)) {
            void this.publishHide(parsed.hidden);
          }
        } catch {
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.#peerSweepTimer = setInterval(
      () => this.#sweepStalePeers(),
      PEER_STALE_SWEEP_INTERVAL_MS
    );
  }
  #heartbeatTimer = null;
  #peerSweepTimer = null;
  // Walk every sig in the peer cache and drop entries from peers whose
  // last event is older than PEER_STALE_MS. Emits swarm:peers-changed
  // once per sig that lost a peer so show-cell repaints. Cheap — runs
  // every PEER_STALE_SWEEP_INTERVAL_MS and only touches sigs with
  // actual peers.
  #sweepStalePeers = () => {
    const nowMs = Date.now();
    for (const [sig, bag] of this.#peerLayersBySig) {
      const lastSeenBag = this.#peerLastSeenMsBySig.get(sig);
      if (!lastSeenBag) continue;
      let evicted = false;
      for (const [pubkey] of bag) {
        const lastMs = lastSeenBag.get(pubkey);
        if (lastMs === void 0) continue;
        if (nowMs - lastMs > PEER_STALE_MS) {
          bag.delete(pubkey);
          lastSeenBag.delete(pubkey);
          evicted = true;
        }
      }
      if (evicted) {
        this.#schedulePeersChangedEmit({ sig, pubkey: "", reason: "stale-peer-evicted" });
      }
    }
  };
  // Zone key — a sync-readable identifier for the current (room,
  // secret) pair, written to localStorage so other drones can scope
  // their session-local data (hide list, future per-zone caches)
  // without having to consult the SignatureStore async. base64url
  // of `room\0secret` — unique per zone, sync, no hash collisions
  // possible. Empty when either credential is missing.
  static computeZoneKey(room, secret) {
    const r = (room ?? "").trim();
    const s = (secret ?? "").trim();
    if (!r || !s) return "";
    return btoa(`${r}\0${s}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  #updateZoneKey = () => {
    const room = this.#getRoomStore()?.value ?? "";
    const secret = this.#getSecretStore()?.value ?? "";
    const key = _SwarmDrone.computeZoneKey(room, secret);
    if (key) {
      localStorage.setItem("hc:current-zone", key);
    } else {
      localStorage.removeItem("hc:current-zone");
    }
  };
  /** Force-refresh the current lineage's swarm state: drop every
   *  cached peer at the current sig, close + reopen the subscription,
   *  re-publish our own layer. Useful when the user wants to manually
   *  flush a stale view ("the mesh is showing tiles I deleted") —
   *  the relay's NIP-40 eviction handles the publisher-side cleanup
   *  but receivers that loaded events before the cleanup ran still
   *  have them in memory; this clears that.
   *  Public so a UI control or slash command can invoke it. */
  refresh = () => {
    const sig = this.#currentSig;
    if (!sig) return;
    const sub = this.#subsBySig.get(sig);
    if (sub) {
      try {
        sub.close();
      } catch {
      }
      this.#subsBySig.delete(sig);
    }
    this.#peerLayersBySig.delete(sig);
    this.#peerLastSeenMsBySig.delete(sig);
    this.#lastPublishedBySig.delete(sig);
    this.#lastPublishTimeMsBySig.delete(sig);
    this.emitEffect("swarm:peers-changed", { sig, pubkey: "", reason: "manual-refresh" });
    void this.#syncForCurrentLineage();
  };
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
  evictPubkey = (pubkey) => {
    const pk = String(pubkey ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{8,64}$/.test(pk)) return { sigsAffected: 0, entriesEvicted: 0 };
    const matches = (candidate) => pk.length === 64 ? candidate === pk : candidate.startsWith(pk);
    let entriesEvicted = 0;
    const affectedSigs = [];
    for (const [sig, bag] of this.#peerLayersBySig) {
      const before = bag.size;
      for (const candidate of [...bag.keys()]) {
        if (matches(candidate)) {
          bag.delete(candidate);
          const lastSeenBag = this.#peerLastSeenMsBySig.get(sig);
          lastSeenBag?.delete(candidate);
          entriesEvicted++;
        }
      }
      if (bag.size !== before) affectedSigs.push(sig);
    }
    for (const sig of affectedSigs) {
      this.emitEffect("swarm:peers-changed", { sig, pubkey: pk, reason: "host-blocked-peer" });
    }
    return { sigsAffected: affectedSigs.length, entriesEvicted };
  };
  clearAllPeers = () => {
    let peers = 0;
    for (const bag of this.#peerLayersBySig.values()) peers += bag.size;
    const sigsCleared = this.#peerLayersBySig.size;
    const affectedSigs = [...this.#peerLayersBySig.keys()];
    this.#peerLayersBySig.clear();
    this.#peerLastSeenMsBySig.clear();
    this.#lastPublishedBySig.clear();
    this.#lastPublishTimeMsBySig.clear();
    for (const sig of affectedSigs) {
      this.emitEffect("swarm:peers-changed", { sig, pubkey: "", reason: "host-clear-mesh" });
    }
    void this.#syncForCurrentLineage();
    return { sigsCleared, peerEntriesCleared: peers };
  };
  // markDisposed() on the Bee base calls our protected dispose hook;
  // we clear timers so they stop firing once the drone is gone,
  // close any pending resource subs (their callbacks would otherwise
  // outlive the drone and try to write to a torn-down store), and
  // drop the published-resource memo so a re-mount re-asserts.
  // Effect subscriptions are auto-cleaned by the base.
  dispose() {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    if (this.#peerSweepTimer) {
      clearInterval(this.#peerSweepTimer);
      this.#peerSweepTimer = null;
    }
    for (const sub of this.#resourceSubs.values()) {
      try {
        sub.close();
      } catch {
      }
    }
    this.#resourceSubs.clear();
    this.#publishedResources.clear();
  }
  sense = () => true;
  heartbeat = async () => {
    if (this.#initialized) return;
    this.#initialized = true;
    this.onEffect("mesh:ensure-started", ({ signature }) => {
      void this.#syncForSig(String(signature ?? "").trim());
    });
    const roomStore = this.#getRoomStore();
    const secretStore = this.#getSecretStore();
    if (roomStore) {
      roomStore.addEventListener("change", () => this.#teardownAndResync("room-store-change"));
    }
    if (secretStore) {
      secretStore.addEventListener("change", () => this.#teardownAndResync("secret-store-change"));
    }
    this.onEffect("mesh:room", () => this.#teardownAndResync("mesh:room-effect"));
    this.onEffect("mesh:secret", () => this.#teardownAndResync("mesh:secret-effect"));
    this.onEffect("mesh:public-changed", (payload) => {
      const mesh = this.#getMesh();
      if (payload?.public === true && mesh?.setNetworkEnabled) {
        mesh.setNetworkEnabled(true);
        mesh.connectAll?.();
        mesh.resubscribeAll?.();
      }
      if (payload?.public === false) {
        for (const sub of this.#subsBySig.values()) {
          try {
            sub.close();
          } catch {
          }
        }
        this.#subsBySig.clear();
        this.#peerLayersBySig.clear();
        this.#peerLastSeenMsBySig.clear();
        this.#lastPublishedBySig.clear();
        this.#lastPublishTimeMsBySig.clear();
        for (const sub of this.#resourceSubs.values()) {
          try {
            sub.close();
          } catch {
          }
        }
        this.#resourceSubs.clear();
        this.#updateZoneKey();
        this.emitEffect("swarm:peers-changed", { sig: this.#currentSig, reason: "mode-private" });
        return;
      }
      this.#updateZoneKey();
      void this.#syncForCurrentLineage();
    });
  };
  // -----------------------------------------------------------------
  // Public — the SwarmTileSource queries this on every render.
  // -----------------------------------------------------------------
  // Track last sync input/output for diagnostics. Set by #syncForCurrentLineage.
  #lastSyncInput = null;
  /** Debug snapshot of every private field so callers can see exactly
   *  what state the drone is in. Used for diagnostics when sync
   *  doesn't behave; safe to expose since it only returns shapes
   *  callers already have to know about (sigs, pubkeys). */
  debug = () => ({
    lastSyncInput: this.#lastSyncInput,
    currentSig: this.#currentSig.slice(0, 12),
    myPubkey: this.#myPubkey?.slice(0, 8) ?? null,
    room: this.#getRoomStore()?.value ?? null,
    secretSet: !!this.#getSecretStore()?.value,
    subsCount: this.#subsBySig.size,
    subsBySig: Array.from(this.#subsBySig.keys()).map((s) => s.slice(0, 12)),
    peerLayersCount: this.#peerLayersBySig.size,
    peerLayersBySig: Object.fromEntries(
      Array.from(this.#peerLayersBySig.entries()).map(([sig, bag]) => [
        sig.slice(0, 12),
        { peerCount: bag.size, peers: Array.from(bag.keys()).map((p) => p.slice(0, 8)) }
      ])
    ),
    lastPublishedSigCount: this.#lastPublishedBySig.size,
    lastPublishedBySig: Array.from(this.#lastPublishedBySig.keys()).map((s) => s.slice(0, 12))
  });
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
  peerTilesAtCurrentSig = () => {
    const peerLayers = this.#peerLayersBySig.get(this.#currentSig);
    if (!peerLayers || peerLayers.size === 0) return [];
    const out = [];
    const lastSeenBag = this.#peerLastSeenMsBySig.get(this.#currentSig) ?? /* @__PURE__ */ new Map();
    const nowMs = Date.now();
    const sortedPeers = [...peerLayers.entries()].sort(([pkA], [pkB]) => {
      const tA = lastSeenBag.get(pkA) ?? 0;
      const tB = lastSeenBag.get(pkB) ?? 0;
      return tB - tA;
    });
    for (const [pubkey, layer] of sortedPeers) {
      if (this.#myPubkey && pubkey === this.#myPubkey) continue;
      const lastMs = lastSeenBag.get(pubkey);
      if (lastMs !== void 0 && nowMs - lastMs > PEER_STALE_MS) continue;
      const children = Array.isArray(layer?.children) ? layer.children : [];
      for (const c of children) {
        const name = String(c?.name ?? "").trim();
        if (!name) continue;
        const idx = typeof c?.index === "number" && Number.isFinite(c.index) && c.index >= 0 ? c.index : void 0;
        const propsSig = typeof c?.propsSig === "string" && /^[0-9a-f]{64}$/.test(c.propsSig) ? c.propsSig : void 0;
        const imageSig = typeof c?.imageSig === "string" && /^[0-9a-f]{64}$/.test(c.imageSig) ? c.imageSig : void 0;
        out.push({
          name,
          peerPubkey: pubkey,
          ...idx !== void 0 ? { index: idx } : {},
          ...propsSig !== void 0 ? { propsSig } : {},
          ...imageSig !== void 0 ? { imageSig } : {}
        });
      }
    }
    return out;
  };
  // -----------------------------------------------------------------
  // Boot
  // -----------------------------------------------------------------
  #configureMeshKinds = (attempts) => {
    const mesh = this.#getMesh();
    if (!mesh?.configureKinds) {
      if (attempts >= 50) return;
      setTimeout(() => this.#configureMeshKinds(attempts + 1), 100);
      return;
    }
    mesh.configureKinds([29010, SWARM_LAYER_KIND, SWARM_RESOURCE_KIND, SWARM_HIDE_KIND], true);
  };
  /**
   * Compose the swarm sig for an arbitrary set of segments. Same
   * algorithm as #syncForCurrentLineage: sha256 of `lineageKey + ' ' +
   * room + ' ' + secret`. Returns '' when room/secret are not set or
   * when the signature store isn't ready — caller treats that as
   * "no peer tiles to surface."
   */
  composeSigForSegments = async (segments) => {
    const sigStore = this.#getSignatureStore();
    if (!sigStore?.signText) return "";
    const room = this.#getRoomStore()?.value?.trim() ?? "";
    const secret = this.#getSecretStore()?.value?.trim() ?? "";
    if (!room || !secret) return "";
    const segs = (Array.isArray(segments) ? segments : []).map((x) => String(x ?? "").trim()).filter((x) => x.length > 0);
    const lineageKey = segs.join("/");
    try {
      return await sigStore.signText(`${lineageKey}\0${room}\0${secret}`);
    } catch {
      return "";
    }
  };
  /**
   * Same shape as peerTilesAtCurrentSig() but bound to a specific
   * composed sig instead of the drone's internal #currentSig. Used
   * by the tile source so the source can honor the LOCATION the
   * renderer asked about, not whatever lineage the drone last
   * synced to. Without this split, peer events from a previously-
   * visited location leak into the current view whenever the source
   * is called before #currentSig has caught up.
   */
  peerTilesAtSig = (sig) => {
    if (!sig) return [];
    const peerLayers = this.#peerLayersBySig.get(sig);
    if (!peerLayers || peerLayers.size === 0) return [];
    const out = [];
    const lastSeenBag = this.#peerLastSeenMsBySig.get(sig) ?? /* @__PURE__ */ new Map();
    const nowMs = Date.now();
    const sortedPeers = [...peerLayers.entries()].sort(([pkA], [pkB]) => {
      const tA = lastSeenBag.get(pkA) ?? 0;
      const tB = lastSeenBag.get(pkB) ?? 0;
      return tB - tA;
    });
    for (const [pubkey, layer] of sortedPeers) {
      if (this.#myPubkey && pubkey === this.#myPubkey) continue;
      const lastMs = lastSeenBag.get(pubkey);
      if (lastMs !== void 0 && nowMs - lastMs > PEER_STALE_MS) continue;
      const children = Array.isArray(layer?.children) ? layer.children : [];
      for (const c of children) {
        const name = String(c?.name ?? "").trim();
        if (!name) continue;
        const idx = typeof c?.index === "number" && Number.isFinite(c.index) && c.index >= 0 ? c.index : void 0;
        const propsSig = typeof c?.propsSig === "string" && /^[0-9a-f]{64}$/.test(c.propsSig) ? c.propsSig : void 0;
        const imageSig = typeof c?.imageSig === "string" && /^[0-9a-f]{64}$/.test(c.imageSig) ? c.imageSig : void 0;
        out.push({
          name,
          peerPubkey: pubkey,
          ...idx !== void 0 ? { index: idx } : {},
          ...propsSig !== void 0 ? { propsSig } : {},
          ...imageSig !== void 0 ? { imageSig } : {}
        });
      }
    }
    return out;
  };
  #registerTileSource = (attempts) => {
    const registry = this.#getRegistry();
    if (registry?.register) {
      const source = async (loc) => {
        const sig = await this.composeSigForSegments(loc.segments);
        if (!sig) return [];
        const tiles = this.peerTilesAtSig(sig);
        return tiles.map(({ name, peerPubkey, index }) => ({
          name,
          kind: "peer",
          source: {
            peerPubkey,
            ...typeof index === "number" ? { peerIndex: index } : {}
          }
        }));
      };
      registry.register(source);
      return;
    }
    if (attempts >= 50) return;
    setTimeout(() => this.#registerTileSource(attempts + 1), 100);
  };
  #resolveMyPubkey = async () => {
    const signer = this.#getSigner();
    if (!signer?.getPublicKeyHex) return false;
    try {
      const pk = await signer.getPublicKeyHex();
      if (!pk) return false;
      this.#myPubkey = pk.toLowerCase();
      let evicted = 0;
      for (const [sig, bag] of this.#peerLayersBySig) {
        if (bag.delete(this.#myPubkey)) {
          evicted++;
          const lastSeenBag = this.#peerLastSeenMsBySig.get(sig);
          lastSeenBag?.delete(this.#myPubkey);
          this.#schedulePeersChangedEmit({ sig, pubkey: this.#myPubkey, reason: "self-evicted-after-pubkey-resolve" });
        }
      }
      if (evicted > 0) {
        console.log(`[swarm] resolved myPubkey ${this.#myPubkey.slice(0, 8)}; evicted ${evicted} self-echo entr${evicted === 1 ? "y" : "ies"} from peer cache`);
      }
      return true;
    } catch {
      return false;
    }
  };
  // Boot-time retry wrapper. Signer registers via IoC during module
  // load; depending on bundle order it may not be ready when this
  // drone's constructor schedules the first resolve. Without retry,
  // a missed resolve leaves #myPubkey null for the session and the
  // self-skip at #onEvent never fires — every relay-echoed publish
  // of ours surfaces as a peer tile. Polls until the signer answers
  // or we hit the attempt cap (~10s).
  #resolveMyPubkeyWithRetry = async (attempts) => {
    if (this.#myPubkey) return;
    if (await this.#resolveMyPubkey()) return;
    if (attempts >= 100) return;
    setTimeout(() => {
      void this.#resolveMyPubkeyWithRetry(attempts + 1);
    }, 100);
  };
  // Wire ourselves to Lineage's `change` events so we follow navigation
  // independently of show-cell's render loop. This is the primary trigger
  // for "current location changed" — fires whenever the user navigates,
  // even before any user input has caused a processor pulse.
  //
  // Gating: also waits for NostrMeshDrone before firing the boot sync.
  // If mesh isn't ready when we fire, #ensureSubscribed silently skips
  // and we'd never subscribe (no further `change` events to retry on
  // when the user is idle on a freshly-loaded location).
  #hookLineageChanges = (attempts) => {
    const lineage = this.#getLineage();
    const sigStore = this.#getSignatureStore();
    const mesh = this.#getMesh();
    if (!lineage || !sigStore || !mesh) {
      if (attempts >= 50) return;
      setTimeout(() => this.#hookLineageChanges(attempts + 1), 100);
      return;
    }
    lineage.addEventListener("change", () => {
      void this.#syncForCurrentLineage();
    });
    void this.#syncForCurrentLineage();
  };
  #syncForCurrentLineage = async () => {
    const lineage = this.#getLineage();
    const sigStore = this.#getSignatureStore();
    if (!lineage || !sigStore) {
      console.log("[swarm] syncForCurrentLineage: missing", { lineage: !!lineage, sigStore: !!sigStore });
      return;
    }
    const room = this.#getRoomStore()?.value?.trim() ?? "";
    const secret = this.#getSecretStore()?.value?.trim() ?? "";
    if (!room || !secret) {
      const meshPublic = typeof localStorage !== "undefined" ? localStorage.getItem("hc:mesh-public") : null;
      console.log("[swarm] syncForCurrentLineage: room/secret missing \u2014 broadcast skipped", { hasRoom: !!room, hasSecret: !!secret, meshPublic });
      return;
    }
    console.log("[swarm] syncForCurrentLineage: proceeding", { roomLen: room.length, secretLen: secret.length });
    const segsRaw = lineage.explorerSegments?.() ?? [];
    const segments = (Array.isArray(segsRaw) ? segsRaw : []).map((x) => String(x ?? "").trim()).filter((x) => x.length > 0);
    const lineageKey = segments.join("/");
    let composedSig = "";
    try {
      composedSig = await sigStore.signText(`${lineageKey}\0${room}\0${secret}`);
    } catch {
      return;
    }
    if (!composedSig) return;
    this.#lastSyncInput = { segments, room, secretLen: secret.length, key: `${lineageKey}\0${room}\0${secret}` };
    await this.#syncForSig(composedSig);
  };
  // Tear down all per-sig state at the OLD #currentSig (subscriptions,
  // peer cache, last-published memo) and re-run sync at the new
  // composed sig. Called on room/secret changes. Emits
  // swarm:peers-changed so show-cell repaints without the now-orphaned
  // peer entries from the previous credential pair.
  #teardownAndResync = (reason) => {
    for (const sub of this.#subsBySig.values()) {
      try {
        sub.close();
      } catch {
      }
    }
    this.#subsBySig.clear();
    this.#peerLayersBySig.clear();
    this.#peerLastSeenMsBySig.clear();
    this.#lastPublishedBySig.clear();
    this.#lastPublishTimeMsBySig.clear();
    this.#hiddenByPubkeyBySig.clear();
    this.#lastPublishedHideBySig.clear();
    this.#lastHidePublishTimeMsBySig.clear();
    for (const sub of this.#resourceSubs.values()) {
      try {
        sub.close();
      } catch {
      }
    }
    this.#resourceSubs.clear();
    this.#publishedResources.clear();
    this.#updateZoneKey();
    this.emitEffect("swarm:peers-changed", { sig: this.#currentSig, reason });
    this.#currentSig = "";
    void this.#syncForCurrentLineage();
  };
  #syncForSig = async (sig) => {
    if (!sig) return;
    const prevSig = this.#currentSig;
    if (prevSig && prevSig !== sig) {
      const prevSub = this.#subsBySig.get(prevSig);
      if (prevSub) {
        try {
          prevSub.close();
        } catch {
        }
        this.#subsBySig.delete(prevSig);
      }
      this.#peerLayersBySig.delete(prevSig);
      this.#peerLastSeenMsBySig.delete(prevSig);
      this.#lastPublishedBySig.delete(prevSig);
      this.#lastPublishTimeMsBySig.delete(prevSig);
      this.#hiddenByPubkeyBySig.delete(prevSig);
      this.#lastPublishedHideBySig.delete(prevSig);
      this.#lastHidePublishTimeMsBySig.delete(prevSig);
      this.emitEffect("swarm:peers-changed", { sig: prevSig, reason: "lineage-change-flush" });
    }
    this.#currentSig = sig;
    this.#ensureSubscribed(sig);
    await this.#publishMyLayerAt(sig);
  };
  // -----------------------------------------------------------------
  // Subscribe / receive
  // -----------------------------------------------------------------
  #ensureSubscribed = (sig) => {
    if (this.#subsBySig.has(sig)) return;
    const mesh = this.#getMesh();
    if (!mesh?.subscribe) return;
    const sub = mesh.subscribe(sig, (evt) => this.#onEvent(sig, evt));
    this.#subsBySig.set(sig, sub);
  };
  #onEvent = (sig, evt) => {
    const kind = Number(evt?.event?.kind ?? 0);
    console.log("[swarm] onEvent received:", { sig: sig.slice(0, 8), kind, fromPubkey: evt?.event?.pubkey?.slice(0, 8), isSelf: this.#myPubkey && evt?.event?.pubkey === this.#myPubkey });
    if (kind === SWARM_LAYER_KIND || kind === SWARM_HIDE_KIND) {
      const nowSec = Math.floor(Date.now() / 1e3);
      const tags = evt?.event?.tags ?? [];
      const expirationTag = tags.find((t) => t[0] === "expiration")?.[1];
      if (expirationTag) {
        const expirationSec = Number(expirationTag);
        if (Number.isFinite(expirationSec) && expirationSec <= nowSec) {
          console.log("[swarm] onEvent DROPPED: expired", { kind, fromPubkey: evt?.event?.pubkey?.slice(0, 8), expirationSec, nowSec, delta: expirationSec - nowSec });
          return;
        }
      } else {
        const createdAt = Number(evt?.event?.created_at ?? 0);
        if (Number.isFinite(createdAt) && createdAt > 0 && createdAt + EVENT_TTL_SECS < nowSec) {
          console.log("[swarm] onEvent DROPPED: stale created_at", { kind, fromPubkey: evt?.event?.pubkey?.slice(0, 8), createdAt, nowSec, ageS: nowSec - createdAt });
          return;
        }
      }
    }
    if (kind === SWARM_RESOURCE_KIND) {
      void this.#onResourceEvent(evt);
      return;
    }
    if (kind === SWARM_HIDE_KIND) {
      this.#onHideEvent(sig, evt);
      return;
    }
    if (kind !== SWARM_LAYER_KIND) return;
    const pubkey = String(evt?.event?.pubkey ?? "").trim().toLowerCase();
    if (!pubkey) {
      console.log("[swarm] onEvent DROPPED: no pubkey (local fanout)");
      return;
    }
    if (this.#myPubkey && pubkey === this.#myPubkey) {
      return;
    }
    const payload = evt?.payload;
    if (!payload || typeof payload !== "object") {
      console.log("[swarm] onEvent DROPPED: payload not object", { pubkey: pubkey.slice(0, 8), payloadType: typeof payload });
      return;
    }
    const layer = payload;
    if (!Array.isArray(layer.children)) {
      console.log("[swarm] onEvent DROPPED: children not array", { pubkey: pubkey.slice(0, 8), childrenType: typeof layer.children });
      return;
    }
    let bag = this.#peerLayersBySig.get(sig);
    if (!bag) {
      bag = /* @__PURE__ */ new Map();
      this.#peerLayersBySig.set(sig, bag);
    }
    const previousLayer = bag.get(pubkey);
    const isNewPeer = previousLayer === void 0;
    const layerChanged = isNewPeer || JSON.stringify(previousLayer) !== JSON.stringify(layer);
    bag.set(pubkey, layer);
    console.log("[swarm] onEvent CACHED", { sig: sig.slice(0, 8), pubkey: pubkey.slice(0, 8), childCount: layer.children.length, isNewPeer, layerChanged });
    let lastSeenBag = this.#peerLastSeenMsBySig.get(sig);
    if (!lastSeenBag) {
      lastSeenBag = /* @__PURE__ */ new Map();
      this.#peerLastSeenMsBySig.set(sig, lastSeenBag);
    }
    lastSeenBag.set(pubkey, Date.now());
    if (layerChanged) {
      void this.#pullResourcesFromLayer(layer);
    }
    if (layerChanged) {
      this.#schedulePeersChangedEmit({
        sig,
        pubkey,
        reason: isNewPeer ? "peer-arrived" : "layer-updated"
      });
    }
  };
  #schedulePeersChangedEmit = (payload) => {
    if (this.#peersChangedTimer !== null) return;
    this.#peersChangedTimer = setTimeout(() => {
      this.#peersChangedTimer = null;
      this.emitEffect("swarm:peers-changed", payload);
    }, 150);
  };
  // -----------------------------------------------------------------
  // Publish
  // -----------------------------------------------------------------
  #publishMyLayerAt = async (sig) => {
    const mesh = this.#getMesh();
    const sigStore = this.#getSignatureStore();
    if (!mesh?.publish || !sigStore) {
      console.log("[swarm] publishMyLayerAt: missing mesh/sigStore", { mesh: !!mesh?.publish, sigStore: !!sigStore });
      return;
    }
    const dir = await this.#resolveLineageDir();
    if (!dir) {
      console.log("[swarm] publishMyLayerAt: no dir from #resolveLineageDir \u2014 sub-layer probably has no OPFS dir post-sweep");
      return;
    }
    console.log("[swarm] publishMyLayerAt:", { sig: sig.slice(0, 8), dirName: dir.name });
    const lineage = this.#getLineage();
    const segsRaw = lineage?.explorerSegments?.() ?? [];
    const segments = (Array.isArray(segsRaw) ? segsRaw : []).map((x) => String(x ?? "").trim()).filter((x) => x.length > 0);
    const room = this.#getRoomStore()?.value?.trim() ?? "";
    const secret = this.#getSecretStore()?.value?.trim() ?? "";
    if (!room || !secret) return;
    const counter = { count: 0 };
    void this.#publishSubtree(dir, segments, 0, counter, sigStore, mesh, room, secret);
    void sig;
  };
  #publishSubtree = async (dir, segments, depth, counter, sigStore, mesh, room, secret) => {
    if (counter.count >= MAX_PUBLISH_NODES) return;
    const key = `${segments.join("/")}\0${room}\0${secret}`;
    let sig = "";
    try {
      sig = await sigStore.signText(key);
    } catch {
      return;
    }
    if (!sig) return;
    const lineage = this.#getLineage();
    const history = this.#getHistory();
    let childNames;
    if (history?.sign && history?.currentLayerAt && history?.getLayerBySig) {
      try {
        const locationSig = await history.sign({
          domain: lineage?.domain,
          explorerSegments: () => segments
        });
        const layer = await history.currentLayerAt(locationSig);
        const childSigs = Array.isArray(layer?.children) ? layer.children : [];
        console.log("[swarm] publishSubtree: layer resolve", { segments, locationSig: locationSig?.slice(0, 8), layerExists: layer !== null, childSigCount: childSigs.length });
        if (childSigs.length === 0 && layer == null) {
          childNames = await listLocalChildren(dir);
          console.log("[swarm] publishSubtree: layer null \u2192 OPFS fallback", { childNames });
        } else {
          const resolved = await Promise.all(childSigs.map(async (cs) => {
            try {
              const child = await history.getLayerBySig(cs);
              return typeof child?.name === "string" && child.name.length > 0 ? child.name : null;
            } catch {
              return null;
            }
          }));
          childNames = resolved.filter((n) => n !== null);
          const droppedCount = resolved.length - childNames.length;
          if (droppedCount > 0) {
            console.log("[swarm] publishSubtree: dropped unresolved child sigs", { droppedCount, totalChildSigs: childSigs.length, resolvedNames: childNames });
          }
        }
      } catch (err) {
        console.log("[swarm] publishSubtree: history resolve threw \u2192 OPFS fallback", { err: String(err) });
        childNames = await listLocalChildren(dir);
      }
    } else {
      console.log("[swarm] publishSubtree: no history service \u2192 OPFS fallback", { dir: dir.name });
      childNames = await listLocalChildren(dir);
    }
    let propsIndex = {};
    try {
      propsIndex = JSON.parse(localStorage.getItem("hc:tile-props-index") ?? "{}");
    } catch {
    }
    const store = this.#getStore();
    const children = await Promise.all(childNames.map(async (name) => {
      try {
        const childDir = await dir.getDirectoryHandle(name, { create: false });
        const props = await readChildProperties(childDir);
        const idx = Number(props["index"]);
        const out = { name };
        if (Number.isFinite(idx) && idx >= 0) out.index = idx;
        if (store?.putResource) {
          try {
            const fileHandle = await childDir.getFileHandle("0000", { create: false });
            const blob = await fileHandle.getFile();
            if (blob.size > 0) {
              out.propsSig = await store.putResource(blob);
            }
          } catch {
          }
        }
        const rawCached = propsIndex[name];
        if (typeof rawCached === "string" && /^[0-9a-f]{64}$/.test(rawCached) && store?.getResource) {
          try {
            const cachedBlob = await store.getResource(rawCached);
            if (cachedBlob) {
              const text = await cachedBlob.text();
              const parsed = JSON.parse(text);
              const hasImage = parsed && (parsed.small && typeof parsed.small.image === "string" || parsed.flat && parsed.flat.small && typeof parsed.flat.small.image === "string" || typeof parsed.imageSig === "string");
              if (hasImage) {
                out.imageSig = rawCached;
              }
            }
          } catch {
          }
        }
        return out;
      } catch {
        return { name };
      }
    }));
    const payload = { children };
    const serialized = JSON.stringify(payload);
    const nowMs = Date.now();
    const lastTimeMs = this.#lastPublishTimeMsBySig.get(sig) ?? 0;
    const elapsedSinceLast = nowMs - lastTimeMs;
    const heartbeatDue = elapsedSinceLast >= HEARTBEAT_INTERVAL_MS;
    const contentChanged = this.#lastPublishedBySig.get(sig) !== serialized;
    console.log("[swarm] publishSubtree:", { sig: sig.slice(0, 8), depth, childCount: children.length, childNames, contentChanged, heartbeatDue, willPublish: contentChanged || heartbeatDue });
    if (contentChanged || heartbeatDue) {
      this.#lastPublishedBySig.set(sig, serialized);
      this.#lastPublishTimeMsBySig.set(sig, nowMs);
      counter.count++;
      const referenced = /* @__PURE__ */ new Set();
      for (const c of children) {
        if (c.propsSig) referenced.add(c.propsSig);
        if (c.imageSig) referenced.add(c.imageSig);
      }
      await Promise.all([...referenced].map((s) => this.#publishResource(s, mesh)));
      const expirationSecs = Math.floor(nowMs / 1e3) + EVENT_TTL_SECS;
      await mesh.publish(SWARM_LAYER_KIND, sig, payload, [
        ["d", sig],
        ["expiration", String(expirationSecs)]
      ]);
    }
    if (depth >= MAX_PUBLISH_DEPTH) return;
    const subtreeWork = [];
    for (const childName of childNames) {
      if (counter.count >= MAX_PUBLISH_NODES) break;
      try {
        const childDir = await dir.getDirectoryHandle(childName, { create: false });
        subtreeWork.push(this.#publishSubtree(
          childDir,
          [...segments, childName],
          depth + 1,
          counter,
          sigStore,
          mesh,
          room,
          secret
        ));
      } catch {
      }
    }
    await Promise.all(subtreeWork);
  };
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
  #publishResource = async (sig, mesh) => {
    if (!sig) return;
    const nowMs = Date.now();
    const lastMs = this.#publishedResources.get(sig);
    if (lastMs !== void 0 && nowMs - lastMs < RESOURCE_TTL_SECS * 1e3 - RESOURCE_REPUBLISH_BUFFER_MS) return;
    const store = this.#getStore();
    if (!store?.getResource) return;
    let blob = null;
    try {
      blob = await store.getResource(sig);
    } catch {
      return;
    }
    if (!blob) return;
    const buf = await blob.arrayBuffer();
    if (buf.byteLength > MAX_RESOURCE_BYTES) {
      console.warn("[swarm] skipping resource publish \u2014 exceeds cap", { sig: sig.slice(0, 12), bytes: buf.byteLength });
      this.#publishedResources.set(sig, nowMs + RESOURCE_TTL_SECS * 1e3);
      return;
    }
    this.#publishedResources.set(sig, nowMs);
    const content = arrayBufferToBase64(buf);
    const expirationSecs = Math.floor(nowMs / 1e3) + RESOURCE_TTL_SECS;
    try {
      await mesh.publish(SWARM_RESOURCE_KIND, sig, content, [
        ["d", sig],
        ["expiration", String(expirationSecs)]
      ]);
    } catch (err) {
      console.warn("[swarm] publishResource failed", { sig: sig.slice(0, 12), err });
      this.#publishedResources.delete(sig);
      return;
    }
    try {
      const text = new TextDecoder().decode(buf);
      const parsed = JSON.parse(text);
      const nested = /* @__PURE__ */ new Set();
      collectNestedSigs(parsed, nested);
      nested.delete(sig);
      await Promise.all([...nested].map((sub) => this.#publishResource(sub, mesh)));
    } catch {
    }
  };
  // Walk a received layer's children for propsSig references; for
  // each we don't already have locally, subscribe by sig so the
  // companion resource event lands and `#onResourceEvent` writes the
  // bytes to OPFS. The subscription is closed inside the handler once
  // the resource is persisted, keeping the per-shell sub count bounded.
  // The propsSig blob is the publisher's child `0000` — the receiver
  // needs it on disk so that adopting the peer tile can copy it
  // straight into the new local tile's `0000` and bring the same
  // visual state along.
  #pullResourcesFromLayer = async (layer) => {
    const store = this.#getStore();
    const mesh = this.#getMesh();
    if (!store?.getResource || !mesh?.subscribe) return;
    const needed = /* @__PURE__ */ new Set();
    for (const child of layer.children) {
      if (typeof child?.propsSig === "string") needed.add(child.propsSig);
      if (typeof child?.imageSig === "string") needed.add(child.imageSig);
    }
    for (const sig of needed) {
      if (this.#resourceSubs.has(sig)) continue;
      let existing = null;
      try {
        existing = await store.getResource(sig);
      } catch {
      }
      if (existing) continue;
      const sub = mesh.subscribe(sig, (evt) => void this.#onResourceEvent(evt));
      this.#resourceSubs.set(sig, sub);
    }
  };
  // Resource arrival path. Verifies the bytes against the d-tag sig
  // (Store.putResource computes its own sha256 — a mismatch tells us
  // the peer published bad bytes and we discard rather than persist).
  // On success, emits `swarm:resource-arrived` so substrate / show-
  // cell can re-resolve any tile that was waiting on this sig.
  #onResourceEvent = async (evt) => {
    const kind = Number(evt?.event?.kind ?? 0);
    if (kind !== SWARM_RESOURCE_KIND) return;
    const tags = evt?.event?.tags ?? [];
    const dTag = tags.find((t) => t[0] === "d")?.[1] ?? "";
    if (!dTag) return;
    const sig = String(dTag).toLowerCase();
    const content = String(evt?.event?.content ?? "");
    if (!content) return;
    const store = this.#getStore();
    if (!store?.putResource) return;
    let bytes;
    try {
      bytes = base64ToArrayBuffer(content);
    } catch {
      return;
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESOURCE_BYTES) return;
    const blob = new Blob([bytes]);
    let writtenSig = "";
    try {
      writtenSig = await store.putResource(blob);
    } catch {
      return;
    }
    if (writtenSig !== sig) {
      console.warn("[swarm] resource sig mismatch", { claimed: sig.slice(0, 12), actual: writtenSig.slice(0, 12) });
      return;
    }
    const sub = this.#resourceSubs.get(sig);
    if (sub) {
      try {
        sub.close();
      } catch {
      }
      this.#resourceSubs.delete(sig);
    }
    try {
      const text = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(text);
      const nested = /* @__PURE__ */ new Set();
      collectNestedSigs(parsed, nested);
      nested.delete(sig);
      const mesh = this.#getMesh();
      const getResource = store.getResource;
      if (mesh?.subscribe && getResource) {
        for (const sub2 of nested) {
          if (this.#resourceSubs.has(sub2)) continue;
          let existing = null;
          try {
            existing = await getResource(sub2);
          } catch {
          }
          if (existing) continue;
          const sh = mesh.subscribe(sub2, (ev) => void this.#onResourceEvent(ev));
          this.#resourceSubs.set(sub2, sh);
        }
      }
    } catch {
    }
    this.emitEffect("swarm:resource-arrived", { sig });
  };
  // -----------------------------------------------------------------
  // Hide events (kind 30202)
  // -----------------------------------------------------------------
  // Reads the hide event's `{ hidden: [...] }` payload and stores it
  // per (sig, pubkey). NOTE the self-pubkey filter that layer events
  // use does NOT apply here — we WANT our own hide events to come
  // back on relay echo so the filter survives reloads. The publisher
  // (us) and the consumer (us) are the same client; the mesh is just
  // the persistence layer.
  #onHideEvent = (sig, evt) => {
    const pubkey = String(evt?.event?.pubkey ?? "").trim().toLowerCase();
    if (!pubkey) return;
    const payload = evt?.payload;
    if (!payload || typeof payload !== "object") return;
    const rawHidden = payload.hidden;
    if (!Array.isArray(rawHidden)) return;
    const hidden = new Set(
      rawHidden.map((x) => String(x ?? "").trim()).filter((x) => x.length > 0)
    );
    let bag = this.#hiddenByPubkeyBySig.get(sig);
    if (!bag) {
      bag = /* @__PURE__ */ new Map();
      this.#hiddenByPubkeyBySig.set(sig, bag);
    }
    const previous = bag.get(pubkey);
    const changed = !previous || previous.size !== hidden.size || [...hidden].some((x) => !previous.has(x));
    bag.set(pubkey, hidden);
    if (changed) {
      this.emitEffect("swarm:hide-changed", { sig, pubkey });
    }
  };
  /** All tile names this client (own pubkey) has hidden at the
   *  current lineage. Merged into show-cell's local hidden filter
   *  so the renderer drops them from the union before laying out.
   *  Returns an empty set when myPubkey hasn't resolved yet OR
   *  when no hide event has echoed back from the relay. */
  hiddenAtCurrentSig = () => {
    if (!this.#myPubkey) return /* @__PURE__ */ new Set();
    const bag = this.#hiddenByPubkeyBySig.get(this.#currentSig);
    return bag?.get(this.#myPubkey) ?? /* @__PURE__ */ new Set();
  };
  /** Publish a hide event for the current lineage with the given
   *  set of names. Idempotent with heartbeat — skips a republish
   *  when the list is unchanged AND we're not approaching NIP-40
   *  expiration. Pass an empty set to clear the filter (publishes
   *  `{ hidden: [] }` which the relay-echo will then store as the
   *  cleared state). */
  publishHide = async (names) => {
    const sig = this.#currentSig;
    if (!sig) return;
    const mesh = this.#getMesh();
    if (!mesh?.publish) return;
    const hidden = [...new Set([...names].map((n) => String(n).trim()).filter((n) => n.length > 0))].sort();
    const payload = { hidden };
    const serialized = JSON.stringify(payload);
    const nowMs = Date.now();
    const lastTimeMs = this.#lastHidePublishTimeMsBySig.get(sig) ?? 0;
    const heartbeatDue = nowMs - lastTimeMs >= HEARTBEAT_INTERVAL_MS;
    const contentChanged = this.#lastPublishedHideBySig.get(sig) !== serialized;
    if (!contentChanged && !heartbeatDue) return;
    this.#lastPublishedHideBySig.set(sig, serialized);
    this.#lastHidePublishTimeMsBySig.set(sig, nowMs);
    const expirationSecs = Math.floor(nowMs / 1e3) + EVENT_TTL_SECS;
    try {
      await mesh.publish(SWARM_HIDE_KIND, sig, payload, [
        ["d", sig],
        ["expiration", String(expirationSecs)]
      ]);
    } catch (err) {
      console.warn("[swarm] publishHide failed", { sig: sig.slice(0, 12), err });
      this.#lastHidePublishTimeMsBySig.delete(sig);
    }
  };
  // -----------------------------------------------------------------
  // IoC resolvers
  // -----------------------------------------------------------------
  #getMesh = () => window.ioc?.get?.(NOSTR_MESH_KEY);
  #getSigner = () => window.ioc?.get?.(NOSTR_SIGNER_KEY);
  #getRegistry = () => window.ioc?.get?.(TILE_SOURCE_REGISTRY_KEY);
  #getLineage = () => window.ioc?.get?.(LINEAGE_KEY);
  #getHistory = () => window.ioc?.get?.(HISTORY_SERVICE_KEY);
  #getSignatureStore = () => window.ioc?.get?.(SIGNATURE_STORE_KEY);
  #getStore = () => window.ioc?.get?.(STORE_KEY);
  #getRoomStore = () => window.ioc?.get?.(ROOM_STORE_KEY);
  #getSecretStore = () => window.ioc?.get?.(SECRET_STORE_KEY);
  // Resolve the FileSystemDirectoryHandle for the current lineage by
  // walking from Store.hypercombRoot using the segments — bypasses
  // lineage's explorerDir cache so a too-early call here can never
  // pollute show-cell's later reads with a cached null.
  #resolveLineageDir = async () => {
    const store = this.#getStore();
    const root = store?.hypercombRoot;
    if (!root) return null;
    const lineage = this.#getLineage();
    const segs = lineage?.explorerSegments?.() ?? [];
    const segments = (Array.isArray(segs) ? segs : []).map((x) => String(x ?? "").trim()).filter((x) => x.length > 0);
    let dir = root;
    for (const seg of segments) {
      try {
        dir = await dir.getDirectoryHandle(seg, { create: false });
      } catch {
        return null;
      }
    }
    return dir;
  };
};
var _swarmDrone = new SwarmDrone();
window.ioc?.register?.(
  "@diamondcoreprocessor.com/SwarmDrone",
  _swarmDrone
);
export {
  SwarmDrone
};
