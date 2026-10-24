# Conversation continuity — no conversation ends on a promise

Status: **designed 2026-10-24, revised the same day after an adversarial
review** (workflow `wf_ebdf8a54-f07`: 56 issues, three of them blockers);
building phase 1. Audit: workflow `wf_7f06c037-76b` (five readers and a critic
over the chat turn lifecycle; 81 findings, each checked in the code,
collapsing into the seven causes below).

jwize, 2026-10-24: *"sometimes the conversations just say they are going to wait
or do something but they are finished already"* — and — *"maybe some models fall
off and others continue. but they should all be robust and survive refreshes."*

## The rule

**Work a conversation still owes is a record in that conversation's own folder,
never a thought in the window's memory.** One runner carries every such record
forward — whether the conversation is on screen or not, after a refresh, on
another model when one falls off — until the work is answered, or it is honestly
waiting on the participant, which the rail then says.

No orchestrator pushes conversations along and nothing wakes them on a timer
for its own sake: the record says what is owed and why, and the runner acts on
what the record says.

## What the audit found

| # | Cause | What it looks like | Findings |
|---|---|---|---|
| 1 | **The end of a turn misses announced work.** The promise check reads only the last line, only lines under 400 characters that open with *I'll / I will / let me / I'm going to*, once per leg, and never at a leg's end; the leg-end prose check needs a paragraph opening *what's left / remaining / next step*. Output cut at the provider's token cap is read as complete. Some leg exits bypass the handover. | "Next, I'll update the other tiles." — and the turn is over. | 1, 2, 9, 12, 14, 40, 42, 49, 50, 77 |
| 2 | **Carrying on lives in the window's memory.** `#continueIfLeft` runs only for the conversation on screen. After a refresh only the newest conversation resumes, only with the window open, only within an hour (`RESUME_LEFT_MS`). A window rebuilt mid-leg loses it. | "*Continuing: …*" with nothing behind it. | 3, 4, 7, 16, 17, 45, 53, 54, 62, 66 |
| 3 | **A refresh mid-leg forgets the request.** The stream checkpoint holds text only; boot files it as a stopped turn with no record of what was being done. Changes that already ran in the leg are missing from it. | "Stopped part way" and nothing more. | 5, 6, 15, 19, 21, 22, 25, 34, 55 |
| 4 | **A model failing ends the work.** The failure path never hands over; the round is pinned to one provider after the first work round; nothing retries after words are out, after a dropped connection, or after a hung local model; the next leg may land on a lighter model. | "The model could not answer" — and no other model tries. | 8, 29–33, 35–39, 56, 64, 71, 74–76, 78 |
| 5 | **Waiting on the participant is not durable.** Held Execution acts live in memory only; a refresh loses them. Holds have no state the rail shows, approval after moving runs nothing, and a manager hears "held" but never the outcome. | A held read that vanished with the reload. | 13, 20, 23, 43–48, 51, 52, 63, 79 |
| 6 | **Concurrency.** All stream checkpoints share one pool doc (read-modify-write, no lock): lost and phantom "stopped" turns. A second message sent while a leg runs joins that leg and is never asked. Background asks swap the window's view. | A question that never got an answer; a ghost "stopped" turn. | 18, 26–28, 57–61, 65, 67–69 |
| 7 | **No ceiling, no honest pause.** A model that hands over the same work forever has no cap; the budget pause is not durable (reopening spends again); later legs lose the original request; the stored handover is cut to 300 characters. | Legs that never end, or a pause that is not one. | 10, 11, 24, 41, 70, 72, 73, 80, 81 |

## The design (revised)

The first draft ran background legs "through the path manager asks already
use". That path swaps the participant's view, and a turn reads the window's
on-screen state throughout — the transcript (`turns()`), the model, the
subject, the selection. So the work is staged: phase 1 makes the record the one
truth and fixes the end of a turn for the conversation on screen; phase 2 makes
a turn able to run off screen; phase 3 lets models fall off; phase 4 makes
waiting durable.

### A. The owed record

One marker per conversation, `chat-owed`, in the conversation's bucket in the
threads pool (fixed name = `sha256(kind)`, beside `chat-archived`), read by the
list walk that already reads every bucket. **Writes merge** — a writer changes
only the fields it owns — because several writers fire inside one leg.

```
{ kind: 'chat-owed', convoId, at,
  state: 'continue' | 'waiting' | 'paused' | 'done',
  why:   handover | promised | cut | failed | interrupted | queued | asked   (continue)
       | held | question | stalled | gave-up | return-to-page               (waiting)
       | budget                                                             (paused),
  left, lastLeft,                  // what is owed now, and at the previous leg end
  promises, idleLegs,              // counters: promises in a row, legs with no work round
  spent: { rounds, tokens, legs }, // every settled attempt charged once, failures and Jev included
  carriedBy: { tier, providerId, model },
  tried: [{ providerId, model, at, error }],
  page?: { segments, selection },  // a chat tied to no tile reads from here, not the live page
  ran: string[],                   // lines that already ran in an unfinished leg (capped)
  asked: string[],                 // user turns sent while a leg ran, by signature
  asker?: string,                  // a manager ask owns this work; the runner never touches it
  next: number }                   // not before (backoff)
```

