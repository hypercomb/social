# The signed vocabulary claim

*Say a word, hash it, ask your hosts — with honest absence.*

`molecule-index.md` states the gap plainly:

> NOTHING is ever placed AT a molecule address. Placement is a publish act;
> this is only the declaration.

So a hive can DERIVE which words it holds, and nothing else can see it.
Cross-host search is not reachable. This closes that gap with a **publish**,
never by serving the derived cache — serving `sign('molecule:index')` would
make search rest on a wipe-safe, GC-able record that nobody may depend on, and
an empty answer would then mean either *"nobody said anything"* or *"that host
has not recomputed yet"*. Those two must never be confusable.

---

## 1. What is signed

Eight lines, `\n`-joined, no trailing newline. Every field is lowercase hex,
`-`, or digits, so no field can contain the delimiter and no escaping rule can
ever be needed — `headClaimPreimage`'s argument, restated rather than
re-derived.

```
hc:molecule-vocabulary:v1
<pubkey>      64 hex   the key the reader ASKED FOR, and the verifying key
<surface>     64 hex   the door the reader OPENED — sign('vocabulary:hive')
<body>        64 hex   sha256 of the canonical vocabulary atom
<prev | "-">  64 hex   the previous claim's body sig, or "-" at genesis
<seq>         digits   the ONLY recency axis
<count>       digits   how many addresses the body holds
<complete>    1 | 0    1 iff the publisher's own picture was whole
```

| line | what it defeats |
|---|---|
| 1 | **Signature harvesting.** The same key already signs kind-30564 hive indexes, kind-27235 NIP-98 headers and kind-30565 head claims. A signature lifted from any of them renders a different string here. `:v1` lets a `:v2` exist while this verifier *refuses* rather than mis-parses. |
| 2 | **A valid claim served at the wrong address.** Rendered by the READER from the key it walked to, never parsed out of the bytes. A genuine claim by A, served when the reader asked for B, renders a string that never verifies. There is no `declared === askedFor` comparison for a refactor to delete, because nothing is declared. |
| 3 | Nothing *today* — there is exactly one surface. It is the namespace hinge that lets a second surface exist later; adding a line afterwards would change every signature ever minted. One line now, or a migration later. |
| 4 | **A padded word list and a truncated one, in one field.** The preimage's fixed alphabet forbids embedding a variable list, so the claim commits to `sha256(bodyBytes)`. A host can *withhold* the body; it can never edit it under a valid signature. |
| 5 | **Re-parenting** a genuine claim. |
| 6 | **A replayed older claim.** `seq`, not a clock: it needs no clock to be right, cannot be raised without the secret, and a mis-clocked device can never set a permanent freshness floor against its own key. A signature proves authorship and **never** recency. **Bounded at `MAX_CLAIM_SEQ` (1e9)** — an unbounded counter was a one-shot unrecoverable publish DoS: a host serving `MAX_SAFE_INTEGER - 1` got the participant to sign `MAX_SAFE_INTEGER`, which went into the permanent local ledger, after which every plan was past the reader's own shape gate and that device could never publish again. |
| 7 | Bounds the body fetch *before* it starts. Redundant once line 4 is checked — duplicated on purpose, the same note `head-map.ts` puts on `refs`. |
| 8 | Makes an absence mintable at all. See §4. |

### The body atom

```json
{"kind":"hypercomb.vocabulary","v":1,"pubkey":"<64hex>","words":["<64hex>",…]}
```

Built by string concatenation from arrays only, deduped and sorted ascending.
`encodeVocabularyBody` **throws** on a non-canonical record; `parseVocabularyBody`
re-encodes and demands byte equality, so reordered words, a duplicate, added
whitespace, an unknown field or `v: 2` all refuse rather than mis-read.

**No display spellings and no counts** — a deliberate subtraction from
`MoleculeWord` `{a, n, c}`:

* `n` is attacker-chosen TEXT that a reader would render next to a word. The
  reader already has the word it typed. Dropping it means this surface cannot
  inject a single non-hex byte into a reader's UI.
* `c` is ranking data (`molecule-index.ts` already says nothing may branch on
  it). A signed count from a stranger is a sybil-weighting lever aimed at a
  routing table.
* With only hex in the array, the fixed-literal encoding needs no escaping.

A body is **entirely molecule addresses** — directory addresses with no bytes
behind them. `words` must never be registered in `core/edge-registry.ts`: a
closure walker descending them is a permanent 404 cascade.

---

## 2. Publishing is an act

