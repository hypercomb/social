// src/diamondcoreprocessor.com/editor/image-drop.drone.ts
import { Drone, EffectBus, hypercomb } from "@hypercomb/core";
var ImageDropDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "editor";
  description = "Intercepts drag-and-drop image files from the desktop and routes them into the tile editor.";
  emits = ["drop:dragging"];
  listens = ["render:host-ready", "drop:target", "editor:mode"];
  #canvas = null;
  #dragging = false;
  #previewUrl = null;
  #effectsRegistered = false;
  /** Last hex position reported by TileOverlayDrone during drag. */
  #lastTarget = null;
  constructor() {
    super();
    document.addEventListener("dragover", this.#onDragOver);
    document.addEventListener("dragleave", this.#onDragLeave);
    document.addEventListener("drop", this.#onDrop);
    document.addEventListener("dragend", this.#onDragEnd);
  }
  heartbeat = async () => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true;
      this.onEffect("render:host-ready", (payload) => {
        this.#canvas = payload.canvas;
      });
      this.onEffect("drop:target", (target) => {
        this.#lastTarget = target;
      });
    }
  };
  // ── drag handlers ─────────────────────────────────────────────
  #onDragOver = (e) => {
    const el = document.activeElement;
    if (el && el.matches?.("input, textarea, select, [contenteditable]")) return;
    const types = e.dataTransfer?.types ?? [];
    if (!types.includes("Files")) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (!this.#dragging) {
      this.#dragging = true;
      this.#tryExtractPreview(e);
      this.emitEffect("drop:dragging", { active: true, previewUrl: this.#previewUrl });
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
    const el = document.activeElement;
    if (el && el.matches?.("input, textarea, select, [contenteditable]")) return;
    const types = e.dataTransfer?.types ?? [];
    if (!types.includes("Files")) return;
    const editorSvc = this.#editorService;
    if (editorSvc?.mode === "editing") {
      const target = e.target;
      if (target?.closest?.(".editor-panel, .image-canvas, hc-tile-editor")) {
        this.#clearDragging();
        return;
      }
    }
    const files = e.dataTransfer?.files;
    if (!files) {
      this.#clearDragging();
      return;
    }
    let imageFile = null;
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith("image/")) {
        imageFile = files[i];
        break;
      }
    }
    if (!imageFile) {
      this.#clearDragging();
      return;
    }
    e.preventDefault();
    const dropTarget = this.#lastTarget;
    this.#clearDragging();
    void this.#routeImage(imageFile, dropTarget);
  };
  // ── routing ───────────────────────────────────────────────────
  async #routeImage(file, target) {
    const blob = new Blob([await file.arrayBuffer()], { type: file.type });
    const editorSvc = this.#editorService;
    if (editorSvc?.mode === "editing") {
      editorSvc.setLargeBlob(blob);
      await this.#loadImageWhenReady(blob);
      return;
    }
    if (target?.occupied && target.label) {
      EffectBus.emit("tile:action", {
        action: "edit",
        label: target.label,
        q: target.q,
        r: target.r,
        index: target.index
      });
      await this.#waitForEditorMode();
      this.#editorService?.setLargeBlob(blob);
      await this.#loadImageWhenReady(blob);
      return;
    }
    const cellName = await this.#createCellFromFile(file.name);
    if (!cellName) return;
    await new Promise((r) => setTimeout(r, 150));
    EffectBus.emit("tile:action", { action: "edit", label: cellName, q: 0, r: 0, index: 0 });
    await this.#waitForEditorMode();
    this.#editorService?.setLargeBlob(blob);
    await this.#loadImageWhenReady(blob);
  }
  // ── preview extraction ────────────────────────────────────────
  #tryExtractPreview(e) {
    if (this.#previewUrl) return;
    try {
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.type.startsWith("image/")) {
          this.#previewUrl = URL.createObjectURL(file);
        }
      }
    } catch {
    }
    if (!this.#previewUrl) {
      try {
        const items = e.dataTransfer?.items;
        if (items) {
          for (let i = 0; i < items.length; i++) {
            if (items[i].kind === "file" && items[i].type.startsWith("image/")) {
              const file = items[i].getAsFile();
              if (file) {
                this.#previewUrl = URL.createObjectURL(file);
                break;
              }
            }
          }
        }
      } catch {
      }
    }
  }
  // ── helpers ───────────────────────────────────────────────────
  #clearDragging() {
    if (!this.#dragging) return;
    this.#dragging = false;
    if (this.#previewUrl) {
      URL.revokeObjectURL(this.#previewUrl);
      this.#previewUrl = null;
    }
    this.emitEffect("drop:dragging", { active: false, previewUrl: null });
  }
  async #createCellFromFile(fileName) {
    const lineage = get("@hypercomb.social/Lineage");
    if (!lineage) return null;
    const dir = await lineage.explorerDir();
    if (!dir) return null;
    const baseName = fileName.replace(/\.[^.]+$/, "");
    let cellName = baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!cellName) cellName = "image";
    const existing = /* @__PURE__ */ new Set();
    for await (const key of dir.keys()) {
      existing.add(key);
    }
    let finalName = cellName;
    if (existing.has(finalName)) {
      let counter = 2;
      while (existing.has(`${cellName}-${counter}`)) counter++;
      finalName = `${cellName}-${counter}`;
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
  // ── IoC accessors ─────────────────────────────────────────────
  get #editorService() {
    return get("@diamondcoreprocessor.com/TileEditorService");
  }
  get #imageEditor() {
    return get("@diamondcoreprocessor.com/ImageEditorService");
  }
};
var _imageDrop = new ImageDropDrone();
window.ioc.register("@diamondcoreprocessor.com/ImageDropDrone", _imageDrop);
export {
  ImageDropDrone
};
