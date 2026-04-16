# dna -- path capsules (optional publishing)

> by default, hypercomb stores nothing; the hive exists only in live presence.
> **dna is optional.** use it only when a path should persist for public reuse and verification.

---

## what dna is (in this architecture)

- **not the hive** -- dna is not live presence or meaning.
- **a tiny byte stream** -- a minimal **path capsule** that encodes how to get somewhere (a sequence of 1-byte navigation steps across the hex grid).
- **integrity first** -- includes a cryptographic commitment so anyone can verify it has not been altered.
- **no urls, no addresses** -- dna never reveals servers or identities.
- **content-addressed** -- the commitment is a SHA-256 hash of the capsule contents, the same algorithm used by `SignatureService` throughout the build and runtime pipeline.
- **chain optional** -- you *may* anchor the commitment to a public chain for tamper-evidence, but it is not required.

think of dna as **sheet music** you can publish; the performance (the hive) is still live.

---

## when to use dna (and when not to)

use dna when a path should be:
- **publicly reproducible** (others can follow it later)
- **tamper-evident** (provably unchanged)
- **portable** across communities

do **not** use dna when:
- the path is private, ephemeral, or consent-limited
- you do not want discoverability beyond the session
- publication could compromise privacy or safety

---

## path capsule -- format

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
**hash:** SHA-256 via `crypto.subtle.digest('SHA-256', bytes)` -- the same primitive backing `SignatureService.sign()`.
**no timestamps:** persistence comes from publication/anchoring, not clocks.

---

## relationship to the current signing pipeline

dna commitments use the same SHA-256 content-addressing that powers the rest of hypercomb:

| concept | implementation | location |
|---------|---------------|----------|
| artifact signing | `SignatureService.sign(bytes)` -> 64-char hex | `@hypercomb/core` `signature.service.ts` |
| payload signing | `PayloadCanonical.compute(payload)` -> canonical JSON -> SHA-256 | `@hypercomb/core` `payload-canonical.ts` |
| build pipeline | every essentials module artifact is signed at build time | `hypercomb-essentials/scripts/build-module.ts` |
| opfs storage | `Store.put(bytes)` signs then stores by signature | `hypercomb-shared/core/store.ts` |
| dna commitment | `SHA-256(header \|\| instr \|\| length)` | same algorithm, same output format |

all of these produce **content-addressed hashes** (like git or ipfs), not asymmetric signatures. the 64-character hex string returned by `SignatureService.sign()` is a deterministic fingerprint of the input bytes. **there is no private key involved today.**

> honest status: `SignatureService` performs SHA-256 hashing for content addressing. asymmetric signing (ed25519, secp256k1) for attestation is a future capability. dna capsules that set the `attested` flag will need that future work.

---

## start_hash (entry point)

```
start_hash = SHA-256(start_cell)
```

- `start_cell` maps to a **lineage path** in the current architecture: `domain/path/cell` segments that `Lineage` resolves against opfs.
- the cell can be a public category (e.g., `"chemistry"`) or an opaque community taxonomy byte string.
- you may publish the cleartext `start_cell`, but it is optional.
- `salt` prevents trivial dictionary reversal if cells remain private.

in the running system, `Lineage` manages the explorer path (`domain -> segments -> current handle`) and resolves content within the opfs tree rooted at `hypercomb.io`. the start_hash in a dna capsule corresponds to the sha-256 of the lineage cell that begins the path.

---

## instruction bytes (the path)

each step is one byte (see also: [byte-protocol.md](./byte-protocol.md)):

```
bits:  7 6  |  5 4  |  3  |  2 1 0
       m m  |  p p  |  d  |  n n n

nnn:  neighbor (0-5)
d:    0=backward, 1=forward
pp:   00=neutral, 01=beacon, 10=avoid, 11=priority
mm:   00=end, 01=continue, 10=branch, 11=reserved
```

this is the same live navigation model, just **captured** for voluntary publication.

- `nnn` (0-5) addresses one of the six hex neighbors computed by `AxialService.getAdjacentCoordinates()`: northeast, east, southeast, southwest, west, northwest. values 6-7 are invalid and must be dropped.
- `d` controls forward/backward traversal along the lineage path.
- `pp` carries ephemeral pheromone hints -- social signals for rendering, not ratings.
- `mm` controls flow: end, continue, branch, or reserved.

---

## integrity, attestation, anchoring

- **integrity (required):** `commitment = SHA-256(header || instr || length)`
  verifiers recompute and compare. this uses the same `crypto.subtle.digest` call as `SignatureService`.

- **attestation (optional, policy-dependent):**
  - *creator-opt-in (default):* one signature by the creator over `commitment`
  - *creator + cohort:* add n-of-m co-signatures from linked participants
  - *community threshold:* community verifiers co-sign per local rules
  - **current status:** nostr mesh (`NostrMeshDrone`) can sign events via nip-07 browser extensions or a `NostrSigner` dependency. this provides the first real asymmetric signing path for attestation. full ed25519 attestation of dna commitments is future work.

- **anchoring (optional):**
  - post `commitment` (or a commitment-of-commitments) to a public chain
  - store: `anchor = { chain: "solana|eth|btc|...", txid: "<ref>" }`
  - anchoring is **evidence**, not authority; it proves *when* the commitment existed

no personal identifiers are required for any of the above.

---

## privacy properties

- no urls or server locations disclosed
- no user identities embedded
- `start_hash` can be public or opaque
- `salt` defends against cell name reversal
- attestation keys may be pseudonymous; reputation is social (see: [architecture-fundamentals.md](architecture-fundamentals.md))

---

## verification (client flow)

