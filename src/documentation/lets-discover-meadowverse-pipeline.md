# Let's Discover: The Authoring-Runtime Pipeline

> hypercomb.io builds. meadowverse.ca runs. the signature is the bridge.

---

## the two meadows

a honeybee colony doesn't build comb in the field. it builds inside the hive — dark, controlled, structured — and the results of that work radiate outward into the world. the flowers don't know how the hive is organized. they just receive the pollinator.

hypercomb has two environments, and they mirror this separation:

**hypercomb.io** is the hive. Angular, Pixi.js, the hex grid, the Diamond Core Processor, the cell hierarchy. this is where you author bees, compile TypeScript in the browser, sign payloads, organize layers, navigate the comb. it is structured, opinionated, full of tooling. it is where you *build*.

**meadowverse.ca** is the meadow. vanilla JavaScript, Three.js, a single `<canvas>`. no Angular, no hex grid, no editor chrome. just a runtime surface where signed bees arrive, pulse, and render into a 3D scene. it is where things *run*.

the breakthrough is that these two environments share the same core — `@hypercomb/core` — and the same content-addressing system. a bee built in the hive can fly to the meadow without modification. the signature is its passport.

---

## why this separation matters

today, if you want to build a 3D experience, you build the whole thing at once. the editor, the renderer, the asset pipeline, the debugging tools — they're all one monolith. you can't test a single piece in isolation without loading the entire application.

the hypercomb architecture already solved this problem for 2D. bees are self-contained. they declare their own dependencies, their own grammar, their own effects. `ScriptPreloader` discovers them from the install manifest. `hypercomb.act()` pulses them. they don't know or care what application hosts them.

extend this to 3D and something remarkable happens: you can build a single scene element — a particle system, a terrain shader, a character controller — as one bee, install it on meadowverse, and pulse it in total isolation. no scene graph to untangle. no framework to boot. just your bee, a canvas, and Three.js.

build it. sign it. run it. debug it. iterate. when it works, compose it with other bees. piece by piece, the 3D experience assembles itself — not as a monolith deployed all at once, but as a colony of behaviors that each earned their place through isolated verification.

---

## the bridge already exists

the infrastructure connecting these two environments is not hypothetical. it is built:

| component | what it does | where it lives |
|-----------|-------------|----------------|
| `SignatureService` | SHA-256 content addressing — every artifact identified by its bytes | `@hypercomb/core` |
| `LayerInstaller` | downloads + verifies + writes artifacts to OPFS | `hypercomb-shared/core/layer-installer.ts` |
| `ScriptPreloader` | discovers bees from install manifest, verifies signatures, loads from OPFS | `hypercomb-shared/core/script-preloader.ts` |
| `DependencyLoader` | resolves namespace dependencies via import map | `hypercomb-shared/core/dependency-loader.ts` |
| `resolveImportMap()` | scans OPFS `__dependencies__/` for aliases, builds dynamic import map | `hypercomb-shared` |
| service worker | intercepts `/opfs/` requests, serves from OPFS with correct MIME types | per-app `public/` |
| `install.manifest.json` | lists all bees, deps, layers by signature + `beeDeps` for lazy loading | build output |
| `EffectBus` | pub/sub with last-value replay — bees coordinate without coupling | `@hypercomb/core` |

none of these depend on Angular. none depend on Pixi.js. they are platform-agnostic plumbing. meadowverse would use the exact same `LayerInstaller`, the same `ScriptPreloader`, the same signature verification pipeline. the only difference is what sits on top: Three.js instead of Pixi.js.

---

## what a 3D bee looks like

a bee that renders into Three.js is structurally identical to one that renders into Pixi.js. the lifecycle is the same. the difference is the platform external it imports.

