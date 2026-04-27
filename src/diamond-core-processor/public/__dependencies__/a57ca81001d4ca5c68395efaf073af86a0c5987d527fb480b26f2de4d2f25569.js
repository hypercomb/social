// @diamondcoreprocessor.com/history
// src/diamondcoreprocessor.com/history/collapse-history.queen.ts
import { QueenBee } from "@hypercomb/core";
var CollapseHistoryQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  genotype = "history";
  command = "collapse-history";
  aliases = ["collapse-histories", "squash-history"];
  description = "Delete all non-head history entries across every location (dev utility)";
  execute(_args) {
    void this.#collapse();
  }
  async #collapse() {
    const store = get("@hypercomb.social/Store");
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!store?.history || !history) {
      console.warn("[/collapse-history] Store or HistoryService not available");
      return;
    }
    let bags = 0;
    let removed = 0;
    for await (const [lineageSig, bag] of store.history.entries()) {
      if (bag.kind !== "directory") continue;
      bags++;
      const entries = await history.listLayers(lineageSig);
      if (entries.length <= 1) continue;
      const keep = entries[entries.length - 1];
      const toDelete = entries.filter((e) => e.filename !== keep.filename).map((e) => e.filename);
      removed += await history.removeEntries(lineageSig, toDelete);
    }
    let cleared = 0;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith("hc:cursor-position:")) {
        localStorage.removeItem(key);
        cleared++;
      }
    }
    console.log(
      `[/collapse-history] ${bags} bag(s); removed ${removed} non-head layer entries; cleared ${cleared} cursor positions. Reloading\u2026`
    );
    setTimeout(() => location.reload(), 50);
  }
};
var _collapseHistory = new CollapseHistoryQueenBee();
window.ioc.register("@diamondcoreprocessor.com/CollapseHistoryQueenBee", _collapseHistory);

// src/diamondcoreprocessor.com/history/delta-record.ts
var NAME_MAX_LEN = 256;
var SIG_RE = /^[a-f0-9]{64}$/;
function canonicalise(record) {
  if (typeof record?.name !== "string" || record.name.length === 0) {
    throw new Error("DeltaRecord: name is required");
  }
  if (record.name.length > NAME_MAX_LEN) {
    throw new Error(`DeltaRecord: name exceeds ${NAME_MAX_LEN} chars`);
  }
  const opKeys = Object.keys(record).filter((k) => k !== "name").sort();
  const lines = [record.name];
  for (const op of opKeys) {
    const value = record[op];
    const sigs = extractSigs(value);
    if (sigs.length === 0) {
      lines.push(op);
    } else {
      const sortedSigs = [...sigs].sort();
      lines.push(`${op} ${sortedSigs.join(" ")}`);
    }
  }
  return lines.join("\n");
}
function parse(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  const lines = text.split("\n");
  const name = lines[0]?.trim();
  if (!name || name.length > NAME_MAX_LEN) return null;
  const out = { name };
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;
    const tokens = raw.split(" ").filter((t) => t.length > 0);
    if (tokens.length === 0) continue;
    const op = tokens[0];
    if (op === "name") continue;
    const sigs = tokens.slice(1).filter((t) => SIG_RE.test(t));
    out[op] = sigs;
  }
  return out;
}
function canonicalBytes(record) {
  return new TextEncoder().encode(canonicalise(record));
}
function extractSigs(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((s) => typeof s === "string" && SIG_RE.test(s));
  }
  if (typeof value === "string") {
    return SIG_RE.test(value) ? [value] : [];
  }
  return [];
}
function isSig(value) {
  return typeof value === "string" && SIG_RE.test(value);
}

// src/diamondcoreprocessor.com/history/delta-reducer.ts
function reduce(records) {
  const cells = /* @__PURE__ */ new Set();
  const hidden = /* @__PURE__ */ new Set();
  for (const record of records) {
    if (!record) continue;
    const opKeys = Object.keys(record).filter((k) => k !== "name");
    if (opKeys.length === 0) {
      cells.add(record.name);
      continue;
    }
    for (const op of opKeys) {
      switch (op) {
        case "remove":
          cells.delete(record.name);
          hidden.delete(record.name);
          break;
        case "hide":
          hidden.add(record.name);
          break;
        case "show":
          hidden.delete(record.name);
          break;
      }
    }
  }
  return { cells, hidden };
}

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

