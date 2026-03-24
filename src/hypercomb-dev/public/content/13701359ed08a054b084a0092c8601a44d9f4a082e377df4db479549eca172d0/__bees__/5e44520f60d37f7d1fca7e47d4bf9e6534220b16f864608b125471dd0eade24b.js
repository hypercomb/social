// src/diamondcoreprocessor.com/presentation/tiles/tile-index-overlay.drone.ts
import { Drone } from "@hypercomb/core";
import { Container, Graphics, Text, TextStyle } from "pixi.js";
var INDEX_STYLE = new TextStyle({
  fontFamily: "monospace",
  fontSize: 8,
  fill: 16777215,
  align: "center"
});
var HEX_FILL = 16777215;
var HEX_FILL_ALPHA = 0.08;
var HEX_STROKE = 16777215;
var HEX_STROKE_ALPHA = 0.15;
var STROKE_WIDTH = 0.5;
var TileIndexOverlayDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "renders axial index numbers on all hex cells during move command mode";
  #renderContainer = null;
  #layer = null;
  #meshOffset = { x: 0, y: 0 };
  #cellCount = 0;
  #cellLabels = [];
  #visible = false;
  deps = {
    axial: "@diamondcoreprocessor.com/AxialService"
  };
  listens = ["render:host-ready", "render:mesh-offset", "render:cell-count", "move:index-overlay"];
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
      if (this.#visible) this.#rebuild();
    });
    this.onEffect("render:cell-count", (payload) => {
      this.#cellCount = payload.count;
      this.#cellLabels = payload.labels;
      if (this.#visible) this.#rebuild();
    });
    this.onEffect("move:index-overlay", (payload) => {
      this.#visible = payload.show;
      if (payload.show) {
        this.#rebuild();
      } else {
        this.#clear();
      }
    });
  };
  dispose() {
    if (this.#layer) {
      this.#layer.destroy({ children: true });
      this.#layer = null;
    }
  }
  #initLayer() {
    if (!this.#renderContainer || this.#layer) return;
    this.#layer = new Container();
    this.#layer.zIndex = 6e3;
    this.#layer.visible = false;
    this.#renderContainer.addChild(this.#layer);
    this.#renderContainer.sortableChildren = true;
  }
  #clear() {
    if (!this.#layer) return;
    this.#layer.removeChildren();
    this.#layer.visible = false;
  }
  #rebuild() {
    if (!this.#layer) return;
    this.#layer.removeChildren();
    const axialSvc = this.resolve("axial");
    if (!axialSvc?.items) return;
    const settings = window.ioc.get("@diamondcoreprocessor.com/Settings");
    const r = settings?.hexagonDimensions?.circumRadius ?? 32;
    const ox = this.#meshOffset.x;
    const oy = this.#meshOffset.y;
    const maxIndex = Math.max(this.#cellCount, axialSvc.items.size);
    const limit = Math.min(maxIndex + 20, axialSvc.items.size);
    for (const [index, coord] of axialSvc.items) {
      if (index >= limit) break;
      const cx = coord.Location.x + ox;
      const cy = coord.Location.y + oy;
      const hex = new Graphics();
      const verts = [];
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 3 * i + Math.PI / 6;
        verts.push(cx + r * Math.cos(angle));
        verts.push(cy + r * Math.sin(angle));
      }
      hex.poly(verts, true);
      hex.fill({ color: HEX_FILL, alpha: HEX_FILL_ALPHA });
      hex.poly(verts, true);
      hex.stroke({ color: HEX_STROKE, alpha: HEX_STROKE_ALPHA, width: STROKE_WIDTH });
      this.#layer.addChild(hex);
      const text = new Text({
        text: String(index),
        style: INDEX_STYLE,
        resolution: window.devicePixelRatio * 4
      });
      text.anchor.set(0.5);
      text.position.set(cx, cy);
      text.alpha = 0.6;
      this.#layer.addChild(text);
    }
    this.#layer.visible = true;
  }
};
var _tileIndexOverlay = new TileIndexOverlayDrone();
window.ioc.register("@diamondcoreprocessor.com/TileIndexOverlayDrone", _tileIndexOverlay);
export {
  TileIndexOverlayDrone
};
