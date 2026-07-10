# Collections — sharing override & pulling members

**Status: DESIGN OPEN — captured 2026-07-09 (Jaime), deliberately
deferred to a fresh session.** Baseline doctrine stands: collections are
structurally never-public (public-content-endpoint.md).

## 1. The two-key public override (maybe)

A collection may go public ONLY when both keys turn:

- **Collection-side key** — the participant deliberately flips the
  collection itself (an explicit override of the never-public default,
  with friction worthy of "this is my curation").
- **Reference-side key** — a member appears in the public view only if
  its TARGET is already public. Private-target members are PRUNED
  entirely (no stubs, no counts) — the same physics as the publish
  walk pruning private children.

Public view = intersection of curation intent and each item's own
status. Publishing curation can never out a private item. Jaime is
"not sure" the override should exist at all — decide fresh.

## 2. Pulling a member out of a collection

Two existing verbs:
- **Copy** — materialize the referenced tile into the hive (yours, new
  lineage, normal adopt/copy semantics).
- **Reference** — place a reference tile pointing at it (references are
  doctrine-bound ALWAYS PRIVATE — composes cleanly).

## 3. Collections as pickers for behavior slots (the new idea)

A beehavior with an input need (dropbox wants an image, slides want a
deck, tutor wants a scope) opens the relevant collection as its
palette; choosing a member binds the member's SIG into the slot. Pure
signature-reference doctrine — slots hold sigs, collections are where
sigs get chosen, zero new storage semantics. Curation becomes the
supply chain for behaviors.

Open questions for the fresh session: override friction shape; whether
prune leaks existence via ordering/size; picker UX (which collection
answers which need — tags? kind matching?); whether a pulled copy
remembers its source collection (provenance vs privacy).
