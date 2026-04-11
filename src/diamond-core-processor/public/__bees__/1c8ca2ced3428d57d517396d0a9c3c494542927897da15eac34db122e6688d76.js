// hypercomb-essentials/src/diamondcoreprocessor.com/link/tile-link-action.drone.ts
import { Drone, EffectBus } from "@hypercomb/core";
var LINK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
var LINK_OWNER = "@diamondcoreprocessor.com/TileLinkActionDrone";
var LINK_ICON = {
  name: "link",
  owner: LINK_OWNER,
  svgMarkup: LINK_SVG,
  x: -2,
  y: -7,
  hoverTint: 11065599,
  profile: "private",
  visibleWhen: (ctx) => ctx.isBranch && ctx.hasLink
};
var TileLinkActionDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "linking";
  description = "link action icon \u2014 opens content viewer for tile links";
  listens = ["render:host-ready", "tile:action"];
  emits = ["overlay:register-action"];
  #registered = false;
  #effectsRegistered = false;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("render:host-ready", () => {
      if (this.#registered) return;
      this.#registered = true;
      this.emitEffect("overlay:register-action", LINK_ICON);
    });
    this.onEffect("tile:action", (payload) => {
      if (payload.action !== "link") return;
      EffectBus.emit("tile:action", {
        action: "open",
        label: payload.label,
        q: payload.q,
        r: payload.r,
        index: payload.index
      });
    });
  };
};
var _tileLinkAction = new TileLinkActionDrone();
window.ioc.register("@diamondcoreprocessor.com/TileLinkActionDrone", _tileLinkAction);
export {
  TileLinkActionDrone
};
