# Uniform decoration — the life primitive decorates everything

**Status: DOCTRINE — pinned 2026-08-08 (Jaime). First slice BUILT** (edge
registry + `marksOf` union); the rest adopts lazily, feature by feature.
Companions: `pheromones.md` (community deposits, filtering doctrine),
`signature-system.md`, `known-location-pools.md`, `optimize-phase.md`.

## The goal

One decoration design for every kind of thing — tiles, notes, list items,
behaviors, hierarchies, raw bytes — so that filtering (pheromones) rules the
world without ever mentioning types. Views, filters, sharing, enablement all
become queries over marks; features compose without knowing each other.

## One envelope, one growable layer

```
meta = {
  meta: 1,
  exactly one of: layer | resource | dependency | bee: <sig>,
  mark?, tags?, ...incidence
}

artifact = existing layer JSON | resource bytes | dependency bytes | bee bytes
```

- **Identity** — each meta, layer, and raw payload has its own immutable sig.
- **Incidence/classification** — meta says how a payload occurs here, including
  `mark`, tags, author, recipients, gate, canonical root, and provenance.
- **Growth** — features that need trees use existing layers; artifact refs in
  their installed slots point through meta.
- **Atoms** — raw bytes terminate through a typed meta payload key. The key is
  the declaration; referenced content is never sniffed to determine its type.

A richer relationship (`notes`, `image`, `properties`, `done`, `shape`) keeps
its installed scalar/array slot shape; each artifact it names is referenced by
a meta sig. An authored display label, image, or border for one reference
therefore stays on that reference's local meta/layer and cannot stomp another
appearance of the same canonical root.

**Lists proved the model**: a list is a LENS over the notes tree, not a
second structure. A list item and a note are byte-identical shapes with
different marks. No new hierarchical feature mints a node schema — it mints
marks (declared vocabulary) and, if needed, a view.

## Collections are values

Existing collection-valued slots remain arrays. Each artifact entry is a meta
sig, so occurrences can differ without changing the shared artifact. If a
collection itself needs identity, decoration, or children, represent that
feature as an ordinary layer; no new collection storage primitive is needed.

**References point at META.** A layer payload opens a growable node. A
`resource`, `dependency`, or `bee` payload opens raw bytes. Never content-sniff
"bytes or layer?"; the payload key already answers it.

## Meta resources (promotion)

Bare bytes at `<root>/<sig>` gain metadata without changing them:

```text
raw bytes <- { meta: 1, resource: <byte sig>, relation: "image" }
```

Use `dependency` or `bee` instead of `resource` for those atom kinds. Add an
ordinary feature layer only when that occurrence needs children, notes, or
other growth; the raw byte atom remains terminal. Envelope marks are AUTHORED
classification: merkle-linked, carried by sharing, and decorating is an edit.
Personal annotation on bytes can use the pool carrier below instead, avoiding
unwanted graph churn.

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

- **EDGE_FIELDS** = `layer`, `resource`, `dependency`, `bee`, `children`, plus
  legacy-drain `content` and `refs` — dependencies whose bytes must travel.
  Frozen; extending it is a closure-protocol decision.
- **REFERENT_FIELDS** = `groupSig`, `targetSig` — addresses/identities
  with no bytes behind them; fetching one 404s forever. May grow — adding
  here is how a new pointer field opts out of every walker at once.

A doctrine ratchet (`doctrine.spec.ts`) forbids inline referent-field
comparisons outside the registry. Marks arriving from peers are UNTRUSTED:
a mark may select a renderer, never grant behaviour or execution.

## Adoption discipline

Legacy shapes keep working forever through deterministic passive projection.
Reads do not rewrite history; synthesized meta records may be added to the flat
pool as a cache, and the next ordinary edit emits metadata refs in the existing
artifact shape.
New features must pass the life-primitive test: if the feature cannot be a
meta-wrapped layer capable of further references and growth, it introduces an
unnecessary terminal special case.
