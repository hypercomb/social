// @diamondcoreprocessor.com/assistant
// src/diamondcoreprocessor.com/assistant/conversation.queen.ts
import { QueenBee, EffectBus } from "@hypercomb/core";
var ConversationQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  genotype = "assistant";
  command = "chat";
  aliases = [];
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

// src/diamondcoreprocessor.com/assistant/input.atomizer.ts
import { EffectBus as EffectBus2 } from "@hypercomb/core";
import { ATOMIZER_IOC_PREFIX } from "@hypercomb/core";
var INPUT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6" y2="14"/></svg>';
var InputAtomizer = class {
  atomizerId = "input-atomizer";
  name = "Input";
  description = "Break apart input controls \u2014 font, color, border, spacing, placeholder";
  icon = INPUT_ICON;
  targetTypes = ["input", "textarea"];
  discover(target) {
    const el = target.element;
    const computed = window.getComputedStyle(el);
    const properties = [
      // ── typography ──
      {
        key: "font-size",
        label: "font size",
        type: "range",
        value: parseFloat(computed.fontSize) || 14,
        defaultValue: 14,
        min: 8,
        max: 48,
        step: 1,
        group: "typography"
      },
      {
        key: "font-family",
        label: "font",
        type: "select",
        value: computed.fontFamily.split(",")[0].trim().replace(/"/g, ""),
        defaultValue: "monospace",
        options: [
          { label: "Monospace", value: "monospace" },
          { label: "Sans-serif", value: "sans-serif" },
          { label: "Serif", value: "serif" },
          { label: "System UI", value: "system-ui" }
        ],
        group: "typography"
      },
      {
        key: "font-weight",
        label: "weight",
        type: "select",
        value: computed.fontWeight,
        defaultValue: "400",
        options: [
          { label: "Light", value: "300" },
          { label: "Normal", value: "400" },
          { label: "Medium", value: "500" },
          { label: "Bold", value: "700" }
        ],
        group: "typography"
      },
      {
        key: "letter-spacing",
        label: "tracking",
        type: "range",
        value: parseFloat(computed.letterSpacing) || 0,
        defaultValue: 0,
        min: -2,
        max: 8,
        step: 0.5,
        group: "typography"
      },
      // ── color ──
      {
        key: "color",
        label: "text color",
        type: "color",
        value: this.#rgbToHex(computed.color),
        defaultValue: "#ffffff",
        group: "color"
      },
      {
        key: "background-color",
        label: "background",
        type: "color",
        value: this.#rgbToHex(computed.backgroundColor),
        defaultValue: "#000000",
        group: "color"
      },
      {
        key: "opacity",
        label: "opacity",
        type: "range",
        value: parseFloat(computed.opacity) * 100,
        defaultValue: 100,
        min: 0,
        max: 100,
        step: 5,
        group: "color"
      },
      // ── border ──
      {
        key: "border-color",
        label: "border color",
        type: "color",
        value: this.#rgbToHex(computed.borderColor),
        defaultValue: "#333333",
        group: "border"
      },
      {
        key: "border-width",
        label: "border width",
        type: "range",
        value: parseFloat(computed.borderWidth) || 0,
        defaultValue: 1,
        min: 0,
        max: 8,
        step: 0.5,
        group: "border"
      },
      {
        key: "border-radius",
        label: "radius",
        type: "range",
        value: parseFloat(computed.borderRadius) || 0,
        defaultValue: 4,
        min: 0,
        max: 24,
        step: 1,
        group: "border"
      },
      // ── spacing ──
      {
        key: "padding",
        label: "padding",
        type: "spacing",
        value: computed.padding,
        defaultValue: "4px 8px",
        group: "spacing"
      },
      {
        key: "height",
        label: "height",
        type: "range",
        value: parseFloat(computed.height) || 32,
        defaultValue: 32,
        min: 16,
        max: 80,
        step: 2,
        group: "spacing"
      },
      // ── content ──
      {
        key: "placeholder",
        label: "placeholder",
        type: "text",
        value: el.placeholder || "",
        defaultValue: "",
        group: "content"
      },
      {
        key: "autocomplete",
        label: "autocomplete",
        type: "boolean",
        value: el.autocomplete !== "off",
        defaultValue: false,
        group: "content"
      },
      {
        key: "spellcheck",
        label: "spellcheck",
        type: "boolean",
        value: el.spellcheck,
        defaultValue: false,
        group: "content"
      }
    ];
    return properties;
  }
  apply(target, key, value) {
    const el = target.element;
    if (key === "placeholder") {
      el.placeholder = String(value);
      return;
    }
    if (key === "autocomplete") {
      el.autocomplete = value ? "on" : "off";
      return;
    }
    if (key === "spellcheck") {
      el.spellcheck = Boolean(value);
      return;
    }
    if (key === "opacity") {
      el.style.opacity = String(Number(value) / 100);
      return;
    }
    const numericWithPx = ["font-size", "border-width", "border-radius", "height", "letter-spacing"];
    if (numericWithPx.includes(key) && typeof value === "number") {
      el.style.setProperty(key, `${value}px`);
      return;
    }
    el.style.setProperty(key, String(value));
  }
  reset(target) {
    const el = target.element;
    el.removeAttribute("style");
  }
  // ── helpers ──
  #rgbToHex(rgb) {
    const match = rgb.match(/\d+/g);
    if (!match || match.length < 3) return "#000000";
    const [r, g, b] = match.map(Number);
    return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
  }
};
var _inputAtomizer = new InputAtomizer();
window.ioc.register(`${ATOMIZER_IOC_PREFIX}input-atomizer`, _inputAtomizer);
EffectBus2.emit("atomizer:registered", { atomizer: _inputAtomizer });
console.log("[InputAtomizer] Loaded");

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
import { QueenBee as QueenBee2, EffectBus as EffectBus3 } from "@hypercomb/core";
var SYSTEM_PROMPT = `You are an assistant integrated into a spatial knowledge graph called Hypercomb.
You receive context gathered from content-addressed lineages (folder paths) and signatures (SHA-256 hashes).
Respond concisely and helpfully based on the provided context. Your response will be stored as a content-addressed resource.`;
var LlmQueenBee = class extends QueenBee2 {
  namespace = "diamondcoreprocessor.com";
  genotype = "assistant";
  command = "opus";
  aliases = [];
  description = "Send context to a Claude LLM and store the response as a resource";
  /** Set by the provider before invoke() to select which model to use */
  activeModel = "opus";
  async execute(args) {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn(`[llm] No API key. Set via: localStorage.setItem('${API_KEY_STORAGE}', 'sk-ant-...')`);
      EffectBus3.emit("llm:api-key-required", {});
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
    EffectBus3.emit("llm:request-start", { model, targets, contextRefs });
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
      EffectBus3.emit("llm:response", { model, targets, sig, contextRefs });
      EffectBus3.emit("llm:request-done", { model, targets, success: true });
      console.log(`[llm] ${this.activeModel} response stored: ${sig.slice(0, 12)}...`);
    } catch (err) {
      EffectBus3.emit("llm:error", { message: err?.message ?? "Unknown error" });
      EffectBus3.emit("llm:request-done", { model, targets, success: false });
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

// src/diamondcoreprocessor.com/assistant/structure.atomizer.ts
import { EffectBus as EffectBus4 } from "@hypercomb/core";
import { ATOMIZER_IOC_PREFIX as ATOMIZER_IOC_PREFIX2 } from "@hypercomb/core";
var STRUCTURE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/><line x1="12" y1="22" x2="12" y2="15.5"/><polyline points="22 8.5 12 15.5 2 8.5"/></svg>';
var StructureAtomizer = class {
  atomizerId = "structure-atomizer";
  name = "Structure";
  description = "Open a program node in DCP for editing";
  icon = STRUCTURE_ICON;
  targetTypes = ["structure-cell"];
  discover(target) {
    this.#openInDcp(target);
    return [];
  }
  apply() {
  }
  reset() {
  }
  #openInDcp(target) {
    const props = target.structureProps;
    if (!props) {
      console.warn("[StructureAtomizer] No structure properties on target:", target.targetId);
      return;
    }
    const lineage = String(props.lineage ?? "");
    const signature = String(props.signature ?? "");
    const kind = String(props.kind ?? "");
    if (!lineage) {
      console.warn("[StructureAtomizer] Missing lineage for target:", target.targetId);
      return;
    }
    const dcpOrigin = location.hostname === "localhost" ? "http://localhost:2400" : "https://diamondcoreprocessor.com";
    const params = new URLSearchParams();
    params.set("navigate", lineage);
    if (signature) params.set("signature", signature);
    if (kind) params.set("kind", kind);
    const url = `${dcpOrigin}?${params.toString()}`;
    window.open(url, "_blank");
    EffectBus4.emit("dcp:navigate", { lineage, signature, kind });
    console.log(`[StructureAtomizer] Opening DCP: ${lineage} (${kind})`);
  }
};
var _structureAtomizer = new StructureAtomizer();
window.ioc.register(`${ATOMIZER_IOC_PREFIX2}structure-atomizer`, _structureAtomizer);
EffectBus4.emit("atomizer:registered", { atomizer: _structureAtomizer });
console.log("[StructureAtomizer] Loaded");

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
  InputAtomizer,
  LlmQueenBee,
  MODELS,
  StructureAtomizer,
  buildMessages,
  callAnthropic,
  callAnthropicMultiTurn,
  computeThreadId,
  getApiKey,
  listThreads,
  loadThread,
  saveThread
};
