// src/diamondcoreprocessor.com/selection/tile-selection.drone.ts
import { Drone, hypercomb } from "@hypercomb/core";
import { Point } from "pixi.js";
var TileSelectionDrone = class _TileSelectionDrone extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "Translates pointer clicks and drag gestures into tile selection changes.";
  #renderContainer = null;
  #canvas = null;
  #renderer = null;
  #meshOffset = { x: 0, y: 0 };
  #cellCount = 0;
  #cellLabels = [];
  #cellCoords = [];
  #occupiedByAxial = /* @__PURE__ */ new Map();
  // drag-select gesture state
  #dragActive = false;
  #activePointerId = null;
  #lastOp = null;
  #touched = /* @__PURE__ */ new Set();
  #justDragged = false;
  // selection-mode drag: pending until pointer moves beyond threshold
  #pendingDrag = false;
  #pendingStartLabel = null;
  #pendingStartX = 0;
  #pendingStartY = 0;
  static #DRAG_THRESHOLD = 5;
  // px
  // move mode — drag-to-reorder
  #moveMode = false;
  #reorderDragActive = false;
  #reorderSourceLabel = null;
  // navigation click guard — blocks clicks during layer transitions
  #navigationBlocked = false;
  #navigationGuardTimer = null;
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
  listens = ["render:host-ready", "render:cell-count", "render:mesh-offset", "render:set-orientation", "tile:click", "navigation:guard-start", "navigation:guard-end", "move:mode"];
  emits = [];
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("render:host-ready", (payload) => {
      this.#renderContainer = payload.container;
      this.#canvas = payload.canvas;
      this.#renderer = payload.renderer;
      this.#gate = window.ioc.get("@diamondcoreprocessor.com/InputGate") ?? null;
      this.#attachListeners();
    });
    this.onEffect("render:mesh-offset", (offset) => {
      this.#meshOffset = offset;
    });
    this.onEffect("render:cell-count", (payload) => {
      this.#cellCount = payload.count;
      this.#cellLabels = payload.labels;
      this.#cellCoords = payload.coords;
      this.#rebuildOccupiedMap();
    });
    this.onEffect("tile:click", (payload) => {
      if (this.#justDragged) return;
      if (this.#navigationBlocked) return;
      const selection = this.#selection();
      if (!selection) return;
      if (payload.ctrlKey || payload.metaKey) {
        selection.toggle(payload.label);
      } else if (selection.isSelected(payload.label)) {
        selection.setActive(payload.label);
      } else {
        selection.clear();
        selection.add(payload.label);
      }
    });
    this.onEffect("render:set-orientation", (payload) => {
      this.#flat = payload.flat;
    });
    this.onEffect("navigation:guard-start", () => {
      this.#navigationBlocked = true;
      if (this.#dragActive || this.#pendingDrag || this.#reorderDragActive) {
        this.#dragActive = false;
        this.#pendingDrag = false;
        this.#pendingStartLabel = null;
        this.#reorderDragActive = false;
        this.#reorderSourceLabel = null;
        this.#activePointerId = null;
        this.#lastOp = null;
        this.#touched.clear();
        this.#gate?.release("tile-selection");
      }
      if (this.#navigationGuardTimer) clearTimeout(this.#navigationGuardTimer);
      this.#navigationGuardTimer = setTimeout(() => {
        this.#navigationBlocked = false;
      }, 200);
    });
    this.onEffect("move:mode", (payload) => {
      this.#moveMode = !!payload?.active;
    });
    this.onEffect("navigation:guard-end", () => {
      this.#navigationBlocked = false;
      if (this.#navigationGuardTimer) {
        clearTimeout(this.#navigationGuardTimer);
        this.#navigationGuardTimer = null;
      }
    });
  };
  dispose() {
    if (this.#listening) {
      document.removeEventListener("pointerdown", this.#onPointerDown);
      document.removeEventListener("pointermove", this.#onPointerMove);
      document.removeEventListener("pointerup", this.#onPointerUp);
      document.removeEventListener("pointercancel", this.#onPointerCancel);
      document.removeEventListener("keyup", this.#onKeyUp);
      window.removeEventListener("blur", this.#onBlur);
      this.#listening = false;
    }
  }
  // ── listener setup ──────────────────────────────────────────
  #attachListeners() {
    if (this.#listening) return;
    this.#listening = true;
    document.addEventListener("pointerdown", this.#onPointerDown);
    document.addEventListener("pointermove", this.#onPointerMove);
    document.addEventListener("pointerup", this.#onPointerUp);
    document.addEventListener("pointercancel", this.#onPointerCancel);
    document.addEventListener("keyup", this.#onKeyUp);
    window.addEventListener("blur", this.#onBlur);
  }
  // ── pointer handlers ────────────────────────────────────────
  #onPointerDown = (e) => {
    if (e.pointerType === "touch") return;
    if (this.#navigationBlocked) return;
    if (this.#dragActive || this.#reorderDragActive || this.#pendingDrag) return;
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return;
    const label = this.#labelAtClient(e.clientX, e.clientY);
    if (!label) return;
    const selection = this.#selection();
    if (!selection) return;
    if (!this.#gate?.claim("tile-selection")) return;
    if (!e.ctrlKey && !e.metaKey && selection.isSelected(label)) {
      this.#gate?.release("tile-selection");
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      this.#activePointerId = e.pointerId;
      this.#dragActive = true;
      this.#touched.clear();
      this.#lastOp = selection.isSelected(label) ? "remove" : "add";
      this.#applyOp(label);
      return;
    }
    this.#gate?.release("tile-selection");
  };
  #onPointerMove = (e) => {
    if (e.pointerId !== this.#activePointerId) return;
    if (this.#pendingDrag) {
      const dx = e.clientX - this.#pendingStartX;
      const dy = e.clientY - this.#pendingStartY;
      if (dx * dx + dy * dy >= _TileSelectionDrone.#DRAG_THRESHOLD * _TileSelectionDrone.#DRAG_THRESHOLD) {
        this.#pendingDrag = false;
        this.#dragActive = true;
        this.#touched.clear();
        const selection = this.#selection();
        if (selection && this.#pendingStartLabel) {
          this.#lastOp = selection.isSelected(this.#pendingStartLabel) ? "remove" : "add";
          this.#applyOp(this.#pendingStartLabel);
        }
        const label2 = this.#labelAtClient(e.clientX, e.clientY);
        if (label2) this.#applyOp(label2);
      }
      return;
    }
    if (!this.#dragActive || !this.#lastOp) return;
    const label = this.#labelAtClient(e.clientX, e.clientY);
    if (label) this.#applyOp(label);
  };
  #onPointerUp = (e) => {
    if (e.pointerId !== this.#activePointerId) return;
    if (this.#reorderDragActive) {
      this.#endReorderDrag(e.clientX, e.clientY);
      return;
    }
    if (this.#pendingDrag) {
      this.#pendingDrag = false;
      this.#activePointerId = null;
      this.#gate?.release("tile-selection");
      return;
    }
    this.#endDrag();
  };
  #onPointerCancel = (e) => {
    if (e.pointerId !== this.#activePointerId) return;
    this.#reorderDragActive = false;
    this.#reorderSourceLabel = null;
    this.#pendingDrag = false;
    this.#pendingStartLabel = null;
    this.#endDrag();
  };
  #onKeyUp = (e) => {
    if (!this.#dragActive) return;
    if (e.key === "Control" || e.key === "Meta") this.#endDrag();
  };
  #onBlur = () => {
    if (this.#dragActive) this.#endDrag();
  };
  // ── drag helpers ────────────────────────────────────────────
  #endDrag() {
    if (this.#dragActive) {
      this.#gate?.release("tile-selection");
      this.#justDragged = true;
      requestAnimationFrame(() => {
        this.#justDragged = false;
      });
    }
    this.#dragActive = false;
    this.#activePointerId = null;
    this.#lastOp = null;
    this.#touched.clear();
  }
  #applyOp(label) {
    if (this.#touched.has(label)) return;
    this.#touched.add(label);
    const selection = this.#selection();
    if (!selection || !this.#lastOp) return;
    if (this.#lastOp === "add") {
      if (!selection.isSelected(label)) selection.add(label);
    } else {
      if (selection.isSelected(label)) selection.remove(label);
    }
  }
  #selection() {
    return this.resolve("selection");
  }
  // ── coordinate mapping (same pattern as TileOverlayDrone) ──
  #labelAtClient(cx, cy) {
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return void 0;
    const detector = this.resolve("detector");
    if (!detector) return void 0;
    const pixiGlobal = this.#clientToPixiGlobal(cx, cy);
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y));
    const meshLocalX = local.x - this.#meshOffset.x;
    const meshLocalY = local.y - this.#meshOffset.y;
    const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat);
    const entry = this.#occupiedByAxial.get(axialKey(axial.q, axial.r));
    if (!entry || entry.index >= this.#cellCount) return void 0;
    return entry.label;
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
  // ── reorder drag ───────────────────────────────────────────
  #endReorderDrag(cx, cy) {
    const targetLabel = this.#labelAtClient(cx, cy);
    this.#reorderDragActive = false;
    this.#activePointerId = null;
    const selection = this.#selection();
    if (!targetLabel || !selection || targetLabel === this.#reorderSourceLabel) {
      this.#reorderSourceLabel = null;
      return;
    }
    const selected = new Set(selection.selected);
    const currentOrder = [...this.#cellLabels].slice(0, this.#cellCount);
    if (currentOrder.length === 0) {
      this.#reorderSourceLabel = null;
      return;
    }
    const targetIdx = currentOrder.indexOf(targetLabel);
    if (targetIdx === -1) {
      this.#reorderSourceLabel = null;
      return;
    }
    const remaining = currentOrder.filter((l) => !selected.has(l));
    const insertIdx = remaining.indexOf(targetLabel);
    const selectedInOrder = currentOrder.filter((l) => selected.has(l));
    remaining.splice(insertIdx + 1, 0, ...selectedInOrder);
    this.#reorderSourceLabel = null;
    const orderProjection = window.ioc?.get?.("@diamondcoreprocessor.com/OrderProjection");
    if (orderProjection) {
      void orderProjection.reorder(remaining).then(() => void new hypercomb().act());
    }
  }
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
function axialKey(q, r) {
  return `${q},${r}`;
}
var _tileSelection = new TileSelectionDrone();
window.ioc.register("@diamondcoreprocessor.com/SelectionInputDrone", _tileSelection);
