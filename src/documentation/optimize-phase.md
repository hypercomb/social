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

## History for free

Because records are keyed by the layer sig they derive from, old records keyed
by old sigs remain valid for rewind and time-travel — the pool inherits the
shape of history without being part of it. Layer history is sacred and
append-only; optimization history is a disposable shadow: free to grow, free
to prune, always regenerable. GC may drop any record; the only cost is one
cold pass before the phase re-mints it.

## First implementation

`history/manifest-optimizer.drone.ts` (essentials): queues layer sigs off the
`content:wrote` effect (kind `layer`), and during the phase resolves every
child sig to its layer and writes the complete-or-absent children manifest into
`sign('manifests')` keyed by the parent layer sig. Previously this write lived
inline in `HistoryService.commitLayer` on a microtask — the commit path now
mints truth only. `resolveChildNames` backfills missing manifests, so the
record is never required.