```typescript
import { Drone } from '@hypercomb/core'
import * as THREE from 'three'

export class ParticleFieldDrone extends Drone {
  readonly namespace = 'meadowverse.ca'
  readonly description = 'a field of particles that drift and swirl'

  #scene: THREE.Scene | undefined
  #particles: THREE.Points | undefined

  protected override sense = (_grammar: string): boolean => {
    return true // always active — this is a background element
  }

  protected override heartbeat = async (_grammar: string): Promise<void> => {
    if (!this.#scene) {
      this.#scene = this.resolve<THREE.Scene>('scene')
      if (!this.#scene) return

      const geometry = new THREE.BufferGeometry()
      // ... particle setup
      this.#particles = new THREE.Points(geometry, material)
      this.#scene.add(this.#particles)
    }

    // animate
    if (this.#particles) {
      this.#particles.rotation.y += 0.001
    }
  }

  deps = {
    scene: 'meadowverse:scene'
  }
}
```

the bee resolves `meadowverse:scene` from IoC — the shared Three.js scene that meadowverse provides as infrastructure. it doesn't create the renderer, doesn't manage the canvas, doesn't handle the animation loop. it just adds its contribution to the scene and updates it on each pulse.

this is the same pattern hypercomb-web uses. `PixiHostWorker` owns the Pixi.js application and registers it in IoC. rendering drones resolve the stage and add their sprites. meadowverse would have a `ThreeHostWorker` that owns the renderer, camera, and scene, registering them as IoC services. 3D bees resolve what they need and contribute their geometry.

---

## incremental execution: run a little piece

this is where the idea becomes extraordinary.

in a traditional 3D engine, you can't run "just the particle system." the particle system depends on the renderer, which depends on the window, which depends on the scene, which depends on the asset loader, which depends on... everything. testing one piece means booting the world.

in meadowverse, the processor doesn't know or care how many bees exist. `hypercomb.act(grammar)` broadcasts to whoever is listening. if only one bee is installed — your particle field — only that bee pulses. the scene has one element. the canvas shows one thing. you can see it, debug it, profile it, iterate on it.

```
meadowverse.ca/?content={particleFieldSig}
```

that URL tells `ensureInstall()` to fetch exactly one manifest — the one containing your particle field bee and its dependencies. `LayerInstaller` downloads it. `ScriptPreloader` loads it. `hypercomb.act()` pulses it. one bee. one canvas. one thing to debug.

now add a second bee — a terrain. new signature, new manifest (or an updated one that includes both). refresh. two bees pulse. the particle field drifts above the terrain. you didn't write integration code. they both resolved `meadowverse:scene` from IoC and added their geometry independently.

this is composition without coupling. each bee is debugged in isolation, then composed by co-installing them. the install manifest is the composition document — it lists which bees are present, and the processor pulses all of them.

---

## the debug loop

here's the workflow, step by step:

```
1. AUTHOR    hypercomb.io → Diamond Core Processor
             write TypeScript bee, target Three.js
             esbuild-wasm compiles in browser → BeePayloadV1
             sign payload → SHA-256 signature

2. PUBLISH   signed bytes → OPFS on hypercomb.io (postMessage from DCP iframe)
             or: build via CLI → install.manifest.json → Azure blob / local

3. INSTALL   meadowverse.ca loads
             ensureInstall() fetches manifest by signature
             LayerInstaller downloads bee + deps → OPFS
             signature verified at every step

4. RESOLVE   resolveImportMap() scans __dependencies__/
             injects <script type="importmap">
             Three.js mapped to /vendor/three.runtime.js

5. PULSE     hypercomb.act() → ScriptPreloader.find()
             bee loaded from OPFS, instantiated, registered in IoC
             bee.pulse() → sense() → heartbeat()
             bee resolves scene from IoC, adds geometry

6. SEE       Three.js renders the scene to <canvas>
             one bee = one visual element
             inspect, profile, adjust

7. ITERATE   change the bee in DCP → new signature → repeat from step 2
             old signature is old content. new signature is new content.
             no cache invalidation. no version bumps. just new bytes, new hash.
```

