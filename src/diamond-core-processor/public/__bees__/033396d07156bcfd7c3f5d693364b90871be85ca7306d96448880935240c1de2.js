// src/diamondcoreprocessor.com/assistant/conversation.drone.ts
import { Drone, EffectBus, normalizeCell, hypercomb } from "@hypercomb/core";

// src/diamondcoreprocessor.com/assistant/llm-api.ts
var ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
var ANTHROPIC_VERSION = "2023-06-01";
var MODELS = {
  opus: "claude-opus-4-6",
  o: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  s: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
  h: "claude-haiku-4-5-20251001"
};
var API_KEY_STORAGE = "hc:anthropic-api-key";
var getApiKey = () => localStorage.getItem(API_KEY_STORAGE);
var callAnthropicMultiTurn = async (model, systemPrompt, messages, apiKey, maxTokens = 4096) => {
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${text}`);
  }
  const json = await response.json();
  return {
    text: json.content?.[0]?.text ?? "",
    stopReason: json.stop_reason ?? "end_turn",
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
    model: json.model ?? model
  };
};

// src/diamondcoreprocessor.com/assistant/thread.ts
import { SignatureService } from "@hypercomb/core";
var computeThreadId = async (systemPrompt, firstMessage) => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(systemPrompt + "\0" + firstMessage);
  return SignatureService.sign(bytes.buffer);
};
var MANIFEST_FILE = "manifest.json";
var saveThread = async (threadsDir, manifest) => {
  const dir = await threadsDir.getDirectoryHandle(manifest.id, { create: true });
  const handle = await dir.getFileHandle(MANIFEST_FILE, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify(manifest));
  } finally {
    await writable.close();
  }
};
var loadThread = async (threadsDir, threadId) => {
  try {
    const dir = await threadsDir.getDirectoryHandle(threadId);
    const handle = await dir.getFileHandle(MANIFEST_FILE);
    const file = await handle.getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
};
var buildMessages = async (getResource, manifest) => {
  const messages = [];
  for (const turn of manifest.turns) {
    const blob = await getResource(turn.contentSig);
    if (!blob) continue;
    const text = await blob.text();
    messages.push({ role: turn.role, content: text });
  }
  return messages;
};

// src/diamondcoreprocessor.com/assistant/conversation.drone.ts
var SYSTEM_PROMPT = `You are an assistant integrated into a spatial knowledge graph called Hypercomb.
You receive context gathered from content-addressed lineages (folder paths) and signatures (SHA-256 hashes).
Respond concisely and helpfully based on the provided context. Your response will be stored as a content-addressed resource.`;
var PROPS_FILE = "0000";
var ConversationDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "assistant";
  description = "Orchestrates multi-turn Claude conversations as question tiles with response children";
  deps = {
    store: "@hypercomb.social/Store",
    lineage: "@hypercomb.social/Lineage"
  };
  listens = ["conversation:send"];
  emits = [
    "conversation:response",
    "conversation:turn-added",
    "cell:added",
    "llm:request-start",
    "llm:request-done",
    "llm:error"
  ];
  #effectsRegistered = false;
  #busy = false;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("conversation:send", (payload) => {
      void this.#handleSend(payload);
    });
  };
  async #handleSend(payload) {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const apiKey = getApiKey();
      if (!apiKey) {
        console.warn(`[conversation] No API key. Set via: localStorage.setItem('${API_KEY_STORAGE}', 'sk-ant-...')`);
        EffectBus.emit("llm:api-key-required", {});
        return;
      }
      const store = this.resolve("store");
      const lineage = this.resolve("lineage");
      if (!store || !lineage) {
        console.warn("[conversation] Store or Lineage not available");
        return;
      }
      const explorerDir = await lineage.explorerDir();
      if (!explorerDir) return;
      const modelKey = payload.model?.toLowerCase() ?? "opus";
      const model = MODELS[modelKey] ?? MODELS["opus"];
      const modelAlias = Object.entries(MODELS).find(([k, v]) => v === model && k.length > 1)?.[0] ?? modelKey;
      let manifest;
      let questionDir;
      if (payload.threadId) {
        const loaded = await loadThread(store.threads, payload.threadId);
        if (!loaded) {
          console.warn(`[conversation] Thread not found: ${payload.threadId}`);
          return;
        }
        manifest = loaded;
        const tileName = await this.#findThreadTile(explorerDir, payload.threadId);
        if (!tileName) {
          console.warn(`[conversation] Question tile not found for: ${payload.threadId}`);
          return;
        }
        questionDir = await explorerDir.getDirectoryHandle(tileName);
      } else {
        const threadId = await computeThreadId(SYSTEM_PROMPT, payload.message);
        const tileName = normalizeCell(payload.message.slice(0, 40)) || `chat-${threadId.slice(0, 8)}`;
        questionDir = await explorerDir.getDirectoryHandle(tileName, { create: true });
        const questionBlob = new Blob([payload.message], { type: "text/plain" });
        const questionSig = await store.putResource(questionBlob);
        await this.#writeProps(questionDir, {
          thread: threadId,
          contentSig: questionSig,
          tags: ["question", modelAlias]
        });
        EffectBus.emit("cell:added", { cell: tileName });
        manifest = {
          id: threadId,
          model,
          systemPrompt: SYSTEM_PROMPT,
          turns: [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        manifest.turns.push({
          role: "user",
          contentSig: questionSig,
          tileName,
          at: Date.now()
        });
      }
      EffectBus.emit("llm:request-start", { model, threadId: manifest.id });
      if (payload.threadId) {
        const userBlob = new Blob([payload.message], { type: "text/plain" });
        const userSig = await store.putResource(userBlob);
        const turnIndex = manifest.turns.length + 1;
        const followUpName = `${String(turnIndex).padStart(2, "0")}-followup`;
        const followUpDir = await questionDir.getDirectoryHandle(followUpName, { create: true });
        await this.#writeProps(followUpDir, {
          contentSig: userSig,
          tags: ["followup"]
        });
        EffectBus.emit("cell:added", { cell: followUpName });
        manifest.turns.push({
          role: "user",
          contentSig: userSig,
          tileName: followUpName,
          at: Date.now()
        });
      }
      const messages = await buildMessages(
        (sig) => store.getResource(sig),
        manifest
      );
      const result = await callAnthropicMultiTurn(
        model,
        manifest.systemPrompt,
        messages,
        apiKey
      );
      const responseBlob = new Blob([result.text], { type: "text/plain" });
      const responseSig = await store.putResource(responseBlob);
      const responseIndex = manifest.turns.length + 1;
      const responseName = `${String(responseIndex).padStart(2, "0")}-response`;
      const responseDir = await questionDir.getDirectoryHandle(responseName, { create: true });
      const stopReasonTag = result.stopReason.replace(/_/g, "-");
      await this.#writeProps(responseDir, {
        contentSig: responseSig,
        stopReason: result.stopReason,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: result.model,
        tags: ["response", modelAlias, stopReasonTag]
      });
      EffectBus.emit("cell:added", { cell: responseName });
      const responseTurn = {
        role: "assistant",
        contentSig: responseSig,
        tileName: responseName,
        at: Date.now(),
        meta: {
          stopReason: result.stopReason,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens
        }
      };
      manifest.turns.push(responseTurn);
      manifest.updatedAt = Date.now();
      await saveThread(store.threads, manifest);
      EffectBus.emit("conversation:response", { threadId: manifest.id, responseSig, model });
      EffectBus.emit("llm:request-done", { model, threadId: manifest.id, success: true });
      console.log(`[conversation] ${modelAlias} thread ${manifest.id.slice(0, 12)}... \u2192 ${manifest.turns.length} turns`);
      await new hypercomb().act();
    } catch (err) {
      EffectBus.emit("llm:error", { message: err?.message ?? "Unknown error" });
      EffectBus.emit("llm:request-done", { model: "", threadId: "", success: false });
      console.warn("[conversation] failed:", err);
    } finally {
      this.#busy = false;
    }
  }
  async #findThreadTile(dir, threadId) {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "directory") continue;
      if (name.startsWith("__")) continue;
      try {
        const props = await this.#readProps(handle);
        if (props.thread === threadId) return name;
      } catch {
      }
    }
    return null;
  }
  async #readProps(cellDir) {
    try {
      const fh = await cellDir.getFileHandle(PROPS_FILE);
      const file = await fh.getFile();
      return JSON.parse(await file.text());
    } catch {
      return {};
    }
  }
  async #writeProps(cellDir, updates) {
    const existing = await this.#readProps(cellDir);
    const merged = { ...existing, ...updates };
    const fh = await cellDir.getFileHandle(PROPS_FILE, { create: true });
    const writable = await fh.createWritable();
    try {
      await writable.write(JSON.stringify(merged));
    } finally {
      await writable.close();
    }
  }
};
var _conversation = new ConversationDrone();
window.ioc.register("@diamondcoreprocessor.com/ConversationDrone", _conversation);
export {
  ConversationDrone
};
