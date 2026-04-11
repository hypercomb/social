// hypercomb-essentials/src/diamondcoreprocessor.com/move/move.drone.ts
import { Drone, EffectBus, hypercomb } from "@hypercomb/core";

// hypercomb-essentials/src/diamondcoreprocessor.com/editor/tile-properties.ts
var TILE_PROPERTIES_FILE = "0000";
var readCellProperties = async (cellDir) => {
  try {
    const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return {};
  }
};
var writeCellProperties = async (cellDir, updates) => {
  const existing = await readCellProperties(cellDir);
  const merged = { ...existing, ...updates };
  const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(merged));
  await writable.close();
};

// hypercomb-essentials/src/diamondcoreprocessor.com/move/move.drone.ts
function axialKey(q, r) {
  return `${q},${r}`;
}
var MoveDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "movement";
  description = "Coordinates multi-tile drag-and-drop \u2014 tracks move state, computes reorder, and commits placement.";
  effects = ["render"];
  #canvas = null;
  #container = null;
  #renderer = null;
  #meshOffset = { x: 0, y: 0 };
  #moveActive = false;
  #activeSource = null;
  #anchorAxial = null;
  #movedGroup = /* @__PURE__ */ new Map();
  // label → original axial
  #occupancy = /* @__PURE__ */ new Map();
  // axialKey → label
  #labelToKey = /* @__PURE__ */ new Map();
  // label → axialKey (reverse map)
  #keyToIndex = /* @__PURE__ */ new Map();
  // axialKey → index (for reordering)
  #cellLabels = [];
  #cellCoords = [];
  #cellCount = 0;
  // ── layer dwell state ────────────────────────────────────
  #branchLabels = /* @__PURE__ */ new Set();
  #dwellLabel = null;
  #dwellTimer = null;
  #dwellStart = 0;
  #dwellRaf = 0;
  #droppedThrough = false;
  #pendingDragLabel = null;
  #pendingSource = null;
  get moveActive() {
    return this.#moveActive;
  }
  get isDwelling() {
    return this.#dwellLabel !== null;
  }
  get branchLabels() {
    return this.#branchLabels;
  }
  labelAtAxial = (axial) => {
    for (let i = 0; i < this.#cellLabels.length; i++) {
      const coord = this.#cellCoords[i];
      if (coord && coord.q === axial.q && coord.r === axial.r) {
        return this.#cellLabels[i] ?? null;
      }
    }
    return null;
  };
  deps = {
    desktopMove: "@diamondcoreprocessor.com/DesktopMoveInput",
    touchMove: "@diamondcoreprocessor.com/TouchMoveInput",
    detector: "@diamondcoreprocessor.com/HexDetector",
    axial: "@diamondcoreprocessor.com/AxialService",
    layout: "@diamondcoreprocessor.com/LayoutService",
    lineage: "@hypercomb.social/Lineage",
    selection: "@diamondcoreprocessor.com/SelectionService",
    transfer: "@diamondcoreprocessor.com/LayerTransferService"
  };
  listens = ["render:host-ready", "render:cell-count", "render:mesh-offset", "controls:action"];
  emits = ["move:preview", "move:committed", "move:mode", "cell:reorder", "move:layer-dwell"];
  #effectsRegistered = false;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("render:host-ready", (payload) => {
      this.#canvas = payload.canvas;
      this.#container = payload.container;
      this.#renderer = payload.renderer;
      const refs = {
        canvas: this.#canvas,
        container: this.#container,
        renderer: this.#renderer,
        getMeshOffset: () => this.#meshOffset
      };
      const desktopMove = this.resolve("desktopMove");
      desktopMove?.attach(this, refs);
      const touchMove = this.resolve("touchMove");
      touchMove?.attach(this, refs);
    });
    this.onEffect("render:cell-count", (payload) => {
      this.#branchLabels = new Set(payload.branchLabels ?? []);
      if (this.#pendingDragLabel && payload.labels.includes(this.#pendingDragLabel)) {
        this.#cellCount = payload.count;
        this.#cellLabels = payload.labels;
        this.#cellCoords = payload.coords ?? [];
        this.#autoResumeDrag();
        return;
      }
      if (this.#activeSource && this.#activeSource !== "command") return;
      this.#cellCount = payload.count;
      this.#cellLabels = payload.labels;
      this.#cellCoords = payload.coords ?? [];
    });
    this.onEffect("render:mesh-offset", (offset) => {
      this.#meshOffset = offset;
    });
    let ready = false;
    this.onEffect("controls:action", (payload) => {
      if (!ready) return;
      if (payload.action === "move") this.#toggleMode();
    });
    ready = true;
  };
  stop = async () => {
    const desktopMove = this.resolve("desktopMove");
    desktopMove?.detach();
    const touchMove = this.resolve("touchMove");
    touchMove?.detach();
  };
  // ── move mode toggle ──────────────────────────────────
  #toggleMode() {
    this.#moveActive = !this.#moveActive;
    if (!this.#moveActive && this.#activeSource) {
      this.emitEffect("move:preview", null);
      this.#reset(this.#activeSource);
    }
    this.emitEffect("move:mode", { active: this.#moveActive });
  }
  // ── exclusivity ──────────────────────────────────────────
  #begin = (source) => {
    if (this.#activeSource && this.#activeSource !== source) return false;
    this.#activeSource = source;
    return true;
  };
  #end = (source) => {
    if (this.#activeSource === source) this.#activeSource = null;
  };
  // ── public API (called by input handlers) ────────────────
  beginMove = (anchorAxial, source) => {
    if (!this.#moveActive) return false;
    if (!this.#begin(source)) return false;
    const anchorKey = axialKey(anchorAxial.q, anchorAxial.r);
    const axialSvc = this.resolve("axial");
    if (!axialSvc?.items) {
      this.#end(source);
      return false;
    }
    this.#occupancy.clear();
    this.#labelToKey.clear();
    this.#keyToIndex.clear();
    for (const [i, coord] of axialSvc.items) {
      const key = axialKey(coord.q, coord.r);
      this.#keyToIndex.set(key, i);
    }
    for (let i = 0; i < this.#cellLabels.length; i++) {
      const label = this.#cellLabels[i];
      if (!label) continue;
      const coord = this.#cellCoords[i];
      if (!coord) continue;
      const key = axialKey(coord.q, coord.r);
      this.#occupancy.set(key, label);
      this.#labelToKey.set(label, key);
    }
    const anchorLabel = this.#occupancy.get(anchorKey);
    if (!anchorLabel) {
      this.#end(source);
      return false;
    }
    const selection = this.resolve("selection");
    const selected = selection?.selected;
    this.#movedGroup.clear();
    if (selected && selected.size > 0) {
      if (!selected.has(anchorLabel)) {
        this.#end(source);
        return false;
      }
      for (let i = 0; i < this.#cellLabels.length; i++) {
        const label = this.#cellLabels[i];
        if (!label) continue;
        const coord = this.#cellCoords[i];
        if (!coord) continue;
        if (selected.has(label)) {
          this.#movedGroup.set(label, { q: coord.q, r: coord.r });
        }
      }
    } else {
      this.#movedGroup.set(anchorLabel, { q: anchorAxial.q, r: anchorAxial.r });
    }
    console.log("[move] beginMove", { anchorLabel, selectedLabels: selected ? [...selected] : [], movedGroupSize: this.#movedGroup.size, movedLabels: [...this.#movedGroup.keys()], cellCount: this.#cellCount, cellLabelsLen: this.#cellLabels.length, cellLabels: [...this.#cellLabels] });
    this.#anchorAxial = anchorAxial;
    return true;
  };
  updateMove = (hoverAxial, source) => {
    if (this.#activeSource !== source) return;
    if (!this.#anchorAxial) return;
    if (this.#droppedThrough) {
      const insertOrder = this.#computeInsertPlacements(hoverAxial);
      const movedLabels2 = new Set(this.#movedGroup.keys());
      const axialSvc = this.resolve("axial");
      const gridSize = axialSvc?.count ?? 0;
      const names = new Array(Math.max(gridSize, insertOrder.length)).fill("");
      for (let i = 0; i < insertOrder.length; i++) {
        if (insertOrder[i]) names[i] = insertOrder[i];
      }
      this.emitEffect("move:preview", { names, movedLabels: movedLabels2 });
      return;
    }
    const diff = {
      q: hoverAxial.q - this.#anchorAxial.q,
      r: hoverAxial.r - this.#anchorAxial.r
    };
    const placements = this.#computePlacements(diff);
    const reordered = this.#reorderNames(placements);
    const movedLabels = new Set(this.#movedGroup.keys());
    this.emitEffect("move:preview", { names: reordered, movedLabels });
  };
  commitMoveAt = async (finalAxial, source) => {
    if (this.#activeSource !== source) return;
    this.cancelDwell();
    if (!this.#anchorAxial) {
      this.#reset(source);
      return;
    }
    if (this.#droppedThrough) {
      const insertOrder = this.#computeInsertPlacements(finalAxial).filter((n) => n !== "");
      this.emitEffect("cell:reorder", { labels: insertOrder });
      const lineage = this.resolve("lineage");
      const layout = this.resolve("layout");
      if (layout && lineage?.explorerDir) {
        const dir = await lineage.explorerDir();
        if (dir) await layout.write(dir, insertOrder);
      }
      this.emitEffect("move:preview", null);
      this.emitEffect("move:committed", { order: insertOrder });
      this.#droppedThrough = false;
      this.#reset(source);
      void new hypercomb().act();
      return;
    }
    const diff = {
      q: finalAxial.q - this.#anchorAxial.q,
      r: finalAxial.r - this.#anchorAxial.r
    };
    if (diff.q === 0 && diff.r === 0) {
      this.#reset(source);
      return;
    }
    const placements = this.#computePlacements(diff);
    await this.#commitPlacements(placements);
    this.#reset(source);
    void new hypercomb().act();
  };
  cancelMove = (source) => {
    if (this.#activeSource !== source) return;
    this.cancelDwell();
    this.#droppedThrough = false;
    this.emitEffect("move:preview", null);
    this.#reset(source);
  };
  // ── reorder names by index ──────────────────────────────
  #reorderNames(placements) {
    const axialSvc = this.resolve("axial");
    const gridSize = axialSvc?.count ?? 0;
    const names = new Array(Math.max(gridSize, this.#cellLabels.length)).fill("");
    for (let i = 0; i < this.#cellLabels.length; i++) {
      const label = this.#cellLabels[i];
      if (!label) continue;
      const coord = this.#cellCoords[i];
      if (!coord) continue;
      const gridIndex = this.#keyToIndex.get(axialKey(coord.q, coord.r));
      if (gridIndex !== void 0) names[gridIndex] = label;
    }
    let maxIdx = names.length - 1;
    for (const [, axial] of placements) {
      const targetKey = axialKey(axial.q, axial.r);
      const targetIndex = this.#keyToIndex.get(targetKey);
      if (targetIndex !== void 0 && targetIndex > maxIdx) maxIdx = targetIndex;
    }
    while (names.length <= maxIdx) names.push("");
    const placedLabels = new Set(placements.keys());
    for (let i = 0; i < names.length; i++) {
      if (placedLabels.has(names[i])) names[i] = "";
    }
    for (const [label, axial] of placements) {
      const targetKey = axialKey(axial.q, axial.r);
      const targetIndex = this.#keyToIndex.get(targetKey);
      if (targetIndex !== void 0) {
        names[targetIndex] = label;
      }
    }
    return names;
  }
  // ── swap algorithm (from legacy computePlacements) ───────
  #computePlacements(diff) {
    const placements = /* @__PURE__ */ new Map();
    if (this.#movedGroup.size === 0) return placements;
    for (const [label, fromAxial] of this.#movedGroup) {
      placements.set(label, {
        q: fromAxial.q + diff.q,
        r: fromAxial.r + diff.r
      });
    }
    const groupDestToSource = /* @__PURE__ */ new Map();
    for (const [label, fromAxial] of this.#movedGroup) {
      const toAxial = placements.get(label);
      groupDestToSource.set(axialKey(toAxial.q, toAxial.r), fromAxial);
    }
    for (const [label] of this.#movedGroup) {
      const toAxial = placements.get(label);
      const toKey = axialKey(toAxial.q, toAxial.r);
      const occupant = this.#occupancy.get(toKey);
      if (!occupant) continue;
      if (this.#movedGroup.has(occupant)) continue;
      let target = this.#movedGroup.get(label);
      let targetKey = axialKey(target.q, target.r);
      while (groupDestToSource.has(targetKey)) {
        target = groupDestToSource.get(targetKey);
        targetKey = axialKey(target.q, target.r);
      }
      placements.set(occupant, { q: target.q, r: target.r });
    }
    return placements;
  }
  // ── command-driven move API (for command line /select[...]/move) ──
  #commandActive = false;
  get moveCommandActive() {
    return this.#commandActive;
  }
  /**
   * Begin a command-driven move with explicit labels (no pointer).
   * First label is the anchor.
   */
  beginCommandMove = (labels) => {
    if (labels.length === 0) return;
    if (this.#activeSource) return;
    this.#activeSource = "command";
    this.#commandActive = true;
    const axialSvc = this.resolve("axial");
    if (!axialSvc?.items) {
      this.#end("command");
      this.#commandActive = false;
      return;
    }
    this.#occupancy.clear();
    this.#labelToKey.clear();
    this.#keyToIndex.clear();
    for (const [i, coord] of axialSvc.items) {
      const key = axialKey(coord.q, coord.r);
      this.#keyToIndex.set(key, i);
    }
    for (let i = 0; i < this.#cellLabels.length; i++) {
      const label = this.#cellLabels[i];
      if (!label) continue;
      const coord = this.#cellCoords[i];
      if (!coord) continue;
      const key = axialKey(coord.q, coord.r);
      this.#occupancy.set(key, label);
      this.#labelToKey.set(label, key);
    }
    this.#movedGroup.clear();
    const anchorLabel = labels[0];
    let anchorSet = false;
    for (const label of labels) {
      const key = this.#labelToKey.get(label);
      if (!key) continue;
      const parts = key.split(",");
      const q = parseInt(parts[0], 10);
      const r = parseInt(parts[1], 10);
      this.#movedGroup.set(label, { q, r });
      if (label === anchorLabel && !anchorSet) {
        this.#anchorAxial = { q, r };
        anchorSet = true;
      }
    }
    if (!anchorSet) {
      this.#reset("command");
      this.#commandActive = false;
    }
  };
  /**
   * Update preview for a target axial index (from command line input).
   */
  updateCommandMove = (targetIndex) => {
    if (this.#activeSource !== "command") return;
    if (!this.#anchorAxial) return;
    const axialSvc = this.resolve("axial");
    const targetCoord = axialSvc?.items?.get(targetIndex);
    if (!targetCoord) return;
    const diff = {
      q: targetCoord.q - this.#anchorAxial.q,
      r: targetCoord.r - this.#anchorAxial.r
    };
    const placements = this.#computePlacements(diff);
    const reordered = this.#reorderNames(placements);
    const movedLabels = new Set(this.#movedGroup.keys());
    this.emitEffect("move:preview", { names: reordered, movedLabels });
  };
  /**
   * Commit the command move at a specific target index.
   */
  commitCommandMoveAt = async (targetIndex) => {
    if (this.#activeSource !== "command") return;
    if (!this.#anchorAxial) {
      this.#resetCommand();
      return;
    }
    const axialSvc = this.resolve("axial");
    const targetCoord = axialSvc?.items?.get(targetIndex);
    if (!targetCoord) {
      this.#resetCommand();
      return;
    }
    const diff = {
      q: targetCoord.q - this.#anchorAxial.q,
      r: targetCoord.r - this.#anchorAxial.r
    };
    if (diff.q === 0 && diff.r === 0) {
      this.#resetCommand();
      return;
    }
    const placements = this.#computePlacements(diff);
    await this.#commitPlacements(placements);
    this.#resetCommand();
    void new hypercomb().act();
  };
  /**
   * Commit the command move to a specific label's position.
   */
  commitCommandMoveToLabel = async (targetLabel) => {
    const key = this.#labelToKey.get(targetLabel);
    if (!key) {
      this.#resetCommand();
      return;
    }
    const idx = this.#keyToIndex.get(key);
    if (idx === void 0) {
      this.#resetCommand();
      return;
    }
    await this.commitCommandMoveAt(idx);
  };
  /**
   * Cancel command move — clear preview and reset.
   */
  cancelCommandMove = () => {
    if (this.#activeSource !== "command") return;
    this.emitEffect("move:preview", null);
    this.#resetCommand();
  };
  #resetCommand() {
    this.#reset("command");
    this.#commandActive = false;
  }
  // ── layer dwell (Ctrl + hover on branch tile) ─────────────
  #dwellMs = 750;
  startDwell = (label) => {
    if (!this.#activeSource) return;
    if (!this.#branchLabels.has(label)) return;
    if (this.#movedGroup.has(label)) return;
    if (this.#dwellLabel === label) return;
    this.cancelDwell();
    this.#dwellLabel = label;
    this.#dwellStart = performance.now();
    const tick = () => {
      if (!this.#dwellLabel) return;
      const elapsed = performance.now() - this.#dwellStart;
      const progress = Math.min(elapsed / this.#dwellMs, 1);
      this.emitEffect("move:layer-dwell", { label: this.#dwellLabel, progress });
      if (progress < 1) {
        this.#dwellRaf = requestAnimationFrame(tick);
      }
    };
    this.#dwellRaf = requestAnimationFrame(tick);
    this.#dwellTimer = setTimeout(() => {
      this.#dwellTimer = null;
      cancelAnimationFrame(this.#dwellRaf);
      this.#dwellRaf = 0;
      this.emitEffect("move:layer-dwell", { label: this.#dwellLabel, progress: 1 });
      void this.#dropThrough();
    }, this.#dwellMs);
  };
  cancelDwell = () => {
    if (this.#dwellTimer) {
      clearTimeout(this.#dwellTimer);
      this.#dwellTimer = null;
    }
    if (this.#dwellRaf) {
      cancelAnimationFrame(this.#dwellRaf);
      this.#dwellRaf = 0;
    }
    if (this.#dwellLabel) {
      this.#dwellLabel = null;
      this.emitEffect("move:layer-dwell", null);
    }
  };
  // ── drop through into child layer ────────────────────────
  async #dropThrough() {
    const targetLabel = this.#dwellLabel;
    if (!targetLabel) return;
    const source = this.#activeSource;
    if (!source) return;
    const lineage = this.resolve("lineage");
    const transfer = this.resolve("transfer");
    if (!lineage || !transfer) return;
    const sourceDir = lineage.explorerDir ? await lineage.explorerDir() : null;
    if (!sourceDir) return;
    let targetLayerDir;
    try {
      targetLayerDir = await sourceDir.getDirectoryHandle(targetLabel, { create: false });
    } catch {
      return;
    }
    const movedLabels = [...this.#movedGroup.keys()];
    for (const label of movedLabels) {
      try {
        await transfer.transfer(sourceDir, targetLayerDir, label);
      } catch (err) {
        console.warn("[move] drop-through transfer failed for", label, err);
      }
    }
    for (const label of movedLabels) {
      EffectBus.emit("cell:removed", { cell: label });
    }
    this.#dwellLabel = null;
    this.emitEffect("move:layer-dwell", null);
    this.emitEffect("move:preview", null);
    this.#pendingDragLabel = movedLabels[0] ?? null;
    this.#pendingSource = source;
    this.#droppedThrough = true;
    this.#anchorAxial = null;
    this.#movedGroup.clear();
    this.#occupancy.clear();
    this.#labelToKey.clear();
    this.#keyToIndex.clear();
    lineage.explorerEnter(targetLabel);
  }
  // ── auto-resume drag after navigation ─────────────────────
  #autoResumeDrag() {
    const label = this.#pendingDragLabel;
    const source = this.#pendingSource;
    this.#pendingDragLabel = null;
    this.#pendingSource = null;
    if (!label || !source) return;
    const idx = this.#cellLabels.indexOf(label);
    if (idx < 0) return;
    const coord = this.#cellCoords[idx];
    if (!coord) return;
    this.#moveActive = true;
    this.#activeSource = source;
    const axialSvc = this.resolve("axial");
    if (!axialSvc?.items) return;
    this.#occupancy.clear();
    this.#labelToKey.clear();
    this.#keyToIndex.clear();
    for (const [i, c] of axialSvc.items) {
      this.#keyToIndex.set(axialKey(c.q, c.r), i);
    }
    for (let i = 0; i < this.#cellLabels.length; i++) {
      const l = this.#cellLabels[i];
      if (!l) continue;
      const c = this.#cellCoords[i];
      if (!c) continue;
      const key = axialKey(c.q, c.r);
      this.#occupancy.set(key, l);
      this.#labelToKey.set(l, key);
    }
    this.#movedGroup.clear();
    this.#movedGroup.set(label, { q: coord.q, r: coord.r });
    this.#anchorAxial = { q: coord.q, r: coord.r };
    EffectBus.emit("cell:added", { cell: label });
    this.emitEffect("move:mode", { active: true });
  }
  // ── insert-push reorder (used after drop-through) ─────────
  #computeInsertPlacements(hoverAxial) {
    if (this.#movedGroup.size === 0) return [...this.#cellLabels];
    const movedLabels = new Set(this.#movedGroup.keys());
    const denseWithout = this.#cellLabels.filter((l) => l && !movedLabels.has(l));
    const hoverKey = axialKey(hoverAxial.q, hoverAxial.r);
    const hoverLabel = this.#occupancy.get(hoverKey);
    let insertIdx = denseWithout.length;
    if (hoverLabel) {
      const pos = denseWithout.indexOf(hoverLabel);
      if (pos >= 0) insertIdx = pos;
    }
    const movedList = [...movedLabels];
    const result = [...denseWithout];
    result.splice(insertIdx, 0, ...movedList);
    return result;
  }
  // ── shared commit logic (pinned vs dense) ────────────────
  async #commitPlacements(placements) {
    const lineage = this.resolve("lineage");
    const locationKey = String(lineage?.explorerLabel?.() ?? "/");
    const layoutMode = localStorage.getItem(`hc:layout-mode:${locationKey}`) === "pinned" ? "pinned" : "dense";
    if (layoutMode === "pinned") {
      const dir = lineage?.explorerDir ? await lineage.explorerDir() : null;
      if (dir) {
        for (const [label, axial] of placements) {
          const targetKey = axialKey(axial.q, axial.r);
          const targetIndex = this.#keyToIndex.get(targetKey);
          if (targetIndex === void 0) continue;
          try {
            const cellDir = await dir.getDirectoryHandle(label, { create: false });
            await writeCellProperties(cellDir, { index: targetIndex, offset: 0 });
          } catch {
          }
        }
      }
    } else {
      const denseOrder = this.#reorderNames(placements).filter((n) => n !== "");
      this.emitEffect("cell:reorder", { labels: denseOrder });
      const layout = this.resolve("layout");
      if (layout && lineage?.explorerDir) {
        const dir = await lineage.explorerDir();
        if (dir) await layout.write(dir, denseOrder);
      }
    }
    this.emitEffect("move:preview", null);
    this.emitEffect("move:committed", {
      order: layoutMode === "pinned" ? [...placements.keys()] : this.#reorderNames(placements).filter((n) => n !== "")
    });
  }
  // ── reset ────────────────────────────────────────────────
  #reset(source) {
    this.cancelDwell();
    this.#anchorAxial = null;
    this.#movedGroup.clear();
    this.#occupancy.clear();
    this.#labelToKey.clear();
    this.#keyToIndex.clear();
    this.#pendingDragLabel = null;
    this.#pendingSource = null;
    this.#end(source);
  }
};
var _move = new MoveDrone();
window.ioc.register("@diamondcoreprocessor.com/MoveDrone", _move);
export {
  MoveDrone
};
