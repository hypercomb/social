# Dependency Resolution

How dependencies are resolved across the four project types in the Hypercomb
workspace. Each layer has a different resolution mechanism and different
constraints on what it may reference.

---

## Project Layers

```
  @hypercomb/core          zero-dependency foundation (npm package)
        |
  @hypercomb/essentials    runtime plugin modules (npm package, OPFS delivery)
        |                  imports core as PLATFORM_EXTERNAL
        |
  @hypercomb/sdk           facade re-exporting core + build API (npm package)
        |                  imports core as peer dependency
        |
  @hypercomb/cli           command-line tool wrapping sdk (npm package)
        |                  imports sdk
        |
  @hypercomb/shared        shared services + Angular bridge (source reference)
        |                  imports core via tsconfig paths
        |
  hypercomb-web            Angular application (consumer)
  hypercomb-dev            Angular dev tool (consumer)
  diamond-core-processor   Angular DCP tool (consumer)
```

---

## 1. Core (`@hypercomb/core`)

**What it is:** A zero-dependency TypeScript package that defines the framework
primitives: `Drone`, `ServiceToken`, `SignatureService`, IoC (`register`/`get`/
`has`/`list`), `Effect`, `GrammarHint`, `ProviderLink`, `PayloadCanonical`,
`DroneResolver`, and `DcpResourceMessage`.

**Build tool:** tsup (ESM + CJS + `.d.ts`)

**Resolution rules:**
- Imports nothing external. Every type it needs is defined internally.
- Published to npm or referenced locally via `file:../hypercomb-core` in
  consumer `package.json` files.
- TypeScript compiler resolves it through `tsconfig.base.json` paths:
  ```
  "@hypercomb/core"   -> src/hypercomb-core/src/index.ts
  "@hypercomb/core/*" -> src/hypercomb-core/src/*
  ```
- At runtime in the browser, the import map resolves the bare specifier:
  ```
  "@hypercomb/core" -> /hypercomb-core.runtime.js
  ```

**Constraints:**
- Must never import from `shared`, `essentials`, `web`, or Angular.
- Must remain framework-agnostic so it can ship as an external to both the
  Angular apps and the OPFS-delivered essentials modules.

---

## 2. Essentials (`@hypercomb/essentials`)

**What it is:** A collection of domain-specific bees (drones + workers) and their dependencies,
compiled into content-addressed artifacts and delivered to the browser via OPFS
at runtime.

**Build tool:** Custom `build-module.ts` pipeline using esbuild.

**Build pipeline:**
1. **Discover** -- Walk `src/`, classify files as bees (`*.drone.ts`, `*.worker.ts`) or
   dependencies. Domains listed in `EXCLUDED_DOMAINS` (e.g. `revolucionstyle.com`)
   are skipped entirely -- their drones and namespaces are omitted from the build
   output. This allows domain-specific modules to exist in the source tree without
   shipping in the production artifact.
2. **Namespace** -- Group files into namespaces by directory path (up to 3
   segments). Example: `core/communication/mesh-adapter.ts` becomes namespace
   `@diamondcoreprocessor.com/core/communication`.
3. **Bundle** -- esbuild bundles each namespace into a single file. Two classes
   of imports are marked `external`:
   - **PLATFORM_EXTERNALS** (`@hypercomb/core`, `pixi.js`) -- never bundled,
     resolved by the browser import map at runtime.
   - **Sibling namespaces** -- resolved by the import map at runtime.
4. **Sign** -- SHA-256 hash each output to produce a content-addressed signature.
5. **Layer tree** -- Build a hierarchy of layer metadata, each signed. Root
   signature identifies the entire release.
6. **Output:**
   ```
   dist/<rootSignature>/
     install.manifest.json
     __layers__/<sig>.json
     __bees__/<sig>.js
     __dependencies__/<sig>.js
   ```

