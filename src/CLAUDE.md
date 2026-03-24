# Hypercomb - Claude Code Instructions

## Philosophy

Minimalism. Small surface area. No unnecessary abstractions. Signatures (SHA-256 hashes of canonical content) are the primary identity primitive — they name drones, layers, dependencies, and history entries.

**Externalize everything.** All features and functionality must be externally loadable as drone modules. Code may live in Angular/shared projects during early development, but the strategy is to migrate anything that can live outside the web shell into interchangeable, signature-addressed modules. The community can fork, improve, and share modules via the merkle tree sharing pattern — signatures ensure integrity and deduplication across the network.

## Project Roles

There are five project tiers with distinct roles:

| Project | Role | Build | Consumed by |
|---------|------|-------|-------------|
| **hypercomb-core** | Core primitives (IoC, EffectBus, Drone base, Signatures) | `tsup` → `dist/` | essentials, sdk, shared, web, dev |
| **hypercomb-essentials** | Module project — drones, supporting services (IoC), and resources (static assets) | `tsup` → `dist/` | dev (import), web (runtime OPFS) |
| **hypercomb-sdk** | Facade — re-exports core types, env-agnostic IoC proxy, build API | `tsup` → `dist/` | cli, external consumers |
| **hypercomb-cli** | CLI tool — `hypercomb build`, `hypercomb inspect` | `tsup` → `dist/` | Developers (terminal) |
| **hypercomb-shared** | Shared source — Store, Navigation, Lineage, UI components | No build (raw `.ts`) | web, dev (direct tsconfig include) |
| **hypercomb-web** | Production Angular app — loads drones at **runtime** from OPFS | `ng build` | End users |
| **hypercomb-dev** | Development Angular app — imports drones at **dev-time** directly | `ng build` | Developers |

### Dependency direction (critical)

```
Modules (essentials) → can only import from → Core
Shared / Web / Dev  → can consume modules via IoC at runtime
Modules             → must NEVER import from → Shared, Web, or Dev
```

If a drone or service in essentials needs something that currently lives in shared, it must be migrated down to **core** (if it's a primitive) or kept in **essentials** (if it's module-level). Shared and web must never be upstream of a module.

### What belongs where

- **Core**: Primitives that any module on any platform needs — IoC, EffectBus, Drone base, Signatures.
- **Essentials (modules)**: All features and functionality — drones, supporting services, resources (static assets like images, text, styles, JSON, byte arrays), and domain logic. These are signed, interchangeable, and community-shareable.
- **Shared**: Shell-level plumbing shared between web implementations — bootstrapping, installing/deploying files, Angular UI chrome. Temporary home for code migrating toward modules.
- **Web / Dev**: Bootstrapping shells. Deploy files, initialize the runtime, load modules. A different platform (e.g., Windows native, mobile) would replace the shell but load the same signed modules.

### Dev-time vs Runtime loading

- **hypercomb-dev** imports essentials classes directly in TypeScript. The constructor instantiates them and they self-register in `window.ioc`. Fast iteration, no OPFS needed.
- **hypercomb-web** never imports essentials. Instead: `LayerInstaller` downloads signed bundles → stores in OPFS → `ScriptPreloader` dynamically imports them at runtime via import maps → drones self-register in `window.ioc`.

## Build Chain

When you change code, rebuild in dependency order:

```
hypercomb-core → hypercomb-essentials → hypercomb-web / hypercomb-dev
```

### What to rebuild

| Changed | Rebuild |
|---------|---------|
| **hypercomb-core** | `npm run build:core` then `npm run build:essentials` then (if web) `npm run runtime:core` in hypercomb-web |
| **hypercomb-essentials** | `npm run build:essentials` (builds + copies modules to web `public/content/` for local dev) |
| **hypercomb-shared** | Nothing — raw source, Angular dev server hot-reloads |
| **hypercomb-web** | Nothing extra — `ng serve` or `ng build` |
| **hypercomb-dev** | Nothing extra — `ng serve` or `ng build` |

### Key commands (run from monorepo root `src/`)

```bash
npm run build:packages          # Build core + essentials in order
npm run build:core              # Build core only
npm run build:essentials        # Build essentials (tsup + esbuild modules + copy to web)
npm run deploy:essentials       # Build essentials + deploy to Azure (production)
```

