// src/diamondcoreprocessor.com/website/website-build.drone.ts
import { EffectBus } from "@hypercomb/core";
var SIG_REGEX = /^[a-f0-9]{64}$/;
var MAX_DEPTH = 24;
var PRIOR_SIG_KEY = "hc:website:last-root-sig";
var WebsiteBuildDrone = class extends EventTarget {
  constructor() {
    super();
    EffectBus.on("website:build", (payload) => {
      void this.#handleBuild(payload).catch((err) => {
        console.error("[website-build] envelope assembly failed", err);
        EffectBus.emit("website:build:error", { error: String(err?.message ?? err) });
      });
    });
  }
  async #handleBuild(payload) {
    const history = get("@diamondcoreprocessor.com/HistoryService");
    const notes = get("@diamondcoreprocessor.com/NotesService");
    if (!history || !notes) {
      console.warn("[website-build] HistoryService / NotesService not ready yet");
      return;
    }
    const scopeSegments = (payload.scopeSegments ?? []).map(String);
    const mode = payload.mode ?? "upgrade";
    const scope = payload.scope ?? "subtree";
    const branchSig = await history.sign({ explorerSegments: () => scopeSegments });
    const branch = await this.#walk(history, notes, scopeSegments, MAX_DEPTH);
    const instructionsSig = await history.sign({ explorerSegments: () => ["instructions"] });
    const instructions = await this.#walk(history, notes, ["instructions"], MAX_DEPTH);
    const priorRootSig = typeof payload.priorRootMarker === "string" && payload.priorRootMarker.length > 0 ? payload.priorRootMarker : typeof localStorage !== "undefined" ? localStorage.getItem(PRIOR_SIG_KEY) : null;
    const envelope = {
      mode,
      scope,
      scopeSegments,
      branch,
      instructions,
      branchSig,
      instructionsSig,
      priorRootSig
    };
    console.log("[website-build] envelope ready", {
      mode,
      scope,
      lineage: scopeSegments.join("/") || "(root)",
      branchSig: branchSig.slice(0, 12),
      instructionsSig: instructionsSig.slice(0, 12),
      priorRootSig: priorRootSig?.slice(0, 12) ?? null,
      branchCells: this.#countCells(branch),
      branchNotes: this.#countNotes(branch),
      instructionsCells: this.#countCells(instructions),
      instructionsNotes: this.#countNotes(instructions)
    });
    EffectBus.emit("website:build:envelope", envelope);
    EffectBus.emit("website:build:ready", {
      branchSig,
      instructionsSig,
      priorRootSig,
      mode,
      scope
    });
  }
  /** Recursive walk: layer at segments → BranchNode with full subtree.
   *  Cycle/depth guarded. Children may be sigs (resolve to layer.name)
   *  or names (use directly). Notes hydrated via NotesService for each
   *  cell so the envelope is complete (no per-cell async fetches at
   *  the codegen step — pure-function input). */
  async #walk(history, notes, segments, depth, visited = /* @__PURE__ */ new Set()) {
    if (depth < 0) return null;
    const key = segments.join("/");
    if (visited.has(key)) return null;
    visited.add(key);
    const sig = await history.sign({ explorerSegments: () => segments });
    const layer = await history.currentLayerAt(sig);
    if (!layer) {
      return {
        segments: [...segments],
        name: segments[segments.length - 1] ?? "",
        notes: [],
        children: []
      };
    }
    const childNames = await this.#resolveChildNames(history, layer);
    const cellNotes = segments.length === 0 ? [] : await notes.getNotesAtSegments(segments);
    const children = [];
    for (const childName of childNames) {
      const child = await this.#walk(history, notes, [...segments, childName], depth - 1, visited);
      if (child) children.push(child);
    }
    return {
      segments: [...segments],
      name: typeof layer.name === "string" && layer.name ? layer.name : segments[segments.length - 1] ?? "",
      notes: cellNotes,
      children
    };
  }
  async #resolveChildNames(history, layer) {
    const children = Array.isArray(layer.children) ? layer.children.slice() : [];
    const names = [];
    for (const entry of children) {
      const s = String(entry ?? "").trim();
      if (!s) continue;
      if (SIG_REGEX.test(s)) {
        const child = await history.getLayerBySig(s);
        const n = child?.name;
        if (typeof n === "string" && n) names.push(n);
      } else {
        names.push(s);
      }
    }
    return names;
  }
  #countCells(n) {
    if (!n) return 0;
    return 1 + n.children.reduce((sum, c) => sum + this.#countCells(c), 0);
  }
  #countNotes(n) {
    if (!n) return 0;
    return n.notes.length + n.children.reduce((sum, c) => sum + this.#countNotes(c), 0);
  }
};
var _build = new WebsiteBuildDrone();
window.ioc.register("@diamondcoreprocessor.com/WebsiteBuildDrone", _build);
export {
  WebsiteBuildDrone
};
