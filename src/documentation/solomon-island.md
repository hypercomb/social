# Solomon's Key: the island

The adventure above the rooms is an island you walk across without the screen ever changing. It grows outward from one busy centre, and it is meant to hold shrines that other people build.

## One primitive: the place

Everything in the adventure is the same thing: a **place**. This is the hypergraph, the same pattern Hypercomb uses for tiles and layers.

- **A place** has a view and a map. The view is one of four: top-down island, torchlit cavern, side-on room, or side-on scroller.
- **A place holds entrances.** An entrance is a placeholder in the map: a cave mouth, a door, a shrine plot, a town gate. It names no place. Any place can seat into it, through a mark the place itself wears.
- **Walking into an entrance goes down** into the place seated there, a world of its own at its own scale. **Leaving goes back up** to exactly where you came in.
- **There is no special top or bottom.** The island is itself a place and can sit in an entrance of something larger, and any node can become another tree. The world is infinite by composition, not by size.
- **Every place is atomic.** It stands alone, carries its own look, and depends on no parent. That is why a community shrine is simply a place someone made, seated into a plot.

What this changes (the next step; not built yet):

- **Shell:** the adventure shell keeps a **path of places**, like the hive's lineage, instead of fixed world/room/dungeon modes.
- **Views:** each view is a renderer for one kind of place. The island, caverns, labyrinth rooms and scrollers all go in and out the same way.
- **Saves:** a save holds the path and each place's own facts, keyed by place.
- **Hypercomb:** places are Hypercomb layers and a place's entrances are its children, so the hive's navigation, history and sharing apply without a second system.

## Four kinds of place

| Place | View | What you do there | State |
|---|---|---|---|
| **The island** | Top-down, three-quarter | Walk anywhere without a screen change; talk, read signs, open caches, use the wand on brickwork, assemble shrines | Built |
| **Labyrinths** | Side-on, one screen per room | The original Solomon's Key rooms, joined across depths; every square is a native tile layer | Built earlier |
| **Treasure rooms** | Top-down, rectangular | Inscriptions, rune gates, hidden alcoves (today's Wayfarer and Highland caverns), walked by torchlight | Built; re-rendered in the island's style |
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
| `games/solomon/island.ts` | The generator: terrain kinds, stamps, rivers, towns, roads, regions |
| `games/solomon/island-paint.ts` | Ground and above canvases, textures, atmosphere, wand effects |
| `games/solomon/island-places.ts` | Place sprites |
| `games/solomon/island-sprites.ts` | Walker sprites (character redesign) |
| `games/solomon/island-treasure.ts` | The chest-opening scene and item drawings |
| `games/solomon/cavern-paint.ts` | Cavern rock, pools, torches, torchlight and remembered passages |
| `games/solomon/scroll-dungeon.ts` | The cavern model (unchanged) and its torchlit view |
| `games/solomon/rpg-overworld.ts` | `ISLAND_DEF`, people, places, the model (movement, wand, saves) and the view |
| `games/solomon/labyrinth-overlay.ts` | The adventure shell; Z/J cast the wand on the island |

## Verification

- `island.spec.ts`
  - The island is deterministic and surrounded by sea.
  - The valley and every stamp are set in tile for tile.
  - Coast, forest, rivers with bridges, snow-capped mountains and towns all exist.
  - Regions are named correctly.
  - Walking the valley road leads straight out onto the island.
- `rpg-overworld.spec.ts`
  - Every encounter is reachable on foot and with the wand.
  - Each Brick Garden puzzle is walked through end to end.
  - Wand safety rules hold.
  - Residents talk, plots describe themselves, and regions are announced.
- `rpg-overworld.snapshot.spec.ts`: version 1 and version 2 saves, wand changes and opened caches.

## Next

1. **The path-of-places shell** (see *One primitive: the place*): one way in and out of every place, at any depth.
2. **Scrollers**: long side-on levels on the rooms' engine, with a camera.
3. **More at the epicentre** before going further out: puzzles, residents and caches around Saltmere and the valley roads.
4. **Community shrines**: authoring each kind of room, signing a shrine, seating it on a plot, finding it across hosts.

## Handoff 2026-09-11 — the doors (built in another session by mistake, tests green)

Jaime's direction, given in the chat-experience session and belonging here:
touch a door to pass through it (no E); a ~1 s visualization between every
warp; no direction glyphs — a door is its colour and shape, hashed from the
room it leads to, so the same place always looks the same; zoom in/out as the
theme for entering any place; later, proximity battles that slow time, new
weapons and spells, interactables that unlock barriers, and a beauty overhaul
of both the puzzle rooms and the caverns.

Landed, uncommitted, 91/91 Solomon specs green, `tsc` clean:
- `labyrinth.ts`: `get arrivalDoor()` on `LabyrinthJourney`.
- `labyrinth-overlay.ts`: `#passDoor()` in the room loop — standing in an
  open door passes through; the arrival door is skipped until you step off;
  a locked door says its requirement once per approach (low tone); E still
  works. Entry message reworded.
- `labyrinth-view.ts`: `doorHue`/`doorShape` (FNV hash of the target room id;
  shapes arch · round · peak · gate · keyhole), `.sol-passage` restyled with
  `--door-h`, no text, `.known` glow when the far room was visited, locked =
  dashed + hatch; the VEIL (`.sol-room-veil` canvas, `VEIL_MS` 1000): the old
  room breaks into 6→1-tile blocks, the new room resolves 6→1 and the veil
  lifts, drawn from the tile grid (walls stone, bricks clay, doors their hue,
  relics gold); plus a ZOOM of the board from the arrival door (in: scale
  .55→1, out: 1.35→1). Reduced motion: none of it. jsdom (no canvas): the
  veil is skipped, the zoom uses `animate` when present.
- `labyrinth-overlay.spec.ts`: "passes through a door by touching it".

Not verified visually: a scratchpad harness (`solomon-doors-4334` in
launch.json, another session's scratchpad path) mounted the overlay, but the
keyboard-driven walk to the Dawn Shrine did not move the player in the Browser
pane, so the veil and the door looks were not eyeballed. Please eyeball on
your harness (`world.html`/`cavern.html` with `__at`) and adjust the door
palette/shapes and the veil timing to taste.
