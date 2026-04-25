// @diamondcoreprocessor.com/commands
// src/diamondcoreprocessor.com/commands/accent.queen.ts
import { QueenBee, EffectBus, hypercomb } from "@hypercomb/core";
var STORAGE_KEY = "hc:neon-color";
var ACCENT_NAMES = {
  glacier: 0,
  bloom: 1,
  aurora: 2,
  ember: 3,
  nebula: 4
};
var ACCENT_INDEX_TO_NAME = ["glacier", "bloom", "aurora", "ember", "nebula"];
var get2 = (key) => window.ioc?.get?.(key);
var AccentQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  command = "accent";
  aliases = [];
  description = "Set the hover accent color by name";
  async execute(args) {
    const trimmed = args.trim().toLowerCase();
    if (!trimmed) {
      this.#cycle();
      return;
    }
    if (trimmed.startsWith("~")) {
      const tagName = trimmed.slice(1).trim();
      if (tagName) await this.#removeTagAccent(tagName);
      return;
    }
    const bracketMatch = trimmed.match(/^\[(.+?)\]\s*(.*)$/);
    if (bracketMatch) {
      const tagNames = bracketMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
      const presetName = bracketMatch[2].trim();
      if (presetName && presetName in ACCENT_NAMES && tagNames.length > 0) {
        for (const tag of tagNames) {
          await this.#setTagAccent(tag, presetName);
        }
        this.#setDefault(presetName);
      }
      return;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      const name = parts[0];
      if (name in ACCENT_NAMES) {
        this.#setDefault(name);
      }
      return;
    }
    if (parts.length === 2) {
      const [tagName, presetName] = parts;
      if (presetName in ACCENT_NAMES) {
        await this.#setTagAccent(tagName, presetName);
        const selection = get2("@diamondcoreprocessor.com/SelectionService");
        if (selection && selection.selected.size > 0) {
          await this.#setTileAccent(Array.from(selection.selected), presetName);
        }
      }
      return;
    }
  }
  #cycle() {
    const current = loadIndex();
    const next = (current + 1) % ACCENT_INDEX_TO_NAME.length;
    this.#setDefault(ACCENT_INDEX_TO_NAME[next]);
  }
  #setDefault(name) {
    const index = ACCENT_NAMES[name];
    if (index === void 0) return;
    localStorage.setItem(STORAGE_KEY, String(index));
    EffectBus.emit("overlay:neon-color", { index, name });
  }
  async #setTagAccent(tagName, presetName) {
    const registry = get2("@hypercomb.social/TagRegistry");
    if (!registry) return;
    await registry.ensureLoaded();
    await registry.setAccent(tagName, presetName);
  }
  async #removeTagAccent(tagName) {
    const registry = get2("@hypercomb.social/TagRegistry");
    if (!registry) return;
    await registry.ensureLoaded();
    await registry.setAccent(tagName, void 0);
  }
  async #setTileAccent(labels, presetName) {
    const lineage = get2("@hypercomb.social/Lineage");
    if (!lineage) return;
    const dir = await lineage.explorerDir();
    if (!dir) return;
    for (const label of labels) {
      try {
        const cellDir = await dir.getDirectoryHandle(label, { create: true });
        const props = await readProps(cellDir);
        props["accent"] = presetName;
        await writeProps(cellDir, props);
      } catch {
      }
    }
    void new hypercomb().act();
  }
};
var PROPS_FILE = "0000";
async function readProps(cellDir) {
  try {
    const fh = await cellDir.getFileHandle(PROPS_FILE);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch {
    return {};
  }
}
async function writeProps(cellDir, updates) {
  const fh = await cellDir.getFileHandle(PROPS_FILE, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(updates));
  await writable.close();
}
function loadIndex() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return 0;
  const n = parseInt(stored, 10);
  return n >= 0 && n < ACCENT_INDEX_TO_NAME.length ? n : 0;
}
var _accent = new AccentQueenBee();
window.ioc.register("@diamondcoreprocessor.com/AccentQueenBee", _accent);

// src/diamondcoreprocessor.com/commands/arrange.queen.ts
import { QueenBee as QueenBee2, EffectBus as EffectBus2 } from "@hypercomb/core";
var ArrangeQueenBee = class extends QueenBee2 {
  namespace = "diamondcoreprocessor.com";
  command = "arrange";
  description = "Toggle icon arrangement mode on the tile overlay";
  #active = false;
  execute() {
    this.#active = !this.#active;
    EffectBus2.emit("overlay:arrange-mode", { active: this.#active });
  }
};
var _arrange = new ArrangeQueenBee();
window.ioc.register("@diamondcoreprocessor.com/ArrangeQueenBee", _arrange);

// src/diamondcoreprocessor.com/commands/branch.queen.ts
import { QueenBee as QueenBee3, EffectBus as EffectBus3 } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/tile-properties.ts
var TILE_PROPERTIES_FILE = "0000";
var isSignature = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
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

// src/diamondcoreprocessor.com/commands/branch.queen.ts
var toast = (type, title, message) => {
  try {
    EffectBus3.emit("toast:show", { type, title, message });
  } catch {
  }
};
var NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
var BranchQueenBee = class extends QueenBee3 {
  namespace = "diamondcoreprocessor.com";
  command = "branch";
  aliases = ["mark", "label"];
  description = "Give a lineage path or signature a named handle that other slash commands autocomplete against.";
  descriptionKey = "slash.branch";
  slashComplete(args) {
    const tokens = args.split(/\s+/);
    const registry = get("@hypercomb.social/NameRegistry");
    const names = registry?.names ?? [];
    if (tokens.length <= 1) {
      const first = (tokens[0] ?? "").toLowerCase();
      const matches = names.filter((n) => n.toLowerCase().startsWith(first));
      const suggestions = [];
      if (!first) suggestions.push("(name)", "list");
      if ("list".startsWith(first)) suggestions.push("list");
      return [.../* @__PURE__ */ new Set([...matches, ...suggestions])];
    }
    if (tokens.length === 2) {
      const second = (tokens[1] ?? "").toLowerCase();
      const ops = ["<64-hex signature>", "clear"];
      if (!second) return ops;
      return ops.filter((o) => o.toLowerCase().startsWith(second));
    }
    return [];
  }
  execute(args) {
    const trimmed = args.trim();
    if (!trimmed) {
      console.warn("[/branch] usage: /branch <name> [signature | clear]  |  /branch list");
      return;
    }
    const tokens = trimmed.split(/\s+/);
    const first = tokens[0];
    if (first.toLowerCase() === "list") {
      void this.#list();
      return;
    }
    if (!NAME_RE.test(first)) {
      console.warn(`[/branch] invalid name "${first}" \u2014 use letters, digits, - . _ (max 64)`);
      return;
    }
    const second = tokens[1]?.trim();
    if (!second) {
      void this.#setLineage(first);
      return;
    }
    if (second.toLowerCase() === "clear" || second.toLowerCase() === "remove") {
      void this.#remove(first);
      return;
    }
    if (isSignature(second)) {
      void this.#setSignature(first, second.toLowerCase());
      return;
    }
    console.warn(`[/branch] second arg must be empty, "clear", or a 64-hex signature \u2014 got "${second.slice(0, 20)}\u2026"`);
  }
  async #setLineage(name) {
    const lineage = get("@hypercomb.social/Lineage");
    const registry = get("@hypercomb.social/NameRegistry");
    if (!lineage?.explorerSegments || !registry?.setLineage) {
      console.warn("[/branch] services not ready");
      return;
    }
    const path = [...lineage.explorerSegments() ?? []];
    await registry.setLineage(name, path);
    const label = "/" + path.join("/");
    console.log(`[/branch] ${name} \u2192 ${label}`);
    toast("success", "Branch saved", `${name} \u2192 ${label}`);
  }
  async #setSignature(name, sig) {
    const registry = get("@hypercomb.social/NameRegistry");
    if (!registry?.setSignature) return;
    await registry.setSignature(name, sig);
    console.log(`[/branch] ${name} \u2192 signature ${sig}`);
    toast("success", "Branch saved", `${name} \u2192 ${sig.slice(0, 12)}\u2026`);
  }
  async #remove(name) {
    const registry = get("@hypercomb.social/NameRegistry");
    if (!registry?.remove) return;
    const removed = await registry.remove(name);
    console.log(removed ? `[/branch] removed ${name}` : `[/branch] no such name: ${name}`);
    if (removed) toast("info", "Branch removed", name);
    else toast("warning", "No such branch", name);
  }
  async #list() {
    const registry = get("@hypercomb.social/NameRegistry");
    if (!registry?.ensureLoaded) {
      console.warn("[/branch] registry not ready");
      return;
    }
    await registry.ensureLoaded();
    const all = registry.all;
    const names = Object.keys(all).sort();
    if (!names.length) {
      console.log("[/branch] no branches");
      return;
    }
    for (const name of names) {
      const entry = all[name];
      if (entry?.target?.kind === "lineage") {
        console.log(`[/branch] ${name} \u2192 /${(entry.target.path ?? []).join("/")}`);
      } else if (entry?.target?.kind === "signature") {
        console.log(`[/branch] ${name} \u2192 signature ${entry.target.signature}`);
      }
    }
  }
};
var _branch = new BranchQueenBee();
window.ioc.register("@diamondcoreprocessor.com/BranchQueenBee", _branch);

