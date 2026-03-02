# Core Processor Architecture

The purpose of `@hypercomb/core` and the significance of the paradigm it
establishes.

---

## Purpose

`@hypercomb/core` is the zero-dependency foundation of the Hypercomb framework.
It defines a small set of primitives that together enable a content-addressable,
grammar-driven, reactive runtime where behaviors (drones) are loaded, resolved,
and executed dynamically -- without compile-time coupling to the application that
hosts them.

Everything above core (essentials, shared, web apps) is built on these
primitives. Core itself imports nothing and depends on nothing.

---

## Primitives

### Drone

The fundamental unit of behavior. A drone is a class that:

1. **Senses** whether it should respond to a given grammar string.
2. **Executes** a heartbeat when it does.
3. **Declares** its dependencies, effects, and intent metadata.
4. **Tracks** its lifecycle through a state machine.

```
DroneState:  Created -> Registered -> Active -> Disposed
```

A drone's `encounter(grammar)` method is the single framework entry point. The
framework never calls `heartbeat()` directly -- it calls `encounter()`, which
checks lifecycle state, evaluates `sense()`, and only then delegates to
`heartbeat()`.

```typescript
abstract class Drone {
  // developer overrides
  protected sense(grammar: string): boolean | Promise<boolean>
  protected heartbeat(grammar: string): Promise<void>
  protected deps?: Record<string, string>
  protected resolve<T>(localName: string): T | undefined

  // framework entry point
  public async encounter(grammar: string): Promise<void>

  // metadata
  public description?: string
  public grammar?: GrammarHint[]
  public effects?: readonly Effect[]
  public links?: ProviderLink[]
}
```

**Why this matters:** Drones are self-describing. A drone declares what grammar
it responds to, what effects it produces, what dependencies it needs, and what
its purpose is. This metadata makes it possible for the runtime to discover,
filter, and orchestrate drones without knowing their implementations at compile
time.

### SignatureService

Content-addressable identity. Given any `ArrayBuffer`, `SignatureService.sign()`
returns a SHA-256 hex string. This signature becomes the artifact's filename,
its cache key, its verification hash, and its identity across the network.

```typescript
class SignatureService {
  static async sign(bytes: ArrayBuffer): Promise<string>
}
```

Every artifact in the system -- drones, dependencies, layers, payloads -- is
identified by its content hash. Two artifacts with the same bytes produce the
same signature. Different bytes always produce different signatures. This
eliminates version numbers, timestamps, and naming conventions as coordination
mechanisms.

**Why this matters:** Content addressing enables:
- **Deduplication** -- if two sources produce identical bytes, only one copy
  exists.
- **Verification** -- fetch by signature, hash on arrival, reject if mismatched.
- **Immutability** -- a signature is a permanent reference. The content at a
  given signature never changes.
- **Global memoization** -- the combination of a script signature and a payload
  signature uniquely identifies a computation. If the result is already known,
  the code doesn't need to run again.

### IoC Container

A minimal service locator: `register(key, value)`, `get(key)`, `has(key)`,
`list()`. Supports both string keys and typed `ServiceToken<T>` objects.

```typescript
class ServiceToken<T> {
  constructor(public readonly key: string) {}
}

register(key: string | ServiceToken<T>, value: T, name?: string): void
get<T>(key: string | ServiceToken<T>): T | undefined
has(key: string | ServiceToken<T>): boolean
list(): readonly string[]
```

The core IoC is a simple `Map<string, unknown>`. The web layer (`ioc.web.ts`)
extends it with `onRegister` callbacks, `graph()` introspection, and global
convenience functions (`window.get`, `window.register`).

**Why this matters:** The IoC container is the seam between compile-time code
(Angular apps, shared services) and runtime-loaded code (OPFS drones). Both
sides register and resolve through the same container, enabling communication
without import coupling.

### DroneResolver

An interface that finds drones for a given grammar string. The framework calls
`resolver.find(grammar)` and gets back an array of `Drone` instances.

```typescript
interface DroneResolver {
  find(input: string): Promise<Drone[]>
}
```

The resolver implementation lives outside core (in `ScriptPreloader` within
shared). Core only defines the contract and the IoC key
(`hypercomb:drone-resolver`).