`publishVocabulary(options, deps)` is the only door, and it refuses unless
`options.confirmed === true` — **a required argument with no default**, so a
caller cannot omit consent by forgetting a parameter. It then shows the
participant the word count, the exact branch list and the completeness bit, and
requires a confirmation. `withdrawVocabulary` is a **second, distinct verb**
that signs an empty `complete: 1` claim at seq+1, because nothing may be
inferred from absence and *"I publish"* and *"I retract"* must never be
reachable by the same accidental call.

### The mint order is load-bearing

`HostSyncService` auto-enqueues every `content:wrote` sig and drains at module
load, at +20s and on an interval. **Minting is uploading.** So nothing reaches
`putResource` or `markPublic` until the confirmation returns true — everything
before that line is a read (the word set, the canonical body text, its hash).
The obvious optimisation, *"precompute the claim so the confirmation can show
its size"*, is the one that breaks this, and `vocabulary-publish.spec.ts` fails
if anyone takes it.

**And the line is not "every write", it is "every irreversible step".** Two deps
that *look* like reads are effects on the world, and both used to run before the
participant was asked:

* `publicKey` → `readerPubkey()` → `resolveSecretKeyHex()`, which **mints and
  persists** a secp256k1 secret on a miss. A participant who opened the dialog
  and said *no* walked away holding a signing identity they declined — the exact
  hazard `nostr-signer.ts` documents against itself, worse here because a claim
  key carries write authority. `publishedKeys` reached it too; it now uses the
  non-minting `cachedPubkey()`.
* `readHeld` → `fetchHiveIndex` + a second `fetch`: the participant's public
  key, IP and publishing intent handed to a standing public endpoint. Declining
  cannot un-send that.

Both existed only to render `seq` in the dialog. `summary.seq` is `null` now and
the anti-rollback plan is computed after consent — it is needed to *sign*, not
to *ask*. `vocabulary-publish.accidental.spec.ts` spies the READ half too, which
is what the original spy log could not see.

**`readHeld` also verifies before it believes.** It used to check only the
atom's hash — "the worst a lie can buy is a gap in my own sequence" — which was
wrong twice: `prev` from a host is *signed into my real claim* (line 5 exists
precisely so a genuine claim cannot be re-parented, and an invented `prev` gets
me to re-parent it myself), and `seq` is signed *and* written to my permanent
ledger. It now runs `acceptVocabularyClaim` against my own key and surface. A
publisher must never sign a counter or a parent it did not derive from something
authenticated.

### Every automatic trigger, and why none is used

| trigger | why not |
|---|---|
| `optimize()` | Called from `act()`'s `finally` on a 2s idle timeout, serially, swallowing throws — it fires during boot whether idle or not. Anything there is unattributable. |
| `content:wrote` | Fires on every layer commit. A handler that published would make publishing a side effect of a commit. |
| `publishBranch` | A branch publish and a vocabulary publish are two acts. Note `publishBranch` is *not* scope-neutral — it sets the branch's public mark and enables the public host — which is why this routine only ever READS that mark. |
| `publish-status.drone` refresh | Read-only on `history:head-changed`, `navigate`, `share:receipt-revoked`. Stays so. |
| `domain:learned` → `probeDomain` | Fine for READING; never a write trigger. |
| HostSync auto-drain / swarm `markPublic` | Those move BYTES once a gate is on. The claim atom becomes public only inside the act. |
| **bridge `branch-public`** | **The second real hole, and the more subtle one.** The op called `setBranchPublic()` with no gesture at all. `hc:public-branches` is not merely a panel row — it is the SCOPE INPUT of this claim, so an agent driving the bridge could choose which subtrees a later, properly confirmed publish declares, while the confirmation still said the participant chose. The op is now **read-only**: it returns the marks and refuses any attempt to set one. |
| **bridge `hive-root-set`** | **This was a real hole.** `claude-bridge.worker.ts` advances the signed index with no gesture at all and refused only *colon-less* keys — `vocabulary:hive` carries a colon, so it would have been remotely settable the moment the key existed. Closed as DATA: `BRIDGE_FORBIDDEN_ROOT_KEYS` in `sharing/hive-link.ts`, checked beside the colon test. |

### The scope model: per published subtree

Not per-word, not all-or-nothing.

* all-or-nothing is the wide default the constraint forbids;
* per-word needs a registry of up to 8000 toggles, a second thing to keep in
  agreement with the tree, and a participant who has to *find* a setting before
  their words are private;
