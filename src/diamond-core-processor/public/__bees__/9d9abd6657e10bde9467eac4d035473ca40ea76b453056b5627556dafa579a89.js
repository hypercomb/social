// src/diamondcoreprocessor.com/notes/notes.drone.ts
import { EffectBus, SignatureService, hypercomb } from "@hypercomb/core";
var CAPTURE_MODE = "note-capture";
var NOTES_INDEX_KEY = "hc:notes-index";
var NotesService = class extends EventTarget {
  #queue = Promise.resolve();
  /** In-memory cache of decoded note sets keyed by setSig. Populated on warmup. */
  #setCache = /* @__PURE__ */ new Map();
  constructor() {
    super();
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
   * Read the current note set signature for a cell from the index.
   * Returns "" if the cell has no notes.
   */
  setSigFor = (cellLabel) => {
    const index = this.#readIndex();
    return index[cellLabel] ?? "";
  };
  /**
   * Read the entire `cell -> setSig` index — what LayerCommitter folds into
   * `notesByCell` on the next snapshot.
   */
  readIndex = () => {
    return { ...this.#readIndex() };
  };
  /**
   * Resolve the current notes for a cell. Hits the warm in-memory cache when
   * possible; otherwise loads the resource and caches it.
   */
  getNotes = async (cellLabel) => {
    const sig = this.setSigFor(cellLabel);
    if (!sig) return [];
    const set = await this.#loadSet(sig);
    return set?.notes ?? [];
  };
  /**
   * Synchronous read from the warm cache. Returns an empty array if the
   * cell has no notes or its set has not been decoded yet (call warmup()
   * first or `getNotes` async to populate). UI code that needs to render
   * without async should rely on `notes:changed` to re-read after writes.
   */
  notesFor = (cellLabel) => {
    const sig = this.setSigFor(cellLabel);
    if (!sig) return [];
    const set = this.#setCache.get(sig);
    return set?.notes ?? [];
  };
  /**
   * Pre-decode every note set referenced by the current layer head so the UI
   * can read synchronously from the cache. Called by the warmup lifecycle.
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
    const priorSig = this.setSigFor(cellLabel);
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
    index[cellLabel] = resourceSig;
    this.#writeIndex(index);
    this.#setCache.set(resourceSig, snapshot);
    this.dispatchEvent(new CustomEvent("change", { detail: { cellLabel, count: snapshot.notes.length } }));
    EffectBus.emit("notes:changed", { cellLabel, count: snapshot.notes.length });
    void new hypercomb().act();
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
export {
  NotesService
};
