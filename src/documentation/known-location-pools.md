# Known-location pools — user vocabulary lives one level down

**Status: PARADIGM — pinned 2026-07-21 (Jaime).**
Companions: `pheromones.md` (marks and namespaces), the pool registry
(`hypercomb-core/src/core/pool-registry.ts`), and the bare-word ratchet
in `doctrine.spec.ts`.

## The problem this solves

The OPFS root is an **untagged union**. Three species share one flat
namespace of 64-hex names, and nothing on disk says which is which:

- content sig files — `sha256(bytes)`
- lineage sigbags — `sha256(lineageKey(segments))`
- pools of meaning — `sha256(meaning)`

For a **bare-word** meaning the bag and pool preimages are byte-identical
(`lineageKey` preserves letters/digits), so `sign('clipboard')` IS the
history bag of a root tile named `clipboard`. Verified live:
`sign('websites')` == the `/websites` launcher bag. This is not
theoretical — an unguarded `/flatten` at a colliding address hard-deleted
the pool's members (reproduced and fixed 2026-07-21; see the guard in
`HistoryService.#quarantineNonLayerFiles` and
`pool-bag-collision.spec.ts`).

Two structural facts make the root unfixable by bookkeeping alone:

1. Any module may mint a pool — no fixed list of meanings is ever
   complete (four drifted copies existed before the registry).
2. Users may name a root tile anything — no bare word is ever safe.

## The paradigm

> **The root vocabulary is closed and developer-defined. User-generated
> names live one level down, always scoped inside a known location.**

A *known location* is a colon-scoped **meaningful behavior pool** —
`sign('websites:menu')`, `sign('hives:names')`, `sign('usage:dwell')` —
whose address is derived at runtime, registered by derivation
(`Store.poolSignature` / `registerPoolMeaning`), and collision-proof by
construction: `lineageKey` folds every non-letter/digit to `-`, so no
location can ever produce a colon.

Inside a known pool, **position answers membership**. Every child of
`sign('hives:names')` is unambiguously a hive entry — no registry, no
tag, no heuristic needed to classify it. The disambiguation problem that
poisons the root simply does not exist one level down, because the
parent's meaning types its children. User vocabulary (hive names, site
names, tag names) is unbounded — and that is fine, because it is minted
in a namespace where nothing else lives.

## Marks classify; they never resolve

