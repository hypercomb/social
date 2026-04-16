// @diamondcoreprocessor.com/history
// src/diamondcoreprocessor.com/history/global-time-clock.service.ts
import { EffectBus } from "@hypercomb/core";
var GlobalTimeClock = class extends EventTarget {
  #timestamp = null;
  /** null = live mode (no time override). number = frozen timestamp (ms epoch). */
  get timestamp() {
    return this.#timestamp;
  }
  /** Whether the clock is in global time mode (not live). */
  get active() {
    return this.#timestamp !== null;
  }
  /**
   * Set the global clock to a specific timestamp.
   * All locations will sync to show state at this moment.
   */
  setTime(timestamp) {
    if (this.#timestamp === timestamp) return;
    this.#timestamp = timestamp;
    this.#emit();
  }
  /**
   * Return to live mode. All locations show head state.
   */
  goLive() {
    if (this.#timestamp === null) return;
    this.#timestamp = null;
    this.#emit();
  }
  /**
   * Step to the previous op timestamp across all known history bags.
   * Finds the nearest op timestamp that is strictly before the current timestamp.
   */
  stepBack(allOpsTimestamps) {
    if (allOpsTimestamps.length === 0) return;
    if (this.#timestamp === null) {
      const last = allOpsTimestamps[allOpsTimestamps.length - 1];
      if (last !== void 0) this.setTime(last);
      return;
    }
    let candidate = null;
    for (const t of allOpsTimestamps) {
      if (t < this.#timestamp) {
        if (candidate === null || t > candidate) candidate = t;
      }
    }
    if (candidate !== null) {
      this.setTime(candidate);
    }
  }
  /**
   * Step to the next op timestamp across all known history bags.
   * Finds the nearest op timestamp that is strictly after the current timestamp.
   * If stepping past the last op, returns to live mode.
   */
  stepForward(allOpsTimestamps) {
    if (this.#timestamp === null || allOpsTimestamps.length === 0) return;
    let candidate = null;
    for (const t of allOpsTimestamps) {
      if (t > this.#timestamp) {
        if (candidate === null || t < candidate) candidate = t;
      }
    }
    if (candidate !== null) {
      this.setTime(candidate);
    } else {
      this.goLive();
    }
  }
  #emit() {
    this.dispatchEvent(new CustomEvent("change"));
    EffectBus.emit("time:changed", { timestamp: this.#timestamp });
  }
};
var _globalTimeClock = new GlobalTimeClock();
window.ioc.register("@diamondcoreprocessor.com/GlobalTimeClock", _globalTimeClock);

// src/diamondcoreprocessor.com/history/history-cursor.service.ts
import { EffectBus as EffectBus2 } from "@hypercomb/core";
var HistoryCursorService = class _HistoryCursorService extends EventTarget {
  #locationSig = "";
  #position = 0;
  #layers = [];
  // Last-fetched layer content, keyed by layer signature
  #cachedLayerSig = null;
  #cachedContent = null;
  get state() {
    const entry = this.#position > 0 ? this.#layers[this.#position - 1] : null;
    return {
      locationSig: this.#locationSig,
      position: this.#position,
      total: this.#layers.length,
      rewound: this.#layers.length > 0 && this.#position < this.#layers.length,
      at: entry?.at ?? 0
    };
  }
  /**
   * Load (or reload) layer history for a location. Restores persisted
   * cursor position so rewound state survives page refresh.
   */
  async load(locationSig) {
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!historyService) return;
    this.#layers = await historyService.listLayers(locationSig);
    if (this.#locationSig !== locationSig) {
      this.#locationSig = locationSig;
      this.#cachedLayerSig = null;
      this.#cachedContent = null;
      const saved = this.#loadPersistedPosition(locationSig);
      this.#position = saved !== null && saved < this.#layers.length ? saved : this.#layers.length;
    } else if (this.#position > this.#layers.length) {
      this.#position = this.#layers.length;
    }
    this.#emit();
  }
  /**
   * Called after LayerCommitter appends a new layer. If cursor was at
   * head, stay at head (absorb the new layer). Otherwise keep the
   * rewound position — the user is viewing history.
   */
  async onNewLayer() {
    const wasAtLatest = this.#position >= this.#layers.length;
    await this.load(this.#locationSig);
    if (wasAtLatest) {
      this.#position = this.#layers.length;
      this.#emit();
    }
  }
  /** Move cursor to an absolute position (1-based, clamped). */
  seek(position) {
    const clamped = Math.max(0, Math.min(position, this.#layers.length));
    if (clamped === this.#position) return;
    this.#position = clamped;
    this.#emit();
  }
  /** Step backward one layer. */
  undo() {
    if (this.#position > 0) this.seek(this.#position - 1);
  }
  /** Step forward one layer. */
  redo() {
    if (this.#position < this.#layers.length) this.seek(this.#position + 1);
  }
  /** Jump to latest (exit rewind mode). */
  jumpToLatest() {
    this.seek(this.#layers.length);
  }
  /**
   * Seek to the last layer at or before the given timestamp.
   * Returns the position it landed on (0 if no layers before timestamp).
   */
  seekToTime(timestamp) {
    if (this.#layers.length === 0) return 0;
    let pos = 0;
    for (let i = 0; i < this.#layers.length; i++) {
      if (this.#layers[i].at <= timestamp) pos = i + 1;
      else break;
    }
    this.seek(pos);
    return pos;
  }
  /**
   * All layer timestamps for this location, in order.
   * Used by GlobalTimeClock for stepping across locations.
   */
  get allTimestamps() {
    return this.#layers.map((entry) => entry.at);
  }
  /**
   * Resolve the LayerContent for the entry at the cursor position.
   * Cached by layer signature so repeated reads during a single render
   * hit memory, not OPFS.
   */
  async layerContentAtCursor() {
    if (this.#position === 0) return null;
    const entry = this.#layers[this.#position - 1];
    if (this.#cachedLayerSig === entry.layerSig && this.#cachedContent) {
      return this.#cachedContent;
    }
    const store = get("@hypercomb.social/Store");
    if (!store) return null;
    try {
      const blob = await store.getResource(entry.layerSig);
      if (!blob) return null;
      const content = JSON.parse(await blob.text());
      this.#cachedLayerSig = entry.layerSig;
      this.#cachedContent = content;
      return content;
    } catch {
      return null;
    }
  }
  /** Last-fetched layer content, for synchronous reads after a prior await. */
  peekContent() {
    return this.#cachedContent;
  }
  #emit() {
    this.#persistPosition();
    this.dispatchEvent(new CustomEvent("change"));
    EffectBus2.emit("history:cursor-changed", this.state);
  }
  // ── Cursor persistence (localStorage) ──────────────────────
  static #STORAGE_PREFIX = "hc:history-cursor:";
  #persistPosition() {
    if (!this.#locationSig) return;
    const key = _HistoryCursorService.#STORAGE_PREFIX + this.#locationSig;
    if (this.#position >= this.#layers.length) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(this.#position));
    }
  }
  #loadPersistedPosition(locationSig) {
    const raw = localStorage.getItem(_HistoryCursorService.#STORAGE_PREFIX + locationSig);
    if (raw === null) return null;
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }
};
var _historyCursorService = new HistoryCursorService();
window.ioc.register("@diamondcoreprocessor.com/HistoryCursorService", _historyCursorService);

// src/diamondcoreprocessor.com/history/history.service.ts
import { SignatureService } from "@hypercomb/core";
var HistoryService = class _HistoryService {
  // In-memory cache of full replay per signature. Keeps navigation instant —
  // history is the same until the next record()/updateLayer() append.
  #replayCache = /* @__PURE__ */ new Map();
  get historyRoot() {
    const store = get("@hypercomb.social/Store");
    return store.history;
  }
  getBag = async (signature) => {
    const root = this.historyRoot;
    return await root.getDirectoryHandle(signature, { create: true });
  };
  /**
   * Sign a lineage path to get the history bag signature.
   * Matches the same signing scheme as ShowCellDrone.
   */
  sign = async (lineage) => {
    const domain = String(lineage?.domain?.() ?? "hypercomb.io");
    const explorerSegmentsRaw = lineage?.explorerSegments?.();
    const explorerSegments = Array.isArray(explorerSegmentsRaw) ? explorerSegmentsRaw.map((x) => String(x ?? "").trim()).filter((x) => x.length > 0) : [];
    const lineagePath = explorerSegments.join("/");
    const roomStore = get("@hypercomb.social/RoomStore");
    const secretStore = get("@hypercomb.social/SecretStore");
    const space = roomStore?.value ?? "";
    const secret = secretStore?.value ?? "";
    const parts = [space, domain, lineagePath, secret, "cell"].filter(Boolean);
    const key = parts.join("/");
    const sigStore = get("@hypercomb/SignatureStore");
    return sigStore ? await sigStore.signText(key) : await SignatureService.sign(new TextEncoder().encode(key).buffer);
  };
  /**
   * Record an operation into the history bag for the given signature.
   * Appends a sequential file (00000001, 00000002, ...) with JSON content.
   *
   * Ops are a legacy view — the primary history primitive is the layer
   * snapshot (commitLayer). Any edit while rewound simply appends a new
   * layer at head; previous layers remain immutable and addressable.
   */
  record = async (signature, operation) => {
    const bag = await this.getBag(signature);
    const nextIndex = await this.nextIndex(bag);
    const fileName = String(nextIndex).padStart(8, "0");
    const fileHandle = await bag.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(operation));
    await writable.close();
    const cached = this.#replayCache.get(signature);
    if (cached) cached.push(operation);
  };
  /**
   * Replay all operations in a bag, in order.
   * If upTo is provided, stop at that index (inclusive).
   */
  replay = async (signature, upTo) => {
    if (upTo === void 0) {
      const cached = this.#replayCache.get(signature);
      if (cached) return cached;
    }
    const root = this.historyRoot;
    let bag;
    try {
      bag = await root.getDirectoryHandle(signature, { create: false });
    } catch {
      if (upTo === void 0) this.#replayCache.set(signature, []);
      return [];
    }
    const entries = [];
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== "file") continue;
      entries.push({ name, handle });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const ops = [];
    for (const entry of entries) {
      const index = parseInt(entry.name, 10);
      if (isNaN(index)) continue;
      if (upTo !== void 0 && index > upTo) break;
      try {
        const file = await entry.handle.getFile();
        const text = await file.text();
        const op = JSON.parse(text);
        ops.push(op);
      } catch {
      }
    }
    if (upTo === void 0) this.#replayCache.set(signature, ops);
    return ops;
  };
  /**
   * List all signature bags in __history__/.
   */
  list = async () => {
    const root = this.historyRoot;
    const result = [];
    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== "directory") continue;
      let count = 0;
      for await (const [, child] of handle.entries()) {
        if (child.kind === "file") count++;
      }
      result.push({ signature: name, count });
    }
    return result;
  };
  /**
   * Return the latest operation index and contents for a given bag.
   */
  head = async (signature) => {
    const root = this.historyRoot;
    let bag;
    try {
      bag = await root.getDirectoryHandle(signature, { create: false });
    } catch {
      return null;
    }
    let maxName = "";
    let maxHandle = null;
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== "file") continue;
      if (name > maxName) {
        maxName = name;
        maxHandle = handle;
      }
    }
    if (!maxHandle) return null;
    try {
      const file = await maxHandle.getFile();
      const text = await file.text();
      const op = JSON.parse(text);
      return { index: parseInt(maxName, 10), op };
    } catch {
      return null;
    }
  };
  // -------------------------------------------------
  // layer.json — materialized layer state
  // -------------------------------------------------
  static #LAYER_FILE = "layer.json";
  static #emptyLayer = { bees: [], layers: [], dependencies: [], resources: [] };
  getLayer = async (signature) => {
    try {
      const bag = await this.historyRoot.getDirectoryHandle(signature, { create: false });
      const handle = await bag.getFileHandle(_HistoryService.#LAYER_FILE);
      const file = await handle.getFile();
      const text = await file.text();
      return JSON.parse(text);
    } catch {
      return { ..._HistoryService.#emptyLayer };
    }
  };
  putLayer = async (signature, state) => {
    const bag = await this.getBag(signature);
    const handle = await bag.getFileHandle(_HistoryService.#LAYER_FILE, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(JSON.stringify(state));
    } finally {
      await writable.close();
    }
  };
  updateLayer = async (signature, next) => {
    const prev = await this.getLayer(signature);
    const added = {};
    const removed = {};
    for (const key of ["bees", "layers", "dependencies", "resources"]) {
      const prevSet = new Set(prev[key]);
      const nextSet = new Set(next[key]);
      const a = next[key].filter((s) => !prevSet.has(s));
      const r = prev[key].filter((s) => !nextSet.has(s));
      if (a.length) added[key] = a;
      if (r.length) removed[key] = r;
    }
    const hasChanges = Object.keys(added).length > 0 || Object.keys(removed).length > 0;
    if (hasChanges) {
      const bag = await this.getBag(signature);
      const nextIndex = await this.nextIndex(bag);
      const fileName = String(nextIndex).padStart(8, "0");
      const handle = await bag.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(JSON.stringify({ added, removed, at: Date.now() }));
      } finally {
        await writable.close();
      }
      await this.putLayer(signature, next);
      this.#replayCache.delete(signature);
    }
    return { added, removed };
  };
  // -------------------------------------------------
  // layer snapshots — signature-addressed history entries
  // -------------------------------------------------
  static #LAYERS_DIR = "layers";
  /**
   * Canonicalize a layer so byte-equal content produces byte-equal JSON.
   * `cells` keeps its caller-supplied order (position is meaningful). All
   * other string arrays are sorted lexicographically. Object keys are
   * inserted in sorted order; V8 preserves insertion order for string
   * keys, so plain `JSON.stringify` then produces stable output.
   */
  static canonicalizeLayer = (layer) => {
    const contentKeys = Object.keys(layer.contentByCell).sort();
    const contentByCell = {};
    for (const k of contentKeys) contentByCell[k] = layer.contentByCell[k];
    const tagKeys = Object.keys(layer.tagsByCell).sort();
    const tagsByCell = {};
    for (const k of tagKeys) tagsByCell[k] = [...layer.tagsByCell[k]].sort();
    const notesKeys = Object.keys(layer.notesByCell).sort();
    const notesByCell = {};
    for (const k of notesKeys) notesByCell[k] = layer.notesByCell[k];
    return {
      version: 2,
      cells: layer.cells.slice(),
      hidden: [...layer.hidden].sort(),
      contentByCell,
      tagsByCell,
      notesByCell,
      bees: [...layer.bees].sort(),
      dependencies: [...layer.dependencies].sort(),
      layoutSig: layer.layoutSig,
      instructionsSig: layer.instructionsSig
    };
  };
  /**
   * Commit a layer snapshot for a location.
   *
   * Writes the canonical layer content as a signature-addressed resource
   * (via Store.putResource) and appends an entry file pointing at it
   * under `__history__/{locationSig}/layers/NNNNNNNN.json`. Skips the
   * append if the new layer signature equals the current head (dedup).
   *
   * @returns the layer signature, or null if the commit was deduped.
   */
  commitLayer = async (locationSig, layer) => {
    const canonical = _HistoryService.canonicalizeLayer(layer);
    const json = JSON.stringify(canonical);
    const bytes = new TextEncoder().encode(json).buffer;
    const layerSig = await SignatureService.sign(bytes);
    const head = await this.headLayer(locationSig);
    if (head?.layerSig === layerSig) return null;
    const store = get("@hypercomb.social/Store");
    if (store) {
      await store.putResource(new Blob([json], { type: "application/json" }));
    }
    const layersDir = await this.#getLayersDir(locationSig);
    const nextIndex = await this.#nextLayerIndex(layersDir);
    const fileName = String(nextIndex).padStart(8, "0") + ".json";
    const handle = await layersDir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    try {
      const entry = { layerSig, at: Date.now() };
      await writable.write(JSON.stringify(entry));
    } finally {
      await writable.close();
    }
    return layerSig;
  };
  /**
   * Read the highest-numbered layer entry for a location, or null if the
   * location has no layer history yet.
   */
  headLayer = async (locationSig) => {
    const layersDir = await this.#tryGetLayersDir(locationSig);
    if (!layersDir) return null;
    let maxName = "";
    let maxHandle = null;
    for await (const [name, handle] of layersDir.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".json")) continue;
      if (name > maxName) {
        maxName = name;
        maxHandle = handle;
      }
    }
    if (!maxHandle) return null;
    try {
      const file = await maxHandle.getFile();
      const entry = JSON.parse(await file.text());
      return { ...entry, index: parseInt(maxName, 10) };
    } catch {
      return null;
    }
  };
  /**
   * Read a specific layer entry by index. Returns null if missing.
   */
  getLayerAt = async (locationSig, index) => {
    const layersDir = await this.#tryGetLayersDir(locationSig);
    if (!layersDir) return null;
    const fileName = String(index).padStart(8, "0") + ".json";
    try {
      const handle = await layersDir.getFileHandle(fileName, { create: false });
      const file = await handle.getFile();
      return JSON.parse(await file.text());
    } catch {
      return null;
    }
  };
  /**
   * List all layer entries for a location, sorted by index ascending.
   */
  listLayers = async (locationSig) => {
    const layersDir = await this.#tryGetLayersDir(locationSig);
    if (!layersDir) return [];
    const out = [];
    for await (const [name, handle] of layersDir.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".json")) continue;
      try {
        const file = await handle.getFile();
        const entry = JSON.parse(await file.text());
        out.push({ ...entry, index: parseInt(name, 10) });
      } catch {
      }
    }
    out.sort((a, b) => a.index - b.index);
    return out;
  };
  #getLayersDir = async (locationSig) => {
    const bag = await this.getBag(locationSig);
    return await bag.getDirectoryHandle(_HistoryService.#LAYERS_DIR, { create: true });
  };
  #tryGetLayersDir = async (locationSig) => {
    try {
      const bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false });
      return await bag.getDirectoryHandle(_HistoryService.#LAYERS_DIR, { create: false });
    } catch {
      return null;
    }
  };
  #nextLayerIndex = async (layersDir) => {
    let max = 0;
    for await (const [name, handle] of layersDir.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".json")) continue;
      const n = parseInt(name, 10);
      if (!isNaN(n) && n > max) max = n;
    }
    return max + 1;
  };
  // -------------------------------------------------
  // internal
  // -------------------------------------------------
  nextIndex = async (bag) => {
    let max = 0;
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== "file") continue;
      const n = parseInt(name, 10);
      if (!isNaN(n) && n > max) max = n;
    }
    return max + 1;
  };
};
var _historyService = new HistoryService();
window.ioc.register("@diamondcoreprocessor.com/HistoryService", _historyService);

