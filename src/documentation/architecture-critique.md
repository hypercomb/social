# Hypercomb Architecture Critique

**A review through the lens of Martin Fowler's architectural principles**

---

## 1. Inversion of Control — Significantly Improved

> **Status: ADDRESSED** — The IoC system now provides typed resolution and explicit dependency declarations.

Fowler's seminal 2004 article *"Inversion of Control Containers and the Dependency Injection pattern"* draws a sharp distinction between **Dependency Injection** and **Service Locator**. Hypercomb still uses a Service Locator at the mechanism level, but the developer experience has moved toward explicitness.

`@hypercomb/core` now provides a **`ServiceToken<T>`** abstraction that enables type-safe IoC resolution while maintaining duck-typing compatibility across package boundaries. The container API is intentionally minimal: `register()`, `get()`, `has()`, `list()` — backed by a `Map<string, unknown>` with optional alias resolution via a secondary names map.

Drones resolve dependencies through `this.resolve()` rather than making ad-hoc `window.ioc.get()` calls scattered through methods. A **Bridge Providers** pattern creates Angular DI providers that delegate to `window.ioc`, ensuring Angular components receive the same instances as dynamic OPFS modules.

**What Fowler would commend:**
- The IoC container remains in `core` with zero runtime dependencies — correct layering.
- `ServiceToken<T>` makes resolution type-safe without coupling packages to concrete types.
- `list()` enables dependency graph inspection — a strong debugging and governance tool.
- The container is deliberately simple (53 lines). No overengineered lifecycle hooks or scoped instances. It does one thing.

**What remains:**
- `window.ioc` is still the underlying global mechanism. A full **Composition Root** where all wiring happens at startup (rather than as side effects during module initialization, e.g., `window.ioc.register('AxialService', new AxialService())` at the bottom of service files) would complete the transition.
- No compile-time validation that services exist when resolved. If a drone calls `this.resolve('Settings')` before Settings is registered, it gets `undefined` silently.

---

## 2. The Drone Pattern — Formalized Lifecycle

> **Status: ADDRESSED** — Drone lifecycle is now an explicit state machine with enforced transitions and auto-cleanup.

The "Drone" is Hypercomb's core abstraction. Each drone is simultaneously a lifecycle-managed component, an event participant, a renderer (optionally), and a domain actor. Fowler would recognize the **"God Object"** risk, but Hypercomb mitigates it through specialization — `PanningDrone` only handles panning, `NostrMeshDrone` only handles mesh communication. The *pattern* is broad, but the *instances* are focused.

The lifecycle is now governed by a formal `BeeState` enum in `bee.base.ts`:

```
Created → Registered → Active → Disposed
```

- `markRegistered()` — Framework calls this when the drone is added to IoC.
- `pulse(grammar)` — Single entry point. Checks for Disposed state, calls `sense()` for relevance filtering, then `heartbeat()` for execution. Transitions to Active on first successful heartbeat. Workers use `ready()` / `act()` instead.
- `markDisposed()` — Triggers auto-unsubscription of all effect subscriptions, then calls the optional `dispose()` override for custom cleanup.

**What Fowler would commend:**
- The drone-as-composable-unit model resembles the **Plugin** pattern from *Patterns of Enterprise Application Architecture*. Each drone extends the system without modifying the core.
- The separation between `@hypercomb/core` (drone infrastructure) and `@hypercomb/essentials` (concrete drones) is a clean example of the **Separated Interface** pattern.
- The state machine makes temporal coupling visible. Disposed drones are gated out of `pulse()` entirely — no zombie behavior.
- **Declarative sensing** via `sense()` lets drones declare relevance to a grammar string rather than blindly reacting to everything.

**What remains:**
- No compile-time enforcement that `resolve()` is only called during appropriate states (e.g., after `Registered`). This is still a runtime responsibility.
- `sense()` and `heartbeat()` are `protected`, which means testing requires subclassing — not ideal for test ergonomics.
- No state change events — no observers notified on transitions. Though the EffectBus could serve this role if wired in.

---

## 3. The Effect System — Event-Driven with Last-Value Replay

