# runtime — navigation primitives

this document describes every primitive involved in navigating the hypercomb runtime. nothing here is theoretical. every primitive listed exists in the codebase today.

---

## the grid

navigation happens on a hexagonal grid. the grid is defined by three primitives:

**AxialCoordinate** — a single hex cell. three numbers (q, r, s) constrained by q + r + s = 0. each coordinate computes a cantor-pairing hash for O(1) index lookup. the coordinate also carries a pixel-space `Location` computed from `Settings.hexagonSide`.

**AxialService** — the grid builder. `createMatrix()` generates hexagons outward from center (0, 0, 0) in concentric rings, up to `Settings.rings` deep (default: 50). pre-computes an adjacency map: every coordinate knows its 6 neighbors.

**Settings** — spatial configuration. `hexagonSide = 200` drives all geometry. height = side * 2. width = side * sqrt(3). `rings = 50` determines grid extent. `panThreshold = 25` sets input sensitivity.

the six neighbors of any cell:

| index | direction | delta (q, r, s) |
|-------|-----------|-----------------|
| 0 | northeast | (+1, -1, 0) |
| 1 | east | (+1, 0, -1) |
| 2 | southeast | (0, +1, -1) |
| 3 | southwest | (-1, +1, 0) |
| 4 | west | (-1, 0, +1) |
| 5 | northwest | (0, -1, +1) |

this is the spatial foundation. every higher-level navigation primitive ultimately resolves to movement between these six neighbors.

---

## the drone

the drone is the unit of behavior. every runtime action is performed by a drone.

**lifecycle**: `Created → Registered → Active → Disposed`

- a drone enters `Created` when instantiated
- it enters `Registered` when placed in the ioc container (`markRegistered()`)
- it enters `Active` on first successful `encounter()` — the framework calls `sensed()` for relevance, then `heartbeat()` for execution
- it enters `Disposed` when `markDisposed()` is called, which severs all effect subscriptions and invokes the optional `dispose()` hook

**dependency declaration**: drones declare what they need via a `deps` map:
```ts
protected deps = { settings: 'Settings', axial: 'AxialService' }
```
resolved at runtime through `this.resolve<T>('settings')`.

**effect participation**: drones declare what they listen for and what they emit:
```ts
listens = ['render:host-ready']
emits = ['mesh:ready', 'mesh:items-updated']
```

a drone that has been disposed cannot be reactivated. the lifecycle is one-directional.

---

## the effect bus

all drone-to-drone communication passes through the effect bus. no drone imports another drone.

**emit** — broadcast a named effect with a typed payload. the bus stores the most recent value.

**on** — subscribe to a named effect. if the effect has already been emitted, the subscriber immediately receives the last value (last-value replay). returns an unsubscribe function.

**once** — subscribe for a single delivery, then auto-unsubscribe.

**auto-cleanup** — when a drone is disposed, all its subscriptions are severed automatically.

the bus has no routing logic, no priorities, no filtering. it is a medium. drones decide for themselves whether to respond.

registered effects in the current codebase:

| effect | emitter | purpose |
|--------|---------|---------|
| `render:host-ready` | PixiHostDrone | pixi app, container, canvas, renderer are available |
| `mesh:ensure-started` | any | trigger nostr mesh initialization for a signature |
| `mesh:subscribe` | any | subscribe to mesh events for a signature |
| `mesh:publish` | any | publish an event to nostr relays |
| `mesh:ready` | NostrMeshDrone | mesh connection established |
| `mesh:items-updated` | NostrMeshDrone | cached mesh items changed |

---

## the ioc container

the colony registry. 53 lines. four operations.

**register(key, value, name?)** — place a service in the container, optionally with a human-readable alias.

**get(key)** — resolve a service by key or `ServiceToken<T>`. returns undefined if not found.

**has(key)** — check existence without resolving.

**list()** — return all registered keys.

`ServiceToken<T>` provides type-safe resolution across package boundaries without coupling to concrete types. the container is a `Map<string, unknown>` with an alias `Map<string, string>`.

services self-register at module load time:
```ts
window.ioc.register('Settings', new Settings())
window.ioc.register('AxialService', new AxialService())
```

---

## the rendering pipeline

**PixiHostDrone** — creates the pixi `Application`, attaches it to the dom, initializes `AxialService` with `Settings`, and broadcasts `'render:host-ready'` carrying the app, container, canvas, and renderer.

**ShowHoneycombDrone** — subscribes to `'render:host-ready'`. receives the pixi infrastructure and renders the hex grid.

**ZoomDrone** — manages zoom state. uses `ZoomArbiter` for exclusive control (only one input source zooms at a time). `ZoomState` tracks per-scope snapshots, min/max scale (0.05–12), and pivot-preserving zoom math. subscribes to `'render:host-ready'`.

**PanningDrone** — manages panning. uses a similar exclusive-control pattern via `begin(source)` / `end(source)`. delegates to `MousePanInput` for mouse-based panning. subscribes to `'render:host-ready'`.

the rendering pipeline is entirely effect-driven. no drone in the pipeline imports another. they coordinate through the bus.

---

## the navigation layer

