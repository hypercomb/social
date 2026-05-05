// src/diamondcoreprocessor.com/assistant/claude-bridge.worker.ts
import { Worker, EffectBus, normalizeCell, hypercomb } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/tile-properties.ts
var TILE_PROPERTIES_FILE = "0000";
var readCellProperties = async (cellDir) => {
  try {
    const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return {};
  }
};

// src/diamondcoreprocessor.com/assistant/claude-bridge.worker.ts
var BRIDGE_PORT = 2401;
var BRIDGE_ENABLED_QUERY_KEY = "claudeBridge";
var BRIDGE_ENABLED_STORAGE_KEY = "hypercomb.claudeBridge.enabled";
var RECONNECT_MS = 3e3;
var ClaudeBridgeWorker = class extends Worker {
  namespace = "diamondcoreprocessor.com";
  genotype = "assistant";
  description = "Claude CLI bridge \u2014 receives tile commands over WebSocket and executes against OPFS.";
  grammar = [
    { example: "claude bridge" }
  ];
  effects = [];
  #ws = null;
  #timer = null;
  act = async () => {
    if (!this.#isEnabled()) return;
    this.#connect();
  };
  #isEnabled() {
    try {
      const host = window.location.hostname;
      if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return false;
      const queryValue = new URLSearchParams(window.location.search).get(BRIDGE_ENABLED_QUERY_KEY);
      if (queryValue !== null) return /^(1|true|yes|on)$/i.test(queryValue);
      const storedValue = window.localStorage.getItem(BRIDGE_ENABLED_STORAGE_KEY);
      if (storedValue !== null) return /^(1|true|yes|on)$/i.test(storedValue);
    } catch {
      return false;
    }
    return false;
  }
  // ------- WebSocket lifecycle -------
  #connected = false;
  #connect() {
    try {
      const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`);
      ws.onopen = () => {
        this.#connected = true;
        ws.send(JSON.stringify({ type: "renderer" }));
        console.log("[claude-bridge] connected");
      };
      ws.onmessage = (event) => {
        void this.#handleMessage(String(event.data));
      };
      ws.onclose = () => {
        const wasConnected = this.#connected;
        this.#ws = null;
        this.#connected = false;
        if (wasConnected) {
          console.log("[claude-bridge] disconnected, will reconnect");
          this.#scheduleReconnect();
        }
      };
      ws.onerror = () => {
      };
      this.#ws = ws;
    } catch {
    }
  }
  #scheduleReconnect() {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#connect();
    }, RECONNECT_MS);
  }
  // ------- message handling -------
  async #handleMessage(raw) {
    let req;
    try {
      req = JSON.parse(raw);
    } catch {
      return;
    }
    if (!req.id || !req.op) return;
    let res;
    try {
      res = await this.#dispatch(req);
    } catch (err) {
      res = { id: req.id, ok: false, error: err?.message ?? "unknown error" };
    }
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(res));
    }
  }
  async #dispatch(req) {
    switch (req.op) {
      case "update":
        return this.#update(req);
      case "add":
        return this.#add(req);
      // legacy: delegates to update
      case "remove":
        return this.#remove(req);
      // legacy: delegates to update
      case "list":
        return this.#list(req);
      case "inspect":
        return this.#inspect(req);
      case "history":
        return this.#history(req);
      case "submit":
        return this.#submit(req);
      default:
        return { id: req.id, ok: false, error: `unknown op: ${req.op}` };
    }
  }
  // Layer-as-primitive update. Caller passes `{ segments, layer }` where
  // layer is `{ name, ...slots }`. Slot names are conventional (children,
  // tags, notes, etc.). Empty arrays wipe the slot. One awaited cascade
  // per parent. The receiver mirrors `children` to OPFS folders so the
  // file tree stays in sync with the merkle layer.
  async #update(req) {
    const layer = req.layer;
    if (!layer || typeof layer !== "object") {
      return { id: req.id, ok: false, error: "no layer provided" };
    }
    let dir = await this.#explorerDir();
    if (!dir) return { id: req.id, ok: false, error: "no explorer directory" };
    const parentSegments = [];
    if (req.segments?.length) {
      for (const raw of req.segments) {
        const seg = normalizeCell(raw);
        if (!seg) continue;
        dir = await dir.getDirectoryHandle(seg, { create: true });
        parentSegments.push(seg);
      }
    }
    const childrenRaw = layer.children;
    const children = Array.isArray(childrenRaw) ? childrenRaw.map((c) => normalizeCell(String(c))).filter(Boolean) : [];
    for (const name of children) {
      await dir.getDirectoryHandle(name, { create: true });
    }
    const committer = get("@diamondcoreprocessor.com/LayerCommitter");
    if (!committer?.update) {
      return { id: req.id, ok: false, error: "committer.update not available" };
    }
    await committer.update(parentSegments, layer);
    return { id: req.id, ok: true, data: { count: children.length, segments: parentSegments } };
  }
  // Mirrors a human keystroke into the in-app command line. Emits the same
  // EffectBus channel a future remote caller would use; the command-line
  // component subscribes and runs the existing submit pipeline. Text is
  // forwarded verbatim so anything the keyboard accepts (slash behaviours,
  // bracket selects, multi-token grammar, plain cell names) just works.
  async #submit(req) {
    const text = req.text;
    if (typeof text !== "string") return { id: req.id, ok: false, error: "no text provided" };
    EffectBus.emit("command-line:remote-submit", { text });
    return { id: req.id, ok: true };
  }
  // ------- operations -------
  async #add(req) {
    const cells = req.cells;
    if (!cells?.length) return { id: req.id, ok: false, error: "no cells provided" };
    let dir = await this.#explorerDir();
    if (!dir) return { id: req.id, ok: false, error: "no explorer directory" };
    const parentSegments = [];
    if (req.segments?.length) {
      for (const raw of req.segments) {
        const seg = normalizeCell(raw);
        if (!seg) continue;
        dir = await dir.getDirectoryHandle(seg, { create: true });
        parentSegments.push(seg);
      }
    }
    let count = 0;
    for (const name of cells) {
      const normalized = normalizeCell(name);
      if (!normalized) continue;
      await dir.getDirectoryHandle(normalized, { create: true });
      EffectBus.emit("cell:added", { cell: normalized, segments: parentSegments.slice() });
      count++;
    }
    await new hypercomb().act();
    return { id: req.id, ok: true, data: { count } };
  }
  async #remove(req) {
    if (req.all) {
      const visible = await this.#visibleCells();
      for (const cell of visible) {
        EffectBus.emit("cell:removed", { cell });
      }
      await new hypercomb().act();
      return { id: req.id, ok: true, data: { count: visible.length } };
    }
    const cells = req.cells;
    if (!cells?.length) return { id: req.id, ok: false, error: "no cells provided" };
    let count = 0;
    for (const raw of cells) {
      const cell = normalizeCell(raw);
      if (!cell) continue;
      EffectBus.emit("cell:removed", { cell });
      count++;
    }
    await new hypercomb().act();
    return { id: req.id, ok: true, data: { count } };
  }
  async #list(req) {
    const cells = await this.#visibleCells();
    return { id: req.id, ok: true, data: cells };
  }
  async #inspect(req) {
    const name = req.cell ? normalizeCell(req.cell) : "";
    if (!name) return { id: req.id, ok: false, error: "no cell name" };
    const dir = await this.#explorerDir();
    if (!dir) return { id: req.id, ok: false, error: "no explorer directory" };
    try {
      const cellDir = await dir.getDirectoryHandle(name, { create: false });
      const props = await readCellProperties(cellDir);
      return { id: req.id, ok: true, data: props };
    } catch {
      return { id: req.id, ok: false, error: `cell not found: ${name}` };
    }
  }
  async #history(req) {
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    const lineage = get("@hypercomb.social/Lineage");
    if (!historyService || !lineage) {
      return { id: req.id, ok: false, error: "history service not available" };
    }
    const sig = await historyService.sign(lineage);
    const ops = await historyService.replay(sig);
    return { id: req.id, ok: true, data: ops };
  }
  // ------- helpers -------
  async #explorerDir() {
    const lineage = get("@hypercomb.social/Lineage");
    return lineage?.explorerDir?.() ?? null;
  }
  async #listCellFolders(dir) {
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "directory") continue;
      if (!name) continue;
      if (name.startsWith("__") && name.endsWith("__")) continue;
      out.push(name);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }
  async #visibleCells() {
    const dir = await this.#explorerDir();
    if (!dir) return [];
    const all = await this.#listCellFolders(dir);
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    const lineage = get("@hypercomb.social/Lineage");
    if (!historyService || !lineage) return all;
    const sig = await historyService.sign(lineage);
    const ops = await historyService.replay(sig);
    const cellState = /* @__PURE__ */ new Map();
    for (const op of ops) cellState.set(op.cell, op.op);
    const allSet = new Set(all);
    return all.filter((cell) => {
      const lastOp = cellState.get(cell);
      return lastOp !== "remove" || allSet.has(cell);
    });
  }
};
var _claudeBridgeWorker = new ClaudeBridgeWorker();
window.ioc.register("@diamondcoreprocessor.com/ClaudeBridgeWorker", _claudeBridgeWorker);
export {
  ClaudeBridgeWorker
};
