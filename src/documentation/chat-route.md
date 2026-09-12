# The route — a conversation's workflow, fixed in place beside it

Status: DESIGN 2026-09-10 (Jaime), reviewed by three adversarial passes the
same day, built and verified the same day (v1). **Tree v2: DESIGN
2026-09-10**, synthesized from three lens designs — the model pipeline
(measured against the participant's own Ollama), the tree and its viewport,
and the summary with finding the spot in the chat. **Revised 2026-09-11**
after a buildability review (against the code and the web build) and an
experience review (measured on a fresh 13-exchange conversation). §4 is the v2
contract that the two build packages (§4.8) work against. §9 records what each
review and each of Jaime's directions changed.

Jaime: *"a guided UI with workflow where as you answer the questions the
workflow gets locked into position so they can see visually what you've
decided … like that pipe card game … a response wizard for directional
behavior and then you'll see the workflow get fixed into place … a visual
workflow of whatever you did inside the chat window for that conversation.
… do the workflow vertically down on the right side … mouse over gives you
details … summaries on the left."*

## 1. What it is

Every conversation in the chat window grows a **route**: its workflow, drawn
in a **sidebar on the right of the thread** (§4). The sidebar is one column
holding two surfaces: a **tree viewport** on top and a **summary pane** under
it.

When the participant's **own machine-local model** has organized the
conversation, the tree is that **workflow**. "Own" means exactly the local
model they chat with (§4.1.1). It is never a paid provider and there is never
a fallback. The workflow is the tasks the conversation worked on, each a
square card named in the local model's words, laid out as a real tree:

- **Top-level goals** run down one straight main line.
- **Deviations branch off beneath the task they left.** A deviation is a
  detour to fix something, a side question, the separate parts of a larger
  goal, or a reversal. A branch sits under its task, one fixed indent step to
  the right, with the pipe elbowing into it. Siblings stack one under another,
  so the tree reads top to bottom in the order the keys walk it (§4.2).
- **The viewport pans** up and down, and side to side only as far as a deep
  branch needs at a narrow sidebar (§4.3).
- **Exchanges not yet organized** follow on the main line as quiet
  **dormant** stages with no text — one card per exchange, its work, reply and
  question carried as marks on the card. With no flow at all, every exchange
  is one.

A card becomes the **current step** in one of three ways: pressing it, walking
to it with the keys, or scrolling the conversation to its messages. A step
chosen by press or key stays current until the participant scrolls the
conversation themselves. The summary pane shows the full state of the current
step:

- where it stands, first;
- its branches, one line each;
- what it set out to do and what was done, one press away;
- its decisions and its work.

Pressing a card also **moves the thread down to that spot** and lights the
messages the step covers (§4.4). The pane describes what is current, never
what the pointer happens to be over. The sidebar never shows the messages
themselves: a reply is a mark, not its words.

Three kinds of piece are read from records. On the tree they are marks on a
card (the end is a card of its own), and the summary pane gives their full
account:

- a **junction** — a question the responder asked with two to four
  directions.
  - **Open:** its mark is dashed and the pipe after it is not yet flowing.
  - **Answered:** the chosen outlet is the one the pipe continues through and
    the others are **capped**. The choice is locked because it is a turn in
    the record, and turns are append-only.
  - **Superseded** (the responder went on without an answer): every outlet is
    capped.
- a **work piece** — one **run** the responder made for that turn: what it
  did between the question and the reply, read from the run ledger. A card
  carries one work mark with the count of attempts, and the summary pane
  lists the attempts in order. A run with a failed attempt anywhere is a
  **leak**: the mark is drawn broken and the failure is named in words.
- an **end** — the last card on the main line.
  - It is open while the conversation goes on.
  - It becomes a cap that says *goal reached* once the goals-attained receipt
    lands, or *put away* while the thread is archived.
  - Both are states the participant can reverse, and the cap says so; nothing
    is sealed.

The route is a **view over records that already exist** — the turns and
the run ledger. Rebuild the window, reload the hive, or open the thread on
another day, and the route is exactly what the records say, no more. The one
thing written beside it is each conversation's **flow**: its tree and each
node's card. The flow is a **derived cache** (§4.1.6):

- one recycled slot per conversation;
- version-stamped and wipe-safe;
- never load-bearing — a missing flow is dormant stages and nothing else.

It is minted passively, in the background, by the local model only, so it
costs no paid compute.

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

The settled line is what carries decisions on the phone, where the sidebar
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
`@diamondcoreprocessor.com/ChatThreads`) gains a **method**. It is a method
and not a field because the class is instantiated at module scope inside an
import cycle:

```ts
readRoute(convoId: string, liveRunId?: string): Promise<Route>   // optional; feature-detected
```

`Route` holds work rows keyed by `turnSig`, plus the live and unfinished
entries. It is produced by `hypercomb-essentials/src/assistant/chat-route.ts`
(+ spec): a pure `deriveRoute(turns, steps, requests, { liveRunId })` that the
method wraps. `readRoute` adds four things:

- **`flow`** — the v2 view of §4.1.7, added only when the conversation's slot
  holds a record at this version about THIS history.
- **`organizerState`** — what the participant's local model can do right now,
  read from probe STATE only: `awake`, `off`, `unknown`, `asleep`, `blocked`,
  `needs-permission`, `empty`, or `no-model` (awake, but no model of theirs
  resolves, §4.1.1).
- **`organizer`** — `{ providerId, model }`, present only while
  `organizerState` is `awake`.
- **`organizing` and `cardBackoff`** — what the local model is doing for this
  conversation right now, and which cards it recently could not write.

A flow read never throws and never probes. A second method mints the flow:

```ts
organizeRoute(convoId: string, liveRunId?: string, waiting?: boolean, prefer?: string): Promise<number>   // optional; feature-detected
```

- `prefer` names the node the participant is looking at. That node's card,
  and the uncarded branches beneath it, are written first (§4.1.9).
- It **starts no model call** while `waiting` is true (the shell is waiting on
  a reply in this conversation), or while the lane is paused after the
  participant's own local chat (§4.1.9). A refused call resolves 0, reads
  nothing and emits nothing, so it cannot re-trigger itself through a refresh
  hint.

**Junctions are not in `Route`.** The shell derives them from
`settleQuestions` over the turns it already has, and zips both onto its rows.

**Read faults.** `readRoute` resolves the bucket once with
`conversationBucket` and reads turns and ledger from that handle:

- A null bucket is an empty route.
- Any read fault **throws**. `readTurns`/`readSteps` swallow faults into
  `[]`, so they are not used here.
- On a fault the shell draws one quiet line at the thread's foot, beside the
  availability line — *the route could not be read* — and never an empty
  pipe.
- An older essentials build with no `readRoute` shows junctions only and no
  notice.

**Refresh hints.** The shell re-reads on each hint and never appends the
payload. Hints are debounced 150 ms:

- `agent:step`, filtered on `convoId` (EffectBus replays the last value, so
  the filter is not optional);
- `chat:threads-changed`;
- `chat:goal-reached`;
- `chat:route-flow-changed`, filtered on `convoId` (the passive drain writes
  flows for every conversation);
- `chat:route-flow-organizing`, filtered on `convoId` (a model call for this
  conversation started or ended);
- `llm:policy-changed` (the local model's probe state flipped, so
  `organizerState` may have changed).

`ask:chat-reply` ends the wait; it is not a route hint.

After a refresh of the open conversation, while the sidebar is shown, the
shell calls `threads.organizeRoute?.(convoId, liveRunId, waiting(), prefer)`
and does not await it. `prefer` is the current node's id once that node has
been current for `ROUTE_SUMMARY_ASK_MS` (700) with no card or a stale one, and
is otherwise omitted.

## 4. The sidebar

Jaime: *"Basically it's a visual workflow of what you accomplished on the
right hand sidebar working its way down. It can be a viewport where you can
pull it or you can just have it all on screen."* And, for v2: *"give you a
full summary at every state and kind of move you down the chat as well to find
that spot … create a tree when this deviation happens for each of the nodes
and show it vertically visually spread out. Remember that view can be just a
viewport and so you can actually move it up and down inside to side
slightly."*

- **Layout.** At ≥ 701 px (the rail's query, `railVisible()`,
  `RAIL_QUERY` chat-window.component.ts:699) the conversation area is
  `[ thread | column ]`.
  - `.chat-route-split` holds `.chat-threadwrap` and `.chat-route-col`.
  - The column holds `nav.chat-route-side[data-route-viewport]` (the tree
    viewport, a scroller on both axes, §4.3) above
    `section.chat-route-summary` (the summary pane, its own vertical
    scroller, §4.4).
  - **Why stacked:** the pane sits under the tree rather than floating over
    the thread. A floating card covers exactly the messages the steer just
    brought into view. A pane that changed with the pointer would change
    under the pointer on its way down to it.
  - **Why the pane's height is fixed** (`clamp(9rem, 45%, 24rem)`): the pane
    changes whenever the current step does. A content-sized pane would resize
    the tree viewport on every change and the tree would jump. 45% is what
    lets *where it stands* and a parent's branch lines fit without a pane
    scroll at 1280×820 (§4.4.1).
  - **Width.** `--chat-route-side-w: clamp(14rem, 30%, 22rem)` is set on the
    split. The column is `flex: 0 1 var(--chat-route-side-w)` with
    `min-width: 12rem`. The thread wrap takes `min-width: 16.25rem`
    (`CONVERSATION_MIN` 260 px, chat-window.component.ts:612), so at 701 px
    the sidebar gives way before the thread does. The numbers are in §4.3.1.
  - **Divider.** The column wears the `--hc-window-edge` divider
    (`border-inline-start`), which moves off the nav.
  - `.chat-thread` is its original flex column. It gains only
    `position: relative`, set from chat-route.scss, so the start line of
    §4.4.3 can be placed inside it. Folding the window (peek) hides the split
    with the thread.
- **Presence.** Any open conversation with at least one turn. It is not
  gated on junctions or work — a plain chat's workflow is its exchanges. No
  conversation, or no turns: no sidebar.
- **Content** — derived only, with no records of its own.
  - When a **flow** exists (§4.1), its **nodes** are laid out as the tree
    (§4.2).
  - After the tree, on the main line, comes the **tail**: every exchange the
    flow has not read, **one card per exchange**. (v1 drew a card per piece,
    chat-window.component.ts:2237-2265, so one or two open exchanges filled the
    followed viewport with stage, work, reply and junction cards.)
    - a **dormant stage** — a dashed, dimmed card with no caption text and an
      `aria-label` of *not organized yet*. Its pieces row carries the
      exchange's marks in the order work → replied → junction: one work mark
      for every run of the exchange (runs no reply followed included) with
      the attempt count, broken on a leak; a *replied* mark when a reply
      exists; and the question it ended on, an `alt_route` mark, dashed while
      open. Every length of pipe after an open question is dashed;
    - while waiting, the **live** run (its count grows as steps land) or,
      before any step has reported, a bare **wait** card;
    - the **end** last.
  - The work, reply, junction and unfinished entries that were cards in v1
    are **pane entries** of their stage (§4.4.2), keyed as before.
- **A node card at rest** (§4.2.5):
  - a square wearing the node's state glyph;
  - the title in the local model's words, up to three lines;
  - one row of pieces — its work as one mark, its questions as one mark with
    a count;
  - a fold mark when a branch hangs beneath it.
  The current step's card takes the window wash and an accent square border.
  Nothing glows and nothing moves.
- **Press, keys, summary.** Pressing a card (or Enter/Space on it) makes it
  current, shows its state in the pane and moves the thread to its spot.
  Walking the tree with the keys makes each card current as focus lands, and
  moves the thread once the walk rests. Either choice holds until the
  participant scrolls the conversation; from then on, the step whose messages
  are being read is current. See §4.4. The floating hover or focus detail card
  of v1 is **retired**; its content lives in the pane.
- **Phone / narrow (< 701 px):** not rendered (template switch on
  `railVisible()`, not CSS). A landscape phone past that width hides the
  column with the rail (`@include bp.phone`). The settled lines in the thread
  carry the decisions there. The summaries do not reach the phone in this
  pass (§8).
- **Class prefixes** `chat-route-*` and `chat-question-*`. `chat-step*` and
  `chat-wizard` belong to the setup checklist and are not touched.
- **Styles** live in a **fifth** sheet, `chat-route.scss` (the main sheet is at
  the budget). The rules:
  - `@use '../toolwindow' as tw`.
  - Paint only from `var(--acc)`, the `--hc-window-*` roles and `tw.ink()`.
  - Cards take `tw.$radius-card`; controls and chips take
    `tw.$radius-control`.
  - The pipe is `currentColor` on an ink role.
  - The sidebar's chrome and text are rem. The only px left are hairlines
    (the 1 px divider, the 1 px start line and the 2 px pipe) and the start
    line's measured offset.
  - Motion: the lock-in is a 150 ms colour/opacity change, and nothing
    overshoots. Under reduced motion the resting state is the final state,
    and a steer of the thread is instant (§4.4.4).
  - The compiled sheet must stay within `anyComponentStyle` 32/48 kB
    (hypercomb-dev/angular.json:61-63). The retired rails, indent, elbow,
    per-piece card and hover card rules roughly pay for the grid, segment and
    pane rules, but that must be measured, not assumed.
- **Glyphs** are all already in the shipped subset
  (`hypercomb-web/public/fonts/icons.txt`), and there is no font regeneration
  in this pass:
  - `person` (stage), `chat_bubble` (replied), `hourglass_empty` (wait),
    `alt_route` (junction), `error` (leak), `task_alt` / `archive` (end caps);
  - a node's state, resolved by `nodeIcon` with one literal return each:
    `task_alt` (done), `hourglass_empty` (open), `alt_route` (decided, and a
    node's question mark), `block` (dropped, on a capped, muted card with its
    title struck);
  - the fold mark `chevron_right` / `expand_more` (`foldIcon`);
  - the verb map, written as
    `const VERB_ICONS: readonly { verb: string; icon: string }[]` so the
    subset extractor sees it.
- **No side setting** in this pass. Nothing can set one until the summary
  gutter exists, so the sidebar stays on the right.

### 4.1 The flow v2 — the local model organizes, names and summarizes

Jaime: *"It's not that I want you to just put the messages. I want you to
use the local AI if it's available, otherwise you can just leave whatever is
in there and leave it dormant."* Then: *"so let's make sure that ollama visits
as many chats as possible and updates the workflow for each chat."* And:
*"We're not talking about like just telling what it did we're just giving
like a general overview in about the rational order … have a workflow of
what's been going on through the session you can branch … and it'll be able
to be navigable to see what's happening."* — *"Basically it's a passive free
local model organization."* And for v2: *"correct naming by the local AI
obviously the one I use so that we don't waste our paid compute."*

A conversation's flow is two things written into one record:

- **The structure.** An assignment of every organized exchange to a task,
  frozen once it has been seen with enough later context (§4.1.4). Code builds
  the tree from it.
- **The cards.** Each task's name and a three-part summary.

Two model stages mint them (§4.1.3). Everything in this section lives in
`hypercomb-essentials/src/assistant/chat-route.ts`, except three things in the
provider seam: the local-provider knobs and the participant's stored model
choice (§4.1.1–§4.1.2, `llm-dispatch.ts`, `providers/`), and the pinned probe
state (§4.1.9, `providers/local-liveness.ts`).

**Measured twice.**

- **The lens run (2026-09-10)** — Ollama 0.33.1 on the participant's machine
  (`qwen3:8b`, `qwen2.5-coder:7b`): four synthetic conversations plus a
  24-exchange concatenation, fresh and incremental.
- **The review run (2026-09-11)** — `qwen3:8b`, the final prompts verbatim, on
  a fresh 13-exchange development conversation the prompts had never seen:
  two problems raised together, a side question, two reversals, an unrelated
  rename, a late test of an earlier fix, and replies that open with code;
  structure repeated 5 times, plus a pre-emption timing test. It found what
  the lens run did not: no reversal captured, a misfiled follow-up, trees that
  differ between identical runs, and leaf cards that invent facts. §4.1.4,
  §4.1.5, §4.1.9 and §4.1.10 carry the consequences.

**What v1 got wrong, measured.** The lens run showed that the v1 single call
cannot be tuned into v2:

- **It thinks.** Nothing turns qwen3's reasoning off, and reasoning ate 197–4000
  tokens per call. A website structure call ran 67 s and hit
  `finish=length` with no content. Under v1's `FLOW_MAX_TOKENS = 900`
  (chat-route.ts:505) such an answer is empty, counts as unusable, and backs
  off for 10 minutes (chat-route.ts:1084-1087).
- **It copies its own example.** It emitted `"detail":"One short sentence."`
  from `ROUTE_FLOW_SYSTEM` (chat-route.ts:771) verbatim. It also hung
  "Publish the site" under "Add contact section", and lost a reversal: no
  node was dropped and the reversed choice stayed `decided`.
- **It has no room.** Ollama loads models at a 4096-token context
  (`/api/ps`), and the OpenAI-compatible path cannot raise it. Summaries for
  up to 32 nodes do not fit beside a transcript in one answer.
- **It names no model** (§4.1.1).

#### 4.1.1 Which model: exactly the participant's own local model

**How a choice is stored today.**

- **Per conversation.** `localStorage['hc:chat-models']` holds
  `{ [convoId]: model }`.
  - The chat window writes it with the wire model that actually answered a
    local stream (`#remember(chunk.model)`, chat-window.component.ts:4430), or
    with the word the participant named (`setModel`, :4034-4039, writing
    through `#remember` :4046).
  - It also writes the **bridge's** word there: a bridge send remembers
    `this.answering()` (:4249), a Claude word. A participant who chats through
    the bridge therefore has no local model remembered in any conversation.
  - Essentials reads it with `conversationModel(convoId)`
    (chat-thread.ts:676-686).
- **When no model is named.** The local chat send states
  `need = { tier: 'fast', streaming: true }` (chat-window.component.ts:4274).
  `buildRequest` then picks `modelForTier(provider, 'fast')` (llm-dispatch.ts
  :234-240 → model-policy.ts:337-338): the first model the roster tags
  `fast`.
- **The roster.** After a probe the roster is the server's own `/v1/models`,
  with the tier read off the size tag (`tierOf`, local-liveness.ts:447-451).
  The previous `defaultModel` is kept while still installed
  (`defaultFrom`, :477-478). On Jaime's machine the first `fast` model is
  `qwen3:8b`, while `defaultModel` is still `qwen2.5-coder:7b`
  (local.provider.ts:83).
- **Pins** (`hc:llm:pin:<tier>`) hold PROVIDER ids, never models
  (model-policy.ts:44). No surface stores a per-provider model choice.

**Why roster order is wrong.** v1 calls with `model: undefined`
(chat-route.ts:984) and `need.tier: 'fast'` (:1076). It lands on the
participant's model only by accident of roster order, and would silently move
if the server listed models differently. Any rule that falls back to
`modelForTier` inherits the same accident — for everyone whose conversations
ran through the bridge, it is the whole rule.

**The stored choice** (new, in `llm-dispatch.ts`). "The local model I use"
gets ONE answer, written by the one path that is the participant's own local
chat:

```ts
export const LOCAL_MODEL_STORAGE_KEY = 'hc:llm:local:model'
/** The wire model of the participant's last own local chat, or null. Best-effort read. */
export const participantLocalChoice = (): { readonly providerId: string; readonly model: string; readonly at: number } | null
```

- **Who writes it:** `streamProvider` (llm-dispatch.ts:364 onward), once
  `send` resolves OK, for a machine-local provider (`requiresKey === false &&
  transport === 'browser-http'`, the `emitLocalUse` predicate, :357-361), with
  `request.model` — the model that is answering. The router's `stream`
  (:595 → `streamRoutedModel` :500) is the only streaming entry in use, and its
  one caller is the chat window's local send (chat-window.component.ts:4400).
- **Who never writes it:** `callModel`. Its callers are automatic — the blurb
  drain (chat-blurb.ts:241), bee banter (agent-bee.drone.ts:1193), serving a
  peer (peer-models.drone.ts:310), the providers window's test
  (providers-window.view.ts:1015) — and every flow call.
- A write that throws is skipped, as `hc:chat-models` writes are.

**The resolution** (new, in chat-route.ts):

```ts
/** THE MODEL YOU USE — an installed wire id on THIS provider, or null. Never roster order. */
export const participantLocalModel = (
  provider: LlmProviderDescriptor,
  registry: Pick<LlmProviderRegistry, 'providerForModel' | 'resolveModelId'>,
  choice: { readonly providerId: string; readonly model: string } | null,
  options: { readonly convoIds?: readonly string[]; readonly fallback?: string } = {},
): string | null => {
  const installed = new Set(provider.models.map(m => m.id))
  const local = (word: string): string | null => {
    const w = word.trim()
    if (!w || registry.providerForModel(w)?.id !== provider.id) return null
    const id = registry.resolveModelId(provider, w)            // llm-provider-registry.ts:184-192
    return installed.has(id) ? id : null
  }
  if (choice && choice.providerId === provider.id) { const id = local(choice.model); if (id) return id }
  if (options.fallback && installed.has(options.fallback)) return options.fallback
  for (const convoId of options.convoIds ?? []) { const id = local(conversationModel(convoId)); if (id) return id }
  return null
}
```

In order:

1. **The stored choice**, when it names this provider and is still installed.
2. **`fallback`** — the pinned `lastPassModel` (§4.1.9), when still installed.
   Only the attended call passes it, so the attended call names the model the
   drain last used and never forces a swap between the two.
3. **A conversation's remembered local model**, in the order given. This is
   the migration path for a hive whose stored choice has never been written.
   `hc:chat-models` holds a local wire model only where that model actually
   answered (:4430) or the participant named it (:4034-4039), so it is never
   roster order.
4. Otherwise **null**. The flow does not run, and the pane says *chat with
   your local model once* (§4.4.2). Never `modelForTier`, never
   `defaultModel`.

Values that are not local models drop out:

- `'auto'` (`DEFAULT_MODEL`, chat-window.component.ts:620) and bridge words
  such as `opus` resolve to no local provider, so they are skipped.
- A pre-sync alias such as `qwen-coder` passes through `resolveModelId`
  unchanged, is not installed, and is skipped.

**Which conversations are passed.**

- **The passive drain** resolves ONE model at the start of each pass, with its
  LIVE conversations newest `lastAt` first, and pins it as `lastPassModel`.
  - **Why one model per pass:** a model swap on the participant's machine
    measured 10.1–16.9 s. On an 8 GB card it also evicts the model they are
    chatting with.
- **The attended call** (`organizeRoute`) resolves with
  `fallback: lastPassModel` and `convoIds: [convoId]`. With a stored choice —
  the normal case once the participant has chatted locally once — both paths
  name the same model.

**The gate is split: probe state first, then a model that stays fixed.**

