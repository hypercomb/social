# Mathematically backed truth — an experimental research programme over pools of meaning and categorized signatures

**Status: RESEARCH, ADOPTED — experiments built and passing; the four axioms
in section 7 entered the codex as the Truth tier (`M1`–`M4`) by jwize's
decision on 2026-11-04.** The theory is jwize's. The experiments live in
`hypercomb-core/src/core/mathematically-backed-truth.spec.ts` and run with the
vitest suite from `src/`:

```bash
npx vitest run hypercomb-core/src/core/mathematically-backed-truth.spec.ts
```

Companions: `signature-system.md` (the primitive), `signature-algebra.md` (the
operations over signatures), `known-location-pools.md` and
`pools-across-hosts.md` (pools), `install-by-replication.md` (verify at
admission), `hypercomb-core/src/core/head-map.ts` (why a seal that reads a
directory listing proves nothing).

---

## 1. The theory

> We can hold mathematically backed truths against our pools of meaning and our
> categorized signatures, and a mathematically backed truth is rock solid.

Restated as three claims that can each be tested:

1. **Identity and address are mathematics.** What a thing is (`I1`) and where a
   meaning lives (`P1`, `P2`) are both `sha256` of bytes anyone can produce.
   Nobody has to be believed.
2. **Categorization can be mathematics.** "This signature belongs to that pool"
   can be made as solid as identity — but only in a particular form, and the
   hive's pools do not all have that form today.
3. **Rock solid has a number.** The strength of every such claim reduces to the
   strength of SHA-256, which is a published, attacked, bounded quantity, not a
   policy.

The research asks, for every kind of claim the hive makes: *who can check it,
with what in hand, trusting whom?* A claim is **mathematically backed** when
the answer is "anyone, holding only the inputs, trusting nobody". It is **rock
solid** when the only way to make it false is to break the hash function.

## 2. What the mathematics actually guarantees

Three properties of SHA-256 carry everything:

| Property | Statement | What it buys the hive |
|---|---|---|
| Determinism | same bytes, same digest, on every machine, forever | `I1`; two strangers derive one address from one word (`P1`) |
| Preimage and second-preimage resistance | given a digest, no one can find bytes that produce it; given bytes, no one can find other bytes with the same digest | `S3` is a proof, not a check: a file named by its hash cannot be substituted |
| Collision resistance | no one can find any two byte strings with one digest | two different documents never share a name; deduplication (`A6`) is safe |

Honesty about the last row: collision resistance of SHA-256 is a **conjecture
with no known attack**, not a theorem. Its security is the 128-bit birthday
bound. "Rock solid" means exactly this: breaking a hive claim costs the same as
breaking the hash that underwrites most of the internet's certificates, and no
host, publisher or stranger can lower that cost by policy.

### The numbers (E3, E4)

| Quantity | Measured or computed |
|---|---|
| Output bits that change when one input bit flips, mean over 256 trials | 127.79 of 256 |
| Smallest change seen in 256 trials | 109 bits |
| Probability of any collision among 10^18 atoms | about 4.3 × 10^-42 |
| Atoms needed for even odds of one collision | about 3.4 × 10^38 (2^128) |

The avalanche row is why tampering is never subtle: a changed byte does not
move a signature a little, it moves it to an unrelated point in a 256-bit
space. The birthday row is why "stored once, referenced many times" is safe at
any scale the hive will reach.

### What the mathematics never guarantees

The hash backs the step **from bytes to name**. It never backs the step **from
the world to the bytes**. A signed lie is still a lie, with a perfect
signature. This is exactly why the hive separates **names** (what a thing is,
`N1`) from **marks** (what someone claims about it, `R1`, `R2`): mathematics
makes the claim attributable and immutable, never true.

## 3. The solidity ladder

Every claim the hive makes sits on one rung. The rung says what a verifier
needs in hand. The experiments confirm each rung as the code ships it today.

