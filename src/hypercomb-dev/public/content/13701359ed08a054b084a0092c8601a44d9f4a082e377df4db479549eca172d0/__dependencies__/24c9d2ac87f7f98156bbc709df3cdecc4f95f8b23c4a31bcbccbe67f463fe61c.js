// @diamondcoreprocessor.com/move
// src/diamondcoreprocessor.com/move/desktop-move.input.ts
var DesktopMoveInput = class {
  #enabled = false;
  #canvas = null;
  #container = null;
  #renderer = null;
  #getMeshOffset = null;
  #drone = null;
  #source = "desktop-move";
  #threshold = 6;
  #downPos = null;
  #downAxial = null;
  #dragging = false;
  #spaceHeld = false;
  attach = (drone, refs) => {
    if (this.#enabled) return;
    this.#drone = drone;
    this.#canvas = refs.canvas;
    this.#container = refs.container;
    this.#renderer = refs.renderer;
    this.#getMeshOffset = refs.getMeshOffset;
    document.addEventListener("pointerdown", this.#onPointerDown);
    document.addEventListener("pointermove", this.#onPointerMove);
    document.addEventListener("pointerup", this.#onPointerUp);
    document.addEventListener("pointercancel", this.#onPointerUp);
    document.addEventListener("keydown", this.#onKeyDown);
    document.addEventListener("keyup", this.#onKeyUp);
    window.addEventListener("blur", this.#onBlur);
    this.#enabled = true;
  };
  detach = () => {
    if (!this.#enabled) return;
    document.removeEventListener("pointerdown", this.#onPointerDown);
    document.removeEventListener("pointermove", this.#onPointerMove);
    document.removeEventListener("pointerup", this.#onPointerUp);
    document.removeEventListener("pointercancel", this.#onPointerUp);
    document.removeEventListener("keydown", this.#onKeyDown);
    document.removeEventListener("keyup", this.#onKeyUp);
    window.removeEventListener("blur", this.#onBlur);
    this.#cancel();
    this.#drone = null;
    this.#canvas = null;
    this.#container = null;
    this.#renderer = null;
    this.#getMeshOffset = null;
    this.#enabled = false;
  };
  // ── pointer events ────────────────────────────────────────
  #onPointerDown = (e) => {
    if (e.pointerType === "touch") return;
    if (e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (this.#spaceHeld) return;
    if (!this.#canvas) return;
    if (this.#isInteractiveTarget(e.target)) return;
    const rect = this.#canvas.getBoundingClientRect();
    if (!this.#isInsideRect(e.clientX, e.clientY, rect)) return;
    const axial = this.#clientToAxial(e.clientX, e.clientY);
    console.log("[desktop-move] pointerdown", { axial, moveActive: this.#drone?.moveActive, hasDrone: !!this.#drone });
    if (!axial) return;
    this.#downPos = { x: e.clientX, y: e.clientY };
    this.#downAxial = axial;
    this.#dragging = false;
  };
  #onPointerMove = (e) => {
    if (!this.#downPos || !this.#downAxial || !this.#drone) return;
    if (e.pointerType === "touch") return;
    const dx = e.clientX - this.#downPos.x;
    const dy = e.clientY - this.#downPos.y;
    if (!this.#dragging) {
      if (Math.abs(dx) < this.#threshold && Math.abs(dy) < this.#threshold) return;
      const ok = this.#drone.beginMove(this.#downAxial, this.#source);
      if (!ok) {
        this.#downPos = null;
        this.#downAxial = null;
        return;
      }
      this.#dragging = true;
      this.#setCursor("grabbing");
    }
    const axial = this.#clientToAxial(e.clientX, e.clientY);
    if (axial) {
      this.#drone.updateMove(axial, this.#source);
    }
  };
  #onPointerUp = (e) => {
    if (!this.#downPos) return;
    if (e.pointerType === "touch") return;
    if (this.#dragging && this.#drone) {
      const axial = this.#clientToAxial(e.clientX, e.clientY);
      if (axial) {
        void this.#drone.commitMoveAt(axial, this.#source);
      } else {
        this.#drone.cancelMove(this.#source);
      }
    }
    this.#resetDrag();
  };
  #onKeyDown = (e) => {
    if (e.key === " ") this.#spaceHeld = true;
    if (e.key === "Escape" && this.#dragging) {
      this.#drone?.cancelMove(this.#source);
      this.#resetDrag();
    }
  };
  #onKeyUp = (e) => {
    if (e.key === " ") this.#spaceHeld = false;
  };
  #onBlur = () => {
    if (this.#dragging) {
      this.#drone?.cancelMove(this.#source);
    }
    this.#resetDrag();
    this.#spaceHeld = false;
  };
  // ── helpers ───────────────────────────────────────────────
  #cancel() {
    if (this.#dragging) this.#drone?.cancelMove(this.#source);
    this.#resetDrag();
  }
  #resetDrag() {
    this.#downPos = null;
    this.#downAxial = null;
    this.#dragging = false;
    this.#setCursor("");
  }
  #clientToAxial(cx, cy) {
    if (!this.#container || !this.#renderer || !this.#getMeshOffset) return null;
    const detector = window.ioc.get(
      "@diamondcoreprocessor.com/HexDetector"
    );
    if (!detector) return null;
    const pixiGlobal = this.#clientToPixiGlobal(cx, cy);
    const local = this.#container.toLocal(pixiGlobal);
    const offset = this.#getMeshOffset();
    return detector.pixelToAxial(local.x - offset.x, local.y - offset.y);
  }
  #clientToPixiGlobal(cx, cy) {
    const rect = this.#canvas.getBoundingClientRect();
    const screen = this.#renderer.screen;
    return {
      x: (cx - rect.left) * (screen.width / rect.width),
      y: (cy - rect.top) * (screen.height / rect.height)
    };
  }
  #setCursor(cursor) {
    if (this.#canvas) this.#canvas.style.cursor = cursor;
  }
  #isInsideRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }
  #isInteractiveTarget(target) {
    if (!target || !(target instanceof HTMLElement)) return false;
    return !!target.closest('input, textarea, button, select, option, a, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
  }
};
window.ioc.register("@diamondcoreprocessor.com/DesktopMoveInput", new DesktopMoveInput());

// src/diamondcoreprocessor.com/move/layout.service.ts
var LAYOUT_FILE = "__layout__";
var LayoutService = class {
  /**
   * Read the ordered seed list from __layout__ in the given directory.
   * Returns null if no layout file exists (fall back to alphabetical).
   */
  async read(dir) {
    try {
      const handle = await dir.getFileHandle(LAYOUT_FILE, { create: false });
      const file = await handle.getFile();
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter((x) => typeof x === "string" && x.length > 0);
    } catch {
      return null;
    }
  }
  /**
   * Write the ordered seed list to __layout__.
   */
  async write(dir, order) {
    const handle = await dir.getFileHandle(LAYOUT_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(order));
    await writable.close();
  }
  /**
   * Merge a saved layout order with current filesystem seeds.
   * Keeps layout order, removes deleted seeds, appends new seeds alphabetically.
   */
  merge(layoutOrder, fsSeeds) {
    const fsSet = new Set(fsSeeds);
    const result = [];
    const seen = /* @__PURE__ */ new Set();
    for (const label of layoutOrder) {
      if (fsSet.has(label) && !seen.has(label)) {
        result.push(label);
        seen.add(label);
      }
    }
    const newSeeds = fsSeeds.filter((s) => !seen.has(s));
    newSeeds.sort((a, b) => a.localeCompare(b));
    for (const s of newSeeds) result.push(s);
    return result;
  }
};
window.ioc.register("@diamondcoreprocessor.com/LayoutService", new LayoutService());

// src/diamondcoreprocessor.com/move/touch-move.input.ts
import { Point } from "pixi.js";
var TouchMoveInput = class {
  #enabled = false;
  #canvas = null;
  #container = null;
  #renderer = null;
  #getMeshOffset = null;
  #drone = null;
  #gate = null;
  #source = "touch-move";
  #holdMs = 300;
  #jitterPx = 10;
  #holdTimer = null;
  #downPos = null;
  #downAxial = null;
  #activePointerId = null;
  #pointerCount = 0;
  #dragging = false;
  attach = (drone, refs) => {
    if (this.#enabled) return;
    this.#drone = drone;
    this.#gate = window.ioc.get("@diamondcoreprocessor.com/InputGate") ?? null;
    this.#canvas = refs.canvas;
    this.#container = refs.container;
    this.#renderer = refs.renderer;
    this.#getMeshOffset = refs.getMeshOffset;
    window.addEventListener("pointerdown", this.#onPointerDown, { passive: false });
    window.addEventListener("pointermove", this.#onPointerMove, { passive: false });
    window.addEventListener("pointerup", this.#onPointerUp, { passive: false });
    window.addEventListener("pointercancel", this.#onPointerUp, { passive: false });
    this.#enabled = true;
  };
  detach = () => {
    if (!this.#enabled) return;
    window.removeEventListener("pointerdown", this.#onPointerDown);
    window.removeEventListener("pointermove", this.#onPointerMove);
    window.removeEventListener("pointerup", this.#onPointerUp);
    window.removeEventListener("pointercancel", this.#onPointerUp);
    this.#cancel();
    this.#drone = null;
    this.#gate = null;
    this.#canvas = null;
    this.#container = null;
    this.#renderer = null;
    this.#getMeshOffset = null;
    this.#enabled = false;
  };
  // ── pointer events ────────────────────────────────────────
  #onPointerDown = (e) => {
    if (e.pointerType !== "touch") return;
    if (!this.#canvas) return;
    this.#pointerCount++;
    if (this.#pointerCount > 1) {
      this.#cancel();
      return;
    }
    const rect = this.#canvas.getBoundingClientRect();
    if (!this.#isInsideRect(e.clientX, e.clientY, rect)) return;
    const axial = this.#clientToAxial(e.clientX, e.clientY);
    if (!axial) return;
    this.#activePointerId = e.pointerId;
    this.#downPos = { x: e.clientX, y: e.clientY };
    this.#downAxial = axial;
    this.#holdTimer = setTimeout(() => {
      this.#holdTimer = null;
      if (!this.#downAxial || !this.#drone) return;
      if (this.#gate?.active) {
        this.#resetDrag();
        return;
      }
      const ok = this.#drone.beginMove(this.#downAxial, this.#source);
      if (!ok) {
        this.#resetDrag();
        return;
      }
      this.#dragging = true;
      try {
        navigator.vibrate?.(50);
      } catch {
      }
      e.preventDefault();
      e.stopPropagation();
    }, this.#holdMs);
  };
  #onPointerMove = (e) => {
    if (e.pointerType !== "touch") return;
    if (e.pointerId !== this.#activePointerId) return;
    if (this.#holdTimer && this.#downPos) {
      const dx = e.clientX - this.#downPos.x;
      const dy = e.clientY - this.#downPos.y;
      if (Math.abs(dx) > this.#jitterPx || Math.abs(dy) > this.#jitterPx) {
        this.#clearTimer();
        this.#resetDrag();
        return;
      }
    }
    if (!this.#dragging || !this.#drone) return;
    const axial = this.#clientToAxial(e.clientX, e.clientY);
    if (axial) this.#drone.updateMove(axial, this.#source);
    e.preventDefault();
    e.stopPropagation();
  };
  #onPointerUp = (e) => {
    if (e.pointerType !== "touch") return;
    this.#pointerCount = Math.max(0, this.#pointerCount - 1);
    if (e.pointerId !== this.#activePointerId) return;
    this.#clearTimer();
    if (this.#dragging && this.#drone) {
      const axial = this.#clientToAxial(e.clientX, e.clientY);
      if (axial) {
        void this.#drone.commitMoveAt(axial, this.#source);
      } else {
        this.#drone.cancelMove(this.#source);
      }
    }
    this.#resetDrag();
  };
  // ── helpers ───────────────────────────────────────────────
  #cancel() {
    this.#clearTimer();
    if (this.#dragging) this.#drone?.cancelMove(this.#source);
    this.#resetDrag();
  }
  #clearTimer() {
    if (this.#holdTimer) {
      clearTimeout(this.#holdTimer);
      this.#holdTimer = null;
    }
  }
  #resetDrag() {
    this.#downPos = null;
    this.#downAxial = null;
    this.#activePointerId = null;
    this.#dragging = false;
  }
  #clientToAxial(cx, cy) {
    if (!this.#container || !this.#renderer || !this.#getMeshOffset) return null;
    const detector = window.ioc.get(
      "@diamondcoreprocessor.com/HexDetector"
    );
    if (!detector) return null;
    const pixiGlobal = this.#clientToPixiGlobal(cx, cy);
    const local = this.#container.toLocal(new Point(pixiGlobal.x, pixiGlobal.y));
    const offset = this.#getMeshOffset();
    return detector.pixelToAxial(local.x - offset.x, local.y - offset.y);
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
  #isInsideRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }
};
window.ioc.register("@diamondcoreprocessor.com/TouchMoveInput", new TouchMoveInput());
export {
  DesktopMoveInput,
  LayoutService,
  TouchMoveInput
};
