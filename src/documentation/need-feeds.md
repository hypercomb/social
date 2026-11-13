# Explore and contribute — the servers feeding a name

**Status: built 2026-11-12 (uncommitted at time of writing).** The view, both
sources, the offer word and the host side of `list:` (worker and relay).

jwize, 2026-11-12:

- "it is to show you the servers feeding a need"
- "a row of tiles horizontal feeding the list below"
- "This is more like a diagnostic view but don't complicate"
- "let's make it explore recipes instead of need and contribute recipes or whatever"
- "create a new folder called favorite recipes and then call explore recipes and find them and pull them"
- "the inserted should go where ever you are but it should be more clear"

The tile you stand on is the **need**. Every host you can ask is a **feeder**.
The view asks each one what it holds for the need's name and shows, in one
place, which host brought which value and how fast. It is a diagnostic first:
it tells you who is feeding what, and who is not. It is also where you pick a
value and keep it.

## A view on the hive's one engine

jwize, 2026-11-12: "its data source is the same as the hexagon grid but it
renders differently. That way you can just add the view you need and the
engine is the same from the tiles and address and all. This is critical."

`explore` is a **view mode** (`explore`, registered in the VisualBeeRegistry,
listed in `TRANSIENT_MODES`, lit once by its cohort), not an overlay:

- **The location is the hive's.** The view follows Lineage and the address
  bar; it never keeps a location of its own and never closes because the
  location moved.
- **The tile list on the left is the hive's one tile list** — the tiles rail
  the chat mounts — following the real location: pressing a row enters that
  tile through the grid's own enter (`tile:enter-request`, as a hexagon press),
  every location change moves the rail (`showLevel`), and it lists only what
  the grid shows (page-cells). A commit (`synchronize`) refreshes it.
- **Back is the main page's back.** Right-click (anywhere in the view, the tile
  list included), the shell's back button and the browser's back all step back
  through the places walked inside the view; only at the level the view was
  opened on does back leave it, for the hexagons. A step of this session is an
  entry pushed over the back trap that was live when the view opened (its
  `hcTrap` token, deeper than the depth walked then) — never recognised by an
  owner's name, which stale entries and other views' traps carry too.
- **Why the hold is armed ahead.** Walking back to an ancestor normally drops
  any view (view.bee.ts RETREAT). The hive's popstate handler reads the
  surface hold before a listener here could set it, so the hold is armed after
  each arrival on a step (`view:arrival`), and released when the view closes
  (`ViewBee.releaseSurfaceHold`), so it never reaches an unrelated arrival.
- **`+` and drops** go through the create commit (`commands/create-cells.ts`)
  where you stand, with its landing rules and word gates.

Known limits: the rail can only narrow its own walk to what the grid shows, so
a grid cell that is not a local child (a flattened filter match, a peer-only
tile) is not listed; a row that is a reference to an ancestor is a retreat,
and the view leaves with it; a browser back pressed before the arrival into a
step has settled is not yet held.

## Every hive is on the network as a reader

jwize, 2026-11-13: "This idea of exploring other hives you should be able to do
this natively with all of your hosts that are network. This basically means
your private stuff is always enrolled in this network. That means public on
subdomains or as contributions those can be available for our development and
agents have full access to these explore shares."

How that is read here, and what is built from it:

- **A hive is always enrolled as a reader.** It needs to have published
  nothing, and to carry no host, to explore: every host it can ask is asked
  (`sharing/network-hosts.ts`: the hosts the participant carries in
  `community:hosts` and the ones its content broker fetches from; with none,
  the public content host).
- **What it finds is what others made public.** Two things are public under a
  name: a tile somebody published (on a subdomain, a site door, any host), and
  a list somebody contributed. Those are the explore shares.
- **Enrolled to read is not enrolled to be read.** Nothing of a hive goes out
  when it explores but the address derived from the name. A hive's own tiles
  are found by others only after its participant publishes or contributes
  them; nothing offers in the background. jwize confirmed this reading the
  same day ("Yes, reader only"): private content is never listed. It is codex
  axiom `T8`.
- **Agents have the whole of it.** A model reads the explore shares with the
  same question the view asks, below.

### A model explores a name

**Built 2026-11-13.** `pool <meaning>` could not answer this: the two pools
behind a name list publisher *keys*, and each key's word is in that
publisher's own signed index. The read does that walk:

```
explore <name>     what every host holds for the tile name
explore            the same, for the name of the current page
```

