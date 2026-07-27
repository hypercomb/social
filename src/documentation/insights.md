# insights

> **status: partially built (as of 2026-07-26).** the insight *record* ships — named, persisted, callable from the sideways tree view (`/tree`, `presentation/tiles/tree-insight.ts`), stored as one document in `sign('insights:catalog')`. everything past §3 is design: filtered branches, insights as computation input, and the swarm subject are specified here and not implemented. the insight record must move out of `presentation/` before any of it is built — see §8.

an **insight** is a named, **partial** capture of the hive: a little piece of something you can share with others or reference later. it is not a saved view and not a bookmark — it is a bounded, addressable, verifiable description of a region.

the load-bearing word is *partial*. **hives are full.** that one distinction sets the whole vocabulary:

| | named? | complete? | |
|---|---|---|---|
| **branch** | no | yes — a whole subtree | the raw structural unit |
| **hive** | yes | **yes** | naming a whole branch gives you one (`/hive <name>`) |
| **insight** | yes | **no** | selected pieces, from anywhere, at any depth |

and the verb that connects them: **group insights → promote to a hive → take it somewhere.** gather the pieces that matter, commit them as a complete thing, and now it is navigable, adoptable, and presentable like any other hive (`/present`). an insight is the fragment; a hive is what you make from fragments when you are ready to hand it to someone.

the second useful sentence is *an insight of compute*: a bounded region, named, that can be handed to something as input. whatever is asked of an insight is asked of exactly those signatures and no others.

**related critical documents:**
- [signature-system.md](signature-system.md) — the expansion doctrine an insight obeys: one sig field, resolved lazily
- [signature-algebra.md](signature-algebra.md) — the algebra insights make set-valued
- [deterministic-computation.md](deterministic-computation.md) — the receipt an insight becomes an input to
- [collapsed-compute.md](collapsed-compute.md) — why content-addressed inputs make computation memoizable
- [optimize-phase.md](optimize-phase.md) — where a derived insight is allowed to be minted
- [known-location-pools.md](known-location-pools.md) — why the pool meaning carries a colon

---

## 1. what an insight is

```ts
type Insight = {
  name: string
  root: { sig?: string; segments?: readonly string[]; label?: string }
  calls: readonly string[]   // layer signatures, called in from any level
  createdAt: number
  updatedAt: number
}
```

you name it **first** — the name is the starting point, not a label applied afterwards — and then call branches into it as you find them. calls may come from any depth and need not be related to each other.

## 1.0 an insight is not a new primitive — but it is not a hive either

> two superseded drafts are recorded here so neither is reinvented.

**draft one said** a layer is tree-valued and an insight is set-valued, so insights are a new primitive beside the layer. **wrong.** a layer's `children` is already an arbitrary set of signatures with no requirement that they be locally authored — `layer-placement.ts` exists precisely to re-point `children` at "content sourced from elsewhere", which is what adopt and paste do. the set-valued primitive was always there. it is a layer.

**draft two therefore said** an insight simply *is* a hive, derived rather than committed. **also wrong**, in the opposite direction. same *shape*, different *contract*: a hive claims to be complete. an insight explicitly does not. collapsing them throws away the only thing that distinguishes a fragment from a finished thing.

so: an insight **is structurally a layer** (no new record kind, no new reader discrimination) and **is not a hive** (it makes no completeness claim). it is a *derived, partial* layer:

| | branch | hive | insight |
|---|---|---|---|
| structurally | layer | layer | layer |
| claims completeness | n/a | **yes** | **no** |
| minted by | authored | `commitLayer` | `materializeLayer` |
| lineage bag / markers | yes | yes | **no** |
| history weight | full | full | none |
| navigable / renderable | yes | yes | yes |
| becomes a hive by | being named | — | grouping + committing |

the consequences that matter:

- **no new record kind.** an insight resolves through `getLayerBySig` to a layer, because it is one.
- **no reader discrimination** — §3.1 below is satisfied by construction, not by discipline.
- **the root/calls split disappears.** the root *is* the layer; the calls *are* its children. one rule, not two.
- an insight is **derived, not committed**: an ephemeral selection must never mint a lineage bag and a history entry. pool-write it; commit only on deliberate promotion.

what remains genuinely new is **not the container but the provenance and the comparison**: where each child came from, what it looked like then, and how to tell what has moved since. those are slots and operations over an ordinary layer — §1.1, §5.

### 1.0.1 promotion

grouping insights and committing the result is how a fragment becomes a finished thing. the promoted hive is an ordinary hive in every respect — it can be presented, adopted, shared, and used as a swarm subject. the insights it was built from remain valid and independently referenceable; promotion copies nothing, because every child is already a signature.

this is the workflow the whole primitive exists to serve: **capture pieces while you explore, group them when they add up to something, hand the result to someone.**

---

## 1.1 what an insight still adds

1. **it is one signature.** `{ "scope": "<insightSig>" }` obeys the existing expansion doctrine with no change to the algebra.

