// @diamondcoreprocessor.com/navigation/zoom
// src/diamondcoreprocessor.com/navigation/zoom/mousewheel-zoom.input.ts
var MousewheelZoomInput = class {
  enabled = false;
  canvas = null;
  step = 1.05;
  zoom = null;
  gate = null;
  attach = (zoom, canvas) => {
    if (this.enabled) return;
    this.zoom = zoom;
    this.canvas = canvas;
    this.gate = window.ioc.get("@diamondcoreprocessor.com/InputGate") ?? null;
    window.addEventListener("wheel", this.onWheel, { passive: false });
    this.enabled = true;
  };
  detach = () => {
    if (!this.enabled) return;
    window.removeEventListener("wheel", this.onWheel);
    this.zoom = null;
    this.canvas = null;
    this.gate = null;
    this.enabled = false;
  };
  onWheel = (event) => {
    if (!this.zoom || !this.canvas) return;
    if (this.gate?.active) return;
    const rect = this.canvas.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    const factor = event.deltaY < 0 ? this.step : 1 / this.step;
    this.zoom.zoomByFactor(
      factor,
      { x: event.clientX, y: event.clientY }
    );
    event.preventDefault();
    event.stopPropagation();
  };
};
window.ioc.register("@diamondcoreprocessor.com/MousewheelZoomInput", new MousewheelZoomInput());

// src/diamondcoreprocessor.com/navigation/zoom/pinch-zoom.input.ts
var PinchZoomInput = class {
  #zoom = null;
  #minScale = 0.05;
  attach = (zoom, minScale) => {
    this.#zoom = zoom;
    if (minScale != null) this.#minScale = minScale;
  };
  detach = () => {
    this.#zoom = null;
  };
  /**
   * Called by TouchGestureCoordinator on each move event during a pinch.
   * Returns the new distance so the coordinator can track it.
   */
  pinchUpdate = (p1, p2, lastDistance, sensitivity) => {
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (dist <= 0 || lastDistance <= 0) return { distance: dist || lastDistance };
    let factor = dist / lastDistance;
    if (!Number.isFinite(factor) || factor <= 0) return { distance: lastDistance };
    factor = Math.max(0.5, Math.min(2, factor));
    const deviation = factor - 1;
    factor = 1 + deviation * sensitivity;
    const pivot = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    this.#zoom?.zoomByFactor(factor, pivot);
    return { distance: dist };
  };
};
window.ioc.register("@diamondcoreprocessor.com/PinchZoomInput", new PinchZoomInput());

// src/diamondcoreprocessor.com/navigation/zoom/zoom-arbiter.ts
var ZoomArbiter = class {
  activeSource = null;
  acquire = (source, force = false) => {
    if (!this.activeSource) {
      this.activeSource = source;
      return true;
    }
    if (this.activeSource === source) return true;
    if (!force) return false;
    this.activeSource = source;
    return true;
  };
  release = (source) => {
    if (this.activeSource !== source) return;
    this.activeSource = null;
  };
  current = () => this.activeSource;
};
export {
  MousewheelZoomInput,
  PinchZoomInput,
  ZoomArbiter
};
