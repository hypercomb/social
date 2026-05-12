// src/diamondcoreprocessor.com/selection/url-bracket-opens-editor.drone.ts
import { Drone, EffectBus } from "@hypercomb/core";
var UrlBracketOpensEditorDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "When a URL bracket selection (`/parent/[name]`) arrives, opens the tile editor for the first selected.";
  #bound = false;
  /** Tracks the URL we last reacted to. Re-firing for the same URL
   *  (after save → cascade → synchronize → other internal events) would
   *  re-open the editor in a loop — guard with this. */
  #lastUrl = null;
  #onUrl = () => {
    this.#maybeOpen();
  };
  heartbeat = async () => {
    if (this.#bound) return;
    this.#bound = true;
    window.addEventListener("navigate", this.#onUrl);
    window.addEventListener("popstate", this.#onUrl);
    this.#maybeOpen();
  };
  dispose() {
    if (!this.#bound) return;
    window.removeEventListener("navigate", this.#onUrl);
    window.removeEventListener("popstate", this.#onUrl);
    this.#bound = false;
  }
  #maybeOpen() {
    const ioc = window.ioc;
    if (!ioc) return;
    const navigation = ioc.get("@hypercomb.social/Navigation");
    const selection = ioc.get("@diamondcoreprocessor.com/SelectionService");
    if (!navigation || !selection) return;
    const url = window.location.pathname + window.location.search + window.location.hash;
    const urlChanged = url !== this.#lastUrl;
    this.#lastUrl = url;
    if (!urlChanged) return;
    if (!navigation.hasBracketSelection()) return;
    if (selection.selected.size === 0) return;
    const first = [...selection.selected][0];
    EffectBus.emit("tile:action", {
      action: "edit",
      label: first,
      q: 0,
      r: 0,
      index: 0
    });
  }
};
var _drone = new UrlBracketOpensEditorDrone();
window.ioc.register("@diamondcoreprocessor.com/UrlBracketOpensEditorDrone", _drone);
export {
  UrlBracketOpensEditorDrone
};
