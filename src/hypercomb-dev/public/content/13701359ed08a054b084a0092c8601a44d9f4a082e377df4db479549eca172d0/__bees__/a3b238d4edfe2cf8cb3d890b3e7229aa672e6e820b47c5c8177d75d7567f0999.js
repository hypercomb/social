// src/diamondcoreprocessor.com/presentation/tiles/tile-selection.drone.ts
import { Drone } from "@hypercomb/core";
import { Graphics, Point } from "pixi.js";

// src/diamondcoreprocessor.com/presentation/grid/hex-geometry.ts
function createHexGeometry(circumRadiusPx, gapPx, padPx = 10) {
  return { circumRadiusPx, gapPx, padPx, spacing: circumRadiusPx + gapPx };
}
var DEFAULT_HEX_GEOMETRY = createHexGeometry(32, 6);

// src/diamondcoreprocessor.com/presentation/tiles/tile-selection.drone.ts
var SELECTION_FILL = 2280550;
var SELECTION_FILL_ALPHA = 0.15;
var SELECTION_STROKE = 2280550;
var SELECTION_STROKE_ALPHA = 0.6;
var LEADER_FILL = 16755200;
var LEADER_FILL_ALPHA = 0.2;
var LEADER_STROKE = 16755200;
var LEADER_STROKE_ALPHA = 0.8;
var STROKE_WIDTH = 1;
var TileSelectionDrone = class _TileSelectionDrone extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "tile selection with leader tile and relative axial math";
  #app = null;
  #renderContainer = null;
  #canvas = null;
  #renderer = null;
  #layer = null;
  #meshOffset = { x: 0, y: 0 };
  #geo = DEFAULT_HEX_GEOMETRY;
  #cellCount = 0;
  #cellLabels = [];
  #occupiedByAxial = /* @__PURE__ */ new Map();
  // ── selection state ───────────────────────────────────────────
  #selected = /* @__PURE__ */ new Set();
  // axial keys "q,r"
  #leaderKey = null;
  // axial key of the leader tile
  // ── drag state ────────────────────────────────────────────────
  #dragActive = false;
  #dragOp = null;
  #touched = /* @__PURE__ */ new Set();
  #lastDragAxial = null;
  #gate = null;
  #listening = false;
  #effectsRegistered = false;
  // hex orientation
  #flat = false;
  deps = {
    detector: "@diamondcoreprocessor.com/HexDetector",
    axial: "@diamondcoreprocessor.com/AxialService",
    selection: "@diamondcoreprocessor.com/SelectionService"
  };
  listens = ["render:host-ready", "render:mesh-offset", "render:cell-count", "render:set-orientation", "render:geometry-changed", "keymap:invoke", "selection:changed"];
  emits = ["selection:changed"];
  // flag to prevent feedback loops: this drone emits selection:changed and also listens to it
  #syncing = false;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("render:host-ready", (payload) => {
      this.#app = payload.app;
      this.#renderContainer = payload.container;
      this.#canvas = payload.canvas;
      this.#renderer = payload.renderer;
      this.#gate = window.ioc.get("@diamondcoreprocessor.com/InputGate") ?? null;
      this.#initLayer();
      this.#attachListeners();
    });
    this.onEffect("render:mesh-offset", (offset) => {
      this.#meshOffset = offset;
      this.#redraw();
    });
    this.onEffect("render:cell-count", (payload) => {
      this.#cellCount = payload.count;
      this.#cellLabels = payload.labels;
      this.#rebuildOccupiedMap();
      this.#pruneStaleSelections();
      this.#redraw();
    });
    this.onEffect("render:set-orientation", (payload) => {
      this.#flat = payload.flat;
      this.#redraw();
    });
    this.onEffect("render:geometry-changed", (geo) => {
      this.#geo = geo;
      this.#redraw();
    });
    this.onEffect("keymap:invoke", ({ cmd }) => {
      if (cmd in ARROW_OFFSETS) {
        this.#handleArrowNav(cmd);
        return;
      }
    });
    this.onEffect("selection:changed", (payload) => {
      if (this.#syncing) return;
      if (!Array.isArray(payload?.["selected"])) return;
      const targetLabels = new Set(payload["selected"]);
      const targetKeys = /* @__PURE__ */ new Set();
      for (const [key, entry] of this.#occupiedByAxial) {
        if (targetLabels.has(entry.label)) targetKeys.add(key);
      }
      if (targetKeys.size === this.#selected.size && [...targetKeys].every((k) => this.#selected.has(k))) return;
      this.#selected.clear();
      for (const k of targetKeys) this.#selected.add(k);
      this.#leaderKey = targetKeys.size > 0 ? [...targetKeys][0] : null;
      this.#syncing = true;
      this.#redraw();
      this.#syncing = false;
    });
  };
  dispose() {
    if (this.#listening) {
      document.removeEventListener("mousedown", this.#onMouseDown);
      document.removeEventListener("mousemove", this.#onMouseMove);
      document.removeEventListener("mouseup", this.#onMouseUp);
      this.#listening = false;
    }
    if (this.#layer) {
      this.#layer.destroy();
      this.#layer = null;
    }
  }
  // ── public API ────────────────────────────────────────────────
  get selectedAxialKeys() {
    return this.#selected;
  }
  get selectedLabels() {
    const out = [];
    for (const key of this.#selected) {
      const entry = this.#occupiedByAxial.get(key);
      if (entry) out.push(entry.label);
    }
    return out;
  }
  /** The leader tile — first tile selected, origin for relative axial math */
  get leader() {
    if (!this.#leaderKey) return null;
    const entry = this.#occupiedByAxial.get(this.#leaderKey);
    if (!entry) return null;
    const [qs, rs] = this.#leaderKey.split(",");
    return { q: Number(qs), r: Number(rs), label: entry.label };
  }
  /**
   * Selected tiles as axial coordinates relative to the leader.
   * dq/dr = tile.q - leader.q, tile.r - leader.r
   * Leader itself has dq=0, dr=0.
   */
  get relativeAxials() {
    const l = this.leader;
    if (!l) return [];
    const out = [];
    for (const key of this.#selected) {
      const entry = this.#occupiedByAxial.get(key);
      if (!entry) continue;
      const [qs, rs] = key.split(",");
      const q = Number(qs);
      const r = Number(rs);
      out.push({ q, r, dq: q - l.q, dr: r - l.r, label: entry.label });
    }
    return out;
  }
  clearSelection() {
    if (this.#selected.size === 0 && !this.#leaderKey) return;
    this.#selected.clear();
    this.#leaderKey = null;
    this.#redraw();
    this.#emitChanged();
    this.#syncSelectionService();
  }
  // ── keyboard navigation ──────────────────────────────────────
  #handleArrowNav(cmd) {
    const offset = ARROW_OFFSETS[cmd];
    if (!offset) return;
    if (!this.#leaderKey) {
      const centerKey = axialKey(0, 0);
      if (this.#occupiedByAxial.has(centerKey)) {
        this.#leaderKey = centerKey;
        this.#selected.clear();
        this.#selected.add(centerKey);
        this.#syncSelectionService(centerKey);
      } else {
        const first = this.#occupiedByAxial.keys().next().value;
        if (!first) return;
        this.#leaderKey = first;
        this.#selected.clear();
        this.#selected.add(first);
        this.#syncSelectionService(first);
      }
      this.#redraw();
      this.#emitChanged();
      return;
    }
    const [qs, rs] = this.#leaderKey.split(",");
    let tq = Number(qs) + offset.dq;
    let tr = Number(rs) + offset.dr;
    while (_TileSelectionDrone.#inBounds(tq, tr)) {
      const targetKey = axialKey(tq, tr);
      if (this.#occupiedByAxial.has(targetKey)) {
        if (this.#selected.has(targetKey)) {
          this.#leaderKey = targetKey;
        } else {
          this.#leaderKey = targetKey;
          this.#selected.clear();
          this.#selected.add(targetKey);
          this.#syncSelectionService(targetKey);
        }
        this.#redraw();
        this.#emitChanged();
        return;
      }
      tq += offset.dq;
      tr += offset.dr;
    }
  }
  static #inBounds(q, r) {
    const s = -q - r;
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= 50;
  }
  #syncSelectionService(_axialKeyStr) {
    const selection = this.resolve("selection");
    if (!selection) return;
    this.#syncing = true;
    selection.clear();
    for (const key of this.#selected) {
      const entry = this.#occupiedByAxial.get(key);
      if (entry) selection.add(entry.label);
    }
    this.#syncing = false;
  }
  // ── layer setup ───────────────────────────────────────────────
  #initLayer() {
    if (!this.#renderContainer || this.#layer) return;
    this.#layer = new Graphics();
    this.#layer.zIndex = 5e3;
    this.#renderContainer.addChild(this.#layer);
    this.#renderContainer.sortableChildren = true;
  }
  // ── listener setup ────────────────────────────────────────────
  #attachListeners() {
    if (this.#listening) return;
    this.#listening = true;
    document.addEventListener("mousedown", this.#onMouseDown);
    document.addEventListener("mousemove", this.#onMouseMove);
    document.addEventListener("mouseup", this.#onMouseUp);
  }
  // ── mouse handlers ────────────────────────────────────────────
  #onMouseDown = (e) => {
    if (e.button !== 0) return;
    if (!e.ctrlKey && !e.metaKey) return;
    if (!this.#canvas) return;
    if (this.#isInteractiveTarget(e.target)) return;
    const rect = this.#canvas.getBoundingClientRect();
    if (!this.#isInsideRect(e.clientX, e.clientY, rect)) return;
    const axial = this.#clientToAxial(e.clientX, e.clientY);
    if (!axial) return;
    const key = axialKey(axial.q, axial.r);
    const isOccupied = this.#occupiedByAxial.has(key);
    if (!this.#gate?.claim("tile-selection")) return;
    this.#dragActive = true;
    this.#touched.clear();
    this.#lastDragAxial = axial;
    if (isOccupied) {
      const isSelected = this.#selected.has(key);
      if (isSelected && this.#selected.size > 1) {
        this.#leaderKey = key;
        this.#dragOp = null;
        this.#redraw();
        this.#emitChanged();
      } else {
        this.#dragOp = isSelected ? "remove" : "add";
        this.#applyOp(key);
      }
    } else {
      this.#dragOp = "add";
    }
    e.preventDefault();
    e.stopPropagation();
  };
  #onMouseMove = (e) => {
    if (!this.#dragActive || !this.#dragOp) return;
    const axial = this.#clientToAxial(e.clientX, e.clientY);
    if (!axial) return;
    if (this.#lastDragAxial && this.#lastDragAxial.q === axial.q && this.#lastDragAxial.r === axial.r) return;
    this.#lastDragAxial = axial;
    const key = axialKey(axial.q, axial.r);
    if (!this.#occupiedByAxial.has(key)) return;
    this.#applyOp(key);
    e.preventDefault();
    e.stopPropagation();
  };
  #onMouseUp = (_e) => {
    if (!this.#dragActive) return;
    this.#gate?.release("tile-selection");
    this.#dragActive = false;
    this.#dragOp = null;
    this.#touched.clear();
    this.#lastDragAxial = null;
  };
  // ── selection logic ───────────────────────────────────────────
  #applyOp(key) {
    if (this.#touched.has(key)) return;
    this.#touched.add(key);
    if (this.#dragOp === "add") {
      if (this.#selected.size === 0) this.#leaderKey = key;
      this.#selected.add(key);
    } else if (this.#dragOp === "remove") {
      this.#selected.delete(key);
      if (key === this.#leaderKey) {
        const next = this.#selected.values().next();
        this.#leaderKey = next.done ? null : next.value;
      }
    }
    this.#redraw();
    this.#emitChanged();
    this.#syncSelectionService();
  }
  #pruneStaleSelections() {
    let pruned = false;
    for (const key of this.#selected) {
      if (!this.#occupiedByAxial.has(key)) {
        this.#selected.delete(key);
        pruned = true;
      }
    }
    if (this.#leaderKey && !this.#occupiedByAxial.has(this.#leaderKey)) {
      const next = this.#selected.values().next();
      this.#leaderKey = next.done ? null : next.value;
      pruned = true;
    }
    if (pruned) this.#emitChanged();
  }
  #emitChanged() {
    this.#syncing = true;
    this.emitEffect("selection:changed", {
      count: this.#selected.size,
      keys: Array.from(this.#selected),
      labels: this.selectedLabels,
      leader: this.leader,
      relativeAxials: this.relativeAxials
    });
    this.#syncing = false;
  }
  // ── hex drawing (all programmatic, no PNGs) ───────────────────
  #redraw() {
    if (!this.#layer) return;
    this.#layer.clear();
    if (this.#selected.size === 0) return;
    const ox = this.#meshOffset.x;
    const oy = this.#meshOffset.y;
    const axial = this.resolve("axial");
    for (const key of this.#selected) {
      const entry = this.#occupiedByAxial.get(key);
      if (!entry) continue;
      const coord = axial?.items?.get(entry.index);
      if (!coord?.Location) continue;
      const cx = coord.Location.x + ox;
      const cy = coord.Location.y + oy;
      const isLeader = key === this.#leaderKey;
      this.#drawHex(cx, cy, this.#geo.circumRadiusPx, isLeader, this.#flat);
    }
  }
  #drawHex(cx, cy, r, isLeader, flat = false) {
    if (!this.#layer) return;
    const angleOffset = flat ? 0 : Math.PI / 6;
    const verts = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 3 * i + angleOffset;
      verts.push(cx + r * Math.cos(angle));
      verts.push(cy + r * Math.sin(angle));
    }
    const fillColor = isLeader ? LEADER_FILL : SELECTION_FILL;
    const fillAlpha = isLeader ? LEADER_FILL_ALPHA : SELECTION_FILL_ALPHA;
    const strokeColor = isLeader ? LEADER_STROKE : SELECTION_STROKE;
    const strokeAlpha = isLeader ? LEADER_STROKE_ALPHA : SELECTION_STROKE_ALPHA;
    this.#layer.poly(verts, true);
    this.#layer.fill({ color: fillColor, alpha: fillAlpha });
    this.#layer.poly(verts, true);
    this.#layer.stroke({ color: strokeColor, alpha: strokeAlpha, width: STROKE_WIDTH });
  }
  // ── coordinate helpers ────────────────────────────────────────
  #axialToPixel(q, r, flat = false) {
    return flat ? { x: 1.5 * this.#geo.spacing * q, y: Math.sqrt(3) * this.#geo.spacing * (r + q / 2) } : { x: Math.sqrt(3) * this.#geo.spacing * (q + r / 2), y: this.#geo.spacing * 1.5 * r };
  }
  #clientToAxial(cx, cy) {
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return null;
    const detector = this.resolve("detector");
    if (!detector) return null;
    const pixiGlobal = this.#clientToPixiGlobal(cx, cy);
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y));
    const meshLocalX = local.x - this.#meshOffset.x;
    const meshLocalY = local.y - this.#meshOffset.y;
    return detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat);
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
  // ── occupied lookup ───────────────────────────────────────────
  #rebuildOccupiedMap() {
    this.#occupiedByAxial.clear();
    const axial = this.resolve("axial");
    if (!axial?.items) return;
    for (let i = 0; i < this.#cellCount; i++) {
      const coord = axial.items.get(i);
      const label = this.#cellLabels[i];
      if (!coord || !label) break;
      this.#occupiedByAxial.set(axialKey(coord.q, coord.r), { index: i, label });
    }
  }
  #isInteractiveTarget(target) {
    if (!target || !(target instanceof HTMLElement)) return false;
    return !!target.closest('input, textarea, button, select, option, a, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }
  #isInsideRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }
};
var ARROW_OFFSETS = {
  "navigation.moveLeft": { dq: -1, dr: 0 },
  "navigation.moveRight": { dq: 1, dr: 0 },
  "navigation.moveUp": { dq: 0, dr: -1 },
  "navigation.moveDown": { dq: 0, dr: 1 }
};
function axialKey(q, r) {
  return `${q},${r}`;
}
var _tileSelection = new TileSelectionDrone();
window.ioc.register("@diamondcoreprocessor.com/TileSelectionDrone", _tileSelection);
export {
  TileSelectionDrone
};
