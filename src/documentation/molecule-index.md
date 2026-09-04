# The molecule index — a hive's declared vocabulary, derived

**Status: built, and additive.** Nothing migrates, nothing is deleted, the write
path is unchanged, and lineage bags remain the truth. This is a **derived
index**: recomputable from layers that already exist, so if it is wrong, stale
or wiped, the correct response is to recompute it and nothing else in the system
may depend on it.

Companions: `address-syntax.md` (the convention, now executable in
`hypercomb-core/src/core/molecule-address.ts`), `hypergraph-molecule-lineage.md`
(the model), `optimize-phase.md` (the contract this obeys).

---

## What it is for

Say a word, hash it, ask your hosts. That needs `sign(fold(canon(name)))` to
have content, and the content already exists — it is the names of tiles that are
already committed. The index is the fold of those names into the addresses they
reach, so "can this hive say that word?" is a hash and a map lookup rather than
a walk.

## The pieces

| file | what it is |
|---|---|
| `hypercomb-core/src/core/lineage-key.ts` | the canon rule, MOVED here from essentials so the colon theorem and the code that asserts it live in one package |
| `hypercomb-core/src/core/molecule-address.ts` | `fold`, `moleculeKey`, `moleculeAddress`, `facetPreimage`, `facetAddress`, `validatePoolSpelling` |
| `hypercomb-core/src/core/pool-kinds.ts` | the four kinds as a decoration keyed by meaning — advisory, never authoritative |
| `hypercomb-core/src/core/reference-rule.ts` | the saved-rule atom, its validator, and the byte-stable payload append |
| `hypercomb-essentials/src/molecule/` | the record, the reader service, the optimize-phase bee |
| `hypercomb-essentials/src/references/reference-evaluator.ts` | the local evaluator — no UI, no shell surface |

## The record

`sign('molecule:index')`, keyed by the **source layer signature**:

```ts
type MoleculeWord   = { a: string; n: string; c: number }   // address, a spelling, count
type MoleculeRecord = { v: 1; words: MoleculeWord[]; truncated?: boolean }
```

`derive(S) = ⋃ over manifest(S) of ( {address(child.name)} ∪ derive(child.sig) )`

Composition, not traversal: a child that already has a record is spliced in
whole and never descended into. The union is idempotent, so a record is bounded
by the **distinct vocabulary** of a subtree rather than by its tile count.

**Reject-on-read is the invalidation.** `MOLECULE_DERIVATION` is written on every
derive and checked on every read; bumping it turns every prior record into a
miss and the phase re-mints. No migration, no sweep, no pass over old records.

## What was deliberately cut, and why

- **No bytes are written at a molecule address.** `GET /<sign(word)>/` needs
  content AT that address, and placement is a publish act — truth, forbidden by
  the fourth line of the derived-cache contract. What the phase can honestly
  produce is the **declaration**: `declaredVocabulary()`. A host may declare what
  it holds; it may never place anything in your world.
- **No record is ever keyed by a molecule address.** Keying by a name violates
  the first line of the contract. The index is keyed by a layer sig and
  *contains* addresses; it is never addressed by one.
- **No layer signatures in a record.** `referencesOutside` credits every 64-hex
  string in a pool member's bytes, so a record naming member sigs would pin
  those layers against prune — and a cache that changes what the collector keeps
  is not wipe-safe. The address answers *whether*; the search records already
  answer *where*, and they are the ones allowed to hold sigs.
- **No backfill pass and no boot-time pass.** The phase runs only from
  `hypercomb.act()`'s `finally` — scheduled with a 2s idle *timeout*, so it
  fires during boot whether the browser is idle or not, and the processor awaits
  every bee's `optimize()` serially with no deadline. `optimize()` therefore
  returns immediately when nothing was committed. The one exception is a
  **repair**: a root record that already exists and admits it is `truncated` is
  re-derived once per session. An *absent* record is left absent — that is a
  cold pool, not a damaged one, and the cold path answers it correctly.
