// src/diamondcoreprocessor.com/selection/selection-from-url.drone.ts
import { Drone } from "@hypercomb/core";
var SelectionFromUrlDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "Bridges window URL (path-bracket + hash selection forms) into the SelectionService.";
  #bound = false;
  #syncing = false;
  #sync = () => {
    this.#syncFromUrl();
  };
  heartbeat = async () => {
    if (this.#bound) return;
    this.#bound = true;
    window.addEventListener("navigate", this.#sync);
    window.addEventListener("popstate", this.#sync);
    this.#syncFromUrl();
  };
  dispose() {
    if (!this.#bound) return;
    window.removeEventListener("navigate", this.#sync);
    window.removeEventListener("popstate", this.#sync);
    this.#bound = false;
  }
  #syncFromUrl() {
    if (this.#syncing) return;
    const ioc = window.ioc;
    if (!ioc) return;
    const navigation = ioc.get("@hypercomb.social/Navigation");
    const selection = ioc.get("@diamondcoreprocessor.com/SelectionService");
    if (!navigation || !selection) return;
    const desired = new Set(navigation.getSelections());
    const current = selection.selected;
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
    this.#syncing = true;
    try {
      selection.clear();
      for (const name of desired) selection.add(name);
    } finally {
      this.#syncing = false;
    }
  }
};
var _selectionFromUrl = new SelectionFromUrlDrone();
window.ioc.register("@diamondcoreprocessor.com/SelectionFromUrlDrone", _selectionFromUrl);
export {
  SelectionFromUrlDrone
};
