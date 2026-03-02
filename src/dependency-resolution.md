# Dependency Resolution — Dual Angular Runtime Issue

## Problem

The `SearchBarComponent` (defined in `hypercomb-shared/ui/`) crashes at runtime when
built from the main `hypercomb-web` project with either:

- **NG0203** — `inject() must be called from an injection context` (original code)
- **firstCreatePass null** — `Cannot read properties of null (reading 'firstCreatePass')` at `viewQuery` (IoC-refactored code)

The same code works perfectly when built from a git worktree.

## Root Cause

**Two separate `@angular/core` installations resolve to different file paths, causing
esbuild to bundle two independent Angular runtimes.**

| Location | Version | Resolved by |
|---|---|---|
| `src/node_modules/@angular/core` | 20.1.7 | Files in `hypercomb-shared/` |
| `src/hypercomb-web/node_modules/@angular/core` | 20.3.17 | Files in `hypercomb-web/src/` |

### How it happens

1. `tsconfig.app.json` includes `../hypercomb-shared/**/*.ts` so shared files are
   compiled as part of the web app.
2. When esbuild resolves `import { signal } from '@angular/core'` inside a shared
   file (e.g. `hypercomb-shared/core/script-preloader.ts`), it walks up from the
   file's directory: `hypercomb-shared/ → src/node_modules/@angular/core` (v20.1.7).
3. When esbuild resolves the same import inside an app file (e.g.
   `hypercomb-web/src/app/app.ts`), it walks up from the file's directory:
   `hypercomb-web/src/ → hypercomb-web/node_modules/@angular/core` (v20.3.17).
4. Since these are **different file paths**, esbuild includes **both copies** — adding
   ~68 kB to the bundle.
5. Each Angular runtime has its own `instructionState` (internal view tracking). When
   the app's runtime (A) creates a view for `SearchBarComponent` (compiled against
   runtime B), the component's template calls B's `getLView()` which returns `null`
   because B's state was never initialized.

### Evidence

| Metric | Broken build | Fixed build |
|---|---|---|
| Bundle size | 322 kB | 254 kB |
| `defineComponent` functions | 2 (`Jp`, `Tt`) | 1 (`He`) |
| Console errors | `firstCreatePass` null | None |

The 68 kB difference is exactly one duplicate Angular runtime.

### Why the worktree worked

The git worktree's build produced a 253 kB bundle. The worktree directory structure
placed shared files in a path where both app and shared files resolved to the **same**
`@angular/core` installation, so esbuild deduped naturally.

## Immediate Fix (Applied)

Created Windows directory junctions so both resolution paths lead to the same physical
files:

```
src/node_modules/@angular/core        → junction → src/hypercomb-web/node_modules/@angular/core
src/node_modules/@angular/common      → junction → src/hypercomb-web/node_modules/@angular/common
src/node_modules/@angular/compiler    → junction → src/hypercomb-web/node_modules/@angular/compiler
src/node_modules/@angular/compiler-cli→ junction → src/hypercomb-web/node_modules/@angular/compiler-cli
src/node_modules/@angular/platform-browser → junction → ...
src/node_modules/@angular/platform-browser-dynamic → junction → ...
src/node_modules/@angular/router      → junction → src/hypercomb-web/node_modules/@angular/router
src/node_modules/@angular/forms       → junction → src/hypercomb-web/node_modules/@angular/forms
src/node_modules/@angular/animations  → junction → src/hypercomb-web/node_modules/@angular/animations
```

## Permanent Fix Options

### Option A: Update workspace root `package.json` (recommended)

Update `src/package.json` to match `hypercomb-web`'s Angular version, then
`npm install` from `src/`:

```json
{
  "dependencies": {
    "@angular/animations": "20.3.17",
    "@angular/cdk": "20.2.14",
    "@angular/common": "20.3.17",
    "@angular/compiler": "20.3.17",
    "@angular/core": "20.3.17",
    "@angular/forms": "20.3.17",
    "@angular/material": "20.2.14",
    "@angular/platform-browser": "20.3.17",
    "@angular/platform-browser-dynamic": "20.3.17",
    "@angular/router": "20.3.17"
  },
  "devDependencies": {
    "@angular/build": "20.3.18",
    "@angular/cli": "20.3.18",
    "@angular/compiler-cli": "20.3.17"
  }
}
```

### Option B: Single `node_modules` with npm workspaces

Restructure so that `src/package.json` uses npm workspaces, hoisting all Angular
packages to a single `node_modules`:

```json
{
  "workspaces": [
    "hypercomb-web",
    "hypercomb-dev",
    "hypercomb-shared"
  ]
}
```

### Option C: tsconfig path override

Force Angular resolution via tsconfig paths in `tsconfig.base.json`:

```json
"paths": {
  "@angular/core": ["src/hypercomb-web/node_modules/@angular/core"],
  "@angular/common": ["src/hypercomb-web/node_modules/@angular/common"]
}
```

**Caveat**: This hardcodes the path to one project's `node_modules`, breaking other
projects that share `tsconfig.base.json`.

## Also Fixed

- Removed phantom `hypercomb-shared` library project from `angular.json` (pointed to
  non-existent `projects/hypercomb-shared/` directory with ng-packagr config).

## Diagnostic Commands

```bash
# Check for duplicate @angular/core installations
find src -path "*/node_modules/@angular/core/package.json" -maxdepth 5

# Verify versions match
node -e "console.log(require('src/node_modules/@angular/core/package.json').version)"
node -e "console.log(require('src/hypercomb-web/node_modules/@angular/core/package.json').version)"

# Count defineComponent functions in bundle (should be 1)
node -e "
  const code = require('fs').readFileSync('dist/hypercomb-web/browser/main-*.js','utf8');
  const re = /cmp=([A-Za-z_$][\w$]*)\(/g;
  const fns = {};
  let m;
  while ((m = re.exec(code)) !== null) fns[m[1]] = (fns[m[1]]||0)+1;
  console.log(fns);
"
```
