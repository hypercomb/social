# Revision Mode — Undo, Redo, and the Revision Time Clock

## Overview

Revision mode is the time-travel interface for Hypercomb. It lets you step backward and forward through every operation that has occurred at the current location, see the exact state at any point in time, and optionally restore a past state as the new present.

The system is non-destructive: moving through time never mutates history. The cursor moves; the operations stay.

### Entry points

| Action | Effect |
|--------|--------|
| `/revise` (or `/rev`, `/history`) | Toggle revision mode on/off |
| `Ctrl+Z` | Undo — step backward through history |
| `Ctrl+Y` | Redo — step forward through history |
| `Ctrl+Shift+G` | Toggle local/global time scope |
| `Escape` | Exit revision mode (jump cursor to head, go live) |

---

## Architecture

Seven components work together:

```
HistoryService           — persistent storage (OPFS __history__/ bags)
HistoryRecorder          — listens for effects (cell, tag, content), writes ops
HistoryCursorService     — movable cursor, undo/redo, seekToTime, promote, divergence
GlobalTimeClock          — session-wide timestamp for cross-hierarchy snapshots
HistorySliderDrone       — the revision time clock UI (local/global scope toggle)
ReviseQueenBee           — /revise command (toggle revision mode)
OrderProjection          — derives and caches display order from history ops
```

### Data flow

```
User action (add/remove cell)
  → EffectBus: cell:added / cell:removed
  → HistoryRecorder writes op to __history__/{locationSig}/00000047
  → HistoryCursorService.onNewOp() keeps cursor at latest
  → HistorySliderDrone updates clock display

User presses Ctrl+Z
  → KeyMap fires history.undo
  → HistorySliderDrone calls cursor.undo()
  → Cursor steps back (respecting groupId batching)
  → EffectBus: history:cursor-changed
  → ShowCellDrone reads computeDivergence() → renders ghost/removal overlays
  → Clock updates timestamp and position counter
```

---

## The Revision Time Clock

When revision mode is active and history exists, a compact clock appears in the top-right corner. It shows:

- **Timestamp** — the `at` field of the operation at the current cursor position, formatted as `"Apr 3 2:34:56 PM"`
- **Position counter** — `42/100` meaning cursor is at operation 42 of 100 total
- **Restore button** — appears only when rewound (cursor not at head); clicking it promotes the cursor state to the new head

The clock is the "revision time plot" — you scrub through it by undoing/redoing, and the timestamp tells you exactly when that state existed. The tiles on screen update to show how things looked at that moment.

The clock also shows an **activity label** — a human-readable description of the operation at the current cursor position (e.g., `added "my-tile"`, `tags changed`, `content saved`, `reordered`). This turns the clock into a microscope: you see not just *when* but *what happened* at each step.

### Visibility rules

The clock shows when **both** conditions are met:
1. Revision mode is active (`/revise` has been called)
2. History has at least one operation (`total > 0`)

Exiting revision mode (Escape, `/revise` again) hides the clock and jumps the cursor to head.

---

## History Operations

Every mutation is recorded as a `HistoryOp`:

```typescript
type HistoryOp = {
  op: HistoryOpType
  cell: string        // cell label, or resource signature (for state ops)
  at: number          // Date.now() — millisecond epoch timestamp
  groupId?: string    // optional: batch related ops for grouped undo/redo
}

type HistoryOpType =
  | 'add' | 'remove' | 'reorder' | 'rename'
  | 'add-drone' | 'remove-drone'
  | 'instruction-state' | 'tag-state' | 'content-state' | 'layout-state'
  | 'hide' | 'unhide'
```

### Operation types

| Op | `cell` field | Purpose |
|----|-------------|---------|
| `add` | Cell label | A cell was added at this location |
| `remove` | Cell label | A cell was removed |
| `reorder` | Resource signature | Display order changed; signature resolves to JSON array of cell labels |
| `rename` | Resource signature | Cell renamed; resolves to `{ version, oldName, newName, at }` |
| `instruction-state` | Resource signature | Instruction visibility changed; resolves to InstructionSettings |
| `tag-state` | Resource signature | Tag assignments changed; resolves to `{ version, cellTags, at }` |
| `content-state` | Resource signature | Tile content saved; resolves to `{ version, cellLabel, propertiesSig, at }` |
| `layout-state` | Resource signature | Layout/geometry changed; resolves to `{ version, property, value, at }` |
| `hide` | Cell label | A cell was hidden from view |
| `unhide` | Cell label | A cell was made visible again |
| `add-drone` | Drone IoC key | A drone/bee was added to this location |
| `remove-drone` | Drone IoC key | A drone/bee was removed/disposed |

### Storage format

Operations are stored as numbered files inside OPFS history bags:

```
__history__/
  {locationSig}/          ← SHA-256 of lineage path
    00000001              ← {"op":"add","cell":"My First Tile","at":1672531200000}
    00000002              ← {"op":"add","cell":"Second Tile","at":1672531205000}
    00000003              ← {"op":"reorder","cell":"a1b2c3...","at":1672531210000}
    layer.json            ← materialized layer state snapshot
```

