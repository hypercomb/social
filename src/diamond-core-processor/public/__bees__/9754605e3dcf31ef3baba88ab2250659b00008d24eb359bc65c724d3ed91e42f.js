// src/diamondcoreprocessor.com/history/history-recorder.drone.ts
import { EffectBus, hypercomb } from "@hypercomb/core";
var HistoryRecorder = class {
  #queue = Promise.resolve();
  constructor() {
    EffectBus.on("seed:added", (payload) => {
      if (payload?.seed) this.#enqueue("add", payload.seed);
    });
    EffectBus.on("seed:removed", (payload) => {
      if (payload?.seed) this.#enqueue("remove", payload.seed, payload.groupId);
    });
  }
  #enqueue(op, seed, groupId) {
    this.#queue = this.#queue.then(() => this.#recordOp(op, seed, groupId)).then(() => void new hypercomb().act()).catch(() => {
    });
  }
  async #recordOp(op, seed, groupId) {
    const lineage = get("@hypercomb.social/Lineage");
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!lineage || !historyService) return;
    const sig = await historyService.sign(lineage);
    await historyService.record(sig, { op, seed, at: Date.now(), groupId });
    const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
    if (cursor) await cursor.onNewOp();
  }
};
var _historyRecorder = new HistoryRecorder();
window.ioc.register("@diamondcoreprocessor.com/HistoryRecorder", _historyRecorder);
export {
  HistoryRecorder
};
