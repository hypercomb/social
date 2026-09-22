# Atomic modules — one behaviour, many dependencies

**Status:** steps 1–3 BUILT on games 2026-09-22; steps 4 and 4b BUILT and browser-verified. Step 3 output: 88 game atoms + 11 barrels, zero dangling imports, zero atom cycles, every game module links through the alias map in Node, every game class exists exactly once in the build (Solomon bee ~1.3 MB → 4 KB, game view bee 1–2 MB → 16 KB). Step 4c (position-aware preloader), 5 and 6 open. Decided by jwize: every game (and eventually
every feature) is ONE behaviour the hive registers, plus any number of
dependencies the hive never registers. Dependencies are atoms in their own
right — sig-addressed, shareable, deduplicated — but they never appear as
behaviours. This is the code-side twin of the website-artifact paradigm
(`website-artifact-paradigm.md`): members are atomic and standalone, ONE
artifact names the whole, and nothing shows up as more than it is.

## What is true today

| Fact | Where |
|---|---|
| A bee is any `*.drone.ts` / `*.worker.ts`; every other file is a "dependency". | `hypercomb-essentials/scripts/build-module.ts` `isBee` |
| Each game already has exactly one drone (solomon 39 files / 1 drone, arkanoid 15 / 1, bubble 15 / 1, roper 6 / 1). | `src/games/*` |
| BUT the bee **inlines its whole relative import graph** — the 38 other Solomon files are compiled INTO the bee. | `buildBee`, `external: allSpecifiers` |
| AND the same 38 files are bundled a second time as ONE namespace dependency (`@hypercomb/essentials/games/solomon`). | `buildNamespace` |
| So a game ships as two monoliths of the same code, and module-scope side effects run twice (the duplicate-registration audit). | `native-bee-pool-and-duplicate-registration-audit.md` |
| 179 non-drone files call `ioc.register` / `registerShellSurface` at module scope — every one of them behaves like a bee without being one. The five game queens are among them. | `grep` on essentials, 2026-09-22 |
| The import map already resolves any specifier from a dependency's first-line `// @scope/name` comment, so a dependency can be ONE FILE with its own specifier. Nothing in the runtime requires namespace-sized bundles. | `hypercomb-runtime/src/bags.ts` `aliasOf`, `acquire.ts` |
| Hive-side drafting (`module draft`) edits one `// src/…` SECTION of a bee — it works only because the bee is a monolith. | `hypercomb-runtime/src/module-drafts.ts` |

The "doom" jwize names is real and has two faces: (1) a dependency that
registers at module scope IS a behaviour in everything but name, so the
behaviour count is a lie; (2) a bee that inlines its dependencies is not
atomic — it is the parent-container the website paradigm forbids, and every
edit to a shared file (`juice.ts`, `audio.ts`) re-mints every game bee.

## The rule

1. **One behaviour per feature.** A feature directory has exactly one
   `*.drone.ts`. The bee is the artifact that names the whole: it registers
   in IoC, registers its words, its views, its surfaces. Registration is the
   bee's act and nobody else's.
2. **Every other file is a dependency atom.** Compiled alone, sig-named,
   first line `// @hypercomb/essentials/games/solomon/labyrinth`, listed in
   the layer's `dependencies[]`. A dependency **never** calls
   `ioc.register`, `registerShellSurface`, `registerVisualBee`, or any
   registry at module scope. It exports; the bee wires. Atoms NEST: a
   dependency may depend on dependencies, and once the production line is
   steady, layout elements nest the same way (jwize, 2026-09-22).
3. **Nothing is inlined.** A bee imports its siblings by specifier through
   the import map, the same way it imports `@hypercomb/core`. Same for a
   dependency importing a dependency. One copy of every file, by
   construction.
4. **Shared is shared.** `juice.ts` used by four games is one atom with one
   signature named in four layers. Change it once, one new sig, four layers
   advance. This is `share-resources-never-copy` applied to code.
5. **A new file is a dependency until someone says otherwise.** In the hive,
   `module draft` on a non-bee mints a dependency atom; minting a new
   BEHAVIOUR is a separate, deliberate word (vocabulary is jwize's call —
   candidate: `module draft bee`).

## Steps, in order

### 1. Ratchet first (cheap, no behaviour change)
Add to `src/doctrine.spec.ts`:
- **one-drone-per-feature**: no directory under `src/games/*` (then every
  feature dir) holds more than one `*.drone.ts`.
- **dependencies-do-not-register**: non-bee files calling a registry at
  module scope, frozen allowlist of the current 179. Never grows; the plan
  drains it.

### 2. Move registration into the bee (games first)
Each game queen (`solomon.queen.ts`, …) stops self-registering. It exports
its words/behaviours; `solomon.drone.ts` registers them in its constructor
or `activate`. Same for `game.queen.ts`. Five files, then remove their five
allowlist entries. Verify: the words still answer in the dev shell; the
duplicate-registration warnings for the games vanish.

