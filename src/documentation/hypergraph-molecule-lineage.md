# Hypergraph molecule lineage — DOCTRINE (2026-09-02)

**Status: mandated direction.** Supersedes the path-keyed sigbag as the identity
of a location and the "bare word = hazard" reading of the pool collision rule.
Read this before touching `history.service.ts`, `lineage-key.ts`,
`pool-registry.ts`, `level-roster.ts`, `flatten.queen.ts`, the swarm channel,
or any doc that describes sigbags. Anything contradicting it is a contention
point and must be retired (register: see *Execution order*).

## The pattern — one rule at every scale

- **Atom** — a sig-named artifact at `<root>/<sig>`. Complete in itself.
- **Molecule** — a NAME. Its address is `sign(name)` (bare word, no prefix, no
  colon). The directory holds the atoms gathered under that name.
- **A molecule is an atom one level up.** `people` is a group of persons;
  `business` is a group whose members include `people`. Infinitely outward,
  infinitely inward. Nothing is ever the top.
- **The name IS the grammar.** Every tile named `people`, at ANY route, on ANY
  tenant, contributes to and reads from `sign('people')`. Naming is the only
  partition: a different group needs a different word (`staff`, `family`).
- **Depth is a route, never an address.** `/business/people` = walk into
  `business`, find the member named `people`, it is a molecule, walk in. The
  path-keyed bag `sha256(lineageKey(['business','people']))` is no longer the
  identity of anything. Every entity is one step from the root.
- **Back-reference.** An atom wears a mark naming its grammar(s). Pool =
  grammar → members; mark = member → grammars. Marks classify, never resolve.
- Single-segment locations already coincide: `sha256('people')` =
  `sign('people')`. The root level has been in alignment all along
  (`sign('websites')` IS the `/websites` bag — verified live).

## The decided shape (3 designs, 3 judges — unanimous)

Three independent designs were produced (purist / hybrid / skeptic) and judged
by three lenses (doctrine-fidelity / engineering-correctness / minimalism).
**All three judges chose the purist design and said build it.** Two of three
designers voted to swap; the skeptic declined. The shape, with the grafts the
judges required:

```
<root>/<sig>                          ATOM — three shapes matter
   vertex      {name, properties?, decorations?, …}       ← NO children slot, ever
   envelope    {meta:1, layer:<vertexSig>, root:<canon name>, relation?, slot?}
   succession  {succession:1, prev, members:[envelopeSig…], at}

<root>/<sign(canon(name))>/           MOLECULE — the only directory a tile gets
   <pubkey>/<sha256(headClaim)>           per-AUTHOR-KEY bucket of SIGNED claims
```

- **The succession atom IS the meta lineage** — an ordered list of member sigs
  plus `prev`. `members` order is committed by the sig (canonicalization sorts
  keys, never elements). The numbered marker directory disappears; `prev` is
  the chain.
- **A succession NEVER DECLARES ITS OWN LOCATION** (decided 2026-09-03, step 3).
  `name` and `author` are GONE from the atom. They were the two fields the cold
  path turned into path segments — `root.write(sign(succ.name)/succ.author/…)`
  — which made replication a REMOTE WRITE PRIMITIVE: bytes from a host chose
  which directory they landed in, including a reserved system pool. The fix is
  not a check on arrival. A field that does not exist is a check nobody can
  forget.
- **One head pointer per author KEY** (`sign(name)/<pubkey>/<sha256(claim)>`,
  written new-before-old). A succession has exactly one appender by definition;
  a name has as many appenders as tenants — the per-author bucket is what
  reconciles those two facts. Without it the model is unsound; this is the
  skeptic's one real objection and its answer.

### The head claim — `hypercomb-core/src/core/head-claim.ts`

A bucket is named by the RAW lowercase 64-hex **public key**, never
`sign(pubkey)`: the key is what the signature is checked against, and hashing
the address would sever it from the thing that authenticates it. 64-hex is the
shape `classifyDirectoryEntry` (`core/directory-safety.ts`) already calls a
`bucket`, so nothing in the classifier changes and `hardDeleteVeto` already
protects it.

A bucket entry is a signed CLAIM, not a bare name. The signed bytes are ONE
UTF-8 string — six lines, `\n`-joined, no trailing newline, GOLDEN VECTOR:

```
hc:molecule-head:v1
<moleculeSig>      64 lowercase hex — the directory the reader WALKED TO
<pubkey>           64 lowercase hex — the bucket name AND the verifying key
<headSig>          64 lowercase hex — the succession atom
<prevSig | "-">    64 lowercase hex, or the literal "-" for genesis
<seq>              decimal, no leading zeros, no sign
```

Every field is hex, `-`, or digits, so no field can contain the delimiter and
no escaping rule can ever be needed. Not canonical JSON: the string must
survive verbatim inside a nostr event's `content`, and a serializer both sides
must agree on byte-for-byte is a second thing to get wrong.

**The load-bearing property is not the field list — it is who builds lines 2
and 3.** The reader RENDERS them from the address it asked for and requires the
offered signature to cover exactly that string. It never parses a location out
of the bytes and compares. So placement authentication and signature
authentication are the SAME operation, and there is no `declared === askedFor`
line for a later refactor to delete.

Line 1 is domain + version separation: the same key already signs a hive index
(kind 30564) and NIP-98 headers (kind 27235), and a `:v2` verifier will REFUSE
a `:v1` rather than mis-parse it. Line 4 is a content address, so the signature
commits transitively to the succession's members, hidden set and prev. Line 5
puts the chain link inside the signature so a genuine head cannot be
re-parented. Line 6 is `seq` — signed, monotone, clock-free — because a schnorr
signature proves authorship and **never recency**; it is also what bounds the
fork walk and what breaks a tie. `seq` lives ONLY in the claim, never in the
atom, so every succession ever written stays byte-identical.

**Acceptance order** (`acceptHeadClaim`): shape → **signature** → idempotent
re-offer → staleness → descent. The address is argument one and has no default,
so a caller cannot ask "is this claim good?" without saying where it came from.

The signature runs BEFORE every policy branch, and that ordering is load-bearing
rather than tidy. The re-offer short-circuit used to come first, so any
shape-valid object whose `head` happened to match the held head returned
`ok: true` **with the verifier never called** — and `ok: true` reads as
"authentic for this address". A caller that persisted the offered bytes on it
would store unauthenticated bytes in someone's bucket. Crypto still runs at most
once per call, so nothing was traded away for it.

**A verdict carries three bits, and a storage caller acts on `keep`.**

| bit | meaning |
| --- | --- |
| `ok` | this claim may be what I hold RIGHT NOW |
| `authentic` | FACT: signed by the key that names this bucket, over this molecule |
| `keep` | POLICY: are these bytes a legitimate candidate to sit in this bucket? |

Refusals are `malformed`, `unsigned` (neither authentic nor kept), `stale`,
`rival`, `unproven` (authentic AND kept), and `fork` (authentic, NOT kept).

**Authenticity and headship are different questions, and the answer to the first
is what a reader may keep.** Conflating them is what made a temporal replay
permanent. A host that serves only generation 0 of a 70-generation chain forges
nothing — every byte is genuinely signed by the author for that exact address —
so on FIRST SIGHT there is nothing to be stale against and the reader adopts it.
The real head then arrived, could not prove descent, was refused as a `fork`,
and was THROWN AWAY: the victim ended up accusing the honest author of branching,
forever. A reader that KEEPS every authentic entry and picks its head with
`resolveBucketHead` is immune — the poisoned generation loses on the author's own
signed counter the moment both are in hand, and cannot be talked back down.

**`unproven` is its own refusal.** "I walked your chain to genesis and what I
hold is not on it" is permanent and is an accusation; "I gave up walking" is
recoverable and says nothing about the author. `chainContains` is therefore a
TRI-STATE (`true | false | 'unproven'`) — only the caller knows which of the two
it saw. The walk is bounded by the **signed seq gap**, which is exactly the
number of hops descent can require and cannot be inflated beyond what the author
signed; a constant budget was neither that quantity nor large enough for an
ordinary absence, and 65 edits made while a peer was offline partitioned two
honest participants permanently.

**A same-generation sibling is a `rival`, not a `fork`.** Two chains of the same
LENGTH: neither can contain the other, no walk can help, and only the bucket's
own key can produce the pair. Refusing it outright left two readers of one author
on two different heads forever, decided by which entry each met first. It is kept
and settled by the total order every reader computes identically.

**Nothing ever prunes a foreign bucket**, and a refusal costs the reader nothing:
the fork walk READS WITHOUT KEEPING and only the winning head's closure is
fetched. An entry that does not verify is IGNORED, never deleted — data never
heals.

