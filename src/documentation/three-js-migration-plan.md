# Three.js migration — strategic plan & feasibility evaluation

> Status: **evaluation / proposal**. Not approved work. Purpose: decide whether a
> move from Pixi.js to three.js makes sense, and if so, whether to do it in-place
> on the current app or as a new web app.

## 1. Why consider this

The trigger is **3D animation**: tiles that lift, tilt, cast depth, transition
through space; a hive that can read as a 3D structure rather than a flat hex
plane; meaning-curved geometry (see the layout-emergent-from-relation vision)
expressed with real depth. Pixi.js 8 is a 2D scene-graph renderer — you can fake
2.5D, but genuine 3D (perspective, lighting, depth-sorted meshes, camera orbit)
is outside what it's built for. three.js is a 3D engine; 2D is a special case of
it (orthographic camera). So the question isn't "is three.js capable" — it's
"what does the migration cost, and is the 3D payoff worth it."

## 2. What 3D actually buys — graduated ambition tiers

The cost and the architecture differ enormously by how far you push 3D. Decide
the **tier** before committing; the plan below is structured so you can stop at
any tier.

- **Tier 1 — Flourishes (2D stays, depth as garnish).** Orthographic camera,
  the hex hive still reads as a plane, but tiles can lift/tilt/parallax on
  hover/select/transition, and swarm/particles get real 3D motion. Interaction,
  navigation, coordinates, hit-testing all unchanged. *This is the cheapest real
  win and the most likely sweet spot.*
- **Tier 2 — 2.5D depth.** Perspective camera, layered depth (history/lineage as
  z-depth, children receding, cards with thickness), subtle camera moves on
  navigation. Coordinate math stays axial/2D; only the render + camera gain a z
  axis. Hit-testing moves from axial-math to raycasting in places.
- **Tier 3 — True 3D spatial hive.** Navigate in 3D space, orbit, meaning-curved
  geometry as actual 3D layout, distance = step-count rendered spatially. This
  changes navigation, input, the coordinate system, and the whole interaction
  model. **This is effectively a new product**, and is the one case that argues
  for a new app rather than an in-place swap.

## 3. Current architecture reality (what helps, what hurts)

**Helps:**
- **State ↔ render is already decoupled.** The processor dispatches the
  `synchronize` window event; render drones (`show-cell.drone.ts` etc.) react by
  rebuilding their mesh. State lives in layers/history/EffectBus, not in the
  scene graph. The render *trigger* model is renderer-independent.
- **One host, one root container.** `pixi-host.worker.ts` owns the
  `Application` + root `Container` and broadcasts `render:host-ready`. Zoom/pan is
  a transform on that container, persisted per-layer as `{scale, cx, cy}` — maps
  cleanly to an orthographic/perspective camera.
- **Module doctrine.** Presentation is a set of signed, externalizable drones in
  `essentials`, not baked into the shell. The shell is explicitly "replaceable;
  load the same modules." The renderer belongs to the modules — so a renderer
  swap is a new *module set*, not a shell rewrite.
- **Atlases are renderer-agnostic** (canvas2D → texture) and port directly to
  `THREE.Texture`/`DataTexture`. Hit-testing is largely **axial math**
  (`axial-service.ts`), not Pixi interaction — so most picking survives.

**Hurts:**
- **No renderer abstraction.** ~30 presentation files import `pixi.js` directly
  and build Pixi scene graphs. `HostReadyPayload` leaks `Application`/`Container`/
  `renderer` to every consumer.
- **Pixi auto-batches sprites; three does not.** Naive 1-mesh-per-tile explodes
  draw calls. Needs `InstancedMesh`/merged geometry — the single biggest perf
  risk.
- **Custom GLSL shaders**: `hex-sdf`, `hex-overlay`, `bee-swarm`, `bee-ab`. Math
  survives; the Pixi Shader/Geometry/Mesh plumbing → `ShaderMaterial` +
  `BufferGeometry`/`InstancedBufferGeometry` is real rewrite work.
- **No built-in text** in three (Pixi has `Text`/`BitmapText`). Use
  `troika-three-text` or keep the existing label atlas on quads.
- **Hard-won correctness behaviors** that are not Pixi APIs and must be
  re-established: host never `display:none` (context loss), nav-lockup atlas/GPU,
  hex dual-scale, label-atlas superimpose, image-stable-once-present,
  render-once-not-streamed, the scissored-clear that worked around the Edge erase
  bug.

## 4. The keystone: a `RenderHost` abstraction (required for either path)

Whatever we decide, **step one is the same and independently valuable**: invert
the dependency so drones stop importing `pixi.js`. Define a renderer-agnostic
`RenderHost` in core (per the "pluggable everything / IoC registry" doctrine):

