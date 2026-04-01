# Simple Naming Initiative

Human-readable naming conventions for code that humans need to audit.

## Principles

1. **Verb-first**: `load.devices` not `devices.load` — reads like English
2. **Machine modeling**: Name the object, then the action — `this.selection.add(label)`
3. **Consistency over cleverness**: Pick one pattern per category and stick to it

---

## Proposals

### 1. Verb-First Operation Grouping

Group common verbs as namespace objects so the verb leads.

```typescript
// Instead of:
journal.setCigar(cigar)
journal.setRating(field, value)
journal.setNotes(notes)

// Consider:
journal.set.cigar(cigar)
journal.set.rating(field, value)
journal.set.notes(notes)
```

**When to apply**: Services with 4+ operations sharing a verb (`set`, `load`, `add`, `remove`).

### 2. Machine-Object Modeling for IoC Deps

Use short dep aliases so consuming code reads as machine.action().

```typescript
// Drone deps:
deps = { selection: '@diamondcoreprocessor.com/SelectionService' }

// Usage reads naturally:
this.selection.add(label)
this.selection.toggle(label)
this.selection.clear()
```

**Status**: Many drones already do this implicitly. Formalize as convention.

### 3. Consistent Verb Tense in Effects

Standardize on two tenses:
- **Past tense** for events that happened: `selection:changed`, `journal:saved`
- **Imperative** for commands/requests: `loader:start`, `navigation:guard`

Avoid gerunds (`loading`, `updating`) in effect names.

### 4. Drop `get` Prefix for Pure Queries

```typescript
// Instead of:
navigation.getSelections()
keymap.getEffective()

// Just:
navigation.selections()
keymap.effective()
```

Reserve `get` for async fetches involving I/O (`getBee()`, `getOrFetchManifest()`).

### 5. Async Convention

Async operations that do I/O keep explicit verbs: `fetch`, `load`, `install`, `resolve`.
Sync operations use short nouns/adjectives. No need for `Async` suffix — the verb signals it.

### 6. Boolean Query Convention

```typescript
get suppressed(): boolean     // bare adjective — good
selection.has(label)          // instead of isSelected
rect.contains(x, y)          // instead of isInsideRect
```

Reserve `is*` for simple state checks. Prefer domain verbs (`has`, `contains`, `supports`) when they read better.

### 7. Handler Naming

- `on*` — exclusively for external event handlers: `#onKeyDown`, `#onPointerUp`
- `#notify` / `#changed` — internal state-change notifications

---

## Priority Order

1. **Machine-object modeling** (#2) — highest readability gain, lowest risk
2. **Drop `get` prefix** (#4) — simple, consistent
3. **Verb-first grouping** (#1) — biggest structural change, apply selectively
4. **Effect tense** (#3) — small cleanup pass
5. **Boolean queries** (#6) — minor consistency win
6. **Async convention** (#5) — most subjective, needs discussion

---

## Next Iteration Ideas

### 8. Context-Aware Method Shortening

Method names should lean on the class/service name for context instead of repeating it.

```typescript
// ScriptPreloader already tells you the domain:
#scanDirectoryForMarkers()  →  #scanMarkers()
#loadBeeBySignature(sig)    →  #loadBee(sig)

// HistoryService already tells you the domain:
getHistoryRoot()            →  root()

// LayerInstaller already tells you the domain:
#installLayers()            →  #layers()   // or keep verb if ambiguous
#installDependencies()      →  #deps()
```

**Rule**: If the class name already contains the noun, the method doesn't need it again.

### 9. Nullable Return Convention: `try*` vs `*OrNull`

Currently `try*` is used inconsistently — sometimes it means "nullable return," sometimes "swallows errors."

```typescript
// Make intent explicit:
tryResolveFrom()     →  resolveFrom()       // returns T | null (nullable is default)
#tryReadText()       →  #readTextOrNull()   // explicit nullable
#tryLoadBee()        →  #loadBee()          // throws on real errors, null on "not found"
```

**Rule**: Methods return `null` by default for "not found." Only add `OrNull` suffix when the non-nullable version also exists. Reserve `try` for error-swallowing wrappers only.

### 10. Signal Suffix Convention (`$`)

Angular signals bridged from `EventTarget` use `$` inconsistently.

```typescript
// Current mix:
#moved$    // has $
#idle      // no $
#hovered   // no $

// Standardize:
#moved$    // ✓ signal/observable
#idle$     // ✓ signal/observable
#hovered$  // ✓ signal/observable
```

**Rule**: All `Signal`, `WritableSignal`, and `fromRuntime()` bridged values get the `$` suffix. Plain fields do not.

### 11. Effect Name Structure: `domain:past-tense` / `domain:imperative`

Audit current effect names against proposal #3:

| Current | Tense | Proposed |
|---------|-------|----------|
| `mesh:ensure-started` | imperative (compound) | `mesh:start` (command) |
| `mesh:items-updated` | past | `mesh:updated` (keep) |
| `render:host-ready` | past | `render:ready` (shorter) |
| `loader:bees-progress` | noun | `loader:progressed` or `loader:bee-loaded` |
| `loader:bees-done` | past | `loader:loaded` |
| `tile:navigate-in` | imperative | `tile:enter` (simpler verb) |
| `tile:navigate-back` | imperative | `tile:exit` (pair with enter) |

**Rule**: One word after the colon when possible. Compound verbs signal over-specificity.

### 12. Consistent Explorer/Navigation Verb Families

Lineage and Navigation both deal with movement but use different verbs:

```typescript
// Lineage uses "explorer*" prefix:
explorerEnter(), explorerUp(), explorerLabel(), explorerDir()

// Navigation uses bare verbs:
go(), goRaw(), back(), forward(), move()
```

Model as machines:

```typescript
// Lineage — the explorer IS the machine:
this.explorer.enter(cell)
this.explorer.up()
this.explorer.label()
this.explorer.dir()

// Navigation — movement IS the machine:
this.nav.go(path)
this.nav.back()
this.nav.forward()
```

**Rule**: If a service has 3+ methods sharing a prefix, extract the prefix as a sub-object (machine).

### 13. IoC Key Shorthand Registry

Frequently resolved IoC keys are long. Consider a well-known aliases map:

```typescript
// Current:
window.ioc.get('@hypercomb.social/Store')
window.ioc.get('@diamondcoreprocessor.com/AxialService')

// With aliases:
window.ioc.get('store')        // shorthand
window.ioc.get('axial')        // shorthand
```

**Caution**: Only for shell-level services with high call frequency. Module-level services keep full keys for namespace safety.

---

## Status

These proposals are conventions to adopt incrementally during normal development. Apply them when touching a file for other reasons — no dedicated refactoring pass required.
