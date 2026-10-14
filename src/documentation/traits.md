# Traits — the extension points a creation leaves, and passive discovery

A Hypercomb primitive. A trait is an extension point: a word a creation leaves
open for a filler. Any creation may leave them; any tile may wear them;
the hive shows them as hexagon silhouettes and fills them from the pools of the
hosts you follow. The business card is one creation that uses it
([business-card.md](business-card.md), "Traits on a card"); it is not the
business card's feature.

*jwize, 2026-10-07:* "a sort of query language that can fill in the blanks …
if it uses a template that's registered it could just be a signature; if not
we say hey, this signature for this name is required … those scripts can be
replaceable, they can be the injection point in our hypergraph … a different
business card that has more injection points. That encourages communities to
build redundancy and how they've changed over time."

*jwize, 2026-10-07:* "the passive discovery slots should work as a hypercomb
primitive and show hexagon silhouettes for giving information. These are
generic, not just for business cards."

*jwize, 2026-10-12:* "seam is an extension point" … "trait is better than
seem."

The word is `trait`. "Slot" already names a field on a layer
(`history/layer-slot-registry.ts`) and "label" means a tile's own name, so
either would read as something else everywhere it appeared.

*jwize, 2026-10-12:* "trait is great for template parts, basically any layer
can have traits … they act as names for the next layers and also meaningful
labels for extension points."

So a trait does two jobs with one word. It is the **name of the next layer**:
the child that fills it is a tile called the word, one level down. And it is
the **label of the extension point**: a reader sees what the creation wants
before anything fills it. Any layer may wear traits, because every tile is a
layer. A template's parts are its traits: [template addressing](template-addressing.md)
fills a placeholder from the child of that name, which is the child rung
below, asked for one word at a time.

*jwize, 2026-10-13:* "Basically giving traits to a layer is how you design
things in the hive. It makes perfect sense."

Designing is naming what a layer wants. The traits are the design, the
silhouettes show it, and each tile made in one is the design being filled in.
There is no separate plan to keep in step with what gets built.

## What a trait is

A trait is a mark a tile wears, naming one word: `name`, `portrait`,
`tagline`, `contact-script`, `soundtrack`, `rules`. There is no query
language. The word is already an address, `sign(word)`
([hypergraph-molecule-lineage.md](hypergraph-molecule-lineage.md)), so filling
a trait is the lookup the hive already does for every molecule, asked from the
creation's side. [Template addressing](template-addressing.md) is the same
trait one level down: a template's placeholders are names, and a tile's
children supply them. A trait is that placeholder made visible, and widened
from the tile's own children to every host it follows.

A creation with more traits is a different creation. A community fork that
adds a trait is a new signature that may reuse every filler the old one had.
That is the point: the trait is the injection point of the hypergraph, and the
fillers people make over time, visible by date in the pool, are the
redundancy.

*jwize, 2026-10-13:* "it is not that they must be fulfilled it is a reminder
that if you want the behavior to work properly you must provide but more likely
you see it as an extension point that already has a working version."

**A trait is not owed.** Most traits already have a working version, the
behaviour's own. A filler replaces it, and what others have made is offered,
never swapped in on its own. A trait declared as needed is the other case: a
reminder that the behaviour works properly only once something is provided. A
trait a participant gives with the `trait` word has no own version either, so
it counts as needed, and its tile is made at once to fill it.

**A trait fills by rungs, in order:**

1. **Fill.** The tile wears a `trait:fill` mark for the word. That filler is
   used. Nothing is re-resolved. What you read is exactly what was chosen.
2. **Child.** A child of the tile named the word fills it.
3. **Own.** The behaviour's own version stands. Tiles elsewhere named the word
   are listed as offers and replace it only when the participant picks one
   with `fill`.

Only a needed trait goes on:

4. **This hive.** Tiles elsewhere in this hive named the word. One fills it.
   Several are offered, never first-wins: the participant picks with `fill`,
   or later a META atom decides.
5. **Followed hosts.** The pool `sign(word)` on the hosts this hive follows,
   with the same rule for several.
6. **Miss.** Nothing anywhere: the reminder stands. A miss is an ask, the same
   path as a retired word read on miss and the bridge's ask screen. The
   participant, an agent, or a community host answers it, and the answer
   lands in the pool, so the next reader never misses.

