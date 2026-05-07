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
  /**
   * Set the tint applied when the icon is not hovered. Used by per-tile
   * `tintWhen` predicates so an icon can advertise per-cell state (e.g.
   * "this tile contains notes") via colour. Pass null to reset to white.
   */
  setNormalTint(tint) {
    this.#normalTint = tint ?? 16777215;
    if (this.#sprite && !this.#hovered) {
      this.#sprite.tint = this.#normalTint;
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

// src/diamondcoreprocessor.com/history/nurse.bee.ts
import { Bee } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/tile-properties.ts
import { EffectBus } from "@hypercomb/core";
var TILE_PROPERTIES_FILE = "0000";
var readCellProperties = async (cellDir) => {
  try {
    const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return {};
  }
};

// src/diamondcoreprocessor.com/history/nurse.bee.ts
var NurseBee = class extends Bee {
  // ── cache ──────────────────────────────────────────────────────────
  #cache = /* @__PURE__ */ new Map();
  /**
   * Read the value for a cell.
   *
   * `cacheKey` should uniquely identify the cell across renders — the
   * cell's lineage path (e.g. `'instructions/section'`) or its
   * locationSig. The caller chooses; the nurse just keys by it.
   *
   * Hot path: cache hit returns without touching disk. Cold path:
   * read 0000, parse, cache.
   */
  async read(cellDir, cacheKey) {
    const cached = this.#cache.get(cacheKey);
    if (cached) return cached.value;
    const props = await readCellProperties(cellDir);
    const value = this.parse(props[this.attribute]);
    this.#cache.set(cacheKey, { value, layerSig: "" });
    return value;
  }
  /** Synchronous peek — returns whatever the cache currently holds.
   *  Cache misses return `undefined` without triggering a read. */
  peek(cacheKey) {
    return this.#cache.get(cacheKey)?.value;
  }
  /** Annotate an existing entry with the layerSig it was last seen
   *  alongside. Lets a consumer detect "different layer, same value"
   *  when deciding whether to do work. No-op if the entry doesn't
   *  exist or the sig is unchanged. */
  setLayerSig(cacheKey, layerSig) {
    const existing = this.#cache.get(cacheKey);
    if (!existing) return;
    if (existing.layerSig === layerSig) return;
    this.#cache.set(cacheKey, { value: existing.value, layerSig });
  }
  /** Drop one cell's entry. */
  invalidate(cacheKey) {
    this.#cache.delete(cacheKey);
  }
  /** Drop all entries whose key starts with the given prefix. Used by
   *  inheriting nurses when an ancestor write should invalidate every
   *  descendant's composition. */
  invalidatePrefix(prefix) {
    if (prefix.length === 0) {
      this.#cache.clear();
      return;
    }
    const withSep = prefix.endsWith("/") ? prefix : prefix + "/";
    for (const k of [...this.#cache.keys()]) {
      if (k === prefix || k.startsWith(withSep)) this.#cache.delete(k);
    }
  }
  /** Clear the entire cache. Used on lineage-wide invalidations
   *  (folder-tree wipes, install reset). */
  clear() {
    this.#cache.clear();
  }
  // ── construction ───────────────────────────────────────────────────
  constructor() {
    super();
    this.onEffect(
      "cell:0000-changed",
      (payload) => {
        if (!payload?.keys?.includes(this.attribute)) return;
        this.invalidate(payload.cacheKey);
      }
    );
  }
  // ── nurses don't run per pulse ─────────────────────────────────────
  async pulse(_grammar) {
  }
};

// src/diamondcoreprocessor.com/presentation/tiles/index.nurse.ts
var IndexNurse = class extends NurseBee {
  namespace = "diamondcoreprocessor.com";
  attribute = "index";
  parse(raw) {
    if (typeof raw !== "number") return void 0;
    if (!Number.isFinite(raw)) return void 0;
    if (raw < 0) return void 0;
    return raw;
  }
};
var _indexNurse = new IndexNurse();
window.ioc?.register?.(_indexNurse.iocKey, _indexNurse);
export {
  HexIconButton,
  HexOverlayMesh,
  IndexNurse
};
