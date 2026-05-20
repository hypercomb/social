// src/diamondcoreprocessor.com/presentation/tiles/tile-actions.drone.ts
import { Drone, EffectBus as EffectBus2, hypercomb, normalizeCell } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/tile-properties.ts
import { EffectBus, SignatureService } from "@hypercomb/core";
var TILE_PROPERTIES_FILE = "0000";
var readCellProperties = async (cellDir) => {
  let fileHandle;
  try {
    fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE);
  } catch {
    return {};
  }
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch (err) {
    console.warn("[tile-properties] failed to read/parse 0000 in", cellDir.name, err);
    return {};
  }
};
var writeCellProperties = async (cellDir, updates, cacheKey) => {
  const existing = await readCellProperties(cellDir);
  const merged = { ...existing, ...updates };
  const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(merged));
  await writable.close();
  EffectBus.emit("cell:0000-changed", {
    cacheKey: cacheKey ?? cellDir.name,
    keys: Object.keys(updates)
  });
};

// src/diamondcoreprocessor.com/presentation/tiles/tile-actions.drone.ts
function hideStorageKey(location) {
  const zone = localStorage.getItem("hc:current-zone") ?? "";
  return zone ? `hc:hidden-tiles:${location}:z${zone}` : `hc:hidden-tiles:${location}`;
}
var NOTE_ACCENT = 16769354;
var NOTE_ACCENT_CSS = "#ffe14a";
var md = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="${d}"/></svg>`;
var ICONS = {
  // terminal — Material Icons Filled
  command: md("M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.11-.9-2-2-2zm0 14H4V8h16v10zM7.5 17l-1.41-1.41L8.67 13l-2.58-2.59L7.5 9l4 4-4 4zM13 17v-2h5v2h-5z"),
  // search — Material Icons Filled
  search: md("M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"),
  // visibility_off — Material Icons Filled
  hide: md("M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"),
  // grid_view — Material Icons Filled
  breakApart: md("M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z"),
  // add — Material Icons Filled
  adopt: md("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"),
  // block — Material Icons Filled
  block: md("M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z"),
  // delete — Material Icons Filled
  remove: md("M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"),
  // refresh — Material Icons Filled
  reroll: md("M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"),
  // sticky_note_2 — Material Icons Filled
  note: md("M19 3H4.99c-1.11 0-1.98.9-1.98 2L3 19c0 1.1.89 2 2 2h10l6-6V5c0-1.1-.9-2-2-2zM7 8h10v2H7V8zm5 6H7v-2h5v2zm2 5.5V14h5.5L14 19.5z")
};
var ICON_REGISTRY = [
  // ── private profile ──
  { name: "command", svgMarkup: ICONS.command, hoverTint: 11075544, profile: "private", labelKey: "action.command", descriptionKey: "action.command.description" },
  // 'edit' icon is provided by TileEditorDrone via IconProviderRegistry —
  // when the editor drone is toggled off it never registers, the icon
  // never appears, and the merged-available filter strips it from default
  // arrangements. Same pattern for 'note' (NotesService) and 'reroll'
  // (SubstrateDrone) — both registered by their owning drones.
  { name: "search", svgMarkup: ICONS.search, hoverTint: 13172680, profile: "private", visibleWhen: (ctx) => ctx.noImage, labelKey: "action.search", descriptionKey: "action.search.description" },
  { name: "remove", svgMarkup: ICONS.remove, hoverTint: 16763080, profile: "private", labelKey: "action.remove", descriptionKey: "action.remove.description" },
  { name: "break-apart", svgMarkup: ICONS.breakApart, hoverTint: 6737151, profile: "private", visibleWhen: (ctx) => ctx.isHidden, labelKey: "action.break-apart", descriptionKey: "action.break-apart.description" },
  // ── public-own profile ──
  // Your own tile in public mode. Removal is the existing trash-bin
  // delete, which routes through LayerCommitter and is recorded in
  // history (so it can be undone, time-travelled to, and is part of
  // the lineage's canonical state). Hide doesn't belong here — hide
  // is a session-scoped per-view filter, but you OWN this tile and
  // the correct dismissal is to delete it from your layer.
  { name: "remove", svgMarkup: ICONS.remove, hoverTint: 16763080, profile: "public-own", labelKey: "action.remove", descriptionKey: "action.remove.description" },
  { name: "break-apart", svgMarkup: ICONS.breakApart, hoverTint: 6737151, profile: "public-own", visibleWhen: (ctx) => ctx.isHidden, labelKey: "action.break-apart", descriptionKey: "action.break-apart.description" },
  // ── public-external profile ──
  { name: "adopt", svgMarkup: ICONS.adopt, hoverTint: 11075544, profile: "public-external", labelKey: "action.adopt", descriptionKey: "action.adopt.description" },
  // 'hide' also lives in `public-own` (your own tile in public mode);
  // re-registering for `public-external` lets the same handler apply
  // when the tile is a peer-only mesh entry. Same dispatch through
  // tile:hidden, same instant repaint (show-cell listens directly),
  // same mesh propagation via publishHide. Peer tiles disappear
  // immediately without needing to adopt them first.
  { name: "hide", svgMarkup: ICONS.hide, hoverTint: 16767144, profile: "public-external", visibleWhen: (ctx) => !ctx.isHidden, labelKey: "action.hide", descriptionKey: "action.hide.description" },
  { name: "block", svgMarkup: ICONS.block, hoverTint: 16763080, profile: "public-external", labelKey: "action.block", descriptionKey: "action.block.description" }
];
var DEFAULT_ACTIVE = {
  "private": ["command", "edit", "note", "reroll", "remove", "break-apart"],
  // Your own tile in public mode — same trash-bin remove that
  // private mode uses. Records a history op, can be undone.
  "public-own": ["remove", "break-apart"],
  // Peer-only mesh tiles you haven't adopted. `adopt` materialises
  // them locally (carries the publisher's 0000 + image); `hide`
  // dismisses without taking ownership (zone-scoped, instant,
  // mesh-published so the filter survives reload + multi-device).
  "public-external": ["adopt", "hide"]
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
var HANDLED_ACTIONS = /* @__PURE__ */ new Set(["edit", "search", "command", "note", "hide", "break-apart", "adopt", "block", "remove", "reroll", "import"]);
var TileActionsDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "registers default tile overlay icons and handles their click actions";
  deps = {
    lineage: "@hypercomb.social/Lineage"
  };
  listens = ["render:host-ready", "render:cell-count", "tile:action", "controls:action", "overlay:icons-reordered", "overlay:arrange-mode", "substrate:applied", "substrate:rerolled", "cell:removed"];
  emits = ["overlay:register-action", "overlay:pool-icons", "search:prefill", "command:focus", "note:capture", "tile:hidden", "tile:unhidden", "tile:blocked", "cell:removed", "visibility:show-hidden", "substrate:rerolled"];
  #registered = false;
  #effectsRegistered = false;
  #arrangement = {};
  #substrateLabels = /* @__PURE__ */ new Set();
  #onRegistryChange = () => {
    this.#reregisterAll();
  };
  heartbeat = async () => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true;
      this.onEffect("render:host-ready", () => {
        if (this.#registered) return;
        this.#registered = true;
        void this.#loadArrangementAndRegister();
      });
      this.onEffect("render:cell-count", (payload) => {
        this.#substrateLabels = new Set(payload.substrateLabels ?? []);
      });
      this.onEffect("substrate:applied", ({ cell }) => {
        if (cell) this.#substrateLabels.add(cell);
      });
      this.onEffect("cell:removed", ({ cell }) => {
        if (cell) this.#substrateLabels.delete(cell);
      });
      this.onEffect("tile:action", (payload) => {
        if (!HANDLED_ACTIONS.has(payload.action)) return;
        this.#handleAction(payload);
      });
      this.onEffect("controls:action", (payload) => {
        if (payload?.action === "hide") this.#bulkHideSelected();
        else if (payload?.action === "reroll") this.#bulkRerollSelected();
      });
      this.onEffect("overlay:icons-reordered", (payload) => {
        this.#arrangement[payload.profile] = payload.order;
        void this.#persistArrangement();
        this.#registerProfileIcons(payload.profile);
      });
      const registry = window.ioc.get("@hypercomb.social/IconProviderRegistry");
      registry?.addEventListener("change", this.#onRegistryChange);
    }
  };
  // ── Merged icon catalog ─────────────────────────────────────────
  // Local ICON_REGISTRY entries plus any IconProviderRegistry entries
  // contributed by individual drones. Source of truth for "available"
  // icons used by descriptor build, pool computation, and arrangement
  // filtering.
  #mergedEntries() {
    const registry = window.ioc.get("@hypercomb.social/IconProviderRegistry");
    const provided = registry?.all() ?? [];
    return [...ICON_REGISTRY, ...provided];
  }
  #reregisterAll() {
    if (!this.#registered) return;
    for (const profile of ["private", "public-own", "public-external"]) {
      this.#registerProfileIcons(profile);
    }
  }
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
    const merged = this.#mergedEntries();
    for (const profile of ["private", "public-own", "public-external"]) {
      const activeNames = this.#getActiveNames(profile);
      const positions = computeIconPositions(activeNames);
      for (let i = 0; i < activeNames.length; i++) {
        const entry = merged.find((e) => e.name === activeNames[i] && e.profile === profile);
        if (!entry) continue;
        descriptors.push({
          name: entry.name,
          owner: this.iocKey,
          svgMarkup: entry.svgMarkup,
          hoverTint: entry.hoverTint,
          profile: entry.profile,
          visibleWhen: entry.visibleWhen,
          tintWhen: entry.tintWhen,
          labelKey: entry.labelKey,
          descriptionKey: entry.descriptionKey,
          x: positions[i].x,
          y: positions[i].y
        });
      }
    }
    return descriptors;
  }
  #registerProfileIcons(profile) {
    const merged = this.#mergedEntries();
    const profileEntries = merged.filter((e) => e.profile === profile);
    for (const entry of profileEntries) {
      EffectBus2.emit("overlay:unregister-action", { name: entry.name });
    }
    const activeNames = this.#getActiveNames(profile);
    const positions = computeIconPositions(activeNames);
    const descriptors = [];
    for (let i = 0; i < activeNames.length; i++) {
      const entry = merged.find((e) => e.name === activeNames[i] && e.profile === profile);
      if (!entry) continue;
      descriptors.push({
        name: entry.name,
        owner: this.iocKey,
        svgMarkup: entry.svgMarkup,
        hoverTint: entry.hoverTint,
        profile: entry.profile,
        visibleWhen: entry.visibleWhen,
        labelKey: entry.labelKey,
        descriptionKey: entry.descriptionKey,
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
    const merged = this.#mergedEntries();
    const available = new Set(merged.filter((e) => e.profile === profile).map((e) => e.name));
    const saved = this.#arrangement[profile];
    const desired = saved && saved.length > 0 ? saved : DEFAULT_ACTIVE[profile];
    return desired.filter((n) => available.has(n));
  }
  #emitPoolIcons() {
    const merged = this.#mergedEntries();
    const pool = {};
    for (const profile of ["private", "public-own", "public-external"]) {
      const activeNames = new Set(this.#getActiveNames(profile));
      pool[profile] = merged.filter((e) => e.profile === profile && !activeNames.has(e.name));
    }
    EffectBus2.emit("overlay:pool-icons", { pool, registry: merged });
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
        EffectBus2.emit("search:prefill", { value: label });
        break;
      case "command":
        EffectBus2.emit("command:focus", { cell: label });
        break;
      case "note": {
        EffectBus2.emit("note:capture", { cellLabel: label });
        break;
      }
      case "hide":
        this.#hideOrBlock(label, "hc:hidden-tiles", "tile:hidden");
        break;
      case "break-apart":
        this.#unhide(label);
        break;
      case "adopt":
        console.log("[sync] tile-actions: adopt \u2192", label);
        EffectBus2.emit("paired-channel:adopt-request", { branchName: label });
        break;
      case "import":
        console.log("[sync] tile-actions: import \u2192", label);
        EffectBus2.emit("paired-channel:import-request", { branchName: label });
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
    const history = window.ioc?.get?.("@diamondcoreprocessor.com/HistoryService");
    const committer = window.ioc?.get?.("@diamondcoreprocessor.com/LayerCommitter");
    if (!lineage || !history || !committer) return;
    const segments = (lineage.explorerSegments?.() ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
    const parentLocSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => segments
    });
    const parent = await history.currentLayerAt(parentLocSig);
    if (!parent) return;
    const childSigs = Array.isArray(parent.children) ? parent.children : [];
    const survivorNames = [];
    for (const sig of childSigs) {
      const child = await history.getLayerBySig(sig);
      if (!child || typeof child.name !== "string") continue;
      if (child.name !== label) survivorNames.push(child.name);
    }
    const nextLayer = { ...parent, children: survivorNames };
    EffectBus2.emit("cell:removed", { cell: label, segments });
    await committer.update(segments, nextLayer);
  }
  async #rerollSubstrate(label) {
    const svc = window.ioc?.get?.("@diamondcoreprocessor.com/SubstrateService");
    if (svc?.rerollCell(label)) {
      EffectBus2.emit("substrate:rerolled", { cell: label });
      void new hypercomb().act();
    }
  }
  #bulkRerollSelected() {
    const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
    if (!selection || selection.count === 0) return;
    const svc = window.ioc?.get?.("@diamondcoreprocessor.com/SubstrateService");
    if (!svc) return;
    const labels = [...selection.selected].filter((l) => this.#substrateLabels.has(l));
    if (labels.length === 0) return;
    const rerolled = svc.rerollCells(labels);
    if (rerolled.length === 0) return;
    for (const cell of rerolled) {
      EffectBus2.emit("substrate:rerolled", { cell });
    }
    void new hypercomb().act();
  }
  #unhide(label) {
    const lineage = this.resolve("lineage");
    const location = lineage?.explorerLabel() ?? "/";
    const key = hideStorageKey(location);
    const existing = JSON.parse(localStorage.getItem(key) ?? "[]");
    const updated = existing.filter((l) => l !== label);
    localStorage.setItem(key, JSON.stringify(updated));
    EffectBus2.emit("tile:unhidden", { cell: label, location });
    const swarm = window.ioc.get(
      "@diamondcoreprocessor.com/SwarmDrone"
    );
    void swarm?.publishHide?.(updated);
    void new hypercomb().act();
  }
  #bulkHideSelected() {
    const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
    if (!selection || selection.count === 0) return;
    const lineage = this.resolve("lineage");
    const location = lineage?.explorerLabel() ?? "/";
    const key = hideStorageKey(location);
    const hidden = JSON.parse(localStorage.getItem(key) ?? "[]");
    const hiddenSet = new Set(hidden);
    const labels = [...selection.selected];
    const allHidden = labels.every((l) => hiddenSet.has(l));
    const swarm = window.ioc.get(
      "@diamondcoreprocessor.com/SwarmDrone"
    );
    if (allHidden) {
      const removeSet = new Set(labels);
      const updated = hidden.filter((l) => !removeSet.has(l));
      localStorage.setItem(key, JSON.stringify(updated));
      for (const label of labels) EffectBus2.emit("tile:unhidden", { cell: label, location });
      EffectBus2.emit("visibility:show-hidden", { active: localStorage.getItem("hc:show-hidden") === "1" });
      void swarm?.publishHide?.(updated);
    } else {
      for (const label of labels) if (!hiddenSet.has(label)) hidden.push(label);
      localStorage.setItem(key, JSON.stringify(hidden));
      for (const label of labels) EffectBus2.emit("tile:hidden", { cell: label, location });
      localStorage.setItem("hc:show-hidden", "1");
      EffectBus2.emit("visibility:show-hidden", { active: true });
      void swarm?.publishHide?.(hidden);
    }
    selection.clear();
    void new hypercomb().act();
  }
  #hideOrBlock(label, storagePrefix, effect) {
    const lineage = this.resolve("lineage");
    const location = lineage?.explorerLabel() ?? "/";
    const key = storagePrefix === "hc:hidden-tiles" ? hideStorageKey(location) : `${storagePrefix}:${location}`;
    const existing = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!existing.includes(label)) existing.push(label);
    localStorage.setItem(key, JSON.stringify(existing));
    EffectBus2.emit(effect, { cell: label, location });
    if (storagePrefix === "hc:hidden-tiles") {
      const swarm = window.ioc.get(
        "@diamondcoreprocessor.com/SwarmDrone"
      );
      void swarm?.publishHide?.(existing);
    }
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
  NOTE_ACCENT,
  NOTE_ACCENT_CSS,
  TileActionsDrone,
  computeIconPositions,
  hideStorageKey
};
