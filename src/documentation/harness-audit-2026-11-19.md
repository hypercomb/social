# Harness audit, 2026-11-19

jwize, 2026-11-19: "we mainly want state of the art but not necessarily additive. We need to compete with claude-code at least from the harness side." Then: "do a full audit."

This is that audit: what the in-hive harness does today, measured against what Claude Code's harness does, with the defects found on the way and an order of work. It describes the code at `0bdc121c2`. Nothing here is built.

## How it was done

Four readers each read one area of the code end to end and reported with file and line: the loop, the tools, review and undo, and agents and memory. Their reports were then checked against the code for the claims this document leans on. Nothing was executed for the audit itself; where a finding rests on reading alone it says so.

Checked by hand after the readers: no caller sets `tools`; reads in a block run one after another; the fold is truncation; the default policy runs every kind; a draft can be applied unheld when the brood write fails; `send()` has no guard against a turn in flight; a picked sentence lifts three holds; Jev leaving un-gates the rest of the turn; `agent:stop` has no listener.

Abbreviations: `CW` is `hypercomb-runtime/src/chat-window/ui/chat-window/chat-window.ts`; `core/` is `hypercomb-core/src/core/`; `asst/` is `hypercomb-essentials/src/assistant/`.

## The verdict

The harness is strong where Claude Code is weakest and weak where Claude Code is strongest.

**Ahead.** Every change is admitted by one default-deny gate, judged, held where it matters, run as a transaction, and reversible; receipts come from the hive and never from the model's account; long work survives a refresh; a second model judges changes against written rules; the loop's numbers are a signed record a hive can swap.

**Behind.** The model works through one text block per reply, one kind of action per round, reads one after another, cannot search content, cannot run or see what it made outside one narrow case, keeps no plan, cannot split work, remembers nothing between conversations, and has no web. These are the things that make Claude Code feel capable, and most of them come from one cause: the reply protocol.

**Corrected the same day.** This audit first said the first move was to replace the text protocol with native tool calls. That missed the record: the text fence was jwize's decision of 2026-09-13 (`hive-read-fence.md` §1.3, §2), made because many OpenRouter models call tools poorly and fail without saying why, and so that every model asks the same way. Asked on 2026-11-19 whether to also offer native tool calls, he said: "Keep text only." So the text fence stays, and the first move is to carry more in one round inside it. See "Order of work".

## Scorecard