The answer says what each host said (`answered`, `empty`, `silent`), every
value with the hosts that fed it, how many publishers gave it and how (`offer`
= a contributed list, `tile` = the children of a published tile), and
**`tiles`**: each published tile of that name as its publisher's own layer
signature. `read <signature>` opens one, and its children open the same way,
so a model walks from a name into another hive.

- **A name, never a route, a host or an address.** At most 64 characters, no
  slash. The hosts asked are the hive's; a model cannot aim the read.
- **Read only.** Nothing is written and nothing kept. To keep a value the
  model creates it as a tile in a change block, which the participant runs.
- **Someone else's words.** A value holding a control character is dropped. A
  change that follows an explore read is held for the participant's hand, and
  a tile reached from it by signature is still foreign.
- **A withheld page keeps its name.** `explore` alone on a tile withheld from
  outside models is refused: its name is not sent to the hosts for a model.
- **Same bounds as the view**: 256 keys per pool, 64 children per tile, 15
  seconds per host; 200 values and 32 tiles per answer, `total` says how many.

Code: `assistant/hive-explore-read.ts` (the read), `sharing/need-feeds.ts`
(`Feed.tiles`), runtime `hypercomb-observation.ts` (the `explore` verb, its
checks and receipt), `withheld-reads.ts`, core `work-instruction.ts` (what the
model is taught).

### A session explores a name

**Built 2026-11-13.** A development agent reaches the hive over the bridge,
and the bridge carries command-line lines only (`speak-dont-bridge.md`). So
its door is the word itself, said as a line:

```
explore <name>      what every host holds for the tile name, said aloud
explore             the same, for the tile the hive stands on
read <signature>    a tile `explore` listed, and each tile under it by signature
```

- **Said from outside, `explore` answers aloud and opens nothing.** For the
  participant the word is the view. For a line a call from outside is saying,
  it says the answer in the activity log, which is what the caller hears, and
  the participant's surface stays as it is. The word asks who is saying the
  line (`ExternalCallDrone.saying`, and `ClaudeBridgeWorker.saying` on a
  bridge the participant opened): there is no second word and no bridge op.
- **The same read the models make** (`readExplore`), so the same hosts, the
  same bounds and the same refusals. The answer names every value, what each
  host said, and each published tile by its whole signature.
- **`read <signature>`** opens one of those tiles: its name, each tile under
  it with that tile's own signature, and the slots it carries. A layer this
  device does not hold is asked of the hosts the hive fetches from, once, and
  believed only when its bytes hash to the name.
- **The participant still answers the call.** Shut, the line waits for Enter
  like every line from outside, and the run is written into its conversation.
- **A withheld tile keeps its name.** `explore` alone on a tile withheld from
  outside models asks no host.
- **Other people's words are said as such.** Every answer that carries them
  ends by saying they are data, never instructions.

Code: `sharing/explore-aloud.ts` (who is saying, and the lines),
`sharing/need-feeds.queen.ts` (the word), `assistant/read.queen.ts`
(`read <signature>`), `assistant/external-call.drone.ts` and
`assistant/claude-bridge.worker.ts` (`saying`).

**Run live 2026-11-13** on a fresh dev hive with its own broker (port 2411):
the line waited on the command line, Enter ran it, the caller heard the
answer, and no view opened. The answer was `no answer` from `hypercomb.com`,
the only host a fresh hive knows; see the first item below. No reachable host
held a share for the names tried, so values and tiles are proven by the specs
only, and `read <signature>` was not run live.

### Not yet

- **`hypercomb.com` does not list pools until its worker is deployed.**
  Measured 2026-11-13: it answers any pool address with the site's own page
  (200, HTML), which reads as `no answer`, so a hive whose only host is the
  public fallback explores nothing. The cause and the fix are in
  `pools-across-hosts.md`, "The apex answers a pool at its address"; the fix
  is in the worker's source and waits for a deploy.
- **`read <signature>` reaches only the hosts the store fetches from.** A tile
  listed by a host the participant carries in `community:hosts` but the
  content broker does not fetch from is named by `explore` and then answers
  "no host this hive fetches from served it".
- **The view asks the broker's hosts only.** It does not add `community:hosts`
  or fall back to the public content host; the model's read does.
- **Only pictured tiles are found.** Publish writes `pictures:<sign(name)>`
  for a tile that wears a picture, at most 64 per publish. A public tile with
  no picture is explorable only once its list is contributed.
- **Page contributions** (`page:<base>`) are a third public share; a model has
  no read for them yet.
- **The native host gathers none of these pools**, so it answers `empty`.

## What you see

