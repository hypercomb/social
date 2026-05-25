// src/diamondcoreprocessor.com/link/link-open.worker.ts
import { Worker, EffectBus as EffectBus2 } from "@hypercomb/core";

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

// src/diamondcoreprocessor.com/editor/tile-properties.ts
import { EffectBus } from "@hypercomb/core";
var TILE_PROPERTIES_FILE = "0000";
var TILE_PROPERTIES_SLOT = "properties";
window.ioc?.whenReady?.(
  "@diamondcoreprocessor.com/LayerSlotRegistry",
  (registry) => {
    try {
      registry.register({
        slot: TILE_PROPERTIES_SLOT,
        triggers: []
      });
    } catch (err) {
      console.warn("[tile-properties] slot register failed:", err);
    }
  }
);
var readCellProperties = async (cellDir) => {
  let fileHandle;
  try {
    fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE);
  } catch {
    return {};
  }
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch (err) {
    console.warn("[tile-properties] failed to read/parse 0000 in", cellDir.name, err);
    return {};
  }
};
var HISTORY_KEY = "@diamondcoreprocessor.com/HistoryService";
var STORE_KEY = "@hypercomb.social/Store";
var iocGet = (key) => {
  const ioc = window.ioc;
  return ioc?.get?.(key);
};
var readTilePropertiesAt = async (parentSegments, cellName) => {
  const history = iocGet(HISTORY_KEY);
  const store = iocGet(STORE_KEY);
  if (!history?.sign || !history?.currentLayerAt || !store?.getResource) return {};
  const cellSig = await history.sign({
    explorerSegments: () => [...parentSegments, cellName]
  });
  if (!cellSig) return {};
  const layer = await history.currentLayerAt(cellSig);
  const slot = Array.isArray(layer?.properties) ? layer.properties : [];
  const propSig = slot.length > 0 ? slot[0] : void 0;
  if (typeof propSig !== "string" || propSig.length === 0) return {};
  try {
    const blob = await store.getResource(propSig);
    if (!blob) return {};
    const text = await blob.text();
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn("[tile-properties] failed to read/parse properties resource", propSig, err);
    return {};
  }
};

// src/diamondcoreprocessor.com/link/link-open.worker.ts
var LinkOpenWorker = class extends Worker {
  namespace = "diamondcoreprocessor.com";
  genotype = "linking";
  description = "Handles the default tile open action \u2014 routes image links to the photo view.";
  emits = [];
  act = async () => {
    EffectBus2.on("tile:action", (payload) => {
      if (payload.action !== "open") return;
      void this.#handleOpen(payload.label);
    });
  };
  async #handleOpen(label) {
    const link = await this.#readTileLink(label);
    if (!link) return;
    const blob = await fetchImageBlob(link);
    if (blob) {
      this.#photoView?.showBlob(blob);
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
  }
  async #readTileLink(label) {
    const lineage = get("@hypercomb.social/Lineage");
    const parentSegments = lineage?.explorerSegments?.() ?? [];
    try {
      const props = await readTilePropertiesAt(parentSegments, label);
      if (typeof props["link"] === "string" && props["link"].length > 0) {
        return props["link"];
      }
    } catch {
    }
    try {
      const index = JSON.parse(
        localStorage.getItem("hc:tile-props-index") ?? "{}"
      );
      const store = get("@hypercomb.social/Store");
      const sig = index[label];
      if (store && sig) {
        const blob = await store.getResource(sig);
        if (blob) {
          const text = await blob.text();
          const props = JSON.parse(text);
          if (typeof props.link === "string" && props.link.length > 0) return props.link;
        }
      }
    } catch {
    }
    try {
      const dir = await lineage?.explorerDir?.();
      if (!dir) return null;
      const cellDir = await dir.getDirectoryHandle(label, { create: false });
      const props = await readCellProperties(cellDir);
      return typeof props.link === "string" ? props.link : null;
    } catch {
      return null;
    }
  }
  get #photoView() {
    return get("@diamondcoreprocessor.com/PhotoView");
  }
};
var _linkOpen = new LinkOpenWorker();
window.ioc.register("@diamondcoreprocessor.com/LinkOpenWorker", _linkOpen);
export {
  LinkOpenWorker
};
