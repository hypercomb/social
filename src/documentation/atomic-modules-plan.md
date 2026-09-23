# Atomic modules — one behaviour, many dependencies

**Status:** steps 1–3 BUILT on games 2026-09-22; steps 4 and 4b BUILT and browser-verified. Step 3 output: 88 game atoms + 11 barrels, zero dangling imports, zero atom cycles, every game module links through the alias map in Node, every game class exists exactly once in the build (Solomon bee ~1.3 MB → 4 KB, game view bee 1–2 MB → 16 KB). Step 5 BUILT and browser-verified. Step 4c (position-aware preloader) and 6 open. Decided by jwize: every game (and eventually
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

**BUILT and browser-verified 2026-09-22.** An atom is not in any layer — the
root lists it, and a pick takes the dependencies under its path from its own
root. So `draftModule` on a dependency picks at the layer that holds the
atom's namespace (`games/solomon` for `games/solomon/labyrinth`, `games` for
`games/juice`), keeps that layer as it runs, and writes a draft root whose
dependencies are the ones that path runs now with the one atom swapped. Line 1
(the specifier) and line 2 (the lazy marker) are kept; a draft that changed
the specifier is refused. Drafts at one path now STACK: a bee draft and an
atom draft build on the pick already there instead of resetting to the
trunk's dependencies. A commit lists what the selection runs — the trunk's
dependencies with each drafted path's own — so a committed atom draft
publishes the new atom. The drafts port (`ModuleDraftsProvider.draft`, core)
lets a queen draft without importing the runtime.

Proved on the web shell at 4260: drafting the Solomon labyrinth atom through
the port, reloading, and opening Solomon ran the drafted code; the import map
pointed the labyrinth specifier at the new atom and every other atom stayed
as it was; dropping the draft restored the original. Tests:
`module-drafts.atoms.spec.ts`.

### 6. Extend to every feature
Flip the per-directory flag on for the rest of essentials one domain at a
time, draining the 179-entry allowlist as each domain's registrations move
into its bee. `presentation` (36 drones) is a genuine many-behaviour domain
and stays that way — the rule is one behaviour per FEATURE, not per
directory tree; what changes there is only that its services stop
registering themselves.

**Decided by jwize, 2026-09-22:**
- **A queen that registers itself is a bee.** A word is a behaviour the hive
  registers. In an atomized domain the build classifies a self-registering
  `*.queen.ts` as its own bee. A queen its feature's bee registers (the game
  queens) stays a dependency. A queen becomes a bee only when its domain is
  atomized: as a lone bee in a namespace-bundle domain it would carry private
  copies of its sibling files.
- **Every other registering file gets an owner bee.** A service, view, input
  or small registry stops registering itself; the bee of its feature
  registers it once, and every other bee keeps resolving it by IoC key.
- **Domain by domain**, smallest first, each committed on its own.

**The recipe for one domain:**
1. Its self-registering queens become bees (automatic once it is listed).
2. Every other registration moves into the domain's owner bee.
3. Exports another file imports from a queen move into a dependency atom
   (a bee cannot be imported; the build stubs it and a named import fails).
4. The domain joins `hypercomb-essentials/atomized-roots.json` — the one list
   the build and the ratchets both read.
5. `npm run build:essentials`; zero dangling imports; zero link failures in
   Node through the alias map; the domain's tests and the doctrine suite.
6. On a web shell of its own origin: install the new build, reload, and
   compare every registered IoC key with a baseline taken before — nothing
   missing, nothing new.
7. Commit.

**The build keys every unit on the atomized list** (`BUILD_SHAPE`). Listing
a domain changes what OTHER units inline without touching their source, so
without it their caches hit and ship the old inlined copies — caught on the
first batch, when only 6 of 140 bees rebuilt.

**Batch 1 — BUILT and browser-verified 2026-09-22:** notes, concealment,
website, widgets, references, recording, meeting, format, document, search,
computation. Three queens became bees; the search service, both computation
services and the document slot moved under their bees. 436 of 436 IoC keys
registered after the swap; 169 units linked.

**A service the first paint needs is registered by the render-critical bee
that needs it.** Before atomization every namespace bundle loaded before any
bee, so a service always existed first; an owner bee loads concurrently with
the rest. The render-critical bees (`PixiHostWorker`, `ShowCellDrone`,
`BackgroundDrone`) load before the paint, so a service they read for it is
theirs to register: Settings (pixi-host), LayoutService and SubstrateService
(show-cell — the tile order and the fallback tile pictures). Everything else
the shell and the bees already look up when used, or through `whenReady`.

**A self-registering `*.bee.ts` is a bee** in an atomized domain, as a queen
is (`sequence/sequence-editor.bee.ts`).

