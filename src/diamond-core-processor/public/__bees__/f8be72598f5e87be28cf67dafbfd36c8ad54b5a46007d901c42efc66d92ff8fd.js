// src/diamondcoreprocessor.com/sharing/ambient-presence.worker.ts
import { Worker } from "@hypercomb/core";
var AmbientPresenceWorker = class extends Worker {
  namespace = "diamondcoreprocessor.com";
  genotype = "sharing";
  description = "Aggregates peer presence into a heat map overlay by tracking mesh event timestamps.";
  effects = ["network"];
  deps = { mesh: "@diamondcoreprocessor.com/NostrMeshDrone" };
  listens = ["mesh:ensure-started"];
  emits = ["render:presence-heat"];
  #sub = null;
  #currentSig = "";
  #lastSeenMs = /* @__PURE__ */ new Map();
  #ttlMs = 12e4;
  // match mesh TTL
  act = async () => {
    this.onEffect("mesh:ensure-started", ({ signature }) => {
      if (signature === this.#currentSig) return;
      this.#sub?.close();
      this.#currentSig = signature;
      this.#lastSeenMs.clear();
      const mesh = this.resolve("mesh");
      if (!mesh) return;
      this.#sub = mesh.subscribe(signature, (evt) => this.#onEvent(evt));
    });
  };
  #onEvent = (evt) => {
    const cells = Array.isArray(evt.payload?.cells) ? evt.payload.cells : Array.isArray(evt.payload?.seeds) ? evt.payload.seeds : [];
    const now = Date.now();
    for (const cell of cells) this.#lastSeenMs.set(cell, now);
    this.#emitHeat();
  };
  #emitHeat = () => {
    const now = Date.now();
    const heat = {};
    for (const [cell, ms] of this.#lastSeenMs) {
      const age = now - ms;
      if (age >= this.#ttlMs) {
        this.#lastSeenMs.delete(cell);
        continue;
      }
      heat[cell] = 1 - age / this.#ttlMs;
    }
    this.emitEffect("render:presence-heat", heat);
  };
  dispose = () => {
    this.#sub?.close();
  };
};
var _drone = new AmbientPresenceWorker();
window.ioc.register("@diamondcoreprocessor.com/AmbientPresenceWorker", _drone);
export {
  AmbientPresenceWorker
};
