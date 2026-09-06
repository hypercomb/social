# Model mediation and the training prompt

**Status:** one bug fixed and §3.3 built (2026-09-06); three gaps remain.
**Direction from Jaime, 2026-09-06:** the mediator should decide *what level of
work* a request needs and therefore *which model* takes it; every model needs a
training prompt that teaches it to expand a signature, introspect the hive's
behaviours, and answer in natural language that the command line can run.

This document exists because most of that is already built and scattered across
four files. Anyone about to "add model selection" or "write a system prompt"
should read this first and discover they are mostly wiring, not authoring.

---

## 1. What already exists

### The mediator — `hypercomb-essentials/src/assistant/model-policy.ts`

`designate(need)` is the mediator. A caller states what the WORK needs and never
who should do it:

```ts
designate({ tier: 'deep', readsHive: true })   // → { providerId, label, vendor, tier, model, name, availability }
```

It already does more than "pick a model":

- **Usage plans** — Intelligence first (default), Balanced, Fast, Private,
  Economy. Each is a different ranking of exact-tier fit, live availability,
  locality and cost.
- **Per-tier pins** — "deep is always Opus" is one `setPin` call.
- **Step down, not out** (`tierUnderLoad`) — a provider reporting `limited`
  headroom answers one tier lighter rather than handing the work to a different
  vendor. Changing weight is a smaller surprise than changing voice.
- **Peers excluded from automatic picks** unless explicitly allowed — a free
  model on a stranger's machine is a fine choice a participant makes and an
  ugly one a routine makes for them.
- **`rankProviders`** returns the whole ordered roster, not just the winner, so
  a caller has a pre-authorised fallback plan rather than a single answer.

### The behaviour census — `hypercomb-core/src/core/machine-grammar.ts`

Every behaviour declares its own machine reach on itself (`QueenBee.machine`),
beside its description and examples. The model's vocabulary is DERIVED from the
live census. The hand-written five-name `CALLABLE_FORMS` table is gone and
ratcheted — it drifted toward "less than exists" and told a participant this
hive had no delete behaviour while `/remove` had shipped for months.

Default-deny survives: no `machine` block, no machine call.

### The training prompt — `hypercomb-shared/ui/chat-window/hypercomb-grammar.ts`

`hypercombGrammarInstruction(entries, grant)` already builds exactly the
artefact Jaime describes: stable instructions plus a live catalogue of every
callable grammar, its argument forms, its consequence and one worked example.
`callableBehaviours()` filters that catalogue through the `/grant` ceiling, so
a verb the grant refuses is **never taught** — the difference between a
boundary and a trap.

### The bridge's introspection doors — `claude-bridge.worker.ts`

- `behaviors-list` → every registered behaviour package as
  `{view, slashCommand, decorationKind, adoptable}`.
- `get-resource` → expand a signature to its bytes.
- `layer-at` / `layer-by-sig` → walk the tree.

So "expand a signature and read it" and "find out which behaviours exist" are
both already answerable over the bridge.

### The last mile — `search:prefill`

`command-line.component.ts:2046` listens for
`EffectBus.emit('search:prefill', { value, focus, select })`, which sets the
command line's text, focuses it and selects it. Jaime's "show that sentence and
then you can click return as if you typed it in" needs no new transport — this
is it.

---

## 2. The bug that was fixed (2026-09-06)

**Symptom.** Two CLIs parked on the bridge (Claude Code, Codex), both announced
and enabled, both shown in the providers console — and neither ever reported as
active. The chat's foot said "Local model" instead.

**Cause.** One line in `model-policy.ts`:

```ts
// before
if (!need.readsHive && provider.transport === 'agent-bridge') return false
```

A bridge could only be considered by work that *hard-required* a hive reader.
But `readsHive: true` also **excludes every keyed and local provider**, so the
chat window could not ask for it without shutting out everyone else. It
therefore asked for neither — `{ tier: 'fast', streaming: true }` — directly
contradicting its own docstring ("a chat question is the deep, hive-reading
kind"). Result: no bridge could ever be designated for the one surface built to
reach one, and the console's "active" marker (computed from the same literal,
copied) agreed with the chat by being wrong in the same way.