```ts
export type RouteOrganizerState =
  'awake' | 'off' | 'unknown' | 'asleep' | 'blocked' | 'needs-permission' | 'empty' | 'no-model'

/** STATE ONLY — the v1 gate body (chat-route.ts:964-988): loopback endpoint, provider enabled,
 *  localServerReport(...).state === 'awake', resolves to itself. No fetch on any path.
 *  Not awake: the best state short of it — 'off' when no machine-local provider is enabled,
 *  else the first provider's report state (local first). */
export const localOrganizerState = async (): Promise<
  { readonly state: 'awake'; readonly provider: LlmProviderDescriptor } |
  { readonly state: Exclude<RouteOrganizerState, 'awake' | 'no-model'> }>

export interface RouteLabeller {
  readonly id: string
  /** The wire model every call of this labeller names. */
  readonly model: string
  readonly call: (call: LlmCall) => Promise<LlmCallResult>
}

/** A labeller for a model ALREADY resolved. Run again immediately before every call: it re-reads
 *  state and checks `model` is still installed; it never re-resolves the model. */
export const awakeLocalLabeller = async (model: string): Promise<RouteLabeller | null>
// inside, once localOrganizerState() is awake for `provider` and provider.models lists `model`:
return {
  id, model,
  call: c => {
    const { thinking: _thinking, jsonSchema, temperature, ...rest } = c
    const plain = flowState().plainLocalModels.has(model)          // §4.1.2 refusal, §4.1.9 pinned state
    return dispatch.callModel({
      ...rest,
      ...(plain ? {} : { thinking: false as const, jsonSchema, temperature }),
      providerId: id, model,                                       // provider AND model LAST
    })
  },
}
```

**No fallback is possible.** An explicit `providerId` + `model` gives
`routeCandidates` exactly one candidate (llm-dispatch.ts:469-470), and
`callModel` makes one attempt (:297-323). The resolved model is stamped on the
record (`record.model`) and on every card (`card.model`), so the pane can say
which model did the work.

#### 4.1.2 Provider knobs: thinking off, the shape constrained (local provider only)

**Measured on `/v1/chat/completions`** (qwen3:8b):

| Request | Time | Tokens | Reasoning |
|---|---|---|---|
| Plain | 2863 ms | 197 | present |
| `reasoning_effort: 'none'` | **132 ms** | **6** | none |
| `think: false` | 4398 ms | 301 | present |
| `/no_think` suffix | 5777 ms | 397 | present |

- `qwen2.5-coder:7b` accepts the field without error.
- `response_format` with a `json_schema` was honoured by both models.
- **Determinism is not claimed.** The lens run saw temperature 0 repeat its
  trees. The review run, with identical input and all three knobs, produced
  two different assignments in 5 repeats — 4 of 13 exchanges and one title
  differed (review scratch `s1-repeats.log`). GPU inference at temperature 0
  is not reproducible; §4.1.4 bounds how long one answer can bind a
  conversation.

So a flow call sends all three knobs. Each is honoured by the local provider
only; every other vendor's request body stays byte-identical.

- **`providers/llm-provider.types.ts`**: `LlmRequest` (:122-139) gains three
  optional fields:

  ```ts
  /** false = ask a model that can think to answer without a reasoning pass. Honoured by the local provider only. */
  readonly thinking?: false
  /** Constrain the answer to this JSON Schema. Honoured by the local provider only. */
  readonly jsonSchema?: Readonly<Record<string, unknown>>
  /** Sampling temperature. Honoured by the local provider only. */
  readonly temperature?: number
  ```

- **`llm-dispatch.ts`**:
  - `LlmCall` (:65-88) gains the same three fields. There is no `background`
    field: pre-emption keys on the participant's interactive use instead
    (§4.1.9).
  - `buildRequest` (:229-244) passes the three through.
  - The two stream emits (`emitLocalUse`, :357-361, called at :380 and :395)
    send `{ providerId, at: Date.now(), interactive: true }`, and the stream
    path writes the stored choice (§4.1.1) once `send` resolves OK.
    `callModel` (:317-319) sends `{ providerId, at: Date.now() }`, never
    `interactive`.
  - The only other listener, peer-models.drone.ts:171, ignores the payload and
    keeps counting every local use as the owner's.

- **`providers/local.provider.ts`**: `toRequest` (:87) becomes:

  ```ts
  toRequest: request => {
    const http = openAiRequest(`${localLlmHost()}/v1/chat/completions`, request, () => ({}))
    if (request.thinking !== false && !request.jsonSchema && request.temperature === undefined) return http
    const body = JSON.parse(String(http.init.body)) as Record<string, unknown>
    if (request.thinking === false) body['reasoning_effort'] = 'none'
    if (request.jsonSchema) body['response_format'] = { type: 'json_schema', json_schema: { name: 'answer', schema: request.jsonSchema } }
    if (request.temperature !== undefined) body['temperature'] = request.temperature
    return { url: http.url, init: { ...http.init, body: JSON.stringify(body) } }
  },
  ```

**A server that refuses the knobs** (the fallback lives in chat-route, not in
the provider):

- **Trigger:** a flow call throws `LlmDispatchError` with `status` 400 or 422
  and a message matching `/reasoning_effort|response_format|json_schema/i`.
- **Action:** the model joins the pinned `plainLocalModels` set (§4.1.9) and
  the same call is retried once. The labeller reads that set on every call and
  then sends none of the three knobs (§4.1.1), so the retry really is plain,
  and so is every later call to that model this session.
- **Parsing still copes:** `extractRouteFlow` (chat-route.ts:670) already
  strips `<think>` blocks and fences.
- **Limit:** a server that silently IGNORES the knobs is only slower. It is
  never wrong, because code validates every answer.

#### 4.1.3 Two stages, and what a deviation is

**Why two stages.**

- **The measured failures of one call:** it leaks its example, misplaces
  branches, loses reversals, and has no room for summaries. 32 nodes of
  three-part summaries (~1500 output tokens) on top of a ~1.7k prompt
  overflows a 4096 context.
- **What two stages buy:**
  - Every call is bounded: a structure prompt is at most 6,000 characters
    (§4.1.4), a card prompt at most 7,000 characters of covered text
    (§4.1.5).
  - A card reads the node's FULL covered text instead of 200-character
    clips (chat-route.ts:499).
  - A node whose inputs did not change is never re-summarized.
  - The structure reaches the sidebar seconds before the summaries.

The stages:

1. **Stage 1 — structure** (§4.1.4). The model tags every exchange with a
   task id, and **code builds the tree**. The model is not trusted with
   parent pointers across the whole conversation; it only says, exchange by
   exchange, whether this continues a task, starts a branch of one, starts a
   new goal, or reverses an earlier choice. Code then repairs what it can
   check (§4.1.4 step 6).
2. **Stage 2 — a card per node** (§4.1.5), post-order. A leaf reads its
   covered text. A parent reads its own text plus its branches' outcomes.

**How the tree grows.** The model is taught these rules; code enforces the
shape.

| Situation | Tree effect |
|---|---|
| A fresh goal, even right after other work; each of several separate problems raised together | a new **top-level** node |
| A PART of a larger goal worked out on its own (a piece of a plan, a section of a page, a choice to make) | a new **branch of that goal** |
| A DETOUR: fixing something the task in progress ran into, or a side question in its middle | a new **branch of the task in progress** |
| More of the same task: next step, retry, confirmation, revision of what the last reply made | **reuse** its id |
| Coming BACK to an earlier task ("back to…", "still broken") | **reuse** that id |
| A REVERSAL: an earlier choice or approach abandoned for a new one | a new **sibling** (same parent), plus `drops: <abandoned id>`, which marks the abandoned node `dropped` |

**Why the prompt carries a balanced example.** The prompt variants were
measured on qwen3:8b in the lens run:

| Variant | Result |
|---|---|
| Rules only | **Lumped.** Planning became 2 nodes with the whole plan dropped; the flicker bug was hung under undo. |
| An all-new worked example | **Over-split.** 8 nodes per conversation, with junk drops. |
| Enumerated moves | **Under-split.** The first task went untitled. |
| Rules + a **balanced** example (3 reuses among 7 exchanges, from another domain) | **Correct on the lens fixtures.** Debugging became an umbrella with two parallel branches whose returns reused their ids. In planning, the parts became branches, the reversed choice was dropped and its replacement sat beside it. |

The balanced example was the only one that calibrated both splitting and
reuse. **It is not correct everywhere.** On the review conversation, in all 5
runs, no `drops` was ever emitted for either reversal, the two problems raised
together became one umbrella with one of them as its branch (against the
prompt's own rule), and the late test of an earlier fix was filed under an
unrelated node. The prompt stays; §4.1.4 adds code-side re-homing and a
provisional window, and §4.1.10 records what neither fixes.

#### 4.1.4 Stage 1 — structure (prompts verbatim)

The system prompt below was measured as the final pipeline. Its wording is
part of the version: change a word, bump `ROUTE_FLOW_VERSION`.

```ts
export const ROUTE_FLOW_STRUCTURE_SYSTEM = [
  'You map a conversation onto the TASKS it worked on, one exchange at a time.',
  'An exchange is one participant message and the reply to it. The tasks form a TREE.',
  '',
  'How the tree grows:',
  '- A fresh goal is a TOP-LEVEL task ("from": ""). Several SEPARATE problems raised together are separate',
  '  tasks; never hang one problem under another.',
  '- A PART of a larger goal that gets worked out on its own (a piece of a plan, a section of a page, a choice',
  '  to make) is a BRANCH of that goal ("from": the goal\'s id).',
  '- A DETOUR is a BRANCH of the task in progress: fixing something it ran into, or a side question asked in',
  '  the middle of it.',
  '- More of the SAME task REUSES its id: the next step, a retry, a confirmation, and any revision of what the',
  '  last reply made (shorter, warmer, add this to it, rename it, save it). Coming BACK to an earlier task',
  '  ("back to", "still broken") reuses that id too. Most exchanges reuse an id.',
  '- A REVERSAL starts a new branch beside the abandoned one (same "from") and names the abandoned one in "drops".',
  '',
  'For EVERY exchange, in order, one entry:',
  '"e": the exchange number. "task": its id; new ids are t1, t2, t3 ... in order of first appearance.',
  '"title": for a NEW id only, 3 to 8 words, verb first, naming the specific thing (tile, page, bug, feature,',
  '  option); for a reused id "". "from": for a NEW id only; for a reused id "".',
  '"state": that task after this exchange: "open" (still going, failing or waiting), "done" (finished),',
  '  "decided" (a choice settled it), "dropped" (abandoned). "drops": an abandoned EARLIER id, else "".',
  'Read the "work" lines (FAILED = that attempt did not work) and the "decided" lines. Reply with JSON only.',
  '',
  'EXAMPLE (a different conversation):',
  'E1 participant: Help me plan a week in Lisbon in May: flights, a hotel, a day trip.',
  'E2 participant: Start with flights, book the morning one. | reply: Booked the 7:05 flight.',
  'E3 participant: Wait, my passport expires in June, is that a problem? | reply: Some airlines refuse it; renew first.',
  'E4 participant: Renewed it. Does the flight booking still hold? | reply: Yes, unchanged.',
  'E5 participant: Now the hotel: the Alfama guesthouse. | decided: Which hotel? → Alfama guesthouse',
  'E6 participant: Cancel Alfama, too many stairs, find one in Baixa. | reply: Cancelled; booked Hotel Baixa.',
  'E7 participant: Add breakfast to that booking. | reply: Breakfast added.',
  '{"exchanges":[',
  '{"e":1,"task":"t1","title":"Plan a week in Lisbon","from":"","state":"open","drops":""},',
  '{"e":2,"task":"t2","title":"Book the morning flight to Lisbon","from":"t1","state":"done","drops":""},',
  '{"e":3,"task":"t3","title":"Check passport expiry for the flight","from":"t2","state":"done","drops":""},',
  '{"e":4,"task":"t2","title":"","from":"","state":"done","drops":""},',
  '{"e":5,"task":"t4","title":"Book the Alfama guesthouse","from":"t1","state":"decided","drops":""},',
  '{"e":6,"task":"t5","title":"Book a hotel in Baixa instead","from":"t1","state":"done","drops":"t4"},',
  '{"e":7,"task":"t5","title":"","from":"","state":"done","drops":""}]}',
].join('\n')

export const ROUTE_FLOW_STRUCTURE_SCHEMA = {
  type: 'object',
  properties: {
    exchanges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          e: { type: 'integer' }, task: { type: 'string' }, title: { type: 'string' },
          from: { type: 'string' }, state: { type: 'string', enum: ['open', 'done', 'decided', 'dropped'] },
          drops: { type: 'string' },
        },
        required: ['e', 'task', 'title', 'from', 'state', 'drops'],
      },
    },
  },
  required: ['exchanges'],
} as const
```

**The exchange block.** An exchange is a user turn and every turn up to the
next user turn; this reuses `routeExchanges` (chat-route.ts:442-462).

- **Turns before the first user turn** ride with E1, both here and in the
  view's turn derivation (§4.1.7). Every organized turn therefore belongs to
  exactly one exchange, and so to exactly one node.
- **Text:** each turn goes through `plainQuestionText`, as `routeFlowPrompt`
  does today (:817). Then every fenced code block becomes `[code]` (an
  unterminated fence runs to the end of the turn), and whitespace is
  flattened, with `…` at every cut. **Why:** the review conversation's replies
  opened with code, so a head clip showed the model code and never the
  sentence that said what happened.
- **Clips:**
  - participant text: its first **280** characters;
  - a reply longer than 360 characters: its first **120** + ` … ` + its last
    **240** — a reply's outcome sentence is usually at its end;
  - **at most two reply lines per exchange**: the first reply and the last,
    with `(+k more replies)` between them when there were more;
  - the work line lists at most **6** attempts, then `+k more`.

```
E{n}:
  participant: {clip}
  reply: {clip}                                    ← the first reply
  (+k more replies)                                ← only when there were more than two
  reply: {clip}                                    ← the last reply, when it is not the first
  work: {verb}{ cell}? {ok|FAILED} · … +k more     ← only when that exchange has settled attempts
  decided: {prompt} → {chosen | (went on without an answer) | (own words) …}   ← as chat-route.ts:829-835
```

**The window — provisional assignments.** A record holds `exchanges` (a node
id per mapped exchange) and `settled` (how many of them are frozen, §4.1.6).
Freezing an assignment on its first answer made whichever tree the first run
happened to produce permanent (§4.1.2). So an assignment freezes only once a
structure call has mapped it with at least `ROUTE_FLOW_OVERLAP` (5) later
exchanges in view:

- **The window.** A call maps `E{from+1}…E{upto}`, where `from = settled` and
  `upto = min(from + ROUTE_FLOW_CHUNK, closedExchanges, 400)`. It is made only
  when `upto > exchanges.length`, so at least one exchange is new. The
  provisional exchanges `E{settled+1}…E{exchanges.length}` — never more than
  5 — are mapped again together with the new ones.
- **After a usable call**, `exchanges[from..upto)` are replaced, and
  `settled = max(from, upto − ROUTE_FLOW_OVERLAP)`; when `upto` reached
  exchange 400, `settled = upto`.
- **Progress:** at most 5 exchanges are provisional, so a full chunk maps at
  least 5 new ones. The newest ≤ 5 assignments of a conversation that stops
  growing stay provisional, harmlessly: they are shown, and no call is made
  until something new closes.
- **Released nodes.** Nodes referenced only by provisional exchanges are
  released before the call: TASKS SO FAR lists only the nodes referenced by
  `exchanges[0..from)` and their ancestors, and `next` counts only those. A
  released id can be issued again; §4.1.6 says how cards follow it.
- **Input budget.** The rendered user prompt is at most
  `ROUTE_FLOW_STRUCTURE_INPUT_CHARS` (6000) characters.
  - Over it, `upto` shrinks by one exchange and the prompt is rendered again.
  - When the window can no longer hold its provisional exchanges plus one new
    exchange, the oldest provisional exchanges freeze as they are (`from` and
    `settled` advance) until it fits.
  - When one new exchange alone is over budget, its replies are cut to 120 +
    120 characters.
  - **Why the number:** the system prompt is about 3,000 characters (~850
    tokens); 6,000 characters of prompt is about 1,700 tokens; the answer is
    at most `60 × 10 + 120` = 720 tokens. That is about 3,300 of Ollama's
    4,096. The measured maximum (1,897 tokens in) came from 3–6-node
    conversations; 32 task lines alone are about 2,000 characters, which is
    why the budget is enforced rather than assumed.

**Fresh** (`from === 0`):

```
EXCHANGES E1–E{upto}:
{block E1}
…
{block E_upto}

Map every exchange, E1 to E{upto}.
```

**Update** (`from > 0`) — every later window, including every re-mapping of
provisional exchanges. Fresh and incremental mapping are one path:

```
TASKS SO FAR (E1–E{from} are already mapped):
- t1 [open]: Plan a signup system for the community garden
- t2 (branch of t1) [dropped]: Import sign-ups from a spreadsheet
…

THE LAST MAPPED EXCHANGE, for context:
{block E_from}
  → {exchanges[from-1]}

EXCHANGES E{from+1}–E{upto}:
{blocks}

Map only E{from+1} to E{upto}. Reuse an id above when an exchange continues or returns to that task; the next new id is t{next}.
```

Task lines carry the node's **display** title (the card's name once named)
and its stored state.

**Call parameters.**

| Parameter | Value |
|---|---|
| `system` | `ROUTE_FLOW_STRUCTURE_SYSTEM` |
| `messages` | `[{ role: 'user', content }]` |
| `jsonSchema` | `ROUTE_FLOW_STRUCTURE_SCHEMA` |
| `temperature` | 0 |
| `thinking` | `false` (set by the labeller, unless the model is plain) |
| `maxTokens` | `60 × (upto − from) + 120` |
| `signal` | `AbortSignal.any([laneAbort, AbortSignal.timeout(ROUTE_FLOW_STRUCTURE_TIMEOUT_MS)])` |
| Window size | `ROUTE_FLOW_CHUNK = 10` exchanges per call, shrunk by the input budget |

Measured: 4.2 s average, 7.9 s maximum on the lens fixtures (at most 1,897
tokens in, 484 out); 7.8–8.0 s warm and 12.3 s cold (model load included) for a
full window on the review conversation (1,875 tokens in, 481 out).

**`buildFlowTree` — parse and repair, pure.** Its inputs are the parsed
entries for one window, the previous `{ nodes, exchanges, settled }` (or
none), and the window's exchange texts (for step 6).

1. `extractRouteFlow(text)` (chat-route.ts:670). Take `value.exchanges` when
   it is an array, else the value itself when it is an array, else the window
   is unusable.
2. Keep the entries that are objects with an integer `e` in
   `[from+1, upto]`; the first entry per `e` wins. **If fewer than
   ⌈(upto−from)/2⌉ entries survive, the window is unusable:** no write for it,
   and the structure back-off applies (§4.1.9).
3. Seed `tasks` with the nodes referenced by `exchanges[0..from)` and their
   ancestors (in record node order), and `assign = exchanges[0..from)`.
   **Settled assignments are never changed.** `next` = 1 + the largest numeric
   suffix among the seeded ids.
4. `alias: Map<modelId, canonicalId>`, seeded with identity for every
   seeded id. The model's own ids are never stored: canonical ids are
   `t1, t2, …`, never renumbered while referenced.
5. For each `k` from `from` to `upto − 1`, with `prev = assign[k-1]`:
   - **Read:** `raw = trim(en.task)`; `id = alias.get(raw) ?? ''`.
   - **Reuse:** if `id` is set, the entry's title and `from` are ignored.
   - **New node:** else, if `cleanWorkingTitle(en.title)` is non-empty and
     `tasks.size < ROUTE_FLOW_MAX_NODES`:
     - the new `id = 't' + next++`, and `alias.set(raw || id, id)`;
     - `parent = alias.get(trim(en.from)) ?? ''` — a parent must already
       exist;
     - while the parent sits at depth ≥ 3, move up to the parent's parent;
     - push `{ id, title, parent, state: 'open' }`.
   - **No usable title:** `id = prev` (continue). E1 with no title gets a new
     `'t' + next++` with title `''`; the card names it later, and the shell
     shows `chat.route.flow.untitled` meanwhile.
   - **A missing entry for `k`:** `id = prev`.
   - **State:** a valid `en.state` sets `tasks[id].state`. **The last
     reported state wins**, so a later exchange can reopen a node.
   - **Drops:** `d = alias.get(trim(en.drops))`. When `d` exists, is not
     `id`, and is not an ancestor of `id`, then `tasks[d].state = 'dropped'`.
     A drop of one's own ancestor is ignored; the all-new-example variant
     dropped the whole plan that way.
   - `assign[k] = id`, then step 6 for this `k`.
6. **Re-home (lexical)**, for `k ≥ 1`, right after `k` is assigned:
   - `words(text)`: the lowercased tokens split on `[^\p{L}\p{N}]+`, of length
     ≥ 4, minus STOP and GENERIC (§4.1.5), each cut to its first 5 characters.
   - `P = words(participant text of E{k+1})`; skip when `|P| < 2`.
   - `C(n)` = the words of the participant and reply texts of every exchange
     assigned so far to `n` or to a descendant of `n`, plus `words(n.title)`.
   - The **tested node** is the reused node, or, for a new node, its parent. A
     new root is not tested.
   - **When** `P ∩ C(tested)` is empty, `P ∩ C(a)` is empty for every ancestor
     `a` of the tested node, and exactly one other node `m` (not the tested
     node, not the new node itself) has `|P ∩ C(m)| ≥ 2` while every other node
     has fewer: a reuse becomes a reuse of `m`, and a new node's parent becomes
     `m` (the depth rule of step 5 applies).
   - **Why covered text, not titles:** on the review conversation the late
     test ("Write a test for the fold anchoring from earlier.") belonged to
     "Fix sidebar jump", a title that shares no word with it. The exchange that
     raised the fold ("…it still happens when I fold a branch…") does share
     words with it.
   - Unmeasured; the review conversation is its eval (§8).
7. `cleanWorkingTitle` = the existing `cleanTitle` (chat-route.ts:521-530),
   then strip a trailing question clause, `/[:\-–—]?\s*[^:]*\?\s*$/`. If that
   empties the title, strip only the `?`.
8. **Node order is rational order:** preorder, with roots and each node's
   children in order of first appearance. Parents precede children, as in
   v1.
9. **Guard:** a node referenced by no exchange, and with no referenced
   descendant, is removed. This is how a released provisional node that was
   not issued again goes away.
10. **Cap:** only the first `ROUTE_FLOW_MAX_EXCHANGES` (400) exchanges are
    ever mapped; the rest stay dormant stages.

A node's turns are never stored. They are derived at read time from
`exchanges` and the turn list (§4.1.7).

#### 4.1.5 Stage 2 — a card per node (prompts verbatim)

