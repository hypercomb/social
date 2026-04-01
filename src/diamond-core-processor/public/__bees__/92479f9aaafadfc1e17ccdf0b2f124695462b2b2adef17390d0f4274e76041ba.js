// src/diamondcoreprocessor.com/assistant/atomize.drone.ts
import { Drone, EffectBus, hypercomb, normalizeSeed } from "@hypercomb/core";

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
var EXPAND_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
var ACTION_DESCRIPTOR = {
  name: "expand",
  svgMarkup: EXPAND_SVG,
  x: -25.25,
  y: 5,
  hoverTint: 14207231,
  profile: "private"
};
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
var AtomizerSession = class {
  target;
  provider;
  atoms;
  activeStrategy;
  #strategies;
  constructor(target, provider, atoms, strategies, initialStrategy) {
    this.target = target;
    this.provider = provider;
    this.atoms = atoms;
    this.#strategies = strategies;
    this.activeStrategy = initialStrategy;
  }
  setStrategy(name) {
    if (name === this.activeStrategy) return;
    const current = this.#strategies.get(this.activeStrategy);
    const next = this.#strategies.get(name);
    if (!next) return;
    current?.exit();
    this.activeStrategy = name;
    next.switchTo(this.atoms);
  }
  enter() {
    const strategy = this.#strategies.get(this.activeStrategy);
    strategy?.enter(this.provider, this.atoms);
  }
  exit() {
    const strategy = this.#strategies.get(this.activeStrategy);
    strategy?.exit();
    this.provider.reassemble();
  }
};
var AtomizeDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "atomizes tiles (Claude Haiku) and UI components (display strategies)";
  deps = {
    lineage: "@hypercomb.social/Lineage",
    navigation: "@hypercomb.social/Navigation",
    store: "@hypercomb.social/Store"
  };
  listens = [
    "render:host-ready",
    "tile:action",
    "atomize:trigger",
    "atomize:set-strategy",
    "atomize:close"
  ];
  emits = [
    "overlay:register-action",
    "seed:added",
    "atomize:mode",
    "atomize:atoms",
    "atomize:strategy-changed"
  ];
  #registered = false;
  #effectsRegistered = false;
  #busy = false;
  // --- strategy registry ---
  #strategies = /* @__PURE__ */ new Map();
  #session = null;
  /** Register a display strategy (called by strategy modules at load time) */
  registerStrategy(strategy) {
    this.#strategies.set(strategy.name, strategy);
  }
  /** Get the current atomizer session (for external queries) */
  get session() {
    return this.#session;
  }
  /** Get all registered strategy names */
  get availableStrategies() {
    return [...this.#strategies.keys()];
  }
  // --- lifecycle ---
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("render:host-ready", () => {
      if (this.#registered) return;
      this.#registered = true;
      this.emitEffect("overlay:register-action", [ACTION_DESCRIPTOR]);
    });
    this.onEffect("tile:action", (payload) => {
      if (payload.action !== "expand") return;
      void this.#expand(payload.label);
    });
    this.onEffect(
      "atomize:trigger",
      (payload) => {
        void this.#atomizeComponent(payload.target, payload.strategy);
      }
    );
    this.onEffect(
      "atomize:set-strategy",
      (payload) => {
        if (!this.#session) return;
        this.#session.setStrategy(payload.strategy);
        this.emitEffect("atomize:strategy-changed", {
          strategy: payload.strategy
        });
      }
    );
    this.onEffect("atomize:close", () => {
      this.#closeSession();
    });
  };
  // ---------------------------------------------------------------------------
  // UI component atomization
  // ---------------------------------------------------------------------------
  async #atomizeComponent(target, strategyName) {
    this.#closeSession();
    const ioc = globalThis.ioc;
    const provider = ioc?.get(target);
    if (!provider) {
      console.warn(`[atomize] No AtomizerProvider found for: ${target}`);
      return;
    }
    const atoms = provider.discover();
    if (atoms.length === 0) {
      console.warn(`[atomize] No atoms discovered for: ${target}`);
      return;
    }
    const strategy = strategyName ?? this.#strategies.keys().next().value;
    if (!strategy || !this.#strategies.has(strategy)) {
      console.warn(`[atomize] No display strategy available`);
      return;
    }
    this.#session = new AtomizerSession(
      target,
      provider,
      atoms,
      this.#strategies,
      strategy
    );
    this.#session.enter();
    this.emitEffect("atomize:mode", { active: true, target, strategy });
    this.emitEffect("atomize:atoms", { atoms, target });
    console.log(
      `[atomize] ${target} \u2192 ${atoms.length} atoms (strategy: ${strategy})`
    );
  }
  #closeSession() {
    if (!this.#session) return;
    this.#session.exit();
    this.#session = null;
    this.emitEffect("atomize:mode", { active: false, target: "", strategy: "" });
  }
  // ---------------------------------------------------------------------------
  // Tile decomposition (original behavior, unchanged)
  // ---------------------------------------------------------------------------
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
      const label = normalizeSeed(rawLabel) || rawLabel;
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
        const name = normalizeSeed(item.name);
        if (!name) continue;
        EffectBus.emit("seed:added", { seed: name });
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
