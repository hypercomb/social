# The servers feeding a need

**Status: built 2026-11-12 (uncommitted at time of writing).** The view, both
sources, the offer word and the host side of `list:` (worker and relay).

jwize, 2026-11-12:

- "it is to show you the servers feeding a need"
- "a row of tiles horizontal feeding the list below"
- "This is more like a diagnostic view but don't complicate"

The tile you stand on is the **need**. Every host you can ask is a **feeder**.
The view asks each one what it holds for the need's name and shows, in one
place, which host brought which value and how fast. It is a diagnostic first:
it tells you who is feeding what, and who is not. It is also where you pick a
value and keep it.

## What you see

**A row of hexagons across the top.** One per host this hive can ask (the
broker's known content hosts), in a fixed order, each with its own hue. Under
the host's name, its state: `asking…`, `N · ms`, `holds nothing`, or
`no answer`.

**Lines running down into one list.** From the foot of each hexagon a curve
runs to the head of the list. A thin flow moves along it while the host is
being asked, and keeps moving, slower, once the host has brought something. A
host that holds nothing or never answered is a still, dim, dashed line.

**The list.** Every value any host brought, folded by case and spacing (first
spelling kept), most-fed first, then A to Z. Each row carries one dot per host
that fed it and a count of the publishers who said it.

**Hover lights the path.** Hover a value and the lines and hexagons that fed it
light while the rest dim. Hover a hexagon and its values light.

**`+` promotes.** A value's `+` makes it a child tile of the tile you stand on,
through the same create commit `create <name>` runs. Nothing is written until
you promote. Escape, the close button, or a right-click leaves, and so does
walking to another tile: a promote lands where the view was opened, never
somewhere you walked to since.

**The hive underneath is asleep.** While the view is up the keymap is held, so
no hive shortcut acts on tiles you cannot see. A value that cannot be a tile
name (it holds a `/`, or is a reserved or saved word) is refused at the `+`.

## The word

| Say | What happens |
|---|---|
| `need` | the view, for the tile you stand on |
| `need <name>` | the view, asked for another name; a promoted value still lands where you stand |
| `need offer` | offer the child names of the tile you stand on, under its name, to a host |
| `need offer v1, v2, ...` | offer those values instead |
| `need offer ... @host` | offer to that host |

The view also carries an **offer mine** button, which runs the same act as
`need offer` with no values, then asks the hosts again. It is shown only when
the view's name is the tile you stand on — `need <other name>` has no offer
button, since an offer is always for where you stand.

**The words after `need` are its own** (`rawArgs`): values and an
`@host:port` are never read as tags or as further behaviour words.

**The offer is your own act.** Only the typed word or a button you click
publishes. Nothing offers in the background.

**The name is where you stand.** It is the last segment of the tile you stand
on. At the hive root there is no name, and the word refuses with a toast.

**The values.** The comma-separated values when you give them, otherwise the
names of the children of the tile you stand on.

**The host.** `@host` when you say one (folded the way the zone door folds a
host). Otherwise the first host of the branch you stand on. With neither, the
word refuses and tells you to say `need offer @<host>`.

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
children feed the list once somebody offers them (`need offer`).

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
- `hypercomb-essentials/src/sharing/need-feeds.queen.ts`: the `need` word, the
  view (row, lines, list, hover, promote) and `need offer`.
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