// src/diamondcoreprocessor.com/history/layer-diff.ts
var EMPTY = {
  version: 2,
  cells: [],
  hidden: [],
  contentByCell: {},
  tagsByCell: {},
  notesByCell: {},
  bees: [],
  dependencies: [],
  layoutSig: "",
  instructionsSig: ""
};
var diffLayers = (prev, next) => {
  const p = prev ?? EMPTY;
  const diffs = [];
  const prevCellSet = new Set(p.cells);
  const nextCellSet = new Set(next.cells);
  for (const c of next.cells) if (!prevCellSet.has(c)) diffs.push({ kind: "cell-added", cell: c });
  for (const c of p.cells) if (!nextCellSet.has(c)) diffs.push({ kind: "cell-removed", cell: c });
  if (setEquals(prevCellSet, nextCellSet) && !sequenceEquals(p.cells, next.cells)) {
    diffs.push({ kind: "cells-reordered", from: [...p.cells], to: [...next.cells] });
  }
  const prevHidden = new Set(p.hidden);
  const nextHidden = new Set(next.hidden);
  for (const c of next.hidden) if (!prevHidden.has(c)) diffs.push({ kind: "cell-hidden", cell: c });
  for (const c of p.hidden) if (!nextHidden.has(c)) diffs.push({ kind: "cell-unhidden", cell: c });
  const contentKeys = union(Object.keys(p.contentByCell), Object.keys(next.contentByCell));
  for (const cell of contentKeys) {
    const a = p.contentByCell[cell] ?? "";
    const b = next.contentByCell[cell] ?? "";
    if (a === b) continue;
    if (!a) diffs.push({ kind: "content-added", cell, sig: b });
    else if (!b) diffs.push({ kind: "content-removed", cell, sig: a });
    else diffs.push({ kind: "content-changed", cell, prevSig: a, nextSig: b });
  }
  const tagKeys = union(Object.keys(p.tagsByCell), Object.keys(next.tagsByCell));
  for (const cell of tagKeys) {
    const a = p.tagsByCell[cell] ?? [];
    const b = next.tagsByCell[cell] ?? [];
    if (sequenceEquals(a, b)) continue;
    diffs.push({ kind: "tags-changed", cell, prev: [...a], next: [...b] });
  }
  const notesKeys = union(Object.keys(p.notesByCell), Object.keys(next.notesByCell));
  for (const cell of notesKeys) {
    const a = p.notesByCell[cell] ?? "";
    const b = next.notesByCell[cell] ?? "";
    if (a === b) continue;
    if (!a) diffs.push({ kind: "notes-added", cell, sig: b });
    else if (!b) diffs.push({ kind: "notes-removed", cell, sig: a });
    else diffs.push({ kind: "notes-changed", cell, prevSig: a, nextSig: b });
  }
  const prevBees = new Set(p.bees);
  const nextBees = new Set(next.bees);
  for (const k of next.bees) if (!prevBees.has(k)) diffs.push({ kind: "bee-registered", key: k });
  for (const k of p.bees) if (!nextBees.has(k)) diffs.push({ kind: "bee-unregistered", key: k });
  const prevDeps = new Set(p.dependencies);
  const nextDeps = new Set(next.dependencies);
  for (const s of next.dependencies) if (!prevDeps.has(s)) diffs.push({ kind: "dependency-added", sig: s });
  for (const s of p.dependencies) if (!nextDeps.has(s)) diffs.push({ kind: "dependency-removed", sig: s });
  if (p.layoutSig !== next.layoutSig) {
    diffs.push({ kind: "layout-changed", prevSig: p.layoutSig, nextSig: next.layoutSig });
  }
  if (p.instructionsSig !== next.instructionsSig) {
    diffs.push({ kind: "instructions-changed", prevSig: p.instructionsSig, nextSig: next.instructionsSig });
  }
  return diffs;
};
var setEquals = (a, b) => {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
};
var sequenceEquals = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
var union = (a, b) => {
  const set = new Set(a);
  for (const k of b) set.add(k);
  return [...set];
};

