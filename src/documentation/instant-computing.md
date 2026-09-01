# instant computing

> **status: thesis — the argument for the architecture (2026-09-01).** this document consolidates the instant-computing hypothesis: that a content-addressed, merkle-structured network with cheap probabilistic verification can make every digital computation a one-time cost for humanity — solved once anywhere, verified and free everywhere, forever. hypercomb is the canvas and the information-gathering device for doing this at scale. nothing here proposes a new service, folder, or field; every mechanism maps onto primitives that already exist or onto derived-cache records the optimize phase is already allowed to mint.

## the hypothesis

> if every computation is a pure derivation of signature-addressed inputs, keyed by the signatures of its function and its inputs, then the network becomes a global memo table: no gate is ever solved twice, no result ever needs to be trusted, and the marginal cost of all repeated computation falls toward the energy cost of a hash. everyone thinks with the whole network's past behind them — instant computing for everything digital.

**related critical documents:**
- [collapsed-compute.md](collapsed-compute.md) — the memoization core: `authenticity = sign(concat(sign(S), sign(I)))`, result markers, the network effect. this thesis is the verification-and-scale argument layered on top of it.
- [signature-system.md](signature-system.md) — content IS identity; the expansion doctrine
- [signature-algebra.md](signature-algebra.md) — the algebra over signatures; deterministic on every peer without coordination
- [deterministic-computation.md](deterministic-computation.md) — script + resource → deterministic result (the determinism precondition)
- [optimize-phase.md](optimize-phase.md) — the derived-cache contract: pure, sig-keyed, never load-bearing, complete-or-absent
- [trail-capsule.md](trail-capsule.md) — the 1-byte route stream: the existing witness encoding for navigation
- [known-location-pools.md](known-location-pools.md) — pool doctrine; every NEW pool meaning carries a colon
- [byte-protocol.md](byte-protocol.md) — dense byte encodings at the leaf tier

---

## 1. the pairing is not a metaphor

two results from 1992 were made for each other, and hypercomb has half of the pair built as doctrine.

- **the PCP theorem** (Arora–Safra; Arora–Lund–Motwani–Sudan–Szegedy): every NP proof can be rewritten so a verifier checks it by reading a **constant number of bits**, chosen with O(log n) randomness. verification becomes sampling.
- **Kilian's protocol**: PCP proofs alone are astronomically long — nobody can ship one. Kilian's move: don't ship it, **merkle-commit to it**. the verifier's few queries are answered with short authentication paths. locality plus commitment made probabilistic checking practical. Micali then applied Fiat–Shamir so the proof travels with the data, non-interactively. every modern SNARK/STARK descends from this construction.

Kilian's construction IS "PCP + merkle tree." hypercomb has the merkle half — signatures as identity, layers composing recursively by signature, derived caches keyed by input signature. the PCP half is the missing upgrade, and it slots into an existing seam.

## 2. the seam is the optimize phase

the optimize-phase contract — records are **pure derivations of sig-addressed inputs, keyed by the input signature, never load-bearing, recomputable cold from truth** — is, almost word for word, the contract that makes a cache record safe to accept from a stranger.

today a record proves only "this is the content with hash X." it does not prove "X is the correct output of function F on input Y." that is the trust gap between a local cache and a world catalog. two closures, both cheap because of existing doctrine:

1. **optimistic + spot-check.** accept records from anyone; recompute a random sample; discard on mismatch. this is affordable ONLY because derived caches are never load-bearing — a poisoned record wastes time but can never corrupt truth. most distributed systems cannot afford this model; hypercomb forbade load-bearing caches before it needed the property.
2. **proof-carrying records.** attach a succinct argument (SNARK/STARK — PCP + merkle at heart) so any consumer verifies `record = F(input)` in milliseconds without re-running F. reserved for derivations too expensive to spot-check.

**the key must name the function.** a shareable record is keyed by `sign(F ‖ input)` where F is itself a sig-named artifact (bees already are). collapsed-compute's `authenticity` marker is exactly this key. the derivation-version lesson is subsumed: the function's signature IS its version.