* per-subtree **already exists** as `hc:public-branches`, **already** defaults
  to nothing-public, and is already how a participant says "this branch is
  shareable".

**The invariant that makes it safe:** the claim may only ever name words already
reachable in published bytes. The body is derived from published subtree heads,
and the published set is the public-branch marks **intersected with the publish
ledger** — a branch marked public but never actually served would otherwise mint
a route to bytes no host holds. Holding a word privately is the default, and a
participant reaches it by doing nothing.

**The second invariant, and it is the one that was broken:** *a branch that
contributes fewer than all of its reachable words CLEARS `complete`.* A
publisher that signs `complete: true` over a picture it knows is narrower mints
the wrong NO at the source, correctly signed, where no amount of reader-side
rigour can catch it. Four triggers, and the first two were live defects:

1. **The ledger intersection dropped a branch silently.** `publish-heads.ts`
   describes its own pool as *"a floor, never a ceiling: it cannot know about
   branches published from another device"* — so a branch that really is
   published and really is served is dropped here, and the claim was signed
   `complete: true` anyway. It now says so. The `published.size > 0` escape is
   gone too: an empty or unreadable ledger used to disable the intersection
   entirely, which is fail-open on exactly the device (fresh, wiped) where it is
   most likely.
2. **The branch's own name was never declared.** A record is the fold over a
   layer's CHILDREN manifest, so publishing `/business` declared `invoices` and
   `clients` and never `business` — the single most likely search term for the
   branch, and one any visitor reads straight off the route. The last segment is
   now folded in. Only the last: the ancestors on the path are not themselves
   public.
3. a missing head, or a subtree vocabulary that could not be assembled;
4. a `truncated` record.

**And the derived index is an accelerator, never a dependency.** The publish
used to call the raw pool reader, which by its own docstring *never derives*.
`sign('molecule:index')` is declared `index` kind — recomputable, wipe-safe,
GC-able, and a collector is *licensed* to empty it — so a wipe turned a
publishable claim into a refusal, which is a different ANSWER and not a slower
one. It now calls `MoleculeIndexReader.subtreeVocabulary`, the branch-scoped
form of the same cold walk `fallbackVocabulary` already proved for the root:
identical, only slower.

**The record's own filename is a layer signature, and the collector must not
credit it.** `MoleculeIndexService.writeRecord` names each member by the sig it
derives from — that IS the invalidation rule — while
`HistoryService.referencesOutside` credits member NAMES, for the good reason
that `SubstrateService.addReference` writes an empty file named by an image's
signature. Both are right; the rule that reconciles them is
`poolCreditsMemberNames`, in `core/pool-kinds.ts`: a **wipe-safe** pool's member
names are not references (its bytes still are, conservatively), and undeclared
is not wipe-safe. Without it, minting the cache changed what prune keeps —
precisely the load-bearing derived cache `optimize-phase.md` rule 3 forbids. In
the same pass the display spelling is sanitised **at the writer**: a tile named
`backup <sig>` used to put that signature in the record bytes (and, via
`absorb`, in every ancestor record) and pin it against the collector.

The confirmation copy is load-bearing: `isCellPublic` prefix-descends, so
marking `/work` public declares every descendant NAME, and a molecule address is
sha256 of a short public string that a dictionary inverts. The prompt says that
tile names in those subtrees become publicly derivable — not "publish your
vocabulary", which sounds like a setting.

---

## 3. How a host serves it

### The real contract — five host kinds, not three

`documentation/hosting-from-a-machine.md` lists three and omits the R2 worker.

| shape | relay | R2 worker | shim `serve.mjs` | native `hypercomb-serve` | static Pages / bucket |
|---|---|---|---|---|---|
| `GET /<sig>` (a file) | yes | yes | yes | yes | yes |
| `GET /<sigDir>/<name>` | yes | **NO** | yes | yes | yes |
| `GET /<poolSig>/` (listing) | yes | **NO** | **NO** | **NO** | `index.html` only |
| `GET /hive/<pubkey>` (pointer) | **NO** | **YES** | file only | **NO** | file only |

Two corrections worth writing down:

* **`/hive/<pubkey>` is implemented in exactly one server** — `blossom-worker/worker.js`. `relay.js` has no `/hive/` route at all; the native host routes `["hive", pubkey]` through its `[dir, entry] if is_sig(dir)` arm, `"hive"` is not a sig, and it 404s. `serve.mjs` and a bucket serve it only if a file is shipped at that path.
* **`pools-across-hosts.md`'s "BOTH BUILT 2026-09-03"** is true for `relay.js`'s directory branch and the static ship only. The shim host, the native host and the R2 worker all still 404 a pool URL — and the worker is *actively wrong* rather than merely absent: `GET /<pool>/<member>` matches its sig route with `named=true` and looks the blob up at the POOL signature, discarding the member name.

