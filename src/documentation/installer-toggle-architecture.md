# Installer Toggle Architecture

How the DCP toggle pipeline works, what "fully off" means, and what must change so every drone can be toggled cleanly.

## The Toggle Pipeline

```
User clicks toggle in DCP UI
  → Angular component writes layer.json { enabled: false }
  → BroadcastChannel message to sentinel iframe (embedded in web)
  → Sentinel recomputes sync manifest
    → reads each layer.json for enabled state
    → maps bees to their parent layer
    → excludes disabled layers' bees from the manifest
  → MessagePort sends new manifest to web host
  → web: resyncFromSentinel() diffs OPFS against manifest
    → deletes bees not in manifest (disabled layer's bees)
    → writes new bees if any added
  → sync signature changes → page reload
  → on reload: import map built from surviving OPFS bees
  → ScriptPreloader loads only those bees
  → bees self-register in IoC via constructor side-effect
  → processor pulses surviving drones
```

**Result:** disabled layer's code never loads. No classes instantiate, no IoC keys exist, no EffectBus listeners subscribe.

## What "Fully Off" Means

A toggled-off drone must produce **zero observable difference** from never having existed:

| Concern | Mechanism | Status |
|---------|-----------|--------|
| Code doesn't load | OPFS pruning removes bees | Done (pipeline) |
| IoC keys don't exist | Bees self-register in constructor; no constructor = no key | Done (inherent) |
| EffectBus listeners absent | Same — constructor never runs | Done (inherent) |
| **Tile overlay icons don't appear** | Self-registration via `overlay:register-action` | **Partially done** (edit only) |
| **Slash behaviours don't appear** | Self-registration via `addProvider()` | **Not started** |
| **Keyboard shortcuts don't fire** | Self-registration via `addLayer()` | **Not started** |
| **Controls bar buttons don't appear** | Self-registration or dynamic visibility | **Not needed yet** |

The first three rows are free — the pipeline handles them. The last four are UI registration surfaces where features can leak through when their backing code is gone.

## UI Registration Surfaces

### 1. Tile Overlay Actions (`overlay:register-action`)

**Current state:** Partially migrated. `edit` self-registers from `TileEditorDrone`. `link` already self-registered (predates this work). Remaining actions in `TileActionsDrone` (`command`, `search`, `reroll`, `remove`, `hide`, `break-apart`, `adopt`, `block`) are platform-level and always loaded.

**Pattern:** Emit `overlay:register-action` with an `OverlayActionDescriptor` on `render:host-ready`. The overlay drone accumulates descriptors and renders them. No descriptor = no icon.

**Who owns the icon = who must register it.** If a feature can be toggled off, its icon registration must live in that feature's bee, not in a shared registry.

### 2. Slash Behaviours (`SlashBehaviourDrone.addProvider()`)

**Current state:** All 20+ providers are hardcoded in `slash-behaviour.drone.ts` (lines 606–631). The providers are inner classes defined in the same file. This is the largest gap.

**Problem:** If the `commands` layer is toggled off, the entire slash behaviour system disappears — that's correct since slash behaviours are a commands-layer feature. But individual providers reference functionality from other layers:

- `MeetingProvider` → meeting layer
- `VoiceProvider`, `PushToTalkProvider` → recording layer
- `ChatProvider`, `LlmProvider` → assistant layer
- `MoveProvider` → move layer
- `SubstrateProvider`, `RerollProvider` → substrate layer
- `AtomizeUiProvider` → assistant layer
- `RecordingProvider` → recording layer

If the meeting layer is off but commands is on, `/meeting` still appears in autocomplete. It won't crash (the IoC lookup returns null, the behaviour likely no-ops), but it's visible when it shouldn't be.

**Fix:** Each layer's bee registers its own slash behaviours via `addProvider()` at load time. The `SlashBehaviourDrone` keeps only platform-level providers (help, clear, debug). Feature providers move into their respective layer's bees.

### 3. Keyboard Shortcuts (`KeyMapService.addLayer()`)

**Current state:** `KeyMapService` uses a layer stack. The `default-keymap.ts` defines a base set of bindings. Individual features can call `addLayer()` to add context-specific shortcuts.

**Assessment:** This is already structured correctly — `addLayer()` is called at runtime, so if the bee doesn't load, its shortcuts never register. The only risk is if `default-keymap.ts` includes shortcuts for toggleable features. Need to audit.

### 4. Controls Bar (`CONTROL_REGISTRY`)

