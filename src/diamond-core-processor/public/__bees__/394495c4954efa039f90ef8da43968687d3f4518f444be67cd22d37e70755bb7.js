// src/diamondcoreprocessor.com/presentation/tiles/tile-overlay.drone.ts
import { Drone as Drone2, EffectBus as EffectBus2, consumePointerGesture, I18N_IOC_KEY } from "@hypercomb/core";
import { Container as Container3, Graphics as Graphics2, Point, Text, TextStyle } from "pixi.js";

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

// src/diamondcoreprocessor.com/presentation/grid/hex-geometry.ts
function createHexGeometry(circumRadiusPx, gapPx, padPx = 10) {
  return { circumRadiusPx, gapPx, padPx, spacing: circumRadiusPx + gapPx };
}
var DEFAULT_HEX_GEOMETRY = createHexGeometry(32, 6);

// src/diamondcoreprocessor.com/presentation/tiles/tile-actions.drone.ts
import { Drone, EffectBus, hypercomb, normalizeCell } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/tile-properties.ts
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
var writeCellProperties = async (cellDir, updates) => {
  const existing = await readCellProperties(cellDir);
  const merged = { ...existing, ...updates };
  const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(merged));
  await writable.close();
};

// src/diamondcoreprocessor.com/presentation/tiles/tile-actions.drone.ts
var NOTE_ACCENT = 16769354;
var svg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
var ICONS = {
  // Terminal prompt >_
  command: svg('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>'),
  // Pencil
  edit: svg('<path d="M17 3l4 4L7 21H3v-4L17 3z"/>'),
  // Magnifying glass
  search: svg('<circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/>'),
  // Eye with slash
  hide: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/><line x1="4" y1="4" x2="20" y2="20"/>'),
  // Break apart — four fragments separating
  breakApart: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  // Plus
  adopt: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  // Circle with slash
  block: svg('<circle cx="12" cy="12" r="9"/><line x1="5.7" y1="5.7" x2="18.3" y2="18.3"/>'),
  // Trash bin
  remove: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  // Refresh / reroll — two curved arrows
  reroll: svg('<path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10"/><path d="M3.51 15A9 9 0 0 0 18.36 18.36L23 14"/>'),
  // Sticky note — small page with a folded corner
  note: svg('<path d="M4 4h12l4 4v12H4z"/><polyline points="16 4 16 8 20 8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="14" y2="16"/>')
};
var ICON_REGISTRY = [
  // ── private profile ──
  { name: "command", svgMarkup: ICONS.command, hoverTint: 11075544, profile: "private", labelKey: "action.command", descriptionKey: "action.command.description" },
  { name: "edit", svgMarkup: ICONS.edit, hoverTint: 13162751, profile: "private", labelKey: "action.edit", descriptionKey: "action.edit.description" },
  { name: "note", svgMarkup: ICONS.note, hoverTint: NOTE_ACCENT, profile: "private", tintWhen: (ctx) => ctx.hasNotes ? NOTE_ACCENT : null, labelKey: "action.note", descriptionKey: "action.note.description" },
  { name: "search", svgMarkup: ICONS.search, hoverTint: 13172680, profile: "private", visibleWhen: (ctx) => ctx.noImage, labelKey: "action.search", descriptionKey: "action.search.description" },
  { name: "reroll", svgMarkup: ICONS.reroll, hoverTint: 14207231, profile: "private", visibleWhen: (ctx) => ctx.hasSubstrate, labelKey: "action.reroll", descriptionKey: "action.reroll.description" },
  { name: "remove", svgMarkup: ICONS.remove, hoverTint: 16763080, profile: "private", labelKey: "action.remove", descriptionKey: "action.remove.description" },
  { name: "break-apart", svgMarkup: ICONS.breakApart, hoverTint: 6737151, profile: "private", visibleWhen: (ctx) => ctx.isHidden, labelKey: "action.break-apart", descriptionKey: "action.break-apart.description" },
  // ── public-own profile ──
  { name: "hide", svgMarkup: ICONS.hide, hoverTint: 16767144, profile: "public-own", visibleWhen: (ctx) => !ctx.isHidden, labelKey: "action.hide", descriptionKey: "action.hide.description" },
  { name: "break-apart", svgMarkup: ICONS.breakApart, hoverTint: 6737151, profile: "public-own", visibleWhen: (ctx) => ctx.isHidden, labelKey: "action.break-apart", descriptionKey: "action.break-apart.description" },
  // ── public-external profile ──
  { name: "adopt", svgMarkup: ICONS.adopt, hoverTint: 11075544, profile: "public-external", labelKey: "action.adopt", descriptionKey: "action.adopt.description" },
  { name: "block", svgMarkup: ICONS.block, hoverTint: 16763080, profile: "public-external", labelKey: "action.block", descriptionKey: "action.block.description" }
];
var DEFAULT_ACTIVE = {
  "private": ["command", "edit", "note", "reroll", "remove", "break-apart"],
  "public-own": ["hide", "break-apart"],
  "public-external": ["adopt", "block"]
};
var ICON_Y = 10;
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
  const startX = Math.round(-(count - 1) * spacing / 2);
  return activeNames.map((_, i) => ({ x: Math.round(startX + i * spacing), y: ICON_Y }));
}
var ARRANGEMENT_KEY = "iconArrangement";
var HANDLED_ACTIONS = /* @__PURE__ */ new Set(["edit", "search", "command", "note", "hide", "break-apart", "adopt", "block", "remove", "reroll"]);
var TileActionsDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "registers default tile overlay icons and handles their click actions";
  deps = {
    lineage: "@hypercomb.social/Lineage"
  };
  listens = ["render:host-ready", "render:cell-count", "tile:action", "controls:action", "overlay:icons-reordered", "overlay:arrange-mode", "substrate:applied", "substrate:rerolled", "cell:removed"];
  emits = ["overlay:register-action", "overlay:pool-icons", "search:prefill", "command:focus", "note:capture", "tile:hidden", "tile:unhidden", "tile:blocked", "cell:removed", "visibility:show-hidden", "substrate:rerolled"];
  #registered = false;
  #effectsRegistered = false;
  #arrangement = {};
  #substrateLabels = /* @__PURE__ */ new Set();
  heartbeat = async () => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true;
      this.onEffect("render:host-ready", () => {
        if (this.#registered) return;
        this.#registered = true;
        void this.#loadArrangementAndRegister();
      });
      this.onEffect("render:cell-count", (payload) => {
        this.#substrateLabels = new Set(payload.substrateLabels ?? []);
      });
      this.onEffect("substrate:applied", ({ cell }) => {
        if (cell) this.#substrateLabels.add(cell);
      });
      this.onEffect("cell:removed", ({ cell }) => {
        if (cell) this.#substrateLabels.delete(cell);
      });
      this.onEffect("tile:action", (payload) => {
        if (!HANDLED_ACTIONS.has(payload.action)) return;
        this.#handleAction(payload);
      });
      this.onEffect("controls:action", (payload) => {
        if (payload?.action === "hide") this.#bulkHideSelected();
        else if (payload?.action === "reroll") this.#bulkRerollSelected();
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
        const props = await readCellProperties(rootDir);
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
          owner: this.iocKey,
          svgMarkup: entry.svgMarkup,
          hoverTint: entry.hoverTint,
          profile: entry.profile,
          visibleWhen: entry.visibleWhen,
          tintWhen: entry.tintWhen,
          labelKey: entry.labelKey,
          descriptionKey: entry.descriptionKey,
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
        owner: this.iocKey,
        svgMarkup: entry.svgMarkup,
        hoverTint: entry.hoverTint,
        profile: entry.profile,
        visibleWhen: entry.visibleWhen,
        labelKey: entry.labelKey,
        descriptionKey: entry.descriptionKey,
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
        await writeCellProperties(rootDir, { [ARRANGEMENT_KEY]: this.#arrangement });
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
    const label = normalizeCell(rawLabel) || rawLabel;
    switch (action) {
      case "edit":
        break;
      case "search":
        EffectBus.emit("search:prefill", { value: label });
        break;
      case "command":
        EffectBus.emit("command:focus", { cell: label });
        break;
      case "note": {
        const selection = window.ioc?.get?.("@diamondcoreprocessor.com/SelectionService");
        selection?.setActive?.(label);
        EffectBus.emit("note:capture", { cellLabel: label });
        break;
      }
      case "hide":
        this.#hideOrBlock(label, "hc:hidden-tiles", "tile:hidden");
        break;
      case "break-apart":
        this.#unhide(label);
        break;
      case "adopt":
        EffectBus.emit("cell:added", { cell: label });
        void new hypercomb().act();
        break;
      case "block":
        this.#hideOrBlock(label, "hc:blocked-tiles", "tile:blocked");
        break;
      case "reroll":
        void this.#rerollSubstrate(label);
        break;
      case "remove":
        void this.#removeTile(label);
        break;
    }
  }
  async #removeTile(label) {
    const lineage = this.resolve("lineage");
    if (!lineage) return;
    const dir = await lineage.explorerDir();
    if (!dir) return;
    try {
      await dir.removeEntry(label, { recursive: true });
      EffectBus.emit("cell:removed", { cell: label });
    } catch {
    }
    void new hypercomb().act();
  }
  async #rerollSubstrate(label) {
    const svc = window.ioc?.get?.("@diamondcoreprocessor.com/SubstrateService");
    if (svc?.rerollCell(label)) {
      EffectBus.emit("substrate:rerolled", { cell: label });
      void new hypercomb().act();
    }
  }
  #bulkRerollSelected() {
    const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
    if (!selection || selection.count === 0) return;
    const svc = window.ioc?.get?.("@diamondcoreprocessor.com/SubstrateService");
    if (!svc) return;
    const labels = [...selection.selected].filter((l) => this.#substrateLabels.has(l));
    if (labels.length === 0) return;
    const rerolled = svc.rerollCells(labels);
    if (rerolled.length === 0) return;
    for (const cell of rerolled) {
      EffectBus.emit("substrate:rerolled", { cell });
    }
    void new hypercomb().act();
  }
  #unhide(label) {
    const lineage = this.resolve("lineage");
    const location = lineage?.explorerLabel() ?? "/";
    const key = `hc:hidden-tiles:${location}`;
    const existing = JSON.parse(localStorage.getItem(key) ?? "[]");
    const updated = existing.filter((l) => l !== label);
    localStorage.setItem(key, JSON.stringify(updated));
    EffectBus.emit("tile:unhidden", { cell: label, location });
    void new hypercomb().act();
  }
  #bulkHideSelected() {
    const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
    if (!selection || selection.count === 0) return;
    const lineage = this.resolve("lineage");
    const location = lineage?.explorerLabel() ?? "/";
    const key = `hc:hidden-tiles:${location}`;
    const hidden = JSON.parse(localStorage.getItem(key) ?? "[]");
    const hiddenSet = new Set(hidden);
    const labels = [...selection.selected];
    const allHidden = labels.every((l) => hiddenSet.has(l));
    if (allHidden) {
      const removeSet = new Set(labels);
      localStorage.setItem(key, JSON.stringify(hidden.filter((l) => !removeSet.has(l))));
      for (const label of labels) EffectBus.emit("tile:unhidden", { cell: label, location });
      EffectBus.emit("visibility:show-hidden", { active: localStorage.getItem("hc:show-hidden") === "1" });
    } else {
      for (const label of labels) if (!hiddenSet.has(label)) hidden.push(label);
      localStorage.setItem(key, JSON.stringify(hidden));
      for (const label of labels) EffectBus.emit("tile:hidden", { cell: label, location });
      localStorage.setItem("hc:show-hidden", "1");
      EffectBus.emit("visibility:show-hidden", { active: true });
    }
    selection.clear();
    void new hypercomb().act();
  }
  #hideOrBlock(label, storagePrefix, effect) {
    const lineage = this.resolve("lineage");
    const location = lineage?.explorerLabel() ?? "/";
    const key = `${storagePrefix}:${location}`;
    const existing = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!existing.includes(label)) existing.push(label);
    localStorage.setItem(key, JSON.stringify(existing));
    EffectBus.emit(effect, { cell: label, location });
    void new hypercomb().act();
  }
};
var _tileActions = new TileActionsDrone();
window.ioc.register("@diamondcoreprocessor.com/TileActionsDrone", _tileActions);

