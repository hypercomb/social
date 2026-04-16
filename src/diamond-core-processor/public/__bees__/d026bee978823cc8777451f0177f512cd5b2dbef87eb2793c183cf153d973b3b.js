// src/diamondcoreprocessor.com/commands/shortcut-sheet.drone.ts
import { EffectBus } from "@hypercomb/core";
var CATEGORY_ORDER = [
  "Navigation",
  "Clipboard",
  "View"
];
var ShortcutSheetDrone = class extends EventTarget {
  #open = false;
  #slashCommands = [];
  #commandLineOps = [];
  #shortcutGroups = [];
  constructor() {
    super();
    EffectBus.on("keymap:invoke", (payload) => {
      if (payload?.cmd === "ui.shortcutSheet") this.#toggle();
    });
    EffectBus.on("shortcut-sheet:close", () => {
      if (this.#open) this.#close();
    });
  }
  get state() {
    return {
      open: this.#open,
      slashCommands: this.#slashCommands,
      commandLineOps: this.#commandLineOps,
      shortcutGroups: this.#shortcutGroups
    };
  }
  #toggle() {
    if (this.#open) this.#close();
    else this.#openSheet();
  }
  #openSheet() {
    this.#open = true;
    this.#slashCommands = this.#buildSlashCommands();
    this.#commandLineOps = this.#buildCommandLineOps();
    this.#shortcutGroups = this.#buildShortcutGroups();
    EffectBus.emit("keymap:suppress", { reason: "shortcut-sheet" });
    this.#emit();
  }
  #close() {
    this.#open = false;
    EffectBus.emit("keymap:unsuppress", { reason: "shortcut-sheet" });
    this.#emit();
  }
  #buildSlashCommands() {
    const drone = get("@diamondcoreprocessor.com/SlashBehaviourDrone");
    if (!drone) return [];
    return drone.entries().map((b) => ({
      name: b.name,
      aliases: b.aliases ?? [],
      description: b.description
    })).sort((a, b) => a.name.localeCompare(b.name));
  }
  #buildCommandLineOps() {
    const reference = get("@hypercomb.social/CommandLineBehaviors");
    if (!reference) return [];
    const entries = [];
    for (const behavior of reference) {
      for (const op of behavior.operations) {
        const first = op.examples[0];
        entries.push({
          behavior: behavior.name,
          trigger: op.trigger,
          description: op.description,
          example: first ? { input: first.input, result: first.result } : void 0
        });
      }
    }
    return entries;
  }
  #buildShortcutGroups() {
    const keymap = get("@diamondcoreprocessor.com/KeyMapService");
    if (!keymap) return [];
    const bindings = keymap.getEffective?.() ?? [];
    const grouped = /* @__PURE__ */ new Map();
    const exclude = /* @__PURE__ */ new Set(["ui.shortcutSheet", "ui.commandPalette"]);
    for (const b of bindings) {
      if (!b.description) continue;
      if (exclude.has(b.cmd)) continue;
      const cat = b.category ?? "Other";
      const arr = grouped.get(cat) ?? [];
      arr.push(b);
      grouped.set(cat, arr);
    }
    const result = [];
    for (const cat of CATEGORY_ORDER) {
      const binds = grouped.get(cat);
      if (binds?.length) result.push({ category: cat, bindings: binds });
      grouped.delete(cat);
    }
    for (const [cat, binds] of grouped) {
      if (binds.length) result.push({ category: cat, bindings: binds });
    }
    return result;
  }
  #emit() {
    this.dispatchEvent(new Event("change"));
    EffectBus.emit("shortcut-sheet:state", this.state);
  }
};
var _shortcutSheet = new ShortcutSheetDrone();
window.ioc.register("@diamondcoreprocessor.com/ShortcutSheetDrone", _shortcutSheet);
export {
  ShortcutSheetDrone
};