### Where the claim lives

```
GET /hive/<pubkey>   → verified index → roots['vocabulary:hive'] = <claimSig>
GET /<claimSig>      → the signed event bytes; hash-checked against the sig
GET /<bodySig>       → the canonical word atom; hash-checked against line 4
```

This is exactly the `format:hive` shape and invents nothing. It **must** be a
reserved KEY pointing at a sig, never an inline field and never an inline word
list, for two hard reasons: `putHiveManifest` re-serializes `{v, roots}`, so a
sibling top-level field is erased by the very next publish from any client
including an older one; and a roots VALUE that is not 64-hex makes
`fetchHiveIndex` reject the WHOLE index as malformed, which would unpublish
every branch for every reader. The reservation is structural, not an allowlist:
`lineageKey` folds every non-letter/digit to `-`, so no tile name can produce a
key containing `:`.

The write is one `setHiveRoot(host, 'vocabulary:hive', claimSig)` call, which
already carries the full safety set (404-only empty baseline, refuse-on-
unreadable, one-key merge, unchanged no-op) and takes injectable deps.

**The two atoms that carry all the verifiable content are sig-named files, so
they are reachable on all five host kinds with zero host changes.** Only the
pointer is worker-only, and it is the same door every existing publish already
writes through (`resolveIndexDoor` → branch `host:<zone>` marks →
`PUBLIC_CONTENT_HOSTS`).

### The static fallback, stated plainly

A static host cannot list a directory and cannot accept a PUT, so it has **no
live pointer**. Its fallback is what the ship already does for pools: write the
answer as a file at deploy time — ship the signed kind-30564 event as
`hive/<pubkey>`. `serve.mjs` (a real file wins, always) and Pages both serve it,
and the `_redirects` `/* /index.html 200` rule only fires on a genuine miss, so
it survives the SPA rewrite. No ship writes one today; until one does, a static
host answers **unknown**, never a wrong **absent**.

A static pointer is **frozen at deploy**, which is exactly why the `seq` axis is
load-bearing rather than decorative: a frozen index yields an authentic *old*
claim, which the reader ranks against every other door and against its own
proven high-water, and it degrades to `unknown/'regressed'`.

### Wire traps

* `relay.js` tests `/[a-f0-9]{64}/i` **unanchored** and pins the match
  `immutable` for a year. Correct for the claim and body atoms (immutable by
  construction) — and the reason a claim must be a **new hash-named atom every
  publish** rather than a rewritten member name.
* `_headers` applies `max-age=31536000, immutable` to `/content/*`, which covers
  `/content/<pool>/index.html` — the opposite of the `no-store` a directory is
  contracted to have. A static host's membership can be a year stale with no
  signal. This design does not depend on a listing.
* `check-host.mjs` never requests `/<pool>/` or `/hive/<pubkey>`. A host can
  print `HOST OK` and be unable to answer a vocabulary query.

---

## 4. Search, with honest absence

### The defect being prevented, named

`hypercomb-runtime/src/host-packages.ts` says it in writing: a host that
*"publishes nothing, that cannot be reached, or that is not a host at all — the
three are deliberately one outcome here."* `findPool` returns null for all
three; `listHostPackages` returns `[]`. There is no status field in those types,
so there is no channel to carry UNKNOWN at all.

### Four structural properties, none of them documentary

1. `why` is `VocabularyUnknown | null` under the invariant
   `(verdict === 'unknown') === (why !== null)`, enforced in the **only three
   constructors** that build a finding. You cannot mint an `unknown` without
   naming what stopped you, or an `absent` while naming one.
2. `VocabularySearch` carries **exactly two fields** — `{address, findings}`.
   No `declared: string[]`, no `hosts`, no `count`. Every convenience field is a
   place a `.length === 0` becomes "nobody has it".
3. **The row set is fixed before any I/O.** One row per publisher, built before
   a socket opens; I/O only fills verdicts in. A dead host, a blown deadline or
   a thrown fetch changes a row and can never delete one, so **an answer can
   never shrink into an absence**.
4. `absent` is minted in exactly one place — core's `membershipOf` — and the
   `absent` finding **carries the verified claim it was derived from**, so no
   code path can construct an absence without holding the evidence.

### The verdicts

