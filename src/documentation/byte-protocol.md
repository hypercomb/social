# byte protocol

## the idea

a bee doesn't carry a map. it carries a direction, a scent, and enough memory to know whether it's still going or done. that's the byte protocol: one byte per navigation step. no headers, no schemas, no negotiation. just 8 bits that tell a drone where to fly next on the hex grid.

the hex grid has six edges. three bits address all six. that leaves five bits for everything else a drone needs to decide: which pheromone trail it's following, whether it should keep going or stop, and whether the path branches.

one byte. one step. a trail is just an array of them.

---

## bit layout

```
  7   6   5   4   3   2   1   0
 [mm     ] [pp     ] [d ] [nnn        ]
  mode      phero    dir   neighbor
```

| field | bits | range | meaning |
|-------|------|-------|---------|
| `nnn` | 0-2 | 0-5 | neighbor index (6 hex edges) |
| `d` | 3 | 0-1 | direction (0 = backward, 1 = forward) |
| `pp` | 4-5 | 0-3 | pheromone hint |
| `mm` | 6-7 | 0-3 | mode |

values 6 and 7 in the `nnn` field are invalid (a hexagon has exactly 6 neighbors). bytes with `nnn > 5` are dropped silently.

---

## neighbor mapping to axial coordinates

the `nnn` bits (0-5) map directly to the six neighbors returned by `AxialService.getAdjacentCoordinates()` in `@hypercomb/essentials`. the order is fixed and matches cube coordinate offsets on the hex grid:

```
nnn   name        delta (q, r, s)     direction on grid
---   ---------   ----------------    -----------------
 0    northeast   (+1, -1,  0)        upper-right
 1    east        (+1,  0, -1)        right
 2    southeast   ( 0, +1, -1)        lower-right
 3    southwest   (-1, +1,  0)        lower-left
 4    west        (-1,  0, +1)        left
 5    northwest   ( 0, -1, +1)        upper-left
```

this is the same order used in `AxialService.getAdjacentCoordinates()`:

```typescript
// from axial-service.ts in @hypercomb/essentials
public getAdjacentCoordinates = (axial: AxialCoordinate): AxialCoordinate[] => {
  return [
    this.newCoordinate(axial.q + 1, axial.r - 1, axial.s), // 0: northeast
    this.newCoordinate(axial.q + 1, axial.r,     axial.s - 1), // 1: east
    this.newCoordinate(axial.q,     axial.r + 1, axial.s - 1), // 2: southeast
    this.newCoordinate(axial.q - 1, axial.r + 1, axial.s), // 3: southwest
    this.newCoordinate(axial.q - 1, axial.r,     axial.s + 1), // 4: west
    this.newCoordinate(axial.q,     axial.r - 1, axial.s + 1), // 5: northwest
  ]
}
```

given a current `AxialCoordinate`, resolving the next cell is one array lookup:

```typescript
const neighbors = axialService.getAdjacentCoordinates(current)
const next = neighbors[nnn] // nnn from the byte
```

the constraint `q + r + s = 0` is preserved by every delta. this is intrinsic to cube coordinates and does not need to be validated at runtime.

---

## direction bit

the `d` bit modifies how the `nnn` neighbor is interpreted:

| d | meaning | behavior |
|---|---------|----------|
| 0 | backward | the drone is retracing. the neighbor index is read from the trail in reverse. used for backtracking and return-to-hive. |
| 1 | forward | the drone is advancing. standard forward navigation along the trail. |

backward does not invert the neighbor index itself. it signals that the drone should interpret the current byte as a return step, allowing trail replay in reverse order without rewriting the byte sequence.

---

## pheromone bits

pheromones are the scent markers that bees leave on the grid. in hypercomb, they map to visual cues rendered by pixi and to effect payloads carried over the `EffectBus`.

