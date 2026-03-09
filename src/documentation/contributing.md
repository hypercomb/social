# contributing to hypercomb

> presence-first. live by default. no storage unless explicit dna publish.

---

## before you begin

read these documents in order. they establish the vocabulary and architecture
you will work within:

1. [hive.md](hive.md) -- the metaphor layer and how it maps to code
2. [architecture-overview.md](architecture-overview.md) -- live presence architecture, drone lifecycle, effect bus, package structure
3. [glossary.md](glossary.md) -- canonical terms from metaphor to mechanics
4. [byte-protocol.md](byte-protocol.md) -- the 1-byte navigation wire format
5. [dna.md](dna.md) -- optional path capsule publishing
6. [core-processor-architecture.md](core-processor-architecture.md) -- core primitives and paradigm significance
7. [dependency-resolution.md](dependency-resolution.md) -- how each layer resolves its imports

if you don't understand the distinction between a bee and a drone, or between
the effect bus and the nostr mesh, re-read the glossary before writing code.

---

## philosophy

these principles are not negotiable:

- **presence is permission.** the hive exists only while we are here together.
  nothing is stored unless someone explicitly publishes dna.
- **drones are autonomous.** they do not call each other. they do not import
  each other. they sense and act independently.
- **the effect bus is the only bridge.** drone-to-drone communication happens
  through named effects. no direct resolution, no shared mutable state.
- **content-addressed identity.** sha-256 hashes replace names, versions,
  and credentials. the content is the identity.
- **zero-dependency core.** `@hypercomb/core` imports nothing and depends on
  nothing. this constraint is load-bearing and must not be violated.

---

## package structure

the hive is layered. each ring depends only on the rings inside it.

```
@hypercomb/core          zero dependencies. the framework.
                         Drone, DroneState, EffectBus, IoC, ServiceToken,
                         SignatureService, PayloadCanonical, DroneResolver,
                         KeyChord, KeyBinding, KeyMapLayer.
                         build: tsup (ESM + CJS + .d.ts)

@hypercomb/essentials    pixi peer dep. domain-namespaced modules.
                         diamondcoreprocessor.com/:
                           core, input, nostr, pixi, editor, settings
                         revolucionstyle.com/:
                           journal, wheel, cigar, discovery
                         build: esbuild via custom build-module.ts pipeline

@hypercomb/shared        angular bridge. path aliases. not published to npm.
                         Store (opfs), Lineage (navigation),
                         Navigation, SecretStore, LayerInstaller,
                         BridgeProviders for angular DI.
                         compiled inline as part of angular app builds.

hypercomb-web            the app. angular 21+ shell.
                         home page, setup, service worker.
                         build: angular cli (esbuild)
```

dependency direction is strictly inward:

- core imports nothing external
- essentials may only import core and sibling namespaces within essentials
- shared may import core (via tsconfig paths) but never essentials
- web apps consume shared by source and load essentials dynamically at runtime

violation of this layering breaks the content-addressing pipeline.

---

## protocol invariants

these are structural constraints of the byte protocol and the live presence
model. they must not be weakened or worked around:

- **1-byte steps.** every navigation instruction is exactly one byte:
  `mm pp d nnn` (2 | 2 | 1 | 3 bits). no multi-byte extensions.
- **no urls or identities in protocol.** the byte stream never reveals server
  locations, user accounts, or network addresses.
- **stateless relay.** the effect bus forwards signals and stores nothing
  permanently. the nostr mesh relays encrypted frames to decentralized relays,
  not to a central server.
- **session nonce rotation.** content-addressed signatures replace session
  nonces. the signature of the current domain + explorer path + seed is
  computed on every heartbeat.
- **meadow log is local-only.** opfs data never crosses the network without
  explicit user action (dna publish).
- **dna is optional.** publishing is a gift, not an obligation.
- **nnn range 0-5.** values 6-7 are invalid (hexagons have exactly six
  neighbors). bytes with `nnn > 5` are dropped silently.

---

## repo conventions

### file organization

- documentation lives in `social/src/documentation/`. link to sibling files
  with plain relative names (e.g., `[glossary.md](glossary.md)`).
- drone source files use the `.drone.ts` suffix
  (e.g., `pixi-host.drone.ts`).
- key export files use the `.keys.ts` suffix. these are auto-generated
  and excluded from essentials artifacts.
- essentials are organized by domain namespace:
  `hypercomb-essentials/src/<domain>/<namespace>/`.
  each domain (e.g. `diamondcoreprocessor.com`, `revolucionstyle.com`) is an
  independent module ecosystem within the same build pipeline.

### naming

