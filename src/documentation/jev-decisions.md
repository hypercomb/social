# Jev runs the show

**Status: BUILT 2026-09-20** (second design; the first, a judge over
model-written proposals, is retired). Direction from Jaime: *"JEV runs the
show — LLMs produce a result table or possibility chart, JEV decides, so the
time a model spends deciding is taken off the path."* Checked against
TypeSafe's own guidance the same day: Jev is a System-One model built for
snap judgments over options YOU supply, answered in parallel in one call; a
question like "determine the best course of action" is the thing it is NOT
for, and the recommended shape is *break the task into small questions and
compose the answers in code*. That is exactly this design.

## 1. The split

| Who | Good at | Does |
|---|---|---|
| **The worker** (any chat model in the suite) | listing, writing sentences the hive can run, prose | ends every round with a **possibility table** |
| **Jev** (`~typesafe/jev-latest`, OpenRouter Decisions API) | fast, cheap, calibrated judgments over supplied options | answers one batch of snap questions about the rows |
| **Code** (`jevResult`, the chat loop) | arithmetic, gates, budgets, authority, execution | composes the plan and runs it |

The worker never argues for a step, ranks steps, or reasons about which is
best. It is told so in `JEV_WORK_INSTRUCTION`. That is the performance win:
the slow, expensive part of a model's turn — deliberation — is removed, and
the model's output shrinks to a short JSON table. A lighter tier can list as
well as a heavy one; the decision quality now comes from Jev's gates.

## 2. The possibility table

Fence `hypercomb-table` (`hypercomb-work-fence.ts`, kind `table`; replaces
`hypercomb-propose`). One closed JSON block, two to eight rows:

```json
{"rows":[
 {"id":"a","kind":"read","label":"See who is under people","line":"list /business/people"},
 {"id":"b","kind":"do","label":"Create the people tile","lines":["create people"]},
 {"id":"c","kind":"answer","label":"Answer now"},
 {"id":"d","kind":"ask","label":"Ask how to group","line":"Group by city or by role?"}
]}
```

- `read` — one read line in the observation verbs (`tree read list history
  summary find code`). This is "finding information".
- `do` — one to six behaviour sentences from the live vocabulary. This is
  "storing meta changes / organisation".
- `answer` — the worker could answer now from what the messages hold.
- `ask` — a preference only the participant can supply; `line` is the question.

`id` `[a-z][a-z0-9_-]{0,23}` (never `none`), `label` ≤ 70 chars and distinct,
optional `why` ≤ 200. A bare `hypercomb-do` block in Jev mode is treated as a
one-row table. A bare `hypercomb-read` runs as written: reads are safe.

**A table is recognised by its shape.** Models told to write a
`hypercomb-table` fence still reach for a `json` fence, a bare fence, or no
fence (the first live run did exactly that, and Jev was never called). A JSON
object whose first key is `rows` counts as a table in any of those spellings;
an organizer's `{"nodes":[]}` or ordinary prose does not.

**The hive's parsers go first.** Before Jev sees a row, every read line goes
through `parseHypercombObservationGrammars` and every do row through
`parseHypercombGrammars` against the census. A row the hive cannot run is
DROPPED and named back to the worker; Jev only ever chooses among rows that
can already run. If no row survives, the round is refused with the reasons.

## 3. The questions (one call, all parallel)

Rewritten after the audit against TypeSafe's guidance (§10). Every question
and every threshold lives in one place, the tables at the top of
`jev-decision.ts`, so the whole rubric can be read at once. Each question asks
ONE condition and carries `criteria` saying what yes and no mean.

| Row kind | Questions (noul, one condition each) | High means |
|---|---|---|
| read | `_needed` would the read's result help answer the request? · `_known` does evidence already show what it would return? | needed: useful · known: redundant |
| do | `_toward` does it carry out the request, or a step toward it? · `_beyond` does it change something the request did not ask to change? · `_grounded` does evidence show the tiles, names and places it relies on? · `_rule<k>` would it break doctrine section k? | toward, grounded: good · beyond, rule: bad |
| answer | `_answered` does evidence hold everything needed to answer fully? | good |
| ask | `_open` does the request leave a choice only the participant can make? | good |
| all | `next` choice over every row id plus `none` — no preferences in its wording; policy lives in code | |

