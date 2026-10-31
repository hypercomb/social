# The community lens — one view across many servers

jwize, 2026-10-30: published content lets people see their data across
servers. "You can organize and silo but get access across. This would be like
a domain group that you view against. Just like a swarm but not live, or a
hybrid."

Status: DESIGN, with step 1 started: the record-layer read is
`hypercomb-essentials/src/sharing/community-lens.ts` (`readLens`: hosts and
words in, signatures with words and origins out; spec-tested against faked
hosts, not yet against a live host). Nothing else here is built. It extends `showcase.md` (the community
as a named group of domains) and `pools-across-hosts.md` (a pool at the same
address on every host).

## What a live host serves today (probed 2026-10-31)

- Hosts that run the relay or shim answer `GET /<sign(meaning)>/` with a real
  listing: `localhost:7777` listed `host:packages`; `realones.online` answered
  with a valid, empty listing.
- Front doors on Pages (`hypercomb.com`) answer every path with the app page,
  and `revolucionstyle.com` answers 404, so the lens reads both as gaps.
- **No word molecule is published anywhere yet.** The local content root holds
  648 signature directories; none is the address of a word from the
  documentation (23,026 candidate words hashed, no hit). They are pools in the
  host-pool format (eight-digit markers), not tile molecules. This matches
  `hypergraph-molecule-lineage.md`: the molecule write path does not exist and
  `commitLayer` is still path-keyed, so a published tile does not appear at
  `sign(word)/` on a host.

So the word read is correct but has nothing to find until words are published
as pools. Until then the lens can only be proven live on a pool a host already
carries (`host:packages`). The next dependency is therefore the publish side:
which pool a published tile's name is enrolled in, so a host lists it at
`sign(word)/`.

## The idea

A **community** (a named group of domains, `community:hosts` plus a name) is
also a **lens**. Choosing one means: show me the union of what these domains
have published. Each domain stays its own silo; the view spans them.

Two layers read through the same view and produce the same rows. Live only
changes how fresh the rows are.

1. **Record layer (default, not live).** For each member host, read the pools
   it has published at `GET /<sign(meaning)>/` (a directory, `no-store`), then
   fetch each sig once (`GET /<sig>`, immutable). Merge. This is the
   "swarm, but not live" half: the public record, readable offline from cache.
2. **Live overlay (opt-in, the hybrid).** Join the swarm for just this
   community's hosts. Presence and fresh publishes stream in over the record
   layer. Turn it off and the record view is whole.

This is the two-layer swarm model already settled (public record plus live),
scoped to a community instead of the world.

## Rules

- **Read-only across hosts.** A lens never pushes onto another domain. Others'
  creations are a versioned, read-only view.
- **Provenance on every row.** The merged list carries each row's origin
  domain, so the silos stay visible inside the union.
- **Computed at read time, never stored.** The union is not a copy and mints no
  pool. A cached result is a derived cache keyed by the source signatures
  (optimize-phase rules): complete or absent, never load-bearing.
- **Same word, same address.** The lens asks each host for the pool by
  `sign(meaning)`; there is no per-community index endpoint and no named file.
- **Silos are the hosts' own.** Whatever a host does not publish is not in the
  lens. The lens grants no access a visitor would not already have.
- **Undo is native.** The community's membership is a layer in the hive, so
  editing it rides history.

## Surfaces

- **Owner (build first).** On the front door's accordion, picking a community
  filters the tile list to the union of its domains. A small live toggle turns
  the overlay on. The summary line reads like "4 domains, 112 tiles, 3 live
  now". Manage (the owed hive-side work) edits membership.
- **Visitor (later).** Search across a published community. Needs access
  gating (public communities for everyone, gated ones need a grant), which is
  not designed yet.

## Triangulate (jwize, 2026-10-30)

"On the subdomain with the automaton I want to look right into the hive across
domains and other words and bring it together. Imagine reading a website,
highlighting a group of words, saying *triangulate*, and a hive opens with
those tiles and related data across specific groups of communities, in
realtime, while viewing hypercomb content."

The lens needs no new primitive, because a word already is an address.

- **Each highlighted word is a molecule address.** Fold the selection into
  words and take `sign(word)` for each (`hypergraph-molecule-lineage.md`).
  Asking a host for a word is `GET /<sign(word)>/`, the same read the lens
  already makes.
- **Triangulation is the overlap.** Fetch the molecule of each word from each
  member host. Atoms found under two or more of the words are the
  triangulation points, ranked by how many words (and how many hosts) they
  share. Atoms under only one word are the periphery.
- **The result is a hive, not a panel.** One tile per word, plus a tile per
  triangulation point, with each tile's origin domain on it. It opens on the
  automaton subdomain as an ordinary read-only hive, so everything a hive
  already does (navigate, hold for versions and domains, undo) works on it.
- **Scoped by community.** The selection runs against one chosen community
  (or several), never the whole network. Which communities are chosen is the
  "specific groups".
