// src/diamondcoreprocessor.com/clipboard/image-paste.worker.ts
import { Worker, EffectBus } from "@hypercomb/core";
var ImagePasteWorker = class extends Worker {
  namespace = "diamondcoreprocessor.com";
  genotype = "clipboard";
  description = "Intercepts browser paste events containing images and routes them into the tile editor.";
  emits = ["drop:pending", "search:prefill"];
  #pendingBlob = null;
  #pendingCellUnsub = null;
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
    this.#pendingBlob = blob;
    EffectBus.emit("drop:pending", { active: true });
    EffectBus.emit("search:prefill", { value: "" });
    this.#pendingCellUnsub?.();
    this.#pendingCellUnsub = EffectBus.on("cell:added", ({ cell }) => {
      if (!this.#pendingBlob) return;
      const stashedBlob = this.#pendingBlob;
      this.#clearPending();
      void (async () => {
        await new Promise((r) => setTimeout(r, 150));
        EffectBus.emit("tile:action", { action: "edit", label: cell, q: 0, r: 0, index: 0 });
        await this.#waitForEditorMode();
        this.#editorService?.setLargeBlob(stashedBlob);
        await this.#loadImageWhenReady(stashedBlob);
      })();
    });
    setTimeout(() => {
      if (this.#pendingBlob) this.#clearPending();
    }, 3e4);
  }
  // ── helpers ──────────────────────────────────────────────────
  #clearPending() {
    this.#pendingBlob = null;
    this.#pendingCellUnsub?.();
    this.#pendingCellUnsub = null;
    EffectBus.emit("drop:pending", { active: false });
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
