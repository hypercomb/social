var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/diamondcoreprocessor.com/editor/tile-properties.ts
var tile_properties_exports = {};
__export(tile_properties_exports, {
  TILE_PROPERTIES_FILE: () => TILE_PROPERTIES_FILE,
  cellLocationSig: () => cellLocationSig,
  isSignature: () => isSignature,
  readCellProperties: () => readCellProperties,
  resolveResourceSignatures: () => resolveResourceSignatures,
  writeCellProperties: () => writeCellProperties
});
import { EffectBus, SignatureService } from "@hypercomb/core";
var TILE_PROPERTIES_FILE, isSignature, cellLocationSig, readCellProperties, writeCellProperties, resolveResourceSignatures;
var init_tile_properties = __esm({
  "src/diamondcoreprocessor.com/editor/tile-properties.ts"() {
    "use strict";
    TILE_PROPERTIES_FILE = "0000";
    isSignature = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
    cellLocationSig = async (parentSegments, cellName) => {
      const path = [...parentSegments, cellName].join("/");
      const sigStore = window.ioc?.get("@hypercomb/SignatureStore");
      if (sigStore?.signText) return sigStore.signText(path);
      return SignatureService.sign(new TextEncoder().encode(path).buffer);
    };
    readCellProperties = async (cellDir) => {
      let fileHandle;
      try {
        fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE);
      } catch {
        return {};
      }
      try {
        const file = await fileHandle.getFile();
        const text = await file.text();
        return JSON.parse(text);
      } catch (err) {
        console.warn("[tile-properties] failed to read/parse 0000 in", cellDir.name, err);
        return {};
      }
    };
    writeCellProperties = async (cellDir, updates, cacheKey) => {
      const existing = await readCellProperties(cellDir);
      const merged = { ...existing, ...updates };
      const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(merged));
      await writable.close();
      EffectBus.emit("cell:0000-changed", {
        cacheKey: cacheKey ?? cellDir.name,
        keys: Object.keys(updates)
      });
    };
    resolveResourceSignatures = async (properties, getResource) => {
      const resolved = /* @__PURE__ */ new Map();
      const walk = async (obj) => {
        if (!obj || typeof obj !== "object") return;
        for (const value of Object.values(obj)) {
          if (isSignature(value)) {
            const sig = value;
            if (!resolved.has(sig)) {
              const blob = await getResource(sig);
              if (blob) resolved.set(sig, blob);
            }
          } else if (typeof value === "object" && value !== null) {
            await walk(value);
          }
        }
      };
      await walk(properties);
      return resolved;
    };
  }
});

// src/diamondcoreprocessor.com/sharing/expose.drone.ts
init_tile_properties();
import { Drone as Drone2, EffectBus as EffectBus3 } from "@hypercomb/core";

// src/diamondcoreprocessor.com/sharing/paired-channel.drone.ts
import { Drone, EffectBus as EffectBus2 } from "@hypercomb/core";

