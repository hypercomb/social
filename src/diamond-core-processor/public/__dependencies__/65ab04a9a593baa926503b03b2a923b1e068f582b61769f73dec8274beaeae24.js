// @diamondcoreprocessor.com/substrate
// src/diamondcoreprocessor.com/substrate/folder-handles.ts
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

// src/diamondcoreprocessor.com/substrate/reroll.queen.ts
import { QueenBee, EffectBus, hypercomb } from "@hypercomb/core";
var get = (key) => window.ioc?.get?.(key);
var RerollQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  command = "reroll";
  aliases = [];
  description = "Reroll substrate background images on tiles";
  async execute(args) {
    const service = get("@diamondcoreprocessor.com/SubstrateService");
    if (!service) return;
    await service.ensureLoaded();
    const targets = await this.#resolveTargets(args);
    if (targets.length === 0) {
      this.#toast("nothing to reroll");
      return;
    }
    const rerolled = service.rerollCells(targets);
    if (rerolled.length === 0) {
      this.#toast("no substrate tiles in target");
      return;
    }
    for (const cell of rerolled) {
      EffectBus.emit("substrate:rerolled", { cell });
    }
    this.#toast(`rerolled ${rerolled.length} tile${rerolled.length === 1 ? "" : "s"}`);
    void new hypercomb().act();
  }
  /**
   * Resolution order:
   *   1. explicit bracket batch    → those names
   *   2. explicit single name arg  → [that name]
   *   3. current selection         → selection contents
   *   4. no target information     → every tile in the current hive
   */
  async #resolveTargets(args) {
    const explicit = parseTargets(args);
    if (explicit.length > 0) return explicit;
    const selection = get("@diamondcoreprocessor.com/SelectionService");
    if (selection && selection.selected.size > 0) {
      return Array.from(selection.selected);
    }
    return this.#visibleHiveLabels();
  }
  async #visibleHiveLabels() {
    const lineage = get("@hypercomb.social/Lineage");
    const dir = await lineage?.explorerDir();
    if (!dir) return [];
    const labels = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") labels.push(name);
    }
    return labels;
  }
  #toast(message) {
    EffectBus.emit("activity:log", { message, icon: "\u25C8" });
  }
};
function parseTargets(args) {
  const trimmed = args.trim();
  if (!trimmed) return [];
  const bracketStart = trimmed.indexOf("[");
  if (bracketStart >= 0) {
    const bracketEnd = trimmed.lastIndexOf("]");
    const inner = bracketEnd > bracketStart ? trimmed.slice(bracketStart + 1, bracketEnd) : trimmed.slice(bracketStart + 1);
    return inner.split(",").map((s) => normalizeName(s.trim())).filter(Boolean);
  }
  const name = normalizeName(trimmed);
  return name ? [name] : [];
}
function normalizeName(s) {
  return s.trim().toLocaleLowerCase().replace(/[._\s]+/g, "-").replace(/[^\p{L}\p{N}\-]/gu, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/, "");
}
var _reroll = new RerollQueenBee();
window.ioc.register("@diamondcoreprocessor.com/RerollQueenBee", _reroll);

// src/diamondcoreprocessor.com/substrate/substrate.queen.ts
import { QueenBee as QueenBee2, EffectBus as EffectBus2, hypercomb as hypercomb2 } from "@hypercomb/core";
var get2 = (key) => window.ioc?.get?.(key);
var BUILTIN_DEFAULTS_ID = "builtin:defaults";
var SubstrateQueenBee = class extends QueenBee2 {
  namespace = "diamondcoreprocessor.com";
  command = "substrate";
  aliases = [];
  description = "Manage substrate background image sources";
  async execute(args) {
    const service = get2("@diamondcoreprocessor.com/SubstrateService");
    if (!service) return;
    await service.ensureLoaded();
    const trimmed = args.trim().toLowerCase();
    switch (trimmed) {
      case "":
        EffectBus2.emit("substrate-organizer:open", {});
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
    EffectBus2.emit("activity:log", { message, icon: "\u25C8" });
  }
  async #refreshVisible(service) {
    const lineage = get2("@hypercomb.social/Lineage");
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
      void new hypercomb2().act();
    }
  }
  async #currentPath() {
    const lineage = get2("@hypercomb.social/Lineage");
    if (!lineage) return null;
    const segments = lineage.explorerSegments();
    return segments.length > 0 ? segments.join("/") : null;
  }
};
var _substrate = new SubstrateQueenBee();
window.ioc.register("@diamondcoreprocessor.com/SubstrateQueenBee", _substrate);

