// src/diamondcoreprocessor.com/presentation/tiles/move-preview.drone.ts
import { Drone } from "@hypercomb/core";
import { Graphics } from "pixi.js";
var SWAP_FILL = 16746564;
var SWAP_FILL_ALPHA = 0.2;
var SWAP_STROKE = 16746564;
var SWAP_STROKE_ALPHA = 0.5;
var STROKE_WIDTH = 0.5;
var DROP_FILL = 2267562;
var DROP_FILL_ALPHA = 0.35;
var DROP_STROKE = 3390412;
var DROP_STROKE_ALPHA = 0.85;
var DROP_STROKE_WIDTH = 2;
var DROP_INSET_FACTOR = 0.55;
var DROP_INSET_FILL_ALPHA = 0.55;
var DROP_CHEVRON_WIDTH = 2.5;
var MovePreviewDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "movement";
  description = "Draws swap-indicator overlays showing where tiles will land during a move.";
  #renderContainer = null;
  #layer = null;
  #dropIntoLayer = null;
  #meshOffset = { x: 0, y: 0 };
  #originalNames = [];
  #cellCoords = [];
  #cellCount = 0;
  deps = {
    axial: "@diamondcoreprocessor.com/AxialService"
  };
  listens = ["render:host-ready", "render:mesh-offset", "render:cell-count", "move:preview", "move:drop-into"];
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
      this.#cellCoords = payload.coords ?? [];
      this.#cellCount = payload.count;
    });
    this.onEffect("move:preview", (payload) => {
      this.#redraw(payload);
    });
    this.onEffect("move:drop-into", (payload) => {
      this.#redrawDropInto(payload);
    });
  };
  dispose() {
    if (this.#dropIntoLayer) {
      this.#dropIntoLayer.parent?.removeChild(this.#dropIntoLayer);
      this.#dropIntoLayer.destroy();
      this.#dropIntoLayer = null;
    }
    if (this.#layer) {
      this.#layer.parent?.removeChild(this.#layer);
      this.#layer.destroy();
      this.#layer = null;
    }
  }
  #initLayer() {
    if (!this.#renderContainer || this.#layer) return;
    this.#layer = new Graphics();
    this.#layer.zIndex = 7e3;
    this.#dropIntoLayer = new Graphics();
    this.#dropIntoLayer.zIndex = 7001;
    this.#renderContainer.addChild(this.#layer);
    this.#renderContainer.addChild(this.#dropIntoLayer);
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
  // ── drop-into hex (Ctrl-modifier preview) ─────────────────
  #redrawDropInto(payload) {
    if (!this.#dropIntoLayer) return;
    this.#dropIntoLayer.clear();
    if (!payload) return;
    const { label } = payload;
    const idx = this.#originalNames.indexOf(label);
    if (idx < 0) return;
    const axialSvc = this.resolve("axial");
    if (!axialSvc?.items) return;
    const coord = this.#cellCoords[idx];
    if (!coord) return;
    let px = 0;
    let py = 0;
    for (const [, item] of axialSvc.items) {
      if (item.q === coord.q && item.r === coord.r) {
        px = item.Location.x;
        py = item.Location.y;
        break;
      }
    }
    const ox = this.#meshOffset.x;
    const oy = this.#meshOffset.y;
    this.#drawDropIntoHex(px + ox, py + oy);
  }
  /**
   * Visualise "drop these tiles into this tile's children": a thick outer
   * hex highlighting the target, an inset hex suggesting nesting/depth, and
   * a downward chevron at center reading as "going in".
   */
  #drawDropIntoHex(cx, cy) {
    if (!this.#dropIntoLayer) return;
    const settings = window.ioc.get("@diamondcoreprocessor.com/Settings");
    const r = settings?.hexagonDimensions?.circumRadius ?? 32;
    const buildHexVerts = (radius) => {
      const verts = [];
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 3 * i - Math.PI / 2;
        verts.push(cx + radius * Math.cos(angle));
        verts.push(cy + radius * Math.sin(angle));
      }
      return verts;
    };
    const outer = buildHexVerts(r);
    this.#dropIntoLayer.poly(outer, true);
    this.#dropIntoLayer.fill({ color: DROP_FILL, alpha: DROP_FILL_ALPHA });
    this.#dropIntoLayer.poly(outer, true);
    this.#dropIntoLayer.stroke({ color: DROP_STROKE, alpha: DROP_STROKE_ALPHA, width: DROP_STROKE_WIDTH });
    const inset = buildHexVerts(r * DROP_INSET_FACTOR);
    this.#dropIntoLayer.poly(inset, true);
    this.#dropIntoLayer.fill({ color: DROP_FILL, alpha: DROP_INSET_FILL_ALPHA });
    this.#dropIntoLayer.poly(inset, true);
    this.#dropIntoLayer.stroke({ color: DROP_STROKE, alpha: DROP_STROKE_ALPHA, width: 1 });
    const cw = r * 0.32;
    const ch = r * 0.18;
    const cyOffset = r * 0.05;
    this.#dropIntoLayer.moveTo(cx - cw, cy - ch + cyOffset);
    this.#dropIntoLayer.lineTo(cx, cy + ch + cyOffset);
    this.#dropIntoLayer.lineTo(cx + cw, cy - ch + cyOffset);
    this.#dropIntoLayer.stroke({ color: DROP_STROKE, alpha: 1, width: DROP_CHEVRON_WIDTH });
  }
};
var _movePreview = new MovePreviewDrone();
window.ioc.register("@diamondcoreprocessor.com/MovePreviewDrone", _movePreview);
export {
  MovePreviewDrone
};
