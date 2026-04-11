// @diamondcoreprocessor.com/navigation/touch
// hypercomb-essentials/src/diamondcoreprocessor.com/navigation/touch/touch-gesture.coordinator.ts
import { EffectBus } from "@hypercomb/core";
var DRAG_THRESHOLD = 12;
var PINCH_THRESHOLD = 15;
var SWIPE_THRESHOLD = 20;
var SWIPE_ANGLE_MAX_DEG = 25;
var SENSITIVITY_MIN = 0.25;
var SENSITIVITY_MAX = 4;
var SENSITIVITY_DEFAULT = 1;
var LOCK_DOUBLE_SWIPE_MS = 800;
var MOMENTUM_VELOCITY_THRESHOLD = 0.3;
var MOMENTUM_FRICTION = 0.92;
var MOMENTUM_STOP_THRESHOLD = 0.5;
var MOMENTUM_MAX_SAMPLES = 4;
var MOMENTUM_MAX_AGE_MS = 80;
var LS_KEY = "hypercomb:touch-sensitivity";
var TouchGestureCoordinator = class {
  #state = 0 /* IDLE */;
  #pointers = /* @__PURE__ */ new Map();
  #gate = null;
  #canvas = null;
  #enabled = false;
  #source = "touch-coordinator";
  // delegates
  #panDelegate = null;
  #pinchDelegate = null;
  // pan state
  #panLast = null;
  // pinch state
  #pinchLastDistance = 0;
  // sensitivity state
  #sensitivity = SENSITIVITY_DEFAULT;
  #sensitivityLocked = false;
  #swipeUpCount = 0;
  #lastSwipeUpTime = 0;
  #swipeStartY = 0;
  #swipeStartSensitivity = SENSITIVITY_DEFAULT;
  // dragging effect emitted state
  #draggingEmitted = false;
  // track whether gesture was active (for poisoning)
  #gestureWasActive = false;
  // momentum / inertia state
  #velocitySamples = [];
  #momentumRaf = null;
  #momentumVx = 0;
  #momentumVy = 0;
  constructor() {
    this.#loadSensitivity();
  }
  get sensitivity() {
    return this.#sensitivity;
  }
  get sensitivityLocked() {
    return this.#sensitivityLocked;
  }
  /** Effective sensitivity — browsers report touch coordinates in CSS pixels
   *  (already DPR-neutral), so no devicePixelRatio correction is needed.
   *  Users fine-tune via the two-finger vertical sensitivity swipe gesture. */
  get #effectiveSensitivity() {
    return this.#sensitivity;
  }
  get state() {
    return ["IDLE", "PENDING_PAN", "PAN", "PENDING_TWO_FINGER", "PINCH", "SENSITIVITY_SWIPE"][this.#state];
  }
  attach = (canvas, pan, pinch) => {
    if (this.#enabled) return;
    this.#canvas = canvas;
    this.#panDelegate = pan;
    this.#pinchDelegate = pinch;
    this.#gate = window.ioc.get("@diamondcoreprocessor.com/InputGate") ?? null;
    window.addEventListener("pointerdown", this.#onPointerDown, { passive: false });
    window.addEventListener("pointermove", this.#onPointerMove, { passive: false });
    window.addEventListener("pointerup", this.#onPointerUp, { passive: false });
    window.addEventListener("pointercancel", this.#onPointerUp, { passive: false });
    this.#enabled = true;
  };
  detach = () => {
    if (!this.#enabled) return;
    this.#cancelMomentum();
    window.removeEventListener("pointerdown", this.#onPointerDown);
    window.removeEventListener("pointermove", this.#onPointerMove);
    window.removeEventListener("pointerup", this.#onPointerUp);
    window.removeEventListener("pointercancel", this.#onPointerUp);
    this.#reset();
    this.#canvas = null;
    this.#panDelegate = null;
    this.#pinchDelegate = null;
    this.#gate = null;
    this.#enabled = false;
  };
  // ── pointer events ──────────────────────────────────────────
  #onPointerDown = (e) => {
    if (e.pointerType !== "touch") return;
    if (!this.#canvas) return;
    if (this.#momentumRaf !== null) {
      this.#cancelMomentum();
      this.#gate?.release(this.#source);
      this.#emitDragging(false);
    }
    const rect = this.#canvas.getBoundingClientRect();
    if (!this.#isInsideRect(e.clientX, e.clientY, rect)) return;
    const pt = { x: e.clientX, y: e.clientY };
    this.#pointers.set(e.pointerId, { start: { ...pt }, current: pt, id: e.pointerId });
    e.preventDefault();
    e.stopPropagation();
    const count = this.#pointers.size;
    if (this.#gestureWasActive) return;
    if (this.#state === 0 /* IDLE */) {
      if (count === 1) {
        this.#state = 1 /* PENDING_PAN */;
      } else if (count === 2) {
        this.#state = 3 /* PENDING_TWO_FINGER */;
      }
    } else if (this.#state === 1 /* PENDING_PAN */ && count === 2) {
      this.#state = 3 /* PENDING_TWO_FINGER */;
    }
    if (this.#state === 2 /* PAN */ || this.#state === 4 /* PINCH */ || this.#state === 5 /* SENSITIVITY_SWIPE */) {
      if (count > (this.#state === 2 /* PAN */ ? 1 : 2)) {
        this.#gestureWasActive = true;
      }
    }
  };
  #onPointerMove = (e) => {
    if (e.pointerType !== "touch") return;
    const entry = this.#pointers.get(e.pointerId);
    if (!entry) return;
    const prev = { ...entry.current };
    entry.current = { x: e.clientX, y: e.clientY };
    if (this.#gestureWasActive) return;
    switch (this.#state) {
      case 1 /* PENDING_PAN */:
        this.#handlePendingPan(entry);
        break;
      case 2 /* PAN */:
        this.#handlePan(prev, entry.current);
        e.preventDefault();
        e.stopPropagation();
        break;
      case 3 /* PENDING_TWO_FINGER */:
        this.#handlePendingTwoFinger();
        break;
      case 4 /* PINCH */:
        this.#handlePinch();
        e.preventDefault();
        e.stopPropagation();
        break;
      case 5 /* SENSITIVITY_SWIPE */:
        this.#handleSensitivitySwipe();
        e.preventDefault();
        e.stopPropagation();
        break;
    }
  };
  #onPointerUp = (e) => {
    if (e.pointerType !== "touch") return;
    const wasTracked = this.#pointers.delete(e.pointerId);
    if (this.#pointers.size === 0) {
      if (this.#state === 5 /* SENSITIVITY_SWIPE */) {
        this.#checkSwipeUpForLock();
      }
      this.#finishGesture();
      if (wasTracked) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };
  // ── gesture handlers ────────────────────────────────────────
  #handlePendingPan(entry) {
    const dx = entry.current.x - entry.start.x;
    const dy = entry.current.y - entry.start.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= DRAG_THRESHOLD) {
      if (!this.#gate?.claim(this.#source)) {
        this.#state = 0 /* IDLE */;
        return;
      }
      this.#state = 2 /* PAN */;
      this.#panLast = { ...entry.current };
      this.#emitDragging(true);
    }
  }
  #handlePan(prev, current) {
    if (!this.#panLast) return;
    this.#panDelegate?.panUpdate(this.#panLast, current, this.#effectiveSensitivity);
    const now = performance.now();
    const dx = current.x - this.#panLast.x;
    const dy = current.y - this.#panLast.y;
    this.#velocitySamples.push({ dx, dy, t: now });
    if (this.#velocitySamples.length > MOMENTUM_MAX_SAMPLES) {
      this.#velocitySamples.shift();
    }
    this.#panLast = { ...current };
  }
  #handlePendingTwoFinger() {
    const pts = Array.from(this.#pointers.values());
    if (pts.length < 2) return;
    const [a, b] = pts;
    const startDist = Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y);
    const curDist = Math.hypot(a.current.x - b.current.x, a.current.y - b.current.y);
    const distDelta = Math.abs(curDist - startDist);
    const aDy = a.current.y - a.start.y;
    const bDy = b.current.y - b.start.y;
    const avgDy = (aDy + bDy) / 2;
    const aDx = a.current.x - a.start.x;
    const bDx = b.current.x - b.start.x;
    const avgDx = (aDx + bDx) / 2;
    const verticalDist = Math.abs(avgDy);
    const angle = Math.atan2(Math.abs(avgDx), Math.abs(avgDy)) * (180 / Math.PI);
    const sameDirection = aDy > 0 && bDy > 0 || aDy < 0 && bDy < 0;
    if (sameDirection && verticalDist >= SWIPE_THRESHOLD && angle <= SWIPE_ANGLE_MAX_DEG && !this.#sensitivityLocked) {
      if (!this.#gate?.claim(this.#source)) {
        this.#state = 0 /* IDLE */;
        return;
      }
      this.#state = 5 /* SENSITIVITY_SWIPE */;
      this.#swipeStartY = (a.current.y + b.current.y) / 2;
      this.#swipeStartSensitivity = this.#sensitivity;
      this.#emitDragging(true);
      this.#emitSensitivityBar(true);
      return;
    }
    if (distDelta >= PINCH_THRESHOLD) {
      if (!this.#gate?.claim(this.#source)) {
        this.#state = 0 /* IDLE */;
        return;
      }
      this.#state = 4 /* PINCH */;
      this.#pinchLastDistance = curDist;
      this.#emitDragging(true);
      return;
    }
  }
  #handlePinch() {
    const pts = Array.from(this.#pointers.values());
    if (pts.length < 2) return;
    const [a, b] = pts;
    const result = this.#pinchDelegate?.pinchUpdate(
      a.current,
      b.current,
      this.#pinchLastDistance,
      this.#effectiveSensitivity
    );
    if (result) {
      this.#pinchLastDistance = result.distance;
    }
  }
  #handleSensitivitySwipe() {
    const pts = Array.from(this.#pointers.values());
    if (pts.length < 2) return;
    const [a, b] = pts;
    const currentY = (a.current.y + b.current.y) / 2;
    const deltaY = this.#swipeStartY - currentY;
    const logDelta = deltaY / 200;
    const newSensitivity = this.#swipeStartSensitivity * Math.pow(2, logDelta);
    this.#sensitivity = Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, newSensitivity));
    this.#emitSensitivityBar(true);
  }
  // ── sensitivity lock ────────────────────────────────────────
  #checkSwipeUpForLock() {
    const pts = Array.from(this.#pointers.values());
    const currentY = this.#swipeStartY;
    const netUp = this.#sensitivity > this.#swipeStartSensitivity;
    const now = Date.now();
    if (now - this.#lastSwipeUpTime <= LOCK_DOUBLE_SWIPE_MS) {
      this.#swipeUpCount++;
    } else {
      this.#swipeUpCount = 1;
    }
    this.#lastSwipeUpTime = now;
    if (this.#swipeUpCount >= 2) {
      this.#sensitivityLocked = !this.#sensitivityLocked;
      this.#swipeUpCount = 0;
      this.#saveSensitivity();
      try {
        navigator.vibrate?.(100);
      } catch {
      }
      this.#emitSensitivityBar(true);
    }
  }
  // ── lifecycle helpers ───────────────────────────────────────
  #finishGesture() {
    const wasPan = this.#state === 2 /* PAN */;
    if (this.#state === 5 /* SENSITIVITY_SWIPE */) {
      this.#saveSensitivity();
      this.#emitSensitivityBar(false);
    }
    if (wasPan && this.#startMomentum()) {
      this.#state = 0 /* IDLE */;
      this.#panLast = null;
      this.#pinchLastDistance = 0;
      this.#gestureWasActive = false;
      this.#pointers.clear();
      return;
    }
    if (this.#state !== 0 /* IDLE */) {
      this.#gate?.release(this.#source);
    }
    this.#state = 0 /* IDLE */;
    this.#panLast = null;
    this.#pinchLastDistance = 0;
    this.#gestureWasActive = false;
    this.#pointers.clear();
    this.#velocitySamples.length = 0;
    this.#emitDragging(false);
  }
  // ── momentum / inertia ──────────────────────────────────────
  #startMomentum() {
    const now = performance.now();
    const cutoff = now - MOMENTUM_MAX_AGE_MS;
    const recent = this.#velocitySamples.filter((s) => s.t >= cutoff);
    if (recent.length < 2) return false;
    const totalTime = recent[recent.length - 1].t - recent[0].t;
    if (totalTime <= 0) return false;
    let sumDx = 0, sumDy = 0;
    for (const s of recent) {
      sumDx += s.dx;
      sumDy += s.dy;
    }
    const vxPerMs = sumDx / totalTime;
    const vyPerMs = sumDy / totalTime;
    const speed = Math.hypot(vxPerMs, vyPerMs);
    if (speed < MOMENTUM_VELOCITY_THRESHOLD) return false;
    this.#momentumVx = vxPerMs * 16.667;
    this.#momentumVy = vyPerMs * 16.667;
    this.#velocitySamples.length = 0;
    this.#momentumRaf = requestAnimationFrame(this.#momentumTick);
    return true;
  }
  #momentumTick = () => {
    this.#momentumVx *= MOMENTUM_FRICTION;
    this.#momentumVy *= MOMENTUM_FRICTION;
    if (Math.abs(this.#momentumVx) + Math.abs(this.#momentumVy) < MOMENTUM_STOP_THRESHOLD) {
      this.#momentumRaf = null;
      this.#momentumVx = 0;
      this.#momentumVy = 0;
      this.#gate?.release(this.#source);
      this.#emitDragging(false);
      return;
    }
    const origin = { x: 0, y: 0 };
    const delta = { x: this.#momentumVx, y: this.#momentumVy };
    this.#panDelegate?.panUpdate(origin, delta, this.#effectiveSensitivity);
    this.#momentumRaf = requestAnimationFrame(this.#momentumTick);
  };
  #cancelMomentum() {
    if (this.#momentumRaf !== null) {
      cancelAnimationFrame(this.#momentumRaf);
      this.#momentumRaf = null;
    }
    this.#momentumVx = 0;
    this.#momentumVy = 0;
    this.#velocitySamples.length = 0;
  }
  #reset() {
    this.#cancelMomentum();
    if (this.#state !== 0 /* IDLE */) {
      this.#gate?.release(this.#source);
    }
    this.#state = 0 /* IDLE */;
    this.#pointers.clear();
    this.#panLast = null;
    this.#pinchLastDistance = 0;
    this.#gestureWasActive = false;
    this.#emitDragging(false);
  }
  #emitDragging(active) {
    if (this.#draggingEmitted === active) return;
    this.#draggingEmitted = active;
    EffectBus.emit("touch:dragging", { active });
  }
  #emitSensitivityBar(visible) {
    EffectBus.emit("touch:sensitivity-bar", {
      value: this.#sensitivity,
      locked: this.#sensitivityLocked,
      visible
    });
  }
  // ── sensitivity persistence ─────────────────────────────────
  #loadSensitivity() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (typeof data.value === "number") {
          this.#sensitivity = Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, data.value));
        }
        if (typeof data.locked === "boolean") {
          this.#sensitivityLocked = data.locked;
        }
      }
    } catch {
    }
  }
  #saveSensitivity() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        value: this.#sensitivity,
        locked: this.#sensitivityLocked
      }));
    } catch {
    }
  }
  // ── utils ───────────────────────────────────────────────────
  #isInsideRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }
};
window.ioc.register("@diamondcoreprocessor.com/TouchGestureCoordinator", new TouchGestureCoordinator());
export {
  TouchGestureCoordinator
};
