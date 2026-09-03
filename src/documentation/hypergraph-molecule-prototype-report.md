# Molecule lineage — prototype report

Companion to `hypergraph-molecule-lineage.md`. What was built, what it proved,
what five adversarial skeptics broke, and what I think you should do.

> **STATUS 2026-09-03 — STEP 4 LANDED.** Blockers 2 and 3 below (no merkle
> root; the stranger-triggered cascade) are ANSWERED by retiring the recursive
> seal, not by repairing it: the deploy signature is now a flat, signed head
> map (`hypercomb-core/src/core/head-map.ts`, prototype twin `head-map.mjs`,
> proofs in `head-map.test.mjs`). §4's proposal is adopted with one refinement
> — the map is a CONTENT ATOM the index names, never the index's content, so
> the 64 KiB index ceiling never applies and the index value stays an adoptable
> layer sig. The `remove()` bug §4 calls "an implementation bug against your
> own rule" is FIXED in the same pass. Skeptic-4 A, A2, B and H still
> reproduce AGAINST THE SEAL and always will; that is the point. Blockers 4
> and 5 (prune, cold-read cost) are UNCHANGED and still open. Full write-up:
> `hypergraph-molecule-lineage.md` → *The deploy signature is a signed head
> map*.
>
> **REVISED THE SAME DAY — STEP 4 WAS ITSELF PUT THROUGH THREE ADVERSARIAL
> PASSES, AND SIX FINDINGS LANDED.** All six are fixed; the attacks are kept
> verbatim in `headmap-skeptic-0/1/2.test.mjs` and
> `hypercomb-core/src/core/head-map.{skeptic,stranger,third-party}.spec.ts`,
> with only the assertions inverted, so the forgery is still built before it is
> refused.
>
> 1. **NOTHING SIGNED THE SET.** Every ROW was signed and the COMPOSITION was
>    signed by nobody, and `record.pubkey` is a field whoever composes the bytes
>    chooses — so any stranger holding a publisher's public bytes could compose
>    a TRUNCATION, an EMPTY DEPLOY, or a CHERRY-PICKED mixture of generations
>    out of that publisher's own rows, each verifying `ok:true, reason:null,
>    holes:[]`. §4's "a third signature would prove authorship and never
>    recency, so it would close nothing" conflated two properties: recency is
>    unprovable by signature, but AUTHORSHIP OF THE SET is not recency and is
>    exactly what a signature closes. `headMapAttestationPreimage(pubkey,
>    mapSig)` — three lines, same verifier, same key, no clock.
> 2. **THE ENUMERATION WAS NOT FLAT AND IT AMPUTATED.** The branch walk stopped
>    at any molecule the publisher did not head, so ONE tile made by somebody
>    else in the middle of a route erased every page below it from the deploy,
>    silently; a contributor who only works inside other people's pages minted a
>    ZERO-ROW deploy; and the root scope was not a superset of a branch scope
>    inside it. The root scope is the mint LEDGER now, and a branch walk
>    descends the UNION of authors as its FILTER while asserting only my own
>    claims as its CONTENT.
> 3. **THE PUBLISH PATH FAILED OPEN** where `#commit` fails closed: molecules
>    the mint could not resolve were dropped with no field naming them.
>    `unresolved` / `outOfScope` / `opaque` are returned now.
> 4. **NO FUNCTION TOOK A DEPLOY SIGNATURE**, so steps 0-1 of the documented
>    verification recipe were owned by nobody and a forged set's verdict was
>    byte-identical to the truth's. `verifyDeploy` owns the whole procedure;
>    the weaker `verifyHeadMapRows` has no `ok` field at all.
> 5. **A DEPLOY COULD NAME NO CONTENT** (`ok:true` over a host holding the map
>    and the claims and not one byte of the hive) and **A CLAIM READER COULD
>    STAY SILENT** about what it fetched (a lying host downgraded a row under an
>    unchanged deploy signature). `readHead` and a REQUIRED `sig` close both;
>    a lie is `mismatched`, never `absent`.
> 6. **THE WRITER'S GATE WAS WEAKER THAN THE READER'S** (`encodeHeadMap`
>    uncapped, `parseHeadMap` capped at 4 MiB), so at 20,660 molecules one more
>    tile name lost every molecule, silently. Same constant both ways now, the
>    refusal says which gate said no, and `splitHeadMap` shards past it.
>
> **AND ONE OUTSIDE THE MAP: `pullClosure` RECURSED WITH NO DEPTH BOUND.** Step
> 5 of the verification recipe blew the stack on ~20k chained atoms — well under
> a megabyte — chosen by whoever serves them. It is iterative now, with an
> explicit worklist and a distinct-atom budget.
>
> **OPEN, AND NO DESIGN CLOSES IT:** a whole, genuinely ATTESTED older deploy,
> replayed to a COLD reader. A signature proves authorship and never recency;
> the per-row `seq` defence needs generations the reader has already proven, and
> a cold reader has none. The pointer's freshness (kind-30564 `created_at`
> monotonicity) is the mitigation, which is why the pointer must come from a
> source with a clock. Pinned as `headmap-skeptic-1 S1-B2`.

