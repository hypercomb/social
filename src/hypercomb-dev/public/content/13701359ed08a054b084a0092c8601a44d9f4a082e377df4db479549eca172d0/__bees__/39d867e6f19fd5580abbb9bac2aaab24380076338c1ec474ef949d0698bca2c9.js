// src/diamondcoreprocessor.com/presentation/tiles/move-preview.drone.ts
import { Drone } from "@hypercomb/core";
import { Graphics } from "pixi.js";
var SWAP_FILL = 16746564;
var SWAP_FILL_ALPHA = 0.2;
var SWAP_STROKE = 16746564;
var SWAP_STROKE_ALPHA = 0.5;
var STROKE_WIDTH = 0.5;
var MovePreviewDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "swap indicator overlays during tile move";
  #renderContainer = null;
  #layer = null;
  #meshOffset = { x: 0, y: 0 };
  #originalNames = [];
  #cellCount = 0;
  deps = {
    axial: "@diamondcoreprocessor.com/AxialService"
  };
  listens = ["render:host-ready", "render:mesh-offset", "render:cell-count", "move:preview"];
  emits = [];
  #effectsRegistered = false;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("render:host-ready", (payload) => {
      this.#renderContainer = payload.container;
      this.#initLayer();
    });
    this.onEffect("render:mesh-offset", (offset) => {
      this.#meshOffset = offset;
    });
    this.onEffect("render:cell-count", (payload) => {
      this.#originalNames = payload.labels;
      this.#cellCount = payload.count;
    });
    this.onEffect("move:preview", (payload) => {
      this.#redraw(payload);
    });
  };
  dispose() {
    if (this.#layer) {
      this.#layer.destroy();
      this.#layer = null;
    }
  }
  #initLayer() {
    if (!this.#renderContainer || this.#layer) return;
    this.#layer = new Graphics();
    this.#layer.zIndex = 7e3;
    this.#renderContainer.addChild(this.#layer);
    this.#renderContainer.sortableChildren = true;
  }
  #redraw(payload) {
    if (!this.#layer) return;
    this.#layer.clear();
    if (!payload) return;
    const { names, movedLabels } = payload;
    const axialSvc = this.resolve("axial");
    if (!axialSvc?.items) return;
    const ox = this.#meshOffset.x;
    const oy = this.#meshOffset.y;
    for (let i = 0; i < this.#cellCount; i++) {
      const label = names[i];
      if (!label) break;
      if (movedLabels.has(label)) continue;
      if (label === this.#originalNames[i]) continue;
      const coord = axialSvc.items.get(i);
      if (!coord) break;
      this.#drawSwapHex(coord.Location.x + ox, coord.Location.y + oy);
    }
  }
  #drawSwapHex(cx, cy) {
    if (!this.#layer) return;
    const settings = window.ioc.get("@diamondcoreprocessor.com/Settings");
    const r = settings?.hexagonDimensions?.circumRadius ?? 32;
    const verts = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 3 * i + Math.PI / 6;
      verts.push(cx + r * Math.cos(angle));
      verts.push(cy + r * Math.sin(angle));
    }
    this.#layer.poly(verts, true);
    this.#layer.fill({ color: SWAP_FILL, alpha: SWAP_FILL_ALPHA });
    this.#layer.poly(verts, true);
    this.#layer.stroke({ color: SWAP_STROKE, alpha: SWAP_STROKE_ALPHA, width: STROKE_WIDTH });
  }
};
var _movePreview = new MovePreviewDrone();
window.ioc.register("@diamondcoreprocessor.com/MovePreviewDrone", _movePreview);
export {
  MovePreviewDrone
};
