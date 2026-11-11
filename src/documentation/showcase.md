# The showcase — what your address shows, and your community behind it

jwize, 2026-10-24: "The showcase is the only thing people see when they are at
your address. You see your whole network." This is the default we recommend
for every networking-style app ("all networking style applications follow this
pattern … as a default recommendation"), and every editable community comes
with undo/redo ("any editable community … should include undo/redo as a
recommendation").

## Two views of one domain

- **A domain's page is a hyperdex** (jwize, 2026-10-25: "in the domain on
  hypercomb.com or persons.com it is a list that is an accordion and the
  domains you follow are the source for published items belonging to your
  peers"). Under a lean header (a small brand row, then the search), one row
  per domain: **this domain first and open**, its tiles its **showcase**;
  then the domains the viewer follows (`community:hosts`, kept on that
  origin), closed, each opening onto what that peer publishes. One row is open
  at a time. A stranger follows nothing there, so they see only the showcase;
  you, following your peers, see your whole network. On a phone that is all
  there is, with the follow input fixed at the bottom; the desktop keeps the
  setup beneath it, because it is the dashboard and the hosting (jwize:
  "desktop gets everything"). The front door draws it
  (`hypercomb-shim/src/bootstrap/showcase.ts`).
- **A straightforward list, the whole width of the screen** (jwize,
  2026-10-25: "we want to stick to that really straightforward list that takes
  up the whole screen width and gives room for you to see and do stuff and open
  into a viewport similar to the tiles"). On a phone the rows run edge to edge
  and each opens onto its tiles; on a desktop the list is as wide as the
  screen allows.
- **The search stays with you.** It is anchored flush to the top of the
  screen, in the place the brand was, as the page scrolls; the brand scrolls
  away and comes back when the page is scrolled back to the top.
- **A tap visits; a hold toggles** (jwize, 2026-10-25: "long press to toggle and single press to visit").
  A tile is a link to the content, so a tap, a middle-click and "open in a tab" all just go. On the
  owner's own device (a hive of theirs on the same origin answers) holding a tile for half a second puts it
  into the showcase or takes it out; for anyone else the hold lists the domains that hold a different
  revision, each a link, and the same-signature ones stay unseen while the tile is in the showcase. A
  right-click or Space lists the domains for the owner too. The click a hold ends with never also visits.
- **On other domains, a tap toggles** (jwize, 2026-10-25: "of course on other
  domains it is just toggling behaviors"): in your hive's Manage view, a tap on
  a tile of a followed domain switches it into or out of your showcase, the way
  a behaviour's switch is thrown, and a hold still says where else it is. That
  belongs to the hive, which holds the key; this page holds none and cannot
  sign, so on the page a tap always goes to the content. **Not built.**
- **You** see your whole **community**: your domains, each opening onto what it
  hosts, where you choose what joins your showcase.

"Community" is the word people read; underneath, a domain is a colony
([colony = domain](./domain-claim.md)).

## Your community: domains are tiles (design — not built)

Nothing in this section exists in the hive yet: no hive code calls `signShowcase` or the
switches below, no `showcase` layer slot is registered, and there is no Manage view.
The front door's side (reading a signed showcase) and the record's pure functions are
built; this is where they are headed.

Your community is a list you keep (the `community:hosts` pool). In your hive it
reads as your **hyperdex**: one tile per domain, drawn from that list. Nothing
is minted in your tree for it: add or remove a domain and its tile follows.

The tiles' **themes and properties are pools of meaning** (jwize, 2026-10-24:
"they update across domains and applications when people plug in new
pieces"). A domain tile's look and what it carries are never baked into it:
update the pool once and every domain and app that reads it follows, and a new
piece someone plugs in extends the pool.

- Open a domain's tile and the page beneath it is that domain's creations:
  what it hosts, from its ledger and its public pools. One domain is open at a
  time, because that is how a hive's pages work.
- A creation can be **visited** and tested, or **run as a sandbox** on that
  domain.
- **Manage**, on the open domain, turns clicks into switches. A single click
  turns a creation on or off for your showcase, like a behaviour's switch. A
  creation turned off **grays out** where it is and stays until you leave the
  page; come back and it is gone from your showcase, found again under its
  domain.
- **Show all**, on a domain, puts everything it hosts in your showcase, now
  and later.
- **Your community is a versioned view.** Another person's creation shows at
  a version you see and choose; you can never publish or push anything onto
  their domain or their creation (jwize, 2026-10-25: "your community should
  have a versioned view you can't push things on them").
- **Yours reflect your latest publish.** Wherever your own creations appear
  in your community, they show your hive's latest published version (jwize,
  2026-10-25: "for you they should all reflect your hive latest publish
  version").
- **Your own domain** is one of the tiles. Its creations can be turned off
  where they open (`setHiveDoors`, the front door's Off) or unpublished.

## The record

The shape and its readers are built; what writes it from the hive is the design above.

What you chose for a domain is one record:

```json
{ "kind": "host:showcase", "zone": "hypercomb.com",
  "items": [{ "pubkey": "<64 hex>", "lineage": "dylan" }],
  "domains": ["jwize.com"] }
```

- **In your hive** it is a resource, and its signature sits in a passive
  `showcase` layer slot on that domain's page, written with
  `LayerCommitter.commitSlotSet`. Each switch is one ordinary commit, so undo
  and redo are the hive's own: Ctrl+Z on that page brings back the showcase
  before the click. No second undo stack exists.
- **In public** the same bytes go to the domain and are named in your signed
  index as `showcase:<zone>`, the path a zone's card takes (`welcome:<zone>`).
  The page reads your index from the domain, checks its signature and the
  record's name, and draws exactly the items it names plus everything on the
  domains it shows in full (`hypercomb-shim/src/bootstrap/showcase-record.ts`).
  The owners whose record counts are the keys the domain's own root names in
  the ledger.
- A domain with no record yet shows what its owners **published here**: the
  lineages whose signed doors name this domain, which is Publish's switch for it.
  A lineage with no doors is not shown, even where the worker would open it.
- A named item is shown unless Publish has turned it off for this domain: the
  owners' signed doors have the last word on every item the record names. A
  domain "shown in full" brings everything it hosts, whether or not it opens here.
- **When it cannot be known, the page shows nothing rather than guess.** If no
  owner's index could be reached, or an index names a showcase that cannot be
  fetched or verified, the list says "Could not read what is published here." and
  draws nothing, never the larger set the owners did not choose. A later read
  that reaches no one keeps what the page last knew. Every owner the domain's
  root names must be read: one that cannot be, by a network error or a bad
  signature, makes the whole read unknown (an owner with no index here at all is
  just an owner who has signed nothing). The message sits above the platform's
  door tiles, where it can be read.
- **A followed domain's names stay its own.** Its ledger is drawn in its own row
  and never merges into a tile of this domain's by name, so it cannot add an
  owner, a label or an address under a tile that is yours.

The front door holds no key and cannot tell you from a visitor, which is why
the choice is a signed public record and never a switch on the page itself.
Adoptions (`host:adoptions`) stay what they were: one browser's own.

## Communities: more than one showcase

jwize, 2026-10-25: "multiple showcases on your mobile — a left-to-right or
right-to-left swipe to switch showcases. Basically grouping shared data. You
could start with *all*, and the groups allow filtering. That is best because
you can then look at it like a bunch of grayed-out tiles while managing, and
then show the selected ones when viewing. Nothing changes about the accordion:
it is still the master list with your offerings at the top." Then: "Yes they
can swipe through groups that they have access to." "You create a community
that is the name." "Swiping between your communities." "It can cycle as
well."

A **community** is a named page of your showcase: a filter over what it
already shows, never a way to show more. (This is a different thing from "your
community", the domains you follow; where both could be meant, say "a
community page".)

**What a visitor sees (built).**

- Under the search, a strip of names: **All**, then each community that has
  members. On a phone a sideways swipe on the list turns the page, and the
  pages **cycle**: on from the last is All, and back from All is the last. The
  tabs are a real tablist: arrow keys round the ends, Home and End, roving
  focus.
- The swipe is touch and pen only (a mouse has the tabs and the keys). It is
  committed on release, at least 56px (or a quick 24px flick) and clearly
  sideways (1.4 times more across than down), so a vertical scroll is never a
  swipe. It never starts from the screen's own edge, never takes over the
  browser's scrolling or pinch-zoom, and the click that ends a swipe is
  swallowed so it can never press a tile.
- A community page shows this domain's row filtered to its members. The
  platform's door tiles belong to **All**. The followed domains below it stay
  the master list. A member that is not in the showcase never appears: the page
  shows the showcase **and** the community.

**The record (built).** `communities: [{ name, items, domains }]` sits beside
`items` and `domains`, appended last and only when there are any, so a showcase
with none keeps the exact bytes and signature it had.

- **A community is its name.** It is cleaned (no format or control
  characters, spaces folded, forty code points) and keyed by the molecule fold
  of the name, so `Games!` and `games` are one community. `all` is the first
  page and is never a name; a reserved pool word is refused when you name one.
  At most 24, in the order they are swiped.
- Turning a creation off, or a domain's "show all" off, takes it out of every
  community in the same commit.
- Both readers (the front door's and the hive's) hold a record to the same
  check, pinned by a spec. A reader that meets a community asking for `access`
  it does not understand drops that community: an unknown gate fails closed.
- An old front door ignores the field and shows All.

**How a page is drawn (built).** The tiles, their pictures and their
properties never change; only the shape they are drawn in does (jwize,
2026-10-25: "a rendering aspect that keeps the same images and properties but
allows a more traditional row of four launcher. The default is hexagons for the
brand"; "there should be a way on the groups to change launcher renderings").

- A **view** is a property: `view` on the showcase (how All is drawn) and `view`
  on a community (how that page is drawn). Absent, a community is drawn as All
  is, and All is drawn as **hexagons**, the brand's default. An explicit `hex`
  on a community beats an inherited `launcher`, `iphone`, `list`, or `tiles`.
- `hex` is the comb of hexagons. `launcher` is the traditional launcher: the
  same tiles in rows of four, rounded icons with the name beneath, the same
  owner counts, check marks and links. `iphone` is the iPhone launcher: those
  same tiles as icons in four columns on a phone-shaped screen, the name under
  each one. Once the page has more than four, the first four sit in the dock
  and the rest in the grid above it. `list` is a column of blocks: the picture
  at the left, the name and address beside it. A block on your own page is a
  link, and a tap opens it. A block under another domain is on or off — on
  wears the check, off is gray — and a tap switches it, the same as the other
  shapes. `tiles` is one column of squares, and the column is a scroller: the
  frame is square, each square fills it, the picture goes to every edge, and a
  flick lands on the next square. The name and address sit on the picture. Up
  and down in that column moves the next square into the frame. It does not
  turn the set.
- The names walk in that order — `hex`, then `launcher`, then `iphone`, then
  `list`, then `tiles`, then back to `hex`. A new idea is another name in that list, drawn
  by both readers (the hive that writes the record and the front door that
  reads it). A name neither knows is not a view, and the page is drawn as
  hexagons.
- The followed domains stay the master list, drawn in the shape All has.
- `?view=tiles` (or `list`, or `iphone`, or `launcher`, or `hex`) on the address asks for a shape for
  whoever is looking, and signs nothing: the way to try one before choosing it.
- The set is closed on purpose: a view is a name this reader draws. A piece
  someone plugs in to draw a new shape would arrive as a signature-addressed
  resource, and that needs a decision about running foreign styling that is not
  made yet.

**Managing changes what a swipe does (built).** With Manage off, a sideways
swipe goes back and forward: through the sets when the page is showing them,
and through the browser's own back and forward when it is not. An up or down
drag stays a scroll. With Manage on, a sideways swipe changes the template of
the page you are on (hexagons, the row launcher, the iPhone launcher, the list, the square column), and an
up or down swipe changes the filtered set — the communities, or, when none are
named, the domains you follow. Leaving Manage puts the sideways swipe back to
back and forward. The template you landed on stays for this visit and signs
nothing; choosing it for visitors is the community window's template control,
then Publish. The arrow keys follow the same split. A line under the set's
name says which template is showing, and how the two swipes are split.

**Not built.**

- **Making one in the hive.** Naming a community, choosing its view, the Manage view (every tile
  shown, the non-members grayed out, a click toggling membership) and signing
  the record all live in the hive, with native undo through the `showcase`
  layer slot. The record's writer is built (`addCommunity`, `removeCommunity`,
  `toggleCommunityItem`, `setView`, `setCommunityView`); the screen is not. The Publish panel's Groups are not
  reused for membership: a group holds child tiles of one page, and a community
  holds a peer's items too.
- **Access-gated communities.** Today every community in the record is as public
  as the showcase: anyone who fetches the record sees every name and member, and
  a swipe strip is a view, never a lock. "Communities they have access to" is
  therefore, for now, every community. A gated community cannot live in the
  public record at all (its name, its count and its members would leak); it
  would be a separate sealed atom, reached by a link that carries its key in the
  fragment (as a swarm link does), with a random id and the name inside the
  sealed blob. Turning a door off or unpublishing stay the only real hide.

## Groups: one label, not tabs (jwize, 2026-10-25)

"I don't want tabs, I want the label for the current group." The page shows the
current group's name once (All, or a community); a swipe, the arrow keys or a tap on
the label turn to the next. **Manage** (not built, hive side) is an icon to the right
of the search: in it the label can be renamed, every showcase tile is shown, and a
tile is switched on or off for that group; leaving Manage hides the ones switched off.

### Built (hive side, first cut)

`community <domain>` opens the window (`sharing/community.view.ts`): the search with the Manage icon to its
right, the current group's label (tap, swipe or arrow keys turn it; in Manage it renames), every candidate
tile with the ones off grayed (a tap switches it for the group; leaving Manage hides them), new group,
the template per group (hexagons, the row launcher, the iPhone launcher, the list, the square column), delete, undo/redo (`community.draft.ts`) and **Publish**
(`community publish`), which asks first and signs `showcase:<zone>`. **Still owed:** the draft is
in-window undo only, not yet the hive's own history slot, so closing the window drops the undo trail; and the
candidates are this key's lineages on the zone, not yet the followed domains' tiles.

### The tap on the page, for the owner (jwize 2026-10-25)

"Whatever you're hosting should be able to have that key" and "I should be able to manage my showcase on my
mobile with the key in my device": a participant's own host holds the page and the hive on one origin, and
the device's key is passed to other devices by the key list. So the page asks the hive beside it, over a
same-origin BroadcastChannel (`owner-bridge.ts` here, `showcase-bridge.ts` in the hive): `hello` finds out
whether this device is the owner's; a tap on a tile then puts it into the showcase (in another domain's row;
the ones not in it are grayed) or takes it out (in your own row), and the hive signs with its tested writer.
A visitor, or a page with no hive on its origin, gets no answer and a hold just lists the domains. A hold still lists the
other domains. **Not yet checked on a real host:** that the page and the hive share an origin there, and the
key-list path for a second device.

**Untap brings the domains back.** A held tile leaves out the domains whose copy is signed the same as the one in
your showcase; take the tile out of the showcase and they are listed again.

**Adding a phone is one tap** (jwize 2026-10-25: "the transport and distribution of keys must be safe and
easy"): `keys allow` on the desktop gives a link (ten minutes, one use); opened on the phone it asks once, in
words, and the tap adds the phone's own key to your key list. Nothing secret is copied; `keys off` removes it.
`keys allow` also shows the link as a QR code (`sharing/qr-code.ts`, no third-party code; `invite-qr.view.ts` draws it until the invite ends), so a phone in the room can just be pointed at it. The encoder is held, module for module, to the Python `qrcode` package's output for 13 texts under all 8 masks, versions 1-10 (`qr-code.reference.json`). **Not built:** a revoke row in a window (`keys off` does it).

### Under another domain a tap turns it on (jwize 2026-10-25, last word)

"They should all be grayed out under other domains and when you click it lights up and it is added to the
showcase." So the two kinds of row differ: **in the showcase** (this domain's row) a tap visits and a hold takes
the tile out (on the owner's device) or lists its domains; **under another domain** every tile is grayed unless it
is already in the showcase, and a tap lights it up and adds it (a second tap takes it out); a hold lists the domains
and offers the same switch. With a hive beside the page the switch is signed there; with none the tap opens the hive
that has the key (`#showcase=` link, `showcase-link.ts`; the hive asks once, signs, and returns you). Arrival shows
only the showcase open. Search and Follow are unchanged.

### Arrival is the brand and the tiles (jwize 2026-10-25)

"It should just be the branding and the tiles with a manage button and the current view becomes manage." On
arrival the page is the brand, the search, and the showcase's tiles, nothing else: no row headers, no other domains, no
follow box. The Manage icon, to the right of the search, turns that same view into the manager: every domain you
follow as a row, their tiles grayed until turned on, and the follow box. Pressing it again returns to the showcase.

### The buttons sit at the bottom

The page arrives as the brand and the tiles. The search is not there until it is asked for. A bar fixed at the bottom holds two buttons. The magnifying glass shows the search across the top and focuses it, or hides it and clears what was typed, so the top is only the brand. Manage opens the management screen — the domains, the tiles that can be turned on or off, and the follow box — and pressing it again returns to the showcase. Escape in the search hides it the same way.

### Groups are set aside (jwize 2026-10-25: "we aren't doing groups for now")

The page no longer draws groups: no "All" row or word, no group label, no swipe between pages (`groups` is an option, off
unless asked for; the record and the hive's `community` window still carry them, so nothing signed is lost). The hive's
own setup ("Manage this hive": creations, sources, packages, deployments) now waits behind the Manage icon, so arrival is the
brand, the search and the tiles.

### A showcase tile is a belief; carrying bytes belongs to following (jwize 2026-10-25)

Turning a tile on names it (`{pubkey, lineage}`) and links to where its author serves it: the ACT of adding to a showcase copies
nothing ("it goes against the ethos of believing in somebody", and a host that only supplies a third party's bytes is no
better than a redirect when they vanish). Carrying bytes is a different act and belongs to FOLLOWING: "you always carry the
bytes for a site you are following, so the byte sharing runs laterally", the followers being the copies. Whether following
carries the bytes today has not been checked (it is a design stated here, not built behaviour). What an author controls is their own
word: signed doors, honored by honest readers; nothing forces another host to forget a byte. Private content is encrypted
on the device and never public.

### One view; Manage only filters the domains (jwize 2026-10-25, latest)

There are no two views. The page is always the same tile grid. The Manage icon adds a strip of the domains (yours first, then the
ones you follow); the one pressed is the one whose tiles are shown, grayed unless already in the showcase, and a tap turns one on.
No accordion rows. The search is only for search. The follow box stays at the foot all the time, and when the search holds a valid
domain nobody follows yet it suggests it in the follow box (never replacing what the person typed there). Following a domain turns
the filter on to show it.

### Pictures: a tile with none inherits (jwize 2026-10-26)

"Blanks should always inherit what is available when empty." The front door's picture for a hive is its own (`large`, else `small`,
in its head's first properties entry), else the first child's, level by level (two levels, 40 layer reads at most), else the generated
cover. Checked on the live hypercomb.com on 2026-10-26: only revolucion and camelflage carry a picture; the other seven publish
`properties` holding only `index`, and nothing below them or in their website pages carries one either, so they still show the
generated cover until a picture is set on them in the hive and published (it travels with the publish).

### The comb is flush, and updated pictures have a word (jwize 2026-10-26)

The honeycomb spans its card **edge to edge**: the tiles are grown just enough that a full row has the outer hexagons' flat
sides on the comb's own edges, the card's side padding is gone, and the gutter between tiles is `.2rem` (`.12rem` on a phone).
**`republish`** (`sharing/republish.queen.ts`, the participant's word like every publish form) publishes again every page the
Publish panel marks `drift` (published, and its head here has moved on, as it does when a picture is set on a tile): it names
them, asks once, and runs them one after another to the hosts each names, as the panel's selected-apps run does. It never
publishes anything that was not already published. The pictures on the front door appear as soon as the republish lands.

### Dark by default, and a padded outer card (jwize 2026-10-26)

The front door's default theme is **dark** (`hypercomb-shim/index.html` sets `data-theme` before first paint to the stored
`hc:theme`, else `dark`; a visitor who chose another theme keeps it, and `system` still follows the browser). The hive shells'
own default (`hypercomb-shared/core/theme.service.ts`, `DEFAULT_THEME = 'honey'`) is a separate decision and is unchanged. The
outer card around the tiles is padded on all sides (`1rem`), so the dark background surrounds the comb completely, while the
tiles inside still span the card's inner width edge to edge.

### The follow bar is anchored; the card fits its tiles (jwize 2026-10-26)

The follow input and its button are anchored to the bottom of the screen (sticky, pushed to the foot of a panel that is at
least the screen tall), so a short list leaves the bar at the bottom and a long one carries it along. The outer card is exactly
as tall as its tiles plus its own padding, and the gap between it and the bar is the search's `.55rem`. The gutter between tiles
is `.3rem` (`.18rem` on a phone), a very slight increase on the first flush layout.

### No dead area, and symmetrical gutters (jwize 2026-10-26)

The open card takes the whole space between the search and the follow bar, so the dark surface runs unbroken from one to the
other with the tiles at its top. The gutter above the card (from the search) and the gutter below it (to the follow input) are
the same `.55rem`, so the card is centred between its two inputs.

### The domains are an accordion, the open one always on top (jwize 2026-10-26)

"You click the domain view and it is an accordion of domains with the open one showing the available; they are below the open item,
which is always at the top." Under Manage every domain is a row (globe, name, tile count, chevron). The open row shows its tiles and
is always the FIRST row; the other domains follow below it as header rows. Opening another domain moves it to the top and the one it
replaced drops below. (An earlier pass drew the domains as tags, then as a dropdown list; neither is kept.) On arrival there is no
accordion at all: only the showcase.

### Side margins (jwize 2026-10-26)

The page's side margin is `.5rem` (it was `1.5rem`), and the brand row, the search with its Manage icon, the card and the follow input with
its button all share the same left and right edge (measured: 8px to the window's edge at 1500px, all five at the same x).

### A domain being checked shows at once, and "not found" does not stay (jwize 2026-10-26)

Following a domain adds its row the moment it is asked for, marked **Checking…**, before the host has been asked. If the host
answers like a host it becomes an ordinary followed row; if not, the row stays with **Not found** and the reason, toned as a
warning. That row is temporary and kept nowhere: it goes when the page is refreshed, when another row is opened, when Manage is
toggled, or when another domain is asked for.

### Narrow is the same page (jwize 2026-10-26: "when squeezed it has a margin again")

Under 720px the page keeps the same `.5rem` side margin as the wide one: the brand, the search, the comb and the follow input all
start 8px from the screen edge (measured at 378px). The follow bar is no longer fixed over the page; it is in the flow at the foot of a
screen-tall panel, sticky to the bottom, so the card fills right down to it and no band is left between them.

### A followed domain is alive when added and leaves only when removed (jwize 2026-10-26)

Checked on the live page in a persistent browser profile: a followed domain (realones.online) is still listed after a reload and after
the browser was closed and reopened; it lives in the browser's `community:hosts` pool, not in the page. Nothing but removal takes it away:
a refresh, opening another row, toggling Manage and searching leave it alone (specs). Each followed row now has a **remove** control
(shown under Manage) that forgets it in the store (`removeHostZone`) and drops the row; if the store cannot forget it the row stays and says
so. Only the temporary rows (Checking…, Not found) are ever dropped by anything else. The local preview window now keeps its own profile between
runs for the same reason (`--fresh` starts empty).

### The front door shows the hive's capture, so zoom and position match (jwize 2026-10-26)

A tile's picture is stored twice: the original (`large.image` plus a framing `large.{x,y,scale}`) and a CAPTURE (`small.image`, the point-top hexagon box
at 346x400) that is the original already cropped and zoomed by that framing. The hive draws the capture; the front door used to draw the original
centred, so the zoom and position differed (the agenda globe was cropped). It now shows the capture first and the original only for a tile with no
capture. Checked on every hive the live ledger lists: each capture resolves as a 346x400 image, so all of them frame as the hive does.

### Collapse them all to the top (jwize 2026-10-26)

Pressing the open domain's header collapses it, and then NO row is open, so none takes the free height: every domain stays a plain
header row and they stack from the top, in order. (It used to leave the first collapsed row at the top and push the next one to the bottom.)
Opening any header brings it back to the top with its tiles.

### Tiles toggle where they sit (jwize 2026-11-10; replaces the community row of 2026-11-04)

"You add domains. You go to them and toggle things on or off. Then you are back in your mobile app view and you are just using
the creations." While editing, every row is a domain and every tile stays in its own domain's row: lit when it is on, gray when
it is not. A tile is ON when it is published here (the owners' signed showcase) or this browser turned it on. There is no
community row; the community is the page you come back to — what is published here, and what this browser turned on in any
domain it added. What this browser turned on is kept in `community:tiles` (`readCommunity` / `keepCommunity`) and signs nothing.

Who can do what:

- **Without the key, on a phone**: a tap is the switch itself, at once, no question. It can turn on or off only this browser's
  own picks. A tile the domain published says so: only its key can take it off.
- **With the key** (a hive beside the page, or a phone that took its owner's invite), or on a desktop where the tap can be handed
  to the hive: a tap asks once, and yes is the signed act — publish or unpublish — so a visitor sees the same community.

**One tap, then one red button across the foot (jwize 2026-11-10).** The question is not a sheet over the tiles. The tap marks
the tile and a red bar across the bottom of the screen says what pressing it signs ("Put dylan in my showcase"). Pressing it
is the yes. Escape, or a tap anywhere that is not a tile, puts it away with nothing done; a tap on another tile asks about
that one instead.

### Just a search and the tiles (jwize 2026-11-10)

The page a visitor lands on is one input, called Search, and the tiles. The mark, the name, its sentence and the counts show
only while editing, where they say which domain is being edited. A room the owner hosts ("Join the swarm") stays, because it
is a door and not information.

There is no follow box and no link inside the field. While what is typed is a domain nobody follows yet, a button across the
foot of the screen names it — "Add jwize.com" — the same bar the red confirm uses, without the red. Until the line is a
domain it is only a search.

### The help tiles are optional (jwize 2026-11-10)

The starting tile and the platform's own doors (the tour, the app, source, licensing) are help. A host that staged a front
page of its own — hypercomb.com — shows what it staged. Every other host shows none of them by default. While editing they
sit gray in the domain's own row and a tap turns one on or off; the choice is kept in this browser, in the same
`community:tiles` document as its other picks, under a key no tile has (`help:<address>`, `help:start`). The tour is the
protocol hive, `protocol.hypercomb.com`.

A domain whose ledger names no owner has nothing signed to read, so its row says "Nothing is published here yet." and never
"Could not read what is published here."

### Four looks, swiped sideways while editing (jwize 2026-11-10)

A sideways swipe on the list while editing walks four looks and goes round: hexagons, the launcher (rows of four), the iPhone
screen, the list of buttons. The square column (`tiles`) is still a view a signed record or `?view=tiles` may name, but the
swipe does not walk it. The look chosen is kept in this browser (in the `showcase:orientation` document, beside the lane
orientation), so leaving edit mode and coming back later keeps it. Swiping signs nothing: a visitor is shown the owners' record.

With the key, a quiet link beside the look's name — "Show visitors this look" — signs it into that record (`view`), so every
visitor is shown it. It is there only while the look tried here is not the one already signed. The page asks over the same
bridge as a toggle (`{ t: 'view', zone, view }`): the hive answers with `applyView` (essentials `showcase-bridge.ts`), a phone
that took its owner's invite signs it itself (`device-owner.ts`). Hexagons is the absence of a view; a zone with no record yet
keeps showing what it publishes, because the record that first names a look names those too. A hive older than this never
answers, and the page says so.

Being in the showcase is a different act, not a tap: a hold on the owner's own tile, or the held sheet's "Put it in my showcase".
**Only a revision that is optimized and minimized can be put in.** `minimized.ts` asks the domain serving the head: its root layer
names `derivedFrom`, or a derivation record is a member of `derived:<head>` (`derivations.md`). A revision that is not yet minimized
is refused with the reason; taking one out is never gated. Nothing asks where the page was given no `minimized` check.

### The phone has one input (jwize 2026-11-04)

The follow bar at the foot is gone on a phone. The header search carries one dynamic button beside it: **Follow** while the line is a
domain nobody follows yet (`followCandidate`), **Go** otherwise — on a followed domain Go opens its row; on anything else it
dismisses the keyboard, since the search already filters as you type. The keyboard's Go key does the same, on a phone only. The
tiles scroll under the dock, and the list's own end padding lets the last tiles rest fully above it. The Files sheet is a title
and a short list of revisions (loaded here, newest on each domain) with one signature box; opening one shows its files with a Back,
and the tools that change a branch wait behind one line.
