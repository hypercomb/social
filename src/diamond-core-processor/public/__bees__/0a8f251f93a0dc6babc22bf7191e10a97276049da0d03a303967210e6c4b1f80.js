// src/diamondcoreprocessor.com/clipboard/clipboard.worker.ts
import { Worker, EffectBus, hypercomb } from "@hypercomb/core";
var META_FILE = "__meta__";
var ClipboardWorker = class extends Worker {
  namespace = "diamondcoreprocessor.com";
  genotype = "clipboard";
  description = "Captures selected cells into clipboard and pastes them at the current location.";
  listens = [
    "controls:action",
    "keymap:invoke"
  ];
  emits = [
    "clipboard:captured",
    "clipboard:paste-start",
    "clipboard:paste-done",
    "cell:added",
    "cell:removed"
  ];
  constructor() {
    super();
    EffectBus.on("controls:action", (payload) => {
      if (!payload?.action) return;
      switch (payload.action) {
        case "copy":
          this.#capture("copy");
          break;
        case "cut":
          this.#capture("cut");
          break;
        case "paste":
          void this.#paste();
          break;
        case "place":
          void this.#place();
          break;
        case "clear-clipboard":
          void this.#clearClipboard();
          break;
      }
    });
    EffectBus.on("keymap:invoke", (payload) => {
      if (!payload?.cmd) return;
      switch (payload.cmd) {
        case "clipboard.copy":
          this.#capture("copy");
          break;
        case "layout.cutCells":
          this.#capture("cut");
          break;
        case "clipboard.paste":
          void this.#paste();
          break;
      }
    });
    const tryRestore = () => {
      const store = this.#store;
      const svc = this.#clipboardSvc;
      if (!store?.clipboard || !svc) {
        setTimeout(tryRestore, 200);
        return;
      }
      void this.#restoreFromOpfs();
    };
    setTimeout(tryRestore, 200);
  }
  act = async () => {
  };
  // ── helpers ───────────────────────────────────────────
  get #clipboardSvc() {
    return get("@diamondcoreprocessor.com/ClipboardService");
  }
  get #lineage() {
    return get("@hypercomb.social/Lineage");
  }
  get #store() {
    return get("@hypercomb.social/Store");
  }
  get #selection() {
    const svc = get("@diamondcoreprocessor.com/SelectionService");
    if (svc && svc.selected.size > 0) return svc;
    return void 0;
  }
  #selectedLabels() {
    const svc = get("@diamondcoreprocessor.com/SelectionService");
    if (svc && svc.selected.size > 0) return Array.from(svc.selected);
    const tsd = get("@diamondcoreprocessor.com/TileSelectionDrone");
    return tsd?.selectedLabels ?? [];
  }
  // ── capture (copy or cut) ─────────────────────────────
  // Both record labels + source in clipboard service + persist meta.
  // Cut additionally emits cell:removed → HistoryRecorder records remove ops.
  // Folders stay in OPFS. History is the genome.
  #capture(op) {
    const labels = this.#selectedLabels();
    if (labels.length === 0) return;
    const segments = this.#lineage?.explorerSegments() ?? [];
    this.#clipboardSvc?.capture(labels, segments, op);
    if (op === "cut") {
      for (const label of labels) {
        EffectBus.emit("cell:removed", { cell: label });
      }
      this.#selection?.clear();
    }
    EffectBus.emit("clipboard:captured", { labels: [...labels], op });
    if (op === "cut") {
      setTimeout(() => void new hypercomb().act(), 80);
    }
    void this.#persistMeta(op, labels, segments);
  }
  async #persistMeta(op, labels, segments) {
    const store = this.#store;
    if (!store) return;
    await writeMeta(store.clipboard, {
      op,
      items: labels.map((label) => ({ label, sourceSegments: [...segments] }))
    });
  }
  // ── paste ─────────────────────────────────────────────
  // Reads cell trees from original source location (folders are still there).
  // Copies to current destination. Emits cell:added per label.
  async #paste() {
    const clipboardSvc = this.#clipboardSvc;
    if (!clipboardSvc) return;
    const { items, op } = clipboardSvc.consume();
    if (items.length === 0) return;
    EffectBus.emit("clipboard:paste-start", { count: items.length, op });
    for (const entry of items) {
      EffectBus.emit("cell:added", { cell: entry.label });
    }
    EffectBus.emit("clipboard:paste-done", { count: items.length, op });
    if (op === "cut") {
      const store = this.#store;
      if (store) await clearDirectory(store.clipboard);
    }
  }
  // ── place (selected clipboard items → current page) ──
  async #place() {
    const clipboardSvc = this.#clipboardSvc;
    if (!clipboardSvc || clipboardSvc.isEmpty) return;
    const selectedLabels = this.#selectedLabels();
    if (selectedLabels.length === 0) return;
    const selectedSet = new Set(selectedLabels);
    const toPlace = clipboardSvc.items.filter((i) => selectedSet.has(i.label));
    if (toPlace.length === 0) return;
    for (const entry of toPlace) {
      EffectBus.emit("cell:added", { cell: entry.label });
    }
    clipboardSvc.removeItems(selectedSet);
    this.#selection?.clear();
    const store = this.#store;
    if (clipboardSvc.isEmpty) {
      if (store) await clearDirectory(store.clipboard);
      EffectBus.emit("clipboard:view", { active: false });
    } else if (store) {
      await writeMeta(store.clipboard, {
        op: clipboardSvc.operation,
        items: clipboardSvc.items.map((i) => ({
          label: i.label,
          sourceSegments: [...i.sourceSegments]
        }))
      });
      EffectBus.emit("clipboard:view", {
        active: true,
        labels: clipboardSvc.items.map((i) => i.label),
        sourceSegments: [...clipboardSvc.items[0]?.sourceSegments ?? []]
      });
    }
  }
  // ── clear ─────────────────────────────────────────────
  async #clearClipboard() {
    this.#clipboardSvc?.clear();
    const store = this.#store;
    if (store) await clearDirectory(store.clipboard);
  }
  // ── restore from OPFS on startup ──────────────────────
  async #restoreFromOpfs() {
    const store = this.#store;
    const clipboardSvc = this.#clipboardSvc;
    if (!store || !clipboardSvc) return;
    if (!clipboardSvc.isEmpty) return;
    const meta = await readMeta(store.clipboard);
    if (!meta || meta.items.length === 0) return;
    clipboardSvc.capture(
      meta.items.map((i) => i.label),
      meta.items[0]?.sourceSegments ?? [],
      meta.op
    );
  }
};
async function writeMeta(clipDir, meta) {
  try {
    const handle = await clipDir.getFileHandle(META_FILE, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(JSON.stringify(meta));
    } finally {
      await writable.close();
    }
  } catch {
  }
}
async function readMeta(clipDir) {
  try {
    const handle = await clipDir.getFileHandle(META_FILE, { create: false });
    const file = await handle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}
async function clearDirectory(dir) {
  const entries = [];
  for await (const [name] of dir.entries()) {
    entries.push(name);
  }
  for (const name of entries) {
    try {
      await dir.removeEntry(name, { recursive: true });
    } catch {
    }
  }
}
var _clipboard = new ClipboardWorker();
window.ioc.register("@diamondcoreprocessor.com/ClipboardWorker", _clipboard);
export {
  ClipboardWorker
};
