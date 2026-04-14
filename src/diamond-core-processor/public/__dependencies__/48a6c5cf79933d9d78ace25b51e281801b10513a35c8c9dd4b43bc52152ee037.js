// @diamondcoreprocessor.com/keyboard
// src/diamondcoreprocessor.com/keyboard/default-keymap.ts
var globalKeyMap = {
  id: "global",
  priority: 0,
  bindings: [
    {
      cmd: "global.escape",
      sequence: [[{ key: "escape" }]],
      description: "Cancel / dismiss",
      descriptionKey: "keymap.escape",
      pierce: true
    },
    {
      cmd: "ui.shortcutSheet",
      sequence: [[{ key: "/" }]],
      description: "Show keyboard shortcuts",
      descriptionKey: "keymap.shortcuts",
      category: "Navigation"
    },
    {
      cmd: "ui.commandPalette",
      sequence: [[{ key: "k", primary: true }]],
      description: "Open command palette",
      descriptionKey: "keymap.palette",
      category: "Navigation",
      pierce: true
    },
    {
      cmd: "render.togglePivot",
      sequence: [[{ key: "8", code: "digit8", primary: true, shift: true }]],
      description: "Toggle hex orientation",
      descriptionKey: "keymap.pivot",
      category: "View",
      pierce: true
    },
    {
      cmd: "ui.commandLineToggle",
      sequence: [[{ key: "space", ctrl: true }]],
      description: "Toggle command line focus",
      descriptionKey: "keymap.command-line-toggle",
      category: "Navigation",
      pierce: true
    },
    {
      cmd: "mesh.togglePublic",
      sequence: [[{ key: "p", primary: true, shift: true }]],
      description: "Toggle public / private mode",
      descriptionKey: "keymap.mesh-toggle",
      category: "Mesh",
      pierce: true
    },
    {
      cmd: "render.toggleBees",
      sequence: [[{ key: "b", ctrl: true, shift: true }]],
      description: "Toggle bee avatars",
      descriptionKey: "keymap.bees",
      category: "View",
      pierce: true
    },
    {
      cmd: "navigation.fitToScreen",
      sequence: [[{ key: "0", primary: true }]],
      description: "Fit content to screen",
      descriptionKey: "keymap.fit",
      category: "Navigation",
      pierce: true
    }
  ]
};
var defaultKeyMap = {
  id: "default",
  priority: 10,
  bindings: [
    // Navigation
    {
      cmd: "navigation.moveUp",
      sequence: [[{ key: "arrowup" }]],
      description: "Navigate up",
      descriptionKey: "keymap.up",
      category: "Navigation"
    },
    {
      cmd: "navigation.moveDown",
      sequence: [[{ key: "arrowdown" }]],
      description: "Navigate down",
      descriptionKey: "keymap.down",
      category: "Navigation"
    },
    {
      cmd: "navigation.moveLeft",
      sequence: [[{ key: "arrowleft" }]],
      description: "Navigate left",
      descriptionKey: "keymap.left",
      category: "Navigation"
    },
    {
      cmd: "navigation.moveRight",
      sequence: [[{ key: "arrowright" }]],
      description: "Navigate right",
      descriptionKey: "keymap.right",
      category: "Navigation"
    },
    // Clipboard
    {
      cmd: "clipboard.copy",
      sequence: [[{ key: "c" }]],
      description: "Copy selected tiles",
      descriptionKey: "keymap.copy",
      category: "Clipboard"
    },
    {
      cmd: "clipboard.paste",
      sequence: [[{ key: "enter" }]],
      description: "Paste from clipboard",
      descriptionKey: "keymap.paste",
      category: "Clipboard"
    },
    {
      cmd: "layout.cutCells",
      sequence: [[{ key: "x" }]],
      description: "Cut selected tiles",
      descriptionKey: "keymap.cut",
      category: "Clipboard"
    },
    // Selection
    {
      cmd: "selection.toggleLeader",
      sequence: [[{ key: "space", ctrl: false }]],
      description: "Toggle leader tile in selection",
      descriptionKey: "keymap.toggleLeader",
      category: "Selection"
    },
    // Remove
    {
      cmd: "selection.remove",
      sequence: [[{ key: "delete" }], [{ key: "backspace" }]],
      description: "Remove selected tiles",
      descriptionKey: "keymap.remove",
      category: "Editing"
    }
  ]
};

