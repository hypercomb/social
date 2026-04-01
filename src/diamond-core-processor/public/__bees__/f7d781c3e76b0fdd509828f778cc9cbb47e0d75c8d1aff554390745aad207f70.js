// src/diamondcoreprocessor.com/commands/slash-command.drone.ts
import { EffectBus, hypercomb, I18N_IOC_KEY } from "@hypercomb/core";
var SlashCommandDrone = class extends EventTarget {
  #providers = [];
  addProvider(provider) {
    this.#providers.push(provider);
    this.#providers.sort((a, b) => b.priority - a.priority);
  }
  all() {
    return this.#providers.flatMap((p) => p.commands).map((c) => this.#localize(c));
  }
  match(query) {
    const q = query.toLowerCase().trim();
    const results = [];
    for (const provider of this.#providers) {
      for (const command of provider.commands) {
        const names = [command.name, ...command.aliases ?? []];
        if (!q || names.some((n) => n.startsWith(q))) {
          results.push({ command: this.#localize(command), provider });
        }
      }
    }
    return results;
  }
  #localize(command) {
    if (!command.descriptionKey) return command;
    const i18n = get(I18N_IOC_KEY);
    if (!i18n) return command;
    const translated = i18n.t(command.descriptionKey);
    if (translated === command.descriptionKey) return command;
    return { ...command, description: translated };
  }
  execute(commandName, args) {
    const name = commandName.toLowerCase().trim();
    for (const provider of this.#providers) {
      for (const command of provider.commands) {
        const names = [command.name, ...command.aliases ?? []];
        if (names.includes(name)) {
          return provider.execute(command.name, args);
        }
      }
    }
  }
};
var HelpProvider = class {
  name = "help-provider";
  priority = 100;
  commands = [
    { name: "help", description: "Show keyboard shortcuts", descriptionKey: "slash.help" }
  ];
  execute() {
    EffectBus.emit("keymap:invoke", { cmd: "ui.shortcutSheet", binding: null, event: null });
  }
};
var ClearProvider = class {
  name = "clear-provider";
  priority = 100;
  commands = [
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
  commands = [
    { name: "keyword", description: "Add or remove keywords (tags) on selected tiles", descriptionKey: "slash.keyword", aliases: ["kw", "tag"] }
  ];
  async execute(_commandName, args) {
    const queen = get("@diamondcoreprocessor.com/KeywordQueenBee");
    if (queen?.invoke) {
      await queen.invoke(args);
    }
  }
};
var MeetingProvider = class {
  name = "meeting-provider";
  priority = 100;
  commands = [
    { name: "meeting", description: "Start or join a video meeting on the selected tile", descriptionKey: "slash.meeting", aliases: ["meet", "call"] }
  ];
  async execute(_commandName, args) {
    const queen = get("@diamondcoreprocessor.com/MeetingQueenBee");
    if (queen?.invoke) {
      await queen.invoke(args);
    }
  }
};
var DebugProvider = class {
  name = "debug-provider";
  priority = 100;
  commands = [
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
  commands = [
    { name: "remove", description: "Remove tiles from the current directory", descriptionKey: "slash.remove", aliases: ["rm"] }
  ];
  async execute(_commandName, args) {
    const queen = get("@diamondcoreprocessor.com/RemoveQueenBee");
    if (queen?.invoke) {
      await queen.invoke(args);
    }
  }
};
var FormatSlashProvider = class {
  name = "format-provider";
  priority = 100;
  commands = [
    { name: "format", description: "Copy visual formatting from the active tile", descriptionKey: "slash.format", aliases: ["fmt", "fp"] }
  ];
  async execute(_commandName, args) {
    const queen = get("@diamondcoreprocessor.com/FormatQueenBee");
    if (queen?.invoke) await queen.invoke(args);
  }
};
var LayoutProvider = class {
  name = "layout-provider";
  priority = 100;
  commands = [
    { name: "layout", description: "Save, apply, list, or remove layout templates", descriptionKey: "slash.layout", aliases: ["lo"] }
  ];
  async execute(_commandName, args) {
    const queen = get("@diamondcoreprocessor.com/LayoutQueenBee");
    if (queen?.invoke) await queen.invoke(args);
  }
};
var NeonProvider = class {
  name = "neon-provider";
  priority = 100;
  commands = [
    { name: "neon", description: "Toggle the neon hover color toolbar", descriptionKey: "slash.neon" }
  ];
  execute() {
    EffectBus.emit("neon:toggle-toolbar", {});
  }
};
var MoveProvider = class {
  name = "move-provider";
  priority = 100;
  commands = [
    { name: "move", description: "Toggle move mode for drag-reordering tiles", descriptionKey: "slash.move" }
  ];
  async execute(_commandName, args) {
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
  commands = [
    { name: "revise", description: "Toggle revision mode (history clock)", descriptionKey: "slash.revise", aliases: ["rev", "history"] }
  ];
  async execute(_commandName, args) {
    const queen = get("@diamondcoreprocessor.com/ReviseQueenBee");
    if (queen?.invoke) await queen.invoke(args);
  }
};
var ExpandProvider = class {
  name = "expand-provider";
  priority = 100;
  commands = [
    { name: "expand", description: "Expand selected tiles into constituent parts via Claude Haiku", descriptionKey: "slash.expand", aliases: ["atomize"] }
  ];
  async execute(_commandName, _args) {
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
  commands = [
    { name: "chat", description: "Multi-turn conversation with Claude", aliases: ["c", "ask"] }
  ];
  async execute(_commandName, args) {
    const queen = get("@diamondcoreprocessor.com/ConversationQueenBee");
    if (queen?.invoke) await queen.invoke(args);
  }
};
var LlmProvider = class {
  name = "llm-provider";
  priority = 100;
  commands = [
    { name: "opus", description: "Send context to Claude Opus 4.6", descriptionKey: "slash.opus", aliases: ["o"] },
    { name: "sonnet", description: "Send context to Claude Sonnet", descriptionKey: "slash.sonnet", aliases: ["s"] },
    { name: "haiku", description: "Send context to Claude Haiku", descriptionKey: "slash.haiku", aliases: ["h"] }
  ];
  async execute(commandName, args) {
    const queen = get("@diamondcoreprocessor.com/LlmQueenBee");
    if (queen) {
      queen.activeModel = commandName;
      await queen.invoke(args);
    }
  }
};
var LanguageProvider = class {
  name = "language-provider";
  priority = 100;
  commands = [
    { name: "language", description: "Switch the UI language", descriptionKey: "slash.language", aliases: ["lang", "locale"] }
  ];
  async execute(_commandName, args) {
    const queen = get("@diamondcoreprocessor.com/LanguageQueenBee");
    if (queen?.invoke) await queen.invoke(args);
  }
};
var ArrangeProvider = class {
  name = "arrange-provider";
  priority = 100;
  commands = [
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
  commands = [
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
  commands = [
    { name: "push-to-talk", description: "Toggle push-to-talk mic button", descriptionKey: "slash.push-to-talk" }
  ];
  async execute() {
    const current = localStorage.getItem("hc:push-to-talk") === "true";
    const next = !current;
    localStorage.setItem("hc:push-to-talk", String(next));
    EffectBus.emit("push-to-talk:toggle", { enabled: next });
  }
};
var AtomizeUiProvider = class {
  name = "atomize-ui-provider";
  priority = 100;
  commands = [
    { name: "atomize-ui", description: "Toggle the atomizer toolbar", descriptionKey: "slash.atomize-ui", aliases: ["au", "atomizer"] }
  ];
  execute() {
    EffectBus.emit("atomizer-bar:toggle", { active: true });
  }
};
var _slashCommands = new SlashCommandDrone();
_slashCommands.addProvider(new HelpProvider());
_slashCommands.addProvider(new ClearProvider());
_slashCommands.addProvider(new KeywordProvider());
_slashCommands.addProvider(new MeetingProvider());
_slashCommands.addProvider(new DebugProvider());
_slashCommands.addProvider(new RemoveProvider());
_slashCommands.addProvider(new FormatSlashProvider());
_slashCommands.addProvider(new LayoutProvider());
_slashCommands.addProvider(new NeonProvider());
_slashCommands.addProvider(new MoveProvider());
_slashCommands.addProvider(new ReviseProvider());
_slashCommands.addProvider(new ExpandProvider());
_slashCommands.addProvider(new ChatProvider());
_slashCommands.addProvider(new LlmProvider());
_slashCommands.addProvider(new LanguageProvider());
_slashCommands.addProvider(new ArrangeProvider());
_slashCommands.addProvider(new VoiceProvider());
_slashCommands.addProvider(new PushToTalkProvider());
_slashCommands.addProvider(new AtomizeUiProvider());
window.ioc.register("@diamondcoreprocessor.com/SlashCommandDrone", _slashCommands);
export {
  SlashCommandDrone
};
