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