Two spellings of one word are one trait: the molecule fold decides, never the
display text.

A replaceable script in a trait is a bee: the filler is a bee signature in the
`bees` pool, loaded the way every other bee loads. There is no second
script-attachment mechanism beside it.

Three lines not to cross:

- **No new grammar.** The tile name is the grammar. A trait that needs more
  than a word is two traits.
- **A trait is a mark, never a parent.** The filler stands alone and can fill
  other creations ([website-artifact-paradigm.md](website-artifact-paradigm.md)).
- **Trait kinds are not pheromone kinds.** A trait classifies by word and pool
  membership. Pheromones stay interest signals ([pheromones.md](pheromones.md)).

## Every behaviour and every view

*jwize, 2026-10-13:* "because trait is a first class citizen it needs to be
available to all behaviors and minimum views but I expect all."

The rules live in core (`hypercomb-core/src/core/trait.ts`), so every module
on every platform resolves traits the same way. Two places declare them, and
both are data read without running anything:

- **A view** declares them on its descriptor in the visual-bee registry, the
  record every view already registers under its token. Every tile opening as
  that view has them, and a sleeping view states its traits without loading.
- **Any behaviour** may declare them on itself: `traits` on the bee base,
  beside `listens` and `emits`.

A declaration is a word, or `{ word, needs: true }` for the reminder case:

```ts
traits: ['portrait', 'tagline', { word: 'contact-script', needs: true }]
```

A tile's traits are its view's declared traits, then the ones opened on the
tile itself; a word in both is one trait. A view asks for its fillers through
the provider registered under core's `TRAITS_IOC_KEY`, so a community module
needs nothing but core:

```ts
const traits = window.ioc.get<TraitProvider>(TRAITS_IOC_KEY)
const sig = await traits?.fillerAt(segments, 'portrait') // null: use your own version
```

## A common dialect, by membrane

*jwize, 2026-10-13:* "the dialectic nature of hypercomb promotes a common
vocabulary that has orthogonal reach across your communities where those
pieces will become comparable to the other implementations across servers …
we hope that the community adopts a common dialect over time but really they
do because the imprint of the popular items gets a membrane … then you start
to get the layers that you might want your agents to inspect as input for
upgrades."

A trait word is a molecule address, so the same word on two servers is the
same address. Two communities that both declare `portrait` have made two
implementations of one thing, and they line up side by side with no mapping
table. Nobody rules on the vocabulary. Popular words gather fillers, and that
weight is the membrane that makes them the common dialect. The offers under a
word are then exactly the layers an agent can inspect as input for an
upgrade: every working version the community has made of that one extension
point.

## The words

Two decorations and two words. Both words act on the tile you stand in.

| Record | Payload | Meaning |
|---|---|---|
| `trait:want` | `{ word }` | this tile leaves the word open; one record per word |
| `trait:fill` | `{ word, sig }` | the filler chosen for the word: the head signature you took, not a route that may move |

```
trait                          what traits this tile has, and how each is filled
trait portrait tagline         open two traits
trait ~ tagline                close one
fill portrait                 keep what fills it now: the child, or the one tile in this hive
fill portrait /people/x/face  fill it with that tile, as it is now
fill portrait <signature>     fill it with that signature
fill ~ portrait               forget the choice; the trait resolves again
```

Opening, closing and filling are ordinary decoration commits, so they undo
like any other. A word the hive keeps for itself, such as `bees`, cannot be a
trait. The code is `hypercomb-essentials/src/commands/trait.ts` (the rungs,
pure), `trait-read.ts`, `trait.queen.ts` and `fill.queen.ts`.

## Empty traits are silhouettes

*jwize, 2026-10-07:* "showing an empty slot when the parent contains slots, so
when you go to the level you can either search in your public network or you
can see: oh, I need to create a tile by that name."

