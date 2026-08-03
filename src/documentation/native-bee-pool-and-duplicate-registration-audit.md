# Native bee pool + duplicate IoC registration — audit (2026-08-03)

Diagnosed live against the release exe (`hypercomb-client/target/release/hypercomb-client.exe`)
driven over CDP (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'`,
`/json/list` → websocket → `Runtime.evaluate`), plus a static scan of the shipped
`hypercomb-client/app/frontend/content` against its `manifest.json`.

Installed package = `ae4818c1…` = exactly the package the shell ships. So static bytes
and live store bytes are the same thing.

---

## 1. Pool GC — nothing is leaking. The 218 was a miscount.

Live `raw_dir_entries` on `sign('bees')` returns **220 names**, but they are two
different kinds of name:

| shape | count | what it is |
|---|---|---|
| `<sig>.js` | **110** | the pool's flat bee members — exactly the manifest's 110 |
| `<beesBag>/000000NN` | **110** | markers of the bees **sigbag**, a sub-bucket inside the pool |

`<beesBag>` = `5621835689a2…` = `manifest.beesBag`, exactly. Same story for
dependencies: 41 flat + 41 bag markers = 82.

- bees in the pool but not in the manifest: **0**
- bees in the manifest but not in the pool: **0**

`raw_dir_entries` (host `lib.rs:281`) deliberately returns the union of markers and
pool members with sub-bucket keys flattened, so counting its rows over-reports a pool
by the size of any bag living inside it. The shim's `#entries()`
(`native-filesystem.ts:440`) is what collapses `a/b` into a directory row — count
through the shim, or filter to `/^[0-9a-f]{64}\.js$/`, not through the raw command.

`purgeStaleOpfsArtifacts` → `NativeSigDirectory.removeEntry` → `raw_dir_remove` →
`pool_remove` works: verified live by writing a probe member into the bees pool
through `store.bees`, confirming it in `raw_dir_entries`, removing it through the same
handle, and confirming it gone. No code change needed here.

One latent hazard worth noting, though it is not causing the reported symptom:
`purgeDir` calls `removeEntry(name, { recursive: true })`, and the recursive branch
re-runs `#rawEntries()` **per entry** — 110 extra full listings on a purge. That is
precisely the IPC burst shape the transport discipline exists to avoid, and each
failure is swallowed by `purgeDir`'s `catch {}`, so a collapse would look like a
silent partial purge. Passing no options (pool members have no sub-buckets) removes
the risk.

---

## 2. Duplicate registration — real, and the second copy is a *dependency*, not a bee

The premise was bee↔bee inlining. The live warnings come from **bee↔dependency**
inlining, which is a different (and more consequential) thing.

`build-module.ts` classifies a source file as a **bee** only if it is `*.drone.ts` /
`*.worker.ts` (`isBee`, line 276). Everything else — `*.queen.ts`, `*.service.ts`,
registries, shared singletons — is a **dependency**, and every dependency file in a
namespace folder is pulled into that namespace's bundle by `export * from`
(`buildNamespace`, line 624). Those files self-register at module scope, so the
namespace bundle *executes registrations* when the import map loads it.

A bee is compiled with `external = [platform, …namespace specifiers]` only. A bee that
imports a sibling by **relative path** therefore inlines a second copy of a module the
namespace bundle already owns.

Cross-scanning module-scope `ioc.register("…")` across all 110 bees and 41 deps:

| key | copies | where |
|---|---|---|
| `OverlapMetrics` | 18 | 15 bees + 3 deps |
| `HistoryService` | 9 | 5 bees + 4 deps |
| `TileActionsDrone` | 5 | 4 bees + 1 dep |
| `OrganizeDrone` | 4 | bees only |
| `TutorialLessonRegistry`, `AgentAvatarRegistry` | 3 each | 1 bee + 2 deps |
| 14 more keys | 2 each | mostly bee + `dep:84501548` |

