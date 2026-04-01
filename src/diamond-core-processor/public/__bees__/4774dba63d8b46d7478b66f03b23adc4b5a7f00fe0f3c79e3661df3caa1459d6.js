// src/diamondcoreprocessor.com/presentation/tiles/neon-toolbar.drone.ts
import { Drone, EffectBus } from "@hypercomb/core";
import { Container as Container2, Graphics as Graphics2 } from "pixi.js";

// src/diamondcoreprocessor.com/presentation/tiles/hex-overlay.shader.ts
import { BlurFilter, Container, Graphics } from "pixi.js";
var NEON_PRESETS = [
  {
    // 0 — Cyan (default)
    core: 65535,
    bright: 4521983,
    mid: 35020,
    dim: 17510,
    white: 13434879,
    fill: 2580,
    embers: [
      { glow: 4500223, core: 13426175, startEdge: 0 },
      { glow: 6741503, core: 15663103, startEdge: 2 },
      { glow: 13395711, core: 16764159, startEdge: 4 }
    ]
  },
  {
    // 1 — Magenta / Hot Pink
    core: 16711935,
    bright: 16729343,
    mid: 13369480,
    dim: 6684740,
    white: 16764159,
    fill: 655370,
    embers: [
      { glow: 16729258, core: 16764125, startEdge: 0 },
      { glow: 16738013, core: 16772863, startEdge: 2 },
      { glow: 11158783, core: 14535935, startEdge: 4 }
    ]
  },
  {
    // 2 — Green / Emerald
    core: 65416,
    bright: 4521898,
    mid: 52326,
    dim: 17442,
    white: 13434862,
    fill: 2566,
    embers: [
      { glow: 4521898, core: 13434845, startEdge: 0 },
      { glow: 6750156, core: 15663086, startEdge: 2 },
      { glow: 4500223, core: 13426175, startEdge: 4 }
    ]
  },
  {
    // 3 — Gold / Amber
    core: 16763904,
    bright: 16768324,
    mid: 13404160,
    dim: 6702080,
    white: 16772812,
    fill: 657408,
    embers: [
      { glow: 16755268, core: 16768460, startEdge: 0 },
      { glow: 16764006, core: 16772846, startEdge: 2 },
      { glow: 16737860, core: 16764108, startEdge: 4 }
    ]
  },
  {
    // 4 — Violet / Purple
    core: 8930559,
    bright: 11167487,
    mid: 6693580,
    dim: 3346790,
    white: 14535935,
    fill: 393226,
    embers: [
      { glow: 8939263, core: 13417471, startEdge: 0 },
      { glow: 11176191, core: 15654399, startEdge: 2 },
      { glow: 16737962, core: 16764125, startEdge: 4 }
    ]
  }
];
var MOVE_DUR = 3;
var DWELL_DUR = 3;
var CYCLE_PERIOD = MOVE_DUR + DWELL_DUR;
var MOVE_FRAC = MOVE_DUR / CYCLE_PERIOD;

