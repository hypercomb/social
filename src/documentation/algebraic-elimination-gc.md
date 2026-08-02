# Algebraic elimination GC — roadmap

> **status: idea, not built (logged 2026-08-02).** A design direction for
> reclaiming space in the hive without a traversal-based collector. Nothing
> here ships today. It rides the existing optimize phase, pools of meaning,
> and signature algebra — it must never introduce a new folder, service, or
> field. Related: [optimize-phase.md](optimize-phase.md),
> [signature-algebra.md](signature-algebra.md),
> [signature-system.md](signature-system.md).

The hypothesis: in a store where identity is content, garbage collection does
not have to be a walk. It can be an **evaluation** — an expression that, when
it goes true, retires its own subject. Three tiers, in ascending risk and
descending certainty.

---

## Tier 1 — reachability as set algebra

Roots in the hive are known and small: the max marker of every lineage sigbag,
plus truth-class pools of meaning. So

```
live    = ⋃ closure(headᵢ)     over roots
garbage = S \ live
```

`closure(sig)` is a pure derivation of a sig-addressed input keyed by that sig
— exactly the optimize-phase record contract. Closures therefore memoize
forever and compose: a new head's closure is `delta ∪ closure(parent)`.
Invalidation is free, because a changed input is a different sig.

**Two hard constraints.**

1. Closure records live in a GC-able pool, so the collector consults a cache
   the collector may itself drop. Fail-safe direction is mandatory: **a missing
   closure means live**, never garbage. Complete-or-absent, per the doctrine.
2. Optimization records are **not roots**. A derived cache that pins its inputs
   is a heap that never shrinks. Sweep derived pools first, then run
   truth-reachability.

## Tier 2 — algebraic elimination proper

History never branches; undo appends a compensating op. A history segment is
therefore a word, and `a · a⁻¹` reduces to identity. A run of ops whose **net
effect is identity** is eliminable: the endpoints are equal, so every
intermediate layer that segment minted is referenced by nothing outside it.
Collapse the word and the garbage falls out — no heap traversal at all.

Detection is cheap in a merkle store: two markers in one bag whose resulting
root sig is identical ⇒ everything strictly between them is a candidate. No
diffing, no refcounts. **Sig equality is the proof of cancellation.**

Generalizes past adjacency: ops on disjoint cells commute, so they can be
reordered to bring inverses adjacent — free-group reduction with a commutation
relation — finding cancellations that are not contiguous in time.

**The cost is a retention decision, not a free win.** Eliminating a segment
destroys time-travel *through* it: the endpoints survive, the middle is gone,
and no one can stand at a moment inside the cancelled range. Two-stage undo and
`/rewind` depend on standing inside ranges, so the honest form is age-gated —
only eliminate cancelled segments older than the rewind window.

**First probe (read-only, build this before anything deletes):** scan bags for
repeated root sigs and report how many layers sit inside cancelled ranges. That
number decides whether the tier is worth building.

## Tier 3 — self-retiring records (`whenSig`)

Invert the collector. Instead of a sweeper deciding what is dead, a pool record
carries a **condition for its own removal** — a `whenSig`, the signature of a
canonical expression (query-as-identity, §1 of the algebra). The optimize phase
evaluates; true ⇒ the record drops its own entry. Nothing walks the store,
nothing holds a root set.

**Why this is worth more than a sweeper here:** the expression is
content-addressed, so evaluation is deterministic. Every peer evaluating the
same `whenSig` against the same inputs collects the same records with zero
coordination — GC inherits consensus from content addressing, like the rest of
the algebra. Precedent: CRDT garbage collection via *causal stability*, where a
replica drops a record when a monotone predicate every replica computes
identically goes true. This generalizes that predicate from "causally stable"
to any expression.

**Three constraints that decide whether it works.**