**Run it yourself** (zero dependencies, Node ≥ 20):

```bash
cd documentation/molecule-lineage-prototype && node --test
```

2,670 lines: `molecule.mjs` (the model), `root.mjs` (an OPFS-shaped root),
`host.mjs` (directory listings), `pool.mjs` (the shipped pool writer),
`canon.mjs` (the real `lineageKey` rule), `sig.mjs` (sha256 + canonical JSON),
`molecule.test.mjs` (10 scenarios) and `skeptic-0..4.test.mjs` (39 attacks).

---

## 1. What the prototype proves — 10 / 10 pass

| # | Scenario |
|---|---|
| 1 | `save /business/people/Alice` → atom at the root, membership in `sign('people')`, business's projection unchanged |
| 2 | `/business/people` and `/club/people` are ONE molecule — the firehose |
| 3 | Two tenants replicate via `GET /<sign('people')>/` — union, same sig stored once |
| 4 | Order lives in the author's succession + the envelope slot; the molecule is an unordered set |
| 5 | Undo is a VIEW on my chain: the atom stays, the directory head never moves, redo restores |
| 6 | A cold client with an EMPTY root materializes `/business/people` from host listings alone |
| 7 | Time travel: read the molecule as of chain position `0001` |
| 8 | A tile named `bees` coexists with the reserved system pool `sign('bees')` |
| 9 | The ROOT molecule is the empty name, and the empty atom is never written |
| 10 | Canonicalization: punctuation and whitespace converge; case does not — **SUPERSEDED, see §6.1: case is now folded** |

**The headline claim is real.** Saving a tile writes 1 vertex + 1 succession +
1 pointer. No cascade. Two tenants converge on one byte-identical address with
no coordinator, and identical content dedups exactly.

## 2. What held under attack

Worth stating, because these were the parts I expected to break:

- **Order in the succession atom is genuine** — `canonicalJSON` sorts keys but
  never array elements, so `members` order is committed by the signature.
- **Listing order is irrelevant** — natural, reversed and sorted listings
  produce byte-identical read models.
- **Colon pools are unreachable by any tile name.** A colon cannot survive
  canonicalization, so reserved system meanings are safe by construction. The
  scheme you already had is sound.
- **Bare-word collision survives** — a tile named `bees` keeps its author
  bucket, and the shipped `putPoolDoc` deletes sibling *files* only.
- **Content addressing end to end** — a tampered atom fails its hash on
  arrival; a lying host is rejected.
- **Fork refusal works** — a peer head whose `prev` chain doesn't contain the
  head I hold is refused. History never branches.
- **Undo as a view is sound** — the directory head never moves while rewound;
  peers keep seeing the head.
- **Symbol-only names** (`!!!`, `-`, `...`) do not collapse to the root.

## 3. What the skeptics broke

All five returned `refuted: true`. Consolidating across lenses — four of them
found the same top two independently:

### Blockers

1. **Self-placement is unauthenticated** *(4 of 5 lenses)*. A succession
   declares its own `name` and `author`, and replication files it where the
   atom says. So bytes from a host choose which directory they land in —
   including a reserved system pool — and one served atom can blank a page for
   every cold visitor. `author` is both a self-declared field and the bucket
   address, so a host can forge your head on the cold path.
2. **There is no merkle root: the name graph is CYCLIC** *(2 lenses)*. Because
   depth is a route and names are global, an ordinary tile name can close a
   cycle. `seal()` has no fixpoint, cannot terminate, and the same molecule
   seals to different sigs depending on entry point. That is a direct hit on
   "history is the deploy".
3. **The cascade returns with an external trigger.** A stranger's commit
   re-mints your deploy sig, because the seal folds heads other people move.
4. **Prune is unimplementable.** `prev` makes the whole history
   merkle-reachable; a faithful GC frees nothing, ever. The only real prune
   truncates the chain — which forks you off the mesh.
5. **`remove()` blanks a live sibling route.** Removing a child on one page
   empties the child molecule *globally*, so another page showing it goes
   blank, and one undo cannot restore it.
6. **The bucket commit is not atomic and has no tie-break.** A half-written
   head erases the author's chain and silently forks it; `flatten()` then
   deletes the last good head.
7. **A derived-cache wipe destroys history** — including other authors' heads —
   because a wipe is directory-scoped and the molecule dir holds both.