The 5 duplicate-view warnings map **exactly**: `living-brief` (bee `18c9e4ad`),
`slides` + `lightbox` (bee `2ee14bf0`), `evidence-atlas` + `knowledge-studio`
(bee `74b2d187`) — every one of them also registered by dep `84501548` (the
`commands` namespace bundle, which carries `lightbox.queen.ts`, `brief` queen,
`atlas`/`studio` queens, `tree`/`website` views). Views `tutor`, `workflow`, `tree`,
`website` are registered by dependency bundles **only** — the dep chunks are already
load-bearing for behaviour, not just for shared code.

### The runtime consequences (and the premise correction)

`window.ioc.register` is **first-wins, not last-wins** (`ioc.web.ts:15`, and the same
code is in the shipped shell bundle `main-XEL6LBVL.js`). The loser is not left running:
if it has `markDisposed` (every `Bee`/`Drone`/`QueenBee` does) it is disposed on the
spot and its EffectBus subscriptions unhook. So the "loser instances stay alive with
their listeners" part does not hold for drones. What is real:

1. **Plain objects have no `markDisposed`.** `OverlapMetrics` resolves live as a plain
   `Object`; `HistoryService` as `_HistoryService` with no `markDisposed`. Their 17 /
   8 losing copies are simply orphaned — and, worse, the code **inside** each
   duplicating bundle that holds the module-local reference talks to its *own* copy
   while everything resolving through IoC talks to the canonical one. For registries
   (`TutorialLessonRegistry`, `AgentAvatarRegistry`, `TutorGameRegistry`) that is a
   split-brain: anything registered into the losing copy is invisible.

2. **Two bee sigs are now entirely dead weight.** The log's
   `bee 2752f972… returned null from getBee()` and `bee 55b2ed4f… returned null`
   are `store.ts` case 3: every registration in those bundles was rejected by
   first-wins because the dep copy got there first. They download, evaluate, register
   nothing, and are skipped. `2752f972` owns `OverlapMetrics` + `TileActionsDrone`;
   `55b2ed4f` owns `TreeViewDrone` — all three are served by dep `84501548` instead.

3. **`PresenceBadgeDrone` twice / "saw 106 bees, 105 distinct instances"** is not two
   PresenceBadge instances. Only bee `b73cb4a1` contains that class. It is
   mis-attribution in `Store.getBee`: bee loads run concurrently under
   `Promise.allSettled`, `onRegister` capture is global, and a module with **no class
   exports** falls back to "latest captured instance" (`store.ts:645`). A class-export-
   less bee loading alongside PresenceBadge captures PresenceBadge's registration and
   reports its `iocKey`. Two sigs → one instance object → 106 vs 105.

4. Byte cost: 4.56 MB of bee bundles against 3.57 MB of dependency bundles, with 15
   bees each carrying their own inlined `OverlapMetrics`.

Same-build clones are byte-identical, so today's behaviour is stable. What is *not*
stable is which physical copy owns each key, and that is decided by load order between
the import-map dependency graph and the preloader's concurrent bee loads.

### Where a fix belongs

At the build, not at the registry. `buildBee` needs to treat any source file that the
namespace bundles already own as **external**, rewritten to its namespace specifier —
so a bee references the one dep copy through the import map instead of inlining a
second one. The machinery is already half-present: `classToDepSig`
(`build-module.ts:856`) is exactly the class → owning-dep-sig index, and `beeDeps`
already ships per-bee dep declarations that the preloader honours. An esbuild resolve
plugin over `buildBee` that maps a resolved sibling path to its namespace specifier
would collapse all 20 duplicated keys, delete the two dead bee sigs, and shrink the
bee payload.

Nothing here is native-specific: the duplication lives in the shipped content, so the
web shell installs the same duplicates. The native client only makes it visible
because it has no DCP pusher and adopts its own bundle wholesale.
