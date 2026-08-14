# AI as a First-Class Citizen — the Plan

**Goal.** Anyone can use Hypercomb's AI freely, with whatever they already
have: a Claude Code subscription, an API key from any major vendor, or a
local model — picked from a branded hexagon page, guided through setup on
first touch, and answered in a chat window that earns the word *first-class*.
This is the primary focus until it stands on its own.

Companion tutorial (ship-now half): [claude-bridge-setup.md](claude-bridge-setup.md).

---

## 1. The elegant core: one descriptor, three transports

The repo already contains three AI paths that share nothing but a model-name
string. They are not competing designs — they are three **transport classes**,
and that observation is the whole architecture:

```
transport: 'browser-http'  → direct fetch with the participant's key    (today: llm-api.ts, Anthropic-only)
transport: 'host-relay'    → NIP-98 POST to <host>/ai/ask               (today: host-ai.service.ts)
transport: 'agent-bridge'  → mint a kind:'ask' record for a session     (today: llm.queen.ts → Claude Code)
```

Everything else in this plan is one registry over that field.

### LlmProviderRegistry (essentials)

`assistant/llm-provider-registry.ts`, registered
`@diamondcoreprocessor.com/LlmProviderRegistry`. Pattern copied verbatim from
`commands/visual-bee-registry.ts` — descriptors declared in code by small
per-vendor modules, one IoC singleton, EventTarget change notification.

```ts
type LlmProviderDescriptor = {
  id: string                       // 'anthropic', 'openai', 'google', 'xai', …
  label: string                    // 'Claude', 'ChatGPT', 'Gemini', 'Grok', …
  vendor: string                   // keys into VENDOR_BODY (agent-model.ts) — ONE colour source
  transport: 'browser-http' | 'host-relay' | 'agent-bridge'
  endpoint?: string
  models: { name: string; id: string; tier: 'deep' | 'balanced' | 'fast' }[]
  defaultModel: string
  docsUrl: string                  // "get your key here" — the guided setup link
  keyPattern?: RegExp              // sanity-check a pasted key (sk-ant-…, sk-…, AIza…)
  toRequest(prompt, model, opts): RequestInit      // the adapter
  fromResponse(json): LlmResult
  fromStreamEvent?(evt): string                    // SSE chunk decoder
}
```

One file per vendor under `assistant/providers/` (anthropic, openai, google,
xai, deepseek, mistral, local/ollama). The Anthropic adapter is extracted from
`llm-api.ts` — endpoint, `x-api-key`, version header, `cache_control` all move
behind it; `llm-api.ts` becomes a back-compat shim until
`translation.service.ts` and `layer-edit-ai.service.ts` migrate.

`assistant/llm-dispatch.ts` is the one seam every caller uses:
`callModel({providerId, model, messages, signal})` /
`streamModel(...)` — resolve descriptor → resolve key → adapter → normalized
`{text, stopReason, inputTokens, outputTokens, model}`.

### LlmKeyStore (core — NOT shared; essentials may not import shared)

`hypercomb-core/src/core/llm-keys.ts`, self-registers
`@hypercomb.social/LlmKeyStore`. Shape copied from
`hypercomb-shared/core/secret-store.ts` (EventTarget, `#fields`, `change`
events). Storage scheme `hc:llm:<providerId>:key`; reads the legacy
`hc:anthropic-api-key` as a read-only drain fallback, never writes it.
API: `get(id)`, `set(id, key)`, `clear(id)`, `configured(): string[]`.

**Keys are device-local truth.** Never in a layer, decoration, resource,
EffectBus payload, toast, or log line. Never synced, never shared, never in
history. Add the missing doctrine ratchet to `doctrine.spec.ts` before
shipping N keys: no plaintext credential in any content-addressed write.

`ai-key.drone.ts` generalizes: one command-line indicator per configured
provider (spend must never be invisible).

---

## 2. The provider picker — a branded hexagon page at `/providers`

A **LaunchGroup** (`hypercomb-shared/core/providers-group.ts`), built like
`help-group.ts` (clustered islands) with membership derived from the registry
like `games-group.ts` (zero hardcoded roster). Registration = one import line
in `launch-groups.ts`.

- One **island per vendor**: a header tile wearing the company's look, its
  model tiles clustered around it (`launch:target` decorations with
  `role:'header' | 'action'`, `group:'gN'`,
  `groupSig = sign('group:llm:provider:<vendor>')`).
- **Branding** comes from `VENDOR_BODY` — the repo's existing "recognisable
  colours, not official brand assets" posture, which is exactly right for
  third-party marks. Logo art rides the tile-art pipeline
  (`put-resource` → merge props `small.image`/`flat.small.image`/`large.image`
  → `bag-set properties` → `stamp` nudge). **No text in the art**; the
  platform draws labels. `substrate:false` so a theme pass never redresses a
  logo.
- **Click = the whole promise**:

```
activate(member):
  key configured (or transport needs none) → chat:open {provider, model}
  no key yet → provider-setup:open {provider}   // guided key setup, then straight into chat
```

- **Guided key setup** is a framework-free custom element
  (`hc-provider-setup`, contributed via the ShellSurfaceRegistry `element:`
  shape — precedent: `skills-window.view.ts`). Password input, paste, "test
  this key" (one cheap dispatch through the adapter), link to the vendor's
  `docsUrl`, done. Modelled on `mesh-modal` — the one sanctioned credential UI.

- **Marks** (declared vocabulary, one `/keyword` registration pass):
  `providers` on the collection; `provider` + vendor word on provider tiles;
  `model` + vendor + tier on model tiles. Classification lives on tiles;
  key-configured state is resolved live from LlmKeyStore — **marks classify,
  never resolve**.