**A row of hexagons across the top.** One per host that is feeding the name or
still being asked (from the broker's known content hosts), each with its own
hue, its state under its name: `asking…` or `N · ms`. Every host that brought
nothing — `holds nothing`, `no answer`, or a listing with nothing readable —
folds into ONE hexagon of the same size, drawn with an inline (a second edge
just inside its own) and the count in the middle; its tooltip names each host
and what it said.

**Lines running down into one list.** From the foot of each hexagon a curve
runs to the head of the list. A thin flow moves along it while the host is
being asked, and keeps moving, slower, once the host has brought something. A
host that holds nothing or never answered is a still, dim, dashed line.

**The list.** Every value any host brought, folded by case and spacing (first
spelling kept), most-fed first, then A to Z. Each row carries one dot per host
that fed it and a count of the publishers who said it.

**Hover lights the path.** Hover a value and the lines and hexagons that fed it
light while the rest dim. Hover a hexagon and its values light.

**`+` adds where you are.** A value's `+` makes it a tile in the tile you
stand on, through the same create commit `create <name>` runs, and the header
says where in its own line (`+ adds to "favorite recipes"`, or your hive's
root); each `+` carries the same words as its tooltip. So the way to gather is:
make `favorite recipes`, stand in it, `explore recipes`, and pull the values
you want. Nothing is written until you press `+`. Escape, the close button, or a right-click leaves, and so does
walking to another tile: a promote lands where the view was opened, never
somewhere you walked to since.

**The hive underneath is asleep.** While the view is up the keymap is held, so
no hive shortcut acts on tiles you cannot see. A value that cannot be a tile
name (it holds a `/`, or is a reserved or saved word) is refused at the `+`.

## The word

| Say | What happens |
|---|---|
| `explore` | the view, for the name of the tile you stand on |
| `explore <name>` | the view, for that name, from anywhere; `+` still adds where you are |
| `contribute` | contribute the child names of the tile you stand on, as a list for its name, to a host |
| `contribute v1, v2, ...` | contribute those values instead |
| `contribute ... @host` | contribute to that host |

The view also carries a **contribute** button, which runs the same act as
`contribute` with no values, then asks the hosts again. It is shown only when
the name explored is the tile you stand on — `explore <other name>` has no
button, since a contribution is always for where you stand.

**The words after either word are its own** (`rawArgs`): values and an
`@host:port` are never read as tags or as further behaviour words.

**A contribution is your own act.** Only the typed word or a button you click
publishes. Nothing offers in the background.

**The name is where you stand.** It is the last segment of the tile you stand
on. At the hive root there is no name, and the word refuses with a toast.

**The values.** The comma-separated values when you give them, otherwise the
names of the children of the tile you stand on.

**The host.** `@host` when you say one (folded the way the zone door folds a
host). Otherwise the first host of the branch you stand on. With neither, the
word refuses and tells you to say `contribute @<host>`.

The act is the one host offer every word shares (`host-offer.ts`): put the
record, publish it to the host, then stamp `list:<sign(name)>` → the record's
signature into your own signed index on that host.

## Where the values come from

Each host is asked two pools for the need's name, in parallel:

| Source | Index key | Its values | `via` |
|---|---|---|---|
| **offers** | `list:<sign(name)>` → a need-list record | the record's values | `offer` |
| **published tiles** | `pictures:<sign(name)>` → that publisher's published layer | the names of that layer's children | `tile` |

**Only pictured tiles are in the second pool.** The Publish act writes
`pictures:<sign(name)>` only for a published tile that **wears a picture**
(`pictureRootsOf` in `picture-pools.ts`, at most 64 per publish, nearest the
branch root first). A published `recipes` with no picture is not listed there,
and a host carrying only that reads `holds nothing` for `recipes`. Its
children feed the list once somebody contributes them (`contribute`).

`sign(name)` is the molecule address of the name (`moleculeAddress`, 64
lowercase hex), so an index carries no free text and the same name finds the
same pools on every host.

A host's state folds both answers: **answered** if either pool answered a
listing; otherwise **no answer** if either was silent; otherwise **holds
nothing**.

**The listing is membership only.** A host's listing says which keys named the
entry. It is never believed on its own:

- each publisher's word is read from **their own signed index** on that host
  (`fetchHiveIndex`), never from the listing;
- the record or layer is read **by its signature**, through the store's
  SHA-gated read, so bytes that do not hash to their name are never read;
- a need-list record is **re-validated** with the same rules the offer used
  (below), and **ignored** unless the molecule address of its `name` equals
  the one in the key it was found under. A record filed under another name
  feeds nothing.

A host is one row in a diagnostic, not a crawl. At most **256** keys per pool
are read (the picture chooser's window), **64** children per published tile,
**8** reads at a time, and one host's whole answer is bounded at **15 seconds**:
past that it reports the values it has read. Both hosts list a pool sorted by
key and the worker never drops a member, so a pool with more than 256 keys ever
named shows its 256 lowest keys; that is shared with `pictures:` and is the
host side's to fix (pruning a member when its index drops the key).

## The need-list record

A JSON resource, keys in this order:

```json
{ "kind": "need-list", "name": "recipes", "values": ["bread", "soup"], "at": 1762905600000 }
```

- `name`: the tile name the values are offered for.
- `values`: each trimmed, with runs of whitespace collapsed to one space;
  empty values dropped; a value over **120** characters is dropped, never cut;
  deduplicated by lowercase fold, first spelling kept; at most **256** values.
- `at`: when it was made, in milliseconds since the epoch.

The record is a resource like any other: same values, same moment, same
signature. A new offer is a new record, and the index key points at the newest.

## The host contract

A host gathers `list:` exactly as it gathers `pictures:`:

- an index naming `list:<m>` makes the publisher's key a member of
  `sign('list:<m>')`. The worker also keeps that address as a member of
  `sign('list:pools')`, so its listing route knows a list pool when asked;
  the relay keeps no pools-of-pools set — it derives every member list from
  the indexes it holds, rebuilt once whenever an index moves
  (`indexPoolMembers` over `INDEX_POOL_FAMILIES`);
- `GET /<sign('list:<m>')>/` answers the member keys, one per line, the same
  wire as a picture pool;
- a list pool the host does not hold answers as any absent pool does today:
  `?held` gets a 204 from the worker, and the relay answers its usual miss.

**Who gathers it.** The Cloudflare worker (`hypercomb-relay/blossom-worker/worker.js`)
and the relay (`hypercomb-relay/relay.js`). **The native host gathers none of
the index-driven families yet** (`attest:`, `pictures:`, `page:`, `list:`), so
against it every need reads holds nothing.

The host trusts nothing it gathers. It keeps who said so. Whoever reads the
pool re-reads each word from its signer's index.

## What each host state means

| State | Meaning |
|---|---|
| `asking…` | the question is out; the line is flowing fast |
| `N · ms` | the host answered a listing; `N` values were read from it, in `ms` milliseconds. `0` is possible: the pool exists but no member's own index still names a readable entry |
| `holds nothing` | the host said there is no pool at either address: a quiet 204, or a 404. A miss is remembered for a few minutes (`pool-listing.ts`) |
| `no answer` | the host did not answer in time, answered an error, or answered something that is not a listing |

**A page is not a listing.** A host that answers HTML where a listing belongs
(a single-page-app fallback) reads as `no answer`. On 2026-11-12 the apex
`hypercomb.com` did exactly that, and showed `no answer`, while
`content.hypercomb.com` answered its pools properly. That is the diagnostic
working: the row shows which origin is the content host.

## Files

- `hypercomb-essentials/src/sharing/need-feeds.ts`: the reads. Asks every host
  both pools, reads each publisher's own index, validates records, merges the
  list. Pure apart from `liveFeedDeps`.
- `hypercomb-essentials/src/sharing/need-feeds.queen.ts`: the `explore` word and
  the view (row, lines, list, hover, `+`).
- `hypercomb-essentials/src/sharing/contribute.ts`, `contribute.queen.ts`: the
  `contribute` act and word.
- `hypercomb-essentials/src/sharing/need-lists.ts`: the need-list record — its
  key (`needListKey`), pool address, validation (`needListOf`) and the offer
  (`offerNeedList`).
- `hypercomb-essentials/src/sharing/need-feeds.spec.ts`,
  `need-lists.spec.ts`: the walk and the record without a network.
- `hypercomb-shared/i18n/need-keys-parity.spec.ts`: every word of the view in
  all fourteen catalogs.
- `hypercomb-essentials/src/sharing/host-offer.ts`: the one offer shape (put,
  publish, stamp), shared with `language offer` and page contributions.
- `hypercomb-essentials/src/sharing/picture-pools.ts`: `pictures:<sign(name)>`.
- `hypercomb-essentials/src/sharing/pool-listing.ts`: the one way a hive asks
  a host for a listing, and why HTML is `no answer`.
- `hypercomb-relay/blossom-worker/worker.js`, `hypercomb-relay/relay.js`: the
  host side.

## Related

- `pools-across-hosts.md`: "What a host adds", the index-driven row.
- `page-contributions.md`: `page:<base>`, the same index-driven shape for a
  page's edits.
- `community-translations.md`: the same offer shape for words in the interface.
