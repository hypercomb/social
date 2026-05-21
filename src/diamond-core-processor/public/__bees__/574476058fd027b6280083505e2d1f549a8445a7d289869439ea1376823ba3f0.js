// src/diamondcoreprocessor.com/assistant/claude-bridge.worker.ts
import { Worker, EffectBus as EffectBus2, normalizeCell, hypercomb, isSignature as isSignature2 } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/tile-properties.ts
import { EffectBus } from "@hypercomb/core";
var TILE_PROPERTIES_FILE = "0000";
var TILE_PROPERTIES_SLOT = "properties";
window.ioc?.whenReady?.(
  "@diamondcoreprocessor.com/LayerSlotRegistry",
  (registry) => {
    try {
      registry.register({
        slot: TILE_PROPERTIES_SLOT,
        triggers: []
      });
    } catch (err) {
      console.warn("[tile-properties] slot register failed:", err);
    }
  }
);
var cellLocationSig = async (parentSegments, cellName) => {
  const history = window.ioc?.get?.(
    "@diamondcoreprocessor.com/HistoryService"
  );
  if (!history?.sign) {
    return "";
  }
  return history.sign({ explorerSegments: () => [...parentSegments, cellName] });
};
var readCellProperties = async (cellDir) => {
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
var HISTORY_KEY = "@diamondcoreprocessor.com/HistoryService";
var STORE_KEY = "@hypercomb.social/Store";
var COMMITTER_KEY = "@diamondcoreprocessor.com/LayerCommitter";
var iocGet = (key) => {
  const ioc = window.ioc;
  return ioc?.get?.(key);
};
var readTilePropertiesAt = async (parentSegments, cellName) => {
  const history = iocGet(HISTORY_KEY);
  const store = iocGet(STORE_KEY);
  if (!history?.sign || !history?.currentLayerAt || !store?.getResource) return {};
  const cellSig = await history.sign({
    explorerSegments: () => [...parentSegments, cellName]
  });
  if (!cellSig) return {};
  const layer = await history.currentLayerAt(cellSig);
  const slot = Array.isArray(layer?.properties) ? layer.properties : [];
  const propSig = slot.length > 0 ? slot[0] : void 0;
  if (typeof propSig !== "string" || propSig.length === 0) return {};
  try {
    const blob = await store.getResource(propSig);
    if (!blob) return {};
    const text = await blob.text();
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn("[tile-properties] failed to read/parse properties resource", propSig, err);
    return {};
  }
};
var writeTilePropertiesAt = async (parentSegments, cellName, updates) => {
  const history = iocGet(HISTORY_KEY);
  const store = iocGet(STORE_KEY);
  const committer = iocGet(COMMITTER_KEY);
  if (!history?.sign || !store?.putResource || !committer?.commitSlotSet) return;
  const existing = await readTilePropertiesAt(parentSegments, cellName);
  const merged = { ...existing, ...updates };
  for (const k of Object.keys(merged)) {
    if (merged[k] === void 0) delete merged[k];
  }
  const sortedKeys = Object.keys(merged).sort();
  const canonical = {};
  for (const k of sortedKeys) canonical[k] = merged[k];
  const blob = new Blob([JSON.stringify(canonical)], { type: "application/json" });
  const propSig = await store.putResource(blob);
  const cellSegments = [...parentSegments, cellName];
  await committer.commitSlotSet(cellSegments, TILE_PROPERTIES_SLOT, [propSig]);
  EffectBus.emit("cell:0000-changed", {
    cacheKey: await cellLocationSig(parentSegments, cellName),
    keys: Object.keys(updates)
  });
};

// src/diamondcoreprocessor.com/history/inflate.ts
import { isSignature } from "@hypercomb/core";
var getIoc = (key) => window.ioc?.get(key);
var PREVIEW_LIMIT = 280;
var resolveOne = async (sig) => {
  const history = getIoc("@diamondcoreprocessor.com/HistoryService");
  if (history?.getLayerBySig) {
    try {
      const layer = await history.getLayerBySig(sig);
      if (layer) return layer;
    } catch {
    }
  }
  const store = getIoc("@hypercomb.social/Store");
  if (store?.resolve) {
    const resolved = await store.resolve(sig);
    if (resolved !== sig) return resolved;
    if (store.getResource) {
      try {
        const blob = await store.getResource(sig);
        if (!blob) return null;
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let preview;
        let contentType = "binary";
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          contentType = "text";
          preview = text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}\u2026` : text;
        } catch {
        }
        const descriptor = {
          $sig: sig,
          $bytes: bytes.byteLength,
          $contentType: contentType
        };
        if (preview !== void 0) descriptor.$preview = preview;
        return descriptor;
      } catch {
      }
    }
  }
  return null;
};
var MARKER_KEYS = ["$sig", "$cycle", "$missing", "$bytes"];
var isMarker = (value) => !!value && typeof value === "object" && !Array.isArray(value) && MARKER_KEYS.some((k) => k in value);
var inflate = async (value, visited = /* @__PURE__ */ new Set()) => {
  if (isSignature(value)) {
    const sig = value;
    if (visited.has(sig)) return { $cycle: sig };
    visited.add(sig);
    const raw = await resolveOne(sig);
    if (raw === null) return { $sig: sig, $missing: true };
    if (isMarker(raw)) return raw;
    return await inflate(raw, visited);
  }
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      out[i] = await inflate(value[i], visited);
    }
    return out;
  }
  if (value && typeof value === "object") {
    if (isMarker(value)) return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await inflate(v, visited);
    }
    return out;
  }
  return value;
};

// src/diamondcoreprocessor.com/assistant/claude-bridge.worker.ts
var BRIDGE_PORT = 2401;
var BRIDGE_ENABLED_QUERY_KEY = "claudeBridge";
var BRIDGE_ENABLED_STORAGE_KEY = "hypercomb.claudeBridge.enabled";
var CONTEXT_SLOT = "context";
var RECONNECT_MS = 3e3;
var ClaudeBridgeWorker = class extends Worker {
  namespace = "diamondcoreprocessor.com";
  genotype = "assistant";
  description = "Claude CLI bridge \u2014 receives tile commands over WebSocket and executes against OPFS.";
  grammar = [
    { example: "claude bridge" }
  ];
  effects = [];
  #ws = null;
  #timer = null;
  act = async () => {
    if (!this.#isEnabled()) return;
    this.#connect();
  };
  #isEnabled() {
    try {
      const host = window.location.hostname;
      if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return false;
      const queryValue = new URLSearchParams(window.location.search).get(BRIDGE_ENABLED_QUERY_KEY);
      if (queryValue !== null) return /^(1|true|yes|on)$/i.test(queryValue);
      const storedValue = window.localStorage.getItem(BRIDGE_ENABLED_STORAGE_KEY);
      if (storedValue !== null) return /^(1|true|yes|on)$/i.test(storedValue);
    } catch {
      return false;
    }
    return false;
  }
  // ------- WebSocket lifecycle -------
  #connected = false;
  #connect() {
    try {
      const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`);
      ws.onopen = () => {
        this.#connected = true;
        ws.send(JSON.stringify({ type: "renderer" }));
        console.log("[claude-bridge] connected");
      };
      ws.onmessage = (event) => {
        void this.#handleMessage(String(event.data));
      };
      ws.onclose = () => {
        const wasConnected = this.#connected;
        this.#ws = null;
        this.#connected = false;
        if (wasConnected) {
          console.log("[claude-bridge] disconnected, will reconnect");
          this.#scheduleReconnect();
        }
      };
      ws.onerror = () => {
      };
      this.#ws = ws;
    } catch {
    }
  }
  #scheduleReconnect() {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#connect();
    }, RECONNECT_MS);
  }
  // ------- message handling -------
  async #handleMessage(raw) {
    let req;
    try {
      req = JSON.parse(raw);
    } catch {
      return;
    }
    if (!req.id || !req.op) return;
    let res;
    try {
      res = await this.#dispatch(req);
    } catch (err) {
      res = { id: req.id, ok: false, error: err?.message ?? "unknown error" };
    }
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(res));
    }
  }
  async #dispatch(req) {
    switch (req.op) {
      case "update":
        return this.#update(req);
      case "note-add":
        return this.#noteAdd(req);
      case "note-list":
        return this.#noteList(req);
      case "note-delete":
        return this.#noteDelete(req);
      case "list-at":
        return this.#listAt(req);
      case "inflate":
        return this.#inflate(req);
      case "layer-at":
        return this.#layerAt(req);
      case "put-resource":
        return this.#putResource(req);
      case "get-resource":
        return this.#getResource(req);
      case "optimization-add":
        return this.#optimizationAdd(req);
      case "optimization-list":
        return this.#optimizationList(req);
      case "optimization-remove":
        return this.#optimizationRemove(req);
      case "decoration-add":
        return this.#decorationAdd(req);
      case "bag-add":
        return this.#bagMutate(req, "add");
      case "bag-remove":
        return this.#bagMutate(req, "remove");
      case "bag-set":
        return this.#bagSet(req);
      case "stamp":
        return this.#stamp(req);
      case "add":
        return this.#add(req);
      // legacy: delegates to update
      case "remove":
        return this.#remove(req);
      // legacy: delegates to update
      case "list":
        return this.#list(req);
      case "inspect":
        return this.#inspect(req);
      case "history":
        return this.#history(req);
      case "submit":
        return this.#submit(req);
      default:
        return { id: req.id, ok: false, error: `unknown op: ${req.op}` };
    }
  }
  // ─── resource I/O ──────────────────────────────────────────────────
  //
  // Content-addressed put: bytes in (text or base64), sig out. Mints a
  // resource in __resources__/ via Store.putResource — same path the rest
  // of the system uses, so dedup, OPFS write, and the content:wrote
  // sentinel mirror all happen.
  async #putResource(req) {
    const store = get("@hypercomb.social/Store");
    if (!store?.putResource) return { id: req.id, ok: false, error: "Store.putResource not available" };
    let bytes = null;
    if (typeof req.base64 === "string" && req.base64.length > 0) {
      try {
        bytes = base64ToBytes(req.base64);
      } catch (e) {
        return { id: req.id, ok: false, error: `bad base64: ${e?.message ?? "decode failed"}` };
      }
    } else if (typeof req.text === "string") {
      bytes = new TextEncoder().encode(req.text);
    } else {
      return { id: req.id, ok: false, error: "put-resource needs `text` or `base64`" };
    }
    const blob = new Blob([bytes]);
    const sig = await store.putResource(blob);
    return { id: req.id, ok: true, data: { sig, bytes: bytes.byteLength } };
  }
  // Content-addressed get: sig in, bytes out. Returns text when the
  // resource is valid UTF-8, otherwise base64. Caller can request a
  // specific encoding via req.text='base64' if it wants raw bytes.
  async #getResource(req) {
    const sig = typeof req.sig === "string" ? req.sig.trim() : "";
    if (!isSignature2(sig)) return { id: req.id, ok: false, error: "get-resource requires `sig` (64-hex)" };
    const store = get("@hypercomb.social/Store");
    if (!store?.getResource) return { id: req.id, ok: false, error: "Store.getResource not available" };
    const blob = await store.getResource(sig);
    if (!blob) return { id: req.id, ok: false, error: `resource not found: ${sig.slice(0, 12)}\u2026` };
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const force64 = req.text === "base64";
    if (!force64) {
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return { id: req.id, ok: true, data: { sig, encoding: "text", text, bytes: bytes.byteLength } };
      } catch {
      }
    }
    return {
      id: req.id,
      ok: true,
      data: { sig, encoding: "base64", base64: bytesToBase64(bytes), bytes: bytes.byteLength }
    };
  }
  // ─── persistent decoration substrate (__optimization__) ────────────
  //
  // Mint, list, and remove optimization objects in OPFS `__optimization__/`.
  // Each entry is a content-addressed JSON file (Q&A, comm, future kinds).
  // Layer-untouched: this directory is structurally separate from any
  // cell's layer slots. The dashboard reader and state-machine wrappers
  // around base objects pull from here at access/render time.
  async #optimizationAdd(req) {
    const store = get("@hypercomb.social/Store");
    if (!store?.putOptimization) return { id: req.id, ok: false, error: "Store.putOptimization not available" };
    if (typeof req.text !== "string" || req.text.length === 0) {
      return { id: req.id, ok: false, error: "optimization-add needs `text` (JSON payload)" };
    }
    try {
      JSON.parse(req.text);
    } catch {
      return { id: req.id, ok: false, error: "optimization-add: `text` must be valid JSON" };
    }
    const bytes = new TextEncoder().encode(req.text);
    const blob = new Blob([bytes]);
    const sig = await store.putOptimization(blob);
    return { id: req.id, ok: true, data: { sig, bytes: bytes.byteLength } };
  }
  async #optimizationList(req) {
    const store = get("@hypercomb.social/Store");
    if (!store?.listOptimizations || !store?.getOptimization) {
      return { id: req.id, ok: false, error: "Store optimization API not available" };
    }
    const wantKind = typeof req.kind === "string" && req.kind.trim() ? req.kind.trim() : null;
    const sigs = await store.listOptimizations();
    const items = [];
    for (const sig of sigs) {
      const blob = await store.getOptimization(sig);
      if (!blob) continue;
      let parsed;
      try {
        parsed = JSON.parse(await blob.text());
      } catch {
        continue;
      }
      if (wantKind && parsed?.kind !== wantKind) continue;
      items.push({ sig, kind: parsed?.kind, appliesTo: parsed?.appliesTo, payload: parsed?.payload, mark: parsed?.mark });
    }
    return { id: req.id, ok: true, data: { items, count: items.length } };
  }
  async #optimizationRemove(req) {
    const store = get("@hypercomb.social/Store");
    if (!store?.removeOptimization) return { id: req.id, ok: false, error: "Store.removeOptimization not available" };
    const sig = typeof req.sig === "string" ? req.sig.trim() : "";
    if (!isSignature2(sig)) return { id: req.id, ok: false, error: "optimization-remove requires `sig` (64-hex)" };
    const removed = await store.removeOptimization(sig);
    return { id: req.id, ok: true, data: { sig, removed } };
  }
  // ─── decoration-add ────────────────────────────────────────────────
  //
  // Composite write: mint a decoration record in `__resources__` AND
  // wire its sig into the cell's `decorations` slot in one bridge call.
  // Equivalent to `put-resource` + `bag-add slot=decorations` but
  // saves a round-trip and atomically applies the cascade.
  //
  // Decoration JSONs live in `__resources__` (not `__optimization__`)
  // so they ride the existing replication/sharing pipeline. Peer adopters
  // resolve decoration sigs through the same getResource path as HTML
  // pages, images, and other shared content. `__optimization__` stays
  // reserved for personal-only decorations (Q&A, comms) that should not
  // leak across peers.
  //
  // Request shape:
  //   {
  //     op: 'decoration-add',
  //     segments: ['dolphin', 'site'],
  //     kind: 'visual:website:page',
  //     appliesTo: ['dolphin', 'site'],   // typically same as segments
  //     payload: { htmlSig: '…', ... },   // bee-specific, any JSON
  //     mark?: 'persistent',
  //     replaceKind?: true,               // remove existing of same kind
  //   }
  //
  // When `replaceKind` is true the worker scans the cell's current
  // `decorations` slot, fetches each entry from `__resources__` to read
  // its kind, drops any whose kind matches `req.kind`, then appends the
  // new sig. This preserves the "one page per cell" semantic for visual
  // bees like /website while leaving decorations of other kinds intact.
  // The dropped decoration JSONs themselves stay in `__resources__`
  // (signature-addressed; deduped against other consumers). GC of
  // orphans is a separate concern.
  async #decorationAdd(req) {
    const segments = (req.segments ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    if (segments.length === 0) return { id: req.id, ok: false, error: "decoration-add requires `segments`" };
    const kind = typeof req.kind === "string" ? req.kind.trim() : "";
    if (!kind) return { id: req.id, ok: false, error: "decoration-add requires `kind`" };
    const appliesTo = Array.isArray(req.appliesTo) ? req.appliesTo.map((s) => String(s)) : [...segments];
    const payload = req.payload && typeof req.payload === "object" ? req.payload : null;
    if (!payload) return { id: req.id, ok: false, error: "decoration-add requires `payload` (object)" };
    const mark = req.mark === "persistent" ? "persistent" : void 0;
    const store = get("@hypercomb.social/Store");
    if (!store?.putResource) return { id: req.id, ok: false, error: "Store.putResource not available" };
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!history) return { id: req.id, ok: false, error: "HistoryService not available" };
    const committer = get("@diamondcoreprocessor.com/LayerCommitter");
    if (!committer?.update) return { id: req.id, ok: false, error: "LayerCommitter.update not available" };
    const record = { kind, appliesTo, payload };
    if (mark) record["mark"] = mark;
    const recordBytes = new TextEncoder().encode(JSON.stringify(record));
    const newSig = await store.putResource(new Blob([recordBytes]));
    const locationSig = await history.sign({ explorerSegments: () => segments });
    const layer = await history.currentLayerAt(locationSig);
    const cellName = layer?.name ?? segments[segments.length - 1] ?? "";
    const priorRaw = layer?.["decorations"];
    let prior = Array.isArray(priorRaw) ? priorRaw.map((s) => String(s)).filter((s) => /^[0-9a-f]{64}$/.test(s)) : [];
    const dropped = [];
    if (req.replaceKind === true && store.getResource) {
      const kept = [];
      for (const existingSig of prior) {
        if (existingSig === newSig) continue;
        try {
          const blob = await store.getResource(existingSig);
          if (!blob) {
            kept.push(existingSig);
            continue;
          }
          const parsed = JSON.parse(await blob.text());
          if (parsed?.kind === kind) {
            dropped.push(existingSig);
            continue;
          }
          kept.push(existingSig);
        } catch {
          kept.push(existingSig);
        }
      }
      prior = kept;
    }
    if (prior.includes(newSig) && dropped.length === 0) {
      return { id: req.id, ok: true, data: { sig: newSig, slot: "decorations", unchanged: true, count: prior.length } };
    }
    const next = prior.includes(newSig) ? prior : [...prior, newSig];
    const nextLayer = { name: cellName, decorations: next };
    await committer.update(segments, nextLayer);
    for (const removedSig of dropped) {
      EffectBus2.emit("decorations:changed", { segments, op: "removeSig", sig: removedSig });
    }
    EffectBus2.emit("decorations:changed", { segments, op: "append", sig: newSig });
    return { id: req.id, ok: true, data: { sig: newSig, slot: "decorations", count: next.length, dropped: dropped.length } };
  }
  // ─── context-bag helpers ───────────────────────────────────────────
  //
  // Mutate a sig-array slot at `segments`. The slot defaults to
  // `context` (the LLM's per-cell bag) but the same machinery handles
  // any slot whose value is an array of resource sigs — pass req.slot
  // to override.
  //
  // Flow: read current layer at segments → splice the slot's sig array
  // → committer.update commits the new layer (one cascade up to root).
  async #bagMutate(req, mode) {
    const sig = typeof req.sig === "string" ? req.sig.trim() : "";
    if (!isSignature2(sig)) return { id: req.id, ok: false, error: `bag-${mode} requires \`sig\` (64-hex)` };
    const segments = (req.segments ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    if (segments.length === 0) return { id: req.id, ok: false, error: `bag-${mode} requires \`segments\`` };
    const slot = typeof req.slot === "string" && req.slot.trim() || CONTEXT_SLOT;
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!history) return { id: req.id, ok: false, error: "HistoryService not available" };
    const locationSig = await history.sign({ explorerSegments: () => segments });
    const layer = await history.currentLayerAt(locationSig);
    const cellName = layer?.name ?? segments[segments.length - 1] ?? "";
    const priorRaw = layer?.[slot];
    const prior = Array.isArray(priorRaw) ? priorRaw.map((s) => String(s)) : [];
    let next;
    if (mode === "add") {
      if (prior.includes(sig)) return { id: req.id, ok: true, data: { unchanged: true, slot, count: prior.length } };
      next = [...prior, sig];
    } else {
      if (!prior.includes(sig)) return { id: req.id, ok: true, data: { unchanged: true, slot, count: prior.length } };
      next = prior.filter((s) => s !== sig);
    }
    const committer = get("@diamondcoreprocessor.com/LayerCommitter");
    if (!committer?.update) return { id: req.id, ok: false, error: "LayerCommitter.update not available" };
    const nextLayer = { name: cellName, [slot]: next };
    await committer.update(segments, nextLayer);
    return { id: req.id, ok: true, data: { slot, count: next.length, mode } };
  }
  /** Replace a slot's sig array atomically. Caller passes
   *  `segments`, optional `slot` (default `context`), and `cells` —
   *  the array of sigs the slot should hold AFTER the call. Other
   *  slots on the cell layer are untouched. Use this when a single
   *  resource per cell is the intent (e.g. one rendered page per
   *  cell): `{ op: 'bag-set', segments, cells: [pageSig] }`. */
  async #bagSet(req) {
    const segments = (req.segments ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    if (segments.length === 0) return { id: req.id, ok: false, error: "bag-set requires `segments`" };
    const cells = req.cells;
    if (!Array.isArray(cells)) return { id: req.id, ok: false, error: "bag-set requires `cells` (array of sigs)" };
    const next = cells.map((s) => String(s ?? "").trim()).filter((s) => /^[0-9a-f]{64}$/.test(s));
    if (next.length !== cells.length) {
      return { id: req.id, ok: false, error: "bag-set: every cell must be a 64-hex sig" };
    }
    const slot = typeof req.slot === "string" && req.slot.trim() || CONTEXT_SLOT;
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!history) return { id: req.id, ok: false, error: "HistoryService not available" };
    const locationSig = await history.sign({ explorerSegments: () => segments });
    const layer = await history.currentLayerAt(locationSig);
    const cellName = layer?.name ?? segments[segments.length - 1] ?? "";
    const committer = get("@diamondcoreprocessor.com/LayerCommitter");
    if (!committer?.update) return { id: req.id, ok: false, error: "LayerCommitter.update not available" };
    const nextLayer = { name: cellName, [slot]: next };
    await committer.update(segments, nextLayer);
    return { id: req.id, ok: true, data: { slot, count: next.length } };
  }
  // ─── property stamp ────────────────────────────────────────────────
  //
  // Write a key=value into the cell's properties slot on its layer.
  // Used for legacy paths still keyed by cell-property name (websiteSig,
  // custom renderer overrides). Slot-based authors should prefer
  // `update` / `bag-add` for new fields; `stamp` is for the pre-slot
  // property surface that lives in the layer's `properties` slot.
  // Layer-slot writes emit `cell:0000-changed` so nurse cache
  // invalidation fires correctly across both legacy and new paths.
  async #stamp(req) {
    const segments = (req.segments ?? []).map((s) => normalizeCell(String(s ?? "").trim())).filter(Boolean);
    if (segments.length === 0) return { id: req.id, ok: false, error: "stamp requires `segments`" };
    const layer = req.layer;
    if (!layer || typeof layer !== "object") {
      return { id: req.id, ok: false, error: "stamp requires `layer` with property key\u2192value pairs" };
    }
    const parentSegments = segments.slice(0, -1);
    const cellName = segments[segments.length - 1];
    const updates = {};
    for (const [k, v] of Object.entries(layer)) {
      if (v === null || ["string", "number", "boolean"].includes(typeof v)) updates[k] = v;
    }
    await writeTilePropertiesAt(parentSegments, cellName, updates);
    return { id: req.id, ok: true, data: { keys: Object.keys(updates) } };
  }
  // Recursive sig → JSON inflater. Caller hands a 64-hex sig (or a
  // segments path that resolves to the current layer sig at that
  // location) and receives the fully-inflated merkle subtree as a
  // self-contained JSON value. Mechanical primitive — the LLM
  // composes by passing sigs around, this returns the content.
  // Raw layer read — returns slot values with their underlying sig
  // arrays preserved, NOT recursively resolved into their content.
  // Use when the caller needs the canonical sig of a slot entry
  // (e.g. dashboard refresh needs the qa-slot resource sig so the
  // in-page answer composer can `bag-remove` the right entry on
  // submit). `inflate` resolves sigs into their JSON which drops
  // the addressing — this op keeps the addressing intact.
  async #layerAt(req) {
    const segments = (req.segments ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!history) return { id: req.id, ok: false, error: "HistoryService not available" };
    const locationSig = await history.sign({ explorerSegments: () => segments });
    const layer = await history.currentLayerAt(locationSig);
    if (!layer) return { id: req.id, ok: false, error: `no layer at /${segments.join("/")}` };
    return { id: req.id, ok: true, data: layer };
  }
  async #inflate(req) {
    let sig = typeof req.cell === "string" ? req.cell.trim() : "";
    if (!sig && req.segments) {
      const segments = req.segments.map((s) => String(s ?? "").trim()).filter(Boolean);
      const history = get("@diamondcoreprocessor.com/HistoryService");
      if (!history) return { id: req.id, ok: false, error: "HistoryService not available" };
      const locationSig = await history.sign({ explorerSegments: () => segments });
      const layer = await history.currentLayerAt(locationSig);
      if (!layer) return { id: req.id, ok: false, error: `no layer at /${segments.join("/")}` };
      const inflated2 = await inflate(layer);
      return { id: req.id, ok: true, data: inflated2 };
    }
    if (!isSignature2(sig)) {
      return { id: req.id, ok: false, error: "inflate requires a 64-hex sig (in `cell`) or `segments`" };
    }
    const inflated = await inflate(sig);
    return { id: req.id, ok: true, data: inflated };
  }
  // Read notes at an EXPLICIT cell location (parentSegments + cellLabel).
  // Headless mirror of `note-add` — uses NotesService.getNotesAtSegments
  // so the bridge can read instructions without temporarily navigating.
  async #noteList(req) {
    const segments = (req.segments ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    if (segments.length === 0) {
      return { id: req.id, ok: false, error: "no segments provided" };
    }
    const notes = get("@diamondcoreprocessor.com/NotesService");
    if (!notes?.getNotesAtSegments) {
      return { id: req.id, ok: false, error: "NotesService.getNotesAtSegments not available" };
    }
    const items = await notes.getNotesAtSegments(segments);
    return { id: req.id, ok: true, data: items };
  }
  // List child cell folders at EXPLICIT segments — bypasses the user's
  // current navigation. Walks from the absolute hypercombRoot (NOT the
  // lineage's current explorerDir) so segments are interpreted as a
  // path from root, identical regardless of where the user is.
  async #listAt(req) {
    const store = get("@hypercomb.social/Store");
    let dir = store?.hypercombRoot ?? null;
    if (!dir) return { id: req.id, ok: false, error: "no hypercombRoot" };
    const segments = (req.segments ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    for (const seg of segments) {
      const clean = normalizeCell(seg);
      if (!clean) continue;
      try {
        dir = await dir.getDirectoryHandle(clean, { create: false });
      } catch {
        return { id: req.id, ok: false, error: `path not found: ${segments.join("/")}` };
      }
    }
    const cells = await this.#listCellFolders(dir);
    return { id: req.id, ok: true, data: cells };
  }
  // Append a note to a cell at explicit segments. Calls
  // NotesService.addAtSegments — same upsert path as user-typed notes.
  // Headless: no dependency on the current navigation lineage.
  async #noteAdd(req) {
    const cell = req.cell;
    const text = req.text;
    const segments = req.segments ?? [];
    if (typeof cell !== "string" || !cell) {
      return { id: req.id, ok: false, error: "missing cell label" };
    }
    if (typeof text !== "string" || !text) {
      return { id: req.id, ok: false, error: "missing note text" };
    }
    const notes = get("@diamondcoreprocessor.com/NotesService");
    if (!notes?.addAtSegments) {
      return { id: req.id, ok: false, error: "NotesService.addAtSegments not available" };
    }
    await notes.addAtSegments(segments, cell, text);
    return { id: req.id, ok: true };
  }
  // Remove a note by id from a cell at explicit segments. Calls
  // NotesService.deleteAtSegments — same merkle cascade as user-driven
  // delete. Used for migration scripts that retract [Q]-prefixed legacy
  // notes once they've been copied into __optimization__/.
  async #noteDelete(req) {
    const cell = req.cell;
    const noteId = typeof req.sig === "string" ? req.sig.trim() : "";
    const segments = req.segments ?? [];
    if (typeof cell !== "string" || !cell) {
      return { id: req.id, ok: false, error: "missing cell label" };
    }
    if (!noteId) {
      return { id: req.id, ok: false, error: "missing noteId (pass via `sig` field)" };
    }
    const notes = get("@diamondcoreprocessor.com/NotesService");
    if (!notes?.deleteAtSegments) {
      return { id: req.id, ok: false, error: "NotesService.deleteAtSegments not available" };
    }
    await notes.deleteAtSegments(segments, cell, noteId);
    return { id: req.id, ok: true, data: { cell, noteId } };
  }
  // Layer-as-primitive update. Caller passes `{ segments, layer }` where
  // layer is `{ name, ...slots }`. Slot names are conventional (children,
  // tags, notes, etc.). Empty arrays wipe the slot. One awaited cascade
  // per parent. The receiver mirrors `children` to OPFS folders so the
  // file tree stays in sync with the merkle layer.
  async #update(req) {
    const layer = req.layer;
    if (!layer || typeof layer !== "object") {
      return { id: req.id, ok: false, error: "no layer provided" };
    }
    const store = get("@hypercomb.social/Store");
    let dir = store?.hypercombRoot ?? null;
    if (!dir) return { id: req.id, ok: false, error: "no hypercombRoot" };
    const parentSegments = [];
    if (req.segments?.length) {
      for (const raw of req.segments) {
        const seg = normalizeCell(raw);
        if (!seg) continue;
        dir = await dir.getDirectoryHandle(seg, { create: true });
        parentSegments.push(seg);
      }
    }
    const childrenRaw = layer.children;
    const children = Array.isArray(childrenRaw) ? childrenRaw.map((c) => normalizeCell(String(c))).filter(Boolean) : [];
    for (const name of children) {
      await dir.getDirectoryHandle(name, { create: true });
    }
    const committer = get("@diamondcoreprocessor.com/LayerCommitter");
    if (!committer?.update) {
      return { id: req.id, ok: false, error: "committer.update not available" };
    }
    await committer.update(parentSegments, layer);
    return { id: req.id, ok: true, data: { count: children.length, segments: parentSegments } };
  }
  // Mirrors a human keystroke into the in-app command line. Emits the same
  // EffectBus channel a future remote caller would use; the command-line
  // component subscribes and runs the existing submit pipeline. Text is
  // forwarded verbatim so anything the keyboard accepts (slash behaviours,
  // bracket selects, multi-token grammar, plain cell names) just works.
  async #submit(req) {
    const text = req.text;
    if (typeof text !== "string") return { id: req.id, ok: false, error: "no text provided" };
    EffectBus2.emit("command-line:remote-submit", { text });
    return { id: req.id, ok: true };
  }
  // ------- operations -------
  async #add(req) {
    const cells = req.cells;
    if (!cells?.length) return { id: req.id, ok: false, error: "no cells provided" };
    let dir = await this.#explorerDir();
    if (!dir) return { id: req.id, ok: false, error: "no explorer directory" };
    const parentSegments = [];
    if (req.segments?.length) {
      for (const raw of req.segments) {
        const seg = normalizeCell(raw);
        if (!seg) continue;
        dir = await dir.getDirectoryHandle(seg, { create: true });
        parentSegments.push(seg);
      }
    }
    let count = 0;
    for (const name of cells) {
      const normalized = normalizeCell(name);
      if (!normalized) continue;
      await dir.getDirectoryHandle(normalized, { create: true });
      EffectBus2.emit("cell:added", { cell: normalized, segments: parentSegments.slice() });
      count++;
    }
    await new hypercomb().act();
    return { id: req.id, ok: true, data: { count } };
  }
  async #remove(req) {
    if (req.all) {
      const visible = await this.#visibleCells();
      for (const cell of visible) {
        EffectBus2.emit("cell:removed", { cell });
      }
      await new hypercomb().act();
      return { id: req.id, ok: true, data: { count: visible.length } };
    }
    const cells = req.cells;
    if (!cells?.length) return { id: req.id, ok: false, error: "no cells provided" };
    let count = 0;
    for (const raw of cells) {
      const cell = normalizeCell(raw);
      if (!cell) continue;
      EffectBus2.emit("cell:removed", { cell });
      count++;
    }
    await new hypercomb().act();
    return { id: req.id, ok: true, data: { count } };
  }
  async #list(req) {
    const cells = await this.#visibleCells();
    return { id: req.id, ok: true, data: cells };
  }
  async #inspect(req) {
    const segmentsRaw = (req.segments ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    if (segmentsRaw.length > 0) {
      const store = get("@hypercomb.social/Store");
      let dir2 = store?.hypercombRoot ?? null;
      if (!dir2) return { id: req.id, ok: false, error: "no hypercombRoot" };
      for (const seg of segmentsRaw) {
        const clean = normalizeCell(seg);
        if (!clean) continue;
        try {
          dir2 = await dir2.getDirectoryHandle(clean, { create: false });
        } catch {
          return { id: req.id, ok: false, error: `path not found: ${segmentsRaw.join("/")}` };
        }
      }
      const props = await readCellProperties(dir2);
      return { id: req.id, ok: true, data: props };
    }
    const name = req.cell ? normalizeCell(req.cell) : "";
    if (!name) return { id: req.id, ok: false, error: "no cell name" };
    const dir = await this.#explorerDir();
    if (!dir) return { id: req.id, ok: false, error: "no explorer directory" };
    try {
      const cellDir = await dir.getDirectoryHandle(name, { create: false });
      const props = await readCellProperties(cellDir);
      return { id: req.id, ok: true, data: props };
    } catch {
      return { id: req.id, ok: false, error: `cell not found: ${name}` };
    }
  }
  async #history(req) {
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    const lineage = get("@hypercomb.social/Lineage");
    if (!historyService || !lineage) {
      return { id: req.id, ok: false, error: "history service not available" };
    }
    const sig = await historyService.sign(lineage);
    const ops = await historyService.replay(sig);
    return { id: req.id, ok: true, data: ops };
  }
  // ------- helpers -------
  async #explorerDir() {
    const lineage = get("@hypercomb.social/Lineage");
    return lineage?.explorerDir?.() ?? null;
  }
  async #listCellFolders(dir) {
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "directory") continue;
      if (!name) continue;
      if (name.startsWith("__") && name.endsWith("__")) continue;
      out.push(name);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }
  async #visibleCells() {
    const dir = await this.#explorerDir();
    if (!dir) return [];
    const all = await this.#listCellFolders(dir);
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    const lineage = get("@hypercomb.social/Lineage");
    if (!historyService || !lineage) return all;
    const sig = await historyService.sign(lineage);
    const ops = await historyService.replay(sig);
    const cellState = /* @__PURE__ */ new Map();
    for (const op of ops) cellState.set(op.cell, op.op);
    const allSet = new Set(all);
    return all.filter((cell) => {
      const lastOp = cellState.get(cell);
      return lastOp !== "remove" || allSet.has(cell);
    });
  }
};
var base64ToBytes = (b64) => {
  const clean = b64.replace(/[\s]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};
var bytesToBase64 = (bytes) => {
  const CHUNK = 32768;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
};
var _claudeBridgeWorker = new ClaudeBridgeWorker();
window.ioc.register("@diamondcoreprocessor.com/ClaudeBridgeWorker", _claudeBridgeWorker);
window.ioc?.whenReady?.(
  "@diamondcoreprocessor.com/LayerSlotRegistry",
  (slotRegistry) => {
    slotRegistry.register({ slot: CONTEXT_SLOT, triggers: [] });
  }
);
export {
  ClaudeBridgeWorker
};