**Doctrine is judged section by section.** `doctrineSections` cuts the
anatomy's `# Doctrine` into its sections (six today, each lifted from its own
document). Every change gets one question per section, with the section
carried in the question itself. Asking about "every rule" at once, with all
of doctrine in the shared state, scored a requested nesting as a violation
in the first real run: Jev reads literally, and unrelated rules distract it.
Each section is a verbatim span of the worker's own system text, so the
source boundary still holds.

State sent: `{request, evidence[], rows[]}` — no doctrine (it rides in its
questions) and no reach (it decides gates in code). Every field must already
exist in the worker's system text or conversation: verbatim, JSON-escaped, or
without the leading slash the hive adds to canonical grammar. A refusal names
the field it could not find. Jev never fetches, never resolves a signature,
never sees the whole conversation.

## 4. Composition (`jevResult` → `plan`)

Gates (`JEV_GATES`, conservative starting values, not measured rates):

| Row | Passes when |
|---|---|
| read | needed ≥ .60 (was .80 until the first real scoreboard: a root read at .66 waited although a read changes nothing) and known ≤ .50 |
| answer | answered ≥ .90 |
| ask | open ≥ .90 |
| do, additive | toward ≥ .90, beyond ≤ .10, every rule ≤ .05 |
| do, editing | as additive, and grounded ≥ .90 |
| do, destructive | never automatic: always waits for the participant |

Any rule at or above .95 rejects the change outright.

**The choice threshold scales with risk** (`JEV_CHOICE_GATES`): answer .60,
ask .60, read .50, additive .70, editing .85; removals never. Below a .50
floor the choice is ignored. Confidence alone decides — TypeSafe derives it
from the distribution, so the former winner and margin checks repeated it.

1. `next` is confident and the chosen row passes its gates →
   - `answer` → `{kind:'answer'}`: the worker is told to answer in prose; that
     is the last round.
   - `ask` → participant question with the ask line as the prompt and the
     surviving rows' sentences as options.
   - `read` → `{kind:'read', rows}`: the chosen read plus any other passing
     read, best fit first, up to `JEV_MAX_READS` (2) — reads are cheap and
     independent, so a round settles several assumptions at once.
   - `do` → `{kind:'do', review:false}`: queued in Execution under the
     participant's normal policy.
2. `next` is a confident `do` that fails a gate but is not rejected →
   `{kind:'do', review:true}`: it waits in Execution with `forceReview`; no
   automatic setting can release it.
3. Otherwise, if any read passes → read first. Uncertainty is resolved by
   looking, not by guessing. This also covers a chosen row that conflicts
   with doctrine.
4. Else, every change rejected → `revise` (sent back to the worker as a
   refusal). Else → `participant`, with rejected rows excluded from the
   choices.

Whenever the decision falls to review or to the participant, the reason
carries Jev's scoreboard — each row's fit, and for changes its rules and
grounded scores, plus the `next` choice and its confidence — so a
participant can see which gate held it back. The gates are tuned against
those numbers, not guessed.

No averaging can compensate for a failed rule. Rejected rows are named to
the worker as "never to be proposed again". A positive decision grants no
permission: execution policy, live vocabulary validation, the serialized
lane and snapshot checks all still apply.

## 5. The participant speaks the hive's language

Direction from jwize: *"everything is run through behaviors, nothing should
be hard coded."* A table question therefore offers the rows' **behaviour
sentences** as its options — `create jev-proof`, `list /` — never their
labels. When the participant's message is one of the sentences the previous
turn offered, the hive runs it as that behaviour through Execution, parsed by
the same census parser every table row goes through, and the worker continues
from the receipt. No decision is bought: the participant outranks Jev. Only
an OFFERED sentence runs this way; ordinary prose never becomes a command.

**The imprint.** Picking a sentence option also puts that sentence on the
command line, unfocused (`search:prefill`). The participant sees the dialect
they just used, in the place where they can say it themselves next time.
What counts as a sentence is whatever the live census parsers accept; a
label, a question or "Something else" leaves the line alone.

