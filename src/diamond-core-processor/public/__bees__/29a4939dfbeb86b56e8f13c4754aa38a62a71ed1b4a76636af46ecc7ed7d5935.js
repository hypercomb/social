// src/diamondcoreprocessor.com/assistant/atomize.drone.ts
import { Drone, EffectBus, hypercomb, normalizeCell } from "@hypercomb/core";

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

// src/diamondcoreprocessor.com/assistant/atomize.drone.ts
var SUBTOPIC_COUNT = 7;
var SYSTEM_PROMPT = `You are a precise decomposition engine for a spatial knowledge graph called Hypercomb.

Your job: Given a single subject, break it down into its constituent parts \u2014 the smaller, more specific pieces that compose it. Each piece should be concrete enough to explore further on its own.

Produce a flat JSON array where each element is an object with:
- "name": a short 1\u20133 word label (will become a tile label, lowercase, no special characters)
- "detail": a concise descriptive phrase (5\u201312 words)

Rules:
1. Output exactly ${SUBTOPIC_COUNT} items.
2. Items must be unique and non-overlapping.
3. Items should be concrete constituents, not vague categories.
4. Output ONLY the JSON array. No markdown, no wrapping text.`;
var AtomizeDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "assistant";
  description = "expands a tile into constituent parts via Claude Haiku";
  deps = {
    lineage: "@hypercomb.social/Lineage",
    navigation: "@hypercomb.social/Navigation",
    store: "@hypercomb.social/Store"
  };
  listens = ["tile:action"];
  emits = ["cell:added"];
  #effectsRegistered = false;
  #busy = false;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("tile:action", (payload) => {
      if (payload.action !== "expand") return;
      void this.#expand(payload.label);
    });
  };
  async #expand(rawLabel) {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const apiKey = getApiKey();
      if (!apiKey) {
        console.warn(`[expand] No API key. Set via: localStorage.setItem('${API_KEY_STORAGE}', 'sk-ant-...')`);
        EffectBus.emit("llm:api-key-required", {});
        return;
      }
      const label = normalizeCell(rawLabel) || rawLabel;
      const userMessage = `Decompose this into ${SUBTOPIC_COUNT} constituent parts:

Topic: ${label}`;
      const responseText = await callAnthropic(
        MODELS["haiku"],
        SYSTEM_PROMPT,
        userMessage,
        apiKey,
        1024
      );
      const parts = this.#extractArray(responseText);
      if (parts.length === 0) {
        console.warn("[expand] No parts extracted from response");
        return;
      }
      for (const item of parts) {
        const name = normalizeCell(item.name);
        if (!name) continue;
        EffectBus.emit("cell:added", { cell: name });
      }
      console.log(`[expand] ${label} \u2192 ${parts.length} parts`);
      await new hypercomb().act();
    } catch (err) {
      console.warn("[expand] failed:", err);
    } finally {
      this.#busy = false;
    }
  }
  #extractArray(text) {
    try {
      const p = JSON.parse(text);
      if (Array.isArray(p)) return p;
    } catch {
    }
    const m = text.match(/\[[\s\S]*\]/g) || [];
    for (const chunk of m.sort((a, b) => b.length - a.length)) {
      try {
        const arr = JSON.parse(chunk);
        if (Array.isArray(arr)) return arr;
      } catch {
      }
    }
    return [];
  }
};
var _atomize = new AtomizeDrone();
window.ioc.register("@diamondcoreprocessor.com/AtomizeDrone", _atomize);
console.log("[AtomizeDrone] Loaded");
export {
  AtomizeDrone
};
