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
          void this.#capture("copy");
          break;
        case "cut":
          void this.#capture("cut");
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
          void this.#capture("copy");
          break;
        case "layout.cutCells":
          void this.#capture("cut");
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
  // ── capture ───────────────────────────────────────────
  // copy: record labels + source segments, leave folders in place.
  // cut:  move folders out of source into store.clipboard, then record
  //       remove ops. After cut, the source no longer holds the cells —
  //       refresh and history replay see them as truly gone.
  async #capture(op) {
    const labels = this.#selectedLabels();
    if (labels.length === 0) return;
    const lineage = this.#lineage;
    const store = this.#store;
    const segments = lineage?.explorerSegments() ?? [];
    if (op === "cut") {
      if (!store || !lineage) return;
      const sourceDir = await lineage.explorerDir();
      if (!sourceDir) return;
      const moved = [];
      await clearDirectory(store.clipboard);
      for (const label of labels) {
        const ok = await moveCellFolder(sourceDir, store.clipboard, label);
        if (ok) moved.push(label);
      }
      if (moved.length === 0) return;
      this.#clipboardSvc?.capture(moved, segments, "cut");
      for (const label of moved) {
        EffectBus.emit("cell:removed", { cell: label });
      }
      this.#selection?.clear();
      EffectBus.emit("clipboard:captured", { labels: [...moved], op: "cut" });
      setTimeout(() => void new hypercomb().act(), 80);
      void this.#persistMeta("cut", moved, segments);
      return;
    }
    this.#clipboardSvc?.capture(labels, segments, "copy");
    EffectBus.emit("clipboard:captured", { labels: [...labels], op: "copy" });
    void this.#persistMeta("copy", labels, segments);
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
  // cut:  move folders from store.clipboard back to current explorer dir.
  // copy: copy folders from sourceSegments to current explorer dir.
  async #paste() {
    const clipboardSvc = this.#clipboardSvc;
    const lineage = this.#lineage;
    const store = this.#store;
    if (!clipboardSvc || !lineage || !store) return;
    if (clipboardSvc.isEmpty) return;
    const targetDir = await lineage.explorerDir();
    if (!targetDir) return;
    const op = clipboardSvc.operation;
    const items = clipboardSvc.items;
    EffectBus.emit("clipboard:paste-start", { count: items.length, op });
    const placed = [];
    const failed = [];
    if (op === "cut") {
      for (const entry of items) {
        const ok = await moveCellFolder(store.clipboard, targetDir, entry.label);
        if (ok) placed.push(entry.label);
        else failed.push(entry.label);
      }
    } else {
      for (const entry of items) {
        const sourceDir = await lineage.tryResolve(entry.sourceSegments, store.hypercombRoot);
        if (!sourceDir) {
          console.warn(`[clipboard] copy source missing for '${entry.label}': /${entry.sourceSegments.join("/")}`);
          failed.push(entry.label);
          continue;
        }
        const ok = await copyCellFolder(sourceDir, targetDir, entry.label);
        if (ok) placed.push(entry.label);
        else failed.push(entry.label);
      }
    }
    for (const label of placed) {
      EffectBus.emit("cell:added", { cell: label });
    }
    if (op === "cut" && placed.length > 0) {
      clipboardSvc.removeItems(new Set(placed));
      if (clipboardSvc.isEmpty) {
        await clearDirectory(store.clipboard);
      } else {
        await writeMeta(store.clipboard, {
          op: clipboardSvc.operation,
          items: clipboardSvc.items.map((i) => ({
            label: i.label,
            sourceSegments: [...i.sourceSegments]
          }))
        });
      }
    }
    EffectBus.emit("clipboard:paste-done", { count: placed.length, op, failed });
  }
  // ── place (selected clipboard items → current page) ──
  async #place() {
    const clipboardSvc = this.#clipboardSvc;
    const lineage = this.#lineage;
    const store = this.#store;
    if (!clipboardSvc || !lineage || !store) return;
    if (clipboardSvc.isEmpty) return;
    const selectedLabels = this.#selectedLabels();
    if (selectedLabels.length === 0) return;
    const selectedSet = new Set(selectedLabels);
    const toPlace = clipboardSvc.items.filter((i) => selectedSet.has(i.label));
    if (toPlace.length === 0) return;
    const targetDir = await lineage.explorerDir();
    if (!targetDir) return;
    const op = clipboardSvc.operation;
    const placed = [];
    if (op === "cut") {
      for (const entry of toPlace) {
        const ok = await moveCellFolder(store.clipboard, targetDir, entry.label);
        if (ok) placed.push(entry.label);
      }
    } else {
      for (const entry of toPlace) {
        const sourceDir = await lineage.tryResolve(entry.sourceSegments, store.hypercombRoot);
        if (!sourceDir) {
          console.warn(`[clipboard] place: copy source missing for '${entry.label}': /${entry.sourceSegments.join("/")}`);
          continue;
        }
        const ok = await copyCellFolder(sourceDir, targetDir, entry.label);
        if (ok) placed.push(entry.label);
      }
    }
    for (const label of placed) {
      EffectBus.emit("cell:added", { cell: label });
    }
    clipboardSvc.removeItems(new Set(placed));
    this.#selection?.clear();
    if (clipboardSvc.isEmpty) {
      await clearDirectory(store.clipboard);
      EffectBus.emit("clipboard:view", { active: false });
    } else {
      await writeMeta(store.clipboard, {
        op: clipboardSvc.operation,
        items: clipboardSvc.items.map((i) => ({
          label: i.label,
          sourceSegments: [...i.sourceSegments]
        }))
      });
      EffectBus.emit("clipboard:view", {
        active: true,
        op: clipboardSvc.operation,
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
  // ── validate ──────────────────────────────────────────
  // Drop entries whose underlying folder can't be resolved, so the
  // clipboard count never shows a tile the view can't actually render.
  // Called from restore and from openClipboard before emitting view.
  async validate() {
    const svc = this.#clipboardSvc;
    const store = this.#store;
    const lineage = this.#lineage;
    if (!svc || !store || svc.isEmpty) return;
    const op = svc.operation;
    const items = svc.items;
    const invalid = /* @__PURE__ */ new Set();
    if (op === "cut") {
      for (const entry of items) {
        try {
          await store.clipboard.getDirectoryHandle(entry.label, { create: false });
        } catch {
          invalid.add(entry.label);
        }
      }
    } else {
      for (const entry of items) {
        const srcDir = lineage ? await lineage.tryResolve(entry.sourceSegments, store.hypercombRoot) : null;
        if (!srcDir) {
          invalid.add(entry.label);
          continue;
        }
        try {
          await srcDir.getDirectoryHandle(entry.label, { create: false });
        } catch {
          invalid.add(entry.label);
        }
      }
    }
    console.log("[clipboard-validate]", {
      op,
      labels: items.map((i) => i.label),
      sourceSegments: items[0]?.sourceSegments ?? [],
      invalid: [...invalid]
    });
    if (invalid.size === 0) return;
    svc.removeItems(invalid);
    if (svc.isEmpty) {
      await clearDirectory(store.clipboard);
    } else {
      await writeMeta(store.clipboard, {
        op: svc.operation,
        items: svc.items.map((i) => ({
          label: i.label,
          sourceSegments: [...i.sourceSegments]
        }))
      });
    }
  }
  // ── restore from OPFS on startup ──────────────────────
  // Cut folders that were moved into store.clipboard before refresh
  // are still there; the meta file tells us which labels and op.
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
    await this.validate();
  }
};
var META_TMP = "__meta__.tmp";
async function writeMeta(clipDir, meta) {
  const json = JSON.stringify(meta);
  try {
    const tmp = await clipDir.getFileHandle(META_TMP, { create: true });
    const w = await tmp.createWritable();
    try {
      await w.write(json);
    } finally {
      await w.close();
    }
    try {
      const file = await tmp.getFile();
      JSON.parse(await file.text());
    } catch {
      await clipDir.removeEntry(META_TMP).catch(() => {
      });
      return;
    }
    const handle = await clipDir.getFileHandle(META_FILE, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(json);
    } finally {
      await writable.close();
    }
    await clipDir.removeEntry(META_TMP).catch(() => {
    });
  } catch (err) {
    console.warn("[clipboard] writeMeta failed:", err);
  }
}
async function readMeta(clipDir) {
  const tryParse = async (name) => {
    try {
      const handle = await clipDir.getFileHandle(name, { create: false });
      const file = await handle.getFile();
      const text = await file.text();
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  return await tryParse(META_FILE) ?? await tryParse(META_TMP);
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
async function copyDirectory(src, dest) {
  for await (const [name, handle] of src.entries()) {
    if (handle.kind === "file") {
      const srcFile = await handle.getFile();
      const destFile = await dest.getFileHandle(name, { create: true });
      const writable = await destFile.createWritable();
      try {
        await writable.write(await srcFile.arrayBuffer());
      } finally {
        await writable.close();
      }
    } else if (handle.kind === "directory") {
      const srcDir = handle;
      const destDir = await dest.getDirectoryHandle(name, { create: true });
      await copyDirectory(srcDir, destDir);
    }
  }
}
async function copyCellFolder(sourceParent, destParent, label) {
  let src;
  try {
    src = await sourceParent.getDirectoryHandle(label, { create: false });
  } catch {
    return false;
  }
  try {
    await destParent.getDirectoryHandle(label, { create: false });
    console.warn(`[clipboard] destination already has '${label}'; skipping`);
    return false;
  } catch {
  }
  let dest;
  try {
    dest = await destParent.getDirectoryHandle(label, { create: true });
    await copyDirectory(src, dest);
    return true;
  } catch (err) {
    console.warn(`[clipboard] copy failed for '${label}':`, err);
    try {
      await destParent.removeEntry(label, { recursive: true });
    } catch {
    }
    return false;
  }
}
async function moveCellFolder(sourceParent, destParent, label) {
  const ok = await copyCellFolder(sourceParent, destParent, label);
  if (!ok) return false;
  try {
    await sourceParent.removeEntry(label, { recursive: true });
    return true;
  } catch (err) {
    console.warn(`[clipboard] source remove failed for '${label}', rolling back:`, err);
    try {
      await destParent.removeEntry(label, { recursive: true });
    } catch {
    }
    return false;
  }
}
var _clipboard = new ClipboardWorker();
window.ioc.register("@diamondcoreprocessor.com/ClipboardWorker", _clipboard);
export {
  ClipboardWorker
};
