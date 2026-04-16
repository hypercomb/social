// src/diamondcoreprocessor.com/history/layer-committer.drone.ts
import { EffectBus, SignatureService } from "@hypercomb/core";
var LayerCommitter = class {
  #scheduled = false;
  // Layout state is scattered across EffectBus effects. We subscribe at
  // construction and keep the latest value locally. Late subscribers get
  // the last-emitted value automatically (EffectBus replay).
  #layout = {
    version: 1,
    mode: "",
    orientation: "point-top",
    pivot: false,
    accent: "",
    gapPx: 0
  };
  constructor() {
    EffectBus.on("layout:mode", (p) => {
      if (p?.mode) this.#layout = { ...this.#layout, mode: p.mode };
    });
    EffectBus.on("render:set-orientation", (p) => {
      if (p) this.#layout = { ...this.#layout, orientation: p.flat ? "flat-top" : "point-top" };
    });
    EffectBus.on("render:set-pivot", (p) => {
      if (p != null) this.#layout = { ...this.#layout, pivot: !!p.pivot };
    });
    EffectBus.on("overlay:neon-color", (p) => {
      if (p?.name) this.#layout = { ...this.#layout, accent: p.name };
    });
    EffectBus.on("render:set-gap", (p) => {
      if (p?.gapPx != null) this.#layout = { ...this.#layout, gapPx: p.gapPx };
    });
    window.addEventListener("synchronize", () => this.#schedule());
    EffectBus.on("render:cell-count", () => this.#schedule());
  }
  #schedule() {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(async () => {
      this.#scheduled = false;
      try {
        await this.#commit();
      } catch {
      }
    });
  }
  async #commit() {
    const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
    if (cursor?.state?.rewound) return;
    const lineage = get("@hypercomb.social/Lineage");
    const history = get("@diamondcoreprocessor.com/HistoryService");
    if (!lineage || !history) return;
    const locationSig = await history.sign(lineage);
    const layer = await this.#assembleLayer(lineage, locationSig);
    const layerSig = await history.commitLayer(locationSig, layer);
    if (layerSig) {
      const cursor2 = get("@diamondcoreprocessor.com/HistoryCursorService");
      if (cursor2) await cursor2.onNewLayer();
    }
  }
  /**
   * Build the full layer snapshot from live state sources.
   */
  async #assembleLayer(lineage, locationSig) {
    const order = get("@diamondcoreprocessor.com/OrderProjection");
    const cells = order?.peek(locationSig) ?? await order?.hydrate(locationSig) ?? [];
    const { contentByCell, tagsByCell } = await this.#readCellState(lineage, cells);
    const bees = this.#readBees();
    const hidden = this.#readHidden(lineage);
    const notesByCell = this.#readNotesIndex(cells);
    const layoutSig = await this.#signLayout();
    const instructionsSig = this.#readInstructionsSig();
    const dependencies = [];
    return {
      version: 2,
      cells,
      hidden,
      contentByCell,
      tagsByCell,
      notesByCell,
      bees,
      dependencies,
      layoutSig,
      instructionsSig
    };
  }
  /**
   * Read the per-cell `noteSetSig` index that NotesService maintains.
   * Filtered to the cells present in this snapshot so dangling pointers
   * for removed cells are not folded into the layer.
   */
  #readNotesIndex(cells) {
    const notes = get("@diamondcoreprocessor.com/NotesService");
    if (!notes?.readIndex) return {};
    const all = notes.readIndex();
    const present = new Set(cells);
    const out = {};
    for (const cell of Object.keys(all)) {
      if (!present.has(cell)) continue;
      const sig = all[cell];
      if (sig) out[cell] = sig;
    }
    return out;
  }
  async #readCellState(lineage, cells) {
    const contentByCell = {};
    const tagsByCell = {};
    let tilePropsIndex = {};
    try {
      tilePropsIndex = JSON.parse(localStorage.getItem("hc:tile-props-index") ?? "{}");
    } catch {
      tilePropsIndex = {};
    }
    const explorerDir = lineage.explorerDir?.();
    if (!explorerDir) return { contentByCell, tagsByCell };
    for (const cell of cells) {
      const contentSig = tilePropsIndex[cell];
      if (contentSig) contentByCell[cell] = contentSig;
      try {
        const cellDir = await explorerDir.getDirectoryHandle(cell, { create: false });
        const propsHandle = await cellDir.getFileHandle("0000");
        const file = await propsHandle.getFile();
        const props = JSON.parse(await file.text());
        if (Array.isArray(props.tags) && props.tags.length > 0) {
          tagsByCell[cell] = props.tags.map((t) => String(t));
        }
      } catch {
      }
    }
    return { contentByCell, tagsByCell };
  }
  /**
   * Capture the set of currently-registered IoC keys as the layer's bees.
   * Today the IoC contains all services (not just drones), but the
   * canonical sort in HistoryService.canonicalizeLayer keeps this stable.
   *
   * TODO(stage-3): narrow to drone-only keys when a formal drone registry
   * exists.
   */
  #readBees() {
    const ioc = window.ioc;
    if (typeof ioc?.list !== "function") return [];
    return [...ioc.list()];
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
  /**
   * Sign the current layout snapshot and store it as a resource. The
   * returned signature is referenced by the layer; identical layouts
   * dedupe to the same resource.
   */
  async #signLayout() {
    const canonical = {
      version: 1,
      mode: this.#layout.mode,
      orientation: this.#layout.orientation,
      pivot: this.#layout.pivot,
      accent: this.#layout.accent,
      gapPx: this.#layout.gapPx
    };
    const json = JSON.stringify(canonical);
    const bytes = new TextEncoder().encode(json).buffer;
    const sig = await SignatureService.sign(bytes);
    const store = get("@hypercomb.social/Store");
    if (store) {
      await store.putResource(new Blob([json], { type: "application/json" }));
    }
    return sig;
  }
  /**
   * Read the current instruction settings signature from the
   * InstructionDrone. Returns "" when no instructions are configured for
   * this location.
   */
  #readInstructionsSig() {
    const drone = get("@diamondcoreprocessor.com/InstructionDrone");
    return drone?.state?.settingsSig ?? "";
  }
};
var _layerCommitter = new LayerCommitter();
window.ioc.register("@diamondcoreprocessor.com/LayerCommitter", _layerCommitter);
export {
  LayerCommitter
};
