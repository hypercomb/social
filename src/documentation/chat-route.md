# The route — a conversation's workflow, fixed in place beside it

Status: DESIGN 2026-09-10 (Jaime), reviewed by three adversarial passes the
same day, building in the same pass. §9 records what the review changed.

Jaime: *"a guided UI with workflow where as you answer the questions the
workflow gets locked into position so they can see visually what you've
decided … like that pipe card game … a response wizard for directional
behavior and then you'll see the workflow get fixed into place … a visual
workflow of whatever you did inside the chat window for that conversation.
… do the workflow vertically down on the right side … mouse over gives you
details … summaries on the left."*

## 1. What it is

Every conversation in the chat window grows a **route**: a vertical pipe in
a narrow column beside the thread, inside the same scroller, one row per
turn. Three kinds of piece sit on the pipe:

- a **junction** — a question the responder asked with two to four
  directions. Open, its outlets are all open-ended and the pipe below it is
  not yet flowing. Answered, the chosen outlet is the one the pipe continues
  through and the others are **capped**. The choice is locked because it is
  a turn in the record and turns are append-only. Superseded (the
  responder went on without an answer), every outlet is capped.
- a **work piece** — one **run** the responder made for that turn: what it
  did between the question and the reply, read from the run ledger. One
  piece per run, carrying the count of attempts; its card lists them in
  order. A run with a failed attempt anywhere is a **leak**: the piece is
  drawn broken and the failure is named in words.
- an **end** — the pipe's last row: open while the conversation goes on;
  a cap that says *goal reached* once the goals-attained receipt lands, or
  *put away* while the thread is archived. Both are states the participant
  can reverse, and the cap says so; nothing is sealed.

Hovering (or focusing) a piece shows its detail card; the message it
belongs to lifts its border while the card is up. The pieces are square
cards on a straight pipe, the card-game shape.

The route is a **view over records that already exist** — the turns and
the run ledger. It writes nothing of its own. Rebuild the window, reload
the hive, open the thread on another day: the route is exactly what the
records say, no more.

## 2. The response wizard — how a question is asked and answered

### 2.1 The convention: a fenced block inside an ordinary reply

A responder that needs a direction decided sends a normal reply whose text
ends with one fenced block whose info string is `hypercomb-question`:

````
Two ways to lay this out.

```hypercomb-question
{"prompt":"How many pages?","options":["One long page","Several pages"]}
```
````

- `prompt`: 1–280 characters. `options`: 2–4 strings, each 1–80
  characters, distinct after trimming. No control characters anywhere.
- **Strict, total, one rule:** a turn holds a question only when it
  contains exactly one `hypercomb-question` fence, that fence is the last
  fence in the turn, it is closed, and its body validates. Otherwise
  nothing is parsed and the fence renders as the code block it already is.
  Two such fences → no question. Model output is untrusted.
- Works on **every tier** with no protocol change: it is reply text. The
  bridge stores it through `chat-reply` as it does any reply; the host and
  local providers stream it as text.
- There is no "other" flag. **The composer is always the other answer.**
  Typing anything sends it as the next turn and settles the question the
  same way a pick does.

**One parser, in core.** `hypercomb-core/src/question-fence.ts` (+ spec)
exports `splitQuestion(text) → { prose, question? }`, `questionFence(prompt,
options)` (the serializer, so scripts and tests round-trip against the same
rules), `plainQuestionText(text)` (the fence replaced by
`Q: <prompt> — <opt> · <opt>` for readers that show a turn as one line),
`settleQuestions(turns)` (§2.3) and `hostWireText(turns, message)` (§2.4).
The fence grammar it scans with is the same `FENCE_RE` chat-markdown uses;
that regex moves to core and chat-markdown imports it. Shared and
essentials both consume this module; neither has a parser of its own.
(Core changes need `npm run build:core` for the essentials typecheck; the
dev shell compiles core from source.)

### 2.2 Presenting it

The question renders **inside the assistant turn** where the fence was.
`rendered` splits each turn first: `html = #markdown(prose)`, and the
question is drawn by the Angular template, so every string goes through
interpolation, never `innerHTML`. `copyTurn`, `noteTurn` and `editTurn`
act on `prose` — the fence is machinery, not what the participant said.

**Open** (no turn after it):

```
 ai   Two ways to lay this out.
      ◆ How many pages?
        ( ) 1  One long page
        ( ) 2  Several pages
        or type your own answer below
```

