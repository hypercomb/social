# hypercomb-shim

The framework-free boot. Phase 5 of [everything-is-a-beehavior](../documentation/everything-is-a-beehavior.md),
stood up **first** so the lean shell can be grown into rather than arrived at.

```bash
node hypercomb-shim/build.mjs      # or: npm run build:shim
```

Serve `dist/` and open it — `shim-4270` in `.claude/launch.json` does both.

## What it is

`hypercomb-web/src/main.ts` already *is* this boot. Every step here is the same
call in the same order; the difference is the last line — that one ends in
`bootstrapApplication()`, this one ends in `mountSurfaces()`. The boot sequence
did not have to be invented, only unfused from Angular.

```
ioc.web  →  packed-store gate  →  SW control  →  import map
         →  DependencyLoader   →  initializeRuntime  →  mountSurfaces
```

No Angular, no Vite, no `ng` builder — one `esbuild` call. If the boot needs a
framework to build, it is not a shim. The build **fails loudly** if
`@angular/*` ever reaches the bundle, because that is not a size problem: the
directives use standard field decorators, and without the Angular AOT compiler
they throw `"not supported in JIT mode"` at module evaluation. A framework
import here does not bloat the shim, it stops it booting.

Current: **44 modules, 3.1 MB unminified, boots in ~22 ms.**

## What it deliberately does not carry

- **Acquisition.** No `ensure-install`, no sentinel, no install prompt. Phase 4
  carves those into one sig-addressed bootstrap bundle the shim fetches by
  pinned signature. A cold OPFS boots to `0 surfaces` — correct, not broken.
- **The visitor path**, upgrade orchestration, drift enforcement.
- **The reload-once import-map dance.** A shim that reloads itself is much
  harder to reason about while it is being built. `index.html`'s synchronous
  replay covers the second boot onward; Phase 4 retires the map entirely.

## The scoreboard

Every boot prints:

```
[shim] surfaces — N element-shaped mounted, M still Angular-shaped [...]
```

`M` is the number of panels still owing a conversion to a custom element. It
may only go down. `window.__hcSurfaces()` returns the same live.

## Deploy safety

The shim lives outside `hypercomb-web` **on purpose**. It is not under
`hypercomb-web/src` (so `ng build` cannot type-check it), not under
`hypercomb-web/public` (so it cannot enter the deploy artifact), not a
workspace member (so it cannot change `npm install`), and named by no
`angular.json` configuration or GitHub workflow. `build.mjs` writes only into
`hypercomb-shim/dist`.

The live artifact is `hypercomb-web/dist/hypercomb-web/browser`, built by a
push to `main`. Nothing here can reach it.
