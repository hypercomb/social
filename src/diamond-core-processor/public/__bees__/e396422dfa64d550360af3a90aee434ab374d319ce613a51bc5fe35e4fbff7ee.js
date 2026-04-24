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
    if (head && head.layerSig === layerSig) return null;
    const store = get("@hypercomb.social/Store");
    if (!store) return null;
    await store.putResource(new Blob([json], { type: "application/json" }));
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
   * Entries whose referenced layer resource can no longer be resolved are
   * filtered out — they are dead pointers that would otherwise render as
   * "(loading)" forever in the history viewer.
   */
  listLayers = async (locationSig) => {
    const layersDir = await this.#tryGetLayersDir(locationSig);
    if (!layersDir) return [];
    const raw = [];
    for await (const [name, handle] of layersDir.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".json")) continue;
      try {
        const file = await handle.getFile();
        const entry = JSON.parse(await file.text());
        raw.push({ ...entry, index: parseInt(name, 10) });
      } catch {
      }
    }
    raw.sort((a, b) => a.index - b.index);
    const store = get("@hypercomb.social/Store");
    const resolved = /* @__PURE__ */ new Set();
    if (store) {
      const uniqueSignatures = Array.from(new Set(raw.map((e) => e.layerSig)));
      await Promise.all(uniqueSignatures.map(async (signature) => {
        try {
          const blob = await store.getResource(signature);
          if (blob) resolved.add(signature);
        } catch {
        }
      }));
    }
    const filtered = [];
    let previousSignature = null;
    for (const entry of raw) {
      if (store && !resolved.has(entry.layerSig)) continue;
      if (entry.layerSig === previousSignature) continue;
      filtered.push(entry);
      previousSignature = entry.layerSig;
    }
    return filtered;
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

// src/diamondcoreprocessor.com/history/history-cursor.service.ts
import { EffectBus } from "@hypercomb/core";
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
   *
   * Warms the resource cache in the background for every signature
   * referenced by any historical layer at this location. Undo/redo
   * targets are in memory by the time the user presses the shortcut —
   * no cold load, no empty-texture flash.
   */
  async load(locationSig) {
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!historyService) return;
    this.#layers = await historyService.listLayers(locationSig);
    if (this.#locationSig !== locationSig) {
      this.#locationSig = locationSig;
      this.#cachedLayerSig = null;
      this.#cachedContent = null;
      this.#position = this.#layers.length;
      void this.#warmupHistoricalResources();
    } else if (this.#position > this.#layers.length) {
      this.#position = this.#layers.length;
    }
    this.#emit();
  }
  /**
   * Walk every historical layer at the current location and warm every
   * signature reachable through the layer graph — layer sigs, the
   * propsSigs they reference, the image/layout sigs inside those
   * propsSigs, and so on until fixed-point. Each resolve populates the
   * Store's signature cache, so by the end every past state is in
   * memory. Undo/redo never cold-loads.
   *
   * Traversal is iterative BFS over distinct signatures — a signature
   * is resolved at most once even if it appears in many layers.
   */
  async #warmupHistoricalResources() {
    const store = get("@hypercomb.social/Store");
    if (!store?.resolve) return;
    const visited = /* @__PURE__ */ new Set();
    const frontier = this.#layers.map((entry) => entry.layerSig);
    while (frontier.length > 0) {
      const batch = frontier.splice(0, frontier.length);
      const fresh = batch.filter((signature) => {
        if (visited.has(signature)) return false;
        visited.add(signature);
        return true;
      });
      if (fresh.length === 0) continue;
      const resolved = await Promise.all(
        fresh.map((signature) => store.resolve(signature).catch(() => null))
      );
      const nextSignatures = /* @__PURE__ */ new Set();
      for (const content of resolved) {
        if (content && typeof content === "object") {
          store.collectSignatures(content, nextSignatures);
        }
      }
      for (const signature of nextSignatures) {
        if (!visited.has(signature)) frontier.push(signature);
      }
    }
  }
  /**
   * Called after LayerCommitter appends a new layer. If cursor was at
   * head, stay at head (absorb the new layer). Otherwise keep the
   * rewound position — the user is viewing history.
   *
   * Single emit — no intermediate rewound flash.
   */
  async onNewLayer() {
    const wasAtLatest = this.#position >= this.#layers.length;
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!historyService) return;
    this.#layers = await historyService.listLayers(this.#locationSig);
    if (wasAtLatest) this.#position = this.#layers.length;
    this.#emit();
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
      const parsed = JSON.parse(await blob.text());
      const content = {
        version: 2,
        cells: parsed.cells ?? [],
        hidden: parsed.hidden ?? [],
        contentByCell: parsed.contentByCell ?? {},
        tagsByCell: parsed.tagsByCell ?? {},
        notesByCell: parsed.notesByCell ?? {},
        bees: parsed.bees ?? [],
        dependencies: parsed.dependencies ?? [],
        layoutSig: parsed.layoutSig ?? "",
        instructionsSig: parsed.instructionsSig ?? ""
      };
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
    EffectBus.emit("history:cursor-changed", this.state);
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

