# Seams — the extension points a creation leaves, and passive discovery

A Hypercomb primitive. A seam is an extension point: a word a creation leaves
open for a filler. Any creation may leave them; any tile may wear them;
the hive shows them as hexagon silhouettes and fills them from the pools of the
hosts you follow. The business card is one creation that uses it
([business-card.md](business-card.md), "Seams on a card"); it is not the
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

## What a seam is

A seam is a mark a tile wears, naming one word: `name`, `portrait`,
`tagline`, `contact-script`, `soundtrack`, `rules`. There is no query
language. The word is already an address, `sign(word)`
([hypergraph-molecule-lineage.md](hypergraph-molecule-lineage.md)), so filling
a seam is the lookup the hive already does for every molecule, asked from the
creation's side. [Template addressing](template-addressing.md) is the same
seam one level down: a template's placeholders are names, and a tile's
children supply them. A seam is that placeholder made visible, and widened
from the tile's own children to every host it follows.

A creation with more seams is a different creation. A community fork that
adds a seam is a new signature that may reuse every filler the old one had.
That is the point: the seam is the injection point of the hypergraph, and the
fillers people make over time, visible by date in the pool, are the
redundancy.

**A seam fills by rungs, in order:**

1. **Fill.** The tile wears a `seam:fill` mark for the word. That filler is
   used. Nothing is re-resolved. What you read is exactly what was chosen.
2. **Child.** A child of the tile named the word fills it.
3. **This hive.** Tiles elsewhere in this hive named the word. One fills it.
   Several are offered, never first-wins: the participant picks with `fill`,
   or later a META atom decides.
4. **Followed hosts.** The pool `sign(word)` on the hosts this hive follows,
   with the same rule for several.
5. **Miss.** Nothing anywhere. A miss is an ask, the same path as a retired
   word read on miss and the bridge's ask screen. The participant, an agent,
   or a community host answers it, and the answer lands in the pool, so the
   next reader never misses.

Two spellings of one word are one seam: the molecule fold decides, never the
display text.

A replaceable script in a seam is a bee: the filler is a bee signature in the
`bees` pool, loaded the way every other bee loads. There is no second
script-attachment mechanism beside it.

Three lines not to cross:

- **No new grammar.** The tile name is the grammar. A seam that needs more
  than a word is two seams.
- **A seam is a mark, never a parent.** The filler stands alone and can fill
  other creations ([website-artifact-paradigm.md](website-artifact-paradigm.md)).
- **Seam kinds are not pheromone kinds.** A seam classifies by word and pool
  membership. Pheromones stay interest signals ([pheromones.md](pheromones.md)).

## The words

Two decorations and two words. Both words act on the tile you stand in.

| Record | Payload | Meaning |
|---|---|---|
| `seam:point` | `{ word }` | this tile leaves the word open; one record per word |
| `seam:fill` | `{ word, sig }` | the filler chosen for the word: the head signature you took, not a route that may move |

```
seam                          what seams this tile has, and how each is filled
seam portrait tagline         open two seams
seam ~ tagline                close one
fill portrait                 keep what fills it now: the child, or the one tile in this hive
fill portrait /people/x/face  fill it with that tile, as it is now
fill portrait <signature>     fill it with that signature
fill ~ portrait               forget the choice; the seam resolves again
```

Opening, closing and filling are ordinary decoration commits, so they undo
like any other. A word the hive keeps for itself, such as `bees`, cannot be a
seam. The code is `hypercomb-essentials/src/commands/seam.ts` (the rungs,
pure), `seam-read.ts`, `seam.queen.ts` and `fill.queen.ts`.

## Empty seams are silhouettes

*jwize, 2026-10-07:* "showing an empty slot when the parent contains slots, so
when you go to the level you can either search in your public network or you
can see: oh, I need to create a tile by that name."

Diving into a tile that wears seams renders each unfilled seam as a hexagon
silhouette named the word: the outline of a tile that is not there yet, drawn
the way the welcome hive draws what has not been made
([example-hives-first-boot.md](example-hives-first-boot.md)). A silhouette is
for giving information, not for holding anything. It sits in the grid where
the filler would, and it offers two acts: search the hosts you follow for the
word, or create a tile by that name. Creating is the ordinary naming gesture.
A tile named the word joins `sign(word)` by its name, so making it is filling
it; no list is kept and no second step is owed.

