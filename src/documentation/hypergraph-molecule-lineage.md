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

## Ordering — "just have a meta lineage"

The SET is unordered and shared. Order is a point of view, and every point of
view is content-addressed:

```
<root>/<sign('people')>/
    <memberSig>         the set — who is a person (atoms), shared by everyone
    <metaSig>           ordered snapshots — {name, children:[…], refs:[…]} atoms
    0000 … 000x         ONE mutable pointer per participant: the latest meta
```

A layer already IS the meta lineage — `{name, children:[sigs]}` — verbatim. No
new shape. Tenant A's order and tenant B's order are two atoms in the same
directory; neither clobbers the other. There is **no global head**; only
participants have sequences.

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
