# Pheromones — living signals over dead labels

**Status: DESIGN — pinned 2026-07-09 (Jaime). Not built.**
Companions: `public-content-endpoint.md` (the shelf this curates),
`optimize-phase.md` (where fields are minted).

## Pheromones ARE the sharing layer (Jaime, 2026-07-09)

Sharing has two halves: the shelf makes content AVAILABLE (receipts,
bytes-before-broadcast); pheromones make it FOUND. A deposit is the
copyless share — mark a tile and everyone whose filters trust your
nose now finds it, while it stays where it was: one copy, one sig,
still the author's. No reposts, no feeds — paths worn by walking. The
mesh's ~90s events are the ephemeral half of broadcast; trails are the
durable half, persisting exactly as long as anyone keeps caring.
Roadmap consequence: the share switch and the mark verb are two hands
of one gesture — design them within sight of each other.

## The idea, verbatim

Tags are what an author says once. Pheromones are what the swarm keeps
saying: signed deposits on a sig, with **depositor, intensity, and decay**.
The community's refinements accumulate into each participant's filters —
curation without moderators, exactly how a colony does it (stigmergy).

## Why this answers pollution

The public shelf is storage-neutral (quota + expiry + revocation handle
abuse of *bytes*). Pollution is a **discovery** problem: what gets
surfaced, followed, recommended. Pheromones solve it economically, not
administratively:

- **Evaporation is the cleaner.** A trail nobody reinforces fades from
  every filter on its own. Junk doesn't need takedowns — it needs to be
  ignored. Spam must re-deposit continuously, spending quota and burning
  an identity that filters learn to discount.
- **Negative pheromones are the same primitive** — "spam", "tampered",
  "nsfw" marks. A BUD-09 report IS a negative deposit. One mechanism,
  both directions — but NOT symmetric in failure, and the negative
  direction needs a reserved vocabulary. See *Reserved negative
  vocabulary* below.

## Storage model (Jaime, 2026-07-09): histories in `sign('pheromones:deposits')`

Pheromones are NOT a new storage primitive. They are **histories** — the
same append-only sigbag lineages as everything else — living in the
`sign('pheromones:deposits')` pool of meaning:

```
<opfs root>/<sign('pheromones:deposits')>/<lineage-per-target>/0000, 0001, …
```

- One lineage per target; each **deposit appends one marker** referencing
  a sig-addressed deposit record (signed event bytes at the content root
  — signature-reference doctrine, never inline).
- The trail IS the history. Intensity and decay are **read-time
  evaluations** over the deposit chain — evaporation never rewrites or
  deletes markers; append-only stays sacred, the trail fades by
  evaluation.
- Time-travel free: "what did the swarm think of this last month" is
  just reading the history at a cursor, like any lineage.
- Sharing/merging free: histories are already the merkle-shareable
  primitive — peers exchange pheromone lineages like any other, merged
  under the existing marks+merge model.
- Aggregated per-sig fields remain derived caches (optimize phase),
  keyed by the history HEAD sig — changed history = new head = automatic
  invalidation.

