# Permission groups — the managers speak in sentences

Status: **Proposed 2026-10-12. Slice one built 2026-10-24 (next section); the
rest is not built. Decisions for jwize at the end.**

## Built: slice one (2026-10-24)

Groups for the actors that live inside the hive — a conversation, a provider,
a model — and the word. Bridge codes, the actor door and the decision trail
are not built.

- **The store**: `assistant/permit-groups.ts` (IoC
  `@hypercomb.social/PermitGroups`, published beside the queue in
  `chat.drone.ts`). One `permit@1` document in the pool `permit:groups`
  (declared in core `pool-kinds.ts`). Built-ins `everyone` and `held`. Members
  are `{actor, facet, label}`; the actor atom `{actor:1, <facet>:<value>}` is
  minted silently by signature, and for these three facets the label is the
  value matched.
- **The rule**: pure `decide(doc, kind, facts)`. The row's conversation,
  provider and model pick every group with a matching member, else
  `everyone`. **A kind runs only if every picked group runs it** — the
  intersection, so two groups never add up to more than either. The queue's
  holds and `forceReview` still come first.
- **The queue**: `execution-queue.ts` judges each row by its facts and stamps
  `group` on it; mode and kinds are `everyone`'s; the legacy keys seed
  `everyone` once and are never written (ratchet 3 → 1). Once the Store is
  known, nothing runs by policy until the document has been read; its arrival
  releases what it covers.
- **The word**: `assistant/permit.queen.ts`, `rawArgs`, no machine block —
  `permit`, `permit <group>`, `permit <group> <kind>…`, `manual`,
  `everything`, `add provider|model|conversation <id>`, `drop <label>`,
  `permit held drop <label>`, `dissolve`. Strings go through i18n with English
  fallbacks; no catalog keys yet.
- **The chat's own trust switch** no longer runs a row a named group judged:
  "this conversation runs by itself" stands in for `everyone` only.
- **Proof**: `permit-groups.spec.ts`, `permit.queen.spec.ts`,
  `execution-queue.spec.ts`; in the running hive, in a fresh profile,
  `node scripts/drive-permit.cjs`.

Decided while building, open to jwize's word:

- `trusted` is reserved, not built: the chat window keeps its own switch until
  step 7, and an older build keeps a `trusted` group it reads rather than
  erasing it.
- `add conversation this` waits for the chat window step; an id works now.
- A held actor is not moved by `add`; only `permit held drop` releases it.

Still true from "What exists today": the bridge operator can say `permit`, as
it can say `grant` — decision 2 (the authority flag) closes that.

The word is `permit`. Permission groups sit on the one Execution queue, and
the hive's managers change the hive only through sentences — the words a
participant types — never through raw bridge ops.

Paths are relative to `src/`; `assistant/…`, `commands/…`, `notes/…` and
`sharing/…` are under `hypercomb-essentials/src/`, and the chat files are in
`hypercomb-shared/ui/chat-window/`. Line numbers may move.

## The request

jwize, 2026-10-12, after hearing that the managers changed tiles through raw
bridge ops rather than the hive's own words:

> "yes, have the managers use do sentences through the hive, the idea is we
> can create permission groups so we can allow either auto or manual to make
> decisions. Ideally then the natural language is fast and easy."

So the managers of [the management org](hive-management-org.md) act through
`do` sentences, and permission groups decide which of those run on arrival.
The test was his:

> "the hypercomb primitive is the litmus test"
>
> "the living primitive then primitive but maybe hypercomb primitive is best"

So each part must be a hyperedge between signatures
([llm-primitive.md](llm-primitive.md)), and each hop is worn the way
[life-primitive.md](life-primitive.md) says. Three designs were scored by
five judges, one lens each:

| Lens | Design 0 | Design 1 | Design 2 |
|---|---|---|---|
| Hypercomb primitive | 6 | 8 | 8.5 |
| Safety | 4 | 6.5 | 8 |
| Doctrine | 8 | 7 | 5 |
| Ease | 8 | 7 | 5 |
| Buildability | 6 | 5 | 4 |

The base is Design 0 — the smallest and most reused, scored highest for ease
and doctrine. From Design 1 it takes how groups and claims are keyed; from
Design 2 the actor key, the decision trail and the words-only worker. Every
flaw a judge confirmed is fixed.

