// @diamondcoreprocessor.com/navigation/pan
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
export {
  SpacebarPanInput,
  TouchPanInput
};