### Effect

A union type that categorizes what a drone does to the world:

```typescript
type Effect = 'filesystem' | 'render' | 'history' | 'network' | 'memory' | 'external'
```

Effects are metadata, not enforcement. A drone declares its effects so that
orchestrators, UIs, and auditors can reason about what a drone does without
inspecting its code.

### PayloadCanonical

The canonical format for a drone's source code and metadata, used for signing
and transmission:

```typescript
type DronePayloadV1 = {
  version: 1
  drone: { name, description?, grammar?, links?, effect? }
  source: { entry: string, files: Record<string, string> }
}
```

`PayloadCanonical.compute(payload)` serializes the payload to canonical JSON
and signs it. This produces a single signature that identifies the exact drone
implementation -- its code, its metadata, everything.

### DcpResourceMessage

The message protocol between the Diamond Core Processor iframe and the parent
Hypercomb application:

```typescript
interface DcpResourceMessage {
  scope: 'dcp'
  type: 'resource.bytes'
  name: string
  signature: string
  bytes: ArrayBuffer  // transferred, not copied
}
```

This enables the DCP to compile drone source code in an isolated context and
hand the resulting bytes back to the parent for signing and storage.

---

## The `hypercomb` Class

The top-level orchestrator. Extends `web` (an abstract class with a single
`act(grammar)` method). Its implementation:

1. Resolves the `DroneResolver` from IoC.
2. Calls `resolver.find(grammar)` to discover relevant drones.
3. Calls `drone.encounter(grammar)` on each.
4. Dispatches a `synchronize` event when complete.

```typescript
class hypercomb extends web {
  public act = async (grammar: string): Promise<void> => {
    const resolver = get<DroneResolver>(DRONE_RESOLVER_KEY)
    const drones = resolver ? await resolver.find(grammar) : []
    for (const drone of drones) {
      await drone.encounter(grammar)
    }
    window.dispatchEvent(new CustomEvent('synchronize', { detail: { source: 'processor' } }))
  }
}
```

---

## The Seed Hierarchy: The Runtime IS the Data Structure

The central runtime concept in Hypercomb is the **seed hierarchy** -- a tree of
cells stored as nested directories in OPFS, where each directory is a seed and
the tree structure itself is the program's execution space.

### Seeds as Cells

A seed is a named directory inside the current lineage path. The URL
`/domain/path/to/seed` maps directly to an OPFS directory path
`hypercomb.io/domain/path/to/seed`. Seeds are the atoms of the hierarchy --
each one is a cell in the hexagonal grid that can contain:

- **Child seeds** (subdirectories) -- forming the tree's branches
- **Markers** (files named by signature) -- associating drones with locations
- **Mesh state** (shared seeds from the Nostr relay mesh) -- external
  contributions from other nodes

The `Lineage` service tracks the current position in this tree. `Navigation`
moves through it. The URL bar is a direct reflection of your position in the
seed hierarchy. The `ShowHoneycombDrone` renders the current seed's children as
hexagonal cells, unioning local filesystem seeds with seeds discovered through
the mesh.

### The Runtime Loop

When the application starts, it begins at the root of the seed tree. At each
position in the tree, the runtime checks whether any scripts should run at this
location and then moves on. The loop works as follows:

1. **Intent arrives** -- any user input, gesture, navigation event, or tracked
   signal becomes a grammar string. A keystroke is intent. A pan gesture is
   intent. A URL change is intent. There is no distinction between "user action"
   and "system event" -- all are grammar.
2. **`hypercomb.act(grammar)`** broadcasts the grammar to all registered drones.
3. Each drone's **`encounter(grammar)`** fires: check lifecycle state, evaluate
   `sense(grammar)`, execute `heartbeat(grammar)` if relevant.
4. The heartbeat examines the current seed (via Lineage) -- does this location
   have scripts to run? Are there child seeds to traverse? What mesh state
   exists here?
5. **`synchronize`** event fires, coalescing all visual updates into a single
   render pass.

The seed doesn't "run" in the traditional sense. It is a location in the tree
that drones inspect and act upon. The drone checks what exists at the current
seed, performs its work, and the tree is both the data and the execution context.

