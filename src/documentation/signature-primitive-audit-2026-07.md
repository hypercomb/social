# Signature-Primitive Conformance Audit — July 2026

Full-platform audit of every behavior against the core primitive: signature references
(never inline data), derived pools of meaning (`sign(meaning)`, never hardcoded hex, never
typed folders), immutable content (new bytes = new sig), processor-only `synchronize`,
and the serialized FIFO commit chain.

Seven parallel audits covered: history/commit/lineage · clipboard/move/editor/selection ·
decorations/optimizations/tags/view-behaviours · sharing/swarm/install/DCP ·
preferences/commands/keyboard/assistant · a cross-cutting red-flag sweep ·
revolucionstyle.com (the community-module reference case).

## Verdict

**The primitive holds at the core.** The commit spine, pool derivation, content
addressing, install pipeline, decoration substrate, and thread/Q&A records all conform.
Violations cluster at three edges:

1. **Two live write-path violations** in move/paste (data-loss class).
2. **A localStorage shadow state** — shareable/versionable state parked device-side
   instead of in pools.
3. **An unfinished trust layer** — publisher identity and authored-sig gating are
   heuristic (path-keyed) or absent (no inbound Nostr verification).

Plus a cleanup tier: dead legacy code that contradicts the model and misleads readers.

## Scorecard

| Subsystem | Verdict | Key issues |
|---|---|---|
| History / commit / lineage | **CONFORMS** | dead `putLayer`/`updateLayer` (mutable `layer.json`), dormant `record()`/`HistoryOp` |
| Decorations / tags / view behaviours | **CONFORMS** | hidden pool interim-parked in `sign('optimization')`; reference privacy unenforced |
| Clipboard / move / editor / selection | **PARTIAL** | `__layout__` write bypassing committer; name-rebuild sig drops; `__meta__` file |
| Sharing / swarm / install / DCP | **CONFORMS** | no inbound Nostr verify; path-keyed trust; install roots cached in localStorage |
| Preferences / commands / assistant | **CONFORMS** | dashboard pin registry localStorage-only; dead `0000` writers in accent.queen |
| revolucionstyle.com (community template) | **PARTIAL** | collection indexes in localStorage; taxonomy compiled-in; no i18n |
| Cross-cutting sweeps | **CLEAN** | no hardcoded pool hex, no `__x__` writes, no inline-content records, no in-place mutation |

## A. Live violations (fix first — data-loss class)

### A1. Name-rebuild sig drops in paste/move (the husk class, still open)
- `clipboard/image-paste.worker.ts:88-161` — `#createImageCell` resolves each existing
  child sig → name, **drops any sibling whose sig fails to resolve** (cold pool), then
  commits `children:[...existingNames, finalName]` as a full SET. A cold sibling at paste
  time is silently wiped.
- `clipboard/clipboard.worker.ts:511,634` and `move/move.drone.ts:496,511,650,660` —
  membership SETs built from **non-strict `childNamesOf`**, which skips unresolvable sigs
  with no cold-miss signal. `childNamesOfStrict` (`history/layer-placement.ts:93-106`)
  exists with a `coldMiss` abort and is **unused** in every one of these paths.
- **Fix**: adopt `childNamesOfStrict` + abort-on-coldMiss across all membership
  recomputes; or append via a name-add delta instead of re-SETting the whole list.

### A2. `/layout apply` writes a legacy sidecar and bypasses the committer
- `move/layout.queen.ts:96-124` → `move/layout.service.ts:36-41` writes an inline
  ordered-name array into the legacy per-dir `__layout__` FILE via `createWritable` —
  the service's own header says "Nothing new should write it." Violates A (inline data),
  B-spirit (legacy write target), and F (skips CommitMachine FIFO).
- **Fix**: route ordering through per-tile `index` props (`writeTilePropertiesAt`, as
  MoveDrone does); delete `LayoutService.write`.

### A3. Clipboard record is a fixed-name inline file inside a conforming pool
- `clipboard/clipboard.worker.ts:12,905-937` — writes `{op, items:[{label,
  sourceSegments}]}` into `__meta__` inside `sign('clipboard')`. Pool address conforms;
  the member is name-addressed with inline pointer data instead of a content-addressed
  pool doc.
- **Fix**: store via `putPoolDoc` (content-addressed member), keep a `current` pointer if
  needed using the identity-keyed pointer pattern (like viewport).

## B. `synchronize` discipline (rubric E)

The processor (`hypercomb-core/src/core/hypercomb.ts:15`, `act()` finally) is the
sanctioned dispatcher. Three shells dispatch directly at boot:
- `hypercomb-web/src/app/app.ts:265`
- `hypercomb-dev/src/app/app.ts:188`
- `hypercomb-avatars/src/app/app.ts:86`

