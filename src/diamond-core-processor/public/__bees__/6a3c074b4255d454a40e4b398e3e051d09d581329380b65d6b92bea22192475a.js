// src/diamondcoreprocessor.com/notes/notes.drone.ts
import { EffectBus as EffectBus2 } from "@hypercomb/core";

// src/diamondcoreprocessor.com/history/hive-participant.ts
import { EffectBus, SignatureService } from "@hypercomb/core";
var SIG_REGEX = /^[a-f0-9]{64}$/;
var HiveParticipant = class {
  // ── Public API ─────────────────────────────────────────────────────
  /** Synchronous read of items at a parent location. Empty array if
   *  none. Pre-decoded from the warm cache; call warmup() once at
   *  boot to populate. UI re-reads after `triggerName` fires. */
  itemsAt(parentLocSig) {
    const sigs = this.#sigsAt(parentLocSig);
    const out = [];
    for (const sig of sigs) {
      const item = this.#itemCache.get(sig);
      if (item !== void 0) out.push(item);
    }
    return out;
  }
  /** Pre-decode every participant layer + body referenced by the index.
   *  Idempotent. Awaitable — when it returns, every itemsAt() read for
   *  every parent location resolves synchronously. */
  async warmup() {
    const idx = this.#readIndex();
    const sigs = /* @__PURE__ */ new Set();
    for (const arr of Object.values(idx)) for (const s of arr) sigs.add(s);
    await Promise.all([...sigs].map((s) => this.#loadItem(s)));
  }
  // ── Subclass calls these to mutate ─────────────────────────────────
  /**
   * Add or replace items at a parent location. Items whose `idOf`
   * matches an existing item replace it; new ids append. The full
   * resulting array is committed atomically: each item's body resource
   * is hashed and stored, each item's layer is committed, the index
   * is updated, and ONE trigger fires regardless of item count.
   *
   * `parentSegments` is the lineage path of the OWNER (the cell). The
   * participant layer for each item is committed at
   * sign([...parentSegments, '__<slot>__', idOf(item)]).
   */
  async upsert(parentSegments, items) {
    const segs = this.#cleanSegments(parentSegments);
    if (segs.length === 0) {
      throw new Error(`[hive:${this.slot}] upsert requires non-empty parentSegments`);
    }
    if (items.length === 0) {
      throw new Error(`[hive:${this.slot}] upsert requires at least one item; use remove() to delete`);
    }
    const parentLocSig = await this.#signSegments(segs);
    const prior = this.itemsAt(parentLocSig);
    const replaceIds = new Set(items.map((i) => this.idOf(i)));
    const merged = [
      ...prior.filter((p) => !replaceIds.has(this.idOf(p))),
      ...items
    ];
    await this.#commit(segs, parentLocSig, merged);
  }
  /**
   * Remove an item by id at a parent location. Throws when no item
   * with that id exists at that location — silent misses hide bugs.
   * If the resulting set is empty, the slot at parentLocSig is
   * removed from the index (so the cell's layer no longer carries
   * this slot field).
   */
  async remove(parentSegments, id) {
    const segs = this.#cleanSegments(parentSegments);
    if (segs.length === 0) {
      throw new Error(`[hive:${this.slot}] remove requires non-empty parentSegments`);
    }
    if (!id) throw new Error(`[hive:${this.slot}] remove requires a non-empty id`);
    const parentLocSig = await this.#signSegments(segs);
    const prior = this.itemsAt(parentLocSig);
    const next = prior.filter((p) => this.idOf(p) !== id);
    if (next.length === prior.length) {
      throw new Error(`[hive:${this.slot}] no item with id "${id}" at parent ${parentLocSig.slice(0, 8)}`);
    }
    await this.#commit(segs, parentLocSig, next);
  }
  // ── Construction ───────────────────────────────────────────────────
  constructor() {
    queueMicrotask(() => this.#register());
  }
  #register() {
    if (typeof this.slot !== "string" || !/^[a-z][a-z0-9-]*$/.test(this.slot)) {
      throw new Error(`[hive] invalid slot name "${this.slot}" (must be lowercase, alphanumeric+hyphen)`);
    }
    if (this.slot === "name" || this.slot === "children") {
      throw new Error(`[hive] slot name "${this.slot}" is reserved`);
    }
    if (typeof this.triggerName !== "string" || !this.triggerName.includes(":")) {
      throw new Error(`[hive:${this.slot}] invalid triggerName "${this.triggerName}" (expected "domain:event")`);
    }
    if (typeof this.version !== "number" || !Number.isInteger(this.version) || this.version < 1) {
      throw new Error(`[hive:${this.slot}] version must be a positive integer`);
    }
    this.#enforceVersion();
    const registry = get("@diamondcoreprocessor.com/LayerSlotRegistry");
    if (!registry) {
      throw new Error(`[hive:${this.slot}] LayerSlotRegistry not on ioc \u2014 load order is broken`);
    }
    registry.register({
      slot: this.slot,
      triggers: [this.triggerName],
      read: (parentLocSig) => {
        const sigs = this.#sigsAt(parentLocSig);
        return sigs.length > 0 ? [...sigs] : void 0;
      }
    });
  }
  // ── Internal: index ────────────────────────────────────────────────
  /** Decoded participant layer sig → item. Populated by warmup() and
   *  by every #commit. itemsAt() reads here synchronously. */
  #itemCache = /* @__PURE__ */ new Map();
  get #indexKey() {
    return `hypercomb:hive:${this.slot}`;
  }
  get #versionKey() {
    return `hypercomb:hive:${this.slot}:version`;
  }
  /** Wipe the index whenever the on-disk shape (per `version`) doesn't
   *  match what's stored. Explicit erasure — no migration. The legacy
   *  data is no longer reachable from this version's code. */
  #enforceVersion() {
    const stored = localStorage.getItem(this.#versionKey);
    if (stored === String(this.version)) return;
    localStorage.removeItem(this.#indexKey);
    localStorage.setItem(this.#versionKey, String(this.version));
  }
  #readIndex() {
    const raw = localStorage.getItem(this.#indexKey);
    if (raw === null) return {};
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`[hive:${this.slot}] index JSON corrupt \u2014 manual repair required`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`[hive:${this.slot}] index shape invalid \u2014 expected object`);
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (!SIG_REGEX.test(k)) {
        throw new Error(`[hive:${this.slot}] index key "${k}" is not a 64-hex sig`);
      }
      if (!Array.isArray(v)) {
        throw new Error(`[hive:${this.slot}] index value at "${k}" is not an array`);
      }
      for (const s of v) {
        if (typeof s !== "string" || !SIG_REGEX.test(s)) {
          throw new Error(`[hive:${this.slot}] index has bad sig under "${k}"`);
        }
      }
    }
    return parsed;
  }
  #writeIndex(next) {
    localStorage.setItem(this.#indexKey, JSON.stringify(next));
  }
  #sigsAt(parentLocSig) {
    if (!SIG_REGEX.test(parentLocSig)) return [];
    const idx = this.#readIndex();
    return idx[parentLocSig] ?? [];
  }
  // ── Internal: commit ───────────────────────────────────────────────
  async #commit(parentSegments, parentLocSig, items) {
    const history = get("@diamondcoreprocessor.com/HistoryService");
    const store = get("@hypercomb.social/Store");
    if (!history) throw new Error(`[hive:${this.slot}] HistoryService not on ioc`);
    if (!store) throw new Error(`[hive:${this.slot}] Store not on ioc`);
    const sorted = [...items].sort((a, b) => {
      const ka = this.sortKey(a), kb = this.sortKey(b);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      const ia = this.idOf(a), ib = this.idOf(b);
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    });
    const layerSigs = [];
    for (const item of sorted) {
      const id = this.idOf(item);
      if (!id || typeof id !== "string") {
        throw new Error(`[hive:${this.slot}] idOf returned an invalid id`);
      }
      const bodyText = this.canonicalizeBody(item);
      if (typeof bodyText !== "string") {
        throw new Error(`[hive:${this.slot}] canonicalizeBody must return a string`);
      }
      const bodyBytes = new TextEncoder().encode(bodyText);
      const bodySig = await SignatureService.sign(bodyBytes.buffer);
      await store.putResource(new Blob([bodyText], { type: "application/json" }));
      const layer = this.layerFor(item, bodySig);
      if (!layer || layer.name !== id) {
        throw new Error(`[hive:${this.slot}] layerFor must return { name: idOf(item) === "${id}" } (got "${layer?.name}")`);
      }
      const participantSegments = [...parentSegments, `__${this.slot}__`, id];
      const participantLocSig = await this.#signSegments(participantSegments);
      const participantLayerSig = await history.commitLayer(participantLocSig, layer);
      this.#itemCache.set(participantLayerSig, item);
      layerSigs.push(participantLayerSig);
    }
    const idx = this.#readIndex();
    if (layerSigs.length === 0) {
      delete idx[parentLocSig];
    } else {
      idx[parentLocSig] = layerSigs;
    }
    this.#writeIndex(idx);
    EffectBus.emit(this.triggerName, { segments: [...parentSegments] });
  }
  async #signSegments(segments) {
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!history) throw new Error(`[hive:${this.slot}] HistoryService not on ioc`);
    return history.sign({ explorerSegments: () => [...segments] });
  }
  #cleanSegments(segments) {
    return segments.map((s) => String(s ?? "").trim()).filter((s) => s.length > 0);
  }
  async #loadItem(participantLayerSig) {
    if (this.#itemCache.has(participantLayerSig)) return this.#itemCache.get(participantLayerSig);
    const history = get("@diamondcoreprocessor.com/HistoryService");
    const store = get("@hypercomb.social/Store");
    if (!history || !store) return null;
    const layer = await history.getLayerBySig(participantLayerSig);
    if (!layer) return null;
    const bodyField = layer["body"];
    if (!Array.isArray(bodyField) || bodyField.length !== 1) {
      throw new Error(`[hive:${this.slot}] layer ${participantLayerSig.slice(0, 8)} has no canonical body sig`);
    }
    const bodySig = bodyField[0];
    if (typeof bodySig !== "string" || !SIG_REGEX.test(bodySig)) {
      throw new Error(`[hive:${this.slot}] layer ${participantLayerSig.slice(0, 8)} body[0] is not a sig`);
    }
    const blob = await store.getResource(bodySig);
    if (!blob) return null;
    const text = await blob.text();
    const item = this.decodeBody(text);
    this.#itemCache.set(participantLayerSig, item);
    return item;
  }
  /** Drop a localStorage key that predates this participant's index.
   *  Subclasses call from constructor when they know the legacy key
   *  name. Explicit erasure of carryover state. */
  purgeLegacyKey(key) {
    if (localStorage.getItem(key) !== null) localStorage.removeItem(key);
  }
};

