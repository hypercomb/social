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

- **Core**: Primitives that any module on any platform needs — IoC, EffectBus, Drone base, Signatures, I18nProvider.
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

1. **Build** (`npm run build:essentials`): esbuild bundles drones into flat `dist/` as **sig-named files** (layers, bees, dependencies — no typed dirs) plus `manifest.json`. Then `copy-to-web.ts` copies output to `hypercomb-web/public/content/`. *(Legacy note: already-deployed content may still use the retired `__layers__/`/`__bees__/`/`__dependencies__/` URL layout; fetchers try the flat `/<sig>` URL first and fall back to the legacy typed URL — new builds never emit those dirs.)*
2. **Deploy** (`npm run deploy:essentials`): Same build, but uploads flat content to Azure blob storage (`storagehypercomb`) instead of copying locally. Uploads `manifest.json` for discovery.
3. **Runtime auto-install**: On app load, `ensureInstall()` uses sentinel sync or `LayerInstaller` fetches `manifest.json` → looks up package by signature → downloads all listed layers/bees/deps → writes sig-named files to the OPFS root and the `sign('bees')`/`sign('dependencies')` pools. Skips if already installed (checked via `localStorage` + OPFS presence).
4. **Import map**: `resolveImportMap()` reads the `sign('dependencies')` pool from OPFS (union-reading the legacy `__dependencies__/` dir as a read-only fallback while it drains), extracts aliases from first-line comments (`// @scope/name`), and injects a dynamic `<script type="importmap">`.
5. **Module loading**: `DependencyLoader` imports dependencies via the import map. `ScriptPreloader` loads bees from OPFS, instantiates them, and registers in IoC.

## Documentation File Placement

**All documentation lives in `src/documentation/`.** There is no `docs/` folder. Do **not** create a `docs/` directory at the repository root or anywhere else — it has been removed and all content consolidated into `src/documentation/`.

- **`src/documentation/`** — The **sole** location for all markdown documentation: protocol specs, governance, licensing, glossary, contributing guides, feature docs, implementation guides, runtime behavior docs, architecture docs, and any new documentation you create.

**Rule**: Never create or write to a `docs/` folder. Always place all markdown documentation in `src/documentation/`.

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
│       │   ├── selection/              # Tile selection (SelectionService, SelectionInputDrone)
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

**Signatures are not just identifiers — they are the composition mechanism.** Any JSON field, class property, array element, or configuration value that references content must hold a signature pointing to a sig-named resource at the content root, not inline data. This is the fundamental pattern of the architecture:

```typescript
// ✅ CORRECT: signature references — content lives at the content root: <root>/<sig>
{ "op": "reorder", "cell": "a1b2c3d4...", "at": 1712345678 }
{ "turns": [{ "role": "user", "contentSig": "e5f6a7b8..." }] }
{ "manifestSig": "c9d0e1f2...", "hidden": ["selector1", "selector2"] }

// ❌ WRONG: inline data that should be a resource
{ "op": "reorder", "cell": "my-tile-name", "data": { "order": ["a","b","c"] } }
{ "turns": [{ "role": "user", "content": "Hello, this is a long message..." }] }
```

**Why this matters:**
- **Deduplication**: same content → same signature → stored once, referenced many times
- **Instant cache hits**: hold the signature, load the sig-named resource from the content root (`<root>/<sig>`) — no queries, no lookups
- **History composition**: history ops point at resource signatures. Undo = load the previous resource. Time-travel = load the resource at any timestamp. Infinitely expandable.
- **Sharing**: a signature can be shared, imported, or bundled. The recipient resolves it against their own OPFS.
- **Immutability**: content never changes. New content = new signature. Old signatures remain valid forever.

**The expansion pattern**: JSON files embed signatures as string values. At runtime, code resolves them lazily via `Store.getResource(sig)` or `Store.getBee(sig)`. The resolution is always on-demand — signatures remain as lightweight string pointers until explicitly expanded.

**Where this applies (non-exhaustive):**
- History operations (`cell` field holds resource signatures for complex payloads)
- Thread manifests (`contentSig` holds message content signatures)
- Layer files (`bees[]`, `layers[]`, `dependencies[]` are all signature arrays)
- Install manifests (`packages` keyed by package signature)
- Settings and presets (stored as resources, referenced by signature in history)
- Instruction manifests and instruction settings (signature-addressed resources)
- Any new feature that stores structured data

**Rule**: When designing a new feature, data structure, or JSON format — if a field contains content that could be shared, cached, versioned, or composed, it must be a signature reference to a resource. Never store expandable content inline when it can be content-addressed. See `src/documentation/signature-algebra.md` for the formal theory and `src/documentation/signature-system.md` for the expansion doctrine and practical guide.

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

