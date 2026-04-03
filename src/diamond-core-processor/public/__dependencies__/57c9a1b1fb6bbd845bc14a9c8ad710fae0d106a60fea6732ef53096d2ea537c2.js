// @diamondcoreprocessor.com/substrate
// src/diamondcoreprocessor.com/substrate/substrate.queen.ts
import { QueenBee, EffectBus, hypercomb } from "@hypercomb/core";
var get = (key) => window.ioc?.get?.(key);
var SubstrateQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  command = "substrate";
  aliases = ["sub"];
  description = "Manage the default background image collection for new tiles";
  async execute(args) {
    const service = get("@diamondcoreprocessor.com/SubstrateService");
    if (!service) return;
    await service.ensureLoaded();
    const trimmed = args.trim().toLowerCase();
    const parts = trimmed.split(/\s+/).filter(Boolean);
    const subcommand = parts[0] ?? "";
    switch (subcommand) {
      case "": {
        const resolved = await service.resolve();
        const global = service.globalSignature;
        const i18n = get("@hypercomb.social/I18n");
        const t = (key, params) => i18n?.t?.(key, params) ?? key;
        if (resolved) {
          this.#log(t("substrate.active", { path: resolved }));
        } else {
          this.#log(t("substrate.none"));
        }
        if (global && global !== resolved) {
          this.#log(t("substrate.global", { path: global }));
        }
        return;
      }
      case "set": {
        const path = await this.#currentPath();
        if (!path) {
          this.#log("navigate into a hive first");
          return;
        }
        await service.setHive(path);
        this.#setIndicator(true);
        this.#log(`substrate set \u2192 ${path}`);
        return;
      }
      case "global": {
        const path = await this.#currentPath();
        if (!path) {
          this.#log("navigate into a hive first");
          return;
        }
        await service.setGlobal(path);
        this.#setIndicator(true);
        this.#log(`global substrate \u2192 ${path}`);
        return;
      }
      case "clear": {
        if (parts[1] === "global") {
          await service.clearGlobal();
        } else {
          await service.clearHive();
        }
        this.#setIndicator(false);
        this.#log("substrate cleared");
        return;
      }
      case "off": {
        await service.setInherit(false);
        this.#log("substrate inheritance disabled");
        return;
      }
      case "on": {
        await service.setInherit(true);
        this.#log("substrate inheritance enabled");
        return;
      }
      case "refresh":
      case "replay":
      case "reroll": {
        const lineage = get("@hypercomb.social/Lineage");
        const dir = await lineage?.explorerDir();
        if (!dir) return;
        const labels = [];
        for await (const [name, handle] of dir.entries()) {
          if (handle.kind === "directory") labels.push(name);
        }
        const count = await service.refresh(labels);
        this.#log(`substrate refreshed ${count} tile${count === 1 ? "" : "s"}`);
        void new hypercomb().act();
        return;
      }
      default: {
        this.#log(`unknown subcommand: ${subcommand}`);
        return;
      }
    }
  }
  #log(message, icon) {
    EffectBus.emit("activity:log", { message, icon });
  }
  #setIndicator(active) {
    if (active) {
      EffectBus.emit("indicator:set", { key: "substrate", icon: "\u25C8", label: "Substrate active" });
    } else {
      EffectBus.emit("indicator:clear", { key: "substrate" });
    }
    const saved = JSON.parse(localStorage.getItem("hc:indicators") ?? "[]");
    if (active) {
      if (!saved.find((i) => i.key === "substrate")) {
        saved.push({ key: "substrate", icon: "\u25C8", label: "Substrate active" });
      }
    } else {
      const idx = saved.findIndex((i) => i.key === "substrate");
      if (idx !== -1) saved.splice(idx, 1);
    }
    localStorage.setItem("hc:indicators", JSON.stringify(saved));
  }
  async #currentPath() {
    const lineage = get("@hypercomb.social/Lineage");
    if (!lineage) return null;
    const segments = lineage.explorerSegments();
    return segments.length > 0 ? segments.join("/") : null;
  }
};
var _substrate = new SubstrateQueenBee();
window.ioc.register("@diamondcoreprocessor.com/SubstrateQueenBee", _substrate);