**Why not an array in the layer** (considered 2026-07-09, rejected for
truth / kept for reads): a layer is AUTHORED truth — strangers' deposits
would need the author to commit them (gatekeeping their own reputation),
every deposit would mint a new layer sig (identity churn with other
people's opinions as the commits), and decay would mean perpetually
rewriting history.

Note there is no "metadata" escape hatch: `decorations` (like `notes`,
`tags`, `properties`) is an ordinary SLOT — a top-level field of the
canonical layer JSON — so it is inside the signature like everything
else. The cost is therefore not merely churn on that tile: changing a
slot changes the layer sig and **the merkle cascade re-signs every
ancestor up to the root**. One stranger's deposit on one deep tile would
rewrite the author's whole spine, and decay would do it forever with no
user action. Author-written marks in a slot are fine precisely because
the author IS the writer and the tempo is authoring commits — that is
what a tag already is. This is the layer-purity rule: community signal is
external to the layer, like every optimization. The array shape
consumers want DOES exist — as the derived-cache field keyed by layer
sig, minted in the optimize phase from the deposit histories: looks like
`pheromones: [...]` beside the layer, is never truth. The author's own
labels stay in-layer as today: a tag IS the author's pheromone with no
decay.

**Canonical meaning string: `'pheromones:deposits'`** — fix the spelling
once and forever. `sign()` of a typo mints a different pool address for
eternity; derive at runtime via
`Store.poolSignature('pheromones:deposits')`, never hardcode the hex.
The colon is load-bearing, not style: a bare `'pheromones'` would hash
to the same address as a root tile named `pheromones` (lineage bags and
pools share the flat root namespace — see `known-location-pools.md`),
and the doctrine ratchet in `doctrine.spec.ts` now rejects any new
bare-word meaning at build time. Spelled with the colon from day one,
this pool can never collide and never needs a migration.

## Mapping onto existing primitives (nothing new invented)

| Pheromone piece | Existing primitive |
|---|---|
| Deposit | signed event/decoration referencing the target sig — publisher sig authoritative, every deposit attributable |
| Kind | the tag taxonomy (tags = decoration kind 'tag') gains intensity + decay; a classic tag ≡ author's pheromone with no decay |
| Evaporation | the grant/expiry lease pattern applied to signals |
| Field (aggregated intensities per sig) | **derived cache** — pure derivation of deposits, keyed by input sigs, minted in the optimize phase, wipe-safe, NEVER truth (litmus: cold client rebuilds from deposits alone → optimization-class) |
| Filter | participant-local blend: which kinds count, whose deposits count, thresholds — never global, never in history |
| Trails feeding layout | meaning-curved geometry + proximity warming can read intensity later |

## Global field, local noses (Jaime, 2026-07-09)

Pheromones are GLOBAL — one shared environment, like a forest floor:
deposits propagate to everyone, the field is universal. Reading stays
participant-local (filters, trust blends): global substrate, local
interpretation — never global consensus, which would be moderation in a
costume. Mechanics are free: deposits are tiny signed records riding the
mesh like any event; append-only histories union-merge commutatively
(the marks+merge model); the public endpoint shelves deposit records for
cold reads. Scoping rule: **a pheromone inherits the tier of its
target** — public content's trails are global (CDN + relays), swarm
content's trails stay host-anchored. Going global promotes the sybil
rule from advisory to load-bearing.

## Array vs folder — the decision rule (generalizes beyond pheromones)

Six questions; one right-column answer pushes the whole datum to the
pool/history side:

| Question | Array (in layer) | Folder (pool/history) |
|---|---|---|
| Who writes it? | author alone | many writers |
| Changes content identity? | yes — part of what it IS | no — it's ABOUT the thing |
| Tempo? | authoring commits | ambient/decaying/counted |
| Travels with adoption? | intrinsic, in the closure | extrinsic, per context |
| Cold-rebuild test? | it IS truth | derivable → cache pool; else own pool of meaning |
| Attribution? | author vouches once | per-record signatures |

Deposits lose on every row → folder-level, settled. Array-level
residents win every row: the author's own tags, and the derived
read-shape field (an array that only LOOKS in-layer).

The whole table collapses to one question, because **a layer is a
container for sharing** (Jaime, 2026-07-09): *is this part of what I'd
hand over?* In the container: what you're giving. Outside: everything
about the shipment that isn't the gift. Open (and
legitimately array-level if ever wanted): an author-declared hint of
invited pheromone kinds — one writer, deliberate, travels, is truth.

## Consumer contract (Jaime, 2026-07-09)

Two verbs, no routing decisions:

- **View** — any surface (community portal, host portal, tile panel)
  reads the derived pheromone field through its own filter blend. Same
  deposits everywhere, different noses per portal.
- **Mark** — the consumer deposits on a tile; the deposit routes ITSELF
  by the target's tier (public → global field; swarm → that host's
  trails). Never a location choice, same doctrine as the share flow.

Every mark is a signed record from the depositor's key — cheap for a
person, expensive for a spammer.

### Active namespaces (Jaime, 2026-07-21) — a VIEW setting, never truth

Kinds are namespaced by domain (`jwize.com:website`, …) — namespace =
domain = identity, the same convention as the `jwize.com:*` intent tags.
Fully qualified names are correct but unreadable in bulk, so the
pheromone window carries a set of **active namespaces**: a kind in an
active namespace renders by its LOCAL name (`website`), everything else
stays fully qualified.

- **Deposits always store the fully-qualified kind.** Collapsing is a
  rendering step over participant-local view state — never in the
  deposit, never in a layer, never propagated, never in history (same
  doctrine as viewport).
- **Ambiguity never silently shadows.** If two active namespaces both
  define `website`, that local name reverts to fully qualified for BOTH.
  Never guess a winner, never let activation order decide meaning.
- **Colour is derived, not configured.** Hue from the namespace string
  itself (hash → hue), so the same namespace reads the same colour for
  every participant with zero config and no palette drift between peers
  — the same spirit as deriving an address instead of registering one.