### Optimize Phase (derived caches, never truth)

After `synchronize`, the processor schedules a **coalesced idle pass** that calls the optional `optimize()` hook on every registered bee. This is the ONLY sanctioned place to mint derived-cache records. The contract (full spec: `src/documentation/optimize-phase.md`):

1. Records must be **pure derivations of sig-addressed inputs, keyed by the input signature** (e.g. a children manifest keyed by its parent layer sig). Invalidation is automatic — changed source = new sig = no record yet. There is no update, only derive-on-miss.
2. Records live in **derived-cache pools** (`sign('manifests')`, `sign('visual-optimization')`, …) — recomputable, wipe-safe, GC-able.
3. Records are **never load-bearing**: no layer may reference them, no read path may require them, cold paths must produce identical results without them. Complete-or-absent — never write a partial record.
4. **Never mint truth in the phase**: no layers, no history markers, no lineage writes, no gating.

Litmus test for where a record belongs: *"Could a cold client rebuild this from layers alone?"* Yes → derived-cache pool (may be minted in the optimize phase). No → it is state; it needs its own pool of meaning and must NOT be written from the phase. (This is why hidden-feature records belong in `sign('hidden')`, not the optimization pool.)

Do NOT reintroduce derived-cache writes into the commit path (`commitLayer` mints truth only) and do NOT key caches by name/path/position — only by source signature.

### Doctrine ratchets (`src/doctrine.spec.ts`)

Mechanical anti-drift guards run with the vitest suite. Each compares files matching a forbidden pattern (direct `synchronize` dispatch, hardcoded 64-hex signatures, bare `'__x__'` typed-folder literals, out-of-place children-manifest writers) against a frozen allowlist. **Never extend an allowlist** — fix the code instead. When you pay down a listed debt, remove its entry so the ratchet clicks tight.

### Drones
Self-contained modules. Lifecycle: Created → Registered → Active → Disposed.
- `sense(grammar)` — should this drone activate?
- `heartbeat(grammar)` — main entry point
- Self-register in IoC at module load (side-effect pattern)
- Declare `deps`, `listens`, `emits` for introspection

### OPFS (Origin-Private File System)

There are **no typed `__x__` folders** (eradicated — never reintroduce one,
and never propose a new one, even aspirationally; a new grouping is a **pool
of meaning**, never a `__name__` dir). The model:

- **Content bytes are sig-named files at the OPFS root.** The user-content
  root IS the OPFS root (`hypercombRoot === opfsRoot`). A resource/layer
  entry is `<root>/<sig>`.
- **The only folders are signature-named**:
  - **Lineage sigbags** — `<lineageSig>/` holding `0000`, `0001`, … `000x`
    marker files; the max marker IS the current root/head.
  - **Pools of meaning** — dirs named `sign(<meaning>)` (SHA-256 of the
    UTF-8 meaning string). Addresses are DERIVED at runtime via
    `Store.poolSignature(meaning)` / `store.getPool(meaning)` — never
    hardcode the hex in code. For humans:

    | Meaning | sign(meaning) |
    |---|---|
    | `optimization` | `be92e94aba0be148ec1f142becadb01480a3c633ed6e675d98945416a5a3d24d` |
    | `bees` | `23da0d3b0b5aa5ee43ba33f15f971ee4cf32afd1b27ad901863346ba9dd06966` |
    | `dependencies` | `2188dfc2d889b53230f6891977d505642d718b940aa3eec23985afb379141dcd` |
    | `clipboard` | `a78c94675455b6203686c7f220c225c90d386a52a623c547bfce8bbbac94c31c` |
    | `threads` | `4cc500db62ede737f8f7a8c83c02b5fc5cbcebf26bffc48fb49b4540ffc67306` |
    | `computation` | `fb209e75cfb94344539afe813559f0950250a5ab843fcb30d1231021428d11ac` |
    | `manifests` | `c7af7c7a948db8800f71f26f3c90280cf09dfc3141b72318c5ff31ffc9470a59` |
    | `websites:menu` | `17deba5bf2d5bceded9326cba402164b576529d811d73f5f2d2285cd5d038fbb` |

    **Collision rule for NEW meanings**: lineage sigbags share the flat
    root namespace, and a bag is named `sha256(lineageKey(segments))` —
    for a single-segment location that is `sha256(<slug>)`, so a bare-word
    meaning collides with any tile/page whose slug equals it (verified:
    `sign('websites')` IS the `/websites` launcher bag). `lineageKey`
    folds every non-letter/number to `-`, so a `:` in the meaning string
    (e.g. `websites:menu`) can never be produced by a location — every
    NEW pool meaning MUST carry a colon. A doctrine ratchet enforces
    this: the bare-word set in `hypercomb-core/src/core/pool-registry.ts`
    is frozen and may only SHRINK (migrating one away needs a drain plan
    — `sign()` of a new spelling mints a different address forever).

    **Never keep a local list of pool meanings.** The root is an
    UNTAGGED UNION of `{lineage bag, pool}` and any module may mint a
    pool, so no fixed list is ever complete — four separate copies had
    drifted, and `/flatten` on a colliding bare-word address HARD
    DELETED the whole pool. Ask the registry instead:
    `isPoolAddress(sig)`, `poolMeaningOf(sig)`, `poolAddresses()`,
    `poolMeanings()`. It is seeded with the full census AND
    self-extending — `Store.poolSignature` / `registerPoolMeaning` are
    the only sanctioned derivations, and deriving an address registers
    it. Anything that walks, prunes, or enumerates the root must
    consult it before treating a sig-named dir as a lineage bag.
    Full paradigm — closed root vocabulary, user names scoped one level
    down inside known pools, marks classify never resolve:
    `src/documentation/known-location-pools.md`.

