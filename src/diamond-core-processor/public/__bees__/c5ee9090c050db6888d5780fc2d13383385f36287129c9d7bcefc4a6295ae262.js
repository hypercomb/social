// src/diamondcoreprocessor.com/assistant/wiki.drone.ts
import { Drone, EffectBus, normalizeCell, hypercomb } from "@hypercomb/core";

// src/diamondcoreprocessor.com/assistant/llm-api.ts
var ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
var ANTHROPIC_VERSION = "2023-06-01";
var GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
var MODELS = {
  opus: "claude-opus-4-6",
  o: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  s: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
  h: "claude-haiku-4-5-20251001",
  gemini: "gemini-2.5-flash",
  g: "gemini-2.5-flash"
};
var API_KEY_STORAGE = "hc:anthropic-api-key";
var GEMINI_API_KEY_STORAGE = "hc:gemini-api-key";
var getApiKey = () => localStorage.getItem(API_KEY_STORAGE);
var getGeminiApiKey = () => localStorage.getItem(GEMINI_API_KEY_STORAGE);
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
var callGemini = async (model, systemPrompt, userMessage, apiKey, maxTokens = 4096) => {
  const url = `${GEMINI_ENDPOINT}/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: maxTokens }
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini API ${response.status}: ${text}`);
  }
  const json = await response.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
};

