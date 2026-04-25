// src/diamondcoreprocessor.com/history/layer-committer.drone.ts
import { EffectBus } from "@hypercomb/core";
var CommitMachine = class {
  #chain = Promise.resolve();
  #run;
  constructor(run) {
    this.#run = run;
  }
  request() {
    this.#chain = this.#chain.then(() => this.#run()).catch(() => {
    });
  }
};
var LayerCommitter = class {
  // Layout state is scattered across EffectBus effects. We subscribe at
  // construction and keep the latest value locally. Late subscribers get
  // the last-emitted value automatically (EffectBus replay).
  #layout = {
    version: 2,
    orientation: "point-top",
    pivot: false,
    accent: "",
    gapPx: 0,
    textOnly: false
  };
  // Single serialised commit machine for this committer. Every event
  // source — per-event lifecycle, microtask-batched layout changes,
  // synchronize — calls machine.request(). The machine collapses
  // same-turn requests and serialises cross-turn ones; commitLayer
  // dedup then absorbs any redundant identical content. Together
  // they guarantee one commit per distinct state change, no more.
  //
  // Leaf + ancestors still commit as one atomic #commit() call
  // inside the machine's #run — each ancestor is a merkle-chain
  // update cascading up from the leaf.
  #machine = new CommitMachine(() => this.#commit());
  constructor() {
    EffectBus.on("render:set-orientation", (p) => {
      if (p) {
        this.#layout = { ...this.#layout, orientation: p.flat ? "flat-top" : "point-top" };
        this.#schedule();
      }
    });
    EffectBus.on("render:set-pivot", (p) => {
      if (p != null) {
        this.#layout = { ...this.#layout, pivot: !!p.pivot };
        this.#schedule();
      }
    });
    EffectBus.on("overlay:neon-color", (p) => {
      if (p?.name) {
        this.#layout = { ...this.#layout, accent: p.name };
        this.#schedule();
      }
    });
    EffectBus.on("render:set-gap", (p) => {
      if (p?.gapPx != null) {
        this.#layout = { ...this.#layout, gapPx: p.gapPx };
        this.#schedule();
      }
    });
    EffectBus.on("render:set-text-only", (p) => {
      if (p?.textOnly != null) {
        this.#layout = { ...this.#layout, textOnly: !!p.textOnly };
        this.#schedule();
      }
    });
    EffectBus.on("cell:added", () => this.#queueCommit());
    EffectBus.on("cell:removed", () => this.#queueCommit());
    EffectBus.on("tile:saved", () => this.#queueCommit());
    EffectBus.on("tags:changed", () => this.#queueCommit());
    EffectBus.on("tile:hidden", () => this.#queueCommit());
    EffectBus.on("tile:unhidden", () => this.#queueCommit());
  }
  // All commit requests — batched or per-event — route through the
  // single CommitMachine. See the class above for the state transitions.
  #schedule() {
    this.#machine.request();
  }
  #queueCommit() {
    this.#machine.request();
  }
  async #commit() {
    const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
    if (cursor?.state?.rewound) {
      console.log("[commit] skip: cursor rewound");
      return;
    }
    const lineage = get("@hypercomb.social/Lineage");
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!lineage || !history) {
      console.log("[commit] skip: missing lineage or history", { lineage: !!lineage, history: !!history });
      return;
    }
    const segments = [...lineage.explorerSegments?.() ?? []];
    const leafLocSig = await history.sign(lineage);
    const leafLayer = await this.#assembleLayer(lineage, leafLocSig);
    const leafSig = await history.commitLayer(leafLocSig, leafLayer);
    console.log("[commit] leaf", {
      segments,
      cells: leafLayer.cells.length,
      sig: leafSig?.slice(0, 8) ?? "(none)"
    });
    for (let i = segments.length - 1; i >= 0; i--) {
      const ancestorSegments = segments.slice(0, i);
      const ancestorLineage = {
        domain: lineage.domain,
        explorerDir: lineage.explorerDir,
        explorerSegments: () => ancestorSegments
      };
      const ancestorLocSig = await history.sign(ancestorLineage);
      const ancestorLayer = await this.#assembleLayer(ancestorLineage, ancestorLocSig);
      const ancestorSig = await history.commitLayer(ancestorLocSig, ancestorLayer);
      console.log("[commit] ancestor", {
        segments: ancestorSegments,
        cells: ancestorLayer.cells.length,
        sig: ancestorSig?.slice(0, 8) ?? "(none)"
      });
    }
    const cursorAfter = get("@diamondcoreprocessor.com/HistoryCursorService");
    if (cursorAfter) await cursorAfter.onNewLayer();
  }
  /**
   * Build the slim layer snapshot — `cells` (ordered) + `hidden` (set).
   *
   * Source of truth = what is actually on screen. Cells = the OPFS cell
   * directory listing (the same set the renderer at head walks). Order
   * comes from OrderProjection but is INTERSECTED with the directory
   * listing so the layer can never claim cells that don't exist on disk.
   * Any directory cell that the projection doesn't have an order for is
   * appended at the end.
   */
  async #assembleLayer(lineage, locationSig) {
    const explorerDir = await lineage.explorerDir?.();
    const onDisk = /* @__PURE__ */ new Set();
    if (explorerDir) {
      for await (const [name, handle] of explorerDir.entries()) {
        if (handle.kind === "directory") onDisk.add(name);
      }
    }
    const order = get("@diamondcoreprocessor.com/OrderProjection");
    const ordered = order?.peek(locationSig) ?? await order?.hydrate(locationSig) ?? [];
    const cells = [];
    const seen = /* @__PURE__ */ new Set();
    for (const cell of ordered) {
      if (onDisk.has(cell) && !seen.has(cell)) {
        cells.push(cell);
        seen.add(cell);
      }
    }
    for (const cell of onDisk) {
      if (!seen.has(cell)) {
        cells.push(cell);
        seen.add(cell);
      }
    }
    const hidden = this.#readHidden(lineage);
    return { cells, hidden };
  }
  /**
   * Read the set of hidden cells for the active location directly from
   * localStorage. ShowCellDrone writes this key on `tile:hidden` /
   * `tile:unhidden`, so it is always up-to-date when `synchronize` fires.
   */
  #readHidden(lineage) {
    const locationKey = String(lineage.explorerLabel?.() ?? "/");
    try {
      const raw = localStorage.getItem(`hc:hidden-tiles:${locationKey}`);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  // Layout signing / instruction-sig reading were both layer-driven —
  // the layer captured a `layoutSig` and `instructionsSig`. The slim
  // layer doesn't carry either; layout and instructions are bee-owned
  // primitives, and any per-position playback (e.g., undo of a layout
  // gap change) is the responsibility of the layout/instruction bee
  // tracking its own per-state primitive. Removed from the committer.
};
var _layerCommitter = new LayerCommitter();
window.ioc.register("@diamondcoreprocessor.com/LayerCommitter", _layerCommitter);
export {
  LayerCommitter
};
