// @diamondcoreprocessor.com/presentation/tiles
// src/diamondcoreprocessor.com/presentation/tiles/hex-icon-button.ts
import { Container, Graphics, Sprite, Texture } from "pixi.js";
var BACKDROP_PAD = 2;
var BACKDROP_RADIUS = 1.5;
var BACKDROP_FILL = 789530;
var BACKDROP_FILL_ALPHA = 0.72;
var BACKDROP_STROKE = 6719692;
var BACKDROP_STROKE_ALPHA = 0.35;
var BACKDROP_STROKE_WIDTH = 0.6;
var SVG_VIEWBOX = 24;
var SVG_RENDER_SCALE = 4;
var HexIconButton = class extends Container {
  #sprite = null;
  #backdrop;
  #size;
  #normalTint;
  #hoverTint;
  #hovered = false;
  #alive = true;
  constructor(config) {
    super();
    this.#size = config.size;
    this.#normalTint = config.tint ?? 16777215;
    this.#hoverTint = config.hoverTint ?? 13162751;
    this.#backdrop = this.#buildBackdrop();
    this.addChild(this.#backdrop);
  }
  // ── Async icon load ────────────────────────────────────────────────
  async load(svgMarkup) {
    if (!this.#alive) return;
    try {
      const texture = await this.#rasterise(svgMarkup);
      if (!this.#alive) return;
      const sprite = new Sprite(texture);
      sprite.width = this.#size;
      sprite.height = this.#size;
      sprite.anchor.set(0.5, 0.5);
      sprite.tint = this.#normalTint;
      this.#sprite = sprite;
      this.addChild(sprite);
    } catch (e) {
      console.warn("[HexIconButton] load failed:", e);
    }
  }
  // ── Hover state ────────────────────────────────────────────────────
  get hovered() {
    return this.#hovered;
  }
  set hovered(value) {
    if (this.#hovered === value) return;
    this.#hovered = value;
    this.#backdrop.visible = value;
    if (this.#sprite) {
      this.#sprite.tint = value ? this.#hoverTint : this.#normalTint;
    }
  }
  // ── Hit testing ────────────────────────────────────────────────────
  containsPoint(localX, localY) {
    const r = this.#size / 2 + BACKDROP_PAD;
    return localX >= -r && localX <= r && localY >= -r && localY <= r;
  }
  // ── Lifecycle ──────────────────────────────────────────────────────
  destroy(options) {
    this.#alive = false;
    super.destroy(options);
  }
  // ── Internals ──────────────────────────────────────────────────────
  #buildBackdrop() {
    const r = this.#size / 2 + BACKDROP_PAD;
    const g = new Graphics();
    g.roundRect(-r, -r, r * 2, r * 2, BACKDROP_RADIUS);
    g.fill({ color: BACKDROP_FILL, alpha: BACKDROP_FILL_ALPHA });
    g.roundRect(-r, -r, r * 2, r * 2, BACKDROP_RADIUS);
    g.stroke({ color: BACKDROP_STROKE, alpha: BACKDROP_STROKE_ALPHA, width: BACKDROP_STROKE_WIDTH });
    g.visible = false;
    return g;
  }
  /** Rasterise SVG at high resolution via an offscreen Image → Canvas → Texture pipeline. */
  async #rasterise(svgMarkup) {
    const renderPx = SVG_VIEWBOX * SVG_RENDER_SCALE;
    const hiResSvg = svgMarkup.replace(`width="${SVG_VIEWBOX}"`, `width="${renderPx}"`).replace(`height="${SVG_VIEWBOX}"`, `height="${renderPx}"`);
    const img = new Image(renderPx, renderPx);
    const blob = new Blob([hiResSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    try {
      img.src = url;
      await img.decode();
    } finally {
      URL.revokeObjectURL(url);
    }
    const canvas = document.createElement("canvas");
    canvas.width = renderPx;
    canvas.height = renderPx;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, renderPx, renderPx);
    return Texture.from({ resource: canvas, alphaMode: "premultiply-alpha-on-upload" });
  }
};

// src/diamondcoreprocessor.com/presentation/tiles/hex-overlay.shader.ts
import { Container as Container2 } from "pixi.js";
var HexOverlayMesh = class {
  mesh;
  constructor(_radiusPx, _flat) {
    this.mesh = new Container2();
  }
  show(_t) {
  }
  hide() {
  }
  update(_radiusPx, _flat) {
  }
  setColorIndex(_index) {
  }
  setTime(_t) {
  }
};
export {
  HexIconButton,
  HexOverlayMesh
};
