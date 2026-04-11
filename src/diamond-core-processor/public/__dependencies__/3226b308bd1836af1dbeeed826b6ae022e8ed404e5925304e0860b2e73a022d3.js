// @diamondcoreprocessor.com/substrate
// hypercomb-essentials/src/diamondcoreprocessor.com/substrate/folder-handles.ts
var DB_NAME = "hypercomb-folder-handles";
var STORE_NAME = "handles";
var DB_VERSION = 1;
var dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
function txn(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
function isFolderAccessSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}
async function linkFolder(label) {
  if (!isFolderAccessSupported()) return null;
  let handle;
  try {
    handle = await window.showDirectoryPicker({ mode: "read" });
  } catch {
    return null;
  }
  const id = crypto.randomUUID();
  const entry = {
    id,
    handle,
    label: label ?? handle.name,
    createdAt: Date.now()
  };
  await txn("readwrite", (store) => store.put(entry));
  return entry;
}
async function getHandle(id) {
  try {
    const result = await txn("readonly", (store) => store.get(id));
    return result ?? null;
  } catch {
    return null;
  }
}
async function removeHandle(id) {
  try {
    await txn("readwrite", (store) => store.delete(id));
  } catch {
  }
}
async function listHandles() {
  try {
    return await txn("readonly", (store) => store.getAll());
  } catch {
    return [];
  }
}
async function queryPermission(handle) {
  try {
    const state = await handle.queryPermission({ mode: "read" });
    return state;
  } catch {
    return "denied";
  }
}
async function requestPermission(handle) {
  try {
    const state = await handle.requestPermission({ mode: "read" });
    return state;
  } catch {
    return "denied";
  }
}
var IMAGE_EXTENSIONS = /* @__PURE__ */ new Set(["webp", "png", "jpg", "jpeg", "gif", "avif", "svg", "bmp"]);
async function readImagesFromHandle(handle) {
  const out = [];
  try {
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind !== "file") continue;
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      if (!IMAGE_EXTENSIONS.has(ext)) continue;
      try {
        const file = await entry.getFile();
        if (file.type && !file.type.startsWith("image/") && !IMAGE_EXTENSIONS.has(ext)) continue;
        out.push({ name, blob: file });
      } catch {
      }
    }
  } catch {
  }
  return out;
}

// hypercomb-essentials/src/diamondcoreprocessor.com/substrate/substrate.queen.ts
import { QueenBee, EffectBus, hypercomb } from "@hypercomb/core";
var get = (key) => window.ioc?.get?.(key);
var BUILTIN_DEFAULTS_ID = "builtin:defaults";
var SubstrateQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  command = "substrate";
  aliases = [];
  description = "Manage substrate background image sources";
  async execute(args) {
    const service = get("@diamondcoreprocessor.com/SubstrateService");
    if (!service) return;
    await service.ensureLoaded();
    const trimmed = args.trim().toLowerCase();
    switch (trimmed) {
      case "":
        EffectBus.emit("substrate-organizer:open", {});
        return;
      case "here": {
        const path = await this.#currentPath();
        if (!path) {
          this.#toast("navigate into a hive first");
          return;
        }
        const source = await service.addHiveSource(path);
        await service.setHive(path);
        await this.#refreshVisible(service);
        this.#toast(`substrate \u2192 ${source.label}`);
        return;
      }
      case "link": {
        const source = await service.linkLocalFolder();
        if (!source) {
          this.#toast("folder link cancelled or unsupported");
          return;
        }
        await this.#refreshVisible(service);
        this.#toast(`substrate \u2192 ${source.label}`);
        return;
      }
      case "off": {
        await service.setActive(null);
        await this.#refreshVisible(service);
        this.#toast("substrate off");
        return;
      }
      case "on": {
        const registry = service.registry;
        const target = registry.sources.find((s) => s.id === registry.activeId) ?? registry.sources.find((s) => !s.builtin) ?? registry.sources.find((s) => s.id === BUILTIN_DEFAULTS_ID);
        if (!target) {
          this.#toast("no substrate sources");
          return;
        }
        await service.setActive(target.id);
        await this.#refreshVisible(service);
        this.#toast(`substrate on \u2192 ${target.label}`);
        return;
      }
      case "reset":
      case "defaults": {
        await service.clearHive();
        await service.setActive(BUILTIN_DEFAULTS_ID);
        await this.#refreshVisible(service);
        this.#toast("substrate reset to defaults");
        return;
      }
      case "list": {
        const sources = service.listSources();
        if (sources.length === 0) {
          this.#toast("no substrate sources");
          return;
        }
        for (const s of sources) {
          const active = s.id === service.registry.activeId ? "\u25CF" : "\u25CB";
          this.#toast(`${active} ${s.type}: ${s.label}`);
        }
        return;
      }
      default:
        this.#toast(`unknown: /substrate ${trimmed}`);
    }
  }
  #toast(message) {
    EffectBus.emit("activity:log", { message, icon: "\u25C8" });
  }
  async #refreshVisible(service) {
    const lineage = get("@hypercomb.social/Lineage");
    const dir = await lineage?.explorerDir();
    if (!dir) {
      await service.warmUp();
      return;
    }
    const labels = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") labels.push(name);
    }
    const count = await service.refresh(labels, true);
    if (count > 0) {
      this.#toast(`refreshed ${count} tile${count === 1 ? "" : "s"}`);
      void new hypercomb().act();
    }
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

