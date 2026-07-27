# Workflows and skills — every step is a tile

**Status: BUILT (2026-07-26), first slice.** Companions:
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
| the step ORDER | the parent's `children` order — nothing else |
| the step's kind | a `WorkflowStepRegistry` key; nearly always `command` |
| a nested workflow | a step tile that has children of its own |
| a **skill** | a workflow with a name — a `NameRegistry` entry |
| sharing a skill | ordinary adoption, `adoptScope: 'hierarchy'` |

Because a step is a tile, a step can be renamed, noted, tagged, given a
picture, dragged into a different order, undone, hidden, made public,
published and adopted — with no workflow-specific code for any of it. That
is the entire argument for the design.

## What is deliberately absent

- **No edge list, no `next`, no `index`.** The order is the tiles' order.
  A second copy would drift the first time somebody dragged a tile.
- **No node-graph canvas in the tool window.** The hive *is* the graph. A
  second rendering of tiles you are already looking at would be a worse one,
  and would disagree the moment you moved something.
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

`/workflow` opens `hc-workflow-designer` — a registry-fed shell surface
(never an `<hc-*>` tag in an app.html), docked **left**: you drag out of the
palette and into the sequence on the canvas to its right, so the source sits
before the target. It holds the four things the canvas cannot:

- **palette** — every control kind and every slash command the hive currently
  answers to. **Drag one onto the hive** to place it: drop on empty space to
  add a step at the end, drop on a step tile to make that step this kind.
  (Clicking a row is the keyboard/touch path — it re-types the selected step,
  or appends when nothing is selected.)
- **inspector** — the selected step's kind, command and arguments. Which
  fields it offers comes from the palette entry, so the window knows nothing
  about any particular kind.
- **run bar** — go, one-step-at-a-time, stop, with live status on each step.
- **naming**, which is what turns a workflow into a skill. At the hive root —
  which has no tile of its own — the same field MINTS a tile, declares it, and
  walks you into it. Standing somewhere that cannot itself become a workflow
  is a reason to make one, never a reason to refuse.

An empty workflow opens the palette on its own (its one useful control would
otherwise be folded shut under "No steps yet. Add one below"). It only ever
opens, and stops once you work the toggle yourself.

### The drag

Pointer events, not HTML5 drag-and-drop — the drop target is a WebGL canvas
with no DOM nodes to land on. The tile under the release is resolved from
**release coordinates** via `TileOverlayDrone.labelAtClient`, never a
remembered `tile:hover`, which nulls the moment the pointer crosses chrome and
every drag out of a docked panel does exactly that. Only a tile that is a step
*of this workflow* is a re-type target; a drop on anything else adds a step.
Releasing back over the panel is a cancel.

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
- **Reordering from the panel.** The steps list mirrors the canvas order but
  cannot change it — dragging tiles on the hive is how you reorder, which is
  correct (one truth) but means the panel is read-only about order.
- **Conditionals.** No `branch` kind yet. When one lands, its condition must be
  a predicate the hive already has (a pheromone, a tag filter, the hidden pool)
  — not a second selector language.

## The workflow surface — a wide canvas, not hexagons

A honeycomb says *these are siblings*. That is true of a workflow's steps and
useless about them, because the one thing a workflow is is an **order**. So a
workflow gets its own render of the same layers — `WorkflowViewDrone`, the
same shape as the website and tutor takeovers, driven by `ViewMode`.

- **The flow runs left → right** and the stage grows with it, **scrolling**
  rather than shrinking. Fit-to-width is a button, never the default: a
  20-step skill squeezed into 900px is not a diagram.
- **It docks beside the designer**, not under it — the canvas starts where the
  palette ends, so the two are usable together.
- **One node per step**, in `children` order, joined by connectors, each
  carrying its position, tile name, kind, and what it will actually do. A step
  with children says it has its own steps.
- **A run colours the nodes live** — the same hues as the panel's dots —
  so you watch the run walk the flow.
- **Every node carries `data-workflow-step="<cell>"`.** That is what lets the
  palette drag land on a node here exactly as it lands on a hexagon: the panel
  reads the element under the release point and hands the drone an explicit
  label. On the hex grid there is no such element, so there the release point
  resolves through `TileOverlayDrone.labelAtClient`. One drag, either surface.
- **Clicking a node** emits `workflow:step-focus`; the designer's inspector
  follows it. SVG nodes never travel through tile selection, so the surface
  reports its own clicks.

Opening the designer on a workflow switches the surface automatically, and
only from `hexagons` — someone who deliberately put the hive in another view
has said what they want to look at, and a panel must not overrule that.
Walking off a workflow returns you to hexagons rather than stranding you on an
empty flow. Escape or right-click leaves; the takeover is claimed through the
owner-counted `ModeRegistry`, which is the only thing allowed to broadcast
`view:active` (a doctrine ratchet enforces it).