the key insight at step 7: because identity is content-addressed, there is no "update" operation. there is only "install different content." the old bee and the new bee are different signatures. there is no confusion about which version is running. if the bytes are different, the signature is different. if the signature matches, the bytes are verified. the system is append-only in its identity model.

---

## platform externals

hypercomb-web has two platform externals: `@hypercomb/core` and `pixi.js`. these are vendored in `public/` as runtime bundles and mapped via the import map. essentials modules declare them as `external` during esbuild compilation — they're resolved at runtime, not bundled in.

meadowverse would have the same pattern with different externals:

| external | vendored as | purpose |
|----------|------------|---------|
| `@hypercomb/core` | `/hypercomb-core.runtime.js` | processor, IoC, EffectBus, Bee base classes |
| `three` | `/vendor/three.runtime.js` | Three.js renderer, scene graph, math |

the build pipeline (`build-module.ts`) already supports configurable `PLATFORM_EXTERNALS`. bees targeting meadowverse would declare `three` as external instead of `pixi.js`. the compiled output references `three` as a bare specifier. the import map resolves it to the vendored bundle. same mechanism, different library.

this means a single bee codebase could potentially target both platforms — if a bee only uses core primitives (EffectBus, IoC, grammar) and doesn't import a renderer directly, it runs anywhere. a data-processing worker, a mesh sync drone, a settings manager — these are renderer-agnostic. they work on hypercomb.io and meadowverse.ca without modification.

---

## scene graph as a colony

in a traditional 3D engine, the scene graph is a tree of nodes managed by a central authority. in meadowverse, the scene graph emerges from the colony.

each bee contributes to the scene independently:

```
ThreeHostWorker (bootstrap-once)
  → creates WebGLRenderer, Scene, Camera, animation loop
  → registers meadowverse:scene, meadowverse:camera in IoC
  → on each animation frame: renderer.render(scene, camera)

TerrainDrone
  → resolves meadowverse:scene
  → adds PlaneGeometry with displacement map
  → on heartbeat: updates LOD based on camera distance

ParticleFieldDrone
  → resolves meadowverse:scene
  → adds Points with custom shader material
  → on heartbeat: updates particle positions

SkyboxWorker
  → resolves meadowverse:scene
  → adds CubeTextureLoader background
  → acts once, goes dormant

LightingDrone
  → resolves meadowverse:scene
  → adds DirectionalLight + AmbientLight
  → on heartbeat: updates sun position based on time-of-day effect

CameraControlDrone
  → resolves meadowverse:camera
  → listens for input grammar (pan, orbit, zoom)
  → on heartbeat: updates camera transform
```

no bee knows about the others. `ThreeHostWorker` doesn't know what will be added to the scene. `TerrainDrone` doesn't know `ParticleFieldDrone` exists. they coordinate through the shared scene object (IoC) and through effects (EffectBus).

want to debug just the terrain? install only `ThreeHostWorker` + `TerrainDrone`. two bees. the terrain renders alone on a black background. fix the displacement map. sign. install the full set. the terrain now sits under particles, under a skybox, under dynamic lighting — and you never wrote a line of integration code.

---

## the departure

the economy doc describes the moment a completed hive "departs" — avatars lift off and spiral into the meadowverse. this is not just animation. it is the architectural moment where authored content crosses from the build environment to the runtime environment.

what does departure actually mean in technical terms?

1. **the hive is complete** — every tile has been built, every bee compiled, every dependency resolved. the install manifest lists everything.
2. **the manifest is signed** — the root signature represents the entire experience: all bees, all deps, all layers, all resources.
3. **meadowverse receives the signature** — via URL parameter, via mesh relay, via QR code, via any channel that can transmit 64 hex characters.
4. **meadowverse installs** — `LayerInstaller` downloads everything, verifies everything, writes to OPFS.
5. **meadowverse pulses** — `hypercomb.act()` finds all bees, pulses them. the 3D experience comes alive.

