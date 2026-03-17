# glossary

> quick reference from metaphor to mechanics. lowercase to match project style.

---

## metaphor layer

these terms define the user-facing language. they predate the current architecture and remain the canonical vocabulary for communication, ui, and documentation.

### hive
a live session. not a page, feed, or file. exists only while people are present. the spatial representation of a hive is the hex grid (see **axial coordinate**).

### bee
a participant in the hive. identity is visual/social (recognizable avatar), not accounts. implemented as a **bee** (`Bee` base class) in the architecture, specialized as **drone** or **worker**.

### driver
the bee currently steering. emits 1-byte steps.

### link / unlink
consent to join or leave a driver's live path. leaving ends access immediately.

### instruction byte
the single byte that encodes movement + intent.
layout: `mm pp d nnn` (2 | 2 | 1 | 3 bits).

### neighbor (nnn)
relative move within the hex layer (0-5). values 6-7 are invalid. the hex edges map to the 6 adjacencies in **axial coordinate** space.

### direction (d)
`0 = backward` (retracing), `1 = forward` (exploring).

### pheromone (pp)
ephemeral ui hint, not a score.
`00 neutral`, `01 happy/beacon`, `10 caution/avoid`, `11 treasure/priority`.

### mode (mm)
flow control: `00 end`, `01 continue`, `10 branch`, `11 reserved`.

### breadcrumb
tiny local stack of inverse moves for return-home. never leaves the device.

### meadow log
optional local record a driver may keep. used to publish dna. not synced by default.

### dna (path capsule)
a byte stream + integrity commitment (and optional attestations/anchor) that makes a route publicly reproducible. content-addressed via **signature service**. see also **drone payload v1**.

### relay
stateless forwarder for encrypted frames. stores nothing; can enforce minimal rate/jitter. in the current architecture, bee-to-bee relay is handled by the **effect bus**. network relay uses the **nostr mesh**.

### session nonce
short-lived random value binding movement to the current moment; rotates on join/interval.

### tempo guard
edge checks on step timing/jitter to deter bots without profiling.

### micro-gesture check
rare, tiny human-presence proof (e.g., small pointer nudge) when behavior looks automated.

### attestation
signatures over a dna commitment (creator-only, creator+cohort, or community threshold).

### anchor
optional on-chain reference to prove when a dna commitment existed.

---

## architecture layer

these terms describe the implemented system. they live in code and map back to the metaphor layer where noted.

### bee (architecture)
the base class for all autonomous behavior units. `Bee` in `@hypercomb/core` (`bee.base.ts`). defines lifecycle (`BeeState`), dependency declaration (`deps` + `resolve()`), effect participation (`emitEffect()`, `onEffect()`), and metadata. specialized as **drone** (reactive) or **worker** (bootstrap-once). self-registers in IoC at module load.

### drone
reactive bee. extends `Bee`. overrides `sense(grammar)` (relevance gate) and `heartbeat(grammar)` (main logic). `pulse()` fires on every processor cycle — sense first, then heartbeat if relevant. class: `Drone` in `@hypercomb/core` (`drone.base.ts`).

### worker
bootstrap-once bee. extends `Bee`. overrides `ready(grammar)` (gate) and `act(grammar)` (one-time action). `pulse()` checks `ready()` until true, runs `act()` once, then goes dormant. class: `Worker` in `@hypercomb/core` (`worker.base.ts`).

### bee state
lifecycle enum for a bee (`BeeState`). four states:
- `Created` -- constructed, not yet registered.
- `Registered` -- placed in the ioc container.
- `Active` -- has processed at least one successful pulse.
- `Disposed` -- cleaned up, effect subscriptions removed.

### effect bus
last-value-replay pub/sub system. the in-process equivalent of the metaphor **relay**. singleton `EffectBus` in `@hypercomb/core`. api: `emit()`, `on()`, `once()`, `clear()`. subscribers receive the most recent payload immediately on subscribe (eliminates timing races).

### effect
typed union describing the category of side-effect a bee may produce.
values: `'filesystem'` | `'render'` | `'history'` | `'network'` | `'memory'` | `'external'`.

### grammar hint
structured vocabulary entry for a bee's intent. interface with `example` (string) and optional `meaning` (string). used to describe what stimuli a drone responds to.

