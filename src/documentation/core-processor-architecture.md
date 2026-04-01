# Core Processor Architecture

The purpose of `@hypercomb/core` and the significance of the paradigm it
establishes.

---

## Purpose

`@hypercomb/core` is the zero-dependency foundation of the Hypercomb framework.
It defines a small set of primitives that together enable a content-addressable,
grammar-driven, reactive runtime where behaviors (bees) are loaded, resolved,
and executed dynamically -- without compile-time coupling to the application that
hosts them.

Everything above core (essentials, shared, web apps) is built on these
primitives. Core itself imports nothing and depends on nothing.

---

## Primitives

### Bee

The fundamental unit of behavior. `Bee` is the abstract base class for all
autonomous behavior units. It comes in two specializations:

- **Drone** — reactive bee. Overrides `sense()` + `heartbeat()`. Pulses every
  processor cycle.
- **Worker** — bootstrap-once bee. Overrides `ready()` + `act()`. Acts once when
  ready, then goes dormant.

```
BeeState:  Created -> Registered -> Active -> Disposed
```

A bee's `pulse(grammar)` method is the single framework entry point. The
framework calls `pulse()`, which checks lifecycle state, evaluates the gate
(`sense()` for drones, `ready()` for workers), and only then delegates to
the action (`heartbeat()` for drones, `act()` for workers).

```typescript
abstract class Bee {
  // framework entry point
  public abstract pulse(grammar: string): Promise<void>

  // shared infrastructure
  protected deps?: Record<string, string>
  protected resolve<T>(localName: string): T | undefined
  protected emitEffect<T>(effect: string, payload: T): void
  protected onEffect<T>(effect: string, handler: EffectHandler<T>): void

  // metadata
  public description?: string
  public grammar?: GrammarHint[]
  public effects?: readonly Effect[]
  public links?: ProviderLink[]
}

class Drone extends Bee {
  protected sense(grammar: string): boolean | Promise<boolean>
  protected heartbeat(grammar: string): Promise<void>
}

class Worker extends Bee {
  protected ready(grammar: string): boolean | Promise<boolean>
  protected act(grammar: string): Promise<void>
}
```

**Why this matters:** Bees are self-describing. A bee declares what grammar
it responds to, what effects it produces, what dependencies it needs, and what
its purpose is. This metadata makes it possible for the runtime to discover,
filter, and orchestrate bees without knowing their implementations at compile
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

Every artifact in the system -- bees, dependencies, layers, payloads -- is
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
(Angular apps, shared services) and runtime-loaded code (OPFS bees). Both
sides register and resolve through the same container, enabling communication
without import coupling.

### SignatureStore

A trusted-signature allowlist that eliminates redundant SHA-256 hashing at
runtime. Populated from `install.manifest.json` during installation and
persisted to `localStorage` across sessions.

```typescript
class SignatureStore extends EventTarget {
  trust(sig: string): void
  trustAll(sigs: Iterable<string>): void
  isTrusted(sig: string): boolean
  async verify(bytes: ArrayBuffer, expectedSig: string): Promise<boolean>
  async signText(text: string): Promise<string>
  toJSON(): { sigs: string[]; storeSig: string | null }
  restore(data: { sigs?: string[]; storeSig?: string | null }): void
}
```

`verify()` returns `true` immediately for trusted signatures (no hashing),
or hashes and compares for unknown ones (auto-trusting on match). `signText()`
memoizes repeated text-to-signature calls — useful when the same lineage path
is hashed multiple times per render cycle.

**Why this matters:** Content verification is the system's integrity guarantee,
but SHA-256 hashing every file on every load is redundant when the install
pipeline already verified everything. The signature store turns verification
from O(n * hash) into O(n * lookup) for known artifacts, while preserving full
verification for anything new or untrusted.

### BeeResolver

An interface that finds bees for a given grammar string. The framework calls
`resolver.find(grammar)` and gets back an array of `Bee` instances.

```typescript
interface BeeResolver {
  find(input: string): Promise<Bee[]>
}
```

The resolver implementation lives outside core (in `ScriptPreloader` within
shared). Core only defines the contract and the IoC key
(`hypercomb:bee-resolver`).

### Effect

A union type that categorizes what a bee does to the world:

```typescript
type Effect = 'filesystem' | 'render' | 'history' | 'network' | 'memory' | 'external'
```

Effects are metadata, not enforcement. A bee declares its effects so that
orchestrators, UIs, and auditors can reason about what a bee does without
inspecting its code.

### PayloadCanonical

The canonical format for a bee's source code and metadata, used for signing
and transmission:

```typescript
type DronePayloadV1 = {
  version: 1
  drone: { name, description?, grammar?, links?, effect? }
  source: { entry: string, files: Record<string, string> }
}
```

`PayloadCanonical.compute(payload)` serializes the payload to canonical JSON
and signs it. This produces a single signature that identifies the exact bee
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