**What a failure means.** The census is the audit: a behaviour declares on
itself what a machine may say to it, and default-deny covers the rest. So a
request the hive cannot do has only two causes — the behaviour does not
exist, or it exists without a machine declaration. On 2026-09-20 about 25
behaviours were machine-callable out of roughly 114 behaviour files; that
gap, not the loop, is the limit on what chat can do.

**Every refusal is recorded.** When the census refuses a sentence — a table
row, or a plain change block — the chat emits `machine:miss` and essentials
(`assistant/machine-misses.ts`) keeps one immutable record per miss in the
`machine:misses` pool. The word `misses` reads them back grouped by the
missing word, most asked-for first. That list is what to build or declare
next, taken from real requests rather than guessed.

**A change's reach decides its gates.** Each change row carries the reach its
behaviours declare on themselves, read from the census by the loop and never
sent to Jev. Additive changes need fit and doctrine but not prior evidence;
editing needs fit, doctrine and grounding; anything that takes something
away always waits for the participant (`JEV_REACH_GATES`).

## 5a. The direct path: Jev picks the behaviour

Built 2026-09-21 (`jev-creative-plan.md` §1, after Browser Use's Jev agent).
Before any worker is asked, one Jev call (`assistant/jev-direct.ts`) asks
whether the request is ONE census step and which: `single` (one listed
behaviour, used once, does it all), `behaviour` over the census's callable
behaviours minus every removal, `span` over exact spans of the request found
in code, and `target` over the current page's tile names. The argument kind
comes from each behaviour's declared forms: `<name>` takes a span, `<tile>`
a listed tile, a bare word nothing. Nothing is generated.

When `single` ≥ .90, the behaviour clears its reach's choice gate, and the
span or tile clears .70, the sentence goes through the census parser and
runs through Execution under the participant's policy. The worker is never
called, and the answer is the hive's receipt plus "workers: no calls". Any
unsure answer hands the turn to the worker loop unchanged (`passed` in
`jev:outcomes`). A picked table sentence skips this path. The boundary is
the request, the catalogue the worker would be sent, and the page listing,
read under the OpenRouter grant with its snapshot guarding the run.

## 5b. Jev checks the answer

Built 2026-09-21 (`jev-creative-plan.md` §2.1). When a Jev-mode turn ends in
prose and the hive read something this turn, one Jev call
(`assistant/jev-verify.ts`) asks `supported` (everything the answer says
about the hive is in what was read) and `complete` (every part of the
request is answered), each ≥ .80. The answer is never rewritten. When either
falls short, the hive adds one line under it: "Jev could not confirm this
answer against what the hive read", with the two numbers. An answer after a
change with nothing read since is not checked, because there is nothing to
check it against. Each check records `verify:verified` or
`verify:unverified` in `jev:outcomes`.

## 6. The whole provider suite

Jev serves EVERY worker — a local model, a direct vendor key, an OpenRouter
model. `JevDecisionService.ready(providerId)` requires: Jev added and enabled
in the picker, an OpenRouter key, the worker enabled and not decision-only,
and **OpenRouter's "may read the hive" grant**. That grant is the one
disclosure gate: what a worker read of the hive travels to Jev only when the
participant already lets OpenRouter read the hive. The previous rule (only
OpenRouter-credentialed workers) is gone; it protected nothing the grant does
not, and it kept Jev away from the local model, which is where deliberation
is slowest.

## 7. Budgets, provenance, verification

- One Jev call per round, at most `MAX_WORK_ROUNDS` (10) per turn; 20 s
  timeout; cancellation follows the worker turn. No retries, no fallback
  model calls. Per-turn decision characters bounded by the OpenRouter read
  budget (24,000 default). Exact packets reuse a result within the turn,
  keyed by source signature; nothing survives across turns (rolling alias).
- Request, doctrine, evidence, each row's label/lines/why, reasons and answers
  are separate immutable resources; the `jev-input` manifest (rubric 3) and
  the `jev-decision` receipt reference them by signature and ride on the
  turn's read provenance. Provider usage, model and cost enter the attempt
  ledger; the turn reports worker and Jev tokens separately.
- Snapshots are checked before and after each decision and before action.
  After a change ran the worker is told to include a verifying read row;
  when none followed, the final message says verification is missing.

## 8. Files

- `hypercomb-essentials/src/assistant/jev-decision.ts` — rows, questions,
  gates, composition (pure; `jev-decision.spec.ts`).
- `hypercomb-essentials/src/assistant/jev-decision.service.ts` — readiness,
  source boundary, the Decisions call (`jev-decision.service.spec.ts`).
- `hypercomb-shared/ui/chat-window/hypercomb-jev.ts` — shell contract, table
  parser, instruction, participant question, choice note, provenance
  (`hypercomb-jev.spec.ts`).
- `hypercomb-shared/ui/chat-window/chat-window.component.ts` — the round
  loop: parsers first, `judge`, plan switch.

Official references (checked 2026-09-20): OpenRouter Decisions API
(`POST /api/alpha/decisions`, question types `noul` / `choice` / `score`,
answers with `probabilities` and `confidence`, `usage.cost`);
TypeSafe *Primitives* — "ask for one snap judgment per question", "ask
multiple questions together", "speculative fan-out"; OpenRouter cookbook
*Jev-verified cascade*.

## 9. Outcomes

Every decided round emits `jev:outcome`: ran, skipped, failed, answered,
deferred to the participant, or refused. Essentials
(`assistant/jev-outcomes.ts`) keeps one content-addressed record per outcome
in the `jev:outcomes` pool, tied to the decision receipt's signature, with
the change's reach and whether it waited for review. The Jev row of the
providers window shows the tally. These are the numbers the gates are tuned
against — a skipped automatic change is a gate set too low.

**Tuning from the outcomes: the golden set** (`jev-creative-plan.md` §3).
Every decision's receipt names, by signature, everything Jev was shown and
everything it answered, so any past decision can be decided again offline
under candidate thresholds, with no Jev call (`assistant/jev-replay.ts`).
Run it against the attached hive:

```bash
node scripts/jev-golden.cjs
```

It prints, per candidate, how many decisions come out the same, how many
would newly run on their own, and how many would newly be held, each split by
whether the participant ran or skipped the step when asked. A skipped change
a candidate would run on its own is a gate set too low. Replaying under
today's thresholds reproduces every stored decision (checked by the 4250
harness). Change `JEV_GATES` only by hand, from that table, and add the run
here. Only the numbers are candidates: which gates a reach needs, and that
removals are never automatic, are doctrine.