## 3. why it scales — the consensus dodge

the thing that kills world-scale systems is consensus: global agreement on ordering and state. this architecture needs none.

- **truth stays local.** each participant's lineage sigbags are their own. nothing world-scale ever writes truth.
- **the world-scale layer is the derived-cache layer**, and it needs zero coordination: every record is self-certifying (its name is its hash), any host can serve any record, replication is trust-free, deduplication is automatic, and the flat hash namespace has no hot spots. adding a node adds capacity and never adds coordination cost — the same property that lets git and BitTorrent scale with nobody in charge.
- the one real engineering problem is **routing**: finding who holds `sign(F ‖ input)`. that is solved technology (Kademlia-style DHTs); the community-hosts primitive is the small-world version.

## 4. the two asymmetries — what "instant" and "superhuman" mean precisely

the network cannot give anyone more raw FLOPS for a novel computation. what it gives everyone is two asymmetries:

1. **amortization.** effective compute = own hardware × the cache hit rate over the world's entire computational history. because layers compose recursively, novel queries still hit on shared **subtrees** — the unit of reuse is the sub-derivation, and content addressing finds it automatically. the hit rate only rises, because records are permanent. every solved subproblem is solved for the species.
2. **verification.** a succinct proof verifies in milliseconds regardless of what the original computation cost. a phone consumes the output of a datacenter-month, safely, without trusting the datacenter. the gap between "can compute it" and "can use it" collapses.

what each participant gets individually is superhuman **memory and verification**: standing on the entire verified computational history of the community, the way science stands on its literature — except machine-checkable, deduplicated, and millisecond-fast. add LLM sessions as solvers dropping derivations into the pool and the compounding becomes concrete: the second time anyone on earth poses a question, it is a cache hit with a proof attached.

