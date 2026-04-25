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
   * `cells` keeps its caller-supplied order (position is meaningful).
   * `hidden` is sorted lexicographically so set-equal states dedupe.
   */
  static canonicalizeLayer = (layer) => ({
    cells: layer.cells.slice(),
    hidden: [...layer.hidden].sort()
  });
  /**
   * Commit a layer snapshot for a location.
   *
   * Writes the canonical layer content directly into the lineage bag
   * as `__history__/{lineageSig}/{layerSig}` — the file IS the layer
   * content, named by the hash of its bytes. Same content → same sig
   * → same file (natural dedupe, no separate dedup table). Skips the
   * write if a file with that sig already exists so any cached Blob
   * handle elsewhere can't be invalidated by an idempotent rewrite.
   *
   * Also seeds Store.putResource so cross-bag resolvers (cursor warmup,
   * renderer) keep finding the content under the same sig — but the
   * source of truth for this lineage's history is the bag file itself.
   *
   * @returns the layer signature, or null if the layer was a no-op
   *          rewrite of the current head.
   */
  commitLayer = async (locationSig, layer) => {
    const canonical = _HistoryService.canonicalizeLayer(layer);
    const json = JSON.stringify(canonical);
    const bytes = new TextEncoder().encode(json);
    const layerSig = await SignatureService.sign(bytes.buffer);
    const bag = await this.getBag(locationSig);
    let sigExists = true;
    try {
      await bag.getFileHandle(layerSig, { create: false });
    } catch {
      sigExists = false;
    }
    if (!sigExists) {
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
    const store = get("@hypercomb.social/Store");
    if (store) {
      try {
        await store.putResource(new Blob([json], { type: "application/json" }));
      } catch {
      }
    }
    return layerSig;
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
   * Filename conventions at the bag root:
   *   - 64-hex sig file → layer content (one per unique state)
   *   - 8-digit numeric → marker file (one per user event), content = a sig
   *
   * Two named shapes, two roles. The convention is mechanical — names
   * carry meaning, no inspection of content needed for routing. Markers
   * give us per-event history with overlap (multiple markers can point
   * at the same sig); sig files give us content dedupe.
   */
  static #SIG_RE = /^[a-f0-9]{64}$/;
  static #MARKER_RE = /^\d{8}$/;
  /**
   * List all marker entries for a location, sorted chronologically by
   * marker filename (numeric ascending, so the last element is the
   * latest commit). Each entry's `filename` is the MARKER name (used
   * for delete/promote ops); `layerSig` is the content sig the marker
   * points at; `at` is the marker file's lastModified.
   *
   * Multiple markers may share the same `layerSig` (overlap is the
   * whole point of markers — per-event history with content dedupe).
   */
  listLayers = async (locationSig) => {
    await this.#quarantineNonLayerFiles(locationSig);
    let bag;
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false });
    } catch {
      return [];
    }
    const markers = [];
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== "file") continue;
      if (!_HistoryService.#MARKER_RE.test(name)) continue;
      try {
        const file = await handle.getFile();
        const sig = (await file.text()).trim();
        if (!_HistoryService.#SIG_RE.test(sig)) continue;
        markers.push({ layerSig: sig, at: file.lastModified, filename: name });
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
   * Read a layer's JSON content directly from the bag, by sig. The
   * bag is the source of truth in the new layout — `__resources__/`
   * is only a (possibly cold) cache. Going through Store.getResource
   * for undo/redo means a missed cache renders an empty grid even
   * though the bytes are right there in the bag. This bypasses that
   * indirection entirely.
   *
   * Returns the parsed (and field-defaulted) LayerContent, or null
   * when the bag/sig file isn't there. Also seeds Store.putResource
   * on a successful read so any other consumer that still resolves
   * by sig stays warm. No content sniffing — the file is at the
   * canonical path or it isn't.
   */
  getLayerContent = async (locationSig, layerSig) => {
    if (!_HistoryService.#SIG_RE.test(layerSig)) return null;
    let bag;
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false });
    } catch {
      return null;
    }
    let bytes;
    let blob;
    try {
      const handle = await bag.getFileHandle(layerSig, { create: false });
      const file = await handle.getFile();
      bytes = await file.arrayBuffer();
      blob = file;
    } catch {
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
    const content = {
      cells: parsed.cells ?? [],
      hidden: parsed.hidden ?? []
    };
    const store = get("@hypercomb.social/Store");
    if (store) {
      try {
        await store.putResource(blob);
      } catch {
      }
    }
    return content;
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
  #quarantineNonLayerFiles = async (locationSig) => {
    let bag;
    try {
      bag = await this.historyRoot.getDirectoryHandle(locationSig, { create: false });
    } catch {
      return;
    }
    const numericRe = /^\d{1,16}$/;
    const moves = [];
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== "file") continue;
      if (_HistoryService.#SIG_RE.test(name)) {
        try {
          const file = await handle.getFile();
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed?.cells)) continue;
        } catch {
        }
        moves.push(name);
      } else if (_HistoryService.#MARKER_RE.test(name)) {
        try {
          const file = await handle.getFile();
          const text = (await file.text()).trim();
          if (_HistoryService.#SIG_RE.test(text)) continue;
        } catch {
        }
        moves.push(name);
      } else if (numericRe.test(name)) {
        moves.push(name);
      }
    }
    for (const name of moves) {
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
  /**
   * Move cursor to an absolute position (1-based, clamped).
   *
   * When layers exist, the cursor never sits below position 1 — "fully
   * rewound" reveals the oldest recorded state, not the pre-history
   * empty state. The UI's START anchor row is the visual terminator for
   * that floor; there is no reachable cursor position beyond it. If no
   * layers exist at all, position 0 is allowed (there's nothing to
   * show but empty).
   */
  seek(position) {
    const floor = this.#layers.length > 0 ? 1 : 0;
    const clamped = Math.max(floor, Math.min(position, this.#layers.length));
    if (clamped === this.#position) return;
    this.#position = clamped;
    this.#emit();
  }
  /** Step backward one layer, but never past the oldest recorded state. */
  undo() {
    const floor = this.#layers.length > 0 ? 1 : 0;
    if (this.#position > floor) this.seek(this.#position - 1);
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
   * Reads directly from the bag (the source of truth in the new
   * layout) so undo/redo never blanks out on a cold Store cache.
   * Cached by layer signature so repeated reads during a single
   * render hit memory, not OPFS.
   */
  async layerContentAtCursor() {
    if (this.#position === 0) return null;
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
var HistoryRecorder = class {
  // No subscriptions, no writes. The bag's per-event timeline is the
  // marker series the committer mints; nothing else writes here.
};
var _historyRecorder = new HistoryRecorder();
window.ioc.register("@diamondcoreprocessor.com/HistoryRecorder", _historyRecorder);
export {
  HistoryRecorder
};
