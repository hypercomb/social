# The Optimize Phase — derived caches, never truth

A lifecycle phase on the bee base class for minting **derived-cache records**:
signature-addressed accelerators computed from committed truth, so warm paths
(first paint, navigation, preload) collapse to O(1) pool reads.

## Lifecycle

```
act(grammar)
  ├─ resolver.find → bee.pulse(grammar)   // truth mutates here
  ├─ finally: dispatch 'synchronize'      // render coalesces here
  └─ schedule optimize phase              // idle time, coalesced
        └─ for every registered bee with .optimize → await bee.optimize()
```

- The processor (`hypercomb.act()`) is the sole scheduler, exactly as it is the
  sole `synchronize` dispatcher.
- The phase is **coalesced**: a burst of `act()` calls collapses into one idle
  pass (`requestIdleCallback`, 2s timeout fallback). An `act()` landing while a
  pass runs schedules a fresh pass.
- Bees are enumerated from `window.ioc` (where they self-register in every
  shell); implementors declare `public override optimize = async () => { ... }`.
- A throwing `optimize` is swallowed — derived-cache work must never break the
  app.

## The contract

Anything written during the phase MUST be:

1. **A pure derivation of sig-addressed inputs, keyed by the input signature.**
   Never keyed by name, path, or position. Because the key is the source
   content's signature, invalidation is automatic: changed source = new sig =
   no record yet. There is no update, only derive-on-miss.
2. **Stored in a derived-cache pool** (`sign('manifests')`,
   `sign('visual-optimization')`, …) — recomputable, wipe-safe, GC-able.
3. **Never load-bearing.** No layer may reference it; no read path may require
   it. Cold paths must produce identical results without it (slower is fine,
   wrong is not). Complete-or-absent: never write a partial record.
4. **Never truth.** No layers, no history markers, no lineage writes, no
   gating, nothing a peer would need to receive.

The litmus test — and the rule for which pool a record belongs in:
**"Could a cold client rebuild this record from layers alone?"**
Yes → it is optimization-class and belongs in a derived-cache pool.
No → it is state; it needs its own pool of meaning and must NOT be minted here.

## Every request, rebuild only on change

Every new read/render request asks for the optimized `children` projection.
That does not mean recomputing it on every request. The request first probes by
the complete signed source key:

```text
(layer sig + result-affecting meta sigs) -> complete children projection
```

On a hit, the projection is used directly. On a miss, the ordinary meta/layer
walk produces the correct result and schedules or backfills the complete
projection. Immutable signatures provide invalidation: unchanged layer/meta
inputs reuse the existing record; a changed layer or gate/override meta mints a
new key. Only the affected layer and its changed ancestor path need new
projections. There is no mutable cache entry to patch and no global rebuild.

The optimized projection may stand in for meta traversal only for the exact
source key from which it was derived. Authorization and visibility inputs are
part of that key and remain fail-closed. A shared, authored, historical, or
load-bearing accelerator is state, not optimization, and enters the life graph
through a meta-wrapped layer instead.

The canonical meta stays light: `{ meta: 1, layer: <layer-sig> }`. The layer sig
also derives the local lookup address `sign('manifests')/<layer-sig>`, so storing
a second cache pointer in meta is redundant and would let device-local cache
state alter portable identity. A request preloads the small meta, skips all
child work for a leaf, and reads the manifest JSON only when children are
actually requested. The manifest contains the resolved child layers,
properties, and optimized visuals already needed for paint. It stays local and
is not part of a Swarm closure.

## History for free

Because records are keyed by the layer sig they derive from, old records keyed
by old sigs remain valid for rewind and time-travel — the pool inherits the
shape of history without being part of it. Layer history is sacred and
append-only; optimization history is a disposable shadow: free to grow, free
to prune, always regenerable. GC may drop any record; the only cost is one
cold pass before the phase re-mints it.

How that pruning could become an *evaluation* rather than a traversal —
self-retiring records, cancellation of identity-net history segments, and
statistical eviction gated on recoverability — is logged as a roadmap idea in
[algebraic-elimination-gc.md](algebraic-elimination-gc.md). Not built.

## First implementation

`history/manifest-optimizer.drone.ts` (essentials): queues layer sigs off the
`content:wrote` effect (kind `layer`), and during the phase resolves every
child sig to its layer and writes the complete-or-absent children manifest into
`sign('manifests')` keyed by the parent layer sig. Previously this write lived
inline in `HistoryService.commitLayer` on a microtask — the commit path now
mints truth only. `resolveChildNames` backfills missing manifests, so the
record is never required.