// src/diamondcoreprocessor.com/history/order-projection.ts
import { EffectBus as EffectBus3 } from "@hypercomb/core";
var OrderProjection = class {
  #cache = /* @__PURE__ */ new Map();
  #currentSig = null;
  constructor() {
    EffectBus3.on("cell:added", (payload) => {
      if (!payload?.cell || !this.#currentSig) return;
      const order = this.#cache.get(this.#currentSig);
      if (order && !order.includes(payload.cell)) {
        order.push(payload.cell);
      }
    });
    EffectBus3.on("cell:removed", (payload) => {
      if (!payload?.cell || !this.#currentSig) return;
      const order = this.#cache.get(this.#currentSig);
      if (order) {
        const idx = order.indexOf(payload.cell);
        if (idx !== -1) order.splice(idx, 1);
      }
    });
    EffectBus3.on("cell:reorder", (payload) => {
      if (!payload?.labels?.length || !this.#currentSig) return;
      this.#cache.set(this.#currentSig, [...payload.labels]);
    });
  }
  /**
   * Resolve the canonical cell order for a location.
   *
   * Preferred path: read the head layer and use its `cells` array —
   * constant-time and always reflects whatever the LayerCommitter most
   * recently snapshotted.
   *
   * Legacy fallback: for locations whose history predates the layer
   * format (no `layers/` subdirectory), replay the sequential op files.
   * This keeps existing user bags readable without a one-shot migration.
   */
  async hydrate(locationSig) {
    this.#currentSig = locationSig;
    const cached = this.#cache.get(locationSig);
    if (cached) return cached;
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!historyService) return [];
    const fromLayer = await this.#orderFromHeadLayer(historyService, locationSig);
    if (fromLayer) {
      this.#cache.set(locationSig, fromLayer);
      return fromLayer;
    }
    const ops = await historyService.replay(locationSig);
    const order = await this.#buildOrder(ops);
    this.#cache.set(locationSig, order);
    return order;
  }
  async #orderFromHeadLayer(history, locationSig) {
    const head = await history.headLayer(locationSig);
    if (!head) return null;
    const store = get("@hypercomb.social/Store");
    if (!store) return null;
    const blob = await store.getResource(head.layerSig);
    if (!blob) return null;
    try {
      const content = JSON.parse(await blob.text());
      return Array.isArray(content.cells) ? [...content.cells] : null;
    } catch {
      return null;
    }
  }
  /**
   * Write a reorder op to history and update the in-memory cache.
   * Stores the ordered cell list as a content-addressed resource.
   */
  async reorder(cells) {
    if (!this.#currentSig) return cells;
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    const store = get("@hypercomb.social/Store");
    if (!historyService || !store) return cells;
    const payload = JSON.stringify(cells);
    const payloadSig = await store.putResource(new Blob([payload]));
    await historyService.record(this.#currentSig, {
      op: "reorder",
      cell: payloadSig,
      at: Date.now()
    });
    const copy = [...cells];
    this.#cache.set(this.#currentSig, copy);
    return copy;
  }
  /** Read cached order (null if not hydrated). */
  peek(locationSig) {
    return this.#cache.get(locationSig) ?? null;
  }
  /** Invalidate cache for a location. */
  evict(locationSig) {
    this.#cache.delete(locationSig);
  }
  /**
   * Walk history ops to derive display order:
   * - add → append cell (if not present)
   * - remove → remove cell from list
   * - reorder → resolve payload from resources, replace list
   */
  async #buildOrder(ops) {
    const store = get("@hypercomb.social/Store");
    let order = [];
    for (const op of ops) {
      switch (op.op) {
        case "add":
          if (!order.includes(op.cell)) order.push(op.cell);
          break;
        case "remove":
          order = order.filter((s) => s !== op.cell);
          break;
        case "reorder":
          if (store) {
            const blob = await store.getResource(op.cell);
            if (blob) {
              try {
                const parsed = JSON.parse(await blob.text());
                if (Array.isArray(parsed)) order = parsed;
              } catch {
              }
            }
          }
          break;
        case "rename":
          if (store) {
            const blob = await store.getResource(op.cell);
            if (blob) {
              try {
                const parsed = JSON.parse(await blob.text());
                if (parsed?.oldName && parsed?.newName) {
                  const idx = order.indexOf(parsed.oldName);
                  if (idx !== -1) {
                    order[idx] = parsed.newName;
                  }
                }
              } catch {
              }
            }
          }
          break;
      }
    }
    return order;
  }
};
var _orderProjection = new OrderProjection();
window.ioc.register("@diamondcoreprocessor.com/OrderProjection", _orderProjection);

