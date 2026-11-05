# The hover animation is a trait

**Status: built 2026-11-04. Proved on the dev shell on a real GPU: the own looks draw as they always did, all four new looks draw, and a real `trait` + `fill` made the hover pick `mist` on its own. Not yet in the web shell (needs `npm run build:essentials`).**

*jwize, 2026-11-04:* "we should be able to swap out that animation to do different things like smoke or glow or mist or any sort of celebration for the tile" … "when we show our tiles we can decorate things like folder:animation" … "this should be extruded into an extension point."

Hold the pointer on a tile and its border moves. A tile with hexagon children, a pathway, breathes an accent ring with two glints on opposite sides circling the rim. A leaf gets a still outline. That was one hard-coded branch in the hex fragment shader. It is now the **own version** of a [trait](traits.md), `hover-animation`, so a tile can pick another look and nothing else changes.

## What a tile can do with it

Stand in the tile, then:

| Say | What happens |
|---|---|
| `trait own hover-animation` | The tile has the seat. No tile is made, and it keeps its own look until filled. |
| `fill hover-animation /mist` | The tile named `mist` is the filler. The hover now draws mist. |
| `trait hover-animation` | Makes a child called `hover-animation`. The first of **its** children named after a look picks it. |
| `fill ~ hover-animation` | Back to the tile's own look. |

Go back up one level and hover the tile. The animation is seen from the page the tile is on, not from inside it.

## The looks

| Name | Draws |
|---|---|
| `glints` | **A pathway's own.** A breathing accent ring, two glints on opposite sides orbiting the rim, a soft bloom. |
| `outline` | **A leaf's own.** A tight, cool, still outline. |
| `glow` | The rim lit from inside, breathing slowly. |
| `mist` | Pale fog drifting in along the rim, thickest at the edge. |
| `smoke` | Dark wisps climbing the tile, reaching further in than mist. |
| `celebrate` | A gold rim that flashes, and confetti sparks twinkling round it. |

Any look can be put on any tile: a leaf may breathe and a pathway may be quiet.

## Why the filler is a name

A mark travels with the tile to everyone who gets it, and a peer's marks are untrusted. A mark may **select** a look; it may not **bring** one. So the filler tile's name picks among the looks the shader ships, and a name it does not ship falls back to the tile's own look instead of doing nothing. This is the rule the [quick menu's seats](quick-menu-traits.md) follow: the setting is a mark, the behaviour lives in admitted code.

## How it costs nothing

Almost no tile has opened a trait, and for those nothing is read:

1. `wearsHoverTrait` asks the decoration-kind index, which is already hydrated for every visible tile, whether the tile has any `trait:want` record. O(1).
2. Only a tile that does is resolved, once, by the rungs (fill, child, own). The trait reader is imported on that first ask, so it stays off the boot path. The answer is kept per place until a `decorations:changed`.
3. The result is one number in one uniform, `u_hoverFx`, because only one tile is hovered at a time. There is no per-tile vertex attribute and no geometry rebuild. 0 means "its own".
4. The clock that animates the border runs for a hovered pathway **or** a hovered tile with a look of its own, so a page of plain leaves stays still.

## Not built

- **A look that is brought, not selected.** A community bee cannot add a sixth look yet. The program is compiled once, so a new look needs a recompile seam in the shader. The table in `hover-effects.ts` is where it would register.
- **The followed-hosts rung.** Fillers come from this hive only, as with the quick menu.
- **A one-word way to say it.** `trait own` then `fill` is two words and needs a tile to point at.
- **Celebration on an event.** `celebrate` plays on hover. Playing it when a tile is created, completed or shared is a different trigger on the same looks.
- **Per-tile numbers** such as colour or speed. A look is a whole; a tile picks one.
- **The phone**, which has no hover.

Code: `presentation/grid/hover-effects.ts` (the table and the shader code), `presentation/grid/hex-sdf.shader.ts` (the `u_hoverFx` uniform and the one call), `presentation/tiles/hover-animation.ts` (the reader), `presentation/tiles/show-cell.drone.ts` (`#chooseHoverEffect`). Specs: `hover-effects.spec.ts`, `hover-animation.spec.ts`.
