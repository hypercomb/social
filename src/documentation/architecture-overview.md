# architecture -- live presence

hypercomb is live-only by default. meaning is created by moving together in real time.
there is no global storage, no feeds, and no profiles. presence = permission.

tl;dr:
- drones sense and act on every heartbeat -- one pulse drives everything
- only bees present right now receive effects
- the effect bus is stateless (last-value-replay pub/sub, stores nothing permanently)
- the nostr mesh relays encrypted frames to decentralized relays (stores nothing locally beyond a ttl cache)
- identity is content-addressed (sha-256 signatures, not accounts)
- optional local memory via opfs (origin private file system)
- optional publishing via mesh when a path should persist

how it feels:
1. arrive at a hex cell (consent to join by navigating there)
2. move together (drones emit tiny effects; linked bees follow)
3. leave any time (disposing ends access immediately)

---

## the hive: metaphor to implementation

the metaphor layer uses bees, hives, pheromones, and honeycombs.
the implementation layer uses drones, effect buses, hex grids, and nostr relays.
the two are the same system seen from different distances.

| metaphor (what it feels like) | implementation (what the code does) |
|-------------------------------|-------------------------------------|
| bee | `Bee` (bee.base.ts in @hypercomb/core) — specialized as `Drone` or `Worker` |
| hive | `Honeycomb` -- a named collection of drones and layers |
| pheromone | effect -- a named signal on the `EffectBus` |
| honeycomb cell | `AxialCoordinate` (q, r, s cube coords) rendered via pixi |
| relay (stateless forwarder) | `EffectBus` (local) + `NostrMeshDrone` (network) |
| swarm intelligence | `BeeResolver` finds relevant bees; each decides via `sense()` |
| meadow log | opfs directory tree (origin private file system) |
| dna (path capsule) | `PayloadCanonical` -- signed drone payload with sha-256 content address |

---

## data you actually have

- **effect**: a named signal with a payload, broadcast over the effect bus.
  last-value-replay means late subscribers still get the most recent state.
- **hex coordinate**: an axial (q, r, s) position on the honeycomb grid.
  six neighbors (0-5), managed by `AxialService`, rendered by pixi.
- **signature**: sha-256 content address computed by `SignatureService`.
  like git or ipfs -- the content is the identity.
- **opfs tree**: local filesystem rooted at `hypercomb.io/` in the browser's
  origin private file system. seeds, bees, dependencies, resources, and layers live here.
- **(optional) mesh events**: nostr events tagged with a content-addressed
  signature. ttl-backed cache, auto-expiring, deduplicated across relays.

---

## drone lifecycle

every bee in the hive is a `Bee`. bees come in two flavors:

- **drone** — reactive bee. pulses every cycle. uses `sense()` + `heartbeat()`.
- **worker** — bootstrap-once bee. acts once when `ready()` returns true, then goes dormant.

both share the same lifecycle state machine:

```
Created --> Registered --> Active --> Disposed
```

- **created**: constructed, not yet known to the container.
- **registered**: placed in the ioc container (`window.ioc.register`).
- **active**: has successfully responded to at least one pulse.
- **disposed**: cleaned up, effect subscriptions removed, done.

the framework calls `bee.pulse(grammar)` on each resolved bee.
for drones, pulse checks `sense()`, then calls `heartbeat()`, then transitions state.
for workers, pulse checks `ready()`, then calls `act()` once.

---

## communication: the effect bus

drones do not call each other directly. they communicate through effects --
named signals on a shared pub/sub bus.

```
emitEffect('render:host-ready', { app, container, canvas, renderer })
onEffect('render:host-ready', (payload) => { ... })
```

the effect bus (`EffectBus` in @hypercomb/core) provides:

- **last-value replay**: subscribe after an effect was emitted and you still
  get the most recent payload. no timing races.
- **auto-cleanup**: when a drone is disposed, all its subscriptions are removed.
- **metadata**: drones declare `listens` and `emits` arrays for graph visibility.
  call `window.ioc.graph()` to see the full dependency + effect wiring.

this is the local relay. it forwards signals, stores nothing permanently.

---

## communication: the nostr mesh

for network presence, the `NostrMeshDrone` extends the effect bus pattern
across decentralized nostr relays.

- connects to configurable relays via websocket (default: `wss://relay.snort.social`)
- subscribes and publishes nostr events tagged with content-addressed signatures
- ttl-backed cache with configurable expiry rules (default 120s)
- deduplicates events across relays by event id
- signing via nip-07 browser extension or fallback `NostrSigner`
- local fanout: publishes are always delivered locally before network send

other drones coordinate with the mesh through effects:

```
emitEffect('mesh:ensure-started', { signature })
emitEffect('mesh:subscribe', { signature, onItems })
emitEffect('mesh:publish', { kind, sig, payload })
```

---

## the hex grid

the spatial foundation is a hexagonal grid using axial coordinates.

- **AxialCoordinate**: (q, r, s) cube coordinates where q + r + s = 0.
- **AxialService**: generates the grid in concentric rings, caches adjacency
  lists for all six neighbors, and provides closest-cell lookup.
- **PixiHostDrone**: creates the pixi application and root render container.
  broadcasts `render:host-ready` so other drones can draw.
- **ShowHoneycombWorker**: unions local opfs seeds with mesh seeds, maps them
  onto axial positions, and renders labeled hex tiles via sdf shaders.
- **HexSdfTextureShader**: programmatic signed-distance-field rendering for
  hex tiles — replaced svg borders with gpu-computed borders and overlays.
- **orientation**: the grid supports both pointy-top (default) and flat-top
  hex orientations, toggled via a header bar control. orientation changes
  propagate through settings to all input and rendering drones.

