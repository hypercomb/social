# signature algebra

a theoretical framework for performing algebraic operations over content-addressed signatures in hypercomb. signatures are immutable SHA-256 identities — 64-character hex strings, 256-bit numbers. the algebra never modifies a signature. it operates *over* them: grouping, filtering, composing, projecting, and deriving new structures from the relationships between signatures and their metadata.

this document defines the hypothesis, formalizes the theory, and explores ten high-value applications.

**related critical documents:**
- [signature-system.md](signature-system.md) — the signature-payload pair (atoms of the algebra) and the mandatory expansion doctrine that makes this algebra operational
- [collapsed-compute.md](collapsed-compute.md) — the practical consequence: memoized algebra eliminates redundant computation
- [signature-node-pattern.md](signature-node-pattern.md) — plug-and-play guide: copy the node template, your feature participates in the algebra
- [deterministic-computation.md](deterministic-computation.md) — authenticity composition: the composition function `C(s₁, s₂)` implemented
- [core-processor-architecture.md](core-processor-architecture.md) — the runtime that drives the algebra: `hypercomb.act()` → pulse → synchronize

---

## the hypothesis

> if every piece of content in the system has a deterministic, immutable identity (its signature), and if we can tag, group, and relate those identities through metadata (keywords, lineage, dependency graphs, authorship), then we can construct a full algebra over those relationships — and that algebra becomes a universal query and composition language that works identically on every peer without coordination.

the key insight: signatures are *atoms*. they don't change. they don't need to. all the interesting math happens in the *spaces between them* — the sets they belong to, the graphs they form, the lattices they inhabit.

because SHA-256 is deterministic, every peer performing the same algebraic operation on the same inputs arrives at the same result. no consensus protocol needed for the algebra itself — consensus is inherited from the content addressing.

---

## foundational definitions

### signature space

let **S** be the set of all signatures known to a peer. each element is a 64-character hex string — a point in a 256-bit space.

```
S = { s₁, s₂, s₃, ... sₙ }
where sᵢ = SHA-256(contentᵢ)
```

**S** is finite and local. different peers have different **S** based on what content they've installed. the algebra works identically regardless of the size or composition of **S**.

### tag function

a tag is a named predicate over **S**. the tag function **T** maps a tag name to the subset of signatures carrying that tag.

```
T: TagName → P(S)
T("cuban") = { s₃, s₇, s₁₂ }
T("brand") = { s₃, s₅, s₇ }
```

tags are keywords in LayerState. they are first-class data — stored, published, and synchronized alongside the signatures they annotate.

### lineage function

lineage maps a signature to its hierarchical path.

```
L: S → Path
L(s₃) = "cigars/brands/cohiba"
```

lineage is a natural tree — every path has a parent (except root). this gives us a partial order for free.

### dependency function

the dependency graph maps a signature to the set of signatures it depends on.

```
D: S → P(S)
D(s₃) = { s₈, s₉ }   // s₃ depends on s₈ and s₉
```

this is the `beeDeps` structure from the install manifest — already computed at build time.

### composition function

any two signatures can be composed into a deterministic third signature.

```
C: S × S → S
C(s₁, s₂) = SHA-256(concat(s₁, s₂))
```

this is exactly what `authenticity` does in the deterministic computation model. the composed signature is a *new identity* that represents the relationship between two existing identities.

---

## the algebra

### set operations (the foundation)

signatures grouped by tags form sets. all classical set operations apply:

| operation | notation | meaning |
|-----------|----------|---------|
| union | `T(a) ∪ T(b)` | everything tagged `a` or `b` |
| intersection | `T(a) ∩ T(b)` | everything tagged both `a` and `b` |
| difference | `T(a) \ T(b)` | everything tagged `a` but not `b` |
| symmetric difference | `T(a) △ T(b)` | tagged `a` or `b` but not both |
| complement | `S \ T(a)` | everything *not* tagged `a` |
| subset test | `T(a) ⊆ T(b)` | is every `a`-tagged sig also `b`-tagged? |
| cardinality | `|T(a)|` | how many signatures carry tag `a`? |

these are not theoretical — they map directly to operations on arrays of 64-char hex strings. union is concat + deduplicate. intersection is filter. difference is filter-not. every peer computes the same result from the same inputs.

### lattice structure (tag hierarchy)

tags form a lattice under subset ordering. if `T("cuban") ⊆ T("cigar")`, then `cuban` is a refinement of `cigar`. this hierarchy can be:

- **explicit**: declared in metadata ("cuban is-a cigar")
- **emergent**: observed from the data (every signature tagged "cuban" is also tagged "cigar")

the lattice gives us:

- **meet** (greatest lower bound): the most specific tag that contains both sets
- **join** (least upper bound): the most general tag contained in both sets
- **monotonicity**: adding a tag to a signature can only move it *down* the lattice (more specific), never up

### graph operations (dependency algebra)

the dependency function **D** creates a directed acyclic graph. graph algebra includes:

- **transitive closure**: `D*(s)` = everything `s` depends on, recursively
- **reverse dependency**: `D⁻¹(s)` = everything that depends on `s`
- **common ancestors**: `D*(s₁) ∩ D*(s₂)` = shared dependencies
- **topological sort**: a total order respecting all dependency edges

### projection (cross-dimensional queries)

the real power emerges when you project through dimensions:

```
"give me all signatures tagged 'cuban', then for each, give me their dependencies"

result = ⋃ { D(s) | s ∈ T("cuban") }
```

this is a projection from the tag dimension through the signature space into the dependency dimension. you can chain projections:

```
"dependencies of cuban brands that are also used by dominican brands"

cuban_deps = ⋃ { D(s) | s ∈ T("cuban") ∩ T("brand") }
dominican_deps = ⋃ { D(s) | s ∈ T("dominican") ∩ T("brand") }
shared = cuban_deps ∩ dominican_deps
```

---

## the ten most interesting things to do with signature algebra

### 1. computed collections (query-as-identity)

**the idea**: an algebraic expression over tags becomes a first-class object with its own signature.

```
expression = "T('cuban') ∩ T('brand') \ T('discontinued')"
collection_sig = SHA-256(canonical(expression))
```

the expression itself is content-addressed. two peers who independently write the same query get the same collection signature. this means:

- **subscriptions**: subscribe to a collection signature on the mesh. when any peer publishes a new signature matching the expression, you receive it automatically.
- **sharing**: share a collection by sharing its expression signature. the recipient evaluates it against their own **S** and gets a locally-relevant result.
- **caching**: the collection signature is a cache key. if your **S** hasn't changed, the result hasn't changed.

this turns every query into a publishable, subscribable, cacheable identity — with zero coordination.

### 2. dependency impact analysis (reverse explosion graph)

**the idea**: when a dependency changes, instantly compute the blast radius.

```
old_dep_sig = SHA-256(old_bytes)
new_dep_sig = SHA-256(new_bytes)

affected_bees = D⁻¹(old_dep_sig)
affected_layers = { L(s) | s ∈ affected_bees }
affected_tags = ⋃ { tags(s) | s ∈ affected_bees }
```

this gives you a complete impact map: which bees break, which lineage paths are affected, which tagged collections shift. all computed instantly from the existing graph — no test suite needed for the structural analysis.

**going deeper**: compose the new dependency into each affected bee's context:

```
for each bee in affected_bees:
    old_authenticity = C(bee, old_dep_sig)
    new_authenticity = C(bee, new_dep_sig)
    // if cached result exists for old_authenticity, it's stale
    // new_authenticity is the cache key for the recomputed result
```

the deterministic computation model already supports this — signature algebra just gives you the graph traversal to know *where* to look.

### 3. semantic similarity via tag overlap (jaccard on signature sets)

**the idea**: measure how "related" two tags are by comparing their signature sets.

```
similarity(a, b) = |T(a) ∩ T(b)| / |T(a) ∪ T(b)|
```

this is the jaccard index — a number between 0 (no overlap) and 1 (identical sets). it's already used in the cigar discovery service for flavor recommendations. signature algebra generalizes it to *any* tagged content:

- "how related are 'cuban' and 'full-bodied'?" → jaccard on their signature sets
- "what tags are most similar to 'maduro'?" → rank all tags by jaccard similarity to T("maduro")
- "suggest tags for this new signature" → find the tags whose sets it most closely resembles

because this operates on sets of signatures (not the content itself), it's fast — just set intersection and union on arrays of hex strings.

### 4. provenance chains (who touched what, and when)

**the idea**: compose signatures along the history chain to build a verifiable provenance trail.

```
history_chain = [
    C(author₁_sig, content_v1_sig),
    C(author₂_sig, content_v2_sig),
    C(author₁_sig, content_v3_sig)
]
provenance_sig = SHA-256(concat(history_chain))
```

each entry in the chain is a composition of "who" and "what." the chain itself gets a signature. this means:

- **tamper detection**: alter any entry and the provenance signature changes
- **attribution**: the chain records who contributed what, verifiably
- **forking**: if two peers diverge, their provenance signatures diverge — and you can identify exactly where by comparing chains element-by-element

this is content-addressed git — but for any content in the system, not just code files.

### 5. differential sync (what changed between two states)

**the idea**: express the difference between two states of the system as an algebraic operation on signature sets.

```
state_before = { all signatures at time t₁ }
state_after  = { all signatures at time t₂ }

added   = state_after \ state_before
removed = state_before \ state_after
stable  = state_before ∩ state_after
```

this is already how `ensure-install.ts` diffs manifests — old vs new. signature algebra formalizes it and extends it:

- **tag-scoped diff**: "what changed in the 'cuban' collection?" → `(T("cuban") ∩ state_after) △ (T("cuban") ∩ state_before)`
- **dependency-scoped diff**: "which dependencies were added for bees tagged 'editor'?"
- **lineage-scoped diff**: "what changed under `cigars/brands/`?"

because diffs are just set operations, they can be composed: "changes in cuban brands that also affected the editor" is an intersection of two diffs.

### 6. content-addressed access control (capability algebra)

**the idea**: access control as set membership. a capability is a signature. having it means having access.

```
capability_sig = SHA-256("read:" + resource_lineage + ":" + grantee_pubkey)
```

the capability is deterministic — anyone who knows the inputs can verify it. access control becomes set algebra:

- **grant**: add the capability signature to the grantee's set
- **revoke**: remove it
- **check**: is `capability_sig ∈ grantee_capabilities`?
- **delegate**: `C(capability_sig, delegate_pubkey)` = a derived capability that only the delegate can use

compound policies are set expressions:

```
can_edit = T("editor-capability") ∩ T("active-user")
can_publish = can_edit ∩ T("publisher-capability")
```

no ACL database. no permission tables. just set membership over deterministic signatures.

### 7. bloom filter gossip (probabilistic set exchange)

**the idea**: use bloom filters to efficiently discover what a remote peer has that you don't — without exchanging full signature lists.

a bloom filter is a compact probabilistic data structure: it can tell you "definitely not in the set" or "probably in the set."

```
my_bloom = BloomFilter(my_signatures)
// send my_bloom to peer (compact — kilobytes, not megabytes)

// peer tests each of their signatures against my_bloom
probably_missing = { s | s ∈ peer_S AND s ∉ my_bloom }
// peer sends probably_missing back to me
```

the algebra extends to tagged blooms:

```
my_cuban_bloom = BloomFilter(T("cuban"))
// "do you have any cuban-tagged signatures i don't?"
```

this is how the mesh can gossip efficiently about tagged collections — not just raw signature lists. the bloom filter is itself a compressed algebraic summary of a set expression result.

### 8. merkle composition trees (aggregating trust)

**the idea**: compose all signatures in a set into a single merkle root — a compact, verifiable summary of the entire collection.

```
root = MerkleRoot([s₁, s₂, s₃, ... sₙ])
      = SHA-256(SHA-256(s₁ + s₂) + SHA-256(s₃ + s₄) + ...)
```

the root changes if any element changes, is added, or is removed. this gives you:

- **collection integrity**: publish the root alongside the tag. anyone with the same tagged set can independently verify.
- **incremental updates**: merkle trees support O(log n) proofs — "s₇ is in this collection, and here's the proof" without sending the whole set.
- **cross-peer verification**: "do we agree on the contents of T('cuban')?" reduces to comparing a single 64-char hex string.

combine with the query-as-identity from #1: a computed collection has an expression signature (its query) and a merkle root (its current result). both are deterministic. both are publishable.

### 9. algebraic search (navigating the signature space)

**the idea**: search becomes navigation through algebraic expressions, not keyword matching.

start with a broad set:

```
step 1: T("cigar")                           // 847 signatures
step 2: T("cigar") ∩ T("cuban")              // 203 signatures
step 3: T("cigar") ∩ T("cuban") ∩ T("robusto") // 41 signatures
step 4: ... ∩ L("cigars/brands/cohiba")      // 8 signatures
step 5: ... ∩ D⁻¹(s_flavor_wheel)            // 3 signatures (those using the flavor wheel dep)
```

each step is a refinement — an intersection that narrows the result set. the user navigates by adding constraints. unlike traditional search:

- **no index server**: every peer computes locally
- **composable**: each step is an algebraic expression that can be saved, shared, or subscribed to
- **reversible**: remove a constraint to widen. the history of constraints is itself a path through the lattice.
- **cross-dimensional**: mix tags, lineage, dependencies, and authorship in a single expression

the algebra *is* the search language.

### 10. signature-based reactive pipelines (algebra as dataflow)

**the idea**: treat algebraic expressions as live, reactive computations that re-evaluate when their inputs change.

```
pipeline = {
    input:  "T('cuban') ∩ T('brand')",
    transform: (sigs) => sigs.map(s => D(s)),  // get deps for each
    output: "cuban-brand-deps"                  // named result set
}
```

when a new signature is tagged 'cuban' and 'brand', the pipeline fires:

1. the new sig enters `T('cuban') ∩ T('brand')`
2. the transform runs — fetching its dependencies
3. the output set updates
4. anything subscribed to "cuban-brand-deps" receives the delta

this is the EffectBus pattern generalized to signature algebra. effects are already pub/sub with last-value replay. signature algebra expressions become a new class of effect — one whose value is a set of signatures derived from an algebraic expression.

pipelines compose: the output of one pipeline is the input of another. a chain of algebraic transformations, each reactive, each deterministic, each independently verifiable by any peer.

---

## implementation considerations

### expression language

a minimal expression syntax for set operations over tags:

```
cuban & brand                    // intersection
cuban | dominican                // union
cuban - discontinued             // difference
cuban & brand & !discontinued    // intersection with complement
lineage:cigars/brands            // lineage predicate
deps:abc123...                   // dependency predicate
author:npub1...                  // authorship predicate
```

expressions are strings. strings are bytes. bytes have signatures. the expression language is self-hosting — every query is content-addressed.

### performance characteristics

| operation | complexity | notes |
|-----------|-----------|-------|
| tag lookup | O(1) | hash map from tag name to signature set |
| set union | O(n + m) | merge two sorted arrays |
| set intersection | O(min(n, m)) | scan the smaller set |
| set difference | O(n + m) | single pass over both |
| dependency lookup | O(1) | `beeDeps` in manifest |
| transitive closure | O(V + E) | standard graph traversal |
| bloom filter test | O(k) | k hash functions, typically 3-7 |
| merkle root | O(n) | single pass, pairwise hashing |

all operations are sub-second for realistic collection sizes (thousands to tens of thousands of signatures). the bottleneck is never the algebra — it's the I/O to fetch the content the signatures point to.

### what this does NOT do

- **modify signatures**: signatures are immutable. the algebra operates over them, never on them.
- **replace content addressing**: the algebra depends on content addressing. it's a layer above, not a replacement.
- **require consensus**: each peer evaluates expressions against their local **S**. results may differ if peers have different content. this is a feature — local-first by design.
- **break SHA-256 properties**: no homomorphic operations on hash values. `hash(a) + hash(b) ≠ hash(a + b)`. the algebra works on *sets of* hashes, not on the hash bits themselves.
- **require new cryptographic primitives**: everything uses standard SHA-256 via `SignatureService.sign()`. no new hash functions, no zero-knowledge proofs, no fancy crypto. pure set theory over deterministic identifiers.

---

## relationship to existing hypercomb primitives

| primitive | role in the algebra |
|-----------|-------------------|
| `SignatureService.sign()` | produces atoms (**S** elements) |
| keywords in LayerState | produces tag sets (`T()`) |
| lineage | produces the hierarchical dimension (`L()`) |
| `beeDeps` in manifest | produces the dependency graph (`D()`) |
| `authenticity` (deterministic computation) | the composition function (`C()`) |
| EffectBus | the reactive substrate for live pipelines |
| Nostr mesh | the transport for publishing and subscribing to algebraic results |
| Bloom filters (gossip) | compact algebraic summaries for efficient sync |

the algebra doesn't introduce new primitives. it *names and formalizes* the operations already latent in the system, making them composable, shareable, and reactive.

---

## conclusion

signature algebra is the realization that content-addressed identifiers, combined with metadata (tags, lineage, dependencies, authorship), form a complete algebraic structure. the operations — union, intersection, difference, composition, projection, transitive closure — are simple, well-understood, and fast.

the power is not in any single operation. it's in the *composability*. every result is a set of signatures. every set can be further operated on. every expression is itself content-addressed. the algebra is closed — its outputs are the same type as its inputs.

this means queries are identities. subscriptions are expressions. access control is set membership. search is lattice navigation. sync is set difference. trust is merkle composition.

one algebra. every dimension.
