# Quick menu options are traits

*jwize, 2026-11-01:* "it should just be a hive of behaviors" … "the tiles would turn into children and become there automatons" … "they can be swapped out with others" … "where something is hardcode you add traits and then you look across servers for the traits."

Hold alt over a tile and the flower opens. Every option in it is a [trait](traits.md) of that tile. What the registry ships is the option's own version, so a tile with nothing of its own gets the ordinary flower and nothing is stored for it.

## What a tile can do with a seat

Stand in the tile, then:

| Say | What happens |
|---|---|
| `trait copy` | Extrudes a child named `copy`. It is this tile's automaton for that seat. The seat keeps working as it did. |
| Add children under that child | The seat opens a flower of them. Each child runs the word it is named. |
| `trait own view`, then `fill view /beta` | Swaps the seat without making a child. It runs the word `beta`. |
| `fill ~ view` | Puts the seat back. |
| `menu trigger copy hold` | Says how this tile's seat fires. |
| `menu trigger` | Lists this tile's triggers. |

An ordinary child is just a tile. It takes a seat only when the tile has a trait by its name.

## Triggers

| Trigger | When the leaf fires |
|---|---|
| `release` | When alt is let go. The default, and the absence of a mark. |
| `rollover` | As soon as the pointer arrives. |
| `hold` | After resting on it for 600 ms. Moving off cancels. |
| `click` | Only on Enter or a click. Letting go of alt just closes the flower. |

A pathway always opens on arrival, so a trigger on one does nothing.

The trigger is a `quick-menu:trigger` mark on the tile that holds the seat, one per word. It stays with the seat, never on the automaton, so a swapped-in automaton cannot give itself rollover.

## Why it is safe

A seat only ever runs a word, and a word exists only once its bee has been admitted. Somebody else's automaton held in the [brood](../hypercomb-core/src/core/brood.ts) has no word, so it cannot fire from a seat.

## Across hosts

A setting is a mark or a layer addressed by signature, so it travels with the tile and belongs to no host. Traits filter towards the need: a tile's words are the query, so a hive only asks for what it wants. Fillers from followed hosts are offers and replace nothing until picked.

## Not built

- The followed-hosts rung ([traits.md](traits.md)). Fillers come from this hive only.
- A reader's own trigger over the author's. A mark on a tile reaches everyone who gets the tile.
- A way to do any of this from the flower itself. It is words only so far.
- Showing which seats are filled.
- A shared default across tiles.
- A seat swapped with `fill` cannot open a flower. It runs one word.
- More than five children under a seat. The rest are not shown.
- Rollover, hold and click on the cursor ring. Only the flower reads them.

Code: `hypercomb-essentials/src/quickmenu/quick-menu.traits.ts`.
