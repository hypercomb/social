// src/diamondcoreprocessor.com/notes/notes.drone.ts
import { EffectBus, SignatureService, hypercomb } from "@hypercomb/core";
var CAPTURE_MODE = "note-capture";
var NOTES_INDEX_KEY = "hc:notes-index";
var NotesService = class extends EventTarget {
  #queue = Promise.resolve();
  /** In-memory cache of decoded note sets keyed by setSig. Populated on warmup. */
  #setCache = /* @__PURE__ */ new Map();
  /** Cache of computed cell locationSigs keyed by `parent/cellLabel` so we
   *  don't re-sign the same lineage on every UI tick. Cleared when Lineage
   *  changes (subscribed in constructor). */
  #cellLocSigCache = /* @__PURE__ */ new Map();
  constructor() {
    super();
    const lineage = get("@hypercomb.social/Lineage");
    lineage?.addEventListener?.("change", () => this.#cellLocSigCache.clear());
    EffectBus.on("note:capture", (payload) => {
      if (!payload?.cellLabel) return;
      EffectBus.emit("command:enter-mode", {
        mode: CAPTURE_MODE,
        target: payload.cellLabel,
        prefill: payload.prefill ?? "",
        editId: payload.editId ?? ""
      });
    });
    EffectBus.on("note:commit", (payload) => {
      const text = (payload?.text ?? "").trim();
      if (!payload?.cellLabel || !text) return;
      this.#enqueueWrite(payload.cellLabel, (prior) => {
        const now = Date.now();
        if (payload.editId) {
          const idx = prior.findIndex((n) => n.id === payload.editId);
          if (idx === -1) return [...prior, { id: cryptoRandomId(), text, createdAt: now }];
          const next = prior.slice();
          next[idx] = { ...prior[idx], text, updatedAt: now };
          return next;
        }
        return [...prior, { id: cryptoRandomId(), text, createdAt: now }];
      });
    });
    EffectBus.on("note:delete", (payload) => {
      if (!payload?.cellLabel || !payload?.noteId) return;
      this.#enqueueWrite(payload.cellLabel, (prior) => {
        let next = prior.filter((n) => n.id !== payload.noteId);
        if (next.length === prior.length) {
          next = prior.filter((n) => {
            const fallbackId = `${n.createdAt ?? ""}:${n.text ?? ""}`;
            return fallbackId !== payload.noteId;
          });
        }
        if (next.length === prior.length) {
          console.warn("[notes] delete: no matching note for id", payload.noteId, "in cell", payload.cellLabel);
          return prior;
        }
        return next;
      });
    });
    EffectBus.on("note:tag", (payload) => {
      const tag = (payload?.tag ?? "").trim();
      if (!payload?.cellLabel || !payload?.noteId || !tag) return;
      this.#enqueueWrite(payload.cellLabel, (prior) => {
        const idx = prior.findIndex((n) => n.id === payload.noteId);
        if (idx === -1) return prior;
        const note = prior[idx];
        const tags = new Set(note.tags ?? []);
        if (payload.remove) tags.delete(tag);
        else tags.add(tag);
        const next = prior.slice();
        next[idx] = { ...note, tags: [...tags].sort(), updatedAt: Date.now() };
        return next;
      });
    });
  }
  /**
   * Read the current note set signature for a cell at the user's
   * current location. Returns "" if the cell has no notes. Resolves
   * the cell's full layer location internally — callers don't pass
   * segments; the lineage is implicit (same UI assumption as before).
   */
  setSigFor = (cellLabel) => {
    const locSig = this.#cellLocationSigSync(cellLabel);
    if (!locSig) return "";
    const index = this.#readIndex();
    return index[locSig] ?? "";
  };
  /**
   * Slot-side read: given a layer's location sig, return the note set
   * sig stored under it (or "" / undefined). LayerSlotRegistry calls
   * this during snapshot assembly. Pure lookup — no lineage needed.
   */
  setSigForLocation = (locationSig) => {
    const index = this.#readIndex();
    return index[locationSig] ?? "";
  };
  /**
   * Read the entire `locationSig -> setSig` index. For diagnostics
   * and potential bulk operations; the per-slot read goes through
   * setSigForLocation directly.
   */
  readIndex = () => {
    return { ...this.#readIndex() };
  };
  /**
   * Resolve the current notes for a cell at the user's current
   * location. Async — waits for the resource to load if not cached.
   */
  getNotes = async (cellLabel) => {
    const sig = this.setSigFor(cellLabel);
    if (!sig) return [];
    const set = await this.#loadSet(sig);
    return set?.notes ?? [];
  };
  /**
   * Synchronous read from the warm cache. Returns an empty array if
   * the cell has no notes or its set has not been decoded yet (call
   * warmup() first or getNotes() async to populate). UI code re-reads
   * after `notes:changed`.
   */
  notesFor = (cellLabel) => {
    const sig = this.setSigFor(cellLabel);
    if (!sig) return [];
    const set = this.#setCache.get(sig);
    return set?.notes ?? [];
  };
  /**
   * Pre-decode every note set referenced by the index so the UI can
   * read synchronously from the cache. Called by the warmup lifecycle.
   */
  warmup = async () => {
    const sigs = new Set(Object.values(this.#readIndex()).filter(Boolean));
    await Promise.all([...sigs].map((s) => this.#loadSet(s)));
  };
  // ── internal ──────────────────────────────────────────────
  #readIndex() {
    try {
      const raw = localStorage.getItem(NOTES_INDEX_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  #writeIndex(next) {
    localStorage.setItem(NOTES_INDEX_KEY, JSON.stringify(next));
  }
  #enqueueWrite(cellLabel, transform) {
    this.#queue = this.#queue.then(() => this.#write(cellLabel, transform)).catch((err) => {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const stack = err instanceof Error ? err.stack : void 0;
      console.error("[notes] write failed for cell", cellLabel, msg, stack ?? "");
    });
  }
  async #write(cellLabel, transform) {
    const store = get("@hypercomb.social/Store");
    if (!store) return;
    const resolved = await this.#resolveCellLocation(cellLabel);
    if (!resolved) {
      console.warn("[notes] cannot resolve cell location for", cellLabel, "\u2014 skipping write");
      return;
    }
    const { locationSig, segments } = resolved;
    const priorSig = this.setSigForLocation(locationSig);
    const prior = priorSig ? (await this.#loadSet(priorSig))?.notes ?? [] : [];
    const next = transform(prior);
    if (next === prior) return;
    const snapshot = {
      version: 1,
      cellLabel,
      notes: next,
      at: Date.now()
    };
    const json = canonicalJSON(snapshot);
    const blob = new Blob([json], { type: "application/json" });
    const bytes = await blob.arrayBuffer();
    const resourceSig = await SignatureService.sign(bytes);
    await store.putResource(blob);
    const index = this.#readIndex();
    index[locationSig] = resourceSig;
    this.#writeIndex(index);
    this.#setCache.set(resourceSig, snapshot);
    this.dispatchEvent(new CustomEvent("change", { detail: { cellLabel, count: snapshot.notes.length } }));
    EffectBus.emit("notes:changed", {
      cellLabel,
      segments,
      count: snapshot.notes.length
    });
    void new hypercomb().act();
  }
  /**
   * Resolve the layer location of a cell clicked at the current
   * lineage. Returns segments = [...parent, cellLabel] and the sig.
   * Memoized per `parent/cellLabel` until the lineage changes.
   */
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
  /**
   * Synchronous best-effort sigFor — used by UI reads via setSigFor
   * and notesFor. Returns "" when the locationSig hasn't been computed
   * yet (e.g. first visit to a cell). The async getNotes path computes
   * and caches; subsequent sync calls hit the cache.
   *
   * Worst case: the UI shows "no notes" for one frame after navigation,
   * then re-renders on the next `notes:changed` or once getNotes() lands.
   */
  #cellLocationSigSync(cellLabel) {
    const lineage = get("@hypercomb.social/Lineage");
    if (!lineage) return "";
    const parentSegments = (lineage.explorerSegments?.() ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    const segments = [...parentSegments, String(cellLabel ?? "").trim()].filter(Boolean);
    if (segments.length === 0) return "";
    return this.#cellLocSigCache.get(segments.join("/")) ?? "";
  }
  async #loadSet(resourceSig) {
    const cached = this.#setCache.get(resourceSig);
    if (cached) return cached;
    const store = get("@hypercomb.social/Store");
    if (!store) return null;
    try {
      const blob = await store.getResource(resourceSig);
      if (!blob) return null;
      const text = await blob.text();
      const parsed = JSON.parse(text);
      if (parsed && parsed.version === 1 && Array.isArray(parsed.notes)) {
        const notes = parsed.notes.map((n) => {
          if (n && typeof n.id === "string" && n.id) return n;
          const fallbackId = `${n?.createdAt ?? ""}:${n?.text ?? ""}`;
          return { ...n, id: fallbackId };
        });
        const set = { ...parsed, notes };
        this.#setCache.set(resourceSig, set);
        return set;
      }
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[notes] failed to load set", resourceSig, msg);
      return null;
    }
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
var _slotRegistry = get("@diamondcoreprocessor.com/LayerSlotRegistry");
if (_slotRegistry) {
  _slotRegistry.register({
    slot: "notes",
    triggers: ["notes:changed"],
    read: (locationSig) => {
      const setSig = _notesService.setSigForLocation(locationSig);
      return setSig || void 0;
    }
  });
} else {
  console.warn("[notes] LayerSlotRegistry not available at module-load \u2014 notes will not be captured in history");
}
export {
  NotesService
};
