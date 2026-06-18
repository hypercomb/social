# the seal

when a cell of honey is ready, bees cap it with a thin layer of wax. the cap serves one purpose: it proves the contents are complete and untampered. you can see at a glance which cells are sealed and which are still being filled. if someone breaks the cap, you know.

hypercomb seals its artifacts the same way — with content-addressed hashes.

---

## the wax cap

the `SignatureService` takes any content — a drone payload, a navigation path, a module artifact — and produces a seal:

```
content bytes --> SHA-256 --> 64-character hex string
```

this seal is deterministic. the same content always produces the same seal. different content always produces a different seal. if even one bit changes, the seal breaks.

this is not encryption. it is integrity. the seal does not hide what is inside. it proves that what is inside has not been altered.

---

## content-addressable identity

in a real hive, a sealed cell of honey is identified by its position and its cap. you do not need a label. the cap itself is the identifier — if the honey is the same, the cap is the same.

hypercomb works identically. every artifact is identified by its content hash. there are no version numbers, no sequential ids, no registry of "who made what when." the content IS the identity. two identical payloads produce identical seals. this eliminates duplication without any coordination — same honey, same cap, stored once and referenced everywhere.

this is the foundation of [DNA — distributed network artifacts](../dna.md): the content-addressed, immutable, merkle-composed building blocks of the hive. *content-addressed* (the seal is the address), *immutable* (any byte change is a new artifact, never an edit in place), and *deduplicated* (identical content collapses to one seal) — these three properties together are why a signature can stand in for content anywhere in the system.

the lineage path model extends this — but it seals a *position*, not contents. the **domain is discarded**; only the path segments are hashed (`sign(path segments)`), so the empty root signs as `sign([]) = e3b0c442…`. the path signature names *where a cell sits in the comb* — its address — not *what honey is inside it*. (the honey itself — the layers, bees, dependencies, and resources addressed at those positions — is the DNA above.)

---

## what the seal is not

the seal is not a signature in the cryptographic authentication sense. it does not prove WHO created the content — only that the content has not been changed. a wax cap does not tell you which bee deposited the honey. it tells you the honey is intact.

real cryptographic signing — where a bee's identity is bound to the seal through a private key — is a future capability. today, hypercomb uses content addressing: same bytes, same seal, verifiable by anyone.

---

## the pipeline

real bees process nectar through a pipeline: collect, pass mouth-to-mouth (adding enzymes), deposit in cell, fan to evaporate water, cap with wax.

hypercomb's sealing pipeline follows the same pattern:

```
raw bytes (compiled bee/dep output, or JSON.stringify(layer))
  --> SHA-256 digest
    --> 64-character hex seal
```

the build seals the **exact bytes** it produces — there is no separate normalization rung. bees and dependencies are signed from their **raw compiled esbuild output**; layers are signed from `JSON.stringify(layer)` (via the build's `signJson`), in insertion order, with **no key sorting**. the seal is laid over the honey as it is, not over some re-poured copy.

> a reader who "sorts keys to be safe" before hashing computes a **different** seal — and every cache hit that depended on the original breaks. seal the bytes you have.

`PayloadCanonical.compute()` is a separate, off-the-build-path helper for the `BeePayloadV1` envelope (`{ version: 1, bee: {...}, source: { entry, files } }`). it too does `structuredClone` + `JSON.stringify` with **no key sorting** — it is for inspection, not for signing module artifacts.

---

## build-time sealing

every module artifact in `@hypercomb/essentials` is sealed during the build. the build pipeline hashes each output file and records its seal. when a module is loaded at runtime, its content can be re-hashed and compared against the recorded seal.

this is like a beekeeper inspecting caps. if the cap matches, the honey is good. if it doesn't, something happened between the hive and the jar.

but the seals do not stand alone — they **compose**. a layer holds its children's seals in its `children[]` slot, so the parent's own seal is a function of its children (`parent = f(child sigs)`). change one leaf and every ancestor re-seals, the cascade rippling up one rung per level. the seal at the very top — the **`rootLayerSig`** — is the recursive merkle root of the whole tree: a package's **genome**. that single seal *is* the package's identity; the `label` / `previous` / `at` fields ride alongside in `manifest.json` as sidecar metadata and change the file's bytes but **not** the genome seal. comparing two versions is therefore an O(1) root-seal compare — same cap on the comb, nothing underneath has changed. (this content-addressed, merkle-composed artifact model is [DNA](../dna.md); the recursive root is the [genome](../genome-primitive.md).)

---

*a sealed cell is a promise. the contents are what they were when the cap was laid. nothing more is needed.*
