# Universal History — The Complete Undo/Redo Plan

> **Goal**: Every trackable operation within the hive is recorded as an append-only history op. Replay from zero to head produces the current state. A global time clock lets you set any timestamp and navigate the entire hierarchy seeing a perfect snapshot at that moment — an omniscient debugger, a microscope into any point in time.

## Related Documents

- [data-primitive.md](data-primitive.md) — History bag storage model
- [revision-mode.md](revision-mode.md) — Current undo/redo/clock/divergence implementation
- [signature-node-pattern.md](signature-node-pattern.md) — Plug-and-play feature wiring
- [signature-expansion-doctrine.md](signature-expansion-doctrine.md) — Why payloads must be signature-addressed

---

## The Vision

Nothing is ever deleted. Every operation — cell creation, marker toggle, tag assignment, content edit, drone state change, reorder, rename — appends an op to the location's history bag. The final state is always the replay of all ops:

```
add marker "important"     → marker on
remove marker "important"  → marker off
add marker "important"     → marker on (final state: on)
```

This holds for **any type**. Cells, markers, tags, drones, instructions, content, layout — all follow the same append-only pattern. The type of the thing doesn't matter. What matters is that the operation is recorded.

When you rewind the clock to any timestamp and then navigate through the hive, every location you visit reconstructs its state at that moment. You see exactly what existed, what was visible, what was configured — everywhere, all at once. It becomes a perfect debugger: set the clock to when the bug appeared, navigate to the affected cell, and see the exact state that caused it.

---

## Current State (Fully Implemented)

All phases of the universal history plan have been completed. The following operations are now tracked:

| Op Type | Trigger | Source |
|---------|---------|--------|
| `add` | Cell created | `cell:added` effect → HistoryRecorder |
| `remove` | Cell deleted | `cell:removed` effect → HistoryRecorder |
| `reorder` | Cells reordered | OrderProjection.reorder() |
| `rename` | Cell renamed | `/rename` command → `cell:renamed` effect |
| `instruction-state` | Instruction visibility changed | InstructionDrone.recordState() |
| `tag-state` | Tag assignments changed | `tags:changed` effect → HistoryRecorder |
| `content-state` | Tile content saved | `tile:saved` effect → HistoryRecorder |
| `layout-state` | Layout/geometry changed | `layout:mode`, `render:set-orientation`, `render:set-pivot`, `render:set-gap` effects |
| `hide` | Cell hidden | `tile:hidden` effect → HistoryRecorder |
| `unhide` | Cell made visible | `tile:unhidden` effect → HistoryRecorder |
| `add-drone` | Drone added | Drone registration effect |
| `remove-drone` | Drone removed/disposed | `bee:disposed` effect → HistoryRecorder |

### Clock capabilities

- **Per-location cursor**: loads one bag and positions within it
- **Global timestamp mode**: `GlobalTimeClock` synchronizes all locations to a session-wide timestamp
- **Scope toggle**: switch between local and global time (Ctrl+Shift+G)
- **Clock scrubbing**: range slider for continuous time navigation
- **Activity log**: human-readable op description at cursor position

---

## The Plan

### Phase 1: Universal Operation Types

Expand `HistoryOpType` to cover all trackable mutations. Every new type follows the signature-node pattern — complex payloads are signature-addressed resources, simple payloads use the `cell` field directly.

```typescript
export type HistoryOpType =
  // Cell lifecycle
  | 'add'
  | 'remove'
  | 'reorder'
  | 'rename'
  // Drone lifecycle
  | 'add-drone'
  | 'remove-drone'
  // Feature state (signature-addressed payloads)
  | 'instruction-state'
  | 'tag-state'
  | 'content-state'
  | 'layout-state'
  // Visibility markers
  | 'hide'
  | 'unhide'
```

#### Op semantics

| Op | `cell` field | Payload | Undo behavior |
|----|-------------|---------|---------------|
| `tag-state` | Resource signature | `{ version, cellTags: Record<cellLabel, string[]>, at }` | Previous tag assignments restored |
| `content-state` | Resource signature | `{ version, cellLabel, propertiesSig, at }` | Previous content restored |
| `layout-state` | Resource signature | `{ version, property, value, at }` | Previous layout restored |
| `rename` | Resource signature | `{ version, oldName, newName, at }` | Previous name restored |
| `hide` | Cell label | — | Cell becomes visible |
| `unhide` | Cell label | — | Cell becomes hidden |
| `add-drone` | Drone IoC key | — | Drone removed from location |
| `remove-drone` | Drone IoC key | — | Drone restored to location |

### Phase 2: Wire HistoryRecorder to All Effects ✓ DONE

The HistoryRecorder now listens to all trackable effects:

```typescript
// Cell lifecycle
EffectBus.on('cell:added',          payload => this.#enqueue('add', payload.cell))
EffectBus.on('cell:removed',        payload => this.#enqueue('remove', payload.cell, payload.groupId))
EffectBus.on('cell:reorder',        payload => this.#enqueueReorderState(payload.labels))

// Feature state (signature-node pattern)
EffectBus.on('tags:changed',        payload => this.#enqueueTagState(payload.updates))
EffectBus.on('tile:saved',          payload => this.#enqueueContentState(payload.cell))

// Visibility markers
EffectBus.on('tile:hidden',         payload => this.#enqueue('hide', payload.cell))
EffectBus.on('tile:unhidden',       payload => this.#enqueue('unhide', payload.cell))
this.onEffect('layout:changed',  payload => this.#enqueueLayoutState(payload))
```

Each `#enqueue*` method follows the signature-node pattern:
1. **Capture** the current state as a deterministic JSON blob
2. **Sign** it — store as resource in OPFS, get signature
3. **Record** the history op with the signature in the `cell` field

### Phase 3: Divergence Computation for All Types

Currently `computeDivergence()` only tracks cell add/remove to build `current`, `futureAdds`, `futureRemoves` sets. Generalize it:

```typescript
type UniversalDivergenceInfo = {
  // Cell divergence (existing)
  cells: {
    current: Set<string>
    futureAdds: Set<string>
    futureRemoves: Set<string>
  }
  // Marker divergence (NEW)
  markers: {
    current: Map<string, Set<string>>     // cellLabel → active marker ids
    futureAdds: Map<string, Set<string>>
    futureRemoves: Map<string, Set<string>>
  }
  // Tag divergence (NEW)
  tags: {
    atCursor: Map<string, string[]>       // cellLabel → tags at cursor time
    atHead: Map<string, string[]>         // cellLabel → tags at head
  }
  // Content divergence (NEW)
  content: {
    changed: Set<string>                  // cells whose content differs cursor vs head
  }
}
```

The rendering layer uses this to show:
- Ghost overlays for future cells (existing)
- Dimmed markers that don't exist yet at cursor time
- Tag badges that reflect cursor-time tags, not head tags
- Content that matches cursor-time version

### Phase 4: Global Time Clock

This is the transformative piece. Today the cursor is per-location — it loads one bag and positions itself within it. The global time clock adds a **session-wide timestamp** that synchronizes all locations:

#### Architecture

```typescript
interface GlobalTimeClock extends EventTarget {
  /** null = live mode (no time override). number = frozen timestamp */
  readonly timestamp: number | null

  /** Set the global clock. All locations sync to this time. */
  setTime(timestamp: number): void

  /** Return to live mode. All locations show head state. */
  goLive(): void

  /** Step backward across ALL locations (find previous op across all bags) */
  stepBack(): void

  /** Step forward across ALL locations */
  stepForward(): void
}
```

#### How it works

1. **User enters revision mode** (`/revise`) — revision clock appears
2. **User presses Ctrl+Z** — instead of just moving the local cursor, the GlobalTimeClock steps to the previous timestamp across all loaded bags
3. **GlobalTimeClock emits `time:changed`** with the new timestamp
4. **HistoryCursorService listens** — when GlobalTimeClock has a timestamp, `load(locationSig)` seeks to the last op at or before that timestamp (binary search on `at` field)
5. **User navigates to another location** — cursor loads that location's bag and automatically seeks to the GlobalTimeClock timestamp
6. **Every location visited shows state at that exact moment in time**

#### The clock slider

The HistorySliderDrone evolves from showing position/total to showing:
- **Absolute timestamp** (already exists)
- **Global indicator** — when in global time mode, shows a clock icon
- **Scrubbing** — drag to move through time continuously
- **Scope toggle** — switch between "this location" and "global time"

#### Seeking by timestamp

Add to HistoryCursorService:

```typescript
/** Seek to the last op at or before the given timestamp */
seekToTime(timestamp: number): void {
  const targetPos = this.#ops.findLastIndex(op => op.at <= timestamp) + 1
  this.seek(targetPos)  // 0 if no ops before timestamp
}
```

When GlobalTimeClock is active and user navigates:
```
User navigates to /chemistry/organic
  → cursor.load(locationSig)
  → GlobalTimeClock.timestamp is set (not null)
  → cursor.seekToTime(globalClock.timestamp)
  → Location shows state at that global moment
```

### Phase 5: Cross-Hierarchy Snapshot

When the global clock is set to a timestamp, every operation in the system is filtered to that moment. This means:

- **Cells**: only cells added before timestamp and not removed before timestamp are visible
- **Markers**: only markers active at that timestamp
- **Tags**: tag assignments as they were at that timestamp
- **Content**: content version that was current at that timestamp
- **Instructions**: instruction visibility as configured at that timestamp
- **Layout**: geometry/orientation as set at that timestamp
- **Drones**: drone set as it was at that timestamp

Walking the hierarchy with the clock set is walking through a frozen moment in the hive's entire history. Every folder, every cell, every marker — all coherent at one point in time.

---

## Implementation Order

### Step 1 — Foundation (no new op types yet) ✓ DONE
1. ✓ Create `GlobalTimeClock` service, register in IoC
2. ✓ Wire `HistoryCursorService.seekToTime(timestamp)` 
3. ✓ Wire navigation to sync cursor with GlobalTimeClock on location change
4. ✓ Update HistorySliderDrone to show global time mode (local/global scope toggle, Ctrl+Shift+G)

### Step 2 — Marker operations
1. Define `marker-add` and `marker-remove` op types
2. Emit `marker:added` / `marker:removed` effects from marker drones
3. Wire HistoryRecorder to listen and record
4. Update divergence computation for markers
5. Update rendering to respect marker divergence

### Step 3 — Tag operations ✓ DONE
1. ✓ Define `tag-state` op type with full cell tag snapshots
2. ✓ Follow signature-node pattern: read full tag arrays post-change → sign → record
3. ✓ Wire to `tags:changed` effect
4. ✓ HistoryCursorService.collectTagStateSignatures() for reconstruction
5. ✓ ShowCellDrone reads cursor-time tag state when rewound (overrides cellTagsCache)

### Step 4 — Content operations ✓ DONE
1. ✓ Define `content-state` op type with propertiesSig capture
2. ✓ Wire to `tile:saved` effect (captures propertiesSig from localStorage index)
3. ✓ HistoryCursorService.opsAtCursor('content-state') for reconstruction
4. ✓ ShowCellDrone uses cursor-time props index override in loadCellImages when rewound

### Step 5 — Layout and remaining operations ✓ DONE
1. ✓ Define `layout-state` op type
2. ✓ Wire layout-state recording from `layout:mode`, `render:set-orientation`, `render:set-pivot`, `render:set-gap` effects
3. ✓ `/rename` command created — copies OPFS directory, records `rename` op with signature-addressed `{ oldName, newName }`, emits `cell:renamed` effect
4. ✓ `bee:disposed` wired to record `remove-drone` ops (iocKey in cell field)
5. ✓ Layout-state reconstruction in ShowCellDrone when rewound (orientation, pivot, gap, mode)
6. ✓ Rename handling in OrderProjection (replaces old name with new name in order list)

### Step 6 — Polish ✓ DONE
1. ✓ Clock scrubbing UI — range slider beneath the clock, drag to seek any position
2. ✓ Global vs local scope toggle (Ctrl+Shift+G, clickable scope label)
3. ✓ Performance: cursor-time reconstruction cached by `locationSig:position` key — skips redundant OPFS reads
4. ✓ Activity log: human-readable op description at cursor position in the clock UI

---

## Design Principles

### Append-only, always
Never rewrite history. New state = new op appended. Promote = append ops that make head match cursor. The bag only grows.

### Signature-node pattern for every op
Complex payloads are ALWAYS resource signatures. Simple payloads (cell label, drone key) go directly in the `cell` field. No exceptions. See [signature-node-pattern.md](signature-node-pattern.md).

### Tolerant replay
Unknown op types are skipped during replay. Old clients that don't understand `tag-state` still reconstruct cell state correctly. New op types are additive, never breaking.

### GroupId for atomicity
Related operations share a `groupId`. Undo/redo treats the group as one step. Example: pasting 5 cells = 5 `add` ops with one `groupId` = one undo step.

### Timestamp is the universal key
The `at` field on every op is `Date.now()` — millisecond epoch. The global clock uses this to seek across all bags. Operations don't need to know about each other. They just need truthful timestamps.

### Nothing is deleted
History bags are permanent. Cells are "removed" by appending a `remove` op, not by deleting files. The signature addresses the bag; the contents are the complete truth. This is what makes the debugger possible — you can always go back.

---

## The Debugger Promise

Set the clock to 2:34 PM last Tuesday. Navigate to `/projects/website`. See exactly which tiles existed, which markers were active, what tags were assigned, what content was written. Navigate to `/projects/api`. Same moment — see that state too. Navigate anywhere. The entire hive is frozen at that instant.

Find when a marker disappeared. Find when a tag was removed. Find when content changed. Find when a drone was added. The history bags hold every answer. The clock lets you ask the question.

This is not a feature. This is the architecture working as designed — signatures, bags, append-only ops, and a timestamp that unifies them all.