**Fix.** The real precondition for a bridge is not the weight of the work but
whether the **caller can wait for an ask** — a bridge answers through the
broker, as a record a parked CLI drains, never as a fetch. That is now stated:

```ts
// after
if (!need.readsHive && !need.viaAsk && provider.transport === 'agent-bridge') return false
```

`CHAT_NEED = { viaAsk: true, streaming: true }` is exported once and read by
both the chat window (through `llmPolicy.chatNeed`, since the shell may never
import a module) and the providers console. The tier is deliberately unstated —
omitted means balanced, and what weight a question deserves is a judgement
about the question, not a constant about the surface. See §3.1.

Guarded by four tests in `model-policy.spec.ts` (`describe('a chat turn')`),
verified to fail against the old rule by returning `my-machine` — the exact
"Local model" symptom.

---

## 3. The gaps

### 3.1 Nothing derives the tier — this is the missing half of the mediator

`ModelNeed.tier` is **always stated by the caller**, and every caller hardcodes
a constant. The policy is a very good router with no one deciding what to route.
That is precisely Jaime's "the mediator should decide what level of work needs
to be done".

The seam is already the right shape: a function from a request to a `ModelNeed`.

```ts
// sketch — does not exist yet
const needFor = (request: { prompt: string; context: readonly string[]; selection: number }): ModelNeed
```

Signals available at the call site without any new plumbing: prompt length, how
many context signatures rode along, whether the turn names a behaviour verb,
whether tiles are selected, whether the conversation already has a transcript.
The honest first version is a small, legible heuristic that a participant can
overrule — not a classifier, and never a second model call to decide which model
to call.

**Design constraint:** whatever it decides must be *visible before the question
leaves*. `Designation` already carries the tier it landed on and the chat window
already reports it, exactly so that "balanced where deep was expected" is seen
rather than inferred from a disappointing answer.

### 3.2 There is no orchestration level

Jaime: "We can always up the orchestration level if we want a little more agent
work." Nothing like this exists. `usagePlan` is the nearest thing and it is a
different axis — it trades cost against locality, not effort against thoroughness.

An orchestration level is a **bias on the derived need** from §3.1, not a new
selector: at a low level a request resolves to a single balanced answer; at a
high level the same request resolves to deep work, more context, and a
willingness to spend several agent turns. It belongs beside `usagePlan` in
`LlmPolicyStore` (device-local, `change` on every move) and it must not be a
second thing to keep in sync with the tier.

### 3.3 The training prompt never reaches the tier that could use it — BUILT 2026-09-06

**Built.** The catalogue moved DOWN to core (`core/machine-census.ts`:
`machineCatalogue` + `callableBehaviours`), because essentials may never import
from shared and a second renderer in essentials would be the `CALLABLE_FORMS`
mistake again. `hypercomb-grammar.ts` now renders from that one function and
re-exports it, so the shell's framing changed by not one word.

`llm.queen.ts` mints the bridge's own framing (`bridgeInstruction`), stores it
with `putResource`, and carries **`instructionSig`** on both the `mode:'chat'`
payload and the note-bound ask. A signature rather than inline text: an ask
record IS a stored resource, so inlining a multi-kilobyte census would re-store
it every turn, while identical bytes dedup to one copy pointed at by every ask.
It also puts the responder's first move where it belongs — the instruction says
"expand signatures with `get-resource`", and reaching the instruction itself
that way is that lesson performed.

`watch-asks.cjs` forwards the field (it drops anything it does not name) and
the bridge-listen skill tells a session to expand it first. Guarded by
`machine-census.spec.ts` (8) and `ask-instruction.spec.ts` (5), the latter
pinning: signature not inline, the census grant-filtered, a non-declaring
behaviour absent, dedup across turns, and the send surviving a store that
cannot mint — a question that loses its vocabulary is degraded, one that never
leaves is lost.

**Still true, and the reason §3.4 matters:** the instruction deliberately
promises no mechanism that does not exist. It does not tell a model its grammar
line will be offered to the participant for a keypress, because that surface is
not built.

