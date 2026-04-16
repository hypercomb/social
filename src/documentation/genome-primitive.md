# genome primitive

> **core infrastructure.** the genome is a recursive merkle root over a subtree — a single signature that captures the complete state of a branch and all its descendants. if the genome hasn't changed, nothing underneath has changed. any derived computation cached against that genome is still valid. this is how the system short-circuits tree walks and scales infinitely.

## related critical documents

- [signature-algebra.md](signature-algebra.md) — the algebra: tag functions, set operations, lineage projections
- [collapsed-compute.md](collapsed-compute.md) — the collapse hierarchy: genomes enable level 6 (subtree-level collapse)
- [signature-system.md](signature-system.md) — the signature-payload pair (atoms of the genome tree) and the mandatory expansion doctrine that makes genomes work

---

## the problem

the signature system gives every piece of content an immutable identity. but subtrees don't have one. to answer "has anything changed in this branch?" you must walk every child, read every `0000` file, check every signature. for a tag query like `?:education`, you'd walk the entire tree to find matches — O(n) on every query.

the genome solves this by giving **subtrees** the same property that signatures give **content**: a single immutable identity that changes if and only if the underlying state changes.

---

## definition

the genome of a cell is a recursive hash of the cell's own signature and the sorted genomes of all its children.

```
genome(leaf)   = sign(leaf.signature)
genome(parent) = sign(concat(parent.signature, sort([genome(child₁), genome(child₂), ...])))
```

- **leaf cells** (no children): genome equals their content signature
- **parent cells**: genome is the hash of their signature concatenated with the sorted genomes of all children
- **sorting**: children's genomes are sorted lexicographically before concatenation, so the genome is independent of directory enumeration order

a single byte change in any descendant produces a different genome at every ancestor up to root. conversely, an identical genome guarantees that the entire subtree is unchanged — every cell, every tag, every resource, every child at every depth.

### formal definition

let `G: S → S` be the genome function over signature space:

```
G(s) = sign(s)                                           if children(s) = ∅
G(s) = sign(concat(s, sort([G(c) for c in children(s)])))  otherwise
```

properties:
- **deterministic**: same subtree state → same genome. every peer computes the same genome independently.
- **tamper-evident**: any change at any depth invalidates the genome at every ancestor.
- **compositional**: genomes compose upward — the root genome captures the entire tree.

---

## the genome cache

genomes are stored as signature-addressed resources, like everything else.

### storage

```
__resources__/{genome-sig}  →  GenomePayload (JSON blob)
```

the genome payload for a subtree contains the pre-computed results of whatever derived computation was performed against that genome:

```typescript
type GenomePayload = {
  genome: Signature          // the genome signature itself
  root: Signature            // the root cell signature of this subtree
  computed: Record<string, Signature>  // derived results keyed by computation type
}
```

for tag queries specifically:

```typescript
type TagIndex = {
  tags: Record<string, Signature[]>  // tag name → array of cell signatures carrying that tag
  cells: Record<string, string[]>    // cell signature → array of tag names on that cell
}
```

this tag index is itself a signed resource: `sign(JSON.stringify(tagIndex))`. the genome payload points to it:

```typescript
genomePayload.computed['tags'] = tagIndexSignature
```

### the short-circuit

```
query: ?:education

1. compute genome of current subtree root
2. look up genome in cache → found?
   YES → load genomePayload.computed['tags'] → load tagIndex → filter for 'education' → done
   NO  → walk tree, collect tags, build tagIndex, sign it, store genomePayload, return results
```

