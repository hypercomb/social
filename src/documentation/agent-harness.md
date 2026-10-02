# The agent harness — a signed, swappable loop

*jwize, 2026-09-27: "we are missing the grand overall picture to build this
into a customizable harness. Let's use the latest and greatest theory on this,
doing it the hypercomb way."* This is that picture. It names what the chat's
agent loop is made of today, what the field converged on by September 2026,
and how the two become ONE thing: a harness that is content — signed,
sig-addressed, held in a pool of meaning, swappable like a theme, shareable
across the network — with the shipped loop as its default.

Doctrine that binds this document: [known-location-pools](known-location-pools.md),
[hypergraph-molecule-lineage](hypergraph-molecule-lineage.md),
[life-primitive](life-primitive.md), [everything-is-a-beehavior](everything-is-a-beehavior.md),
[hive-read-fence](hive-read-fence.md), [jev-decisions](jev-decisions.md),
[chat-route](chat-route.md), [replayable-agent-loop](replayable-agent-loop.md),
[model-mediation-and-the-training-prompt](model-mediation-and-the-training-prompt.md),
[module-sandbox](module-sandbox.md).

## 1. What exists today, as one machine

Everything below is built and live. It is listed as the PARTS of a harness,
because that is what it already is — the parts are just wired by constants in
code rather than named by a record.

| Part | What it is | Where |
|---|---|---|
| **Tools** | Plain-text fences the model ends a reply with: `hypercomb-read`, `hypercomb-do`, `hypercomb-write`, `hypercomb-table`, `hypercomb-handoff`, `hypercomb-continue`; plus context lines (`context`, `context add`, `context drop`) | `chat-window/hypercomb-work-fence.ts` |
| **Tool registry** | The CENSUS: every behaviour word the participant granted a machine (`/grant`), declared per behaviour (`machine-grammar`); reads: `read` `list` `tree` `find` `history` `summary` `code` | `hypercomb-grammar.ts`, `hypercomb-observation.ts` |
| **Instructions as data** | The anatomy (doctrine sections the participant edits, `hypercomb-write doctrine`), the work instruction, the training prompt | `anatomy`, `workInstruction()` |
| **Planner / worker** | Whatever model the policy designates for the need (tier, context, reads-hive) | `model-policy.ts`, `llm-dispatch.ts` |
| **Judge** | Jev — System One: snap judgments over rows the worker lists; the CHANGE GATE; verifies answers against what was read | `hypercomb-jev.ts`, `jev-round.ts` |
| **Approval** | The Execution window: every `do`/`write` waits for Run or Skip unless the participant set that kind to auto | `execution-queue.ts` |
| **Durable execution** | LEGS: one stretch of context per leg; the older rounds fold into a progress ledger; a full leg hands over in prose plus a continue fence; the handover is a stored turn (`left`, `spent`) so a reopen resumes | `hypercomb-work-fence.ts`, `chat-window.component.ts` |
| **Budget** | Rounds and tokens per request, from the providers' own usage reports; device-local overrides | `workBudget()` |
| **Memory** | Pools of meaning: the transcript (threads), read signatures on the turn, the context basket, the compaction pool, the run ledger | `chat-thread.ts`, `context-basket.ts`, `compaction.ts`, `chat-steps.ts` |
| **Traces** | The run ledger records ATTEMPTS by pointer; history records EFFECTS; the route beside the thread draws it; `jev:turn` carries legs, rounds, weight, ms | `replayable-agent-loop.md`, `chat-route.md` |
| **Delegation** | A model that cannot hands off (fence) to the next the policy ranks; a bridge session takes what no model could; peer models lend by heartbeat | `llm-dispatch.ts`, bridge, `peer-models.drone.ts` |
| **Evals** | Trials on a domain, Jev readings, signed assessments | `module-sandbox.md` |

## 2. The theory, and its hypercomb name

By September 2026 the agent field agreed on a shape. Nothing in it is foreign
to us; each idea already has a hypercomb word, and where the word is a POOL
the idea is already data.

