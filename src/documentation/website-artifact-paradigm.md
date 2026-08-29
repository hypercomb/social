# The website artifact paradigm — atomic artifacts, related by decoration

> Never mint a parent to hold a view's members. Make every artifact atomic,
> make ONE artifact that names the relation, and relate them with a decoration.

This is the shape all forward feature work takes. It is not a slides quirk; the
slide model is only the first instance.

The relation itself lives in one place and belongs to no behaviour:
[pheromones/enrollment.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/pheromones/enrollment.ts),
driven by one verb, `/enroll`. A website, a slide, a photo, a page and a workflow
step all enrol the same way, into the same kind of set.

## The rule

1. **Every artifact is atomic and standalone.** It carries what it says and
   nothing about anyone else. Delete any other artifact and it is still valid.
2. **No artifact depends on another.** There are no parent artifacts, no
   container artifacts, and no artifact whose meaning is "the box the others
   live in".
3. **The relationship is a decoration.** Membership is a mark worn by each
   member — a pheromone, readable by anyone holding the signature.
4. **One artifact names the relation.** A *website artifact* is an ordinary tile
   that holds the group's identity. It is a PEER of its members, never their
   container.
5. **A second face is a second VIEW, not a second container.** When an artifact
   needs to be seen another way, split the artifact into views on itself.
6. **A set has no member TYPE.** Enrolment is type-agnostic, so a photo, a slide
   and a nested site sit in one set and none of them knows about the others. A
   view asks the set for the kinds it can render and ignores the rest.
7. **Sets nest by enrolling, not by containing.** A website artifact enrolled in
   another website is expanded in place by whatever renders it — a site of
   sites, with no site owning any other.

## Why this is the Life Primitive

The [Life Primitive](../hypercomb-core/src/core/life-primitive.ts) is exactly
this shape one level down. Every reference is a META ENVELOPE carrying exactly
**one** typed payload hop (`layer`, `resource`, `dependency`, or `bee`):

```
meta → layer → meta → layer → …
```

An artifact therefore never reaches sideways into another artifact's internals.
It names one thing, through one typed incidence, and everything composes by
alternation — so any referenced feature can become the root of another tree
without knowing it was ever part of one. Connected to everything; dependent on
nothing.

The relation half is the same idea. A group signature is
`sha256('group:' + meaning)` — a declared REFERENT
([edge-registry.ts](../hypercomb-core/src/core/edge-registry.ts)), meaning *no
bytes exist behind it on any host, by construction*. Every precise closure
walker skips it. **The relation carries no cargo**, which is precisely what
makes relating two artifacts unable to make one depend on the other. Membership
that had to carry bytes would be a dependency wearing a mark's clothes.

So: the Life Primitive gives the artifact a spine with no dependencies, and the
group signature gives the relation no weight. Between them, a hive of atomic
artifacts can be arbitrarily connected and still come apart cleanly.

## The three records

| Record | Kind | Worn by | Says |
|---|---|---|---|
| Membership | `group` | every member, artifact included | `{ sig, meaning, order? }` |
| Identity | `visual:<x>:artifact` | the website artifact | `{ groupSig, meaning, name }` |
| Content | `visual:<x>:<member>` | each member | its own payload, `content` → meta envelope |

**Meanings are scoped and MUST carry a colon** — `site:pitch`, not `pitch`.
`lineageKey` folds every non-alphanumeric to `-`, so a preimage with a colon can
never be produced by a location: a group signature is collision-proof against
lineage sigbags and pools of meaning by construction. `sign()` of a new spelling
is a different group forever, so normalize the name *before* minting.

## Where an attribute goes

The hardest question in practice, and the one that decides whether artifacts stay
independent:

- A fact about the **thing** → its own content record. *"This slide is a picture
  of the funnel."*
- A fact about the **relation** → the group mark. *"This slide is third in the
  pitch."*
- A fact about the **website** → the artifact record. *"This presentation is
  called pitch."*

Position is the canonical trap. Putting `order` on the member looks harmless and
silently makes the member depend on one presentation: a single `order` field
cannot serve two websites, so the member can only ever belong to one. Order is an
attribute of the **incidence** — this tile's participation in this website — so
it lives on the mark. A tile in three presentations wears three marks with three
positions, and none of them knows about the others. (Same reasoning as a
reference cell being the incidence in
[references-as-incidences](signature-system.md); marks about a membership belong
to the membership.)

## What this replaced

The retired model put a kind on a PARENT and read its CHILDREN as the members:

```
deck cell   visual:diagram:deck          ← a container artifact
  ├── slide                              ← members are children
  ├── slide
  └── slide
```

Four costs, all structural:

- nothing could be made without first minting a parent to hold it;
- a member belonged to exactly one collection — whichever one it was filed under;
- order was child order, so re-sequencing edited the tree;
- adopting the feature had to carry a subtree (`adoptScope: 'hierarchy'`), so the
  unit of sharing was a branch rather than an artifact.

The replacement:

```
website artifact   group{site:pitch}  visual:site:artifact
slide (anywhere)   group{site:pitch, order:0}  visual:diagram:slide
slide (anywhere)   group{site:pitch, order:1}  visual:diagram:slide
```

Members live anywhere, belong to any number of presentations, re-order without
touching the hive, and adopt one at a time (`adoptScope: 'tile'`).

## The one verb

```
/enroll                — what is this tile part of?
/enroll <name>         — join <name>; re-run to leave
/enroll as <name>      — become the WEBSITE ARTIFACT for <name>
```

That is the whole surface, for every behaviour. A view's own command keeps only
what is genuinely about that view — for slides, the mode toggle and
`/present slide`, which attaches bytes to a tile so it IS a slide. Nothing else
about a behaviour may teach its own container; if a command needs a "put this
inside that" verb, the container has come back.

"What am I part of?" is a question a tile answers ALONE, with no parent to
consult and no index to keep. That it can is the working test of the model.

## Two views of one set

A set is not owned by the view that renders it. Slides and the lightbox are two
faces of the same relation — the same collector, the same members, the same
order — differing only in chrome and in which kinds each bothers to render. That
is what rule 5 means in practice: when something needs to be seen another way,
it gets another VIEW, never another container to be seen *inside*.

## Entering a view

Every member is an entrance. Clicking a member opens the view with the whole
relation loaded, positioned **at that member**; clicking the website artifact
(which wears the mark but carries no member content) opens it at the start. The
entry point IS the position — with no container deciding where a collection
begins, nothing else could decide it.

Both kinds enter the same view, so the visual-bee descriptor names the member
kind as `decorationKind` and the artifact kind in `alsoKinds`. `alsoKinds` is for
genuine PEER artifacts entering one view; a second kind that would merely be "the
thing holding the first" is the container coming back, and wants a mark instead.

## Shipping checklist

1. **Seed the cohort.** A decoration kind nobody has seen is globally OFF, so a
   remodel that changes `decorationKind` makes yesterday's content flip straight
   back to hexagons with no error. `seedCohortOn(<cohort>, [KINDS])`, guarded on
   `readGlobalOnKinds()` — see
   [behavior-enablement.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/sharing/behavior-enablement.ts).
2. **Keep the retired kind readable.** Put it in `legacyKinds` and keep the
   children collect as a fallback path. Nothing writes it again.
3. **Content hops through a meta envelope.** Use
   [artifact-content.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/artifact-content.ts)
   — `payload.content` holds an envelope signature, never a raw
   `payload.<x>Sig` and never a raw entry in a list. `content` is a declared
   EDGE field, so closure walkers carry it with no per-feature work. Give the
   envelope a `relation` naming the ROLE (`slide`, `picture`): the same bytes in
   two roles are two incidences, so they dedup independently instead of
   colliding.
4. **Invalidate the walk memo** on `decorations:changed` / `cell:added` /
   `cell:removed`. Membership can change anywhere in the hive, so there is no
   local head to key a cache on.

## Cases still to refactor

Every view whose content is a child subtree (`adoptScope: 'hierarchy'`) is the
same shape and is owed the same pass, one at a time:

| View | Command | Today's container |
|---|---|---|
| ~~slides~~ | `/present` | ~~`visual:diagram:deck`~~ — **done** |
| ~~relating anything~~ | ~~per-behaviour~~ → `/enroll` | **done** |
| ~~lightbox~~ | `/lightbox` | ~~a tile whose CHILDREN's pictures were the gallery~~ — **done** |
| website | `/website` | pages are child cells, routed by lineage |
| workflow | `/workflow` | steps are child cells |
| tree | `/tree` | the subtree under the marked cell |
| brief | `/brief` | `sourceScopes: hierarchy` |
| view-library | `/views` | `sourceScopes: hierarchy` |

Related: [signature-system.md](signature-system.md) ·
[group-signatures.md](group-signatures.md) ·
[uniform-decoration.md](uniform-decoration.md) ·
[pheromones.md](pheromones.md) · [known-location-pools.md](known-location-pools.md)
