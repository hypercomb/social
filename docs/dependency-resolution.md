# Dependency Resolution in Hypercomb

How services, drones, and modules discover each other across the four project layers.

---

## Architecture Overview

```
  @hypercomb/core        (npm package, zero dependencies)
        |
  @hypercomb/essentials  (npm package, runtime plugin modules)
        |
  hypercomb-shared       (referenced directly by web projects via tsconfig paths)
        |
  +-----------+-----------+
  |                       |
  hypercomb-web           hypercomb-dev
  (production app)        (development sandbox)
```

There are **three distinct resolution mechanisms** working together:

1. **IoC Container** (`window.ioc`) -- service locator for runtime instances
2. **Angular DI** (`inject()`) -- for web project Angular components
3. **Dynamic Import Map** -- browser-native ESM resolution for OPFS-loaded modules

---

## 1. The IoC Container (`window.ioc`)

### Installation

`ioc.web.ts` installs a global service locator on `window.ioc` before anything else runs. This happens at module load time via a side-effect import:

```typescript
// main.ts (both web and dev)
import '@hypercomb/shared/core/ioc.web'
```

The container provides:

| Method | Purpose |
|--------|---------|
| `register(key, value, name?)` | Store an instance by string key |
| `get(key)` | Retrieve an instance |
| `has(key)` | Check existence |
| `list()` | List all registered keys |
| `onRegister(cb)` | Listen for new registrations |
| `graph()` | Return dependency map from drone `deps` declarations |

### Global Convenience Functions

After installation, bare globals are available everywhere without destructuring:

```typescript
// Before (old pattern):
const { get, register } = window.ioc
const store = get('Store')

// After (new pattern):
const store = get('Store')
register('MyService', new MyService())
```

These are declared in `global.d.ts` (shared, essentials, dev) and installed on `window` by `ioc.web.ts`.

### Self-Registration Pattern

Every service registers itself at module load time as a side effect:

```typescript
// store.ts
export class Store { /* ... */ }
register('Store', new Store())

// navigation.ts
export class Navigation { /* ... */ }
register('Navigation', new Navigation())
```

This means **import order matters**. The web project ensures correct ordering through its module graph: `Store` is imported before `Navigation` (which depends on Store), etc.

### Dependency Resolution in Services

Services in `hypercomb-shared` resolve dependencies lazily via getter properties:

```typescript
export class Lineage {
  private get store(): Store { return get('Store') as Store }
  private get navigation(): Navigation { return get('Navigation') as Navigation }
}
```

This lazy resolution avoids circular dependency issues -- the dependency doesn't need to exist when the class is constructed, only when it's first accessed.

---

## 2. Drone Dependency Declaration

Drones (autonomous composable units from `@hypercomb/core`) declare their dependencies explicitly using `deps` + `resolve()`:

```typescript
export class PixiHostDrone extends Drone {
  protected override deps = { settings: 'Settings', axial: 'AxialService' }

  protected override heartbeat = async (): Promise<void> => {
    const settings = this.resolve<any>('settings')
    const axial = this.resolve<any>('axial')
  }
}
```

### Lifecycle State Machine

Every drone follows a formal lifecycle:

```
Created --> Registered --> Active --> Disposed
```

- **Created**: Constructor ran, not yet in the container
- **Registered**: Added to `window.ioc` (set automatically via `onRegister`)
- **Active**: First successful `encounter()` completed
- **Disposed**: Cleanup done, drone stops responding to encounters

### Container Observability

`window.ioc.graph()` returns the dependency map for all registered drones:

```javascript
window.ioc.graph()
// => {
//   "PixiHost":       ["Settings", "AxialService"],
//   "ShowHoneycomb":  ["Lineage", "MeshDrone", "NostrMeshDrone", "PixiHost", "AxialService"],
//   "PanningDrone":   ["PixiHost", "MousePanInput"],
//   "ZoomDrone":      ["PixiHost", "MousewheelZoomInput"],
//   "NostrMeshDrone": ["NostrSigner"],
// }
```