- all documentation filenames are lowercase with hyphens.
- links in docs must be readable -- no tracking parameters, no analytics.
- drone classes end with `Drone` (e.g., `PixiHostDrone`, `ZoomDrone`).
- ioc registration keys are plain strings matching the class name without
  the `Drone` suffix where appropriate (e.g., `'PixiHost'`, `'Settings'`).

### git

- branch from `development`. target PRs to `development`.
- commit messages: imperative mood, lowercase start, no period.
  examples: `feat: add panning inertia to PanningDrone`,
  `fix: clean up effect subscriptions on drone disposal`.
- keep commits atomic. one logical change per commit.

---

## code style

### typescript

- strict mode. no `any` unless absolutely unavoidable (and commented).
- single-line imports, one specifier per line when destructuring many:

```typescript
import { Drone } from '@hypercomb/core'
import { Application, Container } from 'pixi.js'
```

- named pixi imports only. never `import * as PIXI from 'pixi.js'`.
- arrow functions for async methods in drones:

```typescript
protected override heartbeat = async (grammar: string): Promise<void> => {
  // ...
}
```

- use `this.resolve<T>('localName')` to resolve dependencies declared in
  `deps`. never call `window.ioc.get()` directly inside a drone.
- declare `deps`, `emits`, and `listens` as overrides on the drone class:

```typescript
protected override deps = { settings: 'Settings', axial: 'AxialService' }
protected override emits = ['render:host-ready']
protected override listens = ['render:host-ready']
```

- shared services must not use `@Injectable()`. they are plain classes that
  self-register into `window.ioc`. angular DI accesses them through the
  bridge providers.
- use `ServiceToken<T>` for typed ioc keys in core.
- use `SharedToken` (duck-type compatible) in shared to avoid hard dependency
  on core.

### effect naming

effects follow the pattern `category:event-name`:

```
render:host-ready
pheromone:beacon
mesh:ensure-started
mesh:subscribe
mesh:publish
trail:fork
filesystem:changed
```

categories correspond to the `Effect` type union: `filesystem`, `render`,
`history`, `network`, `memory`, `external`.

### drone conventions

- every drone must handle the `Disposed` state correctly. `encounter()`
  already gates on it, but custom cleanup logic belongs in an overridden
  `dispose()` method.
- drones self-register at module load via
  `window.ioc.register('Name', new MyDrone())` at the bottom of the file.
- guard against missing dependencies in `heartbeat`. if a required
  dependency is not yet registered, return early and wait for the next
  pulse:

```typescript
const settings = this.resolve<any>('settings')
if (!settings) return
```

- never call another drone's methods directly. emit an effect instead.

---

## drone lifecycle

every drone follows this state machine:

```
Created --> Registered --> Active --> Disposed
```

- **created**: constructed, not yet known to the ioc container.
- **registered**: placed in the container via `window.ioc.register()`.
  `markRegistered()` transitions the state.
- **active**: has successfully responded to at least one `encounter()`.
  the first successful heartbeat transitions the state.
- **disposed**: cleaned up, effect subscriptions removed.
  `markDisposed()` transitions the state, calls all unsubscribe
  functions, then calls `dispose()` if overridden.

the framework calls `encounter(grammar)` on each resolved drone.
encounter checks lifecycle state, evaluates `sensed()`, calls
`heartbeat()` if relevant, then transitions state. there is no separate
init phase. the intent is the lifecycle trigger.

---

## effect bus usage

drones communicate through effects, not direct calls.

```typescript
// emitting (inside heartbeat)
this.emitEffect('render:host-ready', { app, container, canvas, renderer })

// subscribing (in heartbeat or constructor)
this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
  // use payload
})
```

key properties:

- **last-value replay**: subscribe after emission and you still get the
  most recent payload. no timing races.
- **auto-cleanup**: when a drone is disposed, all its subscriptions are
  removed automatically.
- **metadata**: drones declare `listens` and `emits` arrays for graph
  visibility. call `window.ioc.graph()` to inspect the full wiring.

always clean up manual subscriptions. if you subscribe outside of
`onEffect()` / `onceEffect()`, you must manage the unsubscribe yourself
in `dispose()`.

---

## pr checklist

before opening a pull request, verify all of these:

### architecture

- [ ] core remains zero-dependency. no new imports added to `@hypercomb/core`.
- [ ] essentials do not import from shared or angular.
- [ ] shared does not import from essentials.
- [ ] new drones self-register at the bottom of their file.
- [ ] dependency direction is strictly inward (core -> essentials -> shared -> web).

### drone lifecycle

- [ ] new drones extend `Drone` and override `heartbeat` as an arrow async
      method.
- [ ] `sense()` is overridden if the drone should not respond to every grammar.
- [ ] dependencies are declared in `deps` and resolved via `this.resolve()`.
- [ ] `emits` and `listens` metadata arrays are declared for graph visibility.
- [ ] `dispose()` is overridden if the drone allocates resources beyond effect
      subscriptions (dom nodes, timers, websocket connections).