From `hypercomb-web/`:
```bash
npm start                       # ng serve
npm run runtime                 # Copy core dist + bundle pixi.js to public/
npm run runtime:core            # Copy core dist to public/core/
```

### Module delivery pipeline

Essentials are built as **signature-addressed modules** and auto-installed into OPFS at runtime:

1. **Build** (`npm run build:essentials`): esbuild bundles drones into `dist/{rootSig}/` with `__layers__/`, `__bees__/`, `__dependencies__/`, and `install.manifest.json`. Then `copy-to-web.ts` copies output to `hypercomb-web/public/content/{rootSig}/` and writes `latest.txt`.
2. **Deploy** (`npm run deploy:essentials`): Same build, but uploads to Azure blob storage (`storagehypercomb`) instead of copying locally. Uploads `latest.txt` and `latest.json` for discovery.
3. **Runtime auto-install**: On app load, `ensureInstall()` fetches `latest.txt` → gets root signature → `LayerInstaller` downloads `install.manifest.json` and all listed layers/bees/deps → writes to OPFS. Skips if already installed (checked via `localStorage` + OPFS directory presence).
4. **Import map**: `resolveImportMap()` reads `__dependencies__/` from OPFS, extracts aliases from first-line comments (`// @scope/name`), and injects a dynamic `<script type="importmap">`.
5. **Module loading**: `DependencyLoader` imports dependencies via the import map. `ScriptPreloader` loads bees from OPFS, instantiates them, and registers in IoC.

## Documentation File Placement

- **`docs/`** — Project architecture docs only: protocol specs, governance, licensing, glossary, contributing guides, and other top-level hypercomb design documents.
- **`src/documentation/`** — **All other markdown files.** Any `.md` documentation that is not a top-level project architecture document **must** go in `src/documentation/`. This includes feature docs, how-things-work explanations, implementation guides, runtime behavior docs, and any new documentation you create.

**Rule**: Always place new markdown documentation in `src/documentation/` unless it is a top-level project architecture document (protocol specs, governance, licensing, glossary, contributing guides).

## Monorepo Structure

```
src/
├── hypercomb-core/             # IoC, EffectBus, Drone base, SignatureService, KeyMap types
├── hypercomb-essentials/       # Drones + services, organized by domain namespace
│   └── src/
│       ├── diamondcoreprocessor.com/   # Core processor domain — feature-oriented tree
│       │   ├── assistant/              # AI assistant integration (ClaudeBridgeWorker)
│       │   ├── clipboard/              # Copy, cut, paste (ClipboardWorker, ClipboardService)
│       │   ├── commands/               # Command palette, slash commands, help, shortcut sheet
│       │   ├── editor/                 # Tile content editing + image manipulation
│       │   ├── history/                # Change tracking / undo-redo (HistoryRecorder, HistoryService)
│       │   ├── keyboard/               # Keyboard shortcuts, keymap, escape cascade, pivot toggle
│       │   ├── move/                   # Drag tiles to reorder (MoveDrone, LayoutService)
│       │   ├── navigation/             # Pan, zoom, touch gestures, hex detection
│       │   │   ├── pan/                # Spacebar + drag panning
│       │   │   ├── zoom/               # Mousewheel + pinch zoom, ZoomArbiter
│       │   │   └── touch/              # Multi-touch gesture coordination
│       │   ├── preferences/            # User settings + zoom config (SettingsDrone, Settings)
│       │   ├── presentation/           # Visual rendering engine (Pixi.js)
│       │   │   ├── avatars/            # Avatar particle swarm
│       │   │   ├── background/         # Context-aware backgrounds
│       │   │   ├── grid/               # Hexagonal grid, coordinates, shaders, atlases
│       │   │   └── tiles/              # Tile overlays, actions, selection highlight, move preview
│       │   ├── selection/              # Tile selection (SelectionService, TileSelectionDrone)
│       │   └── sharing/                # Peer-to-peer publishing via Nostr relays
│       └── revolucionstyle.com/        # Cigar journal domain module
│           ├── journal/                # CigarJournalDrone, JournalEntryDrone, JournalService
│           ├── wheel/                  # FlavorWheelDrone, FlavorWheelService, flavor taxonomy
│           ├── cigar/                  # Cigar identity, CigarCatalogService
│           └── discovery/              # DiscoveryService (Jaccard similarity recommendations)
├── hypercomb-sdk/              # Facade: re-exports core types, env-agnostic IoC proxy, build API
├── hypercomb-cli/              # CLI tool: `hypercomb build`, `hypercomb inspect`
├── hypercomb-shared/           # Store, Lineage, Navigation, LayerInstaller, UI components
│   ├── core/                   # Services: Store, Lineage, Navigation, SecretStore, RoomStore, ioc.web
│   └── ui/                     # Angular components: CommandLine, ControlsBar, FileExplorer, History
├── hypercomb-web/              # Production Angular app (runtime drone loading)
├── hypercomb-dev/              # Development Angular app (direct drone imports)
├── documentation/              # Feature docs, implementation guides, how-things-work
└── docs/                       # ARCHITECTURE.md, BYTE-PROTOCOL.md, GLOSSARY.md
```