| pp | name | meaning | effectbus mapping |
|----|------|---------|-------------------|
| 00 | neutral | no scent. the cell is unremarkable. | no effect emitted |
| 01 | beacon | attraction. "come this way." | `emitEffect('pheromone:beacon', payload)` |
| 10 | avoid | repulsion. "stay away from here." | `emitEffect('pheromone:avoid', payload)` |
| 11 | priority | strong attraction. "this is important." | `emitEffect('pheromone:priority', payload)` |

### effectbus integration

when a drone decodes a byte with a non-neutral pheromone, it emits a typed effect through the `EffectBus` from `@hypercomb/core`. other drones subscribe to these effects and react accordingly.

```typescript
import { EffectBus } from '@hypercomb/core'

interface PheromonePayload {
  coordinate: { q: number; r: number; s: number }
  pheromone: 'beacon' | 'avoid' | 'priority'
  source: string // drone name
}

// emitting (inside a drone's heartbeat)
this.emitEffect('pheromone:beacon', {
  coordinate: { q: next.q, r: next.r, s: next.s },
  pheromone: 'beacon',
  source: this.name,
})

// subscribing (another drone listening)
this.onEffect<PheromonePayload>('pheromone:beacon', (payload) => {
  // highlight the cell, adjust pathfinding weight, etc.
})
```

the `EffectBus` provides last-value replay, so a drone that subscribes after a pheromone has been laid still receives the most recent value. this eliminates timing races between trail-layers and trail-followers.

### rendering guidance

pheromone visuals are rendered by pixi on the hex grid. suggested mappings:

| pheromone | visual treatment |
|-----------|-----------------|
| neutral | default cell appearance. no overlay. |
| beacon | soft glow or pulse. warm color (amber/gold). |
| avoid | desaturated or dimmed. cool color (grey/blue). optional warning pattern. |
| priority | bright highlight with animated pulse. hot color (orange/white). |

these are hints, not mandates. the rendering drone owns the final visual decision.

---

## mode bits

the mode bits control drone lifecycle behavior. they map directly to the drone state machine defined in `Drone` from `@hypercomb/core`:

| mm | name | meaning | drone behavior |
|----|------|---------|----------------|
| 00 | end | trail terminates here. | the drone calls `markDisposed()`. state becomes `DroneState.Disposed`. effect subscriptions are cleaned up. |
| 01 | continue | trail continues. keep flying. | the drone's `heartbeat()` runs on the next pulse. state remains `DroneState.Active`. |
| 10 | branch | trail forks. spawn a new path. | the drone emits the remaining trail as a new effect. a new drone (or the same drone on a new pass) picks up the fork. |
| 11 | reserved | undefined. | treat as `continue` (01). log a warning. do not crash. |

### mode and drone lifecycle

```
                  encounter()
  Created ──> Registered ──> Active ──> Disposed
                               |            ^
                               |  mm=00     |
                               +────────────+
                               |
                               |  mm=01
                               +──> heartbeat() ──> Active (loop)
                               |
                               |  mm=10
                               +──> emitEffect('trail:fork', ...) ──> new drone
```

the `branch` mode (10) is how trails split. a drone encountering a branch byte emits the sub-trail as an effect. this uses the same `EffectBus` mechanism as pheromones:

```typescript
this.emitEffect('trail:fork', {
  origin: { q: current.q, r: current.r, s: current.s },
  trail: remainingBytes, // Uint8Array of the branch path
  pheromone: currentPheromone,
})
```

---

## typescript helpers

### pack

```typescript
function packByte(
  neighbor: number,   // 0-5
  direction: number,  // 0 = backward, 1 = forward
  pheromone: number,  // 0-3
  mode: number,       // 0-3
): number {
  if (neighbor < 0 || neighbor > 5) throw new RangeError(`invalid neighbor: ${neighbor}`)
  if (direction < 0 || direction > 1) throw new RangeError(`invalid direction: ${direction}`)
  if (pheromone < 0 || pheromone > 3) throw new RangeError(`invalid pheromone: ${pheromone}`)
  if (mode < 0 || mode > 3) throw new RangeError(`invalid mode: ${mode}`)

  return (mode << 6) | (pheromone << 4) | (direction << 3) | neighbor
}
```

