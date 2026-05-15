// @diamondcoreprocessor.com/presentation/tiles
// src/diamondcoreprocessor.com/presentation/tiles/hex-icon-button.ts
import { Container, Graphics, Sprite, Texture } from "pixi.js";
var BACKDROP_PAD = 2;
var BACKDROP_RADIUS = 1.5;
var BACKDROP_FILL = 789530;
var BACKDROP_FILL_ALPHA = 0.72;
var BACKDROP_STROKE = 6719692;
var BACKDROP_STROKE_ALPHA = 0.35;
var BACKDROP_STROKE_WIDTH = 0.6;
var SVG_VIEWBOX = 24;
var SVG_RENDER_SCALE = 4;
var HexIconButton = class extends Container {
  #sprite = null;
  #backdrop;
  #size;
  #normalTint;
  #hoverTint;
  #hovered = false;
  #alive = true;
  constructor(config) {
    super();
    this.#size = config.size;
    this.#normalTint = config.tint ?? 16777215;
    this.#hoverTint = config.hoverTint ?? 13162751;
    this.#backdrop = this.#buildBackdrop();
    this.addChild(this.#backdrop);
  }
  // ── Async icon load ────────────────────────────────────────────────
  async load(svgMarkup) {
    if (!this.#alive) return;
    try {
      const texture = await this.#rasterise(svgMarkup);
      if (!this.#alive) return;
      const sprite = new Sprite(texture);
      sprite.width = this.#size;
      sprite.height = this.#size;
      sprite.anchor.set(0.5, 0.5);
      sprite.tint = this.#normalTint;
      this.#sprite = sprite;
      this.addChild(sprite);
    } catch (e) {
      console.warn("[HexIconButton] load failed:", e);
    }
  }
  // ── Hover state ────────────────────────────────────────────────────
  get hovered() {
    return this.#hovered;
  }
  set hovered(value) {
    if (this.#hovered === value) return;
    this.#hovered = value;
    this.#backdrop.visible = value;
    if (this.#sprite) {
      this.#sprite.tint = value ? this.#hoverTint : this.#normalTint;
    }
  }
  /**
   * Set the tint applied when the icon is not hovered. Used by per-tile
   * `tintWhen` predicates so an icon can advertise per-cell state (e.g.
   * "this tile contains notes") via colour. Pass null to reset to white.
   */
  setNormalTint(tint) {
    this.#normalTint = tint ?? 16777215;
    if (this.#sprite && !this.#hovered) {
      this.#sprite.tint = this.#normalTint;
    }
  }
  // ── Hit testing ────────────────────────────────────────────────────
  containsPoint(localX, localY) {
    const r = this.#size / 2 + BACKDROP_PAD;
    return localX >= -r && localX <= r && localY >= -r && localY <= r;
  }
  // ── Lifecycle ──────────────────────────────────────────────────────
  destroy(options) {
    this.#alive = false;
    super.destroy(options);
  }
  // ── Internals ──────────────────────────────────────────────────────
  #buildBackdrop() {
    const r = this.#size / 2 + BACKDROP_PAD;
    const g = new Graphics();
    g.roundRect(-r, -r, r * 2, r * 2, BACKDROP_RADIUS);
    g.fill({ color: BACKDROP_FILL, alpha: BACKDROP_FILL_ALPHA });
    g.roundRect(-r, -r, r * 2, r * 2, BACKDROP_RADIUS);
    g.stroke({ color: BACKDROP_STROKE, alpha: BACKDROP_STROKE_ALPHA, width: BACKDROP_STROKE_WIDTH });
    g.visible = false;
    return g;
  }
  /** Rasterise SVG at high resolution via an offscreen Image → Canvas → Texture pipeline. */
  async #rasterise(svgMarkup) {
    const renderPx = SVG_VIEWBOX * SVG_RENDER_SCALE;
    const hiResSvg = svgMarkup.replace(`width="${SVG_VIEWBOX}"`, `width="${renderPx}"`).replace(`height="${SVG_VIEWBOX}"`, `height="${renderPx}"`);
    const img = new Image(renderPx, renderPx);
    const blob = new Blob([hiResSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    try {
      img.src = url;
      await img.decode();
    } finally {
      URL.revokeObjectURL(url);
    }
    const canvas = document.createElement("canvas");
    canvas.width = renderPx;
    canvas.height = renderPx;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, renderPx, renderPx);
    return Texture.from({ resource: canvas, alphaMode: "premultiply-alpha-on-upload" });
  }
};

// src/diamondcoreprocessor.com/presentation/tiles/hex-overlay.shader.ts
import { Container as Container2 } from "pixi.js";
var HexOverlayMesh = class {
  mesh;
  constructor(_radiusPx, _flat) {
    this.mesh = new Container2();
  }
  show(_t) {
  }
  hide() {
  }
  update(_radiusPx, _flat) {
  }
  setColorIndex(_index) {
  }
  setTime(_t) {
  }
};

// src/diamondcoreprocessor.com/history/nurse.bee.ts
import { Bee } from "@hypercomb/core";

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

// src/diamondcoreprocessor.com/history/nurse.bee.ts
var NurseBee = class extends Bee {
  // ── cache ──────────────────────────────────────────────────────────
  #cache = /* @__PURE__ */ new Map();
  /**
   * Read the value for a cell.
   *
   * `cacheKey` should uniquely identify the cell across renders — the
   * cell's lineage path (e.g. `'instructions/section'`) or its
   * locationSig. The caller chooses; the nurse just keys by it.
   *
   * Hot path: cache hit returns without touching disk. Cold path:
   * read 0000, parse, cache.
   */
  async read(cellDir, cacheKey) {
    const cached = this.#cache.get(cacheKey);
    if (cached) return cached.value;
    const props = await readCellProperties(cellDir);
    const value = this.parse(props[this.attribute]);
    this.#cache.set(cacheKey, { value, layerSig: "" });
    return value;
  }
  /** Synchronous peek — returns whatever the cache currently holds.
   *  Cache misses return `undefined` without triggering a read. */
  peek(cacheKey) {
    return this.#cache.get(cacheKey)?.value;
  }
  /** Annotate an existing entry with the layerSig it was last seen
   *  alongside. Lets a consumer detect "different layer, same value"
   *  when deciding whether to do work. No-op if the entry doesn't
   *  exist or the sig is unchanged. */
  setLayerSig(cacheKey, layerSig) {
    const existing = this.#cache.get(cacheKey);
    if (!existing) return;
    if (existing.layerSig === layerSig) return;
    this.#cache.set(cacheKey, { value: existing.value, layerSig });
  }
  /** Drop one cell's entry. */
  invalidate(cacheKey) {
    this.#cache.delete(cacheKey);
  }
  /** Drop all entries whose key starts with the given prefix. Used by
   *  inheriting nurses when an ancestor write should invalidate every
   *  descendant's composition. */
  invalidatePrefix(prefix) {
    if (prefix.length === 0) {
      this.#cache.clear();
      return;
    }
    const withSep = prefix.endsWith("/") ? prefix : prefix + "/";
    for (const k of [...this.#cache.keys()]) {
      if (k === prefix || k.startsWith(withSep)) this.#cache.delete(k);
    }
  }
  /** Clear the entire cache. Used on lineage-wide invalidations
   *  (folder-tree wipes, install reset). */
  clear() {
    this.#cache.clear();
  }
  // ── construction ───────────────────────────────────────────────────
  constructor() {
    super();
    this.onEffect(
      "cell:0000-changed",
      (payload) => {
        if (!payload?.keys?.includes(this.attribute)) return;
        this.invalidate(payload.cacheKey);
      }
    );
  }
  // ── nurses don't run per pulse ─────────────────────────────────────
  async pulse(_grammar) {
  }
};

// src/diamondcoreprocessor.com/presentation/tiles/index.nurse.ts
var IndexNurse = class extends NurseBee {
  namespace = "diamondcoreprocessor.com";
  attribute = "index";
  parse(raw) {
    if (typeof raw !== "number") return void 0;
    if (!Number.isFinite(raw)) return void 0;
    if (raw < 0) return void 0;
    return raw;
  }
};
var _indexNurse = new IndexNurse();
window.ioc?.register?.(_indexNurse.iocKey, _indexNurse);

// src/diamondcoreprocessor.com/presentation/tiles/sources/ephemeral-tile.source.ts
var PAIRED_CHANNEL_DRONE_KEY = "@diamondcoreprocessor.com/PairedChannelDrone";
function locationStringFromSegments(segments) {
  const cleaned = segments.map((s) => String(s ?? "").trim()).filter((s) => s.length > 0 && !(s.startsWith("__") && s.endsWith("__")));
  return "/" + cleaned.join("/");
}
var ephemeralTileSource = async (loc) => {
  const drone = window.ioc?.get?.(
    PAIRED_CHANNEL_DRONE_KEY
  );
  if (!drone?.ephemeralSharesAt) return [];
  const location = locationStringFromSegments(loc.segments);
  const rows = drone.ephemeralSharesAt(location) ?? [];
  return rows.map((r) => ({
    name: r.branchName,
    kind: "ephemeral",
    source: {
      channelId: r.channelId,
      layerSig: r.branchSig,
      branchSig: r.branchSig
    }
  }));
};

// src/diamondcoreprocessor.com/presentation/tiles/sources/opfs-tile.source.ts
var SYSTEM_DIR_NAMES = /* @__PURE__ */ new Set([
  "__dependencies__",
  "__bees__",
  "__layers__",
  "__location__",
  "__history__",
  "__optimization__",
  "__resources__"
]);
function isSystemDirName(name) {
  if (!name) return true;
  if (SYSTEM_DIR_NAMES.has(name)) return true;
  return name.startsWith("__") && name.endsWith("__");
}
var opfsTileSource = async (loc) => {
  const dir = loc.dir;
  if (!dir) return [];
  const out = [];
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "directory") continue;
      if (isSystemDirName(name)) continue;
      out.push({
        name,
        kind: "opfs",
        source: { dir: handle }
      });
    }
  } catch (err) {
    console.warn("[opfs-tile-source] enumeration failed", err);
    return [];
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
};

// src/diamondcoreprocessor.com/presentation/tiles/tile-source-registry.ts
var IOC_KEY = "@hypercomb.social/TileSourceRegistry";
var TileSourceRegistry = class {
  #sources = /* @__PURE__ */ new Set();
  /** Register a tile source. Returns an unregister callback. */
  register = (source) => {
    this.#sources.add(source);
    return () => {
      this.#sources.delete(source);
    };
  };
  /** Resolve all sources for the given location. The result is the
   *  union of every source's contributions, deduplicated by (kind, name).
   *  Errors in individual sources are caught and logged — they don't
   *  cause resolution to fail. */
  resolve = async (loc) => {
    if (this.#sources.size === 0) return [];
    const results = await Promise.allSettled(
      [...this.#sources].map((s) => s(loc))
    );
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const r of results) {
      if (r.status === "rejected") {
        console.warn("[tile-source-registry] source threw", r.reason);
        continue;
      }
      for (const entry of r.value) {
        const dedupKey = `${entry.kind}:${entry.name}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        out.push(entry);
      }
    }
    return out;
  };
  /** Convenience: just the names, in source-arrival order. For callers
   *  upgrading from `listCellFolders` semantics — accepts a final
   *  `precedence` filter to keep only one kind when both exist for the
   *  same name (e.g. `'opfs'` to hide ephemerals that have been
   *  adopted but haven't cleared from the cache yet). */
  resolveNames = async (loc, precedence) => {
    const entries = await this.resolve(loc);
    if (!precedence) return entries.map((e) => e.name);
    const byName = /* @__PURE__ */ new Map();
    for (const e of entries) {
      const existing = byName.get(e.name);
      if (!existing) {
        byName.set(e.name, e);
        continue;
      }
      if (existing.kind === precedence) continue;
      if (e.kind === precedence) byName.set(e.name, e);
    }
    return [...byName.values()].map((e) => e.name);
  };
  /** Find the entry for a given name + optional kind. Used by the
   *  layout service and renderer to recover the source ref. */
  findEntry = async (loc, name, kind) => {
    const entries = await this.resolve(loc);
    return entries.find((e) => e.name === name && (!kind || e.kind === kind)) ?? null;
  };
};
var _registry = new TileSourceRegistry();
window.ioc?.register?.(IOC_KEY, _registry);
var TILE_SOURCE_REGISTRY_KEY = IOC_KEY;
export {
  HexIconButton,
  HexOverlayMesh,
  IndexNurse,
  TILE_SOURCE_REGISTRY_KEY,
  TileSourceRegistry,
  ephemeralTileSource,
  opfsTileSource
};
