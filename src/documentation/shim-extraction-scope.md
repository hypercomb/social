# Extracting the shim — scope

**Question:** what would it take to ship `hypercomb-shim` + `host/` as a
standalone package, so a host can be deployed without cloning the monorepo?

**Answer, measured (2026-08-31):** smaller than it looks. The shim's dependency
closure outside `@hypercomb/core` is **17 modules, 6,390 LOC**, of which one
file is a third of the total. There are **zero npm runtime dependencies**. And
88% of the current bundle is not code at all.

Every number below comes from esbuild's own metafile for
`hypercomb-shim/src/main.ts` and `src/bootstrap/index.ts` — the real graph, not
an import grep.

---

## What the shim actually pulls in

| bucket | modules | bytes in bundle |
|---|---:|---:|
| `hypercomb-shared` **i18n catalogs** | 14 | **2,874 kB** |
| `hypercomb-shared/core` code | 13 | 144 kB |
| `hypercomb-core` | 16 | 20 kB |
| `hypercomb-shim` itself | 4 | 14 kB |
| `hypercomb-shared/ui` | 2 | 0.9 kB |
| **npm packages** | **0** | **0** |

The bootstrap bundle is its own graph: **6 modules, 22 kB**, reaching only two
shared modules — `replication-walker` (136 LOC) and `sealed-package` (66 LOC),
both pure functions over bytes. That bundle is already effectively free of the
monorepo.

### The 2.9 MB that is not code — **DONE 2026-08-31**

`runtime-initializer.ts` dynamic-imports 14 locale catalogs. Angular splits
those into lazy chunks; esbuild without splitting **inlines all of them**, so
the shim shipped every language in its entry bundle. Worse, the shim never
imported `i18n.service`, so `@hypercomb.social/I18n` was never registered and
the whole i18n block was skipped — 2.9 MB of catalogs riding along for a
service that never ran.

Resolved by making a locale what it is: **content**.

- Each catalog is written to the origin as `dist/<sig>`; `dist/locales.json`
  maps locale to signature — a pointer of the same class as `/pin`.
- `hypercomb-shim/src/locales.ts` resolves one on demand:
  `sign('translations')` pool → flat OPFS root → `<origin>/<sig>`, verifying at
  every step and writing a network hit back into the pool.
- `initializeRuntime` gained an optional `catalogs` resolver. **Web and dev pass
  nothing and are byte-for-byte unchanged**; only the shim supplies one.
- A build ratchet fails if any `i18n/*.json` reaches the bundle again.

| | entry `main.js` |
|---|---:|
| before | 3,253 kB |
| after | **192 kB** |

Verified live: `save` → `保存` → `حفظ`, with the `sign('translations')` pool
growing exactly one member per locale actually used — never all fourteen.

Code splitting was the wrong fix and was **not** taken: it would still bake 14
chunks into every host's `dist`. A language is bytes a host holds, fetched when
needed and verified against its own name — not a build artifact, and not an
installer resource. Putting locales in the install manifest would make adding a
language a package rebuild and a merkle cascade.

---

## The 17 modules that must move

| module | LOC | what it is | verdict |
|---|---:|---|---|
| `core/store.ts` | 2,249 | OPFS reads/writes, pools, sigbags | **the blocker** — see below |
| `core/native-filesystem.ts` | 836 | Tauri/WebView2 storage override | droppable from a web-only build |
| `core/script-preloader.ts` | 705 | imports bees, `BeeResolver` | moves as-is |
| `core/packed-store-engine.ts` | 632 | packed-store format | moves as-is |
| `core/runtime-initializer.ts` | 489 | i18n, layers, host resolution | moves; sheds the catalogs |
| `core/packed-bridge.ts` | 265 | native packed bridge | with native-filesystem |
| `ui/window-session.ts` | 189 | panel session state | 189 LOC, misfiled under `ui/` |
| `core/dependency-loader.ts` | 170 | namespace bundles | **retires** at Phase 4 |
| `core/replication-walker.ts` | 136 | the replication protocol | moves — pure |
| `core/ioc.web.ts` | 119 | installs `window.ioc` | moves as-is |
| `core/packed-store-gate.ts` | 117 | one-way-door gate | moves as-is |
| `ui/tool-windows.ts` | 102 | popover dismissers | 102 LOC, misfiled under `ui/` |
| `core/install-monitor.ts` | 97 | install progress | moves as-is |
| `core/shell-surface-registry.ts` | 97 | the surface registry | moves as-is |
| `core/sealed-package.ts` | 66 | package validator | moves — pure |
| `core/proximity-registry.ts` | 63 | warm handlers | moves as-is |
| `core/sw-domains.ts` | 58 | page → SW domain hand-off | moves as-is |
| **total** | **6,390** | | |

The two `ui/` entries are 291 LOC between them and have no Angular in them —
they are core-shaped code that happens to live under `ui/`. Moving them costs
nothing and removes the shim's last nominal tie to `shared/ui`.

## Re-pointing cost: near zero

Importers **outside** the modules themselves:

```
shell-surface-registry  47   ← all 47 are inside hypercomb-shared/ui
native-filesystem        3       (the 48 Angular panels registering themselves)
sw-domains               3
store / script-preloader / ioc.web / packed-store-gate / packed-store-engine   2 each
install-monitor / proximity-registry / replication-walker   1 each
runtime-initializer / dependency-loader / packed-bridge / sealed-package   0
```

