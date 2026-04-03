# Signature Expansion Doctrine

> **This is critical architecture infrastructure.** Every design decision, every data structure, every new feature must follow this doctrine. Without signature composition, nothing in Hypercomb scales. With it, every fragment is composable, every superposition is cacheable, and compute becomes optional.

## Related Critical Documents

- [core-primitive.md](core-primitive.md) — The signature-payload pair: every artifact is content-addressed
- [signature-algebra.md](signature-algebra.md) — The formal algebra: set operations, projections, reactive pipelines over signatures
- [deterministic-computation.md](deterministic-computation.md) — Authenticity layer: script + resource → deterministic result, all signature-addressed
- [architecture-overview.md](architecture-overview.md) — Live presence: identity is content-addressed, not account-based
- [dependency-signing.md](dependency-signing.md) — Dependency bundles are signature-addressed modules

These documents describe different facets of the same principle. This doctrine codifies the **mandatory practice** that makes all of them work together.

---

## Why This Is Non-Negotiable

### Composable fragments are the foundation

Every piece of data in Hypercomb — a cell, an instruction label, a settings preset, a history operation, a thread message, a layout configuration — is a **composable fragment**. A fragment is:

1. **Content-addressed**: its SHA-256 signature IS its identity
2. **Immutable**: same content → same signature, forever
3. **Composable**: fragments combine into larger structures, which are themselves fragments with their own signatures
4. **Cacheable at every level**: a single instruction, a set of instructions, a full manifest, a snapshot of the entire system — each level has a signature, each is cacheable

### Snapshots eliminate compute

When every fragment is signature-addressed, you can take a **snapshot** of any combination at any point in time. That snapshot is itself a signature. Anyone who has that signature can retrieve the exact state — no recomputation, no querying, no assembling from parts.

```
Fragment A (sig: aaa...)  ─┐
Fragment B (sig: bbb...)  ─┼→ Composition AB (sig: ccc...)  ─┐
Fragment C (sig: ddd...)  ─┘                                  ├→ Snapshot (sig: fff...)
Fragment D (sig: eee...)  ────────────────────────────────────┘
```

The snapshot signature `fff...` captures the entire superposition. Share it. Cache it. Retrieve it instantly. **Nobody else has to do the compute** — they just need the signature.

This is what makes the system scale:
- **No redundant computation**: if someone has already computed a result for a given set of inputs, the result signature exists. Look it up.
- **No coordination**: two peers who independently arrive at the same state produce the same signature. No consensus protocol needed.
- **No data migration**: old signatures remain valid forever. New compositions create new signatures without invalidating old ones.
- **No versioning complexity**: there are no "versions." There are only signatures. A "new version" is a new signature. The old one still works.

### What happens without this

