# Quiet landing

*The bridge's answer lands in the hive. The surface does not move until you ask it to.*

## The complaint

An ask raised from a tile used to cost the participant their place. The payload
came back, the layer was minted, the lineage changed, and the canvas re-walked
underneath whatever they were doing. One answer, one flicker. A drained batch of
twenty writes, twenty flickers — while they were still working in the hive.

## The split

The write and the paint are two different things, and only one of them is urgent.

- **The write is never deferred.** The layer is minted, the note is on the cell,
  the resource is in the pool, at the moment the payload arrives. Nothing about
  quiet landing makes the hive less true, and nothing is buffered in memory
  waiting to be flushed. A crash mid-window loses no writes.
- **The paint is held.** The canvas keeps showing what the participant was
  looking at, and a badge tells them something arrived.

## The three channels

No new service. `EffectBus` is in core, so a module and the shell both speak it
without the module ever importing the shell, and last-value replay makes mount
order irrelevant.

| Channel | Payload | Who emits |
|---|---|---|
| `landing:quiet` | `{ active, source, writes }` | the producer, bracketing a burst |
| `landing:pending` | `{ count, where }` | the renderer, publishing what is unseen |
| `landing:apply` | `{}` | the badge, on tap |

Any future background writer becomes quiet by bracketing its own burst. Nothing
in the renderer or the badge knows what a bridge is.

## The producer owns the window

`ClaudeBridgeWorker` wraps its dispatch. A **mutating** op opens a window; a
read-only op never does — a `list` arriving mid-burst must not extend somebody
else's window.

The window is **depth-counted**, so twenty writes in flight are one window, and
it closes on a **settle delay** (400ms) rather than at the last op's return. The
commit machine flushes its markers just *after* the handler resolves; closing on
the dot would let that trailing lineage change through as exactly the flicker
this exists to prevent.

The producer also carries its own **write tally**. The badge shows writes, never
held paints — paints coalesce, so counting them would under-report, and a number
shown to a person has to mean what it says.

## A write's consequences arrive as a chain, not an event

This is the part that is not obvious, and the part every naive version gets
wrong.

The producer's window covers the *write*. What follows is a **chain**: the
commit flushes its marker, then the readiness repaint fires as each new tile's
visual resolves, then the optimize tick. Measured on one three-tile burst,
render requests arrived at **8ms, 36ms, 204ms, 353ms, 407ms, 659ms and 929ms**,
from **seven different call sites** — `onLineageChange` under `#add`,
`onSynchronize` under `act()`, `onLineageChange` under `#commit`, and
`#scheduleReadinessRepaint`'s own 30ms self-scheduler.

Two approaches fail here:

- **A longer settle on the producer.** No fixed delay covers a chain whose
  length depends on how many visuals have to resolve.
- **Tagging the callers.** The chain reaches `requestRender` through paths that
  look exactly like a participant's, and `#scheduleReadinessRepaint` arms
  `#forceNextRender` and re-schedules itself — so an early version that armed
  the force *while holding* built itself a 50ms repaint loop that fired the
  instant the window closed.

So the renderer **measures the chain instead of guessing at it**. While paints
keep being held, the landing is still landing; once nothing has been held for
`#CASCADE_QUIET_MS` (1.5s), the chain is done and the next paint belongs to the
participant. Location is the other half: a pass at a *different* location is the
participant walking somewhere, and always paints.

## Held is not dropped

The force is armed on **release**, never on hold. The pass that spends the badge
must actually run — the held change is at the *same* location, so the
unchanged-page fast path at the top of `renderFromSynchronize` would otherwise
return having done nothing and the badge would clear over a surface that never
moved. Arming it on *hold* instead is what fed the repaint loop above.

## The badge means "you have not seen this"

Never "this is not written". It outlives the burst, and a render that happens
for any *other* reason — they panned, they walked into a layer, they edited
something — has already shown them what landed, so that pass clears the count on
its way through.

## One release, and it is theirs

Tapping the badge is the only thing that applies a held change. **No idle timer,
no auto-apply on navigation.** A repaint the participant did not ask for is the
whole complaint; a mechanism that eventually does it anyway has not fixed
anything.

## Parts

| File | Role |
|---|---|
| `hypercomb-essentials/src/presentation/tiles/show-cell.drone.ts` | the hold + the cascade measure |
| `hypercomb-essentials/src/assistant/claude-bridge.worker.ts` | the window |
| `hypercomb-shared/ui/landing-badge/` | the badge |
| `hypercomb-shared/ui/shell-surfaces/shell-surfaces.barrel.ts` | the mount |

## Proving it

`scripts/drive-quiet-landing.cjs` drives its own Playwright profile (a scratch
hive, never the participant's) and judges the **scene, not the picture** —
headless has no GPU, so Pixi's shaders never compile and a screenshot proves
nothing. It reads `render:cell-count` through the bridge's `effect-last` op and
asserts the labels are unchanged across a burst, that the badge appears with the
right count, and that the tap brings all three tiles onto the surface.

**Precondition: the broker must have exactly one renderer.** With a second tab
or a stale Playwright page also attached, the writes and `effect-last` can be
answered by different renderers and every reading is meaningless.