This enables the DCP to compile bee source code in an isolated context and
hand the resulting bytes back to the parent for signing and storage.

---

## The `hypercomb` Class

The top-level orchestrator. Extends `web` (an abstract class with a single
`act(grammar)` method). Its implementation:

1. Resolves the `BeeResolver` from IoC.
2. Calls `resolver.find(grammar)` to discover relevant bees.
3. Calls `bee.pulse(grammar)` on each.
4. Dispatches a `synchronize` event when complete (in a `finally` block).

```typescript
class hypercomb extends web {
  public override act = async (grammar: string = ''): Promise<void> => {
    try {
      const resolver = get<BeeResolver>(BEE_RESOLVER_KEY)
      const bees = resolver ? await resolver.find(grammar) : []
      for (const bee of bees) {
        await bee.pulse(grammar)
      }
    } finally {
      window.dispatchEvent(new Event('synchronize'))
    }
  }
}
```

---

## The Cell Hierarchy: The Runtime IS the Data Structure

The central runtime concept in Hypercomb is the **cell hierarchy** -- a tree of
cells stored as nested directories in OPFS, where each directory is a cell and
the tree structure itself is the program's execution space.

### Cells

A cell is a named directory inside the current lineage path. The URL
`/domain/path/to/cell` maps directly to an OPFS directory path
`hypercomb.io/domain/path/to/cell`. Cells are the atoms of the hierarchy --
each one is a position in the hexagonal grid that can contain:

- **Child cells** (subdirectories) -- forming the tree's branches
- **Properties** (zero-signature file) -- JSON identity and configuration
- **Mesh state** (shared cells from the Nostr relay mesh) -- external
  contributions from other nodes

Bees are discovered globally via the install manifest, not per-cell. All
installed bees are available at every location in the tree.

The `Lineage` service tracks the current position in this tree. `Navigation`
moves through it. The URL bar is a direct reflection of your position in the
cell hierarchy. The `ShowCellDrone` renders the current cell's children as
hexagonal tiles, unioning local filesystem cells with cells discovered through
the mesh.

### The Runtime Loop

When the application starts, it begins at the root of the cell tree. At each
position in the tree, the runtime checks whether any scripts should run at this
location and then moves on. The loop works as follows:

1. **Intent arrives** -- any user input, gesture, navigation event, or tracked
   signal becomes a grammar string. A keystroke is intent. A pan gesture is
   intent. A URL change is intent. There is no distinction between "user action"
   and "system event" -- all are grammar.
2. **`hypercomb.act(grammar)`** broadcasts the grammar to all registered bees.
3. Each bee's **`pulse(grammar)`** fires: check lifecycle state, evaluate
   the gate (`sense`/`ready`), execute the action (`heartbeat`/`act`) if relevant.
4. The action examines the current cell (via Lineage) -- does this location
   have scripts to run? Are there child cells to traverse? What mesh state
   exists here?
5. **`synchronize`** event fires, coalescing all visual updates into a single
   render pass.

The cell doesn't "run" in the traditional sense. It is a location in the tree
that bees inspect and act upon. The bee checks what exists at the current
cell, performs its work, and the tree is both the data and the execution context.

### Tree Traversal and Parallel Execution

When the cell hierarchy branches -- when a cell has many children -- the runtime
can dispatch work across branches concurrently. Each path from root to leaf is
an independent line of execution:

```
         root
        / | \
      a   b   c          <- 3 branches, can process in parallel
     / \     / \
    d   e   f   g         <- leaf bees execute independently
```

At each node, the bee evaluates whether it should act. If the tree has many
active paths (many leaves with associated bees), those paths can execute their
actions concurrently because:

- Each bee's `pulse()` is self-contained -- bees don't call each other
  directly.
- The IoC container is read-safe for concurrent access.
- The `synchronize` event at the end coalesces all visual updates into one pass.

This is concurrent `Promise` execution within the JavaScript event loop, with
the tree structure providing natural task boundaries. Each branch of the tree is
a self-contained unit of work. When there are many paths out to each leaf, all
active branches can execute their pulses in parallel.

### Cells Are Content-Addressable Locations

The cell hierarchy isn't just a folder structure. Each location in the tree has
a **signature** computed from its lineage path:

```
sig = SHA-256("hypercomb.io/domain/path/to/cell")
```

This signature is used to:
- **Subscribe to mesh updates** for that location (via Nostr relays)
- **Publish local cells** to the mesh so other nodes can discover them
- **Deduplicate** -- two users at the same path are at the same signed location

The signature makes every position in the tree globally addressable. Two
instances of Hypercomb navigating to the same path independently arrive at the
same signature and can share state through the mesh without coordination.

### The Lifecycle IS the Heartbeat