// src/diamondcoreprocessor.com/history/history-recorder.drone.ts
import { EffectBus as EffectBus2, SignatureService as SignatureService2 } from "@hypercomb/core";
var HistoryRecorder = class {
  #queue = Promise.resolve();
  constructor() {
    EffectBus2.on("cell:added", (payload) => {
      if (payload?.cell) this.#enqueue("add", payload.cell);
    });
    EffectBus2.on("cell:removed", (payload) => {
      if (payload?.cell) this.#enqueue("remove", payload.cell, payload.groupId);
    });
    EffectBus2.on("tags:changed", (payload) => {
      if (payload?.updates?.length) this.#enqueueTagState(payload.updates);
    });
    EffectBus2.on("cell:reorder", (payload) => {
      if (payload?.labels?.length) this.#enqueueReorderState(payload.labels);
    });
    EffectBus2.on("tile:saved", (payload) => {
      if (payload?.cell) this.#enqueueContentState(payload.cell);
    });
    EffectBus2.on("tile:hidden", (payload) => {
      if (payload?.cell) this.#enqueue("hide", payload.cell);
    });
    EffectBus2.on("tile:unhidden", (payload) => {
      if (payload?.cell) this.#enqueue("unhide", payload.cell);
    });
    EffectBus2.on("bee:disposed", (payload) => {
      if (payload?.iocKey) this.#enqueue("remove-drone", payload.iocKey);
    });
    EffectBus2.on("render:set-orientation", (payload) => {
      if (payload != null) this.#enqueueLayoutState("orientation", payload.flat ? "flat-top" : "point-top");
    });
    EffectBus2.on("render:set-pivot", (payload) => {
      if (payload != null) this.#enqueueLayoutState("pivot", String(payload.pivot));
    });
    EffectBus2.on("overlay:neon-color", (payload) => {
      if (payload?.name) this.#enqueueLayoutState("accent", payload.name);
    });
    EffectBus2.on("render:set-gap", (payload) => {
      if (payload?.gapPx != null) this.#enqueueLayoutState("gap", String(payload.gapPx));
    });
  }
  #enqueue(op, cell, groupId) {
    this.#queue = this.#queue.then(() => this.#recordOp(op, cell, groupId)).catch(() => {
    });
  }
  async #recordOp(op, cell, groupId) {
    const lineage = get("@hypercomb.social/Lineage");
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!lineage || !historyService) return;
    const sig = await historyService.sign(lineage);
    await historyService.record(sig, { op, cell, at: Date.now(), groupId });
  }
  /**
   * Capture tag state as a signature-addressed resource.
   * Reads the FULL tag array from each affected cell's properties (post-change),
   * so reconstruction at any cursor position only needs the last tag-state per cell.
   */
  #enqueueTagState(updates) {
    this.#queue = this.#queue.then(async () => {
      const lineage = get("@hypercomb.social/Lineage");
      const historyService = get("@diamondcoreprocessor.com/HistoryService");
      const store = get("@hypercomb.social/Store");
      if (!lineage || !historyService || !store) return;
      const locationSig = await historyService.sign(lineage);
      const cellTags = {};
      for (const u of updates) {
        if (cellTags[u.cell]) continue;
        try {
          const explorerDir = lineage.explorerDir?.();
          if (explorerDir) {
            const cellDir = await explorerDir.getDirectoryHandle(u.cell, { create: false });
            const fileHandle = await cellDir.getFileHandle("0000");
            const file = await fileHandle.getFile();
            const props = JSON.parse(await file.text());
            cellTags[u.cell] = Array.isArray(props.tags) ? props.tags : [];
          }
        } catch {
          cellTags[u.cell] = [];
        }
      }
      const snapshot = {
        version: 1,
        cellTags,
        at: Date.now()
      };
      const json = JSON.stringify(snapshot, Object.keys(snapshot).sort(), 0);
      const blob = new Blob([json], { type: "application/json" });
      const bytes = await blob.arrayBuffer();
      const resourceSig = await SignatureService2.sign(bytes);
      await store.putResource(blob);
      await historyService.record(locationSig, {
        op: "tag-state",
        cell: resourceSig,
        at: snapshot.at
      });
    }).catch(() => {
    });
  }
  /**
   * Capture reorder state as a signature-addressed resource.
   * Records a `reorder` op whose `cell` field is the resource signature
   * pointing to the ordered cell list at reorder time.
   */
  #enqueueReorderState(labels) {
    this.#queue = this.#queue.then(async () => {
      const lineage = get("@hypercomb.social/Lineage");
      const historyService = get("@diamondcoreprocessor.com/HistoryService");
      const store = get("@hypercomb.social/Store");
      if (!lineage || !historyService || !store) return;
      const locationSig = await historyService.sign(lineage);
      const payload = JSON.stringify(labels);
      const blob = new Blob([payload], { type: "application/json" });
      await store.putResource(blob);
      const bytes = await blob.arrayBuffer();
      const resourceSig = await SignatureService2.sign(bytes);
      await historyService.record(locationSig, {
        op: "reorder",
        cell: resourceSig,
        at: Date.now()
      });
    }).catch(() => {
    });
  }
  /**
   * Capture content state as a signature-addressed resource.
   * Records the properties signature from the tile-props-index so that
   * point-in-time reconstruction can load the exact content at save time.
   */
  #enqueueContentState(cellLabel) {
    this.#queue = this.#queue.then(async () => {
      const lineage = get("@hypercomb.social/Lineage");
      const historyService = get("@diamondcoreprocessor.com/HistoryService");
      const store = get("@hypercomb.social/Store");
      if (!lineage || !historyService || !store) return;
      const locationSig = await historyService.sign(lineage);
      const indexKey = "hc:tile-props-index";
      const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
      const propertiesSig = index[cellLabel] ?? "";
      const snapshot = {
        version: 1,
        cellLabel,
        propertiesSig,
        at: Date.now()
      };
      const json = JSON.stringify(snapshot, Object.keys(snapshot).sort(), 0);
      const blob = new Blob([json], { type: "application/json" });
      const bytes = await blob.arrayBuffer();
      const resourceSig = await SignatureService2.sign(bytes);
      await store.putResource(blob);
      await historyService.record(locationSig, {
        op: "content-state",
        cell: resourceSig,
        at: snapshot.at
      });
    }).catch(() => {
    });
  }
  /**
   * Capture layout state as a signature-addressed resource.
   * Records layout property changes (mode, orientation, pivot, gap) as
   * snapshots for point-in-time reconstruction.
   */
  #enqueueLayoutState(property, value) {
    this.#queue = this.#queue.then(async () => {
      const lineage = get("@hypercomb.social/Lineage");
      const historyService = get("@diamondcoreprocessor.com/HistoryService");
      const store = get("@hypercomb.social/Store");
      if (!lineage || !historyService || !store) return;
      const locationSig = await historyService.sign(lineage);
      const snapshot = {
        version: 1,
        property,
        value,
        at: Date.now()
      };
      const json = JSON.stringify(snapshot, Object.keys(snapshot).sort(), 0);
      const blob = new Blob([json], { type: "application/json" });
      const bytes = await blob.arrayBuffer();
      const resourceSig = await SignatureService2.sign(bytes);
      await store.putResource(blob);
      await historyService.record(locationSig, {
        op: "layout-state",
        cell: resourceSig,
        at: snapshot.at
      });
    }).catch(() => {
    });
  }
};
var _historyRecorder = new HistoryRecorder();
window.ioc.register("@diamondcoreprocessor.com/HistoryRecorder", _historyRecorder);
export {
  HistoryRecorder
};
