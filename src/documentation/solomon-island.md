# Solomon's Key: the island

The adventure above the rooms is an island you walk across without the screen ever changing. It grows outward from one busy centre, and it is meant to hold shrines that other people build.

## One primitive: the place — BUILT

Everything in the adventure is the same thing: a **place**. This is the hypergraph, the same pattern Hypercomb uses for tiles and layers. This section described a plan; it is now the shipped shape of the game, verified by `place.spec.ts`, `story.spec.ts`, and every playthrough spec listed under Verification below.

- **A place** has a view and a map. The view is one of three, today: top-down island, a rectangular chamber (torchlit cavern, lit interior, or daylit grove), or a side-on labyrinth room. A fourth, the side-on scroller, is still owed (see Next).
- **A place holds entrances.** An entrance is a placeholder in the map: a cave mouth, a door, a shrine plot, a town gate. It names no place. Any place can seat into it, through a mark the place itself wears.
- **Walking into an entrance goes down** into the place seated there, a world of its own at its own scale. **Leaving goes back up** to exactly where you came in.
- **There is no special top or bottom.** The island is itself a place and can sit in an entrance of something larger, and any node can become another tree. The world is infinite by composition, not by size.
- **Every place is atomic.** It stands alone, carries its own look, and depends on no parent. That is why a community shrine is simply a place someone made, seated into a plot (still design-only — see Next).

What this built, concretely:

- **Shell.** `labyrinth-overlay.ts` keeps one **path of places** (`PlacePath`, `place.ts`), like the hive's lineage, instead of fixed world/room/dungeon modes. One dispatcher (`#request(intent)`) handles every `enter`/`leave`/`home`/`crumb`/`surface`/`design` navigation; one key-handling model routes every key, in every place, with no switch on place kind.
- **Views.** `PlaceRuntime`/`RuntimeShell` (`place-runtimes.ts`) is the one contract every place's runtime implements — `IslandRuntime`, `LabyrinthRuntime`, `ChamberRuntime`. Push-to-enter (walk into a portal and hold the direction for `PUSH_DELAY`), beside-prompt bubbles, and the zoom-and-veil transition are all one mechanism, cross-substrate (see "Push, prompts and the zoom" below).
- **Saves.** A save (`adventure-save.ts`, version 3) holds the path and each visited place's own facts, keyed by place, plus the labyrinth's own opaque journey blob, carried knowledge, and two small reveal ledgers (see Saves below).
- **Hypercomb.** Places are still plain data, not yet Hypercomb layers — signing, sharing, and seating places as pheromones/decorations remains future work (see Next). Definitions stay plain data specifically so that step stays possible without a rewrite.

## Kinds of place

