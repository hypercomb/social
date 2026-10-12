# Slots — the blanks a creation leaves, and passive discovery

A Hypercomb primitive. Any creation may leave blanks; any tile may wear them;
the hive shows them as hexagon silhouettes and fills them from the pools of the
hosts you follow. The business card is one creation that uses it
([business-card.md](business-card.md), "Slots on a card"); it is not the
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

## What a slot is

A slot is a mark a tile wears, naming one word: `name`, `portrait`,
`tagline`, `contact-script`, `soundtrack`, `rules`. There is no query
language. The word is already an address, `sign(word)`
([hypergraph-molecule-lineage.md](hypergraph-molecule-lineage.md)), so filling
a slot is the lookup the hive already does for every molecule, asked from the
creation's side. [Template addressing](template-addressing.md) is the same
seam one level down: a template's placeholders are names, and a tile's
children supply them. A slot is that placeholder made visible, and widened
from the tile's own children to every host it follows.

A creation with more slots is a different creation. A community fork that
adds a slot is a new signature that may reuse every filler the old one had.
That is the point: the slot is the injection point of the hypergraph, and the
fillers people make over time, visible by date in the pool, are the
redundancy.

**A slot fills by three rungs, in order:**

1. The tile wears an explicit `slot → signature` mark for the word. That
   filler is used. Nothing is re-resolved. What you read is exactly what was
   chosen.
2. No mark. The pool `sign(word)` is read: the tile's own children first,
   then this hive, then the hosts it follows. A member fills it. Several
   members are the redundancy wanted; which one wins is a META atom or the
   reader's own pick, never a tag.
3. Nothing anywhere. The slot is a miss, and a miss is an ask, the same path
   as a retired word read on miss and the bridge's ask screen. The
   participant, an agent, or a community host answers it, and the answer lands
   in the pool, so the next reader never misses.

A replaceable script in a slot is a bee: the filler is a bee signature in the
`bees` pool, loaded the way every other bee loads. There is no second
script-attachment mechanism beside it.

Three lines not to cross:

- **No new grammar.** The tile name is the grammar. A slot that needs more
  than a word is two slots.
- **A slot is a mark, never a parent.** The filler stands alone and can fill
  other creations ([website-artifact-paradigm.md](website-artifact-paradigm.md)).
- **Slot kinds are not pheromone kinds.** A slot classifies by word and pool
  membership. Pheromones stay interest signals ([pheromones.md](pheromones.md)).

## Empty slots are silhouettes

*jwize, 2026-10-07:* "showing an empty slot when the parent contains slots, so
when you go to the level you can either search in your public network or you
can see: oh, I need to create a tile by that name."

Diving into a tile that wears slots renders each unfilled slot as a hexagon
silhouette named the word: the outline of a tile that is not there yet, drawn
the way the welcome hive draws what has not been made
([example-hives-first-boot.md](example-hives-first-boot.md)). A silhouette is
for giving information, not for holding anything. It sits in the grid where
the filler would, and it offers two acts: search the hosts you follow for the
word, or create a tile by that name. Creating is the ordinary naming gesture.
A tile named the word joins `sign(word)` by its name, so making it is filling
it; no list is kept and no second step is owed.

The "how does this work" writing a community leaves about a slot is the same
pool. A tile named the word on anyone's public domain, with its notes, is that
domain's statement about the word. Visiting the word across the hosts you
follow reads all of them. There is no separate documentation resource and no
colon pool for it: the word is the conventional resource.

## A trait wanted, not a tile waiting

*jwize, 2026-10-07:* "so this gives you the ability to give traits that are
suggested, or is that just an actual tile that has a design saying it is
needed to be filled and then changes its beehavior upon being provided?"

A slot is a trait the creation says it wants. Three things follow:

- **Nothing is minted for an empty slot.** The silhouette is a rendering of
  the parent's slot mark. It is not a tile, has no signature, and holds
  nothing. A tile that changed upon being provided would have to hold its
  filler, and that is a parent, which the doctrine forbids.
- **The behaviour change lives in the reader.** The bee that renders or runs
  the creation resolves each slot by the three rungs. With no filler it draws
  the silhouette and offers search or create; with one it uses it. The
  creation behaves differently once provided, because resolution succeeded,
  not because a tile transformed.
- **Suggested traits are the halo.** Wearing the word declares the trait
  accepted. Fillers listed under the word on followed hosts are the
  suggestion. Nothing lands until `fill`.

The only state in the whole primitive is the `slot → signature` mark on the
tile that wears the slot.

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
reader's own set decides the match. A slot word is an interest declared by
wearing the slot.

What the visit paints, per slot:

| State | Drawn as |
|---|---|
| nobody has it | silhouette |
| you have it | solid tile |
| you have it, others offer more | solid with a halo and a count |
| you lack it, others offer it | silhouette with a halo and a count |

Constraints that keep it passive:

- **Hover starts it, once per session, per word.** The dwell is debounced so
  a pass across the grid fires nothing. The first dwell on a tile wearing
  slots starts the fetch for its words; later dwells on the same word reuse
  the in-flight or finished result. One request per host per word, coalesced
  in memory for the visit.
- **The pulse is the ring breathing** while any host is still unanswered. It
  stops when every host has answered or a short timeout passes. Icons land one
  by one as hosts answer, so a slow host never holds a fast one.
- **The visual is a hint, never a pull.** Nothing is copied until the
  participant picks a filler. The pick is one word from the halo, `fill`, and
  it writes the `slot → signature` mark on the tile. That mark is the whole
  protocol.
- **A tile wearing no slot marks fetches nothing.** Discovery is a property
  of tiles that left blanks, so the default costs an ordinary hive nothing.

## Sticky: the last evaluation is an observation

*jwize, 2026-10-07:* "some icons can arrive as long as a refresh, or perhaps
the last known evaluation can be sticky."

A last-known evaluation is not a derived cache: a cold client cannot rebuild
it from layers, so it may not be minted in the optimize phase
([optimize-phase.md](optimize-phase.md)). It is state, and it gets its own
pool, `sign('discovery')`, one record per slot word keyed by `sign(word)`,
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
| The slot mark, the three rungs, `fill` | not built. Template addressing fills placeholders from a tile's children by name today; nothing reads a host for a word |
| Hexagon silhouettes for unfilled slots | not built. The welcome hive's silhouette drawing exists and is the model |
| The halo and count from followed hosts; hover-once; the breathing ring | not built |
| The `sign('discovery')` pool | not built; the meaning is not yet reserved in the pool registry |