| Rung | Claim | Witness in hand | Backed by | Experiment |
|---|---|---|---|---|
| 0 Identity | these bytes are signature S (`I1`) | the bytes | hash | E1 |
| 1 Address | this directory is `sign(meaning)`; this mark is `sign('group:' + meaning)`; this word's molecule is `sign(fold(word))` (`P1`, `A3`, `N1`) | the word, and the fold | hash of a canonical spelling | E2, E5, E6 |
| 2 Composition | layer L has these children, this envelope wraps this payload (`L1`, `L2`) | the layer bytes | hash, transitively (merkle) | E7 |
| 3 Placement | the same bytes live under any root; a name that is not the hash is refused (`S2`, `S3`) | the bytes | hash | E8 |
| 4 Categorization | signature S is a member of pool P | **today: a directory listing on one replica** | **nothing, until sealed or worn** | E9, E10 |
| 5 Currency | S is the current head of molecule M (`H1`) | a signed head claim with `prev` and `seq` | signature plus hash chain, up to the reader's horizon | E11 |
| 6 Authority | publisher K vouches for root R (`T2`) | the signed sentinel or claim | schnorr over secp256k1: who said it, never whether it is good | E11 |
| 7 Interest | this content is about X (`R1`) | the signed deposit | signature: who deposited, never whether it is so | not tested: by design (`R2`, `R3`) |
| 8 Derived | this record is f(input) (`D1`) | the input signature and f | recomputation | E12 |

Rungs 0 to 3 and 8 are rock solid today. Rungs 5 and 6 are rock solid **up to
the horizon**: a signature proves authorship and the chain proves order among
one key's claims, and no mathematics can make a claim you never received
present (`resolveBucketHead` answers from what a reader holds). Rung 7 is
deliberately not a truth claim. **Rung 4 is the gap, and it is the theory's own
target.**

## 4. Findings

### F1. Membership in a pool is a replica fact until it is sealed or worn (E9)

A pool directory is `readdir`. Two replicas holding the same members list them
in different orders; a third replica with one extra member produces a listing
just as well formed. Nothing in a listing says which replica is right, and
nothing in it is signed. `head-map.ts` reached the same wall from the other
side: a seal that terminates in a directory listing terminates in a mutable,
unsigned, host-chosen fact, and a static host has no listing at all.

Two forms make membership mathematical, and both already exist in the hive:

- **The mark worn by the member** (`A3`). The group signature sits inside the
  member's own canonical bytes, so "S wears `group:style:christmas`" is checked
  by hashing S and reading S. It travels with the content, which is why
  `known-location-pools.md` says marks are the only classification that crosses
  machines.
- **The sealed enumeration.** Sort the member signatures, one per line, and
  sign the bytes. Two replicas with the same set produce the same atom whatever
  their history (E9 proves history independence), one extra member produces a
  different atom, and a stranger with `node:crypto` recomputes the seal. This is
  the flat enumeration `head-map.ts` already mints for heads, generalized to
  any pool a host offers.

So the precise form of claim 2 is: **categorization is mathematically backed
exactly when the category is inside the signed bytes of the member or inside a
signed canonical enumeration of the set. A directory is a replica's memory of
one of those; it is never the proof.** This is `P6` and `N5` stated as
mathematics.

### F2. A federated pool converges only under union (E10)

The canonical seal makes a pool a value, and the value obeys a join-semilattice:
union is associative, commutative and idempotent by signature equality over
random draws. That is the whole proof that `P1`'s federated union is sound: the
order in which replicas meet never matters, and a replica that meets the same
peer twice changes nothing. A pool under union is a grow-only set, the simplest
convergent replicated data type.

The contrast is the finding. A write that **replaces** what came before — a
document space written with `keep: 'current'` (what the software writes on its
own, `PoolDocWrite` in the runtime store), or any register whose rule is "the
newest marker wins" — is order dependent: two replicas that saw the same two
writes in different orders disagree, and no signature can arbitrate. The
default document write keeps every version as markers, which makes that space
a **bag**: an ordered succession whose currency is rung 5, backed to the
horizon, not a set whose membership is rung 4. Replacement is sound as **local
state** and unsound as a **federated fact**. The pool-versus-bag doctrine
already keeps undo out of pools; this adds the mirror rule: keep replacement
out of federation.

### F3. Every address fold is a fixed point today (E5)

`standardName`, `canonicalizeLineageSegment`, `moleculeKey`, `spellPoolMeaning`
and `lineageKey` are idempotent over a corpus of hostile names (em dashes,
non-breaking spaces, smart quotes, emoji-only, Japanese, colons, slashes,
empty). A fold that moved a spelling on the second pass would move an address,
and the history under it. The experiment is now a permanent guard; the corpus
should only grow.

### F4. The collision class and its fence are both arithmetic (E6)

