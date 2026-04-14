# Selection as History — Sketch

> **Goal**: Treat selection state as a first-class, undoable operation so the user can rewind not just *what tiles exist* but *what was selected at the time*. Combined with the click-to-add gesture, this gives seamless undo/redo at any level of granularity.

## Related

- [universal-history-plan.md](universal-history-plan.md) — Parent plan; adds `selection-state` to the op vocabulary
- [signature-expansion-doctrine.md](signature-expansion-doctrine.md) — Why the selection payload must be signature-addressed

## The Click-to-Add Gesture

Today: hold Ctrl to drag, click to set single selection.

Proposal: a controls-bar toggle ("multi-select mode"). While active, every plain click on a tile **toggles** that tile in the selection set. Drag (without Ctrl) becomes available the instant any tile is selected — the user clicks to build a group, then drags any selected tile to move the whole set. Ctrl-drag remains the power-user shortcut for users who never touched the toggle.

Why this matters for history: when selection becomes a deliberate, click-driven gesture (not just a transient pointer state), every click is a meaningful op worth recording.

## New Op Type

```typescript
| 'selection-state'
```

| Op | `cell` field | Payload | Undo behavior |
|----|-------------|---------|---------------|
| `selection-state` | Resource signature | `{ version, selected: string[], active: string \| null, at }` | Previous selection restored |

Same shape as `tag-state` and `content-state` — full snapshot post-change, signed, stored as resource, signature in `cell` field. Tolerant replay still works (old clients skip unknown ops).

## Coalescing — The Critical Decision

A naïve "one op per click" floods the bag. Two strategies:

### Option A — Session coalescing (recommended)

Treat a contiguous run of selection-only operations as **one history step**. Open a "selection session" on first selection change; each subsequent toggle within the session updates an in-memory pending snapshot but does **not** append. The session **closes** (and emits the final `selection-state` op) when:

1. A non-selection op arrives (move, edit, tag, etc.) — the selection state at *that moment* gets recorded just before the other op, so undo restores it.
2. A short idle timer elapses (e.g., 1500 ms of no selection activity).
3. Explicit commit signals (escape key, click outside, mode toggle off).

Result: the user clicks five tiles, drags them, undoes once → the drag reverses; undoes again → all five deselect together. One undo per "intent boundary".

### Option B — Separate ephemeral channel

Selection ops live in a parallel ring buffer that never enters the main history bag. Ctrl+Z in selection mode rewinds selection only; Ctrl+Z outside it rewinds the main timeline. Cleaner separation, but loses the "rewind to see what was selected at 2:34pm" capability — and that capability is exactly what makes the universal clock powerful for debugging.

**Recommendation: Option A.** It preserves the universal-clock invariant ("every location reconstructs its full state at any timestamp") and gives the user one mental model for undo.

## Wiring

```typescript
// SelectionService already extends EventTarget and emits 'selection:changed'
EffectBus.emit('selection:changed', { selected, active })

// HistoryRecorder gains a session-coalesced enqueue:
EffectBus.on('selection:changed', payload => this.#openOrUpdateSelectionSession(payload))
EffectBus.on('cell:added' | 'cell:removed' | 'cell:reorder' | 'tile:saved' | ...,
             () => this.#flushSelectionSession())   // boundary: commit pending selection
```

`#openOrUpdateSelectionSession` keeps the latest snapshot in memory and arms the idle timer; `#flushSelectionSession` signs the snapshot, appends one `selection-state` op, and clears pending state.

## Reconstruction at the Cursor

`HistoryCursorService.collectSelectionStateSignature(positionAtCursor)` — same pattern as tag/content reconstruction. Returns the resource signature of the most recent `selection-state` op at or before the cursor, or `null` if none.

`SelectionService` listens to cursor changes (or a dedicated `selection:reconstruct` effect) and, when in revision mode, sets its internal `#items` and `#active` to the reconstructed snapshot. On `goLive`, it restores the live selection.

## Divergence

Selection isn't really a "diff between cursor and head" the way cells are — it's a point-in-time snapshot. So divergence computation doesn't need a `selection` block; the cursor just hands the live SelectionService its time-warped contents while the clock is set.

## Open Questions

1. **Multi-select toggle persistence** — does the controls-bar toggle survive across navigations / refreshes, or reset every visit? (Lean: persist per-session, reset per page load.)
2. **Idle timeout value** — 1500 ms is a guess. Worth instrumenting once it ships.
3. **Visual feedback for the session** — should the controls bar show a "selection pending commit" indicator? Probably not — invisible coalescing is the point.
4. **Touch parity** — touch already long-presses to enter move mode; do we want a separate "tap-to-add" affordance, or skip touch for v1?

## Implementation Order

1. Add the multi-select toggle to ControlsBar; `SelectionService.toggle(label)` already exists, just needs the click wiring.
2. Add `selection-state` to `HistoryOpType`.
3. Implement `#openOrUpdateSelectionSession` / `#flushSelectionSession` in HistoryRecorder.
4. Add `collectSelectionStateSignature` to HistoryCursorService.
5. Wire SelectionService to apply the cursor-time snapshot when in revision mode.
6. Drop the Ctrl gate from desktop-move once any-tile selection is reachable via click — keep Ctrl as a convenience override.
