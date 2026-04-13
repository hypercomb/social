// src/diamondcoreprocessor.com/link/link-drop.worker.ts
import { Worker, EffectBus as EffectBus2 } from "@hypercomb/core";

// src/diamondcoreprocessor.com/link/youtube.ts
function parseYouTubeVideoId(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let videoId = null;
  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] || null;
  }
  if (!videoId && host.includes("youtube.com")) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else if (url.pathname.startsWith("/embed/")) {
      videoId = url.pathname.split("/")[2] || null;
    } else if (url.pathname.startsWith("/shorts/")) {
      videoId = url.pathname.split("/")[2] || null;
    }
  }
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return null;
  }
  return videoId;
}
function youTubeThumbnailUrl(videoId, quality = "hqdefault") {
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
}

// src/diamondcoreprocessor.com/link/photo.ts
var EXTENSION_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml"
};
function extractExtension(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const lastSegment = url.pathname.split("/").pop() ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex < 0) return null;
  return lastSegment.slice(dotIndex + 1).toLowerCase();
}
function imageMimeType(link) {
  const ext = extractExtension(link);
  if (!ext) return null;
  return EXTENSION_MIME[ext] ?? null;
}
var SAFE_IMAGE_MIMES = /* @__PURE__ */ new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/svg+xml"
]);
async function probeImageMime(link) {
  try {
    const resp = await fetch(link, { method: "HEAD" });
    if (!resp.ok) return null;
    const ct = (resp.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    return SAFE_IMAGE_MIMES.has(ct) ? ct : null;
  } catch {
    return null;
  }
}
async function fetchImageBlob(link) {
  let mime = imageMimeType(link);
  if (!mime) {
    mime = await probeImageMime(link);
  }
  if (!mime) return null;
  try {
    const resp = await fetch(link);
    if (!resp.ok) return null;
    const buffer = await resp.arrayBuffer();
    return new Blob([buffer], { type: mime });
  } catch {
    return null;
  }
}

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

// src/diamondcoreprocessor.com/link/link-drop.worker.ts
var LinkDropWorker = class extends Worker {
  namespace = "diamondcoreprocessor.com";
  genotype = "linking";
  description = "Intercepts browser drag-and-drop link events and routes URLs into the tile editor.";
  emits = ["command:arm-resource", "link:safety-blocked", "link:safety-warning"];
  #busy = false;
  constructor() {
    super();
    document.addEventListener("dragover", this.#onDragOver);
    document.addEventListener("drop", this.#onDrop);
  }
  act = async () => {
  };
  // ── drag handlers ─────────────────────────────────────────────
  #onDragOver = (e) => {
    const el = document.activeElement;
    if (el && el.matches?.("input, textarea, select, [contenteditable]")) return;
    const types = e.dataTransfer?.types ?? [];
    const hasLink = types.includes("text/uri-list") || types.includes("text/plain");
    const hasFiles = types.includes("Files");
    if (hasLink && !hasFiles) {
      e.preventDefault();
    }
  };
  #onDrop = (e) => {
    const el = document.activeElement;
    if (el && el.matches?.("input, textarea, select, [contenteditable]")) return;
    const hasFiles = (e.dataTransfer?.types ?? []).includes("Files");
    if (hasFiles) return;
    const url = this.#extractUrl(e);
    if (!url) return;
    e.preventDefault();
    void this.#routeLink(url);
  };
  // ── URL extraction ────────────────────────────────────────────
  #extractUrl(e) {
    const uriList = e.dataTransfer?.getData("text/uri-list") ?? "";
    for (const line of uriList.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && /^https?:\/\//i.test(trimmed)) {
        return trimmed;
      }
    }
    const plain = (e.dataTransfer?.getData("text/plain") ?? "").trim();
    if (/^https?:\/\//i.test(plain)) return plain;
    return null;
  }
  // ── routing ───────────────────────────────────────────────────
  async #routeLink(url) {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const safety = this.#safetyService;
      let verdict = { decision: "allow", reason: "no safety service" };
      if (safety) {
        verdict = await safety.check(url);
      }
      if (verdict.decision === "deny") {
        EffectBus2.emit("link:safety-blocked", { url, reason: verdict.reason });
        console.warn("[link-drop] blocked:", url, verdict.reason);
        return;
      }
      let thumbnailBlob = null;
      const videoId = parseYouTubeVideoId(url);
      if (videoId) {
        try {
          const thumbUrl = youTubeThumbnailUrl(videoId);
          const resp = await fetch(thumbUrl);
          if (resp.ok) thumbnailBlob = await resp.blob();
        } catch {
        }
      }
      if (!thumbnailBlob) {
        thumbnailBlob = await fetchImageBlob(url);
      }
      const editorSvc = this.#editorService;
      if (editorSvc?.mode === "editing") {
        editorSvc.setLink(url);
        if (thumbnailBlob) {
          editorSvc.setLargeBlob(thumbnailBlob);
          await this.#loadImageWhenReady(thumbnailBlob);
        }
      } else if (this.#selection && this.#selection.count > 0 && this.#selection.active) {
        const cell = this.#selection.active;
        EffectBus2.emit("tile:action", { action: "edit", label: cell, q: 0, r: 0, index: 0 });
        await this.#waitForEditorMode();
        this.#editorService?.setLink(url);
        if (thumbnailBlob) {
          this.#editorService?.setLargeBlob(thumbnailBlob);
          await this.#loadImageWhenReady(thumbnailBlob);
        }
      } else {
        await this.#armLink(url, videoId, thumbnailBlob);
      }
      if (verdict.decision === "warn") {
        EffectBus2.emit("link:safety-warning", { url, reason: verdict.reason });
        console.warn("[link-drop] warning:", url, verdict.reason);
      }
    } catch (err) {
      console.warn("[link-drop] failed:", err);
    } finally {
      this.#busy = false;
    }
  }
  // ── arm resource ──────────────────────────────────────────────
  /**
   * Store the resolved thumbnail (if any) as a content-addressed resource
   * and emit `command:arm-resource` so the command-line displays the preview
   * in its chevron slot. The tile is created on Enter by CommandLineComponent.
   */
  async #armLink(url, videoId, thumbnailBlob) {
    const type = videoId ? "youtube" : "link";
    if (thumbnailBlob) {
      await armImageBlob(thumbnailBlob, { url, type });
      return;
    }
    EffectBus2.emit("command:arm-resource", {
      previewUrl: "",
      largeSig: "",
      smallPointSig: null,
      smallFlatSig: null,
      url,
      type
    });
  }
  // ── helpers ───────────────────────────────────────────────────
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
  get #selection() {
    return get("@diamondcoreprocessor.com/SelectionService");
  }
  get #safetyService() {
    return get("@diamondcoreprocessor.com/LinkSafetyService");
  }
};
var _linkDrop = new LinkDropWorker();
window.ioc.register("@diamondcoreprocessor.com/LinkDropWorker", _linkDrop);
export {
  LinkDropWorker
};
