# The organism view — density as a place

BUILT 2026-09-05 and verified running: `organism-layout.ts` (ranking),
`organism-weight.ts` (the ontology), `organism.drone.ts` (the projections),
`organism.queen.ts` (`/organism`). Both projections confirmed on a live hive.

## Four rules a projection has to obey

Learned by breaking each one. They apply to ANY future projection, not just
this view.

1. **A projection is a FULL slot matrix.** `AxialService.project()` REPLACES
   `items` outright, so a matrix holding only the page's eleven slots leaves a
   grid of eleven slots and strands every other index. The rails pass
   `axial.capacity` for this reason. The organism permutes only the slots the
   page already occupies and leaves every other slot on its spiral coordinate.
2. **A projection must not answer its own render.** Projecting asks for a
   repaint; the repaint republishes `render:cell-count`; that is the effect
   that triggers a re-rank. Left open it loops — and destructively, because
   each pass re-ranks from the tiles the last pass drew, so anything missing
   from one frame is evicted for good. Compare the matrix before applying it.
3. **Ask whether YOU are projecting, not whether you hold a snapshot.** The
   one-projector guard originally tested for a cached spiral, and the read
   path cached one on every render pass — so the guard was disarmed by the
   time the rails could ever take the grid, and the organism flattened the
   rail matrix with no record it had existed.
4. **Every path the word can reach must answer.** The word waits on
   `organism:changed`; a silent early return leaves it timing out and then
   claiming the tile surface never answered. A no-op is a fine outcome, but
   it has to be said.

## What it is

Two ways of looking at a set of tiles where **position means popularity**.
Both are **projections** — the same slot→coordinate swap the phone's rails
use (`AxialService.project()`, `documentation/mobile-rails-projection.md`).
A tile's canonical `index` is never touched, nothing is committed, and
leaving the mode restores the arrangement exactly. Density is a way of
LOOKING at an arrangement, never a second arrangement.

### Projection one — the organism

The thickest tile takes the centre; every other tile crowds around it and
grows outward, thinning until the set runs out. While you are in the mode,
**that is how the tiles are indexed** — rank replaces arrangement as the
thing position reports.

This projection accepts a **top layer**: bring another type to the front and
you see its tiles first, while everything keeps its canonical order
underneath. Promoted tiles are lifted as a band, not re-sorted — the lift
changes what you meet first, never what the order means.

### Projection two — the texture

The most popular tile takes the middle, then the next most popular, and the
next, each becoming a nucleus with its own crowd packed against it. What you
get out is not a list, it is a **texture**: contiguous blobs of related
tiles, each one bleeding into the next until the whole set thins to nothing.

A top layer does not apply here. A texture has no single top, and lifting a
type out of it would tear a nucleus's run in half.

## Both are cross-domain

Neither projection is a local-layer view. They are **public cross-domain
search and swarm surfaces**: the members come from across community hosts,
so the weight is community-wide — how many participants across the swarm
hold a tile, not how many of your own tiles mention it. See
`documentation/pools-across-hosts.md`: a keyword is a consumable family,
discovery is families × community, and the pool is fetched at its address
(`GET /<sign(meaning)>/`). The organism is what that answer looks like when
you draw it instead of listing it.

The local reading of the same signal is the holder count — a small number
after the name of the tile under the pointer, and only that tile
(`presentation/tiles/tile-name.drone.ts`) — participant depth on one tile,
from the participant stack. Same question, one tile versus the swarm.

## Any ontology, one primitive

`organism-layout.ts` does not know what "dense" means. The caller supplies a
weight per tile, so the same shape lays out:

- participants who hold the tile (the stack depth the holder badge shows),
- descendants, or content volume,
- visits, recency, or any pheromone-derived count,
- anything a future ontology can score.

Changing ontology is changing the weight function. That is the whole
extension point, and it is why the two projections are one function.

## Why the texture is the cheap one

Each group is laid as a **contiguous run of spiral ranks**. A run of spiral
ranks is a connected region, which buys two things:

1. **The perimeter is free.** `AxialService.Adjacents` already holds each
   cell's six neighbours, so a section's boundary is a walk: a cell is on
   the edge iff one of its neighbours is outside the run. No geometry pass,
   no polygon math.
2. **A section can become one sprite.** A connected region with a known
   perimeter is exactly what you can bake to a single texture and draw as
   one quad. That is the LOD that lets the view zoom out incredibly deep —
   and it is the honest fix, because zooming out does not make the current
   renderer cheaper by itself (see below).

`organismSections()` returns those runs as half-open rank ranges — the input
both the perimeter walk and the sprite bake want.

## What actually costs, when you zoom out

Measured evidence lives in the sprite-sheet Step 0 note (2026-07-07, 1255
tiles). Summarised for this view:

- **Fragment cost does fall.** Tiles cover fewer pixels and mipmaps make
  sampling cheaper. This half of the GPU genuinely gets easier.
- **Tile geometry is already one draw.** The hex mesh is instanced and
  `HexImageAtlas` packs images into a GPU atlas, so tile count does not
  multiply draw calls. The atlas is a **fixed-slot ring buffer with on-screen
  pinning** — that cap, not the pixel count, is the real wall at depth: past
  it, distinct tile images cannot all stay resident and the ring starts
  evicting. Per-section baked sprites are the answer precisely because they
  collapse many resident images into one.
- **Per-tile CPU work does not fall.** Resolving labels and reading per-tile
  properties is per tile regardless of zoom, and that phase already measured
  as the largest slice of a cold boot.
- **Per-tile Pixi objects do not fall and are the thing to watch.** Anything
  outside the instanced mesh — badges, overlays, `Text` — is its own object
  with its own transform. A deep organism must drop these below a zoom
  threshold; they are the one part of this view that scales badly by
  construction.

So: it does get cheaper with fewer pixels, but not enough, and not in the
part that matters. The depth comes from the section sprites.

## Reading the weight honestly

Three ways the number can lie, all closed:

- **A tile only you hold has no stack entry at all** — show-cell files one
  only when a PEER published the name. Read literally that says nobody holds
  a tile you are looking at, and it ranks a peer's un-adopted tile above
  every tile of your own. Holder counts are floored at one.
- **The read budget must be spent breadth-first.** Tile-by-tile in page order
  meant an exhausted budget scored the rest 0 — and page order has nothing to
  do with density, so the densest branch could sit at arrangement position 35
  and be flung to the rim. Every tile gets its own children counted first;
  only the surplus buys the second level. Running out costs precision, never
  order.
- **All-zero is not a ranking.** The common cause is a FLATTENED page: a tag
  lens gathers tiles from across the hive, none are children of where you
  stand, every lookup misses. Reporting `descendants` over that would dress a
  canonical spiral up as a measurement, so it reports `none` instead.

Known and accepted: child counts come from the parent's stored child sigs,
which can lag an un-propagated ancestor commit (the renderer has an idle
repair for the same staleness). A picture may under-count a tile whose
parent has not caught up. Not worth a stricter read.

## Open

- Whether the top-layer lift should also be a gesture, not only a word.
- Whether section sprites live in the `sign('optimization')` pool as a
  derived cache (they are pure derivations of a sig-addressed member set,
  so the optimize phase is the sanctioned place to mint them).
