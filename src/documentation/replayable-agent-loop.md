# The replayable agent loop

> **status: built.** `assistant/chat-steps.ts` (the record), `claude-bridge.worker.ts`
> (the writer and the read path), `scripts/bridge/loop-run.cjs` (the responder's
> side). Specs: `assistant/chat-steps.spec.ts`.

An agent working in the hive is a loop: it is asked something, it takes steps,
it answers. Two thirds of that was already durable. The turns are stored — one
manifest per turn in the conversation's bucket, the text a content resource
([chat-thread.ts](../hypercomb-essentials/src/assistant/chat-thread.ts)). The
effects are stored — layers, markers and notes, in history, where they belong.

The **steps** were not stored at all. `agent-progress` said so in its own
comment:

> Read-only as far as the hive is concerned: this writes no layer, no note and
> no record — it moves a UI needle and nothing else.

That is delivery-by-event, which is the exact pattern `chat-thread.ts` was
written to kill for replies:

> WRITE THE RECORD, THEN ANNOUNCE IT. Never the announcement as delivery.

So the loop had a durable beginning and a durable end, and a middle that lived
only in the memory of whichever process happened to be running. Kill the
responder and it cannot know which of its steps landed. Reload the browser and
the trail is empty. The orchestrator's `silent` and `rogue` findings are
inferences about state that no longer exists. The hive could say what an agent
last **claimed** it was doing, and never what it **did**.

## What was added

One record — the **step** — and one field on the requests a responder already
sends.

```jsonc
{
  "kind": "chat-step",
  "convoId": "chat:tile:/dolphin/site",
  "runId": "run-7f3a",          // the loop; chosen by the responder, opaque
  "seq": 4,                     // position in the run — THE ordering authority
  "verb": "note-add",           // the bridge op invoked
  "at": 1757000000000,          // stamped by the BROWSER, never the responder
  "outcome": "ok",              // or "failed"
  "contentSig": "9f2c…",        // the request, as a root content resource
  "sigs": ["a41b…"],            // signatures the op RETURNED — pointers into history
  "errorSig": "3d70…"           // the reason, when it failed
}
```

## Why this is not a parallel log

Trails are a view over history, never a second record free to disagree with
it — the moment the trail is its own truth it can contradict history, and then
it is a chat app. A step obeys that rule because of a distinction the system
had not previously needed to draw:

> **History records EFFECTS. The ledger records ATTEMPTS.**

A step says *"at T, in run R, as step N, I invoked verb V, and it worked or it
did not."* It never says what changed. The layer, the marker and the note
remain the only place that lives, and a step reaches them by **pointer**
(`sigs`), never by copying them. The two records describe different things, so
there is nothing for them to disagree about.

The clearest case is the one that motivated it: **an attempt that failed leaves
no trace in history at all.** That absence is not a gap to be filled by
duplicating history — it is information only the ledger can hold, and it is
exactly what a resuming responder needs to read.

## Where the bytes live

Inside the conversation's own bucket in the `sign('threads')` pool, in a
directory named `sha256('chat-steps')` — the same trick the archive and goal
markers use, one level up. One file per step, named by the hash of its own
bytes.

```
sign('threads')/
  <sha256(convoId)>/               ← the conversation's bucket
    <sha256(turn bytes)>           ← turns, as before
    <sha256('chat-archived')>      ← markers, as before
    <sha256('chat-steps')>/        ← the ledger
      <sha256(step bytes)>         ← one file per recorded attempt
```

A **directory** rather than more files beside the turns, for two reasons that
are both about not disturbing what already works:

- **Every existing reader skips it.** `readBucketRaw` walks a bucket under
  `if (handle.kind !== 'file') continue`, so a build that predates the ledger
  cannot see it, let alone mistake a step for a turn. Data never heals: older
  versions keep working, untouched, and a hive that downgrades loses the trail
  rather than the thread.