// src/diamondcoreprocessor.com/commands/compact.queen.ts
import { QueenBee as QueenBee4, hypercomb as hypercomb2 } from "@hypercomb/core";
var CompactQueenBee = class extends QueenBee4 {
  namespace = "diamondcoreprocessor.com";
  command = "compact";
  aliases = [];
  description = "Collapse this location's history into one head entry";
  async execute(_args) {
    const history = get("@diamondcoreprocessor.com/HistoryService");
    const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
    if (!history || !cursor) return;
    const locationSig = cursor.state.locationSig;
    if (!locationSig) return;
    const entries = await history.listLayers(locationSig);
    if (entries.length <= 1) return;
    const pos = cursor.state.position;
    const targetIndex = Math.max(0, Math.min(pos - 1, entries.length - 1));
    const target = entries[targetIndex];
    if (!target) return;
    const store = get("@hypercomb.social/Store");
    if (!store) return;
    let targetContent = null;
    try {
      const blob = await store.getResource(target.layerSig);
      if (blob) targetContent = JSON.parse(await blob.text());
    } catch {
    }
    const promotedSig = await history.promoteToHead(locationSig, target.layerSig);
    if (!promotedSig) return;
    const afterPromote = await history.listLayers(locationSig);
    const newHead = afterPromote[afterPromote.length - 1];
    if (!newHead) return;
    const toDelete = afterPromote.filter((e) => e.filename !== newHead.filename).map((e) => e.filename);
    if (toDelete.length > 0) {
      await history.removeEntries(locationSig, toDelete);
    }
    if (targetContent?.cells) {
      const lineage = get("@hypercomb.social/Lineage");
      const dir = await lineage?.explorerDir?.();
      if (dir) {
        const keep = new Set(targetContent.cells);
        const toRemove = [];
        for await (const [name, handle] of dir.entries()) {
          if (handle.kind !== "directory") continue;
          if (name.startsWith("__")) continue;
          if (!keep.has(name)) toRemove.push(name);
        }
        for (const name of toRemove) {
          try {
            await dir.removeEntry(name, { recursive: true });
          } catch {
          }
        }
      }
    }
    const final = await history.listLayers(locationSig);
    cursor.seek(final.length);
    void new hypercomb2().act();
  }
};
var _compact = new CompactQueenBee();
window.ioc?.register?.("@diamondcoreprocessor.com/CompactQueenBee", _compact);

// src/diamondcoreprocessor.com/commands/debug.queen.ts
import { QueenBee as QueenBee5, EffectBus as EffectBus4 } from "@hypercomb/core";
var DebugQueenBee = class extends QueenBee5 {
  namespace = "diamondcoreprocessor.com";
  command = "debug";
  aliases = [];
  description = "Toggle the Pixi display-tree inspector";
  execute(_args) {
    const dbg = window.__pixiDebug;
    if (dbg && typeof dbg.toggle === "function") {
      dbg.toggle();
      const state = dbg.active ? "ON" : "OFF";
      console.log(`%c[debug] Pixi inspector ${state}`, `color: ${dbg.active ? "#0f0" : "#f55"}; font-weight: bold`);
      EffectBus4.emit("queen:debug", { active: dbg.active });
    } else {
      console.warn("[debug] PixiDebugDrone not loaded \u2014 no __pixiDebug on window");
      EffectBus4.emit("queen:debug", { active: false, error: "not-loaded" });
    }
  }
};
var _debug = new DebugQueenBee();
window.ioc.register("@diamondcoreprocessor.com/DebugQueenBee", _debug);

// src/diamondcoreprocessor.com/commands/domain.queen.ts
import { QueenBee as QueenBee6 } from "@hypercomb/core";
var DomainQueenBee = class extends QueenBee6 {
  namespace = "diamondcoreprocessor.com";
  command = "domain";
  aliases = ["relay"];
  description = "Add, remove, or list mesh relay domains";
  execute(args) {
    const mesh = get("@diamondcoreprocessor.com/NostrMeshDrone");
    if (!mesh) {
      console.warn("[/domain] Mesh not available");
      return;
    }
    const trimmed = args.trim();
    if (!trimmed || trimmed.toLowerCase() === "list") {
      this.#list(mesh);
      return;
    }
    if (trimmed.toLowerCase() === "clear") {
      mesh.configureRelays([], true);
      console.log("[/domain] All domains cleared");
      return;
    }
    const removeMatch = trimmed.match(/^remove\s+(.+)$/i);
    if (removeMatch) {
      const url = removeMatch[1].trim();
      this.#remove(mesh, url);
      return;
    }
    this.#add(mesh, trimmed);
  }
  #list(mesh) {
    const debug = mesh.getDebug?.();
    const relays = debug?.relays ?? [];
    if (relays.length === 0) {
      console.log("[/domain] No domains configured");
      return;
    }
    console.log(`[/domain] ${relays.length} domain(s):`);
    for (const url of relays) {
      const socket = debug?.sockets?.find((s) => s.url === url);
      const state = socket ? ["connecting", "open", "closing", "closed"][socket.readyState] ?? "unknown" : "no socket";
      console.log(`  ${url}  (${state})`);
    }
  }
  #add(mesh, url) {
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      console.warn(`[/domain] Invalid URL \u2014 must start with ws:// or wss://`);
      return;
    }
    const debug = mesh.getDebug?.();
    const current = debug?.relays ?? [];
    if (current.includes(url)) {
      console.log(`[/domain] Already configured: ${url}`);
      return;
    }
    mesh.configureRelays([...current, url], true);
    console.log(`[/domain] Added: ${url}`);
  }
  #remove(mesh, url) {
    const debug = mesh.getDebug?.();
    const current = debug?.relays ?? [];
    const next = current.filter((u) => u !== url);
    if (next.length === current.length) {
      console.log(`[/domain] Not found: ${url}`);
      return;
    }
    mesh.configureRelays(next, true);
    console.log(`[/domain] Removed: ${url}`);
  }
};
var _domain = new DomainQueenBee();
window.ioc.register("@diamondcoreprocessor.com/DomainQueenBee", _domain);