- **Realtime is the overlay.** The first answer comes from the record layer.
  With the live overlay on, new publishes and presence under those words
  stream into the open hive.
- **Reading stays untouched.** The selection is read from the page; nothing is
  written to the page being read.

Costs and constraints that follow from this:

- **A query reveals what you read.** Asking a host for `sign(word)` tells that
  host a reader is interested in that word. That is a tracking surface.
  Triangulate is therefore explicit (a gesture, never on selection alone),
  asks only the hosts of the chosen community, and sends signatures, never the
  surrounding text or the page URL. Nothing is logged against the reader
  ("no tracking, only concurrent counts").
- **A short selection is guessable.** A hash of a single common word is no
  secret. Treat the query as visible to those hosts.
- **Cap the fan-out.** N words times M hosts is N x M directory listings. Cap
  the words per gesture, list hosts in parallel with a timeout, and render as
  answers arrive instead of waiting for the slowest.
- **Words are a vocabulary, not a search index.** Only words that exist as
  molecules on a host can match. A word nobody has published returns nothing,
  which is correct.

Build order: lens over one community (record layer), then multi-word overlap,
then the selection gesture on the automaton subdomain, then the live overlay.

## Seeing it: pictures and relationships (jwize, 2026-10-30)

A triangulated hive is only useful if it reads at a glance, so its tiles must
load with their pictures and show how the domains and creations relate.

- **Pictures are resources by signature.** A tile's picture is the resource
  its published head names (`large.image`). The lens fetches `GET /<sig>` from
  the tile's origin host, once per sig, immutable, so it caches forever and is
  shared by every view that shows the same tile. Nothing is copied into the
  lens. Load lazily and thumbnail-first: the tiles on screen first, the
  periphery as it scrolls in, and a tile with no picture yet draws its name.
- **Cross-origin must work.** Another host's bytes load into the automaton
  subdomain, so hosts serve resources with CORS open for reads (the host
  contract already requires this for replication). A host that does not is
  drawn as a name-only tile, never a broken image.
- **Relationships are marks, not a parent.** An edge is never stored as a
  container. Two tiles are related because they share a signature, sit under
  the same word, or wear the same mark; the lens derives the edges at read
  time from those facts. Edges are a derived view, recomputed on every
  triangulation.
- **Draw edges by what they mean.** A shared word draws a line between the
  word tile and the creation. A creation reachable from several words sits
  nearer the middle, which is the triangulation point. A creation published on
  several domains draws one tile with a small mark per origin, so the same
  sig is not shown twice.
- **Domains and communities are looks from pools.** The colour, badge and
  grouping of a domain or community come from pools of meaning (the theme
  system), not from per-tile code. Update the pool once and every hive that
  reads it follows. A new plugged-in piece extends the pool.
- **Layout is a view.** Placement of word tiles, creation tiles and edges is
  the lens's own arrangement and is never committed to a layer. Pinning a
  result into your own hive is a separate act, and it brings only references
  to the origin tiles ("a belief, not a copy").
- **Known risk to verify first:** visitor tile pictures have failed to arrive
  on public pages before. Check that a cross-origin picture actually loads in
  the automaton subdomain before building the relationship drawing on top.

### Resources without a tile

What a word gathers is signatures, not tiles. A triangulation point can be a
bare resource: an image, a text, a document, audio, a data file, a published
page. A tile is one way to present a signature, not the only one.

- **The unit is the signature.** The overlap is computed over atoms and
  resources alike. A resource that sits under two words is a triangulation
  point whether or not any tile names it.
- **A resource draws by its type.** An image draws as itself, text as a
  snippet, a page as a card, anything else as a typed card with its name or
  first line. The type comes from the resource's own bytes or its mark, never
  from a list kept in the lens.
- **Origin and relationships work the same.** A bare resource carries its
  origin domain and gets edges from the words and marks it shares. Nothing
  about it needs a tile to exist.
- **Pinning a resource keeps the reference.** Bringing one into your hive means
  a tile that points at the signature on the origin host, not a copy of its
  bytes.
- **Big ones stay lazy.** A resource is fetched only when it is on screen or
  opened. Until then the card shows what the listing already told us.

## The lens as a query aid (jwize, 2026-10-30)

The lens is not only a reading view. It is how a developer, an agent or anyone
gets at particular data across a community, and divides it by traits and other
dimensions.

- **One read, many callers.** A person triangulating, a developer script and an
  agent all ask the same question of the same lens: given this community and
  these words, which signatures, from which hosts, wearing which marks. The
  answer is a list of signatures with their origin and marks. What the caller
  does with it (draw a hive, feed a model, drive a build) is the caller's.
- **Divide by dimension.** A lens query is the community plus any combination of:
  - **word**: the molecules asked for (`sign(word)`).
  - **domain**: which member hosts to include or leave out.
  - **trait**: the marks the members wear. Traits classify; they never resolve
    or name a parent. A trait is a molecule name, so adding one is data, not
    code.
  - **type**: image, text, page, data, by the resource's own bytes or mark.
  - **time**: a revision, so the same query can be asked "as of" a published
    head or a date (history is the deploy).
  - **author**: who signed the record.
  Each dimension narrows or groups the same signature list; none of them is a
  second index.
