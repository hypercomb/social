# dna — distributed network artifacts

> **DNA = Distributed Network Artifacts.** the content-addressed, **merkle-versioned** artifacts that compose the hive — layers, dependencies, bees, resources, and user content. they are *dna* because of how they are identified and how they compose: a signed, immutable identity that inherits and mutates like genetic material.

> ⚠️ **reassigned term.** "dna" used to name a publishable navigation *path capsule*. that concept was never code-backed and has been renamed the **trail capsule** — see [trail-capsule.md](trail-capsule.md) and [byte-protocol.md](byte-protocol.md). this page is now the canonical home of dna-as-artifacts.

---

## what dna is

dna is a classification **by identity model**, not by interface. an artifact is dna because of *how it is named and composed*, regardless of what it contains:

- **content-addressed** — its 64-hex SHA-256 signature *is* its address (`SignatureService.sign` over raw bytes; `isSignature = /^[0-9a-f]{64}$/`).
- **immutable** — any byte change yields a different signature. content never mutates in place; new content is a new artifact.
- **merkle-composed** — artifacts reference other artifacts by signature, so a parent's identity is a function of its children's signatures (`parent = f(child sigs)`). a change to a leaf cascades to every ancestor up to the root.
- **mesh-distributable** — because the address is the content hash, any artifact can be fetched, deduplicated, verified, and shared across the network by signature alone.

> dna is **vocabulary over the existing `kind` discriminant and the signature identity model**. it is **not** a `DnaService`, **not** a `dna` field, **not** a new OPFS folder. none of those exist, and none should be implied. the only universal primitive is the signature — see [signature-system.md](signature-system.md).

---

## why "dna" — the merkle property is the genetic property

content-addressing alone gives you a bag of hashed blobs. it is the **merkle versioning** that makes the metaphor honest: every genetic property falls out of the way artifacts compose and inherit. most of these rungs already exist in the build:

| genetic term | hypercomb concept | mechanism |
|---|---|---|
| nucleotide / base pair | a single signed artifact; its **kind** is the letter | `kind: layer \| bee \| dependency \| resource \| content` |
| bond / sequence position | the **signature** | 64-hex SHA-256 (`SignatureService.sign`) |
| gene / strand | a **layer** (functional unit) | layer references bees, deps, resources, child layers by sig |
| **genome** | recursive **merkle root** over a subtree | the root lineage's head layer sig — see [genome-primitive.md](genome-primitive.md) |
| mutation | content change → new signature | immutability doctrine |
| inheritance / lineage | merkle composition, resolved lazily | a subtree's root is `f(child sigs)`. commit is **leaf-only** — `LayerCommitter` writes one marker at the edited node, not one per ancestor; ancestor roots recompute on read (the eager O(depth) leaf→root commit cascade is retired) |
| replication | content-addressed **dedup** + mesh distribution | identical subtree → identical sig → stored once, shared by reference |

the genome is dna-of-a-subtree: because each parent's `children[]` slot holds its children's current layer signatures and the parent re-signs, the root layer signature is effectively the recursive merkle root of the whole tree. *same genome = same subtree = nothing underneath changed.*

> **note on `genome-primitive.md`:** the recursive-merkle-root *concept* is real (via the `children[]` cascade and root re-sign). the named `GenomeService`, the `genome()` hash helper, the sorted-child-genome formula, the tag index, and the `?:` query engine described there are **design, not yet built** (live only in dead `hypercomb-legacy`). treat genome as the concept, anchored to the real cascade.

---

## the five kinds — dna's alphabet

| kind | what it is | example |
|---|---|---|
| `layer` | a snapshot of a node's state; references bees/deps/resources/child layers by sig | a cell's committed state |
| `bee` | a compiled drone/worker/queen bundle | a rendering drone |
| `dependency` | a shared namespace bundle resolved via the import map | `pixi.js`, a domain namespace |
| `resource` | an opaque content blob | an image, a JSON payload, an LLM output |
| `content` | user-authored hive content | the participant's own tree |

`kind` is a **per-subsystem string-union**, not one global enum — `ContentType`, the sentinel install kind, and host-sync kind each enumerate their own relevant subset. "image" and "user content" are **not** first-class kinds: images ride `resource`, user content rides `layer`/`content`. dna must not collapse these into a single interface; the kinds are the bases, the signature is the bond.

---

## identity & signing (no canonical-JSON myth)

dna is signed with **SHA-256 over raw bytes**. the live build does **not** use sorted-key canonical JSON:

- module artifacts are signed from their **raw compiled bytes** (bees and deps: the esbuild output) and from `JSON.stringify(layer)` via `signJson` (layers) — directly, at build time.
- `PayloadCanonical` does `structuredClone` + `JSON.stringify` with **no key sorting**, and is a **non-build-path** helper for `BeePayloadV1` (`{ version: 1, bee: {...}, source: { entry, files } }`). it is not what signs module artifacts.