- `role="radiogroup"` labelled by the prompt; each option a
  `role="radio"` button with `aria-checked`. Roving focus: one option
  tabbable; ↑/↓ move, Enter or Space picks, digits 1–4 pick; the group
  calls `preventDefault` on those.
- **The hive's keymap runs on `window` in the capture phase and treats a
  focused button as non-interactive.** `stopPropagation` in the group
  protects nothing. While the group contains focus the window emits
  `keymap:suppress { reason: 'chat-question' }` and `keymap:unsuppress` on
  blur, settle, close and park — the pattern the command palette and the
  layout designer use. Pierce bindings (Escape, Ctrl+K, Ctrl+Space) keep
  working. No wizard Escape rung: the cascade owns Escape (a press with
  focus on an option parks the window, as it would anywhere in it).
- **Focus on arrival** moves to the first option only when all hold:
  `document.activeElement` is the composer, `<body>` or the panel root
  (never an input or button elsewhere — the rail's find field, a rail row,
  the command line); the composer is empty; `atBottom()`. Then
  `focus({ preventScroll: true })` and `#scrollDown()` decides. Otherwise
  focus stays and the `aria-live="polite"` group announces the prompt.
  Never re-fired on unpark or on a pick.
- **Picking** sends the option's label as the next user turn through the
  ordinary send path — same `appendTurn`, same wait, same bridge queue —
  so the record is the same as if it had been typed. The options are
  `disabled` while `waiting()` (the idiom retry already uses) and the pick
  handler refuses on `waiting()`. `send()` itself is unchanged.
- **Retry is hidden** on an assistant turn holding an open question
  (re-asking is not a thing); edit on the preceding user turn behaves as
  today, and §2.3 keeps a retry from counting as an answer.

**Settled** (a user turn follows): the radiogroup is gone. The assistant
turn shows **one line** — `◆ How many pages? → Several pages` or
`→ answered in your own words` — with the other outlets in the line's
`title` and in the junction's card. The user turn under it stays as the
record with its actions. Five decisions leave five lines, not twenty dead
controls.

**Superseded** (another assistant turn follows before any user turn): one
line, `◆ How many pages? — went on without an answer`.

The settled line is what carries decisions on the phone, where the column
is not rendered.

### 2.3 Which turn answers which question — `settleQuestions`

Derived, never stored. Walk the turns in order:

- A question in assistant turn *i* is **open** while no turn follows it.
- It is **superseded** if an assistant turn follows before any user turn.
- Otherwise the first user turn *j > i* **settles the last question before
  it**. Its outlet is the option whose label equals the turn's text
  (trimmed, exact), else *own words*. Exception: a settling turn whose
  text equals the user turn immediately before the question is a retry,
  not an answer — the question stays open.
- Only the last assistant turn can hold an open question, and never while
  a reply is streaming.

### 2.4 The tiers

- **Bridge (deep tier).** The next ask's 12-turn transcript already
  carries the question turn, fence included. No payload field is added.
- **Host (fast tier).** The host is stateless. When a user turn answers an
  open question on this tier, the **wire text** is the question restated
  with the answer:

  ```
  Question: How many pages?
  Options: One long page · Several pages
  Answer: Several pages
  ```

  The **stored** turn is the bare answer. `hostWireText(turns, message)`
  finds the open question ignoring the trailing user turn equal to
  `message` (send() has already appended it), and the call sits beside the
  `(About: …)` suffix the host path already adds.
- **Local providers.** Their system text gains the same ASKING paragraph
  as the bridge instruction. Their acts through the grammar tool are
  **not** recorded as steps (§8).

### 2.5 Teaching responders

- `bridgeInstruction()` (`llm.queen.ts`) gains an **ASKING** paragraph:
  when replying into a conversation and a direction must be decided, put
  ONE `hypercomb-question` fence at the end of the reply, 2–4 options,
  then end the turn; the answer arrives as the next turn. New `it()` in
  `ask-instruction.spec.ts`. The instruction describes only what is built
  in the same change.
- `scripts/bridge/_chat-reply.cjs` is rewritten flags-first:
  `_chat-reply.cjs <convoId> [prose] --ask <askSig> [--question "<prompt>"
  --option "<a>" --option "<b>" …]` — prose or a question (2–4 options)
  is required; the fence is serialized with `questionFence`; `--ask`
  attaches the run (§3.1). `module.exports = { questionFence, buildReply }`
  with execution under `require.main === module`, and a spec round-trips
  the serializer against the core parser.