### provider link
metadata about an external resource a bee references. has `label`, `url`, optional `trust` level (`'official'` | `'community'` | `'third-party'`), and optional `purpose`.

### source
provider metadata describing where a bee or artifact originates. has `label`, `url`, optional `trust` level (`'official'` | `'community'` | `'third-party'`), and optional `disclaimerUrl`.

### axial coordinate
the hex grid cell. cube coordinates `(q, r, s)` with 6 neighbors. this is the spatial structure of the **hive**. uses cantor pairing for index hashing. location computed from `q`, `r`, `s` and hexagon side length. defined in `@hypercomb/essentials`.

### axial service
manages the hex matrix. creates rings via spiral enumeration, builds adjacency lists, and provides closest-coordinate lookup. registers itself in the ioc container as `'AxialService'`.

### ioc container
inversion-of-control registry. `ServiceToken<T>`-based registration and resolution. api: `register()`, `get()`, `has()`, `list()`. lives on `window.ioc`. bees and services register here for cross-cutting resolution.

### service token
typed key for ioc resolution. `ServiceToken<T>` wraps a string key and optional angular type reference. any object with a `.key` string property is duck-type compatible.

### signature service
sha-256 content addressing. takes an `ArrayBuffer`, produces a deterministic 64-character hex string. used to sign **drone payload v1** artifacts and **dna** commitments.

### signature store
central allowlist of verified signatures. `SignatureStore` in `@hypercomb/core`. populated from `install.manifest.json` at install time (all known bee/dep/layer sigs) and persisted to `localStorage`. `isTrusted(sig)` skips re-hashing for known signatures. `signText(text)` memoizes repeated SHA-256 calls (e.g., lineage path → location signature computed multiple times per render cycle). `verify(bytes, expectedSig)` returns true if trusted or if hash matches (and auto-trusts for future). serializable via `toJSON()` / `restore()` for cross-session persistence.

### drone payload v1
the canonical payload format for drone artifacts. structure:
- `version: 1`
- `drone` -- name, description, grammar hints, provider links, effects.
- `source` -- entry point and file map.

content-addressed via `PayloadCanonical.compute()` which produces a signature and canonical json.

### bridge providers
angular di providers that delegate resolution to `window.ioc`. generated by `bridgeProviders()` in `@hypercomb/shared`. each provider maps an angular class token to a factory that calls `window.ioc.get(key)`.

### shared token
lightweight duck-type of `ServiceToken` used in `@hypercomb/shared`. interface with `key` (string) and `ngType` (angular class). avoids a hard dependency on `@hypercomb/core`.

### @hypercomb/core
zero-dependency framework layer. exports: `Bee`, `BeeState`, `Drone`, `Worker`, `EffectBus`, `Effect`, `GrammarHint`, `Source`, `ProviderLink`, `SignatureService`, `SignatureStore`, `PayloadCanonical`, `DronePayloadV1`, `BeeResolver`, ioc (`register`, `get`, `has`, `list`, `ServiceToken`). `SignatureStore` is the trusted-signature allowlist — populated at install time, persisted to localStorage, and used to skip redundant SHA-256 verification at load time.

### @hypercomb/essentials
concrete bees (drones + workers) and services, organized by domain namespace. depends on `@hypercomb/core`. pixi.js is a peer dependency. domain namespaces include `diamondcoreprocessor.com` (core rendering, input, mesh) and `revolucionstyle.com` (cigar journal, flavor wheel, discovery). each domain is an independent module ecosystem within the same build pipeline.

### @hypercomb/sdk
facade package unifying core primitives and the build api. re-exports `Bee`, `Drone`, `Worker`, `EffectBus`, `SignatureService`, and ioc types from `@hypercomb/core`. provides an environment-agnostic `ioc` proxy that auto-detects `window.ioc` in browser or falls back to the core module in node. exports ioc key constants for both framework-level and shared-level services. `buildModules(options)` spawns the essentials build pipeline programmatically. built as dual-format (esm + cjs) via tsup.

### @hypercomb/cli
command-line interface for the framework. wraps `@hypercomb/sdk` for terminal use. commands: `hypercomb build [--local]` (build essentials modules), `hypercomb inspect [--keys|--registry]` (list ioc key constants or live registry). built as esm with shebang via tsup.

### @hypercomb/shared
angular integration bridge. path-aliased, not published to npm. provides `bridgeProviders()`, shared tokens, and angular-side services that delegate to the ioc container.