```ts
export const ROUTE_FLOW_CARD_SYSTEM = [
  'You write the card for ONE task in a conversation: its name and its summary.',
  'Say only what the messages below show. If they do not say how it ended, say where the last reply left it.',
  '',
  'title: 3 to 8 words. Start with a verb (Build, Fix, Choose, Add, Plan, Trace, Replace ...). Name the SPECIFIC',
  '  thing from the messages: the tile, page, bug, feature, file or option. A task with branches is named for the',
  '  goal ALL its branches serve, never for one of them. Never a vague word like task, issue, problem, discussion,',
  '  question, update, changes, help, work, or conversation. Sentence case, no quotes, no period.',
  '  When a CURRENT NAME is given, keep it unless it no longer fits.',
  'goal: one sentence: what it set out to do.',
  'done: one or two sentences: what was actually done or decided, with the specifics (names, choices, causes,',
  '  fixes, numbers), in the order it happened. For a task with branches, say what the branches came to in a',
  '  few words each; do not repeat their cards.',
  'outcome: one sentence: how it ended: the result, or exactly what is still open. A FAILED attempt that was',
  '  never fixed is still open.',
  '',
  'Write about the work, never about the people ("Fixed the ...", not "The user asked ..."), and never use the',
  'words task, card, branch or state in the text. Reply with JSON only.',
].join('\n')

export const ROUTE_FLOW_CARD_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, goal: { type: 'string' }, done: { type: 'string' }, outcome: { type: 'string' } },
  required: ['title', 'goal', 'done', 'outcome'],
} as const
```

**The user prompt:**

```
STATUS: {node.state}
CURRENT NAME: {node.title}            ← when the node already carries a card-given title (node.named)
WORKING NAME: {node.title}            ← otherwise (exactly one of the two lines)
PART OF: {parent display title}       ← only when parented

ITS BRANCHES (each already has its own card):          ← only for a node with children
- {child display title} [{child state}]: {child card outcome, when it has a card}

MESSAGES:
[{index+1}] participant|reply: {fitted text}
    work: {verb cell ok|FAILED} · …
    decided: {prompt} → {chosen}

Write the card as JSON.
```

- **MESSAGES** are the node's own exchanges, **except meta exchanges.** A meta
  exchange — a wrap-up or courtesy exchange that talks about other steps —
  belongs to its node for lighting and for the card key, but is left out of
  its MESSAGES. An exchange is meta when all of these hold:
  1. its participant text is at most 8 words;
  2. no attempt and no decision sits on its rows;
  3. its participant text shares no `words()` (§4.1.4 step 6) with any node
     title, or with any other exchange's participant text;
  4. its last reply shares at least 2 `words()` with the covered text of each
     of at least 2 nodes other than its own.

  A node whose exchanges are all meta keeps them all.
  - **Why:** on the review conversation "Where are we overall?" was assigned
    to the root, and the root's card then reported the summary pane and the
    tile rename — other steps' work — as its own.
  - **Why condition 4:** a terse follow-up such as "still broken" meets 1–3,
    but its reply is about its own step, so it stays in the card.
- **Fitting.** The covered-text budget is **7000 characters for a leaf** and
  **4000 for a parent**, because a parent also carries its branches. When the
  covered text is over budget, each turn is capped at
  `max(300, floor(budget / turns))`, keeping its first 70% + ` … ` + its last
  30%. Measured: at most 974 tokens in and 161 out.
- **The call:**
  - `jsonSchema: ROUTE_FLOW_CARD_SCHEMA`, `maxTokens: 350`,
    `temperature: 0`;
  - timeout `ROUTE_FLOW_CARD_TIMEOUT_MS`;
  - post-order, so every child's card exists before its parent's prompt is
    built.
  - Measured: 1.7 s average per card with 6.5% needing the retry (lens run);
    1.5–2.6 s per card, 7 cards in 24.8 s with one retry (review run).
- **One retry** when the title or the summary is rejected: the same prompt
  plus

  ```
  \n\nYour last answer was not usable: {title rejected (why); summary rejected (why)}.\n{the JSON it gave}\nWrite it again, fixed.
  ```

  `why` names the offending word for `ungrounded-*`. Take whichever title and
  whichever summary validates across the two answers.

**Title validator — `checkFlowTitle(raw, { covered, participants, childTitles })`.**
`covered` is the node's covered turn texts plus its child display titles.

- **Clean:** flatten whitespace; strip a leading `"'`*_“”‘’` and a trailing
  `"'`*_“”‘’.。`.
