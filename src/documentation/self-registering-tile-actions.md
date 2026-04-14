# Self-Registering Tile Actions

How feature bees register their own tile overlay icons so toggling a feature off in DCP removes both functionality and UI.

## Problem

`TileActionsDrone` hardcoded all tile overlay icons in `ICON_REGISTRY`. When DCP's toggle pipeline disabled a layer (pruning its bees from OPFS), the functionality died but the icons still rendered — clicking them did nothing.

## Solution: Bees Own Their UI

Each feature bee registers its own overlay icon via the `overlay:register-action` EffectBus event. When a bee doesn't load, it never registers, and its icon never appears.

**First migration:** the `edit` action moved from `TileActionsDrone` into `TileEditorDrone`.

### What stays in TileActionsDrone

Actions whose backing service is always loaded (shell/platform-level):

- `command` — command palette lives in shared, always available
- `search` — core tile interaction
- `remove` — core CRUD
- `reroll` — substrate (always loaded)
- `hide` / `break-apart` — core visibility
- `adopt` / `block` — core mesh

### What self-registers

Any action whose feature can be toggled off:

| Action | Bee | Status |
|--------|-----|--------|
| `edit` | `TileEditorDrone` | Done |
| `link` | `TileLinkActionDrone` | Already self-registered (predates this work) |

Future toggleable features follow the same pattern.

## Files Changed

| File | Change |
|------|--------|
| `presentation/tiles/tile-actions.drone.ts` | Removed `edit` from `ICON_REGISTRY`, `DEFAULT_ACTIVE`, `HANDLED_ACTIONS`, `#handleAction` |
| `editor/tile-editor.drone.ts` | Added `EDIT_ICON` descriptor, self-registers via `overlay:register-action` on `render:host-ready` |

## Drone vs Non-Drone Bee

There are two kinds of bee in essentials:

### Drone (extends `Drone` base class)

- Has `sense()`, `heartbeat()`, `dispose()` lifecycle
- Processor pulses it each cycle
- Uses `this.onEffect()` / `this.emitEffect()` (auto-cleanup on dispose)
- Subscriptions happen inside `heartbeat()`, which runs during the processor pulse
- Example: `TileLinkActionDrone`, `TileActionsDrone`, `TileOverlayDrone`

### Non-Drone bee (plain class)

- Self-registers in IoC via constructor side-effect
- Uses `EffectBus.on()` / `EffectBus.emit()` directly
- Constructor runs at bee load time (before the processor pulse)
- Example: `TileEditorDrone`, workers, services

This distinction matters for the timing of `overlay:register-action`.

## The EffectBus Timing Issue

`EffectBus` stores a single `lastValue` per effect key. When a handler subscribes to an effect that has already been emitted, it replays the most recent value. This creates a race when multiple emitters target the same effect:

```
1. Editor bee loads (constructor)
   → EffectBus.on('render:host-ready', cb)
   → Replay fires cb immediately
   → cb emits 'overlay:register-action' with EDIT_ICON
   → lastValue['overlay:register-action'] = EDIT_ICON

2. Processor pulse begins
   → TileActionsDrone.heartbeat()
     → this.onEffect('render:host-ready', ...)
     → Replay fires, calls async #loadArrangementAndRegister()

3. TileOverlayDrone.heartbeat()
   → this.onEffect('overlay:register-action', handler)
   → Replay fires with lastValue — but what's stored?

4. TileActionsDrone's async finishes
   → emits 'overlay:register-action' with [command, reroll, remove, ...]
   → lastValue['overlay:register-action'] = [array]    ← overwrites EDIT_ICON
```

If step 4 happens before step 3, the overlay's replay only sees the array — `EDIT_ICON` is lost.

### The fix for non-Drone bees

Defer the emission to the next macrotask with `setTimeout(0)`:

```typescript
#registerIcon = (): void => {
  if (this.#iconRegistered) return
  this.#iconRegistered = true
  setTimeout(() => EffectBus.emit('overlay:register-action', EDIT_ICON), 0)
}
```

`setTimeout(0)` guarantees the emission runs after all synchronous work in the current event loop turn — including the processor pulse where `TileOverlayDrone` subscribes. The overlay receives the emission live rather than via replay.

### Why Drone bees don't need this

Drone subclasses register effects inside `heartbeat()`, which runs during the processor pulse — the same synchronous call stack where the overlay subscribes. The overlay's `this.onEffect('overlay:register-action', ...)` replays the last stored value at subscription time, AND receives any subsequent live emissions in the same pulse. Since `TileActionsDrone`'s actual emission is async (it reads arrangement from OPFS first), Drone-based emitters like `TileLinkActionDrone` emit synchronously during replay before the async overwrite happens.

## Recommended Refactor

`TileEditorDrone` should eventually extend `Drone` so it participates in the processor lifecycle. This eliminates the `setTimeout(0)` workaround and aligns with the established pattern:

```typescript
// TARGET STATE (refactor)
export class TileEditorDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'tile editor — edit icon + open/save/cancel'

  protected override listens = ['render:host-ready', 'tile:action']
  protected override emits = ['overlay:register-action']

  #registered = false
  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect('render:host-ready', () => {
      if (this.#registered) return
      this.#registered = true
      this.emitEffect('overlay:register-action', EDIT_ICON)
    })

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (payload.action !== 'edit') return
      void this.#openEditing(payload.label)
    })
  }

  // ... rest of save/cancel logic unchanged
}
```

This mirrors `TileLinkActionDrone` exactly. The `setTimeout(0)` approach works and is correct for non-Drone bees, but extending `Drone` is the canonical pattern.

## Pattern Summary for New Features

When adding a toggleable feature that needs a tile overlay icon:

1. Define an `OverlayActionDescriptor` with `owner` set to your IoC key
2. Listen for `render:host-ready`
3. Emit `overlay:register-action` with your descriptor
4. Handle `tile:action` events for your action name

If your bee **extends Drone**: use `this.onEffect()` / `this.emitEffect()` inside `heartbeat()`. No timing workaround needed.

If your bee is a **plain class**: use `EffectBus.on()` for the listener, and wrap the emission in `setTimeout(0)` to defer past the processor pulse.

## Build Cache Warning

The essentials build system caches compiled bees in `dist/.cache/` keyed by content hash. If the cache contains stale entries (e.g., from a different branch), source changes won't appear in the output. Symptoms: `build:essentials` reports `N cached, 0 built` even after editing source files.

Fix: `rm -rf hypercomb-essentials/dist/.cache` then rebuild. The cache is safe to delete — it regenerates on the next build.
