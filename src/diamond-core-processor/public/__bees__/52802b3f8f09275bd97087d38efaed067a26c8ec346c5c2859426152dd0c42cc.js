// src/diamondcoreprocessor.com/history/layer-committer.drone.ts
import { EffectBus } from "@hypercomb/core";

// src/diamondcoreprocessor.com/history/history.service.ts
import { SignatureService } from "@hypercomb/core";

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

// src/diamondcoreprocessor.com/history/history.service.ts
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
    const out = { name: parsed.name };
    if (Array.isArray(parsed.children) && parsed.children.length > 0) out.children = parsed.children;
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
        const out = { name: parsed.name };
        if (Array.isArray(parsed.children) && parsed.children.length > 0) out.children = parsed.children;
        return out;
      } catch {
      }
    }
    await this.preloadAllBags();
    const refreshed = this.#preloaderCache.get(layerSig);
    if (!refreshed) return null;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(refreshed));
      if (!parsed.name) return null;
      const out = { name: parsed.name };
      if (Array.isArray(parsed.children) && parsed.children.length > 0) out.children = parsed.children;
      return out;
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

// src/diamondcoreprocessor.com/history/layer-committer.drone.ts
import { LayerSlotRegistry } from "@diamondcoreprocessor.com/history";
var CommitMachine = class {
  #chain = Promise.resolve();
  #run;
  constructor(run) {
    this.#run = run;
  }
  /** Fire-and-forget enqueue. Returned chain failures are swallowed. */
  request(req = { segments: null }) {
    this.#chain = this.#chain.then(() => this.#run(req)).catch(() => {
    });
  }
  /**
   * Same as `request` but returns a promise that resolves when this
   * specific request finishes (success or failure). Used by bootstrap
   * paths that need to read back the bag right after the commit lands.
   */
  requestAndWait(req = { segments: null }) {
    const ran = this.#chain.then(() => this.#run(req));
    this.#chain = ran.catch(() => {
    });
    return ran.catch(() => {
    });
  }
};
var LayerCommitter = class {
  // Layout state is scattered across EffectBus effects. We subscribe at
  // construction and keep the latest value locally. Late subscribers get
  // the last-emitted value automatically (EffectBus replay).
  #layout = {
    orientation: "point-top",
    pivot: false,
    accent: "",
    gapPx: 0,
    textOnly: false
  };
  // Single serialised commit machine for this committer. Every event
  // source — per-event lifecycle, microtask-batched layout changes,
  // synchronize — calls machine.request(). The machine collapses
  // same-turn requests and serialises cross-turn ones; commitLayer
  // dedup then absorbs any redundant identical content. Together
  // they guarantee one commit per distinct state change, no more.
  //
  // Leaf + ancestors still commit as one atomic #commit() call
  // inside the machine's #run — each ancestor is a merkle-chain
  // update cascading up from the leaf.
  #machine = new CommitMachine((req) => this.#commit(req));
  constructor() {
    EffectBus.on("render:set-orientation", (p) => {
      if (p) {
        this.#layout = { ...this.#layout, orientation: p.flat ? "flat-top" : "point-top" };
        this.#schedule();
      }
    });
    EffectBus.on("render:set-pivot", (p) => {
      if (p != null) {
        this.#layout = { ...this.#layout, pivot: !!p.pivot };
        this.#schedule();
      }
    });
    EffectBus.on("overlay:neon-color", (p) => {
      if (p?.name) {
        this.#layout = { ...this.#layout, accent: p.name };
        this.#schedule();
      }
    });
    EffectBus.on("render:set-gap", (p) => {
      if (p?.gapPx != null) {
        this.#layout = { ...this.#layout, gapPx: p.gapPx };
        this.#schedule();
      }
    });
    EffectBus.on("render:set-text-only", (p) => {
      if (p?.textOnly != null) {
        this.#layout = { ...this.#layout, textOnly: !!p.textOnly };
        this.#schedule();
      }
    });
    EffectBus.on("cell:added", (p) => this.#queueCommit(p?.segments, "add", p?.cell));
    EffectBus.on("cell:removed", (p) => this.#queueCommit(p?.segments, "remove", p?.cell));
    EffectBus.on("tile:saved", (p) => this.#queueCommit(p?.segments));
    EffectBus.on("tile:hidden", (p) => this.#queueCommit(p?.segments));
    EffectBus.on("tile:unhidden", (p) => this.#queueCommit(p?.segments));
    LayerSlotRegistry.onTrigger((trigger) => {
      EffectBus.on(trigger, (p) => this.#queueCommit(p?.segments));
    });
  }
  // All commit requests — batched or per-event — route through the
  // single CommitMachine. See the class above for the state transitions.
  #schedule() {
    this.#machine.request({ segments: null });
  }
  #queueCommit(segments, op, cell) {
    const cleaned = Array.isArray(segments) ? segments.map((s) => String(s ?? "").trim()).filter(Boolean) : null;
    const trimmedCell = cell ? String(cell).trim() : void 0;
    this.#machine.request({
      segments: cleaned,
      op: op && trimmedCell ? op : void 0,
      cell: op && trimmedCell ? trimmedCell : void 0
    });
  }
  /**
   * Self-heal: ensure the lineage at `segments` has a marker reflecting
   * the current on-disk state. Inspects the bag first — only commits
   * when the bag has no canonical markers yet. Idempotent: a populated
   * bag yields a no-op, no redundant markers.
   *
   * Called from HistoryCursorService.load() so that any lineage with
   * tiles on disk but no recorded history (e.g. data created before
   * the merkle commits existed) gets its first marker captured the
   * moment it's first viewed. NON-DESTRUCTIVE: only ever appends.
   */
  // Per-locSig in-flight bootstrap promise. Coalesces concurrent
  // bootstrap calls for the same lineage so cursor.load and the
  // Lineage 'change' subscription don't both fire commits.
  #bootstrapInFlight = /* @__PURE__ */ new Map();
  async bootstrapIfEmpty(segments) {
    const history = get("@diamondcoreprocessor.com/HistoryService");
    const lineage = get("@hypercomb.social/Lineage");
    if (!history || !lineage) {
      return;
    }
    const store = get(
      "@hypercomb.social/Store"
    );
    if (!store?.history || !store?.hypercombRoot) return;
    const cleaned = Array.isArray(segments) ? segments.map((s) => String(s ?? "").trim()).filter(Boolean) : null;
    const fallback = (lineage.explorerSegments?.() ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    const segs = cleaned ?? fallback;
    const locSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => segs
    });
    const existing = this.#bootstrapInFlight.get(locSig);
    if (existing) return existing;
    const run = (async () => {
      const markers = await history.listLayers(locSig);
      const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
      if (markers.length > 0) {
        if (cursor?.refreshForLocation) await cursor.refreshForLocation(locSig);
        return;
      }
      await this.#machine.requestAndWait({ segments: segs });
      if (cursor?.refreshForLocation) await cursor.refreshForLocation(locSig);
      else if (cursor?.onNewLayer) await cursor.onNewLayer();
    })();
    this.#bootstrapInFlight.set(locSig, run);
    try {
      await run;
    } finally {
      this.#bootstrapInFlight.delete(locSig);
    }
  }
  async #commit(req = { segments: null }) {
    const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
    if (cursor?.state?.rewound) return;
    const lineage = get("@hypercomb.social/Lineage");
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!lineage || !history) return;
    const fallbackSegments = (lineage.explorerSegments?.() ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    const segments = req.segments ?? fallbackSegments;
    if (req.op && req.cell) {
      let belowOldSig = null;
      let belowNewSig = null;
      let belowName = req.cell;
      for (let depth = segments.length; depth >= 0; depth--) {
        const sub = segments.slice(0, depth);
        const ancestorName = depth === 0 ? ROOT_NAME : sub[sub.length - 1];
        const ancestorLocSig = await history.sign({
          domain: lineage.domain,
          explorerSegments: () => sub
        });
        const prevSig = await history.latestMarkerSigFor(ancestorLocSig, ancestorName);
        const prevLayer = await history.getLayerBySig(prevSig);
        const prevChildren = prevLayer?.children?.slice() ?? [];
        let nextChildren = prevChildren;
        if (depth === segments.length) {
          if (req.op === "add") {
            const cellLocSig = await history.sign({
              domain: lineage.domain,
              explorerSegments: () => [...sub, req.cell]
            });
            const cellSig = await history.latestMarkerSigFor(cellLocSig, req.cell);
            if (!prevChildren.includes(cellSig)) {
              nextChildren = [...prevChildren, cellSig];
            } else {
              nextChildren = prevChildren;
            }
            belowOldSig = null;
            belowNewSig = cellSig;
            belowName = req.cell;
          } else {
            const filtered = [];
            let foundOldSig = null;
            for (const sig of prevChildren) {
              const child = await history.getLayerBySig(sig);
              if (child?.name === req.cell) {
                foundOldSig = sig;
                continue;
              }
              filtered.push(sig);
            }
            nextChildren = filtered;
            belowOldSig = foundOldSig;
            belowNewSig = null;
            belowName = req.cell;
          }
        } else {
          let swapped = false;
          const out = [];
          for (const sig of prevChildren) {
            if (!swapped && belowOldSig !== null && sig === belowOldSig) {
              if (belowNewSig !== null) out.push(belowNewSig);
              swapped = true;
              continue;
            }
            out.push(sig);
          }
          if (!swapped) {
            for (let i = 0; i < prevChildren.length; i++) {
              const child = await history.getLayerBySig(prevChildren[i]);
              if (child?.name === belowName) {
                if (belowNewSig !== null) out[i] = belowNewSig;
                else out.splice(i, 1);
                swapped = true;
                break;
              }
            }
            if (!swapped && belowNewSig !== null) {
              out.push(belowNewSig);
              swapped = true;
            }
          }
          nextChildren = out;
          belowName = ancestorName;
        }
        const slotValues = await LayerSlotRegistry.readAll(ancestorLocSig, sub);
        const newLayer = nextChildren.length === 0 ? { name: ancestorName, ...slotValues } : { name: ancestorName, children: nextChildren, ...slotValues };
        const newSig = await history.commitLayer(ancestorLocSig, newLayer);
        belowOldSig = prevSig;
        belowNewSig = newSig;
      }
      const cursorAfter2 = get("@diamondcoreprocessor.com/HistoryCursorService");
      if (cursorAfter2) await cursorAfter2.onNewLayer();
      return;
    }
    for (let depth = segments.length; depth >= 0; depth--) {
      const sub = segments.slice(0, depth);
      const ancestorName = depth === 0 ? ROOT_NAME : sub[sub.length - 1];
      const ancestorLocSig = await history.sign({
        domain: lineage.domain,
        explorerSegments: () => sub
      });
      let ancestorDir = null;
      const store = get("@hypercomb.social/Store");
      const root = store?.hypercombRoot;
      if (root && lineage.tryResolve) {
        ancestorDir = await lineage.tryResolve(sub, root).catch(() => null);
      } else if (depth === segments.length) {
        const dirOrPromise = lineage.explorerDir?.();
        ancestorDir = await Promise.resolve(dirOrPromise ?? null);
      }
      const ancestorLayer = await this.#assembleLayerFor(history, sub, ancestorName, ancestorDir);
      await history.commitLayer(ancestorLocSig, ancestorLayer);
    }
    const cursorAfter = get("@diamondcoreprocessor.com/HistoryCursorService");
    if (cursorAfter) await cursorAfter.onNewLayer();
  }
  /**
   * Build a complete layer snapshot for the lineage at `segments` by
   * enumerating its on-disk children AND folding in every registered
   * LayerSlot's current value. Used only by the fallback path in
   * `#commit` (events without op+cell delta info). The delta path
   * preserves sibling sigs verbatim and folds slots inline there.
   */
  async #assembleLayerFor(history, segments, name, explorerDir) {
    const onDiskNames = [];
    if (explorerDir) {
      for await (const [n, handle] of explorerDir.entries()) {
        if (handle.kind !== "directory") continue;
        if (n.startsWith("__")) continue;
        onDiskNames.push(n);
      }
    }
    const locationSig = await history.sign({
      explorerSegments: () => segments
    });
    const slotValues = await LayerSlotRegistry.readAll(locationSig, segments);
    if (onDiskNames.length === 0) return { name, ...slotValues };
    const children = [];
    for (const childName of onDiskNames) {
      const childSegments = [...segments, childName];
      const childLocSig = await history.sign({
        explorerSegments: () => childSegments
      });
      children.push(await history.latestMarkerSigFor(childLocSig, childName));
    }
    return { name, children, ...slotValues };
  }
  // Layout signing / instruction-sig reading were both layer-driven —
  // the layer captured a `layoutSig` and `instructionsSig`. The slim
  // layer doesn't carry either; layout and instructions are bee-owned
  // primitives, and any per-position playback (e.g., undo of a layout
  // gap change) is the responsibility of the layout/instruction bee
  // tracking its own per-state primitive. Removed from the committer.
};
var _layerCommitter = new LayerCommitter();
window.ioc.register("@diamondcoreprocessor.com/LayerCommitter", _layerCommitter);
export {
  LayerCommitter
};