// src/diamondcoreprocessor.com/assistant/wiki.drone.ts
var PROPS_FILE = "0000";
var WIKI_BORDER_COLOR = "0.3,0.6,0.9";
var INDEX_BORDER_COLOR = "1.0,0.85,0.0";
var SYSTEM_PROMPT = `You are a knowledge decomposition engine for Hypercomb, a spatial knowledge graph with depth.

Given raw content (articles, notes, documents), extract key concepts and organize them into a HIERARCHICAL tree of wiki nodes. Top-level nodes are broad categories; child nodes are specific details nested inside them.

Return a JSON object:
{
  "nodes": [
    {
      "name": "short 1-4 word label",
      "summary": "10-30 word description",
      "tags": ["category1", "category2"],
      "parent": null,
      "relationships": [
        { "target": "other-node-name", "type": "related|parent|child|see-also" }
      ]
    },
    {
      "name": "specific detail node",
      "summary": "10-30 word description",
      "tags": ["subtopic"],
      "parent": "short 1-4 word label",
      "relationships": [
        { "target": "other-node-name", "type": "related|see-also" }
      ]
    }
  ],
  "enrichments": [
    {
      "name": "existing-node-name",
      "mergedSummary": "enriched 15-40 word description incorporating both the existing summary and new context",
      "newTags": ["additional-tag"],
      "relationships": [
        { "target": "other-node-name", "type": "related|parent|child|see-also" }
      ]
    }
  ],
  "indexSummary": "1-2 sentence summary of the ingested content"
}

Rules:
1. Extract 5-15 new nodes depending on content complexity.
2. Organize nodes into a DEEP HIERARCHY with as many levels as the content warrants. A node's parent can itself be a child of another node. Aim for 3+ levels of depth when the content supports it. For example: "Machine Learning" \u2192 "Neural Networks" \u2192 "Transformer Architecture" \u2192 "Self-Attention Mechanism".
3. Every node must have at least one relationship to another node.
4. Names must be concrete and specific, not vague categories.
5. The "parent" field references the name of another node in this response (at any depth). Top-level nodes have parent: null. A child can be a parent of deeper children.
6. If existing wiki nodes are listed with their summaries, DO NOT recreate them as new nodes. Instead, if the new content adds meaningful context to an existing node, include it in "enrichments" with a mergedSummary that integrates both the old and new understanding.
7. For enrichments, the mergedSummary should be a coherent single description \u2014 not a concatenation. Preserve the core meaning of the existing summary while weaving in new perspective.
8. Only enrich nodes where the new content genuinely adds new information. If an existing node is merely mentioned in passing, reference it in relationships instead.
9. Output ONLY the JSON object. No markdown, no wrapping text.`;
var WikiDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "assistant";
  description = "Decomposes dropped documents into interconnected wiki cells via LLM";
  deps = {
    store: "@hypercomb.social/Store",
    lineage: "@hypercomb.social/Lineage"
  };
  listens = ["wiki:ingest"];
  emits = [
    "cell:added",
    "wiki:indexed",
    "llm:request-start",
    "llm:request-done",
    "llm:error",
    "llm:api-key-required"
  ];
  #effectsRegistered = false;
  #busy = false;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("wiki:ingest", (payload) => {
      void this.#ingest(payload);
    });
  };
  async #ingest(payload) {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const geminiKey = getGeminiApiKey();
      const anthropicKey = getApiKey();
      const useGemini = !!geminiKey;
      if (!geminiKey && !anthropicKey) {
        console.warn(
          `[wiki] No API key. Set via:
  localStorage.setItem('${GEMINI_API_KEY_STORAGE}', 'AIza...')  (free)
  localStorage.setItem('${API_KEY_STORAGE}', 'sk-ant-...')`
        );
        EffectBus.emit("llm:api-key-required", {});
        return;
      }
      const store = this.resolve("store");
      const lineage = this.resolve("lineage");
      if (!store || !lineage) {
        console.warn("[wiki] Store or Lineage not available");
        return;
      }
      const explorerDir = await lineage.explorerDir();
      if (!explorerDir) return;
      const sourceBlob = new Blob([payload.content], { type: "text/plain" });
      const sourceSig = await store.putResource(sourceBlob);
      const existingWiki = await this.#findWikiCells(explorerDir);
      const existingNames = Array.from(existingWiki.keys());
      const truncated = payload.content.slice(0, 12e3);
      let userMessage;
      if (existingNames.length > 0) {
        const existingContext = Array.from(existingWiki.entries()).map(([name, info]) => {
          const wiki = info.props["wiki"] ?? {};
          const summary = wiki["summary"] ?? "";
          const sources = wiki["sources"] ?? [];
          const count = sources.length || 1;
          return `- ${name}: "${summary}" (${count} source${count === 1 ? "" : "s"})`;
        }).join("\n");
        userMessage = `Decompose this content into wiki nodes. The following wiki entries already exist with their current summaries \u2014 integrate with them where relevant. If the new content enriches an existing node's understanding, include it in the "enrichments" array with a merged summary. Do not recreate existing nodes as new nodes.

Existing nodes:
${existingContext}

---
${truncated}
---`;
      } else {
        userMessage = `Decompose this content into wiki nodes:

---
${truncated}
---`;
      }
      const model = useGemini ? MODELS["gemini"] : MODELS["sonnet"];
      EffectBus.emit("llm:request-start", { model });
      let responseText;
      if (useGemini) {
        responseText = await callGemini(model, SYSTEM_PROMPT, userMessage, geminiKey, 8192);
      } else {
        responseText = await callAnthropic(model, SYSTEM_PROMPT, userMessage, anthropicKey, 8192);
      }
      console.log("[wiki] Raw LLM response:", responseText.slice(0, 500));
      const parsed = this.#extractJson(responseText);
      if (!parsed || !parsed.nodes || parsed.nodes.length === 0) {
        console.warn("[wiki] No nodes extracted from LLM response");
        console.warn("[wiki] Full response:", responseText);
        EffectBus.emit("llm:request-done", { model, success: false });
        return;
      }
      const createdNodes = [];
      const sorted = this.#topoSort(parsed.nodes);
      const dirHandles = /* @__PURE__ */ new Map();
      for (const node of sorted) {
        const cellName = normalizeCell(node.name);
        if (!cellName) continue;
        if (existingWiki.has(cellName)) {
          const info = existingWiki.get(cellName);
          await this.#appendRelationships(info.parentDir, cellName, node.relationships);
          try {
            dirHandles.set(cellName, await info.parentDir.getDirectoryHandle(cellName));
          } catch {
          }
          continue;
        }
        let containerDir = explorerDir;
        if (node.parent) {
          const parentName = normalizeCell(node.parent);
          if (parentName && dirHandles.has(parentName)) {
            containerDir = dirHandles.get(parentName);
          } else if (parentName) {
            try {
              containerDir = await explorerDir.getDirectoryHandle(parentName, { create: true });
              dirHandles.set(parentName, containerDir);
            } catch {
            }
          }
        }
        try {
          const cellDir = await containerDir.getDirectoryHandle(cellName, { create: true });
          dirHandles.set(cellName, cellDir);
          const tags = ["wiki", ...(node.tags ?? []).map((t) => t.toLowerCase())];
          await this.#writeProps(cellDir, {
            tags,
            "border.color": WIKI_BORDER_COLOR,
            wiki: {
              summary: node.summary,
              relationships: (node.relationships ?? []).map((r) => ({
                target: normalizeCell(r.target) || r.target,
                type: r.type
              })),
              sources: [{
                fileName: payload.fileName,
                sig: sourceSig,
                addedAt: Date.now()
              }],
              createdAt: Date.now()
            }
          });
          if (node.parent) {
            await this.#writeProps(containerDir, { hasBranch: true });
          }
          EffectBus.emit("cell:added", { cell: cellName });
          createdNodes.push(node);
        } catch (err) {
          console.warn(`[wiki] Failed to create cell "${cellName}":`, err);
        }
      }
      let enrichedCount = 0;
      if (parsed.enrichments && parsed.enrichments.length > 0) {
        for (const enrichment of parsed.enrichments) {
          const cellName = normalizeCell(enrichment.name);
          if (!cellName || !existingWiki.has(cellName)) continue;
          const info = existingWiki.get(cellName);
          await this.#enrichCell(info.parentDir, cellName, enrichment, payload, sourceSig);
          enrichedCount++;
        }
      }
      await this.#updateIndex(explorerDir, parsed.indexSummary);
      EffectBus.emit("llm:request-done", { model, success: true });
      console.log(`[wiki] Created ${createdNodes.length}, enriched ${enrichedCount} cells from ${payload.fileName ?? "paste"}`);
      await new hypercomb().act();
    } catch (err) {
      EffectBus.emit("llm:error", { message: err?.message ?? "Unknown error" });
      EffectBus.emit("llm:request-done", { model: "", success: false });
      console.warn("[wiki] Ingestion failed:", err);
    } finally {
      this.#busy = false;
    }
  }
  // ── scan existing wiki cells ──────────────────────────────
  async #findWikiCells(dir, maxDepth = 4) {
    const result = /* @__PURE__ */ new Map();
    await this.#scanWikiCells(dir, result, 0, maxDepth);
    return result;
  }
  async #scanWikiCells(dir, result, depth, maxDepth) {
    if (depth > maxDepth) return;
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "directory") continue;
      if (name.startsWith("__")) continue;
      try {
        const cellDir = handle;
        const props = await this.#readProps(cellDir);
        const tags = props["tags"];
        if (tags?.includes("wiki")) {
          result.set(name, { props, parentDir: dir });
        }
        await this.#scanWikiCells(cellDir, result, depth + 1, maxDepth);
      } catch {
      }
    }
  }
  // ── topological sort: parents before children ─────────────
  #topoSort(nodes) {
    const byName = /* @__PURE__ */ new Map();
    for (const n of nodes) byName.set(normalizeCell(n.name), n);
    const sorted = [];
    const visited = /* @__PURE__ */ new Set();
    const visit = (node) => {
      const name = normalizeCell(node.name);
      if (visited.has(name)) return;
      visited.add(name);
      if (node.parent) {
        const parentName = normalizeCell(node.parent);
        const parentNode = byName.get(parentName);
        if (parentNode) visit(parentNode);
      }
      sorted.push(node);
    };
    for (const node of nodes) visit(node);
    return sorted;
  }
  // ── append relationships to existing cell ─────────────────
  async #appendRelationships(parentDir, cellName, newRels) {
    if (!newRels || newRels.length === 0) return;
    try {
      const cellDir = await parentDir.getDirectoryHandle(cellName);
      const props = await this.#readProps(cellDir);
      const wiki = props["wiki"] ?? {};
      const existing = wiki["relationships"] ?? [];
      const existingTargets = new Set(existing.map((r) => r.target));
      const toAdd = newRels.map((r) => ({ target: normalizeCell(r.target) || r.target, type: r.type })).filter((r) => !existingTargets.has(r.target));
      if (toAdd.length === 0) return;
      wiki["relationships"] = [...existing, ...toAdd];
      await this.#writeProps(cellDir, { wiki });
    } catch {
    }
  }
  // ── enrich existing cell with new context ──────────────────
  async #enrichCell(parentDir, cellName, enrichment, payload, sourceSig) {
    try {
      const cellDir = await parentDir.getDirectoryHandle(cellName);
      const props = await this.#readProps(cellDir);
      const wiki = props["wiki"] ?? {};
      if (enrichment.mergedSummary) {
        wiki["summary"] = enrichment.mergedSummary;
      }
      const existing = wiki["relationships"] ?? [];
      const existingTargets = new Set(existing.map((r) => r.target));
      const newRels = (enrichment.relationships ?? []).map((r) => ({ target: normalizeCell(r.target) || r.target, type: r.type })).filter((r) => !existingTargets.has(r.target));
      wiki["relationships"] = [...existing, ...newRels];
      const sources = wiki["sources"] ?? [];
      const alreadyHasSig = sources.some((s) => s.sig === sourceSig);
      if (!alreadyHasSig) {
        sources.push({
          fileName: payload.fileName,
          sig: sourceSig,
          addedAt: Date.now()
        });
      }
      wiki["sources"] = sources;
      delete wiki["source"];
      delete wiki["fileName"];
      delete wiki["sourceSig"];
      const existingTags = props["tags"] ?? [];
      const newTags = (enrichment.newTags ?? []).map((t) => t.toLowerCase());
      const mergedTags = [.../* @__PURE__ */ new Set([...existingTags, ...newTags])];
      if (sources.length >= 3 && !mergedTags.includes("hub")) {
        mergedTags.push("hub");
      }
      await this.#writeProps(cellDir, {
        tags: mergedTags,
        wiki
      });
    } catch (err) {
      console.warn(`[wiki] Failed to enrich cell "${cellName}":`, err);
    }
  }
  // ── update wiki-index cell ────────────────────────────────
  async #updateIndex(dir, indexSummary) {
    const allWiki = await this.#findWikiCells(dir);
    const indexName = "wiki-index";
    const entries = {};
    for (const [name, info] of allWiki) {
      if (name === indexName) continue;
      const wiki = info.props["wiki"] ?? {};
      const rels = wiki["relationships"] ?? [];
      const sources = wiki["sources"] ?? [];
      entries[name] = {
        summary: wiki["summary"] ?? "",
        connections: rels.length,
        sourceCount: sources.length || 1
      };
    }
    const entryCount = Object.keys(entries).length;
    if (entryCount === 0) return;
    const hubCount = Object.values(entries).filter((e) => e.sourceCount >= 3).length;
    const indexDir = await dir.getDirectoryHandle(indexName, { create: true });
    let summary = indexSummary ?? `Wiki index \u2014 ${entryCount} entries`;
    if (hubCount > 0) {
      summary += ` (${hubCount} hub${hubCount > 1 ? "s" : ""})`;
    }
    await this.#writeProps(indexDir, {
      tags: ["wiki", "index"],
      "border.color": INDEX_BORDER_COLOR,
      wiki: {
        summary,
        entries,
        lastUpdated: Date.now()
      }
    });
    EffectBus.emit("cell:added", { cell: indexName });
    EffectBus.emit("wiki:indexed", { indexCell: indexName, nodeCount: entryCount });
  }
  // ── JSON extraction ───────────────────────────────────────
  #extractJson(text) {
    let cleaned = text.replace(/^```(?:json)?\s*\n?/gm, "").replace(/\n?```\s*$/gm, "").trim();
    try {
      const p = JSON.parse(cleaned);
      if (p && Array.isArray(p.nodes)) return p;
    } catch {
    }
    const objectMatches = cleaned.match(/\{[\s\S]*\}/g) || [];
    for (const chunk of objectMatches.sort((a, b) => b.length - a.length)) {
      try {
        const obj = JSON.parse(chunk);
        if (obj && Array.isArray(obj.nodes)) return obj;
      } catch {
      }
    }
    try {
      const fixed = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      const match = fixed.match(/\{[\s\S]*\}/);
      if (match) {
        const obj = JSON.parse(match[0]);
        if (obj && Array.isArray(obj.nodes)) return obj;
      }
    } catch {
    }
    return null;
  }
  // ── props I/O (same pattern as ConversationDrone) ─────────
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
var _wiki = new WikiDrone();
window.ioc.register("@diamondcoreprocessor.com/WikiDrone", _wiki);
console.log("[WikiDrone] Loaded");
export {
  WikiDrone
};
