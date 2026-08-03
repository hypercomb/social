# behaviors-theme — keep the behaviors mirror's artwork in sync

The `behaviors` hive is visually themed (2026-08-02): every cell wears a
generated card — dark slate ground, faint hex lattice, one Material glyph in a
hexagon ring, colored by collection pheromone. **No text in the art** — the
platform labels tiles. Tiers: root = gold double ring; collection = heavy ring,
saturated glyph; behavior = lighter ring, per-behavior glyph; part = dim muted
`data_object` card.

## Sync model

Theming is part of the **mirror doctrine** (`src/documentation/mirror-paradigm.md`):
when a behavior ships, the same pass that adds its tile + pheromones + note also
mints its card. Two ways to stay in sync:

1. **Per-behavior (preferred, same pass as the code):** add the tile to the
   mirror as usual, add a glyph for it in `GLYPHS` in `gen-behavior-tiles.mjs`
   (falls back to the collection glyph if omitted), then run the sweep.
2. **Sweep (catch-up):** `node scripts/behaviors-theme/sweep.cjs` walks the
   live tree, renders every card, and pushes only cells not already wearing
   their exact card (content-addressed comparison — re-runs are cheap no-ops).

## Pieces

| Script | Does |
|---|---|
| `walk.cjs` | Fresh census of the behaviors tree over the bridge (path-addressed `layer-at`; child names resolved via layer bytes — never trust `inflate` for fresh subtrees) → `census.json` |
| `gen-behavior-tiles.mjs` | Renders 512×512 cards with playwright + the repo's local Material font (Google Fonts is unreachable from agent sandboxes) → `tiles/` |
| `push-tiles.cjs` | Bridge pipeline per cell: `put-resource(png)` → merge props (`small.image`, `substrate:false`, keep `index`/`flat`) → `bag-set properties` → `stamp` (syncs `hc:tile-props-index` + repaint). Checkpointed in `push-progress.json`, idempotent by image sig |
| `sweep.cjs` | walk → gen → push |

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
