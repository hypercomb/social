# Learn and leave — reading a branch, curating context, leaving it in a pool

Status: **Proposed 2026-10-12 — not built. Decisions for jwize at the end.**

**outline → items → working set → a kept context on the word's `contexts` facet.**
A model learns a branch in widening steps, curates what it needs into a
working set whose cost it can see, and leaves that set as an artifact on the
word's facet, where the next agent starts from it instead of reading the
branch again.

Paths are relative to `src/`; `assistant/…`, `molecule/…`, `commands/…` and
`notes/…` are under `hypercomb-essentials/src/`, and the chat files are in
`hypercomb-shared/ui/chat-window/`. Line numbers may move.

## The request

jwize, 2026-10-12, in one run of messages:

> "Every model needs to be able to read a branch (expanded and see the
> available resources, perhaps through pools) . That way you can learn,
> attach context, and prune and edit context, event tokenizer perhaps."
>
> "This way we can leave rich artifacts for other agents to take advantage of."
>
> "I mean llm tokenization" … "but we don't have to go that far"
>
> "I mean the artifacts are ideally left behind in pools"
>
> "I think the other way might be wrong"

Read as: an expanded branch read, a working context a model curates with
LLM-token estimates (no exact tokenizer), and what it curated left in pools —
not as notes on tiles, inside a transcript or in a new store. The test was his:

> "the hypercomb primitive is the litmus test"
>
> "the living primitive then primitive but maybe hypercomb primitive is best"

So token figures are
estimates, each act must be a hyperedge between signatures
([llm-primitive.md](llm-primitive.md):7-20, :38-46), and each hop is worn the
way [life-primitive.md](life-primitive.md) says.

Three designs were scored by five judges, one lens each: Design 0 (one
`inflate` verb, a `context leave` slice on the facet), Design 1 (`expand`, a
`context:working` pool document), Design 2 (`outline`, `items`, an artifact
of copied projection text).

| Lens | Design 0 | Design 1 | Design 2 |
|---|---|---|---|
| Hypercomb primitive | 8.5 | 7 | 6 |
| Usefulness to models | 6 | 6.5 | 7.5 |
| Doctrine | 6.5 | 8 | 7 |
| Privacy and safety | 5 | 5.5 | 7 |
| Buildability | 7 | 4 | 6 |
| **Total** | 33 | 31 | **33.5** |

This design builds on Design 2, adds the best ideas of the other two, and
fixes every flaw a judge found.

## What exists today