1. parse capsule, recompute `commitment` via `SHA-256(header || instr || length)`, compare.
2. if attested, verify signatures against known keys/registry (future: nostr pubkeys).
3. if anchored, confirm the commitment appears on-chain.
4. resolve `start_hash` to a lineage entry point -- look up the cell in opfs via `Lineage.tryResolve()`.
5. re-execute `instr_bytes` in a **new live session** against the hex grid (`AxialService`).
6. render the path; apply pheromone hints and local safety rules.

> dna is **replayable**, but it is **not** a recording of meaning.
> it reconstructs the route, not the original social moment.

---

## who decides to publish? (pluggable policy)

choose a policy without changing the format:

- **0 -- creator opt-in (default)** -- the creator can publish their own capsule
- **1 -- creator + cohort** -- publish only with n-of-m co-signatures from linked participants
- **2 -- community threshold** -- publish only when a community multisig attests

all policies produce the **same capsule**; only the attestation block differs.

---

## from opfs to dna (publishing flow)

1. **select slice** from your local opfs path history (the lineage explorer trail).
2. **normalize**: drop consecutive duplicates from jitter; keep order.
3. **choose policy** (0/1/2) and gather attestation material (if any).
4. **build capsule**, compute `commitment` using `SHA-256`, sign if required.
5. **optionally anchor**; record `{ chain, txid }`.
6. **publish** the capsule via the nostr mesh (`NostrMeshDrone`), ipfs, a static file, or any public medium. the nostr mesh uses the commitment (or a derived signature) as the `x` tag for subscription routing.

> opfs logs are local unless you explicitly publish. publication is a gift, not an obligation.

---

## distribution via nostr mesh

published dna capsules can be distributed across devices and communities through the `NostrMeshDrone`:

- the capsule's commitment (or its `SignatureService` hash) becomes the **subscription key** -- the `x` tag that the mesh routes on.
- `mesh.subscribe(sig, cb)` lets any peer listen for capsules matching a signature.
- `mesh.publish(kind, sig, payload)` broadcasts a capsule to connected relays.
- the mesh handles deduplication, ttl-based expiry, and relay reconnection automatically.
- local fanout ensures the publishing device sees its own capsule immediately, even before relay confirmation.

this replaces the legacy notion of "publish to ipfs or static file" with a live, relay-backed distribution layer -- while preserving the property that **no server addresses or identities are embedded in the capsule itself**.

---

## how dna relates to DronePayloadV1

a dna capsule is **not** a `DronePayloadV1`. they serve different purposes:

| | dna capsule | DronePayloadV1 |
|---|------------|----------------|
| contains | navigation steps (byte stream) | drone source code + metadata |
| signed by | `SHA-256(header \|\| instr \|\| length)` | `PayloadCanonical.compute(payload)` |
| purpose | path replay across the hex grid | artifact delivery and verification |
| size | tiny (header + N bytes + commitment) | variable (source files embedded) |

both use the same `SignatureService` SHA-256 for content addressing. a drone *could* replay a dna capsule -- the capsule feeds instruction bytes to `AxialService`, and a drone's `heartbeat()` could drive that replay. but the capsule format is deliberately simpler than a payload.

---

## minimal example (hex)

```
magic="HC" ver=01 flags=01(anchored) policy=00
start_hash = e3b0c44298fc1c149afbf4c8996fb924...   (32 bytes)
salt = 9f9c0a1bc0e6aa43b5dcb2d7f9c30122           (16 bytes)
instr_len = 00000006
instr = 19 05 21 01 2d 80
commitment = 7b1f7a0adf5c5b0d4b9a2d4d1f3e3a8c...   (32 bytes)
anchor = { chain: "eth", txid: "0xabc123..." }
```

- `instr` is illustrative only
- anyone can recompute `commitment` and verify the anchor
- the commitment can be republished as a nostr event with `x` tag = hex(commitment)

---

## implementation notes

- use **SHA-256** today via `crypto.subtle.digest` (same as `SignatureService`); allow **blake3** later via version/flags.
- keep capsules small; avoid metadata creep.
- if you encrypt `instr_bytes` (rare), set `flags.encrypted=1` and publish decryption instructions separately.
- attestations should always sign the **commitment**, not raw fields.
- avoid timestamps in the capsule; anchoring already yields objective time.
- `EffectBus` can coordinate dna replay across drones: emit a `dna:replay` effect with the capsule bytes and let a navigation drone subscribe and re-execute.

---

## non-goals

- no global ledger of hives
- no centralized authority over what becomes "canon"
- no identity requirement to verify or replay a path

---

## what exists today vs. what is future work

| capability | status |
|-----------|--------|
| SHA-256 content addressing (`SignatureService`) | implemented |
| canonical payload signing (`PayloadCanonical`) | implemented |
| opfs local storage (lineage paths, drone artifacts) | implemented |
| hex grid navigation (`AxialCoordinate`, `AxialService`) | implemented |
| nostr mesh distribution (`NostrMeshDrone`) | implemented |
| drone effect bus for coordination (`EffectBus`) | implemented |
| byte protocol (1-byte navigation steps) | specified, not yet wired to capsule serialization |
| dna capsule serializer/parser | not yet implemented |
| asymmetric attestation (ed25519/secp256k1 signing) | not yet implemented (nostr nip-07 provides a path) |
| on-chain anchoring | not yet implemented |
| encrypted instruction bytes | reserved in flags, not yet implemented |

---

## summary

- **live by default:** nothing is stored; presence is the hive
- **publish by choice:** dna is a tiny path capsule
- **verify without exposure:** commitment, optional attestations, optional anchor
- **stay minimal:** no urls, no identities, no creep
- **content-addressed:** same SHA-256 pipeline as every other artifact in hypercomb

**dna is the smallest possible memory a community can share.**
