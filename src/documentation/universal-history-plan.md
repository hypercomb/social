# Universal History — The Complete Undo/Redo Plan

> **status: partially built (as of 2026-06-18).** The layer-marker core (per-page **leaf-only** commit) and the per-location cursor are shipped; the global cross-hierarchy time clock and the per-op-type universals (markers, full divergence) are **design — not built**. Section headers below mark which is which.

> **Goal**: Every trackable change within the hive is captured as an append-only layer commit. The head layer's slots are the current state. A global time clock is *intended* to let you set any timestamp and navigate the entire hierarchy seeing a coherent snapshot at that moment — an omniscient debugger, a microscope into any point in time.

## Related Documents

- [history-sigbag-as-root.md](history-sigbag-as-root.md) — History sigbag storage model
- [revision-mode.md](revision-mode.md) — Current undo/redo/clock/divergence implementation
- [signature-node-pattern.md](signature-node-pattern.md) — Plug-and-play feature wiring
- [signature-system.md](signature-system.md) — Why payloads must be signature-addressed
- [dna.md](dna.md) — Distributed Network Artifacts: the content-addressed, merkle-versioned layers/deps/bees/resources/content that history commits address
- [trail-capsule.md](trail-capsule.md) — The renamed route/navigation capsule (formerly "DNA path capsule")

---

## The Vision

Nothing is ever deleted. Every operation — cell creation, marker toggle, tag assignment, content edit, drone state change, reorder — appends to the location's history. Locally, everything you author is content-addressed and versioned in OPFS; nothing crosses the network unless you publish. The final state is the head layer's slots — conceptually the replay of all ops:

```
add marker "important"     → marker on
remove marker "important"  → marker off
add marker "important"     → marker on (final state: on)
```

This holds for **any type**. Cells, markers, tags, drones, instructions, content, layout — all follow the same append-only pattern. The type of the thing doesn't matter. What matters is that the operation is recorded.

When you rewind the clock to any timestamp and then navigate through the hive, every location you visit reconstructs its state at that moment. You see exactly what existed, what was visible, what was configured — everywhere, all at once. It becomes a perfect debugger: set the clock to when the bug appeared, navigate to the affected cell, and see the exact state that caused it.

---

## Current State

### The model in production: layer-marker + per-page (leaf-only) commit

The implemented history is **not** per-op-type replay from zero. It is the layer-marker model with **per-page, leaf-only** commit (see [history-sigbag-as-root.md](history-sigbag-as-root.md)):

- A **marker** is a pointer record `{ "layer": "<sig>" }` appended to the lineage's sigbag at the OPFS root (`<lineageSig>/NNNNNNNN`; legacy `__history__/` is a read-fallback drain). The layer bytes themselves live as sig-named files at the OPFS root (legacy `__hive__/` and `__layers__/` are read-fallbacks while they drain).
- `commitLayer(locationSig, layer)` signs the **canonical layer bytes** (`SignatureService.sign` over `JSON.stringify` of the canonicalized layer) to get `layerSig`, writes the layer to the pool, then appends one marker. Identical bytes dedupe (no new marker).
- One user action = **one layer + one marker at the edited leaf**. Per-page commit is **leaf-only**: `LayerCommitter` commits exactly where the change happened and does **not** re-commit ancestors — a parent's stored child sig is left as a stale hint, and a lineage's liveness/current root is resolved on demand from its **own** bag head, never from a parent's stale pointer. Cost is **one marker**, not O(depth) up the spine. The merkle relationship still holds — a subtree's root is `f(child sigs)` — but it is resolved **lazily on read**, not materialized eagerly at commit. (This retired the earlier eager leaf→root commit cascade, which wrote one marker per ancestor on every change; its handlers survive only for graceful migration of pre-existing history.)
- "What's here now" reads the **head layer's slots** (`currentLayerAt` → `getLayerBySig`, children from the `children[]` slot) — not an op-replay from zero. Marker `00000000` is an auto-minted EMPTY `{ name }` layer.

> The genetic ladder, in documentation terms: a cell's lineage bag is its **heredity**; its head layer is the expressed phenotype; the recursive merkle root over a subtree is its **genome**. These are content-addressed [Distributed Network Artifacts](dna.md) — the signature IS the address. None of this is a `dna` field or service; it rides the existing `kind` discriminant.

### Legacy / secondary: per-op-type tracking

The original plan modeled history as discrete typed operations (`HistoryOpType`). This vocabulary is **secondary** — the canonical store is the layer-marker model above. Where typed ops still appear they are folded into layer slots, not replayed as an event log. The historical op set:

| Op Type | Trigger | Source |
|---------|---------|--------|
| `add` | Cell created | `cell:added` effect → HistoryRecorder |
| `remove` | Cell deleted | `cell:removed` effect → HistoryRecorder |
| `reorder` | Cells reordered | OrderProjection.reorder() |
| `instruction-state` | Instruction visibility changed | InstructionDrone.recordState() |
| `tag-state` | Tag assignments changed | `tags:changed` effect → HistoryRecorder |
| `content-state` | Tile content saved | `tile:saved` effect → HistoryRecorder |
| `layout-state` | Layout/geometry changed | `layout:mode`, `render:set-orientation`, `render:set-pivot`, `render:set-gap` effects |
| `hide` | Cell hidden | `tile:hidden` effect → HistoryRecorder |
| `unhide` | Cell made visible | `tile:unhidden` effect → HistoryRecorder |
| `add-drone` | Drone added | Drone registration effect |
| `remove-drone` | Drone removed/disposed | `bee:disposed` effect → HistoryRecorder |

> **No `rename` op.** Cells are immutable atomic units — there is no rename (confirmed in `history-cursor.service.ts`: "there is no rename"). Renaming is delete + create; a same-name sig swap is a **cascade**, not a rename. Any `rename` op below is retired/vestigial.

### Clock capabilities

- **Per-location cursor** (solid): loads one bag and positions within it — this is the load-bearing, shipped piece.
- **Clock scrubbing**: range slider for continuous time navigation within a location
- **Activity log**: human-readable op description at cursor position
- **Global timestamp mode** (partial, as of writing): a `GlobalTimeClock` service holds a session-wide timestamp and a scope toggle exists, but the **cross-bag join is not wired end-to-end** — `stepBack`/`stepForward` take an `allOpsTimestamps` array supplied by the caller rather than discovering op timestamps across all loaded bags themselves. Treat the "every location syncs to one global instant" behavior below as **design intent**, not a verified capability.

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
  // | 'rename'  ← RETIRED: cells are immutable; no rename op (delete+create)
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
| ~~`rename`~~ | — | — | **Retired.** No rename op — cells are immutable atomic units (delete + create; a same-name sig swap is a cascade). |
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

### Step 1 — Foundation (no new op types yet) — PARTIAL
1. ✓ Create `GlobalTimeClock` service, register in IoC
2. ✓ Wire `HistoryCursorService.seekToTime(timestamp)`
3. ✓ Wire navigation to sync cursor with GlobalTimeClock on location change
4. ✓ Update HistorySliderDrone to show global time mode (local/global scope toggle, Ctrl+Shift+G)
5. ☐ **Not wired end-to-end**: cross-bag stepping currently relies on the caller supplying `allOpsTimestamps`. Self-discovering op timestamps across all loaded bags (so "step back across the whole hive" works without a precomputed array) is outstanding.

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
3. ~~`/rename` command~~ — **RETIRED / never shipped.** No `/rename` command, `rename` op, or `cell:renamed` effect exists in the current build (verified: no such symbols in `hypercomb-essentials`). Cells are immutable; renaming is delete + create, and a same-name sig swap is a cascade.
4. ✓ `bee:disposed` wired to record `remove-drone` ops (iocKey in cell field)
5. ✓ Layout-state reconstruction in ShowCellDrone when rewound (orientation, pivot, gap, mode)
6. ~~Rename handling in OrderProjection~~ — moot; there is no rename (see item 3).

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
The `at` field carries a millisecond epoch. The per-location cursor uses this to seek within a bag (solid, shipped). The *global* clock is designed to seek across all bags by the same key — but as noted under Clock capabilities, that cross-bag join is not yet wired end-to-end. The principle holds; the global wiring is outstanding.

### Nothing is deleted
History bags are permanent. Cells are "removed" by appending a remove (a new layer whose `children` slot drops the cell), not by deleting files. The signature addresses the bag; the head layer's slots are the live truth. Locally this is durable by default — the OPFS lineage sigbags plus the root sig files persist without any network round-trip (legacy `__history__`/`__layers__`/`__resources__` dirs remain readable only as drain sources). This is what makes the debugger possible — you can always go back.

---

## The Debugger Promise

> The cross-hierarchy promise below is **design intent**, not a shipped capability — it depends on the global cross-bag clock wiring that is still outstanding (see Clock capabilities). The single-location version of every claim here works today.

Set the clock to 2:34 PM last Tuesday. Navigate to `/projects/website`. See exactly which tiles existed, which markers were active, what tags were assigned, what content was written. Navigate to `/projects/api`. Same moment — see that state too. Navigate anywhere. The entire hive frozen at that instant — that is where this is headed.

Find when a marker disappeared. Find when a tag was removed. Find when content changed. Find when a drone was added. The history bags hold every answer; the per-location cursor already lets you ask the question at any one place, and the global clock is meant to ask it everywhere at once.

This is the architecture working as designed — signatures, bags, append-only layers, and a timestamp meant to unify them all.