**Lineage** — tracks the current position in the domain/path tree. maintains `activeDomain` (default: `'hypercomb.io'`), `explorerPath` (segments), and `fsRevision` (change counter). provides `explorerEnter(name)` to descend, `explorerUp()` to ascend, and `showDomainRoot()` to reset.

lineage resolves paths against OPFS:
```
hypercomb.io / segment1 / segment2 / seed
```
each segment maps to a `FileSystemDirectoryHandle`. `tryResolve()` reads without creating. `ensure()` creates missing directories. `addMarker()` writes signature files for content addressing.

**Store** — manages the OPFS root. initializes the directory structure:
```
opfs root
  └── hypercomb.io/
        ├── __drones__/
        ├── __dependencies__/
        └── __layers__/
```
provides `setCurrent(segments)` to navigate the filesystem and `resetCurrent()` to return to root.

**Navigation** — reads and writes the browser url. `segments()` returns normalized path segments from the url. `getSelections()` parses hash-based selections (`#name` or `#(a,b,c)`). `toggleSelection()` adds or removes from the selection set.

lineage dispatches `'synchronize'` events with revision data when paths change. it listens to `'navigate'` and `'popstate'` events from the browser.

---

## the signature system

**SignatureService** — takes bytes, returns a 64-character hex string via `crypto.subtle.digest('SHA-256', bytes)`. deterministic: same bytes always produce the same seal.

**PayloadCanonical** — the signing pipeline for drone artifacts:
```
DronePayloadV1 → structuredClone → JSON.stringify → TextEncoder → ArrayBuffer → SHA-256 → hex seal
```
canonicalization (via structured clone + stringify) ensures deterministic output regardless of property ordering.

**DronePayloadV1** — the artifact format:
```ts
{
  version: 1,
  drone: { name, description?, grammar?, links?, effect? },
  source: { entry: string, files: Record<string, string> }
}
```

signatures serve as content-addressable identifiers. same content = same signature = same identity. no version numbers, no sequential ids.

---

## the mesh

**NostrMeshDrone** — connects to nostr relays (default: `wss://relay.snort.social`) for cross-device communication.

**core operations**:
- `ensureStartedForSig(sig)` — begin querying relays for events matching a signature
- `subscribe(sig, callback)` — receive updates when events arrive for a signature
- `publish(kind, sig, payload)` — broadcast an event to all connected relays
- `getNonExpired(sig)` — retrieve cached events that haven't exceeded their ttl

**caching**: per-signature buckets with configurable ttl (default: 120 seconds). deduplication by event id across relays. per-signature capacity cap (default: 128 items). expiry rules can target specific signature prefixes or event kinds.

**event format**: nostr events carry `kind` (default: 29010), `tags` (including `['x', signature]` for content addressing), `content` (json payload), and standard nostr fields (pubkey, created_at, sig).

the mesh is the mechanism by which hives become visible across devices without a central server. signatures are the subscription keys. presence is temporal — events expire.

---

## the zoom/pan coordination model

zoom and pan use an exclusive-control pattern to prevent conflicts:

**ZoomArbiter** — `acquire(source)` grants exclusive zoom control to one source (mouse wheel, pinch, programmatic). `release(source)` frees it. only the current holder can zoom.

**PanningDrone** — `begin(source)` / `end(source)` for exclusive pan control.

**ZoomState** — maintains per-scope snapshots. when scope changes (e.g., entering a sub-hive), the current zoom is saved and the new scope's zoom is restored. `zoomToScale(scale, pivot)` preserves the screen point under the cursor during zoom.

this pattern ensures that mouse wheel zoom, pinch zoom, and programmatic zoom never fight each other. the arbiter is a semaphore, not a queue.

---

## the write barrier

nothing crosses into persistence unless meaning was attached.

lineage writes to OPFS only through explicit operations: `ensure()` creates directories, `addMarker()` writes signature files. the store does not auto-save. the navigation layer reads the url but does not write history entries automatically.

effects are ephemeral — they exist in the bus until the session ends. drone state is ephemeral — it exists until disposal. zoom snapshots are ephemeral — they exist in memory until the page unloads.

the only durable state is:
1. OPFS directory structure (explicit writes via lineage/store)
2. nostr events published to relays (explicit publish via mesh)
3. url path and hash (explicit writes via navigation)

everything else is runtime turbulence. if the intent never resolves, nothing persists.

---

## primitive dependency graph

```
Settings
  └──> AxialService (uses hexagonSide, rings)
         └──> AxialCoordinate (uses Settings for Location)

PixiHostDrone
  ├──> deps: Settings, AxialService
  └──> emits: 'render:host-ready'
         ├──> ShowHoneycombDrone (subscribes)
         ├──> ZoomDrone (subscribes)
         └──> PanningDrone (subscribes)

NostrMeshDrone
  ├──> deps: NostrSigner
  ├──> listens: 'mesh:ensure-started', 'mesh:subscribe', 'mesh:publish'
  └──> emits: 'mesh:ready', 'mesh:items-updated'

Store ──> Lineage ──> Navigation
  (OPFS)   (paths)    (url)

SignatureService ──> PayloadCanonical
  (SHA-256)           (drone signing)
```

every arrow is either an ioc resolution or an effect subscription. there are no direct imports between drones.

---

*sixteen primitives. zero direct coupling. the runtime is a colony of small, focused behaviors coordinating through scent and registry. that is all it takes.*