- **Legacy `__x__` dirs are self-cleaning drain sources.** (`__hive__/`,
  `hypercomb.io/`, `__layers__/`, `__resources__/`, `__optimized__/`,
  `__history__/`, `__bees__/`, `__dependencies__/`, `__clipboard__/`,
  `__threads__/`, `__computation__/`, `__manifests__/`.) They are opened
  `create: false` (try/catch → `undefined`), read-fallback only, and are
  migrated + removed automatically — detached record-pool absorbs after
  init, and the content relocation self-schedules off the boot path
  (`/consolidate-content` forces a run). Reads try the new location first,
  then legacy. **Writes NEVER target a legacy dir.** Lineage bags
  union-resolve across root + legacy sources; the HIGHEST marker wins.

```
# Hive (hypercomb.io app) — the OPFS root IS the participant's tree
<opfs root>/<sig>            # content bytes: layers, resources (flat, sig-named)
<opfs root>/<lineageSig>/    # lineage sigbags (000x markers, max = current)
<opfs root>/<sign(meaning)>/ # pools of meaning (table above)

# DCP (installer) — domain identity scopes, unchanged (not typed folders)
dcp/hypercomb.io/            # the LOGICAL install: sigbags (packages + pushed tiles)
dcp/<current files>/         # pushed tiles
dcp/domain.com/              # one folder per adopted domain: its sigbag + sig files at the root
dcp/domain2.com/
```

## Localization (i18n)

Runtime localization framework — no build-time compilation. All UI text goes through `LocalizationService` so the app can switch languages instantly.

### Architecture

```
hypercomb-core/src/i18n.types.ts        ← I18nProvider interface + I18N_IOC_KEY (modules import this)
hypercomb-shared/core/i18n.service.ts   ← LocalizationService (extends EventTarget, self-registers)
hypercomb-shared/core/i18n.pipe.ts      ← Angular `| t` pipe for templates
hypercomb-shared/core/i18n.signal.ts    ← ti18n() signal helper for component classes
hypercomb-shared/i18n/en.json           ← English catalog
hypercomb-shared/i18n/ja.json           ← Japanese catalog
```

### Usage in Angular templates

```html
{{ 'editor.save' | t }}                          <!-- simple key -->
{{ 'activity.pasted' | t: { count: 5 } }}        <!-- with interpolation -->
[placeholder]="'palette.placeholder' | t"         <!-- attribute binding -->
[attr.aria-label]="'controls.center' | t"         <!-- aria-label -->
```

### Usage in TypeScript (components/bees)

```typescript
const i18n = get('@hypercomb.social/I18n') as I18nProvider | undefined
const msg = i18n?.t('activity.added', { cell: name }) ?? `added "${name}"`
```

### Slash behaviour descriptions

Slash behaviours use `descriptionKey` on `SlashBehaviour` for localized autocomplete:
```typescript
{ name: 'help', description: 'Show keyboard shortcuts', descriptionKey: 'slash.help' }
```
`SlashBehaviourDrone.match()` resolves descriptions via i18n at match time.

### Community module translations

Bees register namespace-scoped translations at load time:
```typescript
import type { I18nProvider, I18N_IOC_KEY } from '@hypercomb/core'
window.ioc.whenReady(I18N_IOC_KEY, (i18n: I18nProvider) => {
  i18n.registerTranslations('my-module.com', 'en', { 'greeting': 'Hello' })
  i18n.registerTranslations('my-module.com', 'ja', { 'greeting': 'こんにちは' })
})
```

