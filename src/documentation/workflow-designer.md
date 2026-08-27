# Workflows and skills — every step is a tile

**Status: BUILT (2026-07-26), professional editor upgrade 2026-08-26.** Companions:
[selection-tool-windows.md](selection-tool-windows.md) (the tool-window
pattern), [meaning-loop.md](meaning-loop.md) (the ask gate a workflow
obeys), [aggregation-layer-model.md](aggregation-layer-model.md),
[insights.md](insights.md) (the bounded scope a workflow will take),
[shell-surfaces.md](shell-surfaces.md).

## The rule

> "These are all mapped to tiles so that we can have different types and do
> what we normally do. This has to be the concept for all creations — they
> are always tiles, as part of the hive. This way we can start creating
> skills for the hive."

A workflow is not a new document format. **A workflow is a cell, and its
steps are its child tiles.** Everything that follows is a consequence.

| The thing | What it already is |
|---|---|
| the workflow | a cell, with a `workflow` slot naming it |
| a step | a child tile, with a `visual:workflow:step` decoration |
| default step order | the parent's `children` order (legacy-compatible) |
| explicit routes | the source step's optional `next` target list |
| node layout | the step resource's optional `position` |
| the step's kind | a `WorkflowStepRegistry` key; nearly always `command` |
| a nested workflow | a step tile that has children of its own |
| a **skill** | a workflow with a name — a `NameRegistry` entry |
| sharing a skill | ordinary adoption, `adoptScope: 'hierarchy'` |

Because a step is a tile, a step can be renamed, noted, tagged, given a
picture, dragged into a different order, undone, hidden, made public,
published and adopted — with no workflow-specific code for any of it. That
is the entire argument for the design.

## What is deliberately absent

- **No central edge table.** Legacy workflows still follow tile order. When a
  participant draws routes, each content-addressed source step owns its own
  `next` contract; `next: []` is an explicit terminal.
- **No second workflow database.** Foblex Flow renders and edits the graph,
  while DCP tiles and step resources remain authoritative.
- **No run state in the layer.** Which step is running is participant-local
  and transient — the same rule as viewport and clipboard. Putting it in a
  layer would change the workflow's signature every time anybody ran it, so
  your copy and mine would diverge for no reason.
- **No skill format, no skill store, no skill registry.** A skill is a
  subtree of tiles with a name.

## The records

### `workflow` layer slot — this cell is a workflow

```jsonc
// the slot holds one sig; the record it points at:
{ "v": 1, "name": "onboard a peer", "description": "…", "at": 1785000000000 }
```

A slot rather than a pool because a workflow must be undoable, must travel on
adoption, and must sit inside the merkle so its signature covers its steps
(the snapshots-slot argument, applied again). Written with
`LayerCommitter.update`, which leaves every other slot alone.

### `visual:workflow:step` decoration — this tile is a step

```jsonc
// decoration payload — a POINTER, per the expansion doctrine
{ "stepSig": "…" }

// the step resource
{ "v": 1, "kind": "command", "command": "note", "args": "welcome {cell}" }
```

Two steps that say the same thing are the same signature, so a workflow
adopted by a peer deduplicates against steps they already hold.

`replaceDecoration()` (decoration-manifest.ts) keeps exactly one live step
record per tile; superseded ones stay reachable through the tile's history
markers, which is what makes *"what did this step used to do?"* answerable.

## The step vocabulary is mostly not written down

The hive already has a complete, self-extending list of things it can be told
to do — its slash commands. `SlashBehaviourDrone.entries()` is that list and
`execute(name, args)` runs one. So the `command` kind covers nearly
everything, and **the palette grows whenever a module ships a queen**, with no
registration in the workflow module and no change to any file here.

The registry declares only the kinds that are about the workflow rather than
about the hive:

| kind | what it does |
|---|---|
| `command` | run a slash command with arguments — the workhorse |
| `sub` | run this step tile's own children as a workflow (depth-capped at 4) |
| `note` | write a line onto the step's tile as the run passes through |
| `ask` | hand a question to an AI pass — see below |

A module may add a kind with `register()` and its own `run`. It never has to.

### Argument tokens

`{cell}` (the step tile's name), `{workflow}`, `{scope}` (the workflow's
path), `{step}` (1-based position). Unknown tokens are left alone, so a step
whose argument legitimately contains braces is not silently eaten.

## Running

`/workflow run`, or the designer's ▶. The runner walks the child tiles in
canvas order and executes each step's record. Per-step status is broadcast
live on `workflow:run-state` (sticky).

Three rules the runner does not bend:

1. **A run never navigates.** Steps run where the participant stands; a step
   that needs to name a target uses `{scope}` in its arguments. Yanking the
   canvas mid-run is how a helpful automation becomes one you stop trusting.
2. **A failure stops the run** unless it was started continue-on-error. A
   workflow whose third step failed has not done what its name says.
3. **An `ask` stops the run**, reporting `asked` rather than `done`.

### The ask gate — why a workflow is not an agent

