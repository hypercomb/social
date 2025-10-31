# 🧬 DNA — Path Capsules (Optional Publishing)

> by default, hypercomb stores nothing; the hive exists only in live presence.  
> **dna is optional.** use it only when a path should persist for public reuse and verification.

---

## what dna is (in this architecture)

- **not the hive** — dna is not live presence or meaning.
- **a tiny byte stream** — a minimal **path capsule** that encodes how to get somewhere (sequence of 1-byte navigation steps).
- **integrity first** — includes a cryptographic commitment so anyone can verify it hasn’t been altered.
- **no urls, no addresses** — dna never reveals servers or identities.
- **chain optional** — you *may* anchor the commitment to a public chain for tamper-evidence, but it’s not required.

think of dna as **sheet music** you can publish; the performance (the hive) is still live.

---

## when to use dna (and when not to)

use dna when a path should be:
- **publicly reproducible** (others can follow it later)
- **tamper-evident** (provably unchanged)
- **portable** across communities

do **not** use dna when:
- the path is private, ephemeral, or consent-limited
- you don’t want discoverability beyond the session
- publication could compromise privacy or safety

---

## path capsule — minimal format

the capsule is intentionally tiny and self-contained.



+------------------------------+
| MAGIC (2B): "HC" |
| VERSION (1B): 0x01 |
| FLAGS (1B): bitfield | // 0=none, 1<<0=anchored, 1<<1=attested, 1<<2=encrypted(reserved)
+------------------------------+
| POLICY (1B) | // 0=creator-opt-in, 1=creator+cohort, 2=community-threshold
| START_HASH (32B) | // H(start_seed); seed may be public text or opaque bytes
| SALT (16B) | // random; mitigates preimage/rainbow on START_HASH
+------------------------------+
| INSTR_LEN (4B, LE) | // number of instruction bytes
| INSTR_BYTES (N * 1B) | // 1-byte navigation stream (nnn/d/pp/mm)
+------------------------------+
| COMMITMENT (32B) | // H(header||instr||length)
+------------------------------+
| [OPTIONAL] ATTESTATION ... | // signatures over COMMITMENT (policy-dependent)
| [OPTIONAL] ANCHOR ... | // { chain, txid } proving on-chain commit
+------------------------------+


**endianness:** fields marked le are little-endian.  
**hash:** use sha-256 (or blake3 later via version/flags).  
**no timestamps:** persistence comes from publication/anchoring, not clocks.

---

## start_hash (entry point)

`start_hash = H(start_seed)`

- `start_seed` can be:
  - a public category (e.g., `"chemistry"`)
  - an opaque community taxonomy byte string
- you may publish the cleartext `start_seed`, but it’s optional.  
- `salt` prevents trivial dictionary reversal if seeds remain private.

---

## instruction bytes (the path)

each step is one byte (see also: [byte protocol](./byte-protocol.md)):



bits: 7 6 | 5 4 | 3 | 2 1 0
m m | p p | d | n n n

nnn: neighbor (0–5)
d: 0=backward, 1=forward
pp: 00=neutral, 01=beacon, 10=avoid, 11=priority
mm: 00=end, 01=continue, 10=branch, 11=reserved


this is the same live navigation model, just **captured** for voluntary publication.

---

## integrity, attestation, anchoring

- **integrity (required):** `commitment = H(header || instr || length)`  
  verifiers recompute and compare.

- **attestation (optional, policy-dependent):**
  - *creator-opt-in (default):* one signature by the driver over `commitment`
  - *creator + cohort:* add n-of-m co-signatures from linked participants
  - *community threshold:* community verifiers co-sign per local rules  
  signature format is flexible (ed25519 recommended; bls ok for aggregated signatures).

- **anchoring (optional):**
  - post `commitment` (or a commitment-of-commitments) to a public chain
  - store: `anchor = { chain: "solana|eth|btc|…", txid: "<ref>" }`
  - anchoring is **evidence**, not authority; it proves *when* the commitment existed

no personal identifiers are required for any of the above.

---

## privacy properties

- no urls or server locations disclosed  
- no user identities embedded  
- `start_hash` can be public or opaque  
- `salt` defends against seed reversal  
- attestation keys may be pseudonymous; reputation is social (see: [social governance](./social-governance.md))

---

## verification (client flow)

1. parse capsule, recompute `commitment`, compare.  
2. if attested, verify signatures against known keys/registry.  
3. if anchored, confirm the commitment appears on-chain.  
4. resolve `start_hash` to a local/community entry point (taxonomy-dependent).  
5. re-execute `instr_bytes` in a **new live session** (with your own session nonce).  
6. render the path; apply pheromone hints and local safety rules.

> dna is **replayable**, but it is **not** a recording of meaning.  
> it reconstructs the route, not the original social moment.

---

## who decides to publish? (pluggable policy)

choose a policy without changing the format:

- **0 — creator opt-in (default)** — the driver can publish their own capsule  
- **1 — creator + cohort** — publish only with n-of-m co-signatures from linked bees  
- **2 — community threshold** — publish only when a community multisig attests

all policies produce the **same capsule**; only the attestation block differs.

---

## from meadow log to dna (publishing flow)

1. **select slice** from your local meadow log (`start_ts → end_ts`)  
2. **normalize**: drop consecutive duplicates from jitter; keep order  
3. **choose policy** (0/1/2) and gather attestation material (if any)  
4. **build capsule**, compute `commitment`, sign if required  
5. **optionally anchor**; record `{ chain, txid }`  
6. **publish** the capsule (ipfs, static file, or any public medium)

> meadow logs are local unless you explicitly publish. publication is a gift, not an obligation.  
> see also: [meadow log](./meadow-log.md)

---

## minimal example (hex)



magic="HC" ver=01 flags=01(anchored) policy=00
start_hash = e3b0c44298fc1c149afbf4c8996fb924...
salt = 9f9c0a1bc0e6aa43b5dcb2d7f9c30122
instr_len = 00000006
instr = 19 05 21 01 2d 80
commitment = 7b1f7a0adf5c5b0d4b9a2d4d1f3e3a8c...
anchor = { chain: "eth", txid: "0xabc123..." }


- `instr` is illustrative only  
- anyone can recompute `commitment` and verify the anchor

---

## implementation notes

- use **sha-256** today; allow **blake3** later via version/flags  
- keep capsules small; avoid metadata creep  
- if you encrypt `instr_bytes` (rare), set `flags.encrypted=1` and publish decryption instructions separately  
- attestations should always sign the **commitment**, not raw fields  
- avoid timestamps in the capsule; anchoring already yields objective time

---

## non-goals

- no global ledger of hives  
- no centralized authority over what becomes “canon”  
- no identity requirement to verify or replay a path

---

## summary

- **live by default:** nothing is stored; presence is the hive  
- **publish by choice:** dna is a tiny path capsule  
- **verify without exposure:** commitment, optional attestations, optional anchor  
- **stay minimal:** no urls, no identities, no creep

**dna is the smallest possible memory a community can share.**