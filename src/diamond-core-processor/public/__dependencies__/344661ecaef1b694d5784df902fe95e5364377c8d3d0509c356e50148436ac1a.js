// @diamondcoreprocessor.com/assistant
// src/diamondcoreprocessor.com/assistant/conversation.queen.ts
import { QueenBee, EffectBus } from "@hypercomb/core";
var ConversationQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  command = "chat";
  aliases = ["c", "ask"];
  description = "Multi-turn conversation with Claude \u2014 creates thread tiles with Q&A children";
  async execute(args) {
    const parsed = parseChatArgs(args);
    if (!parsed.message) {
      console.warn("[chat] No message provided");
      return;
    }
    EffectBus.emit("conversation:send", {
      threadId: parsed.threadId,
      message: parsed.message,
      model: parsed.model
    });
  }
};
function parseChatArgs(args) {
  let remaining = args.trim();
  let threadId;
  let model;
  const threadMatch = remaining.match(/^\(([0-9a-f]+)\)\s*/);
  if (threadMatch) {
    threadId = threadMatch[1];
    remaining = remaining.slice(threadMatch[0].length);
  }
  const modelMatch = remaining.match(/--model\s+(\S+)\s*/);
  if (modelMatch) {
    model = modelMatch[1];
    remaining = remaining.replace(modelMatch[0], "").trim();
  }
  return { threadId, model, message: remaining };
}
var _conversation = new ConversationQueenBee();
window.ioc.register("@diamondcoreprocessor.com/ConversationQueenBee", _conversation);

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
var callAnthropic = async (model, systemPrompt, userMessage, apiKey, maxTokens = 4096) => {
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
      messages: [{ role: "user", content: userMessage }]
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${text}`);
  }
  const json = await response.json();
  return json.content?.[0]?.text ?? "";
};
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

// src/diamondcoreprocessor.com/assistant/llm.queen.ts
import { QueenBee as QueenBee2, EffectBus as EffectBus2 } from "@hypercomb/core";
var SYSTEM_PROMPT = `You are an assistant integrated into a spatial knowledge graph called Hypercomb.
You receive context gathered from content-addressed lineages (folder paths) and signatures (SHA-256 hashes).
Respond concisely and helpfully based on the provided context. Your response will be stored as a content-addressed resource.`;
var LlmQueenBee = class extends QueenBee2 {
  namespace = "diamondcoreprocessor.com";
  command = "opus";
  aliases = ["sonnet", "haiku", "o", "s", "h"];
  description = "Send context to a Claude LLM and store the response as a resource";
  /** Set by the provider before invoke() to select which model to use */
  activeModel = "opus";
  async execute(args) {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn(`[llm] No API key. Set via: localStorage.setItem('${API_KEY_STORAGE}', 'sk-ant-...')`);
      EffectBus2.emit("llm:api-key-required", {});
      return;
    }
    const contextRefs = parseLlmArgs(args);
    const selection = get("@diamondcoreprocessor.com/SelectionService");
    const targets = selection ? Array.from(selection.selected) : [];
    if (targets.length === 0) {
      console.warn("[llm] No tiles selected");
      return;
    }
    const model = MODELS[this.activeModel.toLowerCase()] ?? MODELS["opus"];
    EffectBus2.emit("llm:request-start", { model, targets, contextRefs });
    try {
      const context = await gatherContext(contextRefs);
      const userMessage = context || `Selected tiles: ${targets.join(", ")}`;
      const responseText = await callAnthropic(model, SYSTEM_PROMPT, userMessage, apiKey);
      const store = get("@hypercomb.social/Store");
      if (!store) {
        console.warn("[llm] Store not available");
        return;
      }
      const blob = new Blob([responseText], { type: "text/plain" });
      const sig = await store.putResource(blob);
      EffectBus2.emit("llm:response", { model, targets, sig, contextRefs });
      EffectBus2.emit("llm:request-done", { model, targets, success: true });
      console.log(`[llm] ${this.activeModel} response stored: ${sig.slice(0, 12)}...`);
    } catch (err) {
      EffectBus2.emit("llm:error", { message: err?.message ?? "Unknown error" });
      EffectBus2.emit("llm:request-done", { model, targets, success: false });
      console.warn("[llm] Request failed:", err);
    }
  }
};
function parseLlmArgs(args) {
  const trimmed = args.trim();
  if (!trimmed) return [];
  const parenMatch = trimmed.match(/^\('(.+)'\)$/);
  if (parenMatch) {
    const inner = parenMatch[1];
    const bracketMatch = inner.match(/^\[(.+)\]$/);
    if (bracketMatch) {
      return bracketMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
    }
    return [inner.trim()];
  }
  if (trimmed) return [trimmed];
  return [];
}
var SIG_PATTERN = /^[0-9a-f]{64}$/;
async function gatherContext(refs) {
  const sections = [];
  for (const ref of refs) {
    try {
      if (SIG_PATTERN.test(ref)) {
        const store = get("@hypercomb.social/Store");
        const blob = await store?.getResource(ref);
        if (blob) {
          const text = await blob.text();
          sections.push(`## Resource ${ref.slice(0, 12)}...
${text}`);
        }
      } else {
        const lineageContext = await readLineageContext(ref);
        if (lineageContext) {
          sections.push(`## Lineage: ${ref}
${lineageContext}`);
        }
      }
    } catch (err) {
      console.warn(`[llm] Failed to gather context for ${ref}:`, err);
    }
  }
  return sections.join("\n\n");
}
async function readLineageContext(_lineagePath) {
  return null;
}
var _llm = new LlmQueenBee();
window.ioc.register("@diamondcoreprocessor.com/LlmQueenBee", _llm);

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
var listThreads = async (threadsDir) => {
  const ids = [];
  for await (const [name, handle] of threadsDir.entries()) {
    if (handle.kind === "directory") ids.push(name);
  }
  return ids;
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
export {
  API_KEY_STORAGE,
  ConversationQueenBee,
  LlmQueenBee,
  MODELS,
  buildMessages,
  callAnthropic,
  callAnthropicMultiTurn,
  computeThreadId,
  getApiKey,
  listThreads,
  loadThread,
  saveThread
};
