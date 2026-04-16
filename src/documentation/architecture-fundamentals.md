# Architecture Fundamentals

Every primitive described here exists in the codebase today. Nothing is theoretical.

---

## The hive

hypercomb is live-only by default. meaning is created by moving together in real time. there is no global storage, no feeds, and no profiles. presence is permission.

- drones sense and act on every heartbeat — one pulse drives everything
- only bees present right now receive effects
- the effect bus is stateless (last-value-replay pub/sub, stores nothing permanently)
- the nostr mesh relays encrypted frames to decentralized relays
- identity is content-addressed (sha-256 signatures, not accounts)
- optional local memory via opfs (origin private file system)
- optional publishing via mesh when a path should persist

how it feels:

1. arrive at a hex cell (consent to join by navigating there)
2. move together (drones emit tiny effects; linked bees follow)
3. leave any time (disposing ends access immediately)

---

## Metaphor and mechanism

The metaphor layer uses bees, hives, pheromones, and honeycombs. The implementation layer uses drones, effect buses, hex grids, and nostr relays. They are the same system seen from different distances.

| metaphor | implementation |
|---|---|
| bee | `Bee` base class — specialized as `Drone`, `Worker`, or `QueenBee` |
| hive | `Honeycomb` — a named collection of drones and layers |
| pheromone | an effect — a named signal on the `EffectBus` |
| honeycomb cell | `AxialCoordinate` (q, r, s cube coords) rendered via pixi |
| six neighbors | `AxialService.getAdjacentCoordinates()`, nnn bits 0–5 |
| relay (stateless forwarder) | `EffectBus` (local) + `NostrMeshDrone` (network) |
| queen bee | `/command` dispatch, bypasses the pulse cycle |
| swarm intelligence | `BeeResolver` finds relevant bees; each decides via `sense()` |
| meadow log | OPFS directory tree (origin private file system) |
| dna (path capsule) | `PayloadCanonical` — signed drone payload with sha-256 content address |
| the hive's emptiness | zero-dependency `@hypercomb/core` — imports nothing |

---

## Bee lifecycle

Every bee is a `Bee`. Bees come in three flavors:

- **drone** — reactive. pulses every cycle. overrides `sense()` + `heartbeat()`.
- **worker** — bootstrap-once. overrides `ready()` + `act()`. acts once, then dormant.
- **queen bee** — real-time command dispatch. invoked via `/command`. bypasses the processor pulse cycle. overrides `execute(args)`.

All three share the same state machine:

```
Created → Registered → Active → Disposed
```

- **Created** — constructed, not yet known to the container.
- **Registered** — placed in the IoC container (`window.ioc.register`).
- **Active** — has successfully responded to at least one pulse.
- **Disposed** — cleaned up, effect subscriptions removed, done.

Disposal is one-directional. A bee cannot be reactivated.

**Dependency declaration** — bees declare what they need via a `deps` map:

```ts
protected deps = { settings: 'Settings', axial: 'AxialService' }
```

Resolved at runtime through `this.resolve<T>('settings')`.

**Effect participation** — bees declare what they listen for and what they emit:

```ts
listens = ['render:host-ready']
emits = ['mesh:ready', 'mesh:items-updated']
```

---

## The effect bus

Drones do not call each other directly. They communicate through effects — named signals on a shared pub/sub bus (`EffectBus` in `@hypercomb/core`).

```ts
emitEffect('render:host-ready', { app, container, canvas, renderer })
onEffect('render:host-ready', payload => { … })
```

- **last-value replay** — late subscribers still receive the most recent payload. no timing races.
- **auto-cleanup** — when a drone is disposed, all its subscriptions are removed.
- **metadata** — `listens` and `emits` arrays are visible via `window.ioc.graph()`.

The bus has no routing, priorities, or filtering. It is a medium. Bees decide for themselves whether to respond.

### Registered effects