`done` replaces deletion. All four markers (archive, harness, goal, owed) share
one writer that owns the only `createWritable` and the only `removeEntry` in
`chat-thread.ts`, so both frozen counts go down. `deleteConversation` accepts
`chat-owed`. Archiving sets the record `done`.

### B. One continuer, one lock

- **The record is the only trigger.** `#continueIfLeft`, `#resumeLeft`, the
  `#left` map and `RESUME_LEFT_MS` are deleted; the turn meta's `left` is for
  display only. A budget pause no longer resumes on reopening; Stop and archive
  end the work for good.
- **One lock per conversation.** Every run — typed, manager, continuation —
  holds the Web Lock `hypercomb:convo:<id>` for its whole life. A record is
  acted on only when that lock is free in every tab; boot recovery skips a
  conversation whose lock is held elsewhere (no more "stopped" ghosts from a
  second tab).
- **The runner** sends a continue word only for `continue` records that are
  due, not archived, have no `asker`, and whose spent is under the request
  budget. It seeds the request's `#task` from `spent` and sends with
  `auto: true`, so rounds, tokens and legs accumulate across legs and after a
  refresh. A continue word never takes Jev's front door and never falls to the
  host tier.
- **Where it runs.** Phase 1: the conversation on screen (the old behaviour,
  now from the record, with no one-hour window). Phase 2: any conversation,
  once a turn takes a **turn scope** — `{ convoId, turns, model, designated,
  about, page, exclude, onScreen() }` — instead of the window's signals, so a
  background leg never swaps the view, never paints into it, and never writes
  its model into the conversation on screen. The runner lives in essentials,
  keeps its queue behind IoC for the window to drain (EffectBus replays only the
  last value, which loses or doubles runs), and starts its boot pass only after
  the window's recovery pass and the work tools are ready.

### C. The end of a turn

- **Promises.** The check reads the last paragraph, not the last line, with the
  openers widened (*I'll, I will, let me, I'm going to, we'll, next I, now I, I
  still need to, once … I'll, I'm about to*) and *let me know / if you'd like*
  excluded, and it applies at a leg's end too. First promise: one nudge round.
  Next: `continue/promised`. Third in a row: `waiting/stalled`.
- **Loops.** Two legs in a row with no work round, or the same `left` twice →
  `waiting/stalled`. The request budget stays the ceiling, now checked on every
  round (`budgetSpent` from `#spend`, not only through `decide`) →
  `paused/budget` with today's wording.
- **Every exit writes the record**: handover, failure (`continue/failed`),
  "stopped the work" (`continue/failed`), read-budget refusal, a Jev question
  (`waiting/question`), a handoff with no stronger model (`waiting/gave-up`), a
  question plus a handover (`waiting/question`, `left` kept), Stop (`done`).
  The harness's handover fence field is read, not just parsed.
- **Cut at the cap.** Dispatch normalises `length` / `max_tokens` /
  `MAX_TOKENS` to `cut` on the last chunk → `continue/cut`.

### D. Models falling off

`tried` holds provider ids. A failure — before words, after words, a dropped
connection, a stalled stream — writes `continue/failed` with backoff (30 s,
2 min, 10 min) and charges the failed attempt. The next leg routes with
`avoid: tried` **within the starting provider's credential owner**
(`fallbackWithin`, as the code already fences), never crossing to another
vendor or off the machine. When nothing in that owner is left, the record is
`waiting/gave-up`, naming the models that failed and those that could take it,
for the participant to choose. A local model's idle bound starts at its first
frame (cold loads are not cut), with a separate bound on the wait for it. An
undeclared window size uses `contextBudgetForModel`, and a 400 naming the
context folds and retries in the same leg. A failure with a session parked goes
to the bridge as `continue/queued`; the reply clears or hands it over, and a
session leaving re-routes it.

### E. Refresh

Each leg's first checkpoint merges `why: interrupted` into the record; every
`ran.push` appends to `ran`. A refresh, a closed tab or a sleeping laptop leaves
a record whose lock is free, and the runner resumes it with *"Already ran: …"*
in the continue word, so nothing is done twice. Checkpoints move to one pool
doc per conversation, so concurrent runs never overwrite each other.

### F. Waiting on you

A held act writes `waiting/held` and emits `agent:progress` `blocked`, so the
registry stops calling it stalled and the orchestrator stops calling it silent.
Holds are kept in a pool doc with their flags (forceReview, needsGrant, leaves,
foreign). Run on a restored hold opens a leg pinned to the hold's provider whose
first act runs the hold's lines through the same gates as any read or change. A
message sent while a row waits resolves it as skipped and is asked at once. A
manager still hears "held" at once, and its ask slot stays open so a later poll
gets the real end.

### G. One message at a time

A message sent while a leg runs is stored and its signature added to `asked`;
it is asked as soon as the leg ends, never joined to it. Enter is not a second
send while a reply is coming.

### H. Ownership

A manager's ask writes `asker`; the runner never runs it, and the manager hears
`left`. `chats tidy` never archives a job with a `continue` record. The bee is
not deleted when a new leg raises it inside its linger.

## Phases

1. **The record and the honest end** — A, B (on-screen continuer, lock, budget
   accumulation, front door skipped), C, H.
2. **Off screen and after refresh** — the turn scope; the runner drone; E; Stop
   from the bee; blocked status.
3. **Models falling off** — D.
4. **Waiting on you and messages** — F, G.

Every finding in the audit has a phase and gets a spec or a harness check before
that phase is called done.