// src/diamondcoreprocessor.com/history/layer-diff.ts
var diffLayers = (prev, next) => {
  const prevChildren = prev?.children ?? [];
  const nextChildren = next.children ?? [];
  const diffs = [];
  const prevSet = new Set(prevChildren);
  const nextSet = new Set(nextChildren);
  for (const c of nextChildren) if (!prevSet.has(c)) diffs.push({ kind: "cell-added", cell: c });
  for (const c of prevChildren) if (!nextSet.has(c)) diffs.push({ kind: "cell-removed", cell: c });
  if (setEquals(prevSet, nextSet) && !sequenceEquals(prevChildren, nextChildren)) {
    diffs.push({ kind: "cells-reordered", from: [...prevChildren], to: [...nextChildren] });
  }
  const prevSlotKeys = prev ? Object.keys(prev).filter((k) => k !== "name" && k !== "children") : [];
  const nextSlotKeys = Object.keys(next).filter((k) => k !== "name" && k !== "children");
  const slotKeys = /* @__PURE__ */ new Set([...prevSlotKeys, ...nextSlotKeys]);
  for (const key of [...slotKeys].sort()) {
    const a = prev?.[key];
    const b = next[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push({ kind: "slot-changed", slot: key, from: a, to: b });
    }
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

// src/diamondcoreprocessor.com/history/history-cursor.service.ts
var HistoryCursorService = class _HistoryCursorService extends EventTarget {
  #locationSig = "";
  #position = 0;
  #layers = [];
  // Last-fetched layer content, keyed by layer signature
  #cachedLayerSig = null;
  #cachedContent = null;
  // Per-signature content cache used by group-step walking so repeated
  // undo/redo presses never re-read OPFS for the same layer.
  #contentBySig = /* @__PURE__ */ new Map();
  #groupStepEnabled = _HistoryCursorService.#loadGroupStep();
  get state() {
    const entry = this.#position > 0 ? this.#layers[this.#position - 1] : null;
    return {
      locationSig: this.#locationSig,
      position: this.#position,
      total: this.#layers.length,
      rewound: this.#layers.length > 0 && this.#position < this.#layers.length,
      at: entry?.at ?? 0,
      groupStepEnabled: this.#groupStepEnabled
    };
  }
  /** Sig of the marker file at the current cursor position, or '' when none. */
  get currentLayerSig() {
    const entry = this.#position > 0 ? this.#layers[this.#position - 1] : null;
    return entry?.layerSig ?? "";
  }
  get groupStepEnabled() {
    return this.#groupStepEnabled;
  }
  setGroupStepEnabled(on) {
    const next = !!on;
    if (next === this.#groupStepEnabled) return;
    this.#groupStepEnabled = next;
    _HistoryCursorService.#saveGroupStep(next);
    this.#emit();
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
    if (!locationSig || typeof locationSig !== "string" || locationSig.length < 8) return;
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!historyService) return;
    const preloadable = historyService;
    if (preloadable.preloadAllBags) await preloadable.preloadAllBags();
    this.#layers = await historyService.listLayers(locationSig);
    if (this.#layers.length === 0) {
      const committer = get(
        "@diamondcoreprocessor.com/LayerCommitter"
      );
      if (committer?.bootstrapIfEmpty) {
        try {
          await committer.bootstrapIfEmpty();
          this.#layers = await historyService.listLayers(locationSig);
        } catch {
        }
      }
    }
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
   * Externally-triggered refresh for a given lineage. Called by
   * LayerCommitter immediately after every bootstrap (whether the
   * bootstrap committed or skipped because the bag was already
   * populated). Solves the race where the cursor was loaded BEFORE
   * markers existed and never re-read after they appeared.
   *
   * Adoption: if cursor has no locationSig yet, we adopt the one we
   * were called with — this lets the committer's auto-bootstrap
   * (which runs from Lineage 'change' before any cursor.load) prime
   * the cursor with the right lineage immediately.
   *
   * If cursor is currently bound to a different lineage, this is a
   * no-op — the user navigated away.
   */
  async refreshForLocation(locSig) {
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!historyService) return;
    if (this.#locationSig && this.#locationSig !== locSig) return;
    const fresh = await historyService.listLayers(locSig);
    const sameSig = this.#locationSig === locSig;
    const sameLength = this.#layers.length === fresh.length;
    const sameHead = sameLength && fresh.length > 0 && this.#layers[fresh.length - 1].layerSig === fresh[fresh.length - 1].layerSig;
    if (sameSig && sameLength && (fresh.length === 0 || sameHead)) {
      return;
    }
    const wasAtLatest = this.#position >= this.#layers.length;
    const adopted = !this.#locationSig;
    if (adopted) this.#locationSig = locSig;
    this.#layers = fresh;
    if (wasAtLatest || adopted) this.#position = this.#layers.length;
    this.#emit();
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
  /**
   * Move cursor to an absolute position (1-based, clamped).
   *
   * Position 0 is the pre-history / empty state. Layers exist above it;
   * undo can walk all the way back to 0 so the user returns to the
   * default. At 0, layerContentAtCursor() returns an empty snapshot and
   * the renderer clears the grid.
   */
  seek(position) {
    const clamped = Math.max(0, Math.min(position, this.#layers.length));
    if (clamped === this.#position) return;
    this.#position = clamped;
    this.#emit();
  }
  /**
   * Step backward. Minimal step (one layer) by default; when group-step is
   * on, skip edit-only layers and land on the earliest cell add/remove in
   * the preceding group. Walks all the way down to position 0 (empty
   * pre-history state).
   */
  undo() {
    if (this.#groupStepEnabled) {
      void this.#undoGroupStep();
      return;
    }
    if (this.#position > 0) this.seek(this.#position - 1);
  }
  /**
   * Step forward. Minimal step by default; when group-step is on, skip
   * edit-only layers and land on the earliest cell add/remove of the next
   * group.
   */
  redo() {
    if (this.#groupStepEnabled) {
      void this.#redoGroupStep();
      return;
    }
    if (this.#position < this.#layers.length) this.seek(this.#position + 1);
  }
  /**
   * Group-step undo. Walk backward from the current position skipping
   * edit-only layers (content, tags, notes, layout). When a cell
   * add/remove is hit, land there — then continue walking back while
   * the preceding layer is ALSO a cell-op AND its timestamp is within
   * GROUP_TIME_WINDOW_MS. That coalesces a multi-select burst (N tiles
   * added in one gesture = N adjacent cell-op layers ~microseconds
   * apart) into a single jump, but keeps separate gestures on separate
   * groups even when they're both cell ops.
   */
  async #undoGroupStep() {
    if (this.#position <= 0) return;
    let target = this.#position - 1;
    while (target >= 1 && !await this.#isCellsAtPosition(target)) {
      target -= 1;
    }
    if (target < 1) {
      this.seek(0);
      return;
    }
    while (target > 1 && await this.#inSameCellsBurst(target)) {
      target -= 1;
    }
    this.seek(target);
  }
  /**
   * Group-step redo. Walk forward skipping edit-only layers until we hit
   * a cell add/remove. That position IS the earliest of the next burst
   * (we just crossed the boundary into it); further redoes step past the
   * rest of the burst.
   */
  async #redoGroupStep() {
    const total = this.#layers.length;
    if (this.#position >= total) return;
    let target = this.#position + 1;
    while (target <= total && !await this.#isCellsAtPosition(target)) {
      target += 1;
    }
    if (target > total) {
      this.seek(total);
      return;
    }
    this.seek(target);
  }
  /**
   * True when both the layer at `position` and the layer at `position-1`
   * are cell add/remove layers AND their timestamps are within the group
   * burst window. This is how we distinguish "multi-select added 3 tiles
   * in one gesture" (all adjacent in time) from "user added a tile
   * earlier, then added another one ten seconds later" (same kind of op,
   * different gestures).
   */
  async #inSameCellsBurst(position) {
    if (position < 2) return false;
    const current = this.#layers[position - 1];
    const previous = this.#layers[position - 2];
    if (!current || !previous) return false;
    if (Math.abs(current.at - previous.at) > _HistoryCursorService.#GROUP_BURST_WINDOW_MS) return false;
    if (!await this.#isCellsAtPosition(position)) return false;
    if (!await this.#isCellsAtPosition(position - 1)) return false;
    return true;
  }
  /**
   * True when the layer at the given 1-based cursor position introduces
   * or removes a cell relative to the preceding layer (or relative to
   * empty, for the first-ever layer).
   */
  async #isCellsAtPosition(position) {
    if (position < 1 || position > this.#layers.length) return false;
    const currentSig = this.#layers[position - 1].layerSig;
    const currentContent = await this.#loadContentForSig(currentSig);
    if (!currentContent) return false;
    let previousContent = null;
    if (position > 1) {
      const prevSig = this.#layers[position - 2].layerSig;
      previousContent = await this.#loadContentForSig(prevSig);
    }
    const diffs = diffLayers(previousContent, currentContent);
    for (const diff of diffs) {
      if (diff.kind === "cell-added" || diff.kind === "cell-removed") return true;
    }
    return false;
  }
  /**
   * Resolve layer content by signature, memoized per-instance.
   *
   * Routes through HistoryService.getLayerContent which reads marker
   * files directly from the lineage's bag. Falls back to the legacy
   * Store.getResource pool only if the bag lookup misses (covers
   * pre-merkle layers that are still pool-resident).
   */
  async #loadContentForSig(signature) {
    if (this.#contentBySig.has(signature)) return this.#contentBySig.get(signature) ?? null;
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (historyService && this.#locationSig) {
      const fromBag = await historyService.getLayerContent(this.#locationSig, signature);
      if (fromBag) {
        this.#contentBySig.set(signature, fromBag);
        return fromBag;
      }
    }
    const store = get("@hypercomb.social/Store");
    if (!store) {
      this.#contentBySig.set(signature, null);
      return null;
    }
    try {
      const blob = await store.getResource(signature);
      if (!blob) {
        this.#contentBySig.set(signature, null);
        return null;
      }
      const parsed = JSON.parse(await blob.text());
      const content = {
        name: parsed.name ?? "",
        children: parsed.children ?? []
      };
      this.#contentBySig.set(signature, content);
      return content;
    } catch {
      this.#contentBySig.set(signature, null);
      return null;
    }
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
   * Reads directly from the bag (the source of truth in the new
   * layout) so undo/redo never blanks out on a cold Store cache.
   * Cached by layer signature so repeated reads during a single
   * render hit memory, not OPFS.
   */
  async layerContentAtCursor() {
    if (this.#position === 0) {
      if (this.#layers.length === 0) return null;
      const empty = { name: "", children: [] };
      this.#cachedLayerSig = null;
      this.#cachedContent = empty;
      return empty;
    }
    const entry = this.#layers[this.#position - 1];
    if (this.#cachedLayerSig === entry.layerSig && this.#cachedContent) {
      return this.#cachedContent;
    }
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!historyService) return null;
    const content = await historyService.getLayerContent(this.#locationSig, entry.layerSig);
    if (!content) return null;
    this.#cachedLayerSig = entry.layerSig;
    this.#cachedContent = content;
    return content;
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
  // ── Group-step toggle persistence (localStorage) ───────────
  //
  // Setting is global (not per-location). Off by default — the minimal
  // per-layer step is the canonical behaviour; group-step is an opt-in
  // coarser walk layered on top.
  static #GROUP_STEP_KEY = "hc:history-group-step";
  // Two cell-op layers whose timestamps are within this window are
  // treated as the same multi-select burst (one group). Anything beyond
  // this is a separate user gesture — a new group boundary. 500ms is
  // comfortably wider than the microtask-scheduled commit path used by
  // LayerCommitter but narrow enough that two independent clicks seconds
  // apart stay distinct.
  static #GROUP_BURST_WINDOW_MS = 500;
  static #loadGroupStep() {
    try {
      return localStorage.getItem(_HistoryCursorService.#GROUP_STEP_KEY) === "1";
    } catch {
      return false;
    }
  }
  static #saveGroupStep(on) {
    try {
      if (on) localStorage.setItem(_HistoryCursorService.#GROUP_STEP_KEY, "1");
      else localStorage.removeItem(_HistoryCursorService.#GROUP_STEP_KEY);
    } catch {
    }
  }
};
var _historyCursorService = new HistoryCursorService();
window.ioc.register("@diamondcoreprocessor.com/HistoryCursorService", _historyCursorService);

// src/diamondcoreprocessor.com/history/history.service.ts
import { SignatureService } from "@hypercomb/core";
var ROOT_NAME = "/";
var emptyLayer = (name) => ({ name });
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
    void domain;
    const key = explorerSegments.join("/");
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
  //
  // On hypercomb.io a lineage's history bag is self-contained:
  //
  //   __history__/{sign(lineage)}/
  //     {sig}              ← layer content, named by its own content sig
  //     {sig}              ← another layer content
  //     ...
  //     __temporary__/     ← soft-deleted layers (30-day TTL)
  //       {sig}
  //
  // No inner `layers/` subfolder. No marker indirection. No entry
  // wrapper JSON. The bag file IS the LayerContent JSON, named by the
  // hash of its bytes — same state collapses to the same file (natural
  // dedupe). Ordering comes from `file.lastModified`. Promotion ("make
  // head") rewrites the file to bump its lastModified; soft-delete
  // moves it into `__temporary__/{sig}` keeping the same name so a
  // restore can move it straight back without rewriting bytes.
  //
  // DCP, by contrast, splits the model: `__layers__/{sig}` holds layer
  // content shared across lineages, and `__history__/{lineageSig}/NNNNNNNN`
  // markers (each containing a single sig line) point into that pool.
  // Markers are a DCP-only indirection — they do not appear here.
  /**
   * Canonicalize a layer so byte-equal content produces byte-equal JSON.
   *
   * Rules:
   *   - `name` always present, always first.
   *   - `children` second when non-empty; omitted entirely when empty.
   *   - All other slot fields follow, sorted alphabetically by key for
   *     stable byte output regardless of registration / mutation order.
   *   - Slot values are kept as-is (each slot is responsible for its
   *     own internal canonical form — sorted arrays, sorted nested
   *     keys, etc.). Empty arrays / empty objects / undefined are
   *     dropped to keep the sparse-layer invariant.
   */
  static canonicalizeLayer = (layer) => {
    const out = { name: layer.name };
    if (layer.children && layer.children.length > 0) out.children = layer.children.slice();
    const slotKeys = Object.keys(layer).filter((k) => k !== "name" && k !== "children").sort();
    for (const key of slotKeys) {
      const v = layer[key];
      if (v === void 0 || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      out[key] = v;
    }
    return out;
  };
  /**
   * Commit a complete layer snapshot for a lineage.
   *
   * The marker file IS the full layer JSON — no pool indirection on
   * hypercomb. Bag layout:
   *
   *   __history__/{lineageSig}/00000000  ← empty layer (auto-minted on first touch)
   *   __history__/{lineageSig}/00000001  ← first user-event commit
   *   __history__/{lineageSig}/00000002
   *   ...
   *
   * Each file's content is the full layer JSON; sha256(file bytes) is
   * the marker's "sig" (the layer's identity). Parent layers reference
   * each child's current marker sig in their `cells` array — the
   * cascade walk that ancestors do upstream of every commit produces
   * a new marker at every level, so the root lineage's bag's latest
   * marker IS the global merkle root.
   *
   * commitLayer here writes ONE marker for ONE lineage. Cascade is
   * orchestrated by the caller (LayerCommitter): walk leaf → root,
   * call commitLayer at each level with that level's freshly-assembled
   * layer (which references its children's just-committed marker sigs).
   *
   * @returns the new marker's sig (sha256 of the file bytes).
   */
  commitLayer = async (locationSig, layer) => {
    const canonical = _HistoryService.canonicalizeLayer(layer);
    const json = JSON.stringify(canonical);
    const bytes = new TextEncoder().encode(json);
    const layerSig = await SignatureService.sign(bytes.buffer);
    const lastSig = this.#latestSigByLineage.get(locationSig);
    if (lastSig === layerSig) return layerSig;
    const bag = await this.getBag(locationSig);
    await this.#ensureEmptyMarker(bag, layer.name);
    const markerName = await this.#nextMarkerName(bag);
    const markerHandle = await bag.getFileHandle(markerName, { create: true });
    const markerWritable = await markerHandle.createWritable();
    try {
      await markerWritable.write(bytes.buffer);
    } finally {
      await markerWritable.close();
    }
    const cacheMap = this.#markerBytesCache.get(locationSig) ?? (this.#markerBytesCache.set(locationSig, /* @__PURE__ */ new Map()), this.#markerBytesCache.get(locationSig));
    cacheMap.set(layerSig, bytes.buffer);
    this.#preloaderCache.set(layerSig, bytes.buffer);
    this.#latestSigByLineage.set(locationSig, layerSig);
    const pushQueue = get("@diamondcoreprocessor.com/PushQueueService");
    if (pushQueue) {
      void pushQueue.enqueue(layerSig).catch(() => {
      });
    }
    return layerSig;
  };
  /**
   * Ensure `00000000` exists in the bag with the empty layer for this
   * lineage's name. Bag's first touch always plants this empty marker
   * so undo has a concrete pre-history landing spot and the bag is
   * never empty once visited.
   *
   * The empty marker's sig is also mirrored into the preloader cache
   * so callers that look it up by sig hit warm without re-reading the
   * file.
   */
  #ensureEmptyMarker = async (bag, name) => {
    let exists = true;
    try {
      await bag.getFileHandle("00000000", { create: false });
    } catch {
      exists = false;
    }
    if (exists) return;
    const empty = _HistoryService.canonicalizeLayer(emptyLayer(name));
    const json = JSON.stringify(empty);
    const bytes = new TextEncoder().encode(json);
    const handle = await bag.getFileHandle("00000000", { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(bytes.buffer);
    } finally {
      await writable.close();
    }
    const sig = await SignatureService.sign(bytes.buffer);
    this.#preloaderCache.set(sig, bytes.buffer);
  };
  /**
   * Return the sig of the lineage's CURRENT layer bytes.
   *
   * Source of truth: the bag at `__history__/<lineageSig>/`. If it has
   * markers, return the latest marker's content sig. If it's empty (or
   * doesn't exist yet), MATERIALIZE the empty marker `00000000` on
   * disk for this name, then return the sig of those real bytes.
   *
   * No virtual / name-derived sigs. Every sig the cascade hands to a
   * parent is the hash of bytes that physically exist in `__history__`.
   * The only named primitive in the system is `<lineageSig>` itself —
   * the bag directory — and the marker filenames `NNNNNNNN`. Cell
   * names live INSIDE the marker JSON (`{name, children?}`), never as
   * folder names anywhere else.
   */
  latestMarkerSigFor = async (lineageSig, name) => {
    const cached = this.#latestSigByLineage.get(lineageSig);
    if (cached && this.#preloaderCache.has(cached)) return cached;
    const bag = await this.historyRoot.getDirectoryHandle(lineageSig, { create: true });
    let latestName = "";
    for await (const [entryName, handle2] of bag.entries()) {
      if (handle2.kind !== "file") continue;
      if (!_HistoryService.#MARKER_RE.test(entryName)) continue;
      if (entryName > latestName) latestName = entryName;
    }
    if (!latestName) {
      await this.#ensureEmptyMarker(bag, name);
      latestName = "00000000";
    }
    const handle = await bag.getFileHandle(latestName, { create: false });
    const file = await handle.getFile();
    const bytes = await file.arrayBuffer();
    const sig = await SignatureService.sign(bytes);
    this.#preloaderCache.set(sig, bytes);
    this.#latestSigByLineage.set(lineageSig, sig);
    return sig;
  };
  /**
   * Head = the chronologically latest marker. Returns null when the
   * location has no markers yet.
   */
  headLayer = async (locationSig) => {
    const all = await this.listLayers(locationSig);
    if (all.length === 0) return null;
    return all[all.length - 1];
  };
  /**
   * Filename convention at the bag root:
   *   - 8-digit numeric (NNNNNNNN) → marker file
   *
   * The marker file's content IS the full layer JSON. The marker's
   * "sig" is sha256 of its bytes. Anything else in the bag is foreign
   * and gets quarantined.
   */
  static #SIG_RE = /^[a-f0-9]{64}$/;
  static #MARKER_RE = /^\d{8}$/;
  /**
   * List all marker entries for a lineage's bag, sorted by filename
   * (numeric ascending). The first element is the empty layer
   * (`00000000`); the last element is the current head.
   *
   * `layerSig` for each entry is sha256 of the marker file's bytes —
   * computed at read time from the file content (not stored anywhere).
   * Two markers with identical content have the same `layerSig`; the
   * filenames stay distinct (they're the per-event timeline).
   */
  listLayers = async (locationSig) => {
    let bag;
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false });
    } catch {
      return [];
    }
    const cacheMap = this.#markerBytesCache.get(locationSig) ?? (this.#markerBytesCache.set(locationSig, /* @__PURE__ */ new Map()), this.#markerBytesCache.get(locationSig));
    const markers = [];
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== "file") continue;
      if (!_HistoryService.#MARKER_RE.test(name)) continue;
      try {
        const file = await handle.getFile();
        const bytes = await file.arrayBuffer();
        const text = new TextDecoder().decode(bytes);
        const trimmed = text.trim();
        if (_HistoryService.#SIG_RE.test(trimmed)) continue;
        try {
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== "object" || typeof parsed.name !== "string" || parsed.name.length === 0) continue;
        } catch {
          continue;
        }
        const layerSig = await SignatureService.sign(bytes);
        cacheMap.set(layerSig, bytes);
        this.#preloaderCache.set(layerSig, bytes);
        markers.push({ layerSig, at: file.lastModified, filename: name });
      } catch {
      }
    }
    markers.sort((a, b) => a.filename.localeCompare(b.filename));
    return markers.map((entry, position) => ({ ...entry, index: position }));
  };
  /**
   * Allocate the next sequential marker name for this bag. Format is
   * 8-digit zero-padded starting at 00000001. Scans existing markers
   * (and the __temporary__ archive if present) for the current max so
   * a re-issued name can never collide with an archived entry.
   */
  #nextMarkerName = async (bag) => {
    let max = 0;
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== "file") continue;
      if (!_HistoryService.#MARKER_RE.test(name)) continue;
      const n = parseInt(name, 10);
      if (!isNaN(n) && n > max) max = n;
    }
    return String(max + 1).padStart(8, "0");
  };
  /**
   * Read a layer's content directly from the lineage's bag.
   *
   * On hypercomb the marker file IS the full layer JSON — no pool
   * indirection. Each NNNN marker in the bag holds one full
   * `LayerContent`; its sha256 is the marker's "sig" (its merkle
   * identity).
   *
   * To resolve `layerSig` → content, we walk the bag's markers,
   * hash each, and return the matching one. Bags are small (one
   * marker per user event for that lineage) so the scan is cheap.
   * For repeated reads we cache (lineageSig, layerSig) → bytes
   * via `#markerBytesCache`.
   */
  getLayerContent = async (locationSig, layerSig) => {
    if (!_HistoryService.#SIG_RE.test(layerSig)) return null;
    const cache = this.#markerBytesCache.get(locationSig);
    let bytes = cache?.get(layerSig);
    if (!bytes) {
      let bag;
      try {
        bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false });
      } catch {
        return null;
      }
      const cacheMap = this.#markerBytesCache.get(locationSig) ?? (this.#markerBytesCache.set(locationSig, /* @__PURE__ */ new Map()), this.#markerBytesCache.get(locationSig));
      for await (const [name, handle] of bag.entries()) {
        if (handle.kind !== "file") continue;
        if (!_HistoryService.#MARKER_RE.test(name)) continue;
        try {
          const file = await handle.getFile();
          const fileBytes = await file.arrayBuffer();
          const sig = await SignatureService.sign(fileBytes);
          cacheMap.set(sig, fileBytes);
          if (sig === layerSig) {
            bytes = fileBytes;
            break;
          }
        } catch {
        }
      }
    }
    if (!bytes) return null;
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
    if (!parsed.name) return null;
    return _HistoryService.#hydrateLayer(parsed);
  };
  /**
   * Pure projection from raw parsed JSON to a LayerContent. Preserves
   * every field as-is — including all registered slot values (notes,
   * tags, future features). Previously only `name` and `children` were
   * surfaced, which silently dropped slot fields on read so cells
   * looked empty even when the bytes-on-disk had notes; that broke the
   * whole LayerSlotRegistry pipeline.
   *
   * Empty `children` is normalised to omitted so reader output matches
   * canonicalizeLayer output (sparse-layer invariant).
   */
  static #hydrateLayer = (parsed) => {
    const out = { name: parsed.name };
    for (const key of Object.keys(parsed)) {
      if (key === "name") continue;
      if (key === "children") {
        if (Array.isArray(parsed.children) && parsed.children.length > 0) out.children = parsed.children;
        continue;
      }
      const v = parsed[key];
      if (v === void 0 || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[key] = v;
    }
    return out;
  };
  // (lineageSig → layerSig → bytes) cache, populated by listLayers
  // and getLayerContent. Keeps undo/redo navigation off OPFS for
  // markers we've already touched in this session.
  #markerBytesCache = /* @__PURE__ */ new Map();
  /**
   * Preloader cache: every layer sig the system has minted, mapped
   * to its bytes. Populated by:
   *   - commitLayer (every cascade step writes here)
   *   - #ensureEmptyMarker (every freshly-minted 00000000 layer)
   *   - listLayers (every marker we read while walking a bag)
   * Lookup is O(1) by sig anywhere in the app — the renderer's
   * resolver, the cursor, anything that has a sig.
   */
  #preloaderCache = /* @__PURE__ */ new Map();
  /**
   * Per-lineage current-sig cache. Updated on every commit so
   * "what's the latest sig for /A/B?" doesn't have to re-walk the bag.
   */
  #latestSigByLineage = /* @__PURE__ */ new Map();
  /**
   * Reverse index: marker sig → the lineage bag it lives in. Lets the
   * depth-bounded preload jump from a child-sig in a parent layer to
   * the child's bag in O(1) without enumerating bags. Populated by
   * every bag walk (#warmBag, listLayers cache fill, getLayerContent
   * cold-scan, commitLayer, latestMarkerSigFor).
   */
  #lineageBySig = /* @__PURE__ */ new Map();
  /**
   * Per-bag "fully warm" flag. Set when #warmBag has read every
   * marker file in the bag and populated #preloaderCache + reverse
   * map for each. Cleared on any destructive op (removeEntries,
   * promoteToHead). commitLayer keeps the flag set because it appends
   * one new marker whose sig+bytes it caches incrementally.
   */
  #bagFullyCached = /* @__PURE__ */ new Set();
  /**
   * Preloader depth — how many levels of children to keep warm
   * outward from the current lineage. Configurable so callers can
   * trade memory for hit-rate. The cache itself is unbounded; depth
   * only bounds how aggressively we PROACTIVELY walk new bags.
   */
  preloaderDepth = 3;
  /**
   * Preloader API: get a layer's parsed content by its sig, from
   * anywhere. Cache hit is O(1); cache miss falls back to a bag scan
   * (which then preloads the bag for future hits).
   */
  getLayerBySig = async (layerSig) => {
    if (!_HistoryService.#SIG_RE.test(layerSig)) return null;
    const cached = this.#preloaderCache.get(layerSig);
    if (cached) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(cached));
        if (!parsed.name) return null;
        return _HistoryService.#hydrateLayer(parsed);
      } catch {
      }
    }
    await this.preloadAllBags();
    const refreshed = this.#preloaderCache.get(layerSig);
    if (!refreshed) return null;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(refreshed));
      if (!parsed.name) return null;
      return _HistoryService.#hydrateLayer(parsed);
    } catch {
      return null;
    }
  };
  /**
   * One-shot session preload: walk every bag in `__history__/`, hash
   * every NNNNNNNN marker, populate `#preloaderCache` and
   * `#latestSigByLineage`. After this runs, every sig anywhere in any
   * layer is resolvable in O(1) from the preloader — no cold walks
   * during render.
   *
   * Idempotent and cheap on subsequent calls (the in-flight promise is
   * shared, completed runs short-circuit).
   *
   * Housekeeping invariant:
   *   - For every lineage encountered, `#latestSigByLineage[lineageSig]`
   *     = sig of the bag's last NNNNNNNN.
   *   - For every marker hashed, `#preloaderCache[sig]` = its bytes.
   * commitLayer / latestMarkerSigFor / removeEntries / promoteToHead /
   * mergeEntries all maintain those invariants from the moment this
   * preload finishes.
   */
  #preloadAllBagsPromise = null;
  preloadAllBags = async () => {
    if (this.#preloadAllBagsPromise) return this.#preloadAllBagsPromise;
    this.#preloadAllBagsPromise = (async () => {
      const root = this.historyRoot;
      for await (const [lineageSig, dirHandle] of root.entries()) {
        if (dirHandle.kind !== "directory") continue;
        if (!_HistoryService.#SIG_RE.test(lineageSig)) continue;
        const bag = dirHandle;
        let latestName = "";
        let latestSig = "";
        for await (const [name, fileHandle] of bag.entries()) {
          if (fileHandle.kind !== "file") continue;
          if (!_HistoryService.#MARKER_RE.test(name)) continue;
          try {
            const file = await fileHandle.getFile();
            const bytes = await file.arrayBuffer();
            const sig = await SignatureService.sign(bytes);
            this.#preloaderCache.set(sig, bytes);
            if (name > latestName) {
              latestName = name;
              latestSig = sig;
            }
          } catch {
          }
        }
        if (latestSig) this.#latestSigByLineage.set(lineageSig, latestSig);
      }
    })();
    return this.#preloadAllBagsPromise;
  };
  /**
   * Per-lineage refresh: invalidate the cached latest for one lineage
   * and re-read its bag. Use after destructive ops on that lineage
   * (already invoked automatically by removeEntries/promoteToHead/
   * mergeEntries, but exposed for callers that mutate a bag directly).
   */
  refreshLineageCache = async (lineageSig) => {
    this.#latestSigByLineage.delete(lineageSig);
    let bag;
    try {
      bag = await this.historyRoot.getDirectoryHandle(lineageSig, { create: false });
    } catch {
      return;
    }
    let latestName = "";
    let latestSig = "";
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== "file") continue;
      if (!_HistoryService.#MARKER_RE.test(name)) continue;
      try {
        const file = await handle.getFile();
        const bytes = await file.arrayBuffer();
        const sig = await SignatureService.sign(bytes);
        this.#preloaderCache.set(sig, bytes);
        if (name > latestName) {
          latestName = name;
          latestSig = sig;
        }
      } catch {
      }
    }
    if (latestSig) this.#latestSigByLineage.set(lineageSig, latestSig);
  };
  /**
   * One-time bag-pollution cleanup. The pre-refactor history-recorder
   * dual-emitted delta records into the bag root (sig-named files
   * with non-layer content) and numeric markers (legacy ops + DCP-
   * style markers). Both shapes live alongside legitimate layer
   * snapshots and would surface as fake rows in listLayers.
   *
   * Sniffing is the price of cleaning a polluted disk. Going forward,
   * the recorder no longer writes records into hypercomb.io bags, so
   * subsequent runs of this pass find nothing to do — the bag stays
   * well-formed and listLayers can keep its mechanical "filename
   * shape IS the type" rule.
   *
   * What gets removed:
   *   - 64-hex sig file whose content is NOT a v2 layer JSON
   *   - 8-digit numeric file (legacy op or DCP marker — doesn't
   *     belong in a hypercomb.io bag)
   *
   * Files whose names don't match either shape are left alone for
   * manual triage.
   */
  /**
   * Purge non-canonical files from a bag.
   *
   * Canonical = NNNN file whose content is a JSON object with at least
   * the slim-layer fields (`children` array). Pre-merkle bags (containing
   * legacy sig-named pool pointers, op-JSON entries, etc.) are dropped.
   *
   * USER-DRIVEN ONLY. listLayers no longer calls this — silently
   * deleting markers from a passive read path is destructive (a single
   * detection bug could erase real history). The only call site is
   * /compact, which the user invokes deliberately.
   *
   * Idempotent: a clean bag is unchanged.
   */
  purgeNonLayerFiles = async (locationSig) => this.#quarantineNonLayerFiles(locationSig);
  #quarantineNonLayerFiles = async (locationSig) => {
    let bag;
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false });
    } catch {
      return;
    }
    const drop = [];
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== "file") continue;
      if (_HistoryService.#MARKER_RE.test(name)) {
        try {
          const file = await handle.getFile();
          const text = (await file.text()).trim();
          if (_HistoryService.#SIG_RE.test(text)) {
            drop.push(name);
            continue;
          }
          try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === "object" && typeof parsed.name === "string" && parsed.name.length > 0) continue;
          } catch {
          }
        } catch {
        }
      }
      drop.push(name);
    }
    for (const name of drop) {
      try {
        await bag.removeEntry(name);
      } catch {
      }
    }
  };
  // -------------------------------------------------
  // marker promotion / delete / merge
  // -------------------------------------------------
  //
  // Direct CRUD on markers — append, delete. Sig content files are
  // touched only by commitLayer (writes a new sig file when content
  // is novel). promoteToHead appends a fresh marker pointing at the
  // existing sig (no content rewrite). removeEntries deletes markers,
  // not sig files (orphan sig files can be GC'd later).
  //
  //   promoteToHead(sig)        → append a new marker pointing at sig.
  //                                Result: that sig appears at head
  //                                without re-writing the content file.
  //
  //   removeEntries(markers[])  → bag.removeEntry(markerName) per item.
  //
  //   mergeEntries(markers[])   → take newest selected marker's sig,
  //                                promote to head, delete the rest.
  /**
   * Bring a layer sig back to head by appending a fresh marker that
   * points at it. The sig content file is NOT touched — its mtime
   * stays put, no Blob handles invalidated. Markers, not content,
   * carry the per-event timeline.
   */
  promoteToHead = async (locationSig, layerSig) => {
    if (!_HistoryService.#SIG_RE.test(layerSig)) return null;
    const bag = await this.getBag(locationSig);
    let sigExists = true;
    try {
      await bag.getFileHandle(layerSig, { create: false });
    } catch {
      sigExists = false;
    }
    if (!sigExists) {
      const store = get("@hypercomb.social/Store");
      const blob = store ? await store.getResource(layerSig).catch(() => null) : null;
      if (!blob) return null;
      const bytes = await blob.arrayBuffer();
      const handle = await bag.getFileHandle(layerSig, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes);
      } finally {
        await writable.close();
      }
    }
    const markerName = await this.#nextMarkerName(bag);
    const markerHandle = await bag.getFileHandle(markerName, { create: true });
    const markerWritable = await markerHandle.createWritable();
    try {
      await markerWritable.write(layerSig);
    } finally {
      await markerWritable.close();
    }
    this.#latestSigByLineage.delete(locationSig);
    return layerSig;
  };
  /**
   * Direct delete of marker files. Sig content files are NOT deleted
   * here (a sig may still be referenced by other markers); orphan-sig
   * GC is a separate sweep if/when needed.
   */
  removeEntries = async (locationSig, filenames) => {
    if (filenames.length === 0) return 0;
    let bag;
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false });
    } catch {
      return 0;
    }
    let removed = 0;
    for (const filename of filenames) {
      try {
        await bag.removeEntry(filename);
        removed++;
      } catch {
      }
    }
    if (removed > 0) this.#latestSigByLineage.delete(locationSig);
    return removed;
  };
  /**
   * Multi-select "merge into head". Pick the newest selected marker's
   * sig, promote it (append a fresh marker), then delete every other
   * selected marker. Net effect: one new marker at head, the merged-
   * source markers are gone from the active list.
   */
  mergeEntries = async (locationSig, filenames) => {
    if (filenames.length === 0) return null;
    let bag;
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false });
    } catch {
      return null;
    }
    let newestMarker = null;
    let newestSig = null;
    for (const filename of filenames) {
      if (!_HistoryService.#MARKER_RE.test(filename)) continue;
      try {
        const handle = await bag.getFileHandle(filename, { create: false });
        const file = await handle.getFile();
        if (newestMarker === null || filename.localeCompare(newestMarker) > 0) {
          newestMarker = filename;
          newestSig = (await file.text()).trim();
        }
      } catch {
      }
    }
    if (!newestSig) return null;
    const promoted = await this.promoteToHead(locationSig, newestSig);
    if (!promoted) return null;
    await this.removeEntries(locationSig, filenames.filter((f) => f !== newestMarker));
    return promoted;
  };
  // -------------------------------------------------
  // mechanical delta-record primitives
  // -------------------------------------------------
  //
  // Records are the pure-differential form of history. A record is
  // `{name, <op>: [sigs]}` serialised as raw line-oriented text (see
  // delta-record.ts). Records are immutable and content-addressed:
  // the record bytes live at `__layers__/{sig}` (flat, not in a
  // domain subfolder — LayerInstaller's domain-scoped package reads
  // iterate only directories, so flat sig files coexist cleanly).
  //
  // Per-location markers live at the bag root as opaque zero-padded
  // entry files (`__history__/{locSig}/NNNNNNNN`, no extension).
  // Each marker contains exactly one sig on one line. Ordering and
  // timestamps come from file.lastModified on the filesystem; under
  // the immutable-files invariant that IS the creation time. Nothing
  // is embedded in the content.
  //
  // Legacy op files that predate the layer system also live at the
  // bag root with the same NNNNNNNN naming. The reader discriminates
  // by content: a new marker file holds a 64-hex sig; a legacy op
  // file holds JSON with `{op, cell, at, ...}`. Coexistence is
  // stable because both formats sort by filename consistently.
  /**
   * Canonicalise the record, sign it, write the raw bytes into the
   * same history bag as `{sig}`, and append a numeric marker at the
   * bag root whose content is that sig. Everything lives in one
   * folder per location so publishing maps to "share this bag" —
   * tar up `__history__/{locSig}/` and the peer gets the markers
   * and the layer content they reference as one self-contained unit.
   * Returns the record-sig, or null if the Store isn't available.
   */
  writeRecord = async (locationSig, record) => {
    const canonical = canonicalise(record);
    const bytes = new TextEncoder().encode(canonical);
    const sig = await SignatureService.sign(bytes.buffer);
    const bag = await this.getBag(locationSig);
    let exists = true;
    try {
      await bag.getFileHandle(sig);
    } catch {
      exists = false;
    }
    if (!exists) {
      const handle = await bag.getFileHandle(sig, { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(bytes);
      } finally {
        await writable.close();
      }
    }
    const fileName = await this.#nextBagMarker(bag);
    const mhandle = await bag.getFileHandle(fileName, { create: true });
    const mwrite = await mhandle.createWritable();
    try {
      await mwrite.write(sig);
    } finally {
      await mwrite.close();
    }
    return sig;
  };
  /**
   * Walk the bag root in chronological order, returning each marker
   * entry's record-sig plus its timestamp. Files whose content is
   * not a sig (legacy op files) are skipped — those readers have
   * their own replay path.
   */
  listRecordSigs = async (locationSig) => {
    let bag;
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false });
    } catch {
      return [];
    }
    const out = [];
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== "file") continue;
      try {
        const file = await handle.getFile();
        const text = (await file.text()).trim();
        if (/^[a-f0-9]{64}$/.test(text)) {
          out.push({ sig: text, at: file.lastModified, filename: name });
        }
      } catch {
      }
    }
    out.sort((a, b) => a.at - b.at || a.filename.localeCompare(b.filename));
    return out;
  };
  /**
   * Load + parse the DeltaRecord at the given signature. Records now
   * live inside each history bag (`__history__/{locSig}/{sig}`), so
   * resolution is scoped to the bag — callers pass the locationSig
   * along with the record sig. Returns null on missing or malformed
   * content.
   */
  resolveDeltaRecord = async (locationSig, sig) => {
    try {
      const bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false });
      const handle = await bag.getFileHandle(sig, { create: false });
      const file = await handle.getFile();
      const text = await file.text();
      return parse(text);
    } catch {
      return null;
    }
  };
  #nextBagMarker = async (bag) => {
    let max = 0;
    for await (const [name] of bag.entries()) {
      const n = parseInt(name, 10);
      if (!isNaN(n) && n > max) max = n;
    }
    return String(max + 1).padStart(8, "0");
  };
  /**
   * Resolve every marker at this location, fold the records into a
   * HydratedState. Optional `upTo` slices the chain — used by the
   * cursor to preview past positions without mutating live state.
   * Empty chain (or `upTo = 0`) returns the identity state — this is
   * the synthetic-empty render path: before any real entry, the grid
   * is empty. No disk writes, no timestamp invention — a pure fold.
   */
  hydratedStateAt = async (locationSig, upTo) => {
    const markers = await this.listRecordSigs(locationSig);
    const slice = typeof upTo === "number" ? markers.slice(0, Math.max(0, upTo)) : markers;
    const records = await Promise.all(
      slice.map((m) => this.resolveDeltaRecord(locationSig, m.sig))
    );
    return reduce(records);
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

// src/diamondcoreprocessor.com/history/layer-slot-registry.ts
var RESERVED_NAMES = /* @__PURE__ */ new Set(["name", "children"]);
var LayerSlotRegistry = class {
  #slots = /* @__PURE__ */ new Map();
  /** Triggers we've already announced to listeners — for replay. */
  #announcedTriggers = /* @__PURE__ */ new Set();
  /** Active listeners. Fired on every NEW trigger as it becomes known. */
  #triggerListeners = /* @__PURE__ */ new Set();
  /**
   * Register a slot. Idempotent for the same slot name + same
   * provider — re-registering with a DIFFERENT provider throws (slot
   * name collisions are a programming error, not a runtime case to
   * recover from). Re-registering the EXACT same object (same
   * reference) is a no-op so module hot-reload during dev doesn't
   * explode.
   *
   * Side effect: any new trigger names appearing in this slot's
   * `triggers` array are announced to all current listeners. Replay
   * via `onTrigger()` ensures listeners that subscribe LATER also
   * see triggers that were registered earlier.
   */
  register(slot) {
    if (!slot?.slot || typeof slot.slot !== "string") {
      throw new Error("[LayerSlotRegistry] slot.slot must be a non-empty string");
    }
    if (RESERVED_NAMES.has(slot.slot)) {
      throw new Error(`[LayerSlotRegistry] slot name "${slot.slot}" is reserved (intrinsic to the layer)`);
    }
    if (typeof slot.read !== "function") {
      throw new Error(`[LayerSlotRegistry] slot "${slot.slot}" must define a read() function`);
    }
    if (!Array.isArray(slot.triggers)) {
      throw new Error(`[LayerSlotRegistry] slot "${slot.slot}" must define a triggers array (use [] for passive slots)`);
    }
    const existing = this.#slots.get(slot.slot);
    if (existing && existing !== slot) {
      throw new Error(`[LayerSlotRegistry] slot "${slot.slot}" already registered by a different provider`);
    }
    this.#slots.set(slot.slot, slot);
    for (const t of slot.triggers) {
      if (this.#announcedTriggers.has(t)) continue;
      this.#announcedTriggers.add(t);
      for (const listener of this.#triggerListeners) {
        try {
          listener(t);
        } catch {
        }
      }
    }
  }
  /**
   * Subscribe to trigger announcements. The listener is fired
   * immediately for every trigger already known to the registry,
   * then for every NEW trigger as future slots register.
   *
   * Returns an unsubscribe function.
   */
  onTrigger(listener) {
    this.#triggerListeners.add(listener);
    for (const t of this.#announcedTriggers) {
      try {
        listener(t);
      } catch {
      }
    }
    return () => {
      this.#triggerListeners.delete(listener);
    };
  }
  /**
   * Iterate registered slots in insertion order. LayerCommitter walks
   * this on every commit (to read slot values into the layer).
   */
  slots() {
    return this.#slots.values();
  }
  /** Look up a single slot by name (mostly for diff/debug tools). */
  get(name) {
    return this.#slots.get(name);
  }
  /** Read every slot's value for a location. Omits slots returning undefined. */
  async readAll(locationSig, segments) {
    const out = {};
    for (const slot of this.#slots.values()) {
      const value = await slot.read(locationSig, segments);
      if (value !== void 0) out[slot.slot] = value;
    }
    return out;
  }
  /** Union of every slot's trigger events known so far. */
  allTriggers() {
    return [...this.#announcedTriggers];
  }
};
var _layerSlotRegistry = new LayerSlotRegistry();
window.ioc.register("@diamondcoreprocessor.com/LayerSlotRegistry", _layerSlotRegistry);

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
   * Preferred path: read the head layer and use its `children` array —
   * constant-time and always reflects whatever the LayerCommitter most
   * recently snapshotted. NOTE: `children` now contains child layer
   * sigs (not display names). Display-name resolution is the consumer's
   * responsibility — callers that need names must load each child sig
   * via HistoryService.getLayerContent and read its `name` field.
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
    const content = await history.getLayerContent(locationSig, head.layerSig);
    if (!content) return null;
    return Array.isArray(content.children) ? [...content.children] : null;
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
import { QueenBee as QueenBee2, EffectBus as EffectBus4 } from "@hypercomb/core";
var ReviseQueenBee = class extends QueenBee2 {
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
  CollapseHistoryQueenBee,
  GlobalTimeClock,
  HistoryCursorService,
  HistoryService,
  LayerSlotRegistry,
  OrderProjection,
  ROOT_NAME,
  ReviseQueenBee,
  canonicalBytes,
  canonicalise,
  diffLayers,
  emptyLayer,
  isSig,
  parse,
  reduce
};