- **Context lines do nothing.** `context add` stores sig `''`
  (`chat-window.component.ts:6411`), `referencePayload` drops it
  (:2082-2086), `systemFor` never reads the shelf (:6645-6665). They run
  before the gate (:6913-6918), so if they carried text they would skip
  `needsGrant` (:6972), the per-provider budget (:6935, "the only privacy
  control that is a number", `assistant/llm-hive-access.ts:34-37`) and
  `foreignReads` (:7037-7043). Only turn prose crosses messages (:6670-6679).
- **Learning a branch is expensive**: two levels from scratch cost 3-6
  rounds and 23k-59k tokens (agent-harness.md:376-380), and models copy
  signatures badly (`hypercomb-observation.ts:352-358`). A tile's projection
  is at most 6,000 chars, null above (`assistant/llm-context.ts:81`, :282).
- **The window is mostly assumed.** Only the OpenRouter catalogue sets
  `contextLength` (`openrouter-catalog.ts:97`); the local `qwen2.5-coder:7b`
  (`local.provider.ts:79-81`) and Anthropic direct declare none. The fold
  falls back to 128,000 (`chat-window.component.ts:7783`), the compiler to
  32,768 (`context-window-compiler.ts:69-82`); nothing sets Ollama's `num_ctx`.
- **The estimator** is `ceil(chars/4)+4` (`hypercomb-core/src/core/agent-leg.ts:51`),
  with a twin in `context-window-compiler.ts:84-87`; it under-counts CJK
  about 4×.
- **Withheld tiles leak.** A node read hands out a withheld child's sig
  (`hypercomb-observation.ts:150-156`); `withoutWithheld` filters only trees
  and finds and leaves sig reads alone (`withheld-reads.ts:15-19`, :35-61);
  ALREADY READ is unfiltered (`chat-window.component.ts:6638-6641`); notes are
  shared by word (`notes/notes-facet.ts:5-8`).
- **The facet writer fires the publication trigger**: envelopes and atom
  (`molecule/facet-succession.ts:277`, :294) emit `content:wrote`, which
  host-sync and folder-sync drain (`sharing/host-sync.service.ts:485-499`).
- **Context pools today.** `llm:context` and `system:compaction` declare no
  kind (`hypercomb-core/src/core/pool-kinds.ts:130-222`), so they pin the
  layers they derive from (:91-96), against [optimize-phase](optimize-phase.md)
  rule 3. `assistant/context-summary-gen.ts:80-109` mints an orphan root
  resource on every ask. `context:slices`, `context:basket` and
  `context:groups` have no subject or envelope rows. `poolMeanings()` includes
  `ai:withheld` (`pool-registry.ts:784-787`).
- **Words taken:** `/expand` mints siblings (`commands/slash-behaviour.drone.ts:685`),
  `leave` is swarm leave, `prune` a queen, `inflate` a bridge op. There is no
  `do` ExecutionKind (`assistant/execution-queue.ts:44`).
- **Reusable:** each turn writes a prompt manifest with `emit:false`
  (`chat-window.component.ts:6709-6716`), named by `Turn.prompt`.

## The design

### Three abilities

1. **Read a branch expanded.** `outline` shows the branch's shape and where
   its token mass sits, about 10 tokens a row; `items` lists one tile's
   resources, numbered; `read /path [n]` opens one. Pools are shown per tile,
   never as a global list: the index pools holding a record for this layer
   sig (`poolKinds()`, kind `index`, `pool-kinds.ts:11`, :255) and the
   word's facets with author counts.
2. **Attach, prune and edit context.** Each conversation has a **working
   set** of envelopes, minted on attach (`emit:false`) and sent as a WORKING
   CONTEXT block in the system text, capped at 25% of (window − reserve),
   taken once per message and refreshed at a fold — so add, pin, drop and
   summary, not age, decide what survives; `FoldInput` is unchanged. Attaching
   unread content runs as a read (`chat-window.component.ts:6911-7058`). The
   set is saved as a draft named on each turn and in the prompt manifest.
3. **Leave rich artifacts.** `/context keep <purpose>`, approved in
   Execution, mints a standalone context layer and puts its sig on the facet
   `sign('contexts:' + moleculeAddress(word))` with the existing
   `writeFacetHead`, per author (`facet-succession.ts:202-223`). The next
   agent sees it in `outline` and takes it on with `context use`.

### The one rule

**Every row's typed hop is the TEXT the model received — a `resource`.**
`derivedFrom` names what that text came from (a tile's layer, a note's
layer, a module, a summarised item), and is a REFERENT
(`hypercomb-core/src/core/edge-registry.ts:95-100`), so closures do not carry
it. No artifact has a layer hop, so a kept or published context can never
carry a private subtree (the privacy judge's point), yet the layer → text
edge is recorded by signature (the primitive judge's point). Freshness is a
signature comparison, never a re-projection, so a bump to
`LLM_CONTEXT_DERIVATION` (`llm-context.ts:76`) never marks rows stale. Text
that already exists (a document, a text attachment) is referenced; only
derived texts — projections, note text, code excerpts — are minted.

### The artifact

A standalone, content-addressed layer at the root, named on the word's facet
in the notes facet's shape:

```
<root>/<sign('contexts:'+moleculeAddress(word))>/<pubkey>/<claim>   signed head (seq, prev)
<root>/<headSig>      {succession:1, signer, prev, members:[facetEnv…], at}
<root>/<facetEnv>     {meta:1, layer:<artifactSig>, relation:'contexts', root:'contexts', slot}
<root>/<artifactSig>  {name:'cohiba', kind:'context', children:[env0, env1, …]}
  env0 {meta:1, resource:<purposeText>, relation:'purpose', slot:0}
  env1 {meta:1, resource:<agentRecord {agent:1, provider, model}>, relation:'agent', slot:1}
  env2 {meta:1, resource:<outlineText>, relation:'outline', slot:2, derivedFrom:<branch layerSig>, route:'/brands/cohiba'}
  env3 {meta:1, resource:<projectionText>, relation:'pinned', slot:3, derivedFrom:<tile layerSig>, route, via:'projection'}
  env4 {meta:1, resource:<documentSig>, relation:'attached', slot:4, route, via:'document'}
  env5 {meta:1, resource:<noteText>, relation:'attached', slot:5, derivedFrom:<note layerSig>, route, via:'notes'}
  env6 {meta:1, resource:<summaryText>, relation:'summary', slot:6, derivedFrom:<item sig>, agent:<agentRecord>, route, via:'decorations[2].payload'}
```

The **purpose** is required at keep and read first by a reuser. The
**outline** is the last outline, rows marked `●` carried, `○` opened but not
kept, `·` not opened — the pruned map the next agent starts from. The
**agent record** travels in the closure, and a summary names its own agent.
The closure is artifact → envelopes → texts, never a subtree (a spec asserts
it). `route` and `via` are labels, never resolved. Rows are minted at attach
with `putArtifactMeta(…, {emit:false})` (`hypercomb-runtime/src/store.ts:1196-1209`),
which keeps extra fields (`life-primitive.ts:135-143`); reused rows dedup.

### Keeping, discovery, reuse

`keepContext`, in a new `assistant/contexts-facet.ts`: refuse with no author
key (`facet-succession.ts:254-255`); refuse any row whose route, sig or
`derivedFrom` is withheld — for **every** model, the local one included,
because succession facets replicate (`pool-kinds.ts:68`); mint the purpose,
agent and outline texts and the layer, `emit:false`; then
`writeFacetHead({plural:'contexts', subjectSig: moleculeAddress(word),
members:[…this author's newest ≤11, artifactSig], kind:'layer', emit:false})`.
The writer gains only that pass-through `emit`. Older contexts stay one
`prev` back. Same-named branches share the facet, as notes do.

**Discovery** is in three places: the `outline` header (newest first, at
most 3 per word) and its `◆k` marks; the `items` about-line; and a "kept
here" section in the `/context` window. `readSuccessionMembers`
(`facet-succession.ts:361-383`) gains an optional per-author return, so each
line reads `[k] by you · <model> · <date> · "<purpose>" · ≈tok · fresh/total`.

**Reuse.** `context use` runs as a read, returns the row texts and adds their
envelope sigs to the working set; nothing is re-minted or re-walked. A tile
row is **fresh** when `derivedFrom` equals the route's current layer sig,
**N versions ago** when it is among the route's lineage markers
(`readHistory`, ≤32), **another tile named X** otherwise; a direct item is
fresh while still among the tile's items. Stale rows stay readable: data
never heals.

**Privacy.** For outside models, withheld rows drop on use and contexts on a
withheld word are not listed. Another author's rows are quoted as data with
the author named, and their sigs join `foreignReads`, so a change that
follows a stranger's context waits for the participant. Keep is not publish
(Life rule 9) — decision 1. `/context forget <sig>` writes a new own head
without it; bytes and `prev` stay. Not yet verified, so covered by specs:
whether the collector walks atom → artifact → texts and treats referents as
keep-alive, and whether host-sync's privacy gate, which reads `relation` as a
slot (life-primitive.md:80), treats the new relations conservatively.

### Why a pool

A curated context is ABOUT a branch, not part of what it IS: many writers,
attributed per record, extrinsic, not rebuildable cold
([pheromones.md](pheromones.md):202-224; [known-location-pools.md](known-location-pools.md)
rule 5; Life rule 8). No new meaning is needed: `contexts:<64hex>` is a legal
facet spelling (`molecule-address.ts`), `Store.poolSignature` registers it
(`store.ts:303-304`), and the writer declares it `succession`
(`facet-succession.ts:268`), as for notes.

### Tokens are estimates

- **One estimator, in core.** `estimateTokens` counts each non-ASCII
  character as one token; ASCII results are byte-identical (a spec asserts
  it), so English folds as today and CJK folds earlier — the safe direction.
  `estimateTokensOfSize(bytes, dense)` sizes unread items: prose bytes/4,
  dense bytes/3 (the ratio at `translation.service.ts:220`), dense decided by
  where the item was found. The compiler drops its twin.
- **Nothing is stored.** No envelope, artifact or draft carries tokens or
  chars; sizes come from byte length at display, so an estimator change never
  re-signs anything. `≈` means text in hand, `~` a byte size, `≥` a cut walk.
- **Per item**, the text the model would receive; a null projection points to
  the tile's items; binaries get "not text, 180 kB — cannot be sent to you".
  **Per tile**, `own` is the `llm:context` record's size, else the layer's
  (dense, `~`), and `sub` adds every descendant walked; outline never projects
  live. **Per context**, the rows plus 4 per header line, against an
  **enforced** 25% of (window − reserve): over it, unpinned rows (oldest
  first), then pinned, shrink to one line each, and the receipt says "context
  over by ≈N: drop or summarize".
- **The window** is the fold's own `router.contextLengthForModel(model) ||
  128,000` (`chat-window.component.ts:7783`), so meter and fold agree,
  "(assumed)" when undeclared; it is not switched to `contextBudgetForModel`,
  which would fold local legs about 4× sooner (decision 4). Reserve is
  `leg.reserveTokens`, 8,000 (`harness.ts:62`); stretch is
  `estimateTokens(system)` plus the messages (`agent-leg.ts:138-147`); room is
  window − reserve − stretch. The last call's `usage.inputTokens`
  (`chat-thread.ts:190-203`) prints beside the estimate; far below it on a
  local model is the sign of a silently truncated prompt.

Every read receipt and context reply ends with the meter:

```
this read ≈3,120 · stretch ≈41,200 of 128,000 (assumed) · context ≈9,840 of 30,000 (pinned 2,100 · attached 6,900 · summaries 840) · room ≈78,800 · last call 38,120 actual
```

The fold's fit check counts the refreshed block (rebuilt before
`estimateTokens(system)`, `chat-window.component.ts:7786`); with no fold the
byte-stable block stays, keeping the prompt cache. Drift named, not fixed: the
read room converts back at 3/2 (:6981-6987), and the compiler's fallback
table disagrees with the fold's.

## The words

None is a behaviour word: `outline`, `items`, `keep`, `use`, `pin`, `unpin`,
`drop`, `summary`, `forget`. Avoided: `expand`, `leave`, `prune`, `inflate`.

**`outline [here|/path] [tokens]`** — NEW read verb, gated and counted like
`read`. 1,500 tokens by default, at most 8,000, never more than room; a
breadth-first fair walk on the find ceiling (2,000 nodes, 12 s,
`hive-tree-reader.ts:51-53`); a level that does not fit becomes one line.

```
outline /brands 2000
→ outline /brands ≈18,400 (31 tiles) · layer <64hex>
  kept about brands: [1] by you · qwen2.5-coder:7b · 2026-10-11 · "pricing review: quotes, both printers" · ≈3,100 · 6/7 fresh → context use /brands 1
  brands own ≈310 · sub ≈18,400 (31) ◆1
    cohiba own ≈1,210 · sub ≈9,800 (12) ◆2
    padron own ≈420 · sub ≈3,300 (8)
    … 3 more ~4,370
```

**`items [here|/path|<layerSig>] [0|1]`** — NEW read verb. Every slot but
`name` and the child slots (`level-roster.ts:31`) is walked, envelopes read
raw, JSON up to 64 kB descended 3 levels, the notes facet unioned in — so a
slot registered tomorrow appears with no code edit. `1` adds a line per child.

```
items /brands/cohiba
→ /brands/cohiba · layer <64hex> · own ≈1,210 · sub ≈9,800
  [1] projection ≈310
  [2] notes "Behike pricing up since…" ≈120 <64hex>
  [3] document ≈4,800 <64hex>
  [4] decorations[2].payload "quotes.md" text/markdown ~900 <64hex>
  [5] properties.large.image — not text, 180 kB <64hex>
  children: behike ≈640 · siglo-vi ≈520 ◆1
  about: llm:context ✓ · search:index ✓ · notes 3 authors · contexts 2 (1 fresh)
```

**`read /path [n]`** — NEW form: item n of the last `items` for that route,
so the model never copies a 64-hex sig. If the tile changed since, "the tile
changed since you listed its items; run items again". Further pages as
today: `read <that sig> 12000`.

**Withheld (CHANGED)**, for every model but the participant's own local one:
a withheld child keeps its name and loses its sig
(`{name:'…', sig:'(withheld)'}`, as `ai-withheld.store.ts` says names stay
visible); `read <sig>` in the closure gets the existing `withheldMessage`;
ALREADY READ is filtered; `items` drops notes and contexts on a withheld word.

**`context`** — CHANGED: the working set and the meter.

```
context
→ context: 4 rows · ≈7,240 of 30,000 · stretch ≈41,200 of 128,000 (assumed) · room ≈78,800 · last call 38,120 actual
  #1 pinned /brands/cohiba (tile) ≈1,210 <64hex>
  #2 attached /brands/cohiba [2] notes ≈120 <64hex>
  #3 summary of /brands/cohiba [3] document ≈180 <64hex>
  #4 attached /brands/padron (tile) ≈420 <64hex>
  draft <64hex>
```

| Form | Does | Example → reply |
|---|---|---|
| `context add <handle> [pin]` (CHANGED) | handle is `/path` (the projection), `/path [n]` or `<sig>`; unread content runs AS A READ, read content is only marked; refused for withheld (outside models), non-text, and over one page: "≈N — read it a page at a time and keep a summary instead" | `context add /brands/cohiba [4]` → `attached #5 ≈900 · context ≈8,140 of 30,000` |
| `context pin\|unpin <#n\|handle>` (NEW) | at once, reads nothing; a pinned row stays whole through every fold and is the last to shrink | `context pin #1` → `pinned · context ≈7,240 of 30,000` |
| `context drop <#n\|handle>` (CHANGED) | at once; the row still opens with `read <sig>` | `context drop #4` → `out · context ≈6,820 of 30,000` |
| `context summary <#n\|handle>: <text ≤900 chars>` (NEW) | the model's summary replaces the row — `putResource(text, {emit:false})` and `{resource, relation:'summary', derivedFrom, agent, route}`; a pin is kept; a loose resource, not a save | `context summary #3: 2026 price list — one row per size; only the Behike rows changed since last year` |
| `context use <route> [k]` or `<contextSig>` (NEW) | a read: row texts up to `perReadBytes`, pinned first, the rest listed with `≈tok`, each fresh, N versions ago, another tile named X, or absent; rows join the set under their existing sigs | `context use /brands 1` → `using <64hex> · by you · qwen2.5-coder:7b · "pricing review…" · 7 rows ≈3,100 · 6 fresh, 1 changed`, then the texts |
| `/context keep <purpose>`, `/context keep on <route>: <purpose>`, `/context keep <draftSig> <purpose>` (NEW change-block word) | the model writes it in hypercomb-do, the participant types it; keeps the set on the route's word (default: the last branch outlined, else the page) as kind `additive`, held for review; in a read block: "keeping goes in the change block; the participant approves it" | `/context keep on /brands/cohiba: pricing review — the quotes, both printers and their notes; skipped the 2019 catalogue` |
| `/context forget <contextSig>` (NEW) | takes one of your own kept contexts off your head; its bytes and `prev` chain stay | → `forgotten from your contexts on cohiba (still one version back)` |

The participant also has `/context add|pin|unpin|drop|summary|use …`, acting
on the open chat's set. A first token is a sub-word only when text follows,
so bare `/context` and `/context <cell>` still open the Context Window
(`commands/context.queen.ts:35-71`).

**Teaching** (`hypercomb-work-fence.ts:174-191`) becomes the loop: outline
first; items on what is big; `read /path [n]`; add, pin, drop and summary
under the meter's budget; `context use` when outline shows a kept context;
when done, ask for `/context keep <purpose>` in the change block.

## Defaults

- `outline`: 1,500 tokens (at most 8,000, never over room), 2,000 nodes,
  12 s, at most 3 kept contexts per word. The working block: 25% of
  (window − reserve), enforced. The window: declared, else 128,000
  "(assumed)"; reserve 8,000; the fold's fallback unchanged.
- Over one page is refused; a summary is at most 900 chars, inside the
  parser's 1,000-char line (`hypercomb-observation.ts:23`). Unread content
  attached or used runs as a read.
- A model's keep always waits (`additive`, `forceReview`; decision 3). Each
  author keeps their newest 12 contexts per word; older ones stay one `prev`
  back. Every new write is `emit:false`. ASCII token estimates are unchanged.
- Withheld rows are refused at keep for every model; withholding is by word
  (decision 5). Kept contexts travel like notes (decision 1).

## The hypercomb primitive, and the living primitive

| Act | Hyperedge | Verdict |
|---|---|---|
| attach a derived item | `{layerSig}` → projection → `{textSig}`; envelope `{resource:textSig, relation, derivedFrom:layerSig}` | PASS |
| `context summary` | `{sourceSig}` → model → `{summaryTextSig}`; envelope `{relation:'summary', derivedFrom, agent}` | PASS |
| one turn | `{row envelopes + transcript}` → model → `{answer}`; the manifest names every input (`chat-window.component.ts:6709-6716`) | PASS |
| `keep` | `{rows, outline, purpose, agent}` → model + keep → `{artifactSig, headSig}`, the next edge's input via `context use` | PASS |
| `outline`, `items`, `read`, `use` | traversals: mint nothing; `use` reuses envelope sigs; receipts name the sig a route resolved to | PASS as reads |

**What does not pass:** token counts (derived numbers); the withheld gate (a
route policy and a memoised closure — a gate, not a vertex); `route` labels
(display and gate only); `/path [n]` handles (grammar, never stored); the
working set between an attach and the turn's end (memory, though each row is
a vertex); the participant's approval of keep (a human gate, by design); and
uncarried `derivedFrom` referents (a replica may lack a row's source, by
design).

**The living primitive** (life-primitive.md:18-32, rules :179-209): one typed
hop per envelope (1); `ensureArtifactMeta` unwraps before it wraps (2,
`store.ts:1213-1242`); an item's kind comes from where it was found, never
its bytes (3); `root:'contexts'` only from the facet writer (5,
`facet-succession.ts:216-218`); each author's latest head selects their list
(7); the facet is the discovered location (8); keep is not publish (9); the
closure is artifact → envelopes → texts, referents never carried (10). Every
hop carries `relation`, `slot` and `agent`, so it can be replayed, reviewed
and traversed across peers.

## What goes wrong with the alternatives

**Other homes.** A **note on the tile** is the participant's voice and shows
in the notes window and a model's note count (`notes-facet.ts:5-12`). A
**layer slot, decoration or tile property** (llm-primitive.md step 4) makes
every write a `commitSlotSet` — a new layer, a cascade, a history marker and
a save without human intent, one writer under `replaceKind`
(`claude-bridge.worker.ts:1390-1416`). **The transcript**'s `known` is
private, capped at 24/64, found by a route string (`chat-thread.ts:139-147`).
**A separate store or typed folder** is forbidden, and an unseeded directory
reads as a lineage bag (`doctrine.spec.ts:712-737`). **An orphan root
resource**, as `context-summary-gen` mints, has no pool naming it. **An index
pool** is wipe-safe, never replicated, pins nothing (`pool-kinds.ts:64-69`).
**`context:slices` or a seeded `context:*` bucket** has no subject and no
per-author signed succession.

**The designs as first written:**

- **Copied projection text (Design 2).** With no layer sig in the artifact,
  the layer → text edge was lost and freshness needed a re-projection that a
  derivation bump marks changed; a note's id is a layer sig
  (`notes/note-tree.ts:107-110`), breaking the invariant; it stored `chars`.
  `derivedFrom` keeps the privacy and restores the edge.
- **Context text captured before the gate (Designs 0 and 1)** let an
  ungranted provider read the hive by attaching.
- **`leave` and `expand` (Designs 0 and 1).** `leave` is swarm leave;
  `/expand` mints siblings, so a model writing it in a do block creates tiles.
  Design 0's leave was queued as a `do` kind, which does not exist.
- **Layer hops in the artifact (Design 0)** carry whole subtrees if a slice
  is published; its slice had no purpose or outline, and `read <sliceSig>` is
  null past 24,000 chars. Its shelf lived only in the manifest written before
  the round loop, so mid-message changes were lost on reload. It dropped
  covered children whole, against "names stay visible".
- **A mutable working-set document (Design 1).** `context:working` with
  `keep:'current'` is a mutable record at a path-derived `sign(convoId)`;
  `#keepOnly` discards prior atoms (`store.ts:479`).
- **One context per author per word (Design 1).** Every model writes under
  the participant's key, so a second curation replaced the first.
- **Switching the fold's fallback (Design 1)** to `contextBudgetForModel`
  gives local models 32,768: they fold about 4× sooner, with smaller reads.
- **Re-declaring pools now (Design 1).** `context:slices` as `set` would
  replicate slices that can hold withheld routes; retiring `context-summary-gen`
  breaks its three consumers. Both are spun off.
- **A `pools` verb (Design 1)** added a core registry for little model value;
  a list built on `poolMeanings()` would include `ai:withheld`, so pools are
  shown per tile. Its keep also let the local model put withheld items into a
  replicating facet.

## Implementation steps

0. **Coordinate.** `/claim` first; build on the other session's landed work
   in `hive-tree-reader.ts`, `hypercomb-observation.ts`,
   `hypercomb-work-fence.ts` and `withheld-reads.ts`. Never stash, reset or
   wipe OPFS. Never read `/susan`, `/howard` or `/people/susan`: withheld
   behaviour is proved by specs against a fake list.
1. **Core** (`hypercomb-core/src/core`). `agent-leg.ts`: the non-ASCII
   correction and `estimateTokensOfSize` (spec: ASCII identical, CJK one per
   character), imported by `context-window-compiler.ts:84-87`.
   `edge-registry.ts`: `derivedFrom` in `REFERENT_FIELDS` after jwize's yes
   (decision 2). Rebuild core, essentials, `runtime:core` — not a revision.
2. **Facet writer** (`molecule/facet-succession.ts`): `emit?` passed at :277
   and :294, default unchanged; an optional per-author return from
   `readSuccessionMembers` (:426-446). Specs: `emit:false` fires nothing;
   notes specs unchanged.
3. **Withheld closure.** A pure, memoised `withheldClosure(routes, reader)`
   in `withheld-reads.ts` (+ spec): each withheld route's subtree sigs, their
   item sigs, its lineage markers (≤32) and the words under it.
   `withoutWithheld` (:35-61) strips covered children's sigs, drops covered
   rows from outline and items, drops word-facet items in the closure and
   refuses by-sig reads in it; ALREADY READ is filtered. Named residual: an
   older descendant version reached through an older parent.
4. **Itemizer.** New pure `assistant/branch-items.ts` (+ spec): `itemsOfLayer`,
   `outlineOf(segments, budgetTokens)`, `aboutOf(layerSig, word)` (index pools
   opened with `openPool`, never create). Specs: a slot added at test time
   appears; a picture gets no figure; withheld shows `(withheld)`; no live
   projection.
5. **Reader and parser.** `hive-tree-reader.ts` delegates `outline()` and
   `items()`. `hypercomb-observation.ts`: the verbs (:32-33), `read /path [n]`
   before the route rule (:309-380), validators, formatter branches with full
   sigs, `≈`/`~` and the meter.
6. **Working set.** New pure `assistant/working-set.ts` and
   `working-set.service.ts` (IoC `@diamondcoreprocessor.com/WorkingSet`, one
   set per convoId, reached from shared only through IoC). Specs: budget,
   order, a pin survives a summary.
7. **Chat wiring** (`chat-window.component.ts`). `#contextLines`
   (:6403-6423) delegates; unread add and use go through `runRead`.
   `systemFor` gains the block after ALREADY READ, rebuilt before the fold's
   estimate (:7783-7787). The manifest gains included and omitted rows
   (`ContextInclusionReason` widens). `TurnMeta.held = draftSig` is written at
   turn end (`chat-thread.ts:151-176`) and restored on reload. The shelf
   (:1751-1754) shows rows with `≈tok`, a pin toggle, × and "Keep…".
8. **Kept contexts.** New `assistant/contexts-facet.ts` (IoC
   `@diamondcoreprocessor.com/ContextArtifacts`): `keepContext`,
   `listContexts`, `useContext`, `forgetContext`. Specs: same rows, same sigs;
   no layer hop in the closure; freshness from sigs; withheld refused even for
   the local model; no key, no write.
9. **The keep word** (`commands/context.queen.ts`): the sub-words; a machine
   declaration after `file.queen.ts:26-40` (reach `additive`, scope `hive`),
   queued `additive` with `forceReview` (`execution-queue.ts:15`, :26); "this
   conversation" and "kept here" in the Context Window; i18n.
10. **Teaching** in `hypercomb-work-fence.ts:174-191`. **Bridge, thin:** ops
    `contexts-list` and `context-use` in `claude-bridge.worker.ts`.
11. **Doctrine documents.** New `documentation/context-artifacts.md`; after
    decision 6, amend `anatomy-context-need.md:167-178` and
    `llm-primitive.md:64-71`; add the context row to `every-act-has-a-word.md`.
12. **Verify.** Vitest from `src/` with `doctrine.spec.ts`: no new pool
    meaning, folder or allowlist entry, no raised storage count. On 4250, OPFS
    never wiped: a small model runs outline, items, `read [n]`, add, summary,
    pin and an approved keep; a fresh conversation sees `◆` and runs
    `context use`; rounds and tokens are compared with the 23k-59k baseline;
    the facet head and artifact sigs exist and user data is unchanged.
13. **Spin off:** pool kinds for `llm:context` and `system:compaction`; the
    orphan resource in `context-summary-gen.ts`; whether notes facet writes
    should pass `emit:false`; retire or reconcile `context:basket` and
    `context:groups`; one window fallback for compiler and fold; whether
    `agent` joins `EDGE_FIELDS`.

## Decisions for jwize

1. **Where do kept contexts travel?** *Proposed:* like notes — a succession
   facet replicating to your own hosts, public only inside a public closure.
   The alternative keeps them on this device until a published-pool handler
   opts them in; peer-lent models stay refused (`llm-hive-access.ts:3-13`),
   so peers benefit only through a host that carries the facet.
2. **Should `derivedFrom` become a REFERENT field** — a protocol decision
   (`edge-registry.ts:95-100`)? *Proposed:* yes; it is the one field that lets
   a row name its source layer without carrying that subtree.
3. **Should a model's `/context keep` always wait for you, or run on its own
   when additive work is auto?** *Proposed:* always wait (`forceReview`).
4. **The local model's real window** — nothing sets Ollama's `num_ctx`, so
   the meter can only say "128,000 (assumed)". *Proposed:* let you set it per
   provider, kept on the device like the read budget
   (`llm-hive-access.ts:116-120`); the fold's fallback stays.
5. **Withholding by word over-withholds** — an outside model loses the notes
   and kept contexts of every tile sharing a withheld tile's name.
   *Proposed:* accept it; the alternative is routes on facet entries.
6. **Seed doctrine text** — `anatomy-context-need.md:167-178` records
   learning as "a note on a tile"; `llm-primitive.md:64-71` writes outputs
   into tile properties. *Proposed:* both become "a kept context on the
   word's contexts facet", on your approval.
