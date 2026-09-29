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
| 2026-09-28 | `ee559ce9d6e6` | 7 tiles, drawn in software | 4180 vs 5807 ms | 4180 vs 5807 ms | 3458 vs 4790 ms | 1746 vs 2525 ms | 33 vs 50 ms / 0.8 vs 1.2 % | 86 vs 115 MB | 1× — PASS. A few seconds of spec runs overlapped it; both sides read ~290 ms above the quiet run before, ratio held (0.72 vs 0.70) |
| 2026-09-28 | `ee559ce9d6e6` | 7 tiles, drawn in software | 8038 vs 13800 ms | 8310 vs 13800 ms | 6479 vs 12091 ms | 3185 vs 5351 ms | 67 vs 67 ms / 13 vs 18 % | 83 vs 92 MB | 4× — PASS; idle blocking 51 vs 419 ms / 10 s |
| 2026-09-28 | `4259fd754f88` | 7 tiles, drawn in software | 4129 vs 5461 ms | 4129 vs 5461 ms | 3438 vs 4646 ms | 1385 vs 2355 ms | 33 vs 33 ms / 0.6 vs 0.4 % | 90 vs 98 MB | 1× — PASS |
| 2026-09-28 | `4259fd754f88` | 7 tiles, drawn in software | 8615 vs 14124 ms | 8615 vs 14124 ms | 6579 vs 11692 ms | 3449 vs 5134 ms | 67 vs 67 ms / 16 vs 17 % | 83 vs 100 MB | 4× — PASS; idle blocking 222 vs 471 ms / 10 s |
| 2026-09-28 | `33c8d74e7636` | 7 tiles, drawn in software | 4012 vs 5232 ms | 4012 vs 5232 ms | 3316 vs 4412 ms | 1110 vs 1790 ms | 33 vs 33 ms / 0.2 vs 0.7 % | 84 vs 93 MB | 1× — PASS; idle blocking 0 vs 52 ms / 10 s |
| 2026-09-28 | `33c8d74e7636` | 7 tiles, drawn in software | 8632 vs 14523 ms | 8632 vs 14523 ms | 6729 vs 12079 ms | 3547 vs 5226 ms | 50 vs 67 ms / 12 vs 24 % | 84 vs 88 MB | 4× — PASS; idle blocking 151 vs 725 ms / 10 s |
| 2026-09-28 | `7057f32c350d` | 7 tiles, drawn in software | 4168 vs 6056 ms | 4168 vs 6056 ms | 3640 vs 4981 ms | 1428 vs 2438 ms | 50 vs 33 ms / 1.7 vs 0.7 % | 93 vs 90 MB | 1× — PASS; idle blocking 0 vs 0 ms / 10 s |
| 2026-09-28 | `7057f32c350d` | 7 tiles, drawn in software | 8392 vs 14254 ms | 8392 vs 14359 ms | 6738 vs 11975 ms | 3419 vs 4952 ms | 67 vs 67 ms / 15 vs 21 % | 77 vs 94 MB | 4× — PASS; idle blocking 62 vs 280 ms / 10 s |
| 2026-09-28 | `23711e50169d` | 7 tiles, drawn in software | 4333 vs 5511 ms | 4333 vs 5586 ms | 3585 vs 4693 ms | 1712 vs 2298 ms | 33 vs 50 ms / 0.3 vs 0.9 % | 82 vs 113 MB | 1× — PASS; idle blocking 0 vs 0 ms / 10 s |
| 2026-09-28 | `23711e50169d` | 7 tiles, drawn in software | 8717 vs 14534 ms | 8717 vs 14534 ms | 6984 vs 11759 ms | 3402 vs 5249 ms | 67 vs 67 ms / 15 vs 20 % | 75 vs 90 MB | 4× — PASS; idle blocking 158 vs 259 ms / 10 s |
| 2026-09-28 | `0f3f26e7669a` | 7 tiles, drawn in software | 4630 vs 6140 ms | 4630 vs 6140 ms | 3866 vs 4956 ms | 1709 vs 2749 ms | 50 vs 50 ms / 1.7 vs 2.5 % | 86 vs 93 MB | 1× — PASS; idle blocking 0 vs 50 ms / 10 s |
| 2026-09-28 | `0f3f26e7669a` | 7 tiles, drawn in software | 9676 vs 15987 ms | 9676 vs 15987 ms | 7501 vs 13712 ms | 4117 vs 6349 ms | 67 vs 67 ms / 30 vs 33 % | 85 vs 100 MB | 4× — PASS; idle blocking 675 vs 1046 ms / 10 s |
| 2026-09-28 | `76740098ae8e` | 7 tiles, drawn in software | 4220 vs 6383 ms | 4220 vs 6383 ms | 3531 vs 5222 ms | 1655 vs 2659 ms | 50 vs 50 ms / 1.1 vs 1.2 % | 77 vs 78 MB | 1× — PASS; idle blocking 0 vs 0 ms / 10 s |
| 2026-09-28 | `76740098ae8e` | 7 tiles, drawn in software | 9363 vs 15807 ms | 9363 vs 15807 ms | 7502 vs 13464 ms | 3926 vs 5942 ms | 67 vs 67 ms / 23 vs 30 % | 85 vs 107 MB | 4× — PASS; idle blocking 527 vs 579 ms / 10 s |
| 2026-09-29 | `9acdffd2297f` | 7 tiles, drawn in software | 4034 vs 5528 ms | 4034 vs 5593 ms | 3414 vs 4664 ms | 1154 vs 2193 ms | 33 vs 33 ms / 0.3 vs 0.5 % | 87 vs 104 MB | 1× — PASS; idle blocking 0 vs 55 ms / 10 s |
| 2026-09-29 | `9acdffd2297f` | 7 tiles, drawn in software | 8504 vs 14228 ms | 8504 vs 14228 ms | 6782 vs 12004 ms | 3199 vs 5081 ms | 67 vs 67 ms / 19 vs 23 % | 78 vs 93 MB | 4× — PASS; idle blocking 205 vs 551 ms / 10 s |

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
| 2026-09-28 | the tool-window base layer in core (package `ee559ce9d6e6`): six framework-free windows on one chrome, one stylesheet, one edge reservation in `DockedPanel`; the seed hosts a build setting | 4180 ms (1×), 8038 ms (4×) | 3458 ms (1×), 6479 ms (4×) | 1× tiles on screen +289 ms against the cleanup's quiet run, Angular +288 ms in the same run: machine drift, not the change. 4× tiles 8310 ms (was 8160 ms for `310e976a049b`); idle blocking 51 vs 415 ms before | same |
| 2026-09-28 | show-cell's first branches drawn out (package `4259fd754f88`): narrowing, membership (+ packed visuals), order, mesh — modules beside the drone, composed through host interfaces | 4129 ms (1×), 8615 ms (4×) | 3438 ms (1×), 6579 ms (4×) | 1× tiles −51 ms against `ee559ce9d6e6`; 4× +305 ms with Angular +324 ms in the same run (machine drift, ratio 0.61 vs 0.60) | same |
| 2026-09-28 | readiness, faces and fill geometry drawn out of show-cell (package `33c8d74e7636`) | 4012 ms (1×), 8632 ms (4×) | 3316 ms (1×), 6729 ms (4×) | 1× tiles −117 ms against `4259fd754f88`, boot blocking −275 ms; 4× +17 ms (Angular +399 ms in the same run) | same or better |
| 2026-09-28 | dive and previews drawn out of show-cell (package `7057f32c350d`) | 4168 ms (1×), 8392 ms (4×) | 3640 ms (1×), 6738 ms (4×) | 1× tiles +156 ms against `33c8d74e7636`, with Angular +824 ms in the same run (machine drift); 4× −240 ms, idle blocking 62 vs 151 ms before | same |
| 2026-09-28 | quiet landing and hover drawn out of show-cell (package `23711e50169d`) | 4333 ms (1×), 8717 ms (4×) | 3585 ms (1×), 6984 ms (4×) | 1× tiles +165 ms against `7057f32c350d` while Angular went −470 ms in the same run, but drag p95 33 ms (was 50) and janky frames 0.3 % (was 1.7); 4× +325 ms with idle blocking 158 ms (was 62) — within the gate's noise band, and neither branch touches boot | same |
| 2026-09-28 | a dive's names drawn by the DOM name layer, after the merge of `development` (package `0f3f26e7669a`) | 4630 ms (1×), 9676 ms (4×) | 3866 ms (1×), 7501 ms (4×) | 1× tiles +297 ms against `23711e50169d` with Angular +554 ms in the same run; 4× +959 ms with Angular +1453 ms (machine drift, ratio 0.61 vs 0.60). The Angular host was rebuilt for the merged core | same |
| 2026-09-28 | quiet landing holds a same-page add or remove too (package `76740098ae8e`) | 4220 ms (1×), 9363 ms (4×) | 3531 ms (1×), 7502 ms (4×) | 1× tiles −410 ms against `0f3f26e7669a` (Angular +243 ms in the same run); 4× −313 ms (Angular −180 ms). Only a held landing's add takes the full path; the participant's own adds stay incremental | same or better |
| 2026-09-29 | the badge tap paints at once, even mid-aftershock (package `9acdffd2297f`) | 4034 ms (1×), 8504 ms (4×) | 3414 ms (1×), 6782 ms (4×) | 1× tiles −186 ms against `76740098ae8e` (Angular −790 ms in the same run); 4× −859 ms (Angular −1579 ms): machine drift, the change touches only the tap | same |

Adding a row: run the gate (and `--rate 4` when boot or rendering moved),
then add the change's line here in the same commit.
