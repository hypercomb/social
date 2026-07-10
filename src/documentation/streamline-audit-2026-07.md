# Streamline Audit — 2026-07-09

Boot + steady-state performance audit of the web shell. Snapshot of what
remains after the push-only install and optimize-phase work landed; consult
git history for whether a finding is since fixed.

## Ranked findings

| # | Impact | Finding | Where |
|---|---|---|---|
| 1 | HIGH | Boot is a fully-serial await chain; the SW-readiness block (up to **1500ms** first-visit wait for `controllerchange`) gates `ensureInstall`/OPFS work it doesn't depend on. SW branch and install branch should overlap (`Promise.all`); real dependencies are only install → import map → loader. | `hypercomb-web/src/main.ts:94-142` (SW wait `:57-81`) |
| 2 | HIGH | `resyncPass` applies streamed files **serially** (await write + await cache-seed per file) and runs `collectPresentSigs` — a full walk of 8 dirs including the entire OPFS root — **twice** per resync (delta `have` + post-apply receipt). | `ensure-install.ts:647-666,868-895,583,676` |
| 3 | HIGH | All **14 locale catalogs** are imported + registered before first paint; only the active locale is needed there. Lazy-load the rest post-paint / on switch. | `runtime-initializer.ts:142-172` |
| 4 | MED-HIGH | Every cold/partial `resolveChildNames` pass runs `freshenBranches` — 3 awaited hops **per child** — even on manifest hits; and `[diag:childres]` console diagnostics fire on every non-memo pass. Gate the diagnostics; skip freshen on manifest-complete passes. | `show-cell.drone.ts:237-412,274-313,333-385` |
| 5 | MED | Post-drain, `#doInit` still opens **15 legacy dirs** `create:false` every boot — all throw. Per-read fallbacks are clean (skip `undefined`); the waste is these 15 opens. Skip via a drained sentinel flag. | `store.ts:363-378` |
| 6 | MED | Two sanctioned idle writers of `sign('manifests')` overlap: render backfill + optimize-phase drone both derive the same parent in one session (duplicate OPFS write + stringify). Backfill's remaining role is pre-optimizer layers only. | `show-cell.drone.ts:399-407`, `manifest-optimizer.drone.ts:56-76`, ratchet `doctrine.spec.ts:133-143` |
| 7 | MED | Commit cascade signs every ancestor layer serially on the main thread (canonicalize → stringify → subtle.digest per level). Confined to commits — steady-state reads are cache-hits. Worker offload only if deep-tree commits measurably jank. | `history.service.ts:917-1007`, `signature.service.ts:9-15` |
| 8 | MED | Bundled install path fetches **immutable sig-addressed bytes** with `cache:'no-store'` (defeats HTTP cache; `LayerInstaller.#fetchBytes` already trusts immutable headers correctly) and `writeAll` re-fetches all sigs with no presence probe. | `ensure-install.ts:307,357,388-398` vs `layer-installer.ts:286-289` |
| 9 | LOW | `resolveImportMap` / `DependencyLoader` bag-less fallbacks read dep files serially — only bites pre-bag installs mid-drain. | `resolve-import-map.ts:139-166`, `dependency-loader.ts:119-145` |
| 10 | LOW | Optimize phase enumerates **every** IoC key per coalesced pass to find `optimize` implementors; a registered-optimizers subset avoids the scan. | `hypercomb.ts:40-44` |

## Verified non-problems (don't re-investigate)

- No boot `manifest.json` fetch on the cached path — push-only.
- Boot spot-check is one enumeration per pool, not per-sig probes.
- `store.initialize()` triple-call is memoized (`#initPromise`).
- `getLayerBySig` cold-miss no longer triggers `preloadAllBags`.
- Legacy read-path unions cost nothing post-drain (skip `undefined`).
- Sentinel sync already deltas via `have[]` — no re-fetch of present sigs.

## Action order

1 → 2 → 3 → 4 (each independent; #2 folds naturally into
`applyVerifiedFiles` from `dcp-single-door.md`; #8 rides the same edit).
Verify per `feedback_verify_perf_changes_on_real_data`: real hive, dev
shell first, signature comparison — never OPFS wipes.
