// @diamondcoreprocessor.com/navigation
// src/diamondcoreprocessor.com/navigation/bee-toggle.ts
import { EffectBus } from "@hypercomb/core";
var beesVisible = localStorage.getItem("hc:bees-visible") === "true";
EffectBus.on("keymap:invoke", ({ cmd }) => {
  if (cmd !== "render.toggleBees") return;
  beesVisible = !beesVisible;
  localStorage.setItem("hc:bees-visible", String(beesVisible));
  EffectBus.emit("render:set-bees-visible", { visible: beesVisible });
});
EffectBus.emit("render:set-bees-visible", { visible: beesVisible });

// src/diamondcoreprocessor.com/presentation/grid/hex-geometry.ts
function createHexGeometry(circumRadiusPx, gapPx, padPx = 10) {
  return { circumRadiusPx, gapPx, padPx, spacing: circumRadiusPx + gapPx };
}
var DEFAULT_HEX_GEOMETRY = createHexGeometry(32, 6);

// src/diamondcoreprocessor.com/navigation/hex-detector.ts
var SQRT3_OVER_3 = Math.sqrt(3) / 3;
var HexDetector = class _HexDetector {
  #spacing;
  constructor(spacing) {
    this.#spacing = spacing;
  }
  get spacing() {
    return this.#spacing;
  }
  set spacing(value) {
    this.#spacing = value;
  }
  /**
   * O(1) pixel-to-axial conversion using cube rounding.
   * point-top inverse of: x = √3 * s * (q + r/2), y = s * 1.5 * r
   * flat-top inverse of:   x = 1.5 * s * q,        y = √3 * s * (r + q/2)
   */
  pixelToAxial(px, py, flat = false) {
    const s = this.#spacing;
    if (flat) {
      const qf2 = 2 / 3 * px / s;
      const rf2 = (py * SQRT3_OVER_3 - px / 3) / s;
      return _HexDetector.cubeRound(qf2, rf2);
    }
    const qf = (px * SQRT3_OVER_3 - py / 3) / s;
    const rf = 2 / 3 * py / s;
    return _HexDetector.cubeRound(qf, rf);
  }
  /**
   * Snap fractional axial to nearest integer hex.
   * Derives sf = -qf - rf, rounds all three, then fixes
   * the q + r + s = 0 constraint by adjusting the component
   * with the largest rounding error.
   */
  static cubeRound(qf, rf) {
    const sf = -qf - rf;
    let rq = Math.round(qf);
    let rr = Math.round(rf);
    const rs = Math.round(sf);
    const dq = Math.abs(rq - qf);
    const dr = Math.abs(rr - rf);
    const ds = Math.abs(rs - sf);
    if (dq > dr && dq > ds) {
      rq = -rr - rs;
    } else if (dr > ds) {
      rr = -rq - rs;
    }
    return { q: rq, r: rr };
  }
};
window.ioc.register(
  "@diamondcoreprocessor.com/HexDetector",
  new HexDetector(DEFAULT_HEX_GEOMETRY.spacing)
);

// src/diamondcoreprocessor.com/navigation/input-gate.service.ts
var InputGate = class extends EventTarget {
  #owner = null;
  #locked = false;
  get active() {
    return this.#locked || this.#owner !== null;
  }
  get locked() {
    return this.#locked;
  }
  get owner() {
    return this.#owner;
  }
  lock = () => {
    if (this.#locked) return;
    this.#locked = true;
    this.dispatchEvent(new CustomEvent("change"));
  };
  unlock = () => {
    if (!this.#locked) return;
    this.#locked = false;
    this.dispatchEvent(new CustomEvent("change"));
  };
  claim = (source) => {
    if (this.#locked) return false;
    if (this.#owner && this.#owner !== source) return false;
    if (this.#owner === source) return true;
    this.#owner = source;
    this.dispatchEvent(new CustomEvent("change"));
    return true;
  };
  release = (source) => {
    if (this.#owner !== source) return;
    this.#owner = null;
    this.dispatchEvent(new CustomEvent("change"));
  };
  /** Emergency reset — drops all locks and ownership.
   *  Wired to the Escape cascade as a last-resort recovery so a leaked
   *  claim or unmatched lock can never permanently block input. */
  clear = () => {
    if (!this.#locked && this.#owner === null) return;
    this.#locked = false;
    this.#owner = null;
    this.dispatchEvent(new CustomEvent("change"));
  };
  constructor() {
    super();
    document.addEventListener("contextmenu", (e) => {
      if (this.#owner || e.ctrlKey || e.metaKey) e.preventDefault();
    }, true);
  }
};
var _inputGate = new InputGate();
window.ioc.register("@diamondcoreprocessor.com/InputGate", _inputGate);

// src/diamondcoreprocessor.com/navigation/input-mode-stack.service.ts
var InputModeStack = class extends EventTarget {
  #stack = [];
  /** Current active mode name (top of stack), or null if empty. */
  get active() {
    return this.#stack[this.#stack.length - 1]?.name ?? null;
  }
  /** Push a mode onto the stack. Unmounts the current top (if any) and
   *  mounts the new mode. The new mode becomes the active one. */
  push = (mode) => {
    if (this.#stack.length > 0) {
      this.#stack[this.#stack.length - 1].unmount();
    }
    this.#stack.push(mode);
    mode.mount();
    this.dispatchEvent(new CustomEvent("change"));
  };
  /** Pop the top mode if it matches the given name. Unmounts it and
   *  re-mounts whatever is now on top. No-op if name mismatches —
   *  this is the safety net against pop-without-push or double-pop. */
  pop = (name) => {
    if (this.#stack.length === 0) return;
    const top = this.#stack[this.#stack.length - 1];
    if (top.name !== name) return;
    top.unmount();
    this.#stack.pop();
    if (this.#stack.length > 0) {
      this.#stack[this.#stack.length - 1].mount();
    }
    this.dispatchEvent(new CustomEvent("change"));
  };
  /** Forced removal by name regardless of position in the stack. If the
   *  removed mode was the active top, unmount it and re-mount the new top.
   *  Useful for teardown (component disposed while its mode was still
   *  pushed, or escape-cascade-style emergency cleanup). */
  remove = (name) => {
    const idx = this.#stack.findIndex((m) => m.name === name);
    if (idx === -1) return;
    const wasTop = idx === this.#stack.length - 1;
    if (wasTop) this.#stack[idx].unmount();
    this.#stack.splice(idx, 1);
    if (wasTop && this.#stack.length > 0) {
      this.#stack[this.#stack.length - 1].mount();
    }
    this.dispatchEvent(new CustomEvent("change"));
  };
};
window.ioc.register("@diamondcoreprocessor.com/InputModeStack", new InputModeStack());
export {
  HexDetector,
  InputGate,
  InputModeStack
};
