# The website artifact paradigm — atomic artifacts, related by decoration

> Never mint a parent to hold a view's members. Make every artifact atomic,
> make ONE artifact that names the relation, and relate them with a decoration.

This is the shape all forward feature work takes. It is not a slides quirk; the
slide model is only the first instance.

The relation itself lives in one place and belongs to no behaviour:
[pheromones/enrollment.ts](../hypercomb-essentials/src/pheromones/enrollment.ts),
driven by one verb, `/enroll`. A website, a slide, a photo, a page and a workflow
step all enrol the same way, into the same kind of set.

## The rule

1. **Every artifact is atomic and standalone.** It carries what it says and
   nothing about anyone else. Delete any other artifact and it is still valid.
2. **No artifact depends on another.** There are no parent artifacts, no
   container artifacts, and no artifact whose meaning is "the box the others
   live in". The one thing an artifact MAY depend on is an **interface** — a
   declared shape that belongs to neither side. See *The interface is the one
   sanctioned dependency*.
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
8. **The grouping IS the compatibility.** There is no pairing table and there
   must never be one. Artifacts that are grouped operate together — that is what
   grouping *means*. Different types may interoperate freely; the only law is
   that none may be *dependent* on another.
9. **One tile may name several relations — one per family.** A tile can be a
   website artifact *and* a photo gallery artifact. Two faces, two sets of
   members, neither aware of the other.
10. **Breaking apart distributes the VISUAL.** When an artifact is broken into
    parts, its appearance is divided among them, and the whole keeps a
    PLACEHOLDER where each region went. A part arrives able to be seen on its
    own, or it is not an artifact yet — and the whole still looks like itself
    with every slot empty.
11. **The whole keeps a PLACEHOLDER where each part goes.** The parent becomes a
    frame with holes, not a picture that was cut up. An empty hole is a valid,
    finished state; a filled one seats the part's own visual and the whole reads
    as one image again.

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

## Families — how a tile has more than one face

A naming record is any decoration kind shaped `visual:<family>:artifact`, and
its meanings are scoped `<family>:<name>`. **Matching is the whole declaration**:
a new artifact type ships its own naming kind and its own family, registered
nowhere.

```
visual:site:artifact      names   site:pitch        → the slides / site face
visual:gallery:artifact   names   gallery:holiday   → the pictures face
visual:workflow:artifact  names   workflow:onboard  → the steps face
```

Because the family scopes the meaning, `site:holiday` and `gallery:holiday` are
different relations by construction — which is exactly what lets one tile carry
both faces without them bleeding into each other. A view renders **the family it
owns** and ignores the rest: `namedIn(cell, family)` for the face,
`enrollmentsIn(cell, family)` for its members. A view that asked for *every*
membership would splice two unrelated sets into one.

The same holds for members. A photo enrolled in a presentation *and* in a
gallery carries two marks with two independent positions, and neither set can
renumber the other.

## Compatibility is not declared

The question "which artifacts work together?" has no table behind it. Artifacts
that are grouped together operate together. A declared matrix would be a second
truth about a relation the mark already states, and it would go stale the day a
module ships a new behaviour.

What a view does with a member it does not understand is *nothing* — it renders
the kinds it can and skips the rest, which is how a photo, a slide and a YouTube
embed already play in one presentation. The rule that keeps this safe is rule 2:
interoperation is free, **dependency is forbidden**.

## The three records

| Record | Kind | Worn by | Says |
|---|---|---|---|
| Membership | `group` | every member, artifact included | `{ sig, meaning, order? }` |
| Identity | `visual:<family>:artifact` | the naming artifact (one per family) | `{ groupSig, meaning, name }` |
| Content | `visual:<x>:<member>` | each member | its own payload, `content` → meta envelope |

**Meanings are scoped by family and MUST carry a colon** — `site:pitch`, not `pitch`.
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

## Breaking apart distributes the visual

> A part that cannot be seen on its own is a dependent artifact.