### The succession names its SIGNER

`name` and `author` are gone from the atom and are not coming back; they were the
two fields the cold path turned into path segments. `signer` is a different
animal. Without it the atom is bound to NOTHING, so any key can mint a perfectly
valid head claim naming SOMEONE ELSE'S succession — every field in the preimage
true — and `viewOf`, which attributes rows to whichever author absorbs first,
hands the byline for the whole page to whoever sorts first. Content-addressed
dedup makes the theft invisible: the rows are byte-identical and only the author
changed.

`signer` is never a path segment and chooses nothing. It is compared against a
bucket address the reader has ALREADY AUTHENTICATED (`headClaimAuthors`), which
is exactly why the check is safe now and was not before. **A declared LOCATION is
a capability; a declared AUTHOR checked against an authenticated address is a
binding.**

### `seq` is replicated state, so a mint needs a LEDGER

`seq` cannot be raised without the secret, which is what makes it sound for other
people's buckets. For my own it has the opposite exposure, and no attacker is
required: `held` is rebuilt FROM A HOST, so a host that merely missed my last two
pushes hands me a counter of 0 when I had signed up to 2. My next commit then
signs seq 1 with genesis as its parent, every peer refuses it (first `stale`,
then `fork` once I commit past them), and NOTHING reports it because my own page
renders perfectly.

`planHeadClaim(held, minted)` takes the STRONGER of the bucket head and a LOCAL,
NEVER-REPLICATED record of the last claim this instance signed, my own record
winning ties. That ledger belongs beside the KEY — the same store the secret
lives in — precisely so it survives the accidents the key survives: an OPFS
eviction, a partial "clear site data", a restore from a folder backup.

And when the ledger is AHEAD of what this store can see, the commit **fails
closed**: `#base` would otherwise take its MEMBERS from the stale head it can see
while naming a `prev` it cannot, publishing a generation that silently drops
everything the newer head held. Refuse, say what to do, and one replication from
a current host resolves it.

**STILL OPEN:** if the ledger is lost too — a full "clear site data", or a
genuinely new second device on the same key — nothing distinguishes "I am new"
from "I am wiped, and this host is behind". A bucket cannot be its own authority
on its own recency. Closing it needs a SIGNED HEAD MAP (one signed document
naming molecule → head/seq) or a per-device sub-key so two devices never share a
bucket. Both are later steps.

### One flat namespace, one alphabet — the address gate

`<root>/<sig>` is a content atom when it is a FILE and a molecule, pool or bag
when it is a DIRECTORY: the ENTRY decides. A content address is `sha256(bytes)`;
a molecule address is `sha256(canonical name)` and a pool address is
`sha256(meaning)`. Nobody can find a collision — and nobody needs one, because
those two preimages are SHORT, PUBLIC STRINGS. A remote that wants a file planted
at `sign('bees')` lists that address as a member and serves the four bytes
`bees`; `sha256(bytes)` really does equal the name, which is the whole trick. In
OPFS a file and a directory cannot share a name, so one served page can
permanently prevent the drone-bundle pool from ever being created — and
`sha256("")` is the ROOT MOLECULE of every hive.

A blocklist cannot answer this: a molecule address is any word any participant
ever typed. The BYTES can. Every directory preimage this system mints is a
canonical name or a pool meaning, and both are drawn from letters, digits, `-`
and `:` — so `looksLikeAddressPreimage` refuses to STORE any replicated body that
could be one. It is conservative in the safe direction and loses nothing: such a
body is a handful of bytes and is trivially reconstructible.

**This is a gate, not the cure.** The cure is domain separation on the ADDRESS —
signing a tagged preimage for content, exactly as line 1 of the head-claim
preimage does for signatures — or moving content one level below the root. Both
re-mint or relocate every signature in every existing hive, so both belong to a
forward migration.

**Core stays dependency-free.** WebCrypto carries no secp256k1/schnorr, so the
asymmetric primitive is INJECTED: `verify(pubkeyHex, preimage, sigHex)`. It
takes the preimage STRING rather than raw bytes because NIP-07 signs only a
nostr event whose `content` is a string, and the schnorr signature covers the
NIP-01 event id. `hypercomb-essentials/src/sharing/head-claim-signer.ts` binds
it: the preimage rides verbatim as `content` of a kind-30565 event, and the
verifier asserts kind, then `evt.pubkey === the bucket asked for`, then
`evt.content === the preimage rebuilt`, and only then `verifyEvent`. It is the
pubkey and content comparisons — not the curve maths — that close the hole.

**`if (files.length !== 1) continue` is RETIRED.** That rule turned any second
entry in a bucket into a total page blackout for every reader. With
authenticated placement an adversary can no longer plant one, so a multi-entry
bucket means exactly one thing: the bucket's own key wrote twice (a crash
between the write and the sibling sweep, or two devices sharing an identity).
`resolveBucketHead` resolves it — highest `seq`, ties broken by the
lexicographically smallest head sig — a total, deterministic, reader-derived
order, so cold rebuild stays independent of listing order.

It is now the ONLY thing that answers "which head?" on a read path. The rule that
replaced the blackout — "accept one entry and delete its siblings" — made this
function's own documented convergence FALSE: two readers who met the same
author's two entries in a different order stayed on different heads forever, and
a reader hard-deleted bytes it did not write out of a directory it does not own.
Keep every authentic entry; rank them here. The loser is never deleted, here or
by any caller.

**Still owed:** `#setHead` is still write-then-prune and still not atomic. A
half-applied write is now SURVIVABLE, not atomic.
- **A parent's succession lists the child's VERTEX, never the child's head** —
  so commits stay per-page: no cascade, no stale hint.
- **`children` on a vertex survives as a DERIVED MIRROR** (decided
  2026-09-02). Truth is the succession's `members`; the vertex carries a
  deterministic mirror of it so an older client — which resolves the
  path-keyed bag under rule 9 and knows nothing about successions — reads a
  layer with children and renders a populated tile instead of an empty one.
  Without the mirror, backward compatibility is nominal and broken in
  practice. Consequences: the mirror is complete-or-absent and never read by
  a new client, and the ratchet is **"no `children` READ"**, not "no
  `children` present" — a new read path that consults the mirror is the
  regression to guard against, not the field itself.
- **`slot` rides the envelope**, not the member — which finally fixes the
  canonical trap where one `properties.index` per tile has to serve every
  appearance of that tile.
- **`hidden:[envelopeSig]` lives in YOUR succession** — the only honest tool
  against a member you did not author (you cannot un-add what you did not
  add), and it makes hide-first structural and undoable.
- **Replication refuses forks**: accept a newer entry for an author only if
  its `prev` chain contains the entry you hold. History never branches.
- ~~**The seal is derived**~~ — **SUPERSEDED by step 4**, see *The deploy
  signature is a signed head map* below. A recursive fold over a global name
  graph has no fixpoint, is entry-point dependent, moves when a stranger
  commits, and cannot be verified without a directory listing. The deploy is a
  MANIFEST OF HEADS, not a recursive seal.
- **The mesh keeps (room, secret)**: `sha256(canon(name) ␀ room ␀ secret)`.
  A channel that is `sign(name)` verbatim would receive every `people` on the
  relay. Unanimous across all three designs.
- **One canonicalization rule everywhere**: `canonicalizeLineageSegment` (NFC,
  non-letter/digit runs → `-`, edge hyphens stripped).
  `controls-bar.component.ts:1158` and `mesh-modal.component.ts:139` hash a
  RAW join today and already disagree — fix both.