// src/diamondcoreprocessor.com/sharing/paired-channel.service.ts
import { SignatureService as SignatureService2 } from "@hypercomb/core";
var PAIRED_CHANNEL_KIND = 29010;
var TEXT_ENCODER = new TextEncoder();
async function channelIdFor(lineageSig, _room, secret) {
  const sig = String(lineageSig ?? "").trim().toLowerCase();
  const sec = String(secret ?? "").trim();
  if (!/^[0-9a-f]{64}$/.test(sig)) throw new Error("paired-channel: lineageSig must be 64 hex chars");
  if (!sec) throw new Error("paired-channel: secret is required");
  const buf = TEXT_ENCODER.encode(
    `${sig.length}:${sig}|${sec.length}:${sec}`
  );
  return SignatureService2.sign(buf.buffer);
}
async function channelIdForLineage(lineage, room, secret) {
  const history = window.ioc.get(
    "@diamondcoreprocessor.com/HistoryService"
  );
  let lineageSig;
  if (history?.sign) {
    lineageSig = await history.sign(lineage);
  } else {
    const segments = (lineage.explorerSegments?.() ?? []).map((s) => String(s ?? "").trim()).filter((s) => s.length > 0);
    const key = segments.join("/");
    lineageSig = await SignatureService2.sign(TEXT_ENCODER.encode(key).buffer);
  }
  return channelIdFor(lineageSig, room, secret);
}
var PairedChannelService = class {
  /** Per-channel handler bookkeeping so re-subscribes aren't duplicated. */
  #subs = /* @__PURE__ */ new Map();
  /**
   * Publish an event into a channel. Caller supplies the verb (`type` tag)
   * and the JSON payload. Extra tags are appended verbatim — caller is
   * responsible for following the tag conventions in the spec.
   *
   * Returns false if the mesh isn't available (no signer, no relay) —
   * the caller can decide whether to retry, queue, or surface the error.
   */
  async publish(channelId, type, payload, extraTags = []) {
    if (!isChannelId(channelId)) {
      console.warn("[paired-channel] publish ignored: invalid channelId", channelId);
      return false;
    }
    if (!type) {
      console.warn("[paired-channel] publish ignored: missing type");
      return false;
    }
    const mesh = this.#mesh();
    if (!mesh) {
      console.warn("[paired-channel] publish: mesh unavailable, dropping event", { channelId, type });
      return false;
    }
    const tags = [["type", String(type)], ...extraTags.filter((t) => Array.isArray(t) && t.length >= 2)];
    const result = await mesh.publish(PAIRED_CHANNEL_KIND, channelId, payload, tags);
    console.log("[sync] mesh.publish", { channel: channelId.slice(0, 12), verb: type, ok: result });
    return result;
  }
  /**
   * Subscribe to a channel. The handler receives every event whose
   * channelId matches and whose kind is 29010. Unknown verbs are still
   * delivered — the dispatcher decides what to ignore.
   *
   * Returns a subscription object; call `.close()` to detach. Multiple
   * subscriptions to the same channel share a single mesh subscription;
   * closing one only detaches that handler.
   */
  subscribe(channelId, handler) {
    if (!isChannelId(channelId)) {
      console.warn("[paired-channel] subscribe ignored: invalid channelId", channelId);
      return { close: () => {
      } };
    }
    const mesh = this.#mesh();
    if (!mesh) {
      console.warn("[paired-channel] subscribe: mesh unavailable");
      return { close: () => {
      } };
    }
    const existing = this.#subs.get(channelId);
    if (existing) {
      existing.handlers.add(handler);
      return { close: () => this.#detach(channelId, handler) };
    }
    console.log("[sync] mesh.subscribe", { channel: channelId.slice(0, 12) });
    const handlers = /* @__PURE__ */ new Set([handler]);
    const meshSub = mesh.subscribe(channelId, (msg) => {
      const evt = msg?.event;
      if (!evt) return;
      const ce = parseChannelEvent(channelId, evt);
      if (!ce) {
        console.warn("[sync] mesh.subscribe: parseChannelEvent failed", { channel: channelId.slice(0, 12), type: evt?.tags });
        return;
      }
      for (const h of [...handlers]) {
        try {
          h(ce);
        } catch (err) {
          console.warn("[paired-channel] handler threw", ce.type, err);
        }
      }
    });
    this.#subs.set(channelId, { meshSub, handlers });
    return { close: () => this.#detach(channelId, handler) };
  }
  // ── internals ──────────────────────────────────────────────────────
  #detach(channelId, handler) {
    const entry = this.#subs.get(channelId);
    if (!entry) return;
    entry.handlers.delete(handler);
    if (entry.handlers.size === 0) {
      try {
        entry.meshSub.close();
      } catch {
      }
      this.#subs.delete(channelId);
    }
  }
  #mesh() {
    const mesh = window.ioc.get("@diamondcoreprocessor.com/NostrMeshDrone");
    return mesh ?? null;
  }
};
function isChannelId(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function parseChannelEvent(channelId, evt) {
  const tags = Array.isArray(evt.tags) ? evt.tags : [];
  let type = "";
  for (const t of tags) {
    if (Array.isArray(t) && t.length >= 2 && t[0] === "type") {
      type = String(t[1]);
      break;
    }
  }
  if (!type) return null;
  const rawContent = evt.content;
  let content = rawContent;
  if (typeof rawContent === "string" && rawContent.length > 0) {
    try {
      content = JSON.parse(rawContent);
    } catch {
    }
  }
  return {
    channelId,
    type,
    pubkey: typeof evt.pubkey === "string" ? evt.pubkey : "",
    id: typeof evt.id === "string" ? evt.id : "",
    createdAt: typeof evt.created_at === "number" ? evt.created_at : 0,
    content,
    tags: tags.map((t) => Array.isArray(t) ? t.map(String) : []),
    raw: evt
  };
}
var _pairedChannelService = new PairedChannelService();
window.ioc.register("@diamondcoreprocessor.com/PairedChannelService", _pairedChannelService);

// src/diamondcoreprocessor.com/sharing/paired-channel.machine.ts
var PairedChannelMachine = class {
  state;
  constructor(channelId) {
    this.state = {
      channelId,
      hostPubkey: null,
      members: /* @__PURE__ */ new Set(),
      pendingJoins: /* @__PURE__ */ new Map(),
      shares: /* @__PURE__ */ new Map(),
      audits: { approvals: /* @__PURE__ */ new Map(), rejections: /* @__PURE__ */ new Map() },
      layers: /* @__PURE__ */ new Map()
    };
  }
  /** Feed a channel event into the machine. Returns the transitions
   *  produced (may be empty for ignored events). */
  apply(event) {
    if (event.channelId !== this.state.channelId) return [];
    const out = [];
    const c = this.#payload(event);
    switch (event.type) {
      case "announce":
        out.push(...this.#announce(event));
        break;
      case "join":
        out.push(...this.#join(event));
        break;
      case "admit":
        out.push(...this.#admit(event));
        break;
      case "revoke":
        out.push(...this.#revoke(event));
        break;
      case "share-request":
        out.push(...this.#shareRequest(event, c));
        break;
      case "share":
        out.push(...this.#share(event, c));
        break;
      case "share-revoked":
        out.push(...this.#shareRevoked(event));
        break;
      case "pulled":
        out.push(...this.#pulled(event));
        break;
      case "layer":
        out.push(...this.#layer(event, c));
        break;
      case "approve":
        out.push(...this.#auditApprove(event));
        break;
      case "reject":
        out.push(...this.#auditReject(event, c));
        break;
      default:
        out.push({ kind: "unknown-verb", type: event.type });
        break;
    }
    return out;
  }
  // ── verb handlers ───────────────────────────────────────────────────
  #announce(e) {
    if (this.state.hostPubkey) return [];
    if (!e.pubkey) return [];
    this.state.hostPubkey = e.pubkey;
    return [{ kind: "host-elected", pubkey: e.pubkey }];
  }
  #join(e) {
    if (!e.id || !e.pubkey) return [];
    if (this.state.pendingJoins.has(e.id)) return [];
    if (this.state.members.has(e.pubkey)) return [];
    const join = { id: e.id, pubkey: e.pubkey, observedAt: e.createdAt };
    this.state.pendingJoins.set(e.id, join);
    return [{ kind: "join-request-received", id: e.id, pubkey: e.pubkey }];
  }
  #admit(e) {
    const target = this.#pTag(e);
    if (!target) return [];
    if (e.pubkey !== this.state.hostPubkey) return [];
    this.state.members.add(target);
    for (const [id, j] of this.state.pendingJoins) {
      if (j.pubkey === target) this.state.pendingJoins.delete(id);
    }
    return [{ kind: "member-admitted", pubkey: target }];
  }
  #revoke(e) {
    const target = this.#pTag(e);
    if (!target) return [];
    if (e.pubkey !== this.state.hostPubkey) return [];
    if (!this.state.members.has(target)) return [];
    this.state.members.delete(target);
    return [{ kind: "member-revoked", pubkey: target }];
  }
  #shareRequest(e, c) {
    if (!e.id || !e.pubkey) return [];
    if (this.state.shares.has(e.id)) return [];
    const branchSig = stringField(c, "branchSig") || this.#layerTag(e) || "";
    if (!branchSig) return [];
    const branchName = stringField(c, "name") || stringField(c, "branchName") || branchSig.slice(0, 8);
    const tileCount = numberField(c, "tileCount");
    const byteEstimate = numberField(c, "byteEstimate");
    const preview = (c["preview"] !== void 0 ? c["preview"] : null) ?? null;
    const body = c["body"] && typeof c["body"] === "object" && !Array.isArray(c["body"]) ? c["body"] : null;
    const share = {
      requestId: e.id,
      approvalId: null,
      requesterPubkey: e.pubkey,
      branchName,
      branchSig,
      tileCount,
      byteEstimate,
      preview,
      cap: null,
      pulledCount: 0,
      state: "pending",
      observedAt: e.createdAt,
      body
    };
    this.state.shares.set(e.id, share);
    return [{ kind: "share-request-received", share }];
  }
  #share(e, c) {
    const requestId = this.#eTag(e);
    if (!requestId) return [];
    const existing = this.state.shares.get(requestId);
    if (!existing) return [];
    if (existing.state !== "pending") return [];
    if (e.pubkey !== this.state.hostPubkey && e.pubkey !== existing.requesterPubkey) return [];
    existing.state = "approved";
    existing.approvalId = e.id || null;
    const capObj = c["cap"];
    if (capObj && typeof capObj === "object") {
      const max = numberField(capObj, "maxDownloads") ?? numberField(capObj, "max");
      if (max !== null && max > 0) existing.cap = { max };
    }
    return [{ kind: "share-approved", share: existing }];
  }
  #shareRevoked(e) {
    const refId = this.#eTag(e);
    if (!refId) return [];
    const target = this.state.shares.get(refId);
    if (!target) return [];
    if (e.pubkey !== this.state.hostPubkey) return [];
    if (target.state === "revoked") return [];
    target.state = "revoked";
    return [{ kind: "share-revoked", share: target }];
  }
  #pulled(e) {
    const refId = this.#eTag(e);
    if (!refId || !e.pubkey) return [];
    const target = this.state.shares.get(refId);
    if (!target) return [];
    target.pulledCount += 1;
    return [{ kind: "share-pulled", share: target, bypubkey: e.pubkey }];
  }
  #layer(e, c) {
    const sig = this.#layerTag(e);
    if (!sig || !/^[0-9a-f]{64}$/.test(sig)) return [];
    if (this.state.layers.has(sig)) return [];
    const content = parsePairedLayerContent(c);
    if (!content) return [];
    this.state.layers.set(sig, content);
    return [{ kind: "layer-received", sig, content }];
  }
  /** Look up a buffered layer by sig. Returns null if not yet seen. */
  layer(sig) {
    return this.state.layers.get(sig) ?? null;
  }
  #auditApprove(e) {
    const layerSig = this.#layerTag(e);
    if (!layerSig || !e.pubkey) return [];
    let bag = this.state.audits.approvals.get(layerSig);
    if (!bag) {
      bag = /* @__PURE__ */ new Set();
      this.state.audits.approvals.set(layerSig, bag);
    }
    if (bag.has(e.pubkey)) return [];
    bag.add(e.pubkey);
    return [{ kind: "audit-approval", layerSig, auditor: e.pubkey }];
  }
  #auditReject(e, _c) {
    const layerSig = this.#layerTag(e);
    if (!layerSig || !e.pubkey) return [];
    let bag = this.state.audits.rejections.get(layerSig);
    if (!bag) {
      bag = /* @__PURE__ */ new Set();
      this.state.audits.rejections.set(layerSig, bag);
    }
    if (bag.has(e.pubkey)) return [];
    bag.add(e.pubkey);
    let danger = null;
    for (const t of e.tags) {
      if (t[0] === "danger") {
        danger = t[1] ?? null;
        break;
      }
    }
    return [{ kind: "audit-rejection", layerSig, auditor: e.pubkey, danger }];
  }
  // ── derived selectors ───────────────────────────────────────────────
  /** Pubkeys observed approving the layer. */
  approvalsFor(layerSig) {
    return this.state.audits.approvals.get(layerSig) ?? /* @__PURE__ */ new Set();
  }
  /** Pubkeys observed rejecting the layer. */
  rejectionsFor(layerSig) {
    return this.state.audits.rejections.get(layerSig) ?? /* @__PURE__ */ new Set();
  }
  /** True if the given pubkey is currently a member. */
  isMember(pubkey) {
    return this.state.members.has(pubkey);
  }
  /** Live shares (approved + pending). Revoked shares are excluded. */
  visibleShares() {
    return [...this.state.shares.values()].filter((s) => s.state !== "revoked");
  }
  // ── helpers ─────────────────────────────────────────────────────────
  #payload(e) {
    if (e.content && typeof e.content === "object" && !Array.isArray(e.content)) {
      return e.content;
    }
    return {};
  }
  /** First `e=...` tag value. */
  #eTag(e) {
    for (const t of e.tags) if (t[0] === "e" && t[1]) return t[1];
    return null;
  }
  /** First `p=...` tag value. */
  #pTag(e) {
    for (const t of e.tags) if (t[0] === "p" && t[1]) return t[1];
    return null;
  }
  /** First `layer=...` tag value. */
  #layerTag(e) {
    for (const t of e.tags) if (t[0] === "layer" && t[1]) return t[1];
    return null;
  }
};
function stringField(c, key) {
  const v = c[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}
function numberField(c, key) {
  const v = c[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function parsePairedLayerContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value;
  const rawName = obj["name"];
  const rawProperties = obj["properties"];
  const rawChildren = obj["children"];
  const name = typeof rawName === "string" ? rawName : null;
  if (!name) return null;
  const properties = rawProperties && typeof rawProperties === "object" && !Array.isArray(rawProperties) ? rawProperties : null;
  if (!properties) return null;
  const childrenRaw = Array.isArray(rawChildren) ? rawChildren : null;
  if (!childrenRaw) return null;
  const children = [];
  for (const c of childrenRaw) {
    if (!c || typeof c !== "object") return null;
    const r = c;
    const name2 = r["name"];
    const sig = r["sig"];
    if (typeof name2 !== "string" || !name2) return null;
    if (typeof sig !== "string" || !/^[0-9a-f]{64}$/.test(sig)) return null;
    children.push({ name: name2, sig });
  }
  children.sort((a, b) => a.name.localeCompare(b.name));
  return { name, properties, children };
}
function canonicaliseLayerContent(c) {
  const sorted = [...c.children].sort((a, b) => a.name.localeCompare(b.name));
  const canonical = {
    name: c.name,
    properties: c.properties,
    children: sorted.map((ch) => ({ name: ch.name, sig: ch.sig }))
  };
  return JSON.stringify(canonical);
}
async function computeLayerSig(content) {
  const json = canonicaliseLayerContent(content);
  const buf = new TextEncoder().encode(json).buffer;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// src/diamondcoreprocessor.com/presentation/tiles/sources/ephemeral-tile.source.ts
var PAIRED_CHANNEL_DRONE_KEY = "@diamondcoreprocessor.com/PairedChannelDrone";
function locationStringFromSegments(segments) {
  const cleaned = segments.map((s) => String(s ?? "").trim()).filter((s) => s.length > 0 && !(s.startsWith("__") && s.endsWith("__")));
  return "/" + cleaned.join("/");
}
var ephemeralTileSource = async (loc) => {
  const drone = window.ioc?.get?.(
    PAIRED_CHANNEL_DRONE_KEY
  );
  if (!drone?.ephemeralSharesAt) return [];
  const location = locationStringFromSegments(loc.segments);
  const rows = drone.ephemeralSharesAt(location) ?? [];
  return rows.map((r) => ({
    name: r.branchName,
    kind: "ephemeral",
    source: {
      channelId: r.channelId,
      layerSig: r.branchSig,
      branchSig: r.branchSig
    }
  }));
};

// src/diamondcoreprocessor.com/presentation/tiles/tile-source-registry.ts
var IOC_KEY = "@hypercomb.social/TileSourceRegistry";
var TileSourceRegistry = class {
  #sources = /* @__PURE__ */ new Set();
  /** Register a tile source. Returns an unregister callback. */
  register = (source) => {
    this.#sources.add(source);
    return () => {
      this.#sources.delete(source);
    };
  };
  /** Resolve all sources for the given location. The result is the
   *  union of every source's contributions, deduplicated by (kind, name).
   *  Errors in individual sources are caught and logged — they don't
   *  cause resolution to fail. */
  resolve = async (loc) => {
    if (this.#sources.size === 0) return [];
    const results = await Promise.allSettled(
      [...this.#sources].map((s) => s(loc))
    );
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const r of results) {
      if (r.status === "rejected") {
        console.warn("[tile-source-registry] source threw", r.reason);
        continue;
      }
      for (const entry of r.value) {
        const dedupKey = `${entry.kind}:${entry.name}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        out.push(entry);
      }
    }
    return out;
  };
  /** Convenience: just the names, in source-arrival order. For callers
   *  upgrading from `listCellFolders` semantics — accepts a final
   *  `precedence` filter to keep only one kind when both exist for the
   *  same name (e.g. `'opfs'` to hide ephemerals that have been
   *  adopted but haven't cleared from the cache yet). */
  resolveNames = async (loc, precedence) => {
    const entries = await this.resolve(loc);
    if (!precedence) return entries.map((e) => e.name);
    const byName = /* @__PURE__ */ new Map();
    for (const e of entries) {
      const existing = byName.get(e.name);
      if (!existing) {
        byName.set(e.name, e);
        continue;
      }
      if (existing.kind === precedence) continue;
      if (e.kind === precedence) byName.set(e.name, e);
    }
    return [...byName.values()].map((e) => e.name);
  };
  /** Find the entry for a given name + optional kind. Used by the
   *  layout service and renderer to recover the source ref. */
  findEntry = async (loc, name, kind) => {
    const entries = await this.resolve(loc);
    return entries.find((e) => e.name === name && (!kind || e.kind === kind)) ?? null;
  };
};
var _registry = new TileSourceRegistry();
window.ioc?.register?.(IOC_KEY, _registry);
var TILE_SOURCE_REGISTRY_KEY = IOC_KEY;

// src/diamondcoreprocessor.com/sharing/paired-channel.drone.ts
var ROOM_STORE_KEY = "@hypercomb.social/RoomStore";
var SECRET_STORE_KEY = "@hypercomb.social/SecretStore";
var LINEAGE_KEY = "@hypercomb.social/Lineage";
var PAIRED_CHANNEL_EFFECTS = {
  joined: "paired-channel:joined",
  left: "paired-channel:left",
  hostElected: "paired-channel:host-elected",
  joinRequestReceived: "paired-channel:join-request-received",
  memberAdmitted: "paired-channel:member-admitted",
  shareRequestReceived: "paired-channel:share-request-received",
  shareApproved: "paired-channel:share-approved",
  shareRevoked: "paired-channel:share-revoked",
  sharePulled: "paired-channel:share-pulled",
  layerReceived: "paired-channel:layer-received",
  auditApproval: "paired-channel:audit-approval",
  auditRejection: "paired-channel:audit-rejection"
};
var PairedChannelDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "sharing";
  description = "Orchestrator for paired-channel sync. One state machine per joined channel; ephemeral protocol state, only materialised layers reach history.";
  grammar = [{ example: "paired-channel join" }];
  effects = [];
  // The drone reads channel events directly via PairedChannelService.
  // `fs:changed` / `cell:added` / `cell:removed` are subscribed for
  // re-evaluation triggers (navigation, structural mutations) — these
  // are the only EffectBus signals the drone cares about.
  listens = ["fs:changed", "cell:added", "cell:removed"];
  constructor() {
    super();
    const tryRegisterEphemeralSource = (attempts) => {
      const registry = window.ioc?.get?.(
        TILE_SOURCE_REGISTRY_KEY
      );
      if (registry?.register) {
        registry.register(ephemeralTileSource);
        return;
      }
      if (attempts > 0) setTimeout(() => tryRegisterEphemeralSource(attempts - 1), 50);
    };
    tryRegisterEphemeralSource(40);
    const reEval = () => {
      void this.#reEvaluateChannel();
    };
    this.onEffect("fs:changed", reEval);
    this.onEffect("cell:removed", reEval);
    this.onEffect("cell:added", async (payload) => {
      if (payload?.source === "paired-channel") return;
      await this.#reEvaluateChannel();
      void this.#onLocalCellAdded(payload);
    });
    const tryWireLineage = (attempts) => {
      const lineage = window.ioc?.get?.(LINEAGE_KEY);
      if (lineage?.addEventListener) {
        lineage.addEventListener("change", reEval);
        return;
      }
      if (attempts > 0) setTimeout(() => tryWireLineage(attempts - 1), 100);
    };
    tryWireLineage(50);
    const tryInitialJoin = async (attempts) => {
      if (this.#channels.size > 0) return;
      await this.#reEvaluateChannel();
      if (this.#channels.size > 0) return;
      if (attempts > 0) setTimeout(() => {
        void tryInitialJoin(attempts - 1);
      }, 250);
    };
    void tryInitialJoin(40);
  }
  emits = Object.values(PAIRED_CHANNEL_EFFECTS);
  // ── state ─────────────────────────────────────────────────────────
  #channels = /* @__PURE__ */ new Map();
  /**
   * Bumped while materialiseFromSig is writing to OPFS. Reserved for
   * future use (e.g. a cell:added listener that re-broadcasts local
   * adds — needs this to suppress echo when the "add" came from the
   * sync write itself).
   */
  #materialiseInProgress = 0;
  // ── lifecycle ─────────────────────────────────────────────────────
  /**
   * Drone heartbeat — runs on every pulse. Reads the user's ACTUAL
   * secret (`SecretStore.value` = `hc:secret`) and the LIVE lineage
   * (`@hypercomb.social/Lineage`), then ensures we're subscribed to
   * the channel that matches the current navigation + secret.
   *
   * No invented localStorage keys, no static config — the drone
   * follows wherever you navigate.
   *
   * Guards:
   *  - NostrMeshDrone must be registered (load-order race on cold
   *    start; without this, subscribe returns a no-op and wedges the
   *    drone permanently).
   *  - SecretStore must have a value (no secret = no channel).
   *  - Lineage must expose `explorerSegments`.
   *
   * Navigation switching: if the live lineage's channelId differs
   * from what we're currently subscribed to, leave the old channel
   * and join the new one. One active channel = current bag.
   */
  heartbeat = async () => {
    await this.#reEvaluateChannel();
  };
  /**
   * Live re-broadcast on local cell:added.
   *
   * - Skip if the cell:added came from materialise itself (echo guard
   *   via `#materialiseInProgress`).
   * - Find any joined channel whose recorded location matches the
   *   cell's PARENT lineage. If none, do nothing — the cell was added
   *   somewhere we're not currently syncing.
   * - Fire `tile:action expose` for that cell. expose.drone walks the
   *   subtree, publishes layer events, publishes share-request. The
   *   sender's own #maybeAutoApprove (if host) elevates it to a share.
   *
   * Channels store `location` as the slash-joined segments string. We
   * compare normalised paths so the matcher works regardless of any
   * leading/trailing slashes.
   */
  async #onLocalCellAdded(payload) {
    if (this.#materialiseInProgress > 0) return;
    const cellName = payload?.cell;
    if (typeof cellName !== "string" || cellName.length === 0) return;
    let segments;
    if (Array.isArray(payload?.segments)) {
      segments = payload.segments;
    } else {
      const lineage = window.ioc.get(LINEAGE_KEY);
      segments = lineage?.explorerSegments?.() ?? [];
    }
    const targetSegs = segments.map((s) => String(s ?? "").trim()).filter(Boolean).join("/");
    let matched = false;
    for (const joined of this.#channels.values()) {
      const here = parseLocationSegments(joined.location).join("/");
      if (here === targetSegs) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      console.log("[sync] cell:added: no channel matches parent", { cell: cellName, parent: "/" + targetSegs, joinedChannels: [...this.#channels.values()].map((j) => j.location) });
      return;
    }
    console.log("[sync] cell:added \u2192 expose", { cell: cellName, parent: "/" + targetSegs });
    EffectBus2.emit("tile:action", { action: "expose", label: cellName, q: 0, r: 0, index: 0 });
  }
  /**
   * Compute the current desired channelId from live state, then join /
   * leave so the drone is always subscribed to exactly the channel
   * matching the user's current navigation + secret. Re-entrant safe
   * (joinLineage is idempotent on dedup).
   */
  async #reEvaluateChannel() {
    const mesh = window.ioc.get("@diamondcoreprocessor.com/NostrMeshDrone");
    if (!mesh) return;
    if (typeof mesh.isNetworkEnabled === "function" && !mesh.isNetworkEnabled()) {
      if (this.#channels.size > 0) {
        console.log("[sync] heartbeat: mesh private, leaving all channels");
        for (const cid of [...this.#channels.keys()]) this.leave(cid);
      }
      return;
    }
    const secretStore = window.ioc.get(SECRET_STORE_KEY);
    const secret = String(secretStore?.value ?? "").trim();
    if (!secret) {
      if (this.#channels.size > 0) {
        console.log("[sync] heartbeat: secret cleared, leaving all channels");
        for (const cid of [...this.#channels.keys()]) this.leave(cid);
      }
      return;
    }
    const roomStore = window.ioc.get(ROOM_STORE_KEY);
    const room = String(roomStore?.value ?? "").trim();
    const lineage = window.ioc.get(LINEAGE_KEY);
    if (!lineage?.explorerSegments) return;
    let desiredChannelId;
    try {
      desiredChannelId = await channelIdForLineage(lineage, room, secret);
    } catch (err) {
      console.warn("[sync] channel derivation failed", err);
      return;
    }
    if (this.#channels.has(desiredChannelId)) return;
    const segments = lineage.explorerSegments?.() ?? [];
    console.log("[sync] heartbeat: joining channel", {
      channelId: desiredChannelId.slice(0, 12),
      room,
      lineage: "/" + segments.join("/"),
      secretSet: !!secret
    });
    for (const oldChannelId of [...this.#channels.keys()]) {
      if (oldChannelId !== desiredChannelId) {
        console.log("[sync] heartbeat: leaving stale channel", oldChannelId.slice(0, 12));
        this.leave(oldChannelId);
      }
    }
    await this.joinLineage(lineage, room, secret);
    void this.#broadcastExistingCellsAt(lineage);
  }
  /**
   * Walk the lineage's OPFS dir and fire `tile:action expose` for each
   * non-transient real cell. Runs once after a successful join, so
   * peers receive the existing tile tree as transient previews.
   *
   * Skips `__system__` directories and any cell whose 0000 has
   * `transient: true` (echo guard — those cells came in via sync and
   * the original publisher is responsible for keeping them alive).
   */
  async #broadcastExistingCellsAt(lineage) {
    const dir = await lineage?.explorerDir?.();
    if (!dir) return;
    const { readCellProperties: readCellProperties2 } = await Promise.resolve().then(() => (init_tile_properties(), tile_properties_exports));
    let exposed = 0;
    try {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== "directory") continue;
        if (name.startsWith("__") && name.endsWith("__")) continue;
        try {
          const childDir = handle;
          const props = await readCellProperties2(childDir).catch(() => ({}));
          if (props["transient"] === true) continue;
          EffectBus2.emit("tile:action", { action: "expose", label: name, q: 0, r: 0, index: 0 });
          exposed++;
        } catch {
        }
      }
    } catch (err) {
      console.warn("[sync] broadcast-existing failed", err);
      return;
    }
    if (exposed > 0) {
      console.log("[sync] broadcast-existing: exposed", exposed, "cell(s)");
    }
  }
  /**
   * Walk the current bag's OPFS dir and delete any cell whose 0000
   * has `transient: true`. Called before joining a channel — clears
   * stale ephemeral state from the previous session. The sender's
   * still-active share events will re-install via materialiseFromSig.
   *
   * Best-effort: failures don't abort the join.
   */
  async #sweepTransientCellsAt(lineage) {
    const dir = await lineage?.explorerDir?.();
    if (!dir) return;
    const { readCellProperties: readCellProperties2 } = await Promise.resolve().then(() => (init_tile_properties(), tile_properties_exports));
    let swept = 0;
    try {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== "directory") continue;
        if (name.startsWith("__") && name.endsWith("__")) continue;
        try {
          const childDir = handle;
          const props = await readCellProperties2(childDir).catch(() => ({}));
          if (props["transient"] === true) {
            await dir.removeEntry(name, { recursive: true });
            swept++;
          }
        } catch {
        }
      }
    } catch (err) {
      console.warn("[sync] transient sweep failed", err);
      return;
    }
    if (swept > 0) {
      console.log("[sync] transient sweep: removed", swept, "unimported cell(s)");
      EffectBus2.emit("fs:changed", { source: "paired-channel:transient-sweep" });
    }
  }
  /**
   * Join a channel by `(location, secret)`. The location is a path
   * string like `/howard/team` — parsed into segments, then signed
   * via HistoryService.sign (or the equivalent fallback) and combined
   * with the secret to produce the channelId.
   *
   * Idempotent: re-joining the same pair is a no-op. Returns the
   * channelId on success, null on failure.
   */
  async join(location, secret, room = "") {
    const lineage = {
      explorerSegments: () => parseLocationSegments(location)
    };
    let channelId;
    try {
      channelId = await channelIdForLineage(lineage, room, secret);
    } catch (err) {
      console.warn("[paired-channel] join: derivation failed", err);
      return null;
    }
    if (this.#channels.has(channelId)) return channelId;
    const service = this.#service();
    if (!service) {
      console.warn("[paired-channel] join: PairedChannelService not available");
      return null;
    }
    if (!window.ioc.get("@diamondcoreprocessor.com/NostrMeshDrone")) {
      console.warn("[paired-channel] join: NostrMeshDrone not registered yet, will retry");
      return null;
    }
    const machine = new PairedChannelMachine(channelId);
    const subscription = service.subscribe(channelId, (event) => {
      this.#onChannelEvent(channelId, event);
    });
    const joined = { channelId, location, secret, machine, subscription };
    this.#channels.set(channelId, joined);
    EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.joined, { channelId, location });
    void this.#announceIfNeeded(channelId);
    return channelId;
  }
  /**
   * Join a channel using a fully-formed Lineage object (typically
   * `@hypercomb.social/Lineage`). Use this in code paths that already
   * hold the live lineage so the channelId aligns exactly with the
   * lineage's canonical signature.
   */
  async joinLineage(lineage, room, secret) {
    let channelId;
    try {
      channelId = await channelIdForLineage(lineage, room, secret);
    } catch (err) {
      console.warn("[sync] joinLineage: derivation failed", err);
      return null;
    }
    if (this.#channels.has(channelId)) return channelId;
    const service = this.#service();
    if (!service) return null;
    const machine = new PairedChannelMachine(channelId);
    const subscription = service.subscribe(channelId, (event) => this.#onChannelEvent(channelId, event));
    const segments = lineage.explorerSegments?.() ?? [];
    const location = "/" + segments.join("/");
    this.#channels.set(channelId, { channelId, location, secret, machine, subscription });
    console.log("[sync] joined channel", { channelId: channelId.slice(0, 12), location, room });
    EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.joined, { channelId, location, room });
    void this.#announceIfNeeded(channelId);
    return channelId;
  }
  /**
   * Publish a `type=announce` event after a short delay if no host
   * has been observed yet. The delay lets late-arriving announces
   * from existing peers be processed first — if someone else already
   * claimed the host slot, we don't fight them for it.
   */
  async #announceIfNeeded(channelId) {
    await new Promise((r) => setTimeout(r, 300));
    const machine = this.#channels.get(channelId)?.machine;
    if (!machine) return;
    if (machine.state.hostPubkey) return;
    const service = this.#service();
    if (!service) return;
    await service.publish(channelId, "announce", { auditPolicy: { threshold: 1, trustedSet: [] } });
  }
  /** Leave a channel. Closes the subscription and drops in-memory state. */
  leave(channelId) {
    const joined = this.#channels.get(channelId);
    if (!joined) return;
    try {
      joined.subscription.close();
    } catch {
    }
    this.#channels.delete(channelId);
    EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.left, { channelId });
  }
  /** All currently-joined channelIds. */
  joinedChannels() {
    return [...this.#channels.keys()];
  }
  /** Read-only view of a joined channel's machine state. */
  stateOf(channelId) {
    return this.#channels.get(channelId)?.machine ?? null;
  }
  /**
   * Ephemeral shares at a given lineage location, deduplicated by
   * branchName. Returned values include the branchSig so consumers
   * can later call `materialiseFromSig` to commit.
   *
   * Used by show-cell to render preview tiles at the receiver's
   * current bag without touching OPFS. Adopt is the only path that
   * commits — after that the cell lands in OPFS and renders
   * normally, and the ephemeral entry should be cleared via
   * `clearEphemeral`.
   */
  ephemeralSharesAt(location) {
    const target = parseLocationSegments(location).join("/");
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const entry of this.#ephemeralShares) {
      if (entry.location !== target) continue;
      if (seen.has(entry.branchName)) continue;
      seen.add(entry.branchName);
      out.push({ branchName: entry.branchName, branchSig: entry.branchSig, channelId: entry.channelId, approvalId: entry.approvalId });
    }
    return out;
  }
  /** Record an ephemeral share (called when materialiseFacade fires). */
  recordEphemeralShare(payload) {
    const normalised = parseLocationSegments(payload.location).join("/");
    const exists = this.#ephemeralShares.find(
      (e) => e.channelId === payload.channelId && e.branchName === payload.branchName
    );
    if (exists) return;
    this.#ephemeralShares.push({
      channelId: payload.channelId,
      location: normalised,
      branchName: payload.branchName,
      branchSig: payload.branchSig,
      approvalId: payload.approvalId
    });
  }
  /** Clear an ephemeral share once it's committed to OPFS via adopt. */
  clearEphemeralShare(branchName) {
    this.#ephemeralShares = this.#ephemeralShares.filter((e) => e.branchName !== branchName);
  }
  /** Internal storage. One entry per (channel, branchName) pair. */
  #ephemeralShares = [];
  /**
   * Import — flip `transient: true` off on a cell + every descendant.
   * After import the cell survives reload (the boot sweep no longer
   * sees it). Idempotent: importing a non-transient cell is a no-op.
   */
  async importTransientTree(cellName) {
    const lineage = window.ioc.get(LINEAGE_KEY);
    const dir = await lineage?.explorerDir?.();
    if (!dir) return { cleared: 0 };
    const { readCellProperties: readCellProperties2, writeCellProperties: writeCellProperties2 } = await Promise.resolve().then(() => (init_tile_properties(), tile_properties_exports));
    let cleared = 0;
    const walk = async (current, name) => {
      try {
        const props = await readCellProperties2(current).catch(() => ({}));
        if (props["transient"] === true) {
          await writeCellProperties2(current, { transient: false });
          cleared++;
        }
        for await (const [childName, handle] of current.entries()) {
          if (handle.kind !== "directory") continue;
          if (childName.startsWith("__") && childName.endsWith("__")) continue;
          await walk(handle, childName);
        }
      } catch {
      }
    };
    try {
      const cellDir = await dir.getDirectoryHandle(cellName, { create: false });
      await walk(cellDir, cellName);
    } catch {
    }
    if (cleared > 0) {
      EffectBus2.emit("paired-channel:imported", { cellName, cleared });
    }
    return { cleared };
  }
  // ── public API for callers (expose drone, accept toast, etc.) ─────
  /**
   * Publish a `share-request` for the given branch on a joined channel.
   * The host's machine sees it, decides per its rules, and (in v0)
   * auto-publishes a `share` event. Other participants see the
   * approved share and can pull.
   *
   * `body` is the inline payload for v0 (a tile's properties + name).
   * Real subtree sharing uses separate `layer` events keyed by sig;
   * this drone delegates that lookup to the consumer.
   */
  async requestShare(channelId, payload) {
    const service = this.#service();
    if (!service) return false;
    const tags = [["layer", payload.branchSig]];
    return service.publish(channelId, "share-request", payload, tags);
  }
  /**
   * Approve a pending share-request as the host. Caller looks up the
   * `requestId` from `stateOf(channelId).visibleShares()` and (optionally)
   * sets a `cap.maxDownloads`. Publishes the `share` event the
   * participants are waiting for.
   */
  async approveShare(channelId, requestId, cap = null) {
    const machine = this.#channels.get(channelId)?.machine;
    if (!machine) return false;
    const share = machine.state.shares.get(requestId);
    if (!share || share.state !== "pending") return false;
    const service = this.#service();
    if (!service) return false;
    const payload = {};
    if (cap !== null && cap > 0) payload["cap"] = { maxDownloads: cap };
    return service.publish(
      channelId,
      "share",
      payload,
      [["e", requestId], ["layer", share.branchSig], ["p", share.requesterPubkey]]
    );
  }
  /**
   * Mark an approved share as pulled. Publishes the `pulled` event
   * for the host's cap counter. Callers materialise the actual content
   * separately — usually by reading the inline `body` from the
   * matching ShareState, or fetching `layer` events keyed by branchSig.
   */
  async markPulled(channelId, approvalId) {
    const service = this.#service();
    if (!service) return false;
    return service.publish(channelId, "pulled", {}, [["e", approvalId]]);
  }
  /**
   * Self-attestation: each peer auto-approves its OWN share-requests
   * by publishing a matching `share` event signed by the same key.
   * The state machine accepts requester-signed shares (in addition to
   * host-signed ones), so every peer can promote its own offers to
   * "approved" with no host bottleneck.
   *
   * Trust boundary: the channelId (sha256 of lineage + secret) IS the
   * access filter. Anyone in the channel proved knowledge of the
   * shared password, so the bag itself is the gate. Host approval
   * remains available for future "I want to share but ask permission
   * first" flows; it isn't required for symmetric sync.
   */
  async #maybeAutoApprove(channelId, share) {
    const myPubkey = await this.#myPubkey();
    if (!myPubkey) return;
    if (share.requesterPubkey !== myPubkey) return;
    void this.approveShare(channelId, share.requestId, null);
  }
  async #myPubkey() {
    if (this.#cachedMyPubkey) return this.#cachedMyPubkey;
    const signer = window.ioc.get("@diamondcoreprocessor.com/NostrSigner");
    if (!signer?.getPublicKeyHex) return null;
    const pk = await signer.getPublicKeyHex();
    if (pk) this.#cachedMyPubkey = pk;
    return pk;
  }
  #cachedMyPubkey = null;
  /**
   * Publish one cell's canonical layer content. Caller pre-computed
   * `sig` via `computeLayerSig(content)`; this method just sends it.
   * Idempotent on the relay side (event id uniqueness), so re-publishes
   * are safe.
   */
  async publishLayer(channelId, sig, content) {
    const service = this.#service();
    if (!service) return false;
    const json = canonicaliseLayerContent(content);
    return service.publish(channelId, "layer", JSON.parse(json), [["layer", sig]]);
  }
  /** Look up a buffered layer by sig (returns null if not yet seen). */
  layerOf(channelId, sig) {
    return this.#channels.get(channelId)?.machine.layer(sig) ?? null;
  }
  /**
   * Walk a share's branchSig recursively from the layer buffer and
   * materialise each layer at the matching path under `parentDir`.
   * Returns `{ written, missing }` so the caller can decide whether
   * to surface "incomplete" or wait for more `layer` events.
   *
   * Cell content lands in 0000 (via writeCellProperties); folder names
   * come from the layer's `name` field. Cycles are guarded by a
   * visited-set keyed by sig.
   *
   * Two modes:
   *   `mode: 'create'` (default — `sync` semantics)
   *     - Cell didn't exist  → create, write 0000, emit cell:added
   *     - Cell already exists → overwrite 0000 with incoming properties
   *
   *   `mode: 'merge'` (— `merge` semantics)
   *     - Cell didn't exist  → create, write 0000, emit cell:added
   *     - Cell already exists → shallow-merge: existing ← incoming,
   *                             incoming wins on key conflicts.
   *                             Children are unioned via recursion
   *                             (no destructive overwrite of locals
   *                             that aren't in the incoming set).
   *
   * In both modes, brand-new cells emit `cell:added` so the receiver's
   * HistoryRecorder logs the addition. Existing-and-merged cells emit
   * no add (they were already present).
   */
  async materialiseFromSig(channelId, sig, parentDir, opts = {}) {
    const maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY;
    const approvalId = opts.approvalId ?? null;
    const transient = opts.transient === true;
    const machine = this.#channels.get(channelId)?.machine;
    if (!machine) return { written: 0, missing: [sig], skipped: 0 };
    const visited = /* @__PURE__ */ new Set();
    const missing = [];
    let written = 0;
    let skipped = 0;
    const initialSegments = opts.parentSegments ?? [];
    const walk = async (s, dir, parentSegments, depth) => {
      if (visited.has(s)) return;
      visited.add(s);
      const content = machine.layer(s);
      if (!content) {
        missing.push(s);
        return;
      }
      let existed = true;
      try {
        await dir.getDirectoryHandle(content.name, { create: false });
      } catch {
        existed = false;
      }
      let cellDir;
      try {
        cellDir = await dir.getDirectoryHandle(content.name, { create: true });
      } catch (err) {
        console.warn("[paired-channel] materialise: getDirectoryHandle failed", content.name, err);
        return;
      }
      let isFacade = false;
      if (existed) {
        const { readCellProperties: readCellProperties2 } = await Promise.resolve().then(() => (init_tile_properties(), tile_properties_exports));
        const existingProps = await readCellProperties2(cellDir).catch(() => ({}));
        isFacade = existingProps["facade"] === true;
      }
      const willRecurse = depth + 1 < maxDepth;
      if (existed && !isFacade) {
        skipped++;
      } else {
        const propsToWrite = { ...content.properties };
        for (const k of ["children", "facade", "branchSig", "channelId", "approvalId"]) {
          delete propsToWrite[k];
        }
        if (!willRecurse && content.children.length > 0) {
          propsToWrite["facade"] = true;
          propsToWrite["branchSig"] = s;
          propsToWrite["channelId"] = channelId;
          if (approvalId) propsToWrite["approvalId"] = approvalId;
        } else if (isFacade) {
          propsToWrite["facade"] = false;
          propsToWrite["branchSig"] = void 0;
          propsToWrite["channelId"] = void 0;
          propsToWrite["approvalId"] = void 0;
        }
        if (transient) {
          propsToWrite["transient"] = true;
        }
        try {
          await this.#writeProperties(cellDir, propsToWrite);
        } catch (err) {
          console.warn("[paired-channel] materialise: write 0000 failed", content.name, err);
        }
        written++;
        if (!existed) {
          EffectBus2.emit("cell:added", { cell: content.name, segments: [...parentSegments], source: "paired-channel" });
        }
      }
      if (!willRecurse) return;
      const childSegments = [...parentSegments, content.name];
      for (const child of content.children) {
        await walk(child.sig, cellDir, childSegments, depth + 1);
      }
    };
    this.#materialiseInProgress++;
    try {
      await walk(sig, parentDir, initialSegments, 0);
    } finally {
      this.#materialiseInProgress--;
    }
    return { written, missing, skipped };
  }
  // Lazy-imported to avoid a hard dependency cycle from the drone into
  // the editor module — and so this drone can be used from a node test
  // harness without an editor present.
  async #writeProperties(cellDir, properties) {
    const { writeCellProperties: writeCellProperties2 } = await Promise.resolve().then(() => (init_tile_properties(), tile_properties_exports));
    await writeCellProperties2(cellDir, properties);
  }
  // ── internal: event routing & rules ───────────────────────────────
  #onChannelEvent(channelId, event) {
    const joined = this.#channels.get(channelId);
    if (!joined) return;
    const transitions = joined.machine.apply(event);
    console.log("[sync] event in", {
      channel: channelId.slice(0, 12),
      verb: event.type,
      from: String(event.pubkey ?? "").slice(0, 8),
      transitions: transitions.map((t) => t.kind)
    });
    for (const t of transitions) this.#onTransition(channelId, t);
  }
  #onTransition(channelId, t) {
    console.log("[sync] transition", { channel: channelId.slice(0, 12), kind: t.kind });
    switch (t.kind) {
      case "host-elected":
        EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.hostElected, { channelId, pubkey: t.pubkey });
        break;
      case "join-request-received":
        EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.joinRequestReceived, { channelId, id: t.id, pubkey: t.pubkey });
        break;
      case "member-admitted":
        EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.memberAdmitted, { channelId, pubkey: t.pubkey });
        break;
      case "member-revoked":
        break;
      case "share-request-received":
        EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.shareRequestReceived, { channelId, share: t.share });
        void this.#maybeAutoApprove(channelId, t.share);
        break;
      case "share-approved":
        EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.shareApproved, { channelId, share: t.share });
        break;
      case "share-revoked":
        EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.shareRevoked, { channelId, share: t.share });
        break;
      case "share-pulled":
        EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.sharePulled, { channelId, share: t.share, by: t.bypubkey });
        break;
      case "layer-received":
        EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.layerReceived, { channelId, sig: t.sig, content: t.content });
        break;
      case "audit-approval":
        EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.auditApproval, { channelId, layerSig: t.layerSig, auditor: t.auditor });
        break;
      case "audit-rejection":
        EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.auditRejection, { channelId, layerSig: t.layerSig, auditor: t.auditor, danger: t.danger });
        break;
      case "unknown-verb":
        break;
    }
  }
  #service() {
    const svc = window.ioc.get(
      "@diamondcoreprocessor.com/PairedChannelService"
    );
    return svc ?? null;
  }
};
function parseLocationSegments(location) {
  return String(location ?? "").split("/").map((s) => s.trim()).filter((s) => s.length > 0);
}
var IOC_KEY2 = "@diamondcoreprocessor.com/PairedChannelDrone";
if (!window.ioc.get(IOC_KEY2)) {
  const _pairedChannelDrone = new PairedChannelDrone();
  window.ioc.register(IOC_KEY2, _pairedChannelDrone);
}

