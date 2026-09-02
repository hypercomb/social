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
- The relay's directory branch, and the static ship's index — neither is
  built.
