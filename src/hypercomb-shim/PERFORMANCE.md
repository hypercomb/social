# The minimal host's performance record

One row per change that could move loading or running. Newest last. The
porting gate (`AGENTS.md`, `scripts/bench-minimal-host.mjs`) says a port must
not make the minimal host worse; this file is where the trend stays visible.

**How the numbers are taken.** Warm boots in headless Chromium, the same
package (`dfdf6eca9eab` unless noted) served to both sides from local
origins, profiles alternating so drift hits both. Medians. Two warm boots of
the *same* build differ by about 35–42 ms (first frame and bees), so a delta
inside ±40 ms is noise, not a change.

- **first frame** — the first `render:cell-count`.
- **tiles on screen** — the first settled pass that draws every seeded tile
  (from 2026-09-27; before that the hives were empty, so "first frame" was
  boot overhead only).
- **bees** — `loader:bees-done`, every bee of the package loaded.

**The sandbox renders on the CPU.** From 2026-09-27 the gate runs with the
hive actually drawn, and in a headless sandbox that means SwiftShader, a
software GPU: every frame is rasterized on the CPU, so absolute times there
are several times a real machine's. The two hosts share the handicap, so the
comparison holds; the absolute numbers do not transfer.

## Against the Angular build (the gate)

| date | package | hive | first frame | tiles on screen | bees | boot blocking | drag p95 / janky | heap | CPU |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-26 | `dfdf6eca9eab` | empty | 587 vs 1184 ms | — | 1377 vs 2022 ms | 73 vs 164 ms | 16.7 vs 66.7 ms / 0 vs 9.5 % | 37 vs 59 MB | 1× |
| 2026-09-26 | `dfdf6eca9eab` | empty | 1594 vs 3349 ms | — | — | — | — / 0 vs 12.9 % | — | 4× |
| 2026-09-27 | `dfdf6eca9eab` | 7 tiles | 479 vs 827 ms | 1513 vs 2220 ms | 1044 vs 1466 ms | 0 vs 68 ms | 17 vs 17 ms / 0 vs 0.1 % | 56 vs 73 MB | 1× — invalid: 7 of 8 boots on each side lost the GPU context (the atlas below) |
| 2026-09-27 | `310e976a049b` | 7 tiles, drawn in software | 3978 vs 6392 ms | 3993 vs 6392 ms | 3318 vs 5162 ms | 2576 vs 3888 ms | 50 vs 50 ms / 3.8 vs 5.3 % | 84 vs 102 MB | 1× — PASS, every boot drew every tile |
| 2026-09-27 | `310e976a049b` | 7 tiles, drawn in software | 8160 vs 13845 ms | 8160 vs 13845 ms | 6284 vs 11543 ms | 3868 vs 5630 ms | 67 vs 67 ms / 33 vs 39 % | 84 vs 93 MB | 4× — PASS; idle blocking 415 vs 1013 ms / 10 s |
| 2026-09-27 | `427ca7b83744` | 7 tiles, drawn in software | 3880 vs 5519 ms | 3891 vs 5519 ms | 3350 vs 4550 ms | 1330 vs 2217 ms | 33 vs 33 ms / 0.3 vs 0.5 % | 87 vs 104 MB | 1× — PASS; idle blocking 0 vs 53 ms / 10 s. A run taken while test suites shared the machine read 4668 vs 6543 ms: gate on a quiet machine |

Minimal first, Angular second.

## Change by change (against the build before it)

| date | change | first frame | bees | other | verdict |
|---|---|---|---|---|---|
| 2026-09-26 | a blocked service worker no longer hangs boot | — | — | worker ready +4 ms, import map +36 ms | same |
| 2026-09-26 | no reload per session | — | — | import map +35 ms; blocked-worker boot 1 navigation instead of 2 (3 s faster) | same warm, faster blocked |
| 2026-09-26 | starts offline, no `env.js` error | 654 vs 645 ms | 1805 vs 1813 ms | | same |
| 2026-09-27 | first install 2.4–3.2 s (was 6.8–7.8 s) | ±35 ms | ±42 ms | cold install −4.5 s | faster install, same warm |
| 2026-09-27 | the `lineage` spot (tiles in the pure host) | 557 vs 554 ms | 1316 vs 1326 ms | console 159 vs 150 ms | same |
| 2026-09-27 | the `tiles` spot (renderers placed, one flavour per class) | +16 / −44 / +17 ms | +8 / −60 / +33 ms | first try was +22 to +85 ms, fixed before commit | same |
| 2026-09-27 | image atlas without multisampling (package `310e976a049b`) | — | — | GPU memory −1 GiB (an 8192² 4-sample buffer); in the sandbox, boots that draw every tile went from 1 of 8 to 8 of 8; pictures identical inside, only the 1-px border of a letterboxed picture is crisp instead of half-blended | better |
| 2026-09-27 | show-cell cleaned (package `427ca7b83744`): 332 dead lines gone, a render lock no longer released early, five timers and two listeners no longer outlive the drone | 3880 ms | 3350 ms | tiles on screen 3891 ms (was 3993 ms for `310e976a049b` in an earlier session, not an A/B in one run) | same or better |

Adding a row: run the gate (and `--rate 4` when boot or rendering moved),
then add the change's line here in the same commit.