// src/diamondcoreprocessor.com/keyboard/escape-cascade.ts
import { EffectBus } from "@hypercomb/core";
var editorActive = false;
var clipboardActive = false;
EffectBus.on("editor:mode", ({ active }) => {
  editorActive = active;
});
EffectBus.on("clipboard:view", ({ active }) => {
  clipboardActive = active;
});
EffectBus.on("keymap:invoke", ({ cmd }) => {
  if (cmd !== "global.escape") return;
  const focused = document.activeElement;
  if (focused instanceof HTMLInputElement && focused.classList.contains("command-input")) return;
  if (editorActive) {
    const drone = window.ioc.get("@diamondcoreprocessor.com/TileEditorDrone");
    drone?.cancelEditing();
    return;
  }
  const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
  const pixi = window.ioc.get("@diamondcoreprocessor.com/TileSelectionDrone");
  if (selection && selection.count > 0 || pixi && pixi.selectedAxialKeys.size > 0) {
    selection?.clear();
    pixi?.clearSelection();
    return;
  }
  if (clipboardActive) {
    EffectBus.emit("clipboard:close", void 0);
    return;
  }
  EffectBus.emit("global:escape", void 0);
});
window.addEventListener("contextmenu", (event) => {
  if (!clipboardActive) return;
  event.preventDefault();
  EffectBus.emit("clipboard:close", void 0);
});

