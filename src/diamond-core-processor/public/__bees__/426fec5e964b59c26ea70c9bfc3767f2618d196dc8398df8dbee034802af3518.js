// src/diamondcoreprocessor.com/commands/slash-behaviour.drone.ts
import { EffectBus, hypercomb, I18N_IOC_KEY } from "@hypercomb/core";
var SlashBehaviourDrone = class extends EventTarget {
  #providers = [];
  addProvider(provider) {
    this.#providers.push(provider);
    this.#providers.sort((a, b) => b.priority - a.priority);
  }
  all() {
    const results = [];
    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const localized = this.#localize(behaviour);
        results.push(localized);
        for (const alias of behaviour.aliases ?? []) {
          results.push({ ...localized, name: alias });
        }
      }
    }
    return results;
  }
  match(query) {
    const q = query.toLowerCase().trim();
    const results = [];
    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const localized = this.#localize(behaviour);
        const names = [behaviour.name, ...behaviour.aliases ?? []];
        for (const name of names) {
          if (!q || name.startsWith(q)) {
            results.push({
              behaviour: name === behaviour.name ? localized : { ...localized, name },
              provider
            });
          }
        }
      }
    }
    return results;
  }
  #localize(behaviour) {
    if (!behaviour.descriptionKey) return behaviour;
    const i18n = get(I18N_IOC_KEY);
    if (!i18n) return behaviour;
    const translated = i18n.t(behaviour.descriptionKey);
    if (translated === behaviour.descriptionKey) return behaviour;
    return { ...behaviour, description: translated };
  }
  complete(behaviourName, args) {
    const name = behaviourName.toLowerCase().trim();
    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const names = [behaviour.name, ...behaviour.aliases ?? []];
        if (names.includes(name) && provider.complete) {
          return provider.complete(behaviour.name, args);
        }
      }
    }
    return [];
  }
  execute(behaviourName, args) {
    const name = behaviourName.toLowerCase().trim();
    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const names = [behaviour.name, ...behaviour.aliases ?? []];
        if (names.includes(name)) {
          return provider.execute(behaviour.name, args);
        }
      }
    }
  }
};
var HelpProvider = class {
  name = "help-provider";
  priority = 100;
  behaviours = [
    { name: "help", description: "Show keyboard shortcuts", descriptionKey: "slash.help" }
  ];
  execute() {
    EffectBus.emit("keymap:invoke", { cmd: "ui.shortcutSheet", binding: null, event: null });
  }
};
var ClearProvider = class {
  name = "clear-provider";
  priority = 100;
  behaviours = [
    { name: "clear", description: "Clear active filter", descriptionKey: "slash.clear" }
  ];
  execute() {
    EffectBus.emit("search:filter", { keyword: "" });
    void new hypercomb().act();
  }
};
var KeywordProvider = class {
  name = "keyword-provider";
  priority = 100;
  behaviours = [
    { name: "keyword", description: "Add or remove keywords (tags) on selected tiles", descriptionKey: "slash.keyword", aliases: ["kw", "tag"] }
  ];
  async execute(_behaviourName, args) {
    const queen = get("@diamondcoreprocessor.com/KeywordQueenBee");
    if (queen?.invoke) {
      await queen.invoke(args);
    }
  }
  complete(_behaviourName, args) {
    const registry = get("@hypercomb.social/TagRegistry");
    const tagNames = registry?.names ?? [];
    const q = args.toLowerCase().trim();
    const prefix = q.startsWith("~") ? q.slice(1) : q;
    if (!prefix) return tagNames;
    return tagNames.filter((t) => t.toLowerCase().startsWith(prefix));
  }
};
var MeetingProvider = class {
  name = "meeting-provider";
  priority = 100;
  behaviours = [
    { name: "meeting", description: "Start or join a video meeting on the selected tile", descriptionKey: "slash.meeting", aliases: ["meet", "call"] }
  ];
  async execute(_behaviourName, args) {
    const queen = get("@diamondcoreprocessor.com/MeetingQueenBee");
    if (queen?.invoke) {
      await queen.invoke(args);
    }
  }
};
var DebugProvider = class {
  name = "debug-provider";
  priority = 100;
  behaviours = [
    { name: "debug", description: "Toggle the Pixi display-tree inspector", descriptionKey: "slash.debug", aliases: ["inspect", "dbg"] }
  ];
  async execute() {
    const queen = get("@diamondcoreprocessor.com/DebugQueenBee");
    if (queen?.invoke) {
      await queen.invoke("");
    }
  }
};
var RemoveProvider = class {
  name = "remove-provider";
  priority = 100;
  behaviours = [
    { name: "remove", description: "Remove tiles from the current directory", descriptionKey: "slash.remove", aliases: ["rm", "delete", "del"] }
  ];
  async execute(_behaviourName, args) {
    const queen = get("@diamondcoreprocessor.com/RemoveQueenBee");
    if (queen?.invoke) {
      await queen.invoke(args);
    }
  }
  complete(_behaviourName, args) {
    const cellProvider = get("@hypercomb.social/CellSuggestionProvider");
    const cells = cellProvider?.suggestions() ?? [];
    const bracketStart = args.indexOf("[");
    if (bracketStart >= 0) {
      const inner = args.slice(bracketStart + 1);
      const lastComma = inner.lastIndexOf(",");
      const fragment = (lastComma >= 0 ? inner.slice(lastComma + 1) : inner).trimStart().toLowerCase();
      const already = /* @__PURE__ */ new Set();
      for (const item of inner.split(",")) {
        const n = item.trim().toLowerCase();
        if (n && n !== fragment) already.add(n);
      }
      let filtered = cells.filter((n) => !already.has(n));
      if (fragment) filtered = filtered.filter((n) => n.startsWith(fragment));
      return filtered;
    }
    const q = args.toLowerCase().trim();
    if (!q) return cells;
    return cells.filter((n) => n.startsWith(q));
  }
};
var FormatSlashProvider = class {
  name = "format-provider";
  priority = 100;
  behaviours = [
    { name: "format", description: "Copy visual formatting from the active tile", descriptionKey: "slash.format", aliases: ["fmt", "fp"] }
  ];
  async execute(_behaviourName, args) {
    const queen = get("@diamondcoreprocessor.com/FormatQueenBee");
    if (queen?.invoke) await queen.invoke(args);
  }
};
var LayoutProvider = class {
  name = "layout-provider";
  priority = 100;
  behaviours = [
    { name: "layout", description: "Save, apply, list, or remove layout templates", descriptionKey: "slash.layout", aliases: ["lo"] }
  ];
  async execute(_behaviourName, args) {
    const queen = get("@diamondcoreprocessor.com/LayoutQueenBee");
    if (queen?.invoke) await queen.invoke(args);
  }
  complete(_behaviourName, args) {
    const subcommands = ["save", "apply", "list", "remove"];
    const q = args.toLowerCase().trim();
    if (!q) return subcommands;
    return subcommands.filter((s) => s.startsWith(q));
  }
};
var AccentProvider = class {
  name = "accent-provider";
  priority = 100;
  behaviours = [
    { name: "accent", description: "Set the hover accent color by name", descriptionKey: "slash.accent", aliases: ["ac"] }
  ];
  async execute(_behaviourName, args) {
    const queen = get("@diamondcoreprocessor.com/AccentQueenBee");
    if (queen?.invoke) await queen.invoke(args);
  }
  complete(_behaviourName, args) {
    const presets = ["glacier", "bloom", "aurora", "ember", "nebula"];
    const registry = get("@hypercomb.social/TagRegistry");
    const tagNames = registry?.names ?? [];
    const bracketStart = args.indexOf("[");
    if (bracketStart >= 0) {
      const bracketClose = args.indexOf("]", bracketStart);
      if (bracketClose < 0) {
        const inner = args.slice(bracketStart + 1);
        const lastComma = inner.lastIndexOf(",");
        const fragment = (lastComma >= 0 ? inner.slice(lastComma + 1) : inner).trimStart().toLowerCase();
        const already = /* @__PURE__ */ new Set();
        for (const item of inner.split(",")) {
          const n = item.trim().toLowerCase();
          if (n && n !== fragment) already.add(n);
        }
        let tags = tagNames.filter((t) => !already.has(t.toLowerCase()));
        if (fragment) tags = tags.filter((t) => t.toLowerCase().startsWith(fragment));
        return tags;
      }
      const after = args.slice(bracketClose + 1).trimStart().toLowerCase();
      if (!after) return presets;
      return presets.filter((p) => p.startsWith(after));
    }
    const all = [...presets, ...tagNames.filter((t) => !presets.includes(t))];
    const parts = args.split(/\s+/);
    if (parts.length >= 2) {
      const q2 = parts[parts.length - 1].toLowerCase();
      if (!q2) return presets;
      return presets.filter((p) => p.startsWith(q2));
    }
    const q = args.toLowerCase().trim();
    if (!q) return all;
    return all.filter((n) => n.toLowerCase().startsWith(q));
  }
};
var MoveProvider = class {
  name = "move-provider";
  priority = 100;
  behaviours = [
    { name: "move", description: "Toggle move mode for drag-reordering tiles", descriptionKey: "slash.move" }
  ];
  async execute(_behaviourName, args) {
    const indexMatch = args.match(/\((\d+)\)/) || args.match(/\((\d+)$/);
    if (indexMatch) {
      const targetIndex = parseInt(indexMatch[1], 10);
      const selection = get("@diamondcoreprocessor.com/SelectionService");
      const labels = selection ? Array.from(selection.selected) : [];
      if (labels.length > 0) {
        const moveDrone = get("@diamondcoreprocessor.com/MoveDrone");
        if (moveDrone) {
          if (moveDrone.moveCommandActive) moveDrone.cancelCommandMove();
          moveDrone.beginCommandMove(labels);
          await moveDrone.commitCommandMoveAt(targetIndex);
        }
      }
      return;
    }
    EffectBus.emit("controls:action", { action: "move" });
  }
};
var ReviseProvider = class {
  name = "revise-provider";
  priority = 100;
  behaviours = [
    { name: "revise", description: "Toggle revision mode (history clock)", descriptionKey: "slash.revise", aliases: ["rev", "history"] }
  ];
  async execute(_behaviourName, args) {
    const queen = get("@diamondcoreprocessor.com/ReviseQueenBee");
    if (queen?.invoke) await queen.invoke(args);
  }
};
var ExpandProvider = class {
  name = "expand-provider";
  priority = 100;
  behaviours = [
    { name: "expand", description: "Expand selected tiles into constituent parts via Claude Haiku", descriptionKey: "slash.expand", aliases: ["atomize"] }
  ];
  async execute(_behaviourName, _args) {
    const selection = get("@diamondcoreprocessor.com/SelectionService");
    const targets = selection ? Array.from(selection.selected) : [];
    if (targets.length === 0) return;
    for (const label of targets) {
      EffectBus.emit("tile:action", { action: "expand", label, q: 0, r: 0, index: 0 });
    }
  }
};
var ChatProvider = class {
  name = "chat-provider";
  priority = 100;
  behaviours = [
    { name: "chat", description: "Multi-turn conversation with Claude", aliases: ["c", "ask"] }
  ];
  async execute(_behaviourName, args) {
    const queen = get("@diamondcoreprocessor.com/ConversationQueenBee");
    if (queen?.invoke) await queen.invoke(args);
  }
};
var LlmProvider = class {
  name = "llm-provider";
  priority = 100;
  behaviours = [
    { name: "opus", description: "Send context to Claude Opus 4.6", descriptionKey: "slash.opus", aliases: ["o"] },
    { name: "sonnet", description: "Send context to Claude Sonnet", descriptionKey: "slash.sonnet", aliases: ["s"] },
    { name: "haiku", description: "Send context to Claude Haiku", descriptionKey: "slash.haiku", aliases: ["h"] }
  ];
  async execute(behaviourName, args) {
    const queen = get("@diamondcoreprocessor.com/LlmQueenBee");
    if (queen) {
      queen.activeModel = behaviourName;
      await queen.invoke(args);
    }
  }
};
var LanguageProvider = class {
  name = "language-provider";
  priority = 100;
  behaviours = [
    { name: "language", description: "Switch the UI language", descriptionKey: "slash.language", aliases: ["lang", "locale"] }
  ];
  async execute(_behaviourName, args) {
    const queen = get("@diamondcoreprocessor.com/LanguageQueenBee");
    if (queen?.invoke) await queen.invoke(args);
  }
  complete(_behaviourName, args) {
    const locales = ["en", "ja"];
    const q = args.toLowerCase().trim();
    if (!q) return locales;
    return locales.filter((l) => l.startsWith(q));
  }
};
var ArrangeProvider = class {
  name = "arrange-provider";
  priority = 100;
  behaviours = [
    { name: "arrange", description: "Toggle icon arrangement mode on the tile overlay", descriptionKey: "slash.arrange" }
  ];
  async execute() {
    const queen = get("@diamondcoreprocessor.com/ArrangeQueenBee");
    if (queen?.invoke) await queen.invoke("");
  }
};
var VoiceProvider = class {
  name = "voice-provider";
  priority = 100;
  behaviours = [
    { name: "voice", description: "Toggle voice input (speech-to-text)", descriptionKey: "slash.voice" }
  ];
  async execute() {
    const svc = get("@hypercomb.social/VoiceInputService");
    svc?.toggle?.();
  }
};
var PushToTalkProvider = class {
  name = "push-to-talk-provider";
  priority = 100;
  behaviours = [
    { name: "push-to-talk", description: "Toggle push-to-talk mic button", descriptionKey: "slash.push-to-talk" }
  ];
  async execute() {
    const current = localStorage.getItem("hc:push-to-talk") === "true";
    const next = !current;
    localStorage.setItem("hc:push-to-talk", String(next));
    EffectBus.emit("push-to-talk:toggle", { enabled: next });
  }
};
var InstructionsProvider = class {
  name = "instructions-provider";
  priority = 100;
  behaviours = [
    { name: "instructions", description: "Toggle instruction overlay", descriptionKey: "slash.instructions", aliases: ["instruct", "labels"] }
  ];
  execute() {
    EffectBus.emit("instruction:toggle", void 0);
  }
};
var AtomizeUiProvider = class {
  name = "atomize-ui-provider";
  priority = 100;
  behaviours = [
    { name: "atomize-ui", description: "Toggle the atomizer toolbar", descriptionKey: "slash.atomize-ui", aliases: ["au", "atomizer"] }
  ];
  execute() {
    EffectBus.emit("atomizer-bar:toggle", { active: true });
  }
};
var DocsProvider = class {
  name = "docs-provider";
  priority = 100;
  behaviours = [
    { name: "docs", description: "Browse project documentation", descriptionKey: "slash.docs", aliases: ["documentation", "doc"] }
  ];
  execute(_behaviourName, args) {
    EffectBus.emit("docs:open", { page: args.trim() || "" });
  }
};
var SubstrateProvider = class {
  name = "substrate-provider";
  priority = 100;
  behaviours = [
    { name: "substrate", description: "Manage default background images for new tiles", descriptionKey: "slash.substrate", aliases: ["sub"] }
  ];
  async execute(_behaviourName, args) {
    const queen = get("@diamondcoreprocessor.com/SubstrateQueenBee");
    if (queen?.invoke) await queen.invoke(args);
  }
  complete(_behaviourName, args) {
    const subcommands = ["set", "global", "clear", "off", "on"];
    const q = args.toLowerCase().trim();
    if (!q) return subcommands;
    if (q === "clear" || q === "clear ") return ["global"];
    if (q.startsWith("clear ")) {
      const mod = q.slice(6).trim();
      return mod ? ["global"].filter((s) => s.startsWith(mod)) : ["global"];
    }
    return subcommands.filter((s) => s.startsWith(q));
  }
};
var _slashBehaviours = new SlashBehaviourDrone();
_slashBehaviours.addProvider(new HelpProvider());
_slashBehaviours.addProvider(new ClearProvider());
_slashBehaviours.addProvider(new KeywordProvider());
_slashBehaviours.addProvider(new MeetingProvider());
_slashBehaviours.addProvider(new DebugProvider());
_slashBehaviours.addProvider(new RemoveProvider());
_slashBehaviours.addProvider(new FormatSlashProvider());
_slashBehaviours.addProvider(new LayoutProvider());
_slashBehaviours.addProvider(new AccentProvider());
_slashBehaviours.addProvider(new MoveProvider());
_slashBehaviours.addProvider(new ReviseProvider());
_slashBehaviours.addProvider(new ExpandProvider());
_slashBehaviours.addProvider(new ChatProvider());
_slashBehaviours.addProvider(new LlmProvider());
_slashBehaviours.addProvider(new LanguageProvider());
_slashBehaviours.addProvider(new ArrangeProvider());
_slashBehaviours.addProvider(new VoiceProvider());
_slashBehaviours.addProvider(new PushToTalkProvider());
_slashBehaviours.addProvider(new InstructionsProvider());
_slashBehaviours.addProvider(new AtomizeUiProvider());
_slashBehaviours.addProvider(new DocsProvider());
_slashBehaviours.addProvider(new SubstrateProvider());
window.ioc.register("@diamondcoreprocessor.com/SlashBehaviourDrone", _slashBehaviours);
export {
  SlashBehaviourDrone
};