**the collective corollary — superhuman solving through atomization.** no node gets smarter, but the swarm solves what no node could, because the architecture deletes the term that normally caps collective intelligence: coordination overhead (Brooks's law — adding solvers slows work because integration and trust costs grow faster than contributions). here atoms are self-certifying, so nobody reviews anybody; merging happens through the pool by content identity (§13), so solvers never communicate with each other at all. collective solving scales nearly linearly with members instead of saturating. the mechanism has a name — **stigmergy**: coordination through traces left in a shared environment, which is how real hives and ant colonies compute. no ant has a plan; the pheromone field is the plan. the pool of sig-addressed records IS the pheromone field — solvers deposit derivations, witnesses, and pruning certificates into the environment, and every other solver's behaviour is shaped by what is already there. hypercomb's bee metaphor is not branding; it is the coordination model, and pheromones are already a primitive. the collective is a stigmergic superorganism: atomize every task, let anything solve any atom, merge by content — a collective superintelligence in the exact sense that its solving capacity is the swarm's, not any member's.

## 5. the economics — instant AND at cost

the cost side is as strong as the speed side, because the light tier's operations are near the physical floor of computation:

- a SHA-256 block costs **nanojoules** on commodity silicon (dedicated SHA hardware ships in essentially every chip made this decade, phones included). a frontier derivation costs joules to megajoules. the ratio between "use a result" and "produce a result" is 10⁹ or more.
- therefore the marginal cost of every **repeated** computation falls toward the energy of hashing — effectively zero. cost is paid once, anywhere, by whoever solves the frontier; benefit accrues everywhere, forever, at nanojoule prices.
- the hardware that serves the repeated case is the cheapest hardware ever made (§8): cent-scale chips, microwatt budgets, coin cells, harvested power. traditional systems scale inversely (more users → more servers → more cost); this one inverts — **more users → higher hit rate → less compute per capita**, delivered on hardware that costs cents.

## 6. requests — the network as solver

a request is a record naming `(F, input)` with **no output yet** — content-addressed, so anyone can pick it up; the result is self-certifying and spot-checkable. that is a work market with no coordinator: no assignment, no trust negotiation, just open derivations and whoever fills them first. distributed-compute projects wanted this shape for decades; what they lacked was self-certifying tasks and cheaply verifiable results.

## 7. witnesses — remember the search, not just the answer

**a remembered route is a witness.** the P-vs-NP asymmetry cashed in as storage: finding a path through a search space of 10⁶⁰ is expensive; the path itself is 20 bytes, and checking it is cheap. in hex grammar a step is 3 bits (six neighbours + centre) — the trail capsule already encodes this.

- **route records** are keyed by `sign(rootSig ‖ querySig)` — pure derivations, optimize-phase legal, derive-on-miss, GC-safe.
- **replay is self-verifying.** a route is followed through hash-committed nodes; a wrong or stale route fails at the first bad step and falls back to real search. routes from strangers cannot lie; at worst they waste a few hash checks.
- **negative certificates** — "this subtree contains nothing matching predicate P," keyed by `(subtreeSig, sign(P))` — are the part merkle uniquely unlocks. negative caching is normally the most dangerous caching in computing (stale negatives silently hide real results). here subtrees are immutable: any change mints a new signature, which has no record, which forces a fresh search. **staleness is structurally impossible**, so paths cut off are cut off forever, for everyone, safely. chess engines prove the local value (transposition tables keyed by position hash are worth hundreds of Elo); this is a transposition table for every hierarchy the network holds.
- **routes compose**: route-to-subtree ‖ route-within-subtree. even novel queries reuse remembered prefixes through shared ancestry.
- **the pruning is shared, not just the answers.** most of the compute in any search is the rejection of branches; when probes are content-addressed, a rejected branch is rejected for everyone.

## 8. geometries — witnesses with area

a path is the one-dimensional witness. a geometry is the general form, and it buys what paths cannot:

- **bulk pruning.** a geometry says "the answer is somewhere in this shape — and nowhere outside it." one shape kills the whole exterior. precedent: Quake's precomputed visibility sets — geometric pruning certificates baked once, shipped with the map — made real-time rendering possible on 1996 hardware. sig-named, such certificates become a commons.
- **space decomposition.** hex grids are planar; planar graphs have O(√n) separators. a remembered separator is a witness for divide-and-conquer — it pre-cuts the region for every future query on it.
- **sampling patterns.** which leaves to probe is itself a shape over the committed tree (the PCP verifier's query pattern IS a geometry), expensive to find and endlessly reusable — the blue-noise-mask lesson from graphics.
- hypercomb's **patterns are already shape artifacts**; this thesis adds only a reading: a pattern is a certificate about space — where to look, where never to look, where to cut.

## 9. multi-scale — cross-sections at every altitude

a merkle tree is natively a multi-scale instrument: every internal node commits to its whole subtree, so "zoom level" is just depth.

- **annotated nodes.** let each node carry a few bytes of verified summary (counts, bounds, coarse geometry) — an authenticated segment tree. coarse queries read annotations; precise queries descend; both are verified by the same hash spine.
- **recursion keeps sampling honest at every zoom.** PCPs compose: a sampled bit is itself the root of a committed lower level, sampled again — verification cost stays roughly constant however deep the stack goes. cross-sectioning is scale-invariant by construction.
- **dense containers at the bottom.** a signature costs 32 bytes plus a fetch; below some granularity, per-item addressing costs more than the item. so: sig the container, index densely inside it (git packfiles, chess bitboards, 4×4 texture blocks, 3-bit hex steps). the ladder — dense bytes in containers, sig-named containers in subtrees, annotated nodes above — puts the container boundary wherever signature overhead stops paying.
- the whole stack is **self-similar**: commit, sample, remember the witness — identical at every scale.

## 10. hardware — many light cores, and why the wall vanishes

small pure operations over immutable inputs are exactly the workload that trades one heavy core for thousands of light ones:

1. **purity is the parallelism precondition.** each derivation reads committed inputs and writes one new record: no locks, no races. the merkle DAG IS the dependency graph; only the logarithmic combine up the spine is serial — Amdahl barely bites.
2. **the coherence wall vanishes.** multicore scaling dies on cache coherence — cores negotiating the current version of mutable lines. content-addressed memory has no current version: a signature's bytes are valid forever on every core and every machine. the same design scales from cores on a chip to devices on a network without changing shape, because the shared memory needs no coherence protocol.
3. **dense containers are SIMD food** — fixed-size, branch-light, uniform. the GPU's origin story (millions of tiny identical ops → thousands of feeble cores → orders of magnitude per watt) and the systolic-array affinity of six-neighbour local flow.
4. **verification makes small devices full citizens.** a swarm of weak untrusted devices is normally useless for serious work; here answers are self-certifying, so trust does not scale with device size. a phone verifies a datacenter; a microcontroller contributes a gate.

the same law covers small-**weight** solvers: a tiny model solving small well-specified gates whose outputs are verified beats a giant model trusted blindly. heavy weights for the frontier; swarms of small ones fill the pool.

## 11. the tiers — and the smallest possible chip

the fifty-year-old precedent is the internet itself: control plane heavy (computing routes, occasionally, on real processors), data plane light (forwarding on dedicated silicon at line rate).

- **light tier: route, fetch, verify, replay.** hash a signature, compare, hop; replay witness bytes down a committed tree; verify a proof or spot-check a sample. no floating point to speak of.
- **heavy tier: derive, bake, prove.** novel computation, scene baking, frontier search, and proof *generation* (currently 10³–10⁶× native cost; improving fast via STARKs and folding schemes). bursty, schedulable, wall-powered.
- **the downhill dynamic:** the heavy tier's output IS the light tier's program. every completed search mints witnesses, and a witness moves a task from search (heavy) to replay (light). real computers are witness factories; light nodes are witness players; every heavy job that finishes permanently shrinks the set of jobs needing a real computer.

**the floor, bounded precisely.** the light-tier atom is *verify one 32-byte link*. a merkle path verifies streaming — running hash (32 B) + sibling (32 B) + 64 B combine buffer + ~100 B SHA-256 state + one direction bit per level: **~200–300 bytes of RAM total, at any depth.**

| tier | chip | notes |
|---|---|---|
| theoretical | dedicated ASIC | SHA-256 core ≈ 20–30k gates + comparator + state machine; well under 0.1 mm²; microwatts; RFID/harvested-power territory. the radio, not the compute, is the true floor. |
| smallest programmable | bit-serial RISC-V (SERV class) | a couple hundred FPGA LUTs; runs SHA-256 slowly but correctly |
| cheapest silicon today | CH32V003 (~10¢, 2 KB RAM) | software SHA-256 at hundreds of blocks/s — vastly more than routing needs; no radio |
| deployable node today | ESP32-C3 class (~$1–2) | RISC-V, hardware SHA engine, Wi-Fi + BLE on-die; routes, fetches, replays, verifies on a coin-cell budget |

caveat: verifying a **signed pointer** (secp256k1, for nostr-published sentinels) costs ~a second in software at this class. keep the smallest nodes hash-only, or accept the occasional slow verify.

## 12. challenge one — everything into gates

"translate everything on the planet into gates" is bounded by **sensing, not translation**. once anything is sampled into bytes, it is already in circuit territory — every computable transformation is a circuit (settled theory). so the challenge reduces to *keep writing the circuits people care about*, which is a commons problem, which content addressing was built for: every circuit written once is written for everyone, and **bees are already the sig-named circuits**. LLM sessions act as compilers from intent to circuit. the genuinely open edge is the sensor boundary — the network computes on what has been sampled.

## 13. challenge two — the merge

processors never merge with each other. they merge **through the pool.**

- **hash-consing at world scale.** when algorithm A and algorithm B each derive the same intermediate content, it gets the same signature — their computation DAGs physically intersect at that record without either algorithm knowing the other exists. no interface, no treaty. the content-addressed store is not a cache beside the computation; it IS the crossing point — a blackboard all algorithms read and write, where identical work fuses because identity is content.
- **equivalence witnesses.** two *different* circuits computing the *same function* have different sigs; syntactic merging misses them. but equivalence is itself a witness: a record keyed by `sign(sigA ‖ sigB)` stating "proven (or heavily sampled) equivalent" — expensive to establish once, cheap to verify, permanent, shared. compiler research calls the machinery **e-graphs** (equality saturation): equivalence classes of programs where a rewrite discovered in one applies to all. a world-scale e-graph over sig-named circuits is the merge pattern that lets code cross into other algorithms.
- the merges are just one more derivation kind in the pool — same doctrine, same GC, same verification.

## 14. code in, pixels out

if every transformation resolves through the pool, the last irreducible act is emission: resolve signatures until the bytes are pixel bytes, then make light. the terminal device is a radio, a hash engine, and a screen — **verify and glow**. this is what hypercomb already is: a rendering surface fed by signature resolution. the hive is the universal display of the merged graph; behaviours are the code in; the hex grid is the pixels out.

the honest boundary stays fixed: the 16 ms frame loop is local — network lookups never sit inside a frame. the pool feeds the loop; it does not run it. the same split governs every real-time domain: graphics bakes on the network and renders locally; a self-driving stack learns, maps, and certifies through the pool (merkle-committed scenario coverage, verified by regulators sampling random leaves) while the control loop stays onboard. **the millisecond loop is local; everything derivable, including the pruning, is the network's.**

## 15. honest limits

stated plainly, because the thesis is stronger with them than without:

1. **PCP is verification, not discovery — for any individual node.** verifying is cheap; solving is still hard (P vs NP stands). the network guarantees no gate is solved twice and no solution needs trust. the collective, however, is superhuman at everything that **decomposes** (§4, the collective corollary) — and the true residual frontier is tasks nobody yet knows how to atomize. even that residue shrinks monotonically: a decomposition is itself an artifact, found once by anyone (human or model), shared forever, never re-lost.
2. **determinism is a per-derivation discipline.** signatures converge only if derivations are canonical (floating point, iteration order). see [deterministic-computation.md](deterministic-computation.md).
3. **proving cost.** succinct proof generation is 10³–10⁶× native today. hence the tiered trust model: optimistic + spot-check by default, proofs for derivations that earn them.
4. **input sparsity.** naive memoization fails on combinatorial input spaces; composition rescues the hit rate at the sub-derivation level, but genuinely novel wholes still miss.
5. **semantic equivalence is undecidable in general.** the merge accumulates witness-by-witness; it never completes. this is the research frontier, not an engineering task.
6. **hard real-time stays local.** frame loops, control loops. by design, not as a concession.
7. **the sensor boundary.** the network computes on the sampled world, not the world.

## 16. what it takes in hypercomb terms

no new machinery — extensions of existing records, in doctrine order:

1. **shareable derivation records** keyed `sign(F ‖ input)` with F a sig-named bee — collapsed-compute's `authenticity` marker, made portable. lives in the existing computation pool; never load-bearing; complete-or-absent.
2. **open-request records** — same key, output absent — as the network-solve primitive (§6).
3. **witness records** — routes (trail-capsule encoding), negative certificates, geometries — as derived-cache pools. any NEW pool meaning carries a colon per [known-location-pools.md](known-location-pools.md) (e.g. `witness:routes`), derived only via `Store.poolSignature`.
4. **equivalence witnesses** keyed `sign(sigA ‖ sigB)` (§13).
5. **acceptance policy**: optimistic import + random spot-check by recomputation; discard-and-rebuild on mismatch (safe because never load-bearing).
6. **optional proof field** on derivation records, for the expensive tail.
7. **world routing**: DHT-style lookup of who holds a signature; community hosts as the first small-world implementation.

each step is independently useful; none blocks another; all of it is derived cache, so every step is wipe-safe and reversible.

---

*license: CC BY-SA 4.0 (see [licensing.md](licensing.md))*