- [ ] heartbeat guards against missing dependencies (early return, not crash).

### effect cleanup

- [ ] all effect subscriptions use `this.onEffect()` or `this.onceEffect()`
      for automatic cleanup.
- [ ] manual subscriptions (if any) are cleaned up in `dispose()`.
- [ ] no stale effect listeners survive drone disposal.
- [ ] `emitEffect()` is only called with declared effect names from `emits`.

### ioc registration

- [ ] new services register with a `ServiceToken<T>` or plain string key.
- [ ] registration key matches the convention (class name without `Drone`
      suffix for drones, class name for services).
- [ ] if the service needs angular DI access, a `SharedToken` and bridge
      provider entry exist in shared.
- [ ] no `@Injectable()` decorator on shared services.

### protocol

- [ ] byte protocol invariants are not violated (1-byte steps, no urls in
      protocol, nnn range 0-5).
- [ ] no new storage is introduced without explicit user consent.
- [ ] content-addressing via `SignatureService` is used for any new artifact
      identity.

### code quality

- [ ] typescript strict mode passes with no new `any` types (unless
      commented).
- [ ] imports follow single-line style. pixi imports are named, not
      star-imported.
- [ ] no direct `window.ioc.get()` calls inside drones. use `this.resolve()`.
- [ ] documentation updated if new concepts or drones are introduced.

---

## local testing

### building the packages

```bash
# core (tsup)
cd src/hypercomb-core
npm run build

# essentials (esbuild pipeline)
cd src/hypercomb-essentials
npm run build            # tsup for npm package
npm run build:watch      # watch mode for development artifacts

# web app (angular cli)
cd src/hypercomb-web
npm run runtime          # build vendored core + pixi runtime bundles
npm start                # ng serve
```

### bootstrap sequence

the web app boots in this order. if something fails, check each step:

1. `import '@hypercomb/shared/core/ioc.web'` -- installs `window.ioc`
2. `ensureSwControl()` -- registers the service worker
3. `ensureInstall()` -- fetches and writes layers to opfs
4. `attachImportMap()` -- builds and inserts `<script type="importmap">`
5. `bootstrapApplication(App, appConfig)` -- starts angular

the import map must be in the dom before any dynamic `import()` of opfs
modules. the service worker must be active before the import map is built.

### verifying drones

open the browser console and run:

```javascript
window.ioc.list()    // all registered keys
window.ioc.graph()   // full dependency + effect wiring map
```

this shows you every drone and service in the container, their dependencies,
and their declared effects.

### common issues

- **dual angular runtime crash (`firstCreatePass` null)**: the workspace
  root `node_modules/@angular/*` and `hypercomb-web/node_modules/@angular/*`
  resolve to different versions. ensure all angular installations resolve to
  the same physical files.
- **import map not loading**: the service worker must be active before
  `attachImportMap()` runs. check `navigator.serviceWorker.controller` in
  the console.
- **drone not firing**: check that `sensed()` returns true for the current
  grammar. check that the drone is registered in ioc (`window.ioc.has('Name')`).
- **effect not received**: check that the emitter has already called
  `emitEffect()` or that the subscriber is listening on the correct effect
  name. use `window.ioc.graph()` to trace wiring.

---

## contributing documentation

documentation lives in `social/src/documentation/`.

### style

- all lowercase. no emojis.
- filenames use hyphens: `byte-protocol.md`, `architecture-overview.md`.
- link to sibling files with plain relative names: `[glossary.md](glossary.md)`.
- no analytics, tracking parameters, or shortened urls in links.
- keep the metaphor-to-mechanism mapping consistent with [glossary.md](glossary.md).

### when to add a doc

- new drone types or abstractions that change how the hive works.
- new protocol extensions or flags in the byte format.
- architectural decisions that affect the layering or dependency direction.

### when not to add a doc

- implementation details that belong in code comments.
- one-off bugfixes or minor refactors.

---

## commit messages

format: `type: short imperative description`

types:

- `feat` -- new feature or drone
- `fix` -- bug fix
- `refactor` -- code restructuring without behavior change
- `chore` -- build, tooling, dependency updates
- `docs` -- documentation only

examples:

```
feat: add EffectBus for drone-to-drone communication via effects
fix: clean up effect subscriptions on drone disposal
refactor: extract axial coordinate caching to AxialService
chore: upgrade Angular 20 -> 21.2.0, align all package versions
docs: add byte protocol specification
```

keep messages concise. the first line should stand alone without reading
the body.

---

## license

hypercomb is licensed under AGPL-3.0-only. by contributing, you agree that
your contributions will be licensed under the same terms.