- The procedure travels in tracked files: this document and the wake line
  (§6). `.claude/skills/bridge-listen/SKILL.md` is gitignored; it is
  corrected too, and points here.

## 3. Work pieces — the run ledger along the route

### 3.1 One input: the ask. The renderer resolves the bucket.

Today a chat turn's steps land nowhere: the chat scripts carry no `run`,
and an ask's run is addressed `agent:<askSig>`, a bucket the chat window
cannot find. Environment variables cannot fix this — a Claude Code session
runs each command in a fresh shell, and in a persistent shell a stale
variable files one conversation's private run into another's bucket.

So a request carries **`run: { ask: <askSig> }`** and the renderer resolves
it in `#dispatch`, **before** `#route` (so the retire's own step resolves
too):

```
record = the ask optimization at <sig>
record.payload.mode === 'chat' && record.payload.convoId
    → { convoId: record.payload.convoId, id: runIdForAsk(sig) }
anything else, or the record already gone
    → { convoId: 'agent:' + sig, id: runIdForAsk(sig) }   (as today)
```

`chat-steps.ts` gets `runForAsk(sig, record?)` spelling that rule; a
request that carries an explicit `{ convoId, id }` is honoured as today.
`loop-run.cjs` `openRun({ ask, bridge })` sends the `{ ask }` form;
`runFromEnv()` (`HYPERCOMB_RUN_ASK`) stays as a fallback for `_bop.cjs`
and now yields `{ ask }`. `_bop.cjs` and `_chat-reply.cjs` take
`--ask <sig>`; `_ask-drain.cjs retire <sig>` derives it from the sig it
already has. `_bop.cjs` also honours `BRIDGE_URL` like the other scripts.
`loop-run.spec.ts` keeps pinning `runIdForAsk` across TS and CJS.

The ledger directory already exists in every conversation bucket and
`deleteConversation` already proves it. **No new record kind, no new
subdirectory, no new pool, no environment.**

### 3.2 Which turn a run belongs to — and the join with the drawn rows

`chat-reply` returns `{ turnSig, contentSig }` in `data` (nothing today),
so the step recorded for it points at the turn it wrote. Internally an
`appendTurnSig` returns the pair; `appendTurn` and `deliverTurn` keep their
boolean contracts (two specs assert `toBe(true)`), and `deliverTurn`'s
caller in the worker gets the pair. `readBucketRaw` keeps the entry name
and `ChatTurn` gains optional `sig` (the manifest's file name — the shape
spec asserts fields, so an added optional passes). Match on `turn.sig`
only: `sigs` is an unlabelled bag, and `contentSig` dedups across
identical replies.

**The join.** The shell's in-memory rows have receipt-time `at` and no
sig. On every refresh hint the component re-reads `threads.readTurns()`
(one bucket read, already the open-thread path) and replaces `turns()`
with the sig-bearing list when its length ≥ the in-memory length. Route
rows are keyed by `turnSig` and carry the on-disk index; a turn without a
sig (in flight, or `stored === false`) gets no pieces and no settled line.

Derivation, run by run, over `settle(readSteps(convoId))`, with
`liveRunId = runIdForAsk(pendingSig)` passed in by the shell:

1. A run whose settled `chat-reply` step names a `turnSig` in the thread
   belongs to **that reply's row**.
2. The run whose id is `liveRunId` is the **live run**: its piece sits in
   the wait row, growing as steps land.
3. Any other run is placed **by time**: the first assistant turn whose
   `at` follows the run's last step and precedes the next user turn takes
   it, and the card says *placed by time*. Only when no assistant turn
   follows before the next user turn (or the end of the thread) is it
   **unfinished** — and while its newest step is younger than 30 s it is
   drawn *in progress*, not unfinished, because the chat-reply step is
   written after the reply's effect fires. A missing step is unknown,
   never "did not happen".

Pieces within a run are ordered by `seq`; runs sort by the row they belong
to, never by `runId`.

### 3.3 What counts as a piece

A leaf module `hypercomb-essentials/src/assistant/bridge-ops.ts` (no
imports) exports `MUTATING_OPS`, `STEP_SILENT_OPS` and
`ROUTE_HIDDEN_OPS = { chat-reply, chat-goal-reached, optimization-remove }`;
the worker's private statics read from it. A step is a piece's attempt iff
its verb is in `MUTATING_OPS − ROUTE_HIDDEN_OPS`. Reads are recorded and
not drawn; the reply, the receipt and every retire are bookkeeping, not
work. `effect-emit` is a UI intent and stays out. A spec pins the sets
against the worker.

