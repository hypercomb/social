# trail capsule — replayable navigation (optional publishing)

> **status: design / not yet implemented.** the capsule serializer/parser, the `trail:replay` / `trail:capsule-ready` effects, and `PathRecorderDrone` do not exist in the build. this is a preserved specification, not shipped behavior.

> **renamed concept.** this was formerly called "dna." that name now belongs to the merkle-versioned artifacts — see [dna.md](dna.md). a trail capsule is a published *route*, not a versioned tree. the bee-metaphor synonym is **waggle capsule** (the dance, written down).

> by default, hypercomb publishes nothing to the network; the hive exists in live presence. a trail capsule is **optional** — use it only when a *path* should persist for public reuse and verification.

---

## what a trail capsule is

- **not the hive** — it is not live presence or meaning.
- **a tiny byte stream** — a minimal capsule that encodes how to get somewhere (a sequence of 1-byte navigation steps across the hex grid; see [byte-protocol.md](byte-protocol.md)).
- **integrity first** — includes a cryptographic commitment so anyone can verify it has not been altered.
- **no urls, no addresses** — never reveals servers or identities.
- **content-addressed** — the commitment is a SHA-256 hash of the capsule contents, the same algorithm `SignatureService` uses throughout the build.
- **chain optional** — you *may* anchor the commitment to a public chain for tamper-evidence, but it is not required.

think of a trail capsule as **sheet music** you can publish; the performance (the hive) is still live.

---

## when to use it (and when not to)

use a trail capsule when a path should be:
- **publicly reproducible** (others can follow it later)
- **tamper-evident** (provably unchanged)
- **portable** across communities

do **not** use it when:
- the path is private, ephemeral, or consent-limited
- you do not want discoverability beyond the session
- publication could compromise privacy or safety

---

## capsule format

the capsule is intentionally tiny and self-contained.

```
+------------------------------+
| MAGIC (2B): "HC"             |
| VERSION (1B): 0x01           |
| FLAGS (1B): bitfield         |  0=none, 1<<0=anchored, 1<<1=attested, 1<<2=encrypted(reserved)
+------------------------------+
| POLICY (1B)                  |  0=creator-opt-in, 1=creator+cohort, 2=community-threshold
| START_HASH (32B)             |  SHA-256 of the start cell (lineage entry point)
| SALT (16B)                   |  random; mitigates preimage/rainbow on START_HASH
+------------------------------+
| INSTR_LEN (4B, LE)           |  number of instruction bytes
| INSTR_BYTES (N * 1B)         |  1-byte navigation stream (mm pp d nnn)
+------------------------------+
| COMMITMENT (32B)             |  SHA-256(header || instr || length)
+------------------------------+
| [OPTIONAL] ATTESTATION ...   |  signatures over COMMITMENT (policy-dependent)
| [OPTIONAL] ANCHOR ...        |  { chain, txid } proving on-chain commit
+------------------------------+
```

**endianness:** fields marked LE are little-endian.
**hash:** SHA-256 via `crypto.subtle.digest('SHA-256', bytes)` — the same primitive backing `SignatureService.sign()`.
**no timestamps:** persistence comes from publication/anchoring, not clocks.

---

## relationship to the signing pipeline

trail-capsule commitments use the same SHA-256 content-addressing as the rest of hypercomb:

| concept | implementation | location |
|---------|---------------|----------|
| artifact signing | `SignatureService.sign(bytes)` → 64-char hex | `@hypercomb/core` `signature.service.ts` |
| payload signing | `PayloadCanonical.compute(payload)` → JSON (no key sorting) → SHA-256 | `@hypercomb/core` `payload-canonical.ts` |
| build pipeline | every essentials module artifact is signed at build time from raw bytes | `hypercomb-essentials/scripts/build-module.ts` |
| opfs storage | `Store.put(bytes)` signs then stores by signature | `hypercomb-shared/core/store.ts` |
| capsule commitment | `SHA-256(header \|\| instr \|\| length)` | same algorithm, same output format |

all of these produce **content-addressed hashes** (like git or ipfs), not asymmetric signatures. the 64-character hex string is a deterministic fingerprint of the input bytes. **there is no private key involved today.**

> honest status: `SignatureService` performs SHA-256 hashing for content addressing. asymmetric signing (ed25519, secp256k1) for attestation is a future capability. capsules that set the `attested` flag will need that future work.

---

## start_hash (entry point)

```
start_hash = SHA-256(start_cell)
```

- `start_cell` maps to a **lineage path** in the current architecture: the `Lineage` service resolves path segments against opfs (domain discarded; the location signature is `sign(path segments)`).
- the cell can be a public category (e.g., `"chemistry"`) or an opaque community taxonomy byte string.
- you may publish the cleartext `start_cell`, but it is optional.
- `salt` prevents trivial dictionary reversal if cells remain private.

---

## instruction bytes (the path)

each step is one byte (see [byte-protocol.md](byte-protocol.md)):

```
bits:  7 6  |  5 4  |  3  |  2 1 0
       m m  |  p p  |  d  |  n n n

nnn:  neighbor (0-5)
d:    0=backward, 1=forward
pp:   00=neutral, 01=beacon, 10=avoid, 11=priority
mm:   00=end, 01=continue, 10=branch, 11=reserved
```

