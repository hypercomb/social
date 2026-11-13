# Pools of meaning across hosts — one word, one address, every host

**Status: DIRECTION — stated by Jaime 2026-09-02, from this sketch:**

```
server 1    /menu
server 2    /menu
server ...  /menu:artsy
server 500  /menu:christmas

pool /menu
menu:styles → artsy, christmas
```

Then the correction that fixes the whole design: *the keyword is not the
artifact (`menu`); it is the thing that gets CONSUMED — `style`, `theme`,
`ui`, `visuals`, anything a behaviour can take in.* This chip states the
standard for discovering, authoring, sharing and filtering such things, and
it invents nothing. Every part already exists; the standard is the seam
between them.

Companions: `known-location-pools.md` (the root vocabulary),
`pheromones.md` (anchor-first, receptor-relative),
`website-artifact-paradigm.md` + `pheromones/enrollment.ts` (relations as
marks), `host-packages-pool.md` (a host's packages as a pool).

## One string, two derivations

A meaning is `family:name` — `style:christmas`, `site:pitch`,
`gallery:holiday`. That one string already yields two addresses, and the
two are complementary, not redundant:

| Derivation | What it is | Where it lives | Travels? |
|---|---|---|---|
| `sign('group:' + meaning)` | the MARK a member wears | in the member's merkle closure | **yes** — the only thing that crosses machines |
| `sign(meaning)` | the POOL — a directory of members | at the root of every host that carries it | no — but it is at the SAME address on every one |

So the same word means the same thing on every machine and every host
without any registry: `sign('style:christmas')` is a universal address
because `sign` is. That is the entire discovery mechanism. Nothing is
looked up, nothing is named; everything is derived from a word the
consumer already holds.

## The standard is the FAMILY word

- **The family is the closed, developer-defined root vocabulary**
  (known-location rule). It names a CONSUMABLE: `style`, `theme`, `ui`,
  `visual`, `packages`, `site`, `gallery`. This is the one list a community
  agrees on, the way it agrees on MIME types — by convention, never by a
  server.
- **The name is user vocabulary, one level down.** `christmas`, `artsy`,
  `pitch`. Unbounded, safe, because position answers membership.
- **What it applies to is a MARK, never a second address.** A style for
  menus and headers is ONE artifact wearing `applies:menu` and
  `applies:header` (`appliesTo: []` keeps a mark shareable — N uses = N
  refs, never N copies). Putting `menu` in the address would mint one
  pool per pairing, which is the pairing table the artifact paradigm
  forbids.
- **The family IS the receptor.** A consumer declares the families it
  consumes (a menu behaviour consumes `style`). Meaning is
  receptor-relative: a nose reads only kinds it holds, so an unknown
  family is not a signal for you, and inventing a family surfaces nothing.

The sketch, mapped:

```
family     style                            ← the keyword (receptor, standard)
names      sign('style:names')/             ← the family pool: one record per relation
relations  style:artsy   style:christmas    ← names, one level down
members    sign('style:christmas')/         ← the relation pool: member sigs
mark       group:style:christmas            ← worn by each member (travels)
filter     applies:menu, season:winter      ← marks, through the nose
```

Two pools per family, both spelled by the rule that the second segment
says what the pool holds (`hives:names` precedent): `<family>:names` holds
one canonical record per relation — `{ kind: 'visual:style:artifact',
meaning: 'style:christmas', payload: { sig } }`, named by its own hash, so
adding twice is a no-op and removing needs no index (the `community:hosts`
shape). `sign(meaning)` holds the relation's members.

## Discover = receptors × community, and the pool is the URL

```
for family in families I consume:
  for host in community:hosts:
    GET /<sign(family + ':names')>/     → the relations this host carries
    GET /<sign(meaning)>/               → the members of one relation
    GET /<sig>                          → the bytes, immutable, once per sig
union by member sig
```

- **The pool is served AT ITS ADDRESS.** A host serves its content root;
  the pool is a directory in it; `GET /<poolSig>/` answers with the
  directory's entry names. No file is named, no format is authored, no
  family-to-filename mapping exists. The listing is `readdir`, encoded
  however the wire likes — it is not a document.
- **Anchor-first, never enumerated.** The client asks each host for an
  address it derived from a word it already holds. There is no "list your
  pools" endpoint — that is the spam amplifier `pheromones.md` rules out.
- **The horizon is the community.** You ask the hosts you carry, not 500
  strangers. `community:hosts` is deletable and seeded with one; growth is
  a host danced to you, never a crawl.
- **Deduplication is free.** The same bytes carry the same sig on every
  host, so 500 hosts serving one christmas style collapse to one member,
  fetched once and cached forever. The sketch's `pool /menu` IS this union.
- **Filtering costs nothing extra.** The name is in the family-pool record;
  everything else a filter reads is a mark in the member's own closure.
  Nothing has to be copied into a listing to be filterable.

## The one wire rule, refined: a sig-named FILE is immutable

`host-packages-pool.md` ruled out a projection at a 64-hex URL because the
relay pins every sig-shaped path for a year. That is the right rule for
FILES — a signature names one closure forever. A pool is a DIRECTORY, and a
directory is a set, and sets grow. The distinction the OPFS root already
makes is the one the wire needs:

| Path | What it is | Cache |
|---|---|---|
| `/<sig>` | a file — content, a member record | `immutable` |
| `/<sig>/` | a directory — a pool, a lineage bag | `no-store` |

Today `relay.js` has no directory branch: it `readFileSync`s every path and
tags anything containing a 64-hex run as immutable. The change is one
branch — trailing slash on a directory → list entries, `no-store`. That is
the whole host contract for discovery.

**`packages.json` was the workaround for a host that could not list a
pool.** Once a host can, `host:packages` is served at `sign('host:packages')/`
like every other pool and the named file is the drain window — it was
never a second dialect, only a relay that could not `readdir`.

**A static host** (Pages, a bucket) has no `readdir`. Its ship writes the
listing as the directory's own index — the same bytes a live host would
compute, at the same address. Still the pool, still not a named file at
the root. This is the directory-as-set fork already found on
`host:packages`; both host shapes answer the same URL.

## Author · share · filter

- **Author = `/enroll`.** Mint the artifact, enrol it in `style:christmas`,
  mark what it applies to. On a store-backed host the pools are projections
  of marks held; nothing writes them by hand. The artifact naming the
  relation is a peer, never a parent.
- **Share = publish.** Once the member is on a host, it is in that host's
  pool at the derived address. There is no second act, and **no nectar, no
  dance**: a pool lists only members whose bytes the host serves.
- **Filter = the nose.** artsy / christmas / applies-to are marks; a
  filter is a bouquet of them, weighted by author and host trust (sybil
  rule). The reserved negative vocabulary is evaluated regardless.

## What a host adds

**Status: DIRECTION — jwize 2026-11-04** ("only share images with hosts";
"hosts can use meaning pools, so this is an upsell: you don't get this
flexibility"). Protocol hive node: `protocol/collaborative/hosting`.

A participant with no host has the swarm: the hives online at the same time,
joined for as long as both stay. Everything it sees, it sees live, from
whoever is present. A participant who runs a host, or joins one, gets the
thing a swarm cannot give: **pools of meaning answered at a derived
address**. One word, `sign(meaning)`, the same address on every host; ask any
host for `/<sign(meaning)>/` and it lists, as plain entry names, what it holds
there from whoever made it — whether or not the maker is online. That reach
is what hosting adds, and it is the reason to run or join one.

The listing is never an inventory and never a switch, so the trust model is
unchanged: each member is checked by its signature, and where a member is a
person's word, by that person's own signed index.

What a host lists, and why each is safe:

| Listing | Which pools | Who decides |
|---|---|---|
| **the floor** | `host:packages`, `host:offerings`, `community:hosts`, `community:offers` (`hypercomb-relay/host-listing.floor.json`) | the protocol — every host lists them |
| **declared** | any colon meaning an operator names in their signed index (`listed`) | the host's operator |
| **index-driven** | a pool whose members are the keys that named an entry in their own signed index — `attest:<record>`, `pictures:<sign(name)>`, and `list:<sign(name)>` (`need-feeds.md`) | each participant, one key at a time; the host only gathers who said so |
| **never** | a tile's name pool (a molecule) and the host's private ledgers | nobody — a 404 says nothing, so a probe learns nothing |

**Pictures travel only through hosts.** A tile's pictures are never offered
from a name pool (those stay closed, as the last row says). A publisher who
wants a picture found under a name says so in their own signed index, as
`pictures:<sign(name)>` → the signature of a small picture record (the image
pointers of the tile they published: `imageSig`, `small`, `flat.small`,
`point`, or `large` alone). The host lists the keys that did, at
`sign('pictures:<sign(name)>')` — index-driven, exactly as `attest:` is — and
a reader reads each key's index, fetches the record by its signature, and
offers the picture with that publisher named. The entry is made by the
Publish act, never in the background, so a picture is public only because its
publisher published it. Keyed by the name's signature, not the name, so the
index carries no free text and the pool address is the molecule address with
a colon in front. Without a host, the images wall shows only what the live
swarm is showing.

**One picture per name, per publisher, per host — your best (jwize
2026-11-04: "we also don't want multiple images per host. That defeats the
point of only sharing your best").** The entry is one key naming one layer,
and a publisher's devices share one index under their anchor key, so a
publish replaces the picture that host offered for the name; it never adds a
second. Never turn the entry into a list. A publisher who wants a different
picture seen elsewhere publishes it to a different host.

**Built 2026-11-04:** the record is the tile's own published
layer (already in the closure on the host), so no new format exists. Publish
adds one entry per pictured tile of the branch in its one signed index write,
nearest the branch root first, at most 64 (`sharing/picture-pools.ts`,
`publish-branch.ts`); withdrawing the branch takes its entries out in the
same write. The worker lists the keys at `sign('pictures:<sign(name)>')` from
each index write, as it does `attest:` (`notePicturePublishers`); the relay
derives the same listing from the indexes it holds (`picturePublishers`). The
reader (`peer-images.ts` `meaningPoolImageCandidates`) asks
`/<that address>/`, then each listed key's own index, and never the name pool.
Not yet: a picture is withdrawn with its branch even when another published
branch still carries the same layer.

The same door carries what is derived from a picture (`derivations.md`): a
thumbnail or hex sheet pair is a derivation record under `derived:<picture>`,
found through a host the same way, so a hive that joins late is handed shots
someone already cut instead of cutting them again.

## A model asks a pool

**Built 2026-11-13 (jwize: "if we use the pools it should be easy to do. We
just have to query the root pool").** Every read the hive's AI had walked the
hive's own tiles (`tree`, `read`, `list`, `find`, `code`). What the community
publishes was never there, so on a page whose own hive is empty (a card's site
door) every read answered `not-found` and the model reported that nothing
exists. The read it lacked is the pool rule itself:

```
pool <meaning>          sign(meaning), asked of each host in community:hosts
pool host:publications  the creations those hosts have published
pool <meaning> <from>   the next page of a long one-file index
```

- **The model names a meaning, never a host.** The hosts asked are every host
  the hive can ask (2026-11-13, `sharing/network-hosts.ts`: the ones the
  participant carries and the ones its content broker fetches from); with
  none, the public content host is read, as `discover` does. A bare word is
  refused: a tile's name pool is never listed.
- **A name is asked with `explore`, not `pool`.** The pools behind a tile name
  (`list:`, `pictures:`) list publisher keys, which `read` cannot open;
  `explore <name>` walks them (`need-feeds.md`, "A model explores a name").
- **Both shapes at the one address.** `/<address>/` (asked with `?held`) is a
  set, whose members come back as signatures that `read <signature>` opens;
  `/<address>` is a one-file index, returned as the host sent it, a page at a
  time. The answer says what each host said: listed, document, absent, silent.
- **Read only.** Nothing is written, nothing is kept, and the meaning is not
  registered as a pool of this hive.
- **Someone else's words.** A change that follows a pool read is held for the
  participant's hand, as after any read of a peer's content.

Code: `assistant/hive-pool-read.ts` (the read), `hypercomb-observation.ts`
(the `pool` verb and its receipt), core `work-instruction.ts` (what the model
is taught).

## The apex answers a pool at its address

**Found and fixed in the worker 2026-11-13; live once the worker is deployed.**

`hypercomb.com` is the only public content host a fresh hive knows
(`PUBLIC_CONTENT_HOSTS`, and the fallback of `sharing/network-hosts.ts`).
Asked for any pool, `GET https://hypercomb.com/<sign(meaning)>/` answered
`200 text/html`: the site's own page. A reader takes a page for "no answer"
(`sharing/pool-listing.ts`), so `pool`, `explore`, the explore view, the
picture chooser and the calendar all heard nothing from the apex. A relay
answers the same request properly (`jwize.com`: a listing, or 204 asked with
`?held`).

**Why.** The apex is an *origin host* (`ORIGIN_HOSTS`,
`hypercomb-relay/blossom-worker/worker.js` `servesOrigin`). Its site stays on
its own origin and the worker is the zone root's write face: it answers the
writes, the heap (`/<sig>`), the signed index and the machine JSON, and hands
every other read to the origin. `/<pool>/` was one of those other reads, on
purpose, for one pool: the package pool `sign('host:packages')` lives on the
origin under `/content/`, and an empty listing from the worker at the root
would stop an install's walk before it reached it. The rule was written for
every pool, so the keys an index write leaves in the worker's heap
(`pictures:<sign(name)>`, `list:<sign(name)>`, `page:<base>`, `attest:`,
an event's list, an operator's declared pools) could be written at the apex
and never read back there.

**The fix** (`originPoolListing`): on an origin host the worker answers a pool
at its address as it does on every other door. Two things stay as they were:

- the package pool is the origin's, untouched, so the install's walk is the
  same request for request;
- a pool the worker does not list is still the origin's to answer when it has
  a listing of its own. Its page is not a listing: that is the site answering
  a path it does not hold, and the reader hears "no pool at this address"
  (204 asked with `?held`, 404 without) instead of silence.

| `GET https://hypercomb.com/...` | Before | After |
|---|---|---|
| `/<sign('host:packages')>/` | the origin | the origin (unchanged) |
| `/<pool the worker lists>/` | the site's page | the listing, `text/plain`, `no-store` |
| `/<any other 64-hex>/` | the site's page | 204 with `?held`, else 404 |
| `/content/...`, `/<sig>`, `/hive/<key>` | as today | as today |

Covered by `worker.spec.js` ("an origin host answers a pool at its address
from the heap..."); the suite's older test that the package pool and every
page still reach the origin unchanged passes as it was.

**To go live** the main worker is deployed by its operator, from
`hypercomb-relay/blossom-worker`: `npm run deploy:pluginthematrix`. Then
`curl -i "https://hypercomb.com/<64 hex>/?held"` answers 204 with
`X-Reason: no pool at this address`, not a page. Nothing in a hive changes.

## Not this

- No named file at the root as the discovery surface — no `<family>.json`,
  no index document. The pool is the address; a named file is a location.
- No pool index on a host, no global family registry — enumeration.
- No sub-pool per pairing (`menu:christmas` as an address) — meaning back in
  addressing, the collision class the colon retired.
- No inventory in a listing — a listing is entry names, nothing that
  decides what installs.

## Open

- Two hosts naming different bytes `style:christmas` share one group sig
  and one pool address. Membership merges; the artifacts stay distinct.
  The nose ranks by host — the same answer already pinned for hive names.
- The family list itself: seed with the families a shipped behaviour
  already consumes; add one only when a consumer exists for it.
- ~~The relay's directory branch, and the static ship's index — neither is
  built.~~ **BOTH BUILT 2026-09-03**, on `host:packages` as the first pool to
  use them. The relay answers `/<sig>/` with its entry names as
  `text/plain`, `no-store`, filtering `index.html` and dotfiles; the ship
  writes that same listing as `<pool>/index.html` so a bucket answers the
  same URL. Client side: `parsePoolListing` / `markerIndices` in
  `hypercomb-runtime/src/host-pool.ts`, with the index probe kept behind them
  as the drain window for a relay that has not restarted. Verified against
  the real content directory: 180 entries in one request; head in 4 requests,
  a five-row browse page in 8. See `host-packages-pool.md`.
  Still owed: the family pools (`sign(family + ':names')`) — this built the
  member half only, for one meaning.
