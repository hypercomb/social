// src/diamondcoreprocessor.com/sharing/ambient-presence.drone.ts
import { Worker } from "@hypercomb/core";
var AmbientPresenceDrone = class extends Worker {
  namespace = "diamondcoreprocessor.com";
  deps = { mesh: "@diamondcoreprocessor.com/NostrMeshWorker" };
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
    const seeds = Array.isArray(evt.payload?.seeds) ? evt.payload.seeds : [];
    const now = Date.now();
    for (const seed of seeds) this.#lastSeenMs.set(seed, now);
    this.#emitHeat();
  };
  #emitHeat = () => {
    const now = Date.now();
    const heat = {};
    for (const [seed, ms] of this.#lastSeenMs) {
      const age = now - ms;
      if (age >= this.#ttlMs) {
        this.#lastSeenMs.delete(seed);
        continue;
      }
      heat[seed] = 1 - age / this.#ttlMs;
    }
    this.emitEffect("render:presence-heat", heat);
  };
  dispose = () => {
    this.#sub?.close();
  };
};
var _drone = new AmbientPresenceDrone();
window.ioc.register("@diamondcoreprocessor.com/AmbientPresenceDrone", _drone);
export {
  AmbientPresenceDrone
};