| effect | emitter | purpose |
|---|---|---|
| `render:host-ready` | PixiHostWorker | pixi app, container, canvas, renderer are available |
| `render:mesh-offset` | ShowCellDrone | hex mesh position updated (overlay alignment) |
| `render:cell-count` | ShowCellDrone | current cell count and label list changed |
| `render:presence-heat` | AmbientPresenceDrone | per-cell presence heat map |
| `mesh:ensure-started` | any | trigger nostr mesh initialization for a signature |
| `mesh:subscribe` | any | subscribe to mesh events for a signature |
| `mesh:publish` | any | publish an event to nostr relays |
| `mesh:ready` | NostrMeshDrone | mesh connection established |
| `mesh:items-updated` | NostrMeshDrone | cached mesh items changed |
| `navigation:guard-start` | ShowCellDrone | layer navigation in progress — ignore input |
| `navigation:guard-end` | ShowCellDrone | layer navigation complete — resume input |
| `tile:click` | TileOverlayDrone | user clicked a tile |
| `tile:hover` | TileOverlayDrone | cursor entered a tile |
| `tile:action` | TileOverlayDrone | tile action triggered (edit, remove) |
| `tile:navigate-in` | TileOverlayDrone | navigate into child layer |
| `tile:navigate-back` | TileOverlayDrone | navigate to parent layer |
| `tile:saved` | TileEditorDrone | cell saved after tile editing |
| `selection:changed` | TileSelectionDrone | tile selection set changed |
| `clipboard:captured` | ClipboardWorker | cells captured to clipboard |
| `clipboard:paste-start` | ClipboardWorker | paste beginning |
| `clipboard:paste-done` | ClipboardWorker | paste complete |
| `clipboard:changed` | ClipboardService | clipboard contents mutated |
| `cell:added` | ClipboardWorker | cell directory created during paste |
| `cell:removed` | ClipboardWorker | cell directory removed during cut |
| `swarm:peer-count` | AvatarSwarmDrone | live peer count changed |
| `queen:help` | HelpQueenBee | help command output |

The `synchronize` window event is dispatched only by the processor (`hypercomb.act()`) — no other code dispatches it.

---

## The IoC container

The colony registry. Framework-agnostic. Four operations.

```
register(key, instance, name?)    store a service
get(key)                          retrieve a service
has(key)                          check existence
list()                            all registered keys
graph()                           dependency + effect wiring map
```

`ServiceToken<T>` provides typed keys across package boundaries. `window.ioc` provides global convenience via `ioc.web.ts` in `@hypercomb/shared`. Services self-register at module load time.

---

## The hex grid

Navigation happens on a hexagonal grid defined by three primitives.

**AxialCoordinate** — a single hex cell. three numbers (q, r, s) constrained by q + r + s = 0. carries a pixel-space `Location` computed from `Settings.hexagonSide`.

**AxialService** — the grid builder. `createMatrix()` generates hexagons outward in concentric rings, up to `Settings.rings` deep (default 50). pre-computes an adjacency map so every coordinate knows its six neighbors.

**Settings** — spatial configuration. `hexagonSide = 200` drives all geometry. height = side × 2. width = side × √3. `rings = 50` determines grid extent. `panThreshold = 25` sets input sensitivity. `orientation` toggles between pointy-top (default) and flat-top — the projection math adapts automatically.

Six neighbors of any cell:

| index | direction | delta (q, r, s) |
|---|---|---|
| 0 | northeast | (+1, -1, 0) |
| 1 | east | (+1, 0, -1) |
| 2 | southeast | (0, +1, -1) |
| 3 | southwest | (-1, +1, 0) |
| 4 | west | (-1, 0, +1) |
| 5 | northwest | (0, -1, +1) |

The grid is what the byte protocol navigates. Entering a cell means navigating into that cell's OPFS directory.

---

## Rendering pipeline

**PixiHostWorker** — creates the pixi `Application`, attaches it to the DOM, initializes `AxialService` with `Settings`, and broadcasts `render:host-ready` carrying the app, container, canvas, and renderer.

**ShowCellDrone** — subscribes to `render:host-ready`. unions local OPFS cells with mesh cells, maps them onto axial positions, and renders labeled hex tiles via SDF shaders.

**HexSdfTextureShader** — programmatic signed-distance-field rendering for hex tiles. replaces SVG borders with GPU-computed borders and overlays.