- **The conversation list stays cheap.** That walk reads files until it finds
  one parseable turn. A busy run's steps sitting beside the turns would put
  hundreds of files in front of that probe, per thread, forever. (Frozen by a
  spec: forty steps, and the list still reads at most two files.)

### The one reader that had to be taught

`deleteConversation` proves that every entry in a bucket is that
conversation's own before it removes anything, and **refuses outright on a
subdirectory it cannot account for**. Left alone, the ledger would have made
every conversation an agent ever worked in undeletable.

It is now taught the ledger by name and holds it to the same standard: every
record inside must name this conversation, or the delete still refuses. The
files are then removed one at a time and the emptied directory after them —
never a recursive sweep, for the same reason the turns get none.

## Append-only, settled on read

A step file is named by the hash of its own bytes, so **writing the identical
step twice writes one file**. Replaying a step is free, which is what lets a
resumed run be approximate about where it stopped.

A **retry** is not identical — its outcome, or its clock, differs — so it lands
as a second record. The ledger shows the attempt that failed *and* the one that
worked, which is more honest than overwriting. `settle()` reduces by `seq` when
a caller wants only the outcome that stands: later `at` wins, and on a tie the
attempt that succeeded does.

Order inside a run is `seq`, assigned by the writer. Never the clock — `at` is
a label, and the bridge stamps it from the browser, so a responder's machine
clock cannot skew a run at all.

## The bridge contract

Every op a responder sends already passes through one chokepoint, so the
recording is a byproduct rather than a discipline:

```js
run: { convoId: 'chat:tile:/dolphin/site', id: 'run-7f3a' }
```

Put that on the requests you already send. That is the entire cost. The steps
you forgot you took and the ones that failed are recorded exactly like the
rest. A request with no `run` records nothing and behaves precisely as before.

Two ops are deliberately **not** steps: `thread-read` (reading the log is how
you rejoin the loop, not a move within it) and `agent-progress` (the
announcement half of the pair — recording it would fill the ledger with the
chatter the record exists to replace).

`seq` is claimed by the bridge, seeded from the ledger on a run's first op, so
a page reload continues the count instead of restarting it and overwriting the
run's own history.

## Reading it back

`thread-read` returns the loop when asked, and only when asked — every
existing caller gets byte-identical output.

```jsonc
{ "op": "thread-read", "cell": "<convoId>", "steps": true, "runId": "run-7f3a" }
→ { "convoId": "…", "turns": [ … ], "steps": [ … ] }
```

Turns say what was said; steps say what was done and what failed. One call, so
a restarted responder reconstructs its whole loop from the record instead of
from memory it no longer has.

From a script, [`loop-run.cjs`](../scripts/bridge/loop-run.cjs):

```js
const { openRun } = require('./loop-run.cjs')
const run = openRun({ convoId, runId: 'run-7f3a' })   // a STABLE id, or resume is impossible

const { landed, nextSeq } = await run.resume()        // where the last process got to
if (!await run.alreadyDid('note-add')) {
  await run.act('note-add', { cell: '/dolphin', text: answer })
}
```

## What this does not do

- **It does not make an agent's work transactional.** A step records that an
  op was attempted and how it ended. If a responder dies between two ops, the
  hive is in the state the first one left it — the ledger tells you that
  truthfully, it does not roll anything back.
- **It does not decide what a resume should skip.** `alreadyDid` is a blunt
  guard over verbs; whether repeating a step is safe is the responder's
  judgement, because only it knows whether the op is idempotent.
- **It does not police two responders sharing one `runId`.** That is a caller
  error; the ledger records both, and their `seq` values will interleave
  visibly rather than silently.
- **It is not an agent API.** The bridge remains a local dev shortcut, not the
  access model — an agent is still just a participant. See
  [agents.md](agents.md).
- **It stores no effects.** If you want to know what changed, follow `sigs`
  into history. That is the only place the answer exists.