**Batch 2 — BUILT and browser-verified 2026-09-22:** selection, clipboard,
contact, quickmenu, files, comfy, workflow, substrate, move, preferences,
pheromones, link, molecule, sequence, safety, keyboard. 17 queens and the
sequence editor became bees; 30 other registrations moved under owner bees.
The keyboard had no bee, so it has one now (`keyboard/keyboard.drone.ts`,
registering the keymap service and the Escape cascade's back entry); the
quick menu's word owns its registry and input; the link drop owns the link
safety service it guards; the workflow's built-in step kinds became a list the
runner registers. On the web shell every baseline IoC key registered, plus the
new keyboard bee — and two sequence words (`frame`, `pattern`) that never
registered before now do. 330 units linked; 185 atoms, 160 bees.

**Batch 3 — BUILT and browser-verified 2026-09-22:** tutorial, editor. The
lesson registry and the four courses (each course is now a list the tutorial
bee registers, in order), the tutor slot, the tile editor's two services, its
IoC face and its shell surface all register from their bees. The tutorial
overlay is created by the shell's surface host, so it ANNOUNCES itself on
connect (`onOverlayMounted`) and its bee registers it. The properties slot is
declared by show-cell, since the first paint reads tile properties. 443 of 443
IoC keys; 44 lessons; 374 units linked; 214 atoms, 164 bees.

**Found: BOOT SERVICES — not atomized yet.** Some services are read before
ANY bee loads, so no owner bee can register them in time:
- `@HistoryService` — the runtime initializer reads it in phase 1, before bees
  load in phase 2, and skips the post-paint neighbourhood warm-up for the
  whole session if it is missing.
- InputGate, ModeRegistry, InputModeStack — shell chrome binds to them as it
  is constructed (the controls bar builds a signal over InputGate).

An atomized domain loads its atoms lazily, so a boot service there must be
registered by something that runs before the shell and the runtime read it.
navigation and history hold these and wait on that decision; presentation,
sharing, assistant and commands must be checked for them too.

**THE BOOT LANE — decided by jwize 2026-09-22, BUILT.** A boot service is
registered by its domain's BOOT BEE: a drone named `*.boot.drone.ts`. The
build names boot bees in the package root (`bootBees`, root only, like
`criticalBees`, checked by the closure pass), and every shell calls
`ScriptPreloader.loadBootBees()` right after the dependencies load — before
the runtime initializer, the Lineage and Angular start. Registration stays a
bee's act; the timing is what the eager namespace bundles used to give. Two
boot bees so far:
- `navigation/navigation.boot.drone.ts` — InputGate, ModeRegistry,
  InputModeStack, BackGesture, ViewBack, HexDetector.
- `history/history.boot.drone.ts` — HistoryService (and its runtime contract
  key `@HistoryService`), HistoryCursorService, the LayerSlotRegistry, and
  history's own builds and snapshots slots.

**Batch 4 — BUILT and browser-verified 2026-09-22:** navigation, history.
Besides the boot bees: the zoom bee registers the mousewheel input too (it
already held pinch and the touch coordinator); the slider owns the global
time clock, the recorder the order projection (it was only a side-effect
anchor before), the manifest optimizer the genome census, and the prune word
its service. On the web shell: the boot lane ran between the dependencies
(+535 ms) and the Lineage (+602 ms); the runtime found `@HistoryService` and
the history warm-up ran; every baseline IoC key registered plus the two boot
bees; zero breaks; 436 units linked; 252 atoms, 172 bees.

**Batch 5 — BUILT and browser-verified 2026-09-22:** presentation. The
render-critical bees own what the first paint reads: pixi-host adds
AxialService (the runtime's render-critical readiness list names it);
show-cell adds the index nurse, the center-slot tracker, the tile-source
registry and the two render factories; background.drone the background
themes and the canvas background. The agent bee owns its avatar registry.
Three screensaver/hide/organism words became bees.

**A bee is never imported for a value — so shared exports leave the bee.**
The build now enforces it inside atomized domains (an import landing on a
bee is an empty module, and a named value import fails the build — it caught
the organism word importing its bee's effect names). Four new atoms:
`tile-public.ts` (the hide list, per-tile public flag and branch-public list,
out of tile-actions.drone), `tile-action-icons.ts` (the icon placement math),
`tree-view-target.ts` (the tree view's name and the `/tree` target parser),
`template-author-effects.ts` and `organism-effects.ts` (effect names). Types
stay where they are: a type import vanishes at build.

On the web shell every baseline key registered, plus the template-author bee,
which never registered before; zero breaks; 559 units linked; 350 atoms,
175 bees.

Next: assistant, sharing, commands — each checked for boot services first
(DecorationService, OverlapMetrics and VisualBeeRegistry are read by the
command line; HostSync by the store). (`revolucionstyle.com` is outside the
build.)

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
