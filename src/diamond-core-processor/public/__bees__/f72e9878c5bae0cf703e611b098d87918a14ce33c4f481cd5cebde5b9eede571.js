// src/diamondcoreprocessor.com/presentation/tiles/move-preview.drone.ts
import { Drone } from "@hypercomb/core";
import { Graphics } from "pixi.js";
var SWAP_FILL = 16746564;
var SWAP_FILL_ALPHA = 0.2;
var SWAP_STROKE = 16746564;
var SWAP_STROKE_ALPHA = 0.5;
var STROKE_WIDTH = 0.5;
var DWELL_FILL = 2267562;
var DWELL_FILL_ALPHA = 0.45;
var DWELL_STROKE = 3390412;
var DWELL_STROKE_ALPHA = 0.7;
var DWELL_STROKE_WIDTH = 1.5;
var MovePreviewDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "movement";
  description = "Draws swap-indicator overlays showing where tiles will land during a move.";
  #renderContainer = null;
  #layer = null;
  #dwellLayer = null;
  #meshOffset = { x: 0, y: 0 };
  #originalNames = [];
  #cellCoords = [];
  #cellCount = 0;
  deps = {
    axial: "@diamondcoreprocessor.com/AxialService"
  };
  listens = ["render:host-ready", "render:mesh-offset", "render:cell-count", "move:preview", "move:layer-dwell"];
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
    this.onEffect("move:layer-dwell", (payload) => {
      this.#redrawDwell(payload);
    });
  };
  dispose() {
    if (this.#dwellLayer) {
      this.#dwellLayer.parent?.removeChild(this.#dwellLayer);
      this.#dwellLayer.destroy();
      this.#dwellLayer = null;
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
    this.#dwellLayer = new Graphics();
    this.#dwellLayer.zIndex = 7001;
    this.#renderContainer.addChild(this.#layer);
    this.#renderContainer.addChild(this.#dwellLayer);
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
  // ── layer dwell hourglass ─────────────────────────────────
  #redrawDwell(payload) {
    if (!this.#dwellLayer) return;
    this.#dwellLayer.clear();
    if (!payload) return;
    const { label, progress } = payload;
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
    this.#drawHourglassHex(px + ox, py + oy, progress);
  }
  /**
   * Draw a point-top hex that fills from bottom vertex to top vertex.
   * progress 0 = empty, progress 1 = full hex.
   */
  #drawHourglassHex(cx, cy, progress) {
    if (!this.#dwellLayer) return;
    const settings = window.ioc.get("@diamondcoreprocessor.com/Settings");
    const r = settings?.hexagonDimensions?.circumRadius ?? 32;
    const verts = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 3 * i - Math.PI / 2;
      verts.push({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle)
      });
    }
    const topY = cy - r;
    const bottomY = cy + r;
    const totalHeight = bottomY - topY;
    const clipY = bottomY - progress * totalHeight;
    const outlineVerts = [];
    for (const v of verts) {
      outlineVerts.push(v.x, v.y);
    }
    this.#dwellLayer.poly(outlineVerts, true);
    this.#dwellLayer.stroke({ color: DWELL_STROKE, alpha: DWELL_STROKE_ALPHA, width: DWELL_STROKE_WIDTH });
    if (progress <= 0) return;
    const clipped = [];
    for (let i = 0; i < 6; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % 6];
      const aBelow = a.y >= clipY;
      const bBelow = b.y >= clipY;
      if (aBelow) {
        clipped.push(a.x, a.y);
      }
      if (aBelow !== bBelow) {
        const t = (clipY - a.y) / (b.y - a.y);
        clipped.push(a.x + t * (b.x - a.x), clipY);
      }
    }
    if (clipped.length >= 6) {
      this.#dwellLayer.poly(clipped, true);
      this.#dwellLayer.fill({ color: DWELL_FILL, alpha: DWELL_FILL_ALPHA });
    }
  }
};
var _movePreview = new MovePreviewDrone();
window.ioc.register("@diamondcoreprocessor.com/MovePreviewDrone", _movePreview);
export {
  MovePreviewDrone
};