// src/diamondcoreprocessor.com/commands/download.queen.ts
import { QueenBee as QueenBee7 } from "@hypercomb/core";
var DownloadQueenBee = class extends QueenBee7 {
  namespace = "diamondcoreprocessor.com";
  command = "download";
  aliases = ["export"];
  description = "Download an OPFS zip snapshot of the full client state";
  async execute(_args) {
    const opfsRoot = await navigator.storage?.getDirectory?.();
    if (!opfsRoot) return;
    const files = [];
    await walkDir(opfsRoot, "", files);
    if (files.length === 0) return;
    const zip = buildStoreZip(files);
    const blob = new Blob([zip], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = `hypercomb-opfs-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
};
async function walkDir(dir, prefix, out) {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      try {
        const file = await handle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        out.push({ path, bytes });
      } catch {
      }
    } else if (handle.kind === "directory") {
      await walkDir(handle, path, out);
    }
  }
}
function buildStoreZip(files) {
  const encoder = new TextEncoder();
  const crcTable = getCrcTable();
  const encoded = [];
  let cursor = 0;
  for (const f of files) {
    const nameBytes = encoder.encode(f.path);
    const crc = crc32(f.bytes, crcTable);
    encoded.push({ nameBytes, data: f.bytes, crc, localOffset: cursor });
    cursor += 30 + nameBytes.length + f.bytes.length;
  }
  const cdStart = cursor;
  for (const e of encoded) {
    cursor += 46 + e.nameBytes.length;
  }
  const cdEnd = cursor;
  cursor += 22;
  const total = cursor;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  for (const e of encoded) {
    dv.setUint32(p, 67324752, true);
    dv.setUint16(p + 4, 20, true);
    dv.setUint16(p + 6, 0, true);
    dv.setUint16(p + 8, 0, true);
    dv.setUint16(p + 10, 0, true);
    dv.setUint16(p + 12, 0, true);
    dv.setUint32(p + 14, e.crc, true);
    dv.setUint32(p + 18, e.data.length, true);
    dv.setUint32(p + 22, e.data.length, true);
    dv.setUint16(p + 26, e.nameBytes.length, true);
    dv.setUint16(p + 28, 0, true);
    p += 30;
    out.set(e.nameBytes, p);
    p += e.nameBytes.length;
    out.set(e.data, p);
    p += e.data.length;
  }
  for (const e of encoded) {
    dv.setUint32(p, 33639248, true);
    dv.setUint16(p + 4, 20, true);
    dv.setUint16(p + 6, 20, true);
    dv.setUint16(p + 8, 0, true);
    dv.setUint16(p + 10, 0, true);
    dv.setUint16(p + 12, 0, true);
    dv.setUint16(p + 14, 0, true);
    dv.setUint32(p + 16, e.crc, true);
    dv.setUint32(p + 20, e.data.length, true);
    dv.setUint32(p + 24, e.data.length, true);
    dv.setUint16(p + 28, e.nameBytes.length, true);
    dv.setUint16(p + 30, 0, true);
    dv.setUint16(p + 32, 0, true);
    dv.setUint16(p + 34, 0, true);
    dv.setUint16(p + 36, 0, true);
    dv.setUint32(p + 38, 0, true);
    dv.setUint32(p + 42, e.localOffset, true);
    p += 46;
    out.set(e.nameBytes, p);
    p += e.nameBytes.length;
  }
  dv.setUint32(p, 101010256, true);
  dv.setUint16(p + 4, 0, true);
  dv.setUint16(p + 6, 0, true);
  dv.setUint16(p + 8, encoded.length, true);
  dv.setUint16(p + 10, encoded.length, true);
  dv.setUint32(p + 12, cdEnd - cdStart, true);
  dv.setUint32(p + 16, cdStart, true);
  dv.setUint16(p + 20, 0, true);
  p += 22;
  return out;
}
var cachedCrcTable = null;
function getCrcTable() {
  if (cachedCrcTable) return cachedCrcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  cachedCrcTable = table;
  return table;
}
function crc32(bytes, table) {
  let c = 4294967295;
  for (let i = 0; i < bytes.length; i++) {
    c = c >>> 8 ^ table[(c ^ bytes[i]) & 255];
  }
  return (c ^ 4294967295) >>> 0;
}
var _download = new DownloadQueenBee();
window.ioc?.register?.("@diamondcoreprocessor.com/DownloadQueenBee", _download);

// src/diamondcoreprocessor.com/commands/empty-long-press.input.ts
import { Point } from "pixi.js";
import { EffectBus as EffectBus6 } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/arm-resource.ts
import { EffectBus as EffectBus5 } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/resource-thumbnail.ts
var generateHexThumbnails = async (source) => {
  const settings = window.ioc?.get?.("@diamondcoreprocessor.com/Settings");
  const pw = settings ? Math.round(settings.hexWidth("point-top")) : 346;
  const ph = settings ? Math.round(settings.hexHeight("point-top")) : 400;
  const fw = settings ? Math.round(settings.hexWidth("flat-top")) : 400;
  const fh = settings ? Math.round(settings.hexHeight("flat-top")) : 346;
  const objectUrl = URL.createObjectURL(source);
  try {
    const img = await loadImage(objectUrl);
    const [pointBlob, flatBlob] = await Promise.all([
      renderCover(img, pw, ph),
      renderCover(img, fw, fh)
    ]);
    return { pointBlob, flatBlob };
  } catch {
    return { pointBlob: null, flatBlob: null };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};
var generatePreviewThumbnail = async (source, size = 256) => {
  const objectUrl = URL.createObjectURL(source);
  try {
    const img = await loadImage(objectUrl);
    return await renderCover(img, size, size);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};
var renderCover = (img, targetW, targetH) => {
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  const scale = Math.max(targetW / img.naturalWidth, targetH / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const dx = (targetW - drawW) / 2;
  const dy = (targetH - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
};
var loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("image decode failed"));
  img.src = src;
});

// src/diamondcoreprocessor.com/editor/arm-resource.ts
var armImageBlob = async (blob, opts = {}) => {
  const store = window.ioc?.get?.("@hypercomb.social/Store");
  if (!store) return false;
  const [largeSig, hex, preview] = await Promise.all([
    store.putResource(blob),
    generateHexThumbnails(blob),
    generatePreviewThumbnail(blob)
  ]);
  const smallPointSig = hex.pointBlob ? await store.putResource(hex.pointBlob) : null;
  const smallFlatSig = hex.flatBlob ? await store.putResource(hex.flatBlob) : null;
  const previewUrl = URL.createObjectURL(preview ?? blob);
  EffectBus5.emit("command:arm-resource", {
    previewUrl,
    largeSig,
    smallPointSig,
    smallFlatSig,
    url: opts.url ?? null,
    type: opts.type ?? "image"
  });
  return true;
};
var armFromClipboard = async () => {
  try {
    const clipboard = navigator.clipboard;
    if (!clipboard?.read) return false;
    const items = await clipboard.read();
    for (const item of items) {
      for (const mime of item.types) {
        if (mime.startsWith("image/")) {
          const blob = await item.getType(mime);
          return await armImageBlob(blob, { type: "image" });
        }
      }
    }
  } catch {
  }
  return false;
};

// src/diamondcoreprocessor.com/commands/empty-long-press.input.ts
var HOLD_MS = 500;
var JITTER_PX = 12;
function axialKey(q, r) {
  return `${q},${r}`;
}
var EmptyLongPressInput = class {
  #canvas = null;
  #container = null;
  #renderer = null;
  #meshOffset = { x: 0, y: 0 };
  #flat = false;
  #occupied = /* @__PURE__ */ new Set();
  #holdTimer = null;
  #downPos = null;
  #activePointerId = null;
  #attached = false;
  constructor() {
    EffectBus6.on("render:host-ready", (payload) => {
      this.#canvas = payload.canvas;
      this.#container = payload.container;
      this.#renderer = payload.renderer;
      this.#attach();
    });
    EffectBus6.on("render:mesh-offset", (offset) => {
      this.#meshOffset = offset;
    });
    EffectBus6.on("render:set-orientation", ({ flat }) => {
      this.#flat = !!flat;
    });
    EffectBus6.on("render:cell-count", ({ coords }) => {
      this.#occupied.clear();
      if (!coords) return;
      for (const c of coords) {
        if (c) this.#occupied.add(axialKey(c.q, c.r));
      }
    });
  }
  #attach() {
    if (this.#attached) return;
    window.addEventListener("pointerdown", this.#onPointerDown, { passive: false });
    window.addEventListener("pointermove", this.#onPointerMove, { passive: false });
    window.addEventListener("pointerup", this.#onPointerUp, { passive: false });
    window.addEventListener("pointercancel", this.#onPointerUp, { passive: false });
    this.#attached = true;
  }
  #isMobile() {
    return window.matchMedia("(max-width: 599px), (max-height: 599px)").matches;
  }
  #onPointerDown = (e) => {
    if (e.pointerType !== "touch") return;
    if (!this.#canvas || !this.#isMobile()) return;
    if (this.#activePointerId !== null) {
      this.#cancel();
      return;
    }
    const rect = this.#canvas.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
    const target = e.target;
    if (target && target !== this.#canvas) return;
    const axial = this.#clientToAxial(e.clientX, e.clientY);
    if (!axial) return;
    if (this.#occupied.has(axialKey(axial.q, axial.r))) return;
    this.#activePointerId = e.pointerId;
    this.#downPos = { x: e.clientX, y: e.clientY };
    this.#holdTimer = setTimeout(() => {
      this.#holdTimer = null;
      try {
        navigator.vibrate?.(40);
      } catch {
      }
      EffectBus6.emit("mobile:input-visible", { visible: true, mobile: true });
      void armFromClipboard();
      this.#reset();
    }, HOLD_MS);
  };
  #onPointerMove = (e) => {
    if (e.pointerType !== "touch") return;
    if (e.pointerId !== this.#activePointerId) return;
    if (!this.#holdTimer || !this.#downPos) return;
    const dx = e.clientX - this.#downPos.x;
    const dy = e.clientY - this.#downPos.y;
    if (Math.abs(dx) > JITTER_PX || Math.abs(dy) > JITTER_PX) {
      this.#cancel();
    }
  };
  #onPointerUp = (e) => {
    if (e.pointerType !== "touch") return;
    if (e.pointerId !== this.#activePointerId) return;
    this.#cancel();
  };
  #cancel() {
    if (this.#holdTimer) {
      clearTimeout(this.#holdTimer);
      this.#holdTimer = null;
    }
    this.#reset();
  }
  #reset() {
    this.#downPos = null;
    this.#activePointerId = null;
  }
  #clientToAxial(cx, cy) {
    if (!this.#container || !this.#renderer) return null;
    const detector = window.ioc.get(
      "@diamondcoreprocessor.com/HexDetector"
    );
    if (!detector) return null;
    const events = this.#renderer?.events;
    let gx, gy;
    if (events?.mapPositionToPoint) {
      const out = new Point();
      events.mapPositionToPoint(out, cx, cy);
      gx = out.x;
      gy = out.y;
    } else {
      const rect = this.#canvas.getBoundingClientRect();
      const screen = this.#renderer.screen;
      gx = (cx - rect.left) * (screen.width / rect.width);
      gy = (cy - rect.top) * (screen.height / rect.height);
    }
    const local = this.#container.toLocal(new Point(gx, gy));
    return detector.pixelToAxial(local.x - this.#meshOffset.x, local.y - this.#meshOffset.y, this.#flat);
  }
};
var _emptyLongPress = new EmptyLongPressInput();
window.ioc.register("@diamondcoreprocessor.com/EmptyLongPressInput", _emptyLongPress);

// src/diamondcoreprocessor.com/commands/help.queen.ts
import { QueenBee as QueenBee8, EffectBus as EffectBus7 } from "@hypercomb/core";
var HelpQueenBee = class extends QueenBee8 {
  namespace = "diamondcoreprocessor.com";
  command = "help";
  aliases = [];
  description = "List all available queen bee commands";
  execute(_args) {
    const queens = this.#findQueenBees();
    if (queens.length === 0) {
      EffectBus7.emit("queen:help", { commands: [] });
      console.log("[/help] No queen bees registered.");
      return;
    }
    const commands = queens.map((q) => ({
      command: q.command,
      aliases: q.aliases,
      description: q.description ?? ""
    }));
    EffectBus7.emit("queen:help", { commands });
    console.group("[/help] Available commands:");
    for (const cmd of commands) {
      const aliasStr = cmd.aliases.length ? ` (aliases: ${cmd.aliases.join(", ")})` : "";
      console.log(`  /${cmd.command}${aliasStr} \u2014 ${cmd.description}`);
    }
    console.groupEnd();
  }
  #findQueenBees() {
    const keys = list();
    const queens = [];
    for (const key of keys) {
      const instance = get(key);
      if (instance && typeof instance.command === "string" && typeof instance.invoke === "function") {
        queens.push(instance);
      }
    }
    return queens;
  }
};
var _help = new HelpQueenBee();
window.ioc.register("@diamondcoreprocessor.com/HelpQueenBee", _help);

// src/diamondcoreprocessor.com/commands/i18n-override.queen.ts
import { QueenBee as QueenBee9, I18N_IOC_KEY } from "@hypercomb/core";
var I18nOverrideQueenBee = class extends QueenBee9 {
  namespace = "diamondcoreprocessor.com";
  command = "i18n-override";
  aliases = [];
  description = "Override any UI translation (savvy users)";
  descriptionKey = "slash.i18n-override";
  slashComplete(args) {
    const parts = args.split(/\s+/);
    const locales = ["en", "ja", "zh", "es", "ar", "pt", "fr", "de", "ko", "ru", "hi", "id", "tr", "it"];
    const first = parts[0]?.toLowerCase() ?? "";
    if (parts.length <= 1) {
      const all = ["reset", ...locales];
      if (!first) return all;
      return all.filter((s) => s.startsWith(first));
    }
    if (first === "reset" && parts.length === 2) {
      const q = (parts[1] ?? "").toLowerCase();
      if (!q) return locales;
      return locales.filter((l) => l.startsWith(q));
    }
    return [];
  }
  async execute(args) {
    const trimmed = args.trim();
    if (!trimmed) {
      const layer2 = await this.#read();
      console.log("[i18n-override]", JSON.stringify(layer2, null, 2));
      return;
    }
    if (trimmed === "reset") {
      await this.#write({});
      console.log("[i18n-override] cleared all overrides (reload to apply)");
      return;
    }
    const resetMatch = trimmed.match(/^reset\s+(\S+)$/);
    if (resetMatch) {
      const locale2 = resetMatch[1];
      const layer2 = await this.#read();
      delete layer2[locale2];
      await this.#write(layer2);
      console.log(`[i18n-override] cleared overrides for locale "${locale2}" (reload to apply)`);
      return;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      console.warn("[i18n-override] usage: /i18n-override <locale> <key> [value]");
      return;
    }
    const locale = parts[0];
    const key = parts[1];
    const value = parts.slice(2).join(" ").trim();
    const layer = await this.#read();
    if (!value) {
      if (layer[locale]) {
        delete layer[locale][key];
        if (!Object.keys(layer[locale]).length) delete layer[locale];
      }
      await this.#write(layer);
      console.log(`[i18n-override] removed ${locale}:${key} \u2014 reload to see the change`);
      return;
    }
    layer[locale] ??= {};
    layer[locale][key] = value;
    await this.#write(layer);
    this.#applyLive(locale, layer[locale]);
    console.log(`[i18n-override] set ${locale}:${key} = "${value}"`);
  }
  async #read() {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("overrides", { create: false });
      const handle = await dir.getFileHandle("i18n.json", { create: false });
      const file = await handle.getFile();
      return JSON.parse(await file.text());
    } catch {
      return {};
    }
  }
  async #write(layer) {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("overrides", { create: true });
    const handle = await dir.getFileHandle("i18n.json", { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(layer, null, 2));
    await writable.close();
  }
  #applyLive(locale, catalog) {
    const i18n = get(I18N_IOC_KEY);
    if (!i18n) return;
    i18n.registerOverrides("app", locale, catalog);
  }
};
var _i18nOverride = new I18nOverrideQueenBee();
window.ioc.register("@diamondcoreprocessor.com/I18nOverrideQueenBee", _i18nOverride);

// src/diamondcoreprocessor.com/commands/keyword.queen.ts
import { QueenBee as QueenBee10, EffectBus as EffectBus8, hypercomb as hypercomb3 } from "@hypercomb/core";
var KeywordQueenBee = class extends QueenBee10 {
  namespace = "diamondcoreprocessor.com";
  command = "keyword";
  aliases = [];
  description = "Add or remove keywords (tags) on selected tiles";
  async execute(args) {
    const parsed = parseKeywordArgs(args);
    if (parsed.length === 0) return;
    const selection = get("@diamondcoreprocessor.com/SelectionService");
    const lineage = get("@hypercomb.social/Lineage");
    const registry = get("@hypercomb.social/TagRegistry");
    const selectedLabels = selection ? Array.from(selection.selected) : [];
    if (selectedLabels.length > 0 && lineage) {
      const dir = await lineage.explorerDir();
      if (dir) {
        const updates = [];
        for (const label of selectedLabels) {
          for (const op of parsed) {
            try {
              const cellDir = await dir.getDirectoryHandle(label, { create: true });
              const props = await readProps2(cellDir);
              const tags = Array.isArray(props["tags"]) ? props["tags"] : [];
              if (op.remove) {
                const idx = tags.indexOf(op.tag);
                if (idx >= 0) {
                  tags.splice(idx, 1);
                  await writeProps2(cellDir, { tags });
                }
              } else {
                if (!tags.includes(op.tag)) {
                  tags.push(op.tag);
                  await writeProps2(cellDir, { tags });
                }
              }
              updates.push({ cell: label, tag: op.tag, color: op.color });
            } catch {
            }
          }
        }
        if (updates.length > 0) {
          EffectBus8.emit("tags:changed", { updates });
        }
      }
    }
    if (registry) {
      await registry.ensureLoaded();
      for (const op of parsed) {
        if (!op.remove) {
          await registry.add(op.tag, op.color);
        }
      }
    }
    void new hypercomb3().act();
  }
};
function parseKeywordArgs(args) {
  const trimmed = args.trim();
  if (!trimmed) return [];
  const bracketMatch = trimmed.match(/^\[(.+)\]$/);
  if (bracketMatch) {
    const ops = [];
    for (const raw of bracketMatch[1].split(",")) {
      const item = raw.trim();
      if (!item) continue;
      if (item.startsWith("~")) {
        const tag = item.slice(1).trim();
        if (tag) ops.push({ tag, remove: true });
      } else {
        const m2 = item.match(/^([^(]+)(?:\(([^)]+)\))?$/);
        if (m2) {
          const tag = m2[1].trim();
          const color = m2[2]?.trim();
          if (tag) ops.push({ tag, color, remove: false });
        }
      }
    }
    return ops;
  }
  if (trimmed.startsWith("~")) {
    const tag = trimmed.slice(1).trim();
    return tag ? [{ tag, remove: true }] : [];
  }
  const m = trimmed.match(/^([^(]+)(?:\(([^)]+)\))?$/);
  if (m) {
    const tag = m[1].trim();
    const color = m[2]?.trim();
    return tag ? [{ tag, color, remove: false }] : [];
  }
  return [];
}
var PROPS_FILE2 = "0000";
async function readProps2(cellDir) {
  try {
    const fh = await cellDir.getFileHandle(PROPS_FILE2);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch {
    return {};
  }
}
async function writeProps2(cellDir, updates) {
  const existing = await readProps2(cellDir);
  const merged = { ...existing, ...updates };
  const fh = await cellDir.getFileHandle(PROPS_FILE2, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(merged));
  await writable.close();
}
var _keyword = new KeywordQueenBee();
window.ioc.register("@diamondcoreprocessor.com/KeywordQueenBee", _keyword);

// src/diamondcoreprocessor.com/commands/language.queen.ts
import { QueenBee as QueenBee11, I18N_IOC_KEY as I18N_IOC_KEY2 } from "@hypercomb/core";
var LanguageQueenBee = class extends QueenBee11 {
  namespace = "diamondcoreprocessor.com";
  command = "language";
  aliases = [];
  description = "Switch the UI language (14 languages supported)";
  descriptionKey = "slash.language";
  slashComplete(args) {
    const locales = ["en", "ja", "zh", "es", "ar", "pt", "fr", "de", "ko", "ru", "hi", "id", "tr", "it"];
    const q = args.toLowerCase().trim();
    if (!q) return locales;
    return locales.filter((l) => l.startsWith(q));
  }
  execute(args) {
    const i18n = get(I18N_IOC_KEY2);
    if (!i18n) {
      console.warn("[/language] Localization service not available");
      return;
    }
    const requested = args.trim().toLowerCase();
    if (!requested) {
      console.log(`[/language] Current locale: ${i18n.locale}`);
      return;
    }
    const locale = LOCALE_ALIASES[requested] ?? requested;
    i18n.setLocale(locale);
    console.log(`[/language] Locale set to: ${locale}`);
  }
};
var LOCALE_ALIASES = {
  "jp": "ja",
  "japanese": "ja",
  "cn": "zh",
  "chinese": "zh",
  "spanish": "es",
  "arabic": "ar",
  "portuguese": "pt",
  "br": "pt",
  "french": "fr",
  "german": "de",
  "korean": "ko",
  "kr": "ko",
  "russian": "ru",
  "hindi": "hi",
  "indonesian": "id",
  "turkish": "tr",
  "italian": "it",
  "en-us": "en"
};
var _language = new LanguageQueenBee();
window.ioc.register("@diamondcoreprocessor.com/LanguageQueenBee", _language);

// src/diamondcoreprocessor.com/commands/player.queen.ts
import { QueenBee as QueenBee12, EffectBus as EffectBus9 } from "@hypercomb/core";
var DISMISSED_KEY = "hc:player-dismissed";
var PlayerQueenBee = class extends QueenBee12 {
  namespace = "diamondcoreprocessor.com";
  command = "player";
  aliases = ["track", "audio"];
  description = "Re-open the track player";
  execute(_args) {
    try {
      localStorage.removeItem(DISMISSED_KEY);
    } catch {
    }
    EffectBus9.emit("player:open", {});
  }
};
var _player = new PlayerQueenBee();
window.ioc.register("@diamondcoreprocessor.com/PlayerQueenBee", _player);

// src/diamondcoreprocessor.com/commands/remove.queen.ts
import { QueenBee as QueenBee13, EffectBus as EffectBus10, hypercomb as hypercomb4 } from "@hypercomb/core";
var RemoveQueenBee = class extends QueenBee13 {
  namespace = "diamondcoreprocessor.com";
  command = "remove";
  aliases = [];
  description = "Remove tiles from the current directory";
  async execute(args) {
    const targets = parseRemoveArgs(args);
    if (targets.length === 0) {
      const selection = get("@diamondcoreprocessor.com/SelectionService");
      if (selection && selection.selected.size > 0) {
        targets.push(...Array.from(selection.selected));
        selection.clear();
      }
    }
    if (targets.length === 0) return;
    const groupId = targets.length > 1 ? `remove:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}` : void 0;
    const lineage = get("@hypercomb.social/Lineage");
    if (!lineage) return;
    const dir = await lineage.explorerDir();
    if (!dir) return;
    for (const name of targets) {
      try {
        await dir.removeEntry(name, { recursive: true });
        EffectBus10.emit("cell:removed", { cell: name, groupId });
      } catch (e) {
        console.error("[remove] removeEntry failed", name, e);
      }
    }
    void new hypercomb4().act();
  }
};
function parseRemoveArgs(args) {
  const trimmed = args.trim();
  if (!trimmed) return [];
  const bracketMatch = trimmed.match(/^\[(.+)\]$/);
  if (bracketMatch) {
    return bracketMatch[1].split(",").map((s) => normalizeName(s.trim())).filter(Boolean);
  }
  const name = normalizeName(trimmed);
  return name ? [name] : [];
}
function normalizeName(s) {
  return s.trim().toLocaleLowerCase().replace(/[._\s]+/g, "-").replace(/[^\p{L}\p{N}\-]/gu, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/, "");
}
var _remove = new RemoveQueenBee();
window.ioc.register("@diamondcoreprocessor.com/RemoveQueenBee", _remove);
EffectBus10.on("controls:action", (payload) => {
  if (payload?.action === "remove") void _remove.invoke("");
});
EffectBus10.on("keymap:invoke", (payload) => {
  if (payload?.cmd === "selection.remove") void _remove.invoke("");
});

// src/diamondcoreprocessor.com/commands/rename.queen.ts
import { QueenBee as QueenBee14, EffectBus as EffectBus11, SignatureService, hypercomb as hypercomb5 } from "@hypercomb/core";
var RenameQueenBee = class extends QueenBee14 {
  namespace = "diamondcoreprocessor.com";
  command = "rename";
  aliases = [];
  description = "Rename a tile";
  async execute(args) {
    const newName = normalizeName2(args.trim());
    if (!newName) return;
    const selection = get("@diamondcoreprocessor.com/SelectionService");
    if (!selection || selection.selected.size !== 1) return;
    const oldName = [...selection.selected][0];
    if (oldName === newName) return;
    const lineage = get("@hypercomb.social/Lineage");
    if (!lineage) return;
    const dir = await lineage.explorerDir();
    if (!dir) return;
    try {
      const oldDir = await dir.getDirectoryHandle(oldName, { create: false });
      try {
        await dir.getDirectoryHandle(newName, { create: false });
        return;
      } catch {
      }
      const newDir = await dir.getDirectoryHandle(newName, { create: true });
      await copyDirectory(oldDir, newDir);
      await dir.removeEntry(oldName, { recursive: true });
      await this.#recordRenameOp(oldName, newName);
      const groupId = `rename:${Date.now().toString(36)}`;
      EffectBus11.emit("cell:removed", { cell: oldName, groupId });
      EffectBus11.emit("cell:added", { cell: newName, groupId });
      EffectBus11.emit("cell:renamed", { oldName, newName });
      selection.clear();
      void new hypercomb5().act();
    } catch {
    }
  }
  async #recordRenameOp(oldName, newName) {
    const lineage = get("@hypercomb.social/Lineage");
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    const store = get("@hypercomb.social/Store");
    if (!lineage || !historyService || !store) return;
    const locationSig = await historyService.sign(lineage);
    const snapshot2 = {
      version: 1,
      oldName,
      newName,
      at: Date.now()
    };
    const json = JSON.stringify(snapshot2, Object.keys(snapshot2).sort(), 0);
    const blob = new Blob([json], { type: "application/json" });
    const bytes = await blob.arrayBuffer();
    const resourceSig = await SignatureService.sign(bytes);
    await store.putResource(blob);
    await historyService.record(locationSig, {
      op: "rename",
      cell: resourceSig,
      at: snapshot2.at
    });
  }
};
async function copyDirectory(src, dest) {
  for await (const [name, handle] of src.entries()) {
    if (handle.kind === "file") {
      const srcFile = await handle.getFile();
      const destFile = await dest.getFileHandle(name, { create: true });
      const writable = await destFile.createWritable();
      await writable.write(await srcFile.arrayBuffer());
      await writable.close();
    } else if (handle.kind === "directory") {
      const srcDir = handle;
      const destDir = await dest.getDirectoryHandle(name, { create: true });
      await copyDirectory(srcDir, destDir);
    }
  }
}
function normalizeName2(s) {
  return s.trim().toLocaleLowerCase().replace(/[._\s]+/g, "-").replace(/[^\p{L}\p{N}\-]/gu, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/, "");
}
var _rename = new RenameQueenBee();
window.ioc.register("@diamondcoreprocessor.com/RenameQueenBee", _rename);

// src/diamondcoreprocessor.com/commands/save-session.queen.ts
import { QueenBee as QueenBee15, EffectBus as EffectBus12 } from "@hypercomb/core";
var SESSION_START = Date.now();
var AUTO_SAVE_KEY = "hc:auto-save-session-on-leave";
var SaveSessionQueenBee = class extends QueenBee15 {
  namespace = "diamondcoreprocessor.com";
  command = "save-session";
  aliases = ["session-save", "save"];
  description = "Collapse this session's history entries at the current location into one head";
  async execute(args) {
    const trimmed = args.trim().toLowerCase();
    if (trimmed === "auto on" || trimmed === "auto") {
      localStorage.setItem(AUTO_SAVE_KEY, "true");
      EffectBus12.emit("activity:log", { message: "auto-save session on leave: ON", icon: "\u{1F4BE}" });
      return;
    }
    if (trimmed === "auto off") {
      localStorage.removeItem(AUTO_SAVE_KEY);
      EffectBus12.emit("activity:log", { message: "auto-save session on leave: OFF", icon: "\u{1F4BE}" });
      return;
    }
    await collapseSessionAtCurrentLocation();
  }
};
async function collapseSessionAtCurrentLocation() {
  const history = get("@diamondcoreprocessor.com/HistoryService");
  const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
  if (!history || !cursor) return;
  const locationSig = cursor.state.locationSig;
  if (!locationSig) return;
  const entries = await history.listLayers(locationSig);
  const sessionEntries = entries.filter((e) => e.at >= SESSION_START);
  if (sessionEntries.length < 2) return;
  await history.mergeEntries(locationSig, sessionEntries.map((e) => e.filename));
  const after = await history.listLayers(locationSig);
  cursor.seek(after.length);
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (localStorage.getItem(AUTO_SAVE_KEY) !== "true") return;
    void collapseSessionAtCurrentLocation();
  });
}
var _save = new SaveSessionQueenBee();
window.ioc?.register?.("@diamondcoreprocessor.com/SaveSessionQueenBee", _save);

// src/diamondcoreprocessor.com/commands/translate-sweep.queen.ts
import { QueenBee as QueenBee16 } from "@hypercomb/core";
var TranslateSweepQueenBee = class extends QueenBee16 {
  namespace = "diamondcoreprocessor.com";
  command = "translate-sweep";
  aliases = ["translate"];
  description = "Batch-translate all tiles (dry-run by default; add --go to execute)";
  descriptionKey = "slash.translate-sweep";
  slashComplete(args) {
    const locales = ["en", "ja", "zh", "es", "ar", "pt", "fr", "de", "ko", "ru", "hi", "id", "tr", "it", "all"];
    const parts = args.split(/\s+/).filter(Boolean);
    const last = parts[parts.length - 1]?.toLowerCase() ?? "";
    if (parts.length >= 1 && locales.includes(parts[0]?.toLowerCase() ?? "")) {
      if (parts.length === 1) return ["--go"];
      if (last === "-" || last.startsWith("--")) {
        return ["--go"].filter((s) => s.startsWith(last));
      }
    }
    if (!last) return locales;
    return locales.filter((l) => l.startsWith(last));
  }
  async execute(args) {
    const svc = get("@diamondcoreprocessor.com/TranslationService");
    if (!svc) {
      console.warn("[/translate-sweep] TranslationService unavailable");
      return;
    }
    const tokens = args.trim().split(/\s+/).filter(Boolean);
    const go = tokens.includes("--go");
    const positional = tokens.filter((t) => t !== "--go");
    const target = positional[0] ?? "";
    const i18n = get("@hypercomb.social/I18n");
    const locales = target === "all" ? SUPPORTED_LOCALES : [target || i18n?.locale || "en"];
    if (!go) {
      console.log("[/translate-sweep] dry-run \u2014 pass --go to execute");
      for (const locale of locales) {
        const est = await svc.estimate(locale);
        console.log(
          `  ${locale.padEnd(3)}  unique=${est.uniqueStrings}  cached=${est.cached}  skipped=${est.skipped}  to-translate=${est.toTranslate}  batches=${est.batches}  ~tokens in/out=${est.estimatedInputTokens}/${est.estimatedOutputTokens}`
        );
      }
      return;
    }
    for (const locale of locales) {
      console.log(`[/translate-sweep] running for ${locale}\u2026`);
      await svc.translateTiles(locale);
      console.log(`[/translate-sweep] finished ${locale}`);
    }
  }
};
var SUPPORTED_LOCALES = [
  "en",
  "ja",
  "zh",
  "es",
  "ar",
  "pt",
  "fr",
  "de",
  "ko",
  "ru",
  "hi",
  "id",
  "tr",
  "it"
];
var _sweep = new TranslateSweepQueenBee();
window.ioc.register("@diamondcoreprocessor.com/TranslateSweepQueenBee", _sweep);

// src/diamondcoreprocessor.com/commands/translation.service.ts
import { EffectBus as EffectBus13, SignatureService as SignatureService2, I18N_IOC_KEY as I18N_IOC_KEY3 } from "@hypercomb/core";

// src/diamondcoreprocessor.com/assistant/llm-api.ts
var ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
var ANTHROPIC_VERSION = "2023-06-01";
var MODELS = {
  opus: "claude-opus-4-6",
  o: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  s: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
  h: "claude-haiku-4-5-20251001"
};
var API_KEY_STORAGE = "hc:anthropic-api-key";
var getApiKey = () => localStorage.getItem(API_KEY_STORAGE);
var callAnthropic = async (model, systemPrompt, userMessage, apiKey, maxTokens = 4096) => {
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }]
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${text}`);
  }
  const json = await response.json();
  return json.content?.[0]?.text ?? "";
};
var callAnthropicBatch = async (model, targetLocale, texts, apiKey) => {
  if (!texts.length) return [];
  const systemPrompt = "You are a translation engine. You will receive a JSON array of strings. Translate each string to the requested target language. Return ONLY a JSON array of translated strings \u2014 same length, same order, no commentary, no code fences. Preserve original tone, meaning, technical terms, names, numbers, and URLs. If a string is already in the target language, return it unchanged.";
  const userMessage = `Target language: ${targetLocale}

Strings:
${JSON.stringify(texts)}`;
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(4096, 64 + texts.join("").length * 3),
      system: [
        { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }
      ],
      messages: [{ role: "user", content: userMessage }]
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${text}`);
  }
  const json = await response.json();
  const raw = json.content?.[0]?.text ?? "";
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) {
      console.warn("[callAnthropicBatch] no JSON array in response:", raw.slice(0, 200));
      return null;
    }
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) {
      console.warn("[callAnthropicBatch] parsed value is not an array:", parsed);
      return null;
    }
    if (parsed.length !== texts.length) {
      console.warn(
        `[callAnthropicBatch] length mismatch: got ${parsed.length}, expected ${texts.length}. Input: ${JSON.stringify(texts).slice(0, 200)}. Output: ${JSON.stringify(parsed).slice(0, 200)}`
      );
      return null;
    }
    return parsed.map((s) => String(s));
  } catch (err) {
    console.warn("[callAnthropicBatch] parse failed:", err, "raw:", raw.slice(0, 300));
    return null;
  }
};

// src/diamondcoreprocessor.com/commands/translation.service.ts
var PROPS_INDEX_KEY = "hc:tile-props-index";
var TRANSLATIONS_DIR = "translations";
var BATCH_SIZE = 40;
var TranslationService = class extends EventTarget {
  // In-memory mirror of per-locale OPFS files, lazy-loaded on first access.
  #cache = /* @__PURE__ */ new Map();
  #translating = false;
  constructor() {
    super();
    EffectBus13.on("locale:changed", (payload) => {
      void (async () => {
        await this.hydrateCatalog(payload.locale);
        if (!this.#translating && getApiKey()) {
          void this.translateTiles(payload.locale);
        }
      })();
    });
    window.ioc.whenReady(I18N_IOC_KEY3, (i18n) => {
      window.ioc.whenReady("@hypercomb.social/Store", () => {
        void (async () => {
          await this.#migrateLegacyLocalStorageCache();
          await this.hydrateCatalog(i18n.locale);
        })();
      });
    });
  }
  // One-time migration: the old implementation stored a flat `<sourceSig>:<locale>`
  // → `<translatedSig>` map in localStorage. Fold it into per-locale OPFS files
  // and remove the localStorage key. Safe to run repeatedly — no-op after first pass.
  async #migrateLegacyLocalStorageCache() {
    const legacy = localStorage.getItem("hc:translation-cache");
    if (!legacy) return;
    try {
      const parsed = JSON.parse(legacy);
      const byLocale = /* @__PURE__ */ new Map();
      for (const [key, sig] of Object.entries(parsed)) {
        const lastColon = key.lastIndexOf(":");
        if (lastColon < 0) continue;
        const sourceSig = key.slice(0, lastColon);
        const locale = key.slice(lastColon + 1);
        if (!byLocale.has(locale)) byLocale.set(locale, {});
        byLocale.get(locale)[sourceSig] = sig;
      }
      for (const [locale, entries] of byLocale) {
        const map = await this.#cacheFor(locale);
        Object.assign(map, entries);
        await this.#persistLocale(locale);
      }
    } catch {
    }
    localStorage.removeItem("hc:translation-cache");
  }
  // ── public API ─────────────────────────────────────
  /**
   * Translate a text string to the target locale.
   * Returns the signature of the translated resource.
   *
   * If a cached translation exists, returns immediately without an AI call.
   */
  async translate(text, targetLocale) {
    const apiKey = getApiKey();
    if (!apiKey) return null;
    const store = get("@hypercomb.social/Store");
    if (!store) return null;
    const originalBytes = new TextEncoder().encode(text);
    const originalSig = await SignatureService2.sign(originalBytes.buffer);
    const map = await this.#cacheFor(targetLocale);
    const cached = map[originalSig];
    if (cached) {
      const existing = await store.getResource(cached);
      if (existing) return cached;
    }
    const translated = await this.#callTranslation(text, targetLocale, apiKey);
    if (!translated) return null;
    const blob = new Blob([translated], { type: "text/plain" });
    const translatedSig = await store.putResource(blob);
    map[originalSig] = translatedSig;
    await this.#persistLocale(targetLocale);
    return translatedSig;
  }
  /**
   * Translate a resource by its signature.
   * Returns the signature of the translated resource.
   */
  async translateResource(originalSig, targetLocale) {
    const store = get("@hypercomb.social/Store");
    if (!store) return null;
    const map = await this.#cacheFor(targetLocale);
    const cached = map[originalSig];
    if (cached) {
      const existing = await store.getResource(cached);
      if (existing) return cached;
    }
    const blob = await store.getResource(originalSig);
    if (!blob) return null;
    const text = await blob.text();
    if (!text.trim()) return null;
    return this.translate(text, targetLocale);
  }
  /**
   * Look up a cached translation signature without triggering an AI call.
   * Returns null if no cached translation exists.
   */
  async lookup(originalSig, targetLocale) {
    const map = await this.#cacheFor(targetLocale);
    return map[originalSig] ?? null;
  }
  /**
   * Translate all visible tile labels and content to the target locale.
   * Batches API calls, skips already-cached pairs, filters trivial strings.
   * Emits 'translation:tile-start/done/complete' effects for UI heat glow.
   */
  async translateTiles(targetLocale) {
    await this.#runSweep(targetLocale, { dryRun: false });
  }
  /**
   * Estimate a sweep without making any API calls.
   * Returns counts and token estimates so the user can confirm before spending credits.
   */
  async estimate(targetLocale) {
    const plan = await this.#planSweep(targetLocale);
    const charCount = plan.toTranslate.reduce((n, s) => n + s.length, 0);
    return {
      locale: targetLocale,
      uniqueStrings: plan.uniqueStrings,
      cached: plan.cachedCount,
      skipped: plan.skippedCount,
      toTranslate: plan.toTranslate.length,
      batches: Math.ceil(plan.toTranslate.length / BATCH_SIZE),
      estimatedInputTokens: Math.ceil(charCount / 3) + 120,
      estimatedOutputTokens: Math.ceil(charCount / 3) + plan.toTranslate.length * 4
    };
  }
  /**
   * Rehydrate the i18n catalog from cached translations for the given locale.
   * Call at app startup (or on locale change) so cached labels display without API calls.
   */
  async hydrateCatalog(targetLocale) {
    const i18n = get(I18N_IOC_KEY3);
    const store = get("@hypercomb.social/Store");
    if (!i18n || !store) return;
    const propsIndex = JSON.parse(
      localStorage.getItem(PROPS_INDEX_KEY) ?? "{}"
    );
    const catalog = {};
    for (const tileName of Object.keys(propsIndex)) {
      const labelSig = await this.#cachedLabelSig(tileName, targetLocale);
      if (!labelSig) continue;
      const blob = await store.getResource(labelSig);
      if (!blob) continue;
      catalog[`cell.${tileName}`] = (await blob.text()).trim();
    }
    if (Object.keys(catalog).length) {
      i18n.registerTranslations("app", targetLocale, catalog);
      if (i18n.locale === targetLocale) {
        EffectBus13.emit("labels:invalidated", { locale: targetLocale });
      }
    }
  }
  // ── sweep internals ─────────────────────────────────
  async #runSweep(targetLocale, opts) {
    if (this.#translating) return;
    this.#translating = true;
    try {
      const store = get("@hypercomb.social/Store");
      const i18n = get(I18N_IOC_KEY3);
      if (!store) return;
      const plan = await this.#planSweep(targetLocale);
      if (!plan.tileNames.length) return;
      if (opts.dryRun) {
        console.log("[translation] dry-run plan", {
          locale: targetLocale,
          unique: plan.uniqueStrings,
          cached: plan.cachedCount,
          skipped: plan.skippedCount,
          toTranslate: plan.toTranslate.length,
          batches: Math.ceil(plan.toTranslate.length / BATCH_SIZE)
        });
        return;
      }
      const apiKey = getApiKey();
      if (!apiKey && plan.toTranslate.length) {
        EffectBus13.emit("llm:api-key-required", {});
        return;
      }
      EffectBus13.emit("translation:tile-start", { labels: plan.tileNames, locale: targetLocale });
      const batchCount = Math.ceil(plan.toTranslate.length / BATCH_SIZE);
      if (plan.toTranslate.length) {
        console.log(
          `[translation] sweep ${targetLocale}: ${plan.toTranslate.length} strings in ${batchCount} batch(es) (${plan.cachedCount} cached, ${plan.skippedCount} skipped)`
        );
      } else {
        console.log(
          `[translation] sweep ${targetLocale}: nothing to translate (${plan.cachedCount} cached, ${plan.skippedCount} skipped)`
        );
      }
      const translatedBySource = {};
      for (let i = 0; i < plan.toTranslate.length; i += BATCH_SIZE) {
        const batch = plan.toTranslate.slice(i, i + BATCH_SIZE);
        let results = null;
        try {
          results = await callAnthropicBatch(MODELS["haiku"], targetLocale, batch, apiKey);
        } catch (err) {
          console.warn(`[translation] batch ${i}-${i + batch.length} failed:`, err);
          continue;
        }
        if (!results) {
          console.warn(
            `[translation] batch ${i}-${i + batch.length} unparseable \u2014 falling back to per-string`
          );
          for (const source of batch) {
            try {
              const single = await callAnthropic(
                MODELS["haiku"],
                "Translate the user's text. Return ONLY the translated text \u2014 no quotes, no explanations.",
                `Translate to ${targetLocale}:

${source}`,
                apiKey,
                512
              );
              if (single?.trim()) translatedBySource[source] = single.trim();
            } catch (err) {
              console.warn(`[translation] per-string fallback failed for "${source}":`, err);
            }
          }
          continue;
        }
        for (let j = 0; j < batch.length; j++) {
          const translated = results[j];
          if (typeof translated === "string" && translated.length) {
            translatedBySource[batch[j]] = translated;
          }
        }
      }
      const catalog = {};
      const map = await this.#cacheFor(targetLocale);
      for (const [source, translated] of Object.entries(translatedBySource)) {
        const sourceSig = await this.#signString(source);
        const blob = new Blob([translated], { type: "text/plain" });
        const translatedSig = await store.putResource(blob);
        map[sourceSig] = translatedSig;
      }
      await this.#persistLocale(targetLocale);
      const propsIndex = JSON.parse(
        localStorage.getItem(PROPS_INDEX_KEY) ?? "{}"
      );
      for (const tileName of plan.tileNames) {
        const propsSig = propsIndex[tileName];
        if (!propsSig) {
          EffectBus13.emit("translation:tile-done", { label: tileName });
          continue;
        }
        const propsBlob = await store.getResource(propsSig);
        if (!propsBlob) {
          EffectBus13.emit("translation:tile-done", { label: tileName });
          continue;
        }
        let props;
        try {
          props = JSON.parse(await propsBlob.text());
        } catch {
          EffectBus13.emit("translation:tile-done", { label: tileName });
          continue;
        }
        let changed = false;
        const labelSig = await this.#cachedLabelSig(tileName, targetLocale);
        if (labelSig) {
          props["translations"] ??= {};
          props["translations"][targetLocale] ??= {};
          if (props["translations"][targetLocale].labelSig !== labelSig) {
            props["translations"][targetLocale].labelSig = labelSig;
            changed = true;
          }
          const labelBlob = await store.getResource(labelSig);
          if (labelBlob) catalog[`cell.${tileName}`] = (await labelBlob.text()).trim();
        }
        if (props["contentSig"]) {
          const contentSig = props["contentSig"];
          const contentTransSig = this.lookup(contentSig, targetLocale) ?? await this.translateResource(contentSig, targetLocale);
          if (contentTransSig) {
            props["translations"] ??= {};
            props["translations"][targetLocale] ??= {};
            if (props["translations"][targetLocale].contentSig !== contentTransSig) {
              props["translations"][targetLocale].contentSig = contentTransSig;
              changed = true;
            }
          }
        }
        if (changed) {
          const updatedBlob = new Blob(
            [JSON.stringify(props, null, 2)],
            { type: "application/json" }
          );
          propsIndex[tileName] = await store.putResource(updatedBlob);
        }
        EffectBus13.emit("translation:tile-done", { label: tileName });
      }
      localStorage.setItem(PROPS_INDEX_KEY, JSON.stringify(propsIndex));
      if (i18n && Object.keys(catalog).length) {
        i18n.registerTranslations("app", targetLocale, catalog);
        if (i18n.locale === targetLocale) {
          EffectBus13.emit("labels:invalidated", { locale: targetLocale });
        }
      }
      EffectBus13.emit("translation:complete", {
        locale: targetLocale,
        translated: plan.toTranslate.length
      });
      this.dispatchEvent(new CustomEvent("change"));
    } finally {
      this.#translating = false;
    }
  }
  async #planSweep(targetLocale) {
    const store = get("@hypercomb.social/Store");
    const propsIndex = JSON.parse(
      localStorage.getItem(PROPS_INDEX_KEY) ?? "{}"
    );
    const tileNames = await this.#enumerateTileNames(propsIndex);
    const sources = /* @__PURE__ */ new Set();
    for (const tileName of tileNames) sources.add(tileName);
    if (store) {
      for (const tileName of tileNames) {
        const propsSig = propsIndex[tileName];
        if (!propsSig) continue;
        const blob = await store.getResource(propsSig);
        if (!blob) continue;
        try {
          const props = JSON.parse(await blob.text());
          const contentSig = props["contentSig"];
          if (typeof contentSig === "string") {
            const contentBlob = await store.getResource(contentSig);
            if (contentBlob) {
              const text = (await contentBlob.text()).trim();
              if (text) sources.add(text);
            }
          }
        } catch {
        }
      }
    }
    let cachedCount = 0;
    let skippedCount = 0;
    const toTranslate = [];
    const map = await this.#cacheFor(targetLocale);
    for (const source of sources) {
      if (shouldSkipForTranslation(source, targetLocale)) {
        skippedCount++;
        continue;
      }
      const sig = await this.#signString(source);
      if (map[sig]) {
        cachedCount++;
        continue;
      }
      toTranslate.push(source);
    }
    return {
      tileNames,
      uniqueStrings: sources.size,
      cachedCount,
      skippedCount,
      toTranslate
    };
  }
  async #enumerateTileNames(propsIndex) {
    const names = new Set(Object.keys(propsIndex));
    const lineage = get("@hypercomb.social/Lineage");
    const dir = lineage?.explorerDir ? await lineage.explorerDir() : null;
    if (dir) {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === "directory") names.add(name);
      }
    }
    return Array.from(names);
  }
  async #cachedLabelSig(tileName, locale) {
    const sig = await this.#signString(tileName);
    const map = await this.#cacheFor(locale);
    return map[sig] ?? null;
  }
  async #cacheFor(locale) {
    let m = this.#cache.get(locale);
    if (m) return m;
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(TRANSLATIONS_DIR, { create: false });
      const handle = await dir.getFileHandle(`${locale}.json`, { create: false });
      const file = await handle.getFile();
      m = JSON.parse(await file.text());
    } catch {
      m = {};
    }
    this.#cache.set(locale, m);
    return m;
  }
  async #persistLocale(locale) {
    const m = this.#cache.get(locale) ?? {};
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(TRANSLATIONS_DIR, { create: true });
    const handle = await dir.getFileHandle(`${locale}.json`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(m, null, 2));
    await writable.close();
  }
  async #signString(text) {
    const bytes = new TextEncoder().encode(text);
    return SignatureService2.sign(bytes.buffer);
  }
  // ── internals ──────────────────────────────────────
  async #callTranslation(text, targetLocale, apiKey) {
    const systemPrompt = [
      "You are a translation engine. Translate the user's text to the target language.",
      "Return ONLY the translated text \u2014 no explanations, no quotes, no formatting.",
      "Preserve the original tone, meaning, and any technical terms.",
      "If the text is already in the target language, return it unchanged."
    ].join(" ");
    const userMessage = `Translate to ${targetLocale}:

${text}`;
    try {
      return await callAnthropic(
        MODELS["haiku"],
        systemPrompt,
        userMessage,
        apiKey,
        2048
      );
    } catch (err) {
      console.warn("[translation] AI call failed:", err);
      return null;
    }
  }
};
var _translation = new TranslationService();
window.ioc.register("@diamondcoreprocessor.com/TranslationService", _translation);
var URL_PATTERN = /^(https?:\/\/|ftp:\/\/|mailto:|tel:)/i;
var NUMERIC_PATTERN = /^[\s\d.,:+\-/()$€¥%]+$/;
var HAS_LETTER = /\p{L}/u;
function shouldSkipForTranslation(text, _targetLocale) {
  const trimmed = text.trim();
  if (trimmed.length < 2) return true;
  if (NUMERIC_PATTERN.test(trimmed)) return true;
  if (URL_PATTERN.test(trimmed)) return true;
  if (!HAS_LETTER.test(trimmed)) return true;
  return false;
}

// src/diamondcoreprocessor.com/commands/website.queen.ts
import { QueenBee as QueenBee17, EffectBus as EffectBus14 } from "@hypercomb/core";
import { CELL_WEBSITE_PROPERTY } from "@hypercomb/core";
var toast2 = (type, title, message) => {
  try {
    EffectBus14.emit("toast:show", { type, title, message });
  } catch {
  }
};
var BRACKET_SIGS_RE = /\[([0-9a-f]{64})\]/gi;
function parseArgs(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "export", target: null };
  if (trimmed.toLowerCase() === "list") return { kind: "list" };
  const tokens = splitTopLevel(trimmed);
  if (tokens.length === 1) {
    const tok = tokens[0];
    if (tok.toLowerCase() === "clear" || tok.toLowerCase() === "remove") {
      return { kind: "clear", target: null };
    }
    if (isSignature(tok)) return { kind: "stamp", target: null, sigs: [tok.toLowerCase()] };
    const bracketed2 = extractBracketedSigs(tok);
    if (bracketed2.length) return { kind: "stamp", target: null, sigs: bracketed2 };
    return { kind: "export", target: tok };
  }
  const target = tokens[0];
  const rest = tokens.slice(1).join(" ");
  if (rest.toLowerCase() === "clear" || rest.toLowerCase() === "remove") {
    return { kind: "clear", target };
  }
  if (isSignature(rest)) return { kind: "stamp", target, sigs: [rest.toLowerCase()] };
  const bracketed = extractBracketedSigs(rest);
  if (bracketed.length) return { kind: "stamp", target, sigs: bracketed };
  return { kind: "error", message: `could not parse "${rest.slice(0, 40)}"` };
}
function splitTopLevel(s) {
  const out = [];
  let cur = "";
  let inBracket = 0;
  for (const ch of s) {
    if (ch === "[") inBracket++;
    else if (ch === "]") inBracket = Math.max(0, inBracket - 1);
    if (!inBracket && /\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function extractBracketedSigs(s) {
  const out = [];
  let m;
  const re = new RegExp(BRACKET_SIGS_RE.source, "gi");
  while ((m = re.exec(s)) !== null) out.push(m[1].toLowerCase());
  return out;
}
async function resolveTarget(spec) {
  const lineage = get("@hypercomb.social/Lineage");
  const store = get("@hypercomb.social/Store");
  if (!lineage || !store?.hypercombRoot) return null;
  if (spec === null) {
    const dir = await lineage.explorerDir?.();
    if (!dir) return null;
    return {
      dir,
      path: [...lineage.explorerSegments?.() ?? []],
      label: lineage.explorerLabel?.() ?? "/"
    };
  }
  const registry = get("@hypercomb.social/NameRegistry");
  if (registry?.ensureLoaded) await registry.ensureLoaded();
  const entry = registry?.get?.(spec);
  if (entry?.target?.kind === "lineage") {
    return resolvePath(lineage, store, entry.target.path);
  }
  if (entry?.target?.kind === "signature") {
    return null;
  }
  const parts = spec.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (parts.length > 0) return resolvePath(lineage, store, parts);
  return null;
}
async function resolvePath(lineage, store, path) {
  const dir = await lineage.tryResolve?.(path, store.hypercombRoot);
  if (!dir) return null;
  return { dir, path, label: "/" + path.join("/") };
}
function resolveSignatureFromName(spec) {
  if (!spec) return null;
  const registry = get("@hypercomb.social/NameRegistry");
  const entry = registry?.get?.(spec);
  if (entry?.target?.kind === "signature") return entry.target.signature;
  return null;
}
async function snapshot(target) {
  const nodes = [];
  await walk(target.dir, [], nodes);
  const rootProps = await readCellProperties(target.dir).catch(() => ({}));
  const current = rootProps[CELL_WEBSITE_PROPERTY];
  const currentWebsiteSig = isSignature(current) ? current : void 0;
  return { rootPath: target.path, currentWebsiteSig, nodes };
}
async function walk(dir, path, out) {
  const props = await readCellProperties(dir).catch(() => ({}));
  const node = { path };
  const sig = props[CELL_WEBSITE_PROPERTY];
  if (isSignature(sig)) node.websiteSig = sig;
  const label = props["label"] ?? props["title"];
  if (typeof label === "string" && label.trim()) node.label = label;
  out.push(node);
  const children = [];
  try {
    for await (const [name, entry] of dir.entries()) {
      if (entry.kind === "directory" && !name.startsWith("_")) children.push(name);
    }
  } catch {
  }
  children.sort();
  for (const name of children) {
    try {
      const childDir = await dir.getDirectoryHandle(name);
      await walk(childDir, [...path, name], out);
    } catch {
    }
  }
}
async function sigsToBundleSig(sigs) {
  const store = get("@hypercomb.social/Store");
  if (!store?.putResource) return null;
  const bundleText = sigs.map((s) => s.toLowerCase()).join("");
  const blob = new Blob([bundleText], { type: "text/plain" });
  return await store.putResource(blob);
}
var WebsiteQueenBee = class extends QueenBee17 {
  namespace = "diamondcoreprocessor.com";
  command = "website";
  aliases = [];
  description = "Export a subtree, stamp a bundleSig, or build a bundle from a list of sigs. Targets current cell or a named branch / lineage path.";
  descriptionKey = "slash.website";
  slashComplete(args) {
    const registry = get("@hypercomb.social/NameRegistry");
    const names = registry?.names ?? [];
    const tokens = args.split(/\s+/);
    const head = (tokens[0] ?? "").toLowerCase();
    if (tokens.length <= 1) {
      const matches = names.filter((n) => n.toLowerCase().startsWith(head));
      const fixed = ["(export current)", "<64-hex sig>", "[sig][sig]\u2026", "clear", "list"].filter((s) => !head || s.toLowerCase().startsWith(head));
      return [.../* @__PURE__ */ new Set([...matches, ...fixed])];
    }
    const second = (tokens[1] ?? "").toLowerCase();
    const ops = ["<64-hex sig>", "[sig][sig]\u2026", "clear"];
    if (!second) return ops;
    return ops.filter((o) => o.toLowerCase().startsWith(second));
  }
  execute(args) {
    const parsed = parseArgs(args);
    switch (parsed.kind) {
      case "list":
        return void this.#list();
      case "error":
        console.warn(`[/website] ${parsed.message}`);
        return;
      case "export":
        return void this.#export(parsed.target);
      case "clear":
        return void this.#clear(parsed.target);
      case "stamp":
        return void this.#stamp(parsed.target, parsed.sigs);
    }
  }
  async #export(targetSpec) {
    if (targetSpec !== null) {
      const sig = resolveSignatureFromName(targetSpec);
      if (sig) return this.#stamp(null, [sig]);
    }
    const target = await resolveTarget(targetSpec);
    if (!target) {
      console.warn(`[/website] could not resolve target: ${targetSpec ?? "(current)"}`);
      return;
    }
    const spec = await snapshot(target);
    const json = JSON.stringify(spec, null, 2);
    console.log(`[/website] hierarchy export from ${target.label}:`);
    console.log(json);
    try {
      await navigator.clipboard.writeText(json);
      console.log(`[/website] copied ${json.length} bytes to clipboard \u2014 paste into Claude Code /website skill`);
      toast2(
        "success",
        "Website exported",
        `${spec.nodes.length} node${spec.nodes.length === 1 ? "" : "s"} from ${target.label} \u2014 ${json.length} bytes on clipboard`
      );
    } catch (err) {
      console.warn("[/website] clipboard write failed \u2014 copy from console:", err);
      toast2(
        "warning",
        "Export copy failed",
        "Clipboard write blocked \u2014 copy the JSON from the browser console"
      );
    }
  }
  async #stamp(targetSpec, sigs) {
    if (sigs.length === 0) {
      console.warn("[/website] no signatures to stamp");
      return;
    }
    const target = await resolveTarget(targetSpec);
    if (!target) {
      console.warn(`[/website] could not resolve target: ${targetSpec ?? "(current)"}`);
      return;
    }
    let finalSig;
    if (sigs.length === 1) {
      finalSig = sigs[0];
    } else {
      const constructed = await sigsToBundleSig(sigs);
      if (!constructed) {
        console.warn("[/website] could not build bundle resource");
        return;
      }
      finalSig = constructed;
      console.log(`[/website] built bundle from ${sigs.length} sigs \u2192 ${finalSig}`);
    }
    await writeCellProperties(target.dir, { [CELL_WEBSITE_PROPERTY]: finalSig });
    console.log(`[/website] ${CELL_WEBSITE_PROPERTY}=${finalSig} on ${target.label}`);
    toast2("success", "Website stamped", `${target.label} \u2192 ${finalSig.slice(0, 12)}\u2026`);
    const lineage = get("@hypercomb.social/Lineage");
    lineage?.dispatchEvent?.(new CustomEvent("change"));
  }
  async #clear(targetSpec) {
    const target = await resolveTarget(targetSpec);
    if (!target) return;
    const props = await readCellProperties(target.dir).catch(() => ({}));
    if (!(CELL_WEBSITE_PROPERTY in props)) return;
    delete props[CELL_WEBSITE_PROPERTY];
    const file = await target.dir.getFileHandle("0000", { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(props));
    await writable.close();
    console.log(`[/website] cleared ${CELL_WEBSITE_PROPERTY} on ${target.label}`);
    toast2("info", "Website cleared", target.label);
    const lineage = get("@hypercomb.social/Lineage");
    lineage?.dispatchEvent?.(new CustomEvent("change"));
  }
  async #list() {
    const registry = get("@hypercomb.social/NameRegistry");
    if (!registry?.ensureLoaded) {
      console.warn("[/website] registry not ready");
      return;
    }
    await registry.ensureLoaded();
    const all = registry.all;
    const names = Object.keys(all).sort();
    console.log(`[/website] ${names.length} branch${names.length === 1 ? "" : "es"}:`);
    for (const name of names) {
      const entry = all[name];
      if (entry?.target?.kind === "lineage") {
        console.log(`  ${name} \u2192 /${(entry.target.path ?? []).join("/")}`);
      } else if (entry?.target?.kind === "signature") {
        console.log(`  ${name} \u2192 signature ${entry.target.signature}`);
      }
    }
  }
};
var _website = new WebsiteQueenBee();
window.ioc.register("@diamondcoreprocessor.com/WebsiteQueenBee", _website);
export {
  AccentQueenBee,
  ArrangeQueenBee,
  BranchQueenBee,
  CompactQueenBee,
  DebugQueenBee,
  DomainQueenBee,
  DownloadQueenBee,
  EmptyLongPressInput,
  HelpQueenBee,
  I18nOverrideQueenBee,
  KeywordQueenBee,
  LanguageQueenBee,
  PlayerQueenBee,
  RemoveQueenBee,
  RenameQueenBee,
  SaveSessionQueenBee,
  TranslateSweepQueenBee,
  TranslationService,
  WebsiteQueenBee,
  shouldSkipForTranslation
};