| verdict | meaning |
|---|---|
| `declared` | The word was present in a verified body at the highest seq that named it. A **partial** claim that names the word is still a positive. |
| `absent` | A claim whose **signed `complete` is true** omits the word, at a seq strictly higher than any claim that named it — **and it must be the CURRENT generation**. The only way "no" is ever minted. |
| `unknown` + `why` | Everything else. |

`VocabularyUnknown` keeps the grades of not-knowing apart: `no-key`,
`unreachable`, `no-index` (the host **asserted** 404), `no-claim` (a *verified*
index naming no vocabulary root), `index-unsafe` (malformed/forged),
`claim-absent`, `unsigned`, `malformed`, `body-absent`, `body-mismatch`,
`partial`, `regressed`, `superseded`. `no-claim` is a **proven** unknown — "I
answer no vocabulary questions" is a different fact from "I do not hold that
word" — and neither is an absence.

#### Only the current generation speaks

`membershipOf` now takes the highest **authentic** seq the reader saw and drops
every observation from a lower one. Without it a stale door minted the answer:

* door A (stale, or merely a slow replica) serves generation 0, complete, no
  `coffee`, body available;
* door B (honest, current) serves generation 1, complete, *has* `coffee`, body
  not yet replicated.

The reader holds an authentic seq-1 claim and folded generation 0 anyway →
**`absent` for a word the hive genuinely declares**, with evidence the reader
itself knew was superseded. The mirror is as bad: a withdrawal defeated by
withholding one atom. `provenSeq` does not save it — the regression gate is
`winner.seq < proven`, and here they are equal.

Bytes reach a reader by REPLICATION, so "the current claim verified, its body
has not arrived yet" is the ordinary state of this architecture, not an attack.
The verdict is now `unknown` carrying that door's own reason (`body-absent` /
`body-mismatch`), and the `absent` constructor additionally refuses evidence
below the current seq — `superseded` — so the bug is unrepresentable rather than
merely fixed.

### Verification order

```
0. SHAPE       pure, local, no I/O
1. SIGNATURE   ONE call, and it is ALSO the placement check. Runs before every
               policy branch, so a hostile host cannot make a reader download a
               megabyte by serving an unsigned claim.
2. REGRESSION  against the reader's own proven high-water → 'regressed'
3. BODY        fetch, hash-check, refuse-or-parse, compare count and pubkey
4. MEMBERSHIP  membershipOf, one fold — over the CURRENT GENERATION ONLY
```

**Rank across doors, never first-wins.** `fetchHiveManifestFromAny` takes the
first verified index, which would let one replaying door decide. Every door is
asked concurrently, every authentic claim is kept, and `resolveVocabularyClaim`
picks the winner (highest seq, ties by smallest body sig — total, deterministic,
reader-derived). A replay succeeds only if *every* reachable door replays the
same old claim **and** the reader has never seen newer.

`fetchHiveIndex`, never `fetchHiveManifest` — the former returns the four states
unconflated, the latter collapses them to null.

**Never `readerPubkey()` on a read path.** It falls through to
`resolveSecretKeyHex()`, which mints and persists a fresh secret on a miss, so a
read-only visitor asking "who declares this word?" would silently become an
author. Search needs no key at all: verification is always against the
claimant's key.

### Deadlines

| | ms |
|---|---|
| one index read | 2 500 |
| one atom fetch | 4 000 |
| one publisher's leg | 8 000 |
| the whole search | 10 000 |

Every leg is wrapped in `byDeadline` (`link/deadline.ts`), whose header already
states the rationale: `fetch` has no timeout of its own, and a stall is worse
than a failure. Fan-out over publishers is concurrent; doors within a publisher
are concurrent. Nothing is sequential — the existing sequential shape multiplies
stalls badly (`findPool` walks four bases in series, each adding up to ~18 more
bare fetches, with no deadline anywhere).

### The five attacks, answered

| attack | answer |
|---|---|
| valid claim at the wrong address | line 2 is rendered by the reader → `unknown/'unsigned'` |
| replayed old claim | line 6 `seq` + rank-across-doors + proven high-water → `unknown/'regressed'`. **Kept**, never discarded: discarding is what let a host pin a reader to whichever generation it chose. |
| padded word list | line 4 → `unknown/'body-mismatch'` |
| omitted words | truncation also breaks line 4, so a host can only omit by serving an OLDER claim (→ replay) or by withholding the body (→ `unknown/'body-absent'`) |
| host that never answers | deadline → `unknown/'unreachable'`, on a row created before the request was made |

