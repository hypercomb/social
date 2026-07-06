# sign(meaning) Pool Migration — Exact Plan

> **status: EXECUTED — full sweep landed 2026-07-04.** This document is kept as
> the historical plan; the sections below record the approach as agreed, with
> dated notes where the executed sweep settled or superseded them. What
> shipped:
>
> - **Flat-root shape SETTLED — no sig-prefix sharding.** Jaime directed all
>   resources at the root: content bytes are sig-named files directly at the
>   OPFS root. The only folders are signature-named — lineage sigbags
>   (`<lineageSig>/` with `000x` markers, max = current) and pools of meaning
>   (`sign(meaning)`).
> - **All record pools live at `sign(meaning)`** (bees, dependencies,
>   manifests, optimization, clipboard, threads, computation) with
>   **self-cleaning boot absorbs**: detached after init, per-record
>   copy→remove, non-recursive final `removeEntry` once the legacy dir is
>   empty.
> - **Content sources drain via the delayed self-clean relocation.**
>   `Store.migrateContentPoolToRoot` covers `__resources__/`, `__layers__/`,
>   `__optimized__/`, `__hive__/`, and `hypercomb.io/`, self-scheduled ~20s
>   after init whenever a legacy source exists; the manual
>   `/consolidate-content` queen is the force-run. Never a blocking scan on
>   the boot/render path.
> - **`__history__` drains via `gcLegacyHistory`** — lineage sigbags live at
>   the OPFS root; while a lineage appears in several sources, resolution
>   unions them and the HIGHEST marker wins.
> - **`__hive__` maps to the OPFS root itself** (`hypercombRoot === opfsRoot`)
>   — it was never a meaning-pool; the folder is a read-fallback drain.
> - **The "one pool at a time" pilot plan is superseded by the executed
>   sweep.** All pools landed in one dedicated effort, still entirely behind
>   the Store's stable API.
> - Legacy `__x__` dirs everywhere are **read-fallback drain sources only**:
>   opened without `create` (try/catch → `undefined`), never write targets,
>   removed once fully drained.
>
> First pool migrated (the template, 2026-07-04, ahead of the manifests
> pilot): `__optimization__` → `sign('optimization')` =
> `be92e94aba0be148ec1f142becadb01480a3c633ed6e675d98945416a5a3d24d` at the
> OPFS root, flat sig-named members, behind the same four Store methods;
> legacy folder absorbed + deleted on boot with dual-reads until gone; the
> swarm derives the same address for its publish-exclusion firewall.

## The directive (Jaime)

Remove **all** underscore folders, replace with **pools of meaning** —
**but do NOT change the layer structure or the meta structure.** This is a
**storage refactor, not a content change**: the layer shape, the meta shape, and
all the commit/render/meta logic that operates on them stay identical. Only
*where the bytes live and how they're typed* moves. Because the shapes are
untouched, everything above the storage layer keeps working — that is exactly
why it doesn't break.

Follow-up directive (addendum): the system is **self-cleaning** — when it
finds a legacy underscore folder it migrates everything into the signed
locations and removes the orphaned folder automatically; no manual step
required (`/consolidate-content` remains as a force-run).

## The model (from the design sessions)

- **One catch-all of sig-named files.** Meaning is never a folder name; the
  signature *is* the address.
- **Pools of meaning are addressed by `sign(meaning)`** — `sign('manifests')`,
  `sign('bees')`, `sign(<scope>)` — with membership a marker that points at a
  sig. An underscore folder (`__manifests__`) hides the meaning behind a human
  label; that is the violation.
