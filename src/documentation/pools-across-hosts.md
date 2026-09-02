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
marks), `host-packages-pool.md` (a host publishes a projection).

## One string, two derivations

A meaning is `family:name` — `style:christmas`, `site:pitch`,
`gallery:holiday`. That one string already yields two addresses, and the
two are complementary, not redundant:

| Derivation | What it is | Where it lives | Travels? |
|---|---|---|---|
| `sign('group:' + meaning)` | the MARK a member wears | in the member's merkle closure | **yes** — the only thing that crosses machines |
| `sign(meaning)` | the POOL — a directory of members | one participant's / one host's root | no — local scaffolding |

So the same word means the same thing on every machine and every host
without any registry: `sign('style:…')` is a universal address because
`sign` is. That is the entire discovery mechanism. Nothing has to be
looked up; everything is derived from a word the consumer already holds.

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
family     style                          ← the keyword (receptor, standard)
relations  style:artsy   style:christmas  ← names, one level down
members    wear group:style:christmas     ← the mark (travels)
filter     applies:menu, season:winter    ← marks, through the nose
pool       sign('style:christmas')        ← local directory, derived
```

## Discover = receptors × community

```
for family in families I consume:
  for host in community:hosts:
    GET https://<host>/<family>.json   (cache: no-store)
union by member sig
```

- **Anchor-first, never enumerated.** The client asks each host for a word
  it already holds. There is no "list your pools" endpoint — that is the
  spam amplifier `pheromones.md` rules out (invent a kind, get surfaced).
- **The horizon is the community.** You ask the hosts you carry, not 500
  strangers. `community:hosts` is deletable and seeded with one; growth is
  a host danced to you, never a crawl.
- **Deduplication is free.** The same bytes carry the same sig on every
  host, so 500 hosts serving one christmas style collapse to one member
  with 500 sources. The sketch's `pool /menu` IS this union.
- **`packages.json` is already instance one.** Family `packages`, projection
  `packages.json`, read by `listHostPackages`. The rule generalises it; it
  does not replace it.

## What a host serves: a projection, never an inventory

`GET /<family>.json`, `no-store`, at a NAMED path — never at a 64-hex URL,
because sig-shaped means immutable and nothing else (`host-packages-pool.md`).
It is rendered from what the host HOLDS wearing `group:<family>:*`:

```json
{ "family": "style",
  "relations": [
    { "meaning": "style:christmas", "artifact": "<sig>",
      "members": [ { "sig": "<sig>", "order": 0, "marks": { "applies": ["menu"] } } ] }
  ] }
```

Every field must be **display-only** (a label, a count, a mark to filter
on — nothing that decides what installs) or **underivable** before the
fetch. Bytes are fetched as `/<sig>` and hash to their own names; the
closure is the ordinary replication walk. **No nectar, no dance:** a host
lists only members whose bytes it serves.

Two host shapes, one projection (the fork already found on
`host:packages`): a store-backed host enumerates enrollments; a static
host mints the projection at ship from the directory-as-set. Neither
grows a second dialect.

## Author · share · filter

- **Author = `/enroll`.** Mint the artifact, enrol it in `style:christmas`,
  mark what it applies to. No pool write — the pool is a projection of
  marks held. The artifact naming the relation is a peer, never a parent.
- **Share = publish.** Once the member is on a host, it is in that host's
  `style.json`. There is no second act.
- **Filter = the nose.** artsy / christmas / applies-to are marks; a
  filter is a bouquet of them, weighted by author and host trust (sybil
  rule). The reserved negative vocabulary is evaluated regardless.

## Not this

- No pool index on a host, no global family registry — enumeration.
- No sub-pool per style (`menu:christmas` as an address) — meaning back in
  addressing, the collision class the colon retired.
- No pairing table, no `appliesTo` in the address.
- No projection at a sig URL; no inventory field that widens an install.

## Open

- Two hosts naming different bytes `style:christmas` share one group sig.
  Membership merges; the artifacts stay distinct. The nose ranks by host —
  the same answer already pinned for hive names.
- The family list itself: seed with the families a shipped behaviour
  already consumes; add one only when a consumer exists for it.
