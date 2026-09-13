# Solomon's Key adventure

The adventure is one shell walking a **path of places** — the same hypergraph
pattern the hive uses for tiles and layers (full doctrine:
`src/documentation/solomon-island.md`). Three kinds of place sit on that path
today:

- **The island** — a continuous top-down/three-quarter world. Walk anywhere
  without a screen change; talk, read signs, open caches, use the wand on
  brickwork, and assemble shrines from relic pieces.
- **Chambers** — rectangular, torchlit rooms: two three-floor caverns
  (Wayfarer, Highland), one interior chain (Wenna's house → her cellar), and
  one area place, the Hollow Grove. All nine run on the same `ChamberModel` —
  continuous movement, blocks and plates, keys and doors, rune gates, lamp
  sets, levers, hidden chests, a heart finale, the Rising Light. **Zero
  enemies, zero combat, ever** — that boundary is load-bearing, not an
  oversight (see "The Hush" below).
- **Labyrinths** — the original Solomon's Key rooms (Sunseed, Tideglass, the
  Pyramid of Accord), native tile layers joined across depths. Alongside the
  pre-existing platforming — the wand-as-cast/dispel, fireball, relics, and
  `SigilRequirement`-gated walls — these rooms now also carry a learnable
  stance, two weapons, three spells, and sealed-stone barriers.

Any place can seat into another place's entrance, through a mark the seated
place wears — never a parent holding children. Walking into an entrance goes
**down** into the place seated there; leaving goes **up**, back to exactly
where you came in. See `src/documentation/solomon-island.md` for the full
place-graph doctrine (`place.ts`, `story.ts`).

## Controls

Arrows or WASD walk; E or Enter interacts with the nearest reachable thing;
M returns to the world; Escape closes a dialog, a table, or steps up one
place. In labyrinth rooms only: Space jumps, Z or J casts/dispels the
labyrinth's own wand-brick, X or K throws a fireball, R retries the room, C
strikes with a held weapon, V casts a held spell, N cycles held weapons, and
B cycles held spells. I opens the **Items** table from anywhere. Touch
controls mirror all of this — walking, jump, wand, use, **Strike**, and
**Cast** are real buttons; weapon/spell cycling (N/B) stays keyboard-only for
now.

Header buttons: **World** returns to the island; **Designer** opens the
labyrinth-room designer; **Items** opens the items table; **Saves** opens the
save-slot panel; the breadcrumb trail jumps to any ancestor place directly.

## Push-to-enter and beside-prompts

Every portal in every place — island doors and cave mouths, chamber
exits/entrances/the Rising Light, a labyrinth door — is entered by **walking
into it and holding the direction for a beat** (`PUSH_DELAY`, 0.3s), or by a
mouse/touch click on its marker. E never enters a portal. Beside a portal, a
bubble names it and its destination, with no key hint — "Stairs down · The
Cistern."

Everything you act on instead of walk through — a chest, a door, a gate, a
lever, a lamp, an alcove, a resident, a labyrinth stele or chest — is an
**E-target**: within reach, its bubble reads "`<name>` · E to `<verb>`."

A third kind reports state and triggers nothing on its own: a chamber
shutter latches itself once its plates are pressed, and a labyrinth barrier
opens itself the instant its attainment is learned. Its bubble is a tag with
no verb: "Sealed stone · it knows the Ward of Solomon."

This one rule holds identically everywhere in the game — no place kind gets
its own beside-prompt logic invented separately.

## The zoom

Crossing between the island and any chamber, area, or labyrinth plays one
zoom-and-veil transition, drawn from a coarse picture of the place you're
leaving. A labyrinth's own room-to-room passage keeps its own, earlier-landed
door veil; the shell's zoom only plays at the outer island boundary. A Hush
never survives either transition — arriving always clears any live exchange
before the picture is taken.

## Chambers: caverns, the interior chain, and the Hollow Grove

Wayfarer Cavern (The Wet Steps → The Cistern → The Spring Heart), Highland
Cavern (The Hall of Hours → The Six Roads → The Accord Sanctum), Wenna's
house and cellar, and the Hollow Grove all run on `chamber.ts`'s
`ChamberModel`. Every mechanic in this list is data on a `ChamberDefinition`,
never a special case in code: movement and collision on a 0.25-radius box;
push-to-enter portals; tablets read by proximity; blocks pushed by
continuous contact onto plates; shutters that latch permanently once their
plates are pressed; doors unlocked by a chamber's own key chests (never a
cross-chamber count); rune gates read from a tablet and solved in a taught
order; lamp sets (ordered or not) that reveal hidden chests or the chamber's
present artifact; levers; the wand (crack/rune/spring, fully reversible,
never able to trap you); settling stones that send blocks home; residents
who cycle their lines; and the Rising Light, entered by pushing, that closes
a chamber's own finale.

The Hollow Grove (`island/valley-grove`) is the one **area** place — no
shrine, no cavern floor, just a stand of trees the size of nine island
cells, walked in from any of its four edges and pushed back out the same
way. It wears no group mark; its own chest, tablet, and resident (Nettle,
the herb-gatherer) are all new content, not a re-skin of a cavern.