// src/diamondcoreprocessor.com/presentation/tiles/tile-overlay.drone.ts
var DEFAULT_ICON_SIZE = 7;
var POOL_Y_OFFSET = 16;
var POOL_ICON_SIZE = 5;
var POOL_SPACING = 8;
var POOL_BG_PADDING = 2;
var POOL_BG_COLOR = 2236996;
var POOL_BG_ALPHA = 0.6;
var WIGGLE_SPEED = 4;
var WIGGLE_AMPLITUDE = 0.06;
var DRAG_ALPHA = 0.6;
var HINT_DELAY_MS = 1500;
var HINT_Y_OFFSET = 22;
var HINT_FONT_SIZE = 6;
var HINT_COLOR = 11583712;
var HINT_EXPANDED_FONT_SIZE = 5.5;
var HINT_MAX_WIDTH = 60;
var TileOverlayDrone = class _TileOverlayDrone extends Drone2 {
  namespace = "diamondcoreprocessor.com";
  description = "contextual action overlay host \u2014 icons registered externally via effects";
  #app = null;
  #renderContainer = null;
  #canvas = null;
  #renderer = null;
  #overlay = null;
  #hexBg = null;
  #buttonTray = null;
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
  #substrateLabels = /* @__PURE__ */ new Set();
  #linkLabels = /* @__PURE__ */ new Set();
  #hiddenLabels = /* @__PURE__ */ new Set();
  #labelsWithNotes = /* @__PURE__ */ new Set();
  // break-apart effect state
  #crackOverlay = null;
  #shatterContainer = null;
  #shatterAnimating = false;
  #navigationBlocked = false;
  #navigationGuardTimer = null;
  /** Tracks the pointerId that triggered a pointerdown-navigation, so the trailing pointerup + click can be suppressed. */
  #consumedPointerId = null;
  #meshPublic = false;
  #editing = false;
  #editCooldown = false;
  #hasSelection = false;
  #touchDragging = false;
  /** Registered descriptors from provider bees, keyed by name */
  #registeredDescriptors = /* @__PURE__ */ new Map();
  /** Genotype visibility — missing key means visible (default-on) */
  #genotypeVisible = /* @__PURE__ */ new Map();
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
  // ── Action hint state ──────────────────────────────────────────
  #hintText = null;
  #hintDescriptionText = null;
  #hintTimer = null;
  #hintActionName = null;
  #hintExpanded = false;
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
    "overlay:pool-icons",
    "bee:disposed",
    "genotype:set-visible",
    "substrate:applied",
    "cell:removed"
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
        for (const desc of descs) {
          this.#registeredDescriptors.set(desc.name, desc);
          if (desc.genotype && !this.#genotypeVisible.has(desc.genotype)) {
            const stored = localStorage.getItem(`hc:genotype:${desc.genotype}`);
            if (stored !== null) this.#genotypeVisible.set(desc.genotype, stored === "true");
          }
        }
        for (const desc of descs) {
          if (!this.#activeOrder.has(desc.profile)) this.#activeOrder.set(desc.profile, []);
          const order = this.#activeOrder.get(desc.profile);
          if (!order.includes(desc.name)) {
            const removeIdx = order.indexOf("remove");
            if (desc.name !== "remove" && removeIdx >= 0) {
              order.splice(removeIdx, 0, desc.name);
            } else {
              order.push(desc.name);
            }
          }
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
      this.onEffect("bee:disposed", ({ iocKey }) => {
        let changed = false;
        for (const [name, desc] of this.#registeredDescriptors) {
          if (desc.owner !== iocKey) continue;
          const order = this.#activeOrder.get(desc.profile);
          if (order) {
            const idx = order.indexOf(name);
            if (idx >= 0) order.splice(idx, 1);
          }
          this.#registeredDescriptors.delete(name);
          changed = true;
        }
        if (changed) this.#rebuildActiveProfile();
      });
      this.onEffect("genotype:set-visible", ({ genotype, visible }) => {
        this.#genotypeVisible.set(genotype, visible);
        localStorage.setItem(`hc:genotype:${genotype}`, String(visible));
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
        this.#substrateLabels = new Set(payload.substrateLabels ?? []);
        this.#linkLabels = new Set(payload.linkLabels ?? []);
        this.#hiddenLabels = new Set(payload.hiddenLabels ?? []);
        this.#rebuildOccupiedMap();
        if (this.#overlay && this.#currentAxial) {
          this.#currentIndex = this.#lookupIndex(this.#currentAxial.q, this.#currentAxial.r);
          this.#updateVisibility();
          this.#updatePerTileVisibility();
        }
      });
      this.onEffect("substrate:applied", ({ cell }) => {
        if (!cell) return;
        this.#substrateLabels.add(cell);
        this.#noImageLabels.delete(cell);
        if (this.#overlay && this.#currentAxial) this.#updatePerTileVisibility();
      });
      this.onEffect("cell:removed", ({ cell }) => {
        if (!cell) return;
        this.#substrateLabels.delete(cell);
        this.#noImageLabels.delete(cell);
        this.#labelsWithNotes.delete(cell);
      });
      this.#seedNotesLabels();
      this.onEffect("notes:changed", ({ cellLabel, count }) => {
        if (!cellLabel) return;
        if (count > 0) this.#labelsWithNotes.add(cellLabel);
        else this.#labelsWithNotes.delete(cellLabel);
        if (this.#overlay && this.#currentAxial) this.#updatePerTileVisibility();
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
        this.#consumedPointerId = null;
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
        this.#updatePerTileVisibility();
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
    this.#clearHint();
    if (this.#arrangeMode) this.#exitArrangeMode();
    if (this.#listening) {
      document.removeEventListener("pointerdown", this.#onPointerDown);
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
      this.#buttonTray = null;
      this.#crackOverlay = null;
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
    this.#buttonTray = new Graphics2();
    this.#buttonTray.visible = false;
    this.#overlay.addChild(this.#buttonTray);
    this.#crackOverlay = new Graphics2();
    this.#crackOverlay.visible = false;
    this.#crackOverlay.zIndex = 100;
    this.#overlay.addChild(this.#crackOverlay);
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
  /**
   * Read the persisted notes index once at startup so the active-tint state
   * is correct on first render. After this, `notes:changed` keeps it fresh.
   */
  #seedNotesLabels() {
    try {
      const raw = localStorage.getItem("hc:notes-index");
      if (!raw) return;
      const index = JSON.parse(raw);
      for (const cell of Object.keys(index)) {
        if (index[cell]) this.#labelsWithNotes.add(cell);
      }
    } catch {
    }
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
    const descs = [...this.#registeredDescriptors.values()].filter((d) => d.profile === key).filter((d) => !d.genotype || this.#genotypeVisible.get(d.genotype) !== false).sort((a, b) => (a.name === "remove" ? 1 : 0) - (b.name === "remove" ? 1 : 0));
    for (const desc of descs) {
      const btn = new HexIconButton({
        size: DEFAULT_ICON_SIZE,
        hoverTint: desc.hoverTint
      });
      this.#overlay.addChild(btn);
      void btn.load(desc.svgMarkup);
      this.#actions.push({
        name: desc.name,
        button: btn,
        profile: desc.profile,
        genotype: desc.genotype,
        visibleWhen: desc.visibleWhen,
        tintWhen: desc.tintWhen,
        labelKey: desc.labelKey,
        descriptionKey: desc.descriptionKey
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
    const startX = Math.round(-(count - 1) * spacing / 2);
    for (let i = 0; i < count; i++) {
      visible[i].button.position.set(Math.round(startX + i * spacing), ICON_Y);
    }
    this.#drawButtonTray(count, spacing);
  }
  #drawButtonTray(iconCount, spacing) {
    if (!this.#buttonTray) return;
    this.#buttonTray.clear();
    const halfIcon = DEFAULT_ICON_SIZE / 2;
    const pad = 3;
    const totalWidth = (iconCount - 1) * spacing + DEFAULT_ICON_SIZE + pad * 2;
    const trayHeight = DEFAULT_ICON_SIZE + pad * 2;
    const x = -(totalWidth / 2);
    const y = ICON_Y - halfIcon - pad;
    this.#buttonTray.roundRect(x, y, totalWidth, trayHeight, 2);
    this.#buttonTray.fill({ color: 789530, alpha: 0.6 });
  }
  // ── Per-tile icon visibility ───────────────────────────────────────
  #updatePerTileVisibility() {
    if (!this.#currentAxial) return;
    if (this.#dropDragging || this.#dropPending) {
      for (const action of this.#actions) action.button.visible = false;
      if (this.#buttonTray) this.#buttonTray.visible = false;
      return;
    }
    if (this.#meshPublic && !this.#hasSelection) {
      for (const action of this.#actions) action.button.visible = false;
      if (this.#buttonTray) this.#buttonTray.visible = false;
      return;
    }
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
      noImage: this.#noImageLabels.has(entry.label),
      hasSubstrate: this.#substrateLabels.has(entry.label),
      isBranch: this.#branchLabels.has(entry.label),
      hasLink: this.#linkLabels.has(entry.label),
      isHidden: this.#hiddenLabels.has(entry.label),
      hasNotes: this.#labelsWithNotes.has(entry.label)
    };
    for (const action of this.#actions) {
      if (action.visibleWhen) {
        action.button.visible = action.visibleWhen(ctx);
      } else {
        action.button.visible = true;
      }
      const tint = action.tintWhen ? action.tintWhen(ctx) : null;
      action.button.setNormalTint(tint ?? null);
    }
    if (this.#buttonTray) {
      this.#buttonTray.visible = true;
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
        this.#updateCellLabel(coord.q, coord.r);
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
    this.#poolBackground = new Graphics2();
    this.#poolContainer.addChild(this.#poolBackground);
    this.#requestPoolRebuild();
  }
  #destroyPoolContainer() {
    if (!this.#poolContainer) return;
    this.#poolContainer.destroy({ children: true });
    this.#poolIcons = [];
    this.#poolBackground = null;
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
        size: POOL_ICON_SIZE,
        hoverTint: entry.hoverTint
      });
      btn.position.set(startX + i * POOL_SPACING, 0);
      btn.alpha = 0.5;
      this.#poolContainer.addChild(btn);
      void btn.load(entry.svgMarkup);
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
    document.addEventListener("pointerdown", this.#onPointerDown);
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
      this.#updateCellLabel(axial.q, axial.r);
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
      this.#clearHint();
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
      this.#updateCellLabel(axial.q, axial.r);
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
      this.#clearHint();
      return;
    }
    const ox = this.#overlay.position.x;
    const oy = this.#overlay.position.y;
    let hoveredName = null;
    for (const a of this.#actions) {
      const btn = a.button;
      const bx = local.x - ox - btn.position.x;
      const by = local.y - oy - btn.position.y;
      const isHovered = btn.containsPoint(bx, by);
      btn.hovered = isHovered;
      if (isHovered) hoveredName = a.name;
    }
    if (this.#crackOverlay) {
      if (hoveredName === "break-apart") {
        this.#showCrackPreview();
      } else {
        this.#crackOverlay.visible = false;
      }
    }
    if (hoveredName !== this.#hintActionName) {
      this.#clearHint();
      if (hoveredName) {
        this.#hintActionName = hoveredName;
        this.#hintTimer = setTimeout(() => this.#showHint(hoveredName), HINT_DELAY_MS);
      }
    }
  }
  // ── Action hint display ─────────────────────────────────────────────
  #resolveI18n() {
    return window.ioc.get(I18N_IOC_KEY) ?? void 0;
  }
  #showHint(actionName) {
    if (!this.#overlay) return;
    const action = this.#actions.find((a) => a.name === actionName && a.button.hovered);
    if (!action?.labelKey) return;
    const i18n = this.#resolveI18n();
    const label = i18n?.t(action.labelKey) ?? action.name;
    this.#clearHintText();
    const hcFont = getComputedStyle(document.documentElement).getPropertyValue("--hc-font").trim();
    this.#hintText = new Text({
      text: label,
      style: new TextStyle({
        fontFamily: hcFont || "'Source Sans Pro Light', system-ui, sans-serif",
        fontSize: HINT_FONT_SIZE,
        fill: HINT_COLOR,
        align: "center"
      })
    });
    this.#hintText.anchor.set(0.5, 0);
    this.#hintText.position.set(action.button.position.x, HINT_Y_OFFSET);
    this.#hintText.alpha = 0.85;
    this.#overlay.addChild(this.#hintText);
    this.#hintExpanded = false;
  }
  #expandHint() {
    if (!this.#overlay || !this.#hintActionName || this.#hintExpanded) return;
    const action = this.#actions.find((a) => a.name === this.#hintActionName);
    if (!action?.descriptionKey) return;
    const i18n = this.#resolveI18n();
    const description = i18n?.t(action.descriptionKey) ?? "";
    if (!description) return;
    const hcFont = getComputedStyle(document.documentElement).getPropertyValue("--hc-font").trim();
    this.#hintDescriptionText = new Text({
      text: description,
      style: new TextStyle({
        fontFamily: hcFont || "'Source Sans Pro Light', system-ui, sans-serif",
        fontSize: HINT_EXPANDED_FONT_SIZE,
        fill: HINT_COLOR,
        align: "center",
        wordWrap: true,
        wordWrapWidth: HINT_MAX_WIDTH
      })
    });
    this.#hintDescriptionText.anchor.set(0.5, 0);
    const yBelow = HINT_Y_OFFSET + (this.#hintText ? this.#hintText.height + 2 : HINT_FONT_SIZE + 2);
    this.#hintDescriptionText.position.set(0, yBelow);
    this.#hintDescriptionText.alpha = 0.7;
    this.#overlay.addChild(this.#hintDescriptionText);
    this.#hintExpanded = true;
  }
  #clearHint() {
    if (this.#hintTimer) {
      clearTimeout(this.#hintTimer);
      this.#hintTimer = null;
    }
    this.#hintActionName = null;
    this.#hintExpanded = false;
    this.#clearHintText();
  }
  #clearHintText() {
    if (this.#hintText) {
      this.#hintText.destroy();
      this.#hintText = null;
    }
    if (this.#hintDescriptionText) {
      this.#hintDescriptionText.destroy();
      this.#hintDescriptionText = null;
    }
  }
  // ── Instant branch navigation on pointerdown ────────────────────────
  #onPointerDown = (e) => {
    if (e.button === 2) {
      if (this.#arrangeMode) return;
      if (this.#navigationBlocked) return;
      if (this.#editing || this.#editCooldown) return;
      if (e.ctrlKey || e.metaKey) return;
      if (!this.#canvas || e.target !== this.#canvas) return;
      const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
      if (selection && selection.count > 0) return;
      const gate = window.ioc.get("@diamondcoreprocessor.com/InputGate");
      if (gate?.active) return;
      this.#consumedPointerId = e.pointerId;
      consumePointerGesture(e.pointerId);
      this.#navigateBack();
      return;
    }
    if (e.button !== 0) return;
    if (this.#arrangeMode) return;
    if (this.#navigationBlocked) return;
    if (this.#editing || this.#editCooldown) return;
    if (this.#hasSelection) return;
    if (this.#touchDragging) return;
    if (e.ctrlKey || e.metaKey) return;
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return;
    if (e.target !== this.#canvas) return;
    const detector = this.resolve("detector");
    if (!detector) return;
    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY);
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y));
    const meshLocalX = local.x - this.#meshOffset.x;
    const meshLocalY = local.y - this.#meshOffset.y;
    const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat);
    const entry = this.#occupiedByAxial.get(_TileOverlayDrone.axialKey(axial.q, axial.r));
    if (!entry?.label) return;
    if (!this.#branchLabels.has(entry.label)) return;
    if (this.#overlay?.visible) {
      const ox = this.#overlay.position.x;
      const oy = this.#overlay.position.y;
      for (const action of this.#actions) {
        if (!action.button.visible) continue;
        const btn = action.button;
        const bx = local.x - ox - btn.position.x;
        const by = local.y - oy - btn.position.y;
        if (btn.containsPoint(bx, by)) return;
      }
    }
    this.#consumedPointerId = e.pointerId;
    consumePointerGesture(e.pointerId);
    this.#navigateInto(entry.label);
  };
  #onClick = (e) => {
    if (this.#consumedPointerId !== null) {
      this.#consumedPointerId = null;
      return;
    }
    if (this.#arrangeMode) return;
    if (this.#navigationBlocked) return;
    if (this.#editing || this.#editCooldown) return;
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return;
    if (e.target !== this.#canvas) return;
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
    if (this.#currentIndex === void 0 || this.#currentAxial === null) {
      const detector = this.resolve("detector");
      if (!detector) return;
      const pixiGlobal2 = this.#clientToPixiGlobal(e.clientX, e.clientY);
      const local2 = this.#renderContainer.toLocal(new Point(pixiGlobal2.x, pixiGlobal2.y));
      const meshLocalX = local2.x - this.#meshOffset.x;
      const meshLocalY = local2.y - this.#meshOffset.y;
      const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat);
      this.#currentAxial = axial;
      this.#currentIndex = this.#lookupIndex(axial.q, axial.r);
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
          if (this.#hintText && !this.#hintExpanded && this.#hintActionName === action.name) {
            this.#expandHint();
            return;
          }
          this.#clearHint();
          if (action.name === "break-apart") {
            this.playShatterAnimation(
              this.#currentAxial.q,
              this.#currentAxial.r,
              entry.label
            );
            return;
          }
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
    if (this.#consumedPointerId === e.pointerId) return;
    if (e.button !== 2) return;
    if (!this.#editing) return;
    const drone = window.ioc.get("@diamondcoreprocessor.com/TileEditorDrone");
    drone?.cancelEditing();
  };
  #onContextMenu = (e) => {
    if (e.target === this.#canvas) e.preventDefault();
  };
  // ── Navigation ─────────────────────────────────────────────────────
  #navigateInto(label) {
    const lineage = this.resolve("lineage");
    if (!lineage) return;
    this.#clearSelectionOnNavigate();
    this.emitEffect("tile:navigate-in", { label });
    lineage.explorerEnter(label);
  }
  #navigateBack() {
    const lineage = this.resolve("lineage");
    if (!lineage) return;
    this.#clearSelectionOnNavigate();
    this.emitEffect("tile:navigate-back", {});
    lineage.explorerUp();
  }
  #clearSelectionOnNavigate() {
    const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
    if (selection && selection.count > 0) selection.clear();
    const pixi = window.ioc.get("@diamondcoreprocessor.com/TileSelectionDrone");
    if (pixi && pixi.selectedAxialKeys.size > 0) pixi.clearSelection();
  }
  // ── Helpers ────────────────────────────────────────────────────────
  #updateCellLabel(_q, _r) {
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
    if (this.#meshPublic && !this.#hasSelection) {
      this.#overlay.visible = false;
      if (this.#hexBg) this.#hexBg.hide();
      for (const action of this.#actions) action.button.visible = false;
      if (this.#crackOverlay) this.#crackOverlay.visible = false;
      return;
    }
    const shouldShow = occupied && !this.#editing && !this.#editCooldown && !this.#touchDragging;
    if (this.#hasSelection) {
      this.#overlay.visible = occupied && !this.#editing && !this.#editCooldown;
      if (this.#hexBg) this.#hexBg.hide();
      return;
    }
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
  // ── Break-apart: crack preview + shatter animation ─────────────────
  #showCrackPreview() {
    const g = this.#crackOverlay;
    if (!g || g.visible) return;
    g.clear();
    const R = this.#geo.circumRadiusPx;
    const cx = (Math.random() - 0.5) * R * 0.3;
    const cy = (Math.random() - 0.5) * R * 0.3;
    const cracks = 5;
    for (let i = 0; i < cracks; i++) {
      const angle = i / cracks * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const len = R * (0.5 + Math.random() * 0.4);
      const midAngle = angle + (Math.random() - 0.5) * 0.3;
      const midLen = len * (0.3 + Math.random() * 0.3);
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(midAngle) * midLen, cy + Math.sin(midAngle) * midLen);
      g.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
      g.stroke({ width: 0.8, color: 16777215, alpha: 0.5 });
      if (Math.random() > 0.4) {
        const bAngle = midAngle + (Math.random() > 0.5 ? 0.7 : -0.7);
        const bLen = len * 0.25;
        const mx = cx + Math.cos(midAngle) * midLen;
        const my = cy + Math.sin(midAngle) * midLen;
        g.moveTo(mx, my);
        g.lineTo(mx + Math.cos(bAngle) * bLen, my + Math.sin(bAngle) * bLen);
        g.stroke({ width: 0.5, color: 16777215, alpha: 0.35 });
      }
    }
    g.visible = true;
  }
  /** Run the shatter animation then emit the action. */
  playShatterAnimation(q, r, label) {
    if (this.#shatterAnimating || !this.#renderContainer || !this.#app) return;
    this.#shatterAnimating = true;
    const R = this.#geo.circumRadiusPx;
    const px = this.#axialToPixel(q, r);
    const ox = px.x + this.#meshOffset.x;
    const oy = px.y + this.#meshOffset.y;
    if (this.#overlay) this.#overlay.visible = false;
    if (this.#crackOverlay) this.#crackOverlay.visible = false;
    const container = new Container3();
    container.position.set(ox, oy);
    container.zIndex = 10001;
    this.#renderContainer.addChild(container);
    this.#shatterContainer = container;
    const fragments = [];
    const wedges = 6;
    for (let i = 0; i < wedges; i++) {
      const a1 = i / wedges * Math.PI * 2 - Math.PI / 2;
      const a2 = (i + 1) / wedges * Math.PI * 2 - Math.PI / 2;
      const g = new Graphics2();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
      g.lineTo(Math.cos(a2) * R, Math.sin(a2) * R);
      g.closePath();
      g.fill({ color: 4478310, alpha: 0.6 });
      g.stroke({ width: 0.5, color: 8956620, alpha: 0.4 });
      container.addChild(g);
      const midAngle = (a1 + a2) / 2;
      fragments.push({
        g,
        angle: midAngle,
        speed: 0.8 + Math.random() * 0.6,
        spin: (Math.random() - 0.5) * 4
      });
    }
    const duration = 500;
    const startTime = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      for (const frag of fragments) {
        const dist = ease * R * 1.8 * frag.speed;
        frag.g.position.set(
          Math.cos(frag.angle) * dist,
          Math.sin(frag.angle) * dist
        );
        frag.g.rotation = ease * frag.spin;
        frag.g.alpha = 1 - ease;
        frag.g.scale.set(1 - ease * 0.3);
      }
      if (t >= 1) {
        this.#app.ticker.remove(tick);
        this.#renderContainer.removeChild(container);
        container.destroy({ children: true });
        this.#shatterContainer = null;
        this.#shatterAnimating = false;
        this.emitEffect("tile:action", {
          action: "break-apart",
          q,
          r,
          index: this.#lookupIndex(q, r) ?? 0,
          label
        });
      }
    };
    this.#app.ticker.add(tick);
  }
};
var _tileOverlay = new TileOverlayDrone();
window.ioc.register("@diamondcoreprocessor.com/TileOverlayDrone", _tileOverlay);
export {
  TileOverlayDrone
};