### unpack

```typescript
interface ByteStep {
  neighbor: number    // 0-5
  direction: number   // 0 | 1
  pheromone: number   // 0-3
  mode: number        // 0-3
}

function unpackByte(byte: number): ByteStep {
  return {
    neighbor:  byte & 0b00000111,
    direction: (byte >> 3) & 0b00000001,
    pheromone: (byte >> 4) & 0b00000011,
    mode:      (byte >> 6) & 0b00000011,
  }
}
```

### trail walker

walk a byte trail across the hex grid, resolving each step to an `AxialCoordinate`:

```typescript
function walkTrail(
  start: AxialCoordinate,
  trail: Uint8Array,
  axialService: AxialService,
): AxialCoordinate[] {
  const path: AxialCoordinate[] = [start]
  let current = start

  for (const byte of trail) {
    const step = unpackByte(byte)

    // drop invalid neighbors
    if (step.neighbor > 5) continue

    // resolve next cell
    const neighbors = axialService.getAdjacentCoordinates(current)
    const next = neighbors[step.neighbor]
    path.push(next)
    current = next

    // handle mode
    if (step.mode === 0) break // end
    // mode 1 (continue): keep going
    // mode 2 (branch): caller handles fork
    // mode 3 (reserved): treat as continue
  }

  return path
}
```

---

## error handling

| condition | response |
|-----------|----------|
| `nnn > 5` | drop the byte. do not advance. do not throw. |
| `mm = 11` (reserved) | treat as `continue` (01). log a warning for diagnostics. |
| repeated identical steps (same coordinate, same direction) | debounce. ignore duplicates within a single trail walk. |
| coordinate outside the grid | the `AxialService.items` map won't contain it. the walker should check membership and stop or skip. |
| empty trail (`Uint8Array` length 0) | return `[start]`. the drone stays where it is. |

---

## trail as a data structure

a trail is a `Uint8Array`. each byte is one step. the entire navigation path from origin to destination (or fork) is a compact sequence:

```typescript
// a 4-step trail: go east, east, southeast (beacon), then end
const trail = new Uint8Array([
  packByte(1, 1, 0, 1), // east, forward, neutral, continue
  packByte(1, 1, 0, 1), // east, forward, neutral, continue
  packByte(2, 1, 1, 1), // southeast, forward, beacon, continue
  packByte(2, 1, 0, 0), // southeast, forward, neutral, end
])
```

4 steps. 4 bytes. no overhead.

---

## the bridge

the byte protocol is the bridge between the metaphor layer (bees flying between cells) and the spatial layer (cube coordinates on a hex grid). the metaphor gives us intuition. the grid gives us math. the byte gives us a wire format that costs almost nothing to store, almost nothing to transmit, and almost nothing to decode.

a drone reads a byte, looks up a neighbor, moves, and either keeps going or stops. that's the whole thing.

---

## related documents

- [architecture-critique.md](./architecture-critique.md) — analysis of the current hypercomb architecture
- [core-processor-architecture.md](./core-processor-architecture.md) — core processor design
- [dependency-resolution.md](./dependency-resolution.md) — how drones resolve dependencies

## source files

- `@hypercomb/essentials` axial coordinate: `hypercomb-essentials/src/diamondcoreprocessor.com/core/axial/axial-coordinate.ts`
- `@hypercomb/essentials` axial service: `hypercomb-essentials/src/diamondcoreprocessor.com/core/axial/axial-service.ts`
- `@hypercomb/core` effect bus: `hypercomb-core/src/effect-bus.ts`
- `@hypercomb/core` drone base: `hypercomb-core/src/drone.base.ts`
- `@hypercomb/core` effect types: `hypercomb-core/src/effect.ts`
