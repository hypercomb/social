// src/diamondcoreprocessor.com/assistant/wiki-drop.drone.ts
import { Drone, EffectBus } from "@hypercomb/core";
var ACCEPTED_TYPES = /* @__PURE__ */ new Set([
  "text/plain",
  "text/markdown",
  "text/html",
  "application/pdf"
]);
var ACCEPTED_EXTENSIONS = /* @__PURE__ */ new Set([".txt", ".md", ".markdown", ".html", ".htm", ".pdf"]);
function isDocumentFile(file) {
  if (ACCEPTED_TYPES.has(file.type)) return true;
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return ACCEPTED_EXTENSIONS.has(ext);
}
var WikiDropDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "assistant";
  description = "Intercepts drag-and-drop document files and routes them to WikiDrone for knowledge decomposition.";
  emits = ["wiki:ingest", "drop:dragging"];
  listens = ["render:host-ready"];
  #effectsRegistered = false;
  #dragging = false;
  constructor() {
    super();
    document.addEventListener("dragover", this.#onDragOver);
    document.addEventListener("dragleave", this.#onDragLeave);
    document.addEventListener("drop", this.#onDrop);
    document.addEventListener("dragend", this.#onDragEnd);
  }
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
  };
  // ── drag handlers ─────────────────────────────────────────
  #onDragOver = (e) => {
    const types = e.dataTransfer?.types ?? [];
    if (!types.includes("Files")) return;
    const items = e.dataTransfer?.items;
    if (items && items.length > 0) {
      const first = items[0];
      if (first.kind === "file" && first.type.startsWith("image/")) return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (!this.#dragging) {
      this.#dragging = true;
      this.emitEffect("drop:dragging", { active: true, previewUrl: null });
    }
  };
  #onDragLeave = (e) => {
    if (e.relatedTarget) return;
    this.#clearDragging();
  };
  #onDragEnd = () => {
    this.#clearDragging();
  };
  #onDrop = (e) => {
    const types = e.dataTransfer?.types ?? [];
    if (!types.includes("Files")) return;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) {
      this.#clearDragging();
      return;
    }
    let docFile = null;
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith("image/")) continue;
      if (isDocumentFile(files[i])) {
        docFile = files[i];
        break;
      }
    }
    if (!docFile) {
      this.#clearDragging();
      return;
    }
    e.preventDefault();
    this.#clearDragging();
    void this.#readAndEmit(docFile);
  };
  // ── file reading ──────────────────────────────────────────
  async #readAndEmit(file) {
    try {
      const content = await file.text();
      if (!content.trim()) {
        console.warn("[wiki-drop] Empty file:", file.name);
        return;
      }
      EffectBus.emit("wiki:ingest", {
        content,
        source: "file-drop",
        fileName: file.name
      });
      console.log(`[wiki-drop] ${file.name} (${content.length} chars) \u2192 wiki:ingest`);
    } catch (err) {
      console.warn("[wiki-drop] Failed to read file:", err);
    }
  }
  // ── helpers ───────────────────────────────────────────────
  #clearDragging() {
    if (!this.#dragging) return;
    this.#dragging = false;
    this.emitEffect("drop:dragging", { active: false, previewUrl: null });
  }
};
var _wikiDrop = new WikiDropDrone();
window.ioc.register("@diamondcoreprocessor.com/WikiDropDrone", _wikiDrop);
console.log("[WikiDropDrone] Loaded");
export {
  WikiDropDrone
};
