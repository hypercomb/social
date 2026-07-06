# Collapsed Compute

> **Critical architecture infrastructure.** This document describes how signature-addressed composition eliminates redundant computation across the entire network. Every cached signature is a computation that never needs to run again — for anyone.

## Related Critical Documents

- [signature-system.md](signature-system.md) — The primitive and the mandatory expansion doctrine: content IS identity; every fragment must be signature-addressed
- [signature-algebra.md](signature-algebra.md) — The algebra: composing, querying, and projecting over signatures
- [deterministic-computation.md](deterministic-computation.md) — Authenticity: script + resource → deterministic result
- [dna.md](dna.md) — Distributed Network Artifacts: the content-addressed, merkle-versioned layers, dependencies, bees, resources, and content that get collapsed here. The signature IS the address; artifacts compose upward so mutations cascade to root.
- [trail-capsule.md](trail-capsule.md) — The trail capsule (formerly "DNA"): the 1-byte navigation/route stream. A *different* concept — not to be confused with the artifacts above.

---

## The Principle

> **The more people who use the system, the less compute anyone has to do.**

Traditional systems scale inversely: more users = more compute = more servers = more cost. Hypercomb inverts this through **collapsed compute** — the network effect of content-addressed caching.

### How it works

1. **Every computation produces a signature.** When any user does work — composing fragments, building a manifest, rendering a layout, computing a recommendation — the result is stored as a content-addressed resource with a SHA-256 signature.

2. **Signatures are shared across the mesh.** When that result is published (via Nostr relays, direct share, or bundled in a layer), every peer who encounters it caches it by signature.

3. **Identical inputs produce identical signatures.** If another user needs the same computation (same script + same resource = same `authenticity` — see [deterministic-computation.md](deterministic-computation.md)), they look up the result by its signature. **The computation never runs again.**

4. **Compositions inherit this property.** A composition of cached fragments is itself cacheable. A snapshot of 100 composed fragments is a single signature. Share that signature and the recipient gets the entire composition — zero compute for any of the 100 underlying fragments.

```
User A computes result R from inputs (S, I)
  → authenticity = sign(concat(sign(S), sign(I)))
  → result-sig = sign(R)
  → stores marker: authenticity → result-sig
  → stores result: result-sig → R bytes
  → publishes authenticity + result-sig to mesh

User B needs the same computation (S, I)
  → computes authenticity = sign(concat(sign(S), sign(I)))  // same inputs → same authenticity
  → looks up authenticity → finds result-sig                 // cache hit
  → loads result-sig → gets R bytes                          // zero compute
```

### The network effect

Every user who does compute and publishes the result **collapses that computation for everyone who comes after**. The more users:

- More fragments get computed and cached
- More compositions get assembled and signed
- More superpositions become available as single-signature lookups
- **Compute approaches zero** as the signature space fills with pre-computed results

This is the inverse of a traditional scaling problem. The system gets **faster and cheaper** as it grows, because the probability of a cache hit increases with every new user's contributions.

---

## Levels of Collapse

### Level 1: Fragment-level collapse

A single resource (an image, a JSON blob, a module) is computed and signed once. Every subsequent reference is a lookup.

```
sign(image-bytes) → sig_A
// Anyone who needs this image just fetches GET /sig_A
// The "computation" (in this case, just hashing) happened once
```

### Level 2: Composition-level collapse

A set of fragments composed together produces a new signature. The composition is cached.

```
manifest = { bees: [sig_1, sig_2], deps: [sig_3] }
manifest_sig = sign(JSON.stringify(manifest))
// Anyone who needs this exact combination fetches GET /manifest_sig
// They don't need to discover, collect, or assemble the parts
```

### Level 3: Computation-level collapse *(design — not built as of 2026-06-18)*

A deterministic computation (script + resource → result) produces an `authenticity` signature and a `result-sig`. The result is cached by authenticity. This authenticity→result memoization is a planned mechanism; today the build collapses Level 1 (fragments) and Level 2 (manifest compositions) only.

```
authenticity = sign(concat(script_sig, resource_sig))
result_sig = sign(execute(script, resource))
// marker: authenticity → result_sig
// Anyone with the same (script, resource) pair skips execution entirely
```

### Level 4: Superposition-level collapse *(design — `sort()` formula not built)*

An arbitrary combination of fragments, compositions, and computation results — a "superposition" — is itself a signature.

```
// design sketch (NOT the build's formula):
superposition = sign(concat(sort([sig_A, sig_B, manifest_sig, result_sig])))
// This captures the ENTIRE state of a complex multi-part system
// Share one signature → recipient gets everything
```

