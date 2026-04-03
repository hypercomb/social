// src/diamondcoreprocessor.com/substrate/substrate.drone.ts
import { Drone, EffectBus } from "@hypercomb/core";
var get = (key) => window.ioc?.get?.(key);
var SubstrateDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "Auto-assign substrate background images to new cells";
  listens = ["cell:added", "cell:removed", "substrate:changed", "drop:pending", "clipboard:paste-start", "editor:mode", "render:cell-count"];
  emits = ["substrate:applied"];
  #initialized = false;
  #dropPending = false;
  #pastePending = false;
  #editorActive = false;
  heartbeat = async () => {
    if (this.#initialized) return;
    this.#initialized = true;
    const service = this.#service();
    if (service) void service.warmUp();
    this.onEffect("drop:pending", (payload) => {
      this.#dropPending = payload?.active ?? false;
    });
    this.onEffect("clipboard:paste-start", () => {
      this.#pastePending = true;
    });
    this.onEffect("clipboard:paste-done", () => {
      this.#pastePending = false;
    });
    this.onEffect("editor:mode", (payload) => {
      this.#editorActive = payload?.active ?? false;
    });
    this.onEffect("cell:added", ({ cell }) => {
      if (!cell) return;
      if (this.#dropPending || this.#pastePending || this.#editorActive) return;
      const svc = this.#service();
      if (svc?.applyToCell(cell)) {
        EffectBus.emit("substrate:applied", { cell });
      }
    });
    this.onEffect("cell:removed", ({ cell }) => {
      if (!cell) return;
      const svc = this.#service();
      svc?.clearCell(cell);
    });
    this.onEffect("render:cell-count", (payload) => {
      if (!payload?.noImageLabels?.length) return;
      const svc = this.#service();
      if (!svc) return;
      const applied = svc.applyToAllBlanks(payload.noImageLabels);
      if (applied.length > 0) {
        for (const cell of applied) {
          EffectBus.emit("substrate:applied", { cell });
        }
      }
    });
    this.onEffect("substrate:changed", () => {
      const svc = this.#service();
      if (svc) {
        svc.invalidateCache();
        void svc.warmUp();
      }
    });
  };
  #service() {
    return get("@diamondcoreprocessor.com/SubstrateService");
  }
};
var _substrateDrone = new SubstrateDrone();
window.ioc.register("@diamondcoreprocessor.com/SubstrateDrone", _substrateDrone);
export {
  SubstrateDrone
};
