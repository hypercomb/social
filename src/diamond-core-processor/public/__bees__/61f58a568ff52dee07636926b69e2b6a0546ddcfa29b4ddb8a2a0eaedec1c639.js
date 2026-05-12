// src/diamondcoreprocessor.com/selection/selection-from-url.drone.ts
import { Drone, EffectBus } from "@hypercomb/core";
var SelectionFromUrlDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "Bridges window URL (path-bracket + hash selection forms) into the SelectionService.";
  #bound = false;
  #syncing = false;
  /** Last URL we synced from. New URL + non-empty bracket → auto-open
   *  the editor for the first selected. Tracking the URL prevents
   *  re-opening the editor when other events (save → tile:saved →
   *  cascade → navigate-without-URL-change) fire repeatedly. */
  #lastSyncedUrl = null;
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
    const url = window.location.pathname + window.location.hash;
    const urlChanged = url !== this.#lastSyncedUrl;
    this.#lastSyncedUrl = url;
    const desired = new Set(navigation.getSelections());
    const current = selection.selected;
    const hasBracket = navigation.hasBracketSelection();
    let setsMatch = desired.size === current.size;
    if (setsMatch) {
      for (const x of desired) {
        if (!current.has(x)) {
          setsMatch = false;
          break;
        }
      }
    }
    if (!setsMatch) {
      this.#syncing = true;
      try {
        selection.clear();
        for (const name of desired) selection.add(name);
      } finally {
        this.#syncing = false;
      }
    }
    if (urlChanged && hasBracket && desired.size > 0) {
      const first = [...desired][0];
      EffectBus.emit("tile:action", {
        action: "edit",
        label: first,
        q: 0,
        r: 0,
        index: 0
      });
    }
  }
};
var _selectionFromUrl = new SelectionFromUrlDrone();
window.ioc.register("@diamondcoreprocessor.com/SelectionFromUrlDrone", _selectionFromUrl);
export {
  SelectionFromUrlDrone
};