### 3.4 Failure

A run with a settled `failed` attempt is a **leak**: the piece's outline
breaks and it carries the `error` glyph; its `aria-label` and card say
*failed*, name the verb and target, and show the error text (materialized
from `errorSig`). Colour never carries the meaning alone.

### 3.5 Reading it from the shell

Shared never imports essentials. `ChatThreads` (IoC
`@diamondcoreprocessor.com/ChatThreads`) gains a **method** (not a field —
the class is instantiated at module scope inside an import cycle):

```ts
readRoute(convoId: string, liveRunId?: string): Promise<Route>   // optional; feature-detected
```

`Route` = work rows keyed by `turnSig` plus the live and unfinished
entries, produced by `hypercomb-essentials/src/assistant/chat-route.ts`
(+ spec): a pure `deriveRoute(turns, steps, requests, { liveRunId })` the
method wraps. Junctions are **not** in it — the shell derives them from
`settleQuestions` over the turns it already has, and zips both onto its
rows. `readRoute` resolves the bucket once with `conversationBucket` and
reads turns and ledger from that handle: a null bucket is an empty route,
any read fault **throws** (`readTurns`/`readSteps` swallow faults into
`[]`, so they are not used here). The shell then draws one quiet line at
the thread's foot, beside the availability line — *the route could not be
read* — and never an empty pipe. An older essentials build with no
`readRoute` shows junctions only and no notice.

Refresh hints (re-read, never append the payload): `agent:step` filtered
on `convoId` (EffectBus replays the last value, so the filter is not
optional), `chat:threads-changed`, `chat:goal-reached`. `ask:chat-reply`
ends the wait; it is not a route hint. Debounced 150 ms.

## 4. The column

- `.chat-thread` becomes a two-column grid when the route is shown:
  `minmax(0,1fr)` for messages, `--chat-route-w` (2.4rem) for the route.
  `row-gap: 0` (the old `gap` becomes `padding-block` on the message cell)
  so the pipe is continuous; each turn renders its message cell and its
  route cell under the **same** `@if (routeShown())`, so a hidden column
  never leaves stray cells to auto-place. `.chat-empty` and
  `.chat-wait-hint` span `grid-column: 1 / -1`; user/assistant cards use
  `justify-self: end | start` (keeping `align-self` for the flex
  fallback); the message cell keeps its `max-width`.
- Every route cell draws the pipe (full-height pseudo element) so it is
  continuous across rows with nothing on them. Pieces sit centred on the
  line. The pipe below an **open** junction is dashed.
- **Presence:** the column exists only when the shell knows of at least
  one junction or `readRoute` returned at least one work row. A plain chat
  with neither draws the thread exactly as today.
- **Phone / narrow (< 701 px):** the route cells are not rendered
  (template switch on `railVisible()`, not CSS). The settled lines in the
  thread carry the decisions there.
- **Hover card:** `role="tooltip"`, floating rung, positioned `fixed` from
  the piece's `getBoundingClientRect()` (the scroller clips absolute
  children), hidden on scroll. Shown on hover and on focus. One roving tab
  stop per column (↑/↓ move between pieces under the same
  `keymap:suppress`); other pieces `tabindex=-1`. Pieces are spans, never
  buttons (a button on a phone takes a 44 px floor).
- **Hover mark on the message:** its card lifts its border
  (`border-color: rgba(var(--acc), .55)`); no text-decoration.
- Class prefixes `chat-route-*` and `chat-question-*`. `chat-step*` and
  `chat-wizard` belong to the setup checklist and are not touched.
- Styles in a **fifth** sheet `chat-route.scss` (the main sheet is at the
  budget). `@use '../toolwindow' as tw`; paint only from `var(--acc)`, the
  `--hc-window-*` roles and `tw.ink()`; pieces take `tw.$radius-card`,
  controls `tw.$radius-control`; the pipe is `currentColor` on an ink role.
  Motion: the lock-in is a 150 ms colour/opacity change, nothing
  overshoots, and the resting state is the final state under reduced
  motion.
- **Glyphs:** `alt_route` (junction — not in the shipped subset yet),
  `error` (leak), and a verb map written as
  `const VERB_ICONS: readonly { verb: string; icon: string }[]` so the
  subset extractor sees it. Fonts regenerated for **all three shells naming
  every family** (`inter source-serif material-symbols`); the two
  `index.html` comments that still say `… inter` are corrected; then
  `icons.spec`, `doctrine.spec`, `check-icon-render.cjs`.
