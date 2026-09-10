# Solomon's Key adventure

The adventure has three connected forms of play:

- **Overworld:** walk through Sevenfold Valley, meet people, reason from their clues, and assemble the shrines in front of labyrinth entrances.
- **Labyrinths:** twelve fixed 16 × 12 rooms across Sunseed, Tideglass, and the Pyramid of Accord. Each square is a native Hypercomb child layer. Movement stays on a two-dimensional playing surface; reciprocal passages connect chambers at different depths, including return routes and a cross-connection.
- **Scrolling dungeons:** Wayfarer and Highland expeditions use their own four-direction exploration, inscriptions, rune sequences, and interpretation puzzles. Their discoveries explain real hidden treasures in the labyrinths.

The six triangular points, central hexagon, and complete Star of David are permanent abilities. Placing a piece into a shrine fills that socket without spending the piece. Pieces also carry information for the shared journal. The first encounter supplies the Dawn triangle; Sunseed supplies two more points and the center; Tideglass supplies the remaining points; the complete star opens the pyramid.

## Controls

Use arrows or WASD to walk, E or Enter to interact, M to return to the world, and Escape to close a conversation or return. Approaching a cavern or an assembled shrine shows a compact entrance prompt; press Enter or click to go inside. Incomplete shrines still show their component assembly. In labyrinths, Up or Space jumps, Down ducks, Z conjures or dispels a block, X uses a stored fireball, and R retries the chamber. Touch controls provide walking, jumping, wand use and interaction.

## Native tiles and saved discoveries

`tile-surface.ts` seeds room definitions into `solomon-maze-v1/<room>/cell-<column>-<row>` through Hypercomb's real `LayerCommitter.importTree`. It hydrates terrain, doors, relics and gates from those signed child layers before play. Existing authored rooms are preserved; absent or unreadable native data is reported rather than replaced by a disconnected canvas game.

`labyrinth-view.ts` renders one addressed plate per native square. Its transparent canvas draws actors and effects only. `LabyrinthJourney` holds visited room engines, so blocks, enemies and pickups retain their state when travelling between rooms during an open adventure. Physics changes remain participant-local projections rather than shared authoring operations every frame.

Earned sigils, shrine placements, conversations, knowledge and score are saved locally under `hc:solomon-adventure:v1`. Closing and reopening starts fresh room attempts with those discoveries retained. Dungeon gate attempts and room simulation are retained while the adventure stays open. The existing level designer remains available separately.

## Implementation and reference

The launch drone opens `labyrinth-overlay.ts`. Campaign definitions and progression live in `labyrinth.ts`; the other two play models are `rpg-overworld.ts` and `scroll-dungeon.ts`.

The supplied [GameMaker remake](https://forum.gamemaker.io/index.php?threads/solomons-key-classic-arcade-remake.55322/) is a reference for compact puzzle rooms. Its [author's page](https://immortalx74.itch.io/solomonskeyremake) links an open-source remake. No external game code or assets were imported. The current room count uses the [NES 16-column, 12-row terrain format](https://datacrystal.tcrf.net/wiki/Solomon%27s_Key/ROM_map); these are newly authored rooms for the connected adventure.

## Verification

The colocated Vitest specs cover native layer creation through the real committer, native hydration, room traversal and retained state, unique rewards, shrine assembly, conversation choices, knowledge-gated dungeon puzzles, hidden-secret payoffs, durable discoveries and overlay lifecycle. The original `selftest.ts` continues to cover the underlying platformer mechanics and designer level sanitation.

`tile-surface.history.spec.ts` also uses the real HistoryService and LayerCommitter with in-memory OPFS handles, then reopens the saved native rooms through a fresh HistoryService. `labyrinth-playthrough.spec.ts` exercises a complete twelve-room route through normal movement, jumping, spell and passage inputs, collecting all sigils and both inscription secrets without losing a life or changing player coordinates directly. This checks physical reachability; difficulty and visual polish still need human playtesting.
