# Tile Render Performance

Speed is the currency of Hypercomb. This document is the living ledger of tile-rendering
performance: what the engine already does right (don't regress it), what should be fixed
(ranked by expected impact), and a parking lot of overkill ideas kept for future
configurations. Findings dated 2026-07-28 from a full audit of
`hypercomb-essentials/src/diamondcoreprocessor.com/presentation/`.

Related docs: `optimize-phase.md` (derived-cache doctrine), `streamline-audit-2026-07.md`,
`mobile-usable-first-plan.md`.

---

## Architecture baseline — already optimal, do not regress

The tile grid is **not** a per-tile scene graph. All tiles render as one instanced-quad
`Mesh` with a single SDF shader sampling a label atlas and an image atlas
(`tiles/show-cell.drone.ts:4106`, `grid/hex-sdf.shader.ts`). Per-tile display-object
count is effectively zero.

| What | Where | Why it's right |
|---|---|---|
| Single Mesh + shared Geometry/Shader for the whole grid | `show-cell.drone.ts:8621` | One draw call for all tiles; off-screen tiles cost vertex invocations only |
| `app.stage.interactiveChildren = false` + arithmetic hit-testing (`pixelToAxial` → Map lookup) | `pixi-host.worker.ts:241`, `tile-overlay.drone.ts:1948` | O(1) per pointermove, no tree traversal |
| Zero Pixi filters; masks only static (3 sites) | all of `presentation/` | No fullscreen passes |
| Attribute-only updates via `#pushBuffer` (hover, heat, shade, label reveal) instead of geometry rebuilds | `show-cell.drone.ts:8683-8834` | No re-triangulation on visual state flips |
| Layered render coalescing: microtask collapse, `#activeRenderTarget` dedupe, cells-key early-return, sync back-nav fast path | `show-cell.drone.ts:1790, 2330, 2355, 2443, 4038` | One pass per burst of `synchronize` events |
| Label SDF atlas: per-label bake cache, 256 slots (64 caused rebake thrash — documented), `fwidth` AA crisp at any zoom | `hex-label.atlas.ts:263`, `show-cell.drone.ts:2402-2408` | Labels never re-rasterize per frame |
| Image pipeline: manifest pack → ≤512px optimized webp → raw fallback with `visual:wanted` demand | `show-cell.drone.ts:7762`, `visual-optimizer.drone.ts` | Warm path decodes cell-sized bytes, not camera originals |
| Atlas ring allocator: pinning, eviction generations, scissored per-slot clear, in-flight dedup, failure TTL | `hex-image.atlas.ts:29-52` | Bounded at 256 slots, no repacking needed |
| Avatar swarm tick: early-return when empty, pre-allocated typed arrays, dirty-flagged `buffer.update()` | `avatar-swarm.drone.ts:383-465` | The model the other tickers should copy |
| Wave-view texture cache: bounded LRU with `destroy(true)` on evict; `#packVisuals` capped at 2048 | `wave-view.drone.ts:457`, `show-cell.drone.ts:7790` | The cache pattern to copy |
| Self-terminating RAF loops (substrate fade, new-cell fade, portal shimmer, move preview) | `show-cell.drone.ts:4518-5933` | Nothing animates past its end |
| Canvas-renderer fallback detected and hard-stopped rather than grinding | `pixi-host.worker.ts:219-238` | |

---

## Ranked fixes — do these

### 1. Render on demand, not 60 fps forever (headline)
`app.init()` in `pixi-host.worker.ts:192-204` never sets `autoStart: false`; there is no
`ticker.stop()`, `maxFPS`, or dirty-flag render anywhere. The full fragment-heavy hex SDF
shader re-renders the whole stage 60×/s at DPR resolution **while completely idle**.
Fix: `autoStart: false` + an `invalidate()` that calls `app.render()` once (or starts the
ticker for the duration of an animation). Animation owners are already isolated
(tile-overlay anim tick, tile-selection 30 fps loop, avatars, screensaver, launcher
drift), so gating is tractable. Alternative cheap first step: `ticker.maxFPS` throttle
when no animation owner is active. Biggest steady-state battery/thermal win available.

### 2. Image atlas render target: drop MSAA and halve resolution
`hex-image.atlas.ts:69-75` creates the atlas `RenderTexture` with `antialias: true` and
`resolution: 2`, giving an 8192×8192 physical target ≈ **268 MB** GPU (label atlas adds
~67 MB).
- `antialias: true` buys nothing — the only thing ever drawn in is an axis-aligned Sprite
  rect — but allocates a full-size multisample renderbuffer and forces an MSAA resolve
  blit on **every `loadImage`** (likely the direct cause of the `SLOW loadImage` warning
  the file logs at `:297`). Remove it.
- `resolution: 2 → 1`: cells are only ever filled with ≤512 px source (`targetMax` at
  `:216`), so the extra density is empty precision. 268 MB → 67 MB, and 8192 currently
  exceeds `MAX_TEXTURE_SIZE` (4096) on older mobile GPUs — a hard correctness risk, not
  just a perf one.

### 3. Atlas destroy() — plug the context-restore leak
Neither `HexImageAtlas` nor `HexLabelAtlas` has a `destroy()`. Renderer swap /
context-restore (`show-cell.drone.ts:2409-2413, 2425-2429, 6014-6021`) assigns fresh
instances over the old ones, leaking ~335 MB of GPU render targets each time.
`HexLabelAtlas` also leaks `#sdfCanvas`/`#sdfTexture`. Add `destroy()` to both and call
before reassignment. (The two byte-identical atlas-construction branches at
`show-cell.drone.ts:2402-2433` should be deduped in the same pass so the sizing fix
lands once.)

### 4. Mipmaps on the image atlas (+ cell gutter)
Neither atlas enables mipmaps; the shader samples with implicit-LOD `texture()`
(`hex-sdf.shader.ts:446`). Zoomed out, 512 texel cells minify 4-10× through plain
bilinear → shimmer/crawl on pan. `hex-icon-button.ts:71-79` already diagnoses and fixes
exactly this for icons via `autoGenerateMipmaps = true` — the fix was never applied to
the tile atlas. Caveat: a packed atlas with zero inter-cell padding
(`hex-image.atlas.ts:287-290`) bleeds neighbouring cells at high LOD, so this needs a
gutter (~8 px per cell) or an LOD cap in the shader. Do after #2 and re-measure —
dropping MSAA/resolution changes the minification profile. Labels are unaffected (SDF).

### 5. Kill the dead overlay animation tick
`tile-overlay.drone.ts:1020-1030` adds a ticker handler at init that accumulates time and
calls `#hexBg.setTime(...)` every frame — but `HexOverlayMesh.setTime` is a stub and
`mesh` is an empty Container (`hex-overlay.shader.ts:16`). Pure per-frame overhead unless
arrange/icon-edit mode is on. Add/remove the handler with those modes.

### 6. Selection overlay: stop retessellating static geometry
`tile-selection.drone.ts:489-605` runs at 30 fps while anything is selected doing full
`Graphics.clear()` + retessellation (poly/fill/stroke ×3 + 6 circles per tile) — but only
two stroke alphas actually animate. Build geometry once per selection change, tween
`alpha` on display objects. Same pass: `:505-522` linearly scans the **entire occupied
map per selected label per frame** (O(selected × tiles)) — keep a label→axial reverse
map; and `selectedLabels`/`leader` allocate per frame.

### 7. Renderer creation options
`pixi-host.worker.ts:192-204`:
- `antialias: true` on the main framebuffer is largely redundant — every edge is already
  analytically AA'd in the SDF shader. At DPR 2 MSAA multiplies fragment cost on exactly
  the integrated-GPU profile the codebase already flags as the pain point. Try dropping
  it and eyeball non-SDF elements (Graphics overlays).
- `powerPreference: 'high-performance'` unset — dual-GPU laptops may bind the iGPU.
- `resolution: devicePixelRatio` uncapped — a 3× phone pays 9× fragments; cap at
  `Math.min(devicePixelRatio, 2)`.
- `preference` (webgl/webgpu) unset — the label atlas has a raw `gl.scissor` fast path
  with a WebGPU fallback (`hex-label.atlas.ts:191-208`); autodetect risks silently taking
  the less-tested branch. Pin explicitly.

### 8. Agent-bee dance tick
`agent-bee.drone.ts:279-378`: free when idle (early-return), but per bee per frame it
does a registry lookup, two `waggleOffset()` allocations, and `#drawWaggleAreas` clears +
rebuilds a Graphics path. Same fix shape as #6.

### 9. `buildCellsKey` as string concatenation
`show-cell.drone.ts:8422-8455`: the change detector builds a multi-KB string (`+=` over
every cell × 11 fields, plus a `hasImage()` and `referenceTargetForLabel()` call each) on
every pass, readiness flip, and back-nav. Replace with a rolling numeric hash/bitfield.

### 10. Small ones (batch when touching the files anyway)
- `createImageBitmap(blob)` with no options (`hex-image.atlas.ts:215`): pass
  `{ premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' }` — skips ICC
  transform on multi-MP camera JPEGs. Do NOT reintroduce `resizeQuality` (documented
  regression at `:206-214`).
- Full-res decodes off the atlas path: `move-preview.drone.ts:515`,
  `screensaver.drone.ts:398`, `wave-view.drone.ts:455`, `agent-avatar.ts:224` all decode
  originals at icon/bubble display size — route through the optimized-visual read.
- `agent-avatar.ts:139-141`: unbounded texture cache, never destroyed — copy the
  wave-view LRU pattern.
- Hover hint (`tile-overlay.drone.ts:2072-2122`): `getComputedStyle` per hover + `Text`
  at `resolution = max(6, dpr*4)` — an 8× rasterize + upload per hover for a tooltip;
  resolution 2-3 is indistinguishable.
- `sdf-glyph.ts:75-78`: `getComputedStyle(document.documentElement)` on **every** label
  bake (forced style recalc × N labels on first paint) — memoize the `--hc-font` read.
- `grid-lines.drone.ts:79-113`: pattern canvas + texture rebuilt on every `canvas:lines`
  effect with no `(kind, accent, alpha)` equality check — memoize.
- `pixi-host.worker.ts:306, 420`: two permanent `setInterval`s with no `document.hidden`
  gate — pause polling in hidden tabs.
- Scratch `Point` for the ~11 `new Point(...)` → `toLocal` sites in
  `tile-overlay.drone.ts` (pointermove/drag paths).
- `#pushBuffer` (`show-cell.drone.ts:8683`) calls `buffer.update()` with no byte length —
  single-cell changes re-upload the whole attribute array. Fine at ~100 tiles; pass a
  sub-range before grids get large.
- The atlas path never consults the 96 px `thumbnails:hex` derived pool
  (`tiles/thumbnails.ts:31`) — only `tree-icons.ts` does. For heavily zoomed-out views a
  thumbnail beats even the 512 px optimized visual.

### Flags (correct today, watch)
- `background.drone.ts:66` and `grid-lines.drone.ts:98` create 200000×200000 objects to
  cover the pan range — correct, but they defeat bounds culling and give the
  TilingSprite an enormous UV range; a screen-sized sprite parented outside the world
  container would be cheaper.
- Any structural cells-key change destroys and rebuilds the entire Geometry (16 fresh
  Float32Arrays, `show-cell.drone.ts:4138`, `:8474`). Many things fold into the key
  (atlas eviction generations, per-cell image resolvability, shade bits), so one
  late-arriving image forces a whole-grid rebuild. Acceptable now; candidate for
  per-attribute patching if grids grow.
- `hex-image.atlas.ts:20` `#failures` map grows per distinct failing sig, never GC'd.

---

## Overkill parking lot — not planned, kept for future configs

Ideas that exceed current needs but are architecturally possible. None should be built
without a measured need; listed so future custom configurations (huge hives, low-end
hardware tiers, kiosk/embedded builds) can shop here.

- **OffscreenCanvas + worker renderer.** `pixi-host.worker.ts` is named for it; moving
  the whole Pixi app off the main thread would isolate render cost from Angular/DOM work.
  Big migration (all DOM-coupled code — hit-testing bridge, getComputedStyle reads,
  tooltips — needs a message protocol).
- **KTX2/Basis supercompressed textures.** Transcode tile images once into
  GPU-native compressed formats (ASTC/BC7) stored as a derived pool — 4-8× VRAM
  reduction and mipmaps come free. Needs a transcoder wasm and a
  `sign('visual-compressed:…')` pool; only worth it for thousand-tile hives on mobile.
- **Virtual/sparse atlas paging.** Replace the fixed 256-slot ring with a
  clipmap/megatexture scheme where only the visible LOD ring is resident. Massive
  complexity; only relevant far beyond current hive sizes.
- **GPU-driven visibility.** Compute-shader frustum culling of tile instances (WebGPU
  only). The single-mesh design already makes CPU culling unnecessary; this would only
  matter at 100k+ tiles.
- **Predictive pre-bake by pan velocity.** Feed camera velocity into the proximity
  registry to pre-bake atlas cells in the direction of travel a few hundred ms early.
  The readiness-shade + preload stack already covers most of this perceptually.
- **Tile impostor pyramid.** At extreme zoom-out, swap the per-tile atlas sampling for a
  single pre-baked "hive snapshot" texture of the whole layer (minted in the optimize
  phase, keyed by layer sig — passes the cold-rebuild litmus). Render becomes one
  textured quad. Pairs with the existing hive-snapshot primitive.
- **Shader LOD switch.** Below a screen-px threshold, branch the SDF shader to a flat
  fill + label-only path (skip image sampling entirely). Cheap to prototype; visual
  design question more than an engineering one.
- **`content-visibility` / DOM containment audit for shell chrome.** Not tile rendering
  proper, but panels repainting over the canvas can force compositor work; auditing
  layer promotion of the Angular chrome could shave main-thread jank.
- **Adaptive quality governor.** Sample `ticker.deltaMS` percentiles at runtime; when a
  device sustains jank, automatically step down (cap DPR → drop main-FB antialias →
  reduce atlas resolution → throttle idle FPS). Inverse also true on strong hardware.
  This is the "custom configurations" hook: expose the ladder as settings the
  preferences drone owns.
- **Half-float atlas + shared exponent.** RGBA4/565 for the image atlas would halve VRAM
  again below fix #2, at visible banding cost — only for a low-memory device tier.

---

## Measurement discipline

Per `feedback_verify_perf_changes_on_real_data`: verify on real hive data, not synthetic
grids. For each fix above, capture before/after on the dev hive (Edge, port 4250):
GPU memory (about:gpu / `renderer.texture.managedTextures`), frame time under pan at
DPR 2, and `loadImage` timing (the atlas already logs slow loads at
`hex-image.atlas.ts:297`). Never wipe OPFS to test — use signature comparison.
