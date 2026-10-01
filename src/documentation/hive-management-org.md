# The hive's management org

jwize, 2026-10-01: *"My intention is to use Sonnet for each of the tasks for
each of the agents that I want being a manager in the hive. Each will have
their own responsibility, but have orchestrators around that collaborate and
act as a thin org to keep orchestration optimal all the time. These can be
delegated Sonnet, or even Opus/Fable in critical scenarios. The frontier model
Claude Code takes care of all management within these orchestration agents and
specific task managers."*

And: *"You don't even need to open the user interface. You have direct access
to the conversation."*

## The shape

```
the participant
   │  writes in a manager's conversation, or to Claude Code
   ▼
Claude Code (frontier)        runs the org: starts managers, reads their
   │                          reports, fixes the harness, takes what is critical
   ▼
orchestrator (Sonnet)         a thin pass: what changed, who should run, in what order
   ▼
managers (Sonnet), side by side — one area each
   games · housekeeping · harness · …
```

- **A manager owns one area** and nothing outside it. Two managers never
  write the same tile; where areas touch, the orchestrator says who goes.
- **No user interface.** A manager works through the bridge with
  `scripts/bridge/manager.cjs`. Every call is one request answered by its own
  id, so managers run at the same time without reading each other's answers.
  Nothing a manager does opens, focuses or types into the chat window.
- **Each manager keeps one conversation**, at a fixed id (the table in
  `manager.cjs`). It reports there, and what the participant writes there is
  its instruction on the next pass. The conversation is the manager's whole
  memory between passes: read it first, write it last.
- **Sonnet by default.** Opus or Fable takes a pass only when the orchestrator
  or Claude Code marks it critical: a change to code that runs, a decision
  that cannot be undone, a finding two managers disagree on.
- **Cost shape** (`feedback: crons are local ticks`): nothing here runs on a
  timer with a model behind it. A pass starts because the participant asked,
  because Claude Code is minding the hive, or because a free node tick found
  work.

## What a manager may do

| Act | Rule |
| --- | --- |
| Read tiles, notes, conversations in its area | Always. |
| Add a note, report in its own conversation | Always, in its area. |
| Create a tile | Only when its charter or the participant asked for one. |
| Rename, move, remove, edit another's words | Never on its own. It proposes; the participant or Claude Code decides. |
| Change code that runs (a module draft) | Through `ask`, with the defect and the fix stated, then read back and checked. A draft it cannot verify by reading goes up to Claude Code. |
| Private tiles (`susan`, `howard`) | Not read, not written, unless the participant names them for that pass. |
| The participant's data | Never wiped, never "cleaned" by deletion. Hide first, delete second, and both are the participant's. |

A manager that cannot do its job inside these rules says so in its report.
It does not look for another way.

## Managing conversations: the manager delegates, checks, and changes

jwize, 2026-10-01: *"They need to be managing the conversations directly and
making changes."*

A manager does not do the bulk of the work with its own hands. It runs
conversations on the hive's own models and manages them:

```
node scripts/bridge/manager.cjs ask <manager|convoId> "<request>"
```

- The request runs in that conversation through the hive's own loop, on the
  models on the hive's list — DeepSeek flash for light work, the line said to
  be deep (DeepSeek pro) for deep or code work; the hive routes by the weight
  of the request. The manager never names a vendor.
- The model reads and changes the hive itself. The conversation is trusted to
  run what it asks for without a press, because the manager answers for it.
- The call waits and prints that ask's own result: outcome, rounds, tokens,
  the answer. Several managers can ask at once; each gets its own result.
- A manager may ask in its own conversation or open a new one per job
  (any id of the form `chat:tile:/::<13 digits>-<6 letters>`); one job per
  conversation keeps the transcript small and the cost down.

**What goes down, what stays up.**

| Work | Who |
| --- | --- |
| Reading many tiles, filing notes, surveying, first drafts, a code change with a stated defect and fix | The hive's models, by `ask`. |
| Deciding what to ask, checking the result against what the hive now holds, deciding it is done | The manager. |
| A cheap model failed the same request twice; a small exact step (one note) | The manager, directly (`note`, `do`). |
| A harness defect, a critical decision, a disagreement | Up to Claude Code. |

**Never take the model's word.** "Done" in an answer is a claim. After every
`ask` that changes something, the manager reads the tiles or notes itself
(`read`, `notes`) and reports what is actually there. A model that says it
filed six notes and filed none is a harness defect: report it, with the
conversation id.

**Write requests a cheap model can follow:** one job, the exact routes, the
exact words to file, what not to touch, and what to answer with.

## A pass

1. `manager.cjs thread <self> 6` — what was last reported, and anything the
   participant wrote since.
2. Survey the area (`tree`, `read`, `notes`). Compare with the charter.
3. Delegate the work (`ask`), check each result by reading, and do the small
   exact steps directly. Keep a list of what was done and what is proposed.
4. `manager.cjs report <self> "<report>"` — short: **done**, **found**,
   **proposed** (each needing a yes), **blocked**. No narration.
5. Return the same report to whoever started the pass.

## The managers

### orchestrator
Keeps the org thin. Reads every manager's last report and the hive's root,
and answers three questions: what changed since the last pass, which managers
should run now and in what order, and what must go up to Claude Code as
critical. It does no area work itself and writes only in its own conversation.

### games
The games on the hive: Bubble Bobble (`/bubble-bobble-dos-v1`, `/games`),
Solomon (`/solomon-maze-v1`), Arkanoid. Each game's requirements live as notes
on its tile; the manager keeps those notes true — what is met, what is
partial, what a draft changed — and reports defects with the evidence. It
never runs DOS material. A code fix goes through `ask` with the defect and the
fix stated, and is read back before it is reported.

### housekeeping
The order of the hive outside the games and the private tiles: tiles with no
notes that should have one line saying what they are, duplicate notes, notes
filed on the wrong tile, a stray prefix left by a tool. It fixes by adding;
anything that needs a rename, a move or a removal is a proposal.

### harness
The hive's own agent: how the cheap models did. It reads the conversations
the hive's agent ran, the Execution column's held rows and the last failures,
and reports each miss as a harness defect — what was asked, what the model
did, what the harness should have done. It changes nothing; Claude Code fixes
the harness.

## Adding a manager

One line in `MANAGERS` in `scripts/bridge/manager.cjs` (its conversation id),
one charter section above. Nothing else learns its name.

## Making a task

`/hive-task <what should be done or looked after>` (the skill in
`.claude/skills/hive-task/`) turns a request into a task that works the
moment it is pasted into a new Sonnet session: it checks the routes against
the live hive, picks the manager (or adds one), and fills the brief — job,
where, what done means, how to delegate, limits, the pass. A one-off job gets
a conversation of its own: `node scripts/bridge/manager.cjs convo`.

## Running the org from one session

One Claude Code session — the frontier one — holds the org. Managers run
under it as background Sonnet agents (`/hive-task … run it`), a few at a
time, each in its own area; their reports come back to that session and land
in their conversations in the hive. A manager gets a session of its own only
when jwize wants a long back-and-forth with it.

- **Three at once is the ceiling for now.** The hive's models share one
  upstream pool; more asks at once only buys "busy" answers.
- **The managing session checks before it repeats.** One "done" claim per
  report is read against the hive.
- **A model that invents is taken off the list.** A fast line answered a
  question about the hive without reading it and named tiles that do not
  exist (2026-10-01); it was dropped (`models drop`), and the same question
  then went to a line that read first.
