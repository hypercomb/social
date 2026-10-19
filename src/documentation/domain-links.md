# Domain links — the copy is the navigation

*jwize, 2026-10-15. Built the same day.*

Any copy inside a website the hive hosts that says the **name** of a
published creation becomes a link to that creation, at its own address.
Nobody writes the links. When a new domain goes live, every page that
already mentioned it starts linking to it; when a creation is unpublished,
its name goes back to being plain text. The copy is how a reader moves
around the domains.

## The list is not authored

The names come from the **running list of publish and unpublish results**:
the `publish:results` pool of meaning (`sharing/publish-results.ts`), one
document holding every outcome in order, written by the one publish routine
(`publish-branch.ts`) and nowhere else. Folding the list — the *last* result
per creation decides, and only a publish with an address is a door — yields
the doors open right now: a name, its segments, the zone it is on, and the
address it opens at.

It is a truth pool. "I published this here" and "I took it down" are remote
acts no cold client could rebuild from layers, so it is never minted from
the optimize phase. The software writes it on its own, so it mints no kept
version. The list is bounded; the oldest results fall off the far end.

A reader without the pool gets the same doors from the publisher's **signed
index** (`doorsOfIndex`): roots, doors and addresses are the same facts,
signed. A visitor on a hosted page reads the publisher named by the page's
door record (`#hc-door`), from the zone the page is served on. The pool is
the fast local source; the index is the public one.

## The rule

`sharing/domain-links.ts`, pure, proven on a detached DOM:

- A name matches as a **phrase**, case-blind, with any run of non-letters
  between its words. `point blank solutions`, `Point-Blank Solutions` and
  `POINT  BLANK  SOLUTIONS` all say the creation named *Point Blank
  Solutions*. Whole words only: `card` never links inside `cardigan`, nor
  inside `<b>card</b>igan`; beside a script written without spaces
  (Japanese, Chinese, Thai…) there is no word edge, so a name links inside
  running text there. Where two names overlap the longest wins, wherever it
  starts: `New York Pizza` links *York Pizza* over *New York*. Names and copy
  are read in NFC, combining marks counted as letters. Where two zones
  published the same name, a page links the door on its own zone; a name
  one of whose doors is the page itself stays text.
- A match becomes an `<a>` at the door's address — only an address the
  host will open: an own address the publisher signed (a label or the
  apex), `<key>.<zone>` when the key is already a DNS label (the host maps
  the label to the lineage verbatim, so `Meetings` has no implicit door),
  or `<top>.<zone>/<rest>` when the top place is itself open there. Root
  paths are off on the hosts. A creation with none of these is no door; its
  name stays text. **No underline.** The link
  wears the **colour of its domain** — one hue per zone, derived from the
  zone's name, so every page on every host agrees without a palette to ship.
  A link whose zone differs from the page's own carries `data-cross`.
- Copy that is already a link, code, a form control or editable text is left
  alone. A page never links to itself. Running the rule twice changes nothing.

## Where it runs

`sharing/domain-links.drone.ts` watches the site view host
(`#hc-site-view-host`, mounted by `presentation/tiles/site-view.drone.ts`)
and applies the rule as the page mounts and as it changes, one pass per
frame. Every `publish:result` effect drops the compiled table, so the next
pass sees the new domain.

Clicking a link to one of **your own** creations, in your own hive, moves
inside the hive — no reload; the site view reconciles on the navigation.
Any other link is an ordinary web link to another host.

## What this makes possible

Every mention is an incidence: copy on one domain naming a creation on
another is a mark that content wears. Collected across hosts, those marks
are a graph of who talks about whom — clusters across domains — and they
are a derivation of signed content, so they can be minted in the optimize
phase and rebuilt by any cold client. The next section is that build.

## Clusters across domains (built the same day)

Every link the rule makes is an **incidence**: this page names that
creation. `sharing/link-incidences.ts` reads them off a page after the pass
and the drone holds them for the **optimize phase**, which mints one record
per `(page content sig, door table sig, source creation)` into the
`links:incidences` pool —
a derived cache by the litmus test (a cold client mounts the page and runs
the rule again), keyed by its inputs so a new domain means a new table, a
new key and a fresh derivation on the next visit. Never load-bearing.

`clustersOf(records, table)` folds them to a graph keyed by creation and
zone (`lineageKey@zone`, so two publishers' same-named creations stay
apart): **inbound** (who names this creation, by zone) and **outbound** (whom
its page names). Only records made against the current door table count —
what a cold client would derive — and of those the newest per source
creation, so an edited page's older versions drop out. After a publish
changes the table, a creation's lines are blank until its page is read
again. A page naming itself is no edge, and a page nobody owns makes none.
A large pool is read across a few views and answers only once read whole. The publications view shows both lines under a
plate, each name coloured by its zone, no underline — the cluster a reader
can move through.

The same links are what an agent spiders: see
[agent-harness](agent-harness.md), section 13.

## The words on a coloured name (built 2026-10-15)

Resting on a domain link shows its **control**: the zone's colour and the
words a reader can say about the link. The control is nothing but those
words, each a sentence on the command line said by a click, so a reader
learns the dialect by using it and an agent says the same sentences.

- `raise <name|address>` — bring the creation's layer to the top. One of
  yours is already in the hive: raise walks to it. Another host's is read at
  its live head and **offered**, the shaded peer the publications view also
  places, then walked to. Nothing is copied or kept; the publications view
  puts it back. The addresses never move — a raise is a twist of the cube,
  another face on top.
- `recommend <name|address> <word>` — leave a signed word on the creation's
  head: a pheromone (`pheromones.md`), shown to readers whose interests
  match the word and to nobody else. The control asks for the word in place.

- `hold <name|address>` — a link tile named after the creation, whose link
  is its address, on the page you stand on, like a dropped link. Every hive
  IS a Hyperdex — its signed index, read from outside — so there is no
  separate collection to file into. The link is written only at the row
  (tile properties are shared by name). A creation already held there is a
  no-op; a tile of that name that links elsewhere, or is no link at all, is
  never replaced. The row is an ordinary link tile, so the held-address read
  and update notice apply to it unchanged.

## Decided, not built (2026-10-18)

- **The link mark** (`link:<zone>` group plus a `link` decoration, the href
  computed on read) waits for its first reader: a Hyperdex view that gathers
  the hive's held links. Until one asks, a link tile's `link` property is
  the whole story, and a mark nobody reads is an abstraction ahead of need.
- **Replacements** (a `successors` map in the signed index, offered to
  holders as an update) wait for the first door that actually moves. They
  change the signed index, a protocol every host and client shares.
- **Clusters** stay blank after a publish until a page is read again; an
  older table's record would show edges a cold read would not.
- **hold** refuses, rather than overrides, a root tile that pins its link.