Members of a known pool may additionally carry a pheromone/decoration
(the shipped example: the `website` tag stamped on site roots by
`websites-group.ts`'s `#ensureWebsitePheromone`). The division of labor
is strict:

- **Addressing resolves.** The pool position says *what kind of entry
  this is*. That is structural and unambiguous.
- **Marks classify.** The tag says *what this entry is for*, after it is
  already resolved — which is what makes members **multi-purpose**: the
  same layer can carry `hive` and `website` and anything else without
  the usages infringing on each other, because no usage owns the
  address. A mark can never be asked to disambiguate an address (a label
  on one directory cannot make it be two things — that was the root
  collision's lesson).

Filtering the swarm, building the hive listing, scoping a logical swarm
relationship — all of these read the marks, through each participant's
own nose (`pheromones.md`). None of them read the address for meaning
beyond membership.

## The collision is SOLVED only by pheromones (Jaime, 2026-07-21)

The structural machinery above is **local**. The pool registry is
compile-time code, the ratchet is a test, the colon is a spelling — your
own client knows what `sign('clipboard')` is; **a swarm peer cannot
consult any of it**. When a peer receives a root or derives an address,
the only portable answer to "what is this, what is it for" is a signed
mark riding the mesh: attributable, propagated, readable through any
nose. Structure guards one machine; marks are the only classification
that crosses machines. Without pheromones doing the filter there is no
logical swarm relationship and no hive listing — the distributed half of
this paradigm has no structural substitute.

The deeper statement: the collision class existed because **meaning was
encoded in addresses**. Bare-word pool names put system meaning into the
same flat hash space where user names carry their meaning — two
meaning-carriers, one namespace, collision inevitable. Pheromones move
meaning out of addressing entirely: addresses only resolve, marks only
mean, nothing competes for names. So the precedence is:

> **Guards make the collision survivable. Colons make new ones
> impossible. Pheromones make the whole class meaningless — and are the
> only layer of the answer that travels.**

Marks-first, with structure as local scaffolding — not the reverse.

## Reference implementation: websites (shipped)

- Pool: `sign('websites:menu')` (`hypercomb-shared/core/websites-pool.ts`
  — note the colon, chosen for exactly this reason).
- Mark: author-tier `website` decoration on each site root
  (`hypercomb-shared/core/websites-group.ts`) — idempotent, in the
  merkle closure, travels with adoption.
- Consumer: the `/websites` aggregation layer reads members + marks;
  the pool is derived caches/menu state, never truth.

## Worked example: hives (NOT BUILT — design sketch; Jaime, 2026-07-21)

- Pool: `sign('hives:names')` — never bare `'hives'` (the ratchet
  rejects it; legacy IndexedDB `'hives'` tables are unrelated). The
  spelling says what the pool holds: NAMES.
- **A hive is a NAMED thing — position-free. The entry is
  `name → sealed head`, and lineage is NOT in it.** The names live in
  the hives pool as per-hive sub-pools — `sign(hiveName)` one level
  down, the paradigm applied recursively, safe because position types
  them. Do NOT confuse this with `HiveManifest.roots:
  Record<lineageKey, sealedHeadSig>` (`hive-pointer.ts`): that is the
  VISIT protocol, keyed by lineage because you are browsing a specific
  host's tree, where the host's paths matter. The registry is the
  opposite: baking a lineage into a hive entry would anchor the hive to
  a position in somebody's tree — exactly what a *named* hive exists to
  not have. Name + head is fully portable; every participant mounts it
  wherever they like.
- **Lineage is TEMPORAL — session-lived, mesh-carried, never stored.**
  You start logically in your hive: lineage is minted at ENTER,
  hive-relative, and matters only for where you go from there. During
  the session it IS passed around — riding the mesh as session
  metadata so peers can show and find information at your position
  (the ephemeral half of broadcast, like the ~90s events in
  `pheromones.md`) — but it never LIVES in metadata: not in a layer,
  not in the pool, not in history. It evaporates with the session.
  Persistence follows the viewport doctrine; transmission follows the
  mesh's ephemeral half — lineage is shared, then gone. The walk is
  the data; your position in the walk is you, for exactly as long as
  you are there.
- **`children` is the only structural property.** Below the entry a
  hive is just layers: follow `children` down; each child layer's own
  `name` is the source of truth (never duplicated into the pool). No
  hive manifest schema, no membership lists — the layer primitive
  already IS the manifest (aggregations are layers; layers compose
  recursively).
- **Relatedness is MARK-defined, not path-defined.** Only related
  tiles carry the hive's required pheromones — the pheromone filter is
  the hive's membrane, so its logical extent can span or exclude
  regardless of tree shape. No lineage-based membership could do this;
  it is the "logical swarm relationship" made concrete, and the
  portable half of the design (see above).
- The pool holds names + heads + derived state ONLY, read-through to
  the layers: if structure changed, the pool must never know better
  than the walk.

### Entering is re-rooting (worked walkthrough)

**"Root" is session-relative — the hive you entered IS the root.**
Standing at the root of hypercomb.io is not an absolute position; it is
the default hive you start in. Entering your own hive and entering
someone else's is the same operation.

Dylan opens *Dylan's Cigar hive*:

1. **Enter** — name looked up in `sign('hives:names')` → sealed head.
   No lineage in this step.
2. **Anchor** — the session roots at that head. Experientially
   identical to the root of hypercomb.io: same walk, same chrome,
   nothing special-cased.
3. **Navigate** — "what's available" is the ordinary walk: `children`
   off the head layer, names from the child layers, availability
   filtered through the hive's required pheromones. Lineage mints per
   step, relative to THIS root.
4. **Show** — sharing a position mid-session sends the lineage over
   the mesh ephemerally; a peer walks to it; nothing lands anywhere.
5. **Leave** — the lineage evaporates. The hive remains name + head,
   position-free, waiting.

### Meeting the same hive from different places (no parameter on the hive)

The same hive can be referenced from many places, and the reference
must stay a bare `name → head` — **no entry-context parameter**. The
moment the reference carries context, the hive is re-anchored to
positions, and the two things position-freedom buys are gone: dedup
(the same hive met twice would mint two identities) and O(1) same-hive
detection (root compare only works on a pure reference).

State DOES matter at enter — the resolution is WHOSE state it is:

| Question at enter | Home | Lifetime |
|---|---|---|
| What is this hive? | name + head (pool) | durable, invariant across meeting places |
| Where should this door open? | the REFERENCING tile (alias/reference primitive) | durable, referrer-owned |
| How did I get here / where is back? | session lineage | temporal |
| What shows inside? | the hive's own required pheromones | the membrane — never inherited from outside |

- **Approach = session.** Two encounters of one hive are one identity,
  two cursors. The back-stack and breadcrumb are session lineage.
- **Door customization = the pointer, never the pointee.** A meeting
  place that should open the hive at a sub-location stores that on its
  own referencing tile — like a URL fragment, invisible to the target.
- **Filters do not follow you in** (the entrance-scoped filter rule):
  entering lands on a normal, unfiltered page; what is visible inside
  is the hive's own membrane. Same hive, same face, from every door.

Differentiating same-kind collections at different depths (staff
`people` at the root vs friends' `people` nested) is the scoped-sniffing
mechanism — queries are (kind, scope), nearest-enclosing wins, the
pheromone lineage is derived by reading the walk: see *Scoped sniffing*
in `pheromones.md`.

## The rules (enforced where possible)

1. **Every NEW pool meaning carries a colon.** Ratchet-enforced
   (`doctrine.spec.ts`); the bare-word set in `pool-registry.ts` is
   frozen and may only shrink, via drained migrations.
2. **User-generated names never mint root-level addresses for system
   purposes.** They live inside a known pool.
3. **Derive addresses, never hardcode hex.** Deriving registers the
   meaning; the registry is how root-walkers tell pools from bags.
4. **Marks classify after resolution; they never resolve.** Multi-use
   is a feature of this rule, not an accident.
5. **Pools hold derived/membership state, never truth.** Truth stays in
   layers (`optimize-phase.md`, POOL vs BAG doctrine).
