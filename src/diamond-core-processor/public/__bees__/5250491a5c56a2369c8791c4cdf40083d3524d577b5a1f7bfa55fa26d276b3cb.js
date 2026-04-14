// src/diamondcoreprocessor.com/assistant/ai-key.drone.ts
import { Drone, EffectBus } from "@hypercomb/core";

// src/diamondcoreprocessor.com/assistant/llm-api.ts
var API_KEY_STORAGE = "hc:anthropic-api-key";

// src/diamondcoreprocessor.com/assistant/ai-key.drone.ts
var INDICATOR_KEY = "ai-active";
var INDICATOR_ICON = "\u2728";
var INDICATOR_LABEL = "Claude API key active";
var AiKeyIndicatorDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "assistant";
  description = "shows a command-line indicator when a Claude API key is set";
  listens = [];
  emits = ["indicator:set", "indicator:clear"];
  #initialized = false;
  #storageHandler = null;
  heartbeat = async () => {
    if (this.#initialized) return;
    this.#initialized = true;
    this.#sync();
    this.#storageHandler = (event) => {
      if (event.key === API_KEY_STORAGE || event.key === null) this.#sync();
    };
    window.addEventListener("storage", this.#storageHandler);
  };
  #sync() {
    const hasKey = !!localStorage.getItem(API_KEY_STORAGE);
    if (hasKey) {
      EffectBus.emit("indicator:set", {
        key: INDICATOR_KEY,
        icon: INDICATOR_ICON,
        label: INDICATOR_LABEL
      });
    } else {
      EffectBus.emit("indicator:clear", { key: INDICATOR_KEY });
    }
  }
};
var _aiKey = new AiKeyIndicatorDrone();
window.ioc.register("@diamondcoreprocessor.com/AiKeyIndicatorDrone", _aiKey);
console.log("[AiKeyIndicatorDrone] Loaded");
export {
  AiKeyIndicatorDrone
};
