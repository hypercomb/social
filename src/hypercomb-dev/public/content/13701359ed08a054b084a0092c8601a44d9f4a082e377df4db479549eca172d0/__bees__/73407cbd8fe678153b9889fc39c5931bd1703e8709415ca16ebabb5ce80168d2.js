// src/diamondcoreprocessor.com/editor/tile-editor.drone.ts
import { EffectBus } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/tile-properties.ts
var TILE_PROPERTIES_FILE = "0000";

// src/diamondcoreprocessor.com/editor/tile-editor.drone.ts
var TileEditorDrone = class {
  constructor() {
    EffectBus.on("tile:action", this.#onTileAction);
  }
  // ── effect handler ─────────────────────────────────────────────
  #onTileAction = (payload) => {
    if (payload.action !== "edit") return;
    void this.#openEditing(payload.label);
  };
  // ── open editor ────────────────────────────────────────────────
  async #openEditing(seed) {
    const store = window.ioc.get("@hypercomb.social/Store");
    const service = window.ioc.get("@diamondcoreprocessor.com/TileEditorService");
    if (!store || !service) return;
    let seedDir;
    try {
      seedDir = await store.current.getDirectoryHandle(seed);
    } catch {
      service.open(seed, {}, null);
      return;
    }
    let properties = {};
    try {
      const fileHandle = await seedDir.getFileHandle(TILE_PROPERTIES_FILE);
      const file = await fileHandle.getFile();
      const text = await file.text();
      properties = JSON.parse(text);
    } catch {
    }
    let largeBlob = null;
    const largeSig = properties.large?.image;
    if (largeSig && typeof largeSig === "string") {
      largeBlob = await store.getResource(largeSig);
    }
    service.open(seed, properties, largeBlob);
  }
  // ── save (called by Angular component) ─────────────────────────
  saveAndComplete = async () => {
    const store = window.ioc.get("@hypercomb.social/Store");
    const service = window.ioc.get("@diamondcoreprocessor.com/TileEditorService");
    const imageEditor = window.ioc.get("@diamondcoreprocessor.com/ImageEditorService");
    const settings = window.ioc.get("@diamondcoreprocessor.com/Settings");
    if (!store || !service || !imageEditor || !settings) return;
    if (service.mode !== "editing") return;
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
      const otherTransform = otherOrientation === "flat-top" ? props.flat?.large : props.large;
      await imageEditor.setOrientation(
        otherOrientation,
        otherTransform ? { x: otherTransform.x ?? 0, y: otherTransform.y ?? 0, scale: otherTransform.scale ?? 1 } : void 0
      );
      const otherBlob = await imageEditor.captureSmall(otherW, otherH);
      const otherSig = await store.putResource(otherBlob);
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
        const pointyTransform = currentOrientation === "point-top" ? currentTransform : imageEditor.getTransform();
        props.large = {
          image: largeSig,
          x: props.large?.x ?? pointyTransform.x,
          y: props.large?.y ?? pointyTransform.y,
          scale: props.large?.scale ?? pointyTransform.scale
        };
        if (!props.flat) props.flat = {};
        const flatLarge = props.flat.large ?? {};
        props.flat.large = {
          x: flatLarge.x ?? 0,
          y: flatLarge.y ?? 0,
          scale: flatLarge.scale ?? 1
        };
      }
    }
    const json = JSON.stringify(props, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const propsSig = await store.putResource(blob);
    const indexKey = "hc:tile-props-index";
    const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
    index[service.seed] = propsSig;
    localStorage.setItem(indexKey, JSON.stringify(index));
    const savedSeed = service.seed;
    imageEditor.destroy();
    service.close();
    EffectBus.emit("tile:saved", { seed: savedSeed });
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
