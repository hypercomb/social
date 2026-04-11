// @diamondcoreprocessor.com/commands
// hypercomb-essentials/src/diamondcoreprocessor.com/commands/accent.queen.ts
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

// hypercomb-essentials/src/diamondcoreprocessor.com/commands/arrange.queen.ts
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

// hypercomb-essentials/src/diamondcoreprocessor.com/commands/debug.queen.ts
import { QueenBee as QueenBee3, EffectBus as EffectBus3 } from "@hypercomb/core";
var DebugQueenBee = class extends QueenBee3 {
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
      EffectBus3.emit("queen:debug", { active: dbg.active });
    } else {
      console.warn("[debug] PixiDebugDrone not loaded \u2014 no __pixiDebug on window");
      EffectBus3.emit("queen:debug", { active: false, error: "not-loaded" });
    }
  }
};
var _debug = new DebugQueenBee();
window.ioc.register("@diamondcoreprocessor.com/DebugQueenBee", _debug);

// hypercomb-essentials/src/diamondcoreprocessor.com/commands/domain.queen.ts
import { QueenBee as QueenBee4 } from "@hypercomb/core";
var DomainQueenBee = class extends QueenBee4 {
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

// hypercomb-essentials/src/diamondcoreprocessor.com/commands/empty-long-press.input.ts
import { Point } from "pixi.js";
import { EffectBus as EffectBus4 } from "@hypercomb/core";
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
    EffectBus4.on("render:host-ready", (payload) => {
      this.#canvas = payload.canvas;
      this.#container = payload.container;
      this.#renderer = payload.renderer;
      this.#attach();
    });
    EffectBus4.on("render:mesh-offset", (offset) => {
      this.#meshOffset = offset;
    });
    EffectBus4.on("render:set-orientation", ({ flat }) => {
      this.#flat = !!flat;
    });
    EffectBus4.on("render:cell-count", ({ coords }) => {
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
      EffectBus4.emit("mobile:input-visible", { visible: true, mobile: true });
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

// hypercomb-essentials/src/diamondcoreprocessor.com/commands/help.queen.ts
import { QueenBee as QueenBee5, EffectBus as EffectBus5 } from "@hypercomb/core";
var HelpQueenBee = class extends QueenBee5 {
  namespace = "diamondcoreprocessor.com";
  command = "help";
  aliases = [];
  description = "List all available queen bee commands";
  execute(_args) {
    const queens = this.#findQueenBees();
    if (queens.length === 0) {
      EffectBus5.emit("queen:help", { commands: [] });
      console.log("[/help] No queen bees registered.");
      return;
    }
    const commands = queens.map((q) => ({
      command: q.command,
      aliases: q.aliases,
      description: q.description ?? ""
    }));
    EffectBus5.emit("queen:help", { commands });
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

// hypercomb-essentials/src/diamondcoreprocessor.com/commands/keyword.queen.ts
import { QueenBee as QueenBee6, EffectBus as EffectBus6, hypercomb as hypercomb2 } from "@hypercomb/core";
var KeywordQueenBee = class extends QueenBee6 {
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
          EffectBus6.emit("tags:changed", { updates });
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
    void new hypercomb2().act();
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

// hypercomb-essentials/src/diamondcoreprocessor.com/commands/language.queen.ts
import { QueenBee as QueenBee7, I18N_IOC_KEY } from "@hypercomb/core";
var LanguageQueenBee = class extends QueenBee7 {
  namespace = "diamondcoreprocessor.com";
  command = "language";
  aliases = [];
  description = "Switch the UI language (14 languages supported)";
  execute(args) {
    const i18n = get(I18N_IOC_KEY);
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

// hypercomb-essentials/src/diamondcoreprocessor.com/commands/player.queen.ts
import { QueenBee as QueenBee8, EffectBus as EffectBus7 } from "@hypercomb/core";
var DISMISSED_KEY = "hc:player-dismissed";
var PlayerQueenBee = class extends QueenBee8 {
  namespace = "diamondcoreprocessor.com";
  command = "player";
  aliases = ["track", "audio"];
  description = "Re-open the track player";
  execute(_args) {
    try {
      localStorage.removeItem(DISMISSED_KEY);
    } catch {
    }
    EffectBus7.emit("player:open", {});
  }
};
var _player = new PlayerQueenBee();
window.ioc.register("@diamondcoreprocessor.com/PlayerQueenBee", _player);

// hypercomb-essentials/src/diamondcoreprocessor.com/commands/remove.queen.ts
import { QueenBee as QueenBee9, EffectBus as EffectBus8, hypercomb as hypercomb3 } from "@hypercomb/core";
var RemoveQueenBee = class extends QueenBee9 {
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
        EffectBus8.emit("cell:removed", { cell: name, groupId });
      } catch {
      }
    }
    void new hypercomb3().act();
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
EffectBus8.on("controls:action", (payload) => {
  if (payload?.action === "remove") void _remove.invoke("");
});
EffectBus8.on("keymap:invoke", (payload) => {
  if (payload?.cmd === "selection.remove") void _remove.invoke("");
});

// hypercomb-essentials/src/diamondcoreprocessor.com/commands/rename.queen.ts
import { QueenBee as QueenBee10, EffectBus as EffectBus9, SignatureService, hypercomb as hypercomb4 } from "@hypercomb/core";
var RenameQueenBee = class extends QueenBee10 {
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
      EffectBus9.emit("cell:removed", { cell: oldName, groupId });
      EffectBus9.emit("cell:added", { cell: newName, groupId });
      EffectBus9.emit("cell:renamed", { oldName, newName });
      selection.clear();
      void new hypercomb4().act();
    } catch {
    }
  }
  async #recordRenameOp(oldName, newName) {
    const lineage = get("@hypercomb.social/Lineage");
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    const store = get("@hypercomb.social/Store");
    if (!lineage || !historyService || !store) return;
    const locationSig = await historyService.sign(lineage);
    const snapshot = {
      version: 1,
      oldName,
      newName,
      at: Date.now()
    };
    const json = JSON.stringify(snapshot, Object.keys(snapshot).sort(), 0);
    const blob = new Blob([json], { type: "application/json" });
    const bytes = await blob.arrayBuffer();
    const resourceSig = await SignatureService.sign(bytes);
    await store.putResource(blob);
    await historyService.record(locationSig, {
      op: "rename",
      cell: resourceSig,
      at: snapshot.at
    });
    const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
    if (cursor) await cursor.onNewOp();
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

// hypercomb-essentials/src/diamondcoreprocessor.com/commands/translation.service.ts
import { EffectBus as EffectBus10, SignatureService as SignatureService2 } from "@hypercomb/core";

// hypercomb-essentials/src/diamondcoreprocessor.com/assistant/llm-api.ts
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

// hypercomb-essentials/src/diamondcoreprocessor.com/commands/translation.service.ts
var CACHE_KEY = "hc:translation-cache";
var PROPS_INDEX_KEY = "hc:tile-props-index";
var TranslationService = class extends EventTarget {
  #cache;
  #translating = false;
  constructor() {
    super();
    this.#cache = this.#loadCache();
    EffectBus10.on("locale:changed", (payload) => {
      if (!this.#translating && getApiKey()) {
        void this.translateTiles(payload.locale);
      }
    });
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
    const cacheKey = `${originalSig}:${targetLocale}`;
    const cached = this.#cache[cacheKey];
    if (cached) {
      const existing = await store.getResource(cached);
      if (existing) return cached;
    }
    const translated = await this.#callTranslation(text, targetLocale, apiKey);
    if (!translated) return null;
    const blob = new Blob([translated], { type: "text/plain" });
    const translatedSig = await store.putResource(blob);
    this.#cache[cacheKey] = translatedSig;
    this.#saveCache();
    return translatedSig;
  }
  /**
   * Translate a resource by its signature.
   * Returns the signature of the translated resource.
   */
  async translateResource(originalSig, targetLocale) {
    const store = get("@hypercomb.social/Store");
    if (!store) return null;
    const cacheKey = `${originalSig}:${targetLocale}`;
    const cached = this.#cache[cacheKey];
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
  lookup(originalSig, targetLocale) {
    return this.#cache[`${originalSig}:${targetLocale}`] ?? null;
  }
  /**
   * Translate all visible tile labels and content to the target locale.
   * Updates tile properties with translation signatures.
   * Emits 'translation:progress' and 'translation:complete' effects.
   */
  async translateTiles(targetLocale) {
    if (this.#translating) return;
    this.#translating = true;
    try {
      const apiKey = getApiKey();
      if (!apiKey) {
        EffectBus10.emit("llm:api-key-required", {});
        return;
      }
      const store = get("@hypercomb.social/Store");
      if (!store) return;
      const propsIndex = JSON.parse(
        localStorage.getItem(PROPS_INDEX_KEY) ?? "{}"
      );
      const tileNames = Object.keys(propsIndex);
      if (!tileNames.length) return;
      EffectBus10.emit("translation:tile-start", { labels: tileNames, locale: targetLocale });
      let done = 0;
      for (const tileName of tileNames) {
        const propsSig = propsIndex[tileName];
        if (!propsSig) {
          done++;
          EffectBus10.emit("translation:tile-done", { label: tileName });
          continue;
        }
        const propsBlob = await store.getResource(propsSig);
        if (!propsBlob) {
          done++;
          EffectBus10.emit("translation:tile-done", { label: tileName });
          continue;
        }
        let props;
        try {
          props = JSON.parse(await propsBlob.text());
        } catch {
          done++;
          EffectBus10.emit("translation:tile-done", { label: tileName });
          continue;
        }
        let changed = false;
        const labelSig = await this.translate(tileName, targetLocale);
        if (labelSig) {
          if (!props["translations"]) props["translations"] = {};
          if (!props["translations"][targetLocale]) props["translations"][targetLocale] = {};
          props["translations"][targetLocale].labelSig = labelSig;
          changed = true;
        }
        if (props["contentSig"]) {
          const contentTransSig = await this.translateResource(props["contentSig"], targetLocale);
          if (contentTransSig) {
            if (!props["translations"]) props["translations"] = {};
            if (!props["translations"][targetLocale]) props["translations"][targetLocale] = {};
            props["translations"][targetLocale].contentSig = contentTransSig;
            changed = true;
          }
        }
        if (changed) {
          const updatedBlob = new Blob(
            [JSON.stringify(props, null, 2)],
            { type: "application/json" }
          );
          const newPropsSig = await store.putResource(updatedBlob);
          propsIndex[tileName] = newPropsSig;
        }
        done++;
        EffectBus10.emit("translation:tile-done", { label: tileName });
      }
      localStorage.setItem(PROPS_INDEX_KEY, JSON.stringify(propsIndex));
      EffectBus10.emit("translation:complete", { locale: targetLocale, translated: done });
      this.dispatchEvent(new CustomEvent("change"));
    } finally {
      this.#translating = false;
    }
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
  #loadCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
    } catch {
      return {};
    }
  }
  #saveCache() {
    localStorage.setItem(CACHE_KEY, JSON.stringify(this.#cache));
  }
};
var _translation = new TranslationService();
window.ioc.register("@diamondcoreprocessor.com/TranslationService", _translation);
export {
  AccentQueenBee,
  ArrangeQueenBee,
  DebugQueenBee,
  DomainQueenBee,
  EmptyLongPressInput,
  HelpQueenBee,
  KeywordQueenBee,
  LanguageQueenBee,
  PlayerQueenBee,
  RemoveQueenBee,
  RenameQueenBee,
  TranslationService
};
