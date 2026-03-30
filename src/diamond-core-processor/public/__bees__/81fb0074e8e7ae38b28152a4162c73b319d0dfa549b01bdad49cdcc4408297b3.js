// src/diamondcoreprocessor.com/presentation/tiles/tile-overlay.drone.ts
import { Drone as Drone2, EffectBus as EffectBus2 } from "@hypercomb/core";
import { Container as Container3, Graphics as Graphics3, Point, Text, TextStyle } from "pixi.js";

// src/diamondcoreprocessor.com/presentation/tiles/hex-icon-button.ts
import { Container, Graphics, Sprite, Assets } from "pixi.js";
var BACKDROP_PAD = 2;
var BACKDROP_RADIUS = 1.5;
var BACKDROP_FILL = 789530;
var BACKDROP_FILL_ALPHA = 0.72;
var BACKDROP_STROKE = 6719692;
var BACKDROP_STROKE_ALPHA = 0.35;
var BACKDROP_STROKE_WIDTH = 0.6;
var HexIconButton = class extends Container {
  #sprite = null;
  #backdrop;
  #config;
  #hovered = false;
  constructor(config) {
    super();
    this.#config = config;
    this.#backdrop = this.#createBackdrop();
    this.addChild(this.#backdrop);
  }
  async load() {
    const { svgMarkup, size, tint, cacheKey } = this.#config;
    try {
      const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
      const loadOpts = { src: dataUri };
      if (cacheKey) loadOpts.alias = cacheKey;
      const texture = await Assets.load(loadOpts);
      const sprite = new Sprite(texture);
      sprite.width = size;
      sprite.height = size;
      sprite.anchor.set(0.5, 0.5);
      sprite.tint = tint ?? 16777215;
      this.#sprite = sprite;
      this.addChild(sprite);
    } catch (e) {
      console.warn("[HexIconButton] load failed:", e);
    }
  }
  get hovered() {
    return this.#hovered;
  }
  set hovered(value) {
    if (this.#hovered === value) return;
    this.#hovered = value;
    this.#backdrop.visible = value;
    if (this.#sprite) {
      this.#sprite.tint = value ? this.#config.hoverTint ?? 13162751 : this.#config.tint ?? 16777215;
    }
  }
  containsPoint(localX, localY) {
    const r = this.#config.size / 2 + BACKDROP_PAD;
    return localX >= -r && localX <= r && localY >= -r && localY <= r;
  }
  #createBackdrop() {
    const r = this.#config.size / 2 + BACKDROP_PAD;
    const g = new Graphics();
    g.roundRect(-r, -r, r * 2, r * 2, BACKDROP_RADIUS);
    g.fill({ color: BACKDROP_FILL, alpha: BACKDROP_FILL_ALPHA });
    g.roundRect(-r, -r, r * 2, r * 2, BACKDROP_RADIUS);
    g.stroke({ color: BACKDROP_STROKE, alpha: BACKDROP_STROKE_ALPHA, width: BACKDROP_STROKE_WIDTH });
    g.visible = false;
    return g;
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

// src/diamondcoreprocessor.com/presentation/grid/hex-geometry.ts
function createHexGeometry(circumRadiusPx, gapPx, padPx = 10) {
  return { circumRadiusPx, gapPx, padPx, spacing: circumRadiusPx + gapPx };
}
var DEFAULT_HEX_GEOMETRY = createHexGeometry(32, 6);

// src/diamondcoreprocessor.com/presentation/tiles/tile-actions.drone.ts
import { Drone, EffectBus, hypercomb, normalizeSeed } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/tile-properties.ts
var TILE_PROPERTIES_FILE = "0000";
var readSeedProperties = async (seedDir) => {
  try {
    const fileHandle = await seedDir.getFileHandle(TILE_PROPERTIES_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return {};
  }
};
var writeSeedProperties = async (seedDir, updates) => {
  const existing = await readSeedProperties(seedDir);
  const merged = { ...existing, ...updates };
  const fileHandle = await seedDir.getFileHandle(TILE_PROPERTIES_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(merged));
  await writable.close();
};

// src/diamondcoreprocessor.com/presentation/tiles/tile-actions.drone.ts
var svg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
var ICONS = {
  // Pencil
  edit: svg('<path d="M17 3l4 4L7 21H3v-4L17 3z"/>'),
  // Tree branch (parent + child node)
  "add-sub": svg('<circle cx="12" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><line x1="12" y1="9" x2="12" y2="15"/>'),
  // Magnifying glass
  search: svg('<circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/>'),
  // Eye with slash
  hide: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/><line x1="4" y1="4" x2="20" y2="20"/>'),
  // Plus
  adopt: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  // Circle with slash
  block: svg('<circle cx="12" cy="12" r="9"/><line x1="5.7" y1="5.7" x2="18.3" y2="18.3"/>')
};
var ICON_REGISTRY = [
  // ── private profile ──
  { name: "add-sub", svgMarkup: ICONS["add-sub"], hoverTint: 11075544, profile: "private" },
  { name: "edit", svgMarkup: ICONS.edit, hoverTint: 13162751, profile: "private" },
  { name: "search", svgMarkup: ICONS.search, hoverTint: 13172680, profile: "private", visibleWhen: (ctx) => ctx.noImage },
  // ── public-own profile ──
  { name: "hide", svgMarkup: ICONS.hide, hoverTint: 16767144, profile: "public-own" },
  // ── public-external profile ──
  { name: "adopt", svgMarkup: ICONS.adopt, hoverTint: 11075544, profile: "public-external" },
  { name: "block", svgMarkup: ICONS.block, hoverTint: 16763080, profile: "public-external" }
];
var DEFAULT_ACTIVE = {
  "private": ["add-sub", "edit", "search"],
  "public-own": ["hide"],
  "public-external": ["adopt", "block"]
};
var ICON_Y = 3;
var ICON_SPACING = 10;
var HEX_INRADIUS = 27.7;
var EDGE_MARGIN = 3;
function computeIconPositions(activeNames) {
  const count = activeNames.length;
  if (count === 0) return [];
  let spacing = ICON_SPACING;
  const available = (HEX_INRADIUS - EDGE_MARGIN) * 2;
  const idealWidth = (count - 1) * spacing;
  if (idealWidth > available && count > 1) {
    spacing = available / (count - 1);
  }
  const startX = -(count - 1) * spacing / 2;
  return activeNames.map((_, i) => ({ x: startX + i * spacing, y: ICON_Y }));
}
var ARRANGEMENT_KEY = "iconArrangement";
var HANDLED_ACTIONS = /* @__PURE__ */ new Set(["edit", "search", "add-sub", "hide", "adopt", "block"]);
var TileActionsDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "registers default tile overlay icons and handles their click actions";
  deps = {
    lineage: "@hypercomb.social/Lineage"
  };
  listens = ["render:host-ready", "tile:action", "overlay:icons-reordered", "overlay:arrange-mode"];
  emits = ["overlay:register-action", "overlay:pool-icons", "search:prefill", "tile:hidden", "tile:blocked"];
  #registered = false;
  #effectsRegistered = false;
  #arrangement = {};
  heartbeat = async () => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true;
      this.onEffect("render:host-ready", () => {
        if (this.#registered) return;
        this.#registered = true;
        void this.#loadArrangementAndRegister();
      });
      this.onEffect("tile:action", (payload) => {
        if (!HANDLED_ACTIONS.has(payload.action)) return;
        this.#handleAction(payload);
      });
      this.onEffect("overlay:icons-reordered", (payload) => {
        this.#arrangement[payload.profile] = payload.order;
        void this.#persistArrangement();
        this.#registerProfileIcons(payload.profile);
      });
    }
  };
  // ── Arrangement loading & registration ──────────────────────────
  async #loadArrangementAndRegister() {
    try {
      const lineage = this.resolve("lineage");
      const rootDir = await this.#getRootDir(lineage);
      if (rootDir) {
        const props = await readSeedProperties(rootDir);
        const saved = props[ARRANGEMENT_KEY];
        if (saved && typeof saved === "object") {
          this.#arrangement = saved;
        }
      }
    } catch {
    }
    const descriptors = this.#buildAllDescriptors();
    this.emitEffect("overlay:register-action", descriptors);
    this.#emitPoolIcons();
  }
  #buildAllDescriptors() {
    const descriptors = [];
    for (const profile of ["private", "public-own", "public-external"]) {
      const activeNames = this.#getActiveNames(profile);
      const positions = computeIconPositions(activeNames);
      for (let i = 0; i < activeNames.length; i++) {
        const entry = ICON_REGISTRY.find((e) => e.name === activeNames[i] && e.profile === profile);
        if (!entry) continue;
        descriptors.push({
          name: entry.name,
          svgMarkup: entry.svgMarkup,
          hoverTint: entry.hoverTint,
          profile: entry.profile,
          visibleWhen: entry.visibleWhen,
          x: positions[i].x,
          y: positions[i].y
        });
      }
    }
    return descriptors;
  }
  #registerProfileIcons(profile) {
    const profileEntries = ICON_REGISTRY.filter((e) => e.profile === profile);
    for (const entry of profileEntries) {
      EffectBus.emit("overlay:unregister-action", { name: entry.name });
    }
    const activeNames = this.#getActiveNames(profile);
    const positions = computeIconPositions(activeNames);
    const descriptors = [];
    for (let i = 0; i < activeNames.length; i++) {
      const entry = ICON_REGISTRY.find((e) => e.name === activeNames[i] && e.profile === profile);
      if (!entry) continue;
      descriptors.push({
        name: entry.name,
        svgMarkup: entry.svgMarkup,
        hoverTint: entry.hoverTint,
        profile: entry.profile,
        visibleWhen: entry.visibleWhen,
        x: positions[i].x,
        y: positions[i].y
      });
    }
    if (descriptors.length > 0) {
      this.emitEffect("overlay:register-action", descriptors);
    }
    this.#emitPoolIcons();
  }
  #getActiveNames(profile) {
    const saved = this.#arrangement[profile];
    if (saved && saved.length > 0) {
      const available = new Set(ICON_REGISTRY.filter((e) => e.profile === profile).map((e) => e.name));
      return saved.filter((n) => available.has(n));
    }
    return [...DEFAULT_ACTIVE[profile]];
  }
  #emitPoolIcons() {
    const pool = {};
    for (const profile of ["private", "public-own", "public-external"]) {
      const activeNames = new Set(this.#getActiveNames(profile));
      pool[profile] = ICON_REGISTRY.filter((e) => e.profile === profile && !activeNames.has(e.name));
    }
    EffectBus.emit("overlay:pool-icons", { pool, registry: ICON_REGISTRY });
  }
  // ── Persistence ─────────────────────────────────────────────────
  async #persistArrangement() {
    try {
      const lineage = this.resolve("lineage");
      const rootDir = await this.#getRootDir(lineage);
      if (rootDir) {
        await writeSeedProperties(rootDir, { [ARRANGEMENT_KEY]: this.#arrangement });
      }
    } catch {
    }
  }
  async #getRootDir(_lineage) {
    return null;
  }
  // ── Action handlers ─────────────────────────────────────────────
  #handleAction(payload) {
    const { action, label: rawLabel } = payload;
    const label = normalizeSeed(rawLabel) || rawLabel;
    switch (action) {
      case "edit":
        break;
      case "search":
        EffectBus.emit("search:prefill", { value: label });
        break;
      case "add-sub":
        EffectBus.emit("search:prefill", { value: label + "/" });
        break;
      case "hide":
        this.#hideOrBlock(label, "hc:hidden-tiles", "tile:hidden");
        break;
      case "adopt":
        EffectBus.emit("seed:added", { seed: label });
        void new hypercomb().act();
        break;
      case "block":
        this.#hideOrBlock(label, "hc:blocked-tiles", "tile:blocked");
        break;
    }
  }
  #hideOrBlock(label, storagePrefix, effect) {
    const lineage = this.resolve("lineage");
    const location = lineage?.explorerLabel() ?? "/";
    const key = `${storagePrefix}:${location}`;
    const existing = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!existing.includes(label)) existing.push(label);
    localStorage.setItem(key, JSON.stringify(existing));
    EffectBus.emit(effect, { seed: label, location });
    void new hypercomb().act();
  }
};
var _tileActions = new TileActionsDrone();
window.ioc.register("@diamondcoreprocessor.com/TileActionsDrone", _tileActions);

