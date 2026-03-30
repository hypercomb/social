// src/diamondcoreprocessor.com/history/history-slider.drone.ts
import { EffectBus } from "@hypercomb/core";
var HistorySliderDrone = class {
  #clock = null;
  #timeLabel = null;
  #restoreBtn = null;
  #posLabel = null;
  #visible = false;
  #reviseActive = false;
  #state = { locationSig: "", position: 0, total: 0, rewound: false, at: 0 };
  constructor() {
    EffectBus.on("history:cursor-changed", (state) => {
      this.#state = state;
      this.#syncUI();
    });
    EffectBus.on("revise:mode-changed", ({ active }) => {
      this.#reviseActive = active;
      this.#syncUI();
    });
    EffectBus.on("keymap:invoke", ({ cmd }) => {
      if (cmd === "history.undo") this.#undo();
      if (cmd === "history.redo") this.#redo();
      if (cmd === "history.exit-revise") this.#exitRevise();
    });
    this.#registerKeybindings();
    this.#buildClock();
  }
  // ── keybindings ──────────────────────────────────────────────
  #registerKeybindings() {
    const layer = {
      id: "history",
      priority: 5,
      bindings: [
        {
          cmd: "history.undo",
          sequence: [[{ key: "z", primary: true }]],
          description: "Undo (step back in history)",
          category: "History",
          pierce: true
        },
        {
          cmd: "history.redo",
          sequence: [[{ key: "y", primary: true }]],
          description: "Redo (step forward in history)",
          category: "History",
          pierce: true
        },
        {
          cmd: "history.exit-revise",
          sequence: [[{ key: "Escape" }]],
          description: "Exit revision mode",
          category: "History",
          pierce: true
        }
      ]
    };
    EffectBus.emit("keymap:add-layer", { layer });
  }
  // ── actions ────────────────────────────────────────────────
  #undo() {
    const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
    cursor?.undo();
  }
  #redo() {
    const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
    cursor?.redo();
  }
  #promote() {
    const cursor = get("@diamondcoreprocessor.com/HistoryCursorService");
    cursor?.promote();
  }
  #exitRevise() {
    if (!this.#reviseActive) return;
    const queen = get("@diamondcoreprocessor.com/ReviseQueenBee");
    if (queen?.invoke) queen.invoke("");
  }
  // ── DOM ────────────────────────────────────────────────────
  #buildClock() {
    const clock = document.createElement("div");
    clock.id = "hc-revision-clock";
    clock.style.cssText = `
      position: fixed;
      top: 8px;
      right: 16px;
      z-index: 9000;
      display: none;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      background: rgba(10, 12, 18, 0.92);
      border: 1px solid rgba(255, 170, 60, 0.35);
      border-radius: 6px;
      backdrop-filter: blur(8px);
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 11px;
      color: rgba(255, 200, 120, 0.9);
      user-select: none;
      pointer-events: auto;
    `;
    const timeLabel = document.createElement("span");
    timeLabel.style.cssText = "white-space: nowrap; letter-spacing: 0.5px;";
    const posLabel = document.createElement("span");
    posLabel.style.cssText = `
      white-space: nowrap;
      color: rgba(200, 220, 240, 0.5);
      font-size: 10px;
    `;
    const restoreBtn = document.createElement("span");
    restoreBtn.textContent = "Restore";
    restoreBtn.title = "Promote this state to head";
    restoreBtn.style.cssText = `
      display: none;
      cursor: pointer;
      padding: 1px 6px;
      margin-left: 4px;
      border: 1px solid rgba(255, 170, 60, 0.4);
      border-radius: 3px;
      background: rgba(255, 170, 60, 0.12);
      color: rgba(255, 200, 120, 0.9);
      font-weight: 600;
      font-size: 10px;
      letter-spacing: 0.3px;
    `;
    restoreBtn.addEventListener("click", () => this.#promote());
    clock.append(timeLabel, posLabel, restoreBtn);
    document.body.appendChild(clock);
    this.#clock = clock;
    this.#timeLabel = timeLabel;
    this.#posLabel = posLabel;
    this.#restoreBtn = restoreBtn;
  }
  // ── sync UI ────────────────────────────────────────────────
  #syncUI() {
    if (!this.#clock || !this.#timeLabel || !this.#posLabel || !this.#restoreBtn) return;
    const { position, total, rewound, at } = this.#state;
    const shouldShow = this.#reviseActive && total > 0;
    if (!shouldShow) {
      if (this.#visible) {
        this.#clock.style.display = "none";
        this.#visible = false;
      }
      return;
    }
    if (!this.#visible) {
      this.#clock.style.display = "flex";
      this.#visible = true;
    }
    if (at > 0) {
      const d = new Date(at);
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
      this.#timeLabel.textContent = `${date} ${time}`;
    } else {
      this.#timeLabel.textContent = "--:--:--";
    }
    this.#posLabel.textContent = `${position}/${total}`;
    this.#restoreBtn.style.display = rewound ? "inline-block" : "none";
  }
};
var _historySliderDrone = new HistorySliderDrone();
window.ioc.register("@diamondcoreprocessor.com/HistorySliderDrone", _historySliderDrone);
export {
  HistorySliderDrone
};
