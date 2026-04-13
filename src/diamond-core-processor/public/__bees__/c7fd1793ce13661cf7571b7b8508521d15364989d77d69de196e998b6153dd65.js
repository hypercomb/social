// src/diamondcoreprocessor.com/editor/image-drop.drone.ts
import { Drone, EffectBus as EffectBus2 } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/arm-resource.ts
import { EffectBus } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/resource-thumbnail.ts
var generateHexThumbnails = async (source) => {
  const settings = window.ioc?.get?.("@diamondcoreprocessor.com/Settings");
  const pw = settings ? Math.round(settings.hexWidth("point-top")) : 346;
  const ph = settings ? Math.round(settings.hexHeight("point-top")) : 400;
  const fw = settings ? Math.round(settings.hexWidth("flat-top")) : 400;
  const fh = settings ? Math.round(settings.hexHeight("flat-top")) : 346;
  const objectUrl = URL.createObjectURL(source);
  try {
    const img = await loadImage(objectUrl);
    const [pointBlob, flatBlob] = await Promise.all([
      renderCover(img, pw, ph),
      renderCover(img, fw, fh)
    ]);
    return { pointBlob, flatBlob };
  } catch {
    return { pointBlob: null, flatBlob: null };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};
var generatePreviewThumbnail = async (source, size = 256) => {
  const objectUrl = URL.createObjectURL(source);
  try {
    const img = await loadImage(objectUrl);
    return await renderCover(img, size, size);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};
var renderCover = (img, targetW, targetH) => {
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  const scale = Math.max(targetW / img.naturalWidth, targetH / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const dx = (targetW - drawW) / 2;
  const dy = (targetH - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
};
var loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("image decode failed"));
  img.src = src;
});

// src/diamondcoreprocessor.com/editor/arm-resource.ts
var armImageBlob = async (blob, opts = {}) => {
  const store = window.ioc?.get?.("@hypercomb.social/Store");
  if (!store) return false;
  const [largeSig, hex, preview] = await Promise.all([
    store.putResource(blob),
    generateHexThumbnails(blob),
    generatePreviewThumbnail(blob)
  ]);
  const smallPointSig = hex.pointBlob ? await store.putResource(hex.pointBlob) : null;
  const smallFlatSig = hex.flatBlob ? await store.putResource(hex.flatBlob) : null;
  const previewUrl = URL.createObjectURL(preview ?? blob);
  EffectBus.emit("command:arm-resource", {
    previewUrl,
    largeSig,
    smallPointSig,
    smallFlatSig,
    url: opts.url ?? null,
    type: opts.type ?? "image"
  });
  return true;
};

// src/diamondcoreprocessor.com/editor/image-drop.drone.ts
var ImageDropDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "editor";
  description = "Intercepts drag-and-drop image files from the desktop and routes them into the tile editor.";
  emits = ["drop:dragging", "command:arm-resource"];
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
      EffectBus2.emit("tile:action", {
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
    await this.#armResource(blob);
  }
  /**
   * Store the dropped image + a generated thumbnail as content-addressed
   * resources, then emit `command:arm-resource` for the command-line to show
   * the preview in its chevron slot. The actual tile creation happens on Enter.
   */
  async #armResource(blob) {
    await armImageBlob(blob, { type: "image" });
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
  async #waitForEditorMode() {
    if (this.#editorService?.mode === "editing") return;
    await new Promise((resolve) => {
      const off = EffectBus2.on("editor:mode", (payload) => {
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