## What exists today

- **One device policy, in localStorage**: `hc:execution:mode` and
  `hc:execution:auto` (`assistant/execution-queue.ts:99-104`, written at :153,
  :164), default auto with every kind; a waiting row lives in session memory
  (:35). Trusted conversations are `hc:chat-exec-auto-conversations`
  (`chat-window.component.ts:1216-1222`, written at :3212).
- **An agent can trust itself**: the ask payload's `trust`
  (`scripts/bridge/manager.cjs:227` → `claude-bridge.worker.ts:2108-2109` →
  `chat-window.component.ts:3174`) and the `chat:exec-trust` intent
  (`claude-bridge.worker.ts:2069-2073`).
- **Nobody is identified.** Both brokers forward ops unchanged
  (`scripts/bridge/run-bridge.cjs:268-276`, `hypercomb-cli/src/bridge/server.ts:289-297`);
  a loopback tool with no code is the anonymous operator with raw ops
  (`run-bridge.cjs:195-197`). `run.convoId` and an ask's target are
  self-declared (`claude-bridge.worker.ts:97-107`), and responders already tag
  ops with `run` (`scripts/bridge/loop-run.cjs:153-161`).
- **The operator can widen its own ceiling.** A bridge `do "grant
  destructive"` runs: `grant` and `trust` have no machine block
  (`commands/grant.queen.ts:116-121`, `sharing/trust.queen.ts:9-11`), reach
  defaults to editing and an undeclared scope passes at network
  (`hypercomb-core/src/core/machine-admission.ts:270-272`, :291-312).
- **A manager's `do` lands in jwize's shell**
  (`hypercomb-shared/ui/command-line/command-line.component.ts:2281`, :2293),
  answers `unknown` (:2412-2423), enters command recall, is lower-cased and
  split at behaviour words by the prose reader
  (`commands/utterance/utterance-reading.ts:123-150`), and meets the tag
  extractor, which would lay a `file-on-x` tile (:4741-4762).
- **Managers write with raw ops.** `manager.cjs note`/`unnote` are raw
  `note-add`/`note-delete` (:190-205). The guard `MUTATING_OPS`
  (`assistant/bridge-ops.ts:24-29`) misses eight writers — `hive-root-set`,
  `branch-public`, `slice-create`, `break-issue-update`, `breaks-compact`,
  `redrain`, `gather-own`, `effect-emit` — and `effect-emit publish:run` skips
  the leaves hold.
- **A policy hold is invisible**: the ask filter drops rows without the four
  hold flags (`chat-window.component.ts:3162`), so a manager polls for 15
  minutes (`manager.cjs:230`). Untagged operator submits leave no step
  (`claude-bridge.worker.ts:568-573`).
- **Smaller facts.** `ParticipantDocument`
  (`preferences/participant-document.ts:8-24`) serves the legacy value until
  it hydrates (:14-19), takes one legacy key (:44-45), and drops
  `putPoolDoc`'s sig when it coalesces writes (:116-123, :143-157).
  `deleteAtSegments` returns silently on empty arguments
  (`notes/notes.drone.ts:453-466`). The harness `review` field
  (`assistant/harness.ts:46-47`) is unwired. `groups` is being claimed by
  publish groups (`sharing/groups.queen.ts:1-25`), and `sign('managers')` IS
  the `/managers` bag (hypergraph-molecule-lineage.md:27-29).

## The design

### A group

The whole policy is **one participant document** in the pool
`permit:groups` — colon-scoped, kind `document`: per participant, never
replicated, every version kept, like `ai:withheld`
(`hypercomb-core/src/core/pool-kinds.ts:193-195`). A new store,
`assistant/permit-groups.ts` (IoC `@hypercomb.social/PermitGroups`), holds it
in a `ParticipantDocument`; reads are synchronous, so no projection can drop a
member.

```
{ kind:'permit@1', prev?:<P_n>, said?:<envelope sig>,
  groups:[ { name, mode:'manual'|'auto'|'everything', auto:[kinds],
             members:[ { actor:<actorSig>, label } ] } ] }
```

A group is today's device policy (`ExecutionMode`, `ExecutionKind`,
`execution-queue.ts:43-48`) with a name and members. Group names are user
words inside the colon pool, never `sign(name)`. Three are built in and
cannot be dissolved; the legacy keys seed them once and are never written
again:

| Group | Mode | Members | Seeded from |
|---|---|---|---|
| `everyone` | today's device policy | none; it takes none | `hc:execution:mode`, `hc:execution:auto` |
| `trusted` | everything | conversations | `hc:chat-exec-auto-conversations` |
| `held` | manual | dropped actors | — |

### An actor

An actor is a vertex — a canonical atom with exactly one facet, stored with
`putResource({emit:false})` (`assistant/chat-steps.ts:123-131`):

```
{ actor:1, code:K }      K = sha256('bridge-code:' + the admitted code's hash)
{ actor:1, conversation:<convoId> }   { actor:1, provider:<id> }   { actor:1, model:<id> }
```

The code facet is never the label or the code, so a re-issued code is a new
vertex. Members are bare actor sigs: a reader matches them, so they stay
bare (life-primitive.md:147-160).

### Identity is a fact the broker stamps

- Both brokers set `msg.from` to the presented code's hash when it is in the
  hive's list, else `''`, and delete any client `from`. `run.convoId` and an
  ask's target are **claims**.
- A code is an actor only once bound with `permit <group> add code <label>`.
  `drop` moves it to `held`, never back to operator; only
  `permit held drop <label>`, at the keyboard, releases it. Narrowing never
  widens.
- An actor's lines are caller `'model'`: declared verbs, the granted roster,
  the ceiling (`machine-admission.ts:270-296`). The anonymous loopback client
  stays `'operator'`; `MachineCaller` gains no member.
- **Words only at the worker:** a default-deny
  `ACTOR_OPS = READ_OPS ∪ {submit, chat-ask, chat-reply, exec-rows}` in the
  leaf `bridge-ops.ts` (:1-19) — not "deny `MUTATING_OPS`", which misses
  eight writers. Actor reads are forced to `withhold: true`
  (`hypercomb-shared/core/ai-withheld.store.ts:12-16`).

### How a row is decided

The first rung that answers wins.

1. **Refused**, nothing queued: the authority flag (decision 2);
   `admitMachineCall` as `'model'`; the behaviour's `machine.refuse`; and a new
   optional `MachineGrammar.placed(args)` — an actor's page-relative lines
   (`commands/create.queen.ts:51-62`, `commands/named-target.ts:10-21`,
   `presentation/tiles/hide.queen.ts:56-66`) answer "this line names no place".
2. **Held**, and no group lifts it: `forceReview` — at the actor door every
   destructive line, since `JEV_REACH_GATES.destructive.automatic` is false
   (`assistant/jev-decision.ts:179-183`); `needsGrant`; leaves
   (`hypercomb-grammar.ts:309-321`); foreign — the chat's rule, plus an actor
   whose run read peer content (`hive-tree-reader.ts:1656`, kept as a ledger
   step), plus a row whose conversation holds a turn by an actor not among its
   facts. Holds stay first (`execution-queue.ts:174-178`).
3. **Not hydrated.** A row with an actor fact waits for the document — it
   fails closed. A row with none decides at once against the legacy-seeded
   value, so own domain runs on the first frame.
4. **Remembered reads** run (`execution-queue.ts:185-190`).
5. **Group policy**, by a pure exported `decide(row, doc)`. **Facts** — the
   stamped code, the conversation the participant typed in, the provider and
   model the page called — pick the groups (`everyone` if none). **Claims**
   only intersect, and never add kinds. A kind in the intersection runs on
   arrival (`by:'policy'`); any other waits.
6. **The hand**: Run, Skip or Always (`execution-queue.ts:229-251`).

`permit` decides run or wait; `grant` decides admit or refuse; there is no
per-group ceiling. When the harness `review` field is wired, it may only
subtract.

### How the participant edits it

