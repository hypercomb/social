# glossary

> quick reference from metaphor to mechanics. lowercase to match project style.

---

## metaphor layer

these terms define the user-facing language. they predate the current architecture and remain the canonical vocabulary for communication, ui, and documentation.

### hive
a live session. not a page, feed, or file. exists only while people are present. the spatial representation of a hive is the hex grid (see **axial coordinate**).

### bee
a participant in the hive. identity is visual/social (recognizable avatar), not accounts. implemented as a **drone** in the architecture.

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
stateless forwarder for encrypted frames. stores nothing; can enforce minimal rate/jitter. in the current architecture, drone-to-drone relay is handled by the **effect bus**. network relay uses the **nostr mesh**.

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

### drone
the architectural implementation of a **bee**. autonomous unit with a defined lifecycle. base class: `Drone` in `@hypercomb/core`. key methods: `sensed()`, `heartbeat()`, `emitEffect()`, `onEffect()`. a drone declares its dependencies, grammar, effects, and provider links.

### drone state
lifecycle enum for a drone. four states:
- `Created` -- constructed, not yet registered.
- `Registered` -- placed in the ioc container.
- `Active` -- has processed at least one encounter.
- `Disposed` -- cleaned up, effect subscriptions removed.

### effect bus
last-value-replay pub/sub system. the in-process equivalent of the metaphor **relay**. singleton `EffectBus` in `@hypercomb/core`. api: `emit()`, `on()`, `once()`, `clear()`. subscribers receive the most recent payload immediately on subscribe (eliminates timing races).

### effect
typed union describing the category of side-effect a drone may produce.
values: `'filesystem'` | `'render'` | `'history'` | `'network'` | `'memory'` | `'external'`.

### grammar hint
structured vocabulary entry for a drone's intent. interface with `example` (string) and optional `meaning` (string). used to describe what stimuli a drone responds to.

### provider link
metadata about an external resource a drone references. has `label`, `url`, optional `trust` level (`'official'` | `'community'` | `'third-party'`), and optional `purpose`.

### source
provider metadata describing where a drone or artifact originates. has `label`, `url`, optional `trust` level (`'official'` | `'community'` | `'third-party'`), and optional `disclaimerUrl`.

### axial coordinate
the hex grid cell. cube coordinates `(q, r, s)` with 6 neighbors. this is the spatial structure of the **hive**. uses cantor pairing for index hashing. location computed from `q`, `r`, `s` and hexagon side length. defined in `@hypercomb/essentials`.

### axial service
manages the hex matrix. creates rings via spiral enumeration, builds adjacency lists, and provides closest-coordinate lookup. registers itself in the ioc container as `'AxialService'`.

### ioc container
inversion-of-control registry. `ServiceToken<T>`-based registration and resolution. api: `register()`, `get()`, `has()`, `list()`. lives on `window.ioc`. drones and services register here for cross-cutting resolution.

### service token
typed key for ioc resolution. `ServiceToken<T>` wraps a string key and optional angular type reference. any object with a `.key` string property is duck-type compatible.

### signature service
sha-256 content addressing. takes an `ArrayBuffer`, produces a deterministic 64-character hex string. used to sign **drone payload v1** artifacts and **dna** commitments.

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
zero-dependency framework layer. exports: `Drone`, `DroneState`, `EffectBus`, `Effect`, `GrammarHint`, `Source`, `ProviderLink`, `SignatureService`, `PayloadCanonical`, `DronePayloadV1`, ioc (`register`, `get`, `has`, `list`, `ServiceToken`).

### @hypercomb/essentials
concrete drones and services. depends on `@hypercomb/core`. pixi.js is a peer dependency. contains: `AxialCoordinate`, `AxialService`, `NostrMeshDrone`, pixi host and rendering drones, input drones (pan, zoom).

### @hypercomb/shared
angular integration bridge. path-aliased, not published to npm. provides `bridgeProviders()`, shared tokens, and angular-side services that delegate to the ioc container.

### nostr mesh
decentralized relay layer implemented by `NostrMeshDrone` in `@hypercomb/essentials`. uses `nostr-tools` and websocket connections to public relays. provides subscribe/publish over nostr events keyed by content signature (`x` tag). ttl-backed cache with per-sig expiry rules. this is the network-level equivalent of the metaphor **relay**.

### opfs
origin private file system. browser-native local storage api. used for persisting hive data, images, and drone artifacts without a traditional backend. accessed through the `navigator.storage.getDirectory()` api.

---

## cross-reference

| metaphor | architecture equivalent |
|---|---|
| bee | drone |
| hive (spatial) | axial coordinate grid |
| relay (local) | effect bus |
| relay (network) | nostr mesh |
| dna integrity | signature service |
| dna capsule format | drone payload v1 |
| neighbor (nnn) | axial coordinate adjacency (6 edges) |