**As soon as you store inline data instead of a signature reference, you lose composition.** That inline data:
- Cannot be deduplicated (two copies of the same content have no shared identity)
- Cannot be cached independently (it's embedded in its parent, not addressable)
- Cannot be shared (you'd have to share the entire parent, not the fragment)
- Cannot be composed into larger structures (it has no signature to compose with)
- Cannot be time-traveled (history can't point at it — it has no address)
- Cannot be verified (no signature means no integrity check)

**One inline field breaks the entire composition chain above it.** If Fragment B stores data inline instead of as a resource, then Composition AB can't be deterministically signed (because B's content isn't content-addressed), and the Snapshot above it is meaningless.

**This doesn't scale the other way.** You can't retrofit composition onto inline data. You can't add caching to embedded content. You can't share what has no address. The decision to use inline data is a decision to break the chain at that point and everything above it.

---

## The Core Rule

> **If a field contains content that could be shared, cached, versioned, or composed — it must be a signature reference to a resource. Never store expandable content inline.**

A signature is a 64-character hex string. It points to a blob in `__resources__/<signature>`. The blob is immutable — same content always produces the same signature. Resolution is lazy — signatures remain as lightweight string pointers until explicitly expanded via `Store.getResource(sig)`.

---

## The Expansion Mechanism

Expansion is mechanical: a signature string in a JSON field or class property gets resolved to its content at runtime.

### Storage

```typescript
// Store content, get signature
const json = JSON.stringify(data, Object.keys(data).sort(), 0) // deterministic key order
const sig = await Store.putResource(new Blob([json]))
// sig = "a1b2c3d4e5f6..." (64 hex chars)
// content now lives at __resources__/a1b2c3d4e5f6...
```

### Reference

```typescript
// In a JSON file, history op, manifest, or class property:
{ "settingsSig": "a1b2c3d4e5f6..." }
```

### Expansion

```typescript
// Resolve lazily when the content is actually needed
const blob = await Store.getResource(sig)
const data = JSON.parse(await blob.text())
```

### Why Deterministic Serialization

Keys must be sorted before signing. `JSON.stringify(data, Object.keys(data).sort(), 0)` ensures that two objects with the same content but different key insertion order produce the same signature. Without this, identical logical content would produce different signatures, breaking deduplication and cache hits. See [deterministic-computation.md](deterministic-computation.md) for how this extends to computation results.

---

## Where Signatures Must Be Used

### The Litmus Test

Before adding a new field to any data structure, ask:

1. **Could this content appear in more than one place?** → Signature reference.
2. **Would undoing/redoing this require storing the old value?** → Signature reference. History points at the signature.
3. **Could this be shared with another user or peer?** → Signature reference. Share the signature, they resolve it.
4. **Is this content larger than a short identifier or flag?** → Signature reference.
5. **Could this be part of a larger composition?** → Signature reference. Compositions need addressable parts.
6. **Is this a boolean, enum, or simple scalar?** → Inline is fine. (e.g., `visible: true`, `placement: 'top'`)

### Already implemented

| System | Field | What it references |
|--------|-------|--------------------|
| History ops | `cell` (on `reorder`) | Resource containing ordered cell list |
| Thread manifests | `contentSig` | Message content blob |
| Layer files | `bees[]`, `layers[]`, `dependencies[]` | Bee modules, child layers, dependency bundles |
| Install manifests | `packages[sig]` | Package keyed by its own signature |
| Deterministic computation | `authenticity` | Composition of script-sig + resource-sig (see [deterministic-computation.md](deterministic-computation.md)) |
| Computation results | `result-sig` | Content-addressed output blob |
| OPFS directories | `__bees__/<sig>.js`, `__dependencies__/<sig>.js`, `__resources__/<sig>` | All content-addressed by filename |

### Must be implemented (new features)

Every new feature must follow this pattern. No exceptions. Examples:

| System | Field | What it references |
|--------|-------|--------------------|
| Instruction manifest | Stored as resource | Full catalog of all instruction anchors |
| Instruction settings | `manifestSig` + `hidden[]` | Which instructions are visible/hidden |
| History ops | `cell` (on `instruction-state`) | Instruction settings resource |
| Any new preset/config | Stored as resource | User preferences, layouts, themes |
| Any new structured payload | Stored as resource | Complex data referenced by signature |

---

## Anti-Patterns to Detect and Eliminate

### 1. Inline complex data in history operations

```typescript
// BREAKS COMPOSITION: inline payload — not addressable, not cacheable, not shareable
{ op: 'reorder', cell: 'tile-name', data: { order: ['a', 'b', 'c'] } }

// COMPOSABLE: payload stored as resource, op references signature
const sig = await Store.putResource(new Blob([JSON.stringify(['a', 'b', 'c'])]))
{ op: 'reorder', cell: sig, at: Date.now() }
```

### 2. Inline configuration that could be versioned

```typescript
// BREAKS COMPOSITION: settings as direct object — can't undo, can't share, can't snapshot
localStorage.setItem('hc:my-settings', JSON.stringify({ theme: 'dark', ... }))

// COMPOSABLE: settings as resource, signature in localStorage
const sig = await Store.putResource(new Blob([JSON.stringify({ theme: 'dark', ... })]))
localStorage.setItem('hc:my-settings-sig', sig)
```

### 3. Inline text content in structured data

```typescript
// BREAKS COMPOSITION: message content inline — can't dedup, can't reference independently
{ turns: [{ role: 'user', content: 'Hello, this is a message...' }] }

// COMPOSABLE: content as resource, signature in manifest
{ turns: [{ role: 'user', contentSig: 'abc123...' }] }
```

### 4. Hardcoded arrays that should be resources

```typescript
// BREAKS COMPOSITION: hardcoded defaults — can't version, can't share, can't compose with
const DEFAULT_INSTRUCTIONS = [{ selector: '...', label: '...' }, ...]

// COMPOSABLE: defaults as resource — the "factory preset" is just another signature
const defaultSig = await Store.putResource(new Blob([JSON.stringify(defaults)]))
```

### 5. Non-deterministic serialization

```typescript
// BREAKS COMPOSITION: different key order → different signature → broken dedup
JSON.stringify({ b: 2, a: 1 }) // '{"b":2,"a":1}'
JSON.stringify({ a: 1, b: 2 }) // '{"a":1,"b":2}' — same content, different signature!

// COMPOSABLE: sorted keys → deterministic output → correct signature
JSON.stringify(data, Object.keys(data).sort(), 0)
```

---

## Composition at Every Level

The power is that signatures compose **at every level of granularity**:

### Cell level (the finest grain)
A single cell's content is a resource. Its signature is its identity. Two cells with identical content have the same signature — automatic deduplication.

### Collection level
A set of cells in a directory has an order (also a resource, via `reorder` ops). The collection's state at a point in time is the set of cell signatures + the order resource signature.

### Feature level
An instruction manifest collects anchors from all bees. It's a resource. An instruction settings preset selects which anchors are visible. It's also a resource. The combination (manifest + settings) is a superposition — and could itself be composed into a higher-level snapshot.

### System level
The entire system state at time T is the set of all resource signatures that were active at T. This is derivable from history (replay ops up to timestamp T). The system snapshot is itself a composable, cacheable, shareable identity.

### Superposition
Any arbitrary combination of fragments from any level can be composed:

```
Superposition = SHA-256(concat(sort([sig_A, sig_B, sig_C, ...])))
```

This superposition signature captures exactly that combination. Cache it. Share it. Anyone who resolves it gets exactly that state. **No compute required** — the work was done once, the result is addressable forever.

This is why we call it signature algebra (see [signature-algebra.md](signature-algebra.md)): the algebra is closed — composing signatures produces signatures, which can be further composed. The system is fractal — the same pattern at every scale.

---

## Caching Strategy

### Three-level cache (standard pattern for every service)

| Level | Storage | Speed | Invalidation |
|-------|---------|-------|-------------|
| In-memory | `Map<string, T>` in the service | Synchronous | Service lifecycle |
| OPFS | `__resources__/<sig>` | ~microseconds | Never (immutable content) |
| SignatureStore | `signText()` memo | Synchronous | Never (deterministic) |

### Cache hit flow

1. Check in-memory map for signature → return if found
2. Call `Store.getResource(sig)` → read from OPFS → parse → store in memory → return
3. On next access → step 1 hits immediately

Because resources are immutable, **cache invalidation does not exist**. A signature always maps to the same content. New content = new signature = new cache entry. Old entries remain valid.

### Fingerprint-based rebuild

When the underlying data changes (e.g., new bees registered), compute a fingerprint of the inputs. If fingerprint matches the last build, the existing resource signature is still valid — no rebuild needed.

```typescript
const fingerprint = ioc.list().sort().join(',')
if (fingerprint === this.#lastFingerprint) return this.#cachedManifestSig
// else: rebuild manifest, sign it, cache it
```

---

## Audit Criteria

When auditing the codebase for compliance, check each of these dimensions:

### 1. Data structures
Does every content field use a signature reference? Flag inline data that should be a resource.

### 2. History operations
Does every `HistoryOp` use resource signatures for complex payloads? Flag inline data in `cell` fields.

### 3. localStorage
Is configuration stored as a signature pointing to OPFS, or as inline JSON? Simple flags are acceptable; complex configs are not.

### 4. Serialization determinism
Are keys sorted before signing? Flag any `JSON.stringify` → `sign()` path without key sorting.

### 5. Cache patterns
Does every service implement the three-level cache? Flag re-fetching what could be cached.

### 6. Composition completeness
Can every stateful entity be captured as a signature? Can superpositions be composed? Flag any state that exists only as mutable inline data.

### 7. Cell-level content addressing
Are individual cells and their metadata content-addressable? Flag mutable inline cell data.

### What's acceptable inline

- Booleans: `visible: true`
- Enums/small strings: `placement: 'top'`, `op: 'add'`
- Timestamps: `at: 1712345678`
- Cell names in `add`/`remove` history ops (these are identifiers, not content)
- Signature strings themselves (they're references, not content)
- Short arrays of signatures or identifiers

### What must be a resource

- Ordered lists (cell reorder payloads)
- Message content (thread turns)
- Configuration objects (settings, presets, themes)
- Instruction catalogs and visibility state
- Any structured data that could be versioned, shared, or composed
- Any payload larger than ~100 bytes that isn't a simple scalar