// src/diamondcoreprocessor.com/history/revise.queen.ts
import { QueenBee, EffectBus as EffectBus4 } from "@hypercomb/core";
var ReviseQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  genotype = "history";
  command = "revise";
  aliases = [];
  description = "Toggle revision mode (history clock)";
  #active = false;
  get active() {
    return this.#active;
  }
  execute(_args) {
    if (this.#active) {
      this.#exit();
    } else {
      this.#enter();
    }
  }
  #enter() {
    this.#active = true;
    EffectBus4.emit("revise:mode-changed", { active: true });
    console.log("[/revise] Revision mode ON \u2014 scrub the clock, Restore to promote.");
  }
  #exit() {
    const clock = get("@diamondcoreprocessor.com/GlobalTimeClock");
    if (clock?.active) clock.goLive();
    const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
    if (cursor?.state.rewound) {
      cursor.jumpToLatest();
    }
    this.#active = false;
    EffectBus4.emit("revise:mode-changed", { active: false });
    console.log("[/revise] Revision mode OFF \u2014 back to head.");
  }
};
var _revise = new ReviseQueenBee();
window.ioc.register("@diamondcoreprocessor.com/ReviseQueenBee", _revise);
export {
  GlobalTimeClock,
  HistoryCursorService,
  HistoryService,
  OrderProjection,
  ReviseQueenBee,
  diffLayers
};
