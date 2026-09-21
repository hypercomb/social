# Bubble Bobble reconstruction

The authoritative campaign data now comes from a static reconstruction of the
supplied 1989 NovaLogic/Taito MS-DOS release. See
[DOS-REFERENCE.md](DOS-REFERENCE.md) for hashes, the safety boundary, decoded
formats, and the exact-versus-transitional status.

The repository contains clean TypeScript data only:

- all 100 native 100-byte terrain records in `dos-level-data.ts`;
- all 100 native enemy lists (575 descriptors) in `dos-enemy-data.ts`;
- all 100 airflow records, 100 collision-patch records, and three round-setting
  arrays in `dos-air-data.ts`;
- their typed decoders and native cell model in `levels.ts`.

No DOS executable, machine code, compressed resource, or runtime emulator ships
with Hypercomb.

## Reproducible static inspection

`scripts/bubble-static-inspect.py` is a read-only aid for an analyst who
already has the unpacked image in a separately controlled location. It requires
the exact 131,856-byte SHA-256 recorded in `DOS-REFERENCE.md` before printing a
bounded byte range; it never unpacks, downloads, executes, modifies, or bundles
the supplied file. From `src/hypercomb-essentials`, for example:

```powershell
py scripts/bubble-static-inspect.py --image C:\controlled\image.bin --start 0xA917 --length 0x60
```

`--disassemble` is optional and uses an already-installed Capstone Python
module in the analyst's external environment. Its direct near-call/jump targets
are display-only `CS:IP` values with a 16-bit masked IP; it is not an emulator.

## Living primitive architecture

`tile-surface.ts` projects the reconstructed campaign into the same native
Hypercomb shape used by Solomon's Key. The `bubble-bobble-dos-v1` branch is a
campaign layer; each loaded round is a child layer; and every one of its 32x25
visible cells is an individually addressed child layer. A cell owns its native
DOS byte, player marker, and ordered enemy descriptors. The eight native work
columns and three airflow settings live on the round layer.

The TypeScript tables are a seed, not permanent authority. A round is imported
once on first entry. Later openings resolve the round's current child heads,
so authored hive edits win even while the parent's historical child signatures
remain immutable. Incomplete, cold, or conflicting content is reported and is
never silently overwritten. Simulation state remains session-local; movement,
bubbles, scores, and 60 Hz native ticks do not generate history writes.

`overlay.ts` now waits for ROUND 01 to hydrate before play. At a clear boundary
it loads the next round, and `engine.ts` will not advance until that living
round has been installed. Only rounds actually reached are materialized, so
opening the game does not create all 80,000 cell layers at once.

## Reconstructed mechanics and transitional presentation

The initial actor simulation and current sprite presentation adapt Julian Rijken's
[BubbleBobble](https://github.com/JulianRijken/BubbleBobble) at commit
`6a59ee99e621f4061cab50802155b9c28c51c4f9`, distributed here under
GPL-3.0-or-later. The complete license is in [COPYING](COPYING). Credit remains
visible in the game footer.

Source correspondence:

- `engine.ts` retains portions of the upstream collision, collection, defeat,
  and stage-lifecycle structure. Its scheduler, deterministic RNG, native
  entrance, 8.8 movement, directional collision masks, principal player
  states, all eight enemy dispatches, projectiles, bubble
  phases/airflow/lifetimes/list cap/support and bounce states, direct trapped
  contact, timed defeated-enemy flight, and pop-score chain have been replaced
  with statically reconstructed DOS behavior. Horizontal enemy shots and fired
  bubbles also use the reconstructed native collision masks, and Invader's
  falling-shot cutoff uses its native coordinate.
- `renderer.ts` and `sprite-assets.ts` still use the pinned upstream sprite
  sheets. The character designs are Taito's; upstream states GPL-3.0-or-later
  but supplies no separate Taito asset permission. No original DOS graphic,
  music, or sound resource is copied.
- `overlay.ts` is Hypercomb's iframe shell, input/focus handling, touch UI,
  score preference, synthesized audio, and living-round hydration. Its canvas
  uses the DOS 320x200 logical framebuffer and a 4:3 displayed aspect.

The remaining inherited pieces are deliberately labelled transitional. Each
decoded archetype now has distinct behavior and the important native constants,
but deeper AI/projectile state branches and some dynamic bubble/contact edge
cases are not yet a cycle-exact translation. Collectible motion/collection
after the native defeat transition, two-player rules, special items and bonus
scoring, audio, and sprites also remain outside exact parity.

## Building and checking

The game uses the existing essentials and application toolchains. It adds no
native dependency and performs no runtime fetch.

From `src/hypercomb-essentials`:

```powershell
node ../node_modules/vitest/vitest.mjs run src/games/bubble --config ../vitest.config.ts --root . --no-cache
```

From `src/hypercomb-dev`:

```powershell
node ../node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit --incremental false
```