- No side setting in this pass (nothing can set it until the summary
  gutter exists); the column is on the right.

## 5. The two fixes riding along

1. **The rail's chat fold is capped.** In `agent-tiles-rail.ts` the
   per-tile `.hc-rail-chats` fold (live threads, `+ New`, `Archived (n)`
   and, opened, the archived threads) is one-open-at-a-time and has no
   ceiling. Jaime asked for it: `max-height: 40vh; overflow-y: auto` — the
   window is full-screen, so 40vh is 40 % of the tool window. Opening
   *Archived* grows the fold within the ceiling and then scrolls. (Review
   noted this is a scroller inside the rail's scroller; Jaime chose the
   cap. Verify at 1280×820 that the tile rows below stay reachable.)
2. **Chat-bar icons match the header gear.** The gear is a 28 px box with
   a fixed 17 px glyph, pinned by core. The bar's icon buttons are
   `tw.icon-button` (1.85rem) with an em-scaled glyph that drifts with text
   size. Fix in rem (chrome is never px in a tool-window sheet): glyph
   `font-size: 1.0625rem` and box `1.75rem` on every icon button in the
   row — peek, providers, goal, archive, new — one size per row.

## 6. Responder tooling corrections

- SKILL.md tells responders to read resources with
  `_ask.cjs get-resource --sig …`; that script mints a persistent `qa`
  question and reads nothing (it did, this morning). Both occurrences
  become `_bop.cjs '{"op":"get-resource","sig":"…","text":"utf8"}'`.
- The `ASK_SESSION_MODEL` / `agent-bridges.json` handoff SKILL.md describes
  is not implemented anywhere in `scripts/`. The paragraph is replaced with
  what the watcher does: every ask wakes the parked session; `model` says
  what was designated; answer it.
- `watch-asks.cjs` prints `references`, the payload's content-sig context
  as `contextSigs` (its `context` is follow-up text and stays so),
  `contextTruncated`, `creationId`, and for chat turns a one-line
  `reply` hint naming the exact `_chat-reply.cjs <convoId> --ask <sig>`
  form — the procedure travels with the tracked script.
- The CHAT section of SKILL.md: pass `--ask <sig>` on `_chat-reply.cjs`
  and `_bop.cjs`; ask a direction with `--question/--option`; the pick
  arrives as the next `mode:'chat'` ask whose transcript holds the
  question; retire as before. No `export`.

## 7. Deliberate rejections

- **No decision record.** The chosen outlet is the next user turn. A
  second record of it would be the parallel log the ledger doctrine
  forbids and could disagree with the turn.
- **No new bridge op** for questions. Text carries it on every tier.
- **No `other` flag.** The composer is the other answer, always.
- **No environment variables** for run addressing. One input, the ask;
  the renderer resolves it from the record it already reads.
- **No separate board view**, no split, no second scroller.
- **No parsing of streaming partials.** Questions are read from stored
  turns; an unterminated fence is not a question.
- **No pipe pieces as buttons**, no glow, no spring, no entrance animation
  that is the only way to a visible state, no sealed end.
- **No side setting** until there is a second gutter to mirror.

## 8. Not in this pass

- The **summary gutter** on the left (`summary-gutter.md`) — not built
  anywhere yet; the route column is built as the same mechanism (a gutter
  inside the scroller, marker per row, hover card) so it can take the
  mirror side, and the side setting arrives with it.
- Steps for host-tier work and for local-provider grammar acts
  (`hypercomb_act`): those routes show junctions and ends only, and say
  nothing about work — which is honest, and owed.
- A sweep for spent `agent:<askSig>` run buckets.

## 9. What the review changed (2026-09-10)

Run addressing moved from two env vars to `run:{ask}` resolved by the
renderer (blocker: fresh shells, and cross-conversation misfiling). The
keymap runs in the capture phase, so the wizard suppresses it instead of
stopping propagation (blocker: ↑/↓ moved the hex selection, Enter pasted).
Focus-on-arrival got a real precondition (blocker: "composer empty" is
always true after send). The parser moved to core, one copy. Junctions are
the shell's; `readRoute` returns work only; it is a method and reads from
the bucket handle so faults throw. Pieces are one per run, not one per
step. Settled questions collapse to one line; superseded and retry states
were added. The pick is guarded, not `send()`. Ends are reversible states,
not seals. The retire is excluded by verb set, not by ask sig. The notice
is a line, not a piece. The grid conversion, hover-card containment,
roving tab stop and glyph extraction rules were written down.