> **Status: ADDRESSED** — The new `EffectBus` provides typed pub/sub with last-value replay and automatic cleanup on drone disposal.

This is the most significant architectural addition since the initial review. `@hypercomb/core` now exports an `EffectBus` — a last-value-replay pub/sub system that enables drone-to-drone communication without direct imports.

The `EffectBus` implementation (48 lines in `effect-bus.ts`) provides:
- **`emit(effect, payload)`** — Stores the last value and notifies all handlers.
- **`on(effect, handler)`** — Subscribes and immediately replays the last value if one exists (solving timing races).
- **`once(effect, handler)`** — One-shot subscription with auto-unsubscribe.

Drones integrate via protected methods: `emitEffect()`, `onEffect()`, `onceEffect()`. Subscriptions are tracked in `_effectSubs[]` and auto-unsubscribed when `markDisposed()` is called. Drones can also declare `listens?: string[]` and `emits?: string[]` metadata for discovery.

Real-world usage: `PixiHostDrone` emits `'render:host-ready'` with its app, container, canvas, and renderer. `ShowHoneycombWorker` subscribes to this effect to receive the Pixi infrastructure — no import dependency between the two drones.

Fowler's writing on **Event-Driven Architecture** distinguishes three levels:
1. **Event Notification** — "something happened, react if you want"
2. **Event-Carried State Transfer** — "here's the new state, update yourself"
3. **Event Sourcing** — "here's the full history of what happened"

The EffectBus operates between levels 1 and 2. The last-value replay carries state to late subscribers, but there's no persistent event history.

**What Fowler would commend:**
- Decoupling drones via effects means adding a new drone doesn't require modifying existing ones. This is the **Open-Closed Principle** in practice.
- The `Effect` type is a fixed union (`'filesystem' | 'render' | 'history' | 'network' | 'memory' | 'external'`), preventing stringly-typed chaos.
- Last-value replay is a pragmatic solution to timing dependencies — a new drone doesn't need to "arrive early" to receive state.
- Auto-cleanup on dispose eliminates subscription leak bugs, a common failure mode in pub/sub systems.

**What remains:**
- No event log for debugging drone cascades. When multiple drones react to the same grammar, tracing the cascade requires stepping through each one.
- Effects don't survive page reload — no persistence layer.
- Single global bus — not scoped per domain or tenant. This is fine for now but may need partitioning at scale.
- **Event Sourcing** is absent. For a system with content-addressable identity, event sourcing would be a natural fit for audit trails.

---

## 4. Module Boundaries — Clear Separation, Shared Asymmetry Remains

> **Status: INCREMENTAL** — Package structure is clean. `@hypercomb/shared` is still a path alias, not a published package.

The package structure demonstrates thoughtful modular thinking. Fowler's **Modular Monolith** concept applies — these aren't microservices, but they have clear boundaries.

| Package | Type | Dependencies |
|---|---|---|
| `@hypercomb/core` | npm (published) | Zero runtime dependencies |
| `@hypercomb/essentials` | npm (published) | `@hypercomb/core`, `nostr-tools`; peer: `pixi.js` |
| `@hypercomb/shared` | Source inclusion via tsconfig | Not published, no `package.json` |

The `dependency-resolution.md` documents three resolution mechanisms: IoC container (runtime), Angular DI (framework), and Dynamic Import Maps (OPFS modules).

**What Fowler would commend:**
- `@hypercomb/core` has zero runtime dependencies. Exceptional discipline for a framework's foundation layer.
- `@hypercomb/essentials` correctly declares `pixi.js` as a peer dependency — required vs. expected from the host is exactly right.
- Core and essentials have proper npm packaging: `main`, `module`, `types`, and conditional `exports` in `package.json`.
- No circular dependencies: Core → Essentials → (Angular/Shared), never backward.

**What remains:**
- `@hypercomb/shared` has **no `package.json`** — it's included as TypeScript source via `tsconfig.app.json` (`"include": ["../hypercomb-shared/**/*.ts"]`). This makes it invisible to `npm ls` and dependency tooling. Contributors see `@hypercomb/shared` imports but can't consume the package outside the monorepo.
- The boundary criteria between `core` and `essentials` are not documented. What qualifies a drone or service for essentials vs. application code? Fowler's **"Published Interface"** problem applies.