the departure is a signature handoff. 64 characters cross from one domain to another. everything else follows deterministically.

and because the signature is content-addressed, the experience is immutable. the meadowverse instance running signature `a1b2c3...` will always render the same scene, with the same bees, producing the same result. it is a permanent artifact. the bees who built it have flown — and what they built endures.

---

## what already works

these components exist today and would transfer directly to meadowverse:

- `@hypercomb/core` — Bee, Drone, Worker, EffectBus, IoC, SignatureService, hypercomb processor
- `LayerInstaller` — download, verify, write to OPFS (domain-scoped)
- `ScriptPreloader` — manifest-driven bee discovery, signature verification, lazy dep loading via `beeDeps`
- `DependencyLoader` — namespace resolution, import map consumption, orphan dep loading
- `resolveImportMap()` — OPFS scan, alias extraction, dynamic `<script type="importmap">` injection
- `SignatureStore` — trusted-signature allowlist, localStorage persistence
- `ensureInstall()` — signature resolution, incremental manifest diffing, resumable installs
- service worker pattern — OPFS-backed cache-first module serving
- `build-module.ts` — discover, bundle, sign, layer tree, install manifest with `beeDeps`
- `PayloadCanonical` — bee serialization + signing for DCP-authored bees

---

## what would need to be built

**meadowverse bootstrap** (`meadowverse/src/main.ts`):
- same sequence as hypercomb-web: `ensureSwControl()` → `ensureInstall()` → `attachImportMap()` → `DependencyLoader.load()` → register `BEE_RESOLVER` → `hypercomb.act()`
- no Angular. vanilla JavaScript. the bootstrap is ~50 lines.

**Three.js host worker** (`ThreeHostWorker`):
- creates `WebGLRenderer` targeting `<canvas id="viewport">`
- creates `Scene`, `PerspectiveCamera`
- registers in IoC: `meadowverse:scene`, `meadowverse:camera`, `meadowverse:renderer`
- runs `requestAnimationFrame` loop that calls `renderer.render(scene, camera)`

**Three.js vendored bundle**:
- `three.runtime.js` in `meadowverse/public/vendor/`
- import map entry: `"three": "/vendor/three.runtime.js"`

**meadowverse namespace in essentials**:
- `hypercomb-essentials/src/meadowverse.ca/` — 3D bees organized by domain
- build pipeline already supports multi-domain namespaces

**grammar conventions for 3D**:
- `render` — continuous frame loop grammar
- `interact:orbit`, `interact:pan` — camera controls
- `scene:add`, `scene:remove` — explicit scene mutations
- or: bees just `sense(() => true)` and pulse every frame, using EffectBus for coordination

---

## the vision

you open hypercomb.io. you navigate to a cell. you open the Diamond Core Processor. you write a drone that creates a glowing wireframe torus. you compile it. 64 hex characters appear — that's your torus.

you open meadowverse.ca in another tab. you paste the signature into the URL. the canvas shows a glowing wireframe torus, spinning slowly in empty space. nothing else. just your torus. you inspect it. you profile the shader. you adjust the geometry. each change produces a new signature. each signature produces the same torus, forever.

you go back to hypercomb.io. you write another drone — a camera that orbits on mouse drag. compile. new signature. you create a manifest that includes both bees. new root signature. paste it into meadowverse. now you can orbit around your torus. two bees. two behaviors. one scene.

you keep going. terrain. lighting. particles. sound. physics. each bee tested in isolation. each bee composed by adding its signature to the manifest. the experience grows not by writing more code in one place, but by building more autonomous pieces that coexist in the same scene without knowing about each other.

this is the meadow. the bees built it, one hexagon at a time, and now it runs — not because someone orchestrated every interaction, but because every bee knows its own job and the processor gives them all a chance to pulse.

*the hive builds. the meadow runs. the signature is the bridge between them.*