Only 15 files in `web` + `dev` + `essentials` import `@hypercomb/shared` at all,
and **essentials imports it zero times** — the two apparent hits are comments
saying not to. `shell-surface-registry`'s 47 importers are the Angular panels,
which are being retired anyway; nothing in web, dev, or essentials touches it.

This is a mechanical re-point, not an untangling.

---

## The one real blocker: `store.ts`

2,249 LOC, a third of everything that moves, and it carries **both** halves:
read-by-sig, pool addressing and sigbag resolution — which the shim genuinely
cannot pulse without — *and* the write path, `commitLayer`, history.

This is [hard knot 3](everything-is-a-beehavior.md) verbatim: *"Store in the
shim … the Phase 5 split is the only way to shrink it — and write-path
behaviours must never sneak back into the shim."*

Two ways to sequence it:

- **Move it whole.** Fast, unblocks everything else, and leaves a package that
  carries a write path no host needs. Honest and reversible.
- **Split first** into a kernel read side and a behaviour-side write half. The
  right end state, roughly halves the package — but it is its own campaign and
  it gates nothing else in this list.

**Recommendation: move it whole, split later.** The split is a good change that
should not be a prerequisite for a package boundary.

## Shape — **STOOD UP 2026-08-31**

```
@hypercomb/core       unchanged
@hypercomb/runtime    NEW · 19 modules, 0 npm deps, tsup → ESM + CJS + .d.ts
@hypercomb/host       NEW · shim + host kit, `bin: hypercomb-host`,
                      4.8 MB packed / 451 files, zero shared ties
```

`hypercomb-runtime/` holds the 15 planned modules plus four the measurement
missed — `packed-store.worker`, `packed-collect`, `i18n.service`, and
`shell-contracts` (new). Every module is its own entry, so
`@hypercomb/runtime/store` is as first-class as the barrel.

**Nothing in it imports `hypercomb-shared`.** The one tie was a single
side-effect line, `runtime-initializer` importing `../ui/tool-windows` to
register the escape cascade; each shell imports it directly now. Four other
apparent ties were `import type` — erased at build, invisible in the bundle
graph, and still real once the package ships — so they became structural
contracts in `shell-contracts.ts`, narrow on purpose.

**Web and dev did not move.** `hypercomb-shared/core/*` keeps 17 one-line
re-export stubs at the old paths, so every existing import resolves unchanged.
They are marked temporary and delete as importers migrate.

Two behaviour-preserving lines were added to each shell: the `tool-windows`
side-effect import, and `catalogs: bundledCatalogs` (the 14-locale loader map
moved to `hypercomb-shared/core/bundled-catalogs.ts`, where the JSON lives —
the runtime ships no catalogs of its own, because a locale is content).

**Verified:** `hypercomb-web` builds green; `hypercomb-dev` compiles with zero
errors and its pre-existing budget failure **1.26 kB smaller** than at HEAD; the
shim runs on the package with 341 IoC keys, renderer up, locales switching,
`ToolWindows` still registered; host check 13/13.

Remaining ties from the shim, reported every build so they can only shrink:

```
[shim] ✓ no hypercomb-shared in the bundle — the host is monorepo-free
```

**Resolved without touching the other branch.** All five came in behind ONE
side-effect import of `ui/tool-windows`, which registers the docked-panel
escape rung — and a host has no docked panels: every panel is still Angular in
`shared/ui`, unreachable from here. Its only consumer resolves it optionally
and documents the absent case ("with no panel showing, this rung answers false
and the press falls straight through"), so dropping it is a no-op today. It
arrives when panels do, as drones.

Lifting the five from `worktree-everything-is-a-beehavior` was rejected on
inspection: those versions have diverged (the `setPopoverDismisser` inversion,
plus matching Angular-side changes), so taking them would import an unmerged
campaign piecemeal. Web and dev keep their own `tool-windows` import and are
unaffected.

Then the client story is:

```bash
npx @hypercomb/host deploy --project my-hive --domain hive.example.com
```

No monorepo, no Claude required. The `/host-deploy` skill stays the helper layer
for diagnosis and architecture calls, never the mechanism.

## Phasing

| step | what | effort | gates |
|---|---|---|---|
| 1 | ~~Locales as content~~ — entry 3,253 → 192 kB | **DONE** | — |
| 2 | ~~Move `ui/tool-windows` + `ui/window-session`~~ | **already done elsewhere** | — |
| 3 | ~~Stand up `@hypercomb/runtime`~~ — 19 modules, stubs keep web/dev unchanged | **DONE** | — |
| 4 | ~~Stand up `@hypercomb/host`~~ — CLI, publishable, 0 shared ties | **DONE** | — |
| 5 | *(later)* Split `store.ts`; drop `native-filesystem` from web builds | campaign | not a blocker |

**Step 2 is already done on `worktree-everything-is-a-beehavior`**, and to a
better destination than this document proposed: `hypercomb-core/src/core/panels/`
rather than `hypercomb-shared/core/`. Repeating the move on `development` would
duplicate it into the wrong package and collide with that branch on merge. Take
it from there instead — the shim's tie to `shared/ui` is 0.9 kB and gates
nothing.

## What not to do

- **Do not gate this on the panel conversion.** The 48 Angular panels live in
  `shared/ui`, which the shim never imports. They are unrelated to this
  boundary and shrinking them takes far longer.
- **Do not gate this on sig-stamped imports.** `dependency-loader` retires with
  the import map at Phase 4, but it is 170 LOC and moves fine in the meantime.
- **Do not vendor `@hypercomb/core` into the host package.** One runtime, one
  IoC, one Store — the bootstrap bundle already proves the external-core pattern
  works, and the build ratchets it.