The `sort()`-then-hash formula above is an illustrative sketch, **not** how the
system composes today. Real composition is a layer re-sign over an
**insertion-order** `children[]` (named `cells` in the build's layer JSON) — the
parent layer signs `JSON.stringify({ name, cells, bees, dependencies })` with the
child sigs in their authored order, no sorting. Two trees that differ only in
child order are *different* layers with *different* signatures. The merkle root
that names a package is exactly this insertion-order re-sign cascaded to the top
(`rootLayerSig`); see Level 2 and "Vertical composition" below.

### Level 5: Temporal collapse

A snapshot of the system at time T is just the layer that was HEAD at that
timestamp — and a layer already *is* a signed merkle root. History is a chain of
markers (`{ layer: <sig> }` pointers) in the lineage's sigbag at the OPFS root
(`<lineageSig>/`; legacy `__history__/` is a read-fallback drain); "what's here
now" is **not** an op-replay from zero but a direct read of the head layer's slots
(`currentLayerAt` → `getLayerBySig`, children from the `children[]`/`cells` slot).
So time-travel to T is "load the layer the marker at T points at" — no replay, no
re-aggregation.

```
snapshot_at_T = the layer sig the history marker at T points to
// Anyone who receives this signature loads that layer → exact state at T
// (The signed layer root already subsumes its subtree; nothing to recombine.)
```

---

## Infinite Scalability Through Composition

Composed fragments are infinitely scalable because they compose on **any plane**:

### Horizontal composition (across features)
Different features produce different signed resources. Compose them (the `sort()`
below is illustrative — the build composes by re-signing an insertion-order
`children[]`/`cells` array, never a sorted one):
```
app_state = sign(concat(sort([
  instruction_settings_sig,
  layout_preset_sig,
  theme_sig,
  user_preferences_sig
])))
```

### Vertical composition (across layers)
Layers compose upward into a single merkle root. A leaf layer's sig folds into its
parent's `cells[]`, the parent re-signs, and the cascade continues to the root:
```
child layer sig → parent layer sig → … → rootLayerSig
Each level re-signs over its insertion-order child sigs (no sorting)
```
The **package's identity IS its `rootLayerSig`** — there is no separate "package
sig", "manifest sig", or "release sig" tier above it. `manifest.json` is a
*discovery* file: a `packages` map **keyed by `rootLayerSig`**, whose entry lists
the package's layer/bee/dependency sig arrays. The `label`, `previous`, and `at`
fields in that entry are **sidecar metadata** — they change `manifest.json` bytes
but never `rootLayerSig`, so renaming or re-stamping a package never redefines it.
Update detection is therefore an O(1) root-sig compare (`installedSig === rootSig`),
not an HTTP 304 / etag round-trip.

### Temporal composition (across time)
History ops are signatures pointing at resource signatures. A time range is a composition:
```
changes_this_week = sign(concat(history_ops_between(t1, t2)))
```

### Social composition (across users)
Multiple users' contributions merge via signature deduplication:
```
User A contributes sigs: {A1, A2, A3}
User B contributes sigs: {B1, B2, A2}  // A2 is shared — already cached!
Combined: {A1, A2, A3, B1, B2}         // A2 stored once, computed once
```

### Cross-peer composition (across the mesh)
Nostr relays gossip signatures. A peer discovers new signatures and caches the resources. The more peers in the mesh, the more of the signature space is pre-populated.

---

## What Gets Collapsed

| What | Without collapse | With collapse |
|------|-----------------|---------------|
| **Module loading** | Fetch, compile, instantiate | Look up signature → already in OPFS |
| **Layout computation** | Calculate positions for N tiles | Look up layout_sig → cached result |
| **AI computation** *(design — not built)* | Send to LLM, wait for response | Look up authenticity → cached result |
| **Instruction rendering** | Collect from all bees, build manifest | Look up manifest_sig → cached manifest |
| **Settings application** | Parse, validate, apply | Look up settings_sig → cached settings |
| **History replay** | Replay N operations sequentially | Read head layer's slots → state is already materialized |
| **Sharing** | Package, serialize, transmit, deserialize | Share one signature → peer resolves it |
| **Verification** | Re-hash and compare | Signature IS the verification |

---

## The Collapse Flywheel

```
More users
  → more computations performed and cached
    → more signatures in the shared space
      → higher probability of cache hits
        → less compute per user
          → faster experience
            → more users
```

This is a **positive feedback loop**. Unlike traditional systems where growth creates resource pressure, Hypercomb's growth creates resource abundance. Every computation anyone does is a gift to everyone who comes after.

---

## Implementation Requirements

For collapsed compute to work, every part of the system must follow the [Signature Expansion Doctrine](signature-system.md):

1. **Every output must be signed.** If a computation produces a result, `sign()` it and store it as a resource.
2. **Every input must be signature-referenced.** Compositions must reference parts by signature, not inline data. Otherwise the composition signature is meaningless.
3. **Deterministic serialization.** Sign the same canonical bytes every time. Same logical content must produce the same signature. Note: the build does **not** sort object keys — module artifacts sign their literal bytes. Bees and dependencies sign the **raw compiled esbuild output**; layers sign `JSON.stringify(layer)` via `signJson` (insertion order, no key reordering); `PayloadCanonical` does `structuredClone` + `JSON.stringify` with **no** key sorting. A reader who "helpfully" sorts keys before hashing computes a *different* signature and breaks every cache hit. The rule is byte-for-byte reproducibility, not canonical key ordering.
4. **Lazy expansion.** Don't eagerly resolve signatures. Hold them as lightweight pointers until the content is actually needed.
5. **Cascade the resource cache.** `Store.getResource` walks memory → OPFS → host (`ContentBroker.#fetchOverHttp`, sha256-verified, write-through, with a 60s negative cache). This self-healing cascade applies to **resources only** — layers, dependencies, and bees are OPFS-only on the render path and heal only via adopt/install/sync. `SignatureStore` is **not** a cache tier: it is a trust allowlist (`isTrusted(sig)`) populated at install time. Never re-compute what's already cached.
6. **Publish results.** When a computation is done, publish the `authenticity → result-sig` mapping so others can benefit.

**Breaking any of these breaks the collapse chain.** Inline data can't be looked up by signature. Non-deterministic serialization produces false cache misses. Eager expansion does unnecessary work. Missing cache levels force redundant I/O.

---

## Relationship to Signature Algebra

Collapsed compute is the **practical consequence** of signature algebra (see [signature-algebra.md](signature-algebra.md)):

- **Signature algebra** defines the operations: union, intersection, composition, projection
- **Collapsed compute** is what happens when those operations are memoized by signature
- **The algebra is the query language**, collapsed compute is the execution model

Query-as-identity (algebra concept #1 in signature-algebra.md) is collapsed compute in its purest form: the query expression is content-addressed, and its result is content-addressed. Same query → same signature → cached result → zero compute.

---

## Trusted Authorities and Safe Sharing

Collapsed compute only works if you can trust the signatures you receive. Hypercomb solves this through **trusted authorities** — entities who have verified and signed compositions, making them safe to consume without re-verification.

### How trust works

1. **Content integrity is mathematical.** A signature is a SHA-256 hash of the content. If the content has been tampered with, the hash won't match. This is not a trust decision — it's a math fact.

2. **Trusted authorities vouch for composed fragments.** When a trusted authority (a human, an organization, a verified CI pipeline) signs a composition, they're saying: "I have verified this set of fragments, and they are safe." The authority's signature on the composition is a second layer of trust on top of the content hash.

3. **The SignatureStore is the trust boundary.** `SignatureStore.isTrusted(sig)` checks whether a signature is in the allowlist. Signatures enter the allowlist through the install pipeline — they were verified at install time. See [security.md](security.md) for the verification model and [deterministic-computation.md](deterministic-computation.md) for the authenticity layer.

4. **Sharing is always safe.** When you receive a signed block of composed fragments from the mesh, you can verify it:
   - Hash the content → does it match the claimed signature? (integrity)
   - Is the signature in the trusted allowlist? (authority)
   - If both pass, the content is safe to use — 100% or as close to it as cryptographic hashing allows.

### The collaborative model

This is not a competition for resources. It's the opposite:

```
Traditional systems:
  More users → more compute → more servers → more cost → competition for resources

Hypercomb:
  More users → more signed compositions → more cache hits → less compute → everyone benefits
```

Every user who computes and publishes a signed result is contributing to the shared knowledge base. It's like a blockchain of meaning — blocks of signatures with embedded meaning (because they're composed fragments), verified by trusted authorities, shared freely across the mesh.

The difference from traditional blockchain: there's no consensus protocol overhead. Content addressing IS the consensus. Two peers who independently produce the same content arrive at the same signature. The math agrees. No mining, no proof-of-work, no coordination — just deterministic hashing.

### Scaling through community

The more people who participate:
- More fragments get computed and cached → fewer redundant computations
- More compositions get assembled → richer pre-computed state available
- More trusted authorities emerge → broader verification coverage
- More mesh peers gossip signatures → faster discovery of pre-computed results
- **Cost per user approaches zero** as the signature space fills

This is why the [Signature Expansion Doctrine](signature-system.md) is non-negotiable. Every feature that uses inline data instead of signature references is a feature that can't participate in collapsed compute. It's a feature that forces every user to re-compute what could have been a cache hit. It's a feature that works against the community instead of with it.