**Resolution rules:**
- At compile time: `@hypercomb/core` resolves via `tsconfig.base.json` paths.
- At bundle time: `@hypercomb/core` and `pixi.js` are externalized.
- At runtime (in browser):
  - `@hypercomb/core` -> `/hypercomb-core.runtime.js` (vendored, served from
    `public/`)
  - `pixi.js` -> `/vendor/pixi.runtime.js` (vendored)
  - `@diamondcoreprocessor.com/core` -> `/opfs/__dependencies__/<sig>.js`
    (served by service worker from OPFS)
  - Bees loaded via dynamic `import()` of `/opfs/__bees__/<sig>.js`

**Constraints:**
- May only import from `@hypercomb/core` or sibling namespaces within
  essentials. No Angular. No `@hypercomb/shared`.
- Key files (`*.keys.ts`) are excluded from artifacts.
- All dependency resolution beyond platform externals happens through the
  import map, which is constructed from whatever is present in OPFS.

---

## 3. Shared (`@hypercomb/shared`)

**What it is:** Service implementations (Lineage, Navigation, Store,
LayerInstaller, ScriptPreloader, etc.), the `window.ioc` bridge, Angular DI
tokens, and UI components (SearchBarComponent). Not published as an npm package;
instead, it is included in Angular app builds by source.

**Resolution rules:**
- At compile time: Resolved via `tsconfig.base.json` paths:
  ```
  "@hypercomb/shared"   -> src/hypercomb-shared/index.ts
  "@hypercomb/shared/*" -> src/hypercomb-shared/*
  ```
- The web apps' `tsconfig.app.json` physically includes shared source files:
  ```json
  "include": ["src/**/*.ts", "../hypercomb-shared/**/*.ts"]
  ```
  This means shared TypeScript is compiled as part of each Angular app's build,
  not as a pre-built library.

**IoC installation (`ioc.web.ts`):**
- Creates `window.ioc` if it doesn't exist (register/get/has/list/onRegister/
  graph).
- Installs global convenience functions: `window.get`, `window.register`.
- Must run before Angular bootstraps -- services like Store and LayerInstaller
  self-register as side effects of their module loading.

**Angular bridge (`tokens.ts` + `shared-providers.ts`):**
- Each shared service has a `SharedToken<T>` with an IoC key and an Angular
  class reference.
- `bridgeProviders()` generates Angular `Provider[]` entries that resolve via
  `window.ioc.get()` at injection time:
  ```
  { provide: Lineage, useFactory: () => window.ioc.get('Lineage') }
  ```
- This ensures Angular components that `inject(Lineage)` get the same singleton
  instance that OPFS-loaded drones get via `get('Lineage')`.

**Constraints:**
- May import from `@hypercomb/core` (via tsconfig paths).
- Must not import from `essentials` (essentials are loaded dynamically at
  runtime and may not be present at build time).
- Services must NOT use `@Injectable()` -- they are plain classes that
  self-register into `window.ioc`. Angular DI accesses them through the bridge
  providers.

---

## 4. Web Applications (`hypercomb-web`, `hypercomb-dev`, `diamond-core-processor`)

**What they are:** Angular applications that consume shared services and
dynamically load essentials at runtime.

**Bootstrap sequence (`main.ts`):**
```
1. import '@hypercomb/shared/core/ioc.web'    install window.ioc
2. await ensureSwControl()                     register service worker
3. await ensureInstall()                       fetch + write layers to OPFS (resumable)
4. await attachImportMap()                     build + insert <script type="importmap">
5. await bootstrapApplication(App, appConfig)  start Angular
```

**Resumable installs:** `ensureInstall()` only marks the signature as installed
in `localStorage` after all artifacts have been written to OPFS. If the install
is interrupted (tab closed, network failure), the next load detects the
incomplete state and resumes — the `LayerInstaller` skips files already present
in OPFS, so only missing artifacts are fetched. Incremental manifest diffing
removes stale entries from the previous version without clearing everything.

**Global bee markers:** After a successful install, `ensureInstall()` places
empty marker files in the `hypercomb.io/` root for every bee signature in the
manifest. `ScriptPreloader.find()` always scans the hypercomb root, so all
installed bees are discovered globally without requiring per-seed marker
placement.

**Resolution rules:**