// src/diamondcoreprocessor.com/keyboard/keymap.service.ts
import { EffectBus as EffectBus2, isMac } from "@hypercomb/core";
var SEQUENCE_TIMEOUT_MS = 500;
var KeyMapService = class extends EventTarget {
  // -------------------------------------------------
  // layer stack (context isolation)
  // -------------------------------------------------
  #layers = [];
  #effectiveCache = null;
  addLayer(layer) {
    this.removeLayer(layer.id);
    this.#layers.push(layer);
    this.#layers.sort((a, b) => a.priority - b.priority);
    this.#effectiveCache = null;
    this.#resetSequences();
    EffectBus2.emit("keymap:changed", void 0);
  }
  removeLayer(id) {
    const idx = this.#layers.findIndex((l) => l.id === id);
    if (idx === -1) return;
    this.#layers.splice(idx, 1);
    this.#effectiveCache = null;
    this.#resetSequences();
    EffectBus2.emit("keymap:changed", void 0);
  }
  getEffective() {
    if (this.#effectiveCache) return this.#effectiveCache;
    const byCmd = /* @__PURE__ */ new Map();
    for (const layer of this.#layers) {
      for (const b of layer.bindings) {
        byCmd.set(b.cmd, b);
      }
    }
    this.#effectiveCache = [...byCmd.values()];
    return this.#effectiveCache;
  }
  // -------------------------------------------------
  // suppression gate (mode isolation)
  // -------------------------------------------------
  #suppressions = /* @__PURE__ */ new Set();
  get suppressed() {
    return this.#suppressions.size > 0;
  }
  suppress(reason) {
    this.#suppressions.add(reason);
  }
  unsuppress(reason) {
    this.#suppressions.delete(reason);
  }
  // -------------------------------------------------
  // sequence state (chord tracking)
  // -------------------------------------------------
  #sequenceState = /* @__PURE__ */ new Map();
  #sequenceTimer = null;
  #resetSequences() {
    this.#sequenceState.clear();
    if (this.#sequenceTimer) {
      clearTimeout(this.#sequenceTimer);
      this.#sequenceTimer = null;
    }
  }
  #touchSequenceTimer() {
    if (this.#sequenceTimer) clearTimeout(this.#sequenceTimer);
    this.#sequenceTimer = setTimeout(() => {
      this.#sequenceState.clear();
      this.#sequenceTimer = null;
    }, SEQUENCE_TIMEOUT_MS);
  }
  // -------------------------------------------------
  // keyboard listener
  // -------------------------------------------------
  #navigationGuardTimer = null;
  constructor() {
    super();
    this.addLayer(globalKeyMap);
    this.addLayer(defaultKeyMap);
    window.addEventListener("keydown", this.#onKeyDown, { capture: true });
    EffectBus2.on("keymap:add-layer", ({ layer }) => {
      this.addLayer(layer);
    });
    EffectBus2.on("keymap:remove-layer", ({ id }) => {
      this.removeLayer(id);
    });
    EffectBus2.on("keymap:suppress", ({ reason }) => {
      this.suppress(reason);
    });
    EffectBus2.on("keymap:unsuppress", ({ reason }) => {
      this.unsuppress(reason);
    });
    EffectBus2.on("navigation:guard-start", () => {
      this.suppress("navigation-transition");
      if (this.#navigationGuardTimer) clearTimeout(this.#navigationGuardTimer);
      this.#navigationGuardTimer = setTimeout(() => {
        this.unsuppress("navigation-transition");
      }, 200);
    });
    EffectBus2.on("navigation:guard-end", () => {
      this.unsuppress("navigation-transition");
      if (this.#navigationGuardTimer) {
        clearTimeout(this.#navigationGuardTimer);
        this.#navigationGuardTimer = null;
      }
    });
  }
  // -------------------------------------------------
  // keydown handler
  // -------------------------------------------------
  #onKeyDown = (e) => {
    if (this.#isModifierOnly(e)) return;
    const isSuppressed = this.suppressed || this.#isInteractiveFocus();
    const bindings = this.getEffective();
    let anyAdvanced = false;
    let matched = false;
    for (const binding of bindings) {
      if (isSuppressed && !binding.pierce) {
        this.#sequenceState.delete(binding.cmd);
        continue;
      }
      const step = this.#sequenceState.get(binding.cmd) ?? 0;
      const chord = binding.sequence[step];
      if (!chord) {
        this.#sequenceState.delete(binding.cmd);
        continue;
      }
      if (this.#matchesChord(e, chord)) {
        if (step + 1 >= binding.sequence.length) {
          this.#sequenceState.delete(binding.cmd);
          matched = true;
          e.preventDefault();
          EffectBus2.emit("keymap:invoke", { cmd: binding.cmd, binding, event: e });
        } else {
          this.#sequenceState.set(binding.cmd, step + 1);
          anyAdvanced = true;
          e.preventDefault();
        }
      } else {
        if (this.#sequenceState.has(binding.cmd)) {
          this.#sequenceState.delete(binding.cmd);
        }
      }
    }
    if (anyAdvanced) {
      this.#touchSequenceTimer();
    } else if (matched) {
      if (this.#sequenceTimer) {
        clearTimeout(this.#sequenceTimer);
        this.#sequenceTimer = null;
      }
    }
  };
  // -------------------------------------------------
  // chord matching
  // -------------------------------------------------
  #matchesChord(e, chord) {
    return chord.every((k) => this.#matchesSingleKey(e, k));
  }
  #matchesSingleKey(e, k) {
    if (k.code) {
      if (e.code.toLowerCase() !== k.code) return false;
    } else {
      if (this.#normalize(e.key) !== k.key) return false;
    }
    if (k.ctrl !== void 0 && e.ctrlKey !== k.ctrl) return false;
    if (k.shift !== void 0 && e.shiftKey !== k.shift) return false;
    if (k.alt !== void 0 && e.altKey !== k.alt) return false;
    if (k.meta !== void 0 && e.metaKey !== k.meta) return false;
    if (k.primary !== void 0) {
      const actual = isMac ? e.metaKey : e.ctrlKey;
      if (actual !== k.primary) return false;
    }
    return true;
  }
  // -------------------------------------------------
  // helpers
  // -------------------------------------------------
  #normalize(key) {
    const k = key.toLowerCase();
    if (k === "control") return "ctrl";
    if (k === " ") return "space";
    return k;
  }
  #isModifierOnly(e) {
    const k = e.key.toLowerCase();
    return k === "control" || k === "shift" || k === "alt" || k === "meta";
  }
  #isInteractiveFocus() {
    const el = document.activeElement;
    if (!el) return false;
    return !!el.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]'
    );
  }
};
window.ioc.register("@diamondcoreprocessor.com/KeyMapService", new KeyMapService());
export {
  KeyMapService,
  defaultKeyMap,
  globalKeyMap
};
