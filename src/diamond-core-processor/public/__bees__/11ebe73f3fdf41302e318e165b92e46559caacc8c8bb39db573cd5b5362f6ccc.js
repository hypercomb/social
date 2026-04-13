// src/diamondcoreprocessor.com/clipboard/image-paste.worker.ts
import { Worker, EffectBus, hypercomb } from "@hypercomb/core";
var ImagePasteWorker = class extends Worker {
  namespace = "diamondcoreprocessor.com";
  genotype = "clipboard";
  description = "Intercepts browser paste events containing images and routes them into the tile editor.";
  emits = [];
  constructor() {
    super();
    document.addEventListener("paste", this.#onPaste);
  }
  act = async () => {
  };
  // ── paste handler ────────────────────────────────────────────
  #onPaste = (e) => {
    const el = document.activeElement;
    if (el && el.matches?.("input, textarea, select, [contenteditable]")) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    let file = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        file = items[i].getAsFile();
        if (file) break;
      }
    }
    if (!file) return;
    e.preventDefault();
    void this.#routeImage(file);
  };
  // ── routing ──────────────────────────────────────────────────
  async #routeImage(blob) {
    const editorSvc = this.#editorService;
    if (editorSvc?.mode === "editing") {
      editorSvc.setLargeBlob(blob);
      await this.#loadImageWhenReady(blob);
      return;
    }
    const selection = this.#selection;
    if (selection && selection.count > 0 && selection.active) {
      const cell = selection.active;
      EffectBus.emit("tile:action", { action: "edit", label: cell, q: 0, r: 0, index: 0 });
      await this.#waitForEditorMode();
      this.#editorService?.setLargeBlob(blob);
      await this.#loadImageWhenReady(blob);
      return;
    }
    const cellName = await this.#createImageCell();
    if (!cellName) return;
    await new Promise((r) => setTimeout(r, 150));
    EffectBus.emit("tile:action", { action: "edit", label: cellName, q: 0, r: 0, index: 0 });
    await this.#waitForEditorMode();
    this.#editorService?.setLargeBlob(blob);
    await this.#loadImageWhenReady(blob);
  }
  // ── helpers ──────────────────────────────────────────────────
  async #createImageCell() {
    const lineage = get("@hypercomb.social/Lineage");
    if (!lineage) return null;
    const dir = await lineage.explorerDir();
    if (!dir) return null;
    const existing = /* @__PURE__ */ new Set();
    for await (const [key] of dir.entries()) {
      existing.add(key);
    }
    let finalName = "image";
    if (existing.has(finalName)) {
      let counter = 2;
      while (existing.has(`image-${counter}`)) counter++;
      finalName = `image-${counter}`;
    }
    await dir.getDirectoryHandle(finalName, { create: true });
    EffectBus.emit("cell:added", { cell: finalName });
    void new hypercomb().act();
    return finalName;
  }
  async #waitForEditorMode() {
    if (this.#editorService?.mode === "editing") return;
    await new Promise((resolve) => {
      const off = EffectBus.on("editor:mode", (payload) => {
        if (payload?.active) {
          off();
          resolve();
        }
      });
      setTimeout(() => {
        off();
        resolve();
      }, 2e3);
    });
  }
  async #loadImageWhenReady(blob) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const ie = this.#imageEditor;
      if (ie) {
        await ie.loadImage(blob);
        if (ie.hasImage) return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  get #editorService() {
    return get("@diamondcoreprocessor.com/TileEditorService");
  }
  get #imageEditor() {
    return get("@diamondcoreprocessor.com/ImageEditorService");
  }
  get #selection() {
    return get("@diamondcoreprocessor.com/SelectionService");
  }
};
var _imagePaste = new ImagePasteWorker();
window.ioc.register("@diamondcoreprocessor.com/ImagePasteWorker", _imagePaste);
export {
  ImagePasteWorker
};
