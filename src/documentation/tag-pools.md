# tag pools — a tag is a deterministic meaning-pool

> **status: design — partially built (as of 2026-06-27).** the *forward* half (a
> tag application as a `kind:'tag'` decoration on a cell/layer) is built and live.
> the *inverse* half (the materialized `tag:<name>` pool with a deterministic head)
> is **not built** — today the inverse is computed by walking the tree
> (`#scanTagsAcrossPages` in `show-cell.drone.ts`). this doc records the model and
> the incremental path to materialize the inverse.

## related

- [genome-primitive.md](genome-primitive.md) — the subtree merkle root. a genome is
  the **ordered** cascade (slot order). a tag pool is the **unordered** sibling: the
  same merkle idea with a sorted-set read policy. genome's "design alternative"
  sorted formula IS the tag-pool head formula.
- [signature-algebra.md](signature-algebra.md) — tag functions + set operations
  (union/intersect/difference) — the algebra a tag pool's membership obeys.
- [signature-system.md](signature-system.md) — the signature↔payload pair and the
  expansion doctrine pools ride on.

---

## the one primitive

Everything is a **named signature pool**: a set of signatures + a *read policy*.

| read policy | order | head formula | example |
|---|---|---|---|
| **lineage / ordered** | insertion | merkle over `children[]` in slot order | a layer's children, the sigbag |
| **meaning / unordered** | none | merkle over **canonically-sorted, deduped** members | a tag (`education`), a game's level set |
| **keyed** | by key | per-slot | a layer's named slots |

A **tag is a meaning-pool**. "X is tagged `education`" is one membership *edge* with
two materialized directions:

- **forward** (built): X's `decorations` slot points at the `education` tag record
  (`kind:'tag'`, `payload:{name}`, `appliesTo:[]`). Rides the merkle tree, so
  adopt/sync carry it. This is the per-item **source of truth**.
- **inverse** (the pool, unbuilt): the `education` pool head = a merkle over the
  sorted sigs of everything tagged `education`. This is the **index**.

"Use a tag name as a signature pool" = materialize the inverse. "Tag another pool
with it" works because a pool is itself sig-addressed (its head), so a pool is a
valid *member* of another pool → pools tag pools, recursively.

---

## why determinism is load-bearing

The catch with naming: a tag **name** is not content-addressed — my `education` and
your `education` hold different members. The resolution: **make the pool head a
deterministic function of its membership** (sort + dedup the member sigs, then sign).
Then a meaning-pool is content-addressed *by meaning*, and three things follow:

1. **Convergence (agreement).** Same members → same head sig, computed identically by
   every peer. The name `education` is a human label; the deterministic head is the
   identity. Name collision across the mesh is no longer a conflict — identical
   meaning *is* an identical sig. (Same property as the root signing empty as
   `e3b0c442…` and the layer-as-primitive merkle root, with a sorted-set policy
   instead of an ordered one.)
2. **Merge is a set union.** Reconciling two peers' `education` = union their members
   → re-sort → re-sign. Union is commutative, associative, idempotent — a CRDT. No
   coordinator, no merge conflict. The mesh "breathes" member sigs and everyone lands
   on the same head.
3. **Recursion stays deterministic.** A pool head is a sig, so it is a member of
   another pool. `academic ⊇ education` is just `education`'s head appearing in
   `academic`'s sorted member set; determinism inherits all the way up.

```
poolHead(name) = sign(canonicalJSON(sort(dedupe(memberSigs))))
```

`sort` is what separates a tag pool from a genome: a genome is **order-sensitive by
design** (slot layout is meaning); a tag pool **must** sort, because for a tag set
insertion order is noise.

---

## determinism ≠ completeness (keep these separate)

- **Determinism solves agreement.** Once two peers hold the same members, they
  *provably* agree on the head — no reconciliation needed.
- **Discovery solves completeness.** A peer still has to *learn* members it hasn't
  seen — the `?:education` mesh request ("send me sigs in pool `education`"). This is
  the unbuilt genome/`?:tag` query + a tag-request mesh kind.

The two are cleanly decoupled: determinism guarantees that *whatever* members you
both have, you agree; discovery fills in *which* members you have.

---

## what is built vs. what this adds

| piece | state |
|---|---|
| tag application (forward decoration, `kind:'tag'`) | ✅ built — `decoration-manifest.ts`, `DecorationService` |
| tag style (name → colour/accent, `TagRegistry`) | ✅ built |
| name → sig binding (`NameRegistry` `kind:'signature'`) | ✅ mechanism exists, not wired to tags |
| inverse index materialized as a `tag:<name>` pool with a deterministic head | ❌ today: walked (`#scanTagsAcrossPages`) |
| `?:tag` discover-by-meaning + tag-request mesh kind, pools-tag-pools | ❌ specced (genome), not built |

**The current build is not wrong.** The forward decoration is the correct, canonical
*apply* side and the source of truth for membership. The tag pool is the additive
*index* side.

---

## incremental build path

1. **Pool head, off the source of truth.** Subscribe to `decorations:changed` (kind
   `tag`). Maintain, per tag name, the sorted-deduped set of owner sigs (the cell/pool
   the decoration sits on). On change, `sign(canonicalJSON(sortedMembers))` →
   `tag:<name>` pool head; store the head + member list as a resource
   (`putResource`), so host-sync/adopt carry it. The decoration walk seeds it; live
   events keep it warm — exactly the hydration pattern `decoration-kind-index.ts`
   already uses.
2. **Name binding.** `NameRegistry.setSignature('education', poolHead)` so the name
   resolves to the current head; re-bind on each head change. (Or a dedicated
   `tag-pool` registry mirroring `TagRegistry`/`NameRegistry` persistence.)
3. **Read path.** Replace the `#scanTagsAcrossPages` tree-walk with a pool lookup:
   `education` → head → member sigs. Filtering and `?:tag` queries become O(1) +
   set algebra (`signature-algebra.md`) instead of an O(n) walk.
4. **Federation.** Announce the pool head on the mesh; merge incoming heads by member
   union → re-sign. Determinism makes this conflict-free. Add the `?:tag` request kind
   for discovery.
5. **Recursion.** A pool head is a sig → allow a `tag` decoration on a pool head →
   pools tag pools; the taxonomy graph is emergent (`meaning-curved geometry`).

Pruning/GC, mutable-head history (the sigbag becomes the pool's head/cursor so a
mutable pool has a verifiable current value), and trust-ranked merge across the mesh
are the open hard parts — all on the *index/federation* side, none on how tag
applications are stored today.