Every reading, chest, and the artifact/Rising-Light payoff raises one **gain
screen** (below) — never a chamber-owned dialog of its own.

## Labyrinths: rooms, relics, and the Hush

Doors are portals (push-to-enter, already hued and shaped per destination);
relics (triangle/hexagon/star) are walk-over pickups that raise a gain
screen as a piece flies into the star. `SigilRequirement`-gated walls open
automatically once their relic is held — they are untouched terrain, never
an E-target, never a tag; a labyrinth "gate" has no interaction of its own.

**The Hush** is a proximity duel state, gated behind one thing: reading the
**Stele of the Stand**, on bare floor at the very start of Sunseed Porch,
before any platforming. Until it is read, nothing can open a Hush — a new
player's first step near any foe is always safe. Once armed, coming within
reach of a grounded fighter (goblin, gargoil, dragon, saramandor) at roughly
the same height, or a flying `neul` at any height, opens an exchange: the
marked foe and its shots slow to 0.65×, every other enemy and the sand drain
slow to 0.25×, and Dana alone stays at full speed. A kill, a parting beyond
reach, a forgiving hit (costs sand and a knockback, not a life), or a 12s
stalemate all end it cleanly; nothing about this ever moves the camera or
changes the screen — that rule is absolute. Outside a Hush, everything is
exactly as it always was: instant death on contact, instant kills on a
shot. Only `goblin`/`gargoil`/`dragon`/`saramandor`/`neul` ever trigger a
Hush; `ghost`/`sparkball`/`demonhead`/`panel` stay today's ordinary hazards.

### Weapons, spells, and the stance

Steles teach a spell or the stance; chests hand over a weapon — both
E-gated, read or taken once, with a second E just re-showing the words.

| Kind | Id | Use | What it does |
|---|---|---|---|
| Stance | `stand` | — | Arms the Hush. Permanent, un-equippable. |
| Weapon | `sickle` (Sickle of the Sun) | C, cycle with N | Melee; a hit that doesn't finish a foe staggers it. |
| Weapon | `sling` (Tideglass Sling) | C, cycle with N | Thrown, homes back, fetches any item it crosses. |
| Spell | `ward` (Ward of Solomon) | V, cycle with B | No sand; turns an incoming hit or shot into a stagger on the attacker. |
| Spell | `ember` (Ember Sigil) | V, cycle with B | Costs sand; flame two tiles wide from the wand's own target cell. |
| Spell | `hold` (Hourglass Hold) | V, cycle with B | Costs sand; freezes the room, and — mid-Hush — the marked foe longer. |

### Barriers

A barrier is a sealed stone wall carrying one requirement (`needs:` a
stance/weapon/spell id). It opens the instant that id enters the kit,
wherever Dana is standing — no brazier, no second unlock step, and it
re-derives correctly on every room load, every save restore, and every new
skill learned mid-visit. It is a **tag**, never an E-target: nothing opens
it directly, and E beside one does nothing, exactly like a chamber shutter.

Placements: the Stele of the Stand and the Sundial Stone (Ward) both sit in
`sunseed-porch`, before any foe can be met. The first Hush opens in
`sunseed-steps`, beside the Sickle of the Sun chest. The Hearth Stone
(Ember) sits in `sunseed-loft`; the barrier it opens (`needs: 'ember'`) seals
a pickup in `sunseed-heart`. The Tideglass Sling chest sits in
`tideglass-steps`; the Hourglass Stone (Hold) in `tideglass-loft`;
`tideglass-heart` adds no new content — its existing gargoil duel is the
proof of Ward's reflect. `starbloom-heart` holds the one remaining barrier,
`needs: 'hold'`, the gauntlet's gated reward. Every placement sits on solid,
reachable ground, approachable from a side, and never blocks the only route
to its own prerequisite.

## Items table and the gain screen

Every permanent thing a traveller can hold — relic pieces, cavern treasures,
knowledge, places visited, ways opened, solved gates, island conversations,
permanent abilities, and now the stance/weapons/spells — is one row in a
single registry (`attainments.ts`). Two surfaces read it:

- **The gain screen** — a corner card that plays once, the moment something
  is first held: a piece flies into the star, an item drops into its group,
  a "Weapons & Spells" card shows the new skill's own art. E (not repeat),
  Escape, or a click on × close it — there is never a second dismiss
  control.
- **The items table** (I) — the one Journal replacement, five tabs: Pieces,
  Items, Knowledge, Places, Tasks. The Items tab's first group is **Weapons &
  Spells**: a held one not currently equipped shows an "Equip" button; the
  equipped one shows "Equipped" as plain text; an unheld one is a silhouette
  row. The Stand appears once, among Knowledge/Abilities, never duplicated
  into the weapons group.

## Saves v3