The bee lifecycle is not a separate initialization sequence. It is the
pulse itself. The lifecycle state machine exists to track *where a bee is*
in its history of pulses, not to enforce a startup ceremony:

```
Intent (any input / gesture / tracked event)
  -> grammar string
    -> hypercomb.act(grammar)
      -> BeeResolver.find(grammar) -> [matching bees]
        -> bee.pulse(grammar)
          -> check state (Disposed? skip entirely)
          -> sense(grammar) / ready(grammar) (relevant? no? skip)
          -> heartbeat(grammar) / act(grammar) (execute the work)
          -> state: Created/Registered -> Active (on first successful pulse)
```

A bee that has never been activated simply hasn't pulsed with a grammar it
senses as relevant yet. The first time it does, it transitions to Active. There
is no separate "init" phase, no temporal ordering of setup calls to get wrong.
The intent IS the lifecycle trigger.

This answers the temporal coupling concern directly: there is nothing to call in
the wrong order. There is only `pulse`, and `pulse` handles everything
-- state gating, relevance filtering, execution, and state transition -- in a
single atomic operation. Each intent reaching some leaf bee in the hierarchy
sends the pulse in the lifecycle. That is the lifecycle.

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

Instead of method calls or event names, bees respond to grammar -- natural
language strings that describe intent. `hypercomb.act('hello world')` doesn't
call a specific function; it broadcasts a grammar string and every bee that
senses relevance responds.

This inverts the coupling direction. The caller doesn't need to know which
bees exist. Bees don't need to know who calls them. The grammar is the only
shared vocabulary.

### Self-Describing Behaviors

Each bee carries its own metadata: what grammar it responds to, what effects
it produces, what dependencies it needs, who authored it, and what it does. This
metadata travels with the compiled artifact because it is part of the signed
payload.

This enables:
- **Discovery** -- a UI can list all available bees and their purposes without
  loading their code.
- **Auditing** -- the effect declarations make it possible to filter bees by
  what they do to the system (filesystem, network, render, etc.).
- **Dependency visualization** -- `window.ioc.graph()` reads `deps` from all
  registered bees to produce a dependency map.

### Runtime Module Loading via OPFS

Bees and their dependencies are not bundled with the application. They are
stored in the browser's Origin Private File System, served by a service worker,
and resolved through a dynamically-generated import map.

This means:
- **The application binary doesn't change when behaviors change.** New bees
  can be installed by updating OPFS, without rebuilding or redeploying the
  Angular app.
- **Behaviors are portable.** A signed bee artifact can be fetched from any
  trusted domain and verified by its hash.
- **Multi-tenant isolation** is structural. Each domain gets its own OPFS
  subdirectory for bees, dependencies, and layers.

### The Tree as Runtime

Most applications separate "code" from "data" -- the program is a fixed binary
that acts on mutable state. In Hypercomb, the cell hierarchy is both. The tree
of cells is the data structure the user navigates, and it is simultaneously the
execution context that determines which drones fire and what they see.

This means:
- **Adding a cell IS adding behavior.** If a bee senses a particular cell
  name, creating that cell directory activates that bee at that location.
- **Navigation IS execution.** Moving to a new cell changes the execution
  context. Different bees may sense relevance at different positions in the
  tree.
- **The tree scales naturally.** Each branch is independent. A tree with a
  thousand leaves can process all active branches concurrently without
  coordination, because the bees at each leaf are self-contained.
- **The tree is the API.** External consumers (mesh peers, other Hypercomb
  instances) don't call methods -- they navigate to signed locations and publish
  cells. The tree structure IS the shared interface.

### Separation of Framework and Domain

Core defines the framework contract. Essentials implements domain behaviors.
Shared bridges them to Angular. Web apps compose everything.

At no point does core know about Angular, OPFS, or any specific bee
implementation. At no point do essentials know about Angular or the DOM. This
separation means you can replace the rendering layer (Angular -> another
framework), the storage layer (OPFS -> IndexedDB), or the delivery mechanism
(service worker -> native fetch) without touching core or essentials.

### Deterministic Computation & Global Memoization

Because every script has a signature and every payload has a signature, the
combination `sign(scriptSig + payloadSig)` -- called the **authenticity token**
-- uniquely identifies a computation. A two-file storage model (marker + result)
bridges computation identity to result identity, enabling bypass of re-execution
when the result is already known. A community authenticity layer provides
volunteer-driven auditing of script signatures before installation.

See [deterministic-computation.md](deterministic-computation.md) for the full
specification: signature composition, two-file storage model, resource
verification, discovery properties, and use cases.

---

## Diamond Core Processor

The Diamond Core Processor (DCP) is a separate Angular application that serves
as the bee development and compilation tool. It uses `esbuild-wasm` to compile
TypeScript bee source code in the browser, producing the `DronePayloadV1`
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
using the `DcpResourceMessage` protocol. When a bee is compiled and signed,
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