- **TWO PREIMAGE FUNCTIONS, NEVER ONE** (resolved 2026-09-02; the contention
  register raised this as the one blocking, unhealable decision). A molecule
  address and a system-pool address must NOT be derived the same way:

  | | preimage | example |
  |---|---|---|
  | **molecule** (a tile name) | `fold(canon(name))` | `People` → `people` → `c9022680…` |
  | **system pool** (a developer's meaning) | the **RAW** meaning, untouched | `websites:menu` → `17deba5b…` |

  The register argued this was a dilemma — canonicalize and the colon is eaten
  (`websites:menu` → `websites-menu`), so every reserved pool re-addresses;
  sign raw and `My Cool Tile` re-forks from `My-Cool-Tile`. **Both horns only
  exist if one function serves both namespaces.** It doesn't, and the code
  already reflects that: `PoolRegistry::address` signs the raw meaning while
  the bag preimage is canonicalized. That is not a disagreement, it is the
  design.

  **The reservation holds BECAUSE the two differ.** `canonicalizeLineageSegment`
  maps every non-letter/digit run to `-`, so its output can never contain a
  colon — therefore no tile name, in any script, can ever reach a colon-scoped
  address. Verified: `canon('websites:menu') === 'websites-menu'`, and
  `sign('websites:menu')` stays `17deba5b…`.

  Keep `lineageKey` byte-identical (paths, case-preserving) and add
  `moleculeKey(name) = fold(canon(name)) || String(name).trim()` — the raw
  fallback matters, or a symbol/emoji-only name canonicalizes to `''` and
  collides with the ROOT address.

- **CASE IS FOLDED FOR THE ADDRESS** (decided 2026-09-02). The molecule address
  is `sign(canon(name).toLowerCase())`. **Case folding IS the interop** — a
  global vocabulary where `People` and `people` are different molecules is not
  a shared vocabulary, and the skeptics landed this as a major
  (`sign('People') !== sign('people')` defeats the headline claim). Notes:
  - Use `String.prototype.toLowerCase()`, which is locale-INDEPENDENT — never
    `toLocaleLowerCase`, whose Turkish dotless-i would make one machine's
    address disagree with another's. NFC first, as today.
  - **Display case is preserved on the vertex.** The `name` field keeps what
    the participant typed; only the hashed preimage is folded. "My Tile" still
    reads as "My Tile".
  - **Known cost, accepted:** two differently-capitalised tiles MERGE, exactly
    as two same-named ones do. Naming remains the only partition.
  - Homoglyphs are NOT solved by folding (Cyrillic `а` still mints a second
    molecule that renders identically). Open, tracked as a minor.
  - Folding re-addresses every existing name carrying a capital, so it lands
    like everything else: additive, dual-pointer, nothing deleted (rule 9).

## The array is the canonical signed form (decided 2026-09-02)

A single signature and an array of signatures are **the same type**. The walker
already works this way — `edgeSigsOf` accepts `string | string[]` on every edge
field (`edge-registry.ts:93-110`). Made doctrine:

1. **In signed bytes, a collection slot is ALWAYS an array** — even when it
   holds one member. `{children:['a']}`, never `{children:'a'}`. One preimage
   per meaning, so two participants making the identical edit mint the
   identical sig and dedup/convergence hold.
2. **`sign(array)` is an ADDRESS, never a substitute inside signed bytes.** The
   array may also live as its own atom at that address, but a record always
   inlines its members. If both spellings were legal preimages, the same edit
   would produce two signatures and replication would read a fork.
3. **`Sig | Sig[]` makes "a molecule is an atom one level up" a type identity**,
   not an analogy. Inline vs reference is a storage decision; the meaning is
   identical. That is what makes the model recursive without a special case.
4. **`content` / `children` / `refs` collapse to one arity-flexible slot** —
   they were the same edge at different arities. The typed payload hops
   (`layer`, `resource`, `dependency`, `bee`) stay SCALAR: they are singular by
   construction — one envelope, one payload — and wrapping them buys nothing.

**Scope boundary — this binds NEW record shapes only.** Normalizing existing
scalar slots in already-signed bytes would re-sign every atom that has one: a
merkle cascade re-addressing the whole hive, for no gain. So the rule applies
to the shapes being minted (succession, the new envelope/vertex forms); legacy
scalar spellings are read as-is and DRAIN. Never re-sign old data to satisfy a
canonicalization rule — that is healing, and data never heals.

### When domains arrive, the array becomes orthogonal

A member is identified by its signature; it is *available* at zero or more
domains. So the community read of a molecule is not a list but an **orthogonal
array — members × hosts**: rows are member sigs, columns are the domains
serving them, and a cell says "this host has these bytes."

- **The domain NEVER enters a preimage.** If it did, the same content served
  from jwize.com and from revolucionstyle.com would carry two signatures and
  every guarantee — dedup, convergence, verification, share-never-copy —
  would collapse. Identity is the row; availability is the column.
- A signed claim (a succession) stays one-dimensional: one author's ordered
  members. The second axis appears only at READ time, as the union across the
  hosts you chose to ask.
- The column is therefore provenance and reachability, never meaning: losing a
  host removes a column, never a member. A member with no columns left is
  unreachable, not deleted.

## Ordering — "just have a meta lineage"

**Ordered is right, but the ordered thing is never the molecule.** All three
judges converged on this independently.

The molecule (the directory) is a **SET** and must stay one: `readdir` has no
order, a union of two authors' sequences has no canonical interleaving, and a
content-addressed identity for a set must sort to converge. The moment order
lives in the directory you have one appender and a sigbag with a worse address
— `host-pool.ts`'s ordered 8-digit pool is the proof; it is a sigbag renamed.

Order lives in exactly two places, both already doctrine elsewhere:

1. **The succession atom** — one author's ordered claim at one moment.
2. **The envelope `slot`** — order rides the incidence, per the artifact
   paradigm ("one order field cannot serve two websites").

Tenant A's order and tenant B's order are two atoms in the same directory;
neither clobbers the other. There is **no global head** — the molecule is a
set, and only participants have sequences.

## The codebase is already walking this way

Three shipped precedents, found by the readers:

- `hives-names-shape.spec.ts` pins a name-keyed head record whose own comment
  reads *"the entry is name → head; NO lineageKey derivation anywhere."*
- `tile-art.ts` ships `sign('visual:tile-art')/<name> → signature`.
- `pool-bag-collision.spec.ts` already proves
  `sign(bareword) === sign(lineageKey([bareword]))` and that `/flatten` must
  not destroy pool members.
- `native-filesystem.ts:34-37` already treats a sig-named directory as *"a bag,
  a pool, or BOTH"* and classifies **per entry** (8-digit = marker). That is
  the rule-5 model every other walker should copy.

## Federation — pools do not live on your computer

`<root>/<sign(name)>/` on a machine is one **replica**. The pool itself has no
home: it is the union of that address across every host in the community.

- **Membership = hosting.** Serve the dir, you are in; stop, you are out. No
  registration, no permission, no central list.
- **Reading = local replica ∪ the hosts you reach.** Tenancy is *whose hosts
  you ask*, never a segment of the address.
- **Every word is a cross-host search address.** `GET /<sign(word)>/` on every
  community host — no index, no schema, no query language. Miss = empty
  listing. Hit = atoms you can materialize cold.
- **Intersection of pools = hyperedge join.** "people who are authors" =
  `sign('people') ∩ sign('authors')` across domains that never met — they only
  had to agree on two words.
- **Unfakeable.** A host cannot advertise a grammar it does not hold; the
  listing IS the holding.

## Data never heals — it moves forward

No migration pass rewrites the past. The transition is a **forward commit**:

- The molecule's first meta under this model unions the old heads in
  `children` and links them via `refs` (an edge `edge-registry.ts` already
  knows). Old heads stay byte-identical atoms. Undo walks *through* the seam:
  rewind past the transition commit and you stand on the old head, seeing
  what it saw.
- Same-name merge (`/business/people` + `/club/people`) is not two bags
  collapsed — it is a commit that says *these were the same word*, with both
  parents one undo away. Announce it; never do it silently.

## Backward compatibility is mandatory — NOTHING is deleted

People on older versions must keep working against the same hosts and the
same OPFS. The transition is purely **additive and dual-pointer**:

- Every new-model commit writes the meta atom ONCE and advances BOTH
  `sign(name)/000x` AND the old `sha256(lineageKey(path))/000x` to that same
  atom. One atom, two pointers — sharing, not copying.
- Hosts serve both directories forever. Pointer files cost nothing.
- An old reader resolving the path-keyed bag's max marker lands on the same
  head a new reader sees; the meta is an ordinary layer it can already read.
  Its view is strictly smaller (no federated union), never broken.
- Not atoms, not markers, not pointer dirs — nothing retires. "Writes never
  target a legacy dir" applies to the typed `__x__` folders, NOT to sigbags: a
  sigbag is a valid address, not a legacy dir.
- **OPEN (owner's call):** the mesh. Old peers converge on `lineageKey(path)`,
  new on `sign(name)`. Either dual-publish for a window or partition by
  version. Flag sites; do not decide silently.

## The collision rule, re-read

`sign('people')` being the `/people` bag is **the design**, not a hazard. The
hazard was `/flatten` hard-deleting a pool it mistook for a bag — a **prune
bug**. Fix prune safety: no walker may delete a directory that holds 64-hex
entries, regardless of registry. Do not forbid bare words.

- Colon meanings stay **reserved for system pools** no tile should name
  (`websites:menu`, `usage:dwell`, …).
- The seven existing bare-word system pools — `bees`, `dependencies`,
  `clipboard`, `threads`, `computation`, `manifests`, `optimization` — cannot
  stay ambiguous. Each either moves to a colon meaning (with a drain — a new
  spelling mints a new address forever) or is declared a reserved name the
  command line refuses. Decide per pool; record it in the register.
- The frozen bare-word set in `pool-registry.ts` stops being a prohibition on
  tiles and becomes the reserved-name list. The ratchet flips from "no bare
  words" to "no `__x__`, no hardcoded hex, no deletion of a member-bearing
  dir".

## Values this serves

Signatures are the only identity · everything is an atom · a molecule is a
name and a group · relations are marks members wear, never a parent that holds
them · pools of meaning first, kind alone only as fallback · every entity one
step from the root · small surface, no abstractions · history never branches ·
hide first, delete second · share resources, never copy · interoperable at
every level.

## Execution order

1. **Prune safety** — precondition. No walker deletes a dir holding 64-hex
   entries.
2. **Dual-read** — `sign(name)` first, path-keyed bag as fallback. Nothing
   changes for the user.
3. **Forward-commit write path** — save = put the atom, add it to
   `sign(parentName)`, commit the meta, advance BOTH pointers.
4. **Mesh channel** — per the open decision above.
5. **Pool-registry / ratchet flip** — reserved names, colon = system only,
   prune-safety ratchet.
6. **Docs** — every passage asserting path-keyed identity, bare-word
   prohibition, or a healing pass is reworded. Docs are contention points too.
7. **The deploy signature** — the recursive seal is retired in favour of a
   signed head map. Core primitive and prototype landed 2026-09-03; the
   per-caller migration is written out under *The deploy signature is a signed
   head map* below and is not applied to shipped code in that pass. Prose that
   still treats the recursive seal as spec: `hive-snapshots.md:19,37`,
   `build-revisions.md:80`, `clipboard-sig-native.md:11,60`,
   `publish-differential.md:58,78,93,268,274`, `insights.md:109`.

   **Revised the same day, after three adversarial passes over the
   replacement.** Four things changed and the section below carries each with
   its reason: the SET is now SIGNED (`headMapAttestationPreimage`) because
   authorship of a composition is not recency and a signature does close it;
   the whole-hive scope is the mint LEDGER and a branch walk descends the UNION
   (a stranger's tile used to amputate a publisher's own subtree from their own
   deploy); `verifyDeploy` owns steps 0-1 of the recipe, which no function used
   to take an argument for; and the size gate is the same constant in both
   directions with `splitHeadMap` past it. A claim reader must now state what it
   actually fetched, `readHead` makes a deploy with no content behind it a hole
   per row, and `pullClosure` is iterative. Nothing was deleted: every changed
   assertion is in a test that still builds the original attack first.

**Done means:** the prototype passes its own and the skeptics' tests, and the
contention register holds no unaddressed `trap` or `must-change` item — code,
ratchets, tests and docs — so nothing in the repo can pull a later session
back to the path-keyed bag.

### The two open items only the owner decides

1. **The mesh transition** (rule 7 above). Old peers converge on
   `lineageKey(path)`, new peers on `canon(name)`. Either new clients
   dual-publish to the old channel for a window, or peers partition by
   version. Every derivation site is flagged in the register; none is decided.
2. **The same-name collapse.** `/business/people` and `/club/people` become
   one molecule on one tenant. This is the literal spec — "the name is the
   grammar" — and there is no purist escape short of putting the route back in
   the address. It must be *announced*, never silent: the migration reports
   "N molecules from M paths, K same-name member stacks" before it writes.

### Known costs, stated plainly

- The same-name collapse above.
- Cold head derivation is O(entries) without the per-author bucket listing —
  which is why the bucket is not optional.
- Two host pieces gate the interop claim: a directory branch for live hosts
  (relay), or a signed `heads: Record<moleculeSig, headSuccessionSig>` map in
  `/hive/<pubkey>` for static hosts (Pages, buckets). Until one ships,
  cross-host search is designed but not reachable.
- Every root walker must learn "the ENTRY decides, never the directory".
- GC roots become every head entry in every molecule: with no parent→child
  edge in layer bytes, closure walkers reach child molecules only by route or
  by seal.

## The deploy signature is a signed head map (step 4, landed 2026-09-03)

`hypercomb-core/src/core/head-map.ts` · prototype twin
`documentation/molecule-lineage-prototype/head-map.mjs`

### What broke, and why it was the fold rather than a bug in it

Four attacks from the adversarial review all land on the recursive seal, and
none of them is a defect that could be patched:

| | finding |
|---|---|
| A | **No merkle root exists.** The recursion step is `sign(childName)`, which does not GROW — it is a step in a general directed graph over the global name set. One ordinary tile named after an ancestor closes a cycle and the fold never terminates. |
| A2 | **Cycle-breaking does not rescue it.** Cutting on the recursion PATH makes what a node folds depend on which ancestors are on the stack, so one molecule has one merkle identity per entry point. |
| B | **The cascade comes back, triggered by a stranger.** The fold reads live heads through `viewOf`, which absorbs every author's bucket in a globally-named molecule, so a foreign commit re-mints my deploy signature. |
| H | **A sealed root cannot be verified from immutable atoms alone.** Sealing needs directory listings, so the merkle proof terminates in a mutable, unsigned, host-chosen readdir — which a static host does not have at all. |

A fifth, unnamed in the review and found while building this: the fold reads
`viewOf`, and `viewOf` reads the LOCAL UNDO CURSOR. Pressing undo re-minted the
deploy root with nothing committed anywhere and nothing on disk changed. A
deploy signature must not be a function of session state.

The shipped `HistoryService.sealSubtree` escapes A only because it is
PATH-keyed: `sealSubtree([...segments, name])` grows its argument, which is the
only reason it terminates. Move addressing from path to `sign(name)` and the
argument becomes constant-size, so A lands on shipped code. Note also that
`sealSubtree` already enumerates `'cycle'` as a refusal reason, and that its
guard is a RECURSION-STACK set, deliberately not a global visited set — the
comment at `history.service.ts:2534-2544` records that a global visited set was
tried and reverted. That is the shipped acknowledgement of A and A2.

### The shape

The deploy is a flat enumeration of what THIS publisher heads, carried as a
content atom:

```
{"kind":"hypercomb.head-map","v":1,"pubkey":"<64hex>",
 "rows":[["<moleculeSig>","<claimSig>"],…],"refs":["<claimSig>",…]}
```

- **`rows` sorted strictly ascending by molecule; `refs` the distinct claim
  sigs, sorted.** Both tokens are fixed-width lowercase hex — one alphabet — so
  codepoint order IS byte order, the order is total, and there is no locale,
  collation or tie-break to specify. An ARRAY OF PAIRS, never a JSON object: an
  object makes the bytes depend on a serializer's key-ordering rule, the
  "second thing to get wrong" `headClaimPreimage` already refuses one level
  down.
- **`rows`, deliberately not `heads`.** Two reasons, and the second is the
  durable one. (1) The prototype twin's miner
  (`documentation/molecule-lineage-prototype/sig.mjs`) DOES treat `heads` as an
  edge field, so a walker there descends the pairs and tries to fetch every
  MOLECULE address as an atom — a directory with no bytes behind it, i.e. the
  permanent-404 bug class. (2) Independently of any one miner: both tokens of a
  pair are ARRAY ELEMENTS, so any field name a walker treats as an edge exposes
  the molecule key as a fetch target. `rows` is not an edge field anywhere.
  **Correction, 2026-09-03:** an earlier draft of this bullet said `heads` is an
  edge field in `core/edge-registry.ts`. It is NOT — `EDGE_FIELDS` is frozen at
  `['layer','resource','dependency','bee','children','content','refs']` and
  `heads` appears nowhere in that file. That is a bug in the OTHER direction: a
  core walker would IGNORE a `heads` slot, so a deploy layer filing the map
  signature there would replicate without the thing it deploys. The deploy layer
  therefore files it under **`refs`**, which is a real edge, and the migration
  table below says so.
- **No clock, no host, no route, no segment list, no publisher-chosen order.**
  `hive-link.ts:151` already made this call for its own bundle. It is what
  gives `mintBuildRecord` its idempotence test back for free: an identical
  rebuild yields the identical signature.
- **`pubkey` is a REFERENT** (added to `REFERENT_FIELDS` this step). It is
  self-declared, so it is COMPARED against the key the reader asked for and
  never used as an address — the same discipline `acceptHeadClaim`'s
  argument-one rule enforces and `hive-pointer.ts:87-91` applies when it calls
  a pubkey mismatch `forged`.
- **The SET is signed** — `headMapAttestationPreimage(pubkey, mapSig)`, three
  `
`-joined lines (`hc:head-map:v1`, the pubkey, the map signature), checked
  by the SAME injected verifier and the SAME key as a head claim.

  **This reverses an earlier decision in this document, and the reversal is the
  point.** The first cut carried no signature of its own and argued that "a
  third signature would prove authorship and never recency, so it would close
  nothing" (`publish-heads.ts:17`). That conflated two properties. Recency is
  indeed unprovable by a signature. **Authorship of the SET is a different
  property, it was exactly what was missing, and it is exactly what a signature
  closes.** Because every row was signed independently and the COMPOSITION was
  signed by nobody — and `pubkey` is a field whoever composes the bytes chooses
  — any party holding a publisher's public bytes could compose new,
  fully-verifying "deploys" out of that publisher's own rows: a TRUNCATION with
  a whole subtree cut out, THE EMPTY DEPLOY ("this publisher published
  nothing"), or a CHERRY-PICKED mixture of generations that never existed on any
  device. All three returned `ok:true, reason:null, holes:[]` — a verdict
  byte-identical to the truth. Three independent adversarial passes found it.

  The attestation adds **no clock** and claims **no recency**: a replayed OLDER
  attested deploy still verifies, and is still caught only per row, on the
  author's own signed `seq`, by a reader that has already proven a newer
  generation. That residual is real and is listed under *Residual risk*. What
  the signature closes is composition, and composition was the whole attack.
  The pointer's freshness remains the index's job — in the shipped app the
  kind-30564 hive index event, whose `created_at` monotonicity the relay
  enforces (409 on rollback).

### The value is the head CLAIM, never the succession atom

Only one of the two is checkable by a third party, and the reason is mechanical.

Step 3 deleted `name` and `author` from the succession atom, so the atom is
bound to no location. A bare head signature in a row is authenticated ONLY by
whatever signed the enclosing document: a reader who lifts one row out cannot
check it without swallowing the whole map, which makes the map a TRUST ANCHOR
and stops the scheme being federated.

A CLAIM signature dereferences to bytes whose signed content is
`headClaimPreimage(molecule, pubkey, head, prev, seq)` — and the verifier
REBUILDS lines 2 and 3 from the row's KEY and the pubkey it asked for, never
from the bytes. A claim moved to another row, or minted under another key,
renders a string that never verifies (proved on two of the publisher's OWN rows
in `head-map.spec.ts` and `head-map.test.mjs` H2). `prev`/`seq` ride inside that
signature, so a reader ranks generations with `resolveBucketHead` WITHOUT the
map: a stale map degrades to "you may not have heard about a newer head", never
to "you were talked back down a generation".

An inline claim OBJECT (`{head, prev, seq, sig}` as the value) is refused: it
duplicates signature bytes that can then disagree with the atom, and
`blossom-worker/worker.js:802-813` requires every `roots` value to be 64-hex, so
it breaks the wire and every deployed reader.

### What terminates, and why "just de-duplicate" is right here and was wrong there

Two scopes:

- **whole hive** (snapshot, and ALSO the `route: []` publish) — read the local
  MINT LEDGER, which `head-claim.ts:515-537` already specifies must live beside
  the KEY rather than in the replicated content tree. It is a
  `molecule → {head, prev, seq}` table. **No graph at all.**
- **one branch** (publish at a route) — a reachability walk with a GLOBAL
  VISITED SET, where **reachability is the FILTER and my own bucket is the
  CONTENT**.

**Correction, 2026-09-03 — the branch walk descends the UNION, not my own
heads.** The first cut walked MY OWN heads and its stop condition was "I hold no
claim here", so a molecule I do not head did not merely get skipped: it
TERMINATED that branch of the walk and every page of mine underneath it became
unreachable and was named by nobody. In this design's headline case — one name,
one page, MANY AUTHORS — that is the ordinary shape and not the corner. One tile
somebody else made in the middle of a four-deep route amputated the rest of it;
a contributor who never made a top-level tile minted a well-formed, correctly
signed deploy of ZERO ROWS, byte-identical to the deploy of somebody who owns
nothing. And "publish everything from the root" published strictly LESS than
"publish this branch inside it", with neither containing the other.

Both halves of the fix follow from the same observation — a walk from the root
can never be more correct than the ledger:

1. **the root scope IS the ledger.** `route: []` walks nothing, so the root
   scope is a superset of every branch scope inside it, by construction.
2. **a branch walk descends every author's head** (`store.heads`, never
   `viewOf`), so a stranger's page is walked THROUGH instead of stopped AT,
   while what gets NAMED is still only a molecule I hold a claim in. A stranger
   can therefore widen or narrow WHICH of my molecules a branch publish covers,
   and can still never touch a ROW — a strictly weaker exposure than losing
   them outright.

**And nothing is dropped silently.** Both scopes return `unresolved` (ledger
molecules whose bucket did not resolve — a publisher must not sign a truncation
of their own hive without being told); a branch scope returns `outOfScope` (what
it leaves behind); and the walk returns `opaque` (molecules whose succession
bytes are missing, so it could not descend). The first cut swallowed all three
with `?? []` and returned no field naming what was lost, so no caller could
surface it — while `#commit` fails CLOSED on exactly that store state ("out of
sync … replicate from a current host"). The publish path must not fail open
where the commit path fails closed. It also means an evicted succession atom no
longer shrinks a deploy or moves its signature: my AUTHORITY did not change, so
neither does my map.

The global visited set was tried and REVERTED for `sealSubtree`. It is sound
here and was not there, and the difference is exact: the seal computes a VALUE
at each node, and de-duplicating a legitimately repeated sibling changes the
answer. This computes MEMBERSHIP, which is idempotent and commutative —
visiting a node twice can only re-add what is already in the set. The reachable
set is the least fixed point of a relation over a FINITE name space, and a
visited set computes it exactly. A cycle is therefore a non-event rather than a
refusal, and a molecule that is a member of itself is one row (and could not be
two: `canonicalHeadMap` refuses a second pair for a molecule already present
with a different claim, so the map is a FUNCTION and never a bag).

The walk reads HEADS, never `viewOf` — which is how both the stranger (B) and
the undo cursor are cut off at the source.

### Why a stranger cannot move it, and how it stays honest anyway

The enumeration opens `<molecule>/<MY pubkey>/` and no other directory. A
foreign commit lands in a different bucket the enumeration never opens.

The map still NAMES the molecule and asserts exactly one thing about it — *this
is MY head there* — and says nothing about anyone else's bucket. A reader who
wants the whole molecule goes to the address: `GET /<sign(name)>/` on any host
with a directory branch, unioned across community hosts. **The map is a FLOOR,
never a ceiling**, and that discipline is not new here: `publish-heads.ts:194-197`
documents `knownRoots` in exactly those words, and `publish-branch.ts:288-291`
computes `missingFromIndex` and REPORTS it rather than re-asserting it, because
resurrecting a branch the participant deliberately unpublished would be its own
kind of lie. The head map inherits that rule verbatim.

### Verification with no directory listing

Every step is `GET /<64hex>` + a hash check + a signature check, and **all of
it is inside one function**, `verifyDeploy`:

0. obtain `(pubkey, deploySig, attestation)` — from the signed index, or from a
   hive-link bundle whose pubkey is pinned in its canonical bytes.
1. `GET /<deploySig>`, assert `digest(bytes) === deploySig` → else `forged`.
2. `parseHeadMap` — REFUSE-OR-PARSE: it re-canonicalizes and requires the bytes
   back, so a second spelling of one set cannot exist. A refusal says WHICH gate
   said no (`oversize` vs `unparseable` vs `non-canonical`), because a publisher
   who must shard and a host that must not be believed call for opposite
   responses.
3. assert `record.pubkey === pubkey`; a mismatch is `forged`.
4. verify the ATTESTATION over `(pubkey, deploySig)`; an unsigned or foreign
   composition is `unattested`.
5. per row: `GET /<claimSig>`, hash what came back, then `acceptHeadClaim` with
   the molecule from the ROW KEY and the pubkey from step 0. Take
   **`authentic`**, never `ok` — `ok` answers a question about a TRANSITION and
   is meaningless when re-reading what is already published.
6. optionally (`readHead`): per verified row, `GET /<head>` and assert the hash.
7. per verified row: walk its members by signature.

**Steps 3 and 4 refuse BEFORE ANY FETCH**, the same discipline that already
refused a wrong `expected` before touching a host: a map that is not this key's,
or that this key never assembled, is not worth a byte of anyone's bandwidth.

**Steps 0-1 used to be owned by NOBODY.** No function in the module took a
deploy signature, so `verifyHeadMap(record, expected, …)` was handed an
already-parsed record and could not check that these bytes were those bytes —
and it returned `{ok:true, reason:null}` for a forged set, byte-identical to
what it returned for the truth. A caller who skipped step 1 got no signal of any
kind and the API gave them nowhere to pass the value that would have caught it.

**Step 6 is optional and it is why `ok` means something.** `refs` is the
record's declared closure and it carries CLAIMS; a claim's `head` is not an edge
and `prev` is a declared REFERENT, so a replica built from a deploy's own
closure holds the map and the claims and NOT ONE BYTE of the hive. That part is
design — a deploy names WHERE the pages are and a reader pulls each head on
demand, which is what keeps a cold read O(page) rather than O(every edit ever
made). What was NOT design is that such a replica verified `ok:true`,
indistinguishable from a whole site. With `readHead`, an unreachable succession
is a hole ON THAT ROW.

**Step 7 must be ITERATIVE.** As-today was `pullClosure`, which recursed once
per edge with a visited set and no depth bound. Hash-checking cannot save it:
`sha256(bytes) === sig` proves the bytes match the NAME and says nothing about
their SHAPE, and the bytes are the publisher's own — so THE PUBLISHER PICKS THE
DEPTH. ~20,000 chained atoms of a few dozen bytes each, the whole weapon under a
megabyte, threw `RangeError: Maximum call stack size exceeded` inside the reader
this scheme offers as the listing-free replacement for the seal, and a hostile
PEER reached the same walk through fork refusal without being the publisher
under verification. A worklist has no stack to exhaust; a distinct-atom budget
is the second belt, and a reader that stops must SAY it stopped rather than
report success.

**TWO DOORS, AND THE WEAKER ONE CANNOT BE MISREAD.** `verifyHeadMapRows`
answers "is every row present genuinely this key's?" and its verdict has **no
`ok` field at all** — only `rowsAuthentic` — because `ok` reads as "this deploy
is good" and could only ever mean "no row I was shown failed". That misreading
was the attack. `ok` exists only on `verifyDeploy`'s verdict, where it means
attested, complete, and every row authentic.

Failure is PER ROW (`holes`), so one cold atom never makes a publisher's whole
deploy unverifiable. This is strictly stronger than the seal, whose internal
nodes are re-signed by NOBODY: even with listings, a verifier of a sealed root
could only check hashes, never authorship.

### One gate, both directions

`HEAD_MAP_MAX_BYTES` (4 MiB) is the ENCODER's ceiling and the PARSER's. It was
the parser's alone, which is the exact asymmetry this module's own comment
forbids — and at 203 bytes a row the wall is 20,660 molecules, where ONE more
tile name lost not one molecule but EVERY molecule, silently at mint time and
totally at read time. It throws at the publisher now, where somebody can act on
it. And the cap is not a cliff: a map is a SET, and a set splits, so
`splitHeadMap` cuts a large publisher's enumeration into shards in canonical row
order (deterministic, so a rebuild that changed nothing produces the identical
shard signatures) and the index names several map atoms.

### Per-caller migration — the repo deliverable

**Nothing shipped is deleted in this step.** `sealSubtree` is DEMOTED from a
gate to a courtesy and stays as the reader for every sealed root already in the
world (every `rootSig` in every shared hive-link bundle is one). What follows is
the plan, not a set of edits made now.

| caller | becomes |
|---|---|
| `sharing/publish-branch.ts:224,226,227` (+ interface `:69-70`) | Build the map for the branch scope, `putResource(encodeHeadMap(record))` → `mapSig`, then `history.materializeLayer({...liveRootHead, refs:[mapSig]})` → `deploySig`
(**`refs`, NOT `heads`** — `heads` is not in core's frozen `EDGE_FIELDS`, so a
precise walker would ignore it and the deploy would replicate without the map it
deploys). Sign the attestation over `deploySig`'s map bytes and carry it beside
the pointer. `sealed` becomes `deploySig` in all FOUR of its load-bearing roles (`:233`/`:247` availability subject, `:283`/`:293` index value, `:315` bundle `rootSig`, `:340` ledger key). The seal+heal pair leaves the required path and `failure:'seal-failed'` (`:229`, surfaced in `host-gesture.ts:101-103`) becomes unreachable. |
| the AVAILABILITY GATE (`markPublic(sealed,'layer',true)`, `isClosureAvailable`) | The most under-appreciated cost, and it needs no new walker. `refs` is an ARRAY slot and is NOT in `CHILD_SLOTS` (`['cells','layers','children']`), so the map atom stages as a RESOURCE and its own `refs` carry every claim. The per-head subtrees come from a FLAT LOOP over the map's rows — `for (row of rows) markPublic(row.head,'layer',true)` — and the gate is the deploy plus every row. **SNAPSHOT THE ROW SET BEFORE STAGING AND SIGN THE MAP OVER THAT SAME SNAPSHOT**, or a commit landing mid-flight yields a map naming a head that was never staged. `confirmPublished`'s `probeServed` subject is `deploySig`; the per-row loop is what proves the creation's bytes. |
| `sharing/publish-status.drone.ts:116,540-541` | `here` becomes the same `deploySig` publish would write. The comment at `:526-529` names the real cost as the post-commit RE-WALK; that disappears, and the `beforeDeadline(...,15s)` wrapper and the yield-between-rows loop become unnecessary. |
| `sharing/publish-verdict.ts:28` | `cannot-compare` **SURVIVES and is re-documented**: the cause changes from "a descendant is cold" to "no head claim is held for this branch root". Do not delete the rung — a row can legitimately be absent. Its display copy also changes: `collidingPaths` (`publish-heads.ts:213-225`) stops meaning "two of your paths collide" and starts meaning "this name is shared with the whole network", which is the design and will read as a bug unless the copy moves with it. |
| `sharing/swarm.drone.ts:2961`, `:3867` | **REPORTED, NOT DECIDED** — both sit in the register's step-4 MESH CHANNEL section (`contention-register.md:60`), marked FLAG, DO NOT DECIDE. No edit is needed: the interface declares `sealSubtree?` OPTIONAL and both sites are wrapped `try { handle = (await …) || cs } catch { handle = cs }`, so they degrade to the pre-seal child sig by construction. They are TWO byte-identical copies and must be extracted into one function before either is touched. |
| `commands/snapshot.queen.ts:102,111,113,114,117` + `#pushClosure:218-232` | The hard case, and the one that most needs the map: `sealSubtree([])` over a global name graph is exactly the walk A proves has no fixpoint. Mint the whole-hive map from the mint ledger — no walk. `#pushClosure`'s recursion becomes a loop over the rows. The five-reason `lastSealFailure` message collapses into a LIST of molecules whose claim could not be resolved, which is more useful than a single first-failure path. |
| `history/builds-slot.ts:65,81-82,175,181-194` | Mint the map for the build root's scope. The idempotence test (`head.seal === seal`) moves to `headMap` and works BETTER: no clock in the bytes. The `'the subtree could not be sealed…'` error (`:187`) goes — enumerating heads never needs a descendant's bytes. Callers unchanged. |
| `history/snapshots-slot.ts:98`, `history/builds-slot.ts:65` | **ADDITIVE FIELD ONLY**: `headMap?: string` beside the existing `seal`. `seal` is already committed into users' layer slots and can never be rewritten (rule 9). Keep minting `seal` while the courtesy walk succeeds; when it fails, write the record anyway with `headMap` and no `seal` — a case that today writes NOTHING. |
| `history/seal-restore.ts:32 applySealAt` | **UNTOUCHED, and kept forever as the legacy reader.** Add a sibling `applyHeadMapAt(mapSig, carrySlots)`; `restore.queen.ts:113` and `builds.queen.ts:181` choose `record.headMap ? applyHeadMapAt : applySealAt`. The new path is a flat loop — no recursion, no `seen` set, no per-node name resolution. ORDER DEPENDENCY: the flat loop needs a MOLECULE-ADDRESSED `commitLayer` (register orders 135-139, not landed), so `headMap` is WRITTEN now and READ once the committer takes the sig pair. Forward commit, dual pointer, nothing deleted. |
| `history/layer-placement.ts:33,241-243 captureCollectionSig` (real callers `clipboard.worker.ts:382,449,479,652`, `move.drone.ts:527`) | **NOT MIGRATED, and must not be.** This is composition, not publication: a paste lands a whole subtree through ONE sig appended to a destination parent's `children`, which a flat map cannot supply. Retiring the walk here before register order 151 (a re-homed node keeps identity `sign(name)`; placement is the destination's meta gaining that sig) silently regresses cut/copy/move of a deep-edited, never-navigated subtree to the stale stored sig the doc at `:236-240` already concedes. |
| `history/history.service.ts:2545 sealSubtree` | KEPT. Demoted to a courtesy, and still the reader for every sealed root already in the world. |
| `history/history.service.ts:2727 healSubtreeBags` | KEPT, but loses ALL THREE of its callers. A doctrine WIN: it is the only truth-writing member of the family (`commitLayer`, `:2749`) and its own doc warns it can re-commit a parent's frozen hint OVER a legitimately newer descendant edit. It survives only as an explicit user/repair op, never as an unattended auto-repair. |
| `history/history.service.ts:2496 lastSealFailure` | KEPT; its ONE external reader (`snapshot.queen.ts:117`) stops reading it. |
| `history/seal-preference.ts:47 chooseSealChildHandle` | KEPT FOR NOW. Zero external callers, but it IS exported through `history/index.ts:37` and listed in `essentials-keys.ts`, so retiring it is a public-surface change to the essentials barrel. Retire it WITH `sealSubtree`, never before: the whole hint-vs-bag arbitration is an artefact of a parent carrying child sigs, and a per-author bucket claim IS the head. `scripts/bridge/_susan-hint-check.cjs` becomes dead with it. |
| `history/active-genome.service.ts` | NOT a caller, deliberately, and the PRECEDENT to cite: it already publishes `heads: ActiveGenomeHead[]`, a flat per-lineage head enumeration; its source contract forbids sealing; and `active-genome.service.spec.ts:123,164` PIN the boundary with `expect(sealSubtree).not.toHaveBeenCalled()`. A consumer already chose the flat head list over the walk and guarded it with a test. |
| the RECURSIVE CLOSURE WALKERS — `commands/snapshot.queen.ts#pushClosure:208-232`, `sharing/decoration-closure.ts:80-82 collectSigsDeep`, `sharing/host-sync.service.ts:1348`, `sharing/swarm-adopt.drone.ts:1290`, `sharing/authored-bootstrap.worker.ts:77` | **OWED, and it is the one finding that is not about the map at all.** Every one recurses per edge with a visited set and NO DEPTH BOUND, and hash-checking cannot save them: `sha256(bytes) === sig` proves the bytes match the NAME and says nothing about their SHAPE, while the bytes are chosen by whoever serves them — so THE SENDER PICKS THE DEPTH. In the prototype, ~20,000 chained atoms of a few dozen bytes each (the whole weapon under a megabyte) threw `RangeError: Maximum call stack size exceeded` inside the reader this scheme offers as the listing-free replacement for the seal, and fork refusal reaches the same walk on a FOREIGN author's head, so a hostile peer need not be the publisher under verification. The fix is mechanical and was made in the prototype (`molecule.mjs#pullClosure`): an explicit worklist instead of a call stack, plus a distinct-atom budget (`CLOSURE_ATOM_CAP`) so a reader that stops SAYS it stopped rather than reporting success. `#pushClosure` is already committed above to becoming a flat loop over the map's rows; the other four need the same treatment independently of step 4. |
| `doctrine.spec.ts` | NEW RATCHET owed. `grep -n seal` over the doctrine spec returns nothing today, so nothing stops a tenth `sealSubtree(` call site appearing as callers migrate. Add a frozen allowlist of the current nine that may only SHRINK, modelled on the `not.toHaveBeenCalled()` assertion above. |

Shell impact is nil: `hypercomb-shared`, `-web`, `-dev`, `-cli`, `-sdk` and
`-core` contain ZERO callers; the publish panel only ever sees `here: string |
null` across a `publish:render` payload.

### Residual risk, stated plainly

- **The deploy layer carries `children` verbatim** from the live branch-root
  head rather than a freshened seal, so a client on an older shell build sees
  the pre-seal, leaf-only-commit staleness for descendants edited but never
  re-committed at the parent. Every head's bytes ARE on the host (the per-row
  loop stages strictly more than today's spine). The bounded remedy, if needed,
  is a DEPTH-1, NON-RECURSIVE substitution of the deploy layer's children from
  the map — deterministic and terminating. Recursion there is exactly the seal
  and stays forbidden.
- **The molecule write path does not exist in the repo yet.** Step 3 landed the
  core primitive and the signer, not storage: nothing writes head claims and
  `commitLayer` is still path-keyed (register orders 135-139). In the first
  landing the KEY is `sign(canonName(name))` derived at mint time and a claim's
  `head` is a LAYER sig, not a succession atom. Say so at the top of the writer
  or a reader will expect a succession.
- **Same-generation rivals in my own bucket.** Two devices signing the same
  `seq` are settled deterministically for every third party by
  `resolveBucketHead`, but my own mint-ledger asymmetry prefers what I signed,
  so my two devices can mint two different maps for one molecule set. The
  index's `created_at` monotonicity makes this last-writer-wins rather than
  divergent; it is not silently wrong, but it is not converged either.
- **The visit path still falls back on a forged index.** `fetchHiveManifest`
  collapses every failure to null and `hive-visit.drone.ts:148` then does
  `manifest?.roots[key] ?? bundle.rootSig`, so a host serving a FORGED index
  silently gets the mint-time hint used instead. The publish path refuses; the
  visit path shrugs. This predates step 4 and is untouched by it — but a head
  map makes the asymmetry cover more.
- **Size, deferred not solved.** `HIVE_MAX_BYTES = 65_536` is not hit, because
  only a 64-hex `deploySig` rides the index and the map is a content atom. That
  budget becomes real the moment the index itself becomes molecule-keyed
  (register order 153): at roughly 135 bytes per entry, about 450 molecules per
  publisher.
- **Claim bytes become dual-carrier — and that is permanent rollback
  ammunition.** For listing-free verification a claim must be fetchable as
  `GET /<claimSig>` at the root, not only inside its bucket. Both are written
  and nothing is removed — do NOT "optimise" the bucket copy away, or the
  cold-listing path regresses. Say the other half out loud: `#setHead` sweeps
  the LOSING entries out of my own bucket, but nothing ever removes these root
  copies, so **every head claim a publisher has ever minted stays fetchable
  forever**. That is correct under DATA NEVER HEALS, and it is precisely what
  made a cherry-picked mixture of generations composable at all. The attestation
  refuses the mixture; the ammunition remains, by design.
- **OPEN, AND NO DESIGN CLOSES IT: a whole, genuinely attested OLDER deploy,
  replayed to a COLD reader.** A signature proves authorship and NEVER recency,
  so a host serving a set the publisher really did sign, earlier, forges
  nothing and a verifier must not call it forged. The per-row defence is exact
  but needs memory — `seq` is line six of a signed claim preimage and cannot be
  raised without the secret, so a reader that has ONCE proven generation 2 can
  never be talked back down to 0 — and a cold reader holds nothing to compare
  against, while a cold reader is exactly who a deploy is FOR. What mitigates it
  lives outside this module, in the POINTER: the kind-30564 index is a
  replaceable event whose `created_at` monotonicity the relay enforces. That is
  why the pointer, and not the map, must come from a source with a clock.
  Pinned, failing nothing, as `headmap-skeptic-1 S1-B2` and in
  `head-map.third-party.spec.ts`, so the limit is never mistaken for an
  oversight.

### `remove()` — settled in the same pass, and unrelated to the deploy

`remove()` took a SECOND commit against `signText(canon)` — the GLOBAL molecule
of that name, the same address `/club/people` reads — appending an empty
succession to it on the author's chain, so removing a tile on one page blanked a
live page elsewhere. Four attacks agreed (`skeptic-0 D`, `skeptic-1 A`,
`skeptic-3 S3-E`, `skeptic-4 E`); it looked two-to-one settled only because the
skeptic files do not share a polarity convention — 0 and 4 assert the DEFECT
(a pass reproduces it) while 1 and 3 assert the REQUIREMENT (a fail reproduces
it). Read the assertion message, never the tap bit.

The fix is ONE DELETION: `remove()` touches the INCIDENCE and nothing else,
which is this project's own rule — relations are marks the members wear, never a
parent that holds them. The comment's justification ("the create-reset guard, so
re-creating the name does not resurrect my old subtree") had the wrong SCOPE:
the thing removed is the ENVELOPE, which is per-route; the child molecule is
global. And under this model a name IS one page, so re-creating it and seeing
the same members is the firehose, not a resurrection — it is what a visitor at
the other route saw the whole time. The verb for "gone from my page" is `hide`.
Re-adopting a vertex is already the separate explicit opt-in `revive()`.

Three more defects went with it: `remove` was two commits on two chains while
`undo` rewinds one; the parent commit landed first, so the child commit could
throw the out-of-sync refusal and leave the removal half-applied while reporting
failure; and `remove([], '   ')` routed the child step at `signText('') ===
ROOT_MOLECULE` and erased the whole top page (`skeptic-2 S2-4`). Suite before
the fix: 80 pass / 12 fail. After: 81 / 11, five tests flipping, none
regressing. The head map neither causes nor fixes this — do not conflate them,
and do not conflate it with `skeptic-4 F` (a derived-cache wipe of
`sign('manifests')` destroying the molecule at the same address), which is also
live and also out of scope.

## Prune safety by positive proof, and the format marker (step 1 + step 6, landed 2026-09-03)

Two things landed together because they answer the same question from
opposite ends: *what may this client destroy, and what may it not see?*

### Prune safety — the entry decides, never the directory

`hypercomb-core/src/core/directory-safety.ts` grew three primitives beside
the landed `classifyDirectoryEntry` / `hardDeleteVeto` / `hardDeleteVetoFor`:

| primitive | question it answers |
|---|---|
| `markerName(index)` | may this index BE a marker name at all? |
| `documentSweepVeto(entries)` | is this directory a one-current-document space, and nothing else? |
| `planNamedRemoval(entries, own)` | of the names I minted, which may I remove? |

**`markerName` makes the ceiling inexpressible rather than merely guarded.**
`String(100000000).padStart(8, '0')` is a no-op — nine digits, which every
reader's `/^\d{8}$/` then rejects forever, so the marker is written and
immediately invisible and the next mint re-reads it and stays out of range.
There is no repair path short of renaming on disk. Every minting site now
goes through `markerName` and refuses on `null`.

**A "current document" pool must declare itself IN SOURCE, and the
declaration must be a fact the code can PROVE about the address** — never a
boolean the caller asserts about a directory it does not own. Exactly two
forms are proof, because a tile name can produce neither:

1. a `subKey` — the target is `sign(subKey)` ONE LEVEL DOWN, space this
   caller minted; a molecule address only ever exists at the ROOT;
2. a colon-carrying meaning with word characters on both sides — `lineageKey`
   folds every non-letter/digit to `-`.

A bare word, or a meaning the registry has never derived, is **not** proof
and the sweep does not run. This inverts the registry from a denylist (which
provably cannot enumerate `sign('people')`) into an allowlist that fails
closed on the unknown.

**And the structure must independently agree.** `documentSweepVetoFor` still
runs, and refuses on ANY marker, ANY author bucket, ANY foreign name. Two
conditions, and neither alone may destroy anything.

**No record on disk is ever the authority for a delete.** A manifest inside a
pool is written by a viewer, a replica, or another author, and a half-synced
device holding members whose manifest has not arrived is the NORMAL state of
replication — a widening manifest would delete exactly what it just
replicated. So a manifest may only ever NARROW a removal set, every name it
hands over is still classified individually, and the plan is refused WHOLE if
any of them is a marker or a bucket.

**Deleting is never required for correctness.** `getPoolDoc` returns the first
non-empty member, so a refused sweep costs a stale read; proceeding costs
another participant's molecule, irreversibly. Every refusal carries its reason
to the console — a silent `false` is how the original `/flatten` incident
stayed invisible.

Two live bare-word document writers moved address, each with a READ-ONLY
legacy fallback and nothing deleted at the old address: `overrides` gained a
`sign('i18n')` sub-bucket, and canonical-reference stopped deriving a pool
address from a raw TILE NAME (`canonical:variants`, keyed by `sign(name)`).

The `parseInt` family is closed. The root cause was never the missing regex:
`parseInt('99999999ab3f…', 10)` returns the PREFIX, which is precisely the
input an `isNaN` reject cannot catch, where `Number` of the same name is NaN.
The sanctioned spelling is `classifyDirectoryEntry(name) === 'marker'` then
`Number(name)`, and a doctrine ratchet with an EMPTY allowlist now holds it.

A second ratchet holds prune safety as a DEPENDENCY rather than a pattern — a
recursive `removeEntry` must sit in a file that consults `directory-safety` —
because a dependency is satisfiable by fixing code, whereas a pattern firing
on sites that are safe by other means can only be satisfied by growing an
allowlist. It scans two surfaces the `.ts`-only `SCAN_DIRS` never reached:
`scripts/` and `hypercomb-relay/`, which between them hold ~35 verbatim
copies of a full OPFS-root wipe.

### The format marker — turning silent divergence into a sentence

There is **no dual-pointer migration**. New writes will go to new addresses;
old data stays readable where it lies. The consequence is that an older client
stops seeing new content, silently. The marker is what makes that legible.

Two constraints shape it:

1. **It ships BEFORE the change it protects against.** A client that predates
   the check cannot report anything, so it lands now, while the format is
   still the old one and `SUPPORTED_FORMAT_VERSION` is still `1`. That
   constant moves in the same change that first writes the new addresses —
   never earlier, or every hive reports `ahead-of-hive` and the participant
   learns to ignore it before it has said anything true.
2. **It is readable by a client that does not understand the new format.**
   Plain JSON, in the OLD format, in places old clients already read:
   * `sign('format:hive')` — a colon-scoped root pool holding ONE member;
   * a reserved `format:hive` key in the kind-30564 hive index, so a VISITOR
     sees it before adopting.

The index key is a **roots key**, not a top-level content field: `putHiveManifest`
re-serializes `{ v, roots }` and drops everything else, so a top-level field
would be erased by the very next publish from any client — the exact silent
divergence the marker exists to prevent. And a roots VALUE must be 64-hex or
the whole index is rejected as malformed, so the key points at a
content-addressed declaration rather than carrying a number.

`core/format-version.ts` is the comparison: zero dependencies, no semver, no
clock, two integers and `<`. Four verdicts, of which exactly one speaks:

| verdict | when | announces |
|---|---|---|
| `undeclared` | no record, or unparseable — every hive that exists today | no |
| `readable` | `minReader <= supports` | no |
| `ahead-of-hive` | this client is newer than the hive | no |
| `unreadable` | `minReader > supports` | **yes** |

The one sentence names both numbers, names the date the format moved, and
states the consequence as MISSING CONTENT — never as damage, and it offers no
fix, because the remedy is a newer client or the other device.

**It fails OPEN, and that asymmetry is deliberate.** `hardDeleteVetoFor` fails
CLOSED because its power is to DESTROY. This marker's only power is to WARN,
so an absent, unreadable or incoherent declaration means *say nothing*.
Hardening it into a gate would build a lockout any corrupt byte could trigger.
An incoherent `minReader > format` is clamped rather than rejected, so a typo
in a foreign hive's record cannot lock a client out of a hive it can
demonstrably read; unknown extra fields are ignored, because an older reader
surviving a newer record is the entire contract.

Monotonicity lives in `advanceFormat`, a pure function that returns `null` for
a downgrade or a no-op — the underlying pool write is unconditional
last-write-wins, so making a downgrade *uncomposable* is what stops an older
device silently turning the warning off on every client.

The surface is the EXISTING sticky toast (`toast:show`, `duration: 0`, no
action buttons — nothing this client can do about it from inside the app). No
new component, no barrel line, no `app.html` tag, and no `side-effects.ts`
edit: `hive-format.ts` is reached transitively through
`update-scout.service.ts`, which `side-effects.ts` already imports.

**The marker's own storage shape is frozen forever.** One sig-named member in
a colon-scoped root pool, plain JSON. Anything new goes in ADDITIONAL fields
of the same record. If a later format change ever relocated or re-shaped the
declaration itself, it would become unreadable by exactly the clients it
exists to warn.

## Artifacts of the decision

- Prototype (node:test, zero deps, purist design by mandate): session
  scratchpad `molecule-lineage/` — workflow `wf_3faa54bf-36d`.
- Contention register: `contention-register.{json,md}` in the same scratchpad
  — workflow `wf_93b8a5f0-9f9`. Both are to be moved under
  `documentation/` once they land.
- Memory: `project_hypergraph_molecule_lineage.md`.

Related: `known-location-pools.md` (colon rule — to be re-read per above),
`pools-across-hosts.md`, `website-artifact-paradigm.md`,
`history-sigbag-as-root.md`, `signature-algebra.md`.
