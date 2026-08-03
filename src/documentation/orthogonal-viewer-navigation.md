# Orthogonal viewer navigation

Three axes, and none of them ever means what another one means.

| Axis | Gesture | What it moves |
|---|---|---|
| **Within** | up / down | the next thing *inside* the viewer — the next slide, the next picture, the next section |
| **Across** | sideways | the next **tile** along the row you came from, **staying in the same viewer** |
| **Between** | the tile close-up | **which viewer** you are in |

A phone user already knows the first two: a feed scrolls one way and changes
subject the other. What the hive adds is that the subject is a **tile** and the
viewer is a **choice** — so the sideways step has to answer a question a feed
never has to.

## The sideways rule

Stepping sideways from tile A to tile B, in viewer V:

- **B has V** → open V on B. You never leave the viewer; the deck you were
  reading becomes B's deck. Implemented as a **re-target in place**, not a
  close-and-reopen, so the hive never flashes between steps.
- **B has no V** → open **B's close-up**. You have not been dumped back on the
  hive; you have been handed the menu for where you now are, with its viewers
  at the top of the column under **open as**.

That second case is why the close-up leads with what the tile can be *opened
as*: an arrival from a sideways step is a question, and that block is the
answer to it.

## Where it lives

`presentation/tiles/viewer-walk.ts` — the whole spine, and the only definition
of each of its three answers:

| Question | Answer |
|---|---|
| what row am I on? | `render:cell-count`'s labels, tracked once at module scope |
| does that tile carry this viewer? | `hasDecorationKind(label, bee.decorationKind)` for the **registered** bee |
| how do I open myself over there? | the bee's own `view-enter:<view>` action, routed by `visual-bee-icons` |

```ts
const target = walkFrom(label, view, delta)      // decide
if (!target) return                              // nowhere to go
landOnWalkTarget(view, target, () => closeMe())  // land — closeMe runs ONLY
                                                 // when the next tile lacks it
```

`bindAxes(host, { vertical, sideways })` binds both axes with a 1.4 dominance
bias, so an ambiguous diagonal favours the viewer's own axis: turning a page by
mistake costs one flick back, arriving on another tile costs your place.

## The scroller — ↕ as real physics

`presentation/tiles/viewer-scroller.ts` is the **within** axis implemented as
the browser's own scrolling instead of a synthetic threshold-and-commit step:
one full-viewport snap section per item, native momentum, `scroll-snap-stop:
always` so a flick lands exactly one item on. It is generic — hand it sections
(`{ key, title, resolve }`), listen for the index; nothing in it knows what a
slide is — so **any** viewer whose vertical axis means "the next thing inside
what I'm looking at" can become a scroller.

The grammar survives untouched because the two implementations compose:
`touch-action: pan-y` on the scroll container hands vertical drags to the
browser (which cancels the pointer stream, so `bindAxes` never commits them)
and lets horizontal drags through to the host, where `bindAxes(host,
{ sideways })` still walks the row. ↕ scrolls, ↔ walks, and neither handler
ever sees the other's gesture.

Feed rules the scroller owns: content resolves lazily (about one viewport
ahead), whatever plays pauses when its section scrolls away, and an iframe
embed mounts on **tap** (placeholder card first) and unmounts on leave — a
full-viewport iframe would swallow the scroll gesture and only stops playing
when it leaves the DOM.

First adopter: `slides-view.drone.ts`, which mounts the scroller **instead of
the paged stage while the mobile experience is active** (MobileModeService) —
tap a deck's view on a phone and you are in a vertical scroller; flick
sideways and the next tile's deck scrolls under the same chrome. Desktop keeps
the stage: a mouse steps, a thumb scrolls.

## Nothing is hand-listed

A behaviour that registers with `VisualBeeRegistry` gets the sideways walk for
free — the row does not know what a deck is, and `viewer-walk` does not know
what any particular viewer is. A behaviour nobody has written yet will work the
same way.

## Adopters

- **`tile-view.drone.ts`** — the close-up. Sideways = next tile (there is no
  viewer to keep). Shares the row through `nextTile`.
- **`slides-view.drone.ts`** — decks and the lightbox. Up/down turns the page,
  sideways walks the row. `Shift+←/→` is the same walk for a keyboard; the bare
  arrows keep the presentation convention, because a deck that stopped
  advancing on `→` would be a worse deck.

Sideways is offered only for a **targeted** open (a viewer opened *for a tile*).
A bare `/present` of wherever you are standing has no row — you are inside the
deck cell, not beside it — and `walkFrom` returns null there.

## Still to adopt

`site-view`, `tutor-view`, `wave-view` and `living-brief-view` have not been
wired yet. Each needs the same three lines in its mount and its own `closeMe`.
