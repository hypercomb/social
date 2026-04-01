// src/diamondcoreprocessor.com/history/history-recorder.drone.ts
import { EffectBus, hypercomb } from "@hypercomb/core";
var HistoryRecorder = class {
  #queue = Promise.resolve();
  constructor() {
    EffectBus.on("cell:added", (payload) => {
      if (payload?.cell) this.#enqueue("add", payload.cell);
    });
    EffectBus.on("cell:removed", (payload) => {
      if (payload?.cell) this.#enqueue("remove", payload.cell, payload.groupId);
    });
  }
  #enqueue(op, cell, groupId) {
    this.#queue = this.#queue.then(() => this.#recordOp(op, cell, groupId)).then(() => void new hypercomb().act()).catch(() => {
    });
  }
  async #recordOp(op, cell, groupId) {
    const lineage = get("@hypercomb.social/Lineage");
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    if (!lineage || !historyService) return;
    const sig = await historyService.sign(lineage);
    await historyService.record(sig, { op, cell, at: Date.now(), groupId });
    const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
    if (cursor) await cursor.onNewOp();
  }
};
var _historyRecorder = new HistoryRecorder();
window.ioc.register("@diamondcoreprocessor.com/HistoryRecorder", _historyRecorder);
export {
  HistoryRecorder
};