This is the same law as rules 1 and 2, applied to appearance, and it is the one
most easily lost — because the parts *look* fine while you are standing on the
whole. Breaking an artifact apart must divide its VISUAL among the parts, not
leave it on the parent.

**Why it is doctrine and not taste.** An artifact with no appearance of its own
is only visible through something else. Filed elsewhere, shared alone, or met by
a peer who does not hold the parent, it arrives blank — so it *depends* on the
whole for its presence. Every other guarantee here rests on a part being able to
stand alone; a part that cannot be seen alone does not.

**The anti-pattern is inheritance.** A part that renders by falling through to
its parent's picture, or to a substrate default, looks correct on the page where
it was made and is naked everywhere else. Inheriting an appearance is not having
one. The test is simple and worth applying literally:

> Move the part somewhere else in the hive, alone. Does it still look like
> itself? And with the part gone, does the whole still look finished?

**What "distributes" means.** The whole's appearance is divided, not copied:

- a picture divides into regions — each part takes the part of the image that is
  *about* it;
- a composite divides into its elements;
- where there is nothing to divide, each part is *given* its own visual at
  creation — derived from what that part is, never left absent.

Duplicating the parent's image onto every part satisfies the letter and defeats
the purpose: seven identical tiles say nothing about which part is which.

## The interface is the one sanctioned dependency

Rule 2 forbids an artifact depending on another artifact. It does not forbid
depending on an **interface**, and it never could — two things cannot compose
without agreeing on something.

The distinction is the whole of it:

- **Depending on an ARTIFACT** couples you to a particular thing. It has to
  exist, it has to be that one, and it can only be in one place at a time.
- **Depending on an INTERFACE** couples you to a declared shape that belongs to
  neither side. Anything of that shape fits, nothing in particular is required,
  and the same part can satisfy the same interface in many wholes at once.

**A placeholder is an interface.** It states a shape — position, size,
proportion — and states nothing about who fills it. The whole may depend on it
(that is what a hole IS). A part may depend on it (that is how it knows what to
be). Neither depends on the other, and both remain replaceable.

That is the test to apply whenever this rule feels like it is in the way: *am I
naming a shape, or naming a thing?* A shape is an interface and is allowed. A
thing is a dependency and is not.

## The whole keeps a placeholder

Dividing alone would only move the dependency: a parent whose picture had been
cut up needs its parts back in order to look like anything. So the parent does
not keep a cut-up picture. **It keeps a frame with a PLACEHOLDER at each place a
part belongs** — the position, size and shape of the hole, and nothing about
which part fills it.

That is what makes the composition free in both directions:

- **the part does not depend on the whole** — it carries its own visual and
  stands alone anywhere (rule 10);
- **the whole does not depend on its parts** — an unfilled placeholder is a
  finished state, not a missing asset. The parent renders complete with every
  hole empty;
- **when both are present they connect exactly** — the part's visual seats into
  its hole and the whole reads as one image again.

Connected to everything, dependent on nothing — the same shape as everything
else here, applied to appearance. A placeholder is a REFERENT: it names a
position and carries no bytes, exactly like a group signature, so it can never
drag a part's content into the parent's closure.

**A placeholder must not name its part.** A parent that pointed at the artifact
filling each hole would depend on it, and the part could then belong to only one
whole. The seating comes from the other side: a part is already enrolled, and
its membership already carries its POSITION (`{ sig, meaning, order }`). Position
is what says which hole it fills. One part can therefore seat into several
different wholes, at a different place in each, and no whole knows the others
exist.

**Filling is not required and never becomes required.** A hole that stays empty
forever is correct. This is what lets an artifact be broken apart long before
anyone has drawn its parts: the structure arrives first, the appearance matures
into it, and nothing is broken in between.

**Where it has to bite.** Every producer of parts — `/break-apart`, `/organize`,
`/expand`, an importer, an atomizer, a responder minting tiles over the bridge —
owns this. A producer that mints a name, a note, and no appearance has moved the
work rather than done it.