// hypercomb-essentials/src/diamondcoreprocessor.com/substrate/substrate.service.ts
import { EffectBus as EffectBus2, EMPTY_SUBSTRATE_REGISTRY } from "@hypercomb/core";
var PROPS_FILE = "0000";
var HIVE_KEY = "substrate";
var INHERIT_KEY = "substrate-inherit";
var REGISTRY_KEY = "substrate-registry";
var LEGACY_GLOBAL_KEY = "substrate-global";
var LEGACY_LS_GLOBAL = "hc:substrate-global";
var BUILTIN_DEFAULTS = {
  type: "url",
  id: "builtin:defaults",
  baseUrl: "/substrate/",
  label: "Hypercomb defaults",
  builtin: true
};
var get2 = (key) => window.ioc?.get?.(key);
async function renderToHexBox(blob, w, h) {
  const bitmap = await createImageBitmap(blob);
  try {
    const useOffscreen = typeof OffscreenCanvas !== "undefined";
    const canvas = useOffscreen ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    const scale = Math.max(w / bitmap.width, h / bitmap.height);
    const scaledW = bitmap.width * scale;
    const scaledH = bitmap.height * scale;
    const x = (w - scaledW) / 2;
    const y = (h - scaledH) / 2;
    ctx.drawImage(bitmap, x, y, scaledW, scaledH);
    if (useOffscreen && "convertToBlob" in canvas) {
      return await canvas.convertToBlob({ type: "image/webp" });
    }
    return await new Promise(
      (resolve, reject) => canvas.toBlob(
        (b) => b ? resolve(b) : reject(new Error("toBlob failed")),
        "image/webp"
      )
    );
  } finally {
    bitmap.close();
  }
}
var SubstrateService = class extends EventTarget {
  #loaded = false;
  #registry = EMPTY_SUBSTRATE_REGISTRY;
  #resolved = null;
  #propsPool = [];
  // ───────────────────────── registry ─────────────────────────
  get registry() {
    return this.#registry;
  }
  get activeSource() {
    return this.#registry.sources.find((s) => s.id === this.#registry.activeId) ?? null;
  }
  get resolvedSource() {
    return this.#resolved?.source ?? null;
  }
  get resolvedImageCount() {
    return this.#resolved?.images.length ?? 0;
  }
  async ensureLoaded() {
    if (this.#loaded) return;
    await this.#loadRegistry();
    this.#loaded = true;
  }
  async #loadRegistry() {
    const store = this.#store();
    if (!store) return;
    let registry = null;
    try {
      const props = await this.#readRootProps(store);
      const raw = props[REGISTRY_KEY];
      if (raw && typeof raw === "object" && Array.isArray(raw.sources)) {
        registry = raw;
      }
    } catch {
    }
    if (!registry) {
      registry = { sources: [BUILTIN_DEFAULTS], activeId: BUILTIN_DEFAULTS.id };
      try {
        const props = await this.#readRootProps(store);
        const legacy = props[LEGACY_GLOBAL_KEY] ?? localStorage.getItem(LEGACY_LS_GLOBAL);
        if (typeof legacy === "string" && legacy.length > 0) {
          const hiveSource = {
            type: "hive",
            id: `hive:${legacy}`,
            path: legacy,
            label: legacy
          };
          registry = { sources: [BUILTIN_DEFAULTS, hiveSource], activeId: hiveSource.id };
        }
      } catch {
      }
      await this.#saveRegistry(registry);
    } else {
      if (!registry.sources.some((s) => s.id === BUILTIN_DEFAULTS.id)) {
        registry = { sources: [BUILTIN_DEFAULTS, ...registry.sources], activeId: registry.activeId };
        await this.#saveRegistry(registry);
      }
    }
    this.#registry = registry;
  }
  async #saveRegistry(next) {
    this.#registry = next;
    const store = this.#store();
    if (!store) return;
    try {
      await this.#writeRootProps(store, { [REGISTRY_KEY]: next });
    } catch {
    }
  }
  listSources() {
    return this.#registry.sources;
  }
  async addSource(source, setActive = true) {
    await this.ensureLoaded();
    const id = source.id ?? `${source.type}:${crypto.randomUUID()}`;
    const full = { ...source, id };
    const sources = [...this.#registry.sources, full];
    const activeId = setActive ? full.id : this.#registry.activeId;
    await this.#saveRegistry({ sources, activeId });
    EffectBus2.emit("substrate:changed", { scope: "registry", sourceId: full.id });
    return full;
  }
  async removeSource(id) {
    await this.ensureLoaded();
    const target = this.#registry.sources.find((s) => s.id === id);
    if (!target || target.builtin) return;
    if (target.type === "folder") {
      await removeHandle(target.handleId);
    }
    const sources = this.#registry.sources.filter((s) => s.id !== id);
    const activeId = this.#registry.activeId === id ? null : this.#registry.activeId;
    await this.#saveRegistry({ sources, activeId });
    EffectBus2.emit("substrate:changed", { scope: "registry", sourceId: id });
  }
  async setActive(id) {
    await this.ensureLoaded();
    if (id !== null && !this.#registry.sources.some((s) => s.id === id)) return;
    await this.#saveRegistry({ sources: this.#registry.sources, activeId: id });
    this.#resolved = null;
    this.#propsPool = [];
    EffectBus2.emit("substrate:changed", { scope: "active", sourceId: id });
  }
  async renameSource(id, label) {
    await this.ensureLoaded();
    const sources = this.#registry.sources.map((s) => s.id === id ? { ...s, label } : s);
    await this.#saveRegistry({ sources, activeId: this.#registry.activeId });
  }
  /** Prompt the user for a local folder and register it as a new source. */
  async linkLocalFolder() {
    if (!isFolderAccessSupported()) return null;
    const entry = await linkFolder();
    if (!entry) return null;
    return this.addSource({
      type: "folder",
      handleId: entry.id,
      label: entry.label
    }, true);
  }
  /** Add a hive source for the given path (e.g. from `/substrate here`). */
  async addHiveSource(path, label) {
    const existing = this.#registry.sources.find((s) => s.type === "hive" && s.path === path);
    if (existing) {
      await this.setActive(existing.id);
      return existing;
    }
    return this.addSource({ type: "hive", path, label: label ?? path }, true);
  }
  // ─────────────────────── per-hive overrides ───────────────────────
  async setHive(path) {
    const dir = await this.#explorerDir();
    if (!dir) return;
    await this.#writeProps(dir, { [HIVE_KEY]: path });
    EffectBus2.emit("substrate:changed", { scope: "hive", path });
  }
  async clearHive() {
    const dir = await this.#explorerDir();
    if (!dir) return;
    await this.#writeProps(dir, { [HIVE_KEY]: null });
    EffectBus2.emit("substrate:changed", { scope: "hive", path: null });
  }
  async setInherit(inherit) {
    const dir = await this.#explorerDir();
    if (!dir) return;
    await this.#writeProps(dir, { [INHERIT_KEY]: inherit });
    EffectBus2.emit("substrate:changed", { scope: "inherit", inherit });
  }
  // ───────────────────────── resolution ─────────────────────────
  /**
   * Resolve the active substrate source for the current location.
   * Walks per-hive overrides first, falls back to registry.activeId,
   * then to the first builtin source.
   */
  async resolve() {
    await this.ensureLoaded();
    const hiveOverride = await this.#resolveHiveOverride();
    if (hiveOverride) return hiveOverride;
    const active = this.activeSource;
    if (active) return active;
    return this.#registry.sources.find((s) => s.builtin) ?? null;
  }
  async #resolveHiveOverride() {
    const store = this.#store();
    if (!store) return null;
    const lineage = this.#lineage();
    if (!lineage) return null;
    const segments = [...lineage.explorerSegments()];
    while (segments.length > 0) {
      try {
        let dir = store.hypercombRoot;
        for (const seg of segments) dir = await dir.getDirectoryHandle(seg);
        const props = await this.#readProps(dir);
        if (props[INHERIT_KEY] === false) return null;
        const path = props[HIVE_KEY];
        if (typeof path === "string" && path.length > 0) {
          return {
            type: "hive",
            id: `hive:override:${path}`,
            path,
            label: path
          };
        }
      } catch {
      }
      segments.pop();
    }
    return null;
  }
  // ─────────────────── source resolvers (per type) ───────────────────
  async #loadSourceImages(source) {
    switch (source.type) {
      case "hive":
        return this.#loadHiveImages(source.path);
      case "url":
        return this.#loadUrlImages(source.baseUrl);
      case "folder":
        return this.#loadFolderImages(source.handleId);
      case "layer":
        return this.#loadLayerImages(source.signature);
    }
  }
  async #loadHiveImages(layerPath) {
    const store = this.#store();
    if (!store) return [];
    const images = [];
    const propsIndex = JSON.parse(localStorage.getItem("hc:tile-props-index") ?? "{}");
    try {
      let dir = store.hypercombRoot;
      for (const seg of layerPath.split("/").filter(Boolean)) {
        dir = await dir.getDirectoryHandle(seg);
      }
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== "directory") continue;
        try {
          const propsSig = propsIndex[name];
          if (!propsSig) continue;
          const blob = await store.getResource(propsSig);
          if (!blob) continue;
          const props = JSON.parse(await blob.text());
          const sig = props?.small?.image ?? props?.flat?.small?.image;
          if (typeof sig === "string" && /^[0-9a-f]{64}$/.test(sig)) images.push(sig);
        } catch {
        }
      }
    } catch {
    }
    return images;
  }
  async #loadUrlImages(baseUrl) {
    const store = this.#store();
    if (!store) return [];
    let manifest;
    try {
      const res = await fetch(`${baseUrl}manifest.json`, { cache: "force-cache" });
      if (!res.ok) return [];
      manifest = await res.json();
    } catch {
      return [];
    }
    const names = manifest.images ?? [];
    const sigs = [];
    for (const name of names) {
      try {
        const r = await fetch(`${baseUrl}${name}`, { cache: "force-cache" });
        if (!r.ok) continue;
        const blob = await r.blob();
        const sig = await store.putResource(blob);
        sigs.push(sig);
      } catch {
      }
    }
    return sigs;
  }
  async #loadFolderImages(handleId) {
    const store = this.#store();
    if (!store) return [];
    const entry = await getHandle(handleId);
    if (!entry) return [];
    const permission = await queryPermission(entry.handle);
    if (permission !== "granted") {
      EffectBus2.emit("substrate:folder-permission", { handleId, permission });
      return [];
    }
    const files = await readImagesFromHandle(entry.handle);
    const sigs = [];
    for (const { blob } of files) {
      try {
        const sig = await store.putResource(blob);
        sigs.push(sig);
      } catch {
      }
    }
    return sigs;
  }
  async #loadLayerImages(_layerSignature) {
    return [];
  }
  /**
   * Request permission for a folder source from a user gesture.
   * Call this from a click handler in the organizer UI.
   */
  async requestFolderAccess(handleId) {
    const entry = await getHandle(handleId);
    if (!entry) return "denied";
    return requestPermission(entry.handle);
  }
  // ─────────────────────── warm-up & picking ───────────────────────
  /** Resolve active source, fetch images, preload atlas, build props pool. */
  async warmUp() {
    await this.ensureLoaded();
    const source = await this.resolve();
    if (!source) {
      this.#resolved = null;
      this.#propsPool = [];
      return;
    }
    const images = await this.#loadSourceImages(source);
    this.#resolved = { source, images };
    await this.#preloadAtlas(images);
    await this.#fillPropsPool(images);
    void this.#migrateLegacySubstrateProps();
  }
  /**
   * One-time cleanup: existing substrate-applied tiles in localStorage point
   * to old-format props (no `flat.small.image`). Detect and remove those
   * entries so the next render reports them as blank and applyToAllBlanks
   * gives them a fresh pool entry containing both orientation variants.
   */
  async #migrateLegacySubstrateProps() {
    const FLAG = "hc:substrate-flat-format-v1";
    if (localStorage.getItem(FLAG) === "true") return;
    const store = this.#store();
    if (!store) return;
    try {
      const indexKey = "hc:tile-props-index";
      const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
      const seenSigs = /* @__PURE__ */ new Map();
      let changed = false;
      for (const [label, propsSig] of Object.entries(index)) {
        if (typeof propsSig !== "string" || !propsSig) continue;
        let legacy = seenSigs.get(propsSig);
        if (legacy === void 0) {
          try {
            const blob = await store.getResource(propsSig);
            if (!blob) {
              seenSigs.set(propsSig, false);
              continue;
            }
            const parsed = JSON.parse(await blob.text());
            legacy = parsed?.substrate === true && !parsed?.flat?.small?.image;
          } catch {
            legacy = false;
          }
          seenSigs.set(propsSig, !!legacy);
        }
        if (legacy) {
          delete index[label];
          changed = true;
        }
      }
      if (changed) localStorage.setItem(indexKey, JSON.stringify(index));
      localStorage.setItem(FLAG, "true");
    } catch {
    }
  }
  async #preloadAtlas(images) {
    if (images.length === 0) return;
    const store = this.#store();
    if (!store) return;
    const showCell = get2("@diamondcoreprocessor.com/ShowCellDrone");
    const atlas = showCell?.imageAtlas;
    if (!atlas) return;
    for (const sig of images) {
      if (atlas.hasImage(sig) || atlas.hasFailed(sig)) continue;
      try {
        const blob = await store.getResource(sig);
        if (blob) await atlas.loadImage(sig, blob);
      } catch {
      }
    }
  }
  async #fillPropsPool(images) {
    const store = this.#store();
    const settings = get2("@diamondcoreprocessor.com/Settings");
    if (!store || !settings || images.length === 0) {
      this.#propsPool = [];
      return;
    }
    const pointW = Math.round(settings.hexWidth("point-top"));
    const pointH = Math.round(settings.hexHeight("point-top"));
    const flatW = Math.round(settings.hexWidth("flat-top"));
    const flatH = Math.round(settings.hexHeight("flat-top"));
    const byImage = /* @__PURE__ */ new Map();
    const pool = [];
    for (const imageSig of images) {
      if (byImage.has(imageSig)) {
        pool.push({ imageSig, propsSig: byImage.get(imageSig) });
        continue;
      }
      try {
        const sourceBlob = await store.getResource(imageSig);
        if (!sourceBlob) continue;
        const pointBlob = await renderToHexBox(sourceBlob, pointW, pointH);
        const flatBlob = await renderToHexBox(sourceBlob, flatW, flatH);
        const pointSig = await store.putResource(pointBlob);
        const flatSig = await store.putResource(flatBlob);
        const props = {
          small: { image: pointSig },
          flat: { small: { image: flatSig } },
          substrate: true
        };
        const blob = new Blob([JSON.stringify(props, null, 2)], { type: "application/json" });
        const propsSig = await store.putResource(blob);
        byImage.set(imageSig, propsSig);
        pool.push({ imageSig, propsSig });
      } catch {
      }
    }
    const MIN_POOL = 50;
    if (pool.length > 0 && pool.length < MIN_POOL) {
      const base = [...pool];
      while (pool.length < MIN_POOL) pool.push(base[pool.length % base.length]);
    }
    this.#propsPool = pool;
  }
  pickRandomImageSync() {
    if (this.#propsPool.length === 0) return null;
    return this.#propsPool[Math.floor(Math.random() * this.#propsPool.length)].imageSig;
  }
  // ────────────────────── cell assignment API ──────────────────────
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
  rerollCell(label) {
    if (this.#propsPool.length === 0) return false;
    const indexKey = "hc:tile-props-index";
    const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
    delete index[label];
    const entry = this.#propsPool[Math.floor(Math.random() * this.#propsPool.length)];
    index[label] = entry.propsSig;
    localStorage.setItem(indexKey, JSON.stringify(index));
    return true;
  }
  clearCell(label) {
    const indexKey = "hc:tile-props-index";
    const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
    delete index[label];
    localStorage.setItem(indexKey, JSON.stringify(index));
  }
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
    if (applied.length > 0) localStorage.setItem(indexKey, JSON.stringify(index));
    return applied;
  }
  /**
   * Reroll every substrate-assigned tile with a fresh pick from the current
   * pool. Optionally re-runs warm-up first (e.g. after a linked folder got
   * new files). Returns the count of tiles reassigned.
   */
  async refresh(visibleLabels, rewarm = true) {
    if (rewarm) await this.warmUp();
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
    if (cleared > 0) localStorage.setItem(indexKey, JSON.stringify(index));
    return this.applyToAllBlanks(visibleLabels).length;
  }
  // ───────────────────────── OPFS helpers ─────────────────────────
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
    for (const k of Object.keys(updates)) if (merged[k] === null) delete merged[k];
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
  // ───────────────────────── IoC helpers ─────────────────────────
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
  SubstrateService,
  getHandle,
  isFolderAccessSupported,
  linkFolder,
  listHandles,
  queryPermission,
  readImagesFromHandle,
  removeHandle,
  requestPermission
};