- **Colour is never the sole carrier of meaning.** It separates
  namespaces at a glance; the name still carries the meaning, and the
  fully-qualified form stays available on inspect.

**Hard interaction with the reserved negative vocabulary (below):**
active-namespace collapse is a convenience over the FILTER surface, and
reserved kinds sit OUTSIDE the filter blend. A reserved kind must
therefore always render, always fully qualified, and must never be
collapsible, recolourable-into-invisibility, or hidden by a namespace
being inactive. Otherwise the namespace switch becomes a way to hide
"tampered" — the exact failure the reserved set exists to prevent.

### Scoped sniffing — the pheromone lineage (Jaime, 2026-07-21)

The same kind legitimately appears at different depths: `people` at the
hive root (staff) and `people` nested under a friends area. Kind alone
cannot differentiate them; raw position must not (position is not
portable truth). The mechanism is **scoping**:

- **A query is (kind, scope), never kind alone.** Scope anchors at the
  SESSION position — where you stand decides where sniffing starts,
  which is exactly the session-relative half of the design (lineage is
  temporal; the anchor is your cursor).
- **The pheromone lineage** of a candidate is the ordered chain of
  marks along the walk from the anchor to it — accumulated by READING
  the intervening layers' own tags. Staff resolve as
  `[hive]→[people]`; friends as `[hive]→…→[friends]→[people]`. The
  chain is what filters select on.
- **Resolution defaults to nearest-enclosing wins** — lexical
  shadowing: from the nested collection, "show people" finds friends;
  staff at the root are shadowed unless the scope is deliberately
  widened. No new mental model.
- **Derived, never stored, never stamped.** No tile carries its chain
  (the application-scope rule: scope is read by walking, never stamped
  on descendants). Results are READ PROJECTIONS (the relations
  verdict: edge lists are projections; children-by-pheromone is
  rejected as truth). Truth stays the layers' own tags + `children`.
  Cacheable in the optimize phase keyed by the path's head sigs.
- **The chain is AUTHOR-TIER only — deposits weight candidates, never
  the chain.** Scoping structure (staff here, friends there) is
  authored structure, read from each layer's own tags. If community
  deposits participated in the chain, strangers could re-scope a
  hive's collections from outside — the child-pheromone rejection all
  over again. Division of labor: the layer supplies the author's
  marks (data, in the closure); the deposits pool supplies the
  community's (data, external); the NOSE does the filtering — the
  layer never filters anything, it doesn't know who is looking.
- **Where the script gets in:** the collections/aggregation surface.
  An aggregation is a layer; its member rule evaluates the scoped
  query at render, from the session position. Entering a result still
  lands on a normal, unfiltered page (the entrance-scoped filter
  rule).

### Referencing BY pheromone (Jaime, 2026-07-21 — the capstone)

A reference can be a REQUIREMENT instead of an enumeration: a
collection references "whatever carries these marks, from here" —
kind + scope — rather than a list of members. (This is the
"author-declared hint of invited pheromone kinds" the array-vs-folder
table already marked as legitimately array-level: one writer,
deliberate, travels, is truth.)

- **The requirement is truth; the result is projection.** The needed
  kinds live as an author-tier field on the REFERENCING layer — in the
  closure, travels with adoption. The resolved membership is a
  read-time projection, never sealed into anything.
- **Living references.** Tag a new member and every requirement
  reference includes it at next read, zero commits to the collection.
  An enumerated list is a snapshot; a pheromone reference stays alive.
- **Adoption re-resolves.** An adopted collection carries the RULE,
  not a frozen membership — it evaluates against the adopter's own
  hive, their walk, their nose. Intent travels, never cargo (the same
  invariant as the waggle dance and scout intention expressions).

The reference vocabulary, weakest binding to strongest:
1. **by requirement** — kind + scope, living, session-anchored
2. **by name** — a hive entry, durable, position-free
3. **by sig** — exact sealed content, immutable

## Sybil discipline (the one hard rule)

Raw deposit-count is spammable for free. Intensity must be weighted by
relationship, not volume: vouches, adopted-from lineage, domain
reputation, and each participant's own trust blend. A thousand fresh
pubkeys shouting = one stranger whispering.

## How a mark is found (Jaime, 2026-07-21): anchor-first, never enumerated

Marks are **not searched for. They are propagated, then encountered.**
Two phases, and neither is a query:

1. **Push — the deposit rides the mesh.** A signed deposit routes itself
   by the target's tier (public → global field; swarm → that host's
   trails). Peers whose noses trust the depositor now HOLD it locally,
   merged like any other history under marks+merge.
