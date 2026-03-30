// @diamondcoreprocessor.com/presentation/background
// src/diamondcoreprocessor.com/presentation/background/editor-background.provider.ts
import { EffectBus } from "@hypercomb/core";
var FILL = 546974;
var FILL_ALPHA = 0.7;
var EditorBackgroundProvider = class {
  name = "editor";
  priority = 90;
  #active = false;
  #unsub = null;
  constructor(requestRedraw) {
    this.#unsub = EffectBus.on("editor:mode", ({ active }) => {
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
    g.fill({ color: FILL, alpha: FILL_ALPHA });
  }
  dispose() {
    this.#unsub?.();
    this.#unsub = null;
  }
};

// src/diamondcoreprocessor.com/presentation/background/move-background.provider.ts
import { EffectBus as EffectBus2 } from "@hypercomb/core";
var FILL2 = 667197;
var FILL_ALPHA2 = 0.85;
var MODE_FILL_ALPHA = 0.4;
var MoveBackgroundProvider = class {
  name = "move";
  priority = 100;
  #modeActive = false;
  #dragging = false;
  #unsubs = [];
  constructor(requestRedraw) {
    this.#unsubs.push(
      EffectBus2.on("move:mode", ({ active }) => {
        this.#modeActive = active;
        requestRedraw();
      }),
      EffectBus2.on("move:preview", (payload) => {
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
    g.fill({ color: FILL2, alpha: this.#dragging ? FILL_ALPHA2 : MODE_FILL_ALPHA });
  }
  dispose() {
    for (const unsub of this.#unsubs) unsub();
    this.#unsubs.length = 0;
  }
};

// src/diamondcoreprocessor.com/presentation/background/selection-background.provider.ts
import { EffectBus as EffectBus3 } from "@hypercomb/core";
var FILL3 = 6769292;
var FILL_ALPHA3 = 0.4;
var SelectionBackgroundProvider = class {
  name = "selection";
  priority = 50;
  #active = false;
  #unsub = null;
  constructor(requestRedraw) {
    this.#unsub = EffectBus3.on("selection:changed", (payload) => {
      const count = payload?.count ?? payload?.selected?.length ?? 0;
      const next = count > 0;
      if (next !== this.#active) {
        this.#active = next;
        requestRedraw();
      }
    });
  }
  active() {
    return this.#active;
  }
  render(g, width, height) {
    g.rect(-width / 2, -height / 2, width, height);
    g.fill({ color: FILL3, alpha: FILL_ALPHA3 });
  }
  dispose() {
    this.#unsub?.();
    this.#unsub = null;
  }
};
export {
  EditorBackgroundProvider,
  MoveBackgroundProvider,
  SelectionBackgroundProvider
};