**ZoomDrone** — manages zoom state. uses `ZoomArbiter` for exclusive control (only one input source zooms at a time). tracks min/max scale (0.05–12) and pivot-preserving zoom math. persists viewport zoom/pan snapshots to the current cell's OPFS properties file.

**PanningDrone** — manages panning via a similar exclusive-control pattern. delegates to `MousePanInput`. persists pan offset alongside zoom state.

**InputGate** — shared input exclusivity. only one consumer (mouse pan, touch pan, pinch zoom, tile selection, editor) can be active at a time. `acquire(source)` claims the gate, `release(source)` frees it. suppresses the browser context menu while held.

The pipeline is entirely effect-driven. No bee imports another.

---

## Navigation layer

**Lineage** — tracks the current position. maintains `activeDomain` (default `'hypercomb.io'`), `explorerPath`, and `fsRevision`. provides `explorerEnter(name)`, `explorerUp()`, and `showDomainRoot()`. resolves paths against OPFS segment-by-segment. path traversal is read-only; no automatic directory creation.

**Store** — manages the OPFS root and provides `setCurrent(segments)` / `resetCurrent()`.

**Navigation** — reads and writes the browser URL. `segments()` returns normalized path segments. `getSelections()` parses hash-based selections (`#name` or `#(a,b,c)`). `toggleSelection()` adds or removes from the selection set.

Lineage dispatches `change` events when paths change. It listens to `navigate` and `popstate` events from the browser.

---

## OPFS tree

Local memory. Browser-native. No server, no cloud.

```
opfs root
├── hypercomb.io/            domain root (cell tree)
│   ├── Alice/               cell directory (becomes a hex tile)
│   └── Bob/
├── __bees__/                compiled bee modules (by signature)
├── __dependencies__/        namespace service bundles (by signature)
├── __layers__/              layer installation manifests
├── __resources__/           content-addressed blobs (images, JSON)
└── __history__/             history bags (sequenced operations per lineage)
```

Cells are non-reserved subdirectories under the domain root. Folders prefixed with `__` are reserved for the runtime.

---

## Signatures

Identity is content-addressed. `SignatureService` computes SHA-256 hashes via `crypto.subtle.digest()`. Same content, same identity. Different content, different identity. Like git commits or IPFS CIDs.

For the full primitive — algebra, expansion doctrine, node pattern, genome extension — see [signature-system.md](signature-system.md).

---

## The mesh

**NostrMeshDrone** — connects to nostr relays (default `wss://relay.snort.social`) for cross-device presence.

Core operations:

- `ensureStartedForSig(sig)` — begin querying relays for events matching a signature
- `subscribe(sig, callback)` — receive updates when events arrive
- `publish(kind, sig, payload)` — broadcast an event to all connected relays
- `getNonExpired(sig)` — retrieve cached events that haven't exceeded TTL

Caching: per-signature buckets with configurable TTL (default 120s). Deduplication by event id across relays. Per-signature capacity cap (default 128 items).

Event format: nostr events carry `kind` (default 29010), `tags` (including `['x', signature]` for content addressing), `content` (JSON payload), and standard nostr fields.

Signing via NIP-07 browser extension or fallback `NostrSigner`. Local fanout: publishes are always delivered locally before network send.

---

## The write barrier

Nothing crosses into persistence unless meaning was attached.

The store does not auto-save. The navigation layer reads the URL but does not write history entries automatically. OPFS writes happen only through explicit operations — cell creation via tile editing, layer installation via the install pipeline, history recording via `HistoryService`.

Effects are ephemeral — they exist in the bus until the session ends. Drone state is ephemeral — it exists until disposal.

The only durable state is:

1. OPFS directory structure (explicit writes)
2. Nostr events published to relays (explicit publish)
3. URL path and hash (explicit writes via navigation)
4. Viewport state — zoom/pan snapshots persisted by ZoomDrone and PanningDrone

Everything else is runtime turbulence. If the intent never resolves, nothing persists.

---

## Session security

- Content-addressed signatures replace session nonces. The signature of the current domain + explorer path + cell is computed on every heartbeat. only drones that resolve the same signature see the same mesh events.
- Nostr event signing via NIP-07 or fallback key provides authenticity.
- Mesh events are TTL-backed and auto-expire (default 120s). old events are pruned on every heartbeat.
- Disposed drones lose all effect subscriptions immediately.

