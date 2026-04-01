# Hypercomb Architecture Critique

**A review through the lens of Martin Fowler's architectural principles**

---

## 1. Inversion of Control — Done Right, With Caveats

Fowler's seminal 2004 article *"Inversion of Control Containers and the Dependency Injection pattern"* draws a sharp distinction between **Dependency Injection** and **Service Locator**. Hypercomb uses both, and this is worth examining.

`@hypercomb/core` provides its own IoC container (`ioc.ts`), and drones resolve their dependencies through `window.ioc.get('ServiceName')`. This is textbook **Service Locator** — the component reaches out to a global registry to pull what it needs.

**What Fowler would commend:**
- The IoC container is in `core`, not in the application layer. This is correct layering — the mechanism belongs in infrastructure.
- Drones are not coupled to concrete implementations. They resolve by key, which preserves substitutability.

**What Fowler would challenge:**
- `window.ioc` as a global is a **hidden dependency**. Any drone can reach into the container at any point in its lifecycle, making the dependency graph implicit rather than explicit. Fowler argues that constructor injection makes dependencies visible in the API surface — you can read a class's constructor to know what it needs.
- The `tryGetMesh()` pattern (try one key, catch, try another) is a smell. If a drone needs a mesh adapter, that should be declared, not discovered at runtime through exception handling.

**Recommendation:** Consider a **Composition Root** pattern where drone wiring happens in one place at startup, rather than scattered `window.ioc.get()` calls throughout drone methods. This would make the system easier to test and reason about without sacrificing the flexibility of late binding.

---

## 2. The Drone Pattern — An Implicit Architectural Style

The "Drone" is Hypercomb's core abstraction, and it deserves scrutiny because it is doing a lot of work. Each drone is simultaneously:

- A **lifecycle-managed component** (created, installed, destroyed)
- An **event participant** (responds to signals from other drones)
- A **renderer** (some drones manage PixiJS display objects)
- A **domain actor** (some drones encapsulate business logic like signature publishing)

Fowler would recognize this as an instance of what he calls the **"God Object"** risk in patterns that combine too many responsibilities. However, Hypercomb mitigates this well through specialization — `PanningDrone` only handles panning, `NostrMeshDrone` only handles mesh communication. The *pattern* is broad, but the *instances* are focused.

**What Fowler would commend:**
- The drone-as-composable-unit model resembles the **Plugin** pattern from *Patterns of Enterprise Application Architecture*. Each drone extends the system without modifying the core.
- The separation between `@hypercomb/core` (the drone infrastructure) and `@hypercomb/essentials` (concrete drones) is a clean example of the **Separated Interface** pattern — the abstraction and its implementations live in different packages.

**What Fowler would challenge:**
- There is no explicit **lifecycle contract** visible in the type system. When does a drone initialize? When is it safe to call `window.ioc.get()`? These temporal dependencies are implicit. Fowler's work on **Temporal Coupling** warns that when the order of method calls matters but isn't enforced by the compiler, bugs follow.
- The drone pattern would benefit from a formal **state machine** — `Created → Installed → Running → Disposed` — with transitions enforced at the type level.

---

## 3. The Effect System — Toward Event-Driven Architecture

`@hypercomb/core` exports an `Effect` abstraction alongside `Source` and `GrammarHint`. This suggests a reactive, event-driven architecture where drones communicate through effects rather than direct method calls.

Fowler's writing on **Event-Driven Architecture** distinguishes between:
1. **Event Notification** — "something happened, react if you want"
2. **Event-Carried State Transfer** — "here's the new state, update yourself"
3. **Event Sourcing** — "here's the full history of what happened"

Hypercomb's Effect system appears to operate primarily at level 1 (notification), which is the simplest and most decoupled form.

**What Fowler would commend:**
- Decoupling drones via effects means adding a new drone doesn't require modifying existing ones. This is the **Open-Closed Principle** in practice.
- The `GrammarHint` concept suggests a structured vocabulary for effects, which prevents the "stringly-typed" anti-pattern where events are just arbitrary strings.

**What Fowler would challenge:**
- Without event sourcing or at minimum an event log, debugging distributed drone interactions becomes difficult. When five drones react to the same effect, understanding the cascade requires tracing through each one.
- Consider whether **Event-Carried State Transfer** would reduce the need for drones to query shared state through the IoC container.

---

## 4. Module Boundaries — Strong on Separation, Weak on Contracts

The package structure (`core`, `essentials`, `shared`, `web`, `legacy`) demonstrates thoughtful modular thinking. Fowler's **Modular Monolith** concept applies here — these aren't microservices, but they have clear boundaries.

