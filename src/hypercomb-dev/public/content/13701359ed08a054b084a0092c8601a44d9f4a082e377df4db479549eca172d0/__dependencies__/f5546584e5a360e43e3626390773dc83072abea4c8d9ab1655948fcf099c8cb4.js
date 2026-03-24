// @diamondcoreprocessor.com/clipboard
// src/diamondcoreprocessor.com/clipboard/clipboard.service.ts
import { EffectBus } from "@hypercomb/core";
var ClipboardService = class extends EventTarget {
  #items = [];
  #op = "copy";
  get items() {
    return this.#items;
  }
  get operation() {
    return this.#op;
  }
  get count() {
    return this.#items.length;
  }
  get isEmpty() {
    return this.#items.length === 0;
  }
  capture(labels, sourceSegments, op) {
    if (labels.length === 0) return;
    this.#items = labels.map((label) => ({ label, sourceSegments }));
    this.#op = op;
    this.#notify();
  }
  consume() {
    const result = { items: this.#items, op: this.#op };
    if (this.#op === "cut") {
      this.#items = [];
      this.#notify();
    }
    return result;
  }
  removeItems(labels) {
    this.#items = this.#items.filter((i) => !labels.has(i.label));
    this.#notify();
  }
  clear() {
    if (this.#items.length === 0) return;
    this.#items = [];
    this.#op = "copy";
    this.#notify();
  }
  #notify() {
    this.dispatchEvent(new CustomEvent("change"));
    EffectBus.emit("clipboard:changed", {
      items: this.#items,
      op: this.#op,
      count: this.#items.length
    });
  }
};
window.ioc.register(
  "@diamondcoreprocessor.com/ClipboardService",
  new ClipboardService()
);
export {
  ClipboardService
};
