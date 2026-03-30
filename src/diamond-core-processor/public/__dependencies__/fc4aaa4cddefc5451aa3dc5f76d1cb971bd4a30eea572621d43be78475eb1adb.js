// @diamondcoreprocessor.com/link
// src/diamondcoreprocessor.com/link/photo.ts
var IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "bmp",
  "jfif",
  "svg"
]);
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
function isImageUrl(link) {
  const ext = extractExtension(link);
  return ext !== null && IMAGE_EXTENSIONS.has(ext);
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

// src/diamondcoreprocessor.com/link/photo.view.ts
import { EffectBus } from "@hypercomb/core";
var PhotoView = class extends EventTarget {
  #overlay = null;
  show(imageUrl) {
    if (this.#overlay) this.close();
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "10000",
      background: "#0a0a0a",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      opacity: "0",
      transition: "opacity 250ms ease"
    });
    const frame = document.createElement("div");
    Object.assign(frame.style, {
      position: "relative",
      display: "inline-flex",
      padding: "6px",
      borderRadius: "3px",
      background: "linear-gradient(145deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
      border: "1px solid rgba(255,255,255,0.08)",
      boxShadow: [
        "0 0 40px rgba(180, 200, 255, 0.07)",
        "0 0 80px rgba(140, 170, 255, 0.04)",
        "0 2px 16px rgba(0, 0, 0, 0.5)",
        "inset 0 1px 0 rgba(255,255,255,0.04)"
      ].join(", "),
      cursor: "default"
    });
    const img = document.createElement("img");
    img.src = imageUrl;
    Object.assign(img.style, {
      maxWidth: "88vw",
      maxHeight: "88vh",
      objectFit: "contain",
      borderRadius: "2px",
      display: "block"
    });
    frame.addEventListener("click", (e) => e.stopPropagation());
    frame.appendChild(img);
    overlay.appendChild(frame);
    overlay.addEventListener("click", () => this.close());
    document.body.appendChild(overlay);
    this.#overlay = overlay;
    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
    });
    document.addEventListener("keydown", this.#onKeyDown);
    EffectBus.emit("view:active", { active: true, type: "photo" });
  }
  showBlob(blob) {
    const url = URL.createObjectURL(blob);
    this.show(url);
    const img = this.#overlay?.querySelector("img");
    if (img) {
      img.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
    }
  }
  close() {
    if (!this.#overlay) return;
    const overlay = this.#overlay;
    this.#overlay = null;
    overlay.style.opacity = "0";
    overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
    setTimeout(() => overlay.remove(), 350);
    document.removeEventListener("keydown", this.#onKeyDown);
    EffectBus.emit("view:active", { active: false, type: "photo" });
  }
  get isOpen() {
    return this.#overlay !== null;
  }
  #onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };
};
var _photoView = new PhotoView();
window.ioc.register("@diamondcoreprocessor.com/PhotoView", _photoView);

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
export {
  PhotoView,
  fetchImageBlob,
  imageMimeType,
  isImageUrl,
  parseYouTubeVideoId,
  youTubeThumbnailUrl
};