---

## 5. Cryptographic Identity — Content Addressing Without Authentication

> **Status: PARTIALLY ADDRESSED** — Content addressing works. Real cryptographic signing is absent.

The `SignatureService` in `@hypercomb/core` is architecturally significant in what it does — and in what it doesn't do.

What it does: SHA-256 hashing via `crypto.subtle.digest()`. Every artifact (drone, payload, dependency) gets a deterministic 64-character hex signature. Same bytes always produce the same signature. This is **content-addressable identity** — like Git or IPFS.

What it doesn't do: There are no private keys, no asymmetric signing, no `crypto.subtle.sign()`. The "signature" is a content hash, not a cryptographic signature in the authentication sense.

**What Fowler would commend:**
- Content addressing in the core layer is correct — identity and integrity are infrastructure, not business logic.
- The `PayloadCanonical.compute()` pattern (canonical JSON → encode → hash) ensures deterministic signatures regardless of property ordering.
- The build pipeline signs every essentials module artifact, creating a chain of trust for distribution.

**What remains:**
- **No authentication chain.** There is no way to verify *who* created a drone, only that its content matches its hash. Real signing would require drone authors to hold private keys, `SignatureService` to use `crypto.subtle.sign()`, and verifiers to validate against public keys.
- **No key lifecycle.** Where do keys live? How are they rotated? How are they revoked? Fowler's principle of making the **"hard part visible"** applies — if key management is implicit, it becomes the hardest thing to audit.
- For a system building on decentralized identity, the gap between content hashing and cryptographic authentication will grow as adoption increases.

---

## 6. The Hexagonal Grid — Domain Model Strength, Rendering Coupling

> **Status: UNCHANGED** — The axial math is correct and well-modeled. PixiJS is imported directly into the domain model.

The axial coordinate system (`AxialCoordinate`, `AxialService`) represents a well-modeled domain. This isn't just a rendering detail — it's a **Domain Model** in Fowler's terminology, with its own rules, invariants, and operations.

The pure math is clean: cube coordinates (`q, r, s`) with the constraint `q + r + s = 0`, ring-based matrix enumeration, pre-computed adjacency maps, and spatial nearest-neighbor queries.

The problem is on line 3 of `axial-coordinate.ts`:

```typescript
import { Point } from "pixi.js"
```

The `Location: Point` field stores screen coordinates as a PixiJS `Point`, and `getLocation()` computes them using `Settings.hexagonSide` resolved from `window.ioc`. The projection math (axial → screen) is embedded in the domain model.

**What Fowler would commend:**
- Axial coordinates are their own type, not just `{x, y}` objects. This is **Value Object** thinking — two coordinates with the same q,r values are semantically equal.
- The zoom system (`ZoomArbiter`, `ZoomDrone`) separates the *decision* of what zoom level to use from the *rendering* of that zoom level. This is **Separated Presentation**. `ZoomDrone` now persists viewport snapshots to OPFS, extending the separation into durable state.
- Ring enumeration and adjacency caching show a well-understood domain.

**What remains:**
- `AxialCoordinate` cannot be instantiated without PixiJS loaded — the module-level import makes the entire file unresolvable without the rendering library.
- `getLocation()` resolves `Settings` via `window.ioc.get("Settings")`, adding an implicit dependency inside what should be a pure domain type.
- In a Fowler architecture, `AxialCoordinate` would be a pure value type (`{q, r, s}` with spatial operations) and a separate **Projection** service would convert domain coordinates to screen space. This is the most impactful remaining change for testability and separation of concerns.

---

## 7. Testing — No Infrastructure Yet

> **Status: NOT ADDRESSED** — Zero test files exist in core or essentials.

This is the area where Fowler would be most direct. There are no `*.test.ts` or `*.spec.ts` files in `@hypercomb/core` or `@hypercomb/essentials`. No `jest.config`, `vitest.config`, or `karma.conf` in the framework packages. The workspace has Jasmine/Karma configured for the Angular apps, but the core framework primitives have zero test coverage.