A root tile named `bees` hashes the very bytes the bee pool hashes:
`sha256(lineageKey(['bees'])) === sha256('bees')`. That is not a bug in a
function, it is equality of preimages, which is why the answer was a reserved
word (`P4`), not a patch. The fence is arithmetic too, with one nuance the
experiment surfaced: a tile preimage **either contains no colon or contains no
letters and digits at all** (a symbol-only name keeps its raw form, so `:` is a
legal preimage). A `family:name` meaning contains both, so no tile can ever
reach a colon pool. Random twelve-character strings and the hostile corpus
confirm it; the group prefix always carries a colon.

### F5. Composition is transitive and dedup is free (E7)

Editing a grandchild re-signs the child and the root; the untouched sibling
keeps its signature. The canonical layer form forgets insertion order and
empties, so one state has one signature; the order of `children` is content,
so swapping two children is another layer (`L1`: ordered). The meta envelope
has one byte form however its fields were given and is one hop from its
payload (`L2`). The merkle root of a subtree is its head layer signature, and
the experiment shows why that is a proof and not a convention.

### F6. Currency is backed to the horizon, and equivocation is a two-string proof (E11)

The head claim preimage carries the molecule it was signed for, so a claim
lifted into another row does not parse to that row. Every reader resolves the
same head from the same claims whatever the listing order; a reader who never
heard the newest claim resolves to its own horizon, which is the one thing no
signature can supply. Two claims by one key with one `seq` and two heads are,
together, a proof of double-signing that anyone holding both can verify with
no third party; and readers still converge deterministically on one of them.

## 5. Where the mathematics pays most

jwize asked which areas and which techniques benefit the platform most. Ranked
by impact against cost, from the ladder:

| Rank | Area | Technique | Why it pays | Cost |
|---|---|---|---|---|
| 1 | Categorization across hosts (rung 4) | **Sealed enumeration** of a pool per host per generation, signed like a head claim; then a **sorted-leaf Merkle set** over it | closes the one rung with no backing; two hosts agree on a pool by comparing one signature; a member's inclusion becomes an O(log n) proof instead of a readdir; a stale seal degrades to "you may not have heard", never to a wrong member | one canonical byte form (E9 is the model) and one signed atom; no new cryptography |
| 2 | Pools of meaning as replicated values | **Join-semilattice discipline**: a federated pool write is a union (grow-only set) or an add-wins hide (`H4` is an observed-remove set); replacement writes are local registers | makes `P1` convergence a theorem instead of a hope; names the unsound case (F2) so it is never federated | a rule and a ratchet; no code to ship |
| 3 | Address derivation (rung 1) | **Fixed-point property tests** over a growing hostile corpus, for every fold | the cheapest insurance in the system: a non-idempotent fold forks addresses and the history under them | already built (E5); keep the corpus growing |
| 4 | Pool sync across a community of hosts | **Set reconciliation**: invertible Bloom lookup tables, or a BCH sketch (Minisketch) | sync costs the symmetric difference, not the set; 500 hosts carrying one style collapse to one transfer; exact, unlike Bloom gossip in `signature-algebra.md` | a small library-free structure; pays once pools are sealed (rank 1) |
| 5 | Currency and publishing (rungs 5, 6) | **Equivocation proofs** carried as two claims; a **version vector** (key → seq) per molecule | misbehaviour becomes a verifiable artifact anyone can hold up; readers know exactly when two views are comparable and when they are concurrent | low: every piece exists in `head-claim.ts` |
| 6 | Discovery at the horizon | **HyperLogLog** for distinct members of a pool across the community; **Bloom filters** per host for "definitely lacks" | a count or a presence answer without transferring members | low; estimates only, so derived cache (`D2`), never truth |
| 7 | Rung 2, replication (`T2`, `V6`) | **Merkle diff** of a new head against held signatures; closure hole counting | already the design; the payoff is a compositional proof that `holes === 0` | already built |

Not needed now: zero-knowledge proofs and homomorphic hashing. The hive's
interests are private by design (`R3`) and never travel, so there is nothing to
prove about them; and `hash(a) + hash(b) ≠ hash(a + b)` is a feature, not a
gap. `signature-algebra.md` reached the same conclusion.

The one-line answer: **seal the sets.** Everything else on the ladder is
already mathematics; membership is the rung that still rests on a listing, and
a canonical, signed enumeration lifts it to the same footing as identity.

## 6. The experiments

