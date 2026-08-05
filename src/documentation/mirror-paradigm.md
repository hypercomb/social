# The Mirror Paradigm

**Permanent requirement for all forward development.** Building a behaviour is
half the work; the other half is building its mirror in the hive, in the same
pass. We are constantly building a prototype out of hexagons, notes, and
pheromones — the hive is the living specification of the code.

## The four parts of a mirror

| Part | What it is | Why |
|---|---|---|
| **Tiles** | One tile per meaningful part of the creation | The feature's structure becomes structure in the tree |
| **Collection** | A tile that gathers the parts | The creation navigates, shares, and adopts as a unit |
| **Pheromones** | `tag` decorations marking what each piece *is* | Render and behaviour resolve from the mark, never from per-feature code |
| **Notes** | Free-text explanation on the tile | The "what's going on" lives with the thing, not only in markdown |

## Rules

1. **Same pass as the code.** The mirror is not documentation-after-the-fact.
   A behaviour whose parts exist only in TypeScript is unfinished.
2. **Data-driven from pools of meaning + pheromones.** If changing how
   something is classified, grouped, or rendered would require editing code,
   that classification belongs on a tile as a pheromone instead.
3. **Declared vocabulary.** Pheromone keywords are chosen deliberately —
   never minted on the fly. Keyword the collection first; painting the same
   keyword on any tile is what makes it a member (the pheromones ARE the
   parameters of the collection).
4. **Multi-purpose collections.** A keyword like `game` classifies any tile —
   behaviours, content, references. Collections grow wherever the keyword is
   painted, at any grain.
5. **Revisioned content.** Every mirror write goes through the committer —
   layers + history markers — so the mirror carries the same undo/share/adopt
   guarantees as everything else. Nothing about a mirror is special-cased.
6. **One resource, one tile (1:1).** A creation whose implementation spans
   several source files must spread those parts across child cells — one cell
   per file — instead of hiding internal dependencies behind a single tile.
   The behaviour tile stays 1:1 with its queen file; every other
   implementation file becomes a child cell marked with the declared `part`
   keyword, noted with its role and source path. Exclusions: `index.ts`
   barrels (packaging, not parts) and files owned by a *shared subsystem*
   rather than the behaviour (e.g. `history/` serves snapshot, restore,
   revise, and others — a subsystem earns its own mirror, it is not any one
   behaviour's internals).

## The mirror queue

Rule 1 says *same pass as the code*, and that is still the standard. But a
mirror pass needs something a code change does not: a live renderer on the
bridge. When the bridge is down, the dev server is mid-rebuild, or another
session holds the hive, the pass cannot run — and a deferral that lives only
in a chat reply is a deferral that gets lost.

So a deferred mirror is **written down, not remembered**:

```bash
npm run mirror:queue -- list                 # what the hive still owes the code
npm run mirror:queue -- add --id <slug> --title "…" [--run "<command>"] [--note "…"] [--commit <sha>]
npm run mirror:queue:run                     # drain it
npm run mirror:queue -- done <id>            # settled by hand
```

7. **A mirror is either run or queued — never neither.** If the pass cannot
   run in the same change, the same change adds a queue entry naming what is
   owed and how to run it. Shipping code with no mirror and no entry is the
   only way the hive falls behind, and it is now the one thing that must not
   happen. Say so in the commit.

The queue is a **file in the repo** (`scripts/mirror-queue.json`) precisely
because the blocked case is "no bridge": it must be writable with no
renderer, no hive, and no network. The queue is the record; **the hive is
still the truth.** An entry is a promise to run a pass, never a substitute
for having run one — nothing reads the queue to decide how anything renders.

`run` is idle-safe on purpose. It probes for a renderer first, and with none
it reports what is still owed and exits 0 — a scheduled drain that fires
while the hive is closed is a quiet no-op, not a failure. Entries run in
order and a failure stops the drain, leaving that entry pending: later passes
routinely need a collection an earlier one creates, and a half-applied mirror
is worse than a queued one. An entry may carry `"run": null` when no script
exists yet — it still counts as owed, it simply cannot drain unattended.

After a drain, mint the cards: `node scripts/behaviors-theme/sweep.cjs`.

## The behaviors mirror (first instance)

`behaviors` at the hive root holds one collection per category — `games`,
`views`, `assistant`, `swarm`, `appearance`, `structure`, `input`,
`guidance` — with one tile per shipped behaviour. Every behaviour tile
carries the `behavior` keyword plus its category keyword; each collection
tile carries its own keyword. Notes hold the `/command` description and the
source file pointer.

Built by `scripts/mirror-behaviors.ts` (bridge build, merge-mode, re-run
sentinel); the 1:1 part spread is built by `scripts/mirror-behavior-parts.ts`
(idempotent — note presence gates note/mark writes, so it can resume after an
interruption). When a new behaviour ships, extend the mirror in the same
change: add its tile under the right collection, paint `behavior` + the
category keyword, note what it does and where it lives, and give every
implementation file beyond the queen a `part` child cell.