**Current state:** Hardcoded array in `controls-bar.component.ts` (shared). All 14 items use `visibleWhen` conditions like `'always'`, `'clipboardHasItems'`, `'voiceSupported'`, `'public'`.

**Assessment:** The controls bar lives in `hypercomb-shared` (shell level, always loaded). Its items map to shell-level concerns (zoom, fullscreen, navigation, lock). Currently no controls bar button maps to a toggleable essentials layer. If one were added in the future, it would need either:
- A `visibleWhen` condition that checks IoC for the backing service
- A self-registration pattern (controls bar accepts dynamic entries via EffectBus)

**No changes needed now**, but the registration pattern should be designed before adding feature-specific controls.

## Drone vs Non-Drone Bee

### Drone (extends `Drone` from `@hypercomb/core`)

```typescript
export class MyFeatureDrone extends Drone {
  protected override heartbeat = async (): Promise<void> => {
    this.onEffect('render:host-ready', () => {
      this.emitEffect('overlay:register-action', MY_ICON)
    })
  }
}
```

- Processor calls `heartbeat()` during the pulse cycle
- `this.onEffect()` / `this.emitEffect()` auto-cleanup on `dispose()`
- Subscriptions happen in the same synchronous pulse as other drones
- No timing workaround needed for `overlay:register-action`
- **This is the canonical pattern.** New bees that register UI should extend Drone.

### Non-Drone bee (plain class)

```typescript
export class TileEditorDrone {
  constructor() {
    EffectBus.on('render:host-ready', this.#registerIcon)
  }
  #registerIcon = (): void => {
    setTimeout(() => EffectBus.emit('overlay:register-action', EDIT_ICON), 0)
  }
}
```

- Constructor runs at bee load time (before the processor pulse)
- Uses `EffectBus.on()` directly — replays immediately at subscribe time
- Must defer `overlay:register-action` with `setTimeout(0)` to avoid the single-slot `lastValue` race
- No automatic cleanup — must manually manage subscriptions

### Why the timing matters

`EffectBus.lastValue` stores **one value per effect key**. When the editor emits `overlay:register-action` and then `TileActionsDrone` emits the same key with its batch array, the array overwrites the editor's value. When `TileOverlayDrone` later subscribes, replay only delivers the array.

`setTimeout(0)` pushes the emission to the next macrotask — after all synchronous heartbeat subscriptions complete — so the overlay receives it as a live event, not via replay.

Drone subclasses avoid this because their `heartbeat()` runs in the same synchronous pulse. The overlay's `this.onEffect()` replays the last value AND receives subsequent emissions in the same call stack.

## The Refactor Roadmap

### Immediate (this PR)

- [x] `edit` action self-registers from `TileEditorDrone`
- [x] Removed from `TileActionsDrone` ICON_REGISTRY, DEFAULT_ACTIVE, HANDLED_ACTIONS

### Short-term

- [ ] Convert `TileEditorDrone` from plain class to `extends Drone` (removes `setTimeout(0)` workaround)
- [ ] Audit `default-keymap.ts` for shortcuts tied to toggleable features

### Medium-term

- [ ] Move feature-specific slash providers out of `slash-behaviour.drone.ts` into their own layer's bees
  - Meeting provider → meeting layer
  - Voice/PushToTalk providers → recording layer
  - Chat/LLM providers → assistant layer
  - Move provider → move layer
  - Substrate/Reroll providers → substrate layer
  - Atomize provider → assistant layer
  - Recording provider → recording layer
- [ ] Design a self-registration pattern for slash behaviours (likely `SlashBehaviourDrone.addProvider()` called from each feature bee at load time, mirroring `overlay:register-action`)

### Long-term

- [ ] If controls bar ever needs feature-specific buttons, add a `controls:register-action` EffectBus event following the overlay pattern
- [ ] Audit all UI surfaces for any remaining hardcoded references to toggleable features

## The Rule

**If a feature can be toggled off, every piece of its UI must be registered by its own bee.** No shared registry, no hardcoded list, no conditional visibility check against IoC. The bee loads → it registers. The bee doesn't load → nothing to register. The toggle pipeline already guarantees the loading part. Self-registration guarantees the UI part.

## Build Cache

The essentials build caches compiled bees in `dist/.cache/` by content hash. When switching branches or making source changes that don't change the file's hash (e.g., the cache was populated from a stale branch), the build serves cached output.

**Symptom:** `build:essentials` reports `N cached, 0 built` even though source files changed.

**Fix:** `rm -rf hypercomb-essentials/dist/.cache` then rebuild.
