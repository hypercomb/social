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
  isSignature: () => isSignature,
  readCellProperties: () => readCellProperties,
  resolveResourceSignatures: () => resolveResourceSignatures,
  writeCellProperties: () => writeCellProperties
});
import { EffectBus } from "@hypercomb/core";
var TILE_PROPERTIES_FILE, isSignature, readCellProperties, writeCellProperties, resolveResourceSignatures;
var init_tile_properties = __esm({
  "src/diamondcoreprocessor.com/editor/tile-properties.ts"() {
    "use strict";
    TILE_PROPERTIES_FILE = "0000";
    isSignature = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
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

// src/diamondcoreprocessor.com/sharing/paired-channel.drone.ts
import { Drone, EffectBus as EffectBus2 } from "@hypercomb/core";

// src/diamondcoreprocessor.com/sharing/paired-channel.service.ts
import { SignatureService } from "@hypercomb/core";
var PAIRED_CHANNEL_KIND = 29010;
var TEXT_ENCODER = new TextEncoder();
async function channelIdFor(lineageSig, secret) {
  const sig = String(lineageSig ?? "").trim().toLowerCase();
  const sec = String(secret ?? "");
  if (!/^[0-9a-f]{64}$/.test(sig)) throw new Error("paired-channel: lineageSig must be 64 hex chars");
  if (!sec) throw new Error("paired-channel: secret is required");
  const buf = TEXT_ENCODER.encode(`${sig.length}:${sig}|${sec.length}:${sec}`);
  return SignatureService.sign(buf.buffer);
}
async function channelIdForLineage(lineage, secret) {
  const history = window.ioc.get(
    "@diamondcoreprocessor.com/HistoryService"
  );
  let lineageSig;
  if (history?.sign) {
    lineageSig = await history.sign(lineage);
  } else {
    const segments = (lineage.explorerSegments?.() ?? []).map((s) => String(s ?? "").trim()).filter((s) => s.length > 0);
    const key = segments.join("/");
    lineageSig = await SignatureService.sign(TEXT_ENCODER.encode(key).buffer);
  }
  return channelIdFor(lineageSig, secret);
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
    return mesh.publish(PAIRED_CHANNEL_KIND, channelId, payload, tags);
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
    const handlers = /* @__PURE__ */ new Set([handler]);
    const meshSub = mesh.subscribe(channelId, (msg) => {
      const evt = msg?.event;
      if (!evt) return;
      const ce = parseChannelEvent(channelId, evt);
      if (!ce) return;
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
    if (e.pubkey !== this.state.hostPubkey) return [];
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

// src/diamondcoreprocessor.com/sharing/paired-channel.drone.ts
var SECRET_STORAGE_KEY = "hypercomb.paired-channel.secret";
var LOCATION_STORAGE_KEY = "hypercomb.paired-channel.location";
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
  // No special listens — the drone subscribes to the mesh directly via
  // PairedChannelService, not via the EffectBus.
  listens = [];
  emits = Object.values(PAIRED_CHANNEL_EFFECTS);
  // ── state ─────────────────────────────────────────────────────────
  #channels = /* @__PURE__ */ new Map();
  // ── lifecycle ─────────────────────────────────────────────────────
  /**
   * Drone heartbeat — runs on every pulse. v0: reads a single
   * (location, secret) from localStorage and auto-joins. The location
   * is parsed into segments and signed identically to how
   * HistoryService.sign would sign it, so the channelId aligns with
   * the canonical lineage signature. Settings UI lands later.
   * Idempotent: re-joining is a no-op once the channel is in
   * #channels.
   */
  heartbeat = async () => {
    if (this.#channels.size > 0) return;
    const location = readLocalStorage(LOCATION_STORAGE_KEY);
    const secret = readLocalStorage(SECRET_STORAGE_KEY);
    if (!location || !secret) return;
    await this.join(location, secret);
  };
  /**
   * Join a channel by `(location, secret)`. The location is a path
   * string like `/howard/team` — parsed into segments, then signed
   * via HistoryService.sign (or the equivalent fallback) and combined
   * with the secret to produce the channelId.
   *
   * Idempotent: re-joining the same pair is a no-op. Returns the
   * channelId on success, null on failure.
   */
  async join(location, secret) {
    const lineage = {
      explorerSegments: () => parseLocationSegments(location)
    };
    let channelId;
    try {
      channelId = await channelIdForLineage(lineage, secret);
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
    const machine = new PairedChannelMachine(channelId);
    const subscription = service.subscribe(channelId, (event) => {
      this.#onChannelEvent(channelId, event);
    });
    const joined = { channelId, location, secret, machine, subscription };
    this.#channels.set(channelId, joined);
    EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.joined, { channelId, location });
    return channelId;
  }
  /**
   * Join a channel using a fully-formed Lineage object (typically
   * `@hypercomb.social/Lineage`). Use this in code paths that already
   * hold the live lineage so the channelId aligns exactly with the
   * lineage's canonical signature.
   */
  async joinLineage(lineage, secret) {
    let channelId;
    try {
      channelId = await channelIdForLineage(lineage, secret);
    } catch (err) {
      console.warn("[paired-channel] joinLineage: derivation failed", err);
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
    EffectBus2.emit(PAIRED_CHANNEL_EFFECTS.joined, { channelId, location });
    return channelId;
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
   */
  async materialiseFromSig(channelId, sig, parentDir) {
    const machine = this.#channels.get(channelId)?.machine;
    if (!machine) return { written: 0, missing: [sig] };
    const visited = /* @__PURE__ */ new Set();
    const missing = [];
    let written = 0;
    const walk = async (s, dir) => {
      if (visited.has(s)) return;
      visited.add(s);
      const content = machine.layer(s);
      if (!content) {
        missing.push(s);
        return;
      }
      let cellDir;
      try {
        cellDir = await dir.getDirectoryHandle(content.name, { create: true });
      } catch (err) {
        console.warn("[paired-channel] materialise: getDirectoryHandle failed", content.name, err);
        return;
      }
      try {
        await this.#writeProperties(cellDir, content.properties);
      } catch (err) {
        console.warn("[paired-channel] materialise: write 0000 failed", content.name, err);
      }
      written++;
      for (const child of content.children) {
        await walk(child.sig, cellDir);
      }
    };
    await walk(sig, parentDir);
    return { written, missing };
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
    for (const t of transitions) this.#onTransition(channelId, t);
  }
  #onTransition(channelId, t) {
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
function readLocalStorage(key) {
  try {
    const v = window.localStorage.getItem(key);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}
function parseLocationSegments(location) {
  return String(location ?? "").split("/").map((s) => s.trim()).filter((s) => s.length > 0);
}
var _pairedChannelDrone = new PairedChannelDrone();
window.ioc.register("@diamondcoreprocessor.com/PairedChannelDrone", _pairedChannelDrone);
export {
  PAIRED_CHANNEL_EFFECTS,
  PairedChannelDrone
};
