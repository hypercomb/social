# Uniform decoration — decorate everything the same way

**Status: DOCTRINE — pinned 2026-08-08 (Jaime). First slice BUILT** (edge
registry + `marksOf` union); the rest adopts lazily, feature by feature.
Companions: `pheromones.md` (community deposits, filtering doctrine),
`signature-system.md`, `known-location-pools.md`, `optimize-phase.md`.

## The goal

One decoration design for every kind of thing — tiles, notes, list items,
behaviors, hierarchies, raw bytes — so that filtering (pheromones) rules the
world without ever mentioning types. Views, filters, sharing, enablement all
become queries over marks; features compose without knowing each other.

## The four-axis node

```
node = { mark, tags?, content?: <sig>, children: [<sig>, ...] }
```

- **Identity** — the node's signature. What these exact bytes are, forever.
- **Classification** — `mark` + `tags` (pheromones). What KIND of thing this
  is lives here — never in the container shape, never in a slot name, never
  in code. Meaning in a schema belongs to the code; meaning in marks belongs
  to the data.
- **Content** — a sig reference to what the node SAYS (body, image, page).
  This IS the "meta layer for everything": there is no fifth axis, and
  `meta:` alongside `content:` is forbidden — one meaning, one field.
- **Composition** — ordered `children` sigs.

Any richer field (`title`, `done`, `shape`) privileges one interpretation
and forks the schema — the reason notes/lists/journal diverged. The test for
a field: would two unrelated features fill it with the same kind of meaning?
`NoteLayer`'s `note` field is an inlined content slot — a compatible
ancestor, not a rival; it drains when a feature needs it to.

**Lists proved the model**: a list is a LENS over the notes tree, not a
second structure. A list item and a note are byte-identical shapes with
different marks. No new hierarchical feature mints a node schema — it mints
marks (declared vocabulary) and, if needed, a view.

## Collections are values

A collection-valued slot holds ONE sig pointing at a node subtree — never an
inline array. The wrapper gives the collection identity: shareable,
diffable, undo = a sig swap, superimposable. New slots use this shape from
day one; the notes array (`notes: [sig, ...]` inline on the cell) drains on
its trigger — the first feature that needs the collection AS a value.

**References point at NODES; only a node's `content` points at bytes.**
Never content-sniff "bytes or node?". A node's `mark` says how to RENDER its
content, never how to parse a reference.

## Meta resources (promotion)

Bare bytes at `<root>/<sig>` are promoted by wrapping in a node
`{ content: <byte-sig>, mark, tags }` — lazy, free, bytes untouched, old sig
valid forever. The envelope is minted the first time someone decorates the
bytes. Envelope marks are AUTHORED classification: merkle-linked, travel
with sharing, and decorating is an edit (sig ripples up). Personal
annotation on bytes uses the pool carrier below instead — no graph churn.

## Two carriers, one read

| carrier | lives | follows edits? | follows duplication? | use for |
|---|---|---|---|---|
| **location** (tag decoration) | the cell's `decorations` slot, indexed by location | YES | no | the DEFAULT — "the thing living here" |
| **sig** (`sign('pheromones:content')` pool) | one record per target sig, member named by that sig | no | YES | "these exact bytes" — audited bundle, reviewed image |

`marksOf(target)` (essentials/pheromones/pheromone-marks.ts, IoC
`@diamondcoreprocessor.com/PheromoneMarks`) unions both; consumers never
branch. The sig pool is TRUTH (user-minted, complete-or-absent, never
written from the optimize phase). Community deposits — decay, intensity,
strangers' keys — are `pheromones:deposits`, a different thing
(`pheromones.md`). Derived speed layers (bouquet → targets indexes) belong
in the optimize phase, keyed by source sigs, never load-bearing.

Behaviors decorate via their MIRROR TILES (the behaviors deck) — the mirror
SKELETON (one derivable address per behavior) is first-class; the FLESH
(notes, parts) stays delay-mapped and may drift. Runtime may read marks
from a derived address; it may NEVER depend on the mirror pass having run.
Absence collapses to the declared default — marks modulate, they are never
required for baseline function.

## The edge rule (integrity)

Sig-shaped fields split two ways, and every PRECISE reachability walker
(share/adopt closures, host-sync, publish — not GC, which deliberately
over-approximates) must consult the one declaration in
`hypercomb-core/src/core/edge-registry.ts`:

- **EDGE_FIELDS** = `children`, `content`, `refs` — dependencies whose
  bytes must travel. Frozen; extending it is a closure-protocol decision.
- **REFERENT_FIELDS** = `groupSig`, `targetSig` — addresses/identities
  with no bytes behind them; fetching one 404s forever. May grow — adding
  here is how a new pointer field opts out of every walker at once.

A doctrine ratchet (`doctrine.spec.ts`) forbids inline referent-field
comparisons outside the registry. Marks arriving from peers are UNTRUSTED:
a mark may select a renderer, never grant behaviour or execution.

## Adoption discipline

Nothing migrates for its own sake. Each piece lands when a feature pulls
it: envelopes when a mark must travel, the generic tree service when a
second hierarchy asks, the notes-array drain when a collection must be a
value. Existing shapes keep working forever (drains, not rewrites); the
model can be adopted lazily and abandoned partially without stranding data.
