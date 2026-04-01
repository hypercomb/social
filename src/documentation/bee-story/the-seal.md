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

hypercomb works identically. every artifact is identified by its content hash. there are no version numbers, no sequential ids, no registry of "who made what when." the content IS the identity. two identical payloads produce identical seals. this eliminates duplication without any coordination.

the lineage path model extends this: `domain/path/cell` is hashed to produce a signature. the path to a resource IS the resource's identity. like a cell's position in the comb IS the cell's address.

---

## what the seal is not

the seal is not a signature in the cryptographic authentication sense. it does not prove WHO created the content — only that the content has not been changed. a wax cap does not tell you which bee deposited the honey. it tells you the honey is intact.

real cryptographic signing — where a bee's identity is bound to the seal through a private key — is a future capability. today, hypercomb uses content addressing: same bytes, same seal, verifiable by anyone.

---

## the pipeline

real bees process nectar through a pipeline: collect, pass mouth-to-mouth (adding enzymes), deposit in cell, fan to evaporate water, cap with wax.

hypercomb's sealing pipeline follows the same pattern:

```
raw payload
  --> canonical JSON (deterministic field ordering)
    --> UTF-8 encode to bytes
      --> SHA-256 digest
        --> 64-character hex seal
```

`PayloadCanonical.compute()` handles this pipeline. the canonical step is critical — just as bees must evaporate water to a precise moisture level before capping, the payload must be normalized before hashing. without canonicalization, the same logical content could produce different seals depending on property order.

---

## build-time sealing

every module artifact in `@hypercomb/essentials` is sealed during the build. the build pipeline hashes each output file and records its seal. when a module is loaded at runtime, its content can be re-hashed and compared against the recorded seal.

this is like a beekeeper inspecting caps. if the cap matches, the honey is good. if it doesn't, something happened between the hive and the jar.

---

*a sealed cell is a promise. the contents are what they were when the cap was laid. nothing more is needed.*