## Path Aliases (tsconfig.base.json)

- `@hypercomb/core` → `src/hypercomb-core/src/index.ts`
- `@hypercomb/essentials` → `src/hypercomb-essentials/src/index.ts`
- `@hypercomb/shared` → `src/hypercomb-shared/index.ts`
- `@hypercomb/sdk` → `src/hypercomb-sdk/src/index.ts`
- `@hypercomb/cli` → `src/hypercomb-cli/src/index.ts`

## Core Primitives

### Signatures
SHA-256 hash (64 hex chars) of canonical content. Created via `SignatureService.sign(bytes)`. Used to name and identify everything: drones, layers, dependencies, history entries. Immutable identity.

### IoC (Service Locator)
```typescript
window.ioc.register('@domain.com/ClassName', instance)
window.ioc.get<T>('@domain.com/ClassName')
```
Keys follow format `@namespace/Name`. Global via `window.ioc`.

### EffectBus (Pub/Sub with Last-Value Replay)
```typescript
protected emitEffect('effect:name', payload)   // Publish
protected onEffect('effect:name', handler)      // Subscribe (auto-cleanup on dispose)
```
Late subscribers receive the last emitted value immediately. No timing races.

### `synchronize` Event (critical)
The `synchronize` window event **must only be dispatched from the processor** (`hypercomb.act()`). It fires in the `finally` block after all bees have pulsed, coalescing visual updates into a single pass. Because the processor is the sole dispatcher, `synchronize` does not need a `detail` payload — no source tagging, revision data, or history ops. Any code that currently dispatches `synchronize` directly must be refactored to let the processor handle it.

### Drones
Self-contained modules. Lifecycle: Created → Registered → Active → Disposed.
- `sense(grammar)` — should this drone activate?
- `heartbeat(grammar)` — main entry point
- Self-register in IoC at module load (side-effect pattern)
- Declare `deps`, `listens`, `emits` for introspection

### OPFS (Origin-Private File System)
```
/opfs/
  __bees__/{signature}.js         # Compiled drone/bee modules
  __dependencies__/{signature}.js # Namespace service bundles (first line: // @scope/alias)
  __resources__/{signature}       # Content-addressed static assets
  __layers__/{domain}/            # Domain-scoped layer manifests + install.manifest.json
  hypercomb.io/                   # User content tree
```

## Coding Conventions

- **Private fields**: Always `#field`, never `private` keyword
- **Reactivity**: `EventTarget` + `dispatchEvent(new CustomEvent('change'))` — not new state libraries
- **Services**: Extend `EventTarget`, use `#field` with public getters, register in IoC
- **Angular signals**: Use `fromRuntime()` to bridge EventTarget → Angular Signal
- **File naming**: `*.drone.ts`, `*.service.ts`, `*.component.ts`
- **Class naming**: PascalCase. IoC keys: `@domain.com/ClassName`
- **Imports**: ESM only. `.js` extensions in relative imports. Path aliases cross-package.
- **Minimalism**: No unnecessary abstractions. Prefer direct solutions over indirection.

## Things to Avoid

- `private` keyword for fields — use `#field`
- New state management libraries — use EventTarget + EffectBus
- Bypassing IoC for cross-service resolution
- CommonJS — everything is ESM
- Over-engineering or premature abstraction
- Hardcoding features into the web shell — if it can be a drone module, it should be

## Tech Stack

Angular 21 · TypeScript 5.9 (ES2022, strict) · Pixi.js 8 · tsup · esbuild · nostr-tools · Node >=20.19.0

## License

Code: AGPL-3.0-only · Docs: CC BY-SA 4.0