| Theory (2026) | Hypercomb |
|---|---|
| A loop of observe → decide → act → verify, with tools | Rounds of read → Jev → do/write → readback, with fences |
| Tools as a registry the model is shown, not hardwired | The census, per participant grant; a new power is a WORD, never a code path |
| Skills and instructions as files the agent reads | Doctrine sections in the anatomy; the training prompt; both content |
| Context engineering: windows, compaction, retrieval by reference, memory files | Leg + fold + `read <signature>` (what a signature names never changes) + pools |
| Durable execution: checkpoint, resume, idempotent steps | The handover turn (`left`, `spent`); the ledger records attempts by pointer |
| Generator / judge separation; verifier models | Worker lists, Jev judges, code composes; Jev checks the answer against the reads |
| Human-in-the-loop gates on irreversible acts | The Execution window; `do` and `write` held by default; reads run freely when granted |
| Budgets and observability (tokens, steps, traces) | `workBudget`, the meter on the availability line, `jev:turn`, the route |
| Sub-agents with narrow context; orchestrator–worker | A conversation per tile (artifact paradigm); hand-off; bridge sessions; peers |
| Evals as the way harnesses improve | Trials on your own domain; Jev readings; signed assessments; the ledger's numbers |
| Model-agnostic routing by need, not vendor | `ModelNeed` → policy → provider; OpenRouter lines; local; bridge; peer |

The one idea the field is still circling — **the harness itself as a
first-class, versioned, shareable artifact** — is the one hypercomb is built
for. A harness is content. It gets a signature. It lives in a pool.

## 3. The harness record

A harness is a `harness@1` JSON resource. Every field that could be shared,
versioned or composed is a SIGNATURE of another resource, never inline
([signature-system](signature-system.md)). The record names the loop's
policy; the loop reads the record; nothing in the loop is a constant any more.

```json
{
  "kind": "harness@1",
  "name": "default",
  "steps": ["<sig front>", "<sig route>", "<sig stretch>", "<sig fold>", "<sig handover>", "<sig verify>", "<sig receipt>"],
  "instruction": "<sig of the work instruction text>",
  "doctrine": ["<sig section>", "<sig section>"],
  "leg": { "rounds": 12, "reserveTokens": 8000, "keepVerbatim": 4 },
  "budget": { "rounds": 400, "tokens": 6000000 },
  "reads": { "pageChars": 48000, "roundsWhenAsked": 6, "charsWhenAsked": 24000 },
  "judge": { "word": "jev", "gate": "change", "verify": true },
  "review": { "auto": ["read"], "held": ["do", "write"] },
  "vocabulary": { "allow": [], "deny": [] },
  "handover": { "fence": "hypercomb-continue", "resumeSeconds": 3600, "proseFallback": true },
  "delegates": ["handoff", "bridge", "peer"],
  "need": { "tier": "auto", "streaming": true }
}
```

- **`steps`** name the loop's stages by the signature of the bee that runs
  each one (section 4). The default harness names the shipped bees.
- **`instruction`** and **`doctrine`** are the words the model is given; a
  community harness can carry its own training prompt and its own sections,
  and the participant's anatomy still applies on top (doctrine outranks).
- **`leg`, `budget`, `reads`** are the numbers that were constants
  (`LEG_ROUNDS`, `WORK_BUDGET`, `MAX_OBSERVATION_*`, `READ_PAGE_CHARS`).
- **`judge`** says who gates changes and whether answers are verified;
  `word` is a behaviour word, so a second judge (another model, a rubric bee)
  is a record change, not a code change.
- **`review`** is the Execution window's default per kind; the participant's
  own auto choices still win — a harness never widens what a person held.