- **Interests are not traits.** A pheromone is an authored interest-signal that
  travels with content. A reader's own interests may rank or surface results
  for that reader, but the lens never uses a pheromone to say what something
  is. Classification is a mark on a molecule name.
- **For agents: signatures in, signatures out.** An agent asks with words and
  gets signatures, then expands only the ones it needs. That keeps the context
  small (an agent reads a projection, not the whole hive) and makes the answer
  reproducible: the same signatures at the same revision give the same result.
- **An agent's scope is stated.** The community, the dimensions and the
  revision it used are part of what it reports, so a reader can rerun the
  query. An agent's lens reads carry the same privacy rule as a person's:
  explicit, scoped to the chosen community, signatures only, nothing logged
  against the reader.
- **Read-only, always.** The lens exposes no write path to another domain, for
  a developer or an agent. Writes go to your own hive through the usual act.

## The cube (jwize, 2026-10-30, speculative)

"We could create the 3D cube that is spun by the command line. It lines up the
grammars and meaning, so we can create an interactive view of our scripts."

A lens result has more than two dimensions, and a flat list or one hive hides
that. A cube shows three at once and lets you turn which three.

- **This is the cube the living presentation already defines**
  (`living-presentation.md`, "Where the story is going"): one point per tile,
  one automaton at one version. Its three directions are **origin** (across;
  where the point came from, own packages at the centre), **word** (into the
  page; the word of the grammar the point answers) and **version** (down; the
  signature direction, newest on top). The lens cube uses the same axes and
  the same reading, so a cube seen in the presentation and a cube opened from
  a lens are one thing. Every trait a tile wears is a further direction that
  can replace an axis when you turn the cube.
- **What the lens adds.** The presentation cube is one participant's domain.
  A lens cube is a community's: origin spans the member domains, and the
  words are the ones you triangulated. Each cell is the set of signatures at
  that intersection. An empty cell is a gap: no implementation of that word at
  that version from that origin.
- **Spinning is the command line.** A sentence turns the cube: it puts a
  different dimension on an axis, or fixes one axis at a value and shows the
  slice. The cube is driven by words like everything else (every act has a
  word); the spin word's name is jwize's to give.
- **Scripts are signatures too.** Behaviours and their dependencies are
  sig-named bees. Placing them on the grammar axis lets you see which scripts
  answer which words, which marks they serve, and which hosts carry which
  revision. Lining up grammar and meaning is how a script's reach becomes
  visible, and how a missing or stale one shows.
- **Same read, new projection.** The cube takes the lens's signature list and
  only arranges it. It adds no index, mints no pool and commits no layout, so
  a cold client rebuilds it from the lens alone.
- **Interactive, not editable.** You can open a cell (it opens as the
  triangulated hive for that slice), follow a signature to its origin, and
  compare two revisions by spinning time onto an axis. Changing a script is
  still the usual act in your own hive.
- **Rendering is three.js until a Pixi 3D returns.** jwize was accepted for a
  3D Pixi, but the access expired (2026-10-30), so the cube uses three.js in
  the meantime (jwize's call, same day). It ships as a signed dependency in
  the `sign('dependencies')` pool and loads through the import map, not as a
  bundled import in the shell, so it is swappable and only a reader who opens
  a cube ever fetches it. The cube module imports from core only. The cube
  stays behind the same read (signature list in, arrangement out), so the
  renderer can change to a Pixi 3D later without touching the lens.

### Cube and tiles together (jwize, 2026-10-30)

"Or a hybrid, if we are using tiles." The hive already draws tiles with Pixi,
so the cube does not have to redraw them.

- **Cube to navigate, hive to read.** three.js draws only the cube: cells as
  light cards (a count, a dominant picture, a gap marker). Selecting a cell
  or a face opens the ordinary Pixi hive for that slice, with real tiles,
  pictures and names. Nothing about tile rendering is duplicated, and tile
  names stay the DOM text they already are.
- **Face as a live hive (later).** A face can show a real hive by sharing the
  Pixi canvas as a texture on that face. It looks best, and it costs a second
  render loop and a texture upload per frame, plus the name-label and
  supersample constraints. Try it only after the first form works, and only
  for the face in focus; the other faces stay cards.
- **One data path.** Both forms read the same lens signature list, so the
  choice is only about drawing, and the form can change per device. A phone,
  which cannot afford a second GPU context, gets the card form or no cube.

## Open questions

- Visitor lens versus owner lens: this doc starts with the owner and the
  record layer only.
- Access gating for gated communities.
- How a community's name is published so a visitor can resolve it (a signed
  record beside `showcase:<zone>`).
- Staleness: how long a cached member pool is trusted before the directory is
  listed again (per host, `no-store` listing, immutable sigs).

## Related

`showcase.md`, `pools-across-hosts.md`, `hypercomb-communication-layer.md`.