2. **it is a snapshot.** a child is held as a layer signature, and a layer sig transitively covers its whole subtree against an append-only pool. so an insight captures those subtrees *as they were*, permanently — resolvable even if the live tree later edits or deletes them. an insight is a provenance artifact, not just a selection.

3. **it remembers where its children came from.** an ordinary hive does not. this is the actual new information, and it rides in slots on the derived layer.

## 1.2 addressing: portable vs local

a call must carry **both** a signature and a location, and they are not interchangeable:

| half | means | portable? |
|---|---|---|
| signature | what it looked like when captured | **yes** — universal |
| location (path segments) | where it lives | **no** — participant-relative |

`/projects/roper` means nothing in someone else's hive. an insight crossing a boundary carries signatures and drops paths. therefore:

- **the identity is the location; the signature is the evidence.** an insight means *these places, and here is what they looked like when i captured them.*
- the **default read is as-it-is-now** (resolve locations), because calling in a branch usually means "that branch, ongoing" — not "those exact bytes". *as-captured* (resolve signatures) is always available.
- any comparison that crosses a participant boundary — the swarm subject in §6 — **must be signature-based, never path-based**.

> **not yet built.** the shipped record stores `calls` as bare layer sigs and the root as a path. that hybrid was accident, not design. dual-addressing is the first change to make.

---

## 2. insights as scope parameters

scope today is always one rooted tree: the tutor takes "the scope cell", website build takes a cell, `sealSubtree` folds one subtree. an insight generalises it without changing the shape of any call site — it is still one sig.

places this pays immediately, all of which exist:

- **the ask screen already builds an anonymous insight and throws it away.** tapping tile chips as targets before submitting *is* selecting branches into a set; it just has no name and cannot be reused. as an insight, every ask becomes nameable, re-runnable and shareable.
- **tutor scope** — one cell today, so a deck cannot span siblings.
- **website page sets**, **adopt selection**, **per-tile sharing** — all naturally set-valued, all currently per-cell or per-tree.

---

## 3. insights as filtered branches (partial reference)

> **design only.** this changes the core composition primitive. do not implement without its own review and test pass.

today a `children` entry is all-or-nothing: the whole subtree or nothing. an insight as a child means a parent can incorporate *part* of another branch — partial reference, the missing piece beside whole-branch reference. this is what makes the tree genuinely carry a hypergraph rather than merely describe one: one node incorporating slices of many others.

merkle integrity survives unchanged. parent sig covers the insight sig, which covers root + calls, which cover their subtrees. transitive coverage holds, so verification is unaffected.

### 3.1 the constraint that makes it tractable

**a filtered branch must resolve to a *layer*.**

if some children resolve to layers and others to a new record kind, every reader must learn to discriminate. that is **117 call sites across 51 files** (`childSigsOf`, `childNamesOf`, `childNamesOfStrict`, `childEntriesOf`, `childrenManifestFor`) — including the renderer's hot path, adopt, paste, host-sync and website-archive. `CHILD_SLOTS` exists precisely so those cannot drift; a second axis of variation would undo it.

so: a filtered branch resolves through `getLayerBySig` to a layer-shaped object (`name`, `children` = the filtered set). the record retains its **provenance** — source sig + filter sig — so it can be re-derived. this is what `materializeLayer` already does: pool-write a derived layer, no marker. **zero readers change.**

### 3.2 the filter

reuse the existing predicate vocabulary — sticky `tags:filter`, pheromones, the hidden pool. do **not** introduce a query language; a second selector language is a second thing to keep correct.

### 3.3 staleness

re-derive in the optimize phase, keyed by `(sourceSig, filterSig)`. source moves ⇒ new sig ⇒ no record ⇒ derive. there is no invalidation logic to get wrong, which is the whole point of the keying direction.

---

## 4. insights as computation input

> **design only — but the substrate already exists.**

`ComputationReceipt` (`hypercomb-core/src/core/computation-receipt.ts`) is already:

```ts
{ inputSignature, functionSignature, outputSignature, timestamp }
```

with routing, receipts and verification around it. what it cannot express is a **set-valued input**: `inputSignature` must be one sig, so the input is one layer or one resource.

an insight is that missing input type. `inputSignature = <insightSig>` lets a computation take *these regions, from anywhere, filtered* — with no new execution model and no change to the receipt shape.

the property that makes it worth doing: `f(insight) → outputSignature` is deterministic, so a receipt is a **verifiable claim anyone can check**, not merely a cache entry.

### 4.1 purity is a precondition, not a nicety

the insight must be the **complete** input. if the function reads anything outside it — a relay, the clock, the participant's other tiles — the receipt is false: same input signature, different output. this is the optimize-phase litmus test again, and it decides which operations may be receipted at all.

the tempting operations (anything AI-shaped) are exactly the impure ones. an unreceipted computation is fine; a *wrong* receipt corrupts the shared record.

### 4.2 received is not runnable

