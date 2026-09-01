# @hypercomb/host

**A Hypercomb node.** Core, the signature fetcher, and the runner — nothing
else. `dist/` **is** the host: serve that directory and it is one.

```bash
npx @hypercomb/host serve                        # run it
npx @hypercomb/host deploy --project my-hive     # put it on Cloudflare Pages
npx @hypercomb/host check https://my-hive.pages.dev
```

In the monorepo the same commands are `npm run build:shim`, `npm run start:shim`
and `npm run host:check -- <url>`. The folder is still called `hypercomb-shim`,
because that is what it is: Phase 5 of
[everything-is-a-beehavior](../documentation/everything-is-a-beehavior.md),
stood up first so the lean shell could be grown into rather than arrived at.

There is no `build` command in the published package. Building needs the
monorepo — essentials' module output, the shared locale catalogs — and a host is
not supposed to compile anything. It serves bytes that were signed elsewhere.

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

Current: **35 modules, 186 kB entry, boots in ~40 ms, 18 MiB origin — and no
`hypercomb-shared` in the bundle at all.** The runtime it needs is
`@hypercomb/runtime`; the locales and the content are on the host.

## The three pieces

| | where | what |
|---|---|---|
| **core** | `public/core/dist/` + `public/hypercomb-core.runtime.js` | the runtime ABI. `@hypercomb/core` resolves here. |
| **fetcher** | `src/replicate.ts` + `public/hypercomb.worker.js` | acquisition by signature, and the service worker that resolves `/@resource/<sig>` and `/opfs/<pool>/<sig>` out of the flat root. |
| **runner** | `src/main.ts` + `src/surfaces.ts` | boots, pulses the processor, mounts whatever registered. |

Everything else in `dist/` is content: `content/<sig>`, flat and sig-named,
copied from `hypercomb-essentials/dist` — the module build that mints it.

## The shim knows exactly one signature

Acquisition is not part of the shell. It is built separately, hashed, written
to the origin under its own signature, and named by `/pin` — and the shim
fetches it the same way it fetches everything else: by signature, verified
before it runs.

```
/pin  →  OPFS <sig>  (or <origin>/<sig>, written back)
      →  VERIFY the bytes hash to the pin
      →  import  →  boot()
```

That resolves the chicken-and-egg (acquisition cannot come from OPFS when OPFS
is empty) with one address rather than a privileged code path, and it makes the
installer forkable: **updating the bootstrap is repinning one signature.**

The verify runs on the OPFS path too, not only the network one. OPFS is
origin-private so local tampering is out of the threat model — but "the file
named `<sig>` does not hash to `<sig>`" is also what a truncated write or an
interrupted eviction looks like, and running those is worse than refetching.

The shim keeps exactly three things: **service-worker control**, the
**packed-store one-way-door gate**, and the **pinned-sig fetch path**.
Everything else it does is runtime — ioc, the store, the module graph, the
processor pulse — which cannot be content, because it is what content runs on.

`src/bootstrap/` is compiled into that bundle and is NOT part of `main.js`.
It may import only `window.ioc` and `@hypercomb/core` (external, resolved
through the import map). Nothing stateful from shared may be bundled in: a
second `Store` module would run a second
`register('@hypercomb.social/Store', new Store())` over the same OPFS. **The
build fails if `shared/core/store.ts` reaches the bundle.** The two pure
modules it does carry — the replication walker and the sealed-package
validator — are stateless functions over bytes, which is why duplicating them
is safe.

## Install is cache-warming, not a precondition

The service worker's module route gains a network fallback: OPFS miss →
`<origin>/<sig>` (then known hosts) → **sha256-verify against the requested
signature** → write into the pool → serve. A heap with a hole in it repairs
that hole when something asks for it, instead of failing the import.

The verification is what makes the fallback admissible: it is the same
admission boundary replication uses, so a forged host, a poisoned CDN, or an
SPA-fallback page can only ever cost a 404.

> This copy of `hypercomb.worker.js` is deliberately **diverged** from
> `hypercomb-web/public/hypercomb.worker.js`, which stays frozen for the live
> deploy. Do not resync them — the shim is the survivor.

## Add a domain. That is the whole interaction.

A cold node shows one card: a field, and the domains you carry. Add one, and
its packages appear; click one, and it is yours.

```
add a domain  →  <domain>/manifest.json  →  seal the record
              →  resolve the inventory (sha256 every atom before write)
              →  complete-or-absent gate  →  activate  →  boot
```

`src/hosts.ts` is the domains — the same `community:hosts` pool essentials
writes, shared by ADDRESS (`sign('community:hosts')`) and never by import,
because essentials is the thing being acquired. A host added in the full app is
already there when the shim boots cold.

