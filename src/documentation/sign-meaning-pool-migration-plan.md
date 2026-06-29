# sign(meaning) Pool Migration — Exact Plan

> **status: plan (2026-06-27).** Captures the agreed approach for removing the
> twelve underscore folders in favour of `sign(meaning)` pools. **Not started.**
> Run as its own dedicated, incremental effort — never bolted onto other work.
> Supersedes the index/sigbag section of `visuals-pool-of-meaning-plan.md`
> (visuals is parked behind this).

## The directive (Jaime)

Remove **all** underscore folders, replace with **pools of meaning** —
**but do NOT change the layer structure or the meta structure.** This is a
**storage refactor, not a content change**: the layer shape, the meta shape, and
all the commit/render/meta logic that operates on them stay identical. Only
*where the bytes live and how they're typed* moves. Because the shapes are
untouched, everything above the storage layer keeps working — that is exactly
why it doesn't break.

## The model (from the design sessions)

- **One catch-all of sig-named files.** Meaning is never a folder name; the
  signature *is* the address.
- **Pools of meaning are addressed by `sign(meaning)`** — `sign('manifest')`,
  `sign('jpg')`, `sign(<scope>)` — with membership a marker that points at a
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

## The one open mechanism to settle first

"One flat catch-all" must reconcile with OPFS performance (millions of files in
one directory is pathological). **Recommendation: shard the catch-all by
sig-prefix, git-object-store style** — `<ab>/<cdef…>` where the prefix is
*derived from the hash*, carrying **no meaning**. That is logically one flat sig
pool, physically sharded, with zero human-named folders. Pools of meaning
(`sign(meaning)`) are marker sets layered on top, addressed by signature.
**Settle this shape before the pilot.**

## Approach — safe by construction

- **Entirely inside the Store, behind its existing public API.**
  `putResource` / `getResource` / `commitLayer` / `readChildrenManifest` / …
  keep their exact signatures. Callers (the layer/meta logic) **never change**.
- **Back-compat reads:** read the legacy folder *and* the new location, so old
  data resolves while the new path drains it over time.
- **One pool at a time, verified before and after.** Never big-bang. At no point
  is the system half-migrated-and-broken.
- **Precedent:** the `claude/funny-gauss-e6b38b` branch already did exactly this
  shape for `__optimization__` — per-scope `<scopeSig>/<memberSig>`,
  `scopeSig = sign(appliesTo.join('/'))`, 4 method names + 9 consumers untouched,
  legacy-flat back-compat, sig→scope cache. Study it as the template (note: it
  kept the `__optimization__` parent; the full migration removes the human
  parent and relies on sig-named sharding).

## Pool inventory (the twelve) + order

| Folder | Nature | Migrate? / risk |
|---|---|---|
| `__manifests__` | pure derived cache (self-healing) | **PILOT** — lowest risk |
| `__optimization__` | per-scope set (feedback/qa) | already shaped on funny-gauss branch |
| `__clipboard__` | participant-local, isolated | low risk, early |
| `__threads__` | thread state | low-mid |
| `__computation__` | compute receipts | low-mid |
| `__optimized__` | optimization variant | low-mid |
| `__resources__` | content pool (everything) | **late** — core, highest churn |
| `__layers__` | layer bytes | **late** — core |
| `__history__` | per-lineage sigbags (`000x`) | **last** — the lineage primitive; the no-`__history__`/sigbag-at-root collapse is its own design (`history-sigbag-as-root.md`) |
| `__bees__` / `__dependencies__` | install artifacts | install-path owned; coordinate |
| `__hive__` | user content root | not a meaning-pool; identity root |

## Pilot — `__manifests__`

Best first because it's a **pure derived cache**: a miss just re-resolves and
re-writes, so a mistake self-heals and can't corrupt authored state.

1. Settle the catch-all sharding shape (above).
2. Keep `readChildrenManifest` / `writeChildrenManifest` signatures exactly.
3. Internally: manifest blob → sig-named file in the sharded catch-all; "this is
   a manifest for parent P" expressed as a `sign('manifest')` membership keyed to
   P (resolve the per-parent pointer the way the funny-gauss per-scope read does).
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
- Additive + reversible; one pool at a time; verified each; never big-bang.
- No human-named folders introduced; sig-prefix sharding only.