> ⚠️ a reader who "sorts keys to be safe" would compute a **different** signature and break every cache hit. sign the exact bytes; do not canonicalize.

(historical note: older docs referred to `DronePayloadV1` — the real type is `BeePayloadV1` with a `bee` key.)

---

## merkle composition & the cascade

- a parent layer's `children[]` (the `cells` array in DCP package layers) holds child **layer signatures in insertion / slot order** — **not** lexicographically sorted.
- on any change, **commit is leaf-only**: `LayerCommitter` writes one marker at the edited node and does **not** re-commit ancestors. a parent's stored child sig is left as a stale hint; a lineage's current root is resolved on demand from its **own** bag head. the merkle relationship still holds — a subtree's root is `f(child sigs)` — but it is recomputed **lazily on read**, not materialized eagerly up the spine. (the earlier eager leaf→root commit cascade — `O(depth)` markers per change, `LayerCommitter` walking `segments..0` — is retired; its handlers survive only to migrate pre-existing history.)
- a **package**'s identity is its **`rootLayerSig`** — the merkle root of its layer tree. the `label` / `previous` / `at` fields are **sidecar metadata** that change `manifest.json`'s bytes but are *not* part of the package signature.
- update detection between two versions is therefore an **O(1) root-sig compare**, not a tree walk.

---

## same dna, different metabolism

this is the guardrail that keeps the metaphor honest: dna shares an **identity** model, not a **fetch** model. the kinds heal differently on the render path:

| artifact | render-path behavior |
|---|---|
| `resource` | **self-heals / streams from hosts**: `Store.getResource` resolves memory → OPFS → host (`ContentBroker.fetchBySig`), sha256-verified, write-through, with a 60s negative cache |
| `layer` · `dependency` · `bee` | **OPFS-only on render** (no host fallback on the hot path); they heal only via **adopt / install / sync** |

- the **broker mesh carries layer signatures only** (a non-`layer` request returns null).
- the **swarm preview** path still relays capped (≤256KB) base64 image bytes for live presence — so the mesh is byte-clean on the broker path but not on the swarm-preview path.

do not flatten this into "all dna fetches the same way." it does not.

---

## what dna is NOT

- **the trail capsule** — a replayable navigation *trail* (a sequence of 1-byte `INSTR_BYTES` from the [byte protocol](byte-protocol.md)). it is a published route, not a versioned tree. see [trail-capsule.md](trail-capsule.md).
- **pheromones / pollination signals** — a parallel, signature-addressed *advisory* space (see [pheromone-protocol.md](pheromone-protocol.md), [pollination-protocol.md](pollination-protocol.md)). advisory, not merkle-resident state.
- **location / lineage signatures** — `sign(path segments)` (domain discarded, root = `sign([])` = `e3b0c442…`). these address a **position**, not content. they name *where*, not *what*.
- **positional `000x` markers** — owned pointers into the sigbag, not by-hash artifacts. see [history-sigbag-as-root.md](history-sigbag-as-root.md).

---

## persistence reality

hypercomb **persists durably and locally by default**. every authored action commits a signed `layer` + marker into OPFS — the marker into the lineage's sigbag at the OPFS root (`<lineageSig>/000x`), the layer bytes as a sig-named file at the root, with `sign(meaning)` pools (optimization, bees, dependencies, …) alongside; legacy `__x__` dirs persist only as read-fallback drains while they empty. dna is the durable, content-addressed memory of the hive.

what is *not* automatic is the **network**: nothing crosses the mesh by default. publishing, sharing, and adoption are explicit acts. presence, cursor, clipboard, selection, and viewport are the only genuinely ephemeral, participant-local state — and they are deliberately kept **out** of the signed layer so they never skew the lineage signature across peers.

---

## cross-links

- [signature-system.md](signature-system.md) — the signature-payload pair, the atoms of every dna artifact
- [signature-algebra.md](signature-algebra.md) — composition, set operations, lineage projections over signatures
- [genome-primitive.md](genome-primitive.md) — the recursive merkle root (the genome rung)
- [history-sigbag-as-root.md](history-sigbag-as-root.md) — the sigbag root, lineage markers, the cascade
- [trail-capsule.md](trail-capsule.md) · [byte-protocol.md](byte-protocol.md) — the renamed former "dna" (the navigation trail)

---

## summary

- **dna = distributed network artifacts**: content-addressed, immutable, merkle-versioned, mesh-distributable.
- the **kinds** (`layer · bee · dependency · resource · content`) are the alphabet; the **signature** is the bond; the **genome** is the recursive root.
- it is **vocabulary**, not an abstraction — no `DnaService`, no `dna` folder, no unified interface.
- **same dna, different metabolism** — resources self-heal from hosts; layers/deps/bees are OPFS-only on render.
- sign **raw bytes**, never sorted-key JSON.
