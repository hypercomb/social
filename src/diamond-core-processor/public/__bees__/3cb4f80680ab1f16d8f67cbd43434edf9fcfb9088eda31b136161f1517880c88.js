// src/diamondcoreprocessor.com/substrate/substrate.drone.ts
import { Drone, EffectBus } from "@hypercomb/core";
var get = (key) => window.ioc?.get?.(key);
var REROLL_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`;
var SubstrateDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "Auto-assign substrate background images to new cells";
  constructor() {
    super();
    const iconRegistry = get("@hypercomb.social/IconProviderRegistry");
    iconRegistry?.add({
      name: "reroll",
      owner: "@diamondcoreprocessor.com/SubstrateDrone",
      svgMarkup: REROLL_ICON_SVG,
      profile: "private",
      hoverTint: 14207231,
      visibleWhen: (ctx) => ctx.hasSubstrate,
      labelKey: "action.reroll",
      descriptionKey: "action.reroll.description"
    });
  }
  listens = [
    "cell:added",
    "cell:removed",
    "substrate:changed",
    "substrate:folder-permission",
    "drop:pending",
    "clipboard:paste-start",
    "clipboard:paste-done",
    "editor:mode",
    "render:cell-count",
    "cell:attach-pending",
    "indicator:click"
  ];
  emits = ["substrate:applied", "substrate:ready", "indicator:set", "indicator:clear", "substrate-organizer:open", "activity:log"];
  #initialized = false;
  #dropPending = false;
  #pastePending = false;
  #editorActive = false;
  #visibilityBound = false;
  #pendingPermissionHandleId = null;
  /** Cells with a user-provided resource being attached — substrate must not touch these. */
  #attachPending = /* @__PURE__ */ new Set();
  heartbeat = async () => {
    if (this.#initialized) return;
    this.#initialized = true;
    const service = this.#service();
    if (service) {
      void service.warmUp().then(() => {
        this.#syncIndicator();
        EffectBus.emit("substrate:ready", {});
      });
    }
    this.onEffect("drop:pending", (p) => {
      this.#dropPending = p?.active ?? false;
    });
    this.onEffect("clipboard:paste-start", () => {
      this.#pastePending = true;
    });
    this.onEffect("clipboard:paste-done", () => {
      this.#pastePending = false;
    });
    this.onEffect("editor:mode", (p) => {
      this.#editorActive = p?.active ?? false;
    });
    this.onEffect("cell:attach-pending", ({ cell, pending }) => {
      if (!cell) return;
      if (pending) this.#attachPending.add(cell);
      else this.#attachPending.delete(cell);
    });
    this.onEffect("cell:added", ({ cell }) => {
      if (!cell) return;
      if (this.#dropPending || this.#pastePending || this.#editorActive) return;
      if (this.#attachPending.has(cell)) return;
      const svc = this.#service();
      if (svc?.applyToCell(cell)) EffectBus.emit("substrate:applied", { cell });
    });
    this.onEffect("cell:removed", ({ cell }) => {
      if (!cell) return;
      this.#service()?.clearCell(cell);
    });
    this.onEffect("render:cell-count", (payload) => {
      const labels = payload?.noImageLabels;
      if (!labels?.length) return;
      const svc = this.#service();
      if (!svc) return;
      const filtered = this.#attachPending.size ? labels.filter((l) => !this.#attachPending.has(l)) : labels;
      if (filtered.length === 0) return;
      const applied = svc.applyToAllBlanks(filtered);
      for (const cell of applied) EffectBus.emit("substrate:applied", { cell });
    });
    this.onEffect("substrate:changed", () => {
      const svc = this.#service();
      if (!svc) return;
      void svc.warmUp().then(() => {
        this.#syncIndicator();
        EffectBus.emit("substrate:ready", {});
      });
    });
    this.onEffect("substrate:folder-permission", ({ handleId, permission }) => {
      if (permission === "granted") return;
      this.#pendingPermissionHandleId = handleId;
      EffectBus.emit("indicator:set", {
        key: "substrate-reconnect",
        icon: "\u25C8",
        label: "Substrate folder \u2014 click to reconnect"
      });
    });
    this.onEffect("indicator:click", async ({ key }) => {
      const svc = this.#service();
      if (!svc) return;
      if (key === "substrate-reconnect" && this.#pendingPermissionHandleId) {
        const result = await svc.requestFolderAccess(this.#pendingPermissionHandleId);
        if (result === "granted") {
          EffectBus.emit("indicator:clear", { key: "substrate-reconnect" });
          this.#pendingPermissionHandleId = null;
          await svc.warmUp();
          this.#syncIndicator();
          EffectBus.emit("activity:log", { message: "substrate folder reconnected", icon: "\u25C8" });
        } else {
          EffectBus.emit("activity:log", { message: "substrate folder access denied", icon: "\u25C8" });
        }
        return;
      }
      if (key === "substrate") {
        EffectBus.emit("substrate-organizer:open", {});
      }
    });
    if (!this.#visibilityBound && typeof document !== "undefined") {
      this.#visibilityBound = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        const s = this.#service();
        if (!s) return;
        const active = s.resolvedSource;
        if (active?.type !== "folder") return;
        void s.warmUp();
      });
    }
  };
  #syncIndicator() {
    EffectBus.emit("indicator:clear", { key: "substrate" });
  }
  #service() {
    return get("@diamondcoreprocessor.com/SubstrateService");
  }
};
var _substrateDrone = new SubstrateDrone();
window.ioc.register("@diamondcoreprocessor.com/SubstrateDrone", _substrateDrone);
export {
  SubstrateDrone
};