// src/diamondcoreprocessor.com/substrate/substrate.service.ts
import { EffectBus as EffectBus2 } from "@hypercomb/core";
var PROPS_FILE = "0000";
var GLOBAL_KEY = "substrate-global";
var HIVE_KEY = "substrate";
var INHERIT_KEY = "substrate-inherit";
var STORAGE_KEY = "hc:substrate-global";
var RESOLVED_KEY = "hc:substrate-resolved";
var get2 = (key) => window.ioc?.get?.(key);
var SubstrateService = class extends EventTarget {
  #loaded = false;
  #globalSignature = null;
  #imageCache = /* @__PURE__ */ new Map();
  // layerSig → image sigs
  // ── public API ──
  get globalSignature() {
    return this.#globalSignature;
  }
  async ensureLoaded() {
    if (this.#loaded) return;
    await this.#loadGlobal();
    this.#loaded = true;
  }
  /** Set the global substrate layer signature. */
  async setGlobal(layerSignature) {
    this.#globalSignature = layerSignature;
    localStorage.setItem(STORAGE_KEY, layerSignature);
    await this.#saveGlobal(layerSignature);
    this.#imageCache.delete(layerSignature);
    EffectBus2.emit("substrate:changed", { scope: "global", signature: layerSignature });
  }
  /** Clear the global substrate. */
  async clearGlobal() {
    this.#globalSignature = null;
    this.#resolvedCache = null;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(RESOLVED_KEY);
    await this.#saveGlobal(null);
    EffectBus2.emit("substrate:changed", { scope: "global", signature: null });
  }
  /** Set per-hive substrate on the current explorer directory. */
  async setHive(layerSignature) {
    const dir = await this.#explorerDir();
    if (!dir) return;
    await this.#writeProps(dir, { [HIVE_KEY]: layerSignature });
    this.#imageCache.delete(layerSignature);
    EffectBus2.emit("substrate:changed", { scope: "hive", signature: layerSignature });
  }
  /** Clear per-hive substrate override. */
  async clearHive() {
    const dir = await this.#explorerDir();
    if (!dir) return;
    await this.#writeProps(dir, { [HIVE_KEY]: null });
    this.#resolvedCache = null;
    localStorage.removeItem(RESOLVED_KEY);
    EffectBus2.emit("substrate:changed", { scope: "hive", signature: null });
  }
  /** Suppress child overrides — only global applies under this hive. */
  async setInherit(inherit) {
    const dir = await this.#explorerDir();
    if (!dir) return;
    await this.#writeProps(dir, { [INHERIT_KEY]: inherit });
    EffectBus2.emit("substrate:changed", { scope: "inherit", inherit });
  }
  /**
   * Resolve the effective substrate layer signature for the current location.
   * Walks up from current hive checking for per-hive overrides, respecting
   * inherit=false barriers. Falls back to global.
   */
  async resolve() {
    await this.ensureLoaded();
    const store = this.#store();
    if (!store) return this.#globalSignature;
    const lineage = this.#lineage();
    if (!lineage) return this.#globalSignature;
    const segments = [...lineage.explorerSegments()];
    while (segments.length > 0) {
      try {
        let dir = store.hypercombRoot;
        for (const seg of segments) {
          dir = await dir.getDirectoryHandle(seg);
        }
        const props = await this.#readProps(dir);
        if (props[INHERIT_KEY] === false) return this.#globalSignature;
        const sig = props[HIVE_KEY];
        if (typeof sig === "string" && sig.length > 0) return sig;
      } catch {
      }
      segments.pop();
    }
    return this.#globalSignature;
  }
  /**
   * Pick a random image signature from the resolved substrate layer.
   * Reads the tile images within that hive and caches them.
   */
  async pickRandomImage() {
    const layerSignature = await this.resolve();
    if (!layerSignature) return null;
    const images = await this.#collectImages(layerSignature);
    if (images.length === 0) return null;
    return images[Math.floor(Math.random() * images.length)];
  }
  /** Preload all substrate images into the image atlas for instant rendering. */
  async preloadImages() {
    const layerSignature = await this.resolve();
    if (!layerSignature) return;
    const images = await this.#collectImages(layerSignature);
    if (images.length === 0) return;
    const store = this.#store();
    if (!store) return;
    const showCell = get2("@diamondcoreprocessor.com/ShowCellDrone");
    if (!showCell?.imageAtlas) return;
    for (const sig of images) {
      if (showCell.imageAtlas.hasImage(sig)) continue;
      try {
        const blob = await store.getResource(sig);
        if (blob) await showCell.imageAtlas.loadImage(sig, blob);
      } catch {
      }
    }
  }
  /**
   * Synchronous pick — returns a pre-resolved image sig from cache.
   * Returns null if substrate is not loaded or pool is empty.
   */
  pickRandomImageSync() {
    const path = this.#resolvedCache;
    if (!path) return null;
    const images = this.#imageCache.get(path);
    if (!images || images.length === 0) return null;
    return images[Math.floor(Math.random() * images.length)];
  }
  #resolvedCache = null;
  /** Warm up: resolve + collect + preload so sync picks are instant. */
  async warmUp() {
    this.#resolvedCache = await this.resolve();
    if (this.#resolvedCache) {
      localStorage.setItem(RESOLVED_KEY, this.#resolvedCache);
    }
    if (!this.#resolvedCache) {
      this.#resolvedCache = localStorage.getItem(RESOLVED_KEY);
    }
    if (!this.#resolvedCache) return;
    await this.#collectImages(this.#resolvedCache);
    await this.preloadImages();
    await this.#fillPropsPool();
  }
  // ── pre-generated props pool ──
  #propsPool = [];
  async #fillPropsPool() {
    const store = this.#store();
    if (!store) return;
    const path = this.#resolvedCache;
    if (!path) return;
    const images = this.#imageCache.get(path);
    if (!images || images.length === 0) return;
    const byImage = /* @__PURE__ */ new Map();
    this.#propsPool = [];
    for (const imageSig of images) {
      if (byImage.has(imageSig)) {
        this.#propsPool.push({ imageSig, propsSig: byImage.get(imageSig) });
        continue;
      }
      try {
        const props = { small: { image: imageSig }, substrate: true };
        const json = JSON.stringify(props, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const propsSig = await store.putResource(blob);
        byImage.set(imageSig, propsSig);
        this.#propsPool.push({ imageSig, propsSig });
      } catch {
      }
    }
    const minPool = 50;
    if (this.#propsPool.length > 0 && this.#propsPool.length < minPool) {
      const base = [...this.#propsPool];
      while (this.#propsPool.length < minPool) {
        this.#propsPool.push(base[this.#propsPool.length % base.length]);
      }
    }
  }
  /**
   * Synchronously assign a substrate image to a cell.
   * Writes to the props index (localStorage) immediately — no async work.
   * Returns true if an image was assigned.
   */
  /**
   * Assign a substrate image to a cell that has NO props at all.
   * Skips any cell that already has an entry in the props index.
   * Returns true if an image was assigned.
   */
  applyToCell(label) {
    if (this.#propsPool.length === 0) return false;
    const indexKey = "hc:tile-props-index";
    const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
    if (index[label]) return false;
    const entry = this.#propsPool[Math.floor(Math.random() * this.#propsPool.length)];
    index[label] = entry.propsSig;
    localStorage.setItem(indexKey, JSON.stringify(index));
    return true;
  }
  /** Remove a cell from the props index (call on cell:removed). */
  clearCell(label) {
    const indexKey = "hc:tile-props-index";
    const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
    delete index[label];
    localStorage.setItem(indexKey, JSON.stringify(index));
  }
  /**
   * Apply substrate images to blank tiles (tiles with no props entry).
   * Only called with noImageLabels — tiles the renderer confirms have no image.
   * Never re-rolls existing assignments.
   */
  applyToAllBlanks(labels) {
    if (this.#propsPool.length === 0 || labels.length === 0) return [];
    const indexKey = "hc:tile-props-index";
    const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
    const applied = [];
    for (const label of labels) {
      if (index[label]) continue;
      const entry = this.#propsPool[Math.floor(Math.random() * this.#propsPool.length)];
      index[label] = entry.propsSig;
      applied.push(label);
    }
    if (applied.length > 0) {
      localStorage.setItem(indexKey, JSON.stringify(index));
    }
    return applied;
  }
  /**
   * Re-roll all substrate-assigned tiles with fresh random images.
   * Clears substrate entries from the props index, re-warms the pool,
   * then re-applies to all blanks on the next render cycle.
   * Returns the number of tiles refreshed.
   */
  async refresh(visibleLabels) {
    if (this.#propsPool.length === 0) return 0;
    const indexKey = "hc:tile-props-index";
    const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
    const substrateSigs = new Set(this.#propsPool.map((p) => p.propsSig));
    let cleared = 0;
    for (const label of visibleLabels) {
      if (index[label] && substrateSigs.has(index[label])) {
        delete index[label];
        cleared++;
      }
    }
    if (cleared > 0) {
      localStorage.setItem(indexKey, JSON.stringify(index));
    }
    this.invalidateCache();
    await this.warmUp();
    const applied = this.applyToAllBlanks(visibleLabels);
    return applied.length;
  }
  // ── private: image collection ──
  async #collectImages(layerPath) {
    if (this.#imageCache.has(layerPath)) return this.#imageCache.get(layerPath);
    const store = this.#store();
    if (!store) return [];
    const images = [];
    const propsIndex = JSON.parse(localStorage.getItem("hc:tile-props-index") ?? "{}");
    try {
      let dir = store.hypercombRoot;
      const segments = layerPath.split("/").filter(Boolean);
      for (const seg of segments) {
        dir = await dir.getDirectoryHandle(seg);
      }
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== "directory") continue;
        try {
          const propsSig = propsIndex[name];
          if (propsSig) {
            const blob = await store.getResource(propsSig);
            if (blob) {
              const props = JSON.parse(await blob.text());
              const sig = props?.small?.image ?? props?.flat?.small?.image;
              if (typeof sig === "string" && /^[0-9a-f]{64}$/.test(sig)) {
                images.push(sig);
              }
            }
          }
        } catch {
        }
      }
    } catch {
    }
    this.#imageCache.set(layerPath, images);
    return images;
  }
  /** Invalidate the image cache for a given layer (or all). */
  invalidateCache(layerPath) {
    if (layerPath) this.#imageCache.delete(layerPath);
    else this.#imageCache.clear();
  }
  // ── private: global persistence (root 0000) ──
  async #loadGlobal() {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) this.#globalSignature = cached;
    try {
      const store = this.#store();
      if (!store) return;
      const props = await this.#readRootProps(store);
      const sig = props[GLOBAL_KEY];
      if (typeof sig === "string" && sig.length > 0) {
        this.#globalSignature = sig;
        localStorage.setItem(STORAGE_KEY, sig);
      }
    } catch {
    }
  }
  async #saveGlobal(signature) {
    try {
      const store = this.#store();
      if (!store) return;
      await this.#writeRootProps(store, { [GLOBAL_KEY]: signature });
    } catch {
    }
  }
  // ── private: OPFS helpers ──
  async #readProps(dir) {
    try {
      const fh = await dir.getFileHandle(PROPS_FILE);
      const file = await fh.getFile();
      return JSON.parse(await file.text());
    } catch {
      return {};
    }
  }
  async #writeProps(dir, updates) {
    const existing = await this.#readProps(dir);
    const merged = { ...existing, ...updates };
    const fh = await dir.getFileHandle(PROPS_FILE, { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify(merged));
    await writable.close();
  }
  async #readRootProps(store) {
    try {
      const fh = await store.opfsRoot.getFileHandle(PROPS_FILE);
      const file = await fh.getFile();
      return JSON.parse(await file.text());
    } catch {
      return {};
    }
  }
  async #writeRootProps(store, updates) {
    const existing = await this.#readRootProps(store);
    const merged = { ...existing, ...updates };
    const fh = await store.opfsRoot.getFileHandle(PROPS_FILE, { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify(merged));
    await writable.close();
  }
  // ── private: IoC resolution ──
  #store() {
    return get2("@hypercomb.social/Store");
  }
  #lineage() {
    return get2("@hypercomb.social/Lineage");
  }
  async #explorerDir() {
    return this.#lineage()?.explorerDir() ?? null;
  }
};
window.ioc.register("@diamondcoreprocessor.com/SubstrateService", new SubstrateService());
export {
  SubstrateQueenBee,
  SubstrateService
};