// src/diamondcoreprocessor.com/presentation/tiles/neon-toolbar.drone.ts
var STORAGE_KEY = "hc:neon-color";
var SWATCH_SIZE = 18;
var SWATCH_GAP = 6;
var SWATCH_CORNER = 4;
var TOOLBAR_PAD = 8;
var TOOLBAR_X = 12;
var AUTO_HIDE_MS = 6e3;
var NeonToolbarDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "neon color swatch toolbar, toggled via /neon";
  listens = ["render:host-ready", "neon:toggle-toolbar"];
  emits = ["overlay:neon-color"];
  #app = null;
  #toolbar = null;
  #swatches = [];
  #selectedIndex = 0;
  #effectsRegistered = false;
  #hideTimer = null;
  #canvas = null;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("render:host-ready", (payload) => {
      this.#app = payload.app;
      this.#canvas = payload.canvas;
      this.#buildToolbar();
    });
    this.onEffect("neon:toggle-toolbar", () => {
      this.#toggle();
    });
  };
  #buildToolbar() {
    if (!this.#app || this.#toolbar) return;
    this.#selectedIndex = loadIndex();
    this.#toolbar = new Container2();
    this.#toolbar.visible = false;
    this.#toolbar.zIndex = 1e4;
    this.#toolbar.eventMode = "static";
    const count = NEON_PRESETS.length;
    const totalH = count * SWATCH_SIZE + (count - 1) * SWATCH_GAP + TOOLBAR_PAD * 2;
    const totalW = SWATCH_SIZE + TOOLBAR_PAD * 2;
    const bg = new Graphics2();
    bg.roundRect(0, 0, totalW, totalH, 6);
    bg.fill({ color: 657940, alpha: 0.75 });
    bg.roundRect(0, 0, totalW, totalH, 6);
    bg.stroke({ width: 1, color: 3359829, alpha: 0.5 });
    this.#toolbar.addChild(bg);
    for (let i = 0; i < count; i++) {
      const preset = NEON_PRESETS[i];
      const g = new Graphics2();
      const y = TOOLBAR_PAD + i * (SWATCH_SIZE + SWATCH_GAP);
      this.#drawSwatch(g, preset.core, i === this.#selectedIndex);
      g.position.set(TOOLBAR_PAD, y);
      g.eventMode = "static";
      g.cursor = "pointer";
      g.on("pointerdown", () => this.#selectColor(i));
      this.#toolbar.addChild(g);
      this.#swatches.push(g);
    }
    this.#positionToolbar(totalW, totalH);
    this.#app.stage.addChild(this.#toolbar);
    if (this.#canvas) {
      const observer = new ResizeObserver(() => this.#positionToolbar(totalW, totalH));
      observer.observe(this.#canvas);
    }
  }
  #positionToolbar(w, h) {
    if (!this.#app) return;
    const screenH = this.#app.screen.height;
    this.#toolbar.position.set(TOOLBAR_X, (screenH - h) / 2);
  }
  #drawSwatch(g, color, selected) {
    g.clear();
    if (selected) {
      g.roundRect(-2, -2, SWATCH_SIZE + 4, SWATCH_SIZE + 4, SWATCH_CORNER + 2);
      g.stroke({ width: 2, color: 16777215, alpha: 0.9 });
    }
    g.roundRect(0, 0, SWATCH_SIZE, SWATCH_SIZE, SWATCH_CORNER);
    g.fill({ color, alpha: 0.9 });
    g.roundRect(2, 2, SWATCH_SIZE - 4, SWATCH_SIZE - 4, SWATCH_CORNER - 1);
    g.fill({ color: 16777215, alpha: 0.15 });
  }
  #selectColor(index) {
    this.#selectedIndex = index;
    localStorage.setItem(STORAGE_KEY, String(index));
    for (let i = 0; i < this.#swatches.length; i++) {
      this.#drawSwatch(this.#swatches[i], NEON_PRESETS[i].core, i === index);
    }
    EffectBus.emit("overlay:neon-color", { index });
    this.#scheduleAutoHide();
  }
  #toggle() {
    if (!this.#toolbar) return;
    const visible = !this.#toolbar.visible;
    this.#toolbar.visible = visible;
    if (this.#hideTimer) {
      clearTimeout(this.#hideTimer);
      this.#hideTimer = null;
    }
    if (visible) {
      this.#selectedIndex = loadIndex();
      for (let i = 0; i < this.#swatches.length; i++) {
        this.#drawSwatch(this.#swatches[i], NEON_PRESETS[i].core, i === this.#selectedIndex);
      }
      this.#scheduleAutoHide();
    }
  }
  #scheduleAutoHide() {
    if (this.#hideTimer) clearTimeout(this.#hideTimer);
    this.#hideTimer = setTimeout(() => {
      if (this.#toolbar) this.#toolbar.visible = false;
      this.#hideTimer = null;
    }, AUTO_HIDE_MS);
  }
};
function loadIndex() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return 0;
  const n = parseInt(stored, 10);
  return n >= 0 && n < NEON_PRESETS.length ? n : 0;
}
var _neonToolbar = new NeonToolbarDrone();
window.ioc.register("@diamondcoreprocessor.com/NeonToolbarDrone", _neonToolbar);
export {
  NeonToolbarDrone
};
