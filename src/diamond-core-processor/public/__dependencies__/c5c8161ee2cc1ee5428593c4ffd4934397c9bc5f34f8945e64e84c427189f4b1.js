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
import { BlurFilter, Container as Container2, Graphics as Graphics2 } from "pixi.js";
var LIGHT_DIR_X = -0.5;
var LIGHT_DIR_Y = -0.866;
var NEON_PRESETS = [
  {
    // 0 — Cyan (default)
    core: 65535,
    bright: 4521983,
    mid: 35020,
    dim: 17510,
    white: 13434879,
    fill: 2580,
    embers: [
      { glow: 4500223, core: 13426175, startEdge: 0 },
      { glow: 6741503, core: 15663103, startEdge: 2 },
      { glow: 13395711, core: 16764159, startEdge: 4 }
    ]
  },
  {
    // 1 — Magenta / Hot Pink
    core: 16711935,
    bright: 16729343,
    mid: 13369480,
    dim: 6684740,
    white: 16764159,
    fill: 655370,
    embers: [
      { glow: 16729258, core: 16764125, startEdge: 0 },
      { glow: 16738013, core: 16772863, startEdge: 2 },
      { glow: 11158783, core: 14535935, startEdge: 4 }
    ]
  },
  {
    // 2 — Green / Emerald
    core: 65416,
    bright: 4521898,
    mid: 52326,
    dim: 17442,
    white: 13434862,
    fill: 2566,
    embers: [
      { glow: 4521898, core: 13434845, startEdge: 0 },
      { glow: 6750156, core: 15663086, startEdge: 2 },
      { glow: 4500223, core: 13426175, startEdge: 4 }
    ]
  },
  {
    // 3 — Gold / Amber
    core: 16763904,
    bright: 16768324,
    mid: 13404160,
    dim: 6702080,
    white: 16772812,
    fill: 657408,
    embers: [
      { glow: 16755268, core: 16768460, startEdge: 0 },
      { glow: 16764006, core: 16772846, startEdge: 2 },
      { glow: 16737860, core: 16764108, startEdge: 4 }
    ]
  },
  {
    // 4 — Violet / Purple
    core: 8930559,
    bright: 11167487,
    mid: 6693580,
    dim: 3346790,
    white: 14535935,
    fill: 393226,
    embers: [
      { glow: 8939263, core: 13417471, startEdge: 0 },
      { glow: 11176191, core: 15654399, startEdge: 2 },
      { glow: 16737962, core: 16764125, startEdge: 4 }
    ]
  }
];
var STORAGE_KEY = "hc:neon-color";
var OVERLAY_ALPHA = 0.85;
var BREATHE_PERIOD = 4;
var BREATHE_LO = 0.8;
var BREATHE_HI = 1;
var NEON_EDGE = 1.15;
var FILL_RADIUS = 1.07;
var GLOW_OUTER_1 = 1.21;
var GLOW_OUTER_2 = 1.27;
var GLOW_INNER_1 = 1.09;
var GLOW_INNER_2 = 1.03;
var EMBER_CORE_R = 1;
var EMBER_GLOW_R = 1.8;
var EMBER_BLUR = 2;
var MOVE_DUR = 3;
var DWELL_DUR = 3;
var CYCLE_PERIOD = MOVE_DUR + DWELL_DUR;
var MOVE_FRAC = MOVE_DUR / CYCLE_PERIOD;
var FLASH_START = 0.48;
var FLASH_END = 0.58;
var SS = 8;
var ENTER_DURATION = 0.18;
var ENTER_SCALE_FROM = 0.95;
var ENTER_SCALE_TO = 1;
var AMBIENT_COUNT = 2;
var AMBIENT_PERIOD = 8;
var AMBIENT_RADIUS = 0.55;
var AMBIENT_ALPHA = 0.08;
var AMBIENT_SIZE = 1.5;
var HexOverlayMesh = class {
  mesh;
  #radiusPx;
  #flat;
  #palette;
  #hex;
  // static hex glow (drawn once)
  #ember;
  // animated ember dot (redrawn per frame)
  #ambient;
  // slow-drifting interior particles
  #neonVerts = [];
  // cached neon edge verts for ember path
  #edgeLengths = [];
  #totalPerimeter = 0;
  #enterStart = -1;
  // timestamp when overlay was shown (-1 = not animating)
  #shown = false;
  // tracks if overlay is currently visible
  constructor(radiusPx, flat) {
    this.#radiusPx = radiusPx;
    this.#flat = flat;
    this.#palette = NEON_PRESETS[loadNeonIndex()];
    this.mesh = new Container2();
    this.mesh.scale.set(1 / SS);
    this.mesh.alpha = OVERLAY_ALPHA;
    this.#hex = new Graphics2();
    this.#ember = new Graphics2();
    this.#ambient = new Graphics2();
    this.#ember.filters = [new BlurFilter({ strength: EMBER_BLUR * SS })];
    this.mesh.addChild(this.#hex, this.#ambient, this.#ember);
    this.#draw();
  }
  /** Call when the overlay becomes visible (hover enters). */
  show(t) {
    if (!this.#shown) {
      this.#enterStart = t;
      this.#shown = true;
    }
  }
  /** Call when hover leaves. */
  hide() {
    this.#shown = false;
    this.#enterStart = -1;
  }
  update(radiusPx, flat) {
    if (radiusPx === this.#radiusPx && flat === this.#flat) return;
    this.#radiusPx = radiusPx;
    this.#flat = flat;
    this.#draw();
  }
  setColorIndex(index) {
    const clamped = Math.max(0, Math.min(index, NEON_PRESETS.length - 1));
    this.#palette = NEON_PRESETS[clamped];
    localStorage.setItem(STORAGE_KEY, String(clamped));
    this.#draw();
  }
  setTime(t) {
    let enterProgress = 1;
    if (this.#enterStart >= 0) {
      const elapsed = t - this.#enterStart;
      enterProgress = Math.min(elapsed / ENTER_DURATION, 1);
      enterProgress = 1 - Math.pow(1 - enterProgress, 3);
      const scale = (ENTER_SCALE_FROM + (ENTER_SCALE_TO - ENTER_SCALE_FROM) * enterProgress) / SS;
      this.mesh.scale.set(scale);
      this.mesh.alpha = OVERLAY_ALPHA * enterProgress;
      if (enterProgress >= 1) {
        this.mesh.scale.set(1 / SS);
        this.mesh.alpha = OVERLAY_ALPHA;
      }
    }
    const breathe = Math.sin(t / BREATHE_PERIOD * Math.PI * 2) * 0.5 + 0.5;
    this.#hex.alpha = BREATHE_LO + (BREATHE_HI - BREATHE_LO) * breathe;
    this.#drawEmber(t);
    this.#drawAmbient(t);
  }
  // ── hex vertex generation ──────────────────────────────────────
  #hexVerts(r) {
    const verts = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 3 * i + (this.#flat ? 0 : Math.PI / 6);
      verts.push(Math.cos(angle) * r * SS, Math.sin(angle) * r * SS);
    }
    return verts;
  }
  // ── per-edge directional lighting ──────────────────────────────
  #edgeLighting(edgeIndex) {
    const a0 = Math.PI / 3 * edgeIndex + (this.#flat ? 0 : Math.PI / 6);
    const a1 = Math.PI / 3 * (edgeIndex + 1) + (this.#flat ? 0 : Math.PI / 6);
    const mx = (Math.cos(a0) + Math.cos(a1)) / 2;
    const my = (Math.sin(a0) + Math.sin(a1)) / 2;
    const len = Math.sqrt(mx * mx + my * my);
    const nx = mx / len;
    const ny = my / len;
    const dot = nx * LIGHT_DIR_X + ny * LIGHT_DIR_Y;
    return dot * 0.5 + 0.5;
  }
  // ── color interpolation ────────────────────────────────────────
  #lerpColor(lo, hi, t) {
    const lr = lo >> 16 & 255, lg = lo >> 8 & 255, lb = lo & 255;
    const hr = hi >> 16 & 255, hg = hi >> 8 & 255, hb = hi & 255;
    const r = Math.round(lr + (hr - lr) * t);
    const g = Math.round(lg + (hg - lg) * t);
    const b = Math.round(lb + (hb - lb) * t);
    return r << 16 | g << 8 | b;
  }
  // ── per-edge bloom stroke helper ───────────────────────────────
  #strokeEdges(g, verts, width, color, alphaLo, alphaHi, colorHi) {
    g.poly(verts);
    g.closePath();
    let avgLight = 0;
    for (let i = 0; i < 6; i++) avgLight += this.#edgeLighting(i);
    avgLight /= 6;
    const alpha = alphaLo + (alphaHi - alphaLo) * avgLight;
    const c = colorHi !== void 0 ? this.#lerpColor(color, colorHi, avgLight) : color;
    g.stroke({ width: width * SS, color: c, alpha, join: "miter" });
  }
  // ── point along hex perimeter (0..1 → x,y) ────────────────────
  #perimeterPoint(t) {
    const v = this.#neonVerts;
    const frac = (t % 1 + 1) % 1;
    let target = frac * this.#totalPerimeter;
    for (let i = 0; i < 6; i++) {
      if (target <= this.#edgeLengths[i]) {
        const i0 = i * 2, i1 = (i + 1) % 6 * 2;
        const lerp = target / this.#edgeLengths[i];
        return {
          x: v[i0] + (v[i1] - v[i0]) * lerp,
          y: v[i0 + 1] + (v[i1 + 1] - v[i0 + 1]) * lerp
        };
      }
      target -= this.#edgeLengths[i];
    }
    return { x: v[0], y: v[1] };
  }
  // ── ease in-out cubic ──────────────────────────────────────────
  #ease(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  // ── draw embers (per frame) ─────────────────────────────────────
  #drawEmber(t) {
    const g = this.#ember;
    g.clear();
    const STEP = 1 / 6;
    for (const spec of this.#palette.embers) {
      const origin = (spec.startEdge + 0.5) / 6;
      const cycleIndex = Math.floor(t / CYCLE_PERIOD);
      const phase = t % CYCLE_PERIOD / CYCLE_PERIOD;
      const fromT = (origin + cycleIndex * STEP) % 1;
      const toT = (origin + (cycleIndex + 1) * STEP) % 1;
      let perimT;
      if (phase < MOVE_FRAC) {
        const eased = this.#ease(phase / MOVE_FRAC);
        let delta = toT - fromT;
        if (delta < 0) delta += 1;
        perimT = fromT + delta * eased;
      } else {
        perimT = toT;
      }
      const pos = this.#perimeterPoint(perimT);
      let flash = 0;
      if (phase >= FLASH_START && phase <= FLASH_END) {
        const flashPhase = (phase - FLASH_START) / (FLASH_END - FLASH_START);
        flash = Math.sin(flashPhase * Math.PI);
      }
      const baseAlpha = phase < MOVE_FRAC ? 0.35 : 0.5;
      g.circle(pos.x, pos.y, EMBER_GLOW_R * SS);
      g.fill({ color: spec.glow, alpha: baseAlpha + flash * 0.3 });
      g.circle(pos.x, pos.y, EMBER_CORE_R * SS);
      g.fill({ color: spec.core, alpha: baseAlpha + flash * 0.45 });
      if (flash > 0.01) {
        g.circle(pos.x, pos.y, (EMBER_GLOW_R + 2 * flash) * SS);
        g.fill({ color: spec.glow, alpha: flash * 0.2 });
      }
    }
  }
  // ── ambient interior particles (very faint drifting dots) ──────
  #drawAmbient(t) {
    const g = this.#ambient;
    g.clear();
    const R = this.#radiusPx * AMBIENT_RADIUS * SS;
    const p = this.#palette;
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      const phase = (t / AMBIENT_PERIOD + i * 0.5) % 1;
      const angle1 = phase * Math.PI * 2;
      const angle2 = phase * Math.PI * 2 * (1.5 + i * 0.7);
      const x = Math.sin(angle1) * R * 0.6;
      const y = Math.cos(angle2) * R * 0.4;
      g.circle(x, y, AMBIENT_SIZE * SS);
      g.fill({ color: p.dim, alpha: AMBIENT_ALPHA });
    }
  }
  // ── main draw (static hex, drawn once) ─────────────────────────
  #draw() {
    const g = this.#hex;
    g.clear();
    const R = this.#radiusPx;
    const neonV = this.#hexVerts(R * NEON_EDGE);
    const fillV = this.#hexVerts(R * FILL_RADIUS);
    const gOuter1V = this.#hexVerts(R * GLOW_OUTER_1);
    const gOuter2V = this.#hexVerts(R * GLOW_OUTER_2);
    const gInner1V = this.#hexVerts(R * GLOW_INNER_1);
    const gInner2V = this.#hexVerts(R * GLOW_INNER_2);
    this.#neonVerts = neonV;
    this.#edgeLengths = [];
    this.#totalPerimeter = 0;
    for (let i = 0; i < 6; i++) {
      const i0 = i * 2, i1 = (i + 1) % 6 * 2;
      const dx = neonV[i1] - neonV[i0];
      const dy = neonV[i1 + 1] - neonV[i0 + 1];
      const len = Math.sqrt(dx * dx + dy * dy);
      this.#edgeLengths.push(len);
      this.#totalPerimeter += len;
    }
    const p = this.#palette;
    this.#strokeEdges(g, gOuter2V, 3, p.dim, 0.04, 0.1);
    this.#strokeEdges(g, gOuter1V, 2.5, p.mid, 0.06, 0.18);
    g.poly(fillV);
    g.fill({ color: p.fill, alpha: 0.55 });
    this.#strokeEdges(g, gInner2V, 2.5, p.dim, 0.04, 0.1);
    this.#strokeEdges(g, gInner1V, 2, p.mid, 0.08, 0.22);
    this.#strokeEdges(g, neonV, 2, p.mid, 0.45, 0.9, p.core);
    this.#strokeEdges(g, neonV, 1, p.bright, 0.2, 0.75, p.white);
  }
};
function loadNeonIndex() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return 0;
  const n = parseInt(stored, 10);
  return n >= 0 && n < NEON_PRESETS.length ? n : 0;
}
function cycleNeonColor() {
  const next = (loadNeonIndex() + 1) % NEON_PRESETS.length;
  localStorage.setItem(STORAGE_KEY, String(next));
  return next;
}
export {
  HexIconButton,
  HexOverlayMesh,
  NEON_PRESETS,
  cycleNeonColor
};