### How it is done

One act, reached by one effect, so no producer has to grow its own answer (and
so the ones written later cannot quietly skip it):

```
parts:distribute-visual   { segments, parts?, creationId?, place? }
```

| Piece | Where | What it holds |
|---|---|---|
| the frame | [visual-division.ts](../hypercomb-essentials/src/presentation/tiles/visual-division.ts) | pure geometry — the spiral, the slots, the derived-visual spec. No IoC, no canvas, no store, so the shape is testable with none of them. |
| the act | [visual-distribution.ts](../hypercomb-essentials/src/assistant/visual-distribution.ts) | cuts the bytes, writes each part its picture, seats each part, records the whole's frame. |
| the door | [visual-distribution.drone.ts](../hypercomb-essentials/src/assistant/visual-distribution.drone.ts) | the effect any producer emits, allowlisted on the bridge so a responder that created the parts remotely can hand the appearance back to the hive — which is the only place the pixels are. |

What lands, and on which side:

- on the **whole** — `visual:division:plan` (the frame) and
  `visual:division:artifact` (the face its parts are members of). Its own
  picture is not touched, which is what keeps it finished with every hole empty.
- on each **part** — its own bytes in `properties.large`/`.small` (the region
  of the whole's picture that is *about* it, or a visual derived from its own
  name when there was nothing to divide) and `group{ meaning, order:k }`, the
  membership that seats it into slot k.

The chain that makes them reassemble is `order k → slot k → layout slot k`, and
every link of it belongs to one side or the other. Nothing points across.

Emitting twice is safe: the frame is replaced, a part already at its slot is
left alone, and a part that already owns a picture is never redressed.

### A frame is one number

`visual:division:plan` holds `{ arity: 7 }` and nothing else. Every rectangle is
a pure function of the arity and the index — the hex at `spiralAxial(k)` fitted
to the spiral's own bounding box — so storing the rectangles would be caching a
derivation, and a derived cache written as truth is exactly what the
optimize-phase contract forbids.

The arity is the one thing that is NOT derivable, and it is frozen at the moment
of breaking apart rather than recounted from live membership. That is the whole
of rule 11 in one decision: recount, and removing a part reflows every remaining
hole, so the whole stops being finished the moment it loses one. Frozen, seven
holes with two parts in them is a whole with five EMPTY holes — which is a
finished state.

(A frame written in the retired rectangle form still reads back as its own
length, so wholes divided before this keep their arity instead of silently
becoming zero.)

### A frame is the layer primitive, with the arrow reversed

Worth naming, because it means this is not a new protocol:

| Life Layer | division frame |
|---|---|
| named slots — `children`, `content`, `properties` | indexed slots, 0…n |
| a slot declares a POSITION in the composition, never the content | a hole declares a position in the picture |
| what fills it is reached through exactly one typed hop | the part's picture is reached through its own `content` envelope |
| an absent slot is a valid layer, not a broken one | an unfilled hole is a finished state |

The one inversion is the whole point. In a layer the slot HOLDS the reference —
`children: [sig, …]` — and `children` is a declared EDGE in
[edge-registry.ts](../hypercomb-core/src/core/edge-registry.ts), so the bytes
travel with it and the parent genuinely depends on its children in closure. In a
frame the slot holds NOTHING; the reference points the other way, from the part's
own `group{ order:k }` mark. The frame is therefore a REFERENT, and every precise
walker skips it.

Same slot vocabulary, evaluated on the other side of the edge/referent line.
That reversal is what buys rule 2.

### `hole` the mark and `hole` the slot are different questions

[piece-protocol.md](piece-protocol.md) already declares `hole` in its vocabulary
and says an uncreated part is *"a tile with a mark and no content sig — a
navigable address, not a gap in a UI"*. That is not the same `hole` as a slot in
a frame, and collapsing them would lose one of the two:

- **`hole` the mark** answers *which part is missing from this creation?* It is
  about a PIECE that does not exist yet, and it wants to be a tile so you can
  stand on it, note it, and fill it later.
- **a slot in a frame** answers *where does a part's picture sit inside the
  whole's?* It is about POSITION, and it exists whether or not anything is
  missing — a fully realized creation still has an arrangement.

They compose rather than compete: an arrangement of arity 7 whose slot 3 is
occupied by a piece marked `hole`. Which is the piece protocol's own sentence —
*"Creation = pieces + an arrangement. The arrangement is a layer."* — with the
arrangement now built and the marks still to come.

## Filing is not membership

A tile has to live somewhere, and the least surprising place is usually under the
artifact that names the relation — the workflow designer still creates a step
tile as a child of the workflow. That is FILING, and it is not what makes the
tile a member. The enrolment mark is.

The distinction is what the whole paradigm rests on. Because filing carries no
meaning, a member can be moved, re-filed, or enrolled in a second set without
either set noticing, and a set can reach a member that lives somewhere else
entirely. A container model cannot express any of that, because in it filing IS
membership.

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
   [behavior-enablement.ts](../hypercomb-essentials/src/sharing/behavior-enablement.ts).
2. **Keep the retired kind readable.** Put it in `legacyKinds` and keep the
   children collect as a fallback path. Nothing writes it again.
3. **Content hops through a meta envelope.** Use
   [artifact-content.ts](../hypercomb-essentials/src/presentation/tiles/artifact-content.ts)
   — `payload.content` holds an envelope signature, never a raw
   `payload.<x>Sig` and never a raw entry in a list. `content` is a declared
   EDGE field, so closure walkers carry it with no per-feature work. Give the
   envelope a `relation` naming the ROLE (`slide`, `picture`): the same bytes in
   two roles are two incidences, so they dedup independently instead of
   colliding.
4. **Invalidate the walk memo** on `decorations:changed` / `cell:added` /
   `cell:removed`. Membership can change anywhere in the hive, so there is no
   local head to key a cache on.
5. **Read THROUGH the hop.** `Store.getResource` does *not* follow a meta
   envelope — only `getResourceResolvedLocal` and `getLayerBytes` do. A consumer
   that hands a payload reference straight to `getResource` gets the envelope's
   JSON and renders it as content. Use `fetchThroughContentHop` (bytes, via your
   own fetch cascade) or `terminalContentSig` (the signature, from local reads).
   This is the one regression the migration reliably causes: it appears only
   once real envelopes exist, so it will not show up in the pass that writes them.
6. **`ensure*`, not `toggle*`, for programmatic callers.** A behaviour that names
   or enrols as a side effect of its own command must use the idempotent form, or
   re-running that command quietly undoes the membership.

## Cases still to refactor

Every view whose content is a child subtree (`adoptScope: 'hierarchy'`) is the
same shape and is owed the same pass, one at a time:

| View | Command | Today's container |
|---|---|---|
| ~~slides~~ | `/present` | ~~`visual:diagram:deck`~~ — **done** |
| ~~relating anything~~ | ~~per-behaviour~~ → `/enroll` | **done** |
| ~~lightbox~~ | `/lightbox` | ~~a tile whose CHILDREN's pictures were the gallery~~ — **done** |
| ~~workflow~~ | `/workflow` | ~~steps were child cells, ordered by `children`~~ — **done** |
| website | `/website` | pages are child cells, routed by lineage |
| tree | `/tree` | the subtree under the marked cell |
| brief | `/brief` | `sourceScopes: hierarchy` |
| view-library | `/views` | `sourceScopes: hierarchy` |

Related: [signature-system.md](signature-system.md) ·
[group-signatures.md](group-signatures.md) ·
[uniform-decoration.md](uniform-decoration.md) ·
[pheromones.md](pheromones.md) · [known-location-pools.md](known-location-pools.md)
