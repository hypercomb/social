// src/diamondcoreprocessor.com/history/rewound-commit.drone.ts
import { Drone, EffectBus } from "@hypercomb/core";
var RewoundCommitDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "Reconciles mode, selection, and user feedback after a rewound-state promotion.";
  #toastShown = false;
  deps = {
    selection: "@diamondcoreprocessor.com/SelectionService",
    move: "@diamondcoreprocessor.com/MoveDrone"
  };
  listens = ["history:promoted"];
  emits = ["controls:action", "toast:show"];
  #registered = false;
  heartbeat = async () => {
    if (this.#registered) return;
    this.#registered = true;
    this.onEffect("history:promoted", (payload) => {
      if (!payload) return;
      this.#reconcileSelection(payload.survivingCells);
      this.#ensureMoveMode();
      this.#showBranchToast();
    });
  };
  #reconcileSelection(survivingCells) {
    const selection = this.resolve("selection");
    if (!selection) return;
    const surviving = new Set(survivingCells);
    const current = [...selection.selected];
    const stale = current.filter((label) => !surviving.has(label));
    if (stale.length === 0) return;
    for (const label of stale) selection.remove(label);
  }
  #ensureMoveMode() {
    const move = this.resolve("move");
    if (!move) return;
    if (move.moveActive) return;
    EffectBus.emit("controls:action", { action: "move" });
  }
  #showBranchToast() {
    if (this.#toastShown) return;
    this.#toastShown = true;
    EffectBus.emit("toast:show", {
      type: "info",
      title: "New path forward",
      message: "Editing from an earlier state \u2014 your changes create a new branch from here."
    });
  }
};
var _rewoundCommit = new RewoundCommitDrone();
window.ioc.register("@diamondcoreprocessor.com/RewoundCommitDrone", _rewoundCommit);
export {
  RewoundCommitDrone
};