- **Complete-or-absent, enforced at the child write.** A child record is keyed
  by the child's real layer sig and a sig's record can never go stale, so there
  is no refresh path and the first record written for a sig is its record
  forever. A truncated or empty one is therefore not slower, it is permanently
  *wrong*. So the depth cap returns `null` rather than an empty record (a record
  must be a pure function of the sig that keys it, not of where the walk
  arrived), a null child sets `truncated` on the parent, and only a complete
  child is written.
- **Minting is not on the registered surface.** IoC carries `moleculeIndexReader()`
  — the read half. `derive` and `writeRecord` stay on the class the bee
  constructs for itself, so a recursive subtree walk plus one pool write per node
  is unreachable from a render or keystroke path by construction.

## Cold-path equivalence, proved not asserted

`MoleculeIndexService.fallbackVocabulary()` **walks the children manifests** from
the head layer and folds the names through the same `moleculeAddress` the
deriver uses. One rule, one input, applied twice — which is what makes
"identical results, only slower" a theorem.

It used to fold `HiveSearchService.vocabulary()` instead, and that was not a cold
path at all: the search reader is a record out of `sign('search:index')` that
returns an empty map on a miss and never derives. Both pools are declared `index`
kind — *recomputable, wipe-safe, GC-able* — so wiping both, which is exactly what
that licenses, left the hive able to say **nothing**. The cold path must reach
the layers or the equivalence claim is circular.

A `truncated` root record no longer suppresses it either: `declaredVocabulary()`
trusts an index record alone only when it is complete, and otherwise falls
through to the walk and unions with it. `declaredVocabularyPartial()` surfaces
the flag the way `HiveSearchService` surfaces its own — "no" and "I could not
finish looking" are not the same fact.

`molecule-index.cold-path.spec.ts` builds a fixture hive, warms the index, wipes
**only** the `molecule:index` pool (single named entries, never recursively,
never real OPFS or localStorage) and asserts:

- `declaredVocabulary()` is the same set warm and cold
- `holds(word)` is true for every word, warm and cold
- re-deriving after a wipe produces byte-identical records
- the reader never opens a handle with `create: true`
- a bumped derivation version reads back as a miss

**Nothing differs cold any more, including the count.** The per-word count `c`
used to under-report cold, because the search reader had already collapsed its
rows by lowercased name — `People` and `people` were two occurrences warm and one
cold. The walk reads the same manifests the deriver reads, so the count agrees as
well as the membership; the spec asserts `c === 2` on both sides. *(A count is
still ranking data and nothing may branch on it.)*

**A record is validated element by element on read.** `readableRecord` checks the
derivation version and the array, and then every entry: the address must be a
64-hex molecule address, the display spelling must not itself be 64-hex (or it
would be credited against prune as a content reference), and the word list is
capped on read as well as on write. A malformed element is *dropped and the
record marked truncated* — never thrown on. A wipe-safe cache may be missing or
stale; it may never be the thing that breaks a read path.

## Pool kinds

Four kinds — set / index / document / succession — stored as a decoration keyed
by the pool's **meaning** and reached by address, so changing a kind never
re-addresses anything. They live in code beside the registry that already grants
meanings, because a kind is a *declaration by the code that mints the pool*: not
derivable from layers (so the phase may not mint it) and not a participant act
(so it is not truth to commit).

**Advisory for reading, never authoritative for a delete.** A record that
arrived over the wire gets no vote on destroying bytes. `pool-kinds.ts` does not
import `directory-safety.js`; nothing in `directory-safety.ts` names anything in
`pool-kinds.ts`; and no destruction primitive takes a kind, so a caller cannot
pass one. `pool-kinds.spec.ts` runs all four kinds against all six exported
guards over fixtures each guard refuses, asserting the verdicts are
byte-identical to the no-record run.

## The reference rule

A reference is an aggregation expressed as a rule — source, predicate, scope,
projection, order — signed as an ordinary atom. **The rule is truth; the result
is derived**, recomputed on demand and never committed: a committed result would
mean every tag change needed a commit, and two participants with different reach
would have signed different answers to the same question.

