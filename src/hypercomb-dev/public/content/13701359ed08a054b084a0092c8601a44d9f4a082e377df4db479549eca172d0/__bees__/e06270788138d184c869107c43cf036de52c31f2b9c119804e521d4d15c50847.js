// src/diamondcoreprocessor.com/navigation/pan/panning.drone.ts
import { Drone } from "@hypercomb/core";

// src/diamondcoreprocessor.com/navigation/pan/spacebar-pan.input.ts
var SpacebarPanInput = class {
  enabled = false;
  spaceHeld = false;
  last = null;
  canvas = null;
  source = "spacebar-pan";
  pan = null;
  gate = null;
  attach = (pan, canvas) => {
    if (this.enabled) return;
    this.pan = pan;
    this.canvas = canvas;
    this.gate = window.ioc.get("@diamondcoreprocessor.com/InputGate") ?? null;
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMove);
    window.addEventListener("blur", this.onBlur);
    this.enabled = true;
  };
  detach = () => {
    if (!this.enabled) return;
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("blur", this.onBlur);
    this.endPan();
    this.pan = null;
    this.canvas = null;
    this.gate = null;
    this.enabled = false;
  };
  // -------------------------------------------------
  // keyboard
  // -------------------------------------------------
  onKeyDown = (e) => {
    if (e.key !== " ") return;
    if (e.repeat) return;
    if (this.isInteractiveFocus()) return;
    e.preventDefault();
    this.spaceHeld = true;
    this.setCursor("grab");
  };
  onKeyUp = (e) => {
    if (e.key !== " ") return;
    this.endPan();
  };
  onBlur = () => {
    this.endPan();
  };
  // -------------------------------------------------
  // mouse movement
  // -------------------------------------------------
  onMove = (e) => {
    if (!this.spaceHeld || !this.pan || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!this.isInsideRect(e.clientX, e.clientY, rect)) return;
    if (!this.last) {
      if (!this.gate?.claim(this.source)) return;
      this.last = { x: e.clientX, y: e.clientY };
      this.setCursor("grabbing");
      return;
    }
    const next = { x: e.clientX, y: e.clientY };
    const delta = { x: next.x - this.last.x, y: next.y - this.last.y };
    this.last = next;
    this.pan.panBy(delta);
  };
  // -------------------------------------------------
  // cleanup
  // -------------------------------------------------
  endPan = () => {
    if (this.spaceHeld && this.last) {
      this.gate?.release(this.source);
    }
    this.spaceHeld = false;
    this.last = null;
    this.setCursor("");
  };
  // -------------------------------------------------
  // cursor
  // -------------------------------------------------
  setCursor = (cursor) => {
    if (!this.canvas) return;
    this.canvas.style.cursor = cursor;
  };
  // -------------------------------------------------
  // helpers
  // -------------------------------------------------
  isInsideRect = (x, y, rect) => {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };
  isInteractiveFocus = () => {
    const el = document.activeElement;
    if (!el) return false;
    return !!el.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]'
    );
  };
};

// src/diamondcoreprocessor.com/navigation/pan/touch-pan.input.ts
var TouchPanInput = class {
  #pan = null;
  attach = (pan) => {
    this.#pan = pan;
  };
  detach = () => {
    this.#pan = null;
  };
  /**
   * Called by TouchGestureCoordinator on each move event during a single-finger pan.
   */
  panUpdate = (prev, current, sensitivity) => {
    if (!this.#pan) return;
    const dx = (current.x - prev.x) * sensitivity;
    const dy = (current.y - prev.y) * sensitivity;
    this.#pan.panBy({ x: dx, y: dy });
  };
};

// src/diamondcoreprocessor.com/navigation/pan/panning.drone.ts
var PanningDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "authoritative panning controller";
  stage = null;
  canvas = null;
  renderer = null;
  vp = null;
  deps = {
    spacebarPan: "@diamondcoreprocessor.com/SpacebarPanInput",
    touchPan: "@diamondcoreprocessor.com/TouchPanInput"
  };
  // Note: touchPan is now a math delegate — the TouchGestureCoordinator
  // calls touchPan.panUpdate() instead of touchPan managing its own pointers.
  // The coordinator is attached by ZoomDrone (which has both zoom + pan refs).
  listens = ["render:host-ready"];
  #effectsRegistered = false;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("render:host-ready", (payload) => {
      this.stage = payload.app.stage;
      this.canvas = payload.canvas;
      this.renderer = payload.renderer;
      const spacebarPan = this.resolve("spacebarPan");
      spacebarPan?.attach(this, this.canvas);
      const touchPan = this.resolve("touchPan");
      touchPan?.attach(this);
      this.vp = window.ioc.get("@diamondcoreprocessor.com/ViewportPersistence") ?? null;
      if (this.vp) {
        void this.vp.read().then((snap) => this.#applyPanSnapshot(snap));
        this.vp.addEventListener("restore", ((e) => {
          this.#applyPanSnapshot(e.detail);
        }));
      }
    });
  };
  #applyPanSnapshot = (snap) => {
    if (!this.stage || !this.renderer) return;
    const s = this.renderer.screen;
    if (snap.pan) {
      this.stage.position.set(
        s.width * 0.5 + snap.pan.dx,
        s.height * 0.5 + snap.pan.dy
      );
    } else {
      this.stage.position.set(s.width * 0.5, s.height * 0.5);
    }
  };
  stop = async () => {
    this.detach();
  };
  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------
  detach = () => {
    const spacebarPan = this.resolve("spacebarPan");
    spacebarPan?.detach();
    const touchPan = this.resolve("touchPan");
    touchPan?.detach();
    this.stage = null;
    this.canvas = null;
    this.renderer = null;
    this.vp = null;
  };
  // -------------------------------------------------
  // pan api (used by inputs)
  // -------------------------------------------------
  panBy = (delta) => {
    if (!this.stage) return;
    this.stage.position.x += delta.x;
    this.stage.position.y += delta.y;
    if (this.renderer && this.vp) {
      const s = this.renderer.screen;
      this.vp.setPan(
        this.stage.position.x - s.width * 0.5,
        this.stage.position.y - s.height * 0.5
      );
    }
  };
};
var _panning = new PanningDrone();
window.ioc.register("@diamondcoreprocessor.com/PanningDrone", _panning);
window.ioc.register("@diamondcoreprocessor.com/SpacebarPanInput", new SpacebarPanInput());
window.ioc.register("@diamondcoreprocessor.com/TouchPanInput", new TouchPanInput());
export {
  PanningDrone
};