- `sceneRoot` / camera transform (the zoom/pan target)
- `addQuad` / `addSprite` (textured), with batching handled by the host
- `addInstanced` (swarm, repeated tiles)
- `addShaderMesh` (SDF hex, overlays) with a uniform/attribute contract
- `renderTarget` (atlas wrap / compositing)
- `pick` / `raycast`
- `frame()` loop (replaces Pixi `Ticker`)

`render:host-ready` then carries a `RenderHost`, not Pixi types. Pixi becomes
*one implementation* (`PixiRenderHost`); three becomes another
(`ThreeRenderHost`). This lets both run side-by-side and lets us cut over **one
subsystem at a time** behind an IoC flag — no big-bang rewrite, always shippable.

This phase alone is the bulk of the *safe* work and pays for itself in testability
even if three.js never lands.

## 5. The two paths

### Path A — In-place migration (new presentation modules behind the seam)
Keep the current app, shell, navigation, data, and history. Build
`ThreeRenderHost` + three-backed versions of the presentation drones, swap them
in subsystem by subsystem via IoC. Backward-compatible; users keep their hives.

- **Best for Tier 1 / Tier 2.**
- Pros: no data/UX migration; incremental + reversible; aligns with module
  doctrine; one codebase.
- Cons: must respect every existing invariant and the Pixi-coexistence period;
  carries the current app's accumulated constraints.

### Path B — New web app (greenfield Three shell)
A parallel app that loads the same signed modules but with a Three-native shell,
camera/navigation, and interaction model designed for 3D from scratch.

- **Only justified by Tier 3** (true 3D spatial navigation), where the
  interaction/coordinate model genuinely changes.
- Pros: no legacy constraints; freedom to rethink navigation in 3D.
- Cons: duplicate shells to maintain; data/feature parity catch-up; splits focus;
  most of the renderer work (RenderHost + Three impl) is needed *anyway*.

## 6. Recommendation

1. **Do Phase 0 (RenderHost abstraction) regardless** — it's the right move on
   its own and is the prerequisite for any renderer change.
2. **Target Tier 1 first**, in-place (**Path A**). It delivers the visible 3D
   payoff (tile lift/tilt/transitions, real 3D swarm) at the lowest risk, on real
   user hives, with a working orthographic camera.
3. **Treat "new web app" (Path B) as a Tier-3 decision only** — defer it until a
   Tier-1/2 prototype proves the value and you've decided you actually want full
   3D spatial navigation. Even then, ~70% of the work (RenderHost + ThreeRenderHost
   + ported drones) is shared, so Path B becomes "swap the shell," not "start over."

In short: **abstraction first, three.js behind it, in-place, Tier 1 → evaluate →
decide on deeper 3D.** Don't fork the app on a hunch; fork it (if ever) on
evidence from a working prototype.

## 7. Phased roadmap (each phase shippable)

- **Phase 0 — Abstraction.** Define `RenderHost`; refactor all presentation
  drones to it, still Pixi-backed (`PixiRenderHost`). Zero behavior change.
  *Largest phase; the real investment. Verifiable: pixel-identical to today.*
- **Phase 1 — Three host, off by default.** `ThreeRenderHost` (orthographic),
  grid + tiles only, behind an IoC/feature flag. Prove sprite batching, the
  SDF-hex shader port, and raycast picking. **First "does it make sense" gate.**
- **Phase 2 — Parity.** Port overlays, selection, move-preview, backgrounds,
  screensaver, swarm (InstancedMesh), text (troika or atlas). Re-establish the
  correctness landmines. Reach feature parity with Pixi under the flag.
- **Phase 3 — Tier 1 3D.** Add depth/lift/tilt/transition animations; 3D swarm
  motion. Flip the flag on for dev, dogfood. **Second gate: is the 3D worth it?**
- **Phase 4 — Decision.** Either (a) make Three the default and retire Pixi
  in-place, or (b) if Tier-3 spatial navigation is the goal, branch a Three-native
  shell reusing all of Phases 0–3.

## 8. Risks & sizing

- **High risk:** sprite batching/draw-call budget; custom-shader port; raycast
  interaction; re-solving the GPU correctness bugs. Prototype these in Phase 1
  before committing further.
- **Medium:** text rendering; render-target compositing; WebGL-vs-WebGPU choice
  (staying WebGL keeps GLSL portable; three's WebGPU/TSL path would mean
  rewriting shaders in TSL).
- **Effort shape:** Phase 0 is the big one (touches ~30 files but mechanically).
  Phases 1–2 are the deep technical risk. Phase 3 is where the fun/payoff is and
  is comparatively small once parity exists.
- **Build/packaging:** drop the `pixi.js` dep and the web `runtime` pixi-bundling
  step; add three.js (+ troika) to the module bundle; adjust tsup/esbuild
  externals. `hypercomb-legacy/` Pixi usage is dead and out of scope.

## 9. Open decisions for the user

- **Which 3D tier** is the actual goal (1 / 2 / 3)? This sets everything.
- **WebGL or WebGPU** target.
- Appetite for the Phase 0 abstraction investment *before* any visible 3D.