### 3. Atomize the build
In `build-module.ts`:
- `buildBee` and a new `buildDependencyAtom` compile every file with an
  esbuild resolve plugin that turns a **relative** import into that file's
  **specifier** (`./labyrinth.js` → `@hypercomb/essentials/games/solomon/labyrinth`)
  and marks it external. This is the `classToDepSig` plugin the earlier
  audit already recommended.
- One output file per source file, header `// <specifier>`, sig-named.
- The namespace bundle becomes a **barrel atom**: `@hypercomb/essentials/games/solomon`
  is a tiny file of `export * from` its members, so cross-namespace
  consumers keep working unchanged.
- Layer `dependencies[]` lists every atom the bee reaches (transitively).
- Build cache: key each atom on its own source content only (the v5/v8
  metafile keying collapses to one input per unit).
- Detect import cycles among atoms and fail the build with the cycle named.
  Inlining hid cycles; live ESM bindings tolerate most, but a
  temporal-dead-zone read at module scope will throw at load.

Do games only in this step (`src/games/**`), behind a per-directory flag,
so the rest of essentials keeps the old shape until proven.

**Built with step 3:** a bee never contains another bee — an import that lands on a game bee compiles to an empty module (a named value import fails the build), and the game view waits for its game through `ioc.onRegister` instead of importing it. The Arkanoid theme registry, its built-in themes, the tutor game registry and its five study games now register from their bees too.

### 4. Load atoms lazily, once, and prove it at runtime
- **Atoms and barrels are never imported eagerly.** The DependencyLoader
  imports every dependency at boot through a blob URL, because a namespace
  bundle carries self-registering code. An atom registers nothing, so it has
  no reason to load until something imports it. Atoms and atomized barrels
  carry a `lazy` marker on their second line; the loader skips them, and they
  load only through the import map when a bee reaches them. That is lazy
  loading and the end of the double instantiation in one move.
- Import map gains a few hundred entries. Confirm `resolveImportMap` handles
  it (specifier → `/opfs/<pool>/<sig>`; nothing is namespace-shaped).
- Cold load of a game: count module fetches, compare first-frame time to
  today's monolith. If per-module cost hurts, the answer is a pack (below),
  not re-inlining.
- Signature comparison, never an OPFS wipe (`feedback_never_wipe_opfs`).

**Built 2026-09-22.** Atoms and barrels carry the marker (build cache v10);
`isLazyDependency` in `hypercomb-runtime/src/dependency-loader.ts` skips
them. Over the build output: 147 dependencies, 47 eager at boot, 100 lazy,
zero game dependencies eager. Opening Solomon pulls 39 atoms, Arkanoid 13,
Bubble 15, Roper 5, the tutor 19. All 107 game modules link through the
alias map in Node.

