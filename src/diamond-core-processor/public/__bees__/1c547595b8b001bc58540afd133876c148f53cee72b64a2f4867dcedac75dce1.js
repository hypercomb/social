// src/diamondcoreprocessor.com/editor/resource-attach.drone.ts
import { EffectBus } from "@hypercomb/core";
var PROPS_INDEX_KEY = "hc:tile-props-index";
var ResourceAttachDrone = class {
  constructor() {
    EffectBus.on("cell:attach-resource", this.#onAttach);
  }
  #onAttach = (payload) => {
    void this.#attach(payload);
  };
  async #attach(payload) {
    const store = window.ioc.get("@hypercomb.social/Store");
    if (!store) return;
    const props = {};
    if (payload.smallPointSig) {
      ;
      props.small = { image: payload.smallPointSig };
    }
    if (payload.smallFlatSig) {
      if (!props.flat) props.flat = {};
      props.flat.small = { image: payload.smallFlatSig };
    }
    if (payload.largeSig) {
      ;
      props.large = {
        image: payload.largeSig,
        x: 0,
        y: 0,
        scale: 1
      };
      if (!props.flat) props.flat = {};
      props.flat.large = { x: 0, y: 0, scale: 1 };
    }
    if (payload.url) {
      ;
      props.link = payload.url;
    }
    const json = JSON.stringify(props, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const propsSig = await store.putResource(blob);
    const index = JSON.parse(localStorage.getItem(PROPS_INDEX_KEY) ?? "{}");
    index[payload.cell] = propsSig;
    localStorage.setItem(PROPS_INDEX_KEY, JSON.stringify(index));
    EffectBus.emit("tile:saved", { cell: payload.cell });
    EffectBus.emit("cell:attach-pending", { cell: payload.cell, pending: false });
  }
};
window.ioc.register(
  "@diamondcoreprocessor.com/ResourceAttachDrone",
  new ResourceAttachDrone()
);
export {
  ResourceAttachDrone
};