The original problem, for the record:

This is the sharpest gap and it matches Jaime's message exactly.

`hypercombActionProviderId()` returns `'local'` or `undefined`
(`hypercomb-grammar.ts:44`). So `hypercombGrammarInstruction` and the
`hypercomb_act` tool are attached **only** when the participant's own local
model answers. The census-derived vocabulary is carefully built and then
withheld from every other model.

What each tier actually receives today:

| Tier | Gets the census vocabulary? | Learns Hypercomb from |
|---|---|---|
| Local model | Yes — instruction + `hypercomb_act` tool | The prompt, freshly derived |
| Claude Code (bridge) | No | `.claude/skills/bridge-listen/SKILL.md` on disk |
| Codex / Gemini / Grok (bridge) | No | **Nothing** |
| Keyed API providers | No | Nothing |

The bridge ask payload carries `prompt`, `transcript`, `context` sigs,
`references`, `segments` — the *material* but no *instructions*. Claude Code
gets away with it because a skill file happens to be checked into this repo.
Announce Codex and it receives a chat turn with no idea that signatures expand,
that `behaviors-list` exists, or what a grammar line looks like.

**The fix is small and it is wiring, not authoring:** the ask record should
carry the same census-derived instruction the local model gets. One field on the
`mode:'chat'` payload, built by the function that already exists. Every bridge
then learns the hive from the hive, and a behaviour added tomorrow is in every
model's vocabulary the moment it registers — which was the whole point of
retiring `CALLABLE_FORMS`.

### 3.4 The model executes; Jaime wants it to propose

Today the local model calls `hypercomb_act` and `executeHypercombPlan` runs the
grammars. Jaime's shape is different and better for a tier you trust less:

> choose the behaviors you want to activate, make a natural language sentence,
> send it back to the result of the chat, have that interpreted in the command
> line behavior mode, show that sentence, and you can click return as if you
> typed it in. Or in the case of an agent it may just run it autonomously.

Two properties worth keeping from that description:

1. **The proposal is the artefact.** A sentence in the command line is
   inspectable, editable, and undoable-by-not-pressing-Return. A function call
   is none of those.
2. **The same sentence serves both tiers.** A participant presses Return; an
   agent with standing authority runs it. One representation, two levels of
   trust — which is the orchestration level of §3.2 applied to execution rather
   than to selection.

The transport exists (`search:prefill`). What is missing is the convention that
a model's answer *may* carry a proposed line, and the command-line affordance
that shows it as a proposal rather than as something already typed.

---

## 4. Recommended order

1. ~~**§3.3 first** — carry the census instruction in the bridge ask payload.~~
   **Done 2026-09-06.** A bridged CLI now arrives knowing what this hive can do.
2. **§3.4** — the proposed-sentence convention, reusing `search:prefill`. It
   makes every model's output actionable without granting any model execution.
3. **§3.1** — derive the need. Do this only after 1 and 2, because the right
   heuristic is much easier to see once several tiers are actually answering.
4. **§3.2** — the orchestration level, last, as a bias on §3.1 rather than as a
   new mechanism.

## 5. Files

| What | Where |
|---|---|
| The mediator | `hypercomb-essentials/src/assistant/model-policy.ts` |
| Who may be called at all | `hypercomb-essentials/src/assistant/llm-dispatch.ts` |
| Behaviour self-declaration | `hypercomb-core/src/core/machine-grammar.ts` |
| Grant ceiling | `hypercomb-core/src/core/machine-admission.ts` |
| Training prompt + catalogue | `hypercomb-shared/ui/chat-window/hypercomb-grammar.ts` |
| Chat send + host path | `hypercomb-shared/ui/chat-window/chat-window.component.ts` |
| Bridge ask minting | `hypercomb-essentials/src/assistant/llm.queen.ts` |
| Bridge ops | `hypercomb-essentials/src/assistant/claude-bridge.worker.ts` |
| Console | `hypercomb-essentials/src/assistant/providers-window.view.ts` |
| Bridge roster (data) | `scripts/bridge/agent-bridges.json` |