the grid is what the byte protocol navigates. each cell is a seed.
entering a cell means navigating into that seed's opfs directory.

---

## identity: content-addressed, not accounts

there are no usernames, passwords, or profiles.

`SignatureService` computes sha-256 hashes via `crypto.subtle.digest()`.
any payload -- a drone's source code, a path capsule, a mesh event tag --
is identified by the hash of its content. same content, same identity.
different content, different identity. like git commits or ipfs cids.

`PayloadCanonical` creates the signed drone payload:

```
{ version: 1, drone: { name, description, grammar, links }, source: { entry, files } }
--> sha-256 --> signature
```

recognition, not accounts.

---

## local memory: opfs

the origin private file system is the browser-native local store.
no server, no cloud -- the data lives in the browser itself.

```
opfs root
  hypercomb.io/            domain root (seed tree)
    Alice/                 seed directory (becomes a hex tile)
    Bob/
  __bees__/                compiled bee modules (by signature)
  __dependencies__/        namespace service bundles (by signature)
  __layers__/              layer installation manifests
  __resources__/           content-addressed blobs (images, JSON)
```

seeds are non-reserved subdirectories under the domain root. folders prefixed with `__` are reserved for the runtime. `Store` manages the opfs handles. `Lineage` tracks the current explorer path and domain context.

---

## package structure

the hive is layered. each ring depends only on the rings inside it.

```
@hypercomb/core          zero dependencies. the framework.
                         Drone, EffectBus, IoC, SignatureService,
                         PayloadCanonical, DroneResolver, KeyMap types.

@hypercomb/essentials    pixi peer dep. the essential drones.
                         organized by domain namespace:

  diamondcoreprocessor.com/
    core/                AxialService, HistoryService, Settings, SelectionService, MeshAdapter
    editor/              TileEditorDrone, TileEditorService, ImageEditorService
    input/               PanningDrone, ZoomDrone, KeyMapService, TileSelectionDrone, InputGate
    nostr/               NostrMeshDrone, NostrSigner, AmbientPresenceDrone
    pixi/                PixiHostDrone, ShowHoneycombWorker, TileOverlayDrone, TileSelectionDrone, Shaders
    screen/              ScreenService, ScreenState
    settings/            SettingsDrone, ZoomSettings

  revolucionstyle.com/
    journal/             CigarJournalDrone, JournalEntryDrone, JournalService
    wheel/               FlavorWheelDrone, FlavorWheelService
    cigar/               Cigar identity, CigarCatalogService
    discovery/           DiscoveryService (Jaccard similarity)

@hypercomb/sdk           facade unifying core primitives and build API.
                         environment-agnostic IoC proxy, IoC key constants,
                         re-exports core types, programmatic build pipeline.

@hypercomb/cli           command-line interface for the framework.
                         `hypercomb build [--local]`, `hypercomb inspect`.

@hypercomb/shared        angular bridge. path aliases.
                         Store (opfs), Lineage (navigation),
                         Navigation, SecretStore, RoomStore,
                         LayerInstaller, BridgeProviders for angular DI.

hypercomb-web            the app. angular shell.
                         home page, setup, service worker.
```

`@hypercomb/core` has zero dependencies and can run anywhere.
`@hypercomb/essentials` adds pixi as a peer dependency for rendering.
domain namespaces within essentials are independent — each is a self-contained
module ecosystem that builds, signs, and deploys as part of the same pipeline.
`@hypercomb/sdk` is a thin facade that re-exports core primitives and provides
an environment-agnostic IoC proxy (auto-detects `window.ioc` in browser,
falls back to core module in Node). `@hypercomb/cli` wraps the sdk for
command-line use (`build`, `inspect`).
`@hypercomb/shared` bridges to angular's dependency injection.
`hypercomb-web` is the final application shell.

---

## ioc container

the inversion-of-control container is minimal and framework-agnostic.

```
register(key, instance)    -- store a service
get(key)                   -- retrieve a service
has(key)                   -- check existence
list()                     -- all registered keys
graph()                    -- dependency + effect wiring map
```

`ServiceToken<T>` provides typed keys in @hypercomb/core.
`window.ioc` provides global convenience (`get`, `register`, `has`, `list`)
via ioc.web.ts in @hypercomb/shared.
bridge providers connect ioc registrations to angular's DI when needed.

---

## session security

- content-addressed signatures replace session nonces.
  the signature of the current domain + explorer path + seed is computed
  on every heartbeat. only drones that resolve the same signature see
  the same mesh events.
- nostr event signing via nip-07 or fallback key provides authenticity.
- mesh events are ttl-backed and auto-expire (default 120s).
  old events are pruned on every heartbeat.
- disposed drones lose all effect subscriptions immediately.

---

## human-only gates (without profiles)

- **tempo guard**: drones execute on heartbeat cadence. unreasonable timing
  is naturally filtered by the sense/heartbeat cycle.
- **content addressing**: you cannot forge a signature without producing
  the exact content. the hash is the proof.

---

## return home

- navigate back up the explorer path (`explorerUp()` on lineage).
- the explorer path is the breadcrumb stack.
- on session end, opfs persists locally. the meadow log remains
  unless the user explicitly clears browser storage.

---

## optional persistence (mesh publishing)

when a path should persist beyond a single session:

- the driver publishes a nostr event with kind 29010,
  tagged with the content-addressed signature of the current location.
- the event contains seed names (local filesystem folders shared
  with the mesh).
- other bees with the same signature see these seeds appear
  as external hex cells on their grid.
- events expire after their ttl. republish to keep them alive.

this is the dna -- a tiny path capsule for shared presence.
