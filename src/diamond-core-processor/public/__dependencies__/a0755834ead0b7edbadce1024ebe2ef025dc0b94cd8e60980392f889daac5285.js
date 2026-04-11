// @diamondcoreprocessor.com/safety
// hypercomb-essentials/src/diamondcoreprocessor.com/safety/link-safety.service.ts
import { EffectBus } from "@hypercomb/core";
var LLM_ENDPOINT = "http://127.0.0.1:4220/v1/chat/completions";
var LLM_MODEL = "llama-3.2-3b-instruct";
var LLM_TIMEOUT_MS = 5e3;
var TRUSTED_HOSTS = /* @__PURE__ */ new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "m.youtube.com",
  "music.youtube.com",
  "github.com",
  "www.github.com",
  "wikipedia.org",
  "en.wikipedia.org",
  "stackoverflow.com",
  "developer.mozilla.org",
  "docs.google.com",
  "drive.google.com",
  "maps.google.com",
  "www.google.com",
  "gitlab.com",
  "bitbucket.org",
  "npmjs.com",
  "www.npmjs.com",
  "crates.io",
  "pypi.org"
]);
var SAFETY_SYSTEM_PROMPT = `You are a URL safety evaluator for a collaborative workspace where people share links.
Given a URL, evaluate whether it is safe to display and click.

Check for:
- Phishing or credential harvesting (lookalike domains, e.g. g00gle.com)
- Known malware distribution patterns
- Deceptive URL patterns (homograph attacks, misleading subdomains)
- URL shorteners that could mask destination (flag as warn, not deny)

Respond ONLY with JSON: { "decision": "allow"|"deny"|"warn", "reason": "brief explanation" }`;
var SAFETY_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "SafetyVerdict",
    schema: {
      type: "object",
      properties: {
        decision: { type: "string", enum: ["allow", "deny", "warn"] },
        reason: { type: "string" }
      },
      required: ["decision", "reason"]
    }
  }
};
var LinkSafetyService = class {
  #queue = Promise.resolve({ decision: "allow", reason: "" });
  /** Check whether a URL is safe. Queued so concurrent calls don't overwhelm the LLM. */
  check = (url) => {
    const next = this.#queue.then(() => this.#evaluate(url));
    this.#queue = next.catch(() => ({ decision: "allow", reason: "internal error" }));
    return next;
  };
  // ── internal ─────────────────────────────────────────────────
  async #evaluate(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (TRUSTED_HOSTS.has(hostname)) {
        return { decision: "allow", reason: "trusted domain" };
      }
      for (const trusted of TRUSTED_HOSTS) {
        if (hostname.endsWith("." + trusted)) {
          return { decision: "allow", reason: "trusted domain" };
        }
      }
    } catch {
      return { decision: "deny", reason: "invalid URL" };
    }
    try {
      return await this.#callLLM(url);
    } catch {
      EffectBus.emit("link:safety-unavailable", { url });
      return { decision: "allow", reason: "Safety check unavailable" };
    }
  }
  async #callLLM(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      const response = await fetch(LLM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: LLM_MODEL,
          temperature: 0.1,
          response_format: SAFETY_SCHEMA,
          messages: [
            { role: "system", content: SAFETY_SYSTEM_PROMPT },
            { role: "user", content: `Evaluate this URL: ${url}` }
          ]
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const raw = (await response.json())?.choices?.[0]?.message?.content ?? "";
      return this.#parseVerdict(raw);
    } finally {
      clearTimeout(timer);
    }
  }
  #parseVerdict(text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.decision === "allow" || parsed.decision === "deny" || parsed.decision === "warn") {
        return { decision: parsed.decision, reason: String(parsed.reason ?? "") };
      }
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          if (parsed.decision === "allow" || parsed.decision === "deny" || parsed.decision === "warn") {
            return { decision: parsed.decision, reason: String(parsed.reason ?? "") };
          }
        } catch {
        }
      }
    }
    return { decision: "allow", reason: "Could not parse safety verdict" };
  }
};
window.ioc.register(
  "@diamondcoreprocessor.com/LinkSafetyService",
  new LinkSafetyService()
);
export {
  LinkSafetyService
};
