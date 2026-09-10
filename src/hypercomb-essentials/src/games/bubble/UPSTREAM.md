# Bubble Bobble adaptation

The previous Hypercomb simulation, vector renderer, authored campaign and level
designer have been replaced with a browser adaptation of
[Julian Rijken's BubbleBobble](https://github.com/JulianRijken/BubbleBobble), pinned
to commit `6a59ee99e621f4061cab50802155b9c28c51c4f9`.

The adapted game code and level data are distributed under **GPL-3.0-or-later**,
as declared by the upstream README. The complete license is in [COPYING](COPYING).
Credit remains visible in the game's footer. This is a fan-made adaptation, not
Taito's original arcade source.

## Source correspondence

- `engine.ts`: the movement, bubble capture/escape, enemy pursuit, Maita shots,
  defeated-enemy fruit and respawn behavior are adapted from upstream
  `src/Components/CaptureBubble.*`, `src/Components/Character/Player/PlayerState.*`,
  character/enemy components, `src/Game.cpp` and `src/Scenes.cpp`.
- `levels.ts`: the three playable maps are decoded from upstream
  `Assets/Levels.png`, following `Game::ParseMaps`. Enemy placement follows
  `src/Scenes.cpp`, except round one's ledges and floor are one tile lower and
  it opens with three Zen-Chan on the upper platform, matching the Taito arcade
  reference. Blue, green and red in the
  source map identify collision types; they are not visible tile colors.
  The top 16 pixels are reserved for the HUD.
- `renderer.ts` and `sprite-assets.ts`: the arcade presentation uses sprite
  sheets supplied in the pinned upstream repository, embedded locally so no
  asset server or runtime download is required. Their source names and revision
  are recorded alongside the embedded data. The characters and original game
  designs are Taito's; these are not newly authored Hypercomb sprites. The
  upstream project declares GPL-3.0-or-later and provides no separate asset
  license or Taito permission statement. No music or sound files are copied.
- `overlay.ts`: Hypercomb's launch/close shell, local keyboard document, touch
  controls, fixed simulation timestep, focus/visibility pause, score storage and
  synthesized sounds. The 256×224 canvas fills the available space using a 4:3
  cabinet display aspect, without discarding space by rounding the scale down.
  This follows MAME's [visible raster configuration](https://github.com/mamedev/mame/blob/master/src/mame/taito/bublbobl.cpp)
  and [default CRT aspect](https://github.com/mamedev/mame/blob/master/src/emu/screen.cpp).
  This runs locally without a remote game embed or a WASM download.

This is a TypeScript/Canvas2D adaptation, not a binary-identical port of the
C++/Box2D game. The implementation uses pixel coordinates, deterministic collision
handling, one player and the upstream three-round campaign. The old designer's
localStorage data is left intact but is not read by this version. New scores use
`hc:bubble-arcade-hiscore`; the shared arcade mute preference is retained.

Visual comparison: [1986 arcade round-one screenshot, MobyGames](https://www.mobygames.com/game/787/bubble-bobble/screenshots/)
([image](https://cdn.mobygames.com/6074b612-c33c-11ed-9a87-02420a0001b4.webp)).
The opening now uses the pink diagonal tile pattern, black background and
recognizable upstream character sprites rather than the earlier generic art.

## Building and checking

The game ships through the existing essentials source/module build. There are no
new native toolchains, downloaded dependencies or external asset fetches. Source
for the adaptation is in this directory; the pinned upstream link above contains
the original C++ source and build instructions.

From `src/hypercomb-essentials`, run:

```powershell
node ../node_modules/vitest/vitest.mjs run src/games/bubble --config ../vitest.config.ts --root . --no-cache
```

From `src/hypercomb-dev`, run the application's TypeScript check:

```powershell
node ../node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit --incremental false
```