### Tree Traversal and Parallel Execution

When the seed hierarchy branches -- when a seed has many children -- the runtime
can dispatch work across branches concurrently. Each path from root to leaf is
an independent line of execution:

```
         root
        / | \
      a   b   c          <- 3 branches, can process in parallel
     / \     / \
    d   e   f   g         <- leaf drones execute independently
```

At each node, the drone evaluates whether it should act. If the tree has many
active paths (many leaves with associated drones), those paths can execute their
heartbeats concurrently because:

- Each drone's `encounter()` is self-contained -- drones don't call each other
  directly.
- The IoC container is read-safe for concurrent access.
- The `synchronize` event at the end coalesces all visual updates into one pass.

This is concurrent `Promise` execution within the JavaScript event loop, with
the tree structure providing natural task boundaries. Each branch of the tree is
a self-contained unit of work. When there are many paths out to each leaf, all
active branches can execute their heartbeats in parallel.

### Seeds Are Content-Addressable Locations

The seed hierarchy isn't just a folder structure. Each location in the tree has
a **signature** computed from its lineage path:

```
sig = SHA-256("hypercomb.io/domain/path/to/seed")
```

This signature is used to:
- **Subscribe to mesh updates** for that location (via Nostr relays)
- **Publish local seeds** to the mesh so other nodes can discover them
- **Deduplicate** -- two users at the same path are at the same signed location

The signature makes every position in the tree globally addressable. Two
instances of Hypercomb navigating to the same path independently arrive at the
same signature and can share state through the mesh without coordination.

### The Lifecycle IS the Heartbeat

The drone lifecycle is not a separate initialization sequence. It is the
encounter itself. The lifecycle state machine exists to track *where a drone is*
in its history of encounters, not to enforce a startup ceremony:

```
Intent (any input / gesture / tracked event)
  -> grammar string
    -> hypercomb.act(grammar)
      -> DroneResolver.find(grammar) -> [matching drones]
        -> drone.encounter(grammar)
          -> check state (Disposed? skip entirely)
          -> sense(grammar) (relevant? no? skip)
          -> heartbeat(grammar) (execute the work)
          -> state: Created/Registered -> Active (on first successful heartbeat)
```

A drone that has never been activated simply hasn't encountered a grammar it
senses as relevant yet. The first time it does, it transitions to Active. There
is no separate "init" phase, no temporal ordering of setup calls to get wrong.
The intent IS the lifecycle trigger.

This answers the temporal coupling concern directly: there is nothing to call in
the wrong order. There is only `encounter`, and `encounter` handles everything
-- state gating, relevance filtering, execution, and state transition -- in a
single atomic operation. Each intent reaching some leaf drone in the hierarchy
sends the heartbeat in the lifecycle. That is the lifecycle.

---

## Paradigm Significance

### Content-Addressable Everything

Traditional software identifies artifacts by name and version (`lodash@4.17.21`).
Hypercomb identifies them by content hash. This is the same principle behind Git
objects, IPFS CIDs, and Nix store paths, applied to a live application runtime.

The consequence is that the system doesn't need a package registry, a version
resolution algorithm, or a lockfile. If you have the signature, you have the
identity. If you have the bytes and they hash to that signature, you have the
artifact.

### Grammar-Driven Dispatch

Instead of method calls or event names, drones respond to grammar -- natural
language strings that describe intent. `hypercomb.act('hello world')` doesn't
call a specific function; it broadcasts a grammar string and every drone that
senses relevance responds.

This inverts the coupling direction. The caller doesn't need to know which
drones exist. Drones don't need to know who calls them. The grammar is the only
shared vocabulary.

### Self-Describing Behaviors

Each drone carries its own metadata: what grammar it responds to, what effects
it produces, what dependencies it needs, who authored it, and what it does. This
metadata travels with the compiled artifact because it is part of the signed
payload.

This enables:
- **Discovery** -- a UI can list all available drones and their purposes without
  loading their code.
- **Auditing** -- the effect declarations make it possible to filter drones by
  what they do to the system (filesystem, network, render, etc.).
- **Dependency visualization** -- `window.ioc.graph()` reads `deps` from all
  registered drones to produce a dependency map.