an insight carrying code is arbitrary code execution the moment one is shared. executable insights ride the **same accept gate** as adopted modules. an insight must never become executable by virtue of having arrived.

### 4.3 an insight is not a package (yet)

a package is already a signature plus `bees[]` / `layers[]` / `dependencies[]` signature arrays — structurally the same thing as an insight. it is tempting to collapse them. **resist for now:** they differ in what they *guarantee*. a package must be complete and installable; an insight need not be. same shape, different contract. record the resemblance; do not merge on the strength of it.

---

## 5. insights as a diff basis

two operations that compose, not one:

- **detection is cheap and bounded.** compare *as-captured* signatures against *as-it-is-now* in `O(calls)`. any inequality localises a change to a specific place without walking anything.
- **description is not.** sig inequality says *that* something changed, never *what*. naming the change still means descending and comparing by name.

so an insight narrows the search to the regions worth reading; name-based comparison explains them. insights make the expensive operation **rare**, they do not replace it.

this is the right shape for handing an agent bounded context: *here are the four regions that moved*, rather than the whole hive.

---

## 6. insights as the swarm subject

> **design only.** supersedes the framing of the swarm gate as admission control.

the naive reading is a gate: the host holds a standard, the joiner conforms. the better reading is **joint attention** — a swarm is an insight plus the people examining it. same mechanism, and it answers a question admission control does not: *what do the people in this swarm actually have in common?*

three consequences, all improvements over the gate reading:

1. **the check runs both ways.** if it is a barrier, only the joiner is tested; if it is a shared subject, the host must still hold it too. otherwise the swarm quietly loses the thing it was about and no one finds out. a one-way check cannot detect that.

2. **divergence is the interesting event, not an error.** if your copy of the subject no longer matches mine, that is the most informative thing the system could report — *we are no longer looking at the same thing here*. surface it; do not reject on it.

3. **membership and coherence are two different questions**, and each takes a different answer:

| question | rule |
|---|---|
| may i join? | **contains-at-least** — hold the insight's places; everything else you have built is your own |
| are we still aligned? | **exact** — within the insight, signatures must match, or that is divergence to surface |

this is structural conformance in the type-system sense: you conform by *having* the shape, not by declaring you do, and extra members are expected. the check is `O(calls)` signature comparisons — not a tree walk.

**keep the required shape small.** a foundation specifying a full hierarchy produces a monoculture and excludes participants whose hives are legitimately organised differently. the gate's job is to prevent incompatible roots, not to enforce a filing system.

---

## 7. vocabulary

| word | means |
|---|---|
| **insight** | the artifact: a named, PARTIAL capture — pieces from anywhere. *in-sight*: what participants look into together |
| **hive** | a named, COMPLETE branch — `/hive <name>` from any location in the tree |
| **foundation** | an insight a swarm requires you to match (beekeeping: the wax sheet that keeps comb uniform) |
| **waggle** | publishing an insight to the swarm: *here is where to go* |

candidates considered and rejected as the name of the artifact (the survivor is **insight**, on the strength of *hives are full, insights are partial*), each for the same reason — they name a relationship, an act, or a route, never a bounded object:

- **dna fragment** — `dna` is already [Distributed Network Artifacts](dna.md) here, and an insight is a *shape*, not a sequence
- **interests** — a psychological state; also collides with pheromones, which already own affinity
- **stream** — unbounded and time-ordered where an insight is bounded and enumerable; also heavily used (`streamCells`, `streamActive`) in the renderer and `MediaStream` in meeting
- **path** — load-bearing for lineage segments; and a path is linear where an insight is a set
- **interface** — semantically the best fit for §6 (structural, contains-at-least) but a TypeScript keyword with 395 occurrences across 151 files. **keep it as the explanation, not the identifier:** *a foundation is a structural interface for a swarm — contain this shape and you are in.*

---

## 8. sequencing

nothing downstream should be built before these, in order:

1. **move the insight record out of `presentation/`.** it lives in `presentation/tiles/tree-insight.ts` because that is where it was born. a scope parameter and a swarm primitive cannot live in a rendering folder — tutor, website build, adopt and the bridge would all be importing through it.
2. **dual-address the calls** (§1.1), with the portable/local split marked in the record rather than implied.
3. **run the tree view against a real hive.** it has been verified only against synthetic data and an empty dev hive. walk cost, icon cost and insight ergonomics will show there and nowhere else.
4. then, independently: filtered branches (§3), computation input (§4), swarm subject (§6).

---

## 9. open questions

- **does an insight's root belong in `calls`?** today it is separate. if the root is just another call, membership and coherence get one rule instead of two.
- **can an insight call another insight?** the record permits it (a sig is a sig), but nothing checks for cycles. either forbid it or bound the expansion depth.
- **who owns a published insight's name?** names are local today. a swarm subject needs a name participants agree on, which is a different namespace question.
- **what happens to an insight whose called sig is unreachable** — cold, or never synced? membership cannot be decided from absence. this needs the same "cannot see ≠ confirmed absent" discipline the strict child reads already use.