A save holds a path of places, each visited place's own facts, the
labyrinth's opaque journey blob, carried knowledge, and two small ledgers:
`revealed` (attainment/chest ids whose gain screen has already played) and
`found` (entrance keys stood beside, passed through, or read). A version 1
(one-screen valley) or version 2 (island-coordinate) save migrates forward;
a version 1 scroll-dungeon snapshot migrates into the matching cavern's own
chamber facts. The labyrinth's stance/weapon/spell state needs no save-format
change at all — it already rides inside the same opaque journey blob
`LabyrinthJourney.exportState()`/`.restoreState()` always carried, and an old
save simply restores with none of the three, exactly like an old save
restores with no blocks moved.

## Implementation and reference

The launch drone (`solomon.drone.ts`) opens `labyrinth-overlay.ts`, the one
shell (`place-runtimes.ts` for its `PlaceRuntime`/`RuntimeShell` contracts).
The place graph is `place.ts`/`story.ts`/`places.ts`; chamber content is
`chamber.ts` (the model) and `chamber-places.ts` (the nine definitions),
rendered by `chamber-view.ts`; the island is `island.ts` (the generator) and
`rpg-overworld.ts` (definition, model, and view); labyrinth rooms are
`engine.ts`/`labyrinth.ts`/`labyrinth-view.ts`/`designer.ts`/`levels.ts`,
rendered by `renderer.ts`. The one reveal/progress/use registry is
`attainments.ts`, shown through `gain-screen.ts` and `items-table.ts`. Saves
are `adventure-save.ts`. `overlay.ts` is a separate, simpler harness for
playtesting one designed labyrinth room outside the adventure; it shares
`designer.ts`/`levels.ts` but has no path, no items table, and no gain
screen — E beside a stele or chest there just prints straight to its status
line.

The supplied [GameMaker remake](https://forum.gamemaker.io/index.php?threads/solomons-key-classic-arcade-remake.55322/) is a reference for compact puzzle rooms. Its [author's page](https://immortalx74.itch.io/solomonskeyremake) links an open-source remake. No external game code or assets were imported. Labyrinth rooms use the [NES 16-column, 12-row terrain format](https://datacrystal.tcrf.net/wiki/Solomon%27s_Key/ROM_map); every room is newly authored for this adventure.

## Verification

Run from `src/`: `npx vitest run hypercomb-essentials/src/games/solomon`.
jsdom is the default environment; every view path — chamber, island, and the
room renderer's combat routines — tolerates a `null` canvas context.

- `place.spec.ts` — the path graph: enter/leave, restore's longest-valid-
  prefix, route/step queries, `validateStory`.
- `chamber.spec.ts` / `chamber.snapshot.spec.ts` — every chamber mechanic in
  isolation, every restore-rejection rule (unknown ids, unread gates,
  forged unlocks, out-of-order lamp sequences, memories without the
  hexagon), and the structural build checks.
- `chamber-playthrough.spec.ts` — a full walkthrough of every one of the
  nine chambers (all three cavern floors each, both interior rooms, the
  grove), push-to-enter timing and refusal, reachability proofs, and the
  pinned push/clue-geometry numbers.
- `chamber-view.spec.ts` — the DOM/canvas renderer: cues, dialogs, the fresh-
  chest/artifact gain sequence.
- `story.spec.ts` / `story-when.spec.ts` / `attainments.spec.ts` — the story
  table, the conditions language, and every row of the one attainment
  registry (112 unique ids, including the six `skill:` rows).
- `gain-screen.spec.ts` / `items-table.spec.ts` — open/close rules, queueing,
  the Weapons & Spells group.
- `labyrinth.spec.ts` / `labyrinth-playthrough.spec.ts` /
  `labyrinth-overlay.spec.ts` / `labyrinth-view.spec.ts` — room state
  (including `kit`/`weapon`/`spell` surviving death, retry, and save/
  restore), a full twelve-room route, the shell's push/beside-prompt/gain-
  screen/items-table/save wiring, and the in-room prompt/status line.
- `battle.spec.ts` — the Hush in isolation: the Stand gate, proximity and
  footing, the time-scale curve, every ending, guard/stagger, both weapons,
  all three spells, steles/chests/barriers, and save-restore of a v1 journey
  with no `kit` at all.
- `designer.spec.ts` — the six stele/chest tools and a barrier round-trip
  through save, `sanitizeLevel`, and the ASCII glyphs.
- `adventure-save.spec.ts` — v1/v2/dungeon-v1 migration, the v3 refusal
  table, and `revealed`/`found`'s own bounds and sort order.
- `rpg-overworld.spec.ts` / `rpg-overworld.snapshot.spec.ts` / `island.spec.ts`
  — the island: reachability, the wand, push/crossing entrances, saves.
- `tile-surface.*.spec.ts` — native layer creation and hydration through the
  real `HistoryService`/`LayerCommitter`.

`overlay.ts`'s combat touch (C/V/N/B, the no-modal E-message, the seven new
designer tools) has no spec of its own — it rides on `designer.spec.ts`'s
round-trip coverage of the same data plus manual verification through the
harness, exactly as `selftest.ts` already covers the underlying platformer
mechanics.
