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
    const fileName = await this.#nextEntryFilename(locationSig, layersDir);
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
   * Allocate the next sequential filename for an entry at this location.
   * Format is 8-digit zero-padded starting at 00000001. The filename is
   * ONLY used to guarantee a unique handle — nothing reads it to infer
   * order, head, or age (use the payload's `at` for that). Scans both
   * layers/ and __deleted__/ so a just-deleted highest slot never gets
   * handed back out and collide with an archived restore.
   */
  #nextEntryFilename = async (locationSig, layersDir) => {
    let max = 0;
    for await (const [name, handle] of layersDir.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".json")) continue;
      const n = parseInt(name, 10);
      if (!isNaN(n) && n > max) max = n;
    }
    const deletedDir = await this.#tryGetDeletedDir(locationSig);
    if (deletedDir) {
      for await (const [name, handle] of deletedDir.entries()) {
        if (handle.kind !== "file" || !name.endsWith(".json")) continue;
        const n = parseInt(name, 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }
    return String(max + 1).padStart(8, "0") + ".json";
  };
  /**
   * Head = the most recent entry. Found by scanning every entry, parsing
   * its payload, and picking the one with the highest `at`. Filenames
   * are opaque — never compared or parsed here. Returns null when the
   * location has no history yet.
   */
  headLayer = async (locationSig) => {
    const all = await this.listLayers(locationSig);
    if (all.length === 0) return null;
    return all[all.length - 1];
  };
  /**
   * List all layer entries for a location, sorted chronologically by
   * `at` (oldest first). `index` is the position in that sorted array,
   * `filename` is the opaque on-disk handle — callers that need to
   * delete or promote a specific entry pass `filename` back in. Entries
   * whose backing resource can't be resolved are dropped so the viewer
   * never renders "(loading)" rows forever.
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
        raw.push({ ...entry, filename: name });
      } catch {
      }
    }
    raw.sort((a, b) => a.at - b.at || a.filename.localeCompare(b.filename));
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
    let position = 0;
    for (const entry of raw) {
      if (store && !resolved.has(entry.layerSig)) continue;
      filtered.push({ ...entry, index: position });
      position++;
    }
    return filtered;
  };
  // -------------------------------------------------
  // layer promotion / soft-delete / merge
  // -------------------------------------------------
  //
  // Three primitives the viewer binds to its per-row and multi-select
  // action buttons:
  //
  //   promoteToHead(sig)          → append a new entry at head that
  //                                  points at the same layer content.
  //                                  Same sig, new index, new timestamp.
  //                                  The layer lives twice in the bag —
  //                                  that's the whole point: bringing a
  //                                  past state back to head without
  //                                  touching the past.
  //
  //   removeEntries(indexes[])    → soft-delete: move entry files into
  //                                  __deleted__/{locSig}/ with the full
  //                                  layer JSON as content. 30 days from
  //                                  `deletedAt` they are GC'd out by
  //                                  pruneExpiredDeletes. Restorable
  //                                  because the content is still
  //                                  byte-equal under its original sig.
  //
  //   mergeEntries(indexes[])     → multi-select merge. Picks the newest
  //                                  selected entry's content as the
  //                                  combined state, appends it to head
  //                                  via promoteToHead, then removes all
  //                                  the selected entries so the bag
  //                                  ends up with one fewer row instead
  //                                  of one more. Deletion is soft.
  static #DELETED_DIR = "__deleted__";
  static #DELETE_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
  /**
   * Force-append a new entry at head pointing at the given layer sig.
   * Used to promote a historical layer back to current without touching
   * the past. Skips the dedup gate commitLayer applies; the whole point
   * is to re-use an existing sig as the new head.
   */
  promoteToHead = async (locationSig, layerSig) => {
    const store = get("@hypercomb.social/Store");
    if (!store) return null;
    const blob = await store.getResource(layerSig);
    if (!blob) return null;
    const layersDir = await this.#getLayersDir(locationSig);
    const fileName = await this.#nextEntryFilename(locationSig, layersDir);
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
   * Soft-delete history entries by filename. Each entry's content is
   * archived (entry pointer + full layer JSON snapshot) into
   * __deleted__/{locSig}/{sameFilename}, then the original entry file
   * is removed. 30-day TTL enforced by pruneExpiredDeletes.
   */
  removeEntries = async (locationSig, filenames) => {
    if (filenames.length === 0) return 0;
    const layersDir = await this.#tryGetLayersDir(locationSig);
    if (!layersDir) return 0;
    const store = get("@hypercomb.social/Store");
    const deletedDir = await this.#getDeletedDir(locationSig);
    const deletedAt = Date.now();
    let removed = 0;
    for (const filename of filenames) {
      let entry = null;
      try {
        const handle = await layersDir.getFileHandle(filename, { create: false });
        const file = await handle.getFile();
        entry = JSON.parse(await file.text());
      } catch {
        continue;
      }
      const archivePayload = {
        deletedAt,
        entry,
        layer: null
      };
      if (store) {
        try {
          const blob = await store.getResource(entry.layerSig);
          if (blob) archivePayload.layer = JSON.parse(await blob.text());
        } catch {
        }
      }
      try {
        const archiveHandle = await deletedDir.getFileHandle(filename, { create: true });
        const writable = await archiveHandle.createWritable();
        try {
          await writable.write(JSON.stringify(archivePayload));
        } finally {
          await writable.close();
        }
      } catch {
        continue;
      }
      try {
        await layersDir.removeEntry(filename);
      } catch {
      }
      removed++;
    }
    return removed;
  };
  /**
   * Multi-select "merge into head". Appends the newest selected layer's
   * content as the new head (via promoteToHead), then soft-deletes all
   * the selected source entries. Net effect: one new row at top, the
   * sources disappear from the active list but remain restorable from
   * __deleted__ for 30 days.
   */
  mergeEntries = async (locationSig, filenames) => {
    if (filenames.length === 0) return null;
    const layersDir = await this.#tryGetLayersDir(locationSig);
    if (!layersDir) return null;
    let newest = null;
    for (const filename of filenames) {
      try {
        const handle = await layersDir.getFileHandle(filename, { create: false });
        const file = await handle.getFile();
        const entry = JSON.parse(await file.text());
        if (!newest || entry.at > newest.at) newest = entry;
      } catch {
      }
    }
    if (!newest) return null;
    const newSig = await this.promoteToHead(locationSig, newest.layerSig);
    if (!newSig) return null;
    await this.removeEntries(locationSig, filenames);
    return newSig;
  };
  /**
   * GC pass: remove soft-deleted entries older than 30 days. Safe to
   * call at startup and after any delete/merge. Idempotent and bounded
   * by the number of deleted files at this location.
   */
  pruneExpiredDeletes = async (locationSig) => {
    const deletedDir = await this.#tryGetDeletedDir(locationSig);
    if (!deletedDir) return 0;
    const cutoff = Date.now() - _HistoryService.#DELETE_TTL_MS;
    let pruned = 0;
    const names = [];
    for await (const [name, handle] of deletedDir.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".json")) continue;
      names.push(name);
    }
    for (const name of names) {
      let deletedAt = 0;
      try {
        const handle = await deletedDir.getFileHandle(name, { create: false });
        const file = await handle.getFile();
        const payload = JSON.parse(await file.text());
        deletedAt = Number(payload?.deletedAt ?? 0);
      } catch {
        continue;
      }
      if (!Number.isFinite(deletedAt) || deletedAt === 0 || deletedAt > cutoff) continue;
      try {
        await deletedDir.removeEntry(name);
        pruned++;
      } catch {
      }
    }
    return pruned;
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
   * the synthetic-seed render path: before any real entry, the grid
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
  #getDeletedDir = async (locationSig) => {
    const bag = await this.getBag(locationSig);
    return await bag.getDirectoryHandle(_HistoryService.#DELETED_DIR, { create: true });
  };
  #tryGetDeletedDir = async (locationSig) => {
    try {
      const bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false });
      return await bag.getDirectoryHandle(_HistoryService.#DELETED_DIR, { create: false });
    } catch {
      return null;
    }
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
   * Resolve layer content by signature, memoized per-instance. The
   * background warmup seeds the Store cache, so this usually hits
   * in-memory data.
   */
  async #loadContentForSig(signature) {
    if (this.#contentBySig.has(signature)) return this.#contentBySig.get(signature) ?? null;
    const store = get("@hypercomb.social/Store");
    if (!store) return null;
    try {
      const blob = await store.getResource(signature);
      if (!blob) {
        this.#contentBySig.set(signature, null);
        return null;
      }
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
   * Cached by layer signature so repeated reads during a single render
   * hit memory, not OPFS.
   */
  async layerContentAtCursor() {
    if (this.#position === 0) {
      if (this.#layers.length === 0) return null;
      const empty = {
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
      this.#cachedLayerSig = null;
      this.#cachedContent = empty;
      return empty;
    }
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
    const record = recordForCellLifecycle(op, cell);
    if (record) await historyService.writeRecord(sig, record);
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
function recordForCellLifecycle(op, cell) {
  switch (op) {
    case "add":
      return { name: cell };
    case "remove":
      return { name: cell, remove: [] };
    case "hide":
      return { name: cell, hide: [] };
    case "unhide":
      return { name: cell, show: [] };
    default:
      return null;
  }
}
var _historyRecorder = new HistoryRecorder();
window.ioc.register("@diamondcoreprocessor.com/HistoryRecorder", _historyRecorder);
export {
  HistoryRecorder
};
