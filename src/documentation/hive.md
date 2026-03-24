# the hive -- how it works

## entering the hive

when you join the hive, you are not opening a file, profile, or feed -- you are
stepping into a living space of shared presence. the hive is a shared garden of
discoveries, images, stories, questions, insights -- but nothing is stored here
by default. the hive exists only while we are here together.

underneath, the hive is a hexagonal grid. each cell is an `AxialCoordinate`
defined by cube coordinates (q, r, s), and every cell has exactly six neighbors.
`AxialService` builds the grid outward in concentric rings, caching adjacency
lists so any cell can instantly name the six cells that surround it. the grid is
rendered through PixiJS, but to you it is simply the space you move through.

---

## how drones move

drones are the autonomous inhabitants of the hive. each drone follows a
lifecycle -- `Created`, `Registered`, `Active`, `Disposed` -- and carries two
essential abilities: `sense()` and `heartbeat()`.

a drone senses whether the current moment is relevant to it. if it is, its
heartbeat fires -- a single pulse of awareness and action. drones do not call
each other. they do not import each other. they simply exist in the same space,
sensing and acting independently.

movement through the hive happens via tiny flying instructions. each instruction
selects one of six hex neighbors (the byte protocol's nnn bits map directly to
`AxialService.getAdjacentCoordinates()`: northeast, east, southeast, southwest,
west, northwest) and carries a pheromone -- a social or emotional scent. these
instructions are shared only with drones currently present.

---

## drones leave helpful scents (the effect bus)

drones communicate through the EffectBus -- a last-value-replay pub/sub channel
that carries pheromones between drones without any direct coupling.

a drone emits an effect with `emitEffect()`. another drone listens with
`onEffect()`. if the listener arrives after the emitter has already spoken, the
bus replays the last value immediately -- no timing races, no missed signals.
when a drone is disposed, all its subscriptions are cleaned up automatically.

| effect type  | meaning                                       |
|--------------|-----------------------------------------------|
| `filesystem` | something changed in the local meadow (OPFS)  |
| `render`     | a visual change is ready to be drawn           |
| `history`    | the navigation trail shifted                   |
| `network`    | a message arrived from or left for the mesh    |
| `memory`     | in-memory state was updated                    |
| `external`   | something happened outside the hive boundary   |

a real example: `PixiHostWorker` emits `'render:host-ready'` carrying the PixiJS
application, its root container, and the canvas. `ShowCellDrone` subscribes
to that effect, receives the rendering infrastructure, and begins drawing the
honeycomb grid. neither drone imports nor references the other. the effect bus is
the only bridge.

no talking required -- drones understand by moving and sensing together.

---

## how drones go home

drones keep a tiny, local list of inverse steps -- their breadcrumb trail. when
a drone wants to return, it reverses the moves it took. no maps. no stored
coordinates. just memory of the journey.

every path and payload is content-addressed through `SignatureService` -- a
SHA-256 hash that becomes both identity and proof. the breadcrumb trail never
leaves your device, and the signature ensures that what you retrace is exactly
what you walked.

---

## sharing with friends

when a drone finds something meaningful, it can share the path in real time.
`NostrMeshDrone` opens a decentralized relay connection to the Nostr network,
enabling cross-device and cross-instance presence. drones publish seeds to signed
locations and subscribe to discover what others have planted.

only drones who are present in the hive session can follow. outside observers
cannot replay or reconstruct the path. the hive is created by moving together,
not by saving or posting.

---

## why the hive is safe

- the hive is generated live -- nothing is saved unless someone explicitly
  chooses to publish.
- no centralized server stores your paths. the Nostr mesh is a relay, not a
  record.
- only drones currently present receive navigation data.
- identity is visual and social, not login-based or credential-based.
- OPFS (the origin private file system) provides optional local persistence --
  a private meadow log that stays on your device and never crosses the network
  without your explicit action.
- `@hypercomb/core` has zero runtime dependencies. the foundation trusts nothing
  it did not build.

presence is permission.

---

## from metaphor to mechanism

| the story            | the code                                                  |
|----------------------|-----------------------------------------------------------|
| the hive             | hex grid: `AxialCoordinate` (q, r, s), rendered by PixiJS |
| the bees             | drones: `Drone` base class, lifecycle state machine       |
| pheromone scents     | `EffectBus`: last-value-replay typed pub/sub               |
| six neighbors        | `AxialService.getAdjacentCoordinates()`, nnn bits 0-5     |
| the breadcrumb trail | inverse step list, content-addressed via `SignatureService`|
| sharing paths        | `NostrMeshDrone`: decentralized Nostr relay mesh           |
| the meadow log       | OPFS: origin private file system for local persistence     |
| the hive's emptiness | zero-dependency core: `@hypercomb/core` imports nothing    |

for the full technical treatment, see [core-processor-architecture.md](core-processor-architecture.md).

---

## core idea

a hive is not a thing you possess -- it is something we create together by being
here. when we move together, the hive blooms. when we rest, the hive becomes
quiet. meaning lives in our shared presence, not in data stored somewhere else.

the hive is presence itself.