Diving into a tile that wears traits renders each needed trait nothing fills
yet as a hexagon silhouette named the word: the outline of a tile that is not there yet, drawn
the way the welcome hive draws what has not been made
([example-hives-first-boot.md](example-hives-first-boot.md)). A silhouette is
for giving information, not for holding anything. It sits in the grid where
the filler would, and it offers two acts: search the hosts you follow for the
word, or create a tile by that name. Creating is the ordinary naming gesture.
A tile named the word joins `sign(word)` by its name, so making it is filling
it; no list is kept and no second step is owed.

**How it is drawn.** Standing in a tile, every needed trait that no child and
no fill answers yet takes the next free slot of the spiral, in the order the
tile has its traits, so a silhouette sits exactly where its tile will land. It is a faint
hexagon with the inner ring and the word. Pressing it creates the tile by that
name through the same commit `create <name>` runs, and the next render pass
puts the tile where the silhouette was. A trait with its own version is never
drawn: it already works. A needed trait answered by a `trait:fill` mark is
not drawn either. A silhouette is drawn on its own layer: it is never in the cell list, the counts or the click
routing, and nothing about it is stored. Drawing one reads only the tile's
`trait:want` records and the labels already on screen: no search, no network.
The code is `presentation/tiles/trait-silhouette.ts` (the placement, pure) and
`trait-silhouette.drone.ts`.

The "how does this work" writing a community leaves about a trait is the same
pool. A tile named the word on anyone's public domain, with its notes, is that
domain's statement about the word. Visiting the word across the hosts you
follow reads all of them. There is no separate documentation resource and no
colon pool for it: the word is the conventional resource.

## A requirement, not a tile

*jwize, 2026-10-07:* "so this gives you the ability to give traits that are
suggested, or is that just an actual tile that has a design saying it is
needed to be filled and then changes its beehavior upon being provided?"

*jwize, 2026-10-13:* "as soon as you give a trait it should become a tile …
they are known as traits because they are an interface … they aren't tiles …
so basically a requirement of some tiles … we have to make it fit, and
currently wiping out tile or cell makes no sense."

A trait is a requirement some tiles have: an interface, never a tile. Tiles
and cells stay what they are; an ordinary tile is just a tile, and creating
one adds no trait. Four things follow:

- **The requirement lives on the tile; the implementations live in the pool.**
  A given trait is a `trait:want` record in the layer's decorations, so it
  travels, undoes and publishes with the tile. Pools never hold truth. The
  word's pool `sign(word)` gathers what can fill it, across this hive and the
  hosts it follows.
- **Giving a trait makes the tile that fills it.** `trait portrait` records
  the requirement and creates the child tile called `portrait` at once. Its
  silhouette is the first frame: it brightens and opens out over the new tile
  as it lands. Hide that tile later and the silhouette returns, because the
  requirement outlived it.
- **The behaviour change lives in the reader.** The bee that renders or runs
  the creation resolves each trait by the rungs. With no filler it uses its
  own version, or for a needed trait draws the silhouette; with one it uses
  it. The creation behaves differently once provided because resolution
  succeeded, not because a tile transformed.
- **Suggested fillers are the halo.** Fillers listed under the word on
  followed hosts are the suggestion. Nothing replaces what fills a trait until
  `fill`.

## Passive discovery: a GET, never a join

*jwize, 2026-10-07:* "we're going to passively discover extension points we
can search in real time just across community, without joining a public area
or swarm. It could be a default behaviour for tiles, or some other strategy
for suggest (by invite only) and discover."

A followed host serves `<origin>/<sign(word)>` as a listing of members, so
discovery is a fetch from a host, not a room, not a relay, not presence.
Reading a public host is visiting a website, so it is on by default, and what
comes back is a census of content, never of people
([pools-across-hosts.md](pools-across-hosts.md)).

Two gates the participant already holds separate the two strategies:

- **Discover** is you asking. You follow the host, and you dive into or
  dwell on a tile holding the word. Both are your acts. This is the default.
- **Suggest** is them offering. A host lists a filler under a word. Your hive
  surfaces it only if you hold that word. Holding the word is the invite:
  nothing arrives for a word you never named, so there is no spam surface and
  no invite list to maintain. The follow list is the second gate, and it
  already exists.

That is the pheromone shape: the offer travels with the content, and the
reader's own set decides the match. A trait word is an interest declared by
wearing the trait.

What the visit paints, per trait:

