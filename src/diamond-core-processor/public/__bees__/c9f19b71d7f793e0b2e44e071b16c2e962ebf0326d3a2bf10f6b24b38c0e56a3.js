// src/diamondcoreprocessor.com/presentation/tiles/tile-selection.drone.ts
import { Drone } from "@hypercomb/core";
import { Graphics } from "pixi.js";

// src/diamondcoreprocessor.com/presentation/grid/hex-geometry.ts
function createHexGeometry(circumRadiusPx, gapPx, padPx = 10) {
  return { circumRadiusPx, gapPx, padPx, spacing: circumRadiusPx + gapPx };
}
var DEFAULT_HEX_GEOMETRY = createHexGeometry(32, 6);

// src/diamondcoreprocessor.com/presentation/tiles/tile-selection.drone.ts
var SELECTION_FILL = 2280550;
var SELECTION_FILL_ALPHA = 0.12;
var SELECTION_STROKE = 2280550;
var SELECTION_STROKE_MIN_ALPHA = 0.35;
var SELECTION_STROKE_MAX_ALPHA = 0.75;
var SELECTION_STROKE_WIDTH = 1;
var INSET_OFFSET = 3;
var INSET_STROKE_ALPHA = 0.25;
var INSET_STROKE_WIDTH = 0.75;
var VERTEX_RADIUS = 2.75;
var VERTEX_COLOR = 13145946;
var VERTEX_ALPHA = 0.85;
var LEADER_FILL = 16755200;
var LEADER_FILL_ALPHA = 0.15;
var LEADER_STROKE = 16755200;
var LEADER_STROKE_MIN_ALPHA = 0.5;
var LEADER_STROKE_MAX_ALPHA = 0.9;
var LEADER_STROKE_WIDTH = 2.5;
var HALO_OFFSET = 5;
var HALO_FILL = 16755200;
var HALO_FILL_ALPHA = 0.1;
var LEADER_VERTEX_RADIUS = 3.5;
var LEADER_VERTEX_RING_RADIUS = 5;
var LEADER_VERTEX_RING_WIDTH = 0.75;
var LEADER_VERTEX_RING_ALPHA = 0.5;
var PULSE_PERIOD_MS = 3e3;
var ANIM_FPS_CAP = 30;
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
  #cellCoords = [];
  #occupiedByAxial = /* @__PURE__ */ new Map();
  // ── selection state ───────────────────────────────────────────
  #selected = /* @__PURE__ */ new Set();
  // axial keys "q,r"
  #leaderKey = null;
  // axial key of the leader tile
  #effectsRegistered = false;
  // hex orientation
  #flat = false;
  // ── animation state ───────────────────────────────────────────
  #tickerBound = false;
  #pulsePhase = 0;
  #lastFrameTime = 0;
  deps = {
    detector: "@diamondcoreprocessor.com/HexDetector",
    axial: "@diamondcoreprocessor.com/AxialService",
    selection: "@diamondcoreprocessor.com/SelectionService"
  };
  listens = ["render:host-ready", "render:mesh-offset", "render:cell-count", "render:set-orientation", "render:geometry-changed", "keymap:invoke", "selection:changed", "move:preview", "move:committed"];
  // When true, the selection layer is hidden until the next render:cell-count arrives
  #hiddenForMove = false;
  // During a move preview, override selection positions to follow the tiles
  #previewOccupied = null;
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
      this.#initLayer();
    });
    this.onEffect("render:mesh-offset", (offset) => {
      this.#meshOffset = offset;
      this.#redraw();
    });
    this.onEffect("render:cell-count", (payload) => {
      this.#cellCount = payload.count;
      this.#cellLabels = payload.labels;
      this.#cellCoords = payload.coords;
      this.#rebuildOccupiedMap();
      this.#resyncFromService();
      if (this.#hiddenForMove) {
        this.#hiddenForMove = false;
      }
      this.#redraw();
    });
    this.onEffect("move:preview", (payload) => {
      if (!payload) {
        this.#previewOccupied = null;
        return;
      }
      const axial = this.resolve("axial");
      if (!axial?.items) return;
      const preview = /* @__PURE__ */ new Map();
      for (let i = 0; i < payload.names.length; i++) {
        const label = payload.names[i];
        if (!label) continue;
        const coord = axial.items.get(i);
        if (!coord) continue;
        preview.set(axialKey(coord.q, coord.r), { index: i, label });
      }
      this.#previewOccupied = preview;
      this.#redraw();
    });
    this.onEffect("move:committed", () => {
      this.#previewOccupied = null;
      this.#hiddenForMove = true;
      if (this.#layer) this.#layer.clear();
    });
    this.onEffect("render:set-orientation", (payload) => {
      this.#flat = payload.flat;
      this.#redraw();
    });
    this.onEffect("render:geometry-changed", (geo) => {
      this.#geo = geo;
      this.#redraw();
    });
    this.onEffect("keymap:invoke", ({ cmd, event }) => {
      if (cmd in ARROW_OFFSETS) {
        const extend = !!(event && (event.ctrlKey || event.metaKey));
        this.#handleArrowNav(cmd, extend);
        return;
      }
      if (cmd === "selection.toggleLeader") {
        this.#handleToggleLeader();
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
      const activeLabel = payload["active"];
      let leaderKey = null;
      if (activeLabel) {
        for (const [key, entry] of this.#occupiedByAxial) {
          if (entry.label === activeLabel) {
            leaderKey = key;
            break;
          }
        }
      }
      leaderKey = leaderKey ?? (targetKeys.size > 0 ? [...targetKeys][0] : null);
      const sameSet = targetKeys.size === this.#selected.size && [...targetKeys].every((k) => this.#selected.has(k));
      if (sameSet && leaderKey === this.#leaderKey) return;
      this.#selected.clear();
      for (const k of targetKeys) this.#selected.add(k);
      this.#leaderKey = leaderKey;
      this.#redraw();
      this.#emitChanged();
      if (this.#selected.size > 0) this.#startAnimation();
      else this.#stopAnimation();
    });
  };
  dispose() {
    this.#stopAnimation();
    if (this.#layer) {
      this.#layer.parent?.removeChild(this.#layer);
      this.#layer.destroy();
      this.#layer = null;
    }
  }
  // ── animation lifecycle ──────────────────────────────────────
  #startAnimation() {
    if (this.#tickerBound || !this.#app) return;
    this.#tickerBound = true;
    this.#lastFrameTime = 0;
    this.#app.ticker.add(this.#onAnimTick);
  }
  #stopAnimation() {
    if (!this.#tickerBound || !this.#app) return;
    this.#app.ticker.remove(this.#onAnimTick);
    this.#tickerBound = false;
    this.#pulsePhase = 0;
  }
  #onAnimTick = () => {
    if (!this.#app || this.#selected.size === 0) return;
    const now = performance.now();
    const minInterval = 1e3 / ANIM_FPS_CAP;
    if (now - this.#lastFrameTime < minInterval) return;
    this.#lastFrameTime = now;
    this.#pulsePhase = now % PULSE_PERIOD_MS / PULSE_PERIOD_MS;
    this.#redraw();
  };
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
    this.#stopAnimation();
    this.#redraw();
    this.#emitChanged();
    this.#syncSelectionService();
  }
  // ── keyboard navigation ──────────────────────────────────────
  #handleArrowNav(cmd, extend = false) {
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
      this.#startAnimation();
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
        if (extend) {
          this.#leaderKey = targetKey;
          this.#selected.add(targetKey);
          this.#syncSelectionService(targetKey);
        } else if (this.#selected.has(targetKey)) {
          this.#leaderKey = targetKey;
        } else {
          this.#leaderKey = targetKey;
          this.#selected.clear();
          this.#selected.add(targetKey);
          this.#syncSelectionService(targetKey);
        }
        this.#startAnimation();
        this.#redraw();
        this.#emitChanged();
        return;
      }
      tq += offset.dq;
      tr += offset.dr;
    }
  }
  #handleToggleLeader() {
    if (!this.#leaderKey) return;
    if (this.#selected.has(this.#leaderKey)) {
      this.#selected.delete(this.#leaderKey);
      if (this.#selected.size > 0) {
        this.#leaderKey = this.#selected.values().next().value;
      } else {
        this.#leaderKey = null;
        this.#stopAnimation();
      }
    } else {
      this.#selected.add(this.#leaderKey);
      this.#startAnimation();
    }
    this.#syncSelectionService(this.#leaderKey ?? void 0);
    this.#redraw();
    this.#emitChanged();
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
  /**
   * Re-derive visual selection from SelectionService after the occupied map
   * has been rebuilt.  This handles moves (tiles at new axial positions)
   * and deletions (tiles removed entirely) in one pass.
   */
  #resyncFromService() {
    const selection = this.resolve("selection");
    if (!selection) return;
    const targetLabels = selection.selected;
    const newKeys = /* @__PURE__ */ new Set();
    for (const [key, entry] of this.#occupiedByAxial) {
      if (targetLabels.has(entry.label)) newKeys.add(key);
    }
    let leaderKey = null;
    if (selection.active) {
      for (const [key, entry] of this.#occupiedByAxial) {
        if (entry.label === selection.active) {
          leaderKey = key;
          break;
        }
      }
    }
    leaderKey = leaderKey ?? (newKeys.size > 0 ? [...newKeys][0] : null);
    const sameSet = newKeys.size === this.#selected.size && [...newKeys].every((k) => this.#selected.has(k));
    if (sameSet && leaderKey === this.#leaderKey) return;
    this.#selected.clear();
    for (const k of newKeys) this.#selected.add(k);
    this.#leaderKey = leaderKey;
    this.#emitChanged();
    if (this.#selected.size > 0) this.#startAnimation();
    else this.#stopAnimation();
  }
  #emitChanged() {
    this.#syncing = true;
    const labels = this.selectedLabels;
    this.emitEffect("selection:changed", {
      selected: labels,
      active: this.leader?.label ?? null,
      count: this.#selected.size,
      keys: Array.from(this.#selected),
      labels,
      leader: this.leader,
      relativeAxials: this.relativeAxials
    });
    this.#syncing = false;
  }
  // ── hex drawing (all programmatic, no PNGs) ───────────────────
  #redraw() {
    if (!this.#layer) return;
    this.#layer.clear();
    if (this.#hiddenForMove) return;
    if (this.#selected.size === 0) return;
    const ox = this.#meshOffset.x;
    const oy = this.#meshOffset.y;
    const selectedLabels = this.selectedLabels;
    if (selectedLabels.length === 0) return;
    const leaderLabel = this.leader?.label ?? null;
    const occupied = this.#previewOccupied ?? this.#occupiedByAxial;
    for (const label of selectedLabels) {
      let axialQ = null;
      let axialR = null;
      for (const [key, entry] of occupied) {
        if (entry.label === label) {
          const [qs, rs] = key.split(",");
          axialQ = Number(qs);
          axialR = Number(rs);
          break;
        }
      }
      if (axialQ === null || axialR === null) continue;
      const pos = this.#axialToPixel(axialQ, axialR, this.#flat);
      const cx = pos.x + ox;
      const cy = pos.y + oy;
      const isLeader = label === leaderLabel;
      this.#drawHex(cx, cy, this.#geo.circumRadiusPx, isLeader, this.#flat);
    }
  }
  #hexVerts(cx, cy, r, angleOffset) {
    const verts = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 3 * i + angleOffset;
      verts.push(cx + r * Math.cos(angle));
      verts.push(cy + r * Math.sin(angle));
    }
    return verts;
  }
  #drawHex(cx, cy, r, isLeader, flat = false) {
    if (!this.#layer) return;
    const angleOffset = flat ? 0 : Math.PI / 6;
    const verts = this.#hexVerts(cx, cy, r, angleOffset);
    const sin01 = (Math.sin(this.#pulsePhase * Math.PI * 2) + 1) / 2;
    if (isLeader) {
      const haloVerts = this.#hexVerts(cx, cy, r + HALO_OFFSET, angleOffset);
      this.#layer.poly(haloVerts, true);
      this.#layer.fill({ color: HALO_FILL, alpha: HALO_FILL_ALPHA });
      this.#layer.poly(verts, true);
      this.#layer.fill({ color: LEADER_FILL, alpha: LEADER_FILL_ALPHA });
      const leaderAlpha = LEADER_STROKE_MIN_ALPHA + (1 - sin01) * (LEADER_STROKE_MAX_ALPHA - LEADER_STROKE_MIN_ALPHA);
      this.#layer.poly(verts, true);
      this.#layer.stroke({ color: LEADER_STROKE, alpha: leaderAlpha, width: LEADER_STROKE_WIDTH });
      const insetVerts = this.#hexVerts(cx, cy, r - INSET_OFFSET, angleOffset);
      this.#layer.poly(insetVerts, true);
      this.#layer.stroke({ color: LEADER_STROKE, alpha: INSET_STROKE_ALPHA, width: INSET_STROKE_WIDTH });
      for (let i = 0; i < 12; i += 2) {
        const vx = verts[i], vy = verts[i + 1];
        this.#layer.circle(vx, vy, LEADER_VERTEX_RING_RADIUS);
        this.#layer.stroke({ color: VERTEX_COLOR, alpha: LEADER_VERTEX_RING_ALPHA, width: LEADER_VERTEX_RING_WIDTH });
        this.#layer.circle(vx, vy, LEADER_VERTEX_RADIUS);
        this.#layer.fill({ color: VERTEX_COLOR, alpha: VERTEX_ALPHA });
      }
    } else {
      this.#layer.poly(verts, true);
      this.#layer.fill({ color: SELECTION_FILL, alpha: SELECTION_FILL_ALPHA });
      const selAlpha = SELECTION_STROKE_MIN_ALPHA + sin01 * (SELECTION_STROKE_MAX_ALPHA - SELECTION_STROKE_MIN_ALPHA);
      this.#layer.poly(verts, true);
      this.#layer.stroke({ color: SELECTION_STROKE, alpha: selAlpha, width: SELECTION_STROKE_WIDTH });
      const insetVerts = this.#hexVerts(cx, cy, r - INSET_OFFSET, angleOffset);
      this.#layer.poly(insetVerts, true);
      this.#layer.stroke({ color: SELECTION_STROKE, alpha: INSET_STROKE_ALPHA, width: INSET_STROKE_WIDTH });
      for (let i = 0; i < 12; i += 2) {
        this.#layer.circle(verts[i], verts[i + 1], VERTEX_RADIUS);
        this.#layer.fill({ color: VERTEX_COLOR, alpha: VERTEX_ALPHA });
      }
    }
  }
  // ── coordinate helpers ────────────────────────────────────────
  #axialToPixel(q, r, flat = false) {
    return flat ? { x: 1.5 * this.#geo.spacing * q, y: Math.sqrt(3) * this.#geo.spacing * (r + q / 2) } : { x: Math.sqrt(3) * this.#geo.spacing * (q + r / 2), y: this.#geo.spacing * 1.5 * r };
  }
  // ── occupied lookup ───────────────────────────────────────────
  #rebuildOccupiedMap() {
    this.#occupiedByAxial.clear();
    for (let i = 0; i < this.#cellCount; i++) {
      const coord = this.#cellCoords[i];
      const label = this.#cellLabels[i];
      if (!coord || !label) break;
      this.#occupiedByAxial.set(axialKey(coord.q, coord.r), { index: i, label });
    }
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