An `ask` step deposits an `ai:request` record (`status: 'pending'`,
meaning-loop.md §2 verbatim) on its tile and **stops**. The pheromone sweep
finds it, mints a feedback-window question, and generation begins only from the
participant's own answer.

*Ask before creating. Always.* A workflow is a script the participant wrote,
and that is still not authorization for a language model to go and build
something. Because the record shape is the meaning loop's, the routine that
already drains these needs no change to drain a workflow's.

## The tool window

`/workflow` opens `hc-workflow-designer` as a wide, left-docked authoring
studio. Its graph surface is Foblex Flow, embedded directly in Hypercomb:

- **library** — every registered control kind and slash command, searchable
  and available without teaching the editor about particular step types;
- **graph canvas** — pan, zoom, fit, snap-to-grid, multi-selection, keyboard
  deletion, draggable nodes, and connectable routes;
- **inspector** — the selected step's kind, command, arguments, position, and
  outgoing routes;
- **run bar and log** — run, step, stop, and live status on the same graph;
- **naming** — turns the current workflow into a reusable skill. At the hive
  root it mints the workflow tile before declaring it.

Foblex owns interaction and rendering only. DCP remains authoritative: the
designer renders `workflow:state` and emits effects; it does not maintain a
second workflow database.

### Graph persistence

Every node remains a workflow child tile. Editor position is stored on that
step as `position`, and outgoing routes are stored on the source step as
`next`. There is no central edge table. Missing `next` preserves older linear
workflows by routing to the next sibling; `next: []` marks an explicit terminal
step. This keeps old workflows valid while allowing branches and cycles to be
expressed visually.

### Step tiles render as their kind

A step is a cell, but inside a workflow it should not *look* like a generic
cell — it should look like what it does. `WorkflowAuthorDrone` contributes one
overlay icon provider per registered kind, each gated on "this tile is a step
of that kind", so the tiles on the hive carry the palette's own mark: a
terminal for a command, a question for an ask, a tree for a sub-workflow.
Existing overlay path, no new render code, and it costs nothing on a page that
is not a workflow because the gate is a lookup in an empty map there.

It reads nothing itself. `WorkflowAuthorDrone` is the one reader and
broadcasts `workflow:state`; the window renders that and emits intents back
(`workflow:declare`, `workflow:step-add`, `workflow:step-set`). Shell UI must
not import essentials, and a second reader would drift from the runner's.

Selection is a notification, per selection-tool-windows.md: clicking a step
tile on the hive focuses it in the inspector.

## Effects

| effect | direction | payload |
|---|---|---|
| `workflow:view-open` / `:view-close` | → panel | — |
| `workflow:state` | drone → panel (sticky) | the workflow, its steps, the skill list |
| `workflow:palette` | drone → panel (sticky) | palette entries |
| `workflow:declare` | panel → drone | `{ name, description? }` |
| `workflow:step-add` | panel → drone | `{ segments, step, name? }` |
| `workflow:step-set` | panel → drone | `{ segments, step }` |
| `workflow:step-move` | panel → drone | `{ segments, position }` |
| `workflow:connection-set` | panel → drone | `{ segments, targets }` |
| `workflow:step-drop` | panel → drone | `{ segments, step, name?, x, y }` — release point |
| `workflow:run` | → runner | `{ segments, stepThrough?, continueOnError? }` |
| `workflow:run-next` / `:run-stop` | → runner | — |
| `workflow:run-state` | runner → panel (sticky) | progress + per-step results |

## Commands

```
/workflow                 open the designer
/workflow new <name>      make the cell you are standing in a workflow
                          (at the hive root: mint a tile and walk into it)
/workflow run [name]      run it — or a named skill, from anywhere
/workflow step            run it one step at a time
/workflow stop            abandon the run in progress
/workflow list            every named workflow the hive can reach
```

Aliases: `/flow`, `/skill`.

## Not yet built

- **Insight scope.** A workflow runs at one location. `insights.md` §2 is the
  set-valued scope it wants: *run this skill over exactly these regions.* The
  ask screen already builds an anonymous insight and throws it away.
- **Triggers.** "Turning a behaviour on is always a deposit, never an action"
  (meaning-loop): a triggered skill is a pheromone the sweep recognizes, minting
  an ask-gate question — never a workflow that fires itself.
- **A persisted run log.** Live-only today. If it is ever persisted it belongs
  in a pool of meaning — `sign('workflow:runs')`, with the colon that keeps a
  pool address out of the bare-word collision space
  ([known-location-pools.md](known-location-pools.md)) — and never in a slot.
- **Conditional expressions.** Explicit graph branches run every reachable
  route once today. A future conditional route must be
  a predicate the hive already has (a pheromone, a tag filter, the hidden pool)
  — not a second selector language.

## Legacy workflow view

`WorkflowViewDrone`, the earlier full-screen SVG workflow view, remains
registered for compatibility with callers that request it explicitly.
Opening `/workflow` no longer switches `ViewMode`: the embedded Foblex studio
is the authoritative authoring surface. The legacy view can be removed after
downstream callers no longer depend on its mode.