## 10. Audit against TypeSafe's guidance (2026-09-21)

Read from TypeSafe's own docs: their agent skill, the building guide, the
question and confidence pages, Jev 1.13's known weaknesses, and the closest
cookbooks. **Our doctrine outranks theirs** (jwize): each practice was weighed
against what it would break here.

| Their advice | Determination |
|---|---|
| A generative model lists, Jev picks; code owns policy; one call, many questions; a "none" option; questions and thresholds in one file | Already so |
| One condition per yes/no question | Adopted (§3) |
| Criteria on every yes/no question | Adopted (§3) |
| Don't hide several judgments in one question; keep irrelevant detail out of state | Adopted: one question per doctrine section, doctrine out of state (§3) |
| Thresholds scale with risk; confidence already summarises the distribution | Adopted, scaled by each behaviour's own declared reach; removals stay never-automatic (§4) |
| Validate thresholds on your own outcomes | Adopted: the outcomes pool (§9) |
| Retry with backoff on rate limits | Declined: this document forbids automatic retries (§7) |
| Avoid agent loops where a workflow can do the job | Declined: the read fence and the Execution rounds are our architecture |
| Narrow the options per request (skill suggestion) | Declined for the worker's vocabulary: it would break the byte-stable system text vendor prompt caching depends on (anatomy-context-need.md) |
| Pick the function and its arguments directly (function calling) | Deferred: most behaviour arguments are free names, which Jev cannot generate |

## 11. Owed

- **Tier step-down in Jev mode.** With deliberation removed, the mediator
  could route the worker one tier lighter (`tierUnderLoad` already exists).
  Not done: it changes which model answers, which is the participant's call.
- Live account run: the loop is proven by tests and a mocked router; no
  claim is made that a real OpenRouter account was exercised in this pass.
- Gate calibration from participant corrections once real decisions exist.