// src/diamondcoreprocessor.com/sharing/expose.drone.ts
var TILE_ACTION_EXPOSE = "expose";
var TILE_ACTION_SYNC = "sync";
var TILE_ACTION_MERGE = "merge";
var SHARE_APPROVE_EFFECT = "paired-channel:approve-share";
var SHARE_REJECT_EFFECT = "paired-channel:reject-share";
var EGG_UNLOCK_EFFECT = "egg:unlock-selected";
var ExposeDrone = class extends Drone2 {
  namespace = "diamondcoreprocessor.com";
  genotype = "sharing";
  description = "Tile-level UI for paired-channel sharing. Adds an expose icon to local tiles; surfaces sync prompts when another participant exposes content.";
  grammar = [{ example: "expose tile" }];
  listens = [
    "tile:action",
    PAIRED_CHANNEL_EFFECTS.shareRequestReceived,
    PAIRED_CHANNEL_EFFECTS.shareApproved,
    PAIRED_CHANNEL_EFFECTS.layerReceived,
    EGG_UNLOCK_EFFECT,
    SHARE_APPROVE_EFFECT,
    SHARE_REJECT_EFFECT,
    "paired-channel:adopt-request"
  ];
  emits = ["toast:show"];
  // ── lifecycle ─────────────────────────────────────────────────────
  constructor() {
    super();
    this.#registerIcon();
    this.onEffect("tile:action", (payload) => {
      if (!payload?.action) return;
      if (payload.action === TILE_ACTION_EXPOSE) {
        void this.#onExpose(payload.label);
        return;
      }
      if (payload.action === TILE_ACTION_SYNC) {
        void this.#onUnlockTile(payload.label, "create");
        return;
      }
      if (payload.action === TILE_ACTION_MERGE) {
        void this.#onUnlockTile(payload.label, "merge");
        return;
      }
    });
    this.onEffect(EGG_UNLOCK_EFFECT, (payload) => {
      const labels = Array.isArray(payload?.labels) ? payload.labels : [];
      for (const label of labels) {
        if (typeof label === "string" && label) void this.#onUnlockTile(label);
      }
    });
    this.onEffect(
      PAIRED_CHANNEL_EFFECTS.shareApproved,
      (payload) => {
        if (!payload?.share) return;
        void this.#materialiseFacade(payload.channelId, payload.share);
      }
    );
    this.onEffect(SHARE_APPROVE_EFFECT, (payload) => {
      if (!payload?.requestId) return;
      void this.#approveShare(payload.channelId, payload.requestId);
    });
    this.onEffect(SHARE_REJECT_EFFECT, (_payload) => {
    });
    this.onEffect("paired-channel:adopt-request", (payload) => {
      console.log("[sync] expose: adopt-request received", payload);
      const name = payload?.branchName;
      if (typeof name !== "string" || !name) return;
      void this.#adoptEphemeral(name);
    });
    this.onEffect("paired-channel:import-request", async (payload) => {
      const name = payload?.branchName;
      if (typeof name !== "string" || !name) return;
      const drone = this.#pairedChannelDrone();
      if (!drone?.importTransientTree) {
        this.#toast("warning", "Import failed", "PairedChannelDrone unavailable.");
        return;
      }
      const result = await drone.importTransientTree(name);
      if (result.cleared === 0) {
        this.#toast("tip", "Nothing to import", `"${name}" is already permanent.`);
      } else {
        this.#toast(
          "success",
          "Imported",
          `"${name}" (${result.cleared} cell${result.cleared === 1 ? "" : "s"}) is now permanent.`
        );
      }
    });
  }
  async #adoptEphemeral(branchName) {
    console.log("[sync] adopt: start", { branchName });
    const drone = this.#pairedChannelDrone();
    if (!drone) {
      console.warn("[sync] adopt: PairedChannelDrone unavailable");
      this.#toast("warning", "Adopt failed", "PairedChannelDrone unavailable.");
      return;
    }
    const lineage = window.ioc.get("@hypercomb.social/Lineage");
    const dir = await lineage?.explorerDir?.();
    if (!dir) {
      console.warn("[sync] adopt: no explorer dir");
      this.#toast("warning", "Adopt failed", "No explorer directory.");
      return;
    }
    const segments = lineage?.explorerSegments?.() ?? [];
    const here = "/" + segments.join("/");
    const candidates = drone.ephemeralSharesAt?.(here) ?? [];
    console.log("[sync] adopt: ephemeral candidates at", here, ":", candidates.map((c) => c.branchName));
    const match = candidates.find((e) => e.branchName === branchName);
    if (!match) {
      console.warn("[sync] adopt: no ephemeral share found for", branchName);
      this.#toast("warning", "Adopt failed", `No ephemeral share found for "${branchName}".`);
      return;
    }
    if (!drone.layerOf?.(match.channelId, match.branchSig)) {
      console.warn("[sync] adopt: root layer not buffered", match.branchSig);
      this.#toast(
        "warning",
        "Adopt failed",
        `Root layer ${match.branchSig.slice(0, 8)} hasn't arrived yet \u2014 try again in a moment.`
      );
      return;
    }
    console.log("[sync] adopt: materialising", { channelId: match.channelId.slice(0, 12), branchSig: match.branchSig.slice(0, 12) });
    let result;
    try {
      result = await drone.materialiseFromSig(match.channelId, match.branchSig, dir, {
        maxDepth: Number.POSITIVE_INFINITY,
        parentSegments: segments,
        approvalId: match.approvalId
      });
    } catch (err) {
      this.#toast("warning", "Adopt failed", String(err?.message ?? err));
      return;
    }
    drone.clearEphemeralShare?.(branchName);
    EffectBus3.emit("paired-channel:share-installed", { branchName, location: here });
    if (result.missing.length > 0) {
      this.#toast(
        "tip",
        "Adopted (partial)",
        `Wrote ${result.written} layer(s). ${result.missing.length} sig(s) still missing.`
      );
    } else {
      this.#toast(
        "success",
        "Adopted",
        `"${branchName}" + ${Math.max(0, result.written - 1)} descendant(s) are now yours.`
      );
    }
    if (match.approvalId) void drone.markPulled?.(match.channelId, match.approvalId);
  }
  // No per-pulse work; all behavior is event-driven.
  heartbeat = async () => {
  };
  // ── expose path ────────────────────────────────────────────────────
  #registerIcon() {
    void this.#firstJoinedChannel;
  }
  async #onExpose(tileLabel) {
    const channel = this.#firstJoinedChannel();
    if (!channel) {
      console.warn("[sync] expose blocked: no joined channel for", tileLabel);
      this.#toast(
        "warning",
        "No paired channel",
        "Set hypercomb.paired-channel.location and hypercomb.paired-channel.secret in localStorage, then reload."
      );
      return;
    }
    console.log("[sync] expose start", { tile: tileLabel, channel: channel.slice(0, 12) });
    const lineage = window.ioc.get("@hypercomb.social/Lineage");
    const dir = await lineage?.explorerDir?.();
    if (!dir) {
      this.#toast("warning", "Expose failed", "No explorer directory for the current lineage.");
      return;
    }
    let cellDir;
    try {
      cellDir = await dir.getDirectoryHandle(tileLabel, { create: false });
    } catch {
      this.#toast("warning", "Expose failed", `Tile "${tileLabel}" was not found in the current location.`);
      return;
    }
    const drone = this.#pairedChannelDrone();
    if (!drone) {
      this.#toast("warning", "Expose failed", "PairedChannelDrone is not available.");
      return;
    }
    let layers;
    try {
      layers = await buildSubtreeLayers(cellDir, tileLabel);
    } catch (err) {
      this.#toast("warning", "Expose failed", `Subtree walk threw: ${err?.message ?? err}`);
      return;
    }
    if (layers.length === 0) {
      this.#toast("warning", "Expose failed", "No layers produced from the subtree.");
      return;
    }
    let pushed = 0;
    for (const { sig, content } of layers) {
      const ok2 = await drone.publishLayer(channel, sig, content);
      if (ok2) pushed++;
    }
    console.log("[sync] published layers", { tile: tileLabel, pushed, total: layers.length });
    if (pushed === 0) {
      this.#toast(
        "warning",
        "Expose failed",
        "No layer events were published \u2014 mesh signer or relay unavailable."
      );
      return;
    }
    const root = layers[0];
    const byteEstimate = layers.reduce(
      (n, l) => n + approxJsonByteLength(l.content),
      0
    );
    const preview = {
      name: root.content.name,
      children: root.content.children.map((c) => ({ name: c.name }))
    };
    const ok = await drone.requestShare(channel, {
      branchSig: root.sig,
      branchName: root.content.name,
      tileCount: layers.length,
      byteEstimate,
      preview,
      body: null
      // bytes flow via separate `layer` events now
    });
    console.log("[sync] requestShare", { tile: tileLabel, branchSig: root.sig.slice(0, 12), ok });
    if (!ok) {
      this.#toast(
        "warning",
        "Expose failed",
        `Couldn't publish share-request \u2014 mesh signer or relay unavailable.`
      );
    }
  }
  // ── host approval path ─────────────────────────────────────────────
  #offerApproval(channelId, share) {
    const summary = share.byteEstimate ? `${share.tileCount ?? 1} tile \xB7 ~${formatBytes(share.byteEstimate)}` : `${share.tileCount ?? 1} tile`;
    EffectBus3.emit("toast:show", {
      type: "tip",
      title: `Share request: ${share.branchName}`,
      message: `${summary}. Click Approve to host this share for the channel.`,
      duration: 0,
      // sticky
      actionLabel: "Approve",
      actionEffect: SHARE_APPROVE_EFFECT,
      actionPayload: { channelId, requestId: share.requestId }
    });
  }
  async #approveShare(channelId, requestId) {
    const drone = this.#pairedChannelDrone();
    if (!drone) {
      this.#toast("warning", "Approval failed", "PairedChannelDrone is not available.");
      return;
    }
    const ok = await drone.approveShare(channelId, requestId, null);
    if (!ok) {
      this.#toast(
        "warning",
        "Approval failed",
        `Couldn't publish share event \u2014 either the request already expired, your client isn't the host, or the relay is unavailable.`
      );
    }
  }
  // ── receive path ───────────────────────────────────────────────────
  /**
   * Auto-create a facade tile for an approved share at the receiver's
   * current location. The folder + 0000 land immediately so the user
   * sees a visible tile (an "egg") with empty children. Selecting the
   * tile and clicking "Unlock" in the vertical menu fires the
   * `egg:unlock-selected` effect, which routes to #onUnlockTile and
   * fills in the full subtree from the buffered layer events.
   *
   * Skips if a tile with the same name already exists at this location
   * (the source side: host's auto-approval echoes back to itself, but
   * we don't need to overwrite the source tile).
   *
   * The facade write goes through writeCellProperties, so FacadeNurse +
   * IndexNurse pick up the change automatically.
   */
  async #materialiseFacade(channelId, share) {
    const lineage = window.ioc.get("@hypercomb.social/Lineage");
    const dir = await lineage?.explorerDir?.();
    if (!dir) {
      console.warn("[sync] share: no explorer dir", { tile: share.branchName });
      return;
    }
    const segments = lineage?.explorerSegments?.() ?? [];
    const targetName = share.branchName;
    if (!targetName) return;
    try {
      await dir.getDirectoryHandle(targetName, { create: false });
      return;
    } catch {
    }
    const drone = this.#pairedChannelDrone();
    if (!drone) {
      console.warn("[sync] share: PairedChannelDrone unavailable");
      return;
    }
    if (!drone.layerOf(channelId, share.branchSig)) {
      console.warn("[sync] share: root layer not buffered yet", share.branchSig);
      return;
    }
    const location = "/" + segments.join("/");
    drone.recordEphemeralShare({
      channelId,
      location,
      branchName: targetName,
      branchSig: share.branchSig,
      approvalId: share.approvalId
    });
    console.log("[sync] share: ephemeral preview", { tile: targetName, location, branchSig: share.branchSig.slice(0, 12) });
    if (share.approvalId) void drone.markPulled(channelId, share.approvalId);
    EffectBus3.emit("paired-channel:preview-changed", { channelId, location, branchName: targetName });
  }
  /**
   * Unlock handler for one tile. Reads the tile's facade metadata
   * from 0000, calls drone.materialiseFromSig to recursively fill the
   * subtree, then drops `facade: true` from 0000 so the tile becomes
   * a normal cell.
   *
   * No-op if the tile isn't a facade. EggMenuPack surfaces the
   * unlock button for any selection, so plain tiles can also have
   * the unlock invoked — they fall through silently here rather
   * than misbehaving.
   */
  async #onUnlockTile(tileLabel, _mode = "create") {
    const lineage = window.ioc.get("@hypercomb.social/Lineage");
    const dir = await lineage?.explorerDir?.();
    if (!dir) {
      this.#toast("warning", "Sync failed", "No explorer directory.");
      return;
    }
    let cellDir;
    try {
      cellDir = await dir.getDirectoryHandle(tileLabel, { create: false });
    } catch {
      this.#toast("warning", "Sync failed", `Tile "${tileLabel}" not found.`);
      return;
    }
    const props = await readCellProperties(cellDir);
    if (props["facade"] !== true) {
      return;
    }
    const channelId = typeof props["channelId"] === "string" ? props["channelId"] : "";
    const branchSig = typeof props["branchSig"] === "string" ? props["branchSig"] : "";
    if (!channelId || !branchSig) {
      this.#toast("warning", "Sync failed", "Facade metadata is incomplete.");
      return;
    }
    const drone = this.#pairedChannelDrone();
    if (!drone) {
      this.#toast("warning", "Sync failed", "PairedChannelDrone is not available.");
      return;
    }
    if (!drone.layerOf(channelId, branchSig)) {
      this.#toast(
        "warning",
        "Sync failed",
        `Root layer ${branchSig.slice(0, 8)} hasn't arrived yet. Wait a moment and try again.`
      );
      return;
    }
    const parentSegments = lineage?.explorerSegments?.() ?? [];
    let result;
    try {
      result = await drone.materialiseFromSig(channelId, branchSig, dir, { parentSegments });
    } catch (err) {
      this.#toast("warning", "Sync failed", String(err?.message ?? err));
      return;
    }
    try {
      await writeCellProperties(cellDir, { facade: false });
    } catch (err) {
      console.warn("[expose] sync: failed to drop facade flag", err);
    }
    if (result.missing.length > 0) {
      this.#toast(
        "tip",
        "Synced (partial)",
        `Added ${result.written} layer(s). ${result.missing.length} sig(s) still missing \u2014 they may arrive later.`
      );
    } else if (result.written === 0) {
      this.#toast(
        "info",
        "Nothing to sync",
        `"${tileLabel}" and its descendants are already in your hive.`
      );
    } else {
      this.#toast(
        "success",
        "Synced",
        `Added ${result.written} new descendant${result.written === 1 ? "" : "s"} under "${tileLabel}".`
      );
    }
    const approvalId = typeof props["approvalId"] === "string" ? props["approvalId"] : "";
    if (approvalId) {
      void drone.markPulled(channelId, approvalId);
    }
  }
  // ── helpers ────────────────────────────────────────────────────────
  #pairedChannelDrone() {
    const d = window.ioc.get("@diamondcoreprocessor.com/PairedChannelDrone");
    return d ?? null;
  }
  #firstJoinedChannel() {
    const drone = this.#pairedChannelDrone();
    if (!drone) return null;
    const ids = drone.joinedChannels();
    return ids[0] ?? null;
  }
  #toast(type, title, message) {
    EffectBus3.emit("toast:show", { type, title, message });
  }
};
async function listChildNames(dir) {
  const out = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== "directory") continue;
    if (name.startsWith("__") && name.endsWith("__")) continue;
    out.push(name);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}