8. **The empty name aliases the ROOT molecule**, and only one of four write
   paths guards it.

### Majors

- **Case defeats interop**: `sign('People') !== sign('people')`.
- **`hidden` is keyed by envelope sig**, so hiding someone's member silently
  pre-hides your own future identical member — and there is no unhide.
- **Cold read costs the whole history**: 123 atom fetches to render 1 member.
- **A sealed pin needs a directory listing**, so merkle verification depends on
  a mutable, unverifiable read.
- **Undo is per-molecule, therefore per-all-routes**: rewinding on one page and
  committing on another deletes tiles from the page you rewound.
- **A visitor's tile order is sha256 of participant ids** — the owner cannot
  pin the order of the page they published.

## 4. My reading — four of these have clean, doctrine-native fixes

**`prev` must be a REFERENT, not an EDGE.** `edge-registry.ts` already draws
exactly this line: `EDGE_FIELDS` are bytes a closure must carry,
`REFERENT_FIELDS` (`groupSig`, `targetSig`) are pointers a closure must not
follow. Put `prev` in the second set and blockers 4 and the cold-read major
dissolve together: a cold read fetches the head and the members it names, never
the dead generations. The chain is walked only for time travel and fork
refusal. This is not a new mechanism — it is the mechanism you already have.

**The deploy sig is a signed head map, not a recursive root.** Blocker 2 says a
global name graph cannot have a fixpoint. It doesn't need one:
`publish-heads.ts` already publishes `{molecule → head}`. Sign that map and it
is a single summarizing signature that terminates by construction, is
entry-point independent, and cannot be moved by a stranger — which kills
blocker 3 as well. "History is the deploy" survives; what changes is that the
deploy is a *manifest of heads*, not a recursive seal.

**Placement is the reader's derivation, never the atom's declaration.** You
fetched `GET /<mol>/<author>/`; file the bytes at the address you asked for and
reject any atom whose declared `name`/`author` disagree. Combined with a
**pubkey bucket and signed head entries** — the project already carries
nostr keys — blocker 1 closes completely. This is the single most important fix
and it is ordinary engineering, not new theory.

**`remove()` must remove the incidence, never touch the child.** The prototype
reached into the child molecule; doctrine says relations are marks members
wear, *never a parent that holds them*. Blocker 5 is an implementation bug
against your own rule, not a flaw in the rule.

That leaves the genuinely hard ones: **atomic bucket commit** (6) is real
engineering work — a two-phase write with a tie-break rule; **wipe safety** (7)
extends the prune rule to "never wipe a directory holding author buckets"; and
**the empty-name guard** (8) is a one-line fix in four places.

## 5. Verdict

**Swap — but not yet, and not in one move.** The model's core is sound: the
things I most expected to fail (convergence without a coordinator, order in a
shared set, collision safety, cold materialization, fork refusal) all held
under deliberate attack. The blockers cluster into *authentication* and
*termination*, and both have fixes that use machinery already in the repo.

What I would not do is ship step 3 (the forward-commit write path) before
blocker 1 is closed. Unauthenticated placement is not a rough edge — it is a
remote write primitive. The order I'd now recommend:

1. **Prune safety** (unchanged) — plus "never wipe a dir holding author buckets".
2. **`prev` → `REFERENT_FIELDS`**, and prove cold read fetches O(members), not O(history).
3. **Pubkey buckets + signed head entries + reader-derived placement.**
4. **Signed head map as the deploy sig**; retire the recursive seal.
5. Then dual-read, then the forward-commit write path, then mesh, then the ratchet flip, then docs.

## 6. Three decisions only you can make

1. ~~**Case.**~~ **DECIDED 2026-09-02 — FOLD IT. Case folding IS the interop.**
   The molecule address becomes `sign(canon(name).toLowerCase())` (locale-
   independent `toLowerCase`, never `toLocaleLowerCase`); display case is
   preserved on the vertex. Accepted cost: two differently-capitalised tiles
   merge, exactly as two same-named ones do. **This supersedes scenario 10 of
   the prototype**, which asserts case is preserved — that test must be
   inverted when the fold lands. Homoglyphs remain unsolved and open.
2. **`hidden` keying.** Envelope-sig keying is broken (it pre-hides your own
   future identical member). Key it by `(molecule, member vertex)` in your own
   succession instead? That changes what "hide" means when two authors add the
   same thing.
3. **The mesh transition** — still open from the doctrine doc: dual-publish to
   the old `lineageKey(path)` channel for a window, or partition peers by
   version.

---

*Prototype: workflow `wf_3faa54bf-36d`, 16 agents. Skeptic verdicts extracted
from that run's `journal.jsonl`. The repair round and the completeness critic
were killed by a session limit before running — every finding above is the
skeptics' raw output plus my own reading of it, not a repaired result.*