// src/diamondcoreprocessor.com/presentation/tiles/tile-overlay.drone.ts
var LABEL_X = -24;
var LABEL_Y = -14;
var LABEL_STYLE = new TextStyle({
  fontFamily: "monospace",
  fontSize: 5,
  fill: 16777215,
  align: "left"
});
var DEFAULT_ICON_SIZE = 6.5;
var POOL_Y_OFFSET = 16;
var POOL_ICON_SIZE = 5;
var POOL_SPACING = 8;
var POOL_BG_PADDING = 2;
var POOL_BG_COLOR = 2236996;
var POOL_BG_ALPHA = 0.6;
var WIGGLE_SPEED = 4;
var WIGGLE_AMPLITUDE = 0.06;
var DRAG_ALPHA = 0.6;
var TileOverlayDrone = class _TileOverlayDrone extends Drone2 {
  namespace = "diamondcoreprocessor.com";
  description = "contextual action overlay host \u2014 icons registered externally via effects";
  #app = null;
  #renderContainer = null;
  #canvas = null;
  #renderer = null;
  #overlay = null;
  #hexBg = null;
  #seedLabel = null;
  #actions = [];
  #animTime = 0;
  #animTickBound = null;
  #meshOffset = { x: 0, y: 0 };
  #currentAxial = null;
  #currentIndex = void 0;
  #geo = DEFAULT_HEX_GEOMETRY;
  #cellCount = 0;
  #cellLabels = [];
  #cellCoords = [];
  #listening = false;
  #flat = false;
  #occupiedByAxial = /* @__PURE__ */ new Map();
  #branchLabels = /* @__PURE__ */ new Set();
  #externalLabels = /* @__PURE__ */ new Set();
  #currentTileExternal = false;
  #activeProfileKey = null;
  #noImageLabels = /* @__PURE__ */ new Set();
  #navigationBlocked = false;
  #navigationGuardTimer = null;
  #meshPublic = false;
  #editing = false;
  #editCooldown = false;
  #hasSelection = false;
  #touchDragging = false;
  /** Registered descriptors from provider bees, keyed by name */
  #registeredDescriptors = /* @__PURE__ */ new Map();
  // ── Arrange mode state ──────────────────────────────────────────
  #arrangeMode = false;
  #arrangeDirty = false;
  #poolContainer = null;
  #poolBackground = null;
  #poolIcons = [];
  #poolRegistry = [];
  /** Drag state */
  #dragActive = false;
  #dragSource = "active";
  #dragName = null;
  #dragButton = null;
  #dragOriginalPosition = { x: 0, y: 0 };
  #dragStartClient = { x: 0, y: 0 };
  /** Current active order per profile (mirrors tile-actions arrangement) */
  #activeOrder = /* @__PURE__ */ new Map();
  deps = {
    detector: "@diamondcoreprocessor.com/HexDetector",
    axial: "@diamondcoreprocessor.com/AxialService",
    lineage: "@hypercomb.social/Lineage"
  };
  listens = [
    "render:host-ready",
    "render:mesh-offset",
    "render:cell-count",
    "render:set-orientation",
    "render:geometry-changed",
    "navigation:guard-start",
    "navigation:guard-end",
    "mesh:public-changed",
    "editor:mode",
    "selection:changed",
    "overlay:register-action",
    "overlay:unregister-action",
    "overlay:neon-color",
    "drop:dragging",
    "drop:pending",
    "overlay:arrange-mode",
    "overlay:pool-icons"
  ];
  emits = ["tile:hover", "tile:action", "tile:click", "tile:navigate-in", "tile:navigate-back", "drop:target", "overlay:icons-reordered"];
  #dropDragging = false;
  #dropPending = false;
  #effectsRegistered = false;
  heartbeat = async () => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true;
      this.onEffect("overlay:register-action", (payload) => {
        const descs = Array.isArray(payload) ? payload : [payload];
        for (const desc of descs) this.#registeredDescriptors.set(desc.name, desc);
        for (const desc of descs) {
          if (!this.#activeOrder.has(desc.profile)) this.#activeOrder.set(desc.profile, []);
          const order = this.#activeOrder.get(desc.profile);
          if (!order.includes(desc.name)) order.push(desc.name);
        }
        this.#rebuildActiveProfile();
      });
      this.onEffect("overlay:unregister-action", ({ name }) => {
        const desc = this.#registeredDescriptors.get(name);
        if (desc) {
          const order = this.#activeOrder.get(desc.profile);
          if (order) {
            const idx = order.indexOf(name);
            if (idx >= 0) order.splice(idx, 1);
          }
        }
        this.#registeredDescriptors.delete(name);
        this.#rebuildActiveProfile();
      });
      this.onEffect("overlay:neon-color", ({ index }) => {
        this.#hexBg?.setColorIndex(index);
      });
      this.onEffect("overlay:arrange-mode", ({ active }) => {
        if (active) {
          this.#enterArrangeMode();
        } else {
          this.#exitArrangeMode();
        }
      });
      this.onEffect("overlay:pool-icons", ({ pool, registry }) => {
        this.#poolRegistry = registry;
        if (this.#arrangeMode) {
          this.#rebuildPoolIcons(pool);
        }
      });
      this.onEffect("render:host-ready", (payload) => {
        this.#app = payload.app;
        this.#renderContainer = payload.container;
        this.#canvas = payload.canvas;
        this.#renderer = payload.renderer;
        this.#initOverlay();
        this.#attachListeners();
      });
      this.onEffect("render:mesh-offset", (offset) => {
        this.#meshOffset = offset;
        if (this.#currentAxial) {
          this.#positionOverlay(this.#currentAxial.q, this.#currentAxial.r);
        }
      });
      this.onEffect("render:cell-count", (payload) => {
        this.#cellCount = payload.count;
        this.#cellLabels = payload.labels;
        this.#cellCoords = payload.coords;
        this.#branchLabels = new Set(payload.branchLabels ?? []);
        this.#externalLabels = new Set(payload.externalLabels ?? []);
        this.#noImageLabels = new Set(payload.noImageLabels ?? []);
        this.#rebuildOccupiedMap();
        if (this.#overlay && this.#currentAxial) {
          this.#currentIndex = this.#lookupIndex(this.#currentAxial.q, this.#currentAxial.r);
          this.#updatePerTileVisibility();
          this.#updateVisibility();
        }
      });
      this.onEffect("render:set-orientation", (payload) => {
        this.#flat = payload.flat;
        this.#updateHexBg();
        if (this.#currentAxial) this.#positionOverlay(this.#currentAxial.q, this.#currentAxial.r);
      });
      this.onEffect("render:geometry-changed", (geo) => {
        this.#geo = geo;
        const detector = this.resolve("detector");
        if (detector) detector.spacing = geo.spacing;
        this.#updateHexBg();
        if (this.#currentAxial) this.#positionOverlay(this.#currentAxial.q, this.#currentAxial.r);
      });
      this.onEffect("navigation:guard-start", () => {
        this.#navigationBlocked = true;
        this.#currentAxial = null;
        this.#currentIndex = void 0;
        if (this.#overlay && !this.#arrangeMode) this.#overlay.visible = false;
        if (this.#navigationGuardTimer) clearTimeout(this.#navigationGuardTimer);
        this.#navigationGuardTimer = setTimeout(() => {
          this.#navigationBlocked = false;
        }, 200);
      });
      this.onEffect("navigation:guard-end", () => {
        this.#navigationBlocked = false;
        if (this.#navigationGuardTimer) {
          clearTimeout(this.#navigationGuardTimer);
          this.#navigationGuardTimer = null;
        }
      });
      this.onEffect("touch:dragging", ({ active }) => {
        this.#touchDragging = active;
        if (active && this.#overlay && !this.#arrangeMode) this.#overlay.visible = false;
      });
      this.onEffect("mesh:public-changed", (payload) => {
        this.#meshPublic = payload.public;
        this.#rebuildActiveProfile();
        this.#updateVisibility();
      });
      this.onEffect("editor:mode", (payload) => {
        this.#editing = payload.active;
        if (payload.active) {
          this.#editCooldown = false;
          this.#updateVisibility();
        } else {
          this.#editCooldown = true;
          this.#updateVisibility();
          setTimeout(() => {
            this.#editCooldown = false;
            this.#updateVisibility();
          }, 300);
        }
      });
      this.onEffect("selection:changed", (payload) => {
        this.#hasSelection = (payload?.selected?.length ?? 0) > 0;
        this.#updateVisibility();
      });
      this.onEffect("drop:dragging", ({ active }) => {
        this.#dropDragging = active;
        this.#updatePerTileVisibility();
        this.#updateVisibility();
      });
      this.onEffect("drop:pending", ({ active }) => {
        this.#dropPending = active;
        this.#updatePerTileVisibility();
        this.#updateVisibility();
      });
    }
  };
  dispose() {
    if (this.#arrangeMode) this.#exitArrangeMode();
    if (this.#listening) {
      document.removeEventListener("pointermove", this.#onPointerMove);
      document.removeEventListener("dragover", this.#onDragOverTrack);
      document.removeEventListener("click", this.#onClick);
      document.removeEventListener("pointerup", this.#onPointerUp);
      document.removeEventListener("contextmenu", this.#onContextMenu);
      this.#listening = false;
    }
    if (this.#animTickBound && this.#app) {
      this.#app.ticker.remove(this.#animTickBound);
      this.#animTickBound = null;
    }
    if (this.#overlay) {
      this.#overlay.destroy({ children: true });
      this.#overlay = null;
      this.#hexBg = null;
      this.#seedLabel = null;
      this.#actions = [];
    }
  }
  // ── Overlay setup ──────────────────────────────────────────────────
  #initOverlay() {
    if (!this.#renderContainer || this.#overlay) return;
    this.#overlay = new Container3();
    this.#overlay.visible = false;
    this.#overlay.zIndex = 9999;
    this.#hexBg = new HexOverlayMesh(this.#geo.circumRadiusPx, this.#flat);
    this.#overlay.addChild(this.#hexBg.mesh);
    this.#seedLabel = new Text({ text: "", style: LABEL_STYLE, resolution: window.devicePixelRatio * 8 });
    this.#seedLabel.position.set(LABEL_X, LABEL_Y);
    this.#overlay.addChild(this.#seedLabel);
    this.#renderContainer.addChild(this.#overlay);
    this.#renderContainer.sortableChildren = true;
    if (this.#app && !this.#animTickBound) {
      this.#animTickBound = (ticker) => {
        this.#animTime += (ticker.deltaMS ?? 16) / 1e3;
        if (this.#hexBg && this.#overlay?.visible) {
          this.#hexBg.setTime(this.#animTime);
        }
        if (this.#arrangeMode) {
          this.#animateArrangeWiggle();
        }
      };
      this.#app.ticker.add(this.#animTickBound);
    }
    this.#rebuildActiveProfile();
  }
  #updateHexBg() {
    this.#hexBg?.update(this.#geo.circumRadiusPx, this.#flat);
  }
  // ── Profile resolution (now from registered descriptors) ───────────
  #resolveProfileKey() {
    if (!this.#meshPublic) return "private";
    return this.#currentTileExternal ? "public-external" : "public-own";
  }
  #rebuildActiveProfile() {
    if (!this.#overlay) return;
    for (const action of this.#actions) {
      this.#overlay.removeChild(action.button);
      action.button.destroy({ children: true });
    }
    this.#actions = [];
    const key = this.#resolveProfileKey();
    this.#activeProfileKey = key;
    const descs = [...this.#registeredDescriptors.values()].filter((d) => d.profile === key);
    for (const desc of descs) {
      const btn = new HexIconButton({
        svgMarkup: desc.svgMarkup,
        size: DEFAULT_ICON_SIZE,
        cacheKey: `hc-icon-${desc.name}`,
        hoverTint: desc.hoverTint
      });
      this.#overlay.addChild(btn);
      void btn.load();
      this.#actions.push({
        name: desc.name,
        button: btn,
        profile: desc.profile,
        visibleWhen: desc.visibleWhen
      });
    }
    this.#layoutIconRow();
    this.#updatePerTileVisibility();
  }
  // ── Icon row layout (centered, inline) ──────────────────────────────
  #layoutIconRow() {
    const visible = this.#actions.filter((a) => a.button.visible);
    const count = visible.length;
    if (count === 0) return;
    const spacing = ICON_SPACING;
    const startX = -(count - 1) * spacing / 2;
    for (let i = 0; i < count; i++) {
      visible[i].button.position.set(startX + i * spacing, ICON_Y);
    }
  }
  // ── Per-tile icon visibility ───────────────────────────────────────
  #updatePerTileVisibility() {
    if (!this.#currentAxial) return;
    if (this.#dropDragging || this.#dropPending) {
      for (const action of this.#actions) action.button.visible = false;
      if (this.#seedLabel) this.#seedLabel.visible = false;
      return;
    }
    if (this.#seedLabel) this.#seedLabel.visible = true;
    if (this.#arrangeMode) {
      for (const action of this.#actions) action.button.visible = true;
      return;
    }
    const entry = this.#occupiedByAxial.get(_TileOverlayDrone.axialKey(this.#currentAxial.q, this.#currentAxial.r));
    if (!entry) return;
    const ctx = {
      label: entry.label,
      q: this.#currentAxial.q,
      r: this.#currentAxial.r,
      index: entry.index,
      noImage: this.#noImageLabels.has(entry.label)
    };
    for (const action of this.#actions) {
      if (action.visibleWhen) {
        action.button.visible = action.visibleWhen(ctx);
      }
    }
    this.#layoutIconRow();
  }
  // ── Arrange mode ────────────────────────────────────────────────────
  #enterArrangeMode() {
    if (this.#arrangeMode) return;
    this.#arrangeMode = true;
    this.#arrangeDirty = false;
    if (!this.#currentAxial || this.#currentIndex === void 0) {
      if (this.#cellCoords.length > 0 && this.#cellLabels.length > 0) {
        const coord = this.#cellCoords[0];
        this.#currentAxial = { q: coord.q, r: coord.r };
        this.#currentIndex = 0;
        this.#positionOverlay(coord.q, coord.r);
        this.#updateSeedLabel(coord.q, coord.r);
      }
    }
    if (this.#overlay) {
      this.#overlay.visible = true;
    }
    for (const action of this.#actions) {
      action.button.visible = true;
    }
    this.#createPoolContainer();
    EffectBus2.emit("keymap:suppress", { reason: "arrange-mode" });
    document.addEventListener("keydown", this.#onArrangeKeyDown);
    document.addEventListener("pointerdown", this.#onArrangePointerDown, true);
    document.addEventListener("pointermove", this.#onArrangePointerMove);
    document.addEventListener("pointerup", this.#onArrangePointerUp);
  }
  #exitArrangeMode() {
    if (!this.#arrangeMode) return;
    this.#arrangeMode = false;
    if (this.#dragActive) this.#cancelDrag();
    if (this.#arrangeDirty && this.#activeProfileKey) {
      const order = this.#activeOrder.get(this.#activeProfileKey);
      if (order) {
        this.emitEffect("overlay:icons-reordered", { profile: this.#activeProfileKey, order: [...order] });
      }
    }
    this.#destroyPoolContainer();
    EffectBus2.emit("keymap:unsuppress", { reason: "arrange-mode" });
    document.removeEventListener("keydown", this.#onArrangeKeyDown);
    document.removeEventListener("pointerdown", this.#onArrangePointerDown, true);
    document.removeEventListener("pointermove", this.#onArrangePointerMove);
    document.removeEventListener("pointerup", this.#onArrangePointerUp);
    for (const action of this.#actions) {
      action.button.rotation = 0;
      action.button.scale.set(1, 1);
    }
    this.#updateVisibility();
    this.#updatePerTileVisibility();
  }
  #onArrangeKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      EffectBus2.emit("overlay:arrange-mode", { active: false });
    }
  };
  // ── Arrange wiggle animation ────────────────────────────────────
  #animateArrangeWiggle() {
    for (let i = 0; i < this.#actions.length; i++) {
      const action = this.#actions[i];
      if (this.#dragActive && action.name === this.#dragName) continue;
      const phase = i * 1.2;
      action.button.rotation = Math.sin(this.#animTime * WIGGLE_SPEED + phase) * WIGGLE_AMPLITUDE;
    }
    for (let i = 0; i < this.#poolIcons.length; i++) {
      const poolIcon = this.#poolIcons[i];
      if (this.#dragActive && poolIcon.name === this.#dragName) continue;
      const phase = (i + this.#actions.length) * 1.2;
      poolIcon.button.rotation = Math.sin(this.#animTime * WIGGLE_SPEED + phase) * WIGGLE_AMPLITUDE;
    }
  }
  // ── Pool container ──────────────────────────────────────────────
  #createPoolContainer() {
    if (!this.#overlay || this.#poolContainer) return;
    this.#poolContainer = new Container3();
    this.#poolContainer.position.set(0, POOL_Y_OFFSET);
    this.#overlay.addChild(this.#poolContainer);
    this.#poolBackground = new Graphics3();
    this.#poolContainer.addChild(this.#poolBackground);
    this.#requestPoolRebuild();
  }
  #destroyPoolContainer() {
    if (!this.#poolContainer) return;
    for (const poolIcon of this.#poolIcons) {
      poolIcon.button.destroy({ children: true });
    }
    this.#poolIcons = [];
    this.#poolBackground?.destroy();
    this.#poolBackground = null;
    this.#poolContainer.destroy({ children: true });
    if (this.#overlay) {
      this.#overlay.removeChild(this.#poolContainer);
    }
    this.#poolContainer = null;
  }
  #requestPoolRebuild() {
    const profile = this.#activeProfileKey ?? this.#resolveProfileKey();
    const activeNames = new Set(this.#activeOrder.get(profile) ?? []);
    const poolEntries = this.#poolRegistry.filter((e) => e.profile === profile && !activeNames.has(e.name));
    const pool = {};
    pool[profile] = poolEntries;
    this.#rebuildPoolIcons(pool);
  }
  #rebuildPoolIcons(pool) {
    if (!this.#poolContainer || !this.#poolBackground) return;
    for (const poolIcon of this.#poolIcons) {
      this.#poolContainer.removeChild(poolIcon.button);
      poolIcon.button.destroy({ children: true });
    }
    this.#poolIcons = [];
    const profile = this.#activeProfileKey ?? this.#resolveProfileKey();
    const entries = pool[profile] ?? [];
    if (entries.length === 0) {
      this.#poolBackground.clear();
      return;
    }
    const startX = -(entries.length - 1) * POOL_SPACING / 2;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const btn = new HexIconButton({
        svgMarkup: entry.svgMarkup,
        size: POOL_ICON_SIZE,
        cacheKey: `hc-pool-${entry.name}`,
        hoverTint: entry.hoverTint
      });
      btn.position.set(startX + i * POOL_SPACING, 0);
      btn.alpha = 0.5;
      this.#poolContainer.addChild(btn);
      void btn.load();
      this.#poolIcons.push({ name: entry.name, profile: entry.profile, button: btn });
    }
    this.#poolBackground.clear();
    const halfW = (entries.length - 1) * POOL_SPACING / 2 + POOL_ICON_SIZE / 2 + POOL_BG_PADDING;
    const halfH = POOL_ICON_SIZE / 2 + POOL_BG_PADDING;
    this.#poolBackground.roundRect(-halfW, -halfH, halfW * 2, halfH * 2, 1.5);
    this.#poolBackground.fill({ color: POOL_BG_COLOR, alpha: POOL_BG_ALPHA });
  }
  // ── Arrange drag-and-drop ───────────────────────────────────────
  #onArrangePointerDown = (e) => {
    if (!this.#arrangeMode || this.#dragActive) return;
    if (!this.#overlay || !this.#renderContainer || !this.#renderer || !this.#canvas) return;
    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY);
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y));
    const ox = this.#overlay.position.x;
    const oy = this.#overlay.position.y;
    for (const action of this.#actions) {
      const btn = action.button;
      const bx = local.x - ox - btn.position.x;
      const by = local.y - oy - btn.position.y;
      if (btn.containsPoint(bx, by)) {
        e.preventDefault();
        e.stopPropagation();
        this.#startDrag(action.name, action.button, "active", e.clientX, e.clientY);
        return;
      }
    }
    if (this.#poolContainer) {
      const poolOx = ox + this.#poolContainer.position.x;
      const poolOy = oy + this.#poolContainer.position.y;
      for (const poolIcon of this.#poolIcons) {
        const btn = poolIcon.button;
        const bx = local.x - poolOx - btn.position.x;
        const by = local.y - poolOy - btn.position.y;
        if (btn.containsPoint(bx, by)) {
          e.preventDefault();
          e.stopPropagation();
          this.#startDrag(poolIcon.name, poolIcon.button, "pool", e.clientX, e.clientY);
          return;
        }
      }
    }
  };
  #startDrag(name, button, source, clientX, clientY) {
    this.#dragActive = true;
    this.#dragSource = source;
    this.#dragName = name;
    this.#dragButton = button;
    this.#dragOriginalPosition = { x: button.position.x, y: button.position.y };
    this.#dragStartClient = { x: clientX, y: clientY };
    button.alpha = DRAG_ALPHA;
    button.zIndex = 1e4;
    if (button.parent) button.parent.sortableChildren = true;
  }
  #onArrangePointerMove = (e) => {
    if (!this.#dragActive || !this.#dragButton || !this.#overlay || !this.#renderContainer) return;
    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY);
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y));
    const ox = this.#overlay.position.x;
    const oy = this.#overlay.position.y;
    if (this.#dragSource === "pool" && this.#poolContainer) {
      this.#dragButton.position.set(
        local.x - ox - this.#poolContainer.position.x,
        local.y - oy - this.#poolContainer.position.y
      );
    } else {
      this.#dragButton.position.set(local.x - ox, local.y - oy);
    }
    this.#updateDropHighlights(local.x - ox, local.y - oy);
  };
  #onArrangePointerUp = (_e) => {
    if (!this.#dragActive || !this.#dragButton || !this.#overlay || !this.#renderContainer) return;
    const dragName = this.#dragName;
    const dragSource = this.#dragSource;
    const dragButton = this.#dragButton;
    const dropTarget = this.#findDropTarget(dragButton, dragSource);
    if (dropTarget) {
      if (dropTarget.type === "active" && dragSource === "active") {
        this.#swapActiveIcons(dragName, dropTarget.name);
      } else if (dropTarget.type === "pool" && dragSource === "active") {
        this.#moveActiveToPool(dragName);
      } else if (dropTarget.type === "active" && dragSource === "pool") {
        this.#movePoolToActive(dragName, dropTarget.name);
      } else if (dropTarget.type === "active-area" && dragSource === "pool") {
        this.#movePoolToActiveEnd(dragName);
      }
    } else if (dragSource === "pool") {
      const btnGlobalY = dragButton.position.y + (this.#poolContainer?.position.y ?? 0);
      if (btnGlobalY < POOL_Y_OFFSET - POOL_BG_PADDING) {
        this.#movePoolToActiveEnd(dragName);
      }
    }
    this.#cancelDrag();
    this.#clearDropHighlights();
  };
  #cancelDrag() {
    if (this.#dragButton) {
      this.#dragButton.alpha = this.#dragSource === "pool" ? 0.5 : 1;
      this.#dragButton.position.set(this.#dragOriginalPosition.x, this.#dragOriginalPosition.y);
      this.#dragButton.zIndex = 0;
    }
    this.#dragActive = false;
    this.#dragSource = "active";
    this.#dragName = null;
    this.#dragButton = null;
  }
  #findDropTarget(dragButton, dragSource) {
    let centerX;
    let centerY;
    if (dragSource === "pool" && this.#poolContainer) {
      centerX = dragButton.position.x + this.#poolContainer.position.x;
      centerY = dragButton.position.y + this.#poolContainer.position.y;
    } else {
      centerX = dragButton.position.x;
      centerY = dragButton.position.y;
    }
    for (const action of this.#actions) {
      if (action.name === this.#dragName && dragSource === "active") continue;
      const ax = action.button.position.x;
      const ay = action.button.position.y;
      const dist = Math.sqrt((centerX - ax) ** 2 + (centerY - ay) ** 2);
      if (dist < ICON_SPACING * 0.7) {
        return { type: "active", name: action.name };
      }
    }
    if (this.#poolContainer) {
      for (const poolIcon of this.#poolIcons) {
        if (poolIcon.name === this.#dragName && dragSource === "pool") continue;
        const px = poolIcon.button.position.x + this.#poolContainer.position.x;
        const py = poolIcon.button.position.y + this.#poolContainer.position.y;
        const dist = Math.sqrt((centerX - px) ** 2 + (centerY - py) ** 2);
        if (dist < POOL_SPACING * 0.7) {
          return { type: "pool", name: poolIcon.name };
        }
      }
    }
    if (centerY < POOL_Y_OFFSET - POOL_BG_PADDING && centerY > ICON_Y - 10 && centerY < ICON_Y + 15) {
      return { type: "active-area", name: "" };
    }
    return null;
  }
  #updateDropHighlights(localX, localY) {
    for (const action of this.#actions) {
      if (action.name === this.#dragName && this.#dragSource === "active") continue;
      const ax = action.button.position.x;
      const ay = action.button.position.y;
      const dist = Math.sqrt((localX - ax) ** 2 + (localY - ay) ** 2);
      action.button.hovered = dist < ICON_SPACING * 0.7;
    }
  }
  #clearDropHighlights() {
    for (const action of this.#actions) {
      action.button.hovered = false;
    }
    for (const poolIcon of this.#poolIcons) {
      poolIcon.button.hovered = false;
    }
  }
  // ── Arrange operations ──────────────────────────────────────────
  #swapActiveIcons(nameA, nameB) {
    const profile = this.#activeProfileKey;
    if (!profile) return;
    const order = this.#activeOrder.get(profile);
    if (!order) return;
    const idxA = order.indexOf(nameA);
    const idxB = order.indexOf(nameB);
    if (idxA < 0 || idxB < 0) return;
    order[idxA] = nameB;
    order[idxB] = nameA;
    const positions = computeIconPositions(order);
    for (const action of this.#actions) {
      const idx = order.indexOf(action.name);
      if (idx >= 0 && positions[idx]) {
        action.button.position.set(positions[idx].x, positions[idx].y);
      }
    }
    for (const action of this.#actions) {
      const desc = this.#registeredDescriptors.get(action.name);
      if (desc) {
        const idx = order.indexOf(action.name);
        if (idx >= 0 && positions[idx]) {
          desc.x = positions[idx].x;
          desc.y = positions[idx].y;
        }
      }
    }
    this.#arrangeDirty = true;
  }
  #moveActiveToPool(name) {
    const profile = this.#activeProfileKey;
    if (!profile) return;
    const order = this.#activeOrder.get(profile);
    if (!order) return;
    const idx = order.indexOf(name);
    if (idx < 0) return;
    order.splice(idx, 1);
    this.#registeredDescriptors.delete(name);
    this.#rebuildActiveProfile();
    this.#requestPoolRebuild();
    this.#arrangeDirty = true;
    for (const action of this.#actions) {
      action.button.visible = true;
    }
  }
  #movePoolToActive(name, beforeName) {
    const profile = this.#activeProfileKey;
    if (!profile) return;
    const order = this.#activeOrder.get(profile);
    if (!order) return;
    if (order.includes(name)) return;
    const targetIdx = order.indexOf(beforeName);
    if (targetIdx >= 0) {
      order.splice(targetIdx, 0, name);
    } else {
      order.push(name);
    }
    this.#reregisterActiveIcons(profile, order);
    this.#arrangeDirty = true;
  }
  #movePoolToActiveEnd(name) {
    const profile = this.#activeProfileKey;
    if (!profile) return;
    const order = this.#activeOrder.get(profile);
    if (!order) return;
    if (order.includes(name)) return;
    order.push(name);
    this.#reregisterActiveIcons(profile, order);
    this.#arrangeDirty = true;
  }
  #reregisterActiveIcons(profile, order) {
    const positions = computeIconPositions(order);
    for (let i = 0; i < order.length; i++) {
      const iconName = order[i];
      const entry = this.#poolRegistry.find((e) => e.name === iconName && e.profile === profile);
      if (!entry) continue;
      const desc = {
        name: entry.name,
        svgMarkup: entry.svgMarkup,
        hoverTint: entry.hoverTint,
        profile: entry.profile,
        visibleWhen: entry.visibleWhen,
        x: positions[i].x,
        y: positions[i].y
      };
      this.#registeredDescriptors.set(iconName, desc);
    }
    for (const [descName, desc] of this.#registeredDescriptors) {
      if (desc.profile === profile && !order.includes(descName)) {
        this.#registeredDescriptors.delete(descName);
      }
    }
    this.#rebuildActiveProfile();
    this.#requestPoolRebuild();
    for (const action of this.#actions) {
      action.button.visible = true;
    }
  }
  // ── Input listeners ────────────────────────────────────────────────
  #attachListeners() {
    if (this.#listening) return;
    this.#listening = true;
    document.addEventListener("pointermove", this.#onPointerMove);
    document.addEventListener("dragover", this.#onDragOverTrack);
    document.addEventListener("click", this.#onClick);
    document.addEventListener("pointerup", this.#onPointerUp);
    document.addEventListener("contextmenu", this.#onContextMenu);
  }
  /** Track hex position during image drag-over (pointermove doesn't fire during drag). */
  #onDragOverTrack = (e) => {
    if (!this.#dropDragging) return;
    if (!this.#renderContainer || !this.#overlay || !this.#renderer || !this.#canvas) return;
    const detector = this.resolve("detector");
    if (!detector) return;
    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY);
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y));
    const meshLocalX = local.x - this.#meshOffset.x;
    const meshLocalY = local.y - this.#meshOffset.y;
    const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat);
    const hexChanged = !this.#currentAxial || this.#currentAxial.q !== axial.q || this.#currentAxial.r !== axial.r;
    if (hexChanged) {
      this.#currentAxial = axial;
      this.#currentIndex = this.#lookupIndex(axial.q, axial.r);
      this.#positionOverlay(axial.q, axial.r);
      this.#updateSeedLabel(axial.q, axial.r);
      const entry = this.#occupiedByAxial.get(_TileOverlayDrone.axialKey(axial.q, axial.r));
      this.emitEffect("drop:target", {
        q: axial.q,
        r: axial.r,
        occupied: !!entry,
        label: entry?.label ?? null,
        index: entry?.index ?? -1,
        hasImage: entry ? !this.#noImageLabels.has(entry.label) : false
      });
    }
  };
  #onPointerMove = (e) => {
    if (this.#arrangeMode) return;
    if (!this.#renderContainer || !this.#overlay || !this.#renderer || !this.#canvas) return;
    const detector = this.resolve("detector");
    if (!detector) return;
    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY);
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y));
    const meshLocalX = local.x - this.#meshOffset.x;
    const meshLocalY = local.y - this.#meshOffset.y;
    const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat);
    if (typeof globalThis.ngDevMode !== "undefined") {
      const key = _TileOverlayDrone.axialKey(axial.q, axial.r);
      const entry = this.#occupiedByAxial.get(key);
      if (entry && entry.index >= this.#cellCount) {
        console.warn("[tile-overlay] stale occupied entry:", key, entry, "cellCount:", this.#cellCount);
      }
    }
    const hexChanged = !this.#currentAxial || this.#currentAxial.q !== axial.q || this.#currentAxial.r !== axial.r;
    if (hexChanged) {
      this.#currentAxial = axial;
      this.#currentIndex = this.#lookupIndex(axial.q, axial.r);
      const entry = this.#occupiedByAxial.get(_TileOverlayDrone.axialKey(axial.q, axial.r));
      this.#currentTileExternal = !!(entry?.label && this.#externalLabels.has(entry.label));
      if (this.#meshPublic) {
        const newKey = this.#resolveProfileKey();
        if (newKey !== this.#activeProfileKey) this.#rebuildActiveProfile();
      }
      if (e.ctrlKey || e.metaKey) {
        this.#overlay.visible = false;
        this.emitEffect("tile:hover", { q: axial.q, r: axial.r });
        return;
      }
      this.#positionOverlay(axial.q, axial.r);
      this.#updateSeedLabel(axial.q, axial.r);
      this.#updatePerTileVisibility();
      this.emitEffect("tile:hover", { q: axial.q, r: axial.r });
    }
    if (e.ctrlKey || e.metaKey) {
      this.#overlay.visible = false;
      return;
    }
    this.#updateIconHover(local);
  };
  #updateIconHover(local) {
    if (!this.#overlay?.visible) {
      for (const a of this.#actions) a.button.hovered = false;
      return;
    }
    const ox = this.#overlay.position.x;
    const oy = this.#overlay.position.y;
    for (const a of this.#actions) {
      const btn = a.button;
      const bx = local.x - ox - btn.position.x;
      const by = local.y - oy - btn.position.y;
      btn.hovered = btn.containsPoint(bx, by);
    }
  }
  #onClick = (e) => {
    if (this.#arrangeMode) return;
    if (this.#navigationBlocked) return;
    if (this.#editing || this.#editCooldown) return;
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return;
    if (e.ctrlKey || e.metaKey) {
      const detector = this.resolve("detector");
      if (!detector) return;
      const pixiGlobal2 = this.#clientToPixiGlobal(e.clientX, e.clientY);
      const local2 = this.#renderContainer.toLocal(new Point(pixiGlobal2.x, pixiGlobal2.y));
      const meshLocalX = local2.x - this.#meshOffset.x;
      const meshLocalY = local2.y - this.#meshOffset.y;
      const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat);
      const entry2 = this.#occupiedByAxial.get(_TileOverlayDrone.axialKey(axial.q, axial.r));
      if (!entry2?.label) return;
      this.emitEffect("tile:click", {
        q: axial.q,
        r: axial.r,
        label: entry2.label,
        index: entry2.index,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey
      });
      return;
    }
    if (this.#currentIndex === void 0 || this.#currentIndex >= this.#cellCount) return;
    const entry = this.#occupiedByAxial.get(
      _TileOverlayDrone.axialKey(this.#currentAxial.q, this.#currentAxial.r)
    );
    if (!entry?.label) return;
    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY);
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y));
    if (this.#overlay?.visible) {
      const ox = this.#overlay.position.x;
      const oy = this.#overlay.position.y;
      for (const action of this.#actions) {
        if (!action.button.visible) continue;
        const btn = action.button;
        const bx = local.x - ox - btn.position.x;
        const by = local.y - oy - btn.position.y;
        if (btn.containsPoint(bx, by)) {
          this.emitEffect("tile:action", {
            action: action.name,
            q: this.#currentAxial.q,
            r: this.#currentAxial.r,
            index: this.#currentIndex,
            label: entry.label
          });
          return;
        }
      }
    }
    if (this.#hasSelection) {
      this.emitEffect("tile:click", {
        q: this.#currentAxial.q,
        r: this.#currentAxial.r,
        label: entry.label,
        index: this.#currentIndex,
        ctrlKey: false,
        metaKey: false
      });
      return;
    }
    if (this.#branchLabels.has(entry.label)) {
      this.#navigateInto(entry.label);
    } else {
      this.emitEffect("tile:action", {
        action: "open",
        q: this.#currentAxial.q,
        r: this.#currentAxial.r,
        index: this.#currentIndex,
        label: entry.label
      });
    }
  };
  // Cancel editor on right-click release (mirrors Escape cascade priority 1)
  #onPointerUp = (e) => {
    if (e.button !== 2) return;
    if (!this.#editing) return;
    const drone = window.ioc.get("@diamondcoreprocessor.com/TileEditorDrone");
    drone?.cancelEditing();
  };
  #onContextMenu = (e) => {
    if (this.#arrangeMode) {
      e.preventDefault();
      return;
    }
    if (this.#navigationBlocked) return;
    if (this.#editing) {
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      return;
    }
    const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
    if (selection && selection.count > 0) {
      e.preventDefault();
      return;
    }
    const gate = window.ioc.get("@diamondcoreprocessor.com/InputGate");
    if (gate?.active) return;
    e.preventDefault();
    this.#navigateBack();
  };
  // ── Navigation ─────────────────────────────────────────────────────
  #navigateInto(label) {
    const lineage = this.resolve("lineage");
    if (!lineage) return;
    this.emitEffect("tile:navigate-in", { label });
    lineage.explorerEnter(label);
  }
  #navigateBack() {
    const lineage = this.resolve("lineage");
    if (!lineage) return;
    this.emitEffect("tile:navigate-back", {});
    lineage.explorerUp();
  }
  // ── Helpers ────────────────────────────────────────────────────────
  #updateSeedLabel(q, r) {
    if (!this.#seedLabel) return;
    const entry = this.#occupiedByAxial.get(_TileOverlayDrone.axialKey(q, r));
    this.#seedLabel.text = entry ? `${String(entry.index).padStart(3, "0")}-${entry.label}` : "";
  }
  #updateVisibility() {
    if (!this.#overlay) return;
    if (this.#arrangeMode) {
      this.#overlay.visible = true;
      return;
    }
    if (this.#dropDragging || this.#dropPending) {
      this.#overlay.visible = true;
      return;
    }
    const occupied = this.#currentIndex !== void 0 && this.#currentIndex < this.#cellCount;
    const shouldShow = occupied && !this.#editing && !this.#editCooldown && !this.#hasSelection && !this.#touchDragging;
    this.#overlay.visible = shouldShow;
    if (shouldShow && this.#hexBg) {
      this.#hexBg.show(this.#animTime);
    } else if (!shouldShow && this.#hexBg) {
      this.#hexBg.hide();
    }
  }
  #positionOverlay(q, r) {
    if (!this.#overlay) return;
    const px = this.#axialToPixel(q, r);
    this.#overlay.position.set(
      px.x + this.#meshOffset.x,
      px.y + this.#meshOffset.y
    );
    this.#updateVisibility();
  }
  #axialToPixel(q, r) {
    return this.#flat ? { x: 1.5 * this.#geo.spacing * q, y: Math.sqrt(3) * this.#geo.spacing * (r + q / 2) } : { x: Math.sqrt(3) * this.#geo.spacing * (q + r / 2), y: this.#geo.spacing * 1.5 * r };
  }
  static axialKey(q, r) {
    return `${q},${r}`;
  }
  #rebuildOccupiedMap() {
    this.#occupiedByAxial.clear();
    for (let i = 0; i < this.#cellCount; i++) {
      const coord = this.#cellCoords[i];
      const label = this.#cellLabels[i];
      if (!coord || !label) break;
      this.#occupiedByAxial.set(_TileOverlayDrone.axialKey(coord.q, coord.r), { index: i, label });
    }
  }
  #lookupIndex(q, r) {
    return this.#occupiedByAxial.get(_TileOverlayDrone.axialKey(q, r))?.index;
  }
  #clientToPixiGlobal(cx, cy) {
    const events = this.#renderer?.events;
    if (events?.mapPositionToPoint) {
      const out = new Point();
      events.mapPositionToPoint(out, cx, cy);
      return { x: out.x, y: out.y };
    }
    const rect = this.#canvas.getBoundingClientRect();
    const screen = this.#renderer.screen;
    return {
      x: (cx - rect.left) * (screen.width / rect.width),
      y: (cy - rect.top) * (screen.height / rect.height)
    };
  }
};
var _tileOverlay = new TileOverlayDrone();
window.ioc.register("@diamondcoreprocessor.com/TileOverlayDrone", _tileOverlay);
export {
  TileOverlayDrone
};
