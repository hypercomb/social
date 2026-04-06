// src/diamondcoreprocessor.com/navigation/zoom/zoom.drone.ts
import { Drone } from "@hypercomb/core";
import { Point } from "pixi.js";

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

// src/diamondcoreprocessor.com/navigation/touch/touch-gesture.coordinator.ts
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

// src/diamondcoreprocessor.com/navigation/zoom/zoom.drone.ts
var InputGate = class {
  #owner = null;
  #locked = false;
  get active() {
    return this.#locked || this.#owner !== null;
  }
  get locked() {
    return this.#locked;
  }
  lock = () => {
    this.#locked = true;
  };
  unlock = () => {
    this.#locked = false;
  };
  claim = (source) => {
    if (this.#locked) return false;
    if (this.#owner && this.#owner !== source) return false;
    this.#owner = source;
    return true;
  };
  release = (source) => {
    if (this.#owner === source) this.#owner = null;
  };
  constructor() {
    document.addEventListener("contextmenu", (e) => {
      if (this.#owner || e.ctrlKey || e.metaKey) e.preventDefault();
    }, true);
  }
};
var PROPERTIES_FILE = "0000";
var readProperties = async (dir) => {
  try {
    const fh = await dir.getFileHandle(PROPERTIES_FILE);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch {
    return {};
  }
};
var ViewportPersistence = class extends EventTarget {
  constructor() {
    super();
  }
  #dir = null;
  #debounceTimer = null;
  #pending = {};
  #lastRead = {};
  #writing = false;
  #storeListening = false;
  #reading = null;
  #suspended = false;
  /** Suspend persistence — viewport changes are applied visually but not saved to OPFS. */
  suspend = () => {
    this.#suspended = true;
  };
  /** Resume persistence. */
  resume = () => {
    this.#suspended = false;
  };
  // -- directory tracking --
  #syncWithStore = () => {
    const store = window.ioc?.get("@hypercomb.social/Store");
    if (!store) return;
    this.setDir(store.current);
    if (!this.#storeListening) {
      this.#storeListening = true;
      store.addEventListener("change", () => this.setDir(store.current));
    }
  };
  /** Switch directory without reading or dispatching restore — caller already applied the viewport. */
  setDirSilent = (dir) => {
    if (this.#dir === dir) return;
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    const flushDir = this.#dir;
    const flushPending = this.#pending;
    if (flushDir && (flushPending.zoom || flushPending.pan)) {
      void this.#persistTo(flushDir, flushPending);
    }
    this.#dir = dir;
    this.#pending = {};
    this.#lastRead = {};
    this.#reading = null;
  };
  setDir = (dir) => {
    if (this.#dir === dir) return;
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    const flushDir = this.#dir;
    const flushPending = this.#pending;
    if (flushDir && (flushPending.zoom || flushPending.pan)) {
      void this.#persistTo(flushDir, flushPending);
    }
    this.#dir = dir;
    this.#pending = {};
    this.#lastRead = {};
    this.#reading = null;
    if (dir) {
      void this.read().then((snap) => {
        this.dispatchEvent(new CustomEvent("restore", { detail: snap }));
      });
    }
  };
  // -- drone-facing api --
  setZoom = (scale, cx, cy) => {
    if (this.#suspended) return;
    if (!this.#dir) this.#syncWithStore();
    this.#pending.zoom = { scale, cx, cy };
    if (this.#dir) this.#schedulePersist();
  };
  setPan = (dx, dy) => {
    if (this.#suspended) return;
    if (!this.#dir) this.#syncWithStore();
    this.#pending.pan = { dx, dy };
    if (this.#dir) this.#schedulePersist();
  };
  get lastPan() {
    return this.#pending.pan ?? this.#lastRead.pan;
  }
  get lastZoom() {
    return this.#pending.zoom ?? this.#lastRead.zoom;
  }
  read = () => {
    if (!this.#dir) this.#syncWithStore();
    if (!this.#dir) return Promise.resolve({});
    if (this.#reading) return this.#reading;
    const dir = this.#dir;
    this.#reading = readProperties(dir).then((props) => {
      const vp = props.viewport;
      this.#lastRead = vp ?? {};
      return this.#lastRead;
    }).catch(() => {
      this.#lastRead = {};
      return {};
    }).finally(() => {
      this.#reading = null;
    });
    return this.#reading;
  };
  // -- internals --
  #schedulePersist = () => {
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      void this.#persist();
    }, 1e3);
  };
  #persistTo = async (dir, pending) => {
    try {
      const props = await readProperties(dir);
      const viewport = {
        ...props.viewport,
        ...pending
      };
      props.viewport = viewport;
      const fileHandle = await dir.getFileHandle(PROPERTIES_FILE, { create: true });
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(JSON.stringify(props, null, 2));
      } finally {
        await writable.close();
      }
      if (this.#dir === dir) this.#lastRead = viewport;
    } catch {
    }
  };
  #persist = async () => {
    const dir = this.#dir;
    if (!dir) return;
    if (this.#writing) {
      this.#schedulePersist();
      return;
    }
    const pending = { ...this.#pending };
    if (!pending.zoom && !pending.pan) return;
    this.#writing = true;
    try {
      await this.#persistTo(dir, pending);
    } finally {
      this.#writing = false;
    }
  };
};
var ZoomDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "Handles pinch, wheel, and keyboard zoom \u2014 owns the viewport scale.";
  effects = ["render"];
  app = null;
  renderContainer = null;
  canvas = null;
  renderer = null;
  minScale = 0.05;
  maxScale = 12;
  vp = null;
  // ── smooth zoom animation state ──
  #animFrameId = null;
  #animStartTime = 0;
  #animStartScale = 1;
  #animTargetScale = 1;
  #animPivotClient = { x: 0, y: 0 };
  // snapshot of the local point under the pivot at animation start
  #animPivotLocal = { x: 0, y: 0 };
  #animDuration = 150;
  // ms — short for crisp feel
  deps = {
    mouseWheel: "@diamondcoreprocessor.com/MousewheelZoomInput",
    pinchZoom: "@diamondcoreprocessor.com/PinchZoomInput",
    coordinator: "@diamondcoreprocessor.com/TouchGestureCoordinator",
    touchPan: "@diamondcoreprocessor.com/TouchPanInput"
  };
  listens = ["render:host-ready", "editor:mode", "keymap:invoke"];
  #effectsRegistered = false;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("keymap:invoke", ({ cmd }) => {
      if (cmd === "navigation.fitToScreen") this.zoomToFit();
    });
    const gate = window.ioc.get("@diamondcoreprocessor.com/InputGate");
    this.onEffect("editor:mode", ({ active }) => {
      if (active) gate?.lock();
      else gate?.unlock();
    });
    this.onEffect("render:host-ready", (payload) => {
      this.app = payload.app;
      this.renderContainer = payload.container;
      this.canvas = payload.canvas;
      this.renderer = payload.renderer;
      const mouseWheel = this.resolve("mouseWheel");
      mouseWheel?.attach(
        {
          zoomByFactor: this.zoomByFactor,
          zoomToScale: this.zoomToScale,
          animateToScale: this.animateToScale,
          currentScale: this.currentScale
        },
        this.canvas
      );
      const pinchZoom = this.resolve("pinchZoom");
      pinchZoom?.attach(this, this.minScale);
      const touchPan = this.resolve("touchPan");
      const coordinator = this.resolve("coordinator");
      if (coordinator && this.canvas) {
        coordinator.attach(
          this.canvas,
          touchPan ?? { panUpdate: () => {
          } },
          pinchZoom ?? { pinchUpdate: () => ({ distance: 0 }) }
        );
      }
      this.vp = window.ioc.get("@diamondcoreprocessor.com/ViewportPersistence") ?? null;
      if (this.vp) {
        void this.vp.read().then((snap) => this.#applyZoomSnapshot(snap));
        this.vp.addEventListener("restore", ((e) => {
          this.#applyZoomSnapshot(e.detail);
        }));
      }
    });
  };
  #applyZoomSnapshot = (snap) => {
    if (!this.renderContainer) return;
    if (snap.zoom) {
      this.renderContainer.scale.set(snap.zoom.scale);
      this.renderContainer.position.set(snap.zoom.cx, snap.zoom.cy);
    } else {
      this.renderContainer.scale.set(1);
      this.renderContainer.position.set(0, 0);
    }
  };
  stop = async () => {
    this.detach();
  };
  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------
  detach = () => {
    const mouseWheel = this.resolve("mouseWheel");
    mouseWheel?.detach();
    const pinchZoom = this.resolve("pinchZoom");
    pinchZoom?.detach();
    const coordinator = this.resolve("coordinator");
    coordinator?.detach();
    this.app = null;
    this.renderContainer = null;
    this.canvas = null;
    this.renderer = null;
  };
  // -------------------------------------------------
  // zoom api (used by inputs)
  // -------------------------------------------------
  currentScale = () => {
    return this.renderContainer?.scale.x ?? 1;
  };
  zoomToScale = (scale, pivotClient) => {
    if (!this.renderContainer || !this.canvas) return;
    const clamped = this.clamp(scale);
    this.adjustZoom(this.renderContainer, clamped, pivotClient);
  };
  zoomByFactor = (factor, pivotClient) => {
    if (!this.renderContainer || !this.canvas) return;
    if (this.#animFrameId !== null) {
      cancelAnimationFrame(this.#animFrameId);
      this.#animFrameId = null;
    }
    const target = this.renderContainer;
    const current = target.scale.x || 1;
    const raw = current * factor;
    if (raw < this.minScale) {
      this.zoomToFit();
      return;
    }
    const next = this.clamp(raw);
    this.adjustZoom(target, next, pivotClient);
  };
  /**
   * Zoom-to-fit: calculates the bounding box of all hex cells via the
   * mesh adapter and animates the viewport to center and fit all content.
   */
  zoomToFit = (snap = false) => {
    if (!this.renderContainer || !this.renderer || !this.app) return;
    if (this.#animFrameId !== null) {
      cancelAnimationFrame(this.#animFrameId);
      this.#animFrameId = null;
    }
    const target = this.renderContainer;
    const bounds = target.getLocalBounds();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    const padding = 5;
    const headerEl = document.querySelector(".header-bar");
    const pillEl = document.querySelector(".controls-pill");
    const safeTop = headerEl ? headerEl.getBoundingClientRect().bottom + padding : padding;
    const safeBottom = pillEl ? pillEl.getBoundingClientRect().top - padding : window.innerHeight - padding;
    const safeLeft = padding;
    const safeRight = window.innerWidth - padding;
    const availW = safeRight - safeLeft;
    const availH = safeBottom - safeTop;
    const stageScale = this.app.stage.scale.x || 1;
    const screenCx = window.innerWidth * 0.5;
    const screenCy = window.innerHeight * 0.5;
    this.app.stage.position.set(screenCx, screenCy);
    this.vp?.setPan(0, 0);
    const scaleX = availW / (bounds.width * stageScale);
    const scaleY = availH / (bounds.height * stageScale);
    const fitScale = this.clamp(Math.min(scaleX, scaleY));
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const safeMidX = (safeLeft + safeRight) / 2;
    const safeMidY = (safeTop + safeBottom) / 2;
    const targetPosX = (safeMidX - screenCx) / stageScale - centerX * fitScale;
    const targetPosY = (safeMidY - screenCy) / stageScale - centerY * fitScale;
    if (snap) {
      target.scale.set(fitScale);
      target.position.set(targetPosX, targetPosY);
      this.#saveZoom(target);
      return;
    }
    const startScale = target.scale.x;
    const startPosX = target.position.x;
    const startPosY = target.position.y;
    const duration = 200;
    const startTime = performance.now();
    const animate = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      const s = startScale + (fitScale - startScale) * ease;
      const px = startPosX + (targetPosX - startPosX) * ease;
      const py = startPosY + (targetPosY - startPosY) * ease;
      target.scale.set(s);
      target.position.set(px, py);
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        this.#saveZoom(target);
      }
    };
    requestAnimationFrame(animate);
  };
  // -------------------------------------------------
  // smooth animated zoom (mousewheel snap levels)
  // -------------------------------------------------
  animateToScale = (scale, pivotClient) => {
    if (!this.renderContainer || !this.canvas || !this.renderer) return;
    const target = this.renderContainer;
    const clamped = this.clamp(scale);
    if (this.#animFrameId !== null) {
      cancelAnimationFrame(this.#animFrameId);
    }
    this.#animStartScale = target.scale.x;
    this.#animTargetScale = clamped;
    this.#animPivotClient = pivotClient;
    const pivotGlobal = this.clientToPixiGlobal(pivotClient);
    this.#animPivotLocal = target.toLocal(new Point(pivotGlobal.x, pivotGlobal.y));
    this.#animStartTime = performance.now();
    this.#animFrameId = requestAnimationFrame(this.#animTick);
  };
  #animTick = (now) => {
    if (!this.renderContainer || !this.renderer) {
      this.#animFrameId = null;
      return;
    }
    const target = this.renderContainer;
    const elapsed = now - this.#animStartTime;
    const t = Math.min(1, elapsed / this.#animDuration);
    const ease = t * t * t;
    const newScale = this.#animStartScale + (this.#animTargetScale - this.#animStartScale) * ease;
    target.scale.set(newScale);
    const pivotGlobal = this.clientToPixiGlobal(this.#animPivotClient);
    const postGlobal = target.toGlobal(this.#animPivotLocal);
    const parent = target.parent;
    if (parent?.toLocal) {
      const pivP = parent.toLocal(new Point(pivotGlobal.x, pivotGlobal.y));
      const postP = parent.toLocal(postGlobal);
      target.position.set(
        target.position.x + (pivP.x - postP.x),
        target.position.y + (pivP.y - postP.y)
      );
    } else {
      target.position.set(
        target.position.x + (pivotGlobal.x - postGlobal.x),
        target.position.y + (pivotGlobal.y - postGlobal.y)
      );
    }
    if (t < 1) {
      this.#animFrameId = requestAnimationFrame(this.#animTick);
    } else {
      this.#animFrameId = null;
      this.#saveZoom(target);
    }
  };
  // -------------------------------------------------
  // pixel-perfect zoom (no creep)
  // -------------------------------------------------
  //
  // invariant:
  // - the exact pixel under the cursor before zoom remains under the cursor after zoom
  //
  // this is the same math you used in legacy:
  // - compute local point under pivot
  // - apply scale
  // - compute new global for that same local point
  // - translate to cancel the difference
  //
  adjustZoom = (target, newScale, pivotClient) => {
    if (!this.renderer || !this.canvas) return;
    const pivotGlobal = this.clientToPixiGlobal(pivotClient);
    const preLocal = target.toLocal(new Point(pivotGlobal.x, pivotGlobal.y));
    target.scale.set(newScale);
    const postGlobal = target.toGlobal(preLocal);
    const parent = target.parent;
    if (parent?.toLocal) {
      const pivotParent = parent.toLocal(new Point(pivotGlobal.x, pivotGlobal.y));
      const postParent = parent.toLocal(postGlobal);
      target.position.set(
        target.position.x + (pivotParent.x - postParent.x),
        target.position.y + (pivotParent.y - postParent.y)
      );
      this.#saveZoom(target);
      return;
    }
    target.position.set(
      target.position.x + (pivotGlobal.x - postGlobal.x),
      target.position.y + (pivotGlobal.y - postGlobal.y)
    );
    this.#saveZoom(target);
  };
  #saveZoom = (target) => {
    this.vp?.setZoom(target.scale.x, target.position.x, target.position.y);
  };
  // -------------------------------------------------
  // input mapping
  // -------------------------------------------------
  //
  // returns pixi "global" coordinates in renderer.screen units (top-left origin)
  // this must match the coordinate space used by toLocal/toGlobal.
  //
  clientToPixiGlobal = (p) => {
    const renderer = this.renderer;
    const canvas = this.canvas;
    const events = renderer?.events;
    if (events?.mapPositionToPoint) {
      const out = new Point();
      events.mapPositionToPoint(out, p.x, p.y);
      return { x: out.x, y: out.y };
    }
    const rect = canvas.getBoundingClientRect();
    const screen = renderer.screen;
    const x = (p.x - rect.left) * (screen.width / rect.width);
    const y = (p.y - rect.top) * (screen.height / rect.height);
    return { x, y };
  };
  clamp = (v) => Math.max(this.minScale, Math.min(this.maxScale, v));
};
var _inputGate = new InputGate();
window.ioc.register("@diamondcoreprocessor.com/InputGate", _inputGate);
var _viewportPersistence = new ViewportPersistence();
window.ioc.register("@diamondcoreprocessor.com/ViewportPersistence", _viewportPersistence);
var _zoom = new ZoomDrone();
window.ioc.register("@diamondcoreprocessor.com/ZoomDrone", _zoom);
window.ioc.register("@diamondcoreprocessor.com/PinchZoomInput", new PinchZoomInput());
window.ioc.register("@diamondcoreprocessor.com/TouchGestureCoordinator", new TouchGestureCoordinator());
export {
  InputGate,
  ViewportPersistence,
  ZoomDrone
};
