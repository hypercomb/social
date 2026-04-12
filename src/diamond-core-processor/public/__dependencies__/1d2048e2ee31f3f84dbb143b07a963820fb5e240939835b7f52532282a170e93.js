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
   * Restores persisted cursor position when entering a location,
   * so undo/redo state survives page refresh.
   */
  async load(locationSig) {
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!historyService) return;
    const ops = await historyService.replay(locationSig);
    this.#allOps = ops;
    this.#total = ops.length;
    if (this.#locationSig !== locationSig) {
      this.#locationSig = locationSig;
      const clock = get("@diamondcoreprocessor.com/GlobalTimeClock");
      if (clock?.active && clock.timestamp !== null) {
        this.seekToTime(clock.timestamp);
        return;
      }
      const saved = this.#loadPersistedPosition(locationSig);
      if (saved !== null && saved < this.#total) {
        this.#position = saved;
      } else {
        this.#position = this.#total;
      }
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
    if (this.#position <= 0) return;
    let i = this.#position - 1;
    const groupKey = this.#groupKeyForIndex(i);
    while (i >= 0 && this.#groupKeyForIndex(i) === groupKey) i--;
    this.seek(i + 1);
  }
  /** Step forward one op. */
  redo() {
    if (this.#position >= this.#total) return;
    let i = this.#position;
    const groupKey = this.#groupKeyForIndex(i);
    while (i < this.#total && this.#groupKeyForIndex(i) === groupKey) i++;
    this.seek(i);
  }
  /** Jump to latest (exit rewind mode). */
  jumpToLatest() {
    this.seek(this.#total);
  }
  /**
   * Seek to the last op at or before the given timestamp.
   * Returns the position it landed on (0 if no ops before timestamp).
   */
  seekToTime(timestamp) {
    if (this.#allOps.length === 0) return 0;
    let pos = 0;
    for (let i = 0; i < this.#allOps.length; i++) {
      if (this.#allOps[i].at <= timestamp) {
        pos = i + 1;
      } else {
        break;
      }
    }
    this.seek(pos);
    return pos;
  }
  /**
   * Get all operation timestamps for this location's bag.
   * Used by GlobalTimeClock for stepping across locations.
   */
  get allTimestamps() {
    return this.#allOps.map((op) => op.at);
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
    const cursorCells = [];
    const cursorCellSet = /* @__PURE__ */ new Set();
    for (let i = 0; i < this.#position; i++) {
      const op = this.#allOps[i];
      if (op.op === "add") {
        if (!cursorCellSet.has(op.cell)) {
          cursorCellSet.add(op.cell);
          cursorCells.push(op.cell);
        }
      } else if (op.op === "remove") {
        cursorCellSet.delete(op.cell);
        const idx = cursorCells.indexOf(op.cell);
        if (idx !== -1) cursorCells.splice(idx, 1);
      }
    }
    const headCellSet = /* @__PURE__ */ new Set();
    for (const op of this.#allOps) {
      if (op.op === "add") headCellSet.add(op.cell);
      else if (op.op === "remove") headCellSet.delete(op.cell);
    }
    const now = Date.now();
    for (const cell of headCellSet) {
      if (!cursorCellSet.has(cell)) {
        await historyService.record(this.#locationSig, { op: "remove", cell, at: now });
      }
    }
    for (const cell of cursorCellSet) {
      if (!headCellSet.has(cell)) {
        await historyService.record(this.#locationSig, { op: "add", cell, at: now });
      }
    }
    if (cursorCells.length > 0) {
      const store = get("@hypercomb.social/Store");
      if (store) {
        const payload = JSON.stringify(cursorCells);
        const payloadSig = await store.putResource(new Blob([payload]));
        await historyService.record(this.#locationSig, { op: "reorder", cell: payloadSig, at: now });
      }
    }
    const orderProjection = get("@diamondcoreprocessor.com/OrderProjection");
    if (orderProjection?.evict) orderProjection.evict(this.#locationSig);
    await this.load(this.#locationSig);
    this.#position = this.#total;
    this.#emit();
    EffectBus2.emit("history:promoted", {
      locationSig: this.#locationSig,
      reconciledOrder: cursorCells,
      survivingCells: [...cursorCellSet]
    });
  }
  /**
   * Compute divergence info: which cells are current vs future.
   * Used by ShowCellDrone to decide ghost overlays.
   */
  computeDivergence() {
    const current = /* @__PURE__ */ new Set();
    const futureAdds = /* @__PURE__ */ new Set();
    const futureRemoves = /* @__PURE__ */ new Set();
    const hiddenAtCursor = /* @__PURE__ */ new Set();
    if (this.#allOps.length === 0) {
      return { current, futureAdds, futureRemoves, hiddenAtCursor };
    }
    const cellStateAtCursor = /* @__PURE__ */ new Map();
    for (let i = 0; i < this.#position; i++) {
      const op = this.#allOps[i];
      if (op.op === "add" || op.op === "remove") {
        cellStateAtCursor.set(op.cell, op.op);
      } else if (op.op === "hide") {
        hiddenAtCursor.add(op.cell);
      } else if (op.op === "unhide") {
        hiddenAtCursor.delete(op.cell);
      }
    }
    for (const [cell, lastOp] of cellStateAtCursor) {
      if (lastOp !== "remove") current.add(cell);
    }
    if (this.#position >= this.#total) {
      return { current, futureAdds, futureRemoves, hiddenAtCursor };
    }
    const cellStateAtEnd = new Map(cellStateAtCursor);
    for (let i = this.#position; i < this.#total; i++) {
      const op = this.#allOps[i];
      if (op.op === "add" || op.op === "remove") {
        cellStateAtEnd.set(op.cell, op.op);
      }
    }
    for (const [cell, lastOp] of cellStateAtEnd) {
      const existsAtCursor = current.has(cell);
      const existsAtEnd = lastOp !== "remove";
      if (!existsAtCursor && existsAtEnd) {
        futureAdds.add(cell);
      } else if (existsAtCursor && !existsAtEnd) {
        futureRemoves.add(cell);
      }
    }
    return { current, futureAdds, futureRemoves, hiddenAtCursor };
  }
  /**
   * Collect all tag-state resource signatures up to cursor position.
   * Returns the signatures in order — the caller resolves them to get
   * cumulative tag state at cursor time.
   *
   * Reconstruction: walk the returned sigs, each resolves to
   * { version, cellTags: Record<cellLabel, string[]>, at }.
   * Last write wins per cell — build a Map<cellLabel, string[]>.
   */
  collectTagStateSignatures() {
    const sigs = [];
    for (let i = 0; i < this.#position; i++) {
      const op = this.#allOps[i];
      if (op.op === "tag-state") sigs.push(op.cell);
    }
    return sigs;
  }
  /**
   * Collect the last content-state resource signature per cell up to cursor position.
   * Returns Map<cellLabel, resourceSig> — the caller resolves each sig to get
   * { version, cellLabel, propertiesSig, at }.
   *
   * The propertiesSig points to the cell's properties resource at that moment.
   */
  collectContentStateSignatures() {
    const lastSigPerCell = /* @__PURE__ */ new Map();
    for (let i = 0; i < this.#position; i++) {
      const op = this.#allOps[i];
      if (op.op === "content-state") {
        lastSigPerCell.set(`__idx_${i}`, op.cell);
      }
    }
    return lastSigPerCell;
  }
  /**
   * Replay add/remove/reorder ops up to cursor position to derive
   * the correct display order at cursor time.
   * Reorder payloads are resolved from the content-addressed store.
   */
  async buildOrderAtCursor() {
    const store = get("@hypercomb.social/Store");
    let order = [];
    for (let i = 0; i < this.#position; i++) {
      const op = this.#allOps[i];
      switch (op.op) {
        case "add":
          if (!order.includes(op.cell)) order.push(op.cell);
          break;
        case "remove":
          order = order.filter((s) => s !== op.cell);
          break;
        case "reorder":
          if (store) {
            try {
              const blob = await store.getResource(op.cell);
              if (blob) {
                const parsed = JSON.parse(await blob.text());
                if (Array.isArray(parsed)) order = parsed;
              }
            } catch {
            }
          }
          break;
        case "rename":
          if (store) {
            try {
              const blob = await store.getResource(op.cell);
              if (blob) {
                const parsed = JSON.parse(await blob.text());
                if (parsed?.oldName && parsed?.newName) {
                  const idx = order.indexOf(parsed.oldName);
                  if (idx !== -1) order[idx] = parsed.newName;
                }
              }
            } catch {
            }
          }
          break;
      }
    }
    return order;
  }
  /**
   * Get all ops up to cursor position, filtered by type.
   * Generic method for any op type that needs reconstruction.
   */
  opsAtCursor(opType) {
    const ops = [];
    for (let i = 0; i < this.#position; i++) {
      const op = this.#allOps[i];
      if (!opType || op.op === opType) ops.push(op);
    }
    return ops;
  }
  #emit() {
    this.#persistPosition();
    this.dispatchEvent(new CustomEvent("change"));
    EffectBus2.emit("history:cursor-changed", this.state);
  }
  // ── Cursor persistence (localStorage) ─────────��───────────
  static #STORAGE_PREFIX = "hc:history-cursor:";
  #persistPosition() {
    if (!this.#locationSig) return;
    const key = _HistoryCursorService.#STORAGE_PREFIX + this.#locationSig;
    if (this.#position >= this.#total) {
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
  #groupKeyForIndex(index) {
    const op = this.#allOps[index];
    const groupId = String(op?.groupId ?? "").trim();
    if (groupId.length > 0) return `g:${groupId}`;
    return `i:${index}`;
  }
};
var _historyCursorService = new HistoryCursorService();
window.ioc.register("@diamondcoreprocessor.com/HistoryCursorService", _historyCursorService);

// src/diamondcoreprocessor.com/history/history.service.ts
import { SignatureService } from "@hypercomb/core";
var HistoryService = class _HistoryService {
  // Signatures currently being promoted — prevents recursion when promote() calls record()
  #promoting = /* @__PURE__ */ new Set();
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
   * If the cursor for this location is rewound, promotes the cursor state to
   * head first (creating a new branch from the rewound point) before recording.
   */
  record = async (signature, operation) => {
    if (!this.#promoting.has(signature)) {
      const cursorService = get(
        "@diamondcoreprocessor.com/HistoryCursorService"
      );
      if (cursorService?.state.rewound && cursorService.state.locationSig === signature) {
        this.#promoting.add(signature);
        try {
          await cursorService.promote();
        } finally {
          this.#promoting.delete(signature);
        }
      }
    }
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
  ReviseQueenBee
};