- **Reject when:**

  | Condition | Reason |
  |---|---|
  | words < 2 | `too-short` |
  | words > 8 | `too-long` |
  | contains `?` or `!` | `question` |
  | matches `/\b(user|assistant|participant|chatbot)\b/i` | `role-word` |
  | no content words remain (the title's lowercase words split on `[^\p{L}\p{N}&+#]+`, minus STOP, minus GENERIC) | `generic` |
  | no content word of length ≥ 3 has its first `min(5, len)` characters inside the lowercased covered text | `ungrounded` |
  | ≥ 5 words and some participant message (flattened, lowercased) **starts with** the lowercased title | `copied` |
  | equals (case-insensitive) a child display title | `names-a-branch` |

- `STOP` = `a an the of on for to in at by with and or from into about as is are be it its this that these those my our your their new more all both two one via up out off vs`
- `GENERIC` = `task tasks work working discussion discuss discussing conversation chat question questions answer answers issue issues problem problems help request requests update updates updating change changes stuff thing things misc miscellaneous general topic topics follow followup follow-up next steps step phase node branch detour side overview summary user users assistant participant reply replies message messages turn turns exchange exchanges session item items various other details detail info information progress handle handling address addressing continue continuing do doing make making get getting go going talk talking ask asking check checking look looking review reviewing resolve resolving process processing deal dealing provide providing clarify clarifying explain explaining`
- **Casing.** Each non-first word shaped `^\p{Lu}\p{Ll}+$` is lowercased when
  the conversation writes that word in lowercase. "Fraunces", "Inter" and
  "Crumb" keep their capitals; "Waitlist" becomes "waitlist". (The review run
  shows the rule is needed: "Fix Ollama host Shadowing" reached a card.)
- **Which title the node keeps**, in order:
  1. When the node already carries a card-given title and covers fewer than
     `2 × card.exchanges` exchanges, the old title stays (**hysteresis**, so
     names do not flap as a node grows a little).
  2. Otherwise, a valid model title.
  3. Otherwise, the stage-1 working title, if it validates.
  4. Otherwise, the current title, unchanged.

**Summary validator — `checkFlowSummary(obj, { given, others, childCards })`.**
`given` is everything the card was given (its MESSAGES, title, PART OF, its
branches' titles and outcomes); `others` is the covered text of every node
that is neither an ancestor nor a descendant of this one.

- **Limits** (`ROUTE_FLOW_CARD_LIMITS`): goal 160, done 280, outcome 180
  characters. Over a limit, cut at the last `. ` when it falls past 60% of the
  limit; otherwise hard-cut and add `…`.
- **Reject when:**

  | Condition | Reason |
  |---|---|
  | any part < 12 characters | `short-<part>` |
  | any part matches `/\b(user|user's|assistant|participant|chatbot)\b/i` | `role-<part>` |
  | any part matches `/\b(the|this) (task|card|branch)\b/i` | `meta-<part>` |
  | `goal === done` or `done === outcome` | `repeated` |
  | a parent whose `done` has Jaccard similarity > 0.7 (on content words) with any child card's `done` | `copies-a-branch` |
  | a part holds a word (`words()`, from tokens of length ≥ 5) absent from `given` and present in `others` | `ungrounded-<part>` |

- **What `ungrounded` catches, and what it does not:** another step's facts
  leaking into this card. It cannot catch a fact invented from nowhere — the
  review run's "when navigating routes", a phrase in no message — because a
  paraphrase and an invention look the same to a word check (§4.1.10).
- **When the retry also fails:** the node keeps its previous card, flagged
  `stale`, or has none, and the card back-off applies (§4.1.9). Nothing
  partial is ever stored.

**Card accuracy — measured, and the rendering rule.**

- **Lens run:** leaves read accurately, for example *"Added the contact
  section at the bottom with the address 14 Mill Lane, opening hours as a
  table (Tue–Sat 7:00–15:00, closed Sun–Mon), and a tap-to-call link."* 2 of 8
  parent cards held a false claim: one planning parent inverted the reversal,
  one linear parent said "ready for distribution". A parent-only prompt
  variant did not fix it.
- **Review run:** 2 of 5 leaf cards were wrong or missing. One invented a
  route-navigation cause no message mentions; one was rejected `role-goal`
  twice and has no summary. The root parent reported other roots' work as its
  own, through the wrap-up exchange that is now a meta exchange and that the
  `ungrounded` check would also have rejected. A misfiled exchange (§4.1.3)
  also put another step's test into the rename node's card.
- **So no card is ground truth.** The pane (§4.4.2) leads with the node's
  outcome, and for a parent follows it at once with the **branch lines from
  the record**: each child's title and state glyph, which come from stage 1
  and code, not from the card. Each branch line is pressable, and the
  branch's own pane leads with its own outcome.

Whether a parent should show model-written text at all is one of Jaime's
decisions.

#### 4.1.6 The record v2, its keys, and when it is written

```ts
export const ROUTE_FLOWS_POOL = 'chat:route-flows'        // unchanged; seeded in pool-registry.ts:293
export const ROUTE_FLOW_VERSION = 2                       // bump: prompt, parse, shape, window and repair rules
export const ROUTE_FLOW_CARD_VERSION = 1                  // bump on any card prompt/validator change
export const ROUTE_FLOW_MAX_NODES = 32
export const ROUTE_FLOW_MAX_DEPTH = 3
export const ROUTE_FLOW_TITLE_WORDS = 8                   // unchanged
export const ROUTE_FLOW_MAX_EXCHANGES = 400
export const ROUTE_FLOW_CHUNK = 10
export const ROUTE_FLOW_OVERLAP = 5
export const ROUTE_FLOW_STRUCTURE_INPUT_CHARS = 6000
export const ROUTE_FLOW_CARD_LIMITS = Object.freeze({ goal: 160, done: 280, outcome: 180 })

export interface RouteFlowCard {
  readonly key: string          // 64 hex — the card key below
  readonly cv: number           // ROUTE_FLOW_CARD_VERSION when it was written
  readonly goal: string
  readonly done: string
  readonly outcome: string
  readonly exchanges: number    // how many exchanges the node covered when this card was written
  readonly model: string        // the wire model that wrote it
  readonly at: number
  readonly stale?: true         // set on read when cv is old; set at a structure or advance write when its key no longer matches
}
export interface RouteFlowNode {
  readonly id: string           // /^t\d{1,3}$/, never renumbered while referenced
  readonly title: string        // ≤ 8 words / 80 chars; '' only for an untitled node on exchange 1
  readonly named?: true         // the title was given by a card
  readonly state: RouteFlowState
  readonly parent?: string
  readonly card?: RouteFlowCard
}
export interface RouteFlowRecord {
  readonly kind: 'chat:route-flow'
  readonly v: 2
  readonly convoId: string
  readonly upToTurnCount: number            // one past the last turn of the last mapped exchange
  readonly upToTurnSig: string              // sig of turn upToTurnCount - 1
  readonly at: number
  readonly model: string                    // wire model of the last structure pass
  readonly exchanges: readonly string[]     // node id per mapped exchange, in thread order
  readonly settled: number                  // exchanges[0..settled) are FROZEN; the rest (≤ 5) are provisional (§4.1.4)
  readonly nodes: readonly RouteFlowNode[]  // rational order (preorder)
  readonly pending: number                  // nodes with no card or a stale card (recomputed on read)
}
```

The v1 `detail` and the stored per-node `turns` are gone. Turns are derived,
because the assignment already says which exchanges a node owns, and a second
copy could disagree with it. **Size bound:** 32 nodes × (~80 + ~650 bytes) +
400 exchanges × ~5 bytes ≈ 26 KB.

**The card key.**

```ts
cardKey(node) = SignatureService.sign(utf8([
  'chat:route-flow-card', `cv${ROUTE_FLOW_CARD_VERSION}`, `v${ROUTE_FLOW_VERSION}`,
  `state:${node.state}`,                                      // the STORED state, not the rolled-up view state
  ...node.turns.map(i => `turn:${turns[i].sig}`),             // the turn sig covers role + text
  ...attemptsOnRows(node.turns).map(a => `work:${a.verb} ${a.cell ?? ''} ${a.outcome}`),
  ...decisionsOnRows(node.turns).map(q => `decided:${q.prompt}→${chosenText(q)}`),
  ...childrenInOrder(node).map(c => `child:${keyOf(c)}`),     // post-order, so child keys exist
].join('\n')))
```

**What the key is:**

- **Keyed by its inputs**, as the derived-cache doctrine asks: the covered
  turns, their settled work, their decisions, the node's state and the
  branches beneath it.
- **Stamped with both versions**, because a key over immutable inputs is not
  self-invalidating when the deriving code changes.
- **Its card version is also stored, as `cv`.** The key cannot be recomputed
  on the read path: `SignatureService.sign` is async (signature.service.ts:26),
  and `parseFlowRecord` is sync and has no turns. A card whose `cv` is not
  `ROUTE_FLOW_CARD_VERSION` therefore reads `stale` at once. A card version
  bump re-derives every card, idle conversations included, and the view never
  labels such a card current. The record carries no `cv`: `v` already covers
  everything the record itself holds.

**What it deliberately leaves out:**

- **The model.** Switching models must not re-derive every conversation.
- **Titles.** They are outputs, not inputs.

**Consequences:**

- A node is **carded** when it has no card, when its card is `stale`, or when
  `card.key !== cardKey(node)` at a structure or advance write.
- **One grown leaf re-keys its ancestors** — at most two extra calls at depth 3.

Measured growth from 10 to 16 turns (qwen3:8b, lens run):

| Conversation | Stage-1 update | Cards re-written / kept | Total |
|---|---|---|---|
| website | 1.6 s | 4 / 1 | 8.7 s |
| debugging | 1.4 s | 2 / 1 | 6.0 s |
| planning | 1.5 s | 2 / 2 | 5.6 s |

Hysteresis held every title.

**Cards across a re-mapped window.** At a structure write each node takes a
previous card by the first rule that applies:

1. **The same id with the same first exchange** — it is the same node. Its
   card is kept: current when its key matches, `stale` otherwise.
2. **The same key** — any previous card whose key equals this node's key.
   Keys are content keys, so that card is exactly about this node's inputs.
3. Otherwise no card.

A released id issued again to a different node (a different first exchange)
never inherits the old node's card.

**Validation on read and on write — `parseFlowRecord` v2.**

- **The record reads as absent** when:
  - `kind`, `convoId` or `upToTurnCount` fail the v1 checks
    (chat-route.ts:697-703), or `v !== 2`;
  - `exchanges` is not a non-empty array of ≤ 400 strings;
  - an exchange names no node;
  - nothing valid remains.

  A v1 record reads as absent, so it is minted again.
- **`settled`** that is not an integer in `[0, exchanges.length]` reads
  `max(0, exchanges.length − ROUTE_FLOW_OVERLAP)`, which is always a window
  the next call can make progress from.
- **Nodes:**
  - ids must be unique; entries beyond 32 drop;
  - a title is cleaned (§4.1.4 step 7), and an empty title is allowed only for
    the node assigned to exchange 1;
  - an unknown state reads `done` (`STATE_WORDS`, :511-517);
  - a parent must precede the node, or it comes off;
  - a node deeper than 3 re-hangs on its depth-2 ancestor;
  - a node referenced by no exchange, with no referenced descendant, drops.
- **Cards:** an invalid card is removed and the node stays. A card is invalid
  when its key is not 64 hex, `cv` is not an integer, any part fails the
  §4.1.5 lengths or is empty, `exchanges` is not an integer ≥ 1, or `model` is
  missing. A valid card whose `cv` is old is kept with `stale: true`.
- **`pending`** is recomputed on every read and never trusted from storage.

**The write timeline** (complete-or-absent). Every write goes through the
existing `writeRouteFlow` (chat-route.ts:901-909):

- It uses `store.putPoolDoc(pool, bytes, convoId)`. That writes the new member
  before sweeping the others, and a `subKey` is the positive proof the sweep
  requires (hypercomb-runtime/src/store.ts:279-327).
- Every successful write emits `chat:route-flow-changed { convoId }`.
- No resource is minted, and no `content:wrote` fires: the flows are private
  and nothing reaches a host.
- The whole object is validated with `parseFlowRecord` before a byte is
  written. Invalid means nothing is written.

The writes:

1. **W-structure** — after the stage-1 calls of this pass succeed. When a
   later call fails, the successful prefix is written.
   - `upToTurnCount` is the end of the last mapped exchange.
   - Cards follow nodes by the three rules above.
   - `pending` is computed.
2. **W-advance** — the behind rule found closed turns beyond `upToTurnCount`
   but no new exchange start below them: a second reply, or a late reply,
   inside the last mapped exchange.
   - `upToTurnCount` and `upToTurnSig` advance; `exchanges` and `settled`
     stay; no model call is made.
   - The last node's derived turns grow, so its card's key no longer matches:
     it is flagged `stale` and re-carded like any grown node.
3. **W-card:**
   - **Attended** conversation: after **each** card, so summaries appear one
     by one while the participant watches.
   - **Passive:** once, when the conversation's card loop ends, or when the
     pass yields, aborts or hits its budget with cards written.
   - A card replaces the node's card whole: new key, current `cv`, fresh,
     `stale` removed. A title change applies with the card.
4. **No local model awake** means no read, no call and no write — the gate
   runs before the first read, as in v1. W-advance also waits for the gate:
   it changes nothing the participant can see until a card follows it.

**Why a stale card is kept and not blanked.** A growing node keeps its older
summary, honestly labelled *summary of the first n exchanges*, instead of going
blank every time the conversation moves. The card is still whole, keyed and
complete; it is simply about fewer inputs than the node now has. This
stretches "keyed by input" as far as it will go, and the view flags it so it is
never mistaken for current.

#### 4.1.7 What `readRoute` hands the shell — and what "pending" means

```ts
export interface RouteFlowView {
  readonly upToTurnCount: number
  readonly pending: number
  readonly model: string                   // record.model — "Organized by {model}"
  readonly nodes: ReadonlyArray<{
    readonly id: string; readonly title: string; readonly named?: true
    readonly state: RouteFlowState          // the ROLLED-UP display state (below)
    readonly parent?: string
    readonly exchanges: readonly number[]   // 1-based exchange numbers the node owns
    readonly turns: readonly number[]       // derived: the union of those exchanges' turn ranges, < upToTurnCount
    readonly detail?: string                // = card.done clipped to 160 — for an older shell that still draws v1 cards
    readonly card?: Omit<RouteFlowCard, 'key'>   // carries cv and stale
  }>
}

export type RouteOrganizerState =
  'awake' | 'off' | 'unknown' | 'asleep' | 'blocked' | 'needs-permission' | 'empty' | 'no-model'

export interface Route {
  /* rows, live, unfinished — unchanged */
  readonly flow?: RouteFlowView
  /** Probe STATE only: localOrganizerState(), then participantLocalModel with the stored choice,
   *  fallback lastPassModel and [convoId]. No fetch on any path. */
  readonly organizerState?: RouteOrganizerState
  /** Present only while organizerState === 'awake'. */
  readonly organizer?: { readonly providerId: string; readonly model: string }
  /** A flow model call for THIS conversation is in flight. */
  readonly organizing?: { readonly stage: 'structure' } | { readonly stage: 'card'; readonly nodeId: string }
  /** Node ids whose card is in back-off (its last answer was unusable, recently). */
  readonly cardBackoff?: readonly string[]
}
```

- **When the flow is used.** `readRoute` (chat-route.ts:385-393) builds the
  view only when `flowMatches` (:714-718) holds **and** `record.exchanges.length`
  equals the number of exchanges that start below `upToTurnCount`. A mismatch
  reads as no flow, and every exchange is a dormant stage.
- **A node's turns.** Exchange *k* (0-based) spans
  `[start_k, start_{k+1})`, where exchange 0 starts at turn 0 (the turns before
  the first user turn ride with it) and the last is bounded by
  `upToTurnCount`. A node's turns are its OWN exchanges' ranges; a parent's
  turns do not include its branches'.
  - **Why:** pressing a parent brings the thread to where that goal was
    stated. Its branches are listed in the pane, each one pressable. Lighting
    the whole subtree would light most of the conversation, which shows
    nothing.
- **The rolled-up display state** (view only, never stored). A node whose own
  state is `open` displays `done` when both hold:
  - every descendant is settled (`done|decided|dropped`);
  - all its own exchanges precede its first descendant's first exchange.

  This fixes "Build a landing page [open]" sitting over five finished
  branches. It does not fire when the conversation comes back to the parent
  later, which is how the debugging case reads. It is unmeasured.
- **`organizerState`, `organizer`, `organizing` and `cardBackoff`** let the
  pane tell apart states that look alike and mean different things (§4.4.2):
  - **"a summary is on its way"** — the model is awake, the card is missing
    or stale;
  - **"the local model is writing it now"** — `organizing` names this node;
  - **"it waits for your local model"** — nothing is awake, nothing is sent
    anywhere else, and `organizerState` says why: switched off, not heard from
    yet, not running, refused this page, needs permission, no model installed,
    or no model of the participant's chosen yet.

  The shell cannot learn the model's readiness itself without risking a
  knock: the shell's `ready()` reaches `localModelServerUp`, which may probe.
  So essentials reports it through the gate that never knocks.
- **The effect.** `chat:route-flow-organizing { convoId, stage, nodeId?, active }`
  is emitted immediately before and after every flow model call. The shell
  treats it as a refresh hint, filtered on `convoId`.

#### 4.1.8 The behind rule, the gate, never another vendor

- **The behind rule** (`closedFlowEnd` + `flowIsBehind`,
  chat-route.ts:741-760) keeps its closing conditions. Re-derive when a CLOSED
  turn lies beyond `upToTurnCount`, or when there is no flow and something is
  closed.
  - An exchange with a later user turn is closed.
  - The LAST exchange is closed only when all of these hold:
    - it holds a reply;
    - the thread has been idle `ROUTE_FLOW_IDLE_MS` (90 s);
    - no `mode:'chat'` ask for the conversation is still in the pool (read at
      most once per pass; an unreadable pool counts as "maybe outstanding");
    - in the attended call, the shell has no live run and no wait.
  - **Capped:** `closedEnd` is clamped to the start of the 401st exchange,
    so a conversation whose flow holds 400 exchanges is never behind for what
    follows them.
  - **What settles it:**
    - stage 1, while the closed exchanges (≤ 400) outnumber
      `exchanges.length` (§4.1.4);
    - otherwise W-advance, when the growth is inside the last mapped exchange
      (§4.1.6). v1 advanced `upToTurnCount` on any closed growth
      (chat-route.ts:1089-1092); a stage 1 that maps only exchange starts
      would otherwise leave such a conversation behind forever, revisited
      every 5 s.
  - Beside the behind rule, cards are due whenever `pending > 0`.
- **The gate is a STATE READ, never a knock.**
  - Only a **machine-local** provider counts: a loopback endpoint
    (`machineLocalEndpoint`) that the participant has not switched off and
    that is **already known awake**, read by `localOrganizerState` as
    `localServerReport(provider).state === 'awake'`. That is a map lookup plus
    localStorage reads, and it never fetches.
  - The report map is pinned (§4.1.9), so the gate reads the report a probe
    wrote, whichever copy of the module ran the probe.
  - `localModelServerUp` is deliberately **not** used: it calls
    `refreshLocalServer`, which knocks whenever `worthKnocking` holds. That is
    the red console lines the "who asked" gate in
    `providers/local-liveness.ts` exists to prevent.
  - No `checkLocalServer`, `refreshLocalServer` or `probeLocalServer` on any
    flow path, including `readRoute`'s `organizerState`.
  - No local model awake means no read, no call, no fetch, no error, no log.
    The gate runs before the first read, again before every conversation, and
    immediately before every call.
- **Never another vendor.**
  - The call names `providerId` and `model` last.
  - `resolveProvider` returns the named descriptor or throws.
  - `callModel` makes one attempt, and `routeCandidates` gives an explicit
    call one candidate.
  - The gate re-resolves the id and requires it to come back as itself and
    still machine-local, so a future fallback could not slip in unseen.
  - One honest cost: a call to a server that was awake and has since stopped
    fails inside the dispatch seam, which re-probes
    (`noteLocalServerUnreachable`) exactly as it does for any chat send. The
    pass then stops and the state reads asleep. An ABORTED fetch (a timeout, a
    yield) is rethrown without re-probing (llm-dispatch.ts:275), so a timeout
    never marks the server asleep.
- **Passive means passive.** A background drain, never a bee, never agent
  work, never a report, silent writes.

#### 4.1.9 When — one state, the lane, the drain, the schedule

**One state, pinned on `globalThis`.** The web build holds chat-route.ts more
than once:

- A bee is bundled with only namespace specifiers external, so every relative
  import is inlined into it (build-module.ts:143-146; `buildBee` :736).
- `orchestrator.drone.ts` is a bee (`isBee`, scripts/_shared.ts:28) and imports
  `./chat-route.js` relatively (orchestrator.drone.ts:39).
- `ChatThreads` reaches chat-route from the namespace dependency
  (chat-thread.ts:27, registered at :1300). Two more bees inline chat-thread.ts
  itself (agent-bee.drone.ts:51, claude-bridge.worker.ts:8), and IoC keeps the
  first registration, so the registered `ChatThreads` may be any of those
  copies.

So on web the drain and the attended call run in different copies. v1's "ONE
guard for the attended call and the passive drain" (chat-route.ts:990-992) is
already two guards there. The probe state is split the same way:
`localServerReport` reads a module map (providers/local-liveness.ts:87-88), and
a copy that no probe ran in reads `unknown` forever. The dev shells import
essentials as one module graph, so the verifier on 4251 cannot see any of
this.

The fix is the pattern `__hypercombEffectBus` already uses. It is chosen over
routing the drain through IoC, because IoC would leave the probe-state split in
place:

```ts
const FLOW_STATE = Symbol.for('hypercomb.chat-route.flow-state')

interface RouteFlowState {
  tail: Promise<void>                                     // the lane: one flow model call at a time
  inFlight: { readonly abort: AbortController; readonly attended: boolean; readonly convoId: string } | null
  attendedWaiting: number
  pausedUntil: number
  subscribedAt: number                                    // 0 until the llm:local-used subscription exists
  readonly organizing: Set<string>                        // the per-conversation mint guard (v1 :992)
  readonly organizingNow: Map<string, { readonly stage: 'structure' } | { readonly stage: 'card'; readonly nodeId: string }>
  readonly prefer: Map<string, string>
  readonly backoff: Map<string, number>                   // structure and card back-off keys → when
  readonly plainLocalModels: Set<string>
  lastPassModel: string
}

const flowState = (): RouteFlowState =>
  ((globalThis as Record<symbol, unknown>)[FLOW_STATE] ??= { /* initial values */ }) as RouteFlowState
```

- `providers/local-liveness.ts` moves `reports` and `inFlight` (:87-88) onto
  `Symbol.for('hypercomb.local-liveness.reports')` the same way.
- The `llm:local-used` subscription is made once per state (guarded by
  `subscribedAt`), not once per module copy.
- No module-scope `let`, `Map` or `Set` for flow coordination remains in
  chat-route.ts; v1's `organizing` (:992) and `unusable` (:995) move into the
  state.

**Constants** (chat-route.ts, beside §4.1.6's):

```ts
ROUTE_FLOW_STRUCTURE_TIMEOUT_MS = 45_000   // a cold model load measured 10–17 s, plus ~8 s worst generation
ROUTE_FLOW_CARD_TIMEOUT_MS = 30_000
ROUTE_FLOW_PASS_MS = 90_000                // unchanged: a pass stops STARTING calls after this
ROUTE_FLOW_PASS_CALLS = 48                 // replaces ROUTE_FLOW_PASS_CONVERSATIONS
ROUTE_FLOW_RETRY_MS = 10 * 60_000          // unchanged
ROUTE_FLOW_YIELD_MS = 30_000               // after the participant's own local chat
ROUTE_FLOW_BACKOFF_CAP = 500
```

**The lane — one flow model call at a time, and the participant always
wins.** `withLane(fn, { attended, convoId, waiting })`:

1. **Refused before anything** — no read, no call, no emit, no write:
   - for every caller, while `now < pausedUntil`;
   - for the attended call, while `waiting` (the shell is waiting on a reply
     in this conversation).

   The attended call resolves 0. The drain ends its pass `stopped: 'yield'`
   with `resumeAt = pausedUntil`.
2. **The attended call never waits behind the drain.**
   - It increments `attendedWaiting`. If the call in flight is passive, that
     call is aborted: its outcome is `yielded`, with no back-off and nothing
     partial written. Then the attended call takes the lane.
   - The drain checks `attendedWaiting` before each call; while it is above 0
     the drain ends its pass `stopped: 'yield'` with
     `resumeAt = now + soonMs`.
   - An attended call can wait only behind another attended call — at most
     that call's timeout (card 30 s, structure 45 s). Measured abort latency is
     about 0.3 s.
3. **The participant's own local chat preempts everything.**
   - On first use, the state subscribes to `llm:local-used`.
   - A payload with `interactive: true` and `at ≥ subscribedAt` (EffectBus
     replays the last value) sets `pausedUntil = at + ROUTE_FLOW_YIELD_MS` and
     aborts the call in flight, attended or passive (outcome `yielded`).
   - A payload without `interactive` changes nothing. That covers the blurb
     drain, bee banter, serving a peer and the providers window's test
     (§4.1.2), which v1's plain payload could not tell apart from the
     participant.
   - **Why:** background organization must never delay the participant's chat
     with the same model. Measured on qwen3:8b (review scratch `preempt.log`):
     the participant's first token came at 87 ms alone, 3,590 ms behind an
     un-aborted flow call (Ollama serialized them), and 107 ms when the flow
     call was aborted at 300 ms.
   - **In-tab only.** The signal comes from this tab's dispatch. Use of the
     same server from a terminal, an editor or another app is not seen, and
     waits behind at most one flow call.
4. **Timeouts.** An aborted call rethrows without re-probing. The outcome is
   `timeout`: that stage's back-off applies, and the pass ends, because the
   server may be loading or busy.
5. **`prefer`.** `organizeRoute(convoId, …, prefer)` records `prefer` in
   `state.prefer`, even while a mint for that conversation is already running.
   Before picking each next card, the card loop takes the preferred node's
   uncarded subtree first (still post-order inside it).

**`organizeOne` v2** — the order of work per conversation:

1. The pinned `organizing` guard.
2. `held = readRouteFlow(convoId)`.
3. **Shortcut:** when `held && summary && held.upToTurnCount >= summary.turnCount && held.pending === 0`,
   the outcome is `current`, without reading the thread. `pending` counts
   cards whose `cv` is old, so a card version bump never takes the shortcut.
4. Read the records (:1033); `previous = flowMatches ? held : null`; apply the
   behind rule (:1038-1056) with §4.1.8's clamp.
5. The labeller. The drain passes the model it resolved for the pass; the
   attended call resolves its model (§4.1.1). Either way
   `awakeLocalLabeller(model)` runs again immediately before every call.
6. **Stage 1** while the closed exchanges outnumber `exchanges.length`: one
   window per call (§4.1.4), each call through the lane. The structure
   back-off key is `${convoId}|s|${lastSig}`. Then W-structure. Otherwise,
   when closed turns grew inside the last mapped exchange: W-advance.
7. **Stage 2**, post-order (with `prefer` first), for nodes needing a card,
   each through the lane and the budget check. The card back-off key is
   `${convoId}|c|${nodeId}|${cardKey}`. Then W-card (§4.1.6).
8. **Outcomes:** `wrote | current | busy | backoff | unusable | unreadable | gate | fault | yielded | timeout | budget`.

**`drainRouteFlows` v2** — *"ollama visits as many chats as possible"*.

- **Start:** the gate first. Then `listConversations()`: LIVE threads newest
  `lastAt` first, then ARCHIVED newest first. Threads with fewer than two
  turns or no reply are skipped (unchanged, :1180-1185).
- **The pass model** is resolved once, from the stored choice and the live
  conversation ids (§4.1.1), and pinned as `lastPassModel`. No model means
  `stopped: 'gate'`.
- **Between conversations** the main thread is given back
  (`requestIdleCallback`, else `setTimeout`).
- **The budget** — 90 s or 48 calls, whichever comes first — is checked before
  every call. The attended call never counts against the call cap, but still
  uses the lane.
- **Pruning:** at the start of a pass, back-off entries older than
  `ROUTE_FLOW_RETRY_MS` are removed, and the map is capped at 500 entries,
  oldest first.
- **Options:** `{ calls?, budgetMs?, now?, pause? }`. v1's `limit` (a
  conversation cap, :1133) is removed.
- **It returns:**

  ```ts
  export interface RouteFlowDrain {
    readonly organized: number
    readonly behind: number
    readonly stopped?: 'gate' | 'budget' | 'fault' | 'yield' | 'timeout'
    readonly dueIn?: number
    /** Set whenever stopped === 'yield': pausedUntil after the participant's own chat, now + soonMs after an attended call. */
    readonly resumeAt?: number
    /** Always set: how long the pass took, from its first read. */
    readonly elapsedMs: number
  }
  ```

**The schedule** lives in `OrchestratorDrone` beside the blurb drain. It is
never a bee of its own, never agent work, and it reports nothing.
`ROUTE_FLOW_SCHEDULE = { soonMs: 5_000, idleMs: 120_000, wakeMs: 2_000 }` and
the wakes (`llm:policy-changed`, `chat:threads-changed`, `ask:chat-reply`) are
unchanged (orchestrator.drone.ts:135-145). `#flowPass` (:243-261) gains three
branches, each a **rest**:

| The pass stopped on | The next pass is due after |
|---|---|
| `budget` | `max(soonMs, elapsedMs)` — at most a 50% duty cycle: a 90 s pass rests 90 s |
| `yield` | `max(soonMs, resumeAt − now)` |
| `timeout` | `idleMs` |

- **No NaN.** Both formulas are guarded with `Number.isFinite` and fall back to
  `soonMs`, so a drain result missing a field (an older build, a spec mock)
  never schedules `setTimeout(NaN)`.
- **A rest holds against wakes.** After those three outcomes the orchestrator
  keeps `#flowRestUntil = now + next`.
  - `#wakeFlows` (:235-240) never schedules a pass earlier than
    `#flowRestUntil`: a wake during a rest leaves the timer at the rest's end.
    Today a wake pulls any pass due more than 2 s away forward, and opening a
    conversation emits `chat:threads-changed` (chat-window.component.ts:3814),
    so every rest would be cancelled.
  - A wake during a pass (`#flowWoken`) schedules
    `max(min(next, wakeMs), #flowRestUntil − now)`.

Everything else is as before:

- `soonMs` while a conversation is behind;
- `idleMs` when nothing is behind, no model is awake, or the pass faulted;
- `dueIn + 1 s`, clamped to `[soonMs, idleMs]`, when a last exchange is only
  waiting on the clock.

A wake during a pass becomes one pass after it. One pass runs at a time,
always.

**Throughput** (measured, qwen3:8b warm):

- a fresh 16-turn conversation: 9–18 s (3–6 nodes); the fresh 13-exchange
  review conversation: about 8 s of structure plus 24.8 s of cards;
- a 48-turn conversation: 30 s (3 structure windows + 9 cards);
- three more exchanges: 5.6–8.7 s;
- one 90 s pass: about 3–5 fresh conversations or about 12 updates, then a
  90 s rest while the page is open;
- the version bump re-mints every existing conversation once, at about 15–35 s
  each, paced by the duty cycle.

#### 4.1.10 What the measurements did not settle

These are honest limits of the design, not bugs to fix quietly:

- **Cards invent facts** — parents (lens run, 2 of 8) and leaves (review run,
  2 of 5). The `ungrounded` check catches only another step's facts. The pane
  leads with the outcome and the record's branch lines, and nothing marks a
  card as verified.
- **Trees are not reproducible.** Temperature 0 on a GPU produced two
  different trees from identical input (§4.1.2). The provisional window gives
  the newest ≤ 5 assignments a second look with more context; everything older
  is whatever the call that froze it saw, and a version bump re-rolls every
  conversation.
- **Reversals may go uncaptured.** The review run captured 0 of 2 in 5 runs:
  no node was dropped and the reversed choice kept its state.
- **Problems raised together can still become an umbrella**, against the
  prompt's own rule (review run, every run). Code does not split nodes.
- **Re-homing and meta exchanges are unmeasured** (§4.1.4 step 6, §4.1.5).
- **A linear conversation over-branches into a chain** — draft → revise →
  {add a section, save}. This happened with every qwen3 prompt variant. It is
  harmless but noisy. A view-time collapse is a decision for Jaime (§8).
- **A topic switch inside one long thread** can hang the new work under the
  previous goal. Windows bound the context but do not cure the model's habit
  of attaching new work to whatever is listed.
- **Quality follows the participant's model.** `qwen2.5-coder:7b` built
  clearly weaker trees: it lost the reversal, lumped the returns, and invented
  more. Using exactly the participant's model is the constraint, so this is
  accepted.
- **Silent truncation.** The 6,000-character budget keeps a structure call
  inside Ollama's default 4,096-token context. A smaller
  `OLLAMA_CONTEXT_LENGTH`, or another local server, could still cut a prompt
  silently, and no response flag reveals it.
- **Other servers.** `reasoning_effort` and `response_format` are verified on
  Ollama 0.33.1 only; the 400/422 fallback covers a server that rejects them.
- **Pre-emption is in-tab only** (§4.1.9).
- **Also unmeasured:** canonical id aliasing and the rolled-up display state.
- **The web-build seam** (§4.1.9) is fixed by construction but proven only on
  the dev shell. A hypercomb-web build must be checked by signature comparison
  (CLAUDE.md's verification rule) — never by clearing OPFS.
- **The raw experiments stay in session scratch directories**, not in the repo.
  Moving the fixtures and run scripts into a tracked eval is owed (§8).

### 4.2 The tree — layout and connectors

The v1 sidebar was a flat, indented column in record order (`withRouteLines`,
chat-window.component.ts:296-307). A deviation was only an indent with a
detached elbow, so "a couple tasks" beside each other read as a list. v2 draws
an **indented tree with joined pipes on a CSS grid**:

- one card per row, in preorder;
- each branch one fixed indent step to the right of the task it left;
- a trunk running down from a task past all its branches, and an elbow into
  each one;
- the main line straight down column 0.

(Revised 2026-09-11. The first v2 draft spread siblings side by side in 10rem
columns and hid half of a branching tree off-screen at common widths, §9.)

All of it lives in the component as pure module-scope functions:
`layoutRouteTree` and `routePipes` replace `withRouteLines`. It cannot live in
essentials, because folds are the participant's live view state and shared may
not import essentials.

#### 4.2.1 Input

1. **`drawn`** — the flow nodes with at least one covered turn below the
   rendered length, in record order (as chat-window.component.ts:2219-2220).
2. **Effective parent** — walk `node.parent` through the flow's `byId` to the
   nearest drawn ancestor; with none, the node is a root. Parents precede
   children, so one pass suffices.
3. **`depth`** is the number of drawn ancestors (0 = the main line), and
   **`descendants`** is the number of drawn descendants.
4. **`folded`** is `#routeFolds().get(convoId)`. A folded node's children are
   not visited.

#### 4.2.2 Place (preorder)

```ts
const ROUTE_INDENT_REM = 1.75

const order: string[] = []                                       // preorder = DOM order = key order = visual order
const visit = (id: string, depth: number): void => {
  place.set(id, { x: depth, y: order.length, level: depth + 1 }); order.push(id)
  if (folded.has(id)) return
  for (const child of kids.get(id) ?? []) visit(child, depth + 1)   // record order
}
for (const root of roots) visit(root, 0)
const treeRows = order.length
const indents = Math.max(0, ...[...place.values()].map(p => p.x))  // 0–2: the record caps depth at 3
const cols = indents + 1                                            // data-route-cols
// The tail follows at x = 0, y = treeRows + i, level 1: one stage per unorganized exchange,
// then live or wait, then end.
```

**The rules in words.**

- Every card is its own row, in preorder: a task, then its branches (each
  followed by its own branches), then the task's next sibling.
- The **main line** is the roots, top to bottom, in column 0.
- A **branch** sits one indent step (`ROUTE_INDENT_REM`, 1.75rem) to the
  right of the task it left.
- **A card spans from its column to the inline end.** Every card's inline end
  is the canvas's, and a deeper card is narrower by one step. A root spans
  every track, so the main line's width never depends on how many branches
  exist: the first branch appearing re-wraps no title on the main line.
- The same input always gives the same coordinates, so a re-derived flow that
  keeps its ids does not jump.

**The horizontal bound.** Depth ≤ 3 gives at most 2 indent tracks (3.5rem),
and a card never gets narrower than `$card-min` (9rem): at most 12.5rem. The
column's minimum is 12rem, so a depth-3 branch at the narrowest sidebar pans
about half a rem. At every other width there is nothing to pan. *"Side to side
slightly"* is the most it ever is.

**Tree pointers** (for the keys, §4.3.5): `parent` (the effective parent) and
`firstChild` (the first visible child). `setSize` and `posInSet` count visible
siblings; the roots and the tail cards form one level-1 set.

**Folding.**

- **A folded node hides its descendants.** The rows below move up; nothing is
  reserved, because reserved empty space reads as a missing branch.
- **The toggled node is anchored.** `setRouteFold` measures the node's rect
  before the fold, and after the render (`afterNextRender`, or the existing
  `setTimeout(0)` idiom — **never** `requestAnimationFrame`, which a hidden tab
  never serves) scrolls the viewport by the delta.
- **Flow re-derivations** rely on native `overflow-anchor: auto` on the
  viewport. Pipe cells carry `overflow-anchor: none`, so the anchor is always a
  card.

#### 4.2.3 Worked layouts (the verifier's fixtures, §4.7)

**Example A** — exchanges E1 t1 (root), E2 t2 (root), E3 t3 (from t2), E4 t4
(from t3), E5 t5 (from t2), E6 t6 (root):

| node | x | y | level |
|---|---|---|---|
| t1 | 0 | 0 | 1 |
| t2 | 0 | 1 | 1 |
| t3 | 1 | 2 | 2 |
| t4 | 2 | 3 | 3 |
| t5 | 1 | 4 | 2 |
| t6 | 0 | 5 | 1 |

- `cols = 3`, `treeRows = 6`; the tail starts at y = 6.
- Folded t3: t1 (0,0), t2 (0,1), t3 (1,2), t5 (1,3), t6 (0,4).
- Folded t2: t1 (0,0), t2 (0,1), t6 (0,2).

**Example B** — a task with a deep first branch and three more branches.
Exchanges E1 t1 (root), E2 t2 (root), E3 t3 (from t2), E4 t4 (from t3), E5 t5
(from t3), E6 t6 (from t2), E7 t7 (from t2), E8 t8 (from t2), E9 t9 (root):

| node | x | y |
|---|---|---|
| t1 | 0 | 0 |
| t2 | 0 | 1 |
| t3 | 1 | 2 |
| t4 | 2 | 3 |
| t5 | 2 | 4 |
| t6 | 1 | 5 |
| t7 | 1 | 6 |
| t8 | 1 | 7 |
| t9 | 0 | 8 |

- `cols = 3`, `treeRows = 9`.
- Folded t3: t3 (1,2), t6 (1,3), t7 (1,4), t8 (1,5), t9 (0,6).

#### 4.2.4 The connectors — `routePipes`

**Tracks and cells.** The canvas's columns are `indents` tracks of 1.75rem
and one last track of `minmax(9rem, 1fr)`. A card at column x covers tracks x
to the end. A **free cell** is a track left of the row's card.

**Cell anatomy.** This applies to every cell, whether it holds a card or is
free.

- **The junction point J** sits `$pad + $square/2` (1.125rem) from the cell's
  inline start — inside the 1.75rem track — at `y = var(--route-drop)/2`, the
  bus line in the cell's top strip. A card's square starts at
  `y = var(--route-drop)`.
- **Segments:**

  | Segment | Runs |
  |---|---|
  | `n` | from the cell top to J (on a card, to the square's top) |
  | `s` | from J to the cell bottom (on a card, the **stem**: from the square's bottom to the cell bottom) |
  | `w` | from the cell's inline start to J |
  | `e` | from J to the cell's inline end (a free cell's end is where the next track, and the child card, begins) |
  | `d` | cards only: from J down to the square's top; implied whenever a card has `w` but no `n` |

- **Why the joints always meet:** rows are auto-height and every grid item
  stretches, so `n` and `s` always reach the row boundary and meet the
  neighbouring cell's segment. Column and row gaps are 0; spacing is padding
  inside cells. A free cell's `e` ends exactly where the child card's `w`
  starts, because the child's column begins at that track boundary.

```ts
type RouteSide = 'n' | 'e' | 's' | 'w'
type RouteSeg = { readonly side: RouteSide | 'd'; readonly dashed: boolean }
type RoutePipe = { readonly key: string; readonly x: number; readonly y: number; readonly segs: readonly RouteSeg[] }

// mark(x, y, side, dashed): on the card at (x,y), 's' sets its stem and n/w/e set its joint;
// otherwise a free cell (key `p:${x},${y}`). Merge: dashed = previous === undefined ? dashed : previous && dashed  (solid wins)
const connectV = (x, fromY, toY, dashed) => { mark(x, fromY, 's', dashed); for (let y = fromY + 1; y < toY; y++) { mark(x, y, 'n', dashed); mark(x, y, 's', dashed) } mark(x, toY, 'n', dashed) }

for (const parent of order) {                        // every placed node with visible children
  const P = place.get(parent)!
  for (const child of visibleKids(parent)) {
    const C = place.get(child)!, dashed = item(child).dashed
    connectV(P.x, P.y, C.y, dashed)                  // the trunk runs down the parent's column
    mark(P.x, C.y, 'e', dashed)                      // the elbow: C.x === P.x + 1 always
    mark(C.x, C.y, 'w', dashed)
  }
}
const spine = [...roots.map(item), ...tail]          // all at x = 0
for (let i = 1; i < spine.length; i++) connectV(0, spine[i - 1].y, spine[i].y, spine[i].dashed)
// a card whose joint has w and no n gets a 'd' segment (dashed as its w)
```

- **The trunk is always in free cells.** Every row strictly between a parent
  and one of its children holds a descendant of that parent, at a depth
  greater than the parent's, so the parent's column is free there. Likewise
  column 0 is free on every row whose card is a branch.
- **`dashed`** keeps its v1 meaning: every length of pipe after an open
  junction in reading order. On the tail, that is the pipe after a stage whose
  exchange ended on an open question.
- **Solid-wins merging** gives the right picture: the pipe flows up to the
  first card that is not flowing yet.

**Worked pipes, example A** (the tail always ends in `end`,
chat-window.component.ts:2269, so the last root has a stem):

- t1: stem.
- t2: joint `n`, stem.
- `p:0,2` = `n e s`; `p:0,3` = `n s`; `p:0,4` = `n e s`.
- t3: joint `w d`, stem.
- `p:1,3` = `n e`.
- t4: joint `w d`.
- t5: joint `w d`.
- t6: joint `n`, stem.
- The tail's first card: joint `n`.

**Worked pipes, example B:**

- t1: stem.
- t2: joint `n`, stem.
- `p:0,2` = `n e s`; `p:0,3` = `n s`; `p:0,4` = `n s`; `p:0,5` = `n e s`;
  `p:0,6` = `n e s`; `p:0,7` = `n e s`.
- t3: joint `w d`, stem.
- `p:1,3` = `n e s`; `p:1,4` = `n e`.
- t4: joint `w d`; t5: joint `w d`.
- t6: joint `w d`; t7: joint `w d`; t8: joint `w d`.
- t9: joint `n`, stem.
- The tail's first card: joint `n`.

**Why a CSS grid with segment spans** — not SVG, and not pseudo-elements
alone:

- **Text size.** A three-line title or a larger root size grows the row
  track, and every segment in that row stretches with it. SVG would need
  measured card rects, a ResizeObserver and a frame — and a hidden tab gets no
  frame.
- **Hit targets.** Each card is a real, focusable DOM element filling its
  cells. Segments are `pointer-events: none`.
- **Language and theme.** Titles are ordinary text nodes. Segments are
  `currentColor` on `--hc-window-ink-quiet` at the existing 0.55 opacity.
  Everything is authored in logical properties, so a future `dir=rtl` mirrors
  the grid and the pipes together.
- **Testability.** Spans have bounding rects, so the verifier can prove the
  joints meet to 1.5 px; pseudo-elements cannot be measured.
- **Cost.** At most 32 cards plus the tail, about 64 pipe cells and about 200
  spans, recomputed once per signal change.

#### 4.2.5 Styles (chat-route.scss; replaces the indent, elbow and rail rules)

```scss
$square: 1.75rem;           // kept
$indent: 1.75rem;           // one branch step — ROUTE_INDENT_REM
$card-min: 9rem;            // the narrowest a card gets
$pad: 0.25rem;              // cell inline-start padding
$gutter: 0.75rem;           // card inline-end padding
$line: 2px;                 // the existing pipe hairline
$jx: calc(#{$pad} + #{$square} / 2);

.chat-route-canvas {
  display: grid;
  grid-auto-rows: auto;
  box-sizing: border-box;
  inline-size: 100%;
  grid-template-columns: minmax(#{$card-min}, 1fr);                      // cols = 1
  &[data-route-cols="2"] { grid-template-columns: #{$indent} minmax(#{$card-min}, 1fr); }
  &[data-route-cols="3"] { grid-template-columns: #{$indent} #{$indent} minmax(#{$card-min}, 1fr); }
}
// Placement is bound per item: [style.grid-row]="y + 1", and [style.grid-column]="(x + 1) + ' / -1'" on a card
// or "x + 1" on a pipe cell. repeat(0, …) is not valid CSS, hence one rule per column count (the depth cap makes it three).
.chat-panel .chat-thread { position: relative; }                          // the start line, §4.4.3
.chat-route-pipe { position: relative; --route-drop: 1rem; overflow-anchor: none; pointer-events: none; }
.chat-route-item {
  --route-drop: 1rem;
  position: relative;
  display: grid; grid-template-columns: #{$square} minmax(0, 1fr); align-content: start; column-gap: 0.45rem;
  padding-block: var(--route-drop) 0.25rem; padding-inline: #{$pad} #{$gutter};
  color: var(--hc-window-ink-quiet); border-radius: tw.$radius-card; cursor: pointer; outline: none;
  &[data-route-y="0"] { --route-drop: 0rem; }
}
.chat-route-seg, .chat-route-stem { position: absolute; pointer-events: none; opacity: 0.55; border: 0 solid currentColor; }
.chat-route-seg[data-seg="n"], .chat-route-seg[data-seg="s"], .chat-route-seg[data-seg="d"], .chat-route-stem {
  inset-inline-start: $jx; margin-inline-start: calc(#{$line} / -2); border-inline-start-width: $line;
}
.chat-route-seg[data-seg="w"], .chat-route-seg[data-seg="e"] {
  top: calc(var(--route-drop) / 2); margin-block-start: calc(#{$line} / -2); border-block-start-width: $line;
}
.chat-route-seg[data-seg="w"] { inset-inline-start: 0; inline-size: calc(#{$jx} + #{$line} / 2); }
.chat-route-seg[data-seg="e"] { inset-inline-start: calc(#{$jx} - #{$line} / 2); inset-inline-end: 0; }
.chat-route-pipe > .chat-route-seg[data-seg="n"] { top: 0; height: calc(var(--route-drop) / 2 + #{$line} / 2); }
.chat-route-pipe > .chat-route-seg[data-seg="s"] { top: calc(var(--route-drop) / 2 - #{$line} / 2); bottom: 0; }
.chat-route-item > .chat-route-seg[data-seg="n"] { top: 0; height: var(--route-drop); }
.chat-route-item > .chat-route-seg[data-seg="d"] { top: calc(var(--route-drop) / 2 - #{$line} / 2); height: calc(var(--route-drop) / 2 + #{$line} / 2); }
.chat-route-stem { top: calc(var(--route-drop) + #{$square}); bottom: 0; }
.chat-route-seg-dashed { border-style: dashed; }

.chat-route-node .chat-route-caption { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: start; column-gap: 0.3rem; }
.chat-route-node .chat-route-title {
  white-space: normal; overflow: hidden; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3;
}
.chat-route-current { background: var(--hc-window-wash); }
.chat-route-current .chat-route-piece { border-color: var(--hc-window-accent); }
```

The pipe's vertical drop is one value (1rem) for every card, since v1's
tighter 0.5rem drop was for pieces inside an exchange, which are now marks.

**Card content at rest.**

- **The square** (1.75rem, `tw.$radius-card`) wears the state glyph through
  `nodeIcon`:
  - `open` is dashed;
  - `decided` wears the accent;
  - `dropped` is muted, with its title struck.
- **The title** is the model's words (or `chat.route.flow.untitled`), clamped
  to three lines. A card is at least 9rem wide, so an 8-word title fits in
  three lines at 0.74rem. The full title stays in `[attr.title]`, the
  `aria-label` and the pane.
- **The pieces row** (a node's own exchanges, or a dormant stage's one
  exchange):
  - **work:** one mini with the first run's glyph and the total number of
    attempts, dashed with `error` on a leak;
  - **replied** (stages only): one `chat_bubble` mini when the exchange holds a
    reply;
  - **decisions:** ONE `alt_route` mini, with a count when more than one, and
    dashed while any question is open. v1 drew one mini per question, and they
    wrapped.
- **The fold mark:** `expand_more` / `chevron_right`, with `+n` while folded,
  at the end of the title line.

### 4.3 The viewport

#### 4.3.1 Width

The rail is `min(var(--chat-rail-width, clamp(15rem, 22vw, 20rem)), …)`
(chat-window.component.scss:55-58). Message cards cap at `min(92%, 44em)`. The
reading area is what is left once the rail, and any providers console, are
taken out.

| Window | Reading area | Sidebar (v1 default `clamp(14rem, 30%, 22rem)`; since 2026-09-11 `clamp(16rem, 40%, 32rem)`, or the dragged width) | Thread | A depth-3 canvas (12.5rem) pans? |
|---|---|---|---|---|
| 1920 | 100rem | 22rem | 78rem | no |
| 1440 | 70.2rem | 21.1rem | 49rem | no |
| 1280 | 62.4rem | 18.7rem | 43.7rem | no |
| 1024 | 49rem | 14.7rem | 34.3rem | no |
| 760 | 32.5rem | 14rem | 18.5rem | no |
| 701 | 28.8rem | shrinks to 12.55rem (min 12rem) | 16.25rem (v1: 12.8rem, below `CONVERSATION_MIN`) | by about half a rem |

(The pan column counts the nav's own padding.)

`#railBounds` (chat-window.component.ts:3671-3675) computes `room` as the
panel width, minus `CONVERSATION_MIN`, minus 12 × the root font size while
`routeSideShown()`. A dragged-wide rail therefore cannot push the split past
the panel.

**The grip (2026-09-11, un-shelving).** Jaime: *"keep it how it is but draggable,
make it wider."* The default widened to `clamp(16rem, 40%, 32rem)`, and the
column wears a grip on its start edge (`.chat-route-grip`, the rail grip's
twin): dragging it LEFT widens the workflow, double-click or Home hands the
width back to the clamp, ←/→ step it by 12 px (40 with Shift). The dragged
width is written to `--chat-route-side-w` on the split from
`routeSideWidth` (`hc:chat-route-side-width`), bounded by the column's
12rem minimum and the split's width minus `CONVERSATION_MIN`. This reverses
the "no resize grip" decision of the same day. The viewport itself was already
draggable: the pull (§4.3.2) pans the tree when the ground is dragged.

#### 4.3.2 Pull (replaces chat-window.component.ts:2588-2624)

```ts
#routeDrag: { id: number; x: number; y: number; left: number; top: number; pulling: boolean; axis: 'x' | 'y' | 'both' } | null = null
readonly routePulling = signal(false)
onRouteSidePointerDown(e) { if (e.pointerType === 'touch' || e.button !== 0) return; const s = e.currentTarget as HTMLElement
  this.#routeDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: s.scrollLeft, top: s.scrollTop, pulling: false, axis: 'both' }; this.#routePulled = false }
onRouteSidePointerMove(e) { const d = this.#routeDrag; if (!d || d.id !== e.pointerId) return; const s = e.currentTarget as HTMLElement
  const dx = e.clientX - d.x, dy = e.clientY - d.y
  if (!d.pulling) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < ROUTE_PULL_PX) return
    d.pulling = true
    d.axis = Math.abs(dy) >= ROUTE_AXIS_LOCK * Math.abs(dx) ? 'y' : Math.abs(dx) >= ROUTE_AXIS_LOCK * Math.abs(dy) ? 'x' : 'both'
    s.setPointerCapture(e.pointerId); this.routePulling.set(true)
  }
  e.preventDefault()
  if (d.axis !== 'x') s.scrollTop = d.top - dy
  if (d.axis !== 'y') s.scrollLeft = d.left - dx }
onRouteSidePointerUp(e) { /* as v1, plus this.routePulling.set(false) */ }
```

- **The click-versus-pull contract is kept:** the press becomes a pull past
  `ROUTE_PULL_PX` (4), and only then captures the pointer, so a 2 px press is
  still a click on the card it started on. The release that ends a pull
  swallows the click.
- **The axis locks** when one direction is at least `ROUTE_AXIS_LOCK` (2)
  times the other, so a vertical pull does not drift sideways where a narrow
  sidebar can pan.
- **Touch** pans natively (`touch-action: pan-x pan-y`).
- A pull's scrolls are the participant's; `onRouteSideScroll` records them as
  a pan (§4.3.4).

#### 4.3.3 Wheel

```ts
onRouteSideWheel(e: WheelEvent) { const s = e.currentTarget as HTMLElement
  if (!e.shiftKey || e.deltaX !== 0 || e.deltaY === 0 || s.scrollWidth <= s.clientWidth) return   // native already did it
  e.preventDefault(); s.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY }
```

- The vertical wheel and trackpad horizontal scrolling stay native
  (`overflow: auto; overscroll-behavior: contain`).
- The Shift+wheel guard acts only when the platform did not already convert
  the delta, so the viewport never pans twice.

#### 4.3.4 Following the newest, and revealing a card

**Follow.** `#routeFollowing` = at the bottom (≤ `ROUTE_SIDE_BOTTOM_PX`)
**and** at the inline start (`|scrollLeft|` ≤ the same tolerance). It is
recomputed in `onRouteSideScroll` and reflected as `nav[data-route-follow]`.
A new conversation starts following (`#clearRoute`).

**Whose scroll it was.** Every programmatic scroll of the nav — a reveal, a
follow, a fold anchor — records the position it set (`#routeExpect = { top,
left }`). `onRouteSideScroll` treats an event within 1 px of it as
programmatic and clears it; any other scroll is the participant's
(`#routePannedAt = performance.now()`). A scrollbar drag, PageUp/PageDown or a
wheel is therefore a pan too, not only a pull.

**When the tree changes** (in `setTimeout(0)` after the render):

1. If the current step's key changed since the last reveal
   (`#routeRevealedKey`), reveal it.
2. Else, if the current card was fully visible before the change and is not
   now (a fold, or an insertion above it, moved it), reveal it.
   `#routeCurrentVisible` is recomputed in `onRouteSideScroll` and after every
   reveal.
3. Else, while following, scroll to the bottom and back to the start.
4. Otherwise nothing: the viewport stays where the participant put it.

A refresh hint (every 150 ms during a streaming reply, §3.5) that changes
neither the current step nor its position moves nothing. **Why both edges for
follow:** the newest cards live in column 0 at the bottom. A participant who
panned right, or scrolled up to read, must not be yanked back.

**Reveal** — `#revealRoute(el, reason: 'participant' | 'thread')`:

```ts
#revealRoute(el: HTMLElement, reason: 'participant' | 'thread'): void {
  const s = this.routeSide()?.nativeElement; if (!s) return
  if (reason === 'thread' && (this.#routeDrag?.pulling || performance.now() - this.#routePannedAt < ROUTE_PAN_HOLD_MS)) return
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16, m = 0.75 * rem
  const v = s.getBoundingClientRect(), r = el.getBoundingClientRect()
  const near = (lo: number, hi: number, vlo: number, vhi: number): number =>
    hi - lo > vhi - vlo - 2 * m ? lo - vlo - m : lo < vlo + m ? lo - vlo - m : hi > vhi - m ? hi - vhi + m : 0
  const top = near(r.top, r.bottom, v.top, v.bottom), left = near(r.left, r.right, v.left, v.right)
  if (!top && !left) return
  this.#routeExpect = { top: clampTop(s, s.scrollTop + top), left: clampLeft(s, s.scrollLeft + left) }
  s.scrollBy({ top, left, behavior: 'auto' })
  this.#routeRevealedKey = this.routeCurrent()?.key ?? ''
}
```

- **Instant, always.** The tree's own moves are small. A smooth tree scroll
  while the thread may also be moving would be two things animating at once.
- **Scoped.** It never uses `scrollIntoView`, which also scrolls the thread
  and the panel.
- **The pan hold.** A reveal caused by the thread is skipped while a pull is
  in progress, or within `ROUTE_PAN_HOLD_MS` (2000) of any pan by the
  participant. A participant who is panning is never fought.

#### 4.3.5 Keyboard

The WAI-ARIA tree pattern, exactly, on the one roving tab stop (`routeCursor`
/ `isRouteStop`, unchanged):

| Key | On a node | On a tail card |
|---|---|---|
| ↓ / ↑ | next / previous card in DOM order (visible preorder, then the tail) — which is also the visual order | same |
| Home / End | first / last card | same |
| Enter, Space | `selectRouteItem(item, 'press')` — the thread moves; again on the current card walks to its next span (§4.4.4) | same |
| → | collapsed → unfold; expanded → `firstChild`; a leaf → nothing | nothing |
| ← | expanded → fold; otherwise → the parent; a root → nothing | nothing |
| Escape | not handled — the cascade parks the window | — |

- **Why no sibling walk on ←/→:** siblings stack, so ↓/↑ already reaches them
  in the order they are drawn. A ← that walked siblings would fold an
  expanded sibling on the way to the parent, and screen-reader users would get
  a tree that does not behave like one.
- **No native panning:** the arrows, Home, End, Enter and Space call
  `preventDefault` on every card, so a focused card never pans the viewport
  natively. PageUp and PageDown stay native (and count as a pan, §4.3.4).
- **A move** focuses with `preventScroll: true`, then calls
  `#revealRoute(target, 'participant')`.
- **Focusing a card that is not drawn yet** (a branch unfolded a moment ago)
  waits for `afterNextRender` or `setTimeout(0)`, never
  `requestAnimationFrame`. v1's focusKey used rAF (chat-window.component.ts
  :2529), which silently does nothing in a hidden tab.
- **The item re-read** — "the card as the sidebar is now", :2514 — is kept,
  so two quick ← presses do not both read "unfolded".
- **Arrival makes the card current** (§4.4.3). The thread follows after the
  walk rests.

**Keymap hold.** The hive's keymap runs on `window` in the capture phase, so
the column holds `keymap:suppress { reason: 'chat-route' }`:

- held on `focusin` to `.chat-route-col`;
- released on `focusout` when `relatedTarget` is outside the column, and on
  close, park and destroy (:841, :3654);
- it covers the pane's controls as well as the cards.

v1's per-card hold (:2488-2502) is removed.

#### 4.3.6 Roles

- **The tree:** `div.chat-route-canvas[role=tree]`, labelled `chat.route.side`.
- **Every card** is `role=treeitem`, still a div — a `<button>` takes the
  phone's 44 px floor. Each carries:
  - `aria-level`;
  - `aria-setsize` / `aria-posinset` among its visible siblings (roots and tail
    cards form one level-1 set);
  - `aria-expanded` only when it has descendants;
  - `aria-selected` — true on the current step only.
- **The current card** also carries
  `aria-describedby="chat-route-summary-state chat-route-summary-outcome"`: the
  state line and the outcome sentence only. An arrow step reads one line of
  state and one sentence, not the whole pane (up to ~620 characters plus
  branches and work). The rest of the pane is reachable by Tab.
- **Pipes and segments** are `aria-hidden`.
- **Reduced motion, text size, themes:**
  - no transitions on segments or cards, and grid placement changes are
    instant by nature;
  - everything is rem, so the row tracks grow with the titles and the pipes
    stay joined;
  - colours come from ink roles, `--hc-window-wash*`, `--hc-window-accent`
    and `currentColor`.

### 4.4 The summary pane, and finding the spot in the chat

#### 4.4.1 The pane

```html
@if (routeSideShown()) {
  <div class="chat-route-col" (focusin)="onRouteColFocusIn()" (focusout)="onRouteColFocusOut($event)"
       (pointerenter)="routePointerInside = true" (pointerleave)="routePointerInside = false">
    <nav class="chat-route-side" #routeSide data-route-viewport …>  <!-- the tree, §4.2–4.3 -->
    </nav>
    <section class="chat-route-summary" [attr.aria-label]="'chat.route.summary.region' | t"
      [attr.data-route-current]="routeCurrent()?.key ?? ''"
      [attr.data-route-source]="routeCurrent()?.source ?? ''"
      [attr.data-route-summary-state]="routeSummaryState()"
      [attr.data-route-organizer]="route()?.organizerState ?? ''"> … </section>
  </div>
}
```

- **Size:** `.chat-route-summary` is `flex: 0 0 auto; height: clamp(9rem, 45%, 24rem); overflow-y: auto; overscroll-behavior: contain`.
  The nav above it is `flex: 1 1 auto; min-height: 8rem`.
  - **Why 45%:** at 1280×820 the column is about 38rem, so the pane is about
    17rem — about 13 lines at 0.8rem × 1.45, and about 42 characters a line
    at 18.7 − 1.5 = 17.2rem of text width.
  - The head, path and chips take about 3 lines. *Where it stands*, with its
    label and ≤ 180 characters, takes about 6. Three branch lines take 3.
    That fits with no pane scroll (verifier r.1b).
  - At 40%, with goal and done shown first, the outcome started at about
    line 17, below the fold.
- **Frame and type:** `border-top: 1px solid var(--hc-window-edge)`,
  `padding: 0.6rem 0.75rem 0.8rem`, `font-size: 0.8rem`, `line-height: 1.45`.
  The pane scrolls back to the top whenever the current key changes.
- **Colours:**
  - head: `--hc-window-ink-loud`, weight 600, wrapping — never ellipsized;
  - labels, path and meta lines: `ink-quiet`;
  - summary sentences: `ink-plain`, in `var(--hc-read, inherit)`;
  - chips, branch lines and the details summary: `tw.$radius-control`,
    `1px solid var(--hc-window-edge-firm)`; the active chip takes
    `var(--hc-window-wash-strong)` with a `rgba(var(--acc), .55)` border;
  - a failed attempt's outcome: `ink-loud`, weight 600, plus the word
    *failed* — colour never carries it alone.
- **The pane is never live** (`aria-live` nowhere), and never takes focus on
  its own. Tab order: the tree stop, then the pane's controls — the chips,
  the branch lines, the details summary, the open question entry.

#### 4.4.2 What the pane says, by state

`routeSummaryState()` → `data-route-summary-state`:

| State | When |
|---|---|
| `summary` | the current card is a node whose card is current |
| `stale` | a node whose card is flagged stale |
| `summarizing` | a node with no card, while `route.organizing` is `{stage:'card', nodeId}` for it |
| `unusable` | a node with no card, `organizer` set, and its id in `cardBackoff` |
| `pending` | a node with no card and `organizer` set |
| `no-model` | a node with no card and no `organizer` — `data-route-organizer` says why |
| `dormant-organizing` | a stage, while `route.organizing?.stage === 'structure'` |
| `dormant-waiting` | a stage, with `organizer` set |
| `dormant-no-model` | a stage, with no `organizer` |
| `item` | live / wait / end |
| `empty` | nothing is current |

**On a node — the order is the point:**

```
h3.chat-route-summary-head          [state glyph] Full title (or "Untitled step")
p.chat-route-summary-path           Part of Plan the site › Choose pages                  ← a branch only; ancestors root→parent
p#chat-route-summary-state          decided · messages [3–6] [9]                           ← display state + span chips (§4.4.4)
div.chat-route-summary-body
  p#chat-route-summary-outcome      "Where it stands" card.outcome                         ← with no card, this element is the status line
  p.chat-route-summary-newer        3 newer exchanges are not organized yet               ← current came from reading past the flow (§4.4.5)
  p.chat-route-summary-older        "Summary of the first {count} exchanges"               ← stale
  p.chat-route-summary-status       summarizing | pending | unusable | why no model        ← with a card: only while its replacement is due or being written
  ul.chat-route-summary-branches    "Branches" + one line per visible OR folded child:     ← a parent only
                                      [glyph] child title — state
  details.chat-route-summary-more   summary: "Goal and what was done"
    p.chat-route-summary-goal       "Goal" card.goal
    p.chat-route-summary-done       "Done" card.done
p.chat-route-summary-folded         2 steps folded inside                                  ← a folded node (chat.route.flow.hidden)
div.chat-route-summary-decided      "Decided" + li "◆ prompt → answer" | went on without an answer | the open prompt
div.chat-route-summary-work         "Work · 4 attempts · 1 failed" + ol › li.chat-route-summary-attempt[data-outcome]
                                     verb · cell · ok|failed · error text (block, code face)
p.chat-route-summary-by             Organized by qwen3:8b, up to message 12 · This summary by qwen2.5-coder:7b   ← the second part only when card.model differs
```

- **Where it stands comes first.** It is the line the participant most needs.
  The goal and what was done sit behind one native `details`. Its open state is
  remembered per conversation for the window's life (`#routeMoreOpen`, a set
  of conversation ids), so opening it once keeps it open while walking steps.
- **A branch line is one line and pressable** (`div role=button tabindex=0`).
  It selects that child as a press would. If the child sits inside a folded
  branch, the folded ancestors unfold first, and the selection lands after the
  render (`setTimeout(0)`). The branch's own pane then leads with its own
  outcome.
  - **Why not the branch outcomes inline:** three of them (≤ 180 characters
    each) push the parent's own outcome and state below the fold, and text
    shown only on focus is unreachable on touch and changes as Tab moves.
- **Why no model** — the status line on `no-model` and `dormant-no-model`,
  from `organizerState`:

  | `organizerState` | Line |
  |---|---|
  | `off` | `chat.route.summary.local.off` |
  | `unknown` | `chat.route.summary.local.unknown` |
  | `asleep` | `chat.link.local.down` |
  | `blocked` | `chat.link.local.blocked` |
  | `needs-permission` | `chat.link.local.permission` |
  | `empty` | `chat.route.summary.local.empty` |
  | `no-model` | `chat.route.summary.local.choose` |
  | absent (an older essentials build) | no line |

- **Stale versus pending.** A stale card is shown with its older-summary line,
  plus the status line when the model is writing its replacement or is due to.
  A node with no card shows only the status line, in the outcome's place.
- **Every string** goes through interpolation, never `innerHTML`.

**On a dormant stage:**

- the head `[person] not organized yet` (`chat.route.dormant`);
- the exchange's span chips;
- the status line (dormant-waiting, dormant-organizing, or why no model);
- *Replied* (`chat.route.repliedHead`) when the exchange holds a reply;
- the **Decided** list: every question the exchange asked,
  `◆ prompt → answer`, *went on without an answer*, or the open prompt. **The
  open question's entry is pressable**, and does what pressing v1's open
  junction card did (chat-window.component.ts:2423-2432): the thread steers to
  the question and its current option takes focus;
- the **Work** list of every run of the exchange, unfinished runs included,
  with *in progress* / *unfinished* / *placed by time*;
- **never the words of any message.**

These entries keep v1's keys as
`.chat-route-summary-item[data-route-key="w:<runId>|r:<index>|j:<index>|u:<runId>"]`.

**On other kinds:**

- live: the attempts, plus *live*;
- wait: *waiting for the reply*;
- end: its label and hint.

**`empty`:** *"Choose a step, or scroll the conversation, to read where it
stands."*

#### 4.4.3 The current step — one signal, four sources

```ts
readonly routeCurrent = signal<{ readonly key: string; readonly source: 'press' | 'key' | 'span' | 'thread' } | null>(null)
readonly routeSpanAt = signal(0)                  // the active span of the current card
readonly routeSteering = signal(false)           // mirrored to .chat-thread[data-route-steering]
readonly routeNewer = signal(0)                  // exchanges past the flow, when reading past it chose the current step
readonly routeHold = signal(false)               // a press/key/span choice holds until the participant scrolls the thread
readonly routeLitRows = computed(() => new Set(this.routeRowsOf(this.#currentItem())))   // replaces :2306-2309
readonly routeAnchorRow = computed(() => {        // the start line after a steer
  if (!this.routeHold()) return -1
  return spansOf(this.routeRowsOf(this.#currentItem()))[this.routeSpanAt()]?.[0] ?? -1
})
readonly routeAnchorTop = signal<number | null>(null)   // measured after render (below)
selectRouteItem(item: RouteItem, source: 'press' | 'key' | 'span' | 'thread', span?: number): void
```

`spansOf(rows)` returns the maximal runs of consecutive indexes, for example
`[[3,4,5],[9]]`. A node's turns can be non-contiguous, because order is
rational, not chronological.

| Source | Sets current | Moves the thread | Holds |
|---|---|---|---|
| `press` — a click (swallowed after a pull), Enter or Space on a card, a pane branch line | at once | at once | yes |
| `key` — ↑/↓/←/→/Home/End landed focus on a card | at once | after `ROUTE_KEY_SETTLE_MS` (250), if focus is still on that card | yes |
| `span` — a span chip in the pane | at once | at once, to that span | yes |
| `thread` — reverse sync (§4.4.5) | at once | **never** | no |

- **The hold.** A press, key or span choice sets `routeHold`. Only the
  participant scrolling the thread clears it: a thread `scroll` event, while no
  steer runs, at a position the component did not set itself.
  - `#scrollDown`, `scrollToBottom` and `#steerThreadTo` record the position
    they set (`#threadExpect`), as §4.3.4 does for the nav.
  - So streaming chunks that follow the newest never release a hold, while a
    wheel, a scrollbar drag, a touch pan or the scroll keys do. Reverse sync
    runs as the hold clears.
  - **Why:** without it, a press whose rows were already in the reading band
    was undone the moment the pointer left the column — the band often holds
    an earlier step's row too — and on touch at ≥ 701 px after every tap.
- **Tab-in, or programmatic focus,** moves the roving cursor only. It sets
  current only when nothing is current, and never moves the thread.
- **Steering is done imperatively, in the handlers,** never as an effect that
  reacts to `routeCurrent`. That makes the movement structurally one-way:
  handlers steer, and reverse sync only selects. That is why pressing and
  scrolling cannot loop.
- **The thread's lit rows** — `.chat-msg.chat-route-lit`, v1's
  `rgba(var(--acc), .55)` border — are the current card's rows.
- **The start line.** While a hold stands, the first row of the active span is
  marked by a thread-level rule, not by the bubble.
  - It is `div.chat-route-anchor[aria-hidden]`, an absolutely positioned child
    of `.chat-thread`, which takes `position: relative` from chat-route.scss.
  - Its style is `inset-inline: 0`, `block-size: 0` and
    `border-block-start: 1px solid var(--hc-window-accent)`.
  - It sits at the row's `offsetTop` minus half the thread's gap (`0.5em`,
    chat-window.component.scss:1174). An absolutely positioned child takes no
    flex gap and scrolls with the rows.
  - `routeAnchorTop` is measured in `setTimeout(0)` whenever `routeAnchorRow`
    or `rendered()` changes. It is static, with no motion.
  - **Why not on the bubble:** assistant bubbles already wear a 2 px accent
    inline-start border (chat-window.component.scss:1213-1221), so an accent
    inset beside it reads as nothing. User bubbles are end-aligned (:1208-1209),
    so a start bar would sit mid-thread.
- **The open question** is reached from its stage's pane entry (§4.4.2). The
  live run, the wait and the end go to the thread's foot (`scrollToBottom`).

#### 4.4.4 Moving the participant down the chat to the spot

```ts
selectRouteItem(item, source, span?) {
  if (source === 'press' && this.#routePulled) return
  clearTimeout(this.#keySettle)
  if (source !== 'thread') { this.routeCursor.set(item.key); this.routeHold.set(true) }
  const same = this.routeCurrent()?.key === item.key
  this.routeCurrent.set({ key: item.key, source })
  if (source !== 'thread') this.routeNewer.set(0)
  this.#revealRoute(el, source === 'thread' ? 'thread' : 'participant')
  if (source === 'thread') return
  if (source === 'key') { this.#keySettle = setTimeout(() => focusedIs(item) && this.#steerTo(item, 'key'), ROUTE_KEY_SETTLE_MS); return }
  this.#steerTo(item, source, span, same)
}
#steerTo(item, source, span?, same = false) {
  // live / wait / end (row < 0): scrollToBottom, as v1
  const spans = spansOf(this.routeRowsOf(item)); if (!spans.length) return
  const inBand = spans.findIndex(run => run.some(row => this.#rowInBand(row)))
  const at = span ?? (same && source === 'press' ? (this.routeSpanAt() + 1) % spans.length : inBand >= 0 ? inBand : 0)
  this.routeSpanAt.set(at)
  if (span === undefined && !(same && source === 'press') && inBand >= 0) return   // already on screen: do not move
  this.#steerThreadTo(spans[at][0])
}
```

- **Where it lands:** the first row of the active span, with its top 0.75rem
  (`ROUTE_STEER_MARGIN_REM`) below the thread's top. The position is computed
  from rects and set with `scroller.scrollTo({ top, behavior })`.
  `scrollIntoView` (v1, :2438-2439) is not used, because it scrolls every
  scrollable ancestor.
- **When a covered row is already on screen,** meaning in the reading band
  (8%–40% of the thread's height, `ROUTE_BAND`), nothing moves and that span
  becomes the active one.
- **Pressing the current card again** walks to its next span. The pane's span
  chips jump straight to one.

```ts
#steerThreadTo(row: number): void {
  const scroller = this.scroller()?.nativeElement
  const msg = scroller?.querySelector<HTMLElement>(`.chat-msg[data-route-row="${row}"]`)
  if (!scroller || !msg) return
  this.#cancelSteer(false)
  const s = scroller.getBoundingClientRect(), m = msg.getBoundingClientRect()
  const max = scroller.scrollHeight - scroller.clientHeight
  const top = Math.max(0, Math.min(max, scroller.scrollTop + (m.top - s.top) - remPx(ROUTE_STEER_MARGIN_REM)))
  const distance = Math.abs(top - scroller.scrollTop)
  if (distance < 1) return
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches && distance <= scroller.clientHeight * ROUTE_SMOOTH_SCREENS
  if (max - top > NEAR_BOTTOM_PX) this.atBottom.set(false)   // BEFORE the first scroll event: #scrollDown() cannot yank back
  const token = ++this.#steerToken
  this.#steer = { token, smooth, quiet: null, cap: setTimeout(() => this.#endSteer(token), ROUTE_STEER_MAX_MS) }
  this.#threadExpect = top
  this.routeSteering.set(true)
  scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
  this.#armQuiet(token)            // ends it when no scroll event arrives within ROUTE_STEER_QUIET_MS
}
```

- **Smooth only when short.** A steer is smooth only when reduced motion is
  off AND the distance is at most two screens (`ROUTE_SMOOTH_SCREENS`);
  otherwise it is instant. A long smooth flight through a thread is exactly
  the flashy effect this window avoids.
- **Follow-newest cannot pull it back.** `atBottom(false)` is declared before
  the scroll starts. Otherwise the first scroll event of a smooth scroll that
  started at the bottom still reads "at bottom", and a streaming chunk's
  `#scrollDown()` (:4789) would set `scrollTop = scrollHeight` mid-flight.
  After a steer up the thread:
  - arrivals do not move the view, and the pill shows;
  - a steer whose target lies within `NEAR_BOTTOM_PX` of the bottom leaves
    `atBottom` true;
  - `#focusQuestionOnArrival` already requires `atBottom()` (:1945), so it
    stays put.
- **The participant always wins.** While steering, passive listeners on the
  thread scroller cancel the steer (`scrollTo({ top: scroller.scrollTop, behavior: 'auto' })`,
  then `#steer = null`) on `wheel`, `touchstart`, `pointerdown`, or a
  `keydown` of PageUp, PageDown, an arrow, Home, End or Space inside the
  scroller. The scroll that follows is the participant's, so it also clears
  the hold. `#scrollDown(true)` and `scrollToBottom()` (:4800) cancel any steer
  first.
- **The steer ends** on `scrollend`, or after `ROUTE_STEER_QUIET_MS` (160) with
  no scroll event, capped at `ROUTE_STEER_MAX_MS` (1200). `onScroll` re-arms
  the quiet timer while steering, and it no longer clears any detail card
  (:4782-4784 goes). The scroll events of a steer are the component's own
  (`#threadExpect`, and `#steer` is set) and never clear the hold.
- **Timers are `setTimeout`, never rAF.**

#### 4.4.5 Reverse sync — the current step follows your reading

**Built.** A "current state" that ignores what is on screen goes stale the
moment the participant scrolls.

```ts
readonly #readingWatch = effect(() => {
  this.rendered(); const shown = this.routeSideShown(); const scroller = this.scroller()?.nativeElement
  setTimeout(() => {                         // after the rows are in the DOM
    if (!shown || !scroller) { this.#disconnectReading(); return }
    if (!this.#readingObserver || this.#readingObserver.root !== scroller) {
      this.#disconnectReading()
      this.#readingObserver = new IntersectionObserver(entries => {
        for (const e of entries) { const row = Number((e.target as HTMLElement).dataset['routeRow']); e.isIntersecting ? this.#reading.add(row) : this.#reading.delete(row) }
        this.#scheduleReading()
      }, { root: scroller, rootMargin: '-8% 0px -60% 0px', threshold: 0 })
    }
    for (const el of scroller.querySelectorAll('.chat-msg[data-route-row]')) if (!this.#observed.has(el)) { this.#observed.add(el); this.#readingObserver.observe(el) }
  }, 0)
})

#disconnectReading(): void {
  this.#readingObserver?.disconnect(); this.#readingObserver = null
  this.#observed = new WeakSet(); this.#reading.clear()
}

#applyReading(): void {
  if (!this.routeSideShown() || this.peeking() || this.#steer || this.#routeDrag?.pulling || this.routeHold()) return
  if (this.routePointerInside) return
  const rows = this.rendered(); if (!rows.length) return
  const current = this.routeCurrent()
  if (current && this.routeRowsOf(this.#itemByKey(current.key)).some(row => this.#reading.has(row))) return   // still being read
  const anchor = this.atBottom() ? rows[rows.length - 1]!.index : this.#reading.size ? Math.min(...this.#reading) : null
  if (anchor === null) return                                  // a gap between cards: keep what is current
  const { key, newer } = routeKeyForRow(this.route()?.flow, this.routeItems(), rows, anchor)
  this.routeNewer.set(newer)
  if (!key || key === current?.key) return
  this.selectRouteItem(this.#itemByKey(key), 'thread')
  this.routeSpanAt.set(Math.max(0, spansOf(this.routeRowsOf(this.#itemByKey(key))).findIndex(run => run.includes(anchor))))
}
```

**When it runs.** `#scheduleReading()` applies after a trailing
`ROUTE_SYNC_MS` (120) `setTimeout`, after IntersectionObserver entries. It is
also called:

- when `atBottom` flips in `onScroll`;
- when the hold clears.

It is **not** called on leaving the column. The first v2 draft applied on
`pointerleave` and `focusout`, which flipped a press back to an earlier step
the moment the pointer left.

**Why the pointer pauses it and focus does not.** A wheel over the column
scrolls the nav, not the thread, so while the pointer is inside the column the
thread only moves by itself (streaming, a steer) and the pane should stay
still. Focus is different: pressing a card leaves focus on it. If focus had
paused reverse sync, a participant who pressed and then scrolled the thread
would never see the current step follow.

**`routeKeyForRow`** is pure, at module scope in the component file, and
returns `{ key, newer }`:

1. **Inside the flow** (`anchor < flow.upToTurnCount`): the node owning the
   anchor's exchange, with `newer = 0`. The assignment gives exactly one owner,
   so v1's "deepest covering node" tie-break is gone. A folded node maps to its
   nearest visible ancestor, and the fold stays as it is.
2. **Past the flow, with a flow:** the **newest organized step**. That is the
   owner of the last mapped exchange (`flow` node owning exchange
   `exchanges.length`), mapped to its nearest visible ancestor. `newer` is the
   number of exchanges that start at or after `upToTurnCount`, and the pane
   shows it (`chat.route.summary.newer`).
   - A dormant stage becomes current only by press or key.
   - **Why:** the last exchange stays unorganized until 90 s after the thread
     goes quiet (§4.1.8). While the participant chats at the bottom, selecting
     that stage would put *not organized yet* in the pane nearly the whole
     time.
3. **No flow:** the stage `s:<the exchange start ≤ anchor>`, with
   `newer = 0`. With none, it returns a null key and nothing changes.

**What it never does, and why:**

- **It never moves the thread.** Pressing and scrolling cannot loop.
- **It pauses while a steer runs, while a pull is in progress, while the
  pointer is inside the column, and while a press, key or span choice holds.**
- **Its tree reveal** is instant, minimal, and respects the pan hold (§4.3.4).
- **It sets the roving cursor**, so the next Tab-in lands on the step being
  read.

**Resetting.** `#clearRoute` (:2688-2696) resets `routeCurrent`,
`routeSpanAt`, `routeNewer`, `routeHold` and the steer, and
**disconnects the reading observer** (`#disconnectReading`).

- **Why:** rows are tracked by position (`${index}:${turn.role}`,
  chat-window.component.ts:1877; `track entry.key`, html :545), and
  `#clearRoute` runs right after the new conversation's turns are set
  (:3806-3810). Switching conversations therefore reuses the same `.chat-msg`
  elements.
- An IntersectionObserver reports only changes, so rows already inside the
  band would never be re-added, and reverse sync would select nothing.
- A fresh observer delivers each row's current state on `observe()`.

#### 4.4.6 The hover card and the piece cards are retired

**Deleted:**

- `RouteDetail` (chat-window.component.ts:309-315), `routeDetail`,
  `#placeRouteDetail`, `onRouteItemEnter` / `onRouteItemLeave`, and
  `#routeKeyScrollAt` / `ROUTE_KEY_SCROLL_MS`;
- the card re-placement in `setRouteFold` (:2282-2286) and in
  `onRouteSideScroll` (:2578-2580);
- the `routeDetail.set(null)` calls (:841, :2500, :2692, :3654, :4784);
- `routePicked`, replaced by `routeCurrent`;
- `activateRouteItem` (:2418-2440), replaced by `selectRouteItem`;
- the card template (html :960 onwards);
- the tail's per-piece cards (`w:`, `r:`, `j:`, `u:` in the tree,
  :2251-2263), which become pane entries of their stage.

**Kept and moved:**

- The `.chat-route-card*` list styles are renamed to `.chat-route-summary*`.
- Cards gain `[attr.title]` with the full node title, for a pointer user
  reading a clamped title.

**Why.** With a pane there are two surfaces saying the same thing. The card
needed rect math, re-placement after folds and arrow keys, and dismissal on two
scrollers. It also covered the very messages the steer had just brought into
view.

#### 4.4.7 Constants (component)

- **New:** `ROUTE_INDENT_REM = 1.75` · `ROUTE_CARD_MIN_REM = 9` ·
  `ROUTE_AXIS_LOCK = 2` · `ROUTE_PAN_HOLD_MS = 2000` ·
  `ROUTE_STEER_MARGIN_REM = 0.75` · `ROUTE_SMOOTH_SCREENS = 2` ·
  `ROUTE_STEER_QUIET_MS = 160` · `ROUTE_STEER_MAX_MS = 1200` ·
  `ROUTE_KEY_SETTLE_MS = 250` · `ROUTE_SYNC_MS = 120` ·
  `ROUTE_BAND = { top: 0.08, bottom: 0.40 }` · `ROUTE_SUMMARY_ASK_MS = 700`
  (a node whose card is missing or stale, once it has been current this long,
  is passed as `prefer`).
- **Kept:** `ROUTE_PULL_PX = 4`, `ROUTE_SIDE_BOTTOM_PX = 8` (now also the
  start-edge tolerance), `ROUTE_KEYS_REASON = 'chat-route'`.
- **Removed:** `ROUTE_KEY_SCROLL_MS`.

### 4.5 i18n

New keys, inserted after `chat.route.end.openHint` (en.json:1933) in all 14
catalogs (ar de en es fr hi id it ja ko pt ru tr zh). The insertions must be
targeted, because other sessions hold uncommitted edits in every catalog. The
`chat-keys-parity.spec.ts` ratchet fails the suite if a catalog misses one.
English — 30 keys:

```json
"chat.route.flow.untitled": "Untitled step",
"chat.route.summary.region": "Current step",
"chat.route.summary.empty": "Choose a step, or scroll the conversation, to read where it stands.",
"chat.route.summary.partOf": "Part of {path}",
"chat.route.summary.goto": "Show messages {range} in the conversation",
"chat.route.summary.outcome": "Where it stands",
"chat.route.summary.more": "Goal and what was done",
"chat.route.summary.goal": "Goal",
"chat.route.summary.done": "Done",
"chat.route.summary.branches": "Branches",
"chat.route.summary.newer.one": "{count} newer exchange is not organized yet",
"chat.route.summary.newer.other": "{count} newer exchanges are not organized yet",
"chat.route.summary.older.one": "Summary of the first {count} exchange",
"chat.route.summary.older.other": "Summary of the first {count} exchanges",
"chat.route.summary.pending": "{model} will summarize this step.",
"chat.route.summary.summarizing": "{model} is summarizing this step…",
"chat.route.summary.unusable": "Your local model could not summarize this step. It will try again later.",
"chat.route.summary.dormant.waiting": "Not organized yet. {model} organizes an exchange once it has gone quiet.",
"chat.route.summary.dormant.organizing": "{model} is organizing this conversation…",
"chat.route.summary.local.off": "No summary yet. Your local model is switched off, and nothing is sent anywhere else.",
"chat.route.summary.local.unknown": "No summary yet. Your local model has not been heard from, and nothing is sent anywhere else.",
"chat.route.summary.local.empty": "No summary yet. Your local model server has no model installed.",
"chat.route.summary.local.choose": "Chat with your local model once, and that model will organize your conversations.",
"chat.route.summary.decided": "Decided",
"chat.route.summary.work.one": "Work · {count} attempt",
"chat.route.summary.work.other": "Work · {count} attempts",
"chat.route.summary.leaks.one": "{count} failed",
"chat.route.summary.leaks.other": "{count} failed",
"chat.route.summary.by": "Organized by {model}, up to message {count}",
"chat.route.summary.cardBy": "This summary by {model}"
```

**Keys:**

- **Reused:**
  - `chat.route.side`, `chat.route.dormant`;
  - `chat.route.flow.state.*`, `chat.route.flow.node`,
    `chat.route.flow.turns`, `chat.route.flow.hidden.*`,
    `chat.route.flow.fold`;
  - `chat.route.leak`, `chat.route.failed` / `ok`,
    `chat.route.superseded`, `chat.route.taken`, `chat.route.junction`,
    `chat.route.repliedHead`;
  - `chat.route.live` / `inProgress` / `unfinished` / `placedByTime`,
    `chat.route.waiting`, `chat.route.end.*`;
  - `chat.link.local.down`, `chat.link.local.blocked`,
    `chat.link.local.permission` (en.json:1869-1871) for the probe states the
    shell already names.
- **Removed:** none — the retired card's keys all live on in the pane.
- **The model's name is interpolated,** never translated.

### 4.6 DOM contract (for verifiers)

- **Split:** `.chat-route-split` › `.chat-threadwrap` + `.chat-route-col`.
- **Column:** `.chat-route-col` › `nav.chat-route-side[data-route-viewport][data-route-follow="true|false"]`
  (`.chat-route-pulling` while pulling) + `section.chat-route-summary`.
  Pan offsets are the nav's `scrollLeft` / `scrollTop`.
- **Tree:** `.chat-route-canvas[role=tree][data-route-cols="1|2|3"][data-route-rows]`
  (`cols` = indent tracks + 1).
- **Card:** `.chat-route-item[role=treeitem]` with:
  - `[data-route-kind][data-route-key][data-route-row][data-route-x][data-route-y][data-route-joint]`;
  - `[aria-level][aria-setsize][aria-posinset][aria-selected]`;
  - inline `grid-row` and `grid-column: x+1 / -1`.

  `data-route-row` stays the THREAD row; `data-route-x` / `data-route-y` are
  the 0-based depth column and grid row. Kinds are
  `node | stage | live | wait | end`. Keys are `n:<nodeId>` (`t1`, `t2`, …),
  `s:<index>`, `live`, `wait`, `end`. The current card adds
  `.chat-route-current` and
  `aria-describedby="chat-route-summary-state chat-route-summary-outcome"`.
- **Node extras:**
  - `[data-route-node]` (its id), `[data-route-parent]` (absent at the top),
    `[data-route-depth]` (1–3), `[data-route-state]` (the display state),
    `[data-route-turns]` (comma-joined), `[data-route-card="current|stale|none"]`,
    `[aria-expanded]`;
  - `.chat-route-node`, `.chat-route-branch` (depth > 1),
    `.chat-route-collapsed`, `.chat-route-state-<state>`;
  - title `.chat-route-title`; the fold mark `.chat-route-fold`; the folded
    count `.chat-route-hidden`;
  - square `.chat-route-piece`; caption `.chat-route-caption`.
- **Pieces row** (nodes and stages): `.chat-route-node-pieces` ›
  `.chat-route-mini[data-route-mini=work|reply|junction]`.
- **Segments:**
  - `.chat-route-seg[data-seg=n|e|w|d]` and `.chat-route-stem` inside cards;
  - `.chat-route-pipe[data-route-x][data-route-y][data-route-pipe="<subset of n e s w>"]` ›
    `.chat-route-seg[data-seg]`;
  - `.chat-route-seg-dashed`.
- **Tail modifiers:** `.chat-route-dormant`, `.chat-route-leak`,
  `.chat-route-junction-open`, `.chat-route-progress`, `.chat-route-dashed`,
  `.chat-route-end-open`.
- **Pane:** `section.chat-route-summary[data-route-current][data-route-source][data-route-summary-state][data-route-organizer]` holding:
  - `h3.chat-route-summary-head`, `.chat-route-summary-path`,
    `p#chat-route-summary-state.chat-route-summary-state`;
  - `.chat-route-summary-spans` › `.chat-route-span[data-route-span][data-route-rows]`
    (`.chat-route-span-at` on the active one, `aria-current="true"`);
  - `.chat-route-summary-body` › `#chat-route-summary-outcome` (the
    `.chat-route-summary-outcome` paragraph, or the `.chat-route-summary-status`
    line in its place when there is no card), `.chat-route-summary-newer`,
    `.chat-route-summary-older`, `.chat-route-summary-status`,
    `.chat-route-summary-branches` › `.chat-route-summary-branch[data-route-node][data-route-state]`,
    `details.chat-route-summary-more` › `.chat-route-summary-goal`,
    `.chat-route-summary-done`;
  - `.chat-route-summary-folded`;
  - `.chat-route-summary-decided li` (the open question's entry
    `[role=button]`);
  - `.chat-route-summary-work li.chat-route-summary-attempt[data-outcome=ok|failed]`;
  - `.chat-route-summary-item[data-route-key]` for the stage's work, reply,
    junction and unfinished entries;
  - `.chat-route-summary-by` (› `.chat-route-summary-card-by` when the card's
    model differs).
- **Thread:** `.chat-thread[data-route-steering]` (present while steering),
  `.chat-msg[data-route-row]`, `.chat-route-lit`, and
  `div.chat-route-anchor[aria-hidden]` inside `.chat-thread` while a hold
  stands.
- **Removed:** `.chat-route-items`, `.chat-route-rail`, `--route-depth`,
  `--route-level`, `--route-cols`, `.chat-route-card[role=tooltip]`,
  `role="button"` on cards, `id="chat-route-summary-body"`, the tree kinds
  `work | reply | junction | unfinished`, and `.chat-route-anchor` as a class
  on a message.

### 4.7 Test plan

**Existing specs that pin v1 API — rewrite or delete them** (vitest fails
otherwise):

- `chat-route.spec.ts` imports (:60-75): `parseRouteFlow`, `routeFlowPrompt`
  and `validateFlowNodes` are removed from chat-route.ts and leave the import
  list. `ROUTE_FLOW_SYSTEM` is removed too.
- `describe('extracting and repairing a flow')` (:761): the
  `extractRouteFlow` cases stay. The `parseRouteFlow` / `validateFlowNodes`
  cases are rewritten against `buildFlowTree` and `parseFlowRecord` v2; the
  node cleaners those functions used survive inside `parseFlowRecord`.
- `describe('what the model is given')` (:890): rewritten against the prompt
  builders `routeFlowStructurePrompt` and `routeFlowCardPrompt`.
- The gate case's `toEqual({ organized: 0, behind: 0, stopped: 'gate' })`
  (:1129) becomes `toMatchObject`, because `elapsedMs` is always returned.
- The drain's `limit` cases (:1449-1475) move to the call budget (`calls`).
- `describe('organizing a conversation …')` (:1114): the stub server answers
  by request shape (structure schema vs. card system text), and the setup
  seeds `hc:llm:local:model` so a model resolves.
- `orchestrator.spec.ts`: the budget case (:334-342) feeds `elapsedMs` and
  expects `max(soonMs, elapsedMs)`; every mocked drain result carries
  `elapsedMs`.

**`hypercomb-essentials/src/assistant/chat-route.spec.ts`** — new cases:

- **`buildFlowTree`:**
  - reuse and return keep ids;
  - a detour and a part parent correctly;
  - a reversal marks its target dropped, and a drop of self or an ancestor is
    ignored;
  - depth 4 re-hangs;
  - a missing entry continues the previous task;
  - a model id `t7` seen first becomes canonical `t1`, and an alias is re-used
    within a window;
  - node 33 folds into the previous task;
  - an untitled E1 gets an empty title;
  - settled assignments never change;
  - fewer than half the entries is unusable;
  - node order is preorder;
  - the rolled-up display state.
- **The window:**
  - a call re-maps only `E{settled+1}…`, and `settled` becomes `upto − 5`
    (`upto` at exchange 400);
  - no call is made when nothing new is closed;
  - a released node that is not issued again is removed, and `next` counts
    only seeded ids;
  - a window shrunk by the input budget freezes its oldest provisional
    exchanges first.
- **Re-home:**
  - the review conversation's E11 ("Write a test for the fold anchoring from
    earlier.", which the model assigned to the rename node) re-homes to the
    node whose covered text says "fold a branch";
  - no re-home when two nodes tie, when `P` has fewer than 2 words, or when
    the tested node or one of its ancestors overlaps.
- **The exchange block:**
  - a fenced code block becomes `[code]`;
  - a 900-character reply clips to 120 + 240;
  - three replies render first, `(+1 more replies)`, last;
  - eight attempts render six and `+2 more`.
- **The input budget:** a 32-node, 10-exchange update renders ≤ 6,000
  characters by shrinking `upto`; a single over-budget exchange cuts its
  replies to 120 + 120.
- **`checkFlowTitle`:**
  - rejects `Fix the issue`, `Handle the user request`,
    `Discuss next steps`, `Assign plots fairly: waitlist or lottery?`, a
    9-word title, `Tune the hyperdrive` (ungrounded), and a child's exact
    title;
  - accepts `Add the contact section` (with the participant having said
    "add the contact section now") and `Fix croissants tile image`;
  - casing keeps Fraunces/Inter/Crumb, lowercases Waitlist, and turns
    "Fix Ollama host Shadowing" into "Fix Ollama host shadowing";
  - hysteresis keeps a title below 2× exchanges and retitles at 2×.
- **`checkFlowSummary`:**
  - sentence clipping, a role word, a meta word, repeated parts,
    copies-a-branch at Jaccard 0.71 versus 0.69;
  - `ungrounded-outcome` for a word found only in an unrelated node's text;
    no rejection for a word from a child's outcome or from the node's own
    messages.
- **Meta exchanges:**
  - "Where are we overall?" whose reply names two other nodes' words is left
    out of MESSAGES and stays in the node's turns and key;
  - "still broken" whose reply is about its own node stays in;
  - a node of only meta exchanges keeps them.
- **`cardKey`:** stable for equal inputs; changes with the state, a turn sig,
  an attempt outcome, a decision, or a child key; independent of the model.
- **`parseFlowRecord` v2:**
  - a v1 record reads as absent;
  - a bad card removes the card only;
  - a card with `cv: 0` reads `stale` and counts in `pending`;
  - `pending` is recomputed and `stale` survives;
  - an invalid `settled` reads `max(0, n − 5)`;
  - the turn derivation puts turns before the first user turn in E1;
  - `readRoute` shows no flow when the exchange count does not match.
- **Card carry:** the same id with the same first exchange keeps its card; a
  re-issued id with a different first exchange does not; a matching key is
  taken across ids.
- **The behind rule:**
  - a second assistant turn inside the last mapped exchange, then 90 s idle,
    gives one W-advance with no fetch, then `current`, with the last node's
    card stale;
  - a conversation of 401 exchanges whose flow holds 400 is not behind.
- **Writes** (fake store):
  - the structure write precedes card calls;
  - attended writes once per card, passive once per conversation;
  - exactly one `putPoolDoc(pool, _, convoId)` per write, W-advance included;
  - the record is validated before any bytes;
  - no write on unusable, yield or timeout;
  - `chat:route-flow-organizing` is emitted around every call.
- **`participantLocalModel`:**
  - the stored choice wins;
  - a stored choice of another provider, or not installed, is ignored;
  - `fallback` is used only when installed;
  - a conversation's remembered local id or alias resolves;
  - `opus`, `auto` and an uninstalled id are ignored;
  - the conversation order is honoured;
  - it returns null with nothing to go on — `modelForTier` is never consulted
    (spy).
- **`awakeLocalLabeller` and `localOrganizerState`:**
  - the call carries `providerId` + `model` set last, plus `thinking: false`,
    `jsonSchema` and `temperature`;
  - once the model is in `plainLocalModels`, the body carries none of the
    three;
  - an uninstalled model gives null without re-resolving;
  - no probe function is called (the existing spies pattern,
    `describe('organizing a conversation — only the machine-local model, never a knock')`);
  - `readRoute`'s `organizerState` never probes, and reports each
    `LocalServerState`, `off` and `no-model`.
- **One state across module copies:**
  - `vi.resetModules()` and a second dynamic import of chat-route.ts give two
    copies that share one `organizing` guard, one lane and one `pausedUntil`;
  - the same holds for local-liveness.ts: a report set through one copy reads
    `awake` through the other.
- **The lane:**
  - an `interactive` `llm:local-used` aborts the call in flight and pauses
    30 s;
  - a plain `callModel` emit (the blurb drain's) does not;
  - a replayed old event is ignored;
  - an attended call aborts a passive call in flight and runs next;
  - an attended call is refused while `waiting`;
  - an attended call during the pause resolves 0 with no fetch, no read and no
    `chat:route-flow-organizing`;
  - `prefer` cards first;
  - a timeout backs off without re-probing.
- **The fallback:** a 400 naming `reasoning_effort` retries once; the retried
  body has no `reasoning_effort`, `response_format` or `temperature`, and the
  model is remembered.
- **The drain:**
  - the pass model is resolved once;
  - the 48-call and 90 s budget;
  - `stopped: 'yield'` always carries `resumeAt` (`pausedUntil` after the
    participant's chat, `now + soonMs` after an attended call);
  - `elapsedMs` is always set;
  - the back-off map is pruned to 500.

**Provider specs** (`llm-routing.spec.ts`, `providers/openai-shape.spec.ts`
or `provider-spec.spec.ts`, extended):

- The local `toRequest` body carries `reasoning_effort: 'none'`,
  `response_format` and `temperature` only when set, and is byte-identical
  when they are unset.
- The openai / xai / deepseek / mistral bodies are unchanged when a call sets
  the new fields.
- `buildRequest` passes them through.
- `callModel` emits `{ providerId, at }` without `interactive`.
- The routed stream emits `interactive: true`, and writes
  `hc:llm:local:model` after an OK response — never after a failed send, and
  never for a keyed provider.

**`providers/local-liveness.spec.ts`** (extended): the pinned report map, as
in "one state across module copies" above.

**`orchestrator.spec.ts`** (`describe('the route-flow schedule')`, extended):

- `budget` with `elapsedMs: 90_000` makes the next gap 90 s;
- `yield` waits until `resumeAt`; a `yield` without `resumeAt` waits `soonMs`;
  no gap is ever NaN;
- `timeout` gives `idleMs`;
- a `chat:threads-changed` wake during a budget rest does not shorten it;
- a wake during a pass that ends in a rest waits out the rest.

**`hypercomb-shared/i18n/chat-keys-parity.spec.ts`** is unchanged: it proves
the 14 catalogs carry all 30 new keys.

**`scripts/verify-chat-route.cjs`**, owned by the verifier session and run only
on the isolated stack (4251 dev server + 2411 broker, never 4250/2401):

- **The stub machine-local provider** answers by request body:
  - a body with `response_format.json_schema.schema.properties.exchanges`
    gets a v2 structure answer — examples A and B of §4.2.3 as exchange
    assignments;
  - a body whose system text starts
    `You write the card for ONE task` gets a card built from the node's
    working name.
  - The run seeds `hc:llm:local:model` with the stub's model first.
- **`side()`** reads `x`, `y`, `joint`, `level`, `selected` and `card` instead
  of `rails`.
- **h** (pull): kept, plus an axis-lock drag at 701×800 where a depth-3 canvas
  pans (dx = 6, dy = 96 changes `scrollTop` by ≥ 40 and `scrollLeft` by < 1).
- **n** (no model):
  - every stage is dormant;
  - the pane on a pressed stage reads `dormant-no-model`, carries
    `data-route-organizer`, and contains no turn text;
  - no request goes to port 11434;
  - no `.chat-route-card` exists.
  - **n.2:** an awake stub with no stored choice and no remembered local model
    gives `data-route-organizer="no-model"`, the `local.choose` line, and no
    request.
- **o** (the stub flow):
  - the example A coordinates, pipes and joints, stems and the tail's `n`
    included;
  - folding t2 leaves t6 at (0,2);
  - the fold and walk keys;
  - the v2 record in the slot (`exchanges`, `settled`, cards with `cv`,
    `model`);
  - one file per conversation after re-derivation;
  - a reload with no model still shows the flow and every card;
  - the drain orders live before archived;
  - `prefer` cards the selected node first.
- **p** (the real local model, when one answers):
  - one real local chat send first, so `hc:llm:local:model` is written by the
    stream path;
  - the flow request body carries `reasoning_effort: "none"` and names exactly
    that model;
  - no request goes to any host but 127.0.0.1:11434;
  - **structural assertions only**, because trees are not reproducible
    (§4.1.10): a valid v2 record, at least one node, and every node carded or
    in back-off within 120 s.
- **q** — the tree, example B:
  1. every node's `data-route-x` / `data-route-y` equals the table, with
     `data-route-cols=3` and `data-route-rows ≥ 9`;
  2. the pipes and joints equal the worked pipes;
  3. a geometry audit (n/s/d centres on the column's square centre, w/e on the
     bus y, card joints meeting the square, a free cell's `e` meeting the child
     card's `w`, adjacent segments touching, all ±1.5 px), repeated at
     `html{font-size:20px}` and in the dark and light themes;
  4. ↓ visits the nodes in preorder and then the tail, each card's rect top
     below the previous one (visual order);
  5. the keys:
     - → on the expanded t3 goes to t4; ← on t4 goes to t3;
     - ← on the expanded t3 folds it: the re-flow matches the folded table,
       and t3's rect is unchanged ±1 px;
     - ← on the folded t3 goes to t2; → on the folded t3 unfolds it;
     - ← on t6 goes to t2 and folds nothing;
     - → on the leaf t1, and ← on the root t1, change nothing;
  6. with rAF stubbed never to fire, a fold followed by → still moves focus;
  7. panning:
     - at 1280×820 the nav's `scrollWidth` equals its `clientWidth` (nothing
       to pan) and every card's inline end is inside the nav;
     - at 701×800, a drag of dx = −40 raises `scrollLeft` by ≥ 1 and at most
       the overflow;
     - `wheel(80, 0)` pans horizontally where there is overflow;
     - Shift + `wheel(0, 80)` pans horizontally once, not twice;
  8. a reveal on ↑ to t8 brings it fully inside the nav without moving the
     thread;
  9. following and holding still:
     - at the bottom and start, an appended exchange keeps
       `data-route-follow=true`;
     - panned 40 px up, five `chat:route-flow-changed` hints over 3 s leave
       `scrollTop` unchanged;
     - a scrollbar-style scripted scroll counts as a pan;
     - a fold above the current card keeps that card in view;
  10. widths:
      - at 1280×820 the column is 18–19.5rem;
      - at 760×800 the column is ≥ 12rem and the thread ≥ 260 px;
      - at 640×800 there is no column;
      - a root card's width is equal ±1 px before and after the first branch
        appears;
  11. ARIA: `role=tree` / `treeitem`, `aria-level`, `aria-posinset` within
      `aria-setsize`, exactly one `aria-selected=true` after a press, and
      `aria-describedby` resolving to the state line and the outcome only;
  12. the contrast walk includes `.chat-route-title` and the pane text, in
      honey, light, sherbet and dark, with 0 under target.
- **r** — the pane and finding the spot, on a 24-turn multi-paragraph
  conversation. The stub nodes: `t2` with a card over turns 3–6; its branch
  `t3` over 5–6; `t5` over the non-contiguous 1–2 and 9–10; `t6` with no
  card; turns ≥ 18 past `upToTurnCount`.
  1. **Stability:** the pane's height and the nav's `clientHeight` are equal
     (±1 px) across three selections.
     - **1b.** At 1280×820, `#chat-route-summary-outcome` lies inside the
       pane's client rect with the pane at `scrollTop` 0, for a leaf and for a
       parent with three branches.
  2. **A press on t2:**
     - `data-route-current="n:t2"`, `source=press`, state `summary`;
     - the outcome text equals the stub card's, and `details` is closed;
     - opening `details` shows the stub's goal and done, and it stays open
       after pressing t3;
     - the chip reads `4–7`;
     - the card has `aria-selected` and `aria-describedby`.
  3. **After `[data-route-steering]` clears:**
     - the first covered message sits 0.75rem ±3 px below the thread's top;
     - exactly the covered rows are lit;
     - `.chat-route-anchor` sits within ±2 px of that message's top minus half
       the gap, and spans ≥ 90% of the thread's client width;
     - the pill is visible.
  4. **Spans on t5:** the first press lands on span 0, a second press on
     span 1, and chip 0 returns.
  5. **Already on screen:** a press whose covered row is in the band leaves
     `scrollTop` unchanged.
  6. **Instant steers:** under reduced motion, and for a target more than two
     screens away, `scrollTop` is final within 40 ms.
  7. **The participant wins:** a wheel 60 ms into a smooth steer ends it, the
     view stays where the wheel left it, the hold clears, and then
     `source=thread`.
  8. **Follow-newest does not yank back, and holds:**
     - after pressing t2 up the thread, an appended assistant turn leaves
       `scrollTop` unchanged, and current stays `n:t2`;
     - the pill returns to the bottom; the current becomes the newest
       organized node with `source=thread`, and `.chat-route-summary-newer`
       shows the count.
  9. **Reverse sync:** a wheel scroll that puts row 5 in the band makes
     `n:t3` current within 600 ms, with the thread unmoved by the sidebar and
     t3 revealed in the nav.
  10. **Holds:**
      - press t3 while a t2 row is also in the band, move the pointer onto the
        thread: current stays `n:t3` for 1 s, and the same after a touch tap;
        a wheel on the thread then releases it;
      - with the pointer inside the column, a scripted thread scroll leaves
        current unchanged, and leaving the column changes nothing until the
        next thread scroll;
      - with focus left on a pressed card and the pointer on the thread, a
        wheel on the thread lets the current follow.
  11. **Keyboard:** ArrowDown sets current at once with `source=key`; the
      thread is unmoved at 120 ms and moved by 700 ms; Tab-in never moves the
      thread; `keymap:suppress {reason:'chat-route'}` is emitted once while
      focus is anywhere in the column (pane controls included) and released on
      leaving.
  12. **Folded:** with t2 folded, row 5 in the band makes `n:t2` current.
  13. **Pending:** `t6` current with a delayed stub goes `summarizing` →
      `summary`; with the stub off it reads `no-model`, with
      `data-route-organizer` set and no request to the port; a stale card
      shows the older-summary line; a card with an old `cv` reads stale.
  14. **A parent pane:** the outcome comes first, then one line per branch,
      each pressable; the pressed branch's pane leads with its own outcome.
  15. **Switching conversations:** open A, scroll mid-thread, switch to B,
      scroll B mid-thread by 1 px with the wheel: `source=thread` within
      600 ms.
  16. **At the bottom:** with a flow and one open exchange past it,
      `data-route-summary-state` is `summary`, not a dormant state.
  17. **The tail:** one open exchange with two runs, a reply and an open
      question is ONE `.chat-route-item[data-route-kind=stage]` carrying work,
      reply and junction minis. Pressing its pane's open-question entry steers
      to the question and focuses an option.

### 4.8 The build split

Two packages build in parallel against §4.1.6–§4.1.7 (the record and the
view), §3.5 (the methods and effects) and §4.6 (the DOM contract). Their file
ownership is disjoint, and no new file is created in essentials or shared. The
running 4250 dev server cannot see a new essentials file.

- **essentials** owns:
  - `hypercomb-essentials/src/assistant/chat-route.ts` and its spec;
  - `orchestrator.drone.ts` and its spec;
  - `chat-thread.ts` — only the `ChatThreads.organizeRoute` signature and its
    comment;
  - `llm-dispatch.ts` — the three fields, the emits, the stored choice;
  - `providers/llm-provider.types.ts`;
  - `providers/local.provider.ts`;
  - `providers/local-liveness.ts` — only the pinned report map (:87-88) — and
    its spec;
  - the existing provider and routing specs.

  None of these carried another session's uncommitted edits when this was
  written (git status, 2026-09-10). The provider files are needed because an
  explicit model with thinking off and a constrained shape is the
  model-selection path; without them the participant's own model still thinks
  and returns empty answers.
- **shell** owns:
  - `hypercomb-shared/ui/chat-window/chat-window.component.{ts,html}`;
  - `chat-route.scss` (including `.chat-panel .chat-thread { position:
    relative }` — the main sheet is not touched);
  - the 14 catalogs, by targeted insertion.

  It must degrade on an older essentials build: no `card`, `exchanges`,
  `organizer`, `organizerState` or `organizing` means no status line, no
  `data-route-organizer`, and v1 titles.

This document and `scripts/verify-chat-route.cjs` belong to neither package.

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
  forbids, and it could disagree with the turn.
- **No new bridge op** for questions. Text carries it on every tier.
- **No `other` flag.** The composer is the other answer, always.
- **No environment variables** for run addressing. There is one input, the
  ask, and the renderer resolves it from the record it already reads.
- **No separate board view.** (The "no split, no second scroller" that
  stood here was reversed the same day: the route is a sidebar beside the
  thread with its own scroller — §4, §9.)
- **No parsing of streaming partials.** Questions are read from stored
  turns; an unterminated fence is not a question.
- **No pipe pieces as buttons**, no glow, no spring, no entrance animation
  that is the only way to a visible state, and no sealed end.
- **No side setting** until there is a second gutter to mirror.
- **No single-call flow.** Measured: one call leaks its example, misplaces
  branches, loses reversals and has no room for summaries (§4.1.3).
- **No thinking pass** for a flow call. Thinking cost 2–10× the time,
  sometimes ate the whole token budget, and did not improve the structure.
- **No model chosen for the participant.** No roster order, no
  `defaultModel` guess, and never a paid provider. The flow names the model
  of the participant's last own local chat, or one their local model answered
  a conversation with, or it does not run (§4.1.1).
- **No freezing on first answer.** Trees are not reproducible, so the newest
  five assignments stay provisional until they are seen with more context
  (§4.1.4).
- **No side-by-side siblings** (revised 2026-09-11). A banded tree that spread
  siblings across 10rem columns hid half a branching tree off-screen at 1280,
  and re-wrapped the whole main line when the first branch appeared. Siblings
  stack, and a branch is one indent step in (§4.2).
- **No sibling walk on ←/→.** The keys are the ARIA tree pattern, exactly
  (§4.3.5).
- **No floating detail card** (retired in v2). A pane under the tree shows the
  current step; a card over the thread hid the messages the steer had just
  brought into view (§4.4.6).
- **No text shown only on focus** in the pane. It cannot be reached on touch,
  and it moves as Tab moves (§4.4.2).
- **No SVG connectors.** They would need measured rects, an observer and an
  animation frame. Grid cells with segment spans stay joined at any text size
  with no measurement (§4.2.4).
- **No stored merge of linear chains.** A collapse that changed the record
  would make the tree depend on pass timing; if it ever comes, it is view-time
  (§8).
- **No IoC detour for the drain.** Routing the drain through `ChatThreads`
  would join the lane's two copies but leave the probe-state split; one pinned
  state fixes both (§4.1.9).

## 8. Not in this pass

- The **summary gutter** on the left (`summary-gutter.md`) is not built
  anywhere yet. The route sidebar is built as the same mechanism (a strip
  beside the thread), so it can take the mirror side, and the side setting
  arrives with it.
- **Summaries on the phone.** Below 701 px the column is not rendered, and the
  settled lines carry the decisions. The designed answer, not built: a
  collapsed native `details.chat-route-step` immediately before each node's
  first covered message, below 701 px only. It is Jaime's call, and it would
  need the standing mobile walkthrough proof, before and after.
- **A view-time collapse of linear refinement chains** (§4.1.10) — a
  single-exchange node whose only child starts at the very next exchange.
- **A resize grip for the sidebar**, like the tiles rail's
  (chat-window.component.ts:3684-3719), a **wider indent step** for a more
  visible spread (both Jaime's call), and **RTL mirroring**. Everything is
  authored in logical properties, but the shell never sets `dir`.
- **Organizing only while the page is hidden or idle.** The experience review
  proposed it as the default. It is not adopted: Jaime asked the local model to
  visit as many chats as possible. It stays his call, beside the duty cycle
  (§9).
- **Pre-emption for local model use outside this tab** — no signal reaches the
  page (§4.1.9).
- **A tracked, local-model-gated offline eval** of the flow prompts. The lens
  fixtures and run scripts, and the review conversation (with its expected
  drops on E8 and E10, and E11–E12 under the fold task), live outside the
  repo. Any prompt change should be re-run against them before its version
  bump. Re-homing and meta exchanges should be measured against the review
  conversation first.
- Steps for host-tier work and for local-provider grammar acts
  (`hypercomb_act`). Those routes show junctions and ends only, and say nothing
  about work — which is honest, and owed.
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

**2026-09-10, later the same day — the column became the sidebar.** Jaime:
*"Basically it's a visual workflow of what you accomplished on the right
hand sidebar working its way down. It can be a viewport where you can pull
it or you can just have it all on screen."* The narrow per-row column inside
the thread's scroller was gated on a junction or recorded work, so in
practice it drew nothing. It is now a sidebar of its own beside the thread
(§4), present for any conversation with a turn, one stage per exchange —
the participant's words, the work, the reply's first line, the junction —
pullable, pressing a card finds its message. The grid conversion and every
per-row cell are gone; the thread is its original flex column again. This
reverses §7's "no split, no second scroller": the split is the point.

**2026-09-10, later still — captions are labels, or nothing.** Jaime:
*"It's not that I want you to just put the messages. I want you to use the
local AI if it's available, otherwise you can just leave whatever is in there
and leave it dormant."* The stage no longer shows the participant's words and
the replied card no longer shows the reply's first line; the detail cards
dropped the excerpts too. A stage is captioned by a label the machine-local
model minted for that exchange — only when that model is already known awake,
never by probing for it and never by another vendor — or it is a dormant card
(§4.1). Labels are a derived cache in `chat:route-labels`, keyed by the
exchange's turn sigs and settled attempts, version-stamped, written silently.
Junctions keep their prompt and chosen answer: those are decisions, not
message text.

**2026-09-10, evening — the local model visits every conversation.** Jaime:
*"so let's make sure that ollama visits as many chats as possible and updates
the workflow for each chat."* Labelling only the conversation on screen left
every other thread dormant forever. A passive drain over ALL conversations
was scheduled in the orchestrator (§4.1, "When").

**2026-09-10, evening — one organized workflow, not captions.** Jaime: *"We're
not talking about like just telling what it did we're just giving like a
general overview in about the rational order obviously you're working on
things back and forth so just get it in there and then just have a workflow
of what's been going on through the session you can branch you can do any
whatever you like and it'll be able to be navigable to see what's
happening."* The per-exchange label (`labelRoute`, `chat:route-labels`, one
file per exchange key) is gone. In its place each conversation has ONE flow —
nodes in rational order, branching by `parent`, each pointing at the turns it
covers — re-derived as the conversation grows, the previous flow passed to
the model so the organization stays stable, stored in one recycled slot per
conversation in `chat:route-flows`. The sidebar draws the nodes as a branching
pipe (elbows, rails, stems), a node lights every message it covers, ←/→ fold a
branch, and the exchanges the flow has not read follow as dormant stages.

**2026-09-10, evening — passive and free.** Jaime: *"Basically it's a passive
free local model organization."* So: machine-local model only, readiness from
probe STATE only (never a knock), no fallback to any other vendor, never a bee,
never agent work, silent writes, and a closed gate reads, calls and fetches
nothing.

**2026-09-10, night — the tree v2: a full summary at every state, the spot in
the chat, his own model, a real deviation tree.** Jaime, verbatim: *"The
workflow in chat is incredible but it's very rudimentary and really what it
needs to do is give you a full summary at every state and kind of move you
down the chat as well to find that spot. Therefore you know correct naming by
the local AI obviously the one I use so that we don't waste our paid compute.
Also there might be parts in the workflow where you actually deviate or
accomplish a couple tasks so you got to create a tree when this deviation
happens for each of the nodes and show it vertically visually spread out.
Remember that view can be just a viewport and so you can actually move it up
and down inside to side slightly."*

Three lens designs were synthesized into §4. Each conflict between them was
settled one way, for the stated reason.

- **The model.** The v1 call named no model (`model: undefined`, tier
  `fast`), so it landed on whatever the roster listed first. v2 names exactly
  the participant's own local model: the conversation's remembered local
  model, else the most recently used one, else what an un-named local chat
  resolves to (§4.1.1). The v1 call also ran with qwen3's thinking on, which
  was measured to empty answers under its token cap. v2 turns thinking off and
  constrains the output shape on the local provider only (§4.1.2).
- **The pipeline.** The single call became two measured stages:
  - per-exchange task tagging, with code building the tree;
  - a validated card per node.

  The record became v2: a frozen exchange assignment, cards keyed by their
  inputs, stale cards kept and labelled, 32 nodes. A lane lets the
  participant's own chat preempt the background drain. The summary lens
  proposed a single prose summary per node; it lost to the three-part card,
  because the card was measured, can be validated, and reads as *where it
  stands*.
- **The tree.** The flat, indented list became a banded tidy tree on a CSS
  grid, with segment spans for pipes. Siblings spread side by side under a
  four-column cap, and the main line stays one straight pipe. The tree lens
  kept the hover card and the summary lens retired it; it is retired, and the
  pane under the tree replaces it.
- **The viewport.** It pans on two axes, with axis lock, Shift+wheel, follow at
  the bottom and the start, and instant scoped reveals. Keys follow the ARIA
  tree pattern, with ←/→ walking siblings.
- **Finding the spot.** One `routeCurrent` signal with four sources. Press,
  key (after the walk rests) and span move the thread with a scoped,
  short-only-smooth steer that the participant's own input cancels. Reverse
  sync selects, and never moves the thread, so the two cannot loop. The
  summary lens's "uncovered" state was dropped: the frozen assignment gives
  every organized turn exactly one owner.
- **Left open for Jaime:**
  - whether a parent step shows model-written text under its branch list;
  - summaries on the phone;
  - the background duty cycle;
  - a view-time collapse of linear chains;
  - the width of the spread.

**2026-09-11 — what the build review and the experience review changed.** Two
reviews read the night's v2 design. The buildability review read it against
the real code and the web build; the experience review ran the verbatim
prompts on a fresh 13-exchange conversation (`qwen3:8b`, 5 structure repeats,
a pre-emption timing test). Every finding was checked against the code or the
logs before it was applied. All of them held, and five fixes were adapted
rather than taken as written.

- **The web build holds the flow state twice** (blocker, held). The
  orchestrator bee inlines chat-route.ts (build-module.ts:143-146,
  orchestrator.drone.ts:39), `ChatThreads` holds another copy, and two more
  bees inline chat-thread.ts. The lane, guards, back-offs and preferences now
  live in one object pinned on `globalThis`. *Adapted:* the probe-state map in
  local-liveness.ts is pinned the same way, because the gate in a copy no probe
  ran in reads `unknown` forever — which routing the drain through IoC would
  not have fixed (§4.1.9).
- **The participant's chat did not really win** (held). The attended call
  never checked the pause or the wait, and `llm:local-used` was also emitted by
  the blurb drain, bee banter and peer serving. Now every lane entry is refused
  during the pause, and the attended call is refused while waiting. The signal
  is inverted: only the routed stream — the chat window's own local send —
  emits `interactive: true`. An attended call aborts a passive call instead of
  waiting behind it (§4.1.9).
- **Turn growth inside a mapped exchange left a flow behind forever** (held).
  W-advance moves `upToTurnCount` without a call, and a 400-exchange flow is
  clamped (§4.1.6, §4.1.8).
- **A card version bump never reached idle conversations** (held). Cards carry
  `cv`, and an old `cv` reads stale on the synchronous read path. *Adapted:* no
  `cv` on the record, whose `v` already covers it (§4.1.6).
- **The plain retry could not be sent** (held). The labeller reads
  `plainLocalModels` and drops all three knobs (§4.1.1–§4.1.2).
- **Rests were cancelled by wakes, and a missing field made `setTimeout(NaN)`**
  (held). `#flowRestUntil` holds against wakes; `elapsedMs` is required,
  `resumeAt` is required on yield, and both formulas are guarded. The duty
  cycle was stated as 50% but was 67% (a 90 s pass, then a 45 s rest); a
  budget pass now rests as long as it ran, a true 50% (§4.1.9).
- **Reverse sync lost its rows on a conversation switch** (held). Rows are
  reused by position; `#clearRoute` now disconnects the observer (§4.4.5).
- **About 25 existing assertions would break unplanned** (held). §4.7 lists
  them.
- **Smaller findings, all held:**
  - the model contract grew a `fallback` and a fixed per-pass model;
  - stage 1 gained a 6,000-character input budget;
  - the worked pipes gained the last root's stem and the tail joint;
  - `chat.route.summary.cardBy` was added;
  - the attended worst-case wait is restated.
- **Half a branching tree was off-screen** (blocker, held). The banded layout
  put nodes at x ≥ 2 outside an 18.7rem sidebar at 1280, and re-wrapped the
  main line when the first branch appeared. The tree is now one card per row
  in preorder, each branch one 1.75rem step in, and cards run to the inline
  end. It pans only about half a rem, and only at the narrowest sidebar
  (§4.2).
- **The pane showed *not organized yet* while chatting** (held). Reading past
  the flow selects the newest organized step, and says how many exchanges are
  newer (§4.4.5).
- **A press was undone when the pointer left** (held). Press, key and span
  choices hold until the participant scrolls the thread. Nothing applies on
  leaving the column. *Adapted:* focus inside the column no longer pauses
  reverse sync, because a pressed card keeps focus (§4.4.3, §4.4.5).
- **Every refresh dragged a panned tree back** (held). A tree change reveals
  only a changed or displaced current step, and any scroll the component did
  not make counts as a pan (§4.3.4).
- **←/→ walked siblings, folding them on the way** (held). The keys are the
  APG tree keys; with stacked siblings, ↓/↑ is the visual order (§4.3.5).
- **The pane buried *where it stands*** (held). The outcome comes first, then
  branch lines one line each, with goal and done behind a remembered
  `details`, and the height is `clamp(9rem, 45%, 24rem)`. *Adapted:* the review
  also proposed 50%, and branch outcomes shown on focus. 45% keeps more tree
  rows. Outcomes appear on the branch's own pane, since focus-only text cannot
  be reached on touch (§4.4.1–§4.4.2).
- **Stage 1 misfiled a follow-up, missed both reversals, and was not
  reproducible** (held; the determinism claim is deleted).
  - Fenced code becomes `[code]`, and replies clip head plus tail.
  - The newest ≤ 5 assignments stay provisional until seen with 5 later
    exchanges.
  - Code re-homes an exchange that shares nothing with its node.
  - *Adapted:* re-homing compares an exchange with covered text, not titles.
    The misfiled test shares no word with the title "Fix sidebar jump", but
    shares "fold" with the exchange that raised it (§4.1.4).
  - Reversals and umbrellas remain honest limits (§4.1.10).
- **Leaf cards invent facts too** (held; the "leaves accurate" claim is
  replaced by the 2/5 measurement). An `ungrounded-<part>` rejection catches
  another step's facts, and meta exchanges stay out of card messages.
  *Adapted:* the proposed meta test (short, no shared title word) would also
  drop "still broken" follow-ups; it now also requires no work, no decision,
  and a reply that spans other steps (§4.1.5).
- **"His own model" fell back to roster order for bridge users** (held). The
  routed stream stores `hc:llm:local:model`, and resolution reads it first.
  *Adapted:* conversations whose local model actually answered are a
  migration fallback — never `modelForTier`; with neither, the pane asks for
  one local chat (§4.1.1).
- **Minor experience findings, all held:**
  - pre-emption is stated as in-tab only;
  - the pane names why no model runs (`organizerState`);
  - the start line is a thread-wide rule, not a bubble inset;
  - `aria-describedby` points at the state line and outcome only;
  - a tail exchange is one card with marks. *Adapted:* the idle-only drain was
    not made the default, because Jaime asked the local model to visit as many
    chats as possible; it is left to him.
- **Left open for Jaime:**
  - whether a parent step shows model-written text beside its branch lines;
  - summaries on the phone;
  - the background duty cycle: a true 50% while the page is open, or organize
    only while hidden or idle;
  - a view-time collapse of linear chains;
  - the indent step and a resize grip;
  - whether "the model of my last local chat" is the right answer to "the one
    I use" (with no local chat yet, the flow waits).

### 2026-09-11 — Jaime's decisions

- **Tree spread:** stacked, one 1.75rem step in; no resize grip. *(Reversed
  later the same day when the work was un-shelved: a grip and a wider default,
  §4.3.1.)*
- **Steps with branches:** the model's one-line outcome first, then one line
  per branch from the record; goal and done one press away.
- **Background use:** a true 50% duty cycle while the page is open; the
  participant's own local chat pauses it.
- **The model:** the model of the participant's last local chat in the hive,
  then a local model that answered one of the conversations, else nothing runs
  and the pane asks for one local chat.
- **Not in this pass:** summaries on the phone, a view-time collapse of linear
  chains.
- **The moderator is the hive's orchestrator, in code, with no second model.**
  Jaime: *"the orchestrator who moderates Ollama can fine tune how it thinks
  about it but also interpret the results so that it doesn't get lost in
  translation. As long as we use a model strong enough to do this we should be
  fine."* The steering and interpreting already specified stay (per-chat
  prompts with the previous tree, validators, the lexical re-home, retries
  that name the reason). OWED, after this pass lands: the orchestrator keeps a
  per-model record of how its answers fared (calls, unusable answers, retries,
  rejections by reason), tightens its asks for a model that keeps failing
  (smaller windows, the plain request), and the pane says so in words when the
  chosen model is too weak to organize well — no extra compute, never a
  different model chosen on the participant's behalf.

### 2026-09-11, later — un-shelved

The sidebar was hidden and the drain paused for a day (`routeSideShown`,
`flowsEnabled`). Jaime: *"I shelved the workflow on the right side of the AI
chat window … this failed miserably but I'd like to continue and see if we can
go at it a second time. Especially the labels need to be descriptive, not
'Replied'."* What had happened: with no local model awake every exchange is a
dormant stage — a person glyph and a chat-bubble mark, nothing descriptive —
and the organizer never ran, so that was ALL he saw. Un-shelving:

- both flags flipped back; the specs rewritten against the v2 pipeline
  (`buildFlowTree`, the two prompt builders, the validators, `cardKey`,
  `parseFlowRecord` v2, a two-stage stub server answering by request shape,
  `hc:llm:local:model` seeded so a model resolves, the call budget instead of
  a conversation limit); en + hi given the 30 summary keys;
- proved on the isolated 4251 shell against the real `qwen3:8b` through
  Ollama: a 12-turn pottery-studio conversation became six named steps
  ("Create landing page for pottery studio" › "Lay out gallery from existing
  tiles" › "Fix error in contact tile" …), each with a card, the pane reading
  *where it stands* on a press — eight completions, all to 127.0.0.1:11434;
- a tool window was asked for and withdrawn in the same breath (*"keep it how
  it is but draggable, make it wider"*): the grip and the wider default of
  §4.3.1.

Still owed: the per-model answer-quality record (the 2026-09-11 decisions), and
a v2 rewrite of `scripts/verify-chat-route.cjs` — its stub still answers in
the v1 `nodes` shape, so its sections o–q no longer pass.

## 10. The chat experience redesign — pass 1 (2026-09-11)

Jaime, on seeing the un-shelved sidebar live: *"what is this session, am I
getting anywhere, does it mean anything — it's not quickly apparent … it
really just doesn't work much to add any clarity to moving between many open
conversations … we really have to make this user experience incredible and
versatile but also simple … I'm not talking about just the sidebar either, I'm
talking about the whole chat AI experience … icons can be greatly useful …
I love the look and if we could get that for every chat window passively that
would be incredible."*

The design (whole-window mockup, approved with "start"): every conversation
has a NAME, a STATE and a "WHERE IT STANDS", written by the local model, and
every surface shows the same three things the same way — the conversations
list, the masthead over the thread, the workflow column, the step rules in the
thread. Build order: (1) the session card and step kinds; (2) masthead, thread
step rules, composer; (3) the conversations list, grouped by who it waits on;
(4) the column on the same record. Pass 1 landed:

- **The session card** (`RouteFlowRecord.session`, `RouteFlowSession`): `name`
  (3–8 words, checked like a title against every card's text) and `stands`
  (≤ 200 characters, one or two sentences), `sv` = `ROUTE_FLOW_SESSION_VERSION`,
  keyed by `sessionKey` — the nodes' ids, states and current card keys — so any
  step's change makes it due again. Written after the cards, once every card is
  current OR nothing more can be carded right now (a refused card in back-off
  never holds the name for ten minutes). One call, one retry naming the reason,
  its own back-off key (`|x|`). `readRoute` hands the shell `flow.session`
  (`stale` when a step changed since) and `flow.counts` by rolled-up state.
- **A kind on every step card** (`RouteFlowCard.kind`: fix · idea · choice ·
  build · look), asked for in the card prompt and its schema, never a reason to
  refuse a card. `ROUTE_FLOW_CARD_VERSION` 1 → 2, so every card is written once
  more. The shell draws it (`KIND_ICONS`: bug_report · lightbulb · alt_route ·
  bolt · explore — all in the shipped subset) in place of the state glyph.
- **The sidebar head** (`.chat-route-head`, `routeHead`): kicker, the name in
  the reading face, the *stands* line with the open step's icon, a done/open
  meter and counts. Until the session card exists it shows the first root step's
  title and the newest carded step's outcome. State colours are COLOUR ON
  PURPOSE through `tw.ink()`: done `#70d59a`, open `#e8b04a`, on the head's
  icon, the meter and each step's glyph.
- **THE VISITED QUEUE** — Jaime: *"if we don't touch the conversation let's not
  organize the workflow sidebar … it gets into a queue if you visit it and then
  that will be done in the background."* `markRouteVisited` (called by the
  attended call, i.e. whenever a conversation is on screen) records
  `hc:chat-route-visited` (newest 200). The drain organizes ONLY visited
  conversations, most recently opened first, live or archived alike, and keeps
  them fresh as they grow; a conversation nobody opened on this machine is left
  as it is. This replaces "live newest-first, then archived".
- Proved on the isolated 4253 shell with the real `qwen3:8b`: the pottery
  conversation's steps re-carded with kinds (bolt, bug_report), the head read
  "Create landing page for pottery studio — The landing page is in progress
  with the gallery section completed and the contact form pending. 6 done · 0
  open", one step's card sat in back-off and did not hold the session card.

Passes 2–4 are owed. Also owed, noted 2026-09-11 while this landed: Jaime's
build naming — *"here's a build, give it a name, the name stays and we just
have revisions under it until we name it again; the date is already the
created time, don't duplicate it"* — belongs with the revision pool
(memory: manifest-should-be-a-revision-pool), not this document.

### 2026-09-11, later — the helper runs on Haiku or Sonnet

Jaime: *"Make sure we use Haiku or Sonnet for our background helper from now
on because qwen is not doing it for us — helpers and/or orchestrators."* A
parallel session landed the mechanism the same hour: `llmPolicy.orchestratorProvider`
(model-policy.ts, default `'anthropic'`, `'local'` restores the machine-local
probe) and `organizerGate` / `organizerModel` / `awakeOrganizerLabeller` in
chat-route.ts, with a "Background helper" picker in the providers window; the
weight is `llmPolicy.orchestratorTier` (`fast` = Haiku by default, `balanced`
= Sonnet). The session card, the kinds and the visited queue run through the
same gate unchanged. Consequences, stated plainly: the organizer now needs the
provider's key under Providers — without one it reads `off`, and the pane's
line was reworded for that ("the background helper is switched off or has no
key"); the "nothing leaves the machine" promise of §4.1.8 holds only while the
helper is set to Local. The local-model proofs above stand for the local path;
the Haiku path was not proved live here because a key cannot be entered on the
participant's behalf.
