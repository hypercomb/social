// src/diamondcoreprocessor.com/assistant/claude-bridge.drone.ts
import { Worker, EffectBus, normalizeSeed, hypercomb } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/tile-properties.ts
var TILE_PROPERTIES_FILE = "0000";
var readSeedProperties = async (seedDir) => {
  try {
    const fileHandle = await seedDir.getFileHandle(TILE_PROPERTIES_FILE);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return {};
  }
};

// src/diamondcoreprocessor.com/assistant/claude-bridge.drone.ts
var BRIDGE_PORT = 2401;
var RECONNECT_MS = 3e3;
var ClaudeBridgeWorker = class extends Worker {
  namespace = "diamondcoreprocessor.com";
  description = "Claude CLI bridge \u2014 receives tile commands over WebSocket and executes against OPFS.";
  grammar = [
    { example: "claude bridge" }
  ];
  effects = [];
  #ws = null;
  #timer = null;
  act = async () => {
    this.#connect();
  };
  // ------- WebSocket lifecycle -------
  #connect() {
    try {
      const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "renderer" }));
        console.log("[claude-bridge] connected");
      };
      ws.onmessage = (event) => {
        void this.#handleMessage(String(event.data));
      };
      ws.onclose = () => {
        this.#ws = null;
        this.#scheduleReconnect();
      };
      ws.onerror = () => {
      };
      this.#ws = ws;
    } catch {
      this.#scheduleReconnect();
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
      case "add":
        return this.#add(req);
      case "remove":
        return this.#remove(req);
      case "list":
        return this.#list(req);
      case "inspect":
        return this.#inspect(req);
      case "history":
        return this.#history(req);
      default:
        return { id: req.id, ok: false, error: `unknown op: ${req.op}` };
    }
  }
  // ------- operations -------
  async #add(req) {
    const seeds = req.seeds;
    if (!seeds?.length) return { id: req.id, ok: false, error: "no seeds provided" };
    const dir = await this.#explorerDir();
    if (!dir) return { id: req.id, ok: false, error: "no explorer directory" };
    let count = 0;
    for (const name of seeds) {
      const normalized = normalizeSeed(name);
      if (!normalized) continue;
      await dir.getDirectoryHandle(normalized, { create: true });
      EffectBus.emit("seed:added", { seed: normalized });
      count++;
    }
    await new hypercomb().act();
    return { id: req.id, ok: true, data: { count } };
  }
  async #remove(req) {
    if (req.all) {
      const visible = await this.#visibleSeeds();
      for (const seed of visible) {
        EffectBus.emit("seed:removed", { seed });
      }
      await new hypercomb().act();
      return { id: req.id, ok: true, data: { count: visible.length } };
    }
    const seeds = req.seeds;
    if (!seeds?.length) return { id: req.id, ok: false, error: "no seeds provided" };
    let count = 0;
    for (const raw of seeds) {
      const seed = normalizeSeed(raw);
      if (!seed) continue;
      EffectBus.emit("seed:removed", { seed });
      count++;
    }
    await new hypercomb().act();
    return { id: req.id, ok: true, data: { count } };
  }
  async #list(req) {
    const seeds = await this.#visibleSeeds();
    return { id: req.id, ok: true, data: seeds };
  }
  async #inspect(req) {
    const name = req.seed ? normalizeSeed(req.seed) : "";
    if (!name) return { id: req.id, ok: false, error: "no seed name" };
    const dir = await this.#explorerDir();
    if (!dir) return { id: req.id, ok: false, error: "no explorer directory" };
    try {
      const seedDir = await dir.getDirectoryHandle(name, { create: false });
      const props = await readSeedProperties(seedDir);
      return { id: req.id, ok: true, data: props };
    } catch {
      return { id: req.id, ok: false, error: `seed not found: ${name}` };
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
  async #listSeedFolders(dir) {
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
  async #visibleSeeds() {
    const dir = await this.#explorerDir();
    if (!dir) return [];
    const all = await this.#listSeedFolders(dir);
    const historyService = get("@diamondcoreprocessor.com/HistoryService");
    const lineage = get("@hypercomb.social/Lineage");
    if (!historyService || !lineage) return all;
    const sig = await historyService.sign(lineage);
    const ops = await historyService.replay(sig);
    const seedState = /* @__PURE__ */ new Map();
    for (const op of ops) seedState.set(op.seed, op.op);
    return all.filter((seed) => seedState.get(seed) !== "remove");
  }
};
var _claudeBridgeWorker = new ClaudeBridgeWorker();
window.ioc.register("@diamondcoreprocessor.com/ClaudeBridgeWorker", _claudeBridgeWorker);
export {
  ClaudeBridgeWorker
};
