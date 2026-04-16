// @miro.com/import
// src/miro.com/import/miro-api.service.ts
var API_BASE = "https://api.miro.com";
var TOKEN_KEY = "miro.importer.token";
var LAST_BOARD_KEY = "miro.importer.last-board";
var MiroApiService = class {
  get token() {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  }
  setToken(value) {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  }
  get lastBoardId() {
    return localStorage.getItem(LAST_BOARD_KEY) ?? "";
  }
  rememberBoard(boardId) {
    localStorage.setItem(LAST_BOARD_KEY, boardId);
  }
  async getBoard(boardId) {
    return await this.#apiJson(`/v2/boards/${encodeURIComponent(boardId)}`);
  }
  async *listItems(boardId) {
    let cursor;
    do {
      const params = new URLSearchParams({ limit: "50" });
      if (cursor) params.set("cursor", cursor);
      const page = await this.#apiJson(
        `/v2/boards/${encodeURIComponent(boardId)}/items?${params}`
      );
      for (const item of page.data ?? []) yield item;
      cursor = page.cursor;
    } while (cursor);
  }
  async fetchAsset(url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    if (!response.ok) {
      throw new Error(`asset ${response.status} ${url}`);
    }
    return await response.blob();
  }
  async #apiJson(path) {
    if (!this.token) throw new Error("NO_TOKEN");
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json"
      }
    });
    if (response.status === 401 || response.status === 403) throw new Error("UNAUTHORIZED");
    if (response.status === 404) throw new Error("NOT_FOUND");
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`miro api ${response.status}: ${detail.slice(0, 200) || response.statusText}`);
    }
    return await response.json();
  }
};
var _instance = new MiroApiService();
window.ioc?.register?.("@miro.com/MiroApiService", _instance);