| State | Drawn as |
|---|---|
| nobody has it | silhouette |
| you have it | solid tile |
| you have it, others offer more | solid with a halo and a count |
| you lack it, others offer it | silhouette with a halo and a count |

Constraints that keep it passive:

- **Hover starts it, once per session, per word.** The dwell is debounced so
  a pass across the grid fires nothing. The first dwell on a tile wearing
  traits starts the fetch for its words; later dwells on the same word reuse
  the in-flight or finished result. One request per host per word, coalesced
  in memory for the visit.
- **The pulse is the ring breathing** while any host is still unanswered. It
  stops when every host has answered or a short timeout passes. Icons land one
  by one as hosts answer, so a slow host never holds a fast one.
- **The visual is a hint, never a pull.** Nothing is copied until the
  participant picks a filler. The pick is one word from the halo, `fill`, and
  it writes the `trait:fill` mark on the tile. That mark is the whole
  protocol.
- **A tile wearing no trait marks fetches nothing.** Discovery is a property
  of tiles that left blanks, so the default costs an ordinary hive nothing.

## Sticky: the last evaluation is an observation

*jwize, 2026-10-07:* "some icons can arrive as long as a refresh, or perhaps
the last known evaluation can be sticky."

A last-known evaluation is not a derived cache: a cold client cannot rebuild
it from layers, so it may not be minted in the optimize phase
([optimize-phase.md](optimize-phase.md)). It is state, and it gets its own
pool, `sign('trait:discovery')`, one record per trait word keyed by `sign(word)`,
holding what each followed host offered and when. Three properties keep it
honest:

- It records what hosts offered, never who looked.
- It is never load-bearing. Deleting the pool changes nothing but the halos.
- It paints faint until a fresh dwell confirms it, then solid. Stale is
  visible as stale, and a hover is the refresh.

The write happens only on a completed evaluation. A half-answered dwell writes
nothing: a partial record would read as "only two hosts have this" when the
truth is "we stopped asking."

So the hive opens with last time's halos already there, dimmed. Mouse over a
tile that left blanks, the ring breathes, the dim icons brighten or change as
hosts answer, and whatever arrived is what is there next time.

## Not subdomains

*jwize, 2026-10-07:* "do we do that by signature then, or what, a tile and a
hierarchical pile with multiple subdomains? Seems like we might have to
support multiple subdomains."

No. Publishing a filler for a word is naming a tile the word and publishing
from your own domain; every hive following that host sees it in
`sign(word)`. The tile is the act, the signature is what travels, and the word
is the address. A subdomain is a route, and a route is never an address
([hypergraph-molecule-lineage.md](hypergraph-molecule-lineage.md)). A new
top-level hive made from a hierarchy is already what publishing a branch does.
Nothing here needs a second origin.

## Ledger — what is true today

| | Status |
|---|---|
| `trait:want` and `trait:fill`; the words `trait` and `fill`; the fill, child, own and this-hive rungs | built. The this-hive rung reads the hive search, so it inherits the search index's reach: a tile the index has not reached is not offered. Not yet proven in the running app |
| Traits in core: declarations on views and behaviours, own versions and needed traits, the provider under `TRAITS_IOC_KEY` | built. Not yet proven in the running app |
| Views declaring their traits | not started. Every view can declare them, and none does yet: which words each view leaves open is that view's design |
| Behaviour declarations read by the provider | not built. The provider reads view descriptors; a bee's own `traits` is declared but nothing collects it yet |
| A card wearing a template inherits the template's traits | not built. The card renders through the website view, so its traits belong to the card's own view or template, not to every website |
| The followed-hosts rung | not built. `vocabulary-search.ts` already asks followed hosts for a word with honest absence and is the reader to reuse |
| A miss as an ask | not built |
| Hexagon silhouettes for needed traits nothing fills yet; pressing one creates the tile | built. Not yet proven in the running app. The search act on a silhouette waits for the followed-hosts rung |
| The halo and count from followed hosts; hover-once; the breathing ring | not built |
| The `sign('trait:discovery')` pool | not built; the meaning is not yet registered. Every new pool meaning carries a colon (`known-location-pools.md`), so it is `trait:discovery`, never a bare `discovery` |
