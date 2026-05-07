// src/diamondcoreprocessor.com/notes/notes.drone.ts
import { EffectBus as EffectBus2 } from "@hypercomb/core";

// src/diamondcoreprocessor.com/history/hive-participant.ts
import { EffectBus, SignatureService } from "@hypercomb/core";
var SIG_REGEX = /^[a-f0-9]{64}$/;
var HiveParticipant = class {
  // ── Public read API ────────────────────────────────────────────────
  /**
   * Synchronous read of items at a parent location. Reads the parent's
   * current layer from HistoryService's preloader cache, takes its slot
   * field, resolves each sig through the local item cache. Empty array
   * if no parent layer is cached or the slot is absent.
   *
   * For first-time-touched parents (no commits yet) and uncached items,
   * call `warmup()` once at boot — after that every itemsAt() resolves
   * synchronously.
   */
  itemsAt(parentLocSig) {
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!history) return [];
    const parent = history.peekCurrentLayer(parentLocSig);
    if (!parent) return [];
    const slotValue = parent[this.slot];
    if (!Array.isArray(slotValue)) return [];
    const out = [];
    for (const sig of slotValue) {
      if (typeof sig !== "string") continue;
      const item = this.#itemCache.get(sig);
      if (item !== void 0) out.push(item);
    }
    return out;
  }
  /**
   * Async sibling of itemsAt() that hydrates the participant layer +
   * body cache for cells whose layers haven't been loaded into the peek
   * cache yet. Uses the same code path the write side uses, so reads
   * after a fresh selection match what writes see.
   *
   * Why this exists: itemsAt() reads from the SYNC peek cache, but the
   * boot warmup only fills that cache for layers it has already seen.
   * A first-touch cell whose participant layers exist in OPFS but
   * weren't preloaded would return [] from itemsAt() until a write
   * triggered the async hydrator. This method closes that gap so
   * selection reads behave like write reads.
   */
  async itemsAtSegmentsAsync(parentSegments) {
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!history) return [];
    return this.#priorItemsAt(history, parentSegments);
  }
  /**
   * Walk every layer in HistoryService's preloader cache, decode every
   * item carried in this slot. After this resolves, every itemsAt() at
   * every parent in the universe is synchronous.
   *
   * Idempotent: re-calling skips already-decoded participant layer sigs.
   */
  async warmup() {
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!history) return;
    await history.preloadAllBags();
    const sigsToDecode = /* @__PURE__ */ new Set();
    for (const layerSig of history.allKnownLayerSigs()) {
      const layer = history.peekLayerBySig(layerSig);
      if (!layer) continue;
      const v = layer[this.slot];
      if (!Array.isArray(v)) continue;
      for (const s of v) {
        if (typeof s === "string" && SIG_REGEX.test(s) && !this.#itemCache.has(s)) {
          sigsToDecode.add(s);
        }
      }
    }
    await Promise.all([...sigsToDecode].map((s) => this.#loadItem(s)));
  }
  // ── Subclass calls these to mutate ─────────────────────────────────
  /**
   * Add or replace items at a parent location. Items whose `idOf`
   * matches an existing item replace it; new ids append. The full
   * resulting array (sorted canonically) is committed atomically: each
   * item's body resource is hashed and stored, each item's layer is
   * committed, and ONE trigger fires with the full canonical sig list.
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
    const history = get("@diamondcoreprocessor.com/HistoryService");
    const store = get("@hypercomb.social/Store");
    const committer = get("@diamondcoreprocessor.com/LayerCommitter");
    if (!history || !store || !committer) {
      throw new Error(`[hive:${this.slot}] HistoryService / Store / LayerCommitter missing on ioc`);
    }
    const prior = await this.#priorItemsAt(history, segs);
    const replaceIds = new Set(items.map((i) => this.idOf(i)));
    const merged = [
      ...prior.filter((p) => !replaceIds.has(this.idOf(p))),
      ...items
    ];
    const sorted = this.#sortCanonical(merged);
    const layerSigs = [];
    for (const item of sorted) {
      const sig = await this.#commitParticipant(item, segs, history, store);
      layerSigs.push(sig);
    }
    const nextLayer = await this.#nextLayerWithSlot(history, segs, layerSigs);
    await committer.update(segs, nextLayer, /* @__PURE__ */ new Set());
    EffectBus.emit(this.triggerName, {
      segments: [...segs],
      op: "set",
      sigs: layerSigs
    });
  }
  /**
   * Remove an item by id at a parent location. Throws when no item
   * with that id exists — silent misses hide bugs. The remaining items
   * (or empty list) become the parent's new slot value; the trigger
   * fires with the remaining canonical sig list.
   */
  async remove(parentSegments, id) {
    const segs = this.#cleanSegments(parentSegments);
    if (segs.length === 0) {
      throw new Error(`[hive:${this.slot}] remove requires non-empty parentSegments`);
    }
    if (!id) throw new Error(`[hive:${this.slot}] remove requires a non-empty id`);
    const history = get("@diamondcoreprocessor.com/HistoryService");
    const store = get("@hypercomb.social/Store");
    const committer = get("@diamondcoreprocessor.com/LayerCommitter");
    if (!history || !store || !committer) {
      throw new Error(`[hive:${this.slot}] HistoryService / Store / LayerCommitter missing on ioc`);
    }
    const prior = await this.#priorItemsAt(history, segs);
    const next = prior.filter((p) => this.idOf(p) !== id);
    if (next.length === prior.length) {
      throw new Error(`[hive:${this.slot}] no item with id "${id}" at this parent`);
    }
    const sorted = this.#sortCanonical(next);
    const layerSigs = [];
    for (const item of sorted) {
      const sig = await this.#commitParticipant(item, segs, history, store);
      layerSigs.push(sig);
    }
    const nextLayer = await this.#nextLayerWithSlot(history, segs, layerSigs);
    await committer.update(segs, nextLayer, /* @__PURE__ */ new Set());
    EffectBus.emit(this.triggerName, {
      segments: [...segs],
      op: "set",
      sigs: layerSigs
    });
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
    window.ioc.whenReady(
      "@diamondcoreprocessor.com/LayerSlotRegistry",
      (registry) => {
        registry.register({
          slot: this.slot,
          triggers: []
        });
      }
    );
  }
  // ── Internal: item cache (decoded items keyed by participant layer sig) ──
  /** Decoded participant layers, keyed by participant layer sig. The
   *  participant layer sig is what appears in parent.<slot>[i], so the
   *  layer IS the source of truth — this map is just a derived
   *  decode-once cache. */
  #itemCache = /* @__PURE__ */ new Map();
  // ── Internal: read prior items via the layer ───────────────────────
  /**
   * Compose the parent's next-layer state for a layer-as-primitive
   * `update()` call: take the parent's current layer (or an empty
   * skeleton if the cell hasn't been committed yet) and replace this
   * participant's slot with the new sig list. All other slots
   * (children, tags, etc.) are preserved verbatim — `update()` would
   * wipe any slot we omit.
   */
  async #nextLayerWithSlot(history, parentSegments, sigs) {
    const parentLocSig = await this.#signSegments(parentSegments);
    const parent = await history.currentLayerAt(parentLocSig);
    const base = parent ? { ...parent } : { name: parentSegments[parentSegments.length - 1] ?? "" };
    base[this.slot] = sigs.slice();
    return base;
  }
  async #priorItemsAt(history, parentSegments) {
    const parentLocSig = await this.#signSegments(parentSegments);
    const parent = await history.currentLayerAt(parentLocSig);
    if (!parent) return [];
    const slotValue = parent[this.slot];
    if (!Array.isArray(slotValue)) return [];
    const out = [];
    for (const s of slotValue) {
      if (typeof s !== "string" || !SIG_REGEX.test(s)) continue;
      const item = await this.#loadItem(s);
      if (item) out.push(item);
    }
    return out;
  }
  // ── Internal: commit a single participant layer ────────────────────
  async #commitParticipant(item, parentSegments, history, store) {
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
    return participantLayerSig;
  }
  // ── Internal: helpers ──────────────────────────────────────────────
  #sortCanonical(items) {
    return [...items].sort((a, b) => {
      const ka = this.sortKey(a), kb = this.sortKey(b);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      const ia = this.idOf(a), ib = this.idOf(b);
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    });
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
  /** Drop a localStorage key that predates this participant. Subclasses
   *  call from constructor when they know the legacy key name. */
  purgeLegacyKey(key) {
    if (typeof localStorage !== "undefined" && localStorage.getItem(key) !== null) {
      localStorage.removeItem(key);
    }
  }
};