var SYNC_DECORATION_KEYS = [
  // Sync-protocol decorations (already excluded)
  "children",
  "facade",
  "branchSig",
  "channelId",
  "approvalId",
  // Render / layout state — must not be part of the canonical layer sig.
  // These vary per browser (viewport per-tab) or per-render-pass (pinned
  // index after zoom-to-fit) and would cause the layer sig to drift on
  // every pan or zoom. Per-cell layout belongs in the optimization
  // (decoration) layer alongside Q&A and comms, not in canonical content.
  "index",
  "viewport",
  "pan",
  "zoom",
  "meshOffset",
  // Stale transient marker from the old in-OPFS-with-marker model — kept
  // out of sig so it doesn't survive into the layer identity even if it
  // accidentally appears in a cell's 0000.
  "transient"
];
function stripDecorations(props) {
  const out = { ...props };
  for (const k of SYNC_DECORATION_KEYS) delete out[k];
  return out;
}
async function buildSubtreeLayers(cellDir, cellName) {
  const descendants = [];
  const visit = async (dir, name) => {
    const childNames = await listChildNames(dir);
    const children = [];
    for (const childName of childNames) {
      let childDir;
      try {
        childDir = await dir.getDirectoryHandle(childName, { create: false });
      } catch (err) {
        console.warn("[expose] subtree: skipping", childName, err);
        continue;
      }
      const child = await visit(childDir, childName);
      children.push({ name: childName, sig: child.sig });
      descendants.push(child);
    }
    const rawProperties = await readCellProperties(dir);
    const properties = stripDecorations(rawProperties);
    const content = { name, properties, children };
    const sig = await computeLayerSig(content);
    return { sig, content };
  };
  const root = await visit(cellDir, cellName);
  return [root, ...descendants];
}
function approxJsonByteLength(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
  } catch {
    return 0;
  }
}
function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
var _exposeDrone = new ExposeDrone();
window.ioc.register("@diamondcoreprocessor.com/ExposeDrone", _exposeDrone);
export {
  ExposeDrone
};