### keymap service
layered keyboard shortcut engine. bees push and pop `KeyMapLayer` instances to register context-specific bindings. supports multi-step chord sequences (`KeyChord`) and priority-sorted layer stacks. suspends during navigation guards. types (`KeyChord`, `KeyBinding`, `KeyMapLayer`) are defined in `@hypercomb/core`; the service implementation lives in `@hypercomb/essentials`.

### ambient presence
passive presence tracking via the nostr mesh. `AmbientPresenceDrone` aggregates mesh activity into a per-cell heat map and emits `render:presence-heat`. the hex sdf shader uses heat values to tint tiles, making collective attention visible without profiles or accounts.

### tile selection drone
programmatic hex overlay for multi-select. `TileSelectionDrone` in `@hypercomb/essentials` (`input/selection/tile-selection.drone.ts`). ctrl+click toggles a tile; ctrl+drag range-selects. first selected tile becomes the **leader** (amber overlay), others are green. emits `selection:changed` with leader info and relative axial coordinates for computational irreducibility math. listens to `render:host-ready`, `render:mesh-offset`, `render:cell-count`.

### tile editor drone
seed editing drone. `TileEditorDrone` in `@hypercomb/essentials` (`editor/tile-editor.drone.ts`). provides seed creation and property editing. emits `tile:saved` when a seed is persisted.

### hex sdf shader
signed-distance-field shader for rendering hex tiles in pixi.js. `HexSdfTextureShader` in `@hypercomb/essentials` (`pixi/hex-sdf.shader.ts`). replaces the original svg-based borders with gpu-computed hex outlines and overlays. supports both pointy-top and flat-top orientations. samples from the label atlas and image atlas to render text and images clipped to the hex boundary. branch indicators and selection highlights are drawn as sdf rings.

### navigation guard
a pair of effects (`navigation:guard-start`, `navigation:guard-end`) emitted by `ShowHoneycombWorker` during layer transitions. while a guard is active, tile overlay and selection bees ignore clicks, and `KeyMapService` suspends bindings. prevents input during the incremental mesh rebuild.

### secret store
shared secret state in `@hypercomb/shared`. persists a single value in `localStorage` (`hc:secret`). on first access, captures any subdomain-derived secret from the url for mesh room joining. exposed in the controls bar ui via a lock icon.

### room store
shared room state in `@hypercomb/shared`. manages the current room identity and secret for mesh participation. provides room controls (join, leave, secret management) in the controls bar ui.

### input gate
shared input exclusivity service in `@hypercomb/essentials` (`input/input-gate.service.ts`). ensures only one input consumer (e.g., panning, selection, editor) has control at a time. also suppresses the browser context menu when an input source is active. drones call `acquire(source)` / `release(source)` to coordinate.

### hex orientation
the grid supports two hex orientations: **pointy-top** (default) and **flat-top**. toggled via a header bar control. the orientation propagates through `Settings` to all input drones (hex detection, panning, selection) and rendering drones (sdf shader, tile overlay). the coordinate math adapts automatically — flat-top swaps the projection axes.

### domain namespace
the organizational unit within `@hypercomb/essentials`. each domain (e.g. `diamondcoreprocessor.com`, `revolucionstyle.com`) groups related bees, services, and resources into namespaces. domains are independent — they share the build pipeline and core primitives but never import from each other at the source level. at runtime, each domain's namespaces are resolved via the import map.

### nostr mesh
decentralized relay layer implemented by `NostrMeshDrone` in `@hypercomb/essentials`. uses `nostr-tools` and websocket connections to public relays. provides subscribe/publish over nostr events keyed by content signature (`x` tag). ttl-backed cache with per-sig expiry rules. this is the network-level equivalent of the metaphor **relay**.

### opfs
origin private file system. browser-native local storage api. used for persisting hive data, images, and bee artifacts without a traditional backend. accessed through the `navigator.storage.getDirectory()` api.

---

## cross-reference

| metaphor | architecture equivalent |
|---|---|
| bee | `Bee` (base), `Drone` (reactive), `Worker` (one-shot) |
| hive (spatial) | axial coordinate grid |
| relay (local) | effect bus |
| relay (network) | nostr mesh |
| dna integrity | signature service |
| dna capsule format | drone payload v1 |
| neighbor (nnn) | axial coordinate adjacency (6 edges) |
