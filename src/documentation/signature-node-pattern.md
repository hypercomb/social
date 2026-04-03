# Signature Node Pattern — Plug-and-Play Implementation Guide

> **Copy-paste this node template. Wire the three methods. Your feature is signature-addressed.**

## Related Critical Documents

- [signature-expansion-doctrine.md](signature-expansion-doctrine.md) — Why every fragment must be signature-addressed
- [collapsed-compute.md](collapsed-compute.md) — Why this pattern makes compute collapse to zero at scale
- [core-primitive.md](core-primitive.md) — The signature-payload pair
- [deterministic-computation.md](deterministic-computation.md) — Authenticity composition

---

## The Pattern

Every feature that stores, caches, or versions data follows the same three-step node:

```
CAPTURE → SIGN → REFERENCE
```

1. **Capture**: Serialize state to a deterministic JSON blob
2. **Sign**: Store blob as resource, get SHA-256 signature
3. **Reference**: Use the signature string in any JSON field, history op, or class property

That's it. Every feature in the system is a variation of this node. Copy the template below, fill in your data shape, and your feature inherits the full composition/caching/undo/sharing infrastructure for free.

---

## The Node Template

```typescript
import { SignatureService } from '@hypercomb/core'

// ═══════════════════════════════════════════════════════
// STEP 1: Define your data shape
// ═══════════════════════════════════════════════════════

interface MyFeatureState {
  readonly version: 1
  // Your fields here. Keep them readonly.
  // Reference other content by signature, never inline.
}

// ═══════════════════════════════════════════════════════
// STEP 2: The node — capture, sign, reference
// ═══════════════════════════════════════════════════════

class MyFeatureNode {
  #cache = new Map<string, MyFeatureState>()
  #currentSig: string | null = null

  // CAPTURE: serialize state deterministically
  #serialize(state: MyFeatureState): string {
    return JSON.stringify(state, Object.keys(state).sort(), 0)
  }

  // SIGN: store as resource, get signature
  async capture(state: MyFeatureState): Promise<string> {
    const json = this.#serialize(state)
    const blob = new Blob([json], { type: 'application/json' })
    const bytes = await blob.arrayBuffer()
    const sig = await SignatureService.sign(bytes)

    // Store in OPFS (via Store service)
    const store = window.ioc.get('@hypercomb.social/Store')
    await store.putResource(blob)

    // Cache in memory
    this.#cache.set(sig, state)
    this.#currentSig = sig

    return sig
  }

  // REFERENCE: load state by signature
  async resolve(sig: string): Promise<MyFeatureState | null> {
    // Level 1: in-memory cache
    const cached = this.#cache.get(sig)
    if (cached) return cached

    // Level 2: OPFS resource
    const store = window.ioc.get('@hypercomb.social/Store')
    const blob = await store.getResource(sig)
    if (!blob) return null

    const state = JSON.parse(await blob.text()) as MyFeatureState
    this.#cache.set(sig, state) // promote to memory
    return state
  }

  get currentSig(): string | null { return this.#currentSig }
}
```

### That's the entire pattern.

Three methods: `#serialize`, `capture`, `resolve`. Everything else — caching, deduplication, sharing, undo, time-travel — comes from the infrastructure these three methods plug into.

---

## Wiring Into the System

### Wire 1: History (undo/redo/time-travel)

Record a history op whenever state changes:

```typescript
// After capturing new state:
const sig = await this.#node.capture(newState)

// Record in history
const historyService = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
await historyService.record(locationSig, {
  op: 'my-feature-state',       // your HistoryOpType
  cell: sig,                     // the resource signature
  at: Date.now(),
  groupId: 'my-feature',        // optional: batch rapid changes
})
```

Now your feature has undo/redo/time-travel for free:
- **Undo**: history cursor steps back → loads the previous signature → `resolve(sig)` → state restored
- **Redo**: cursor steps forward → next signature → resolve → state restored
- **Time-travel**: seek to any position → load that signature → exact state at that moment

### Wire 2: EffectBus (reactive UI)

Broadcast state changes so UI components react:

```typescript
// In your drone:
this.emitEffect('my-feature:state', {
  sig: this.#node.currentSig,
  state: currentState,
})
```

In the Angular component:
```typescript
readonly state$ = fromRuntime(
  get('@domain/MyFeatureDrone') as EventTarget,
  () => drone.currentState,
)
```

### Wire 3: i18n (localized labels)

Register translations at module load:

```typescript
window.ioc.whenReady(I18N_IOC_KEY, (i18n) => {
  i18n.registerTranslations('mydomain.com', 'en', {
    'my-feature.label': 'My Feature',
    'my-feature.description': 'Does something useful',
  })
})
```

---

## Real-World Examples in the Codebase

### Example 1: History reorder operations

The `OrderProjection` stores cell order as a resource:

```typescript
// Capture: serialize the ordered list
const payload = JSON.stringify(cells)
const payloadSig = await store.putResource(new Blob([payload]))

// Reference: history op points at the signature
await historyService.record(sig, { op: 'reorder', cell: payloadSig, at: Date.now() })

// Resolve: load order from signature when replaying history
const blob = await store.getResource(op.cell)
const order = JSON.parse(await blob.text())
```

### Example 2: Thread message content

Thread turns store content as resources:

```typescript
// Capture: message content → resource → signature
interface ThreadTurn {
  role: 'user' | 'assistant'
  contentSig: string  // ← signature reference, not inline text
}

// Resolve: expand signature to content when building messages
const blob = await getResource(turn.contentSig)
const text = await blob.text()
```

### Example 3: Instruction settings (new)

Instruction visibility stored as a resource:

```typescript
// Capture: which instructions are hidden
const settings: InstructionSettings = {
  version: 1,
  manifestSig: currentManifestSig,
  hidden: ['dcp.zoom-in', 'dcp.clipboard'],
  at: Date.now(),
}
const settingsSig = await node.capture(settings)

// Reference: history op points at settings signature
await historyService.record(locSig, { op: 'instruction-state', cell: settingsSig, at: Date.now() })

// Resolve: undo loads previous settings by signature
const prevSettings = await node.resolve(previousSettingsSig)
```

---

## The Plug-and-Play Checklist

When implementing a new feature, copy the node template and check:

- [ ] **Data shape defined** with `readonly` fields and `version: 1`
- [ ] **Content referenced by signature**, never inline (use the litmus test from [signature-expansion-doctrine.md](signature-expansion-doctrine.md))
- [ ] **Deterministic serialization** with sorted keys
- [ ] **`capture()`** stores blob in OPFS and caches in memory
- [ ] **`resolve()`** checks memory → OPFS → returns null
- [ ] **History wired** — state changes recorded as ops with resource signatures
- [ ] **EffectBus wired** — state changes broadcast for reactive UI
- [ ] **i18n registered** — any user-facing text goes through LocalizationService
- [ ] **Three-level cache** — memory, OPFS, SignatureStore

If you check all boxes, your feature automatically gets:
- Undo/redo via history cursor
- Time-travel via timestamp-based replay
- Sharing via signature exchange
- Caching with zero invalidation complexity
- Deduplication (same state = same signature = stored once)
- Composition with other features' signatures
- Collapsed compute (see [collapsed-compute.md](collapsed-compute.md))
