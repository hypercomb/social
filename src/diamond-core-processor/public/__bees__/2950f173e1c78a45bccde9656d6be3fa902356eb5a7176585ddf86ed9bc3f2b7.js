// src/diamondcoreprocessor.com/history/layer-committer.drone.ts
import { EffectBus, SignatureService } from "@hypercomb/core";
var LayerCommitter = class {
  #scheduled = false;
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
   * Drone set for the layer. Reading from `window.ioc.list()` is not
   * stable during startup — drones self-register asynchronously, so
   * every early commit sees a larger set than the one before. The diff
   * then shows up as a cascade of "bees" entries on every refresh,
   * which is pure noise. Until a formal drone registry exists (the
   * stage-3 TODO), this returns an empty list so layer identity is
   * driven by actual user-facing state.
   */
  #readBees() {
    return [];
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
      version: 2,
      orientation: this.#layout.orientation,
      pivot: this.#layout.pivot,
      accent: this.#layout.accent,
      gapPx: this.#layout.gapPx,
      textOnly: this.#layout.textOnly
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
