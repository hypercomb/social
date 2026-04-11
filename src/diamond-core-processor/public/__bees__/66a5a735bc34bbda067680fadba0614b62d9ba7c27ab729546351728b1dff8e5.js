// hypercomb-essentials/src/diamondcoreprocessor.com/instructions/instruction.drone.ts
import { EffectBus } from "@hypercomb/core";
var InstructionDrone = class extends EventTarget {
  #visible = false;
  #catalogOpen = false;
  #manifestSig = null;
  #manifest = null;
  #settingsSig = null;
  #settings = null;
  // three-level cache: in-memory → OPFS → never invalidates (immutable)
  #manifestCache = /* @__PURE__ */ new Map();
  #settingsCache = /* @__PURE__ */ new Map();
  #beeFingerprint = "";
  #lateRegistrations = /* @__PURE__ */ new Map();
  get state() {
    return {
      visible: this.#visible,
      catalogOpen: this.#catalogOpen,
      manifestSig: this.#manifestSig,
      manifest: this.#manifest,
      settingsSig: this.#settingsSig,
      settings: this.#settings
    };
  }
  constructor() {
    super();
    EffectBus.on("instruction:toggle", (payload) => {
      if (payload && typeof payload.visible === "boolean") {
        this.#visible = payload.visible;
      } else {
        this.#visible = !this.#visible;
      }
      this.#catalogOpen = false;
      if (this.#visible && !this.#manifest) this.#collectAndBuild();
      this.#emit();
    });
    EffectBus.on("instruction:catalog", () => {
      this.#catalogOpen = !this.#catalogOpen;
      if (this.#catalogOpen) {
        this.#visible = true;
        if (!this.#manifest) this.#collectAndBuild();
      }
      this.#emit();
    });
    EffectBus.on("instruction:dismiss", (payload) => {
      if (!payload?.selector || !this.#settings || !this.#manifestSig) return;
      const hidden = [...this.#settings.hidden];
      if (!hidden.includes(payload.selector)) hidden.push(payload.selector);
      this.#updateSettings(hidden);
    });
    EffectBus.on("instruction:restore-item", (payload) => {
      if (!payload?.selector || !this.#settings) return;
      const hidden = this.#settings.hidden.filter((s) => s !== payload.selector);
      this.#updateSettings(hidden);
    });
    EffectBus.on("instruction:register", (payload) => {
      if (!payload?.owner || !payload?.anchors?.length) return;
      this.#lateRegistrations.set(payload.owner, payload.anchors);
      this.#beeFingerprint = "";
      if (this.#visible) this.#collectAndBuild();
    });
    EffectBus.on("instruction:restore", async (payload) => {
      if (!payload?.settingsSig) return;
      const settings = await this.#resolveSettings(payload.settingsSig);
      if (!settings) return;
      this.#settingsSig = payload.settingsSig;
      this.#settings = settings;
      if (settings.manifestSig && settings.manifestSig !== this.#manifestSig) {
        const manifest = await this.#resolveManifest(settings.manifestSig);
        if (manifest) {
          this.#manifestSig = settings.manifestSig;
          this.#manifest = manifest;
        }
      }
      this.#emit();
    });
    EffectBus.on("bee:disposed", () => {
      this.#beeFingerprint = "";
    });
  }
  // ─── collection ──────────────────────────────────────
  #collectAndBuild() {
    const ioc = globalThis.ioc;
    if (!ioc) return;
    const keys = ioc.list?.() ?? [];
    const fingerprint = keys.slice().sort().join(",");
    if (fingerprint === this.#beeFingerprint && this.#manifest) return;
    this.#beeFingerprint = fingerprint;
    const sets = [];
    for (const key of keys) {
      const bee = ioc.get(key);
      if (!bee?.instructions?.length) continue;
      sets.push({
        owner: key,
        label: bee.name ?? key,
        anchors: bee.instructions
      });
    }
    for (const [owner, anchors] of this.#lateRegistrations) {
      if (sets.some((s) => s.owner === owner)) continue;
      const label = owner.replace(/^@[^/]+\//, "").replace(/Drone$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
      sets.push({ owner, label, anchors });
    }
    const locale = globalThis.ioc?.get?.("@hypercomb.social/I18n")?.locale ?? "en";
    const manifest = {
      version: 1,
      locale,
      timestamp: Date.now(),
      sets
    };
    this.#manifest = manifest;
    this.#captureManifest(manifest);
    if (!this.#settings || this.#settings.manifestSig !== this.#manifestSig) {
      this.#updateSettings([]);
    }
  }
  // ─── signature node: capture manifest ────────────────
  async #captureManifest(manifest) {
    const json = this.#deterministicJson(manifest);
    const sig = await this.#sign(json);
    this.#manifestSig = sig;
    this.#manifestCache.set(sig, manifest);
    await this.#storeResource(sig, json);
  }
  // ─── signature node: capture settings ────────────────
  async #captureSettings(settings) {
    const json = this.#deterministicJson(settings);
    const sig = await this.#sign(json);
    this.#settingsSig = sig;
    this.#settings = settings;
    this.#settingsCache.set(sig, settings);
    await this.#storeResource(sig, json);
    return sig;
  }
  // ─── settings update + history recording ─────────────
  async #updateSettings(hidden) {
    if (!this.#manifestSig) return;
    const settings = {
      version: 1,
      manifestSig: this.#manifestSig,
      hidden,
      at: Date.now()
    };
    const sig = await this.#captureSettings(settings);
    this.#recordHistory(sig);
    this.#emit();
  }
  // ─── resolve from cache or OPFS ──────────────────────
  async #resolveManifest(sig) {
    const cached = this.#manifestCache.get(sig);
    if (cached) return cached;
    const blob = await this.#loadResource(sig);
    if (!blob) return null;
    const manifest = JSON.parse(await blob.text());
    this.#manifestCache.set(sig, manifest);
    return manifest;
  }
  async #resolveSettings(sig) {
    const cached = this.#settingsCache.get(sig);
    if (cached) return cached;
    const blob = await this.#loadResource(sig);
    if (!blob) return null;
    const settings = JSON.parse(await blob.text());
    this.#settingsCache.set(sig, settings);
    return settings;
  }
  // ─── helpers ─────────────────────────────────────────
  #emit() {
    EffectBus.emit("instruction:state", this.state);
    this.dispatchEvent(new CustomEvent("change"));
  }
  #deterministicJson(data) {
    return JSON.stringify(data, Object.keys(data).sort(), 0);
  }
  async #sign(json) {
    const bytes = new TextEncoder().encode(json);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async #storeResource(sig, json) {
    try {
      const store = globalThis.ioc?.get?.("@hypercomb.social/Store");
      if (!store?.putResource) return;
      await store.putResource(new Blob([json], { type: "application/json" }));
    } catch {
    }
  }
  async #loadResource(sig) {
    try {
      const store = globalThis.ioc?.get?.("@hypercomb.social/Store");
      if (!store?.getResource) return null;
      return await store.getResource(sig);
    } catch {
      return null;
    }
  }
  #recordHistory(settingsSig) {
    try {
      const historyService = globalThis.ioc?.get?.("@diamondcoreprocessor.com/HistoryService");
      if (!historyService?.record) return;
      const lineage = globalThis.ioc?.get?.("@hypercomb.social/Lineage");
      if (!lineage) return;
      const locSig = lineage.locationSignature?.();
      if (!locSig) return;
      historyService.record(locSig, {
        op: "instruction-state",
        cell: settingsSig,
        at: Date.now(),
        groupId: "instruction"
      });
    } catch {
    }
  }
};
var BUILTIN_ANCHORS = [
  { selector: "dcp.open-processor", labelKey: "instruction.dcp.open-processor", placement: "top", category: "view" },
  { selector: "dcp.fit-content", labelKey: "instruction.dcp.fit-content", shortcut: "Ctrl+Click: lock", placement: "top", category: "view" },
  { selector: "dcp.zoom-out", labelKey: "instruction.dcp.zoom-out", shortcut: "Scroll down", placement: "top", category: "navigation" },
  { selector: "dcp.zoom-in", labelKey: "instruction.dcp.zoom-in", shortcut: "Scroll up", placement: "top", category: "navigation" },
  { selector: "dcp.lock", labelKey: "instruction.dcp.lock", placement: "top", category: "view" },
  { selector: "dcp.fullscreen", labelKey: "instruction.dcp.fullscreen", placement: "top", category: "view" },
  { selector: "dcp.layout-mode", labelKey: "instruction.dcp.layout-mode", command: "/layout", placement: "top", category: "view" },
  { selector: "dcp.instructions-toggle", labelKey: "instruction.dcp.instructions-toggle", command: "/instructions", placement: "top", category: "help" }
];
var _instructions = new InstructionDrone();
globalThis.ioc?.register?.("@diamondcoreprocessor.com/InstructionDrone", _instructions);
queueMicrotask(() => {
  EffectBus.emit("instruction:register", {
    owner: "@diamondcoreprocessor.com/InstructionDrone",
    anchors: BUILTIN_ANCHORS
  });
});
export {
  InstructionDrone
};