- **Monotone or nothing.** Once true, true forever. A record that self-deletes
  and then has its condition flip back is an invisible bug. Safe predicates
  read one-way facts: *my input sig is no longer any bag's head*, *a record
  keyed by a descendant sig exists*, *the layer I derive from is unreachable*.
  Anything mentioning selection, viewport, or a mutable name is not a
  predicate, it is a race.
- **Derived pools only, to start.** A wrong `true` in a derived-cache pool
  costs one recompute. In a truth pool it is data loss, and the removal would
  have to be a layer — an op in history, undoable — not a silent delete.
- **Default false.** Unevaluable expression, missing input, unknown operator ⇒
  keep. Absence of proof is never proof of death.

**Scheduling, not correctness, is the cost.** Every record evaluating every
idle tick is O(records) per pass. But a predicate's free variables *are*
signatures: bucket records by the sig their predicate watches and re-evaluate a
bucket only when that sig moves. The `interest` concept (a watched set) doubles
as the GC scheduler.

Tier 2 folds in cleanly: *root sig at marker i equals root sig at marker j* is
just another expression. Cancellation stops being a special-case collector and
becomes one predicate in the vocabulary.

**Open census question before building:** how many distinct predicates are
actually needed? Three or four ⇒ an expression language is over-engineering and
they should be named marks. Open-ended, with modules minting their own removal
conditions ⇒ it is a real language and `whenSig` earns its place. Answerable by
listing what is currently in the derived pools and asking of each: *what would
make this dead?*

## Tier 4 — statistical eviction (cold, not dead)

Unreachable is provable; cold is not. A monotone predicate going true is a
proof of death → delete. A statistical estimate proves nothing, so it can never
authorize deletion — only **eviction**: dropping a local copy of something
obtainable again. Content addressing makes "again" broad: same sig, re-derive
locally or re-fetch from any peer holding it.

> Statistics choose the **order** of eviction; recoverability grants the
> **permission**.

Frequency alone must never be the gate. The fatal counterexample is ordinary: a
tile made once, never published, never revisited. Every access metric calls it
statistically unreachable; it is also the only copy in existence. So permission
is a hard, non-statistical predicate — *re-derivable (derived pool), or
replicated (in a published package, on a relay, held by k peers)* — and
coldness only orders what is already permitted.

| tier | test | action |
|---|---|---|
| provably unreachable | monotone predicate true | delete |
| reachable, recoverable, cold | replication/derivability gate + coldness score | evict, refetch on miss |
| reachable, sole copy | — | never touch, at any coldness |

**Estimator.** Prefer the one-way structural signals the hive already has over
new access-log state: generational distance from any bag head, whether any live
layer references the sig, fan-in across bags. *Twelve generations behind head,
referenced by no current layer, present in a published package* beats a hit
counter and needs no new records.

**One-sided error, oriented correctly.** A Bloom filter here must summarize the
**live** set, never the dead set. False positive then means "thinks garbage is
live" → keeps bytes. The other orientation means "thinks live is garbage" →
deletes data. Same structure, opposite blast radius.

**Keep this tier out of the predicate vocabulary.** Tier 3 is valuable because
it is deterministic — every peer collects identically. A statistical rule makes
peers diverge on what they hold. For eviction that is the *point*: different
peers keeping different cold subsets means the mesh collectively retains what
no single peer can afford. But expressed as a `whenSig` it would poison the
deterministic tier. Deterministic elimination is shared and expression-driven;
statistical eviction is local, unshared, and never an expression.

## Build order

1. **Tier 2 probe** — read-only cancelled-range report. Cheapest, and its
   output decides whether tier 2 is real.
2. **Tier 3 census** — enumerate derived-pool record classes and their death
   conditions. Decides marks vs. expression language.
3. **Tier 4 replication gate** — the hard part and the entire safety story.
   Coldness scoring is tuning; tuning a policy that cannot reach irreplaceable
   data is a pleasant problem to have.

Tier 1 closures are only worth minting once something consumes them — tiers 2
and 3 both can, so it follows rather than leads.