All are one-shot boot kicks after the bee-pulse loop. **Fix**: replace with
`new hypercomb().act()` (empty grammar) so the finally block remains the only emitter.
No other dispatch site exists anywhere in scope; `requestSynchronize` in
command-line correctly routes through `act()`.

## C. The localStorage shadow state

Everything below is *shareable or versionable* content living device-only while the
canonical machinery for it (pools of meaning, layer slots) already exists. The legit
ephemera (theme, locale, viewport prefs, MRU lists, secrets, opt-in flags, install
sentinels) were censused and are correct — the items here are the exceptions.

| Key / store | File | What it should be |
|---|---|---|
| `hc:tile-props-index` | `editor/tile-properties.ts:121`; render truth in show-cell/substrate; seeded by adopt (`swarm-adopt.drone.ts:903-946`) | Canonical `properties` slot is truth; index becomes a rebuildable cache. Fixes adopt blank-tile fragility. |
| Dashboard pin registry `hc:…DashboardBee:bags` | `dashboard/dashboard.bee.ts:50,302-364` (`#publishToSwarm` is a TODO) | Pool/mesh record so pins travel; localStorage as cache. |
| Icon overrides | `hypercomb-shared/core/icon-override.store.ts:69` | Pool doc (cf. `sign('overrides')` pattern). |
| `hc:tag-colors` | `tag-registry.ts:134` + 2 more writers | Pool doc alongside the `sign('registry')` tags-master. |
| Saved locations | `hypercomb-shared/core/saved-locations-store.ts:49` | Pool doc (borderline — decide shareability first). |
| Install layer-roots | `hypercomb-web/src/setup/ensure-install.ts:479-491` (`core-adapter.installed-manifest`) | Derive roots from lineage HEAD marker; keep only the enabled-set (bees/deps) as install config. |
| Journal index / cigar catalog index | `revolucionstyle.com/journal/journal.service.ts:114`, `cigar/cigar-catalog.service.ts:107` | Domain pools of meaning (see F). |
| `hc:website:last-root-sig` | `commands/website.queen.ts:571` | Minor: local build pointer; tolerate or fold into pool doc. |

Model implementations to copy when migrating: **`commands/i18n-override.queen.ts`**
(content-addressed doc in `sign('overrides')`, legacy read-fallback, boot-absorb race
closed) and **`commands/translation.service.ts`** (pool doc per locale, self-healing
localStorage migration).

## D. Trust layer & pheromones

Doctrine (stated 2026-07-09): safe files within layers do **not** need signature
verification to be *seen* — content addressing is self-verifying (you asked for sig X,
sha256 of the bytes must equal X; every fetch path already enforces this:
`content-broker.drone.ts:1283-1291`, `sentinel-handler.ts:561`, swarm resource ingest
`swarm.drone.ts:2684-2692`). Verification belongs at two boundaries only:
**attribution** (who published this) and **activation** (does this code run).
Guarding/discovery is by *identification* — pheromones, i.e. tag decorations — not by
gatekeeping reads.

Findings against that doctrine:

1. **No inbound Nostr signature verification** — `sharing/` signs outbound
   (`nostr-signer.ts:55-85`) but never calls `verifyEvent` on receipt; `event.pubkey` is
   trusted as-is for presence/attribution. A peer can spoof another's identity even
   though content bytes are sha256-gated. **Fix**: schnorr-verify inbound mesh events (or
   assert relay-side verification) before trusting `pubkey`. This is the "publisher sig
   authoritative" doctrine's missing half.
2. **Authored-sig gate is a stub** — `authored-sigs.ts` (`hc:authored-sigs`) is sig-keyed
   and correct, but `isLocallyAuthored` is not consulted by `featureNeedsReview`; the
   activation gate leans on path-prefix foreignness (`hc:adopted-roots`,
   `hc:allowed-roots`, `feature-availability.ts:103-145`). **Fix**: land the two
   `markAuthored` producers + one-time lineage bootstrap; retire path-keyed trust except
   as a viewport fit hint.
3. **Reference decorations are "always private" by intent only** — no sanitizer strips
   `kind:'reference'` at publish (`reference.queen.ts:89-136`; no match in
   visual-sanitizer). Payload carries no sigs so nothing leaks, but the pointer itself
   rides the shared decorations slot. **Fix**: exclude in the publish sanitizer or move
   to a participant-local pool.
4. **Pheromone discovery is already structurally supported** — tags are deduped
   content-addressed decorations (`appliesTo:[]`, one sig per name), the
   decoration-kind-index gives O(1) kind→cells lookup, and `pools-data.ts` keeps a
   discovered-pools cache. What's missing is only the doctrine formalized: a pheromone =
   a tag decoration whose *presence* advertises a capability/pool; readers resolve it
   without verification; guards (hidden pool, verification gate) act at activation, not
   at read. Worth a short spec in `src/documentation/` so community modules follow it.

## E. Dead code that contradicts the model (delete tier)

