// @diamondcoreprocessor.com/selection
// src/diamondcoreprocessor.com/selection/selection.service.ts
import { EffectBus } from "@hypercomb/core";
var SelectionService = class extends EventTarget {
  #items = /* @__PURE__ */ new Set();
  #active = null;
  get selected() {
    return this.#items;
  }
  get count() {
    return this.#items.size;
  }
  get active() {
    return this.#active;
  }
  constructor() {
    super();
  }
  add(label) {
    if (this.#items.has(label)) return;
    this.#items.add(label);
    if (!this.#active) this.#active = label;
    this.#notify();
  }
  remove(label) {
    if (!this.#items.delete(label)) return;
    if (this.#active === label) this.#active = this.#items.size > 0 ? this.#items.values().next().value : null;
    this.#notify();
  }
  toggle(label) {
    if (this.#items.has(label)) {
      this.#items.delete(label);
      if (this.#active === label) this.#active = this.#items.size > 0 ? this.#items.values().next().value : null;
    } else {
      this.#items.add(label);
      if (!this.#active) this.#active = label;
    }
    this.#notify();
  }
  setActive(label) {
    if (!this.#items.has(label) || this.#active === label) return;
    this.#active = label;
    this.#notify();
  }
  clear() {
    if (this.#items.size === 0) return;
    this.#items.clear();
    this.#active = null;
    this.#notify();
  }
  isSelected(label) {
    return this.#items.has(label);
  }
  #notify() {
    this.dispatchEvent(new CustomEvent("change"));
    EffectBus.emit("selection:changed", { selected: Array.from(this.#items), active: this.#active });
  }
};
window.ioc.register(
  "@diamondcoreprocessor.com/SelectionService",
  new SelectionService()
);
export {
  SelectionService
};
