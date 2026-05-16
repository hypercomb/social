// src/diamondcoreprocessor.com/sharing/swarm.drone.ts
import { Drone } from "@hypercomb/core";
var SWARM_LAYER_KIND = 30200;
var NOSTR_MESH_KEY = "@diamondcoreprocessor.com/NostrMeshDrone";
var NOSTR_SIGNER_KEY = "@diamondcoreprocessor.com/NostrSigner";
var TILE_SOURCE_REGISTRY_KEY = "@hypercomb.social/TileSourceRegistry";
var LINEAGE_KEY = "@hypercomb.social/Lineage";
var SIGNATURE_STORE_KEY = "@hypercomb/SignatureStore";
var STORE_KEY = "@hypercomb.social/Store";
var MAX_PUBLISH_DEPTH = 3;
var MAX_PUBLISH_NODES = 200;
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
var SwarmDrone = class extends Drone {
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
  listens = ["mesh:ensure-started", "mesh:public-changed"];
  emits = ["swarm:peers-changed"];
  // Per-lineage subscription handle. We open one per visited sig and
  // never close (cheap — mesh dedupes by sig at the bucket layer).
  #subsBySig = /* @__PURE__ */ new Map();
  // Per-lineage peer state. Outer key = lineage sig, inner key = peer
  // pubkey. Updated on every incoming event; replaceability means the
  // last write wins per peer, which matches what we want at render.
  #peerLayersBySig = /* @__PURE__ */ new Map();
  // Per-lineage memo of the last children list we published. Used to
  // skip republishing when nothing about our local layer changed.
  #lastPublishedBySig = /* @__PURE__ */ new Map();
  // Resolved lazily from NostrSigner. Until it lands, incoming events
  // aren't filtered for self — which is harmless because show-cell
  // already dedupes peer entries against its OPFS-owned set, so our
  // own tiles still surface as `kind: 'opfs'` not `kind: 'peer'`.
  #myPubkey = null;
  // The most recent lineage sig surfaced via mesh:ensure-started. The
  // TileSource queries with the current location's segments; we trust
  // show-cell to call registry.resolve at the same lineage it just
  // emitted ensure-started for, so this is the right key to read.
  #currentSig = "";
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
    queueMicrotask(() => {
      void this.#resolveMyPubkey();
    });
    queueMicrotask(() => this.#hookLineageChanges(0));
  }
  sense = () => true;
  heartbeat = async () => {
    if (this.#initialized) return;
    this.#initialized = true;
    this.onEffect("mesh:ensure-started", ({ signature }) => {
      void this.#syncForSig(String(signature ?? "").trim());
    });
    this.onEffect("mesh:public-changed", (payload) => {
      if (payload?.public === false) {
        for (const sub of this.#subsBySig.values()) {
          try {
            sub.close();
          } catch {
          }
        }
        this.#subsBySig.clear();
        this.#peerLayersBySig.clear();
        this.#lastPublishedBySig.clear();
        this.emitEffect("swarm:peers-changed", { sig: this.#currentSig, reason: "mode-private" });
        return;
      }
      void this.#syncForCurrentLineage();
    });
  };
  // -----------------------------------------------------------------
  // Public — the SwarmTileSource queries this on every render.
  // -----------------------------------------------------------------
  /** All children any peer is currently publishing at #currentSig,
   *  excluding our own slot. Each entry carries the publisher's pubkey
   *  so the renderer can apply mine-vs-theirs treatment downstream. */
  peerTilesAtCurrentSig = () => {
    const peerLayers = this.#peerLayersBySig.get(this.#currentSig);
    if (!peerLayers || peerLayers.size === 0) return [];
    const out = [];
    for (const [pubkey, layer] of peerLayers) {
      if (this.#myPubkey && pubkey === this.#myPubkey) continue;
      const children = Array.isArray(layer?.children) ? layer.children : [];
      for (const c of children) {
        const name = String(c?.name ?? "").trim();
        if (!name) continue;
        out.push({ name, peerPubkey: pubkey });
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
    mesh.configureKinds([29010, SWARM_LAYER_KIND], true);
  };
  #registerTileSource = (attempts) => {
    const registry = this.#getRegistry();
    if (registry?.register) {
      const source = async (_loc) => {
        const tiles = this.peerTilesAtCurrentSig();
        return tiles.map(({ name, peerPubkey }) => ({
          name,
          kind: "peer",
          source: { peerPubkey }
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
    if (!signer?.getPublicKeyHex) return;
    try {
      const pk = await signer.getPublicKeyHex();
      if (pk) this.#myPubkey = pk.toLowerCase();
    } catch {
    }
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
    if (!lineage || !sigStore) return;
    const segsRaw = lineage.explorerSegments?.() ?? [];
    const segments = (Array.isArray(segsRaw) ? segsRaw : []).map((x) => String(x ?? "").trim()).filter((x) => x.length > 0);
    const key = segments.join("/");
    let sig = "";
    try {
      sig = await sigStore.signText(key);
    } catch {
      return;
    }
    if (!sig) return;
    await this.#syncForSig(sig);
  };
  #syncForSig = async (sig) => {
    if (!sig) return;
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
    if (kind !== SWARM_LAYER_KIND) return;
    const pubkey = String(evt?.event?.pubkey ?? "").trim().toLowerCase();
    if (!pubkey) return;
    if (this.#myPubkey && pubkey === this.#myPubkey) return;
    const payload = evt?.payload;
    if (!payload || typeof payload !== "object") return;
    const layer = payload;
    if (!Array.isArray(layer.children)) return;
    let bag = this.#peerLayersBySig.get(sig);
    if (!bag) {
      bag = /* @__PURE__ */ new Map();
      this.#peerLayersBySig.set(sig, bag);
    }
    const previousLayer = bag.get(pubkey);
    const isNewPeer = previousLayer === void 0;
    const layerChanged = isNewPeer || JSON.stringify(previousLayer) !== JSON.stringify(layer);
    bag.set(pubkey, layer);
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
    if (!mesh?.publish || !sigStore) return;
    const dir = await this.#resolveLineageDir();
    if (!dir) return;
    const lineage = this.#getLineage();
    const segsRaw = lineage?.explorerSegments?.() ?? [];
    const segments = (Array.isArray(segsRaw) ? segsRaw : []).map((x) => String(x ?? "").trim()).filter((x) => x.length > 0);
    const counter = { count: 0 };
    void this.#publishSubtree(dir, segments, 0, counter, sigStore, mesh);
    void sig;
  };
  #publishSubtree = async (dir, segments, depth, counter, sigStore, mesh) => {
    if (counter.count >= MAX_PUBLISH_NODES) return;
    const key = segments.join("/");
    let sig = "";
    try {
      sig = await sigStore.signText(key);
    } catch {
      return;
    }
    if (!sig) return;
    const childNames = await listLocalChildren(dir);
    const children = await Promise.all(childNames.map(async (name) => {
      try {
        const childDir = await dir.getDirectoryHandle(name, { create: false });
        const props = await readChildProperties(childDir);
        const idx = Number(props["index"]);
        return Number.isFinite(idx) && idx >= 0 ? { name, index: idx } : { name };
      } catch {
        return { name };
      }
    }));
    const payload = { children };
    const serialized = JSON.stringify(payload);
    if (this.#lastPublishedBySig.get(sig) !== serialized) {
      this.#lastPublishedBySig.set(sig, serialized);
      counter.count++;
      await mesh.publish(SWARM_LAYER_KIND, sig, payload, [["d", sig]]);
    }
    if (depth >= MAX_PUBLISH_DEPTH) return;
    for (const childName of childNames) {
      if (counter.count >= MAX_PUBLISH_NODES) break;
      let childDir;
      try {
        childDir = await dir.getDirectoryHandle(childName, { create: false });
      } catch {
        continue;
      }
      await this.#publishSubtree(
        childDir,
        [...segments, childName],
        depth + 1,
        counter,
        sigStore,
        mesh
      );
    }
  };
  // -----------------------------------------------------------------
  // IoC resolvers
  // -----------------------------------------------------------------
  #getMesh = () => window.ioc?.get?.(NOSTR_MESH_KEY);
  #getSigner = () => window.ioc?.get?.(NOSTR_SIGNER_KEY);
  #getRegistry = () => window.ioc?.get?.(TILE_SOURCE_REGISTRY_KEY);
  #getLineage = () => window.ioc?.get?.(LINEAGE_KEY);
  #getSignatureStore = () => window.ioc?.get?.(SIGNATURE_STORE_KEY);
  #getStore = () => window.ioc?.get?.(STORE_KEY);
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
