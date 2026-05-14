// @diamondcoreprocessor.com/selection
// src/diamondcoreprocessor.com/selection/selection.service.ts
import { EffectBus } from "@hypercomb/core";
var SelectionService = class extends EventTarget {
  #items = /* @__PURE__ */ new Set();
  #active = null;
  #urlSyncing = false;
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
    const syncFromUrl = () => this.#syncFromUrl();
    window.addEventListener("navigate", syncFromUrl);
    window.addEventListener("popstate", syncFromUrl);
    queueMicrotask(syncFromUrl);
  }
  /** Pull current selection from the URL (via Navigation) and reconcile
   *  the in-memory set. Same-set short-circuit avoids redundant
   *  notifications and prevents any feedback with the legacy hash
   *  writer. Internal mutations (add/remove/toggle/clear) are
   *  guarded against re-entering via `#urlSyncing` so the notify
   *  callback below doesn't recurse through window listeners. */
  #syncFromUrl() {
    if (this.#urlSyncing) return;
    const ioc = window.ioc;
    const navigation = ioc?.get("@hypercomb.social/Navigation");
    if (!navigation) return;
    const desired = new Set(navigation.getSelections());
    const current = this.#items;
    if (desired.size === current.size) {
      let same = true;
      for (const x of desired) {
        if (!current.has(x)) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    this.#urlSyncing = true;
    try {
      this.#items.clear();
      this.#active = null;
      for (const name of desired) {
        this.#items.add(name);
        if (!this.#active) this.#active = name;
      }
      this.#notify();
    } finally {
      this.#urlSyncing = false;
    }
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
