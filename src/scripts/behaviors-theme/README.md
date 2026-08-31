# behaviors-theme — keep the behaviors deck's artwork in sync

The `behaviors` hive is visually themed (2026-08-02): every cell wears a
generated card — dark slate ground, faint hex lattice, one Material glyph in a
hexagon ring, colored by collection pheromone. **No text in the art** — the
platform labels tiles. Tiers: root = gold double ring; collection = heavy ring,
saturated glyph; behavior = lighter ring, per-behavior glyph; part = dim muted
`data_object` card.

## Hex orientation

Every hexagon in the art — the glyph ring, the root's inner ring, and the faint
lattice — is **point-top**, matching the platform grid. One constant governs the
whole set (`ROT` in `gen-behavior-tiles.mjs`), so a card can never disagree with
itself. Orientation was briefly part of the per-name jitter, which left 405 of
458 cards flat-top against a point-top lattice; corrected 2026-08-04 and pushed
as one revision.

## Two art slots per cell

A cell carries **two independent images**, and the grid orientation picks which
one renders:

| Slot | Shown when | Holds |
|---|---|---|
| `small.image` | point-top grid | the glyph cards in `tiles/` |
| `flat.small.image` | flat-top grid | photographic art on 209 cells; glyph cards from `tiles-flat/` on the rest |

They are separate snapshots — writing one never disturbs the other. This is
the thing to check first when art "disappears" after an orientation switch:
the tile is not broken, it is showing its other slot.

Generate a set with `HEX_ORIENTATION=flat OUT_DIR=tiles-flat` — orientation and
output directory are separate knobs precisely so one set can never render over
the other's files. The lattice offsets (`dx`/`dy`) are flat-top pitch, so the
flat set tessellates exactly; see the note in `lattice()` for why the point-top
default is left on that same pitch.

## Sync model

When a behavior gets a tile in the behaviors deck, it wants a card. Two ways to
stay in sync:

1. **Per-behavior:** add a glyph for it in `GLYPHS` in `gen-behavior-tiles.mjs`
   (falls back to the collection glyph if omitted), then run the sweep.
2. **Sweep (catch-up):** `node scripts/behaviors-theme/sweep.cjs` walks the
   live tree, renders every card, and pushes only cells not already wearing
   their exact card (content-addressed comparison — re-runs are cheap no-ops).

## Pieces

| Script | Does |
|---|---|
| `walk.cjs` | Fresh census of the behaviors tree over the bridge (path-addressed `layer-at`; child names resolved via layer bytes — never trust `inflate` for fresh subtrees) → `census.json` |
| `gen-behavior-tiles.mjs` | Renders 512×512 cards with playwright + the repo's local Material font (Google Fonts is unreachable from agent sandboxes) → `tiles/` |
| `push-tiles.cjs` | Bridge pipeline per cell: `put-resource(png)` → merge props (`small.image`, `substrate:false`, keep `index`/`flat`) → `bag-set properties` → `stamp` (syncs `hc:tile-props-index` + repaint). Checkpointed in `push-progress.json`, idempotent by image sig. Ends the pass with one `build-record` over `/behaviors` so the whole sweep is a single restorable step (`documentation/build-revisions.md`) — a pass that changed nothing mints no revision |
| `push-flat-tiles.cjs` | Same pipeline into the **`flat.small.image`** slot, and only for cells that have none — a cell already wearing flat art is never overwritten (that is where the photographs live). `--dry` reports what it would fill. Checkpointed in `push-flat-progress.json` |
| `sweep.cjs` | walk → gen → push |

## Publishing (why a second device shows nothing)

Card resources live in the authoring browser's OPFS. Another device can only
fetch what has been **published**, and consumers do not auto-update — the head
sig has to be carried by hand (`scripts/publish-content.ts`). On 2026-08-04 the
point-top cards had never been published (0 of 458, across both the old and the
corrected set) while the flat photos had, so a second device showed photographs
in flat-top mode and bare tiles in point-top. Re-theming cannot fix that; only
publishing `/behaviors` and pointing the device at the new head can.

Prereqs: broker up (`node scripts/bridge/run-bridge.cjs`), exactly **one**
renderer tab (`http://localhost:4250/?claudeBridge=1`, real Edge profile —
two app tabs make the renderer flap; the Claude-in-Chrome extension tab sees a
different OPFS bucket and must never carry the bridge flag).

Palette (mirrors TagRegistry): behaviors `#d9a514`, game `#c05b4d`, view
`#4d7fae`, assistant `#8a63c9`, swarm `#4f9d6e`, appearance `#b06a9e`,
structure `#8b909a`, input `#579fa5`, guidance `#c98f2f`, tool-windows `#6b7fae`.

Views: `visual:diagram:deck` sits on the root + every collection (a new
collection needs one `decoration-add` with payload `{icon:'slideshow'}`,
mark persistent); the root also carries `visual:tree:branch`.
