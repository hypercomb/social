// src/diamondcoreprocessor.com/navigation/pan/panning.drone.ts
import { Drone, EffectBus } from "@hypercomb/core";

// src/diamondcoreprocessor.com/presentation/grid/hex-geometry.ts
function createHexGeometry(circumRadiusPx, gapPx, padPx = 10) {
  return { circumRadiusPx, gapPx, padPx, spacing: circumRadiusPx + gapPx };
}
var DEFAULT_HEX_GEOMETRY = createHexGeometry(32, 6);

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
  description = "Handles touch, mouse, and keyboard panning \u2014 owns the viewport position.";
  effects = ["render"];
  stage = null;
  canvas = null;
  renderer = null;
  container = null;
  vp = null;
  deps = {
    spacebarPan: "@diamondcoreprocessor.com/SpacebarPanInput",
    touchPan: "@diamondcoreprocessor.com/TouchPanInput"
  };
  // Note: touchPan is now a math delegate — the TouchGestureCoordinator
  // calls touchPan.panUpdate() instead of touchPan managing its own pointers.
  // The coordinator is attached by ZoomDrone (which has both zoom + pan refs).
  listens = ["render:host-ready", "render:geometry-changed"];
  #hexGeo = DEFAULT_HEX_GEOMETRY;
  #effectsRegistered = false;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("render:geometry-changed", (geo) => {
      this.#hexGeo = geo;
    });
    this.onEffect("render:host-ready", (payload) => {
      this.stage = payload.app.stage;
      this.canvas = payload.canvas;
      this.renderer = payload.renderer;
      this.container = payload.container;
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
    const tx = snap.pan ? s.width * 0.5 + snap.pan.dx : s.width * 0.5;
    const ty = snap.pan ? s.height * 0.5 + snap.pan.dy : s.height * 0.5;
    const dx = tx - this.stage.position.x;
    const dy = ty - this.stage.position.y;
    const clamped = this.#clampStageDelta(dx, dy);
    this.stage.position.x += clamped.x;
    this.stage.position.y += clamped.y;
  };
  // Locate the hex-mesh layer inside renderContainer — only user tiles,
  // not overlays/swarm/background that would inflate the bbox.
  #findContentLayer = (container) => {
    const kids = container?.children ?? [];
    for (const child of kids) {
      const grandkids = child?.children ?? [];
      for (const gk of grandkids) {
        if (gk?.geometry) return child;
      }
    }
    return null;
  };
  // Enforce: at least one tile must remain fully on screen. Bounds come from
  // the hex-mesh layer (user content only) in world/screen coords, so the
  // proposed pan delta simply shifts them. Clamp the delta so the bounds,
  // extended outward by one tile-diameter, still intersects the viewport.
  #clampStageDelta = (dx, dy) => {
    if (!this.stage || !this.renderer || !this.container) return { x: dx, y: dy };
    const layer = this.#findContentLayer(this.container);
    if (!layer || !layer.getBounds) return { x: dx, y: dy };
    const b = layer.getBounds();
    if (!b || b.width <= 0 || b.height <= 0) return { x: dx, y: dy };
    const cs = this.container.scale?.x ?? 1;
    const ss = this.stage.scale?.x ?? 1;
    const tile = 2 * this.#hexGeo.circumRadiusPx * cs * ss;
    const W = this.renderer.screen.width;
    const H = this.renderer.screen.height;
    const maxDx = W - tile - b.x;
    const minDx = tile - b.x - b.width;
    const maxDy = H - tile - b.y;
    const minDy = tile - b.y - b.height;
    const cx = minDx <= maxDx ? Math.max(minDx, Math.min(maxDx, dx)) : dx;
    const cy = minDy <= maxDy ? Math.max(minDy, Math.min(maxDy, dy)) : dy;
    return { x: cx, y: cy };
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
    this.container = null;
    this.vp = null;
  };
  // -------------------------------------------------
  // pan api (used by inputs)
  // -------------------------------------------------
  panBy = (delta) => {
    if (!this.stage) return;
    EffectBus.emitTransient("viewport:manual", {});
    const clamped = this.#clampStageDelta(delta.x, delta.y);
    this.stage.position.x += clamped.x;
    this.stage.position.y += clamped.y;
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
