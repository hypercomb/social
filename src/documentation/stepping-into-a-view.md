# Stepping into a view — and coming back out where you came in

A view's icon on a tile is a **step-in**: one gesture that does two things.
It walks the explorer to the view's ENTRANCE — for a branch-scoped behaviour
(the tree, a website) that is the marked ROOT of the branch, which can be
several rings away from the tile that was clicked — and then flips the
surface. The walk exists so the renderer has the right floor under it, and it
is invisible while the view is up.

It is still a move, and it used to be the move you were left standing on.
Click the tree icon on `behaviors` from a deck three rings away, press
Escape, and you were on the behaviors root staring at raw hexagons: the page
you came from and the surface you were looking at were both gone.

**A stepped-into view is not a place you walked to.** It is a surface that
TOOK OVER, spawned from wherever you were standing and whatever you were
looking at. So leaving has exactly one destination — **the page that spawned
it, in the view that spawned it** — and nothing about it is derived, walked,
or guessed. Same rule as a website (`embedded-sites.md` → *Coming back out*);
only the way the record is MADE differs.

## The record travels as an effect

A website captures its own spawn when the mode flips, because nothing moved
it. A stepped-into view cannot: by the time the surface flips, the walk has
already happened and "where you stood" is no longer readable from the
lineage. So it has to be TOLD, before the walk:

```
visual-bee-icons.ts  →  EffectBus.emit('view:spawn', { view, mode, segments })
                        …then goRaw(entrance), then setMode(view)
```

`segments` is where the participant stood; `mode` is the surface that was up
('' = the hexagons). The rule that reads it is `view-spawn.ts` — pure, so the
destination can be pinned without standing up a renderer:

| Record | Leaving lands on |
|---|---|
| a step-in from the hexagons | the page the icon was clicked from, on the hexagons |
| a step-in from another view | that page, with that view restored |
| no record (typed command, header toggle, arrival face) | stays put — nothing stepped anywhere |

**The record must not live in a module variable.** EffectBus is the one
singleton every separately-bundled bee shares; a file inlined into two bee
bundles is two copies of its module state, and the record would never arrive.

## What a receiving view owes

`TreeViewDrone` is the first receiver, and the shape is general:

- **Gate on the view name** (`spawnForView`) — one effect carries every
  view's step-ins.
- **Ignore the subscription's own replay** — a boot replay is not a live
  step-in, or a session inherits a spawn from before the reload.
- **Latch the session** — restore only when a session of THIS view was
  actually up, so an unrelated mode flip never moves anyone.
- **Only exits to the hexagons** — a flip onto another view is a change of
  face on this cell, not a way out. Every exit path (Escape, right-click, the
  toolbar button, `/tree off`, the toggle) already names the hexagons, so no
  exit has to be rewired.
- **Surface first, then place** — while the mode still reads the view, an
  arrival at the destination would be judged as walking out of the branch and
  released to the hexagons underneath you. Restoring the surface
  synchronously also means no flash of the default face on the way.
- **Move with `Lineage.explorerReplace`** — the whole reading of a tree costs
  the single history entry that entered it.
- **Travel outranks the way back in** — choosing a node inside the view is
  choosing a destination, so the view drops its spawn before it flips out.

Verify: `node scripts/drive-tree-exit-spawn.cjs --url http://localhost:4251`
(9/9 on a live shell — step-in from the hexagons, step-in from a view, typed
`/tree`, travel) plus `view-spawn.spec.ts`.
