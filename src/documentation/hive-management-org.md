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
| Change code that runs (a module draft) | Never on its own: it describes the defect and the fix, and Claude Code takes it. |
| Private tiles (`susan`, `howard`) | Not read, not written, unless the participant names them for that pass. |
| The participant's data | Never wiped, never "cleaned" by deletion. Hide first, delete second, and both are the participant's. |

A manager that cannot do its job inside these rules says so in its report.
It does not look for another way.

## A pass

1. `manager.cjs thread <self> 6` — what was last reported, and anything the
   participant wrote since.
2. Survey the area (`tree`, `read`, `notes`). Compare with the charter.
3. Do what the rules allow. Keep a list of what was done and what is proposed.
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
never runs DOS material and never edits game code.

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