| What | Mechanism | Resolved to |
|---|---|---|
| `@hypercomb/core` | tsconfig paths (compile) | `src/hypercomb-core/src/index.ts` |
| `@hypercomb/core` | import map (runtime) | `/hypercomb-core.runtime.js` |
| `@hypercomb/shared/*` | tsconfig paths + include | Source files compiled inline |
| `@angular/*` | npm `node_modules` | `hypercomb-web/node_modules/@angular/*` |
| Shared services | `window.ioc.get()` or Angular DI bridge | Singleton from IoC container |
| Bees | Dynamic `import('/opfs/__bees__/<sig>.js')` | Service worker serves from OPFS |
| Dependencies | Import map specifier | Service worker serves from OPFS |

**npm dependencies:**
- `@hypercomb/core` via `file:../hypercomb-core` (local symlink in dev)
- Angular, RxJS, etc. via standard npm resolution
- `diamond-core-processor` additionally depends on `esbuild-wasm` for in-browser
  TypeScript compilation of drone payloads

**Constraints:**
- Cannot reference `essentials` directly (runtime-only, loaded via OPFS).
- Must ensure service worker is ready before inserting the import map.
- Must ensure the import map is in the DOM before any dynamic `import()` of
  OPFS modules.
- All shared file imports resolve through the workspace root `node_modules` for
  third-party packages.
- All shared file imports resolve through the workspace root `node_modules` for
  third-party packages. Angular package versions must match between the workspace
  root and the app's own `node_modules` to avoid duplicate runtimes.

---

## Import Map

The import map is generated at runtime from the contents of OPFS. It is inserted
as a `<script type="importmap">` element before Angular bootstraps.

```json
{
  "imports": {
    "@hypercomb/core": "/hypercomb-core.runtime.js",
    "pixi.js": "/vendor/pixi.runtime.js",
    "@diamondcoreprocessor.com/core": "/opfs/__dependencies__/<sig>.js",
    "@diamondcoreprocessor.com/input": "/opfs/__dependencies__/<sig>.js",
    "@diamondcoreprocessor.com/core/communication": "/opfs/__dependencies__/<sig>.js"
  }
}
```

Namespace aliases are extracted from a comment on the first line of each
dependency file in OPFS (e.g. `// @diamondcoreprocessor.com/core`).

---

## Service Worker

The service worker (`hypercomb.worker.js`) intercepts fetch requests matching
`/opfs/**` and serves them from OPFS:

- `/opfs/__bees__/<sig>.js` -> OPFS `__bees__/<sig>.js`
- `/opfs/__dependencies__/<sig>.js` -> OPFS `__dependencies__/<sig>.js`
- `/opfs/__layers__/<sig>.json` -> OPFS `__layers__/<sig>.json`

It searches both root-scoped directories and domain-scoped directories (for
multi-tenant support), using a cache-first strategy.

---

## Summary of Mechanisms

| Layer | Compile-time | Bundle-time | Runtime |
|---|---|---|---|
| **Core** | (self-contained) | tsup ESM+CJS | vendored `.runtime.js` via import map |
| **Essentials** | tsconfig paths to core | esbuild, externalize core + pixi + siblings | OPFS + service worker + import map |
| **Shared** | tsconfig paths to core + shared | compiled inline with Angular app | `window.ioc` self-registration |
| **Web apps** | tsconfig paths to core + shared, npm for Angular | Angular CLI (esbuild) | import map + service worker + IoC bridge |

---

## Known Pitfall: Dual Angular Runtime

Because `hypercomb-shared/**/*.ts` is compiled as part of the web app but lives
outside the app's `node_modules` tree, esbuild can resolve `@angular/core` to a
different installation for shared files vs app files. If the workspace root
(`src/node_modules/`) has a different Angular version than the app
(`src/hypercomb-web/node_modules/`), esbuild bundles two Angular runtimes,
causing `firstCreatePass` null crashes.

**Fix:** Ensure all `node_modules/@angular/*` installations across the workspace
resolve to the same physical files (directory junctions, version alignment, or
npm workspaces hoisting).
