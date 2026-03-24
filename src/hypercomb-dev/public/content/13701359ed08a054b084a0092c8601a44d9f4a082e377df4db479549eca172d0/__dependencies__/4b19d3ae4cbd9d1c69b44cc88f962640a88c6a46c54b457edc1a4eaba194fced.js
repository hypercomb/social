// @diamondcoreprocessor.com/history
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
   * Matches the same signing scheme as ShowHoneycombWorker.
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
import { EffectBus } from "@hypercomb/core";
var OrderProjection = class {
  #cache = /* @__PURE__ */ new Map();
  #currentSig = null;
  constructor() {
    EffectBus.on("seed:added", (payload) => {
      if (!payload?.seed || !this.#currentSig) return;
      const order = this.#cache.get(this.#currentSig);
      if (order && !order.includes(payload.seed)) {
        order.push(payload.seed);
      }
    });
    EffectBus.on("seed:removed", (payload) => {
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
export {
  HistoryService,
  OrderProjection
};