---

## 5. Trust boundary, and the residual risk

The claim authenticates the **publisher's assertion about their own
vocabulary**. It does not, and cannot, prove the assertion true. A publisher who
signs `complete: 1` over a list they know is short is lying about themselves —
the same and only trust `resolveBucketHead` extends to a bucket owner. The HOST
is trusted for nothing.

**The one wrong answer this design can produce:** a cold reader with no proven
high-water, whose only reachable door serves a genuine older `complete: 1`
claim, gets `absent` for a word the publisher has since added. It is a wrong
NEGATIVE — a missed result, never a false one. Mitigated by ranking across every
door concurrently rather than first-wins, and by persisting the proven seq the
moment any door answers. It cannot be eliminated: a signature proves authorship
and never recency, and a reader with no memory and one lying door has no
evidence to weigh.

Other honest limits:

* **Per-word privacy is not offered.** A participant who published `/business`
  cannot hold back the word `salary` without a second registry. Accepted,
  because the word is already reachable in the published bytes.
* **Size.** 8000 addresses is ~536 KB of body per publisher, fetched per search.
  The signed `count` bounds it before the fetch and the deadline caps it. A
  cache keyed by body sig (immutable by construction) is the obvious follow-up
  and is deliberately not in this design — honest absence must keep working with
  it absent.
* **The ledger pins atoms against prune, deliberately.** `sigsReferencedOutside`
  credits every 64-hex string in a pool member's bytes, so the
  `vocabulary:published` record naming `claimSig`/`bodySig` pins *my own*
  published atoms — which is correct. The reader's `vocabulary:seen` record
  therefore holds only `{at, seq}` and **never** a body sig, or it would pin a
  stranger's atoms in my store.
* **A fresh hive whose optimize-phase bee has never run publishes
  `complete: 0`** — honest, self-healing, and useless until records exist.

---

## 6. Files

| file | what |
|---|---|
| `hypercomb-core/src/core/vocabulary-claim.ts` | preimage, canonical body, `acceptVocabularyClaim`, `resolveVocabularyClaim`, `planVocabularyClaim`, `vocabularyRegressions`, `membershipOf` |
| `hypercomb-core/src/core/pool-registry.ts` | reserves `vocabulary:hive`, `vocabulary:published`, `vocabulary:seen` |
| `hypercomb-core/src/core/pool-kinds.ts` | `poolCreditsMemberNames` — a wipe-safe pool's member NAMES are not references |
| `hypercomb-essentials/src/history/history.service.ts` | `referencesOutside` consults that rule before crediting a member name |
| `hypercomb-essentials/src/molecule/molecule-index.service.ts` | `subtreeVocabulary` — the branch-scoped cold walk the publish reads through |
| `hypercomb-essentials/src/sharing/decoration-closure.ts` | `nestedResourceSigs` bails on a NUMBER `kind` too, so a signed event no longer fans out into `.public` markers |
| `hypercomb-essentials/src/sharing/hive-link.ts` | `VOCABULARY_ROOT_KEY`, `vocabularyRootOf`, `BRIDGE_FORBIDDEN_ROOT_KEYS` |
| `hypercomb-essentials/src/assistant/claude-bridge.worker.ts` | refuses the forbidden root keys; `branch-public` is read-only |
| `hypercomb-essentials/src/molecule/vocabulary-signer.ts` | the nostr binding, kind 30566 |
| `hypercomb-essentials/src/molecule/vocabulary-ledger.ts` | `vocabulary:published` (mine) and `vocabulary:seen` (theirs) |
| `hypercomb-essentials/src/molecule/vocabulary-publish.ts` | the act |
| `hypercomb-essentials/src/molecule/vocabulary-publish.deps.ts` | the live wiring |
| `hypercomb-essentials/src/molecule/vocabulary-search.ts` | the reader |

### Not yet wired

`hypercomb-essentials/src/side-effects.ts` is where a queen or panel that
reaches `publishVocabulary` would be registered. It still owes
`import './molecule/molecule-index.drone.js'` as well. Both lines are left for a
human.

`searchVocabulary`'s `provenSeq` / `rememberSeq` are optional and nothing
supplies them yet: `vocabulary-ledger.ts` exports `loadProvenSeqs()` and
`rememberProvenSeq()` and there is no `defaultVocabularySearchDeps()` to bind
them. So `sign('vocabulary:seen')` has neither a live reader nor a live writer,
and the `regressed` verdict is reachable only where a caller injects the deps.
The fold is proven; the deployment is not.