// src/miro.com/import/miro-import.queen.ts
import { QueenBee, EffectBus, normalizeCell, hypercomb } from "@hypercomb/core";
var ioc = (key) => window.ioc?.get?.(key);
var TILE_PROPERTIES_FILE = "0000";
var MiroImportQueenBee = class extends QueenBee {
  namespace = "miro.com";
  command = "miro-import";
  description = "Import a Miro board as a tile hierarchy; images become tile backgrounds";
  async execute(args) {
    const api = ioc("@miro.com/MiroApiService");
    const store = ioc("@hypercomb.social/Store");
    const lineage = ioc("@hypercomb.social/Lineage");
    if (!api) {
      this.#toast("miro api service not loaded");
      return;
    }
    if (!store || !lineage) {
      this.#toast("store or lineage not ready");
      return;
    }
    if (!api.token) {
      this.#toast("no miro token. run /miro-token <your-token> first");
      return;
    }
    const boardId = args.trim() || api.lastBoardId;
    if (!boardId) {
      this.#toast("usage: /miro-import <boardId>");
      return;
    }
    const currentDir = await lineage.explorerDir();
    if (!currentDir) {
      this.#toast("navigate into a hive first");
      return;
    }
    api.rememberBoard(boardId);
    this.#toast(`fetching miro board ${boardId}...`);
    let board;
    try {
      board = await api.getBoard(boardId);
    } catch (error) {
      this.#toast(this.#formatFetchError(error));
      return;
    }
    const items = [];
    try {
      for await (const item of api.listItems(boardId)) items.push(item);
    } catch (error) {
      this.#toast(`miro items failed: ${error?.message ?? error}`);
      return;
    }
    this.#toast(`importing ${items.length} item${items.length === 1 ? "" : "s"} from "${board.name}"`);
    const rootName = normalizeCell(board.name) || `miro-${boardId.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`;
    const rootDir = await currentDir.getDirectoryHandle(rootName, { create: true });
    await writeTileProperties(rootDir, {
      "miro.boardId": board.id,
      "miro.boardName": board.name,
      "miro.viewLink": board.viewLink ?? "",
      "miro.importedAt": (/* @__PURE__ */ new Date()).toISOString(),
      "miro.itemCount": items.length
    });
    const { topLevel, framedBy } = groupByFrame(items);
    let resourcesFetched = 0;
    let resourceErrors = 0;
    const usedAtLevel = /* @__PURE__ */ new Map();
    const uniqueKey = (dir) => {
      const key = dir.name ?? String(Math.random());
      if (!usedAtLevel.has(key)) usedAtLevel.set(key, /* @__PURE__ */ new Set());
      return usedAtLevel.get(key);
    };
    const claim = (dir, base) => {
      const used = uniqueKey(dir);
      let candidate = base;
      let n = 2;
      while (used.has(candidate)) candidate = `${base}-${n++}`;
      used.add(candidate);
      return candidate;
    };
    for (const item of topLevel) {
      if (item.type === "connector") continue;
      const tileName = claim(rootDir, tileNameForItem(item));
      const tileDir = await rootDir.getDirectoryHandle(tileName, { create: true });
      const result = await attachItem(api, store, tileDir, item);
      if (result === "fetched") resourcesFetched++;
      else if (result === "errored") resourceErrors++;
      if (item.type === "frame") {
        const children = framedBy.get(item.id) ?? [];
        for (const child of children) {
          if (child.type === "connector") continue;
          const childName = claim(tileDir, tileNameForItem(child));
          const childDir = await tileDir.getDirectoryHandle(childName, { create: true });
          const childResult = await attachItem(api, store, childDir, child);
          if (childResult === "fetched") resourcesFetched++;
          else if (childResult === "errored") resourceErrors++;
        }
      }
    }
    this.#toast(`miro import done: ${items.length} item${items.length === 1 ? "" : "s"}, ${resourcesFetched} asset${resourcesFetched === 1 ? "" : "s"}${resourceErrors ? `, ${resourceErrors} failed` : ""}`);
    EffectBus.emit("cell:added", { cell: rootName });
    await new hypercomb().act();
  }
  #formatFetchError(error) {
    const msg = error?.message ?? String(error);
    if (msg === "UNAUTHORIZED") return "miro token rejected. update with /miro-token <new-token>";
    if (msg === "NOT_FOUND") return "board not found. check the id and that your app is installed on the board's team";
    if (msg === "NO_TOKEN") return "no miro token. run /miro-token <your-token> first";
    return `miro fetch failed: ${msg}`;
  }
  #toast(message) {
    EffectBus.emit("activity:log", { message, icon: "\u25C8" });
  }
};
function tileNameForItem(item) {
  const raw = item.data?.title ?? item.data?.content ?? "";
  const normalized = normalizeCell(stripHtml(raw));
  if (normalized) return normalized;
  const shortId = item.id.replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase();
  return `${item.type.replace(/_/g, "-")}-${shortId}`;
}
function stripHtml(input) {
  return input.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
function groupByFrame(items) {
  const frameIds = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (item.type === "frame") frameIds.add(item.id);
  }
  const topLevel = [];
  const framedBy = /* @__PURE__ */ new Map();
  for (const item of items) {
    const parentId = item.parent?.id;
    if (parentId && frameIds.has(parentId) && item.type !== "frame") {
      const list = framedBy.get(parentId) ?? [];
      list.push(item);
      framedBy.set(parentId, list);
    } else {
      topLevel.push(item);
    }
  }
  return { topLevel, framedBy };
}
async function attachItem(api, store, tileDir, item) {
  const properties = {
    "miro.id": item.id,
    "miro.type": item.type
  };
  const textPayload = stripHtml(item.data?.content ?? item.data?.title ?? "");
  if (textPayload) properties["miro.text"] = textPayload;
  const externalLink = item.data?.url ?? item.data?.providerUrl;
  if (externalLink) {
    properties["miro.url"] = externalLink;
    properties["link"] = externalLink;
  }
  const assetUrl = item.data?.imageUrl ?? item.data?.documentUrl ?? item.data?.previewUrl;
  let status = "none";
  if (assetUrl) {
    try {
      const blob = await api.fetchAsset(assetUrl);
      const signature = await store.putResource(blob);
      properties["miro.assetSignature"] = signature;
      properties["miro.assetMime"] = blob.type || "";
      properties["large"] = { image: signature, x: 0, y: 0, scale: 1 };
      properties["small"] = { image: signature };
      properties["flat"] = { small: { image: signature }, large: { x: 0, y: 0, scale: 1 } };
      status = "fetched";
    } catch (error) {
      properties["miro.assetError"] = String(error?.message ?? error);
      status = "errored";
    }
  }
  await writeTileProperties(tileDir, properties);
  return status;
}
async function writeTileProperties(dir, updates) {
  let existing = {};
  try {
    const fileHandle2 = await dir.getFileHandle(TILE_PROPERTIES_FILE);
    const file = await fileHandle2.getFile();
    existing = JSON.parse(await file.text());
  } catch {
    existing = {};
  }
  const merged = { ...existing, ...updates };
  const fileHandle = await dir.getFileHandle(TILE_PROPERTIES_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(merged));
  await writable.close();
}
var _instance2 = new MiroImportQueenBee();
window.ioc?.register?.("@miro.com/MiroImportQueenBee", _instance2);

// src/miro.com/import/miro-token.queen.ts
import { QueenBee as QueenBee2, EffectBus as EffectBus2 } from "@hypercomb/core";
var ioc2 = (key) => window.ioc?.get?.(key);
var MiroTokenQueenBee = class extends QueenBee2 {
  namespace = "miro.com";
  command = "miro-token";
  description = "Store your Miro API token locally (localStorage, never sent anywhere)";
  execute(args) {
    const api = ioc2("@miro.com/MiroApiService");
    if (!api) {
      this.#toast("miro api service not loaded");
      return;
    }
    const trimmed = args.trim();
    if (!trimmed) {
      const existing = api.token;
      this.#toast(existing ? `miro token set (${existing.length} chars). replace: /miro-token <new>. remove: /miro-token clear` : "no miro token. paste yours: /miro-token <token>");
      return;
    }
    if (trimmed.toLowerCase() === "clear" || trimmed.toLowerCase() === "remove") {
      api.setToken("");
      this.#toast("miro token cleared");
      return;
    }
    api.setToken(trimmed);
    this.#toast("miro token stored");
  }
  #toast(message) {
    EffectBus2.emit("activity:log", { message, icon: "\u25C8" });
  }
};
var _instance3 = new MiroTokenQueenBee();
window.ioc?.register?.("@miro.com/MiroTokenQueenBee", _instance3);
export {
  MiroApiService,
  MiroImportQueenBee,
  MiroTokenQueenBee
};
