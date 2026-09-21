# Jev: the next moves — a plan for the implementing session

**Written 2026-09-21 by the audit session, for the session that builds it.**
Read `jev-decisions.md` first (the loop as built, §1–§11), then this. The
transcripts the ideas came from are in the audit session's scratchpad
(`scratchpad/yt/INDEX.md`); the ideas below are the ones that survived a
check against our doctrine. Where a step is jwize's call, it says so.

## 0. Rules that bind every step

- **Our doctrine outranks TypeSafe's advice.** Weigh each borrowed practice
  by whether it breaks ours; decline and say why. No automatic retries
  (`jev-decisions.md` §7). Never narrow the worker's byte-stable system text.
- **Everything runs through behaviours.** The census parsers decide what can
  run; Jev only ever chooses among rows the hive can already run; misses are
  recorded (`machine:misses`). No label matching, no hardcoded vocabulary.
- **Questions and thresholds live in one place**: the tables at the top of
  `hypercomb-essentials/src/assistant/jev-decision.ts` (`JEV_ROW_QUESTIONS`,
  `JEV_GATES`, `JEV_REACH_GATES`, `JEV_CHOICE_GATES`). One condition per
  yes/no question, each with `criteria`. Add a judgment as a new parallel
  question plus a gate in `jevResult`, never a prose rubric.
- **The source boundary holds** (`jevUnseen` in `jev-decision.service.ts`):
  every state field must already be in the text the worker was sent, or in
  the participant's own message. Jev never fetches, never resolves a sig.
- **Reach decides risk.** Destructive is never automatic. Reach comes from the
  census (`hypercombPlanReach`), never from Jev or the worker.
- **Prove it on 4250, not in unit tests alone.** Extend
  `scripts/verify-jev-table.cjs` (fresh Playwright profile, openrouter.ai
  routed in-script, everything else real). Never open a tab on jwize's hive.
- **Every decided round emits `jev:outcome`** (`jev-outcomes.ts`). New plan
  kinds must report too.
