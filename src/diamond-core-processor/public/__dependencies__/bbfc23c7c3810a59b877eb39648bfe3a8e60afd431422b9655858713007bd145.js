// @diamondcoreprocessor.com/history
// src/diamondcoreprocessor.com/history/history-cursor.service.ts
import { EffectBus } from "@hypercomb/core";
var HistoryCursorService = class extends EventTarget {
  #locationSig = "";
  #position = 0;
  #total = 0;
  #allOps = [];
  get state() {
    const op = this.#position > 0 ? this.#allOps[this.#position - 1] : null;
    return {
      locationSig: this.#locationSig,
      position: this.#position,
      total: this.#total,
      rewound: this.#total > 0 && this.#position < this.#total,
      at: op?.at ?? 0
    };
  }
  /**
   * Load (or reload) history for a location.
   * Resets cursor to latest unless it was already set for this sig.
   */
  async load(locationSig) {
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!historyService) return;
    const ops = await historyService.replay(locationSig);
    this.#allOps = ops;
    this.#total = ops.length;
    if (this.#locationSig !== locationSig) {
      this.#locationSig = locationSig;
      this.#position = this.#total;
    } else if (this.#position > this.#total) {
      this.#position = this.#total;
    }
    this.#emit();
  }
  /**
   * Called when a new op is appended (e.g. by HistoryRecorder).
   * If cursor was at the latest, keep it at the latest.
   */
  async onNewOp() {
    const wasAtLatest = this.#position >= this.#total;
    await this.load(this.#locationSig);
    if (wasAtLatest) {
      this.#position = this.#total;
      this.#emit();
    }
  }
  /** Move cursor to an absolute position (1-based, clamped). */
  seek(position) {
    const clamped = Math.max(0, Math.min(position, this.#total));
    if (clamped === this.#position) return;
    this.#position = clamped;
    this.#emit();
  }
  /** Step backward one op. */
  undo() {
    this.seek(this.#position - 1);
  }
  /** Step forward one op. */
  redo() {
    this.seek(this.#position + 1);
  }
  /** Jump to latest (exit rewind mode). */
  jumpToLatest() {
    this.seek(this.#total);
  }
  /**
   * Promote the state at the current cursor position to head.
   * Computes the diff (cursor-state vs head-state), writes the
   * necessary add / remove ops, then a reorder op to preserve
   * the display order at cursor time. Cursor jumps to new head.
   */
  async promote() {
    if (!this.state.rewound) return;
    if (this.#allOps.length === 0) return;
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!historyService) return;
    const cursorSeeds = [];
    const cursorSeedSet = /* @__PURE__ */ new Set();
    for (let i = 0; i < this.#position; i++) {
      const op = this.#allOps[i];
      if (op.op === "add") {
        if (!cursorSeedSet.has(op.seed)) {
          cursorSeedSet.add(op.seed);
          cursorSeeds.push(op.seed);
        }
      } else if (op.op === "remove") {
        cursorSeedSet.delete(op.seed);
        const idx = cursorSeeds.indexOf(op.seed);
        if (idx !== -1) cursorSeeds.splice(idx, 1);
      }
    }
    const headSeedSet = /* @__PURE__ */ new Set();
    for (const op of this.#allOps) {
      if (op.op === "add") headSeedSet.add(op.seed);
      else if (op.op === "remove") headSeedSet.delete(op.seed);
    }
    const now = Date.now();
    for (const seed of headSeedSet) {
      if (!cursorSeedSet.has(seed)) {
        await historyService.record(this.#locationSig, { op: "remove", seed, at: now });
      }
    }
    for (const seed of cursorSeedSet) {
      if (!headSeedSet.has(seed)) {
        await historyService.record(this.#locationSig, { op: "add", seed, at: now });
      }
    }
    if (cursorSeeds.length > 0) {
      const store = get("@hypercomb.social/Store");
      if (store) {
        const payload = JSON.stringify(cursorSeeds);
        const payloadSig = await store.putResource(new Blob([payload]));
        await historyService.record(this.#locationSig, { op: "reorder", seed: payloadSig, at: now });
      }
    }
    const orderProjection = get("@diamondcoreprocessor.com/OrderProjection");
    if (orderProjection?.evict) orderProjection.evict(this.#locationSig);
    await this.load(this.#locationSig);
    this.#position = this.#total;
    this.#emit();
  }
  /**
   * Compute divergence info: which seeds are current vs future.
   * Used by ShowCellDrone to decide ghost overlays.
   */
  computeDivergence() {
    const current = /* @__PURE__ */ new Set();
    const futureAdds = /* @__PURE__ */ new Set();
    const futureRemoves = /* @__PURE__ */ new Set();
    if (this.#allOps.length === 0) {
      return { current, futureAdds, futureRemoves };
    }
    const seedStateAtCursor = /* @__PURE__ */ new Map();
    for (let i = 0; i < this.#position; i++) {
      const op = this.#allOps[i];
      if (op.op === "add" || op.op === "remove") {
        seedStateAtCursor.set(op.seed, op.op);
      }
    }
    for (const [seed, lastOp] of seedStateAtCursor) {
      if (lastOp !== "remove") current.add(seed);
    }
    if (this.#position >= this.#total) {
      return { current, futureAdds, futureRemoves };
    }
    const seedStateAtEnd = new Map(seedStateAtCursor);
    for (let i = this.#position; i < this.#total; i++) {
      const op = this.#allOps[i];
      if (op.op === "add" || op.op === "remove") {
        seedStateAtEnd.set(op.seed, op.op);
      }
    }
    for (const [seed, lastOp] of seedStateAtEnd) {
      const existsAtCursor = current.has(seed);
      const existsAtEnd = lastOp !== "remove";
      if (!existsAtCursor && existsAtEnd) {
        futureAdds.add(seed);
      } else if (existsAtCursor && !existsAtEnd) {
        futureRemoves.add(seed);
      }
    }
    return { current, futureAdds, futureRemoves };
  }
  #emit() {
    this.dispatchEvent(new CustomEvent("change"));
    EffectBus.emit("history:cursor-changed", this.state);
  }
};
var _historyCursorService = new HistoryCursorService();
window.ioc.register("@diamondcoreprocessor.com/HistoryCursorService", _historyCursorService);

// src/diamondcoreprocessor.com/history/history.service.ts
import { SignatureService } from "@hypercomb/core";
var HistoryService = class _HistoryService {
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
    const parts = [space, domain, lineagePath, secret, "seed"].filter(Boolean);
    const key = parts.join("/");
    const sigStore = get("@hypercomb/SignatureStore");
    return sigStore ? await sigStore.signText(key) : await SignatureService.sign(new TextEncoder().encode(key).buffer);
  };
  /**
   * Record an operation into the history bag for the given signature.
   * Appends a sequential file (00000001, 00000002, ...) with JSON content.
   */
  record = async (signature, operation) => {
    const bag = await this.getBag(signature);
    const nextIndex = await this.nextIndex(bag);
    const fileName = String(nextIndex).padStart(8, "0");
    const fileHandle = await bag.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(operation));
    await writable.close();
  };
  /**
   * Replay all operations in a bag, in order.
   * If upTo is provided, stop at that index (inclusive).
   */
  replay = async (signature, upTo) => {
    const root = this.historyRoot;
    let bag;
    try {
      bag = await root.getDirectoryHandle(signature, { create: false });
    } catch {
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
    }
    return { added, removed };
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

// src/diamondcoreprocessor.com/history/order-projection.ts
import { EffectBus as EffectBus2 } from "@hypercomb/core";
var OrderProjection = class {
  #cache = /* @__PURE__ */ new Map();
  #currentSig = null;
  constructor() {
    EffectBus2.on("seed:added", (payload) => {
      if (!payload?.seed || !this.#currentSig) return;
      const order = this.#cache.get(this.#currentSig);
      if (order && !order.includes(payload.seed)) {
        order.push(payload.seed);
      }
    });
    EffectBus2.on("seed:removed", (payload) => {
      if (!payload?.seed || !this.#currentSig) return;
      const order = this.#cache.get(this.#currentSig);
      if (order) {
        const idx = order.indexOf(payload.seed);
        if (idx !== -1) order.splice(idx, 1);
      }
    });
  }
  /**
   * Replay history for a location, build order, cache and return it.
   * Sets this location as the "current" for effect-driven updates.
   */
  async hydrate(locationSig) {
    this.#currentSig = locationSig;
    const cached = this.#cache.get(locationSig);
    if (cached) return cached;
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!historyService) return [];
    const ops = await historyService.replay(locationSig);
    const order = await this.#buildOrder(ops);
    this.#cache.set(locationSig, order);
    return order;
  }
  /**
   * Write a reorder op to history and update the in-memory cache.
   * Stores the ordered seed list as a content-addressed resource.
   */
  async reorder(seeds) {
    if (!this.#currentSig) return seeds;
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    const store = get("@hypercomb.social/Store");
    if (!historyService || !store) return seeds;
    const payload = JSON.stringify(seeds);
    const payloadSig = await store.putResource(new Blob([payload]));
    await historyService.record(this.#currentSig, {
      op: "reorder",
      seed: payloadSig,
      at: Date.now()
    });
    const copy = [...seeds];
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
   * - add → append seed (if not present)
   * - remove → remove seed from list
   * - reorder → resolve payload from resources, replace list
   */
  async #buildOrder(ops) {
    const store = get("@hypercomb.social/Store");
    let order = [];
    for (const op of ops) {
      switch (op.op) {
        case "add":
          if (!order.includes(op.seed)) order.push(op.seed);
          break;
        case "remove":
          order = order.filter((s) => s !== op.seed);
          break;
        case "reorder":
          if (store) {
            const blob = await store.getResource(op.seed);
            if (blob) {
              try {
                const parsed = JSON.parse(await blob.text());
                if (Array.isArray(parsed)) order = parsed;
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
import { QueenBee, EffectBus as EffectBus3 } from "@hypercomb/core";
var ReviseQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  command = "revise";
  aliases = ["rev", "history"];
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
    EffectBus3.emit("revise:mode-changed", { active: true });
    console.log("[/revise] Revision mode ON \u2014 scrub the clock, Restore to promote.");
  }
  #exit() {
    const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
    if (cursor?.state.rewound) {
      cursor.jumpToLatest();
    }
    this.#active = false;
    EffectBus3.emit("revise:mode-changed", { active: false });
    console.log("[/revise] Revision mode OFF \u2014 back to head.");
  }
};
var _revise = new ReviseQueenBee();
window.ioc.register("@diamondcoreprocessor.com/ReviseQueenBee", _revise);
export {
  HistoryCursorService,
  HistoryService,
  OrderProjection,
  ReviseQueenBee
};
