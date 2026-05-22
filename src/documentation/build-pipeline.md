# Build Pipeline

How essentials become signature-addressed modules and reach the running app.

## Build order

```
hypercomb-core → hypercomb-essentials → hypercomb-web / hypercomb-dev
```

## What to rebuild

| Changed | Rebuild |
|---------|---------|
| **hypercomb-core** | `npm run build:core` then `npm run build:essentials` then (if web) `npm run runtime:core` in hypercomb-web |
| **hypercomb-essentials** | `npm run build:essentials` (builds + copies modules to web `public/content/` for local dev) |
| **hypercomb-shared** | Nothing — raw source, Angular dev server hot-reloads |
| **hypercomb-web** | Nothing extra — `ng serve` or `ng build` |
| **hypercomb-dev** | Nothing extra — `ng serve` or `ng build` |

## Key commands (run from monorepo root `src/`)

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

## Module delivery pipeline

Essentials are built as **signature-addressed modules** and auto-installed into OPFS at runtime:

1. **Build** (`npm run build:essentials`): esbuild bundles drones into flat `dist/` with `__layers__/`, `__bees__/`, `__dependencies__/`, and `manifest.json`. Then `copy-to-web.ts` copies output to `hypercomb-web/public/content/`.
2. **Deploy** (`npm run deploy:essentials`): Same build, but uploads flat content to Azure blob storage (`storagehypercomb`) instead of copying locally. Uploads `manifest.json` for discovery.
3. **Runtime auto-install**: On app load, `ensureInstall()` uses sentinel sync or `LayerInstaller` fetches `manifest.json` → looks up package by signature → downloads all listed layers/bees/deps → writes to OPFS. Skips if already installed (checked via `localStorage` + OPFS directory presence).
4. **Import map**: `resolveImportMap()` reads `__dependencies__/` from OPFS, extracts aliases from first-line comments (`// @scope/name`), and injects a dynamic `<script type="importmap">`.
5. **Module loading**: `DependencyLoader` imports dependencies via the import map. `ScriptPreloader` loads bees from OPFS, instantiates them, and registers in IoC.
