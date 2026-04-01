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
  aliases = ["ac"];
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
        const seedDir = await dir.getDirectoryHandle(label, { create: true });
        const props = await readProps(seedDir);
        props["accent"] = presetName;
        await writeProps(seedDir, props);
      } catch {
      }
    }
    void new hypercomb().act();
  }
};
var PROPS_FILE = "0000";
async function readProps(seedDir) {
  try {
    const fh = await seedDir.getFileHandle(PROPS_FILE);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch {
    return {};
  }
}
async function writeProps(seedDir, updates) {
  const fh = await seedDir.getFileHandle(PROPS_FILE, { create: true });
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

// src/diamondcoreprocessor.com/commands/debug.queen.ts
import { QueenBee as QueenBee3, EffectBus as EffectBus3 } from "@hypercomb/core";
var DebugQueenBee = class extends QueenBee3 {
  namespace = "diamondcoreprocessor.com";
  command = "debug";
  aliases = ["inspect", "dbg"];
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

// src/diamondcoreprocessor.com/commands/help.queen.ts
import { QueenBee as QueenBee4, EffectBus as EffectBus4 } from "@hypercomb/core";
var HelpQueenBee = class extends QueenBee4 {
  namespace = "diamondcoreprocessor.com";
  command = "help";
  aliases = ["?", "commands"];
  description = "List all available queen bee commands";
  execute(_args) {
    const queens = this.#findQueenBees();
    if (queens.length === 0) {
      EffectBus4.emit("queen:help", { commands: [] });
      console.log("[/help] No queen bees registered.");
      return;
    }
    const commands = queens.map((q) => ({
      command: q.command,
      aliases: q.aliases,
      description: q.description ?? ""
    }));
    EffectBus4.emit("queen:help", { commands });
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

// src/diamondcoreprocessor.com/commands/keyword.queen.ts
import { QueenBee as QueenBee5, EffectBus as EffectBus5, hypercomb as hypercomb2 } from "@hypercomb/core";
var KeywordQueenBee = class extends QueenBee5 {
  namespace = "diamondcoreprocessor.com";
  command = "keyword";
  aliases = ["kw", "tag"];
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
              const seedDir = await dir.getDirectoryHandle(label, { create: true });
              const props = await readProps2(seedDir);
              const tags = Array.isArray(props["tags"]) ? props["tags"] : [];
              if (op.remove) {
                const idx = tags.indexOf(op.tag);
                if (idx >= 0) {
                  tags.splice(idx, 1);
                  await writeProps2(seedDir, { tags });
                }
              } else {
                if (!tags.includes(op.tag)) {
                  tags.push(op.tag);
                  await writeProps2(seedDir, { tags });
                }
              }
              updates.push({ seed: label, tag: op.tag, color: op.color });
            } catch {
            }
          }
        }
        if (updates.length > 0) {
          EffectBus5.emit("tags:changed", { updates });
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
async function readProps2(seedDir) {
  try {
    const fh = await seedDir.getFileHandle(PROPS_FILE2);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch {
    return {};
  }
}
async function writeProps2(seedDir, updates) {
  const existing = await readProps2(seedDir);
  const merged = { ...existing, ...updates };
  const fh = await seedDir.getFileHandle(PROPS_FILE2, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(merged));
  await writable.close();
}
var _keyword = new KeywordQueenBee();
window.ioc.register("@diamondcoreprocessor.com/KeywordQueenBee", _keyword);

// src/diamondcoreprocessor.com/commands/language.queen.ts
import { QueenBee as QueenBee6, I18N_IOC_KEY } from "@hypercomb/core";
var LanguageQueenBee = class extends QueenBee6 {
  namespace = "diamondcoreprocessor.com";
  command = "language";
  aliases = ["lang", "locale"];
  description = "Switch the UI language \u2014 /language en, /language ja";
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
  "en-us": "en"
};
var _language = new LanguageQueenBee();
window.ioc.register("@diamondcoreprocessor.com/LanguageQueenBee", _language);

// src/diamondcoreprocessor.com/commands/remove.queen.ts
import { QueenBee as QueenBee7, EffectBus as EffectBus6, hypercomb as hypercomb3 } from "@hypercomb/core";
var RemoveQueenBee = class extends QueenBee7 {
  namespace = "diamondcoreprocessor.com";
  command = "remove";
  aliases = ["rm"];
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
        EffectBus6.emit("seed:removed", { seed: name, groupId });
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
EffectBus6.on("controls:action", (payload) => {
  if (payload?.action === "remove") void _remove.invoke("");
});
EffectBus6.on("keymap:invoke", (payload) => {
  if (payload?.cmd === "selection.remove") void _remove.invoke("");
});
export {
  AccentQueenBee,
  ArrangeQueenBee,
  DebugQueenBee,
  HelpQueenBee,
  KeywordQueenBee,
  LanguageQueenBee,
  RemoveQueenBee
};