| Capability | Claude Code | Hive harness | Gap |
|---|---|---|---|
| Reply protocol | Native tool calls, many per step, run in parallel | One fenced text block per reply, by decision (2026-09-13, kept 2026-11-19) | Decided: text |
| Mixing actions | Read, search and edit freely in one step | One kind per round; a read in the reply holds the change (kept: read first, then change) | Medium |
| Reads | Parallel, any file, any size by range | Up to 8 per block, run in sequence (together, after #200); 48,000 characters each | Small after #200 |
| Content search | Regex and glob over everything | Tile names and running code only; notes and files unsearchable | Large |
| Edit | Exact string replace on any file | Search/replace on module sections, tile pages, files, cards | Small |
| Run and see | Shell, tests, type checks, logs, browser, screenshots | Nothing, except a page report after a file write on a managed site door | Large |
| Planning | A task list the user watches | None; one line of "what is left" | Medium |
| Sub-agents | Fresh or forked workers, parallel, background, with notifications | None; `delegates` is declared and unread | Large |
| Context | Model-written summary when long; cached prefix and history | Selection of turns, 400-character truncation fold; only the system text cached | Medium |
| Memory | Project instruction files, user memory, skills loaded on demand | Doctrine tiles only; skills exist for the bridge, not this loop | Medium |
| Permissions | Modes plus allow rules per command | Reach and scope ceiling, per-verb roster, per-actor groups, holds no policy lifts | Ahead |
| Second opinion | None built in | Jev judges each change against the doctrine, with thresholds | Ahead |
| Undo | Checkpoints per turn, rewind | Transaction per block, history per tile; no turn checkpoint | Small |
| Steering | Message mid-turn is queued and delivered | No queue; a message typed mid-turn is stored and not delivered | Medium |
| Web | Fetch and search | None | Medium |
| Extensibility | Hooks, MCP servers, plugins | Signed harness record, step registry, any queen becomes a tool | Even |
| Durability | Session transcript, resume | Turns written first, owed record, stream checkpoints, Web Lock per conversation | Ahead |
| Injection defence | Tool output treated as data by instruction | Provenance taint that holds every later change, persisted | Ahead |

## 1. The loop

**How it works.** A round is one streamed model call plus the one block it asked for. A leg is one context window: 12 rounds, or the window less 8,000 tokens. A request is the typed message plus every leg chained after it, capped at 400 rounds or 6,000,000 tokens (`core/agent-leg.ts:29`, `:34`). At a leg's end the model writes what is left; the hive stores it as an owed record and starts the next leg itself (`CW:7145-7205`).

**The reply protocol is text.** The model ends a reply with one fenced block; `splitWork` parses the finished text (`core/work-fence.ts:575-618`). Kinds: read, do, table, write, handoff, continue. When a reply mixes kinds, handoff wins, then reads; any change in the same reply is not run. A write block targets one file. Native tool calling is fully plumbed (types, body field, stream assembly in `asst/llm-dispatch.ts:583-640`, `asst/providers/openai-shape.ts:130`) and has no caller.

Much of the loop's bulk exists to survive this choice: six accepted spellings of a block, detection of blocks written as prose, of changes claimed but not sent, of answers given without reading, of promises with nothing after them (`core/work-fence.ts:347-482`, `CW:8586-8653`, `owed-step.ts:293-363`). These nets are careful and they work, but they are the cost of a protocol the model was not trained on.

**Context.** Each round sends the system text and the whole message list. History is a selection, never a summary: the latest user turn, up to six recent turns, and older user turns that match correction patterns; the rest is left out even when the window has room (`context-window-compiler.ts:130-216`). Inside a leg, the fold replaces older rounds with one line each, cut to 400 characters, with no model call (`core/agent-leg.ts:59-77`). Read results do not cross a leg boundary; only their signatures do. Caching covers the system text only, and only for Anthropic direct and OpenRouter.

**Limits worth knowing.** Output is 4,096 tokens per call, 16,384 for a model known to think, and the loop never asks for more (`CW:8498-8501`); that bounds one write block. There is no wall-clock limit on a round, a leg, or a wait in Execution. A weaker model escalates to a stronger one only by writing a handoff block itself.

**Strengths.** The run lives outside the window and survives it; partial text is checkpointed every 1,200 ms. A provider is pinned for the whole leg, so reads never move vendors mid-work. Provider failure handling is thorough: busy upstreams are routed around, a refused key poisons only that key, a silent stream is cut at 90 seconds.

## 2. The tools

**Reading.** Nine read verbs: by route, by signature, a module's source section, history, summary, tree, find, code, and the two network reads, pool and explore (`hypercomb-observation.ts:32-33`). Content-addressed reads are a real advantage: a repeat is answered in one line, a changed answer comes back as a diff, and the system text carries the last 24 signatures already read. Reads run in sequence (`hypercomb-observation.ts:672`).

Two silent losses: a layer over 12,000 characters drops whole slots with no way to page them (`asst/hive-tree-reader.ts:944-950`), and notes over 64,000 characters vanish without a flag (`hypercomb-observation.ts:1126`).

**Searching.** `find` matches tile names. `code` matches module names, and lines by treating the whole query as one substring, 40 hits at most. Nothing searches note text, layer content, or attached files, except on a managed site door. There is no regex, no glob, no search by tag or reference. Six verbs a model may say in a do block (`find`, `read`, `explore`, `references`, `walk`, `go`) send their output to the activity log or a panel, so the model gets nothing back.

**Changing.** 51 behaviours declare a machine grammar. A do block is 1 to 12 lines of at most 1,000 characters with no newlines, parsed whole before anything runs, run in one serialized lane, and rolled back on failure (`core/machine-plan.ts:47-49`, `CW:8231-8243`). Outside a managed door the default roster is empty: a model can change nothing until verbs are granted.

**Writing code and files.** One write block per reply: a module section, a new file beside it, a tile's page, a text file on a tile, or card data. Edits are search/replace with an exact-once rule; a failed edit returns the current file. Module writes target the compiled bundle, are always held until the participant accepts, and run after a reload. Checks are a parse and a regex scan for new reach; types and tests are not checked (`hypercomb-runtime/src/module-drafts.ts:23`). The dev shell cannot write code at all. The shell itself is not writable.

**Running and seeing.** No tool runs code, tests, or a type check. No console, no screenshot, no DOM. The one feedback path is "WHAT THE PAGE DID", sent after a tile-file write on a managed site door: errors, failed loads, visible text, canvases (`CW:8394-8409`, `hypercomb-essentials/src/history/frame-watch.ts:60-139`). After a do block the model is told only which lines ran.

**Pictures.** A model that sees gets up to four pictures on the newest message. A model that cannot gets a description from one that can. The Anthropic adapter maps messages to role and content only (`asst/providers/anthropic.provider.ts:103`); a reader reports that attached pictures do not reach a direct Anthropic call. Not confirmed by running it.

**Outside the hive.** No web fetch and no web search.

## 3. Review, permission and undo

This is the harness's strongest area.

**Two layers.** The machine grant decides what a model may say: a ceiling of reach and scope, a per-verb roster, default-deny, fail-closed on corrupt storage, and no way for a model to raise it (`core/machine-admission.ts:205-318`). The Execution queue decides what runs on arrival: manual, auto by kind, or everything, with groups per conversation, provider or model (`asst/execution-queue.ts`, `asst/permit-groups.ts`).

**Holds no policy lifts.** A read by a provider without the hive grant; a line that leaves the machine; any change in a conversation that read someone else's words; anything Jev marked for review; a change to the doctrine; written code, which never runs without a human ruling.

**Jev.** A separate judge model with a fixed set of yes/no questions per row and a threshold per question, including one question per doctrine section. Destructive changes are never automatic. Its inputs and decisions are stored as signed receipts.

**Weaknesses found here.**

- **The default runs everything.** The seeded policy is auto with all four kinds ticked (`asst/permit-groups.ts:108-121`). With Jev off, which is the default, every granted change and every file write runs on arrival.
- **Jev leaving un-gates the turn.** If Jev steps aside at the front door or fails mid-turn, `jevTurn` becomes false and later changes in that turn are not judged (`CW:7747`, `CW:8460`). `jev-decisions.md` says an unavailable Jev means the change waits.
- **No judge without OpenRouter.** Jev needs an OpenRouter key and grant. Without them, no second model judges anything.
- **Verification is advisory.** The final-answer check appends a note; it cannot hold an answer. Its evidence is emptied after every change, so only a read-back made after the last change is checked (`CW:8218`).
- **No turn checkpoint.** Undo is per do block and per tile. A turn of several blocks is reversed by stepping the history several times, and that does not cover writes outside pages.
- **No diff at approval for module writes.** Only tile files show what will change.

## 4. Agents, memory and extensibility

**Agents.** An agent in the hive is a record of work in flight, drawn as a bee. A model cannot start one, message one, or wait on one. Delegation today is a hand-off of the same turn to another model, or an outside process using the bridge.

**Outside callers.** `chat:ask` starts a turn in any conversation and `chat:asked` returns the result, with held changes reported early (`CW:3431-3506`). This is a good base for sub-tasks. Results are kept in memory, 64 at most, and lost on reload.

**The harness record.** Ten numbers and flags are live: leg rounds, reserve, keep-verbatim, budget, the four read limits, and the prose fallback. These fields are parsed and never read: `instruction`, `doctrine`, `review`, `vocabulary`, `delegates`, `handover.fence`, `handover.resumeSeconds`. A swapped harness cannot change the instruction, the tools, the review policy, the judge, or the model. The step registry exists, with seven words; only the shipped steps are registered, and a step's signature is not checked on register.

**Memory.** The only text a participant can write that every future turn reads is the doctrine tiles. There is no project instruction file, no user memory, no standing instruction per tile. Skills exist as tiles for bridge sessions and are not loaded by this loop. Summaries exist for the rail and the route, and none was found feeding the model.

**Knowledge.** Well designed: a small anatomy always sent (3,461 characters of mechanics plus the hive's doctrine), and source, glossary and documents pulled by signature on demand.

**Unattended work.** Nothing runs with the tab closed. Auto-continue covers only the conversation on screen. There is no scheduler in the hive.

## Defects found

These are wrong today, whatever the direction. Each is from reading; none was reproduced.

1. **A draft can be applied without being held.** `admitDraft` returns null, meaning "may be made live", when the brood write throws and the draft reaches nothing new (`hypercomb-runtime/src/module-drafts.ts:255-264`). The rule is that every draft is held.
2. **A message typed mid-turn is lost to the running turn and resets its state.** `send()` has no guard for a turn in flight; it stores the message, clears the spend and the owed record, and the running leg never sees it (`CW:6850-6921`).
3. **A picked sentence lifts the doctrine, foreign and outbound holds.** Options come from any question block in the last assistant turn, so a model can author an option that is a behaviour sentence; one click runs it with three holds lifted (`CW:8426`, `CW:8164-8170`). The click is a hand, but the participant may not read it as an approval of a held kind.
4. **`agent:stop` has no listener.** Stopping an agent removes its record and writes a tombstone; nothing in the hive hears the stop (`asst/agent-registry.service.ts:495`).
5. **Trust can be set by any loaded module.** `chat:ask` with `trust: true` is an open event; the guide uses it (`hypercomb-essentials/src/guide/guide.drone.ts:404-409`). The holds still stand.
6. **Notes over 64,000 characters are dropped silently**, and oversized layer slots are dropped with no paging (section 2).
7. **The foreign taint ignores list, tree, find, history and code reads**, so names and code text from a peer are not counted (`hypercomb-observation.ts:782-784`).
8. **The direct path skips the doctrine questions.** A sentence Jev sends straight to `runDo` is not asked the per-section rule questions (`CW:8131`).
9. **The doctrine hold is a word match**, added 2026-11-17. It over-holds any line containing the word, and it does not cover module code that composes the anatomy.

## Documents that disagree with the code

- `agent-harness.md` says nothing in the loop is a constant any more; seven record fields are unread. It lists `judge` and `need`, which the record lacks, and shows `review.auto: ["read"]` where the default is empty. It names the pool `harness`; the code uses `agent:harness`. It describes a held state for a synced harness that does not exist. It says every do and write waits unless set to auto; the default is that every kind runs.
- `jev-decisions.md` and `hive-read-fence.md` give 10 decisions per turn; the code allows 12. `jev-decisions.md` says an unavailable Jev means the change waits; that holds only when Jev is not ready or out of budget.
- `hive-read-fence.md` says `module commit` is refused for models; `asst/module.queen.ts:362-368` offers it. Its file paths point at `hypercomb-shared`; the code is in `hypercomb-runtime` and core.
- `agents.md` calls agents interruptible; see defect 4.
- `replayable-agent-loop.md` is accurate, and its ledger covers bridge operations only. The in-window loop records no steps.

## Order of work

Replacement first, then what it unlocks. Each step is a package update.

**1. Carry more in one round, inside the text fence.** The transport is decided: text only (see the correction above). The cost the audit measured was never the fence itself but how little one round carried.

- Done in #200: the reads of one block run together, and one reply may write up to six files, each still its own row in Execution.
- Still open: a do block and a write block in one reply; raising the 4,096-token output cap for a work round, which bounds what several write blocks can hold; several write blocks while Jev judges (today only the first is taken).
- Not to do: mixing a read with a change in one reply. "Read first, then change" is a rule of the hive, and a change made before its read came back has not seen it.
- The native tool plumbing with no caller (`asst/llm-dispatch.ts:583-640`, `asst/providers/openai-shape.ts:130`, the `tools` types in the chat window) is now dead by decision and can be removed.

**2. Say what happened after every change.** Make the page report the general rule: after any change, the model receives what the hive observed, not only which lines ran. For module drafts that means a type check and the parse result; for pages, the frame watch in an ordinary hive as well as on a managed door; and a picture of the page for a model that sees.

**3. Content search.** One search over note text, layer content and tile files, with the same receipts for scope and coverage that `find` already gives.

**4. Sub-tasks.** A tool that opens a conversation on a tile with a brief and a slice of the budget, built on `chat:ask` and `chat:asked`. The result returns as a read. One agent's words are foreign to another, which the existing taint already handles.

**5. A plan the participant sees.** A small task list the model keeps, shown under the turn, replacing the single line of what is left.

**6. Context that keeps more.** A model-written summary at the fold in place of 400-character truncation; cache breakpoints on history; read results carried across a leg by signature with their text when the window allows.

**7. Memory.** A standing instruction the participant writes as a tile, read at the start of every turn, and skills loaded on demand by this loop.

**8. Make the harness record true.** Wire `instruction`, `vocabulary`, `review` and `delegates`, or remove them. Verify a step's signature on register.

Fix alongside, not after: defects 1 and 2 are small and real; the default policy and Jev's fall-through are decisions for the owner.

## How to know it competes

A fixed set of tasks, run on the card page by the harness alone, scored the same way each time. A first set:

1. Change the card's colour scheme and confirm the page still renders without errors.
2. Add a section to the page from a one-line description, with an image.
3. Find every tile that mentions a given phrase and list them.
4. Fix a page that throws on load, given only "it is broken".
5. Rename a concept across the page, its script and its styles in one turn.
6. Answer a question about how a module works, citing the source it read.
7. Carry a task across three legs without losing what was decided in the first.
8. Refuse to change the doctrine without a hand, and say why.

For each: did it finish, how many rounds and tokens, how many times a hand was needed, and was the closing claim true. Run the set before step 1 to get the baseline, and after each step.

## Not read, not verified

- Nothing was run for this audit. The mid-turn message loss, the picture loss on direct Anthropic calls, and the unheld draft are from reading.
- Not read in full: `chat-route.ts`, `agent-panel.view.ts`, `harness-tiles.ts`, `permit-groups.ts` internals, the history service, `brood-rules.ts`, the workflow runner and its separate step registry, most bridge operation bodies, the non-Angular chat view (which may be a second loop with different gating), the Google and local provider adapters.
- Not measured: the size of the work instruction and the vocabulary census; Jev's price per decision.
- The comparison column is Claude Code's harness as it behaves in use, not a reading of its source.
