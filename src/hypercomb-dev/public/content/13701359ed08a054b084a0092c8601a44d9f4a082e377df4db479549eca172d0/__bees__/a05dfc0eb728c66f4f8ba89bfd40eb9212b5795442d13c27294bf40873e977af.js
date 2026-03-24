// src/diamondcoreprocessor.com/presentation/tiles/tile-actions.drone.ts
import { Drone, EffectBus, hypercomb, normalizeSeed } from "@hypercomb/core";
var HIDE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><path fill="white" d="M48 28c-18 0-33 12-40 20 3.5 4 8.2 8.5 14 12l5.5-5.5C23 51 20 48 20 48s12-14 28-14c3 0 5.8.6 8.4 1.6l6-6C57.8 27 53 28 48 28zm0 40c18 0 33-12 40-20-3.5-4-8.2-8.5-14-12l-5.5 5.5C73 45 76 48 76 48S64 62 48 62c-3 0-5.8-.6-8.4-1.6l-6 6C38.2 69 43 68 48 68z"/><circle fill="white" cx="48" cy="48" r="10"/><rect fill="white" x="46" y="16" width="4" height="64" rx="2" transform="rotate(-45 48 48)"/></svg>`;
var BLOCK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><path fill="white" fill-rule="evenodd" d="M48 12c-19.9 0-36 16.1-36 36s16.1 36 36 36 36-16.1 36-36-16.1-36-36-36zm0 8c6.5 0 12.5 2.2 17.3 6L25 66.3C21.2 61.5 20 55.5 20 48c0-15.5 12.5-28 28-28zm0 56c-6.5 0-12.5-2.2-17.3-6L71 29.7C74.8 34.5 76 40.5 76 48c0 15.5-12.5 28-28 28z"/></svg>`;
var ADD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><path fill="white" d="M50 18h-4v28H18v4h28v28h4V50h28v-4H50z"/></svg>`;
var SEARCH_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15.1 15.1" width="96" height="96"><path fill="white" fill-rule="evenodd" d="M 2.8298014 0 C 2.0535814 0 1.3853227 0.28019878 0.82527262 0.84025879 C 0.27504258 1.3904888 1.566648e-16 2.0535915 0 2.8298014 L 0 12.262301 C 0 13.038511 0.27504258 13.706769 0.82527262 14.266829 C 1.3853227 14.817049 2.0535814 15.092102 2.8298014 15.092102 L 12.262301 15.092102 C 13.038521 15.092102 13.701603 14.817049 14.251843 14.266829 C 14.811893 13.706769 15.092102 13.038511 15.092102 12.262301 L 15.092102 7.5457926 L 15.092102 2.8298014 C 15.092102 2.0535915 14.811893 1.3904888 14.251843 0.84025879 C 13.701603 0.28019878 13.038521 7.8332402e-17 12.262301 0 L 2.8298014 0 z M 3.319694 3.5077962 C 3.5118105 3.5046951 3.7067928 3.5434545 3.8943359 3.6261353 C 4.2137567 3.7669554 4.944518 4.3190538 5.5557332 4.8813558 C 6.2614729 5.5306175 7.1542248 6.6726222 7.3070475 7.1220459 C 7.3884558 7.3614603 7.3888166 7.6958551 7.3080811 7.9493856 C 7.1958204 8.3019157 6.6316395 9.0778904 5.9495076 9.8185221 C 5.3889302 10.427175 4.3753569 11.239887 3.8803833 11.477336 C 3.693628 11.566927 3.6539908 11.575272 3.3863566 11.583272 C 2.9356228 11.596609 2.7023992 11.510162 2.3931356 11.215853 C 1.9647425 10.808173 1.856547 10.117053 2.1430216 9.6175008 C 2.2752388 9.3869412 2.402257 9.2624528 2.7300659 9.0402751 C 2.9100569 8.918283 3.1769104 8.7222221 3.3233114 8.6051595 C 3.5800197 8.3998964 4.2840211 7.6999139 4.3413371 7.5928182 C 4.3651233 7.5483733 4.3292908 7.4972618 4.102592 7.2491699 C 3.7142112 6.8241389 3.207673 6.3941377 2.668571 6.0321899 C 2.3097797 5.7913004 2.1232913 5.5343147 2.0226156 5.141805 C 1.9114818 4.7085268 2.0788761 4.1912971 2.436027 3.8648804 C 2.6878883 3.6346939 2.9994998 3.5129647 3.319694 3.5077962 z M 10.210746 9.5410197 C 12.177422 9.5322323 12.305877 9.539367 12.586829 9.6702108 C 12.988418 9.8572346 13.187864 10.268004 13.080339 10.68772 C 13.002739 10.990623 12.816096 11.193262 12.496395 11.322306 L 12.337748 11.386385 L 10.39058 11.391553 C 8.2140054 11.397096 8.2237479 11.397809 7.9514526 11.213269 C 7.6536494 11.011442 7.5323973 10.758912 7.5597453 10.397298 C 7.5892645 10.00698 7.7913159 9.7649324 8.2150024 9.6118164 C 8.3883187 9.5491824 8.3911151 9.5491497 10.210746 9.5410197 z"/></svg>`;
var ICON_Y = 5;
var ACTIONS = [
  // ── private profile ──
  { name: "add-sub", fontChar: "~", x: -14, y: ICON_Y, hoverTint: 11075544, profile: "private" },
  { name: "edit", fontChar: "2", x: -2, y: ICON_Y, hoverTint: 13162751, profile: "private" },
  { name: "remove", fontChar: "Q", x: 7.9375, y: ICON_Y, hoverTint: 16763080, profile: "private" },
  {
    name: "search",
    svgMarkup: SEARCH_ICON_SVG,
    x: 19.25,
    y: ICON_Y,
    hoverTint: 13172680,
    profile: "private",
    visibleWhen: (ctx) => ctx.noImage
  },
  // ── public-own profile ──
  { name: "hide", svgMarkup: HIDE_ICON_SVG, x: 8.625, y: ICON_Y, hoverTint: 16767144, profile: "public-own" },
  // ── public-external profile ──
  { name: "adopt", svgMarkup: ADD_ICON_SVG, x: 8.625, y: ICON_Y, hoverTint: 11075544, profile: "public-external" },
  { name: "block", svgMarkup: BLOCK_ICON_SVG, x: -2, y: ICON_Y, hoverTint: 16763080, profile: "public-external" }
];
var HANDLED_ACTIONS = /* @__PURE__ */ new Set(["edit", "remove", "search", "add-sub", "hide", "adopt", "block"]);
var TileActionsDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "registers default tile overlay icons and handles their click actions";
  deps = {
    lineage: "@hypercomb.social/Lineage"
  };
  listens = ["render:host-ready", "tile:action"];
  emits = ["overlay:register-action", "search:prefill", "tile:hidden", "tile:blocked"];
  #registered = false;
  #effectsRegistered = false;
  heartbeat = async () => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true;
      this.onEffect("render:host-ready", () => {
        if (this.#registered) return;
        this.#registered = true;
        this.emitEffect("overlay:register-action", ACTIONS);
      });
      this.onEffect("tile:action", (payload) => {
        if (!HANDLED_ACTIONS.has(payload.action)) return;
        this.#handleAction(payload);
      });
    }
  };
  #handleAction(payload) {
    const { action, label: rawLabel } = payload;
    const label = normalizeSeed(rawLabel) || rawLabel;
    switch (action) {
      case "edit":
        break;
      case "remove":
        EffectBus.emit("seed:removed", { seed: label });
        break;
      case "search":
        EffectBus.emit("search:prefill", { value: label });
        break;
      case "add-sub":
        EffectBus.emit("search:prefill", { value: label + "/" });
        break;
      case "hide":
        this.#hideOrBlock(label, "hc:hidden-tiles", "tile:hidden");
        break;
      case "adopt":
        EffectBus.emit("seed:added", { seed: label });
        void new hypercomb().act();
        break;
      case "block":
        this.#hideOrBlock(label, "hc:blocked-tiles", "tile:blocked");
        break;
    }
  }
  #hideOrBlock(label, storagePrefix, effect) {
    const lineage = this.resolve("lineage");
    const location = lineage?.explorerLabel() ?? "/";
    const key = `${storagePrefix}:${location}`;
    const existing = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!existing.includes(label)) existing.push(label);
    localStorage.setItem(key, JSON.stringify(existing));
    EffectBus.emit(effect, { seed: label, location });
    void new hypercomb().act();
  }
};
var _tileActions = new TileActionsDrone();
window.ioc.register("@diamondcoreprocessor.com/TileActionsDrone", _tileActions);
export {
  TileActionsDrone
};