### Locale switching

```typescript
window.ioc.get('@hypercomb.social/I18n').setLocale('ja')  // persists to localStorage, updates document.lang
```

Or via slash behaviour: `/language ja`, `/language en`, `/lang jp`

### Key conventions

- Flat dot-separated keys: `component.element` (e.g., `editor.save`, `controls.clipboard`)
- Slash behaviour keys: `slash.behaviourName` (e.g., `slash.help`, `slash.language`)
- Plurals: `key.zero`, `key.one`, `key.other` (triggered when `params.count` is present)
- Interpolation: `{token}` placeholders (e.g., `added "{cell}"`)
- Namespace: `'app'` for host, domain name for modules (e.g., `'revolucionstyle.com'`)

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

## OPFS: user data vs install cache (READ BEFORE TOUCHING)

The web shell's OPFS root holds two zones with different ownership:

**User data — NEVER wipe, NEVER `removeEntry` on these in scripts, console snippets, or "let me cold-boot test" experiments:**
- Sig-named files at the OPFS root — the user's content (layer bytes, resources, tile bodies)
- Lineage sigbags at the root (`<lineageSig>/` with `000x` markers) — every undo/redo entry the user has ever made
- Pools of meaning at the root (`sign('optimization')`, `sign('clipboard')`, `sign('threads')`, `sign('computation')`, `sign('manifests')`, …) — user records
- Legacy drain sources, while they still exist — read-fallback only, and STILL never wipe: `hypercomb.io/`, `__hive__/`, `__history__/`, `__resources__/`, `__layers__/`, `__optimized__/`, `__receipts__/`, `__structure__/`, `__threads__/`. Only the self-cleaning migration (per-record copy→verify→remove, gated final removeEntry when fully drained) may remove them — nothing else.

**Install/sync cache — owned by `ensureInstall` / `resyncFromSentinel`, safe to clear if you're inside that code path:**
- the `sign('bees')` pool — drone bundles by signature
- the `sign('dependencies')` pool — namespace deps by signature
- legacy `__bees__/`, `__dependencies__/`, `__layers__/sentinel/` — drain sources, opened without `create`, read-fallback until absorbed; never write new content here

**Verification rule:** to prove an essentials change reaches the web shell, do NOT clear OPFS. Use signature comparison instead — make a source change, rebuild, reload, and check that the new bee signatures appear in the manifest and the new bytes are in the `sign('bees')` pool (legacy `__bees__/` only while it drains). The user's data (root sig files, sigbags, pools) should be unchanged across the test. If you find yourself reaching for `localStorage.clear()` or `navigator.storage.getDirectory()` removal, stop — there is a non-destructive way to verify.

## Web/Dev shell parity — registry-fed surfaces

Shell-level UI is **registry-fed** (see `src/documentation/shell-surfaces.md`). Both `app.html` files mount a single `<hc-shell-surfaces>` host; every panel/strip/overlay/viewer self-registers via `registerShellSurface()` (module scope, after the `@Component` class) and is listed once in `hypercomb-shared/ui/shell-surfaces/shell-surfaces.barrel.ts`. Drones contribute surfaces as framework-free custom elements via IoC (`@hypercomb.social/ShellSurfaceRegistry`, `element:` shape) — never an Angular import.

**Never add an `<hc-*>` tag to either `app.html`** — a doctrine ratchet (`doctrine.spec.ts`) fails the suite if you do. Add a registration + barrel import instead. `order` on the registration is the only DOM/stacking-order lever. Only bound/structural chrome remains template-mounted (header bar, router-outlet, pixi-host, controls-bar, edit-actions, web's install prompt); THAT set must still be kept in sync manually across the two templates, and its ratchet allowlist may only shrink.

## Agent Coordination (Multi-Worktree)

When working in a worktree alongside other agents:

1. **Before starting work**, run `/claim` to register your files and check for conflicts
2. **When done** (or before `/cleanup`), run `/unclaim` to release your claim
3. The coordination registry lives at `src/.claude/coordination.json`
4. Claims older than 30 minutes without a heartbeat update are considered stale
5. If you detect a conflict, coordinate with the user before proceeding

## Tech Stack

Angular 21 · TypeScript 5.9 (ES2022, strict) · Pixi.js 8 · tsup · esbuild · nostr-tools · Node >=20.19.0

## License

Code: AGPL-3.0-only · Docs: CC BY-SA 4.0