2. **Pull — O(1) anchor lookup.** On arriving at a target by any route,
   a client derives that target's trail address from its lineage key and
   reads the bag. No index, no scan, no query. The mark is simply already
   there. This is "paths worn by walking". In practice a renderer reads
   the **derived `pheromones: [...]` field keyed by the layer sig** (see
   *Why not an array in the layer*) rather than the deposit chain — which
   is the same anchor-first move: the key IS the lookup, so no in-layer
   pointer field is needed (and none may be added — a pointer would put
   strangers' deposits back inside the layer identity). That field is a
   LOCAL projection over deposits already held: it makes marks
   **renderable, not findable**.

**The invariant: a consumer needs an ANCHOR, not a term.** Meaning is
**receptor-relative** — a nose only reads kinds it already holds, so an
unknown kind is not lost information, it is *not a signal for you*
(stigmergy: receptors, not an index). This is exactly why there is no
enumeration endpoint and no global "list all kinds" — that would be a
spam amplifier: invent a kind, get surfaced for free. A scout entering a
foreign swarm is not a counter-example: it doesn't know the vocabulary,
but it still reads **down from the root it entered**, harvesting kinds
from targets it can name. Local harvest, never global enumeration.

**The one-way gap — why pheromones alone cannot bootstrap discovery.**
A trail is addressed `sha256(lineageKey(target))`, which is one-way. A
received deposit therefore names a target you may be unable to RESOLVE:
you learn *that* some address carries a mark, not *which* tile it is or
how to walk there. Enumerating the pool yields opaque 64-hex keys. A
deposit is cargo at rest; it carries no directions.

**The waggle dance closes it.** A route carries the *preimage* — already
shipped as `HiveManifest.roots: Record<lineageKey, sealedHeadSig>`
(`hive-pointer.ts`), flown by `hive-visit.drone.ts`. `lineageKey` is
precisely the inverse that converts an opaque trail address back into a
walkable location. So the two primitives are complementary and neither
substitutes for the other:

> **deposit = "this is worth something" · dance = "here is how to reach it"**

Design consequence: any surface that offers "everything carrying X" is
built from deposits the participant ALREADY HOLDS, over targets they can
already name — their own tree plus routes danced to them. It is a local
projection, never a network query. And the invariant transfers intact:
**no nectar, no dance** — never publish a route to bytes that aren't
there.

## Reserved negative vocabulary (Jaime, 2026-07-21 — the second hard rule)

Receptor-relative meaning (above) is right for the positive direction.
**It inverts for warnings.** The two directions fail differently:

- a positive kind you lack a receptor for fails **safe** — you miss a
  recommendation;
- a negative kind you lack a receptor for fails **OPEN** — you consume
  something the swarm already flagged, and inertness is precisely the
  wrong default for "tampered".

So negative kinds cannot be receptor-relative. There must be a **small,
frozen, well-known set every nose is REQUIRED to hold and evaluate**,
independent of the participant's filter blend — the one place the field
is not opt-in. Keep it minimal (a large reserved set is itself a censorship
surface, and every entry is a term the whole network must agree on
forever): start with integrity and safety marks that a consumer could not
rationally want suppressed, and let everything editorial stay opt-in.

Consequences to honour when building:

- **Evaporation still applies, but a reserved-kind trail must not fade
  into invisibility while unrefuted** — decay tunes intensity, not
  whether the mark is evaluated at all.
- **Sybil discipline is MORE load-bearing here**, not less: a mandatory
  vocabulary is the highest-value spam target in the system (a cheap
  "tampered" deposit becomes a censorship tool). Reserved kinds need the
  strictest relationship weighting, and a reserved deposit from an
  unvouched stranger must not be able to bury a work on its own.
- **Reserved ≠ authoritative.** The mark is evaluated, not obeyed; the
  consumer still decides. This is a floor on *attention*, not a verdict.
- Unknown kinds outside the reserved set stay inert, as above — this rule
  carves out an exception, it does not reintroduce a global vocabulary.

Open: the exact member list, and whether a reserved deposit is
counter-markable (an author's "disputed" reply riding the same trail).

## Not now

Build after the public write path + share UX land. First slice when it
comes: deposit event shape + per-sig field in a derived-cache pool + one
filter consumer (discovery surface), negative-kind included from day one
— with the reserved set defined in that same slice, since retrofitting a
mandatory vocabulary after noses ship is a breaking change for every
consumer.