the walk happens **once per genome**. every subsequent query for any tag under the same genome is an instant lookup. the cache invalidates automatically — if any child changes, the genome changes, and the old cache entry simply becomes unreachable (but costs nothing, since it's content-addressed and can be garbage-collected).

---

## bubble-up invalidation

when a cell changes (content edit, tag add/remove, child added/removed), the genome must be recomputed for that cell and every ancestor up to root. this is O(depth), not O(n):

```
cell changes → recompute genome(cell)
             → recompute genome(parent)
             → recompute genome(grandparent)
             → ... up to root

depth of tree: d
cost of invalidation: O(d) hash operations
cost of re-walking: 0 (deferred until next query)
```

the invalidation only marks the path as dirty. the actual recomputation (building a new tag index, etc.) is lazy — it happens on the next query that hits a stale genome. this means rapid edits don't trigger repeated expensive walks. only the final state gets computed.

### dirty tracking

```typescript
type GenomeState = {
  genome: Signature | null     // null = dirty, needs recomputation
  childGenomes: Map<string, Signature>  // child name → child genome
}
```

when a child signals a change, the parent sets `genome = null` and propagates upward. the next query triggers recomputation from the deepest dirty node upward.

---

## tag query syntax

the `?` prefix activates tag query mode in the command line. the query runs against the tag index cached under the current subtree's genome.

| syntax | meaning | algebra |
|--------|---------|---------|
| `?:education` | cells tagged `education` | `T("education")` |
| `?:[education, work]` | cells tagged `education` OR `work` | `T("education") ∪ T("work")` |
| `?:[education, work]!` | cells tagged `education` AND `work` | `T("education") ∩ T("work")` |
| `?:~archived` | cells NOT tagged `archived` | `S \ T("archived")` |
| `?:[education, ~archived]` | tagged `education`, not `archived` | `T("education") \ T("archived")` |

the `~` prefix for negation and `[]` brackets for batching reuse the existing syntax patterns from tag assignment and array-parser.

### result display

query results are displayed as tiles in the current view. each matched cell is rendered directly — the genome's tag index gives us the cell signatures, and those signatures resolve to OPFS content instantly. no tree walk, no enumeration, no warm-up cascade for the query itself.

navigating **into** a matched cell loads its children normally (lazy, on-demand). the genome ensures the matched set is correct; depth exploration remains lazy.

---

## generalized signature tagging

tags currently live on cells (in the `0000` properties file). the genome primitive motivates generalizing this: **any signature can carry tags**, not just cells.

```
signature → tags[]
```

this means:
- **cells** have tags (existing behavior)
- **computation receipts** have tags (`?:verified`, `?:memoized`)
- **resources** have tags (`?:image`, `?:json`, `?:large`)
- **thread manifests** have tags (`?:resolved`, `?:pending`)
- **layer manifests** have tags (`?:stable`, `?:experimental`)

the tag index in the genome payload already supports this — it maps signatures to tags, not cell-names to tags. the only change is allowing tag assignment on non-cell signatures.

---

## collapse level 6: subtree-level collapse

the genome extends the collapse hierarchy from [collapsed-compute.md](collapsed-compute.md):

| level | what's collapsed | signature of |
|-------|-----------------|-------------|
| 1 | fragment | single resource |
| 2 | composition | set of fragments |
| 3 | computation | script + resource → result |
| 4 | superposition | arbitrary combination |
| 5 | temporal | snapshot at time T |
| **6** | **subtree (genome)** | **recursive state of entire branch** |

a genome signature subsumes all signatures in the subtree. sharing a genome means sharing the proof that an entire branch is in a known state — without enumerating any of its contents.

### cross-peer genome sharing

when two peers compare subtrees, they compare genomes:

```
peer A genome: abc123...
peer B genome: abc123...
→ identical. no sync needed. zero bytes transferred.

peer A genome: abc123...
peer B genome: def456...
→ different. walk one level deeper, compare child genomes to find divergence point.
```

this is the standard merkle sync algorithm. it applies directly because genomes ARE merkle roots.

---

## implementation: genome worker

the genome computation runs in a dedicated worker bee to avoid blocking the UI thread during tree walks. the worker is a service registered in IoC.

### GenomeService

```typescript
// registered as '@hypercomb.social/Genome'

interface GenomeService {
  // compute or return cached genome for a subtree root
  genome(root: FileSystemDirectoryHandle): Promise<Signature>

  // get the cached tag index for a genome (null if not yet computed)
  tagIndex(genome: Signature): Promise<TagIndex | null>

  // build and cache the tag index for a genome
  buildTagIndex(root: FileSystemDirectoryHandle): Promise<TagIndex>

  // invalidate genome for a cell and its ancestors
  invalidate(path: string[]): void

  // query: find cells matching a tag expression
  query(expression: TagExpression): Promise<Signature[]>
}
```

### TagExpression

```typescript
type TagExpression =
  | { op: 'has'; tag: string }                              // ?:tag
  | { op: 'not'; tag: string }                              // ?:~tag
  | { op: 'union'; expressions: TagExpression[] }           // ?:[a, b]
  | { op: 'intersection'; expressions: TagExpression[] }    // ?:[a, b]!
  | { op: 'difference'; left: TagExpression; right: TagExpression }  // has a, not b
```

### lifecycle

1. **on app load**: compute root genome (lazy — only when first query arrives)
2. **on cell change**: `invalidate(path)` nulls genomes up the ancestor chain
3. **on tag query**: `genome(root)` recomputes if dirty, then `tagIndex(genome)` returns cached results
4. **on tag assignment**: `invalidate(path)` for the tagged cell, genome recomputes on next query

the worker listens to these effects:
- `cell:added`, `cell:removed` → invalidate parent genome
- `tags:changed` → invalidate cell genome
- `tile:saved` → invalidate cell genome
- `cell:reorder` → invalidate parent genome

---

## scout integration: pre-solving genomes

the genome is only useful if it's already computed when you need it. waiting until query time to walk the tree defeats the purpose. this is where **scouts** come in.

scouts are reconnaissance agents — bees that fly ahead, gather intelligence, and report back. in the genome context, scouts are background computations that keep genome caches warm ahead of demand. they use the existing `ComputationService` (`@diamondcoreprocessor.com/ComputationService`) to record their results as standard computation receipts.

### the pattern

```
1. cell changes → invalidate genome up the ancestor chain
2. scout notices dirty genome → walks the subtree in the background
3. scout builds derived data (tag index, search index, etc.)
4. scout records result as computation receipt:
     input  = genome signature
     function = "genome:tags" (or "genome:search", "genome:count", etc.)
     output = signed payload (the tag index resource)
5. next query → genome matches → lookup receipt → instant result
```

the scout doesn't wait for a query. it pre-solves. by the time the user types `?:education`, the tag index for the current genome is already cached as a computation receipt. the query resolves in a single `ComputationService.lookup()` — no tree walk, no OPFS enumeration.

### scout queen: `/scout`

a scout queen bee manages the fleet of background genome solvers:

| command | effect |
|---------|--------|
| `/scout` | show active scouts and their cache status |
| `/scout tags` | ensure tag index is pre-solved for current subtree |
| `/scout search` | ensure full-text search index is pre-solved |
| `/scout all` | pre-solve all registered genome computations |
| `/scout off` | pause background pre-solving |

scouts listen to `cell:added`, `cell:removed`, `tags:changed`, `tile:saved` — the same effects that trigger genome invalidation. when they detect a dirty genome, they queue a background re-solve. the queue is debounced — rapid edits don't trigger repeated walks. only the final stable state gets computed.

### computation receipt format for genomes

genome computations use the standard receipt model:

```typescript
// recording a genome tag index
const genomeSignature = await genomeService.genome(root)
const tagIndex = await genomeService.buildTagIndex(root)
const tagIndexSignature = await store.putResource(new Blob([JSON.stringify(tagIndex)]))

await computationService.record({
  inputSignature: genomeSignature,
  functionSignature: await signText('genome:tags'),
  outputSignature: tagIndexSignature,
  timestamp: Date.now()
})

// later: instant lookup
const receipt = await computationService.lookup(genomeSignature, await signText('genome:tags'))
if (receipt) {
  const tagIndex = JSON.parse(await (await store.getResource(receipt.outputSignature)).text())
  // use tagIndex directly — no walk needed
}
```

### swarm sharing

because computation receipts are signature-addressed and sharable via nostr relays (kind 29011), genome results participate in [collapsed compute](collapsed-compute.md):

```
peer A solves genome abc123... → records receipt → publishes to mesh
peer B has same subtree (same genome abc123...) → discovers receipt → skips computation entirely
```

the more peers in the swarm, the more genomes are pre-solved. a popular subtree (e.g., a widely-installed module) gets its genome solved once by whichever peer changes first, then every other peer with the same content gets the result for free.

this is the scout metaphor made literal: scouts fly ahead, solve the genome, and dance their findings. the swarm benefits from every scout's work. "no dance" (no result) means the genome is unchanged — silence is information.

---

## reuse everywhere

the genome is not specific to tag queries. it's the universal short-circuit for any derived computation over a subtree:

| computation | genome cache key | payload |
|-------------|-----------------|---------|
| tag index | `computed['tags']` | tag → signatures mapping |
| child count | `computed['count']` | total descendant count |
| size estimate | `computed['size']` | total bytes in subtree |
| dependency graph | `computed['deps']` | transitive dependency closure |
| search index | `computed['search']` | full-text index of cell content |
| layout snapshot | `computed['layout']` | pre-computed tile positions |

any new feature that needs to aggregate over a subtree should:
1. check the genome — if unchanged, load cached result
2. if changed, compute the result, sign it, store under the genome's `computed` map
3. the next query is free

this is [collapsed compute](collapsed-compute.md) applied to tree structure. the genome is the memoization key for the entire subtree.

---

## the invariant

> **same genome = same subtree state = same derived results.**

if two cells (on the same peer or different peers) have the same genome, every query against them produces identical results. no coordination, no synchronization, no re-computation. the math guarantees it.
