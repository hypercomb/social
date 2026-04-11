// hypercomb-essentials/src/diamondcoreprocessor.com/assistant/atomizer-drop.worker.ts
import { Bee, EffectBus } from "@hypercomb/core";
import { ATOMIZER_IOC_PREFIX, ATOMIZABLE_TARGET_PREFIX } from "@hypercomb/core";
var get = (key) => globalThis.ioc?.get(key);
var ioc = () => globalThis.ioc;
var HIGHLIGHT_CLASS = "atomizer-drop-target";
var HOVER_CLASS = "atomizer-drop-hover";
var AtomizerDropWorker = class extends Bee {
  namespace = "diamondcoreprocessor.com";
  genotype = "assistant";
  description = "Manages atomizer drag-and-drop onto controls";
  listens = ["atomizer:drag-start", "atomizer:drag-end"];
  emits = ["atomizer:dropped", "atomizer:properties"];
  #activeDrag = null;
  #highlightedElements = [];
  #dropHandlers = /* @__PURE__ */ new Map();
  async pulse() {
  }
  constructor() {
    super();
    this.onEffect(
      "atomizer:drag-start",
      (payload) => this.#onDragStart(payload)
    );
    this.onEffect("atomizer:drag-end", () => this.#onDragEnd());
  }
  #onDragStart(payload) {
    this.#activeDrag = payload;
    const container = ioc();
    if (!container) return;
    const targets = this.#findMatchingTargets(payload.targetTypes);
    for (const target of targets) {
      const el = target.element;
      el.classList.add(HIGHLIGHT_CLASS);
      this.#highlightedElements.push(el);
      const dragover = (e) => {
        const de = e;
        de.preventDefault();
        if (de.dataTransfer) de.dataTransfer.dropEffect = "copy";
        el.classList.add(HOVER_CLASS);
      };
      const dragleave = () => {
        el.classList.remove(HOVER_CLASS);
      };
      const drop = (e) => {
        const de = e;
        de.preventDefault();
        el.classList.remove(HOVER_CLASS);
        this.#onDrop(de, target);
      };
      el.addEventListener("dragover", dragover);
      el.addEventListener("dragleave", dragleave);
      el.addEventListener("drop", drop);
      this.#dropHandlers.set(el, { dragover, dragleave, drop });
    }
  }
  #onDragEnd() {
    for (const el of this.#highlightedElements) {
      el.classList.remove(HIGHLIGHT_CLASS);
      el.classList.remove(HOVER_CLASS);
      const handlers = this.#dropHandlers.get(el);
      if (handlers) {
        el.removeEventListener("dragover", handlers.dragover);
        el.removeEventListener("dragleave", handlers.dragleave);
        el.removeEventListener("drop", handlers.drop);
      }
    }
    this.#highlightedElements = [];
    this.#dropHandlers.clear();
    this.#activeDrag = null;
  }
  #onDrop(event, target) {
    const atomizerId = event.dataTransfer?.getData("application/x-atomizer-id");
    if (!atomizerId) return;
    const atomizer = get(`${ATOMIZER_IOC_PREFIX}${atomizerId}`);
    if (!atomizer) {
      console.warn(`[atomizer-drop] Atomizer not found: ${atomizerId}`);
      return;
    }
    const properties = atomizer.discover(target);
    EffectBus.emit("atomizer:dropped", { atomizer });
    EffectBus.emit("atomizer:properties", {
      atomizer,
      target,
      properties
    });
    console.log(`[atomizer-drop] ${atomizer.name} \u2192 ${target.targetId} (${properties.length} properties)`);
  }
  #findMatchingTargets(targetTypes) {
    const targets = [];
    const container = ioc();
    if (!container?.list) return targets;
    const keys = container.list();
    for (const key of keys) {
      if (!key.startsWith(ATOMIZABLE_TARGET_PREFIX)) continue;
      const target = container.get(key);
      if (target && targetTypes.includes(target.targetType)) {
        targets.push(target);
      }
    }
    return targets;
  }
};
var _worker = new AtomizerDropWorker();
window.ioc.register("@diamondcoreprocessor.com/AtomizerDropWorker", _worker);
console.log("[AtomizerDropWorker] Loaded");
export {
  AtomizerDropWorker
};