- Traps: the Write tool turns `\u0000`-style escapes into literal control
  bytes (the doctrine ratchet catches it; fix via a script with `String.raw`);
  bash halves backslashes (write `.cjs` files, don't inline); Angular
  decorators reject `static #private`; a module `const` between `@Component`
  and the class detaches the decorator; typecheck essentials with dev's four
  strict flags; `git commit --only` your own files; push only on jwize's word
  (`HYPERCOMB_ALLOW_DIRECT_DEVELOPMENT_PUSH=1`).

## 1. The direct path: Jev picks the behaviour, no worker (the big one)

**LANDED 2026-09-21** in `assistant/jev-direct.ts`, the service's
`direct()`, and the chat loop's `tryDirect`; harness 27/27. See
`jev-decisions.md` §5a. §1.5 remains open.

**Idea (Browser Use's Jev-ultrafast, TunaDev's breakdown):** give Jev a
numbered list of the actions a page supports and ask for the action AND the
target in one call; a tiny model writes only free text; code guards
execution; "done" is a decision, not proof. It cut a browser task from ~1,100
model calls to 101. Our census IS that action list, and our tiles are the
targets.

**What to build.** A pre-round in the chat loop, before the worker is asked,
for requests that a single behaviour sentence can satisfy.

1. **Candidates from the census, in code.** `callableBehaviours(entries)`
   filtered to reach `additive` or `editing` (never destructive), each with
   its `machine.forms` and `description`. Targets: the tiles the loop already
   knows without a read — `grammarContext.selected` and the current page's
   child names (ask the tree reader for the current layer's children only;
   it is one cheap read, budgeted, and its snapshot rides along).
2. **One Jev call** (new pure builder `jevDirectQuestions` beside
   `jevQuestions`, same table discipline):
   - `behaviour` choice over candidate names + `none` ("needs more than one
     step, a read, or a question").
   - `target` choice over known tile names + `here` + `none` (speculative;
     ignored when the chosen behaviour takes no target).
   - `names_new` noul: "Does `request` name something that does not exist
     yet?" (criteria: names a new tile/word vs refers to an existing one).
   - `single_step` noul: "Can `request` be carried out by exactly one of the
     listed behaviours?"
   - `beyond`-style nouls are not needed here: the sentence is built from the
     participant's own words, nothing is invented.
3. **The name is lifted, never generated.** Select instead of generate: take
   the new name VERBATIM from the request (quoted span, or the words after the
   behaviour's verb per its `forms`), validated by the census parser. If no
   verbatim span parses, fall through to the worker. Do NOT add a second
   model for names in this step; that is a later option (§1.5).
4. **Compose in code:** run only when `single_step ≥ .9`, `behaviour`
   confidence ≥ `JEV_CHOICE_GATES[reach]`, the sentence parses, and the
   snapshot still holds. Queue it in Execution under the participant's policy
   (`runDo` with `review:false`); report `jev:outcome` with a new plan kind
   `direct`. Otherwise fall through to the ordinary worker loop unchanged.
5. **Say what happened** in the reply: the hive's own receipt line, the
   sentence in the one look (`hive-sentence`), and the token line ("workers:
   no calls; Jev: N input"). Record a miss when the parser refuses the lifted
   sentence.

**Source boundary for a worker-less turn:** the state is the participant's
message plus census text the anatomy/vocabulary already carries; extend
`JevSource` so the loop can pass `{ system: anatomy + vocabulary, messages:
[message] }`. Nothing else may enter.

**Acceptance (harness):** "Make a tile called jev-proof here" → zero worker
calls, one Jev call, an `additive` Execution row, the receipt, `direct:ran`
in outcomes. "Organize my notes by theme" → `none`, the worker loop runs as
before, still 23/23 on the existing checks. Unit specs cover the lifted-name
parser, the fall-throughs, and that destructive behaviours are never offered.

**§1.5 (later, jwize's call):** a small text model for names when nothing
verbatim parses — it would be the only generated text in the path, so it
needs its own grant and a receipt that says a model wrote the name.

## 2. The cascade: lighter worker, Jev verifies, escalate on doubt

**Idea (LangChain's harness, Vivek Haldar, TypeSafe's SDE cascade):** a cheap
model drafts, Jev verifies against the evidence, a strong model is called
only when Jev is unsure.

**What to build.**

**§2.1 LANDED 2026-09-21** in `assistant/jev-verify.ts`, the service's
`verify()`, and the chat loop's `verifyAnswer`; harness 30/30. See
`jev-decisions.md` §5b. §2.2 was superseded by the front door; §2.3 (wall time) landed.

1. **Verified answers.** When the plan is `answer`, after the worker's final
   prose arrives, ask Jev one call over `{answer, evidence, request}`:
   `supported` noul (every claim in the answer is in the evidence),
   `complete` noul (the answer covers the request). Below the gate, append
   the hive's own line: "This answer was not verified against what was read"
   — never rewrite the answer. Report `answer:verified|unverified`.
2. **SUPERSEDED 2026-09-21 by the front door** (`jev-decisions.md` §5d):
   jwize asked Jev to choose the regular model, so Jev now weighs every
   request and the mediator routes by that weight. The switch below is not
   built. **Worker step-down** — a switch on the Jev row, default OFF, jwize's call:
   in Jev mode route the worker one tier lighter (`tierUnderLoad` /
   `designate` in `model-policy.ts` already know tiers). When ON and the
   verification in (1) fails, re-ask the same round on the designated (not
   stepped-down) tier once — that is one escalation, not a retry of a failed
   call, so it does not cross the no-retry rule; say so in the doc.
3. **LANDED 2026-09-21** (`jev-decisions.md` §9, "How long turns take"):
   every turn is timed by the way it went, and the Jev row shows the medians.
   Measure it: the outcomes pool plus the token line already separate worker
   and Jev usage; add per-turn wall time to `jev:outcome` so §3 can compare.

**Acceptance:** harness scenario where the fake worker's answer contradicts
the evidence → the unverified line appears; a supported answer → no line.
Step-down is proven only by jwize on real models.

## 3. The golden set: tune the gates on our own outcomes

**Idea (TypeSafe's skill, Nate Herk, LangChain's Jev-as-judge):** never trust
thresholds you did not validate on your data.

**LANDED 2026-09-21** as `assistant/jev-replay.ts` (the `jev:replay` bridge
intent) and `scripts/jev-golden.cjs`; harness 31/31. The replay runs in the
hive, where the receipts live, so the script needs the broker and the
attached hive. See `jev-decisions.md` §9.

**What to build.** `scripts/jev-golden.cjs`: reads the `jev:outcomes` pool
and the decision receipts it names (`persistJevInput` already keeps every
request, evidence, row and answer by signature), and for each past decision
recomputes the plan under candidate gates OFFLINE (no Jev call — the answers
are stored). Reports, per gate set: how many steps that jwize RAN would have
run automatically, how many he SKIPPED would have run (false positives), how
many deferrals would have vanished. Output a table; change `JEV_GATES` only
by hand from that table, with the run recorded in `jev-decisions.md` §9.
Also an "outcome" affordance in the chat: a skipped automatic change is a
gate set too low — that signal already exists; make sure `review:true` vs
`review:false` is distinguished in the report.

**Acceptance:** the script runs against the harness's scratch profile
(export the pool via the bridge `thread-read`-style op or read OPFS in the
harness) and against jwize's hive on his machine. No gate changes without a
table.

## 4. Words that route by meaning (smaller, each its own behaviour)

Each is ONE behaviour with a `machine` block, so it enters the census and the
possibility table for free.

**`file` LANDED 2026-09-21** as a typed word (`assistant/file.queen.ts`,
`jev-file.ts`); harness 34/34. The drop gesture, the `interest` matcher and
keep-or-drop compaction remain; the last two wait on jwize's grant decisions.

- **`file` (or the drop gesture):** a dropped note/file/link is placed under
  the tile Jev picks — `where` choice over the current layer's children +
  `here`, `kind` choice (note, picture, link, task), confidence shown. Below
  the gate it lands `here` and says so. (Nate Herk's brain-dump router, the
  downloads filer.)
- **`interest` matcher:** a plain-language rule the participant writes
  ("hide engagement bait", "show only cigar notes") becomes a Jev noul per
  incoming item in the intake filter (`intake-filter.md`). Content the rule
  is applied to must be covered by the OpenRouter read grant — say so in the
  switch; default OFF.
- **Keep-or-drop compaction:** per past tool call, `keep_verbatim` noul; kept
  text is copied, never summarised (`compaction.ts`). Note the one public
  test dropped nothing at a safe setting — build it behind a switch and let
  §3's table judge it.

**Acceptance:** each word appears in `/misses`-free census listings, has a
unit spec for its questions, and one harness check.

## 5. Games that adapt (later; design first)

Jevland regenerates the next level sections every 10 s from how you are
playing, with a local fallback when the call is late; a Mario agent picks a
move every eight frames from a text state plus a danger question. For Solomon
and Bubble: a `director` that, on a timer, asks Jev `difficulty` score and
`next_section` choice over authored section kinds, with the current run's
stats as state and a deterministic fallback. Never on the frame loop — every
8 frames at most, and only for decisions, never for text. Design doc before
code; jwize decides which game first.

## 6. Declined or deferred, with reasons

- **A local open "Jev" (OpenJev/Nimble):** an ordinary fast LLM behind the
  same request shape. Would keep private content local, but its calibration
  is unmeasured; revisit only with §3's table to grade it.
- **Confidence-based context dropping as default:** unproven (see §4).
- **Jev in the worker's system prompt (skill-suggestion style):** would break
  byte-stable caching; if ever done, append AFTER the stable prefix as its own
  small block, and measure cache hit rate before and after.

## 7. Order and ownership

| # | Step | Needs jwize | Proof |
|---|---|---|---|
| 1 | Direct path (§1) | no | harness + specs |
| 2 | Verified answers (§2.1) | no | harness |
| 3 | Golden-set script (§3) | run on his hive | table |
| 4 | `file` word (§4) | no | harness |
| 5 | Worker step-down (§2.2) | switch is his call | real models |
| 6 | `interest` matcher, compaction (§4) | grant decisions | specs + table |
| 7 | Game director (§5) | which game | design doc |

Commit each step on its own with `--only`; do not push. When a step lands,
add its line to `jev-decisions.md` and to the memory file
`project_jev_runs_the_show.md`.
