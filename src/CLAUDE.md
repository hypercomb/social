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

For full command reference, deploy flow, and the runtime install pipeline (esbuild → OPFS → ScriptPreloader), see [documentation/build-pipeline.md](documentation/build-pipeline.md).

## Documentation File Placement

All markdown documentation lives in `src/documentation/`. Never create a `docs/` folder.

## Monorepo Structure

```
src/
├── hypercomb-core/             # IoC, EffectBus, Drone base, SignatureService, KeyMap types, I18nProvider
├── hypercomb-essentials/       # Drones + services, organized by domain namespace
│   └── src/
│       ├── diamondcoreprocessor.com/   # Core processor domain — feature-oriented tree
│       │   ├── assistant/              # AI assistant integration (ClaudeBridgeWorker)
│       │   ├── clipboard/              # Copy, cut, paste (ClipboardWorker, ClipboardService)
│       │   ├── commands/               # Command palette, slash behaviours, help, shortcut sheet
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
│   ├── core/                   # Services: Store, Lineage, Navigation, SecretStore, RoomStore, ioc.web, i18n
│   ├── i18n/                   # Translation catalogs: en.json, ja.json
│   └── ui/                     # Angular components: CommandLine, ControlsBar, FileExplorer, History
├── hypercomb-web/              # Production Angular app (runtime drone loading)
├── hypercomb-dev/              # Development Angular app (direct drone imports)
└── documentation/              # ALL documentation: protocol specs, governance, licensing, feature docs, guides
```

## Path Aliases (tsconfig.base.json)

- `@hypercomb/core` → `src/hypercomb-core/src/index.ts`
- `@hypercomb/essentials` → `src/hypercomb-essentials/src/index.ts`
- `@hypercomb/shared` → `src/hypercomb-shared/index.ts`
- `@hypercomb/sdk` → `src/hypercomb-sdk/src/index.ts`
- `@hypercomb/cli` → `src/hypercomb-cli/src/index.ts`

## Core Primitives

### Signatures — The Universal Reference Primitive

SHA-256 hash (64 hex chars) of canonical content. Created via `SignatureService.sign(bytes)`. Immutable identity.

**Core rule**: Any JSON field, class property, or configuration value holding content that could be shared, cached, versioned, or composed must hold a **signature reference** to a resource in `__resources__/`, not inline data. Same content → same signature → stored once, referenced many times.

```typescript
// ✅ signature reference
{ "op": "reorder", "cell": "a1b2c3d4...", "at": 1712345678 }

// ❌ inline data that should be a resource
{ "op": "reorder", "cell": "my-tile-name", "data": { "order": ["a","b","c"] } }
```

For the full doctrine (deduplication, snapshots, composition, anti-patterns, audit criteria, where signatures appear), see [documentation/signature-system.md](documentation/signature-system.md) and [documentation/signature-algebra.md](documentation/signature-algebra.md).

### IoC (Service Locator)
```typescript
window.ioc.register('@domain.com/ClassName', instance)
window.ioc.get<T>('@domain.com/ClassName')
```
Keys follow format `@namespace/Name`. Global via `window.ioc`.

**Registration semantics must be explicit.** Distinguish first-time `register` from intentional `replace` when re-registering. Silent-skip and silent-overwrite are both bug-classes — if your code path may re-register a key, the intent must be named (replace/conflict-error/no-op), not left to default behaviour. See commit f4f7c86c.

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

## Localization (i18n)

All UI text routes through `LocalizationService` for runtime locale switching. In Angular templates: `{{ 'key' | t }}` (or `'key' | t: { count: n }` for interpolation). In TypeScript: `ioc.get('@hypercomb.social/I18n').t('key', params)`. Bees register namespace translations via `i18n.registerTranslations(domain, locale, catalog)` inside `whenReady(I18N_IOC_KEY, …)`. Slash behaviours use `descriptionKey` for localized autocomplete.

For catalog layout, key conventions (flat dot-separated, plurals, interpolation), locale switching, and full examples, see [documentation/i18n.md](documentation/i18n.md).

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

## State contracts: explicit divergence

Heuristic comparisons over user-mutable state (`.length`, equality, "did this change?") must justify which kind of divergence they're claiming and which mutations are user-driven vs system-driven. Don't conflate user state changes with deployment drift — that's how silent state-clobber bugs ship. See commit f93b9c7d.

## OPFS: user data vs install cache (READ BEFORE TOUCHING)

The web shell's OPFS root is split into two zones with different ownership:

**User data — NEVER wipe, NEVER `removeEntry` on these in scripts, console snippets, or "let me cold-boot test" experiments:**
- `hypercomb.io/` — the user's content tree (tiles, folders, body resources)
- `__history__/` — per-lineage layer commit chains (every undo/redo entry the user has ever made)
- `__resources__/` — signature-addressed content blobs the user has authored or pulled
- `__receipts__/` — receipt log
- `__structure__/` — structure cache
- `__threads__/` — thread state

**Install/sync cache — owned by `ensureInstall` / `resyncFromSentinel`, safe to clear if you're inside that code path:**
- `__bees__/` — drone bundles by signature
- `__dependencies__/` — namespace deps by signature
- `__layers__/sentinel/` — sentinel-scoped layer cache (NOT `__layers__/` root, which may hold domain-scoped user-installed data)

**Verification rule:** to prove an essentials change reaches the web shell, do NOT clear OPFS. Use signature comparison instead — make a source change, rebuild, reload, and check that the new bee signatures appear in the manifest and the new bytes are in `__bees__/`. The user's data dirs should be unchanged across the test. If you find yourself reaching for `localStorage.clear()` or `navigator.storage.getDirectory()` removal, stop — there is a non-destructive way to verify.

**Destructive-op discipline:** any code that calls `removeEntry`, `clear`, or full OPFS traversal must explicitly name which zone (user data vs install/sync cache) it is touching and justify why it isn't reaching user data. Default-deny for any path not in the install/sync allowlist above.

## Web/Dev shell parity

`hypercomb-web/src/app/app.html` and `hypercomb-dev/src/app/app.html` must mount the same set of shell-level UI components from `@hypercomb/shared/ui/`. Drift between them is a class of bug where data flows correctly (drones register, layers commit) but the relevant panel never renders in production because web's shell template is missing the selector.

When adding a new shell-level UI component (overlay, panel, strip, viewer):
1. Add the import + selector to BOTH `hypercomb-web/src/app/app.{ts,html}` and `hypercomb-dev/src/app/app.{ts,html}`.
2. Long-term direction: move shell-level UI into a registry-fed component the way drones contribute icons via `IconProviderRegistry` (see `drone-installer-contract.md`) so drift becomes structurally impossible.

## Agent Coordination (Multi-Worktree)

When working in a worktree alongside other agents:

1. **Before starting work**, run `/claim` to register your files and check for conflicts
2. **When done** (or before `/cleanup`), run `/unclaim` to release your claim
3. The coordination registry lives at `src/.claude/coordination.json`
4. Claims older than 30 minutes without a heartbeat update are considered stale
5. If you detect a conflict, coordinate with the user before proceeding

## Tech Stack

Angular 21 · TypeScript 5.9 (ES2022, strict) · Pixi.js 8 · tsup · esbuild · nostr-tools · Node >=20.19.0