The "how does this work" writing a community leaves about a seam is the same
pool. A tile named the word on anyone's public domain, with its notes, is that
domain's statement about the word. Visiting the word across the hosts you
follow reads all of them. There is no separate documentation resource and no
colon pool for it: the word is the conventional resource.

## A trait wanted, not a tile waiting

*jwize, 2026-10-07:* "so this gives you the ability to give traits that are
suggested, or is that just an actual tile that has a design saying it is
needed to be filled and then changes its beehavior upon being provided?"

A seam is a trait the creation says it wants. Three things follow:

- **Nothing is minted for an empty seam.** The silhouette is a rendering of
  the parent's seam mark. It is not a tile, has no signature, and holds
  nothing. A tile that changed upon being provided would have to hold its
  filler, and that is a parent, which the doctrine forbids.
- **The behaviour change lives in the reader.** The bee that renders or runs
  the creation resolves each seam by the rungs. With no filler it draws
  the silhouette and offers search or create; with one it uses it. The
  creation behaves differently once provided, because resolution succeeded,
  not because a tile transformed.
- **Suggested traits are the halo.** Wearing the word declares the trait
  accepted. Fillers listed under the word on followed hosts are the
  suggestion. Nothing lands until `fill`.

The only state in the whole primitive is the `seam:fill` mark on the
tile that wears the seam.

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
reader's own set decides the match. A seam word is an interest declared by
wearing the seam.

What the visit paints, per seam:

| State | Drawn as |
|---|---|
| nobody has it | silhouette |
| you have it | solid tile |
| you have it, others offer more | solid with a halo and a count |
| you lack it, others offer it | silhouette with a halo and a count |

Constraints that keep it passive:

- **Hover starts it, once per session, per word.** The dwell is debounced so
  a pass across the grid fires nothing. The first dwell on a tile wearing
  seams starts the fetch for its words; later dwells on the same word reuse
  the in-flight or finished result. One request per host per word, coalesced
  in memory for the visit.
- **The pulse is the ring breathing** while any host is still unanswered. It
  stops when every host has answered or a short timeout passes. Icons land one
  by one as hosts answer, so a slow host never holds a fast one.
- **The visual is a hint, never a pull.** Nothing is copied until the
  participant picks a filler. The pick is one word from the halo, `fill`, and
  it writes the `seam:fill` mark on the tile. That mark is the whole
  protocol.
- **A tile wearing no seam marks fetches nothing.** Discovery is a property
  of tiles that left blanks, so the default costs an ordinary hive nothing.

## Sticky: the last evaluation is an observation

*jwize, 2026-10-07:* "some icons can arrive as long as a refresh, or perhaps
the last known evaluation can be sticky."

A last-known evaluation is not a derived cache: a cold client cannot rebuild
it from layers, so it may not be minted in the optimize phase
([optimize-phase.md](optimize-phase.md)). It is state, and it gets its own
pool, `sign('seam:discovery')`, one record per seam word keyed by `sign(word)`,
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
| `seam:point` and `seam:fill`; the words `seam` and `fill`; the fill, child and this-hive rungs | built. The this-hive rung reads the hive search, so it inherits the search index's reach: a tile the index has not reached is not offered. Not yet proven in the running app |
| A card wearing a template inherits the template's seams | not built. A seam is read only on the tile that wears it |
| The followed-hosts rung | not built. `vocabulary-search.ts` already asks followed hosts for a word with honest absence and is the reader to reuse |
| A miss as an ask | not built |
| Hexagon silhouettes for unfilled seams | not built. The welcome hive's silhouette drawing exists and is the model |
| The halo and count from followed hosts; hover-once; the breathing ring | not built |
| The `sign('seam:discovery')` pool | not built; the meaning is not yet registered. Every new pool meaning carries a colon (`known-location-pools.md`), so it is `seam:discovery`, never a bare `discovery` |
