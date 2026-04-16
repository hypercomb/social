# Collapsed Compute

> **Critical architecture infrastructure.** This document describes how signature-addressed composition eliminates redundant computation across the entire network. Every cached signature is a computation that never needs to run again — for anyone.

## Related Critical Documents

- [signature-system.md](signature-system.md) — The primitive and the mandatory expansion doctrine: content IS identity; every fragment must be signature-addressed
- [signature-algebra.md](signature-algebra.md) — The algebra: composing, querying, and projecting over signatures
- [deterministic-computation.md](deterministic-computation.md) — Authenticity: script + resource → deterministic result

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
// Anyone who needs this image just fetches __resources__/sig_A
// The "computation" (in this case, just hashing) happened once
```

### Level 2: Composition-level collapse

A set of fragments composed together produces a new signature. The composition is cached.

```
manifest = { bees: [sig_1, sig_2], deps: [sig_3] }
manifest_sig = sign(JSON.stringify(manifest))
// Anyone who needs this exact combination fetches __resources__/manifest_sig
// They don't need to discover, collect, or assemble the parts
```

### Level 3: Computation-level collapse

A deterministic computation (script + resource → result) produces an `authenticity` signature and a `result-sig`. The result is cached by authenticity.

```
authenticity = sign(concat(script_sig, resource_sig))
result_sig = sign(execute(script, resource))
// marker: authenticity → result_sig
// Anyone with the same (script, resource) pair skips execution entirely
```

### Level 4: Superposition-level collapse

An arbitrary combination of fragments, compositions, and computation results — a "superposition" — is itself a signature.

```
superposition = sign(concat(sort([sig_A, sig_B, manifest_sig, result_sig])))
// This captures the ENTIRE state of a complex multi-part system
// Share one signature → recipient gets everything
```

### Level 5: Temporal collapse

A snapshot of the system at time T is the set of all active signatures at that timestamp. This is derivable from history (replay ops up to T). The snapshot itself can be signed and shared.

```
snapshot_at_T = sign(concat(sort(all_active_sigs_at_T)))
// Anyone who receives this signature can reconstruct the exact system state at time T
// No need to replay history — the collapsed result is the snapshot
```

---

## Infinite Scalability Through Composition

Composed fragments are infinitely scalable because they compose on **any plane**:

### Horizontal composition (across features)
Different features produce different signed resources. Compose them:
```
app_state = sign(concat(sort([
  instruction_settings_sig,
  layout_preset_sig,
  theme_sig,
  user_preferences_sig
])))
```

### Vertical composition (across layers)
Layers compose into packages, packages into manifests, manifests into releases:
```
layer → package → manifest → release
Each level is a signature that subsumes the signatures below it
```

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
| **AI computation** | Send to LLM, wait for response | Look up authenticity → cached result |
| **Instruction rendering** | Collect from all bees, build manifest | Look up manifest_sig → cached manifest |
| **Settings application** | Parse, validate, apply | Look up settings_sig → cached settings |
| **History replay** | Replay N operations sequentially | Look up snapshot_sig → materialized state |
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
3. **Deterministic serialization.** Sort keys before signing. Same logical content must produce the same signature.
4. **Lazy expansion.** Don't eagerly resolve signatures. Hold them as lightweight pointers until the content is actually needed.
5. **Three-level cache.** In-memory → OPFS → SignatureStore. Never re-compute what's already cached.
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
