# The pools are a relational database everyone writes

**Status, 2026-11-24.** The model is doctrine (codex `T9`). The first feature built
directly on it is recipe templates (`recipe-templates.md`); mail templates
(`mail-templates.md`) and card templates (`sharing/card-templates.ts`) already work
this way and are named here as the earlier instances.

jwize, 2026-11-24: *"It's us creating a data set conventionally, by the way we name
our data, simplified. This is the relational database where actually everybody takes
part, and then we filter on the data we want."*

Nothing here is new machinery. The name is the only partition (N1), a relation is a
name, a layout, a fill or a projection (N4), the same word is the same address on
every host (P1), a federated pool converges only under union (M3), and whom you take
from is your own choice (T5). This page says what those add up to, so that nobody
builds the missing parts of a SQL database on top of them.

## The mapping

| A relational database | Here | Rule |
|---|---|---|
| a table | a **name**: the pool of one meaning, the same word and so the same address on every host | N1, P1 |
| a table's name | the meaning, `family:name` (`recipe:template`, `mail:template`, `themes:card`) | P4 |
| a row | a **member**: one atom, named by its own signature | I1, A1 |
| the primary key | the member's signature. The same bytes are the same row everywhere | I1, A6 |
| columns, the schema | a **layout**: the holes a template declares, each with a type | N4 |
| a value | a **fill**: what one member puts in a hole | N4 |
| a foreign key | a **signature** held in a slot: a picture, another member | I2 |
| a join | a **name or a mark two members share**. Never a pairing table | A3, N5 |
| `INSERT` | **leaving a member** in the pool on your host: lit, then published | T1 |
| `UPDATE` | none. A changed member is a new signature and a new row | I1, H2 |
| `DELETE` | none. You withdraw your own member; the bytes stay valid elsewhere | H4, M3 |
| `FROM` | **selection**: the hosts you follow, narrowed on the domain shelf | T5 |
| `WHERE` | **marks** the member wears, and search over what it says | N5 |
| a view | a **projection**: the renderer that reads the family it owns | N4, A5 |
| the database server | none. Every host answers for the same word; the union is the table | P1, M3 |

## How it works, in the order it happens

1. **Naming is the convention.** A community that calls its recipe templates
   `recipe:template` has agreed on a table by spelling one word the same way. No
   registry, no server, no migration. A word spelled differently is a different
   table, which is why a meaning is seeded before it is used (`pool-registry.ts`).
2. **Everybody writes.** A participant makes a member, turns it on, and publishes.
   From then on their own signed index on their host names the pool, under the key
   `pool:<meaning>`: a list of member signatures (`recipe-templates.md`, "Leaving a
   pool at your root domain"). That is the whole insert, and it is theirs alone:
   nobody writes into anyone else's host.
3. **The table is the union.** A reader learns each followed host's publisher keys
   from its publication ledger, reads each key's signed index, takes the list under
   the same key, and merges by signature (M2: a signed enumeration). At most sixteen
   hosts are asked in one read. The same member offered by many hosts is one row.
4. **A reader filters.** First by source (which nodes, on the shelf), then by words.
   A source switched off is not asked; a search shows only the rows that match. What
   is left is what the view offers.
5. **Nothing arrives uninvited.** A listed member is an offer. It is verified by its
   signature and kept only by a press (T4, T5).

## What is deliberately absent

- **No update and no delete.** Convergence is by union only (M3). A "current
  version" of a member is its maker's newer signature, offered beside the old one.
- **No uniqueness across hosts.** Two hosts may fill the same word with different
  members. Both are rows. The reader ranks by host, the answer already pinned for
  hive names.
- **No pairing table.** A relation between members is a mark each wears or a name
  both carry (A3). A table of pairs is the container the artifact paradigm forbids.
- **No listing as proof.** A host's listing is that replica's memory of the set. A
  member is trusted by its own bytes, never because a directory named it (M1, M2).
- **No query a host runs for you.** A host lists; the reader fetches, verifies and
  filters. There is no endpoint that answers a predicate, and none that lists a
  host's pools (`pools-across-hosts.md`, "Not this").
- **No truth in a pool.** A pool holds membership (P6). What a member is lives in
  its own bytes; what a tile is lives in its layer.

## Where the write happens: pools mode

Turning a tile on for a pool and publishing it is one experience, the stage that
used to sit between private and the swarm (`recipe-templates.md`, "Pools mode"). A
lit tile is a row you are offering. Publishing there does not stage a site on a
subdomain: it leaves the lit members in your pools at your root domain, where anyone
who follows you finds them through your signed index.

## How a pool is reached today, and what is not built

The model says one word is one address on every host (P1). Two things reach that
today, and they are not the same thing:

- **These pools** (`recipe:template`, `recipe:entry`) are reached as the key
  `pool:<meaning>` in each publisher's signed index. It needs no change to a host,
  and the list is a signed enumeration (M2). No host lists them at `sign(meaning)`.
- **The one-file index at `sign(meaning)`** (`sharing/published-pools.ts`,
  `pools-across-hosts.md`) is what a static host ships. Nothing publishes these
  pools there yet: a host would have to project the signed key to that address, as
  it does for a language's catalogue. That is a host change.

In a room, where one host serves participants who have none of their own, the rows
are small signed members at an address derived from the meaning and the room
(`recipe-templates.md`, "One host, many participants").
