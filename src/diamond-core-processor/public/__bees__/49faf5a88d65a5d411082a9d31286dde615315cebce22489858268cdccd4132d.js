// src/diamondcoreprocessor.com/editor/tile-editor.drone.ts
import { EffectBus } from "@hypercomb/core";
var EDIT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L7 21H3v-4L17 3z"/></svg>`;
var TileEditorDrone = class {
  constructor() {
    EffectBus.on("tile:action", this.#onTileAction);
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
    let properties = {};
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
    const savedCell = service.cell;
    imageEditor.destroy();
    service.close();
    EffectBus.emit("tile:saved", { cell: savedCell });
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
