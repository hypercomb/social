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
   succession  {succession:1, name, author, prev, members:[envelopeSig…], at}

<root>/<sign(canon(name))>/           MOLECULE — the only directory a tile gets
   <sign(author)>/<headSuccessionSig>     ONE zero-byte entry per author
```

- **The succession atom IS the meta lineage** — an ordered list of member sigs
  plus `prev`. `members` order is committed by the sig (canonicalization sorts
  keys, never elements). The numbered marker directory disappears; `prev` is
  the chain.
- **One head pointer per author** (`sign(name)/sign(author)/<headSig>`,
  written new-before-old). A succession has exactly one appender by
  definition; a name has as many appenders as tenants — the per-author bucket
  is what reconciles those two facts. Without it the model is unsound; this is
  the skeptic's one real objection and its answer.
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
- **The seal is derived** — `{kind:'seal', molecule, head, children:[sealSig]}`
  minted only in the optimize phase, keyed by the heads it folds,
  complete-or-absent, never load-bearing.
- **The mesh keeps (room, secret)**: `sha256(canon(name) ␀ room ␀ secret)`.
  A channel that is `sign(name)` verbatim would receive every `people` on the
  relay. Unanimous across all three designs.
- **One canonicalization rule everywhere**: `canonicalizeLineageSegment` (NFC,
  non-letter/digit runs → `-`, edge hyphens stripped).
  `controls-bar.component.ts:1158` and `mesh-modal.component.ts:139` hash a
  RAW join today and already disagree — fix both.
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