**Browser-verified 2026-09-22** on the web shell at 4260 (its own origin and
storage), after `npm run build:runtime` + `npm run build:essentials` and
`await hypercomb.acquire('<package sig>', ['localhost:4260'])` from the
console (the dev feed's working head). Package `e89e5a96` installed with no
holes; 147 aliases in the import map, 99 of them game atoms and barrels. The
loader imported 36 dependencies eagerly, none of them game code, with zero
failures. All game bees, queens, the three Arkanoid themes and the five tutor
games registered; Solomon, Arkanoid, Bubble and Roper each opened and closed.
87 game atoms arrived through the import map when the game bees loaded after
first paint — that is step 4b's target. Not exercised: a cold arrival on a
tile whose face is a game (the game view's wait for its bee).

**4b. Open loads the game — BUILT and browser-verified 2026-09-22.** One
shared atom, `games/lazy-overlay.ts`, holds the lifecycle all four game bees
share. `open()` starts the load and mounts when it lands; while it loads the
game already counts as active, so `toggle()`, the queens and the game view
read `isActive()` exactly as before. A close during the load cancels it.
Designer requests queue behind the load. A failed load is forgotten so the
next open retries. Arkanoid's built-in themes now arrive with the game. No
idle warm-up: warming every game after first paint would undo the point.

Measured on the web shell at 4260 (package `d7eb146f`):

| | Before 4b | After 4b |
|---|---|---|
| Game atoms fetched at boot | 87 | 28 (19 are the tutor) |
| Atoms a game bee pulls when it loads | Solomon 39 (1.4 MB) | 3 to 4 (about 7 KB) |
| Atoms fetched on first open | 0 | Solomon 36, Bubble 12, Arkanoid 9, Roper 3 |
| Cold first open | — | Solomon about 300 ms, Arkanoid about 25 ms |

Every overlay mounted and left nothing in the page after closing.

**4c. A preloader that knows where you are (long horizon).** Each game bee
exposes `prefetch()`: load the code, open nothing. Nothing calls it yet. The
direction (jwize, 2026-09-22): a preloader that is context- and
position-aware, loading the dependencies a certain DEPTH away from where the
participant stands, so the first open is already warm. Depth is the number of
dynamic-import boundaries: a static import pulls its whole closure at once,
so a preloader can only stage loading where the code has a lazy seam, as
4b's `open()` does. The goal is ADAPTIVE RENDERING: what renders can diverge
or change in real time, per participant and per place, and still preload on
demand. Signatures make that safe — a variant that changes is a new
signature, so the preloader's target moves with it and never warms a stale
copy.

The same lazy seam belongs on the tutor next: its bee still pulls 19 atoms at
load.

### 5. Hive-side drafting follows the atoms
`module read <sig>` on a dependency atom shows one file (the section IS the
file now). `module draft` on it mints a new atom sig, the draft layer swaps
that sig in `dependencies[]`, the pick's import map re-resolves. The bee is
untouched unless the bee file itself is drafted. `module-drafts.ts` needs:
target may be a dependency sig; `renameBee` gains a `renameDependency`
twin; the section slicer becomes trivial for atoms.

### 6. Extend to every feature
Flip the per-directory flag on for the rest of essentials one domain at a
time, draining the 179-entry allowlist as each domain's registrations move
into its bee. `presentation` (36 drones) is a genuine many-behaviour domain
and stays that way — the rule is one behaviour per FEATURE, not per
directory tree; what changes there is only that its services stop
registering themselves.

## Atomize for the editor, optimize for the reader

Decided by jwize, 2026-09-22: single responsibility everywhere lets the graph
be atomized AND optimized — the best of both worlds. The person in the
details changes one atom; the participant keeps their own revision until an
optimization can replace their previous revision and experience.

**Identity is atomic; delivery can be chunked.** An atom keeps its own
signature and registration stays the bee's act. A chunk is only a way to
move and load many atoms at once. It is a DERIVED record (the optimize-phase
contract, `optimize-phase.md`): keyed by the signature of its member set,
complete or absent, never load-bearing. A cold client runs the same from
loose atoms alone.

**Find the overlap before creating redundancy.** Three kinds, three checks:
- *Identical code* — free: same bytes, same signature, stored once.
- *Shared dependencies* — computed: intersect the atom sets of the closures
  before minting a chunk. Every atom lives in exactly ONE chunk; atoms reached
  by several closures go into a shared chunk keyed by that shared set.
  Measured 2026-09-22 across the games: only `game-enablement` (5 closures),
  `juice` (3) and `audio` (2) are shared.
- *The same job done twice in different code* — signatures cannot see it, so
  it is checked BEFORE the atom exists: `module draft` asks which existing
  atoms export the same names or carry the same documented purpose.

**Two ways to chunk, in this order:**
1. *Pack the transfer, keep modules separate.* One pack carries many atoms'
   bytes and unpacks into the store; the browser still sees one module per
   atom, so identity and state cannot change. Removes the round trips.
2. *Merge modules only for hot, stable closures.* Saves parse/link work, but
   the import map gives one module per URL, so members must export no
   clashing names and nothing may also load them loose — the double-state
   risk lives here, so it is the exception.

**Unbounded optimizations, exact slices.** A slice is a set of atom
signatures; a pack for it is keyed by the set's signature and every member
re-hashes against its own signature on arrival, so a reader never has to
trust the optimizer. Anyone — participant, agent, host — may mint a pack for
any slice; a wrong one fails verification and the reader falls back to loose
atoms. Optimizations compete by measurement, not by who made them. The limit
is sharing, not safety: slices too specific are never reused across the
network. So: a few common slices cut from what participants actually
activate, loose atoms for the long tail, personal slices only where they pay
back.

**Speed flows, behaviour is chosen.** A better pack for your slice replaces
the older one silently — same code, repackaged. A newer REVISION changes
behaviour and still goes through the participant's choice to follow it
(`packages-are-followed-pointers`). The fastest path is always available and
never risky: the worst a bad optimization can do is one fallback to loose
atoms.

Order of work: lazy loading first (step 4 — the bigger saving, and it
defines the closures packs are cut from), then packs, then merged modules.

## Non-goals
- No new pool, no new `__x__` folder. Atoms live in `sign('dependencies')`
  as today.
- No change to what a behaviour IS at runtime (Drone lifecycle, IoC key).
- No hive-side vocabulary decided here.

## Risks
- **Every dependency loads twice today.** The DependencyLoader imports each dependency through a blob URL while other modules reach it through the import map's `/opfs/…` URL, so each module is instantiated twice. Atoms keep that count (it was two before: namespace bundle + the copy inlined in the bee) but make it visible per file. Fix in step 4: let atoms load only through the import map.
- **Boot fetches ~100 game modules eagerly** because the loader imports every dependency at boot. Measure in step 4.
- **Cycles** (step 3) — the one place inlining did real work for us.
- **Module-scope side effects in dependencies that are NOT registration**
  (a `const x = ioc.get(...)` at top level) now run once and at import
  order the import map decides. The audit's "split brain" is fixed by the
  same move, but each such file needs a look during step 2/6.
- **Build time**: hundreds of esbuild invocations instead of dozens.
  Mitigate with content-keyed cache (already the design).
