// hypercomb-essentials/src/diamondcoreprocessor.com/history/history-recorder.drone.ts
import { EffectBus, SignatureService } from "@hypercomb/core";
var HistoryRecorder = class {
  #queue = Promise.resolve();
  constructor() {
    EffectBus.on("cell:added", (payload) => {
      if (payload?.cell) this.#enqueue("add", payload.cell);
    });
    EffectBus.on("cell:removed", (payload) => {
      if (payload?.cell) this.#enqueue("remove", payload.cell, payload.groupId);
    });
    EffectBus.on("tags:changed", (payload) => {
      if (payload?.updates?.length) this.#enqueueTagState(payload.updates);
    });
    EffectBus.on("cell:reorder", (payload) => {
      if (payload?.labels?.length) this.#enqueueReorderState(payload.labels);
    });
    EffectBus.on("tile:saved", (payload) => {
      if (payload?.cell) this.#enqueueContentState(payload.cell);
    });
    EffectBus.on("tile:hidden", (payload) => {
      if (payload?.cell) this.#enqueue("hide", payload.cell);
    });
    EffectBus.on("tile:unhidden", (payload) => {
      if (payload?.cell) this.#enqueue("unhide", payload.cell);
    });
    EffectBus.on("bee:disposed", (payload) => {
      if (payload?.iocKey) this.#enqueue("remove-drone", payload.iocKey);
    });
    EffectBus.on("layout:mode", (payload) => {
      if (payload?.mode) this.#enqueueLayoutState("mode", payload.mode);
    });
    EffectBus.on("render:set-orientation", (payload) => {
      if (payload != null) this.#enqueueLayoutState("orientation", payload.flat ? "flat-top" : "point-top");
    });
    EffectBus.on("render:set-pivot", (payload) => {
      if (payload != null) this.#enqueueLayoutState("pivot", String(payload.pivot));
    });
    EffectBus.on("overlay:neon-color", (payload) => {
      if (payload?.name) this.#enqueueLayoutState("accent", payload.name);
    });
    EffectBus.on("render:set-gap", (payload) => {
      if (payload?.gapPx != null) this.#enqueueLayoutState("gap", String(payload.gapPx));
    });
  }
  #enqueue(op, cell, groupId) {
    this.#queue = this.#queue.then(() => this.#recordOp(op, cell, groupId)).catch(() => {
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
  /**
   * Capture tag state as a signature-addressed resource.
   * Reads the FULL tag array from each affected cell's properties (post-change),
   * so reconstruction at any cursor position only needs the last tag-state per cell.
   */
  #enqueueTagState(updates) {
    this.#queue = this.#queue.then(async () => {
      const lineage = get("@hypercomb.social/Lineage");
      const historyService = get("@diamondcoreprocessor.com/HistoryService");
      const store = get("@hypercomb.social/Store");
      if (!lineage || !historyService || !store) return;
      const locationSig = await historyService.sign(lineage);
      const cellTags = {};
      for (const u of updates) {
        if (cellTags[u.cell]) continue;
        try {
          const explorerDir = lineage.explorerDir?.();
          if (explorerDir) {
            const cellDir = await explorerDir.getDirectoryHandle(u.cell, { create: false });
            const fileHandle = await cellDir.getFileHandle("0000");
            const file = await fileHandle.getFile();
            const props = JSON.parse(await file.text());
            cellTags[u.cell] = Array.isArray(props.tags) ? props.tags : [];
          }
        } catch {
          cellTags[u.cell] = [];
        }
      }
      const snapshot = {
        version: 1,
        cellTags,
        at: Date.now()
      };
      const json = JSON.stringify(snapshot, Object.keys(snapshot).sort(), 0);
      const blob = new Blob([json], { type: "application/json" });
      const bytes = await blob.arrayBuffer();
      const resourceSig = await SignatureService.sign(bytes);
      await store.putResource(blob);
      await historyService.record(locationSig, {
        op: "tag-state",
        cell: resourceSig,
        at: snapshot.at
      });
      const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
      if (cursor) await cursor.onNewOp();
    }).catch(() => {
    });
  }
  /**
   * Capture reorder state as a signature-addressed resource.
   * Records a `reorder` op whose `cell` field is the resource signature
   * pointing to the ordered cell list at reorder time.
   */
  #enqueueReorderState(labels) {
    this.#queue = this.#queue.then(async () => {
      const lineage = get("@hypercomb.social/Lineage");
      const historyService = get("@diamondcoreprocessor.com/HistoryService");
      const store = get("@hypercomb.social/Store");
      if (!lineage || !historyService || !store) return;
      const locationSig = await historyService.sign(lineage);
      const payload = JSON.stringify(labels);
      const blob = new Blob([payload], { type: "application/json" });
      await store.putResource(blob);
      const bytes = await blob.arrayBuffer();
      const resourceSig = await SignatureService.sign(bytes);
      await historyService.record(locationSig, {
        op: "reorder",
        cell: resourceSig,
        at: Date.now()
      });
      const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
      if (cursor) await cursor.onNewOp();
    }).catch(() => {
    });
  }
  /**
   * Capture content state as a signature-addressed resource.
   * Records the properties signature from the tile-props-index so that
   * point-in-time reconstruction can load the exact content at save time.
   */
  #enqueueContentState(cellLabel) {
    this.#queue = this.#queue.then(async () => {
      const lineage = get("@hypercomb.social/Lineage");
      const historyService = get("@diamondcoreprocessor.com/HistoryService");
      const store = get("@hypercomb.social/Store");
      if (!lineage || !historyService || !store) return;
      const locationSig = await historyService.sign(lineage);
      const indexKey = "hc:tile-props-index";
      const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
      const propertiesSig = index[cellLabel] ?? "";
      const snapshot = {
        version: 1,
        cellLabel,
        propertiesSig,
        at: Date.now()
      };
      const json = JSON.stringify(snapshot, Object.keys(snapshot).sort(), 0);
      const blob = new Blob([json], { type: "application/json" });
      const bytes = await blob.arrayBuffer();
      const resourceSig = await SignatureService.sign(bytes);
      await store.putResource(blob);
      await historyService.record(locationSig, {
        op: "content-state",
        cell: resourceSig,
        at: snapshot.at
      });
      const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
      if (cursor) await cursor.onNewOp();
    }).catch(() => {
    });
  }
  /**
   * Capture layout state as a signature-addressed resource.
   * Records layout property changes (mode, orientation, pivot, gap) as
   * snapshots for point-in-time reconstruction.
   */
  #enqueueLayoutState(property, value) {
    this.#queue = this.#queue.then(async () => {
      const lineage = get("@hypercomb.social/Lineage");
      const historyService = get("@diamondcoreprocessor.com/HistoryService");
      const store = get("@hypercomb.social/Store");
      if (!lineage || !historyService || !store) return;
      const locationSig = await historyService.sign(lineage);
      const snapshot = {
        version: 1,
        property,
        value,
        at: Date.now()
      };
      const json = JSON.stringify(snapshot, Object.keys(snapshot).sort(), 0);
      const blob = new Blob([json], { type: "application/json" });
      const bytes = await blob.arrayBuffer();
      const resourceSig = await SignatureService.sign(bytes);
      await store.putResource(blob);
      await historyService.record(locationSig, {
        op: "layout-state",
        cell: resourceSig,
        at: snapshot.at
      });
      const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
      if (cursor) await cursor.onNewOp();
    }).catch(() => {
    });
  }
};
var _historyRecorder = new HistoryRecorder();
window.ioc.register("@diamondcoreprocessor.com/HistoryRecorder", _historyRecorder);
export {
  HistoryRecorder
};