// src/diamondcoreprocessor.com/notes/notes.drone.ts
var NOTE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12l4 4v12H4z"/><polyline points="16 4 16 8 20 8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="14" y2="16"/></svg>`;
var NOTE_ACCENT = 16769354;
var CAPTURE_MODE = "note-capture";
var NotesService = class extends HiveParticipant {
  slot = "notes";
  triggerName = "notes:changed";
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
  /** Async-resolving notes for a cell. Hydrates the participant-body
   *  cache from OPFS via the same async path the write side uses, so
   *  the strip's first-selection read returns the same items the user
   *  would see after committing a new note. After this, notesFor() reads
   *  sync from the now-populated cache. */
  getNotes = async (cellLabel) => {
    const resolved = await this.#resolveCellLocation(cellLabel);
    if (!resolved) return [];
    const items = await this.itemsAtSegmentsAsync(resolved.segments);
    return items.slice().sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };
  /** Async-resolving notes for an EXPLICIT segments path — bypasses the
   *  user's current lineage. Used by renderers that need to traverse a
   *  whole tree (e.g. the website surface walking children → grandchildren
   *  → leaves) without temporarily re-navigating the user. Same async
   *  hydration as getNotes(), so reads match what a write would commit. */
  getNotesAtSegments = async (segments) => {
    const cleaned = (segments ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    if (cleaned.length === 0) return [];
    const items = await this.itemsAtSegmentsAsync(cleaned);
    return items.slice().sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
  /**
   * Append a note at an EXPLICIT cell location (parentSegments + cellLabel)
   * without depending on the user's current navigation. Used by the bridge
   * for headless note authoring during imports / scripted hive builds.
   * Goes through the same `upsert` path as user-typed notes — same merkle
   * commit, same trigger event, same render pipeline.
   */
  async addAtSegments(parentSegments, cellLabel, text) {
    const cleanedParents = (parentSegments ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    const cleanedLabel = String(cellLabel ?? "").trim();
    const cleanedText = String(text ?? "").trim();
    if (!cleanedLabel || !cleanedText) return;
    const segments = [...cleanedParents, cleanedLabel];
    const note = {
      id: cryptoRandomId(),
      text: cleanedText,
      createdAt: Date.now()
    };
    await this.upsert(segments, [note]);
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