| What | Where | Why it must go |
|---|---|---|
| `putLayer`/`getLayer`/`updateLayer` + `#LAYER_FILE` | `history/history.service.ts:759-828` | Mutates fixed-name `layer.json` in place inside sigbags — anti-model; zero live callers. |
| `record()`/`HistoryOp` op-log | `history.service.ts:9-31,639-653`; `history-recorder.drone.ts` | Dormant second bag-writer that historically raced marker allocation. |
| `domain-installer.ts` | `hypercomb-shared/core/domain-installer.ts` | 100% commented-out typed-folder world; misleads. |
| `readProps`/`writeProps`/`PROPS_FILE` | `commands/accent.queen.ts:150-170` | Raw in-place `0000` write bypassing putResource/commit; unreferenced. |
| `writeCellProperties` legacy 0000 writer | `editor/tile-properties.ts:225-240` | Write-capable legacy API; only read-fallback used in scope. |
| `SignatureService` import + `JOURNAL_PROPERTIES_FILE` | `revolucionstyle.com/journal/*` | Vestiges of the unfinished sig/pool path. |
| Stray NUL byte | `history/layer-committer.drone.ts` (~offset 26634) | Breaks text tooling. |

## F. revolucionstyle.com — the community-module template

Matters disproportionately: it is what third-party authors copy. Leaf primitive is right
(entries + photos content-addressed & immutable, discovery computes over refs, imports
clean — core-only, no folder or synchronize violations). Systematic gap is the
**collection layer**: journal index and cigar catalog live in localStorage, so nothing
is shareable/syncable/adoptable; the flavor taxonomy is compiled-in code instead of a
versionable sig resource; cigar dedup identity is a hand-rolled composite string, not
`sign(meaning)`; no supersession tracking (edited entries append, stale sigs leak); zero
i18n registration. **Fix as the exemplar**: domain pool(s) of meaning for indexes with
supersession pool-docs, taxonomy seeded as a sig-named JSON resource, namespace i18n.

## G. Minor / consolidation

- **Hidden pool split** — feature-hidden records interim-park in `sign('optimization')`;
  the writer self-documents the future `sign('hidden')` pool (`feature-hidden.ts:22-28`).
  Complete the per-record copy split.
- **Website read paths** — `context` slot vs `website` slot vs `visual:website:page`
  decoration: three co-existing read paths (all sig-referenced, so no violation);
  consolidate to reduce ambiguity (`website.queen.ts`, `website-slot.ts`).
- **Reorder duality** — `SelectionInputDrone` persists order via `OrderProjection` only;
  `MoveDrone` writes per-tile `index` props. Confirm OrderProjection routes through the
  committer and align the two paths.
- **Swarm wire nuance** — layer events inline rendered 0000 props alongside `layerSig`
  for zero-round-trip preview ("SIG-ONLY ON THE WIRE" holds for images). Acceptable;
  if tightening, ship sig only and let receivers resolve.
- **fetchVisualsAt** — composedSig cache is not content-hash verified (by design,
  ephemeral preview); keep the sanitizer authoritative at injection and never persist.

## Pools of meaning — current inventory

Derived via `Store.poolSignature(meaning)` (`store.ts:181-198`); essentials workers
re-derive identically (may not import shared). No hardcoded pool hex exists anywhere;
the only 64-hex literals are documented empty-content sentinels
(`EMPTY_CONTENT_SIG`, `EMPTY_LAYER_STATE_SIG`, `EMPTY_LAYER_CONTENT_SIG`).

`bees` · `dependencies` · `clipboard` · `threads` · `computation` · `manifests` ·
`optimization` · `visual-optimization` · `overrides` · `translations` · `registry` ·
`substrate` · `temporary` · `viewport` · `push` / `receipts` · `host-push` /
`host-receipts` · `sweep-{ts}` (dynamic quarantine) — plus DCP-side pools
(`patches`, `from-hypercomb`, domain scopes).

Candidates this audit adds: `hidden` (split from optimization), `journal`-domain pools,
pin-registry, icon-overrides, tag-colors.

## Recommended sequence

1. **Now (data integrity)**: A1 strict-children fix across image-paste/clipboard/move;
   A2 layout-apply rewrite. Both are user-data-loss class.
2. **Next (model hygiene)**: delete tier E; A3 clipboard pool-doc; B boot-kick
   `act()` routing.
3. **Then (pool adoption — "up the quality")**: C migrations in this order:
   tile-props-index (fixes adopt fragility) → dashboard pins → icon overrides +
   tag colors → install roots from lineage HEAD. Copy the i18n-override pattern.
4. **Then (trust/pheromones)**: D1 inbound verify, D2 authored-sig gate, D3 reference
   sanitizer, D4 write the pheromone-discovery spec.
5. **When touching the domain module**: F — make revolucionstyle the clean exemplar
   before community authors copy it.
