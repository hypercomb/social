// src/diamondcoreprocessor.com/sharing/nostr-mesh.drone.ts
import { Drone } from "@hypercomb/core";
var HARD_RELAY = "wss://relay.snort.social";
var NostrMeshDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "Maintains WebSocket connections to Nostr relays and routes mesh subscribe/publish events.";
  effects = ["network"];
  deps = { signer: "@diamondcoreprocessor.com/NostrSigner" };
  listens = ["mesh:ensure-started", "mesh:subscribe", "mesh:publish"];
  emits = ["mesh:ready", "mesh:items-updated"];
  // -----------------------------
  // config
  // -----------------------------
  // note: default public relay (can be overridden by localstorage/configureRelays)
  relays = [HARD_RELAY];
  // note: set to null to accept any kind matching x
  kinds = [29010];
  // note: expiry rules live here
  ttlMs = 6e5;
  perSigCap = 128;
  expiryRules = [
    { id: "default", ttlMs: 6e5 }
  ];
  // -----------------------------
  // state
  // -----------------------------
  started = false;
  stopped = false;
  networkEnabled = this.loadNetworkEnabled();
  sockets = /* @__PURE__ */ new Map();
  backoff = /* @__PURE__ */ new Map();
  bucketsBySig = /* @__PURE__ */ new Map();
  bucketsBySubId = /* @__PURE__ */ new Map();
  // note: ttl-backed cache per sig
  itemsBySig = /* @__PURE__ */ new Map();
  readyWaitersBySig = /* @__PURE__ */ new Map();
  // note: dedupe across relays (drops repeated ids)
  recentIds = [];
  recentIdsSet = /* @__PURE__ */ new Set();
  recentCap = 2048;
  // -----------------------------
  // debug (off by default)
  // -----------------------------
  debug = false;
  stats = this.newStats();
  logs = [];
  logCap = 200;
  #initialized = false;
  sense = () => true;
  heartbeat = async () => {
    if (!this.#initialized) {
      this.#initialized = true;
      this.ensureStartedNow();
      this.onEffect("mesh:ensure-started", async ({ signature }) => {
        this.ensureStartedForSig(signature);
        this.emitEffect("mesh:ready", { signature });
      });
      this.onEffect("mesh:subscribe", ({ signature, onItems }) => {
        this.subscribe(signature, onItems);
      });
      this.onEffect("mesh:publish", async ({ kind, sig, payload, extraTags }) => {
        await this.publish(kind, sig, payload, extraTags);
      });
    }
    this.pruneAllExpired();
    this.ensureSocketHealth();
  };
  // -----------------------------
  // public api
  // -----------------------------
  configureRelays = (urls, persist = true) => {
    const next = (Array.isArray(urls) ? urls : []).map((u) => String(u ?? "").trim()).filter((u) => u.startsWith("ws://") || u.startsWith("wss://"));
    this.relays = next.length > 0 ? Array.from(new Set(next)) : [HARD_RELAY];
    if (persist) this.saveRelays(this.relays);
    this.reconnectAll();
  };
  loadRelayConfig = () => {
    this.relays = this.loadRelays(this.relays);
  };
  configureKinds = (kinds, persist = true) => {
    this.ensureStartedNow();
    if (kinds === null) {
      this.kinds = null;
      if (persist) this.saveKinds(null);
      this.note("kinds:set", void 0, void 0, void 0, void 0, null);
      this.resubscribeAll();
      return;
    }
    if (!Array.isArray(kinds) || kinds.length === 0) return;
    const next = kinds.map((k) => Number(k)).filter((k) => Number.isFinite(k) && k > 0).sort((a, b) => a - b);
    const uniq = Array.from(new Set(next));
    if (uniq.length === 0) return;
    this.kinds = uniq;
    if (persist) this.saveKinds(uniq);
    this.note("kinds:set", void 0, void 0, void 0, void 0, this.kinds);
    this.resubscribeAll();
  };
  // note: expiry tuning is mesh-owned
  configureExpiry = (ttlMs, perSigCap = 128) => {
    const ttl = Number(ttlMs ?? 0);
    if (Number.isFinite(ttl) && ttl > 0) this.ttlMs = ttl;
    const cap = Number(perSigCap ?? 0);
    if (Number.isFinite(cap) && cap >= 16) this.perSigCap = Math.floor(cap);
    this.ensureDefaultExpiryRule();
    this.pruneAllExpired();
    this.note("expiry:set", void 0, void 0, void 0, void 0, { ttlMs: this.ttlMs, perSigCap: this.perSigCap });
  };
  // note: array-based expiry rules (first match wins, fallback is default ttl)
  configureExpiryRules = (rules) => {
    if (!Array.isArray(rules)) return;
    const next = this.sanitizeExpiryRules(rules);
    this.expiryRules = next;
    this.ensureDefaultExpiryRule();
    this.pruneAllExpired();
    this.note("expiry-rules:set", void 0, void 0, void 0, void 0, this.expiryRules);
  };
  getExpiryRules = () => {
    this.ensureDefaultExpiryRule();
    return this.expiryRules.map((r) => ({ ...r }));
  };
  // note: count distinct publisher IDs in non-expired cache for a signature
  getSwarmSize = (sig) => {
    const s = String(sig ?? "").trim();
    if (!s) return 0;
    this.pruneSigExpired(s);
    const items = this.itemsBySig.get(s);
    if (!items || items.length === 0) return 0;
    const publishers = /* @__PURE__ */ new Set();
    for (const item of items) {
      const tags = item.event?.tags;
      if (!Array.isArray(tags)) continue;
      for (const t of tags) {
        if (Array.isArray(t) && t.length >= 2 && String(t[0]) === "publisher") {
          const v = String(t[1] ?? "").trim();
          if (v) publishers.add(v);
        }
      }
    }
    return publishers.size;
  };
  // note: creates a bucket (zero consumers) so relays are queried and cache fills
  ensureStartedForSig = (sig) => {
    this.ensureStartedNow();
    const s = String(sig ?? "").trim();
    if (!s) return;
    const existing = this.bucketsBySig.get(s);
    if (existing) return;
    const bucket = { sig: s, subId: this.makeSubId(), cbs: /* @__PURE__ */ new Set() };
    this.bucketsBySig.set(s, bucket);
    this.bucketsBySubId.set(bucket.subId, bucket);
    this.note("sub:hidden", void 0, s, bucket.subId, void 0, { consumers: 0 });
    this.sendReqToAll(bucket);
  };
  // note: returns newest-first cached items that are not expired (mesh ttl rules)
  getNonExpired = (sig) => {
    this.ensureStartedNow();
    const s = String(sig ?? "").trim();
    if (!s) return [];
    this.pruneSigExpired(s);
    const items = this.itemsBySig.get(s);
    if (!items || items.length === 0) return [];
    const sorted = items.slice().sort((a, b) => (b.createdAtMs || b.receivedAtMs) - (a.createdAtMs || a.receivedAtMs));
    return sorted.map((i) => ({ relay: i.relay, sig: i.sig, event: i.event, payload: i.payload }));
  };
  // note: await initial cache readiness for a signature
  // resolves when first matching event arrives, relay sends EOSE, or timeout elapses
  awaitReadyForSig = async (sig, timeoutMs = 900) => {
    this.ensureStartedNow();
    const s = String(sig ?? "").trim();
    if (!s) return;
    this.ensureStartedForSig(s);
    this.pruneSigExpired(s);
    const existing = this.itemsBySig.get(s);
    if (existing && existing.length > 0) return;
    await new Promise((resolve) => {
      const list = this.readyWaitersBySig.get(s) ?? [];
      const waiter = { resolve };
      const t = Number(timeoutMs ?? 0);
      if (Number.isFinite(t) && t > 0) {
        waiter.timer = window.setTimeout(() => {
          this.removeReadyWaiter(s, waiter);
          resolve();
        }, Math.floor(t));
      }
      list.push(waiter);
      this.readyWaitersBySig.set(s, list);
    });
  };
  stop = () => {
    this.stopped = true;
    for (const [url, st] of this.backoff.entries()) {
      if (st.timer) clearTimeout(st.timer);
      this.backoff.delete(url);
    }
    for (const [url, ws] of this.sockets.entries()) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
      } catch {
      }
      try {
        ws.close();
      } catch {
      }
      this.sockets.delete(url);
      this.note("socket:stop", url);
    }
  };
  setDebug = (enabled) => {
    this.debug = !!enabled;
    try {
      localStorage.setItem("hc:nostrmesh:debug", this.debug ? "1" : "0");
    } catch {
    }
    this.note("debug:set", void 0, void 0, void 0, void 0, this.debug);
  };
  clearDebug = () => {
    this.stats = this.newStats();
    this.stats.startedAtMs = Date.now();
    this.logs = [];
    this.note("debug:clear");
  };
  getDebug = () => {
    this.ensureStartedNow();
    return {
      debug: this.debug,
      relays: this.relays.slice(),
      kinds: this.kinds ? this.kinds.slice() : null,
      ttlMs: this.ttlMs,
      perSigCap: this.perSigCap,
      expiryRules: this.getExpiryRules(),
      sockets: Array.from(this.sockets.entries()).map(([url, ws]) => ({ url, readyState: ws.readyState })),
      buckets: Array.from(this.bucketsBySig.values()).map((b) => ({ sig: b.sig, subId: b.subId, consumers: b.cbs.size })),
      cached: Array.from(this.itemsBySig.entries()).map(([sig, items]) => ({ sig, count: items.length })),
      stats: { ...this.stats },
      logs: this.logs.slice()
    };
  };
  isNetworkEnabled = () => this.networkEnabled;
  setNetworkEnabled = (enabled, persist = true) => {
    const next = !!enabled;
    if (next === this.networkEnabled) return;
    this.networkEnabled = next;
    if (persist) {
      try {
        localStorage.setItem("hc:nostrmesh:network", next ? "1" : "0");
      } catch {
      }
    }
    this.note("network:set", void 0, void 0, void 0, void 0, this.networkEnabled);
    if (!this.networkEnabled) {
      this.pauseNetwork();
      return;
    }
    this.ensureStartedNow();
    this.reconnectAll();
  };
  // note: signature-only subscription
  // - sig is used as the x tag value
  // - multiple consumers share one network subscription per sig
  subscribe = (sig, cb) => {
    this.ensureStartedNow();
    const s = String(sig ?? "").trim();
    if (!s) return { close: () => void 0 };
    const existing = this.bucketsBySig.get(s);
    if (existing) {
      existing.cbs.add(cb);
      this.note("sub:join", void 0, s, existing.subId, void 0, { consumers: existing.cbs.size });
      return { close: () => this.unsubscribe(s, cb) };
    }
    const bucket = { sig: s, subId: this.makeSubId(), cbs: /* @__PURE__ */ new Set() };
    bucket.cbs.add(cb);
    this.bucketsBySig.set(s, bucket);
    this.bucketsBySubId.set(bucket.subId, bucket);
    this.note("sub:new", void 0, s, bucket.subId, void 0, { consumers: 1 });
    this.sendReqToAll(bucket);
    return { close: () => this.unsubscribe(s, cb) };
  };
  // note: publish a payload
  // - always local fanout immediately (even if signer is missing)
  // - best-effort to sign + send to relays
  publish = async (kind, sig, payload, extraTags) => {
    this.ensureStartedNow();
    const k = Number(kind ?? 0);
    if (!k || !Number.isFinite(k)) return false;
    const s = String(sig ?? "").trim();
    if (!s) return false;
    const tags = [["x", s], ["expiration", String(Math.floor(Date.now() / 1e3) + 600)]];
    if (Array.isArray(extraTags)) {
      for (const t of extraTags) {
        if (!Array.isArray(t) || t.length < 2) continue;
        tags.push(t.map((x) => String(x)));
      }
    }
    const content = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
    const evt = {
      created_at: Math.floor(Date.now() / 1e3),
      kind: k,
      tags,
      content
    };
    this.fanoutToSig("local", s, evt);
    this.note("publish:local", void 0, s, void 0, k);
    const signed = await this.trySign(evt);
    if (!signed) {
      this.stats.sendSkippedNoSigner++;
      this.note("publish:send-skipped-nosigner", void 0, s, void 0, k);
      return true;
    }
    this.sendEventToAll(signed);
    this.note("publish:sent", void 0, s, void 0, k);
    return true;
  };
  // note: publish a fully-formed event (signed elsewhere)
  publishEvent = async (evt) => {
    this.ensureStartedNow();
    if (!evt || !evt.kind || !Array.isArray(evt.tags)) return false;
    const sig = this.readX(evt.tags);
    if (sig) this.fanoutToSig("local", sig, evt);
    const signed = evt.id && evt.pubkey && evt.sig ? evt : await this.trySign(evt);
    if (!signed) {
      this.stats.sendSkippedNoSigner++;
      return true;
    }
    this.sendEventToAll(signed);
    return true;
  };
  // -----------------------------
  // startup
  // -----------------------------
  ensureStartedNow = () => {
    if (this.started) return;
    this.started = true;
    this.debug = this.loadDebugFlag();
    this.stats.startedAtMs = Date.now();
    this.relays = this.loadRelays(this.relays);
    this.kinds = this.loadKinds(this.kinds);
    this.note("mesh:started", void 0, void 0, void 0, void 0, { relays: this.relays, kinds: this.kinds });
    this.connectAll();
  };
  // -----------------------------
  // connections
  // -----------------------------
  connectAll = () => {
    if (!this.networkEnabled) return;
    for (const url of this.relays) this.ensureSocket(url);
  };
  ensureSocketHealth = () => {
    if (!this.networkEnabled || this.stopped) return;
    const now = Date.now();
    for (const [url, st] of this.backoff.entries()) {
      if (st.attempts >= 10 && st.nextAtMs > 0 && now - st.nextAtMs > 3e4) {
        st.attempts = 0;
        st.nextAtMs = 0;
        if (st.timer) {
          clearTimeout(st.timer);
          st.timer = void 0;
        }
        this.note("socket:backoff-reset", url);
      }
    }
    for (const url of this.relays) {
      if (!this.sockets.has(url)) this.ensureSocket(url);
    }
  };
  reconnectAll = () => {
    if (this.stopped) return;
    for (const [url, st] of this.backoff.entries()) {
      if (st.timer) clearTimeout(st.timer);
      this.backoff.delete(url);
    }
    for (const [url, ws] of this.sockets.entries()) {
      try {
        ws.close();
      } catch {
      }
      this.sockets.delete(url);
      this.note("socket:close-requested", url);
    }
    this.connectAll();
  };
  resubscribeAll = () => {
    for (const b of this.bucketsBySig.values()) {
      this.sendCloseToAll(b.subId);
      this.sendReqToAll(b);
    }
  };
  ensureSocket = (relay) => {
    if (!this.networkEnabled) return;
    if (this.stopped) return;
    if (this.sockets.has(relay)) return;
    if (!this.canAttemptRelay(relay)) return;
    const now = Date.now();
    const st = this.backoff.get(relay);
    if (st && st.nextAtMs > now) {
      this.scheduleEnsure(relay, st.nextAtMs - now);
      return;
    }
    let ws;
    try {
      ws = new WebSocket(relay);
    } catch {
      return;
    }
    this.sockets.set(relay, ws);
    this.note("socket:create", relay);
    ws.onopen = () => {
      this.stats.socketsOpened++;
      this.note("socket:open", relay);
      const b = this.backoff.get(relay);
      if (b) {
        b.attempts = 0;
        b.nextAtMs = 0;
      }
      for (const bucket of this.bucketsBySig.values()) this.sendReq(relay, bucket);
    };
    ws.onmessage = (msg) => {
      this.onMessage(relay, msg?.data);
    };
    ws.onclose = () => {
      this.stats.socketsClosed++;
      this.note("socket:closed", relay);
      this.sockets.delete(relay);
      if (!this.networkEnabled || this.stopped) return;
      this.bumpBackoff(relay);
      this.ensureSocket(relay);
    };
    ws.onerror = () => {
      this.stats.socketsErrors++;
      this.note("socket:error", relay);
      try {
        ws.close();
      } catch {
      }
    };
  };
  scheduleEnsure = (relay, delayMs) => {
    if (this.stopped) return;
    const st = this.backoff.get(relay);
    if (!st) return;
    if (st.timer) return;
    st.timer = window.setTimeout(() => {
      st.timer = void 0;
      this.ensureSocket(relay);
    }, Math.max(0, delayMs));
  };
  bumpBackoff = (relay) => {
    const now = Date.now();
    const st = this.backoff.get(relay) ?? { attempts: 0, nextAtMs: 0 };
    st.attempts = Math.min(10, st.attempts + 1);
    const base = Math.min(15e3, 250 * 2 ** (st.attempts - 1));
    const jitter = Math.floor(Math.random() * 250);
    st.nextAtMs = now + base + jitter;
    this.backoff.set(relay, st);
    this.note("socket:backoff", relay, void 0, void 0, void 0, { attempts: st.attempts, waitMs: base + jitter });
  };
  canAttemptRelay = (relay) => {
    if (!this.isLoopbackRelay(relay)) return true;
    if (this.relays.includes(relay)) return true;
    if (this.allowLoopbackRelay()) return true;
    this.note("socket:skip-loopback-relay", relay);
    return false;
  };
  isLoopbackRelay = (relay) => {
    try {
      const u = new URL(relay);
      const h = String(u.hostname ?? "").trim().toLowerCase();
      return h === "localhost" || h === "127.0.0.1" || h === "::1";
    } catch {
      return false;
    }
  };
  allowLoopbackRelay = () => {
    try {
      return localStorage.getItem("hc:nostrmesh:allow-loopback") === "1";
    } catch {
      return false;
    }
  };
  // -----------------------------
  // inbound routing
  // -----------------------------
  onMessage = (relay, data) => {
    if (typeof data !== "string" || !data) return;
    this.stats.msgIn++;
    const msg = this.tryJson(data);
    if (!Array.isArray(msg) || msg.length < 1) {
      this.stats.parseFail++;
      this.note("in:parse-fail", relay, void 0, void 0, void 0, data);
      return;
    }
    const type = String(msg[0] ?? "");
    if (type === "NOTICE") {
      this.stats.msgNoticeIn++;
      this.note("in:notice", relay, void 0, void 0, void 0, msg[1]);
      return;
    }
    if (type === "EOSE") {
      const subId2 = String(msg[1] ?? "");
      const bucket2 = this.bucketsBySubId.get(subId2);
      if (bucket2) this.resolveReadyWaiters(bucket2.sig);
      this.stats.msgOtherIn++;
      if (this.debug) this.note("in:eose", relay, bucket2?.sig, subId2);
      return;
    }
    if (type !== "EVENT") {
      this.stats.msgOtherIn++;
      if (this.debug) this.note("in:other", relay, void 0, void 0, void 0, msg);
      return;
    }
    this.stats.msgEventIn++;
    const subId = String(msg[1] ?? "");
    const evt = msg[2];
    if (!subId || !evt) return;
    const bucket = this.bucketsBySubId.get(subId);
    if (!bucket) {
      this.stats.noBucket++;
      if (this.debug) this.note("in:no-bucket", relay, void 0, subId, void 0, evt);
      return;
    }
    if (Array.isArray(this.kinds) && this.kinds.length > 0) {
      if (!this.kinds.includes(Number(evt.kind ?? 0))) return;
    }
    if (evt.id) {
      const id = String(evt.id);
      if (this.recentIdsSet.has(id)) {
        this.stats.dupDrop++;
        return;
      }
      this.pushRecentId(id);
    }
    const payload = this.parsePayload(evt);
    this.cacheItem(relay, bucket.sig, evt, payload);
    this.resolveReadyWaiters(bucket.sig);
    const out = { relay, sig: bucket.sig, event: evt, payload };
    for (const cb of bucket.cbs) {
      try {
        cb(out);
      } catch {
      }
    }
  };
  cacheItem = (relay, sig, evt, payload) => {
    const now = Date.now();
    const createdAtMs = Number(evt?.created_at ?? 0) > 0 ? Number(evt.created_at) * 1e3 : now;
    const item = { relay, sig, event: evt, payload, receivedAtMs: now, createdAtMs };
    const list = this.itemsBySig.get(sig) ?? [];
    list.push(item);
    if (list.length > this.perSigCap) {
      list.sort((a, b) => (b.createdAtMs || b.receivedAtMs) - (a.createdAtMs || a.receivedAtMs));
      list.splice(this.perSigCap);
    }
    this.itemsBySig.set(sig, list);
    this.pruneSigExpired(sig);
  };
  pushRecentId = (id) => {
    this.recentIds.push(id);
    this.recentIdsSet.add(id);
    if (this.recentIds.length <= this.recentCap) return;
    const drop = this.recentIds.splice(0, this.recentIds.length - this.recentCap);
    for (const d of drop) this.recentIdsSet.delete(d);
  };
  parsePayload = (evt) => {
    const c = String(evt?.content ?? "");
    if (!c) return null;
    const j = this.tryJson(c);
    if (j != null) return j;
    return c;
  };
  readX = (tags) => {
    for (const t of tags) {
      if (!Array.isArray(t) || t.length < 2) continue;
      if (String(t[0]) !== "x") continue;
      return String(t[1] ?? "");
    }
    return "";
  };
  // -----------------------------
  // outbound
  // -----------------------------
  sendReqToAll = (b) => {
    if (!this.networkEnabled) return;
    for (const url of this.sockets.keys()) this.sendReq(url, b);
  };
  sendReq = (url, b) => {
    const ws = this.sockets.get(url);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const filter = { "#x": [b.sig], since: Math.floor(Date.now() / 1e3) - 900 };
    if (Array.isArray(this.kinds) && this.kinds.length > 0) filter.kinds = this.kinds;
    this.stats.reqSent++;
    this.note("out:req", url, b.sig, b.subId, void 0, filter);
    try {
      ws.send(JSON.stringify(["REQ", b.subId, filter]));
    } catch {
    }
  };
  sendCloseToAll = (subId) => {
    for (const url of this.sockets.keys()) this.sendClose(url, subId);
  };
  sendClose = (url, subId) => {
    const ws = this.sockets.get(url);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    this.stats.closeSent++;
    this.note("out:close", url, void 0, subId);
    try {
      ws.send(JSON.stringify(["CLOSE", subId]));
    } catch {
    }
  };
  sendEventToAll = (evt) => {
    const frame = JSON.stringify(["EVENT", evt]);
    this.stats.eventSent++;
    for (const ws of this.sockets.values()) {
      if (!this.networkEnabled) return;
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(frame);
      } catch {
      }
    }
  };
  fanoutToSig = (relay, sig, evt) => {
    const payload = this.parsePayload(evt);
    this.cacheItem(relay, sig, evt, payload);
    const bucket = this.bucketsBySig.get(sig);
    if (!bucket || bucket.cbs.size === 0) return;
    this.stats.localFanout++;
    const out = { relay, sig, event: evt, payload };
    for (const cb of bucket.cbs) {
      try {
        cb(out);
      } catch {
      }
    }
  };
  closeBucket = (b) => {
    this.sendCloseToAll(b.subId);
    this.bucketsBySig.delete(b.sig);
    this.bucketsBySubId.delete(b.subId);
    this.note("sub:closed", void 0, b.sig, b.subId);
  };
  unsubscribe = (sig, cb) => {
    const b = this.bucketsBySig.get(sig);
    if (!b) return;
    b.cbs.delete(cb);
    this.note("sub:leave", void 0, sig, b.subId, void 0, { consumers: b.cbs.size });
    if (b.cbs.size > 0) return;
    this.closeBucket(b);
  };
  // -----------------------------
  // expiry (mesh-owned)
  // -----------------------------
  pruneAllExpired = () => {
    for (const sig of this.itemsBySig.keys()) this.pruneSigExpired(sig);
  };
  pruneSigExpired = (sig) => {
    const list = this.itemsBySig.get(sig);
    if (!list || list.length === 0) return;
    const now = Date.now();
    const keep = list.filter((i) => {
      const t = i.receivedAtMs || i.createdAtMs || 0;
      const ttlMs = this.resolveTtlMs(sig, i.event);
      return t > 0 && now - t <= ttlMs;
    });
    if (keep.length === 0) {
      this.itemsBySig.delete(sig);
      return;
    }
    this.itemsBySig.set(sig, keep);
  };
  // -----------------------------
  // signing (delegated)
  // -----------------------------
  trySign = async (evt) => {
    if (evt?.id && evt?.pubkey && evt?.sig) return evt;
    const anyWin = window;
    if (anyWin?.nostr?.signEvent) {
      try {
        const signed = await anyWin.nostr.signEvent(evt);
        return signed ?? null;
      } catch {
      }
    }
    const signer = this.resolve("signer");
    if (signer?.signEvent) {
      try {
        const signed = await signer.signEvent(evt);
        return signed ?? null;
      } catch {
      }
    }
    return null;
  };
  // -----------------------------
  // helpers
  // -----------------------------
  loadNetworkEnabled() {
    try {
      const v = localStorage.getItem("hc:nostrmesh:network");
      if (v === "0") return false;
      if (v === "1") return true;
    } catch {
    }
    return true;
  }
  pauseNetwork = () => {
    for (const [url, st] of this.backoff.entries()) {
      if (st.timer) clearTimeout(st.timer);
      this.backoff.delete(url);
    }
    for (const [url, ws] of this.sockets.entries()) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
      } catch {
      }
      try {
        ws.close();
      } catch {
      }
      this.sockets.delete(url);
      this.note("socket:pause", url);
    }
  };
  loadDebugFlag = () => {
    try {
      return localStorage.getItem("hc:nostrmesh:debug") === "1";
    } catch {
      return false;
    }
  };
  loadRelays = (fallback) => {
    try {
      const raw = localStorage.getItem("hc:nostrmesh:relays");
      if (!raw) return fallback.slice();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return fallback.slice();
      const next = parsed.filter((u) => typeof u === "string").map((u) => u.trim()).filter((u) => u.startsWith("ws://") || u.startsWith("wss://"));
      return Array.from(new Set(next));
    } catch {
      return fallback.slice();
    }
  };
  saveRelays = (urls) => {
    try {
      localStorage.setItem("hc:nostrmesh:relays", JSON.stringify(urls));
    } catch {
    }
  };
  loadKinds = (fallback) => {
    try {
      const raw = localStorage.getItem("hc:nostrmesh:kinds");
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (parsed === null) return null;
      if (!Array.isArray(parsed)) return fallback;
      const next = parsed.map((k) => Number(k)).filter((k) => Number.isFinite(k) && k > 0).sort((a, b) => a - b);
      const uniq = Array.from(new Set(next));
      return uniq.length ? uniq : fallback;
    } catch {
      return fallback;
    }
  };
  saveKinds = (kinds) => {
    try {
      localStorage.setItem("hc:nostrmesh:kinds", JSON.stringify(kinds));
    } catch {
    }
  };
  // fix: must be a real method (not an arrow-field) so it can be used during field initialization
  newStats() {
    return {
      startedAtMs: 0,
      socketsOpened: 0,
      socketsClosed: 0,
      socketsErrors: 0,
      reqSent: 0,
      closeSent: 0,
      eventSent: 0,
      localFanout: 0,
      msgIn: 0,
      msgEventIn: 0,
      msgNoticeIn: 0,
      msgOtherIn: 0,
      parseFail: 0,
      noBucket: 0,
      sendSkippedNoSigner: 0,
      dupDrop: 0
    };
  }
  note = (type, relay, sig, subId, kind, data) => {
    if (!this.debug) return;
    const entry = { atMs: Date.now(), type, relay, sig, subId, kind, data };
    this.logs.push(entry);
    if (this.logs.length > this.logCap) this.logs.splice(0, this.logs.length - this.logCap);
  };
  makeSubId = () => {
    const r = Math.random().toString(16).slice(2);
    const t = Date.now().toString(16);
    return `hc-${t}-${r}`;
  };
  tryJson = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  sanitizeExpiryRules = (rules) => {
    const out = [];
    for (let i = 0; i < rules.length; i++) {
      const src = rules[i];
      if (!src || typeof src !== "object") continue;
      const ttl = Number(src.ttlMs ?? 0);
      if (!Number.isFinite(ttl) || ttl <= 0) continue;
      const idRaw = String(src.id ?? "").trim();
      const id = idRaw || `rule-${i + 1}`;
      const sigPrefixRaw = String(src.sigPrefix ?? "").trim();
      const sigPrefix = sigPrefixRaw ? sigPrefixRaw : void 0;
      const kindNum = Number(src.kind);
      const kind = Number.isFinite(kindNum) && kindNum > 0 ? Math.floor(kindNum) : void 0;
      out.push({
        id,
        ttlMs: Math.floor(ttl),
        sigPrefix,
        kind
      });
    }
    return out;
  };
  ensureDefaultExpiryRule = () => {
    const idx = this.expiryRules.findIndex((r) => r.id === "default");
    if (idx >= 0) {
      this.expiryRules[idx] = { id: "default", ttlMs: this.ttlMs };
      return;
    }
    this.expiryRules.push({ id: "default", ttlMs: this.ttlMs });
  };
  resolveTtlMs = (sig, evt) => {
    this.ensureDefaultExpiryRule();
    const kind = Number(evt?.kind ?? 0);
    const s = String(sig ?? "");
    for (const rule of this.expiryRules) {
      if (!rule || !Number.isFinite(rule.ttlMs) || rule.ttlMs <= 0) continue;
      if (rule.sigPrefix && !s.startsWith(rule.sigPrefix)) continue;
      if (typeof rule.kind === "number" && Number.isFinite(rule.kind) && rule.kind > 0 && rule.kind !== kind) continue;
      return Math.floor(rule.ttlMs);
    }
    return this.ttlMs;
  };
  resolveReadyWaiters = (sig) => {
    const list = this.readyWaitersBySig.get(sig);
    if (!list || list.length === 0) return;
    this.readyWaitersBySig.delete(sig);
    for (const waiter of list) {
      if (waiter.timer) {
        try {
          clearTimeout(waiter.timer);
        } catch {
        }
      }
      try {
        waiter.resolve();
      } catch {
      }
    }
  };
  removeReadyWaiter = (sig, waiter) => {
    const list = this.readyWaitersBySig.get(sig);
    if (!list || list.length === 0) return;
    const idx = list.indexOf(waiter);
    if (idx < 0) return;
    list.splice(idx, 1);
    if (list.length === 0) this.readyWaitersBySig.delete(sig);
  };
};
var meshDrone = new NostrMeshDrone();
window.ioc.register("@diamondcoreprocessor.com/NostrMeshDrone", meshDrone);
export {
  NostrMeshDrone
};