Twenty-seven assertions in twelve experiments, each against the shipped
primitive, with `node:crypto` as the independent verifier wherever the claim is
"a stranger agrees". Every expected signature is derived, never hardcoded, so
the spec obeys `P2` and the 64-hex ratchet.

| Id | Claim under test | Method | Prediction | Result (2026-11-04) |
|---|---|---|---|---|
| E1 | identity is recomputable by a stranger (`I1`) | `SignatureService.sign` against `createHash('sha256')` over empty, Unicode and random buffers up to 64 KiB; the empty document is the root address | equal in every case | pass |
| E2 | a pool, a group, a molecule and a facet are recomputable from the word alone (`P1`, `P2`, `A3`, `N1`) | every frozen bare-word pool, `websites:menu`, a group, a molecule, a facet, each against the stranger; the registry answers the inverse | equal; inverse round-trips | pass |
| E3 | tampering is never subtle | 256 single-bit flips in 64-byte inputs; count differing output bits | mean near 128, none below 80 | pass: mean 127.79, minimum 109 |
| E4 | rock solid has a number | birthday bound at 10^18 atoms; atoms for even odds | below 10^-40; about 2^128 | pass: 4.3 × 10^-42; 3.4 × 10^38 |
| E5 | every fold is a fixed point | idempotence of five folds over a hostile corpus; convergence of equivalent spellings; no merge of distinct words | all idempotent | pass |
| E6 | the bag/pool collision and its fence are arithmetic (`P3`, `P4`) | `sign(lineageKey(['bees']))` against the bee pool; reserved word; 200 random strings plus the corpus against the colon fence | collision holds; no colon meaning reachable | pass, with the symbol-only nuance in F4 |
| E7 | composition is transitive and dedup is free (`L1`, `L2`, `A6`) | grandchild edit through a three-level tree; canonical form forgets order and empties; children order is content; envelope has one byte form | ancestors re-sign, sibling keeps | pass |
| E8 | location never enters identity (`S2`, `S3`) | same bytes under two roots; a wrong name refused by both verifiers | one name; refused | pass |
| E9 | a listing is a replica fact; a mark or a seal is mathematics (`P6`, `A3`, `N5`) | three replica listings; seal equality; a worn group mark checked by hashing the member | seals agree on equal sets and differ on one extra member; mark verifiable alone | pass |
| E10 | union converges, replacement does not | associativity, commutativity, idempotence of sealed union over five random draws; replace-write in two orders | union equal; replace unequal | pass |
| E11 | currency is backed to the horizon; equivocation is a two-string proof (`H1`, `T2`) | preimage round trip; wrong row; reader with and without the newest claim; two heads at one seq | as predicted | pass |
| E12 | a derived record is a proof by recomputation (`D1`, `D3`) | the same pure function on two "machines"; a changed input | identical record; key miss | pass |

## 7. The Truth tier

Adopted by jwize on 2026-11-04 as `@7 Truth` in `doctrine.codex`, between
Artifact and Derived. The codex carries the rule; this section carries the
argument. Each cites only earlier axioms.

- **M1 < I1, S3:** A claim is mathematically backed when anyone holding its
  inputs recomputes it and trusts nobody. A directory listing is never such an
  input; a member's own bytes or a signed canonical atom are.
- **M2 < P6, A3, M1:** Categorization is backed only as a mark inside the
  member's signed bytes or as a signed canonical enumeration of the set. A pool
  directory is a replica's memory of one of these, never the proof.
- **M3 < P1, M1:** A federated pool converges only under union. A write that
  replaces members is local state and is never offered as a federated fact.
- **M4 < N1, P2:** Every canonical fold is a fixed point: a spelling spelled
  again is itself. A fold that moves a spelling moves an address.

## 8. What this research does not claim

- It does not claim SHA-256 is proven collision resistant. It claims the hive's
  solidity is exactly SHA-256's, which is the strongest available and cannot be
  weakened by any participant.
- It does not claim pools are wrong. A directory is the right place for a
  replica to **hold** membership (`P1`); the claim is only that holding is not
  proving, and that the proof form is one seal away.
- It does not propose new storage. A sealed enumeration is an ordinary
  sig-named atom; a worn mark is an ordinary decoration. No folder, no pool
  kind, no service.
- It does not touch interests (`R1`–`R3`). A pheromone is a signed claim by
  design, and making it "true" would be a category error the doctrine already
  names.