Two doors onto one store API. The word `permit` takes `rawArgs` and has no
machine block, like `grant` and `trust`. In the Execution window the mode
radios and kind boxes edit `everyone` (today's meaning); "This conversation
runs by itself" toggles membership in `trusted`; each row shows its actor,
group, and "by policy" or "by your hand". Both self-trust doors are removed.

### The actor door

`hypercomb-shared/ui/command-line/actor-line.ts`, in shared beside the plan
code it reuses:

1. `manager.cjs do "<sentence>"` sends `{op:'submit', text, run:{convoId, id}}`
   — the manager's conversation from the roster (`manager.cjs:136-146`).
2. The worker resolves `from` to the bound actor A and puts
   `actor:{sig:A, facts:[A], claims:[conversation(run.convoId)], run, foreign}`
   on the request (`hypercomb-core/src/remote-submit.types.ts:79-87`).
3. The listener hands it to `actor-line.ts` before `#setShellValue`, so it
   never touches the shell, recall, the prose reader or the tag extractor.
4. `workLineGrammar(line,'do')` lower-cases only the verb, so a note keeps
   its case (`hypercomb-core/src/core/work-fence.ts:303-311`); then
   `parseHypercombGrammars` as `'model'`, placed, reach and leaves,
   `executionQueue.request`, and on run the **one** shared plan lane, a
   `PlanTransaction` and `executePublicCanonical`
   (`commands/slash-behaviour.drone.ts:165`), rolled back on a throw.

The same sentence is judged the same way at both doors. It answers:

| Outcome | Carries | The manager |
|---|---|---|
| ran | `{id, actions:[{command,args,ok}], after:[layer sigs], decision}` | reads the tile back; `ok` means only "did not throw" (hive-management-org.md:95-99) |
| held | `{id, group, kind, why[]}`, at once | reports it, and does not get around it (`manager.cjs:238`) |
| refused | `{reason}`, the gate's own | exits non-zero |
| running | `{id}`, past the 8 s deadline | reads it later with `row <id>` |

`why` reads like "managers runs read and additive; this is editing", "it
takes something away", "it leaves this machine", "it follows someone else's
words". A new read op, `exec-rows`, returns a row from the queue, or after a
reload its `decide` step, or "gone; nothing ran; say it again".
`chat:asked` reports every waiting row of the asked conversation.

### What each manager op becomes

| Manager says | Becomes |
|---|---|
| `note /r "t"` (raw `note-add`) | `do "file on /r: t"` — additive, hive-scoped, throws when no tile is there (`assistant/file.queen.ts:34-41`, :79-101) |
| `unnote /r <id>` (raw `note-delete`) | `do "unfile on /r: <noteId>"` — a new destructive word ("takes it off where it is listed", `machine-grammar.ts:47-50`); refused under the default editing ceiling (`machine-admission.ts:129`), so a proposal, as the org rule says (hive-management-org.md:54); a held row if the ceiling is raised |
| `install` | unchanged, run as the operator without the code; `add` is refused to an actor |
| `op` with a write | refused for an actor |
| `ask` | drops `trust`; rows are judged as managers ∩ the asked conversation's group |
| `report` | the turn is stamped `agent: A` |
| `hide`, `create`, `title`, `keyword`, `postit`, `into` | "this line names no place" — a proposal until each has a route form |

An act with no word is refused ("/x is not a behaviour in this hive",
`machine-admission.ts:234-237`) and emits `machine:miss` for the harness
manager; the manager reports it and never falls back to a raw op. Known
gaps: note mark, tag, retext, nest, move, split, add-child
(`notes.drone.ts:473-660`); tile rename, promote-to-parent, open/enter/exit
(every-act-has-a-word.md:74-89); reorder (`slash-behaviour.drone.ts:569-602`).

## The words

| Form | Does |
|---|---|
| `permit` | every group: mode, kinds, members by label, what each ran by policy this session |
| `permit <group>` | one group |
| `permit <group> <kind> [<kind>…]` | runs these kinds on arrival; the rest wait for a hand |
| `permit <group> manual` / `everything` | nothing runs by itself / every kind does — holds still wait |
| `permit <group> add code <label>` | binds an actor; also `add conversation <convoId\|this>`, `add provider <id>`, `add model <id>` |
| `permit <group> drop <label>` | the actor moves to `held`, never to operator |
| `permit held drop <label>` | releases it; the word says its lines now run as the operator's |
| `permit <group> dissolve` | members move to `held`; the built-ins refuse |

A new group starts manual; an actor sits in one group; `everyone` takes no
members. Setup, once, by jwize — `bridge give` mints a code shown once, and
`grant allow file` puts `file` on the model roster:

```
bridge give managers
permit managers add code managers
permit managers read additive
grant allow file
```

Each manager is launched with `HYPERCOMB_BRIDGE_TOKEN` set to that code
(sent as a Bearer header, `manager.cjs:45-46`) and `MANAGER=<name>`; `do`
refuses to send without both.

```
manager.cjs do "file on /games/solomon: Call ACME"   → ran, case kept
manager.cjs do "unfile on /games/solomon: <noteId>"  → refused (editing ceiling): a proposal
manager.cjs do "hide x"                              → refused: this line names no place
manager.cjs row <id>  |  manager.cjs held            → a row's state, live or from the ledger
```

After `permit managers read`, the `file` line answers held, and Run settles
it to ran.

## Defaults

On first run the participant's own hive behaves exactly as today.

- `everyone` is the device policy as it stands (with no keys, auto with every
  kind), so own domain runs. `trusted` is everything, with the legacy trusted
  conversations. `held` is manual and empty. A new group starts manual.
- Recommended managers group: `read additive` runs, editing waits for a
  hand, destructive is refused by the unchanged default grant,
  editing/network. Removals stay proposals.
- No code is an actor until bound; unbound codes and code-less loopback tools
  keep today's operator path. Before hydration, actor rows wait.
- Actor reads are always withheld-filtered; foreign holds for an actor's
  whole run; destructive actor lines always `forceReview`. Nothing lifts
  `forceReview`, `needsGrant`, leaves or foreign.
- Off until jwize decides: the authority flag and `BRIDGE_LOOPBACK=code`.
- No localStorage key is written; every record is silent; the document never
  replicates.

## The hypercomb primitive, and the living primitive

**Vertices**, all signatures, all written silently:

- **A** the actor atom; **S** the sentence; the page heads before and after,
  from `PlanTransaction` (`hypercomb-plan-transaction.ts:70-95`).
- **P** = `sign(canonical policy bytes)`, minted as a resource for every
  policy value a decision uses, because `ParticipantDocument` drops
  `putPoolDoc`'s sig and a decision could otherwise cite a version that never
  landed.
- **Q**, the request:
  `{kind:'request@1', said:env{resource:S, relation:'said'}, facts, claims, kind, leaves, foreign, at}`.
- **R**, the decision:
  `{kind:'decision@1', request:env{resource:Q, relation:'request'}, policy:P, group, by:'policy'|'hand'|'hold'|'refused', holds, grant:'<reach>/<scope>', before:[env{layer, relation:'before'}], after:[env{layer, relation:'after'}]}`.

**Hyperedges:**

```
(a) permit:  {P_n, S}          → permit                  → P_n+1 (carries prev:P_n, said:env(S))
(b) decide:  {Q, P, A…}        → decide() or the hand    → R
(c) run:     {S, before heads} → executePublicCanonical  → after heads, recorded inside R
```

`decide` is pure, so any verdict can be recomputed from P and Q.

**The living primitive.** Every hop a reader opens is a `mintMetaEnvelope`
envelope with one payload (`hypercomb-core/src/core/life-primitive.ts:105-145`);
what a reader matches — A, P — stays bare. Ledger steps carry
`env{resource:R, relation:'decision', agent:A, at}`, the first live writer of
`agent` (life-primitive.md:28-31): a `request` step on arrival and a `decide`
step on settlement (`appendStep`, `chat-steps.ts:160`). Untagged operator
submits are recorded under a default local run instead of nowhere.

**What does not pass:**

1. **Authentication** — the broker's stamp is trust in a process and the OS,
   not a signature; a code-less loopback tool is the anonymous operator until
   `BRIDGE_LOOPBACK=code`.
2. **A waiting row's live state** is session memory; after a reload, Q has no R.
3. **Outputs beyond page heads** — a note's word facet, mesh events, pool
   docs — are not output vertices (`hypercomb-plan-transaction.ts:26-29`).
4. **The `/grant` ceiling and roster** are still localStorage keys
   (`machine-admission.ts:348-361`), carried in R as a string.
5. **The anonymous operator's raw ops** remain a side channel.

**The rest of the doctrine.** Group policy is data in one pool. `permit` is
the first word for Execution policy, and `unfile` gives note removal one.
Refusals come from declared reach, scope, refuse and placed. The storage
ratchet goes down: `execution-queue.ts` 3 → 1, `chat-window.component.ts`
11 → 10 (`src/doctrine.storage-writes.json:110`, :211). The document holds
sigs, labels and kinds, and `putPoolDoc` refuses any document carrying a key
(`hypercomb-runtime/src/store.ts:432-444`).

## What goes wrong with the alternatives

- **Members as names (Design 0).** A manager's name was read from a note at
  a route — a record keyed by path, not a vertex. Identity came from
  `run.convoId`, which responders already send, so their submits would become
  default-deny model lines. Automatic runs recorded no policy. `unfile` was
  declared editing, so it passed the ceiling with no hand. An unlisted
  convoId fell into `everyone` (auto, every kind); an ask borrowed a trusted
  conversation's group; the raw-op fence was only in `manager.cjs`, which any
  Bash call bypasses. Its setup was the easiest: three sentences, no codes.
- **Dropping widens (Design 1).** An ungrouped caller with a code stayed
  operator, so dropping a manager or withdrawing its code raised it to full
  operator. Its actor was a label (`hypercomb-core/src/core/llm-keys.ts:240-255`),
  so a code re-given under the same label inherited membership. Its policy was
  an asynchronous projection that can silently drop a member; one broker
  forwarded a forged `via`; `permit` entered the model catalogue; the
  decision went into core though it is not a primitive. Its group shape was
  still the primitive judge's cleanest mapping.
- **Too much surface (Design 2).** Per-group ceilings put admission into
  `permit`, and its own `unfile` was refused rather than held. `ops:'raw'`
  reopened the side channel. `--at /route` tied managers to jwize's page.
  Forcing `run.convoId` to `agent:<actorSig>` moved a manager's trail out of
  the conversation `thread` reads; logging every operator line crowds
  `KEEP_SETTLED=40`; moving plan code into core risks shell skew. Before
  hydration a manager fell to auto with every kind. Its authority flag closes
  a live hole but reverses written doctrine (`grant.queen.ts:116-121`,
  `machine-admission.ts:47-54`), so here it is decision 2.
- **Deny `MUTATING_OPS`.** The doctrine judge preferred it, to keep no read
  list, but eight writers are missing from it. Default-deny fails closed.
- **Membership deciding the caller kind** lets leaving a group raise a
  caller. **`sign(name)` as a group address** is the `/managers` bag. **The
  word `groups`** belongs to publish groups.

## Implementation steps

Build core, then essentials; run vitest from `src/`.

0. **Coordinate.** `/claim` every file below; another session holds edits in
   `side-effects.ts`, `work-fence.ts`, `hypercomb-work-fence.ts`, the
   chat-window specs, the i18n catalogs and `groups.queen.ts`. Prove the four
   reader hazards (lower-casing, splitting, `TAG_ASSIGN_RE` eating
   `/file on X: text`, `unknown` receipts) with specs, never on jwize's hive.
1. **Core contracts.** `remote-submit.types.ts` (+ spec): `actor?`, outcomes
   `held` and `running`, `ran` gains `id`/`after`/`decision`.
   `machine-grammar.ts`: optional `placed?`. `pool-kinds.ts`:
   `['permit:groups','document']`.
2. **Authority flag — only on jwize's yes; ships alone.** `authority = false`
   in `hypercomb-core/src/queen.base.ts`, refused for every caller
   (`machine-admission.ts:218-221`), carried by `wrapQueen`
   (`slash-behaviour.drone.ts:1059-1083`), kept awake by
   `hypercomb-essentials/scripts/passive-queen.ts`. Set on `grant`, `trust`,
   `withhold`, `aliases`, `bridge`, `permit`. Spec: refused for operator and
   model.
3. **Store, queue and trail.** NEW `assistant/permit-groups.ts` (+ spec): the
   document, `actorSig`, `decide`, `policySig`, the edits and guards.
   `execution-queue.ts`: rows gain `facts`, `claims`, `group`, `by`;
   `runsByPolicy` delegates to `decide`; actor rows wait for hydration; mode
   and auto address `everyone`; `setItem` at :153, :164 deleted; `settle`;
   `requested`/`settled` events. NEW `assistant/permit-trail.ts` (+ spec) mints
   Q and R and appends steps, outside the queue to avoid an import cycle.
   Ratchet :110 → 1. Specs: a claim never widens; no group lifts a hold; actor
   rows wait before hydration; drop goes to `held`; legacy keys are never
   written; every cited P resolves.
4. **Words.** NEW `assistant/permit.queen.ts` and `assistant/unfile.queen.ts`
   (+ specs). `unfile` reads first (`getNotesAtSegments`, `notes.drone.ts:404`)
   and throws on a miss, then unlinks with `deleteAtSegments`; destructive,
   hive, placed; 64-hex id. `file.queen.ts` gains `placed`. Register in
   `side-effects.ts`; add `unfile` to the AUDITED table
   (`commands/machine-declarations.spec.ts:60-92`); i18n in all 14 catalogs.
5. **Bridge.** `bridge-ops.ts`: `READ_OPS` (twenty ops, each handler
   confirmed read-only) and `ACTOR_OPS`. Both brokers stamp `from` and gain
   `BRIDGE_LOOPBACK=code`, off. `claude-bridge.worker.ts`: resolve the actor;
   refuse other ops; force withhold; record `foreign-read`; pass `actor` on
   submit and record untagged submits; drop ask `trust` and
   `chat:exec-trust`; stamp `agent` on replies; new `exec-rows`. Specs: `from`
   is overwritten; an actor is refused raw ops and `effect-emit`.
6. **Shared actor door.** One exported `hypercombPlanLane` used by the chat
   too (`chat-window.component.ts:1347`); `PlanTransaction.moved()`; NEW
   `hypercomb-shared/ui/command-line/actor-line.ts` (+ spec); the listener
   branch at `command-line.component.ts:2281`, before `#setShellValue`.
7. **Chat window.** Retire its own trust code (:3091-3103, :3207-3230) for
   `permit` on `trusted`; ignore `ask.trust`; pass facts and claims;
   `#startAsk` answers held for any waiting row; `agent:held` carries group
   and label; `conversationForeign` counts other actors' turns; rows show
   actor, group and by; the head labels `everyone`. Ratchet :211 → 10.
8. **`scripts/bridge/manager.cjs`.** `MANAGER` and a code required; `do`
   sends `run`; `note`/`unnote` become sentence wrappers; `row` and `held`
   read `exec-rows`; `ask` drops `trust`; refused exits non-zero; `install`
   and raw `op` documented as the operator's.
9. **Documentation.** This file becomes the built record; update
   `hive-management-org.md`, `every-act-has-a-word.md` (`permit`, `unfile`),
   `hive-read-fence.md` §3 and `life-primitive.md`; one sentence in
   `grant.queen.ts` and `machine-admission.ts` that a bound actor is judged
   as a model.
10. **Verify.** Vitest; the ratchet proves no count rose. On 4250, after
    jwize types the setup himself, comparing signatures and never clearing
    OPFS: `file` runs with case kept and a decide step; `hide x` names no
    place; after `permit managers read` the file line is held and Run settles
    it; `unfile`, raw `note-add` and `effect-emit` are refused; a forged
    convoId never runs more than managers allows; jwize's shell is untouched.

## Decisions for jwize

1. **Names** — the word `permit` and the pool `permit:groups`?
   *Recommended:* yes. `groups` is publish groups', and "hypercomb primitive
   is best" is read as the test, not the name.
2. **Authority flag** — refuse `grant`, `trust`, `withhold`, `aliases`,
   `bridge` and `permit` at every machine door, your own Claude Code
   included? *Recommended:* yes. It reverses `grant.queen.ts:116-121` and
   closes a live hole: today a bridge `do "grant destructive"` runs.
3. **`BRIDGE_LOOPBACK=code`** — must every loopback tool present a code?
   *Recommended:* off for now. Without it a code-less manager is the anonymous
   operator; with it your own sessions need codes too.
4. **One code or one per manager?** *Recommended:* one org code to start
   (each manager's identity a claim that only narrows); four copy-once codes
   give stronger attribution.
5. **Removals** — keep the editing ceiling, or `grant destructive` plus
   `grant allow unfile` so a removal is a held row one Run away?
   *Recommended:* keep the ceiling, so removals stay proposals. If you raise
   it, also say `permit everyone read additive editing`.
6. **Every bridge code an actor by default?** That limits remote answering
   sessions and pages to words. *Recommended:* no — only codes you bind.