---

## Package structure

Each ring depends only on the rings inside it.

```
@hypercomb/core          Zero dependencies. The framework.
                         Bee, EffectBus, IoC, SignatureService,
                         PayloadCanonical, BeeResolver, KeyMap types.

@hypercomb/essentials    Pixi peer dep. Drones organized by domain:

  diamondcoreprocessor.com/
    assistant/           ClaudeBridgeWorker
    clipboard/           ClipboardWorker, ClipboardService
    commands/            CommandPaletteDrone, HelpQueenBee, SlashBehaviourDrone
    editor/              TileEditorDrone, ImageEditorService
    history/             HistoryRecorderDrone, HistoryService
    keyboard/            KeyMapService, DefaultKeymap, EscapeCascade
    move/                MoveDrone, LayoutService
    navigation/          InputGate, HexDetector, BeeToggle
      pan/               PanningDrone, SpacebarPan, TouchPan
      zoom/              ZoomDrone, ZoomArbiter, MousewheelZoom, PinchZoom
      touch/             TouchGestureCoordinator
    preferences/         SettingsDrone, Settings, ZoomSettings
    presentation/        ScreenService
      avatars/           AvatarSwarmDrone, BeeSwarmShader
      background/        BackgroundDrone
      grid/              AxialCoordinate, AxialService, HexGeometry, SDF shader
      tiles/             PixiHostWorker, ShowCellDrone, TileOverlayDrone
    selection/           SelectionService, TileSelectionDrone
    sharing/             NostrMeshDrone, NostrSigner, AmbientPresenceWorker

  revolucionstyle.com/
    journal/             CigarJournalDrone, JournalEntryDrone, JournalService
    wheel/               FlavorWheelDrone, FlavorWheelService
    cigar/               CigarCatalogService
    discovery/           DiscoveryService

@hypercomb/sdk           Facade. Env-agnostic IoC proxy, build API.

@hypercomb/cli           `hypercomb build`, `hypercomb inspect`.

@hypercomb/shared        Angular bridge. Raw source (no build).
                         Store, Lineage, Navigation, SecretStore, RoomStore,
                         LayerInstaller, UI components.

hypercomb-web            Production shell. Runtime drone loading via OPFS.
hypercomb-dev            Developer shell. Dev-time direct drone imports.
```

`@hypercomb/core` has zero dependencies and runs anywhere. `@hypercomb/essentials` adds pixi as a peer dep. Domain namespaces within essentials are independent — each is a self-contained module ecosystem.

---

## Primitive dependency graph

```
Settings
  └─► AxialService (uses hexagonSide, rings)
        └─► AxialCoordinate (uses Settings for Location)

PixiHostWorker
  ├─► deps: Settings, AxialService
  └─► emits: render:host-ready
        ├─► ShowCellDrone
        │     └─► emits: render:mesh-offset, render:cell-count,
        │                navigation:guard-start/end
        ├─► TileOverlayDrone
        │     └─► emits: tile:click, tile:hover, tile:action,
        │                tile:navigate-in/back
        ├─► TileSelectionDrone
        │     └─► emits: selection:changed
        ├─► ZoomDrone
        └─► PanningDrone

NostrMeshDrone
  ├─► deps: NostrSigner
  ├─► listens: mesh:ensure-started, mesh:subscribe, mesh:publish
  └─► emits: mesh:ready, mesh:items-updated

AmbientPresenceDrone ─► emits: render:presence-heat
AvatarSwarmDrone     ─► emits: swarm:peer-count
ClipboardWorker      ─► emits: clipboard:*, cell:added, cell:removed
KeyMapService        ─► listens: navigation:guard-start/end

Store ─► Lineage ─► Navigation
(OPFS)   (paths)    (url)

SignatureService ─► PayloadCanonical
(SHA-256)          (drone signing)
```

Every arrow is either an IoC resolution or an effect subscription. There are no direct imports between bees.

*Twenty primitives. Zero direct coupling. The runtime is a colony of small, focused bees coordinating through scent and registry.*
