// src/diamondcoreprocessor.com/notes/notes.drone.ts
import { EffectBus } from "@hypercomb/core";
var NOTE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M19 3H4.99c-1.11 0-1.98.9-1.98 2L3 19c0 1.1.89 2 2 2h10l6-6V5c0-1.1-.9-2-2-2zM7 8h10v2H7V8zm5 6H7v-2h5v2zm2 5.5V14h5.5L14 19.5z"/></svg>`;
var NOTE_ACCENT = 16769354;
var NOTES_TRIGGER = "notes:changed";
var NOTES_SLOT = "notes";
var CAPTURE_MODE = "note-capture";
var SIG_REGEX = /^[a-f0-9]{64}$/;
var NotesService = class {
  slot = NOTES_SLOT;
  triggerName = NOTES_TRIGGER;
  // Decoded note layers, keyed by layer sig. Populated lazily on read,
  // and on write right after we mint a layer.
  #cache = /* @__PURE__ */ new Map();
  // Memoized cell-locationSig keyed by `parent/cellLabel`. Cleared on
  // lineage navigation (same cellLabel resolves to a different location
  // depending on the current folder).
  #cellLocSigCache = /* @__PURE__ */ new Map();
  constructor() {
    this.#purgeLegacyKey("hc:notes-index");
    window.ioc.whenReady(
      "@diamondcoreprocessor.com/LayerSlotRegistry",
      (registry) => {
        registry.register({ slot: NOTES_SLOT, triggers: [] });
      }
    );
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
      void this.#commit(payload.cellLabel, text, payload.editId);
    });
    EffectBus.on("note:delete", (payload) => {
      if (!payload?.cellLabel || !payload?.noteId) return;
      void this.#deleteByCellLabel(payload.cellLabel, payload.noteId);
    });
  }
  // ── Public read API ───────────────────────────────────────────────
  /**
   * Synchronous notes for a cell at the user's current lineage. Reads
   * from the peek cache (populated by the preloader walk and by writes).
   * Returns an empty array if the cell hasn't been touched yet — call
   * `getNotes()` for the async hydrating read.
   */
  notesFor = (cellLabel) => {
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!history) return [];
    const locSig = this.#cellLocationSigSync(cellLabel);
    if (!locSig) return [];
    const layer = history.peekCurrentLayer(locSig);
    if (!layer) return [];
    const sigs = layer[NOTES_SLOT];
    if (!Array.isArray(sigs)) return [];
    const out = [];
    for (const sig of sigs) {
      if (typeof sig !== "string" || !SIG_REGEX.test(sig)) continue;
      const cached = this.#cache.get(sig);
      if (cached) out.push(this.#hydrate(sig, cached));
    }
    return out;
  };
  /**
   * Async-resolving notes for a cell at the user's current lineage.
   * Walks OPFS as needed so reads at first selection match what writes
   * see.
   */
  getNotes = async (cellLabel) => {
    const resolved = await this.#resolveCellLocation(cellLabel);
    if (!resolved) return [];
    return this.#readAtLocation(resolved.locationSig);
  };
  /**
   * Async-resolving notes for an EXPLICIT segments path — bypasses the
   * user's current lineage. Used by renderers walking a tree (e.g. the
   * website surface) without temporarily navigating the user.
   */
  getNotesAtSegments = async (segments) => {
    const cleaned = (segments ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    if (cleaned.length === 0) return [];
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!history) return [];
    const locSig = await history.sign({ explorerSegments: () => cleaned });
    return this.#readAtLocation(locSig);
  };
  // ── Public write API ──────────────────────────────────────────────
  /**
   * Append a top-level note at an explicit cell location. Used by the
   * bridge for headless note authoring during imports / scripted hive
   * builds.
   */
  async addAtSegments(parentSegments, cellLabel, text) {
    const cleanedParents = (parentSegments ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    const cleanedLabel = String(cellLabel ?? "").trim();
    const cleanedText = String(text ?? "").trim();
    if (!cleanedLabel || !cleanedText) return;
    const segments = [...cleanedParents, cleanedLabel];
    const sig = await this.#writeNoteLayer(cleanedText, []);
    await this.#commitCellNotes(segments, (prior) => [...prior, sig]);
  }
  /**
   * Remove a top-level note by its layer sig at an explicit cell
   * location. Headless equivalent of the `note:delete` EffectBus
   * handler.
   */
  async deleteAtSegments(parentSegments, cellLabel, noteId) {
    const cleanedParents = (parentSegments ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    const cleanedLabel = String(cellLabel ?? "").trim();
    const cleanedSig = String(noteId ?? "").trim();
    if (!cleanedLabel || !cleanedSig) return;
    const segments = [...cleanedParents, cleanedLabel];
    await this.#commitCellNotes(segments, (prior) => prior.filter((s) => s !== cleanedSig));
  }
  // ── Internal: commit + delete flows ───────────────────────────────
  async #commit(cellLabel, text, editId) {
    const resolved = await this.#resolveCellLocation(cellLabel);
    if (!resolved) {
      console.warn("[notes] cannot resolve cell location for", cellLabel);
      return;
    }
    const { segments } = resolved;
    const newSig = await this.#writeNoteLayer(text, []);
    if (editId && SIG_REGEX.test(editId)) {
      await this.#commitCellNotes(segments, (prior) => prior.map((s) => s === editId ? newSig : s));
    } else {
      await this.#commitCellNotes(segments, (prior) => [...prior, newSig]);
    }
  }
  async #deleteByCellLabel(cellLabel, noteId) {
    const resolved = await this.#resolveCellLocation(cellLabel);
    if (!resolved) return;
    await this.#commitCellNotes(resolved.segments, (prior) => prior.filter((s) => s !== noteId));
  }
  /**
   * Read the cell's current `notes` slot, apply a transform to get the
   * next list, and commit the entire cell layer with the new list via
   * LayerCommitter. Awaits the cascade so the cell layer + every
   * ancestor up to root is at its new sig by the time we resolve.
   * Emits `notes:changed` once the cascade has settled so UI consumers
   * read fresh state.
   */
  async #commitCellNotes(segments, transform) {
    const history = get("@diamondcoreprocessor.com/HistoryService");
    const committer = get("@diamondcoreprocessor.com/LayerCommitter");
    if (!history || !committer) {
      throw new Error("[notes] HistoryService / LayerCommitter missing on ioc");
    }
    const locSig = await history.sign({ explorerSegments: () => segments });
    const priorLayer = await history.currentLayerAt(locSig);
    const priorNotes = Array.isArray(priorLayer?.[NOTES_SLOT]) ? priorLayer[NOTES_SLOT].filter((s) => typeof s === "string") : [];
    const nextNotes = transform(priorNotes);
    const base = priorLayer ? { ...priorLayer } : { name: segments[segments.length - 1] ?? "" };
    base[NOTES_SLOT] = nextNotes.slice();
    await committer.update(segments, base, /* @__PURE__ */ new Set(["children"]));
    EffectBus.emit(NOTES_TRIGGER, {
      segments: [...segments],
      op: "set",
      sigs: nextNotes.slice()
    });
  }
  // ── Internal: note layer write ────────────────────────────────────
  async #writeNoteLayer(text, children) {
    const store = get("@hypercomb.social/Store");
    if (!store) throw new Error("[notes] Store missing on ioc");
    const layer = { children: children.slice(), note: text };
    const json = canonicalJSON(layer);
    const sig = await store.putResource(new Blob([json], { type: "application/json" }));
    this.#cache.set(sig, layer);
    return sig;
  }
  // ── Internal: read paths ──────────────────────────────────────────
  async #readAtLocation(locationSig) {
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!history) return [];
    const layer = await history.currentLayerAt(locationSig);
    if (!layer) return [];
    const sigs = layer[NOTES_SLOT];
    if (!Array.isArray(sigs)) return [];
    const out = [];
    for (const sig of sigs) {
      if (typeof sig !== "string" || !SIG_REGEX.test(sig)) continue;
      const decoded = await this.#loadNoteLayer(sig);
      if (decoded) out.push(this.#hydrate(sig, decoded));
    }
    return out;
  }
  async #loadNoteLayer(sig) {
    const cached = this.#cache.get(sig);
    if (cached) return cached;
    const store = get("@hypercomb.social/Store");
    if (!store) return null;
    const parsed = await store.resolve(sig);
    if (parsed && typeof parsed === "object") {
      const p = parsed;
      if (typeof p.note === "string") {
        const children = Array.isArray(p.children) ? p.children.filter((c) => typeof c === "string" && SIG_REGEX.test(c)) : [];
        const layer2 = { children, note: p.note };
        this.#cache.set(sig, layer2);
        return layer2;
      }
    }
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!history) return null;
    const legacy = await history.getLayerBySig(sig);
    const body = legacy && Array.isArray(legacy["body"]) ? legacy["body"] : null;
    const bodySig = body && body.length === 1 && typeof body[0] === "string" ? body[0] : null;
    if (!bodySig) return null;
    const bodyParsed = await store.resolve(bodySig);
    if (!bodyParsed || typeof bodyParsed !== "object") return null;
    const text = bodyParsed.text;
    if (typeof text !== "string") return null;
    const layer = { children: [], note: text };
    this.#cache.set(sig, layer);
    return layer;
  }
  #hydrate(sig, layer) {
    const children = [];
    for (const childSig of layer.children) {
      const cached = this.#cache.get(childSig);
      if (cached) children.push(this.#hydrate(childSig, cached));
    }
    return { id: sig, text: layer.note, children };
  }
  // ── Internal: cell-location resolution ────────────────────────────
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
  // ── Internal: legacy cleanup ──────────────────────────────────────
  #purgeLegacyKey(key) {
    if (typeof localStorage !== "undefined" && localStorage.getItem(key) !== null) {
      localStorage.removeItem(key);
    }
  }
};
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
