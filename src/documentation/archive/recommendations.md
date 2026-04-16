# 10 recommendations

these are the ten changes that would most reinforce hypercomb's existing architecture without adding complexity. each one makes something that already works, work better. nothing here is new scope — everything strengthens what is already built.

---

## 1. extract AxialCoordinate from pixi.js

**what**: split `AxialCoordinate` into a pure domain type `{q, r, s}` with spatial math, and a separate `AxialProjection` that computes pixel positions using pixi's `Point`.

**why**: AxialCoordinate is the foundational primitive. it should be testable, importable, and usable without a rendering library loaded. today, `import { Point } from "pixi.js"` on line 3 of `axial-coordinate.ts` prevents this.

**how**: move `getLocation()` into a `projection.ts` file in essentials. AxialCoordinate keeps `q, r, s, index, hashCode, add, subtract, equals`. the projection function takes an AxialCoordinate and Settings and returns `{x, y}`.

**stability gain**: the spatial domain model becomes the immovable foundation it was designed to be. core math can be tested in isolation. rendering can be swapped without touching navigation.

---

## 2. implement the byte protocol as a real drone

**what**: create a `TrailDrone` that encodes and decodes 1-byte navigation steps (the `mm pp d nnn` format documented in the bee story) and translates them to AxialCoordinate movements via the effect bus.

**why**: the byte protocol is designed but not wired into the runtime. it is the bridge between intent (I want to go northeast with beacon pheromone) and execution (advance to neighbor 0 of the current AxialCoordinate). connecting it makes the navigation language alive.

**how**: `TrailDrone` listens for `'trail:step'` effects carrying a single byte. it unpacks the byte, resolves the neighbor via `AxialService.getAdjacentCoordinates()`, emits `'trail:moved'` with the new coordinate and pheromone, and handles mode bits (end = dispose trail, branch = emit fork signal). a companion `TrailEncoderDrone` packs user input into bytes.

**stability gain**: the byte protocol becomes testable end-to-end. path recording for DNA becomes trivial — just capture the byte stream. replay becomes deterministic.

---

## 3. add tests to core primitives

**what**: add a test runner (vitest) and unit tests for `EffectBus`, `IoC`, `SignatureService`, `Drone` lifecycle, and `PayloadCanonical`.

**why**: these five primitives are the load-bearing walls of the entire system. they have zero test coverage. they are all testable today without any code changes — no pixi, no dom, no browser required.

**how**: `vitest` in `@hypercomb/core`. test files co-located: `effect-bus.test.ts`, `ioc.test.ts`, `signature.service.test.ts`, `drone.base.test.ts`, `payload-canonical.test.ts`. a `TestDrone` subclass with public `sense()` and `heartbeat()` overrides for lifecycle testing.

**stability gain**: confidence that the foundation is correct. regression protection as the system grows. the tests also serve as documentation — they show exactly how each primitive behaves.

---

## 4. formalize the effect vocabulary

**what**: create a typed registry of all effect keys, their payload types, and which drones emit/listen to them.

**why**: effects are currently string-based (`'render:host-ready'`, `'mesh:subscribe'`). the `listens` and `emits` metadata on drones is a good start, but there is no single source of truth. a typo in an effect key fails silently.

**how**: a `effects.registry.ts` in core that exports typed constants:

```ts
export const EFFECTS = {
  RENDER_HOST_READY: 'render:host-ready' as const,
  MESH_READY: 'mesh:ready' as const,
  MESH_ITEMS_UPDATED: 'mesh:items-updated' as const,
  // ...
} as const
```

with companion payload type exports. drones import these constants instead of using raw strings.

**stability gain**: compile-time detection of misspelled effect keys. autocomplete for all available effects. a single file that documents the entire colony's communication vocabulary.

---

## 5. add a debug event log to the effect bus

**what**: when a debug flag is set, the effect bus records every `emit()` call with timestamp, effect key, and payload summary into a ring buffer (last N events).

**why**: when multiple drones react to the same effect, understanding the cascade currently requires stepping through each drone. a debug log makes the colony's behavior visible without changing it.

**how**: add `EffectBus.setDebug(true)` and `EffectBus.getLog()`. the log is a fixed-size array (e.g., 500 entries). each entry: `{ ts, effect, payloadSummary, handlerCount }`. disabled by default — zero overhead in production.

**stability gain**: debugging drone interactions goes from "step through every heartbeat" to "read the log." especially valuable when onboarding new contributors who need to understand the colony's behavior.

---

## 6. enforce the write barrier with a Store guard

**what**: wrap OPFS writes in the Store and Lineage behind a single `commit()` pattern that requires an explicit intent marker.

**why**: the write barrier is hypercomb's most important architectural principle — nothing persists unless meaning was attached. today this is enforced by convention (developers choose when to call `ensure()` or `addMarker()`). a guard makes it structural.

