# Alias properties — one repo per name, overrides per place

**Status: DESIGN (2026-10-01, jwize).** Nothing here is built beyond what
*What exists* says. Read with `hypergraph-molecule-lineage.md` (the name is
the identity), `reference-designer.md` (references and gathering) and
`visuals-across-lineages.md` (pictures across lineages).

## The rule

A tile's properties — its picture, border, background, and every other key
in the `properties` record — live in ONE place: the **repo** for its name.
Every place the tile appears is an **alias**: a pointer plus a filter, which
holds only the keys it **overrides**.

- **Read** = the repo's properties, with the alias's overrides on top.
- **Write** = a key the alias does not override **sinks to the repo**, so
  every alias sees it. A key the alias already overrides stays at the alias.
  Making a key an override is deliberate: an explicit **only here**.
- **History** = the repo's revisions and each alias's revisions, ordered by
  file time. Every picture a name has worn is in them.

That is the whole design. It is about data, not about any one surface:
anything that creates or edits a tile follows it.

## What exists

The read and the sparse write are already built, for the properties record:

| Piece | Where | What it does |
|---|---|---|
| Repo | the root tile `/<name>` — its bag is `sign(name)`, the name's molecule | Holds the defaults. It is a store, never listed in the root hive (`reference-designer.md`). |
| Read cascade | `readTilePropertiesAt` (`editor/tile-properties.ts`) | Repo first, alias second, shallow per key (`inheritTileProperties`). |
| Sparse alias | `writeTilePropertiesAt` + `sparseTileOverrides` | An alias stores only keys that differ from the repo. |
| Clearing | `propertyPins` | Clearing an inherited key leaves a pin, so the alias shows the key as absent without a null dialect. |
| Variants | `canonical:variants` pool, filed under `sign(name)` | Every time a reference is placed, the target's layer is kept. Nothing reads it yet. |

## What changes

1. **Writes sink.** `writeTilePropertiesAt` at an alias today keeps every new
   key at the alias. Under the rule, a key the alias does not override is
   written to the repo; only keys it already overrides (or that the caller
   marks *only here*) stay. The repo write and the alias write are one commit
   each, under the same tile write lock.

2. **References become aliases.** `place()` today copies a full snapshot of the
   target's details into the reference. Under the rule a reference carries its
   reference mark and nothing else; its properties come from the repo through
   the read cascade. "One person, one face" stops depending on when the
   reference was made.

3. **Gathering merges into the repo.** When two copies of a name meet (a page's
   own tile and the group's), compare key by key:
   - the value from the copy whose properties changed **most recently** (file
     time of its latest revision) goes to the repo;
   - where the other copy differed, its value becomes **that alias's
     override** — so both places look exactly as they did;
   - the losing value is never lost: it stays the other alias's override, and
     the replaced copy stays one step back in that place's history.

   Built (`gatheredRepo` + `mergeCopies` in `gather-link.service.ts`): keys only
   the older copy has also fill the repo, and the page's copy, once replaced by
   a reference, gets exactly its overrides (the writer's `replace` option).

4. **The history reader.** A read over `canonical:variants/<sign(name)>` plus
   the repo's and aliases' revisions lists every picture and properties set
   the name has had, newest first. Choosing one writes it to the repo, or —
   with *only here* — as an override.

## Turning things off — three gestures, none of them a wipe

An alias never changes the repo by turning something off. There are three
distinct gestures, and the editor offers each one by name:

| Gesture at an alias | Stored | Everyone else |
|---|---|---|
| **Override** (*only here*) a key the repo has | the alias's own value for the key | still inherits the repo's value |
| **Inherit again** (drop the override) | the key leaves the alias | unaffected; this alias follows the repo again |
| **Hide here** | a pin at the alias: absent here (`propertyPins`) | unaffected; only this alias shows it absent |

Changing the **repo** is the only act that reaches other aliases, and it reaches
only the ones that inherit that key — an alias that overrides or hides it keeps
what it has. A repo change is a new revision, never a wipe: the previous value
stays in history and can be chosen again.

A pin **on the repo** keeps its existing meaning: the key is **locked**, and no
alias may override it. A pin on an alias hides; a pin on the repo locks.

### Seeing the layers

**Built (step 4):** `propertyLayers` / `editorWrites` / `ownAfterInherit` in
`editor/tile-properties.ts`; the session holds `layers` and pending `choices`
(`tile-editor.service.ts`); the drone reads the layers on open (never from a
cold read; none on a top-level tile, which IS its repo) and saves the choices
— *only here* through `{ onlyHere }`, which keeps a value even when it equals
the repo's; *inherit again* by replacing the alias's own record without those
keys and pins; *hide here* as a cleared key. Fields: picture, border, name
(hideText), fill, link. Strings `editor.layer.*` in all fourteen catalogs.

The editor shows, per property, where its value comes from — **inherited**
(from the repo), **overridden here**, **hidden here**, or **locked** by the repo
— each in its own colour role (tool windows name roles, never colours), with
one control per row to move between override, inherit
again and hide. The layers are then visible, and hiding or inheriting is one
click at any time.

## Migration — forward only, nothing rewritten

Existing aliases carry full copies. Read through the cascade, every key they
carry is an override, so nothing looks different on day one. They thin out by
themselves: the next write at an alias runs `sparseTileOverrides`, which drops
every value equal to the repo's. Where no repo record exists yet for a name,
the first gather or the first sinking write creates it from the copy with the
latest properties. No pass rewrites old layers; older builds keep reading what
they always read.

## Decisions to make while building

- **File time — DECIDED (step 3).** A copy's time is when its CURRENT head was
  written (the leaf — earlier positions belong to history mode), read from
  history's marker list, which reports the marker file's modified time. Where
  the store keeps no time (`0`, as a packed store can), or the two are equal,
  the **group's copy wins** the repo. Marker bytes are not changed to carry
  `at`: their shape is read in several places, and the gather does not need it.
- **Granularity.** Per key inside the properties record (picture separately
  from border) — this matches the existing cascade. Slots outside
  `properties` (notes, contacts, decorations) stay per place for now.
- **One name, two people.** A shared repo per name means two unrelated
  `mike`s share a face unless one overrides. That is the doctrine — the name
  is the partition — so the answer is a different name, not a second repo.
- **Where *only here* lives.** A modifier on the editor's save, and a word for
  the command line (every act has a word).

## Order of work

1. Writes sink (with *only here*), tested against the existing cascade.
2. `place()` stops snapshotting; references read through the cascade.
3. Gather merges by file time and keeps both variants.
4. The editor shows each property's layer (inherited / overridden / hidden /
   locked) with override, inherit again and hide per row.
5. The history reader and picker.

Each step is tested on a scratch hive (a separate dev port) before a
participant's hive sees it.