`src/replicate.ts` is the acquisition, and it is deliberately thin: the walk
itself is `resolveInventory` from shared, which is kind-blind by design. Only
the io wiring — which pool, which suffix, which URL — lives here.

Install is the same call as update and as repair. Present atoms are reused, so
a second run of a complete install fetches nothing (`Held 226 atoms
(0 fetched)`), and a partial one repairs its delta rather than starting over.

**A host must serve its content cross-origin.** `Access-Control-Allow-Origin: *`
is in `public/_headers` and `--cors` is on the local server, because a host
exists to be pulled FROM. Without it every cross-origin replication dies as an
opaque `Failed to fetch` and the host looks exactly like one that publishes
nothing. `*` is correct rather than lax: every byte is public, immutable,
content-addressed and verified by the reader, so there is no request whose
origin changes the answer.

**Not yet signed.** The manifest a domain serves carries no publisher
signature. Every atom is verified, so a hostile host cannot serve wrong bytes —
but it can offer a different tree and call it current. Binding "current" to a
publisher identity is the signed sentinel, and it is the next chip. Until then,
adding a domain is exactly as much trust as visiting one.

## Standalone

The shim reads **nothing** from `hypercomb-web`. Its static root is its own
`public/`; its content comes from the essentials build directly; it carries its
own copy of the import-map resolver (`src/import-map.ts`, short-lived — Phase 4
deletes it). `build.mjs` prints `✓ standalone` when no `hypercomb-web` module
reaches the bundle, next to the `✓ framework-free` check.

Two pieces of `public/` are generated and gitignored — `core/dist` and
`vendor/pixi.runtime.js`, both from `scripts/build-vendor.mjs` (`npm run
build:vendor`). Run it after a `build:core` or a pixi bump.

```bash
node build.mjs                 # minimal — core + fetcher + runner + content
node build.mjs --no-content    # cold host; boots to 0 surfaces, correct
node build.mjs --assets        # + shared-public substrate art (~47 MB)
node build.mjs --minify        # production bytes
```

## What it deliberately does not carry

- **The install MACHINE.** No sentinel resync, no drift enforcement, no
  bundled-package upgrade path, no cold-install welcome flow. The bootstrap
  bundle carries the replication PROTOCOL, not a second copy of
  `ensure-install`. See
  [install-by-replication.md](../documentation/install-by-replication.md).
- **Sig-stamped module imports.** Bee bundles still import their dependencies
  by ALIAS, which is the only reason the import map still exists — so
  `src/import-map.ts` and `dependency-loader` cannot retire yet. Stamping dep
  signatures into the specifiers at build time is a change to
  `hypercomb-essentials/scripts/build-module.ts` that recomputes every bee
  signature (a merkle cascade — plan doc, hard knot 7) and therefore
  invalidates deployed content. It is a deploy decision, not a code one.
- **The visitor path**, upgrade orchestration, drift enforcement.
- **The reload-once import-map dance.** A shim that reloads itself is much
  harder to reason about while it is being built. `index.html`'s synchronous
  replay covers the second boot onward; Phase 4 retires the map entirely.

## The scoreboard

Every boot prints:

```
[shim] surfaces — 1 element-shaped mounted · 47 barrel entries still Angular-shaped, unreachable from the shim
```

The second number is the one that measures Phase 2/3, and it **cannot be
observed at runtime**. Shared's Angular panels register themselves by being
imported from `shell-surfaces.barrel.ts`, and the shim never imports that
barrel — so the count of Angular-shaped registrations that actually reach the
registry is always 0 here. Reporting *that* read as "migration complete" when
it meant "none reached me".

So `build.mjs` counts the barrel's entries at build time and injects the
number. It tracks the barrel as it shrinks and can never quietly disagree with
it; when the barrel is empty the line says so instead of printing a zero that
means nothing. `window.__hcSurfaces()` returns the same live.

Nothing loads Angular here — not statically, not dynamically, and it could not:
the directives use standard field decorators, so without the AOT compiler they
throw `"not supported in JIT mode"` at module evaluation. The behaviours do not
need it either — `@angular` appears in **0 files** across `hypercomb-essentials`.
The 47 are components in `hypercomb-shared/ui` that have not become drones yet.

## Deploy safety

`build.mjs` writes only into `hypercomb-shim/dist`. The shim is not under
`hypercomb-web/src` (so `ng build` cannot type-check it), not under
`hypercomb-web/public` (so it cannot enter the deploy artifact), and named by
no `angular.json` configuration or GitHub workflow.

The live artifact is still `hypercomb-web/dist/hypercomb-web/browser`, built by
a push to `main`. Nothing here can reach it.

Phase 5 of [everything-is-a-beehavior](../documentation/everything-is-a-beehavior.md),
stood up **first** so the lean shell can be grown into rather than arrived at.
