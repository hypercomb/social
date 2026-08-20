# Global Text Search (`?`) — Plan

**Status: PLANNED, not built.** Written 2026-08-19. This documents the agreed
design so the work can be picked up later without re-deriving it.

## The question

Should `?` keyword search find tiles globally, or only filter the current
page? **Decision: globally.** The scope ladder already exists for the tag
filter (`local / children / global`); there is no principled reason text
search stops at the page while a pheromone filter reaches the whole hive. The
participant who remembers a name fragment is exactly the one who is *not*
standing in the right place.

## Current state (what exists today)

- **Tag/pheromone filter — hive-wide, reads truth.** `tags:filter` with
  `scope: 'global'` runs `#scanTagsAcrossPages()`
  (`presentation/tiles/show-cell.drone.ts`): walks from the hive root —
  sign each path → `HistoryService.currentLayerAt` → recurse `children` —
  reading each cell's tag decorations ∪ legacy `properties.tags`. Matches
  flatten onto the current page; `flatPaths` routes clicks to absolute
  locations. One-shot O(whole-tree) walk per filter change, `MAX_DEPTH` 32.
  Its cost is dominated by the per-cell `getResource` fan-out resolving
  decoration sigs.
- **`search:filter` (the `>?` command-line mode) — current page only.**
  Live-filters *visible* tiles by keyword (same drone, `search:filter`
  handler). No global variant.
- **Decoration-kind index** — in-memory, lazily hydrated from visited
  locations only. Exists for synchronous per-frame `visibleWhen` reads, not
  search.
- **Notes search** — within the active tile only (notes-strip). `/spotlight`
  lights tiles on the current layer only.
- **No persistent search index exists anywhere.**

## Two standards, cleanly split (doctrine)

- **Pheromones for meaning** — membership, grouping, filtering, bouquets.
  Deliberate, location-keyed, shareable. "Marks are the index read FIRST."
- **Text for recall** — names and note text the participant never classified.
  Demanding classification-before-findability would tax exactly the freeform
  capture the hive is good at.

Neither primitive may fake the other's job: no pheromone-per-word full-text,
no grep-instead-of-meaning classification (same reasoning as the rejected
relations-atomization).

## Design: walk first, index later

**Phase 1 — global `?` on the existing walk.**

- `?fragment` searches **names** globally via the same walk/flatten path the
  tag filter uses. Text matching is one more predicate on
  `#scanTagsAcrossPages` (matched-by-name instead of / alongside
  matched-by-tag), so the two filters feel like one system: same scope
  semantics (`local / children / global`), same anchor + re-root behaviour
  (global reads from the root while you stand at the anchor; entering a match
  re-roots the walk), same flatten render, same `flatPaths` click routing.
- **Name search is cheap in the walk**: tile names live in each layer's
  `children` list, so it needs only the layer reads the walk already does —
  none of the decoration-sig `getResource` fan-out. Roughly one OPFS read per
  page of the hive.
- **Note-text search is the expensive tier** (note resources resolved per
  cell). Deferred to Phase 2 — the point where a walk stops being honest.

**Phase 2 — derived index, when earned.**

Add an optimize-phase derived-cache pool (a NEW pool meaning — must carry a
colon, e.g. `search:index`) when either (a) the hive grows enough that the
walk lags, or (b) note text should be searchable. Constraints, per
`optimize-phase.md`:

- Pure derivation keyed by **layer sig** (changed source = new sig = no
  record = derive-on-miss; never update-in-place).
- Rebuildable from layers alone (passes the cold-client litmus test).
- **Never load-bearing**: the walk remains the fallback producing identical
  results; the index is purely a speed derivation underneath the same
  behaviour. Complete-or-absent records; minted only in the optimize phase,
  never on the commit path.

The same index treatment applies to the **tag walk itself** — the marks
deserve it more than text does, since doctrine calls them "the index read
FIRST" while the global tag flatten is currently the slowest path in
practice.

## Ordering rationale

Build the behaviour first on the walk that is already trusted; let the index
be added beneath it later. This keeps doctrine clean (the index can never
become load-bearing because the walk ships first as the reference
implementation) and avoids building an index for a behaviour whose shape
hasn't been used yet.