// src/diamondcoreprocessor.com/notes/notes.drone.ts
var NOTE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12l4 4v12H4z"/><polyline points="16 4 16 8 20 8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="14" y2="16"/></svg>`;
var NOTE_ACCENT = 16769354;
var CAPTURE_MODE = "note-capture";
var NotesService = class extends HiveParticipant {
  slot = "notes";
  triggerName = "notes:changed";
  version = 1;
  // Memoized cell-locationSig keyed by `parent/cellLabel`. Cleared
  // when Lineage changes (the same cellLabel resolves to a different
  // location depending on which folder the user is in).
  #cellLocSigCache = /* @__PURE__ */ new Map();
  idOf(note) {
    return note.id;
  }
  sortKey(note) {
    return note.createdAt;
  }
  canonicalizeBody(note) {
    return canonicalJSON(note);
  }
  decodeBody(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("[notes] body did not parse to an object");
    }
    if (typeof parsed.id !== "string" || typeof parsed.text !== "string" || typeof parsed.createdAt !== "number") {
      throw new Error("[notes] body is missing required fields {id, text, createdAt}");
    }
    return parsed;
  }
  layerFor(note, bodySig) {
    return { name: note.id, body: [bodySig] };
  }
  constructor() {
    super();
    this.purgeLegacyKey("hc:notes-index");
    const lineage = get("@hypercomb.social/Lineage");
    lineage?.addEventListener?.("change", () => this.#cellLocSigCache.clear());
    const iconRegistry = get("@hypercomb.social/IconProviderRegistry");
    iconRegistry?.add({
      name: "note",
      owner: "@diamondcoreprocessor.com/NotesService",
      svgMarkup: NOTE_ICON_SVG,
      profile: "private",
      hoverTint: NOTE_ACCENT,
      tintWhen: (ctx) => ctx.hasNotes ? NOTE_ACCENT : null,
      labelKey: "action.note",
      descriptionKey: "action.note.description"
    });
    EffectBus2.on("note:capture", (payload) => {
      if (!payload?.cellLabel) return;
      EffectBus2.emit("command:enter-mode", {
        mode: CAPTURE_MODE,
        target: payload.cellLabel,
        prefill: payload.prefill ?? "",
        editId: payload.editId ?? ""
      });
    });
    EffectBus2.on("note:commit", (payload) => {
      const text = (payload?.text ?? "").trim();
      if (!payload?.cellLabel || !text) return;
      void this.#applyToCell(payload.cellLabel, async (prior) => {
        const now = Date.now();
        if (payload.editId) {
          const idx = prior.findIndex((n) => n.id === payload.editId);
          if (idx >= 0) {
            const next = prior.slice();
            next[idx] = { ...prior[idx], text, updatedAt: now };
            return { upsert: [next[idx]] };
          }
        }
        return { upsert: [{ id: cryptoRandomId(), text, createdAt: now }] };
      });
    });
    EffectBus2.on("note:delete", (payload) => {
      if (!payload?.cellLabel || !payload?.noteId) return;
      void this.#applyToCell(payload.cellLabel, async () => ({ remove: payload.noteId }));
    });
    EffectBus2.on("note:tag", (payload) => {
      const tag = (payload?.tag ?? "").trim();
      if (!payload?.cellLabel || !payload?.noteId || !tag) return;
      void this.#applyToCell(payload.cellLabel, async (prior) => {
        const note = prior.find((n) => n.id === payload.noteId);
        if (!note) return null;
        const tags = new Set(note.tags ?? []);
        if (payload.remove) tags.delete(tag);
        else tags.add(tag);
        return {
          upsert: [{ ...note, tags: [...tags].sort(), updatedAt: Date.now() }]
        };
      });
    });
  }
  // ── Public read API (back-compat with UI consumers) ───────────────
  /** Synchronous notes for a cell at the user's current lineage.
   *  Empty array if no notes (or the warm cache hasn't loaded yet —
   *  call getNotes() async or warmup() at boot to populate). */
  notesFor = (cellLabel) => {
    const locSig = this.#cellLocationSigSync(cellLabel);
    if (!locSig) return [];
    return this.itemsAt(locSig).slice().sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };
  /** Async-resolving notes for a cell. Awaits cell-loc resolution AND
   *  any cold cache loads. After this, notesFor() reads sync. */
  getNotes = async (cellLabel) => {
    await this.warmup();
    const resolved = await this.#resolveCellLocation(cellLabel);
    if (!resolved) return [];
    return this.itemsAt(resolved.locationSig).slice().sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };
  // ── Internal: cell-location resolution + transform plumbing ───────
  /**
   * Apply a transform to a cell's notes. The transform returns either
   * `{ upsert: Note[] }` (add or replace items by id) or
   * `{ remove: string }` (drop a single note by id) or `null` (no-op).
   * Resolves the cell's full lineage segments internally.
   */
  async #applyToCell(cellLabel, transform) {
    const resolved = await this.#resolveCellLocation(cellLabel);
    if (!resolved) {
      console.warn("[notes] cannot resolve cell location for", cellLabel);
      return;
    }
    const { segments, locationSig } = resolved;
    const prior = this.itemsAt(locationSig);
    const result = await transform(prior);
    if (!result) return;
    if (result.remove) {
      await this.remove(segments, result.remove);
    } else if (result.upsert && result.upsert.length > 0) {
      await this.upsert(segments, result.upsert);
    }
  }
  async #resolveCellLocation(cellLabel) {
    const lineage = get("@hypercomb.social/Lineage");
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!lineage || !history) return null;
    const parentSegments = (lineage.explorerSegments?.() ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    const segments = [...parentSegments, String(cellLabel ?? "").trim()].filter(Boolean);
    if (segments.length === 0) return null;
    const cacheKey = segments.join("/");
    const cached = this.#cellLocSigCache.get(cacheKey);
    if (cached) return { locationSig: cached, segments };
    const locationSig = await history.sign({ explorerSegments: () => segments });
    this.#cellLocSigCache.set(cacheKey, locationSig);
    return { locationSig, segments };
  }
  #cellLocationSigSync(cellLabel) {
    const lineage = get("@hypercomb.social/Lineage");
    if (!lineage) return "";
    const parentSegments = (lineage.explorerSegments?.() ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    const segments = [...parentSegments, String(cellLabel ?? "").trim()].filter(Boolean);
    if (segments.length === 0) return "";
    return this.#cellLocSigCache.get(segments.join("/")) ?? "";
  }
};
function cryptoRandomId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  const bytes = new Uint8Array(16);
  c?.getRandomValues?.(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function canonicalJSON(value) {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted = {};
      for (const k of Object.keys(v).sort()) sorted[k] = v[k];
      return sorted;
    }
    return v;
  });
}
var _notesService = new NotesService();
window.ioc.register("@diamondcoreprocessor.com/NotesService", _notesService);
export {
  NotesService
};