**What Fowler would commend:**
- `@hypercomb/core` has zero runtime dependencies. This is exceptional discipline for a framework's foundation layer.
- `@hypercomb/essentials` correctly declares `@hypercomb/core` as a dependency and `pixi.js` as a peer dependency. This distinction (required vs. expected from the host) is exactly right.
- The `tsconfig.base.json` path aliases (`@hypercomb/core`, `@hypercomb/essentials`, `@hypercomb/shared`) create a clean import topology during development while the packages resolve normally when published.

**What Fowler would challenge:**
- `@hypercomb/shared` exists as a path alias but isn't a published package. This creates an asymmetry — some `@hypercomb/*` imports resolve to npm packages, others resolve to local paths. This could confuse contributors.
- The boundary between `core` and `essentials` isn't documented. What criteria determine whether a new drone belongs in essentials versus application code? Fowler calls this the **"Published Interface"** problem — once a package is public, its API is a contract that needs explicit governance.

---

## 5. Cryptographic Identity as a First-Class Concern

The `SignatureService` in `@hypercomb/core` is architecturally significant. By placing cryptographic signing in the core layer rather than in an application module, Hypercomb makes a statement: **identity and authenticity are not features, they are infrastructure.**

Fowler hasn't written extensively about decentralized identity, but his principles on **Cross-Cutting Concerns** apply. Authentication and authorization typically belong in infrastructure, not business logic. Hypercomb gets this right.

**What Fowler would commend:**
- The lineage path model (`domain/path/cell` → signature) creates a **natural key** system that is content-addressable. This is sound — identifiers derive from the thing they identify.
- Signatures are computed in the drone layer (essentials) but the signing mechanism lives in core. This separation means the cryptographic implementation can be swapped without touching any drone code.

**What Fowler would challenge:**
- Key management isn't visible in the core API. Where do private keys live? How are they rotated? Fowler's principle of making the **"hard part visible"** applies — if key management is implicit, it becomes the hardest thing to audit.

---

## 6. The Hexagonal Grid — Domain Model Strength

The axial coordinate system (`AxialCoordinate`, `AxialService`, `AxialKeys`) represents a well-modeled domain. This isn't just a rendering detail — it's a **Domain Model** in Fowler's terminology, with its own rules, invariants, and operations.

**What Fowler would commend:**
- Axial coordinates are their own type, not just `{x, y}` objects. This is **Value Object** thinking — two coordinates with the same q,r values are semantically equal.
- The zoom system (`ZoomArbiter`, `ZoomState`) separates the *decision* of what zoom level to use from the *rendering* of that zoom level. This is a textbook application of **Separated Presentation**.

**What Fowler would challenge:**
- The spatial model and the rendering model appear coupled through the drone system. In a pure Fowler architecture, the domain model (axial coordinates, cell topology) would be completely independent of the presentation technology (PixiJS). Could you run the spatial logic without PixiJS loaded? If not, the domain is leaking into infrastructure.

---

## 7. Testing Implications

This is the area where Fowler would be most direct. The current architecture has characteristics that make testing both easier and harder:

**Easier:**
- The package separation means `@hypercomb/core` can be tested in complete isolation — no DOM, no PixiJS, no browser.
- Drones are individual units with defined boundaries.

**Harder:**
- `window.ioc` as a global makes unit testing drones require global setup/teardown.
- The implicit lifecycle ordering means integration tests need to replicate startup sequences accurately.
- The `file:` dependency pattern (used during development) creates a different resolution path than what consumers experience via npm.

**Recommendation:** Introduce a **Test Fixture** pattern where a drone can be instantiated with explicit dependencies passed in, rather than requiring the full IoC container. This would enable fast, isolated drone testing.

---

## 8. Overall Assessment

Hypercomb's architecture is **ambitious and largely well-executed**. It combines spatial computing, decentralized identity, and GPU-accelerated rendering in a way that demands careful layering — and the layering is mostly right.

The strongest architectural decisions:
1. Zero-dependency core with the signing primitive built in
2. Drone-as-composable-unit with clean package separation
3. Scoped npm packages enabling external adoption

The areas that would benefit from Fowler's patterns:
1. Move from Service Locator toward explicit Dependency Injection
2. Formalize the drone lifecycle as a state machine
3. Document the published interface contract between core and essentials
4. Separate the spatial domain model from rendering concerns

The project occupies an interesting architectural space — it's a **framework** (others build on it), a **platform** (it manages identity and communication), and an **application** (it renders a navigable hex grid). Fowler's guidance would be to ensure these three roles don't collapse into each other, and the current package structure suggests the team understands this instinctively.

---

*"Any fool can write code that a computer can understand. Good programmers write code that humans can understand."* — Martin Fowler, Refactoring (1999)

The Hypercomb team is building something no one else has built. The architecture reflects that ambition. The recommendations above aren't criticisms — they're investments in the system's future legibility as it grows beyond its creators.