The command line follows the same roster: today's hardcoded
`opus|sonnet|haiku|fable` lists (chat window `MODELS`, three whitelists in
`command-line.component.ts`) all become registry lookups, so `/gemini`,
`/grok`, `/gpt` appear the day their descriptor registers.

---

## 3. Chat window uplift — the 50,000× list, prioritized

**P0 — what caps perceived quality today**
1. **Markdown rendering** of turns (headings, lists, tables, fenced code with
   copy button, autolinked URLs) + **hive-path links** — an answer naming
   `dolphin/site` navigates there. `highlight.js` is already a dependency.
2. **Per-message actions** — copy, "put this on the current tile", atomize
   this, retry, edit-and-resend.
3. **Stop button** — `HostAiService.ask` already accepts an AbortSignal nobody
   passes; the bridge tier already has `AgentRegistry.stop`.
4. **Waiting honesty** — elapsed time, "nothing is listening — start a
   session" hint off `bridge:status`, withdraw-the-ask action.
5. **Scroll anchoring** — stop force-pinning `scrollTop` on every chunk; near-
   bottom check + scroll-to-bottom pill.

**P1 — visual and structural**
6. Typography inversion fix — messages are currently the *smallest* text in
   the panel (0.8em under 0.9em chrome). The reading surface leads.
7. Registry-driven provider/model picker (vendor colour + tier) replacing the
   native `<select>`.
8. Footer compaction — three stacked micro-rows become one row with a target
   chip.
9. A real empty state — which tier answers, what the deep tier can do, three
   example prompts.
10. **Mobile bottom-sheet** — copy `tags-viewer.component.scss` verbatim; this
    is the recorded mobile-toolwindow debt (z 100002 over the control
    cluster).

**P2 — capability**
11. `@`-mention of tiles, image paste, drop target (command line already has
    the intellisense machinery).
12. Draft persistence (`context-basket.ts` ships unused
    `saveDraft`/`readDraft`).
13. Context attach/detach from the window (today report-only).
14. Transcript-boundary visibility (`TRANSCRIPT_TURNS = 12` is invisible;
    `thread-read` exists for deeper history).
15. Bridge-tier streaming feel — render `agent-progress` as live thinking.
16. Accessibility — `role="log"`, aria-live on completed replies, labelled
    turns.
17. Stable turn keys (content hash, not `at:index`).
18. Component tests for the two-tier fallback and mid-stream thread switch.

---

## 4. Beyond Claude: agent-bridge adapters and the orchestrator

The bridge protocol is **already vendor-neutral**: an ask is a JSON record, a
responder is anything that polls `optimization-list` and answers with
`chat-reply`/`note-add` over a WebSocket. `drain-tick.cjs` is the only place
that literally spawns `claude -p`.

- **Adapter layer**: `responderFor(provider)` in the drain — one small module
  per agent CLI (`claude -p`, `gemini`, `codex exec`, `grok`, local
  `ollama run`), each mapping the ask's `{provider, model}` hint to its own
  spawn incantation. A parked interactive session of *any* of these tools can
  run the same watcher; the watcher is just JSON lines.
- **The orchestrator/delegator**: with several responders live, the existing
  `orchestrator.drone.ts` + `agent-registry.service.ts` (which already
  classify agents by vendor and render vendor-coloured bees over the hive)
  grow a **delegation policy**: route by the ask's model hint; split a
  structural ask across responders; let `/organize` fan out and reconcile.
  The hive already renders every vendor's bee in its family colour — the
  swarm-of-vendors picture is already drawn, it just needs more than one
  vendor actually flying.
- **Honesty rule**: only `agent-bridge` responders can *read the hive*. A
  browser-http Gemini key answers from the prompt + attached context sigs the
  ask carries; it does not walk your tree. The picker page says which is
  which (a small "reads your hive" badge on agent-backed tiles).

## 5. One-click hosts

The setup page (and the `/providers` collection's header tile) links three
ladders, easiest first:

1. **Use it in the browser** — nothing to install; host-relay tier answers.
2. **One-click app** — Windows/Mac/Linux native client installers (the
   `hive://` client). The link block is wired to the DCP install door the
   moment installers are published per-platform.
3. **Full local loop** — the Claude Code + bridge tutorial (Path A), for the
   people who want the deep tier reading their whole hive.

---

## 6. Phasing

| Phase | Ships | Depends on |
|---|---|---|
| 1 | Tutorial + npm bridge scripts (**done** — this pass) | — |
| 2 | LlmKeyStore (core) + registry + anthropic/openai/google/xai adapters + dispatch seam + credential ratchet | — |
| 3 | `/providers` launch page + guided key setup + logo art pass + marks | 2 |
| 4 | Chat P0 (markdown, actions, stop, waiting, scroll) | — (parallel with 2–3) |
| 5 | Chat P1 + mobile sheet | 4 |
| 6 | Drain adapters for other agent CLIs + orchestrator delegation | 2 |
| 7 | Chat P2 + one-click installer wiring | 3–5 |

**Traps already known** (respect or bleed): doctrine ratchets (no `<hc-*>` in
app.html, no hardcoded hex, pool meanings need a colon — `llm:providers`),
essentials `side-effects.ts` is generated (`npm run prepare`), Angular
per-component style budget freezes deploys silently, build order
core→essentials, one renderer slot, never wipe OPFS, and **every phase owes
its hive mirror in the same pass or a mirror-queue entry**.
