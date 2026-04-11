// hypercomb-essentials/src/diamondcoreprocessor.com/presentation/background/background.drone.ts
import { Drone } from "@hypercomb/core";
import { Graphics } from "pixi.js";

// hypercomb-essentials/src/diamondcoreprocessor.com/presentation/background/move-background.provider.ts
import { EffectBus } from "@hypercomb/core";
var FILL = 667197;
var FILL_ALPHA = 0.85;
var MODE_FILL_ALPHA = 0.4;
var MoveBackgroundProvider = class {
  name = "move";
  priority = 100;
  #modeActive = false;
  #dragging = false;
  #unsubs = [];
  constructor(requestRedraw) {
    this.#unsubs.push(
      EffectBus.on("move:mode", ({ active }) => {
        this.#modeActive = active;
        requestRedraw();
      }),
      EffectBus.on("move:preview", (payload) => {
        const next = payload != null;
        if (next !== this.#dragging) {
          this.#dragging = next;
          requestRedraw();
        }
      })
    );
  }
  active() {
    return this.#modeActive;
  }
  render(g, width, height) {
    g.rect(-width / 2, -height / 2, width, height);
    g.fill({ color: FILL, alpha: this.#dragging ? FILL_ALPHA : MODE_FILL_ALPHA });
  }
  dispose() {
    for (const unsub of this.#unsubs) unsub();
    this.#unsubs.length = 0;
  }
};

// hypercomb-essentials/src/diamondcoreprocessor.com/presentation/background/editor-background.provider.ts
import { EffectBus as EffectBus2 } from "@hypercomb/core";
var FILL2 = 546974;
var FILL_ALPHA2 = 0.7;
var EditorBackgroundProvider = class {
  name = "editor";
  priority = 90;
  #active = false;
  #unsub = null;
  constructor(requestRedraw) {
    this.#unsub = EffectBus2.on("editor:mode", ({ active }) => {
      if (active !== this.#active) {
        this.#active = active;
        requestRedraw();
      }
    });
  }
  active() {
    return this.#active;
  }
  render(g, width, height) {
    g.rect(-width / 2, -height / 2, width, height);
    g.fill({ color: FILL2, alpha: FILL_ALPHA2 });
  }
  dispose() {
    this.#unsub?.();
    this.#unsub = null;
  }
};

// hypercomb-essentials/src/diamondcoreprocessor.com/presentation/background/background.drone.ts
var BackgroundDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "pluggable canvas background coordinator";
  #container = null;
  #graphics = null;
  #providers = [];
  #lastProviderName = "";
  deps = {};
  listens = ["render:host-ready"];
  emits = [];
  #effectsRegistered = false;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("render:host-ready", (payload) => {
      this.#container = payload.container;
      this.#initGraphics();
      this.#redraw();
    });
  };
  addProvider(provider) {
    this.#providers.push(provider);
    this.#providers.sort((a, b) => b.priority - a.priority);
    this.#redraw();
  }
  requestRedraw = () => {
    this.#redraw();
  };
  #initGraphics() {
    if (!this.#container || this.#graphics) return;
    this.#graphics = new Graphics();
    this.#graphics.zIndex = -1e3;
    this.#container.addChild(this.#graphics);
    this.#container.sortableChildren = true;
  }
  #redraw() {
    if (!this.#graphics) return;
    this.#graphics.clear();
    const winner = this.#providers.find((p) => p.active());
    if (!winner) {
      this.#lastProviderName = "";
      return;
    }
    if (winner.name !== this.#lastProviderName) {
      this.#lastProviderName = winner.name;
    }
    winner.render(this.#graphics, 2e5, 2e5);
  }
  dispose() {
    for (const p of this.#providers) p.dispose?.();
    if (this.#graphics) {
      this.#graphics.destroy();
      this.#graphics = null;
    }
  }
};
var _background = new BackgroundDrone();
_background.addProvider(new MoveBackgroundProvider(_background.requestRedraw));
_background.addProvider(new EditorBackgroundProvider(_background.requestRedraw));
window.ioc.register("@diamondcoreprocessor.com/BackgroundDrone", _background);
export {
  BackgroundDrone
};