| Place | View | What you do there | State |
|---|---|---|---|
| **The island** | Top-down, three-quarter | Walk anywhere without a screen change; talk, read signs, open caches, use the wand on brickwork, assemble shrines | Built |
| **Chambers** | Top-down, rectangular | Two three-floor caverns (Wayfarer, Highland), one interior chain (Wenna's house → cellar), and one area place (the Hollow Grove) — inscriptions, rune gates, blocks and plates, hidden alcoves, walked by torchlight or, in the house and the grove, daylight. Zero enemies, zero combat, ever. | Built, on one shared `ChamberModel` |
| **Labyrinths** | Side-on, one screen per room | The original Solomon's Key rooms, joined across depths; every square is a native tile layer. Now also carries a learnable stance, two weapons, three spells, and sealed-stone barriers — the Hush (see below). | Built; combat layer newly built |
| **Scrollers** | Side-on, long | Longer platforming expeditions on the rooms' jump and wand physics, with a scrolling camera | Owed |

**Three-quarter view.** The ground is seen from above. People, trees, houses, brick walls and cliffs are seen from the front, so a person shows their face walking toward you, their side walking past and their back walking away. Anything tall rises into the cell behind it: walk north of a tree or a house and you pass behind it; walk south and you are in front.

## Epicentre first

The island is large (256 × 192 cells, about the size of the first Zelda overworld), but play is dense rather than spread out. Everything in the first hour sits within a short walk of the start:

- **The Sevenfold Valley** — the original valley, tile for tile: Mira, Oren and Sela, the three shrines, the two caverns. Three gaps in its tree ring now open onto island roads.
- **The Brick Garden** — directly east of the valley. It holds the island's wand puzzles, the Brickwarden who explains them, and three caches.
- **Saltmere** — the harbour town, directly south of the valley.

Lanternwick, Cinderreach, the Spine, Mirror Lake and the four shrine plots are further out. New content is added at the edge of what already exists, so the island fills from the centre outward.

## The island is derived, never stored

`ISLAND_DEF` (in `rpg-overworld.ts`) is a small definition: a seed, a size, a mountain spine, forests, lakes, rivers, towns, clearings, hand-made places and the roads between them. `buildIsland` (in `island.ts`) derives everything else from it: height, coast, forest, lakes, rivers and bridges. The grid is never saved. A cold client rebuilds the same island from the same definition, and a road that cannot be built throws an error instead of leaving a place unreachable.

A save holds only what the player did: their position, conversations, knowledge, filled sockets, opened caches, and the cells their wand changed.

- World snapshot **version 2** stores island coordinates.
- A **version 1** save (the old one-screen valley) is translated into the valley. A version 1 position outside the valley's own bounds is refused, never guessed.

## Hand-made places

A **stamp** is a small map set into the island tile for tile, the way the valley is. It lists its **gates**: the border cells where roads meet it. Roads route around a stamp's interior and connect at those gates. The Brick Garden is the first stamp.

## The wand on the island

The wand (Z) acts on the cell in front of the cell you are standing in.

| Built cell | After the wand | Walkable after |
|---|---|---|
| `crack` (cracked brick) | `rubble` | yes |
| `rune` (rune plate) | `laid` brick | no |
| `spring` (rune spring) | `stone` (stepping stone) | yes |

Casting again undoes the change. A `seal` stands until every rune plate in the same place holds a brick; then it becomes rubble, and it closes again if a brick is lifted. `brick` is always solid.

Rules that stop the wand trapping you:

- It will not close a cell you are standing in.
- A seal will not close on you.
- Every change can be undone, so no cast can lock you out of a place.

Changes are saved as `<place>:<col>,<row>` in the place's own coordinates. A save therefore survives the island growing or a stamp moving.

The Brick Garden teaches all of it:

- A cracked door opens the walled court.
- Four rune plates open the seal in front of the Brickwright's Coffer.
- Six rune springs make a stone path to the islet chest.
- A cracked brick in a ruined wall hides a nook.

The specs walk each puzzle with real movement and casts, so the puzzles are proven solvable.

## Reading, talking and treasure

- **Signposts** are read by walking up to them. Their words appear in a bubble above the sign and fade as you walk on. E never goes to a sign.
- **Residents** answer a click or E with their next line, spoken in a bubble over their head. People who ask you something (Mira, Oren, Sela) keep a dialog, because they need an answer.
- **Dialogs** close with E, the key that opened them, as well as Escape or ×. There is no "keep exploring" button.
- **Chests** play a short scene the first time they open: the lid swings back in a burst of light and the items rise out. The items go into the journal. A chest behind a seal or a cracked brick stays hidden until the wand opens a way to it.

## Push, prompts and the zoom

One rule, stated once, holding identically for the island, every chamber,
and the labyrinth — no place kind gets its own version:

- **A portal** (island doors/cave-mouths/open-shrines/area-edges, chamber
  exits/entrances/the Rising Light, a labyrinth door) is entered by walking
  into it and holding the direction for `PUSH_DELAY` (0.3s), or a click on
  its marker. E never enters a portal. Beside one, a tag names it and its
  destination, no key hint: "Stairs down · The Cistern."
- **An E-target** (a chest, a door, a gate, a lever, a lamp, an alcove, a
  resident, a labyrinth stele or chest, an island sign or plot) is acted on
  with E or a click, from within reach. Beside one, a bubble reads
  "`<name>` · E to `<verb>`."
- **A tag-only** feature reports state and is never triggered directly — a
  chamber shutter latches itself once its plates are pressed; a labyrinth
  barrier opens itself the instant its own attainment is learned. Its bubble
  carries no verb: "Sealed stone · it knows the Ward of Solomon."

Crossing between the island and any chamber, area, or labyrinth plays one
zoom-and-veil transition, drawn from a coarse picture (`seed()`) of the
place being left. A labyrinth's own room-to-room passage keeps its earlier,
separately-built door veil; the shell's zoom plays only at the outer
island boundary, and never while a Hush (below) is open — entering or
leaving a room always clears one first.

## The story table

One table, `STORY` (`story.ts`), is the only reshuffle surface in the game:
a list of `{ entrance, place, arrive? }` rows, each saying which place sits
in which entrance, and where inside it a traveller arrives. Nine chambers
seat this way today — the two three-floor caverns, the interior chain, and
the Hollow Grove — plus the three labyrinths seated into the island's dawn/
tide/pyramid shrines. `places.ts` derives everything the shell's chrome
needs from that one table and the place catalog (`PLACES`): breadcrumb
labels, floor labels within a group, a group's entry place, and which
`GROUPS` mark (`wayfarer-cavern`, `highland-cavern`, `chandlery`) a place
wears — the Hollow Grove wears none, since it is a single area, not a floor
in a group. Reshuffling the story table — moving a cavern to a different
shrine, adding a new floor — is a one-line change to `STORY`; nothing else
in the game encodes a place's position.

## Chambers

`chamber.ts`'s `ChamberModel` is the one engine behind every cavern, the
interior chain, and the Hollow Grove — nine `ChamberDefinition`s
(`chamber-places.ts`), each a plain map plus its own exits, entrances,
tablets, gates, chests, doors, shutters, levers, plates, blocks, lamps, lamp
sets, alcoves, and residents. One model, one set of rules, for all nine:
continuous movement on a quarter-tile-radius box; push-to-enter portals that
disarm on arrival and re-arm only once you've stepped well clear; tablets
read by dwelling nearby, never by E; blocks pushed by holding a direction
against them for `PUSH_DELAY`, onto plates that latch a shutter permanently
once every plate in its rule is pressed; doors unlocked by that chamber's
own key chests, never counted across chambers; rune gates read from a
tablet and solved in the order it teaches; lamp sets (ordered or not) that
reveal a hidden chest or the chamber's artifact on completion; a wand
(`wand-rules.ts`) that is always fully reversible and can never trap you;
settling stones that send a room's blocks home; and the Rising Light,
entered by pushing, that closes a chamber's own finale. **Zero enemies, zero
combat, ever** — this is a deliberate, load-bearing boundary, not a gap:
the Hush (below) lives entirely in the labyrinth, on a completely separate
model that shares no runtime code with `ChamberModel`.

The Hollow Grove (`island/valley-grove`) is the one **area** place: no
floor, no group, walked in from any of four edges (its own `WorldArea`
mechanism) and pushed back out the same way. Its content — a cracked
boulder, a rune spring turned to a stepping stone, two chests, a bark-marks
tablet, and Nettle the herb-gatherer — is new, not a re-skin of a cavern.

Every chamber reading, chest, and its artifact/Rising-Light payoff raises
one **gain screen** rather than a view-owned dialog — see "Reading, talking
and treasure" above and the items-table doctrine in
`hypercomb-essentials/src/games/solomon/ADVENTURE.md`.

## The Hush, weapons, spells, and barriers

The labyrinth rooms (Sunseed, Tideglass, the Pyramid of Accord) keep every
pre-existing platforming mechanic untouched — the wand-as-cast/dispel,
fireball, doors gated by a `SigilRequirement`, relic pickups — and now also
carry a proximity duel state, **the Hush**, gated behind one thing: reading
the **Stele of the Stand**, on bare floor at the very start of Sunseed
Porch, before any platforming at all. Until then, nothing can open a Hush.
Once armed, coming within reach of a grounded fighter (goblin, gargoil,
dragon, saramandor) at roughly the same height, or a flying `neul` at any
height, locks time around the exchange: the marked foe and its shots slow
to 0.65×, every other enemy and the sand drain slow to 0.25×, and the
player alone stays at full speed, always. A kill, a parting beyond reach, a
forgiven hit (costs sand and a knockback, not a life), or a stalemate timer
all end it cleanly. **Nothing about a Hush ever moves the camera, changes
the screen, or crosses a door/zoom transition** — those are hard rules, not
defaults to be revisited. Outside a Hush, everything is exactly as before:
instant death on contact, instant kills on a shot. Only
`goblin`/`gargoil`/`dragon`/`saramandor`/`neul` ever trigger one;
`ghost`/`sparkball`/`demonhead`/`panel` stay ordinary hazards.

Steles teach a spell or the stance; chests hand over a weapon — both
E-gated, learned once. One registry (`attainments.ts`) — the same one that
tracks every relic piece, treasure, and conversation — carries all six as
real rows, shown through the same gain screen and items table as everything
else, never a second, parallel system:

| Kind | Id | Use | What it does |
|---|---|---|---|
| Stance | `stand` | permanent | Arms the Hush. |
| Weapon | `sickle` (Sickle of the Sun) | C, cycle N | Melee; a non-killing hit staggers a foe. |
| Weapon | `sling` (Tideglass Sling) | C, cycle N | Thrown, homes back, fetches items it crosses. |
| Spell | `ward` (Ward of Solomon) | V, cycle B | No sand; turns an incoming hit/shot into a stagger on the attacker. |
| Spell | `ember` (Ember Sigil) | V, cycle B | Costs sand; flame two tiles wide. |
| Spell | `hold` (Hourglass Hold) | V, cycle B | Costs sand; freezes the room, and a marked foe longer. |

A **barrier** is a sealed stone wall carrying one requirement (`needs:` a
stance/weapon/spell id) that opens itself the instant that id is learned,
wherever the player stands — no brazier, no second unlock step. It is
tag-only, exactly like a chamber shutter: nothing opens it directly, and E
beside one does nothing.

**Content placements**, entirely inside the labyrinth's own **sunseed**,
**tideglass**, and **starbloom** rooms — a disjoint room set from every
cavern/interior/grove map above, with zero coordinate overlap to resolve:

| Room | Content |
|---|---|
| `sunseed-porch` | Stele of the Stand, at floor level, before any platforming. Sundial Stone (Ward) on the porch's existing shelf. No foe can reach here, ever. |
| `sunseed-steps` | The first Hush, against the room's own goblin. Sickle of the Sun chest on the right shelf. |
| `sunseed-loft` | Hearth Stone (Ember) on the upper shelf. A second Hush against the room's own goblin. |
| `sunseed-heart` | A barrier, `needs: 'ember'`, sealing an existing pickup. |
| `tideglass-steps` | Tideglass Sling chest. |
| `tideglass-loft` | Hourglass Stone (Hold). |
| `tideglass-heart` | No new content — the existing gargoil duel proves Ward's reflect. |
| `starbloom-heart` | One barrier, `needs: 'hold'`, the gauntlet's gated reward. |

Every fight is against a foe the pinned playthrough route already walks
near — no new enemy spawn was added anywhere. Every placement sits on
solid, reachable ground, approachable from a side, and never seals the
only route to its own prerequisite.

## Saves

A save (`adventure-save.ts`, version 3) holds the path of places, each
visited place's own facts keyed by place, the labyrinth's journey state as
one opaque blob, carried knowledge, and two small reveal ledgers:
`revealed` (which attainment/chest gain screens have already played) and
`found` (which entrance keys have been stood beside, passed through, or
read). Older saves migrate forward and never lose data: a version 1
(one-screen valley) or version 2 (island-coordinate) world save is
translated into the new path; a version 1 scroll-dungeon snapshot (the
retired single-floor cavern) migrates into its matching cavern's own
chamber facts. The Hush and its `kit`/`weapon`/`spell` needed **no save-
format change at all** — they ride inside the same opaque journey blob the
labyrinth always exported and restored, so an old save simply loads with
none of the three, exactly like an old save loads with no blocks moved.

## Community shrines (design, not yet built)

The goal is for players to build their own shrines, with their own puzzle rooms, and set them into the world.

- **A shrine is one artifact.** It holds its rooms (any of the three inner kinds: labyrinth, treasure room or scroller) and its own appearance. It depends on no plot and no island, so it still looks like itself when shared alone.
- **A plot is a placeholder, not a parent.** It has a position, a footprint and an entrance style, and names no shrine. An empty plot is a finished state; the island already has four.
- **A shrine seats onto a plot through a mark the shrine wears.** The position lives on that mark, so one shrine can stand on several plots, on several islands.
- **Discovery follows the pools-across-hosts pattern** (`pools-across-hosts.md`): shrines are found at a pool address, never through a named file.
- **Still to decide:** which shrine a plot shows when several seat on it, and how players find, rate and curate shrines.

## Rendering

- `island-paint.ts` paints two canvases. **Ground** sits under the people; **above** sits over them and holds only what rises into the cell behind a thing.
  - Land is soft unions of per-cell discs filled with tileable, procedurally generated textures, so coasts, forest floors and roads have organic edges.
  - Each chunk is baked once; a cast forgets only the chunks around its cell.
  - Per frame it draws only water glints, drifting cloud shadows, motes, wand effects and one baked light grade. No `shadowBlur`.
- `island-sprites.ts` draws the walkers. Their look belongs to the character redesign (the rooms' Dana style); the island only calls `drawWalker`, `lookFor` and `PLAYER_LOOK`.
- `island-places.ts` draws shrines, the pyramid, cavern mouths, plots, caches and signposts in the same cartoon language.
- People and entrances are real buttons on a layer that moves with the camera, so the map stays keyboard- and screen-reader-usable.

## Files

| File | Role |
|---|---|
| `games/solomon/place.ts` | The place graph: `PlacePath`, seat queries, routing, `PlaceSeed` |
| `games/solomon/story.ts`, `places.ts` | `STORY`, `STORY_BOARDS`, `PLACES`, labels, group/floor derivation |
| `games/solomon/story-when.ts` | `StoryWhen`/`StoryFacts` — the conditions language every reveal and gate reads |
| `games/solomon/attainments.ts` | The one reveal/progress/use registry — pieces, items, knowledge, places, tasks, contributions, abilities, and the six skill rows |
| `games/solomon/gain-screen.ts`, `items-table.ts` | The corner reveal card and the Items/Pieces/Knowledge/Places/Tasks table |
| `games/solomon/place-runtimes.ts` | `PlaceRuntime`/`RuntimeShell` and the three runtimes (island, labyrinth, chamber) |
| `games/solomon/adventure-save.ts` | Save v3, migration from v1/v2 and the retired scroll-dungeon v1 |
| `games/solomon/chamber.ts` | `ChamberModel` — the one engine behind every cavern, the interior chain, and the grove |
| `games/solomon/chamber-places.ts` | The nine `ChamberDefinition`s and their `GROUPS` |
| `games/solomon/chamber-view.ts` | The chamber DOM/canvas renderer |
| `games/solomon/island.ts` | The generator: terrain kinds, stamps, rivers, towns, roads, regions |
| `games/solomon/island-paint.ts` | Ground and above canvases, textures, atmosphere, wand effects |
| `games/solomon/island-places.ts` | Place sprites |
| `games/solomon/island-sprites.ts` | Walker sprites (character redesign) |
| `games/solomon/island-treasure.ts` | The chest-opening scene, item drawings, and the six skills' gain art |
| `games/solomon/cavern-paint.ts` | Cavern rock, pools, torches, torchlight and remembered passages |
| `games/solomon/wand-rules.ts` | The island's/chambers' shared wand table — a separate mechanism from the labyrinth's own wand |
| `games/solomon/rpg-overworld.ts` | `ISLAND_DEF`, people, places, the model (movement, wand, saves) and the view |
| `games/solomon/engine.ts` | The labyrinth's puzzle-platformer engine, plus the Hush, weapons, spells, and barriers |
| `games/solomon/labyrinth.ts`, `labyrinth-view.ts` | Room state/progression across a visit, and the room renderer's DOM tile bake |
| `games/solomon/renderer.ts` | The room's canvas layer — actors, effects, and every combat routine |
| `games/solomon/designer.ts`, `levels.ts` | The labyrinth-room level designer and its data shapes |
| `games/solomon/labyrinth-overlay.ts` | The one adventure shell: path, navigation, dialogs, saves, key routing |

## Verification

- `place.spec.ts` — enter/leave semantics, path-depth limits, `restore`'s
  longest-valid-prefix, route/step queries, `validateStory`.
- `story.spec.ts`, `story-when.spec.ts`, `attainments.spec.ts` — the story
  table's own reshuffle proofs, the conditions language's truth table, and
  every row of `ATTAINMENTS` (112 unique ids, including the six `skill:`
  rows), `heldAttainments`/`useAttainment`/`useVerb`.
- `chamber.spec.ts`, `chamber.snapshot.spec.ts` — every chamber mechanic in
  isolation (movement, push timing, plates/shutters, keys, gates, lamp
  sets, levers, the wand, tablets, chests, settling stones, the alcove/
  artifact/Rising-Light/finale, residents) and every restore-rejection rule.
- `chamber-playthrough.spec.ts` — a full, pinned walkthrough of all nine
  chambers (both caverns' three floors each, both interior rooms, the
  grove), push-to-enter/brushing-past/arriving-never-bounces proofs, and
  reachability, push, and clue-geometry numbers.
- `chamber-view.spec.ts`, `gain-screen.spec.ts`, `items-table.spec.ts` — the
  chamber renderer's cues and dialogs, the gain screen's open/close/queue
  rules, and the items table's tabs including Weapons & Spells.
- `island.spec.ts`, `rpg-overworld.spec.ts`, `rpg-overworld.snapshot.spec.ts`
  — the island is deterministic and surrounded by sea; the valley and every
  stamp are set tile for tile; every encounter is reachable on foot and with
  the wand; wand safety rules hold; version 1/2 saves round-trip.
- `labyrinth.spec.ts`, `labyrinth-playthrough.spec.ts`,
  `labyrinth-overlay.spec.ts`, `labyrinth-view.spec.ts` — room state
  including `kit`/`weapon`/`spell` surviving death/retry/save, a full
  twelve-room route, and the shell's full push/prompt/gain-screen/items-
  table/save wiring.
- `battle.spec.ts` — the Hush in isolation: the Stand gate, proximity and
  footing, the time-scale curve, every ending, guard/stagger, both weapons,
  all three spells, steles/chests/barriers, and restoring a v1 journey with
  no `kit` at all.
- `designer.spec.ts`, `adventure-save.spec.ts` — the stele/chest/barrier
  designer tools round-tripping through save and ASCII glyphs, and every
  save-migration and bounds rule including `revealed`/`found`.

Run from `src/`: `npx vitest run hypercomb-essentials/src/games/solomon`.
Full detail, controls, and the player-facing walkthrough of every mechanic
live in `hypercomb-essentials/src/games/solomon/ADVENTURE.md`.

## Next

1. **Scrollers**: long side-on levels on the rooms' engine, with a camera.
2. **More at the epicentre**: puzzles, residents and caches around Saltmere
   and the valley roads; a second or third area place beyond the grove.
3. **Community shrines**: authoring each kind of room, signing a shrine,
   seating it on a plot, finding it across hosts — and, ahead of that,
   places as real Hypercomb layers with seats as pheromones/decorations.
4. **Mobile touch for weapon/spell cycling** (N/B) — Strike and Cast already
   have touch buttons; cycling stays keyboard-only for now.
