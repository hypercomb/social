// hypercomb-essentials/src/diamondcoreprocessor.com/substrate/substrate.drone.ts
import { Drone, EffectBus } from "@hypercomb/core";
var get = (key) => window.ioc?.get?.(key);
var SubstrateDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "Auto-assign substrate background images to new cells";
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
    "indicator:click"
  ];
  emits = ["substrate:applied", "substrate:ready", "indicator:set", "indicator:clear", "substrate-organizer:open", "activity:log"];
  #initialized = false;
  #dropPending = false;
  #pastePending = false;
  #editorActive = false;
  #visibilityBound = false;
  #pendingPermissionHandleId = null;
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
    this.onEffect("cell:added", ({ cell }) => {
      if (!cell) return;
      if (this.#dropPending || this.#pastePending || this.#editorActive) return;
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
      const applied = svc.applyToAllBlanks(labels);
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
    const svc = this.#service();
    if (!svc) return;
    if (svc.pickRandomImageSync()) {
      EffectBus.emit("indicator:set", { key: "substrate", icon: "\u25C8", label: "Substrate \u2014 click to organize" });
    } else {
      EffectBus.emit("indicator:clear", { key: "substrate" });
    }
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