**Testability of current components:**

| Component | Without IoC | Without PixiJS | Assessment |
|---|---|---|---|
| `BeeState` enum | Yes | Yes | Pure enum, trivially testable |
| `EffectBus` | Yes | Yes | Self-contained, most testable component |
| `SignatureService` | Yes | Yes | Only uses Web Crypto API |
| `IoC register/get` | Yes | Yes | Pure functions |
| `Drone.pulse()` | Partial | Yes | Needs mocked `sense()` / `heartbeat()` |
| `AxialCoordinate` | No | No | Module-level PixiJS import blocks loading |
| `ShowHoneycombWorker` | No | No | Depends on Pixi and window.ioc |

**What would be needed:**
1. A test runner configured for core and essentials (Vitest would be natural for ESM packages).
2. Unit tests for `drone.base.ts`, `ioc.ts`, `effect-bus.ts`, `signature.service.ts` — all testable today without changes.
3. A **Test Fixture** pattern: `class TestDrone extends Drone` with public overrides for `sense()` and `heartbeat()`.
4. A test double for `window.ioc` to avoid global pollution between tests.
5. Decoupling `AxialCoordinate` from PixiJS before it can be unit tested.

---

## 8. Overall Assessment

Hypercomb's architecture is **ambitious and maturing**. The EffectBus and drone lifecycle formalization are meaningful structural improvements. The layering is mostly right.

### What has been addressed:

| Critique Area | Status | Key Evidence |
|---|---|---|
| IoC / Dependency Injection | **Addressed** | `ServiceToken<T>`, typed resolution, Bridge Providers |
| Drone Lifecycle | **Addressed** | `BeeState` enum, enforced state machine, auto-cleanup |
| Effect System | **Addressed** | `EffectBus` with last-value replay, drone integration, auto-unsubscribe |
| Module Boundaries | **Incremental** | Dependency resolution documented, packages properly structured |

### What remains:

| Critique Area | Status | Impact |
|---|---|---|
| Spatial Domain Coupling | **Unchanged** | `AxialCoordinate` imports PixiJS directly — domain leaks into infrastructure |
| Cryptographic Authentication | **Unchanged** | Content hashing works, but no real signing or key management |
| Testing | **Not Started** | Zero test files in framework core or essentials |
| `@hypercomb/shared` | **Unchanged** | No `package.json`, invisible to dependency tooling |

### Remaining recommendations (narrowed):

1. **Decouple `AxialCoordinate` from PixiJS** — Extract a pure domain type (`{q, r, s}` with spatial operations) and a separate Projection layer. Most impactful single change for testability and separation of concerns.
2. **Add tests to core** — `EffectBus`, `IoC`, `SignatureService`, and `Drone` lifecycle are all testable today without any code changes. Start there.
3. **Implement Test Fixture pattern** — `class TestDrone extends Drone` with overrideable hooks for isolated drone testing.
4. **Publish `@hypercomb/shared`** — Even as a private package with a `package.json`, this eliminates the path-alias asymmetry and makes it visible to tooling.
5. **Document the core/essentials boundary** — Define what qualifies a drone or service for `essentials` vs. application code.
6. **Make key management visible** — Surface key lifecycle (creation, storage, rotation) in the core API when decentralized identity becomes a user-facing feature.
7. **Consider an event log** — Even a debug-mode log of effect dispatches would make drone cascade debugging tractable.

The project occupies an interesting architectural space — it's a **framework** (others build on it), a **platform** (it manages identity and communication), and an **application** (it renders a navigable hex grid). Fowler's guidance would be to ensure these three roles don't collapse into each other, and the current package structure suggests the team understands this instinctively.

---

*"Any fool can write code that a computer can understand. Good programmers write code that humans can understand."* — Martin Fowler, Refactoring (1999)

The Hypercomb team is building something no one else has built. The progress on IoC, drone lifecycle, and the EffectBus shows the team takes architectural hygiene seriously. The remaining items are focused and actionable — they represent investments in the system's future legibility as it grows beyond its creators.