- **One marker-bag primitive, two modes:**
  - **Lineage** = ordered `000x` sequence, append-only, **max = head = current**
    (history; `0000` seeds the position's name). Keep it **pure `000x`** —
    never interleave signature-markers, or find-latest scales with the junk.
  - **Pool of meaning** = unordered **set** (membership: "is this sig an X?"),
    no head/current, removal = local tombstone. Identity *is* its address.
- **Everything resolves like a cache, and content-addressed caches never need
  invalidation:** a sig's bytes can't change, so a stashed sig is correct
  forever. Only the **pointer** (lineage head) moves. Local-first → on miss pull
  from a holder → stash → next time local. Footprint = only what you've pulled
  (interest-bounded).
- **Federation / decoupled hosts:** the broad "who has X" is a query, not a
  local global pool — hosts (decoupled content caches) and peers advertise what
  they hold and are prioritised by it. **Render never awaits the network** —
  scoped current-state resolves from the **local** lineage; federation heals
  lazily *off* the render path.

## The catch-all shape — DECIDED 2026-07-04: flat root, no sharding

The earlier draft of this section recommended sharding the catch-all by
sig-prefix (`<ab>/<cdef…>`, git-object-store style) and said to settle the
shape before the pilot. **The sweep settled it the other way: no sharding.**
Jaime directed all resources at the root — the catch-all is literally the
OPFS root, sig-named files with no prefix directories and zero human-named
folders. Pools of meaning (`sign(meaning)`) and lineage sigbags are the only
directories layered alongside. (If flat-root directory scale ever becomes a
measured problem, sharding could be revisited as a pure storage-layer change
behind the same Store API — it is not part of the executed model.)

## Approach — safe by construction

- **Entirely inside the Store, behind its existing public API.**
  `putResource` / `getResource` / `commitLayer` / `readChildrenManifest` / …
  keep their exact signatures. Callers (the layer/meta logic) **never change**.
- **Back-compat reads:** read the legacy folder *and* the new location, so old
  data resolves while the new path drains it over time. Legacy handles are
  opened WITHOUT `create` (try/catch → `undefined`); writes never target a
  legacy dir.
- **One pool at a time, verified before and after.** *(Historical sequencing —
  the executed sweep landed all pools in one dedicated effort, each with the
  same absorb template and verification.)* At no point is the system
  half-migrated-and-broken.
- **Precedent:** the `claude/funny-gauss-e6b38b` branch already did exactly this
  shape for `__optimization__` — per-scope `<scopeSig>/<memberSig>`,
  `scopeSig = sign(appliesTo.join('/'))`, 4 method names + 9 consumers untouched,
  legacy-flat back-compat, sig→scope cache. (The shipped pool is flat-membered;
  the per-scope layout can layer on later.)

## Shipped implementation (the template — `hypercomb-shared/core/store.ts`)

- Pool addresses are **derived at runtime** via
  `SignatureService.sign(new TextEncoder().encode(MEANING).buffer)` — never
  hardcode hex in code (the hex in the table below is for humans/docs).
- `hypercombRoot === opfsRoot` — the flat content root IS the OPFS root.
- Pools created at init (dir name = `sign(meaning)`): `bees`, `dependencies`,
  `clipboard`, `threads`, `computation`, `manifests`, `optimization`.
- `Store.poolSignature(meaning)` (static, memoized) and `store.getPool(meaning)`
  for pools Store doesn't pre-open (e.g. `receipts`, `structure`, `roots` if a
  subsystem needs them).
- Constants renamed `X_DIRECTORY` → `LEGACY_X_DIRECTORY` for all `__x__` names;
  new `X_MEANING` constants hold the pool meanings.
- Legacy handles, all optional, opened `create: false`: `legacyHive`
  (`__hive__`), `legacyHypercombIo` (`hypercomb.io/`), `layers`, `resources`,
  `history`, `legacyBees`, `legacyDependencies`, `legacyClipboard`,
  `legacyThreads`, `legacyComputation`, `optimized`, `legacyManifests`.
- `#readContentFile` fallback chain: root → `__hive__` → `hypercomb.io/` →
  the caller's typed legacy dir. `writeOptimizedBytes` = `writeLayerBytes`
  (root). `readChildrenManifest` dual-reads the pool then `__manifests__`.
- Absorb shape (see `#absorbLegacyOptimizationPool`): detached after init,
  bounded, copy→remove per record, gated non-recursive final `removeEntry`
  only when fully drained — NEVER a blocking scan on the boot/render path,
  NEVER deleting anything not confirmed copied.

