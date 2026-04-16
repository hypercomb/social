# Signature System

**Critical architecture infrastructure.** Every design decision, every data structure, every new feature follows this doctrine. Without signature composition, nothing in Hypercomb scales. With it, every fragment is composable, every superposition is cacheable, and compute becomes optional.

---

## The primitive: signature + payload

Every artifact in Hypercomb is a **signature-payload pair**.

- **Signature** — SHA-256 hash (64 hex chars) of the artifact's bytes. Deterministic, immutable, content-derived.
- **Payload** — the artifact itself — a compiled module, a JSON document, an image, a layer manifest.

Same content always produces the same signature. Different content always produces a different signature. **The signature is the identity.**

### What this enables

- **Content addressing.** No version numbers, no sequential IDs, no registries. The hash of the content names the content. Two systems that have never communicated will derive the same signature for the same artifact.
- **Deduplication.** If two cells reference the same image, they store one copy in `__resources__/<sig>`. The signature guarantees they are identical.
- **Integrity verification.** Before any code executes, its bytes are hashed and compared against the expected signature. Mismatch means corruption or tampering — the artifact is rejected, no fallback.
- **Reproducibility.** Given the same inputs and the same build rules, the output signature is identical. If the signature matches, the artifact is proven correct without re-executing the build.

### The pipeline

```
content bytes  →  SHA-256  →  64-char hex signature
```

For structured data, canonicalization ensures deterministic output:

```
object  →  structuredClone  →  JSON.stringify (sorted keys)  →  TextEncoder  →  ArrayBuffer  →  SHA-256  →  signature
```

`SignatureService.sign(buffer)` computes the hash. `SignatureStore` memoizes known signatures to avoid redundant hashing during render cycles.

### The invariant

The signature is proof. If you know the signature, you know the content has not changed. If you have the content, you can independently verify the signature. No trust required — the math is the authority.

---

## Why composition is non-negotiable

### Composable fragments are the foundation

Every piece of data — a cell, an instruction label, a settings preset, a history operation, a thread message, a layout configuration — is a **composable fragment**:

1. **Content-addressed** — its SHA-256 signature IS its identity
2. **Immutable** — same content → same signature, forever
3. **Composable** — fragments combine into larger structures, which are themselves fragments with their own signatures
4. **Cacheable at every level** — a single instruction, a set of instructions, a full manifest, a snapshot of the entire system — each level has a signature, each is cacheable

### Snapshots eliminate compute

When every fragment is signature-addressed, you can take a **snapshot** of any combination at any point in time. That snapshot is itself a signature. Anyone who has that signature can retrieve the exact state — no recomputation, no querying, no assembling from parts.

```
Fragment A (sig: aaa…)  ─┐
Fragment B (sig: bbb…)  ─┼→ Composition AB (sig: ccc…)  ─┐
Fragment C (sig: ddd…)  ─┘                                ├→ Snapshot (sig: fff…)
Fragment D (sig: eee…)  ──────────────────────────────────┘
```

The snapshot signature `fff…` captures the entire superposition. Share it. Cache it. Retrieve it instantly. **Nobody else has to do the compute** — they just need the signature.

This is what makes the system scale:

- **No redundant computation** — if someone has already computed a result for a given set of inputs, the result signature exists. Look it up.
- **No coordination** — two peers who independently arrive at the same state produce the same signature. No consensus protocol needed.
- **No data migration** — old signatures remain valid forever. New compositions create new signatures without invalidating old ones.
- **No versioning complexity** — there are no "versions." There are only signatures. A "new version" is a new signature. The old one still works.

### What happens without this

As soon as you store inline data instead of a signature reference, you lose composition. That inline data:

- Cannot be deduplicated (two copies of the same content have no shared identity)
- Cannot be cached independently (it's embedded in its parent, not addressable)
- Cannot be shared (you'd have to share the entire parent, not the fragment)
- Cannot be composed into larger structures (it has no signature to compose with)
- Cannot be time-traveled (history can't point at it — it has no address)
- Cannot be verified (no signature means no integrity check)

**One inline field breaks the entire composition chain above it.** If Fragment B stores data inline instead of as a resource, then Composition AB can't be deterministically signed (because B's content isn't content-addressed), and the Snapshot above it is meaningless.

You can't retrofit composition onto inline data. You can't add caching to embedded content. You can't share what has no address.

---

## The core rule

> If a field contains content that could be shared, cached, versioned, or composed — it must be a signature reference to a resource. Never store expandable content inline.

A signature is a 64-character hex string. It points to a blob in `__resources__/<signature>`. The blob is immutable — same content always produces the same signature. Resolution is lazy — signatures remain as lightweight string pointers until explicitly expanded via `Store.getResource(sig)`.

---

## The expansion mechanism

### Storage

```ts
const json = JSON.stringify(data, Object.keys(data).sort(), 0) // deterministic key order
const sig = await Store.putResource(new Blob([json]))
// sig = "a1b2c3d4e5f6…" (64 hex chars)
// content now lives at __resources__/a1b2c3d4e5f6…
```

### Reference

```ts
// In a JSON file, history op, manifest, or class property:
{ "settingsSig": "a1b2c3d4e5f6…" }
```

### Expansion

```ts
const blob = await Store.getResource(sig)
const data = JSON.parse(await blob.text())
```

### Deterministic serialization

Keys must be sorted before signing. `JSON.stringify(data, Object.keys(data).sort(), 0)` ensures that two objects with the same content but different key insertion order produce the same signature. Without this, identical logical content would produce different signatures, breaking deduplication and cache hits. See [deterministic-computation.md](deterministic-computation.md) for how this extends to computation results.

---

## Where signatures appear

| context | what is signed | signature names |
|---|---|---|
| Bee modules | Compiled JS bundle | `__bees__/<sig>.js` |
| Dependencies | Namespace service bundle | `__dependencies__/<sig>.js` |
| Resources | Static asset (image, JSON) | `__resources__/<sig>` |
| Layers | Layer manifest JSON | `__layers__/<sig>.json` |
| Root release | `install.manifest.json` | Root signature in `latest.json` |
| Lineage paths | UTF-8 path string | Location signature for mesh subscription |
| History ops | Operation content | Cell identity in history bags |
| Thread manifests | `contentSig` | Message content blob |
| Layer files | `bees[]`, `layers[]`, `dependencies[]` | Bee modules, child layers, dependency bundles |
| Install manifests | `packages[sig]` | Package keyed by its own signature |
| Deterministic computation | `authenticity` | Composition of script-sig + resource-sig |
| Computation results | `result-sig` | Content-addressed output blob |

---

## The litmus test

Before adding a new field to any data structure, ask:

1. **Could this content appear in more than one place?** → Signature reference.
2. **Would undoing/redoing this require storing the old value?** → Signature reference. History points at the signature.
3. **Could this be shared with another user or peer?** → Signature reference. Share the signature, they resolve it.
4. **Is this content larger than a short identifier or flag?** → Signature reference.
5. **Could this be part of a larger composition?** → Signature reference. Compositions need addressable parts.
6. **Is this a boolean, enum, or simple scalar?** → Inline is fine. (e.g., `visible: true`, `placement: 'top'`)

### What's acceptable inline

- Booleans — `visible: true`
- Enums / small strings — `placement: 'top'`, `op: 'add'`
- Timestamps — `at: 1712345678`
- Cell names in `add`/`remove` history ops (identifiers, not content)
- Signature strings themselves (they're references, not content)
- Short arrays of signatures or identifiers

### What must be a resource

- Ordered lists (cell reorder payloads)
- Message content (thread turns)
- Configuration objects (settings, presets, themes)
- Instruction catalogs and visibility state
- Any structured data that could be versioned, shared, or composed
- Any payload larger than ~100 bytes that isn't a simple scalar

---

## Anti-patterns

### 1. Inline complex data in history operations

```ts
// BREAKS COMPOSITION — not addressable, not cacheable, not shareable
{ op: 'reorder', cell: 'tile-name', data: { order: ['a', 'b', 'c'] } }

// COMPOSABLE — payload stored as resource, op references signature
const sig = await Store.putResource(new Blob([JSON.stringify(['a', 'b', 'c'])]))
{ op: 'reorder', cell: sig, at: Date.now() }
```

### 2. Inline configuration that could be versioned

```ts
// BREAKS COMPOSITION — can't undo, can't share, can't snapshot
localStorage.setItem('hc:my-settings', JSON.stringify({ theme: 'dark', … }))

// COMPOSABLE — settings as resource, signature in localStorage
const sig = await Store.putResource(new Blob([JSON.stringify({ theme: 'dark', … })]))
localStorage.setItem('hc:my-settings-sig', sig)
```

### 3. Inline text content in structured data

```ts
// BREAKS COMPOSITION — can't dedup, can't reference independently
{ turns: [{ role: 'user', content: 'Hello, this is a message…' }] }

// COMPOSABLE — content as resource, signature in manifest
{ turns: [{ role: 'user', contentSig: 'abc123…' }] }
```

### 4. Hardcoded arrays that should be resources

```ts
// BREAKS COMPOSITION — can't version, can't share, can't compose with
const DEFAULT_INSTRUCTIONS = [{ selector: '…', label: '…' }, …]

// COMPOSABLE — defaults as resource; the factory preset is just another signature
const defaultSig = await Store.putResource(new Blob([JSON.stringify(defaults)]))
```

### 5. Non-deterministic serialization

```ts
// BREAKS COMPOSITION — different key order → different signature → broken dedup
JSON.stringify({ b: 2, a: 1 }) // '{"b":2,"a":1}'
JSON.stringify({ a: 1, b: 2 }) // '{"a":1,"b":2}' — same content, different signature!

// COMPOSABLE — sorted keys → deterministic output
JSON.stringify(data, Object.keys(data).sort(), 0)
```

---

## Composition at every level

Signatures compose at every level of granularity.

**Cell level** — a single cell's content is a resource. Its signature is its identity. Two cells with identical content have the same signature — automatic deduplication.

**Collection level** — a set of cells in a directory has an order (also a resource, via `reorder` ops). The collection's state at a point in time is the set of cell signatures + the order resource signature.

**Feature level** — an instruction manifest collects anchors from all bees. It's a resource. An instruction settings preset selects which anchors are visible. It's also a resource. The combination (manifest + settings) is a superposition — itself composable into a higher-level snapshot.

**System level** — the entire system state at time T is the set of all resource signatures active at T. Derivable from history (replay ops up to timestamp T). The system snapshot is itself a composable, cacheable, shareable identity.

**Superposition** — any arbitrary combination of fragments from any level can be composed:

```
Superposition = SHA-256(concat(sort([sig_A, sig_B, sig_C, …])))
```

This superposition signature captures exactly that combination. Cache it. Share it. Anyone who resolves it gets exactly that state. **No compute required** — the work was done once, the result is addressable forever.

This is why we call it signature algebra (see [signature-algebra.md](signature-algebra.md)): the algebra is closed — composing signatures produces signatures, which can be further composed. The system is fractal — the same pattern at every scale.

---

## Caching strategy

### Three-level cache (standard pattern for every service)

| level | storage | speed | invalidation |
|---|---|---|---|
| In-memory | `Map<string, T>` in the service | synchronous | service lifecycle |
| OPFS | `__resources__/<sig>` | microseconds | never (immutable content) |
| SignatureStore | `signText()` memo | synchronous | never (deterministic) |

### Cache hit flow

1. Check in-memory map for signature → return if found
2. Call `Store.getResource(sig)` → read from OPFS → parse → store in memory → return
3. On next access → step 1 hits immediately

Because resources are immutable, **cache invalidation does not exist**. A signature always maps to the same content. New content = new signature = new cache entry. Old entries remain valid.

### Fingerprint-based rebuild

When the underlying data changes (e.g., new bees registered), compute a fingerprint of the inputs. If fingerprint matches the last build, the existing resource signature is still valid — no rebuild needed.

```ts
const fingerprint = ioc.list().sort().join(',')
if (fingerprint === this.#lastFingerprint) return this.#cachedManifestSig
// else: rebuild manifest, sign it, cache it
```

---

## Audit criteria

When auditing the codebase for compliance:

1. **Data structures** — does every content field use a signature reference? Flag inline data that should be a resource.
2. **History operations** — does every `HistoryOp` use resource signatures for complex payloads? Flag inline data in `cell` fields.
3. **localStorage** — is configuration stored as a signature pointing to OPFS, or as inline JSON? Simple flags OK; complex configs not.
4. **Serialization determinism** — are keys sorted before signing? Flag any `JSON.stringify` → `sign()` path without key sorting.
5. **Cache patterns** — does every service implement the three-level cache? Flag re-fetching what could be cached.
6. **Composition completeness** — can every stateful entity be captured as a signature? Flag any state that exists only as mutable inline data.
7. **Cell-level content addressing** — are individual cells and their metadata content-addressable? Flag mutable inline cell data.

---

## See also

- [signature-algebra.md](signature-algebra.md) — formal algebra: set operations, projections, reactive pipelines over signatures
- [signature-node-pattern.md](signature-node-pattern.md) — plug-and-play implementation guide; copy the template, your feature is signature-addressed
- [collapsed-compute.md](collapsed-compute.md) — network effect: signature caching eliminates redundant computation across peers
- [deterministic-computation.md](deterministic-computation.md) — authenticity layer: composing script + resource signatures for global memoization
- [genome-primitive.md](genome-primitive.md) — recursive Merkle root over subtrees; universal short-circuit for derived computations
- [dependency-signing.md](dependency-signing.md) — single signature securing entire package hierarchy
- [architecture-fundamentals.md](architecture-fundamentals.md) — where signatures fit in the runtime