**how**: `Store.commit(intent: string, fn: () => Promise<void>)`. the intent string is logged. writes outside of a commit throw in debug mode. this does not add friction to normal development — it makes the write barrier visible and auditable.

**stability gain**: no accidental persistence. every OPFS write has a recorded intent. the system's most fundamental principle is enforced by code, not discipline.

---

## 7. publish @hypercomb/shared as a package

**what**: add a `package.json` to `hypercomb-shared/` and give it a proper entry point, even if it remains a private package consumed only within the monorepo.

**why**: today, `@hypercomb/shared` is a tsconfig path alias that gets source-included in Angular apps. this creates an asymmetry: some `@hypercomb/*` imports resolve to npm packages, others resolve to local paths. contributors cannot tell the difference by looking at import statements.

**how**: add `package.json` with `"name": "@hypercomb/shared"`, `"private": true`, `"main"` and `"types"` pointing to the source entry. no build step needed — it can stay source-included. the package.json makes it visible to `npm ls`, ide tooling, and dependency analysis.

**stability gain**: eliminates the path-alias confusion. makes the dependency graph complete and inspectable. removes a contributor onboarding friction point.

---

## 8. scope the ioc container to lifecycle phases

**what**: add an optional phase guard to `get()` that warns (in debug mode) when a service is resolved before its expected registration phase.

**why**: today, if a drone calls `this.resolve('AxialService')` before AxialService has registered, it silently gets `undefined`. this is the temporal coupling problem — dependencies must exist by the time they're accessed, but nothing enforces this.

**how**: `register()` accepts an optional `phase` tag (e.g., `'core'`, `'rendering'`, `'mesh'`). `get()` checks the current phase. if a rendering-phase service is requested during core phase, a debug warning is logged. no runtime enforcement — just visibility.

**stability gain**: makes the implicit registration order visible. new contributors can see which services are available at which point in the bootstrap sequence. temporal coupling becomes documented, not discovered through debugging.

---

## 9. implement path recording for DNA

**what**: create a `PathRecorderDrone` that captures navigation byte streams and produces sealed path capsules (the DNA format from the bee story).

**why**: DNA is the only persistence mechanism that fulfills hypercomb's aspiration of voluntary, minimal, verifiable memory. the format is designed. the SignatureService exists. the byte protocol is defined. the only missing piece is a drone that records and seals.

**how**: `PathRecorderDrone` listens for `'trail:moved'` effects. it accumulates bytes in a buffer. on `'trail:end'`, it computes the commitment via `SignatureService.sign()`, assembles the capsule (header + bytes + seal), and emits `'dna:capsule-ready'` with the result. publishing to nostr mesh is a separate, explicit step.

**stability gain**: the full vision becomes executable: navigate → record → seal → optionally publish. the path from live presence to durable memory is a single, verifiable pipeline. and because recording is a drone, it follows the same lifecycle as everything else — opt-in, disposable, auto-cleaned.

---

## 10. document the bootstrap sequence

**what**: write a single-page document that describes the exact order in which the runtime initializes: which services register first, which drones boot, which effects fire, and what the dependency graph looks like at each phase.

**why**: the current bootstrap is implicit — services register as side effects of module loading, drones emit effects that trigger other drones, and the order matters but isn't documented. this is the single largest source of confusion for anyone entering the codebase.

**how**: a `bootstrap.md` in `documentation/` that lists the sequence:

```
1. Settings registers in ioc
2. AxialService registers, calls initialize(settings)
3. PixiHostWorker registers, creates pixi app
4. PixiHostWorker emits 'render:host-ready'
5. ShowCellDrone, ZoomDrone, PanningDrone subscribe and activate
6. NostrMeshDrone registers, awaits 'mesh:ensure-started'
7. Store initializes OPFS root
8. Lineage bootstraps from url
```

include a diagram of the effect cascade and the ioc registration order.

**stability gain**: new contributors can read one page and understand how the system starts. the implicit becomes explicit. debugging startup issues goes from archaeology to reading.

---

## priority order

if these were done in sequence, the order that produces the most stability per effort:

1. **add tests to core** (#3) — foundation confidence
2. **extract AxialCoordinate from pixi** (#1) — domain purity
3. **formalize effect vocabulary** (#4) — compile-time safety
4. **document the bootstrap sequence** (#10) — contributor onboarding
5. **add debug event log** (#5) — debugging leverage
6. **implement byte protocol drone** (#2) — navigation language
7. **enforce write barrier** (#6) — architectural principle
8. **publish @hypercomb/shared** (#7) — tooling visibility
9. **implement path recording** (#9) — DNA pipeline
10. **scope ioc to phases** (#8) — temporal coupling visibility

---

*ten changes. zero new abstractions. every one makes an existing primitive stronger, an existing principle more enforceable, or an existing aspiration more reachable. the colony does not need new organs. it needs the ones it has to work with full confidence.*