this is the same live navigation model, just **captured** for voluntary publication.

- `nnn` (0-5) addresses one of the six hex neighbors; values 6-7 are invalid and must be dropped.
- `d` controls forward/backward traversal along the lineage path.
- `pp` carries ephemeral pheromone hints — social signals for rendering, not ratings.
- `mm` controls flow: end, continue, branch, or reserved.

> note: the live navigation uses `axialToPixel` / `pixelToAxial` at spacing=38; `packByte` / `unpackByte` / `walkTrail` and the `trail:fork` effect are part of this design spec, not the shipped path.

---

## integrity, attestation, anchoring

- **integrity (required):** `commitment = SHA-256(header || instr || length)`; verifiers recompute and compare.
- **attestation (optional, policy-dependent):**
  - *creator-opt-in (default):* one signature by the creator over `commitment`
  - *creator + cohort:* add n-of-m co-signatures from linked participants
  - *community threshold:* community verifiers co-sign per local rules
  - **current status:** the nostr mesh (`NostrMeshDrone`) can sign events via nip-07 browser extensions or a `NostrSigner` dependency — the first real asymmetric signing path. full ed25519 attestation of capsule commitments is future work.
- **anchoring (optional):**
  - post `commitment` (or a commitment-of-commitments) to a public chain
  - store: `anchor = { chain: "solana|eth|btc|...", txid: "<ref>" }`
  - anchoring is **evidence**, not authority; it proves *when* the commitment existed

no personal identifiers are required for any of the above.

---

## verification (client flow)

1. parse capsule, recompute `commitment` via `SHA-256(header || instr || length)`, compare.
2. if attested, verify signatures against known keys/registry (future: nostr pubkeys).
3. if anchored, confirm the commitment appears on-chain.
4. resolve `start_hash` to a lineage entry point via `Lineage.tryResolve()`.
5. re-execute `instr_bytes` in a **new live session** against the hex grid (`AxialService`).
6. render the path; apply pheromone hints and local safety rules.

> a trail capsule is **replayable**, but it is **not** a recording of meaning. it reconstructs the route, not the original social moment.

---

## who decides to publish? (pluggable policy)

- **0 — creator opt-in (default)** — the creator can publish their own capsule
- **1 — creator + cohort** — publish only with n-of-m co-signatures from linked participants
- **2 — community threshold** — publish only when a community multisig attests

all policies produce the **same capsule**; only the attestation block differs.

---

## distribution via nostr mesh

when implemented, published capsules can distribute across devices and communities through the `NostrMeshDrone`:

- the capsule's commitment (or its `SignatureService` hash) becomes the **subscription key** — the `x` tag the mesh routes on.
- `mesh.subscribe(sig, cb)` lets any peer listen for capsules matching a signature.
- `mesh.publish(kind, sig, payload)` broadcasts a capsule to connected relays.
- the mesh handles deduplication, ttl-based expiry, and relay reconnection automatically.

no server addresses or identities are embedded in the capsule itself.

---

## how a trail capsule relates to BeePayloadV1

a trail capsule is **not** a `BeePayloadV1`. they serve different purposes:

| | trail capsule | BeePayloadV1 |
|---|------------|----------------|
| contains | navigation steps (byte stream) | bee source code + metadata |
| signed by | `SHA-256(header \|\| instr \|\| length)` | `PayloadCanonical.compute(payload)` (no key sorting) |
| purpose | path replay across the hex grid | artifact delivery and verification |
| size | tiny (header + N bytes + commitment) | variable (source files embedded) |

both use SHA-256 content addressing. a drone *could* replay a capsule — feeding instruction bytes to `AxialService` from `heartbeat()` — but the capsule format is deliberately simpler than a payload.

---

## what exists today vs. what is future work

| capability | status |
|-----------|--------|
| SHA-256 content addressing (`SignatureService`) | implemented |
| canonical payload helper (`PayloadCanonical`, no key sorting) | implemented (non-build-path) |
| opfs local storage (lineage paths, drone artifacts) | implemented |
| hex grid navigation (`AxialCoordinate`, `AxialService`) | implemented |
| nostr mesh distribution (`NostrMeshDrone`) | implemented |
| byte protocol (1-byte navigation steps) | specified, not yet wired to capsule serialization |
| trail capsule serializer/parser | not yet implemented |
| `trail:replay` / `trail:capsule-ready` effects, `PathRecorderDrone` | not yet implemented |
| asymmetric attestation (ed25519/secp256k1 signing) | not yet implemented (nostr nip-07 provides a path) |
| on-chain anchoring | not yet implemented |

---

## summary

- **live by default:** nothing crosses the network; presence is the hive.
- **publish by choice:** a trail capsule is a tiny, replayable route.
- **verify without exposure:** commitment, optional attestations, optional anchor.
- **stay minimal:** no urls, no identities, no creep.
- **not dna:** dna is the merkle-versioned artifacts ([dna.md](dna.md)); a trail capsule is a published path.