---

## 3. Angular DI Bridge (`shared-providers.ts`)

Web projects use Angular's `inject()` for shared services. But Angular must receive the **same instance** that dynamic OPFS modules see via `window.ioc.get()`.

### The Problem

If a service has `@Injectable({ providedIn: 'root' })`, Angular creates its own instance. OPFS-loaded essentials modules call `window.ioc.get('Lineage')` and get a different object. State diverges.

### The Solution: Bridge Providers

`shared-providers.ts` uses `useFactory` providers that delegate to the IoC container:

```typescript
// tokens.ts
export const LINEAGE = token<Lineage>('Lineage', Lineage)
export const NAVIGATION = token<Navigation>('Navigation', Navigation)
// ...

export function bridgeProviders(tokens: SharedToken<any>[]): Provider[] {
  return tokens.map(t => ({
    provide: t.ngType,
    useFactory: () => window.ioc.get(t.key),
  }))
}

// shared-providers.ts
export const sharedProviders = bridgeProviders([
  COMPLETION_UTILITY, LINEAGE, MOVEMENT, NAVIGATION,
  RESOURCE_COMPLETION, RESOURCE_MSG_HANDLER, SCRIPT_PRELOADER,
])
```

Angular components can now use:

```typescript
private readonly lineage = inject(Lineage)  // same instance as window.ioc.get('Lineage')
```

### What Can and Cannot Use `inject()`

| Context | Can use `inject()` | Must use `get()` |
|---------|:------------------:|:----------------:|
| Angular-native services (Router, etc.) | Yes | N/A |
| Shared IoC services in Angular components | **No** — use `get()` | **Yes** (lazy getter) |
| Shared services (non-Angular classes) | No | Yes |
| Essentials drones (loaded at runtime) | No | Yes (via `this.resolve()`) |
| Dev project components | No — use `get()` | Yes |

> **Why not `inject()` for IoC services?** Angular's `inject()` requires bridge providers
> (`useFactory` wrappers) that have proven fragile across Angular production builds.
> Using the global `get()` directly is more reliable and consistent with how services
> are resolved throughout the rest of the codebase.

---

## 4. Dynamic Import Map (Production Web Only)

The production web app (`hypercomb-web`) loads essentials modules from OPFS at runtime using browser-native ESM import maps.

### Build Pipeline (`build-module.ts`)

The essentials build script:

1. **Discovers** all `.ts` files under `hypercomb-essentials/src/`
2. **Classifies** each as a `drone` (`.drone.ts`) or `dependency` (everything else)
3. **Bundles** dependencies into namespace modules using esbuild, with externals:
   ```typescript
   PLATFORM_EXTERNALS = ['@hypercomb/core', 'pixi.js']
   ```
4. **Signs** each artifact with `SignatureService.sign()` to produce a SHA-256 content hash
5. **Writes** the output as signature-named files:
   ```
   dist/<rootSig>/
     __dependencies__/<sig>.js    (namespace bundles)
     __drones__/<sig>.js          (individual drone bundles)
     __layers__/<sig>.json        (layer graph metadata)
     install.manifest.json        (list of all signatures)
   ```

### OPFS Storage Layout

After installation, the browser's Origin Private File System mirrors this structure:

```
opfs://
  __dependencies__/
    <sig1>.js   // contains: // @diamondcoreprocessor.com/core/settings
    <sig2>.js   // contains: // @diamondcoreprocessor.com/pixi
    ...
  __drones__/
    <sig3>.js   // pixi-host.drone compiled
    <sig4>.js   // show-honeycomb.drone compiled
    ...
  __layers__/
    <sig5>.json // layer graph with children, drones, dependencies
    ...
```

### Import Map Resolution (`resolve-import-map.ts`)

Before Angular bootstraps, the web app:

1. **Reads** every file in `opfs://__dependencies__/`
2. **Extracts** the namespace alias from the first line comment (e.g., `// @diamondcoreprocessor.com/core/settings`)
3. **Builds** an import map:
   ```json
   {
     "imports": {
       "@hypercomb/core": "/hypercomb-core.runtime.js",
       "pixi.js": "/vendor/pixi.runtime.js",
       "@diamondcoreprocessor.com/core/settings": "/opfs/__dependencies__/<sig>.js",
       "@diamondcoreprocessor.com/pixi": "/opfs/__dependencies__/<sig>.js"
     }
   }
   ```
4. **Injects** this as a `<script type="importmap">` element

### Drone Loading (`ScriptPreloader`)

After the import map is set:

1. `ScriptPreloader` iterates `opfs://__drones__/`
2. For each drone file, it calls `store.getDrone(signature, buffer)` which dynamically imports the module
3. The drone's self-registration runs: `register('PixiHost', new PixiHostDrone())`
4. Angular's `CoreAdapter` then calls `encounter()` on each drone to start them

### Why This Architecture

- **Core** and **pixi.js** are loaded as static vendor scripts (not from OPFS)
- **Essentials** modules are loaded from OPFS so they can be **updated without redeploying** the web app
- The import map ensures that when a drone does `import { Drone } from '@hypercomb/core'`, it resolves to the same runtime instance
- Each file is content-addressed (SHA-256), making cache invalidation trivial

---

## 5. Dev Project (Direct References)

The dev project (`hypercomb-dev`) is a development sandbox that bypasses OPFS entirely:

```typescript
// app.ts — direct static imports (no import map needed)
import { AxialService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/axial/axial-service'
import { PixiHostDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/pixi-host.drone'
import { ShowHoneycombDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/show-honeycomb.drone'
```

Each import triggers module loading, which triggers self-registration (`register('PixiHost', new PixiHostDrone())`). The dev project then encounters drones directly:

```typescript
const host = get('PixiHost')
await host.encounter('testing')
```

This gives instant feedback during development without the OPFS/import-map pipeline.

---

## 6. ServiceToken (Typed Resolution)

`ServiceToken<T>` provides type-safe access for gradual adoption:

```typescript
// @hypercomb/core
export class ServiceToken<T> {
  constructor(public readonly key: string, public readonly ngType?: any) {}
}

// Usage in shared tokens
export const LINEAGE = token<Lineage>('Lineage', Lineage)

// IoC container accepts tokens via duck typing
window.ioc.get(LINEAGE)  // TypeScript knows this returns Lineage | undefined
```

The container uses duck-type checking (`key in obj`) so tokens work across package boundaries without shared imports.

---

## Summary: Resolution Flow by Context

### Web App (Production)

```
1. ioc.web.ts installs window.ioc + globals
2. Shared services self-register (Store, Navigation, Lineage, ...)
3. ensure-install.ts downloads content from Azure → OPFS
4. resolve-import-map.ts reads OPFS → builds import map
5. apply-import-map.ts injects <script type="importmap">
6. Angular bootstraps with bridgeProviders connecting DI → window.ioc
7. ScriptPreloader loads drones from OPFS → drones self-register
8. CoreAdapter encounters drones → they activate
```

### Dev App (Development)

```
1. ioc.web.ts installs window.ioc + globals
2. Shared services self-register
3. Angular bootstraps
4. App component statically imports essentials → they self-register
5. App encounters drones directly → they activate
```

### Essentials (Runtime Modules)

```
1. Module loaded by browser ESM (import map resolves @hypercomb/core)
2. Drone extends Drone from @hypercomb/core
3. Drone declares deps = { pixiHost: 'PixiHost', axial: 'AxialService' }
4. Module self-registers: register('PixiHost', new PixiHostDrone())
5. On encounter: this.resolve('pixiHost') → get('PixiHost') from container
```
