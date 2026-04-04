// src/diamondcoreprocessor.com/presentation/tiles/tile-actions.drone.ts
import { Drone, EffectBus, hypercomb, normalizeCell } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/tile-properties.ts
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

// src/diamondcoreprocessor.com/presentation/tiles/tile-actions.drone.ts
var svg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
var ICONS = {
  // Terminal prompt >_
  command: svg('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>'),
  // Pencil
  edit: svg('<path d="M17 3l4 4L7 21H3v-4L17 3z"/>'),
  // Magnifying glass
  search: svg('<circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/>'),
  // Eye with slash
  hide: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/><line x1="4" y1="4" x2="20" y2="20"/>'),
  // Break apart — four fragments separating
  breakApart: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  // Plus
  adopt: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  // Circle with slash
  block: svg('<circle cx="12" cy="12" r="9"/><line x1="5.7" y1="5.7" x2="18.3" y2="18.3"/>'),
  // Trash bin
  remove: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  // Refresh / reroll — two curved arrows
  reroll: svg('<path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10"/><path d="M3.51 15A9 9 0 0 0 18.36 18.36L23 14"/>')
};
var ICON_REGISTRY = [
  // ── private profile ──
  { name: "command", svgMarkup: ICONS.command, hoverTint: 11075544, profile: "private" },
  { name: "edit", svgMarkup: ICONS.edit, hoverTint: 13162751, profile: "private" },
  { name: "search", svgMarkup: ICONS.search, hoverTint: 13172680, profile: "private", visibleWhen: (ctx) => ctx.noImage },
  { name: "reroll", svgMarkup: ICONS.reroll, hoverTint: 14207231, profile: "private", visibleWhen: (ctx) => ctx.hasSubstrate },
  { name: "remove", svgMarkup: ICONS.remove, hoverTint: 16763080, profile: "private" },
  { name: "break-apart", svgMarkup: ICONS.breakApart, hoverTint: 6737151, profile: "private", visibleWhen: (ctx) => ctx.isHidden },
  // ── public-own profile ──
  { name: "hide", svgMarkup: ICONS.hide, hoverTint: 16767144, profile: "public-own", visibleWhen: (ctx) => !ctx.isHidden },
  { name: "break-apart", svgMarkup: ICONS.breakApart, hoverTint: 6737151, profile: "public-own", visibleWhen: (ctx) => ctx.isHidden },
  // ── public-external profile ──
  { name: "adopt", svgMarkup: ICONS.adopt, hoverTint: 11075544, profile: "public-external" },
  { name: "block", svgMarkup: ICONS.block, hoverTint: 16763080, profile: "public-external" }
];
var DEFAULT_ACTIVE = {
  "private": ["command", "edit", "remove", "break-apart"],
  "public-own": ["hide", "break-apart"],
  "public-external": ["adopt", "block"]
};
var ICON_Y = 10;
var ICON_SPACING = 10;
var HEX_INRADIUS = 27.7;
var EDGE_MARGIN = 3;
function computeIconPositions(activeNames) {
  const count = activeNames.length;
  if (count === 0) return [];
  let spacing = ICON_SPACING;
  const available = (HEX_INRADIUS - EDGE_MARGIN) * 2;
  const idealWidth = (count - 1) * spacing;
  if (idealWidth > available && count > 1) {
    spacing = available / (count - 1);
  }
  const startX = Math.round(-(count - 1) * spacing / 2);
  return activeNames.map((_, i) => ({ x: Math.round(startX + i * spacing), y: ICON_Y }));
}
var ARRANGEMENT_KEY = "iconArrangement";
var HANDLED_ACTIONS = /* @__PURE__ */ new Set(["edit", "search", "command", "hide", "break-apart", "adopt", "block", "remove", "reroll"]);
var TileActionsDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "registers default tile overlay icons and handles their click actions";
  deps = {
    lineage: "@hypercomb.social/Lineage"
  };
  listens = ["render:host-ready", "tile:action", "controls:action", "overlay:icons-reordered", "overlay:arrange-mode"];
  emits = ["overlay:register-action", "overlay:pool-icons", "search:prefill", "command:focus", "tile:hidden", "tile:unhidden", "tile:blocked", "cell:removed", "visibility:show-hidden", "substrate:rerolled"];
  #registered = false;
  #effectsRegistered = false;
  #arrangement = {};
  heartbeat = async () => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true;
      this.onEffect("render:host-ready", () => {
        if (this.#registered) return;
        this.#registered = true;
        void this.#loadArrangementAndRegister();
      });
      this.onEffect("tile:action", (payload) => {
        if (!HANDLED_ACTIONS.has(payload.action)) return;
        this.#handleAction(payload);
      });
      this.onEffect("controls:action", (payload) => {
        if (payload?.action === "hide") this.#bulkHideSelected();
      });
      this.onEffect("overlay:icons-reordered", (payload) => {
        this.#arrangement[payload.profile] = payload.order;
        void this.#persistArrangement();
        this.#registerProfileIcons(payload.profile);
      });
    }
  };
  // ── Arrangement loading & registration ──────────────────────────
  async #loadArrangementAndRegister() {
    try {
      const lineage = this.resolve("lineage");
      const rootDir = await this.#getRootDir(lineage);
      if (rootDir) {
        const props = await readCellProperties(rootDir);
        const saved = props[ARRANGEMENT_KEY];
        if (saved && typeof saved === "object") {
          this.#arrangement = saved;
        }
      }
    } catch {
    }
    const descriptors = this.#buildAllDescriptors();
    this.emitEffect("overlay:register-action", descriptors);
    this.#emitPoolIcons();
  }
  #buildAllDescriptors() {
    const descriptors = [];
    for (const profile of ["private", "public-own", "public-external"]) {
      const activeNames = this.#getActiveNames(profile);
      const positions = computeIconPositions(activeNames);
      for (let i = 0; i < activeNames.length; i++) {
        const entry = ICON_REGISTRY.find((e) => e.name === activeNames[i] && e.profile === profile);
        if (!entry) continue;
        descriptors.push({
          name: entry.name,
          owner: this.iocKey,
          svgMarkup: entry.svgMarkup,
          hoverTint: entry.hoverTint,
          profile: entry.profile,
          visibleWhen: entry.visibleWhen,
          x: positions[i].x,
          y: positions[i].y
        });
      }
    }
    return descriptors;
  }
  #registerProfileIcons(profile) {
    const profileEntries = ICON_REGISTRY.filter((e) => e.profile === profile);
    for (const entry of profileEntries) {
      EffectBus.emit("overlay:unregister-action", { name: entry.name });
    }
    const activeNames = this.#getActiveNames(profile);
    const positions = computeIconPositions(activeNames);
    const descriptors = [];
    for (let i = 0; i < activeNames.length; i++) {
      const entry = ICON_REGISTRY.find((e) => e.name === activeNames[i] && e.profile === profile);
      if (!entry) continue;
      descriptors.push({
        name: entry.name,
        owner: this.iocKey,
        svgMarkup: entry.svgMarkup,
        hoverTint: entry.hoverTint,
        profile: entry.profile,
        visibleWhen: entry.visibleWhen,
        x: positions[i].x,
        y: positions[i].y
      });
    }
    if (descriptors.length > 0) {
      this.emitEffect("overlay:register-action", descriptors);
    }
    this.#emitPoolIcons();
  }
  #getActiveNames(profile) {
    const saved = this.#arrangement[profile];
    if (saved && saved.length > 0) {
      const available = new Set(ICON_REGISTRY.filter((e) => e.profile === profile).map((e) => e.name));
      return saved.filter((n) => available.has(n));
    }
    return [...DEFAULT_ACTIVE[profile]];
  }
  #emitPoolIcons() {
    const pool = {};
    for (const profile of ["private", "public-own", "public-external"]) {
      const activeNames = new Set(this.#getActiveNames(profile));
      pool[profile] = ICON_REGISTRY.filter((e) => e.profile === profile && !activeNames.has(e.name));
    }
    EffectBus.emit("overlay:pool-icons", { pool, registry: ICON_REGISTRY });
  }
  // ── Persistence ─────────────────────────────────────────────────
  async #persistArrangement() {
    try {
      const lineage = this.resolve("lineage");
      const rootDir = await this.#getRootDir(lineage);
      if (rootDir) {
        await writeCellProperties(rootDir, { [ARRANGEMENT_KEY]: this.#arrangement });
      }
    } catch {
    }
  }
  async #getRootDir(_lineage) {
    return null;
  }
  // ── Action handlers ─────────────────────────────────────────────
  #handleAction(payload) {
    const { action, label: rawLabel } = payload;
    const label = normalizeCell(rawLabel) || rawLabel;
    switch (action) {
      case "edit":
        break;
      case "search":
        EffectBus.emit("search:prefill", { value: label });
        break;
      case "command":
        EffectBus.emit("command:focus", { cell: label });
        break;
      case "hide":
        this.#hideOrBlock(label, "hc:hidden-tiles", "tile:hidden");
        break;
      case "break-apart":
        this.#unhide(label);
        break;
      case "adopt":
        EffectBus.emit("cell:added", { cell: label });
        void new hypercomb().act();
        break;
      case "block":
        this.#hideOrBlock(label, "hc:blocked-tiles", "tile:blocked");
        break;
      case "reroll":
        void this.#rerollSubstrate(label);
        break;
      case "remove":
        void this.#removeTile(label);
        break;
    }
  }
  async #removeTile(label) {
    const lineage = this.resolve("lineage");
    if (!lineage) return;
    const dir = await lineage.explorerDir();
    if (!dir) return;
    try {
      await dir.removeEntry(label, { recursive: true });
      EffectBus.emit("cell:removed", { cell: label });
    } catch {
    }
    void new hypercomb().act();
  }
  async #rerollSubstrate(label) {
    const svc = window.ioc?.get?.("@diamondcoreprocessor.com/SubstrateService");
    if (svc?.rerollCell(label)) {
      const showCell = window.ioc?.get?.("@diamondcoreprocessor.com/ShowCellDrone");
      showCell?.cellImageCache.delete(label);
      showCell?.cellSubstrateCache.delete(label);
      EffectBus.emit("substrate:rerolled", { cell: label });
      void new hypercomb().act();
    }
  }
  #unhide(label) {
    const lineage = this.resolve("lineage");
    const location = lineage?.explorerLabel() ?? "/";
    const key = `hc:hidden-tiles:${location}`;
    const existing = JSON.parse(localStorage.getItem(key) ?? "[]");
    const updated = existing.filter((l) => l !== label);
    localStorage.setItem(key, JSON.stringify(updated));
    EffectBus.emit("tile:unhidden", { cell: label, location });
    void new hypercomb().act();
  }
  #bulkHideSelected() {
    const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
    if (!selection || selection.count === 0) return;
    const lineage = this.resolve("lineage");
    const location = lineage?.explorerLabel() ?? "/";
    const key = `hc:hidden-tiles:${location}`;
    const hidden = JSON.parse(localStorage.getItem(key) ?? "[]");
    const hiddenSet = new Set(hidden);
    const labels = [...selection.selected];
    const allHidden = labels.every((l) => hiddenSet.has(l));
    if (allHidden) {
      const removeSet = new Set(labels);
      localStorage.setItem(key, JSON.stringify(hidden.filter((l) => !removeSet.has(l))));
      for (const label of labels) EffectBus.emit("tile:unhidden", { cell: label, location });
      EffectBus.emit("visibility:show-hidden", { active: localStorage.getItem("hc:show-hidden") === "1" });
    } else {
      for (const label of labels) if (!hiddenSet.has(label)) hidden.push(label);
      localStorage.setItem(key, JSON.stringify(hidden));
      for (const label of labels) EffectBus.emit("tile:hidden", { cell: label, location });
      localStorage.setItem("hc:show-hidden", "1");
      EffectBus.emit("visibility:show-hidden", { active: true });
    }
    selection.clear();
    void new hypercomb().act();
  }
  #hideOrBlock(label, storagePrefix, effect) {
    const lineage = this.resolve("lineage");
    const location = lineage?.explorerLabel() ?? "/";
    const key = `${storagePrefix}:${location}`;
    const existing = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!existing.includes(label)) existing.push(label);
    localStorage.setItem(key, JSON.stringify(existing));
    EffectBus.emit(effect, { cell: label, location });
    void new hypercomb().act();
  }
};
var _tileActions = new TileActionsDrone();
window.ioc.register("@diamondcoreprocessor.com/TileActionsDrone", _tileActions);
export {
  DEFAULT_ACTIVE,
  ICON_REGISTRY,
  ICON_SPACING,
  ICON_Y,
  TileActionsDrone,
  computeIconPositions
};
