# Core Primitive: Signature + Payload

## The Pair

Every artifact in Hypercomb is a **signature-payload pair**.

- **Signature**: SHA-256 hash (64 hex chars) of the artifact's bytes. Deterministic, immutable, content-derived.
- **Payload**: The artifact itself — a compiled module, a JSON document, an image, a layer manifest.

Same content always produces the same signature. Different content always produces a different signature. The signature *is* the identity.

## What This Enables

**Content addressing.** No version numbers, no sequential IDs, no registries. The hash of the content names the content. Two systems that have never communicated will derive the same signature for the same artifact.

**Deduplication.** If two seeds reference the same image, they store one copy in `__resources__/{sig}`. The signature guarantees they are identical.

**Integrity verification.** Before any code executes, its bytes are hashed and compared against the expected signature. Mismatch means corruption or tampering — the artifact is rejected, no fallback.

**Reproducibility.** Given the same inputs and the same build rules, the output signature is identical. If the signature matches, the artifact is proven correct without re-executing the build.

## Where Signatures Appear

| Context | What is signed | Signature names |
|---------|---------------|-----------------|
| Bee modules | Compiled JS bundle | `__bees__/{sig}.js` |
| Dependencies | Namespace service bundle | `__dependencies__/{sig}.js` |
| Resources | Static asset (image, JSON) | `__resources__/{sig}` |
| Layers | Layer manifest JSON | `__layers__/{sig}.json` |
| Root release | `install.manifest.json` | Root signature in `latest.txt` |
| Lineage paths | UTF-8 path string | Location signature for mesh subscription |
| History entries | Operation content | Cell identity in history bags |

## The Pipeline

```
content bytes  →  SHA-256  →  64-char hex signature
```

For structured data (drone payloads, layer manifests), canonicalization ensures deterministic output:

```
object  →  structuredClone  →  JSON.stringify  →  TextEncoder  →  ArrayBuffer  →  SHA-256  →  signature
```

`SignatureService.sign(buffer)` computes the hash. `SignatureStore` memoizes known signatures to avoid redundant hashing during render cycles.

## The Invariant

The signature is proof. If you know the signature, you know the content has not changed. If you have the content, you can independently verify the signature. No trust required — the math is the authority.
