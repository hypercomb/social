// src/diamondcoreprocessor.com/editor/tile-editor.drone.ts
import { EffectBus as EffectBus2 } from "@hypercomb/core";

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

// src/diamondcoreprocessor.com/editor/tile-editor.drone.ts
var EDIT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
var TileEditorDrone = class {
  constructor() {
    EffectBus2.on("tile:action", this.#onTileAction);
    const registry = window.ioc.get("@hypercomb.social/IconProviderRegistry");
    registry?.add({
      name: "edit",
      owner: "@diamondcoreprocessor.com/TileEditorDrone",
      svgMarkup: EDIT_ICON_SVG,
      profile: "private",
      hoverTint: 13162751,
      labelKey: "action.edit",
      descriptionKey: "action.edit.description"
    });
  }
  // ── effect handler ─────────────────────────────────────────────
  #onTileAction = (payload) => {
    if (payload.action !== "edit") return;
    void this.#openEditing(payload.label);
  };
  // ── open editor ────────────────────────────────────────────────
  async #openEditing(cell) {
    const store = window.ioc.get("@hypercomb.social/Store");
    const service = window.ioc.get("@diamondcoreprocessor.com/TileEditorService");
    if (!store || !service) return;
    const lineage = window.ioc.get("@hypercomb.social/Lineage");
    const parentSegments = lineage?.explorerSegments?.() ?? [];
    let properties = {};
    try {
      const layerProps = await readTilePropertiesAt(parentSegments, cell);
      if (Object.keys(layerProps).length > 0) {
        properties = layerProps;
      } else {
        throw new Error("no layer-slot properties");
      }
    } catch {
      try {
        const indexKey = "hc:tile-props-index";
        const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
        const propsSig = index[cell];
        if (!propsSig) throw new Error("no index entry");
        const propsBlob = await store.getResource(propsSig);
        if (!propsBlob) throw new Error("props blob missing");
        const text = await propsBlob.text();
        properties = JSON.parse(text);
      } catch {
        try {
          const dir = await lineage?.explorerDir?.();
          if (dir) {
            const cellDir = await dir.getDirectoryHandle(cell, { create: false });
            properties = await readCellProperties(cellDir);
          }
        } catch {
        }
      }
    }
    let largeBlob = null;
    const largeSig = properties.large?.image;
    if (largeSig && typeof largeSig === "string") {
      largeBlob = await store.getResource(largeSig);
    }
    service.open(cell, properties, largeBlob);
  }
  // ── save (called by Angular component) ─────────────────────────
  saveAndComplete = async () => {
    const store = window.ioc.get("@hypercomb.social/Store");
    const service = window.ioc.get("@diamondcoreprocessor.com/TileEditorService");
    const imageEditor = window.ioc.get("@diamondcoreprocessor.com/ImageEditorService");
    const settings = window.ioc.get("@diamondcoreprocessor.com/Settings");
    if (!store || !service || !imageEditor || !settings) return;
    if (service.mode !== "editing") return;
    const savedCell = service.cell;
    let saveSucceeded = false;
    try {
      const props = { ...service.properties };
      const currentOrientation = imageEditor.orientation ?? "point-top";
      if (imageEditor.hasImage) {
        const currentTransform = imageEditor.getTransform();
        service.updateTransform(currentTransform.x, currentTransform.y, currentTransform.scale, currentOrientation);
        const curW = settings.hexWidth(currentOrientation);
        const curH = settings.hexHeight(currentOrientation);
        const currentBlob = await imageEditor.captureSmall(curW, curH);
        const currentSig = await store.putResource(currentBlob);
        const otherOrientation = currentOrientation === "point-top" ? "flat-top" : "point-top";
        const otherW = settings.hexWidth(otherOrientation);
        const otherH = settings.hexHeight(otherOrientation);
        const savedOtherTransform = otherOrientation === "flat-top" ? props.flat?.large : props.large;
        await imageEditor.setOrientation(
          otherOrientation,
          savedOtherTransform ? { x: savedOtherTransform.x ?? 0, y: savedOtherTransform.y ?? 0, scale: savedOtherTransform.scale ?? 1 } : void 0
        );
        const otherBlob = await imageEditor.captureSmall(otherW, otherH);
        const otherSig = await store.putResource(otherBlob);
        const otherActualTransform = imageEditor.getTransform();
        await imageEditor.setOrientation(
          currentOrientation,
          { x: currentTransform.x, y: currentTransform.y, scale: currentTransform.scale }
        );
        if (currentOrientation === "point-top") {
          ;
          props.small = { image: currentSig };
          if (!props.flat) props.flat = {};
          props.flat.small = { image: otherSig };
        } else {
          ;
          props.small = { image: otherSig };
          if (!props.flat) props.flat = {};
          props.flat.small = { image: currentSig };
        }
        if (service.largeBlob) {
          const largeSig = await store.putResource(service.largeBlob);
          const pointyTransform = currentOrientation === "point-top" ? currentTransform : otherActualTransform;
          const flatTransform = currentOrientation === "flat-top" ? currentTransform : otherActualTransform;
          props.large = {
            image: largeSig,
            x: pointyTransform.x,
            y: pointyTransform.y,
            scale: pointyTransform.scale
          };
          if (!props.flat) props.flat = {};
          props.flat.large = {
            x: flatTransform.x,
            y: flatTransform.y,
            scale: flatTransform.scale
          };
        }
      }
      const json = JSON.stringify(props, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const propsSig = await store.putResource(blob);
      const indexKey = "hc:tile-props-index";
      const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
      index[service.cell] = propsSig;
      localStorage.setItem(indexKey, JSON.stringify(index));
      saveSucceeded = true;
    } finally {
      imageEditor.destroy();
      service.close();
    }
    if (saveSucceeded) {
      EffectBus2.emit("tile:saved", { cell: savedCell });
    }
  };
  // ── cancel ─────────────────────────────────────────────────────
  cancelEditing = () => {
    const imageEditor = window.ioc.get("@diamondcoreprocessor.com/ImageEditorService");
    const service = window.ioc.get("@diamondcoreprocessor.com/TileEditorService");
    imageEditor?.destroy();
    service?.close();
  };
};
window.ioc.register(
  "@diamondcoreprocessor.com/TileEditorDrone",
  new TileEditorDrone()
);
export {
  TileEditorDrone
};