File names are 8-digit zero-padded sequential indices. The sequence is the total order.

---

## Cursor Mechanics

The `HistoryCursorService` holds a position within a location's operation sequence. Moving the cursor changes what is considered "visible" without altering the stored operations.

### CursorState

```typescript
type CursorState = {
  locationSig: string   // which history bag
  position: number      // 1-based; 0 = no history
  total: number         // total ops in the bag
  rewound: boolean      // true if position < total
  at: number            // timestamp of op at cursor (0 if none)
}
```

### Undo and redo

Undo and redo respect **operation groups**. When an op has a `groupId`, all consecutive ops sharing that `groupId` are treated as a single unit:

```
Undo:
  1. Look at the op at (position - 1)
  2. Get its group key: "g:{groupId}" if it has one, or "i:{index}" if individual
  3. Step backward past all ops with the same group key
  4. Seek to the position after the last skipped op

Redo:
  1. Look at the op at position
  2. Get its group key
  3. Step forward past all ops with the same group key
  4. Seek to the position after the last skipped op
```

This means a batch of operations recorded with the same `groupId` (like instruction state changes) undo/redo as one step.

### Seek

`seek(position)` moves the cursor to any absolute position (clamped to `[0, total]`). This is the primitive that undo, redo, and any future scrubbing UI call into.

---

## Divergence Visualization

When the cursor is rewound, tiles diverge into three categories:

| Divergence | Meaning | Visual treatment |
|------------|---------|------------------|
| `0` — current | Cell exists at cursor position | Normal rendering |
| `1` — future add | Cell was added AFTER cursor position | Ghost overlay (semi-transparent) |
| `2` — future remove | Cell exists at cursor but is removed later | Marked for removal |

### How divergence is computed

1. **Replay ops 0 → cursor position** to build the cell set at cursor time
2. **Replay ops cursor → end** to find what changes after
3. Cells that appear only after cursor = `futureAdds`
4. Cells that exist at cursor but disappear later = `futureRemoves`

`ShowCellDrone` listens to `history:cursor-changed` and calls `computeDivergence()` on every cursor move to update the visual state. This lets you see exactly which tiles existed at the cursor's point in time, and which ones came later.

---

## Promote (Restore)

The "Restore" button appears when the cursor is rewound. Clicking it **promotes** the cell state at the cursor position to the head of history. This is the only operation that writes new ops:

1. Compute the cell set at cursor position (replay ops 0 → cursor)
2. Compute the cell set at head (replay all ops)
3. For each cell at head but NOT at cursor: write a `remove` op
4. For each cell at cursor but NOT at head: write an `add` op
5. Write a `reorder` op preserving the display order at cursor time
6. Invalidate the `OrderProjection` cache
7. Reload history and jump cursor to the new head

After promote, the past state becomes the present. All original operations remain in the bag — promote appends new ops that make the head match the desired past state. History is never rewritten.

---

## Order Projection

`OrderProjection` derives the display order of cells from history operations. It walks the operation sequence:

- `add` → append cell to the end of the order list (if not already present)
- `remove` → remove cell from the order list
- `reorder` → resolve the resource signature to a JSON array and replace the order list

The projection caches results per location signature and stays in sync via `cell:added` / `cell:removed` effects for incremental updates. `promote()` calls `evict()` to force a full recompute after restoring a past state.

---

## Global Time Clock

The `GlobalTimeClock` adds a session-wide timestamp that synchronizes all locations. When active, navigating to any location in the hive shows its state at the clock's timestamp — a frozen snapshot across the entire hierarchy.

### Scope modes

| Mode | Behavior | Toggle |
|------|----------|--------|
| **Local** | Cursor moves within the current location's bag only | Default |
| **Global** | All locations sync to a single timestamp; navigating shows state at that moment everywhere | `Ctrl+Shift+G` or click scope label |

### How global time works

1. User enters revision mode (`/revise`) and presses `Ctrl+Shift+G` — scope switches to **global**
2. GlobalTimeClock freezes at the cursor's current timestamp
3. `Ctrl+Z` / `Ctrl+Y` now step through timestamps across all ops in the current bag
4. When user navigates to a different location, `cursor.load()` detects the active global clock and calls `seekToTime(clock.timestamp)` — the new location shows state at that same moment
5. Every location visited reconstructs at the clock's timestamp: which cells existed, which tags were assigned, which content was written
6. Exiting revision mode (`Escape`, `/revise`) calls `goLive()` — all locations return to head state

### The debugger promise

Set the clock to any timestamp. Navigate anywhere in the hive. See exactly what existed at that moment — cells, tags, content, instructions, all coherent at one point in time. This is a microscope into any problem, anywhere, at any time.

---

## Related documents

- [data-primitive.md](data-primitive.md) — The history bag storage model (event sourcing at the file system level)
- [signature-node-pattern.md](signature-node-pattern.md) — How features wire into history for free undo/redo
- [signature-expansion-doctrine.md](signature-expansion-doctrine.md) — Why op payloads use signature references, not inline data
- [universal-history-plan.md](universal-history-plan.md) — The full implementation plan for universal history tracking
