// @diamondcoreprocessor.com/commands
// src/diamondcoreprocessor.com/commands/arrange.queen.ts
import { QueenBee, EffectBus } from "@hypercomb/core";
var ArrangeQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  command = "arrange";
  description = "Toggle icon arrangement mode on the tile overlay";
  #active = false;
  execute() {
    this.#active = !this.#active;
    EffectBus.emit("overlay:arrange-mode", { active: this.#active });
  }
};
var _arrange = new ArrangeQueenBee();
window.ioc.register("@diamondcoreprocessor.com/ArrangeQueenBee", _arrange);

// src/diamondcoreprocessor.com/commands/debug.queen.ts
import { QueenBee as QueenBee2, EffectBus as EffectBus2 } from "@hypercomb/core";
var DebugQueenBee = class extends QueenBee2 {
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
      EffectBus2.emit("queen:debug", { active: dbg.active });
    } else {
      console.warn("[debug] PixiDebugDrone not loaded \u2014 no __pixiDebug on window");
      EffectBus2.emit("queen:debug", { active: false, error: "not-loaded" });
    }
  }
};
var _debug = new DebugQueenBee();
window.ioc.register("@diamondcoreprocessor.com/DebugQueenBee", _debug);

// src/diamondcoreprocessor.com/commands/help.queen.ts
import { QueenBee as QueenBee3, EffectBus as EffectBus3 } from "@hypercomb/core";
var HelpQueenBee = class extends QueenBee3 {
  namespace = "diamondcoreprocessor.com";
  command = "help";
  aliases = ["?", "commands"];
  description = "List all available queen bee commands";
  execute(_args) {
    const queens = this.#findQueenBees();
    if (queens.length === 0) {
      EffectBus3.emit("queen:help", { commands: [] });
      console.log("[/help] No queen bees registered.");
      return;
    }
    const commands = queens.map((q) => ({
      command: q.command,
      aliases: q.aliases,
      description: q.description ?? ""
    }));
    EffectBus3.emit("queen:help", { commands });
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
import { QueenBee as QueenBee4, EffectBus as EffectBus4, hypercomb } from "@hypercomb/core";
var KeywordQueenBee = class extends QueenBee4 {
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
              const props = await readProps(seedDir);
              const tags = Array.isArray(props["tags"]) ? props["tags"] : [];
              if (op.remove) {
                const idx = tags.indexOf(op.tag);
                if (idx >= 0) {
                  tags.splice(idx, 1);
                  await writeProps(seedDir, { tags });
                }
              } else {
                if (!tags.includes(op.tag)) {
                  tags.push(op.tag);
                  await writeProps(seedDir, { tags });
                }
              }
              updates.push({ seed: label, tag: op.tag, color: op.color });
            } catch {
            }
          }
        }
        if (updates.length > 0) {
          EffectBus4.emit("tags:changed", { updates });
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
    void new hypercomb().act();
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
  const existing = await readProps(seedDir);
  const merged = { ...existing, ...updates };
  const fh = await seedDir.getFileHandle(PROPS_FILE, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(merged));
  await writable.close();
}
var _keyword = new KeywordQueenBee();
window.ioc.register("@diamondcoreprocessor.com/KeywordQueenBee", _keyword);

// src/diamondcoreprocessor.com/commands/language.queen.ts
import { QueenBee as QueenBee5, I18N_IOC_KEY } from "@hypercomb/core";
var LanguageQueenBee = class extends QueenBee5 {
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

// src/diamondcoreprocessor.com/commands/neon.queen.ts
import { QueenBee as QueenBee6, EffectBus as EffectBus5 } from "@hypercomb/core";
var NeonQueenBee = class extends QueenBee6 {
  namespace = "diamondcoreprocessor.com";
  command = "neon";
  description = "Toggle the neon hover color toolbar";
  execute() {
    EffectBus5.emit("neon:toggle-toolbar", {});
  }
};
var _neon = new NeonQueenBee();
window.ioc.register("@diamondcoreprocessor.com/NeonQueenBee", _neon);

// src/diamondcoreprocessor.com/commands/remove.queen.ts
import { QueenBee as QueenBee7, EffectBus as EffectBus6, hypercomb as hypercomb2 } from "@hypercomb/core";
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
    void new hypercomb2().act();
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
  ArrangeQueenBee,
  DebugQueenBee,
  HelpQueenBee,
  KeywordQueenBee,
  LanguageQueenBee,
  NeonQueenBee,
  RemoveQueenBee
};