## Pool inventory — canonical mapping (as executed)

| Legacy dir | Outcome | `sign(meaning)` |
|---|---|---|
| `__optimization__` | pool `sign('optimization')` — **first migrated (template)** | `be92e94aba0be148ec1f142becadb01480a3c633ed6e675d98945416a5a3d24d` |
| `__bees__` | pool `sign('bees')` — boot absorb | `23da0d3b0b5aa5ee43ba33f15f971ee4cf32afd1b27ad901863346ba9dd06966` |
| `__dependencies__` | pool `sign('dependencies')` — boot absorb | `2188dfc2d889b53230f6891977d505642d718b940aa3eec23985afb379141dcd` |
| `__clipboard__` | pool `sign('clipboard')` — boot absorb | `a78c94675455b6203686c7f220c225c90d386a52a623c547bfce8bbbac94c31c` |
| `__threads__` | pool `sign('threads')` — boot absorb | `4cc500db62ede737f8f7a8c83c02b5fc5cbcebf26bffc48fb49b4540ffc67306` |
| `__computation__` | pool `sign('computation')` — boot absorb | `fb209e75cfb94344539afe813559f0950250a5ab843fcb30d1231021428d11ac` |
| `__manifests__` | pool `sign('manifests')` (files keyed by PARENT layer sig — derived cache) — boot absorb | `c7af7c7a948db8800f71f26f3c90280cf09dfc3141b72318c5ff31ffc9470a59` |
| `__resources__` | no pool — content = root sig files; drains via the self-clean relocation | — |
| `__layers__` | no pool — layer bytes are content = root sig files; drains via the self-clean relocation | — |
| `__optimized__` | no pool — read-fallback only; drains via the self-clean relocation | — |
| `__hive__` | **the OPFS root itself** (`hypercombRoot === opfsRoot`); the folder is a read-fallback drain | — |
| `hypercomb.io/` | pre-`__hive__` orphan scope — read-fallback drain, relocated to the root | — |
| `__history__` | no pool — lineage sigbags at the OPFS root; drains via `gcLegacyHistory`; union across sources, highest marker wins | — |

## Pilot — `__manifests__` *(superseded — the sweep landed all pools at once)*

The manifests pool was going to be first because it's a **pure derived cache**:
a miss just re-resolves and re-writes, so a mistake self-heals and can't
corrupt authored state. The executed sweep landed it alongside the other
record pools with the same absorb template; the steps are kept as the record
of the reasoning:

1. ~~Settle the catch-all sharding shape~~ *(settled: flat root, no sharding).*
2. Keep `readChildrenManifest` / `writeChildrenManifest` signatures exactly.
3. Internally: manifest blob → sig-named file keyed by parent layer sig in the
   `sign('manifests')` pool.
4. Back-compat: read legacy `__manifests__/<parentLayerSig>` too; drain over use.
5. Verify: render a populated location cold, confirm identical cells before/after
   (the manifest is invisible to the user — only speed changes). No OPFS wipes;
   compare signatures, not by clearing data.

## Verification protocol (every pool)

- **Two-scopes-one-count test** where a pool is scoped: write two members under
  different scopes, ask for one scope's set — only that scope's members return,
  the other's bytes are never read.
- **Before/after render parity** on the dev shell (port 4250/4251): same cells,
  same images, same nav — only cold-load speed changes.
- **Back-compat read** proven: pre-existing legacy data still resolves.
- **Never wipe user OPFS** to "test cold boot" — compare signatures.

## Guardrails

- Layer shape + meta shape + their logic: **unchanged.**
- Behind the Store's stable API; callers never touch the folder model.
- Legacy `__x__` dirs: opened `create: false`, read-fallback only; writes NEVER
  target a legacy dir; removal only when fully drained (copy→verify→remove,
  per record). NEVER delete user data outside that gate.
- No human-named folders introduced — sig files at the root, lineage sigbags,
  and `sign(meaning)` pools are the entire vocabulary. No new `__x__` dirs,
  ever — a new need is a new pool of meaning.
