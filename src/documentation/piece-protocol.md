# The piece protocol — creation, marks, and the portal stamp law

**Status: DESIGN — pinned 2026-08-02 (Jaime). Not built.**
Companions: `pheromones.md` (marks, bouquets, scoped sniffing),
`view-library.md` (existing document views), `mirror-paradigm.md`
(parts as tiles), `known-location-pools.md` (root vocabulary).

## One protocol, not one per feature

**Creation = pieces + an arrangement.** The pieces are tiles
(sig-addressed, so identical pieces are literally the same piece). The
arrangement is a layer. Nothing else. A document, a website page, a
game, a view, a module — all the same shape, differing only in which
geometry renders the arrangement.

What falls out for free:

- **Reuse is automatic.** The same piece in two creations is not a copy
  — it is two incidences of one signature (see
  `references-as-incidences`). Improving it improves both.
- **Holes are pieces.** An uncreated part is a tile with a mark and no
  content sig — a navigable address, not a gap in a UI. "Not built yet"
  is a place you can stand.
- **Monolith = un-atomized.** A blob is not a different category; it is
  a creation whose pieces haven't been named yet. Atomization is a
  *migration*, never a rewrite.

**The grain rule** (the only real judgement call): something is a piece
when you could *name it and want it back somewhere else*. If you can't
name it, it isn't a piece yet — it is interior.

## Views are geometries, not kinds

Hexagon grid, square grid, list, tree — same tiles, different layout
function. Nothing about a tile knows which view it is in. The view's
output is parts, and a part is a tile; "showing them as squares" is the
same children rendered by a different arranger. This extends the
existing view library (`view-library.md`): those views read categories,
marks, and notes — a geometry view reads the same three, it just
arranges instead of narrating.

- **Typing is the resolver.** Type a token: it resolves to an existing
  part → placed; it doesn't → it becomes a **hole** (marked tile, no
  content). Same fast path as tile creation everywhere.
- **Two rails, one toggle.** *Test-bench mode* shows the side rail —
  parts that exist but aren't placed (unassigned) plus the holes. *Use
  mode* renders only realized + assigned parts; the rest is absent
  because the mark isn't there, never because a code branch hid it.
- The vocabulary wants to be data: `geometry`, `part`, `assigned`,
  `hole` as marks. No per-view code — render and behaviour resolve from
  the mark (the mirror-paradigm rule applied to views themselves).

## No unmarked tile, ever

A tile always has **identity** — a location and a name. That is free,
and it is not meaning. The mark is what makes it *findable*: an
unmarked tile isn't wrong, it is invisible to every filter — lost in
translation.

But creation must never ask for a mark (that would kill the fast path:
type a name → get a tile). The rule:

> **Creation never asks for a mark, but never leaves without one.**

Three sources, in order:

1. **Inherited** — from the context that made it: created inside a
   creation → `part`; typed at a page marked for something → that
   thing's mark. Meaning by construction, not by discipline.
2. **Chosen** — the author marks deliberately (painter, bouquet,
   `/keyword`).
3. **`unsorted`** — the explicit floor. Absence of a mark is not a
   state; `unsorted` is a real mark, so loose tiles stay enumerable
   ("show me everything unsorted") and sorting is the same operation as
   every other re-mark: remove one mark, add another.

## The portal stamp law

Portals divide by marks — so anything created *through* a portal must
carry the marks that put it in that partition, or it is lost the moment
it is made. One invariant decides everything:

> **A creation is immediately visible in the place it was created.**
> If you make something through a portal and it doesn't appear there,
> the system lied to you.

The mechanism is mechanical, not a judgement call:

- **The portal declares what it stamps, derived from its own filter.**
  A portal partitions by a predicate over marks; creating through it
  stamps exactly the marks needed to satisfy that predicate. The filter
  already contains the answer — no inference, no guessing.
- **Exotic predicates declare explicitly.** A portal whose predicate
  can't be inverted (negations, computed) declares its creation-set by
  hand. Either way the portal owns the stamp, because the portal is the
  thing doing the dividing.
- **The invariant is testable.** Create through every portal, assert it
  appears there. That is a ratchet, not a hope.

### The three mark classes (keep strictly separate)

| Class | Source | Propagates? |
|---|---|---|
| **Filter marks** | the portal (derived from its predicate) | stamped at creation, once |
| **Structural marks** | the parent, positionally (`part`, role-in-parent) | only these come from hierarchy |
| **Descriptive marks** | nothing — authored on the tile itself | **NEVER** |

Blanket parent inheritance is the trap: it looks like the simple answer
and silently pollutes — a parent marked `deprecated` must not deprecate
its children. Hierarchy contributes structure only; description never
travels. (This is the stamp-time complement of read-time scoped
sniffing in `pheromones.md`, which derives context by walking and never
stamps descendants — the two must not be conflated: sniffing reads,
the stamp law writes, and only filter + structural marks are ever
written by machinery.)

## Bouquets are lenses over the vocabulary

`pheromones.md` and the bouquet mirror define a bouquet as the blend
you scent with. This extends the same primitive — same named group of
pheromones — with its second role: **organizing the pheromone window.**
The flat mark list is too noisy to understand; bouquets are the
grouping.

- **A bouquet is a tile** whose members happen to be pheromones. Making
  one = making a tile: same creation flow, same window, same
  navigation; the "bouquet window" is a normal tile window whose
  behaviour resolves from its mark. Attaching a pheromone to a bouquet
  is the same mark operation as attaching one to anything. And because
  bouquets are in the tree, they are shareable, versionable, undoable —
  a community ships a vocabulary as a bouquet. (Delta from today: the
  bouquet-registry stores named sets as pool-addressed resources; the
  design direction is tile-first, with the registry as the derived
  pointer, not the home.)
- **The pheromone window groups by bouquet** instead of listing every
  mark flat. Filtering by "theme or themes" = selecting bouquets — the
  union of their members becomes the active filter.
- **A mark in no bouquet is `unsorted`** — same rule at the vocabulary
  level as at the tile level: visible, nagging to be organized, sorted
  by the same operation.
- **Bouquet = view, mark = fact.** Bouquets are the presentation order
  of the vocabulary; the marks themselves stay flat truth on tiles. A
  pheromone may live in several bouquets — bouquets overlap, marks
  don't move. This is the same view/data split as geometry views over
  tiles, applied one level up.

Scenting and lensing are two uses of one primitive, and they stay
distinct from an **interest** (a watched set — a filter over marks,
derived at read time), exactly as the bouquet mirror note already
holds.

## Build order (not now)

Nothing here ships ahead of the pheromone deposit slice
(`pheromones.md` § Not now). When it comes, the first slices in
dependency order:

1. `unsorted` as a real mark + creation-context inheritance (the
   no-unmarked-tile rule) — everything else assumes it.
2. Portal stamp derivation + the visibility ratchet (create through
   every portal, assert appearance).
3. Bouquet tiles + pheromone-window grouping/filtering.
4. Geometry views (square/list/tree arrangers) + the typing resolver +
   the unassigned/hole rail.