### Runtime Module Loading via OPFS

Drones and their dependencies are not bundled with the application. They are
stored in the browser's Origin Private File System, served by a service worker,
and resolved through a dynamically-generated import map.

This means:
- **The application binary doesn't change when behaviors change.** New drones
  can be installed by updating OPFS, without rebuilding or redeploying the
  Angular app.
- **Behaviors are portable.** A signed drone artifact can be fetched from any
  trusted domain and verified by its hash.
- **Multi-tenant isolation** is structural. Each domain gets its own OPFS
  subdirectory for drones, dependencies, and layers.

### The Tree as Runtime

Most applications separate "code" from "data" -- the program is a fixed binary
that acts on mutable state. In Hypercomb, the seed hierarchy is both. The tree
of seeds is the data structure the user navigates, and it is simultaneously the
execution context that determines which drones fire and what they see.

This means:
- **Adding a seed IS adding behavior.** If a drone senses a particular seed
  name, creating that seed directory activates that drone at that location.
- **Navigation IS execution.** Moving to a new seed changes the execution
  context. Different drones may sense relevance at different positions in the
  tree.
- **The tree scales naturally.** Each branch is independent. A tree with a
  thousand leaves can process all active branches concurrently without
  coordination, because the drones at each leaf are self-contained.
- **The tree is the API.** External consumers (mesh peers, other Hypercomb
  instances) don't call methods -- they navigate to signed locations and publish
  seeds. The tree structure IS the shared interface.

### Separation of Framework and Domain

Core defines the framework contract. Essentials implements domain behaviors.
Shared bridges them to Angular. Web apps compose everything.

At no point does core know about Angular, OPFS, or any specific drone
implementation. At no point do essentials know about Angular or the DOM. This
separation means you can replace the rendering layer (Angular -> another
framework), the storage layer (OPFS -> IndexedDB), or the delivery mechanism
(service worker -> native fetch) without touching core or essentials.

### Global Memoization Potential

Because every script has a signature and every payload has a signature, the
combination `hash(scriptSig + payloadSig)` uniquely identifies a computation.
If the result of running script S against payload P has been computed before,
it can be retrieved by its composite hash without re-execution.

This extends naturally to a shared computation cache -- a network of nodes that
all agree on content-addressed identity can share results. If node A has already
computed the result for `(S, P)`, node B can retrieve it by hash instead of
recomputing.

---

## Diamond Core Processor

The Diamond Core Processor (DCP) is a separate Angular application that serves
as the drone development and compilation tool. It uses `esbuild-wasm` to compile
TypeScript drone source code in the browser, producing the `DronePayloadV1`
artifacts that get signed and stored.

**Key components:**
- `EsbuildService` -- wraps `esbuild-wasm` for TypeScript-to-ESM transformation
- `compilePayload()` -- takes a `DronePayloadV1`, decodes its Base64 source,
  sends it to a web worker for compilation, and returns the compiled JavaScript
- `dcp-worker.ts` -- a web worker that isolates esbuild compilation from the
  main thread
- `ModuleResolverService` -- fetches module files by signature from trusted
  domains, verifying content hash on arrival

The DCP communicates with the parent Hypercomb application via `postMessage`
using the `DcpResourceMessage` protocol. When a drone is compiled and signed,
the result bytes are transferred (not copied) back to the parent for storage in
OPFS.

---

## Design Constraints

These constraints are intentional and load-bearing:

1. **Core has zero dependencies.** It must work in any JavaScript environment.
2. **Essentials may only import core and sibling namespaces.** No Angular, no
   DOM APIs beyond what's available in a module worker.
3. **Shared must not import essentials.** Essentials are runtime-loaded and may
   not exist at build time.
4. **The IoC container must be installed before Angular bootstraps.** Services
   self-register as module side effects.
5. **The import map must be in the DOM before any dynamic `import()`.** Browsers
   freeze the import map after the first module load.
6. **Signatures are SHA-256 hex strings, 64 characters.** This is not
   configurable.
7. **PLATFORM_EXTERNALS (`@hypercomb/core`, `pixi.js`) are never bundled into
   essentials artifacts.** They are resolved at runtime via the import map.