- A hand-picked list is the **degenerate case** of a rule (`{ signatures: [...] }`),
  so there is one mechanism, not two. It is also, by construction, an **alias
  reference** — it carries addressing and leaks structure — so it is never
  shareable, and the validator *rejects* the contradiction of a hand-picked
  source aimed past `audience: mine` rather than reporting it as a flag a caller
  can ignore.
- **Scope is two orthogonal axes and both are required from the start.** `reach`
  is topological (`local | children | global`, the vocabulary already shipped in
  the tag filter); `audience` is whose things (`mine | hosts | community`), and
  it is what decides shareability. A rule with no scope is refused, not
  defaulted: retrofitting one later leaves every existing reference ambiguous
  forever.
- **Order lives on the mark**, never as a second field: `by: 'mark'` is the
  authored enrolment position, location path as the tiebreak, unplaced last.
- The evaluator takes **ports**, reads marks through the declared union seam
  (`PheromoneMarks.marksOf` — location marks ∪ sig marks), memoises in-session
  only against the tree epoch, writes to no pool, and **emits nothing** — pushing
  a rule's predicate onto the participant's tag lens would overwrite a sticky
  filter and surface as a toggleable chip, which is not relaxing a filter but
  editing the reference.
- An audience beyond `mine` with no host transport returns the local answer
  flagged `partial`. Declared in the type, honest at runtime, never silently
  stubbed — a caller that ignores `partial` shows a team page containing only its
  own things and reads it as complete.
- **The audience is enforced, not merely recorded.** The source port is handed
  the whole `scope`, not just the reach, so a source *can* honour it; and
  `ReferenceCandidate` carries `origin` — the host that answered for a row,
  absent for this hive's own — so the evaluator can drop a stranger from an
  audience-`mine` rule and say the answer was partial. Without that field the
  scope was undecidable on the data the evaluator had, and adding it later is the
  retrofit this design refused for `scope` itself.
- **The predicate fails closed.** A mark read that *throws* is not "this thing
  carries no marks" — it used to be caught as `[]`, which turned a `none`
  exclusion into a no-op and returned the rows it was meant to exclude. A
  candidate whose marks could not be read is excluded and the answer says
  `partial`. Likewise a bouquet that cannot be resolved narrows to **nothing**;
  it used to lose the whole restriction and return every candidate, which is the
  complement of the rule's answer rather than a subset of it.
- **Host names in a rule are validated where they are still data.** A rule with
  `audience: hosts` is shareable, so one that arrives from a peer names the hosts
  *this* client will reach. `isReachableHostName` keeps DNS names and drops
  schemes, paths and IP literals (`169.254.169.254`, `javascript:alert(1)`,
  `../../etc`); a rule whose named hosts are all unusable is refused with a
  reason, because an empty host list is not the same fact as `mine`.
- **`buildReferenceRulePayload` throws on a refused rule** instead of returning
  the base payload. Dropping the rule silently produced an *unscoped* reference —
  the shape the existing reader accepts — so the contradiction the module refuses
  would have been committed as a reference with no audience at all.

## Pool kinds — first declaration wins, and the seed is the first declaration

`declarePoolKind` seeds before it checks. Without that the winner was whoever
imported earliest: a module declaring at import time saw an empty map, took the
slot, and the seed then declined to overwrite it — turning `roots` (succession,
"never touch another author's bucket") into a `document` ("replaces siblings") by
module-graph accident. The destruction verdicts never moved either way, because
`directory-safety.ts` does not know kinds exist, but a reader would have been
wrong about a participant's own history bag.

## Registration still owed

`hypercomb-essentials/src/side-effects.ts` needs one line beside the
search-index import:

```ts
import './molecule/molecule-index.drone.js'
```

Until it lands the bee is never constructed, never registers, and its
`optimize()` is never called — silently, because the phase swallows everything.
The reader is correct without it (the cold path is the answer); it is only
slower.
