// hypercomb-essentials/src/diamondcoreprocessor.com/commands/command-palette.drone.ts
import { EffectBus } from "@hypercomb/core";
var RECENT_KEY = "hc:recent-commands";
var MAX_RECENT = 8;
var CommandPaletteDrone = class extends EventTarget {
  #open = false;
  #query = "";
  #activeIndex = 0;
  #groups = [];
  #totalCount = 0;
  #recent = [];
  constructor() {
    super();
    try {
      this.#recent = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    } catch {
      this.#recent = [];
    }
    EffectBus.on("keymap:invoke", (payload) => {
      if (payload?.cmd === "ui.commandPalette") this.#toggle();
    });
    EffectBus.on("command-palette:input", (payload) => {
      if (!this.#open) return;
      this.#query = payload?.query ?? "";
      this.#activeIndex = 0;
      this.#rebuild();
      this.#emit();
    });
    EffectBus.on("command-palette:nav", (payload) => {
      if (!this.#open) return;
      if (payload?.direction === "up") {
        this.#activeIndex = Math.max(0, this.#activeIndex - 1);
      } else if (payload?.direction === "down") {
        this.#activeIndex = Math.min(this.#totalCount - 1, this.#activeIndex + 1);
      }
      this.#emit();
    });
    EffectBus.on("command-palette:execute", () => {
      if (!this.#open) return;
      this.#executeCurrent();
    });
    EffectBus.on("command-palette:execute-at", (payload) => {
      if (!this.#open || payload?.index == null) return;
      this.#activeIndex = payload.index;
      this.#executeCurrent();
    });
    EffectBus.on("command-palette:close", () => {
      if (this.#open) this.#close();
    });
  }
  get state() {
    return {
      open: this.#open,
      query: this.#query,
      activeIndex: this.#activeIndex,
      groups: this.#groups,
      totalCount: this.#totalCount
    };
  }
  #toggle() {
    if (this.#open) this.#close();
    else this.#openPalette();
  }
  #openPalette() {
    this.#open = true;
    this.#query = "";
    this.#activeIndex = 0;
    EffectBus.emit("keymap:suppress", { reason: "command-palette" });
    this.#rebuild();
    this.#emit();
  }
  #close() {
    this.#open = false;
    this.#query = "";
    this.#groups = [];
    this.#totalCount = 0;
    EffectBus.emit("keymap:unsuppress", { reason: "command-palette" });
    this.#emit();
  }
  #executeCurrent() {
    let item = null;
    for (const g of this.#groups) {
      for (const i of g.items) {
        if (i.globalIndex === this.#activeIndex) {
          item = i;
          break;
        }
      }
      if (item) break;
    }
    if (!item) return;
    this.#addRecent(item.id);
    this.#close();
    if (item.binding) {
      EffectBus.emit("keymap:invoke", { cmd: item.id, binding: item.binding, event: null });
    }
  }
  #addRecent(cmd) {
    this.#recent = [cmd, ...this.#recent.filter((c) => c !== cmd)].slice(0, MAX_RECENT);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.#recent));
    } catch {
    }
  }
  #rebuild() {
    const keymap = get("@diamondcoreprocessor.com/KeyMapService");
    const bindings = keymap?.getEffective?.() ?? [];
    let items = bindings.filter((b) => !!b.description && b.cmd !== "ui.commandPalette").map((b) => ({
      id: b.cmd,
      label: b.description,
      category: b.category ?? "Other",
      type: "command",
      binding: b,
      matchIndices: [],
      score: 0,
      globalIndex: 0
    }));
    if (this.#query) {
      items = items.map((item) => {
        const result = fuzzyMatch(this.#query, item.label);
        if (!result) return null;
        return { ...item, matchIndices: result.indices, score: result.score };
      }).filter((item) => item !== null).sort((a, b) => b.score - a.score);
    }
    const grouped = /* @__PURE__ */ new Map();
    if (!this.#query) {
      const recentItems = this.#recent.map((cmd) => items.find((i) => i.id === cmd)).filter((i) => !!i).map((i) => ({ ...i, type: "recent", category: "Recent" }));
      if (recentItems.length) grouped.set("Recent", recentItems);
      const recentIds = new Set(this.#recent);
      for (const item of items) {
        if (recentIds.has(item.id) && grouped.has("Recent")) continue;
        const arr = grouped.get(item.category) ?? [];
        arr.push(item);
        grouped.set(item.category, arr);
      }
    } else {
      for (const item of items) {
        const arr = grouped.get(item.category) ?? [];
        arr.push(item);
        grouped.set(item.category, arr);
      }
    }
    let idx = 0;
    const groups = [];
    for (const [category, categoryItems] of grouped) {
      const indexedItems = categoryItems.map((item) => ({ ...item, globalIndex: idx++ }));
      groups.push({ category, items: indexedItems });
    }
    this.#groups = groups;
    this.#totalCount = idx;
  }
  #emit() {
    this.dispatchEvent(new Event("change"));
    EffectBus.emit("command-palette:state", this.state);
  }
};
function fuzzyMatch(query, target) {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const indices = [];
  let qi = 0;
  let score = 0;
  let lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      if (lastIdx === ti - 1) score += 3;
      if (ti === 0 || t[ti - 1] === " " || t[ti - 1] === "-" || t[ti - 1] === "_") score += 2;
      score += 1;
      lastIdx = ti;
      qi++;
    }
  }
  if (qi < q.length) return null;
  score += Math.max(0, 10 - (t.length - q.length));
  return { score, indices };
}
var _commandPalette = new CommandPaletteDrone();
window.ioc.register("@diamondcoreprocessor.com/CommandPaletteDrone", _commandPalette);
export {
  CommandPaletteDrone
};
