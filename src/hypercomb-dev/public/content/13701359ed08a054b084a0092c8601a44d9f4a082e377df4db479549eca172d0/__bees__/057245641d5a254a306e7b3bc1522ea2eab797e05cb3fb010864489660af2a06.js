// src/diamondcoreprocessor.com/commands/slash-command.drone.ts
import { EffectBus, hypercomb } from "@hypercomb/core";
var SlashCommandDrone = class extends EventTarget {
  #providers = [];
  addProvider(provider) {
    this.#providers.push(provider);
    this.#providers.sort((a, b) => b.priority - a.priority);
  }
  all() {
    return this.#providers.flatMap((p) => p.commands);
  }
  match(query) {
    const q = query.toLowerCase().trim();
    const results = [];
    for (const provider of this.#providers) {
      for (const command of provider.commands) {
        const names = [command.name, ...command.aliases ?? []];
        if (!q || names.some((n) => n.startsWith(q))) {
          results.push({ command, provider });
        }
      }
    }
    return results;
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
    { name: "help", description: "Show keyboard shortcuts" }
  ];
  execute() {
    EffectBus.emit("keymap:invoke", { cmd: "ui.shortcutSheet", binding: null, event: null });
  }
};
var ClearProvider = class {
  name = "clear-provider";
  priority = 100;
  commands = [
    { name: "clear", description: "Clear active filter" }
  ];
  execute() {
    EffectBus.emit("search:filter", { keyword: "" });
    void new hypercomb().act();
  }
};
var _slashCommands = new SlashCommandDrone();
_slashCommands.addProvider(new HelpProvider());
_slashCommands.addProvider(new ClearProvider());
window.ioc.register("@diamondcoreprocessor.com/SlashCommandDrone", _slashCommands);
export {
  SlashCommandDrone
};