// src/diamondcoreprocessor.com/substrate/substrate.service.ts
import { EffectBus as EffectBus3, EMPTY_SUBSTRATE_REGISTRY } from "@hypercomb/core";
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
var get3 = (key) => window.ioc?.get?.(key);
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
  // propsSig → times currently assigned across tiles. Drives balanced picking
  // so every image gets used once before any gets used twice.
  #usageCounts = /* @__PURE__ */ new Map();
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
    EffectBus3.emit("substrate:changed", { scope: "registry", sourceId: full.id });
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
    EffectBus3.emit("substrate:changed", { scope: "registry", sourceId: id });
  }
  async setActive(id) {
    await this.ensureLoaded();
    if (id !== null && !this.#registry.sources.some((s) => s.id === id)) return;
    await this.#saveRegistry({ sources: this.#registry.sources, activeId: id });
    this.#resolved = null;
    this.#propsPool = [];
    EffectBus3.emit("substrate:changed", { scope: "active", sourceId: id });
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
    EffectBus3.emit("substrate:changed", { scope: "hive", path });
  }
  async clearHive() {
    const dir = await this.#explorerDir();
    if (!dir) return;
    await this.#writeProps(dir, { [HIVE_KEY]: null });
    EffectBus3.emit("substrate:changed", { scope: "hive", path: null });
  }
  async setInherit(inherit) {
    const dir = await this.#explorerDir();
    if (!dir) return;
    await this.#writeProps(dir, { [INHERIT_KEY]: inherit });
    EffectBus3.emit("substrate:changed", { scope: "inherit", inherit });
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
      EffectBus3.emit("substrate:folder-permission", { handleId, permission });
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
    const showCell = get3("@diamondcoreprocessor.com/ShowCellDrone");
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
    const settings = get3("@diamondcoreprocessor.com/Settings");
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
    this.#propsPool = pool;
    this.#seedUsageCounts();
  }
  /**
   * Rebuild per-entry usage counts from the current tile-props-index. Keeps
   * the balanced picker honest across reloads and source switches: tiles
   * already assigned to an image count against that image so we don't hand
   * the same one out again until every other image has caught up.
   */
  #seedUsageCounts() {
    this.#usageCounts = new Map(this.#propsPool.map((entry) => [entry.propsSig, 0]));
    try {
      const index = JSON.parse(localStorage.getItem("hc:tile-props-index") ?? "{}");
      for (const propsSig of Object.values(index)) {
        if (typeof propsSig !== "string") continue;
        if (!this.#usageCounts.has(propsSig)) continue;
        this.#usageCounts.set(propsSig, (this.#usageCounts.get(propsSig) ?? 0) + 1);
      }
    } catch {
    }
  }
  /**
   * Pick a pool entry from those with the lowest current usage count, then
   * increment. Random tie-breaks among least-used entries keep output
   * unpredictable without breaking the even distribution.
   */
  #pickBalanced(excludePropsSig) {
    if (this.#propsPool.length === 0) return null;
    const pool = excludePropsSig && this.#propsPool.length > 1 ? this.#propsPool.filter((e) => e.propsSig !== excludePropsSig) : this.#propsPool;
    let min = Infinity;
    for (const entry of pool) {
      const count = this.#usageCounts.get(entry.propsSig) ?? 0;
      if (count < min) min = count;
    }
    const candidates = pool.filter((e) => (this.#usageCounts.get(e.propsSig) ?? 0) === min);
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    this.#usageCounts.set(chosen.propsSig, (this.#usageCounts.get(chosen.propsSig) ?? 0) + 1);
    return chosen;
  }
  /** Decrement the usage count for a propsSig being released from a tile. */
  #releaseUsage(propsSig) {
    if (!propsSig) return;
    const current = this.#usageCounts.get(propsSig);
    if (current === void 0) return;
    this.#usageCounts.set(propsSig, Math.max(0, current - 1));
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
    const entry = this.#pickBalanced();
    if (!entry) return false;
    index[label] = entry.propsSig;
    localStorage.setItem(indexKey, JSON.stringify(index));
    return true;
  }
  rerollCell(label) {
    if (this.#propsPool.length === 0) return false;
    const indexKey = "hc:tile-props-index";
    const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
    const previous = index[label];
    this.#releaseUsage(previous);
    delete index[label];
    const entry = this.#pickBalanced(previous);
    if (!entry) return false;
    index[label] = entry.propsSig;
    localStorage.setItem(indexKey, JSON.stringify(index));
    return true;
  }
  /**
   * Reroll every label passed in. Callers are responsible for filtering
   * to substrate-only tiles (via the `hasSubstrate` flag from render data).
   * Each label gets a fresh pick from the current pool. Labels with no
   * existing entry in the props index are skipped (they were never assigned).
   * Returns the labels that were actually rerolled — callers should emit
   * `substrate:rerolled` per returned label so show-cell can invalidate caches.
   */
  rerollCells(labels) {
    if (this.#propsPool.length === 0 || labels.length === 0) return [];
    const indexKey = "hc:tile-props-index";
    const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
    const rerolled = [];
    for (const label of labels) {
      const current = index[label];
      if (!current) continue;
      this.#releaseUsage(current);
      delete index[label];
      const entry = this.#pickBalanced(current);
      if (!entry) break;
      index[label] = entry.propsSig;
      rerolled.push(label);
    }
    if (rerolled.length > 0) localStorage.setItem(indexKey, JSON.stringify(index));
    return rerolled;
  }
  clearCell(label) {
    const indexKey = "hc:tile-props-index";
    const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
    this.#releaseUsage(index[label]);
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
      const entry = this.#pickBalanced();
      if (!entry) break;
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
      const current = index[label];
      if (current && substrateSigs.has(current)) {
        this.#releaseUsage(current);
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
    return get3("@hypercomb.social/Store");
  }
  #lineage() {
    return get3("@hypercomb.social/Lineage");
  }
  async #explorerDir() {
    return this.#lineage()?.explorerDir() ?? null;
  }
};
window.ioc.register("@diamondcoreprocessor.com/SubstrateService", new SubstrateService());
export {
  RerollQueenBee,
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