- **`vocabulary`** narrows the census for this harness (a "read-only
  researcher" harness denies every `do`); it can never widen past the grant.
- **`handover`** and **`delegates`** are the durable-execution and
  delegation policy.

### Where it lives

- Pool of meaning **`sign('agent:harness')`** at the OPFS root, one sig-named file
  per harness, addressed only through `Store.poolSignature('harness')`.
- **The active harness is a pointer**, two levels: the device default
  (`hc:harness`, a signature) and a per-conversation mark on the thread
  (a `harness` field in the conversation record) that wins while set.
- **Ships as a seed**, exactly as backgrounds and themes do: the `default`
  record is minted at boot if the pool is empty, and re-minted when the
  shipped default changes (new content, new signature; the old one stays).
- **Arrives from the network like a theme**: `registerPublishedPool({meaning:
  'harness'})` — every host the participant learns is probed once at
  `<origin>/<sign('agent:harness')>`, members are sig-verified, and a third-party
  record is HELD (visible, off) until the participant turns it on
  ([llm-provider plug-in: the hold](model-mediation-and-the-training-prompt.md)).

## 4. Steps are beehaviors

The loop today is one long function. The harness splits it at the seams that
already exist, and each seam is a WORD resolved through IoC, so a harness can
swap one step without touching the others ([everything-is-a-beehavior](everything-is-a-beehavior.md)).

| Step | Word | What the default bee does | Effect it announces |
|---|---|---|---|
| Front door | `front` | Jev reads the request: answer at once, weigh the tier, or step aside | `agent:front` |
| Route | `route` | The policy designates a provider for the need; hand-offs and avoid lists | `agent:route` |
| Stretch | `stretch` | One leg: stream rounds, run fences through the queue, count the spend | `agent:round` |
| Fold | `fold` | When the window is full, fold the older rounds into the progress ledger | `agent:fold` |
| Handover | `handover` | End the leg: the prose, the continue fence, the stored `left` and `spent` | `agent:handover` |
| Verify | `verify` | Jev checks the answer against what was read; a second judge if named | `agent:verify` |
| Receipt | `receipt` | The run ledger, `jev:turn`, the route pieces, goal reached | `agent:receipt` |

Rules for a step bee: it takes the harness record and the leg's state, it
returns the next state, it announces its effect with the facts a surface
needs (never a rendering), and it never writes truth outside its seam — a
`fold` derives, a `handover` stores a turn, a `receipt` stores attempts by
pointer. The chat window becomes a surface that runs the steps the harness
names and paints what they announce; nothing imports the window.

## 5. What stays fixed

A harness can change policy. It cannot change these, and a record that tries
is refused at import the way a provider spec that smuggles an endpoint is:

- **Signatures are the only references.** No inline instruction text, no
  path-keyed anything.
- **Reads never grant change.** A harness may deny `do`; it may never auto-run
  a kind the participant holds.
- **The transcript is the checkpoint.** A handover is a stored turn; no
  side-channel state, no localStorage beyond device preference.
- **Judgment is separated from generation.** The worker lists, the judge
  decides, code composes. A harness may name the judge; it may not remove the
  change gate.
- **Doctrine outranks vendor advice**, and the participant's anatomy outranks
  the harness's sections.
- **Every act has a word.** A harness names words; it introduces no new
  transport, no new fence kind the parsers do not know.

## 6. Words

| Word | What it does |
|---|---|
| `harness` | Lists the pool: name, signature, on/held, which is the device default and which this conversation uses |
| `harness use <name or sig>` | Sets the conversation's harness (with `default` scope, the device default) |
| `harness edit [name]` | Opens the record as a tile (`harness-<name>`) on the current page whose note is the JSON — hives are our source files; editing the note is the save and mints a new signature, held until named |
| `harness offer <name>` | Signs the record and lists it on the participant's host (`harness` index key), as `language offer` does for catalogs |
| `harness sync` | Heals from followed hosts: records the pool lacks, held until turned on |
| `harness try <sig> <request>` | Runs one request under another harness on the same conversation and files both receipts, so Jev and the ledger can compare |

## 7. What the numbers already say

The ledger and `jev:turn` carry per-turn legs, rounds, weight, tokens and
outcome. Keyed by harness signature they become the eval: a `harness try`
over a small set of requests on your own domain yields, per harness,
rounds-to-done, tokens-to-done, hand-offs, reads refused, and Jev's
supported/complete scores. That is how a community harness earns adoption —
by its receipts, not its description.

## 8. Execution order

1. **Lift the constants into the record.** Mint `default` from today's
   values into `sign('agent:harness')` at boot (seed like themes); the chat window
   reads `leg`, `budget`, `reads`, `handover`, `review` from it. No behaviour
   change; the harness exists.
2. **Announce every stage.** The seven `agent:*` effects with their facts;
   the meter, the route and the bee panel read from them instead of from the
   window's signals.
3. **Split the loop at the seams into step bees**, default ones shipped in
   essentials, resolved by word; `steps` in the record names them by
   signature. The window shrinks to a surface.
4. **Words.** `harness`, `harness use`, `harness edit`; the per-conversation
   mark.
5. **Network.** `harness offer` and `harness sync` over the published-pool
   probe, held-if-third-party; the i18n and providers precedents carry it.
6. **Evals.** `harness try`; the ledger keyed by harness; a trials page that
   shows the receipts side by side.

Each step lands alone, ratcheted, with the previous one still working. Step 1
is a morning; step 3 is the one that takes care.

## 9. Strategies — composite patterns as content

*jwize, 2026-09-27, on patterns.smithers.sh: "Can we build some of these or
does it make sense to make these available to our agents as strategies?"*

Smithers is a durable workflow engine: 26 control-flow primitives, some fifty
composite patterns, sixty use cases, each a JSX component over a gateway. We
do not build the engine — the processor, the pools and the conversation tree
ARE the runtime, and a signature makes a step durable and idempotent by
construction. What is worth taking is the VOCABULARY: a composite pattern is
a strategy, and a strategy is content.

**Primitives we already have, by another name.** Sequence, branch and loop are
rounds; human approval and human task are the Execution window and the
question fence; wait-for-signal and scheduled trigger are local node ticks;
retry with backoff and timeout-and-fallback are the router's cooling and
hand-off; continue-as-new IS the leg; try/catch/finally and saga compensation
are history (every act is an undoable commit); idempotent side effects and
stage caching are signatures and the optimize phase; checkpoint fork is the
handover turn plus history; budget propagation is `workBudget`; sandboxed
execution is the module sandbox; durable memory is the pools; workflow-owned
UI is the route and the meter; subflow and isolated worktree are a
conversation per tile.

**Composites worth having as strategies** (the ones a hive can use; the
GitHub-and-CI use cases are not our domain — hives are our source files):

| Strategy | Shape, in our words | Standing |
|---|---|---|
| Review / revise | draft → Jev verify → revise until supported and complete | Jev verify built; the loop condition is a strategy field |
| Convergence | measure → improve → re-measure until a metric meets its target | `harness try` numbers; the metric is a read |
| Scan / fix / verify | scan a surface, fix each in parallel, verify, repeat until clean | the break-repair loop IS this |
| Fan-out / fan-in, map / reduce | break the request into parts, one conversation per tile, merge by reading their signatures | break-apart + expand exist; merge = a read of the parts |
| Planner / executor | Jev front door weighs; the plan is a table; execution is rounds | built (Jev runs the show) |
| Supervisor / workers | a conversation delegates to bridge sessions or peers and inspects their turns | delegation exists; the inspection is a strategy step |
| Escalation chain, model routing, sandwich | cheap first, escalate on hand-off; smart plans, cheap builds, smart polishes | policy + hand-off built; sandwich = tier per step |
| Panel, debate / judge, parallel second opinion | several providers answer the same round; Jev synthesizes or picks | needs a fan-out over providers in `route` |
| Ralph loop, notability filter, drift detector | a standing mission on a tick; the agent runs only when something is notable | ticks + break-repair prove the shape |
| Optimizer loop, eval suite, scorers | generate candidates, score, keep the best; fixed cases with expected outcomes | `harness try` + the ledger keyed by harness |
| Risk-classified runbook | safe steps auto-run, risky ones gate | the Execution window's per-kind review IS this |
| Context handoff | bank a brief, drop the residue, hand to a fresh successor | the leg handover, built |
| Self-authoring delegation | the model authors its own delegation tree under a fuel budget | the interesting one: a table of sub-conversations Jev admits, each with a slice of the budget |

**The hypercomb way to hold them.** A strategy is a signed record in
`sign('strategies')`: a name, the step shape (which harness steps run, in
what loop, with what exit condition), what the judge scores, how the budget
splits across parts, and the words it expands to. A harness may pin one; the
participant may say `strategy <name>`; otherwise the FRONT DOOR proposes —
the worker lists candidate strategies as rows of its table and Jev picks, the
same shape every other decision takes. Community strategies arrive like every
other pool: by signature, sig-verified, held until turned on. Their receipts
in the ledger say which ones earn their place.

**Order.** Strategies come after harness steps 1–3 (a strategy composes
steps, so the steps must be words first). Seed ten from the table above;
make `route` able to fan out over providers (panel, second opinion); make a
sub-conversation a first-class part with its own budget slice (fan-out,
supervisor, self-authoring delegation).

## 10. Standing

What of the order above is built, and where each piece landed.

| Step | Standing | Where |
|---|---|---|
| 1 · the record | BUILT 2026-09-27 | `assistant/harness.ts` — `harness@1`, `parseHarness` (narrow only), `HarnessStore` (sweep, seed, import, use), pool `agent:harness` (scoped census in core), device pointer `hc:harness`, published and seeded by `chat.drone`; the window reads `activeHarness()` per send |
| 2 · the stages | BUILT 2026-09-27 | `core/agent-effects.ts` — the seven `agent:*` effects with typed facts; the window emits; the meter and the bee panel read them |
| 3 · steps as words | BUILT 2026-09-27, all seven | `core/agent-steps.ts` the contract; `core/agent-leg.ts` the leg primitives and the shipped `fold`, `handover`, `receipt`; `core/agent-doors.ts` the shipped `front` and `verify` (the judge, the receipt writer and the bus come in as inputs); `core/work-fence.ts` the fence primitives (the langs, the split, the line grammar, the stream guard) moved down from shared; `core/agent-stretch.ts` the shipped `route` (the call shape, the hand-off reaction, the pin) and `stretch` (one streamed round as an async generator the window delegates to with `yield*`); `assistant/agent-steps.ts` the registry (word → shipped or a bee by signature), published by `chat.drone`; the window resolves each word against the harness's `steps` and falls back to the shipped objects |
| 3 · what the window keeps | BY DESIGN | Listing the census and the tiles a door is shown; running the fences through the Execution window (`runRead`, `runDo`, `runWrite`, the Jev table round); the turn's ledger of attempts; the designation it paints. Each is the window's own or essentials' service already, reached by the loop as a caller — not a policy a harness swaps |
| 4 · words | BUILT 2026-09-28, edit 2026-09-30 | `assistant/harness.queen.ts` — `harness` lists the pool and says which record the device runs under; `harness use <name or sig>` chooses for the device; `harness here <name or sig>` marks the open conversation (a `chat-harness` marker in its bucket, `ConversationSummary.harness`, wins over the device's while it stands; `harness here default` takes it off); `harness show [name]`; `harness import <json>` brings a record in by its bytes and refuses one that widens. `harness edit [name]` (`assistant/harness-tiles.ts`) puts the record on the current page as the tile `harness-<name>` whose note is its JSON and opens the notes; A NOTE IS A HARNESS WHEN ITS TEXT IS A `harness@1` RECORD, so on every `notes:changed` the chat drone's listener reads such notes and imports each new one under its own signature, held, saying so once — a note that widens or does not parse is refused aloud. The shipped default opens as a copy named `custom`, since `default` always answers the shipped record |
| 5 · network | BUILT 2026-09-28 | `assistant/harness-network.ts` — `harness offer <name> [@host]` puts the record's canonical bytes on the host under the participant's key and stamps `agent:harness` in their signed index; the worker (`noteSharedPools`) puts the record into the host's `agent:harness` pool by its own signature, served at `<origin>/<sign('agent:harness')>` once the operator says `hosts list agent:harness`; `harness sync [@host]` reads the hosts the participant follows (and `@host`), verifies each member's bytes against its name, and brings it into the local pool HELD — nothing runs it until `harness use` or `harness here` names it; the published-pool probe is claimed for the meaning too (a worker's one-signature-per-line listing now reads as an index) |
| 6 · evals | BUILT 2026-09-28 | `assistant/agent-receipts.ts` — every `agent:receipt` (now carrying the harness signature the turn ran under) is filed content-addressed in the `agent:receipts` pool by the ledger the chat drone starts; `summarizeReceipts` groups them by harness (runs, answered, failed, stopped; rounds, tokens, seconds and legs averaged over answered turns). `harness try <name> <request>` runs the next turn of the open conversation under another harness once, the mark untouched, and files its receipt under it; `harness compare [name]` reads the standings side by side (a console table and one line per harness). A trials page as a surface is the next surface, not this step |
| 7 · the loop without a window | BUILT 2026-10-02 (read, do, write the build's source) | The loop's own words moved down from the chat window to core: `core/work-words.ts` (the write block's three headers, the edits, what a model is taught — `workInstruction` — and every message back), `core/hive-reads.ts` (the read grammar, its budgets and receipts), `core/hive-grammar.ts` (the canonical do grammar, its reach, the plan queue); the window's modules of those names re-export them. `assistant/agent-turn.ts` runs a turn with no window — route, stretch, fold and handover from the registry; reads through the hive tree reader, changes through the behaviour drone, both waiting in Execution as the participant's policy says — and `/agent` (`assistant/agent.queen.ts`) is its word in the minimal build, `@diamondcoreprocessor.com/AgentTurn` its door for code. A third write header, `version <revision> <path>`, drafts a file of the build's OWN tree (sharing/version-drafts.ts), every file over one revision in one draft per turn; `read <revision> [path]` opens a revision or a draft as a tree, file or folder, from the version pools. Jev's doors (front, the table round, verify) and module and doctrine writes are still the window's |

Why the leg primitives are in core and not essentials: shared may not import
essentials at compile time (the web shell never bundles modules), and
essentials may not import shared. A primitive both sides run — the fold, the
leg-end word, the handover read from prose — has exactly one home that both
can reach, and that is core, beside the fence regex it already held. The
step BEES are essentials' (the registry, the registrations, any community
step); the window's fallback is the same shipped object core exports, so
nothing is written twice.

## 11. Cheap by default, strong by request

The everyday work belongs to the cheap models. That is where the value of an
external API is, and a survey, a note, a rename or a reading of a page does not
need more. The balance is kept by two things the loop already had and one it
gained on 2026-09-30.

**The hand-off** (`hypercomb-handoff`). A model that meets work beyond it says
so in one line, and the turn goes up to a model at the `deep` tier. The model
that handed off is not asked again this turn.

**A line added for a weight of work.** A model line normally takes the tier
its price falls in (`providers/openrouter-stages.ts`), and a model priced above
the last stop is left out. A line the participant adds *for* a tier —
`models add <model id> deep` — offers that one tier whatever it costs
(`LlmModelChoiceStore.tierOf`). It is on the list and never in use: it answers
when work is handed up to it and never otherwise, so a frontier model costs
what the hard turns cost and nothing more.

**The request.** When a hand-off finds no model that can take the work, the
turn does not end in an apology. It emits `agent:model-request` — who handed
off, what it said the work needs, the tier nobody could take, the harness the
turn ran under — and says how to answer it. The chat drone's ledger
(`assistant/model-requests.ts`) files each one, content-addressed, in the pool
`agent:model-requests`.

| Word | Does |
|---|---|
| `models` | Opens the providers console, where the lines are, and says each line's weight of work, its price, and how many requests stand |
| `models add <model id> [tier]` | Puts a line on the list — never in use; with a tier (fast, balanced or deep), for that work only. The id is checked against the catalogue when it is loaded |
| `models drop <model id>` | Takes a line off, and its said tier with it |
| `models requests` | Reads what the work has asked a stronger model for, newest first |
| `models request <what the work needs>` | Files a request by hand |

After `models add … deep`, saying `continue` sends the same question round
again: the cheap model hands off once more, and this time the deep line takes
it. That is one cheap round spent to keep the rule simple — nothing escalates
without a model saying the work needs it.

**How the loop is tuned.** A turn is run with an expectation: about how many
rounds, about how many tokens, what the answer should hold. A turn that
misses it is a defect in the harness, not a reason to reach for a stronger
model. The first drive session found three such defects, none of which a
stronger model would have fixed: a work block written as a tag was shown
instead of run; a busy host that was the account's only road was ignored into
a dead turn; and a two-reads-per-block ceiling made a twelve-tile survey cost
nine rounds and 101k tokens (`reads.perBlock`, now eight). `harness compare`
is where the difference shows.

## 12. Driving it: what a day of minding the hive found

On 2026-09-30 the hive was minded through its own chat on the cheap models
(DeepSeek V4 Flash through OpenRouter, Jev as judge): ten branches explored,
a to-do list of 38 items filed as notes on a `housekeeping` tile, and the
first items delegated. Every turn was run against an expectation, and every
miss was read as a defect in the loop. None was fixed by a stronger model.

**The model spells the block its own way.** A fence, then
`<hypercomb-read>` as a tag, then `<block info="hypercomb-read">`. The tag is
read (block form and inline form; a sentence about the tag stays prose). Any
other markup that names a work word is sent back ONCE to be written properly
(`SplitWork.unwritten`), instead of ending the turn with the machinery on the
screen. The net is what scales; the next spelling costs one round, not a
dead turn.

**A refusal has to be true, visible and bounded.** A twenty-line change was
turned back with "send a table of two to eight rows" when the real reason was
six lines per step; `create` refused a route from the root with "explicit
names separated by /". Each now says the limit and the way through it. A
refused block is said on the bee (`agent:progress`), where before it showed
nowhere, and three refusals running end the turn with the reason.

**A turn must not depend on being watched.** A hidden tab is throttled and
frozen: a round sat 250 seconds; holding a shared Web Lock for the length of
the turn (`core/stay-awake.ts`) it took three to six. The bridge renderer
holds the same lock while its socket is open. A stream silent for ninety
seconds is given up as busy; a blank completion is asked once more.

**The vocabulary is the ceiling.** Asked to create a tile, the model answered
that its only change verbs were keyword, accent, copy, paste, undo, redo,
postit, organism and story: `create`, `title`, `hide` and `file` were asleep,
and a sleeping queen's stand-in carries no `machine` block. A queen that
declares one now stays awake (`scripts/passive-queen.ts`). `file on <tile>:
<text>` and `file on /<route>: <text>` put a note where the model says.
There is still NO machine word to change or unlink a note; half of ordinary
housekeeping waits on that word, and the word is the owner's to name.

**What it costs.** Exploring a branch two levels deep: three to six rounds,
23k to 59k tokens, under a minute when the tab is awake. A branch of
machine-written game data cost 190k to 260k and is not worth exploring by
reading. Eight reads per block (`reads.perBlock`) is what made the first
figure possible; at two it was nine rounds and 101k for a table.

**Open.** A turn that fails after work ran does not tell the next turn what
ran, so `continue` re-reads and may re-do. The front door takes most of a
minute on a long request. The transcript says "Queued — waiting for a session
to pick it up" while a held block is waiting for Run. A model that answers
"I'll create them" and sends no block ends the turn as answered.

