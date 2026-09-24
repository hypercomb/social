# Atomic modules — one behaviour, many dependencies

**Status:** steps 1–3 BUILT on games 2026-09-22; steps 4 and 4b BUILT and browser-verified. Step 3 output: 88 game atoms + 11 barrels, zero dangling imports, zero atom cycles, every game module links through the alias map in Node, every game class exists exactly once in the build (Solomon bee ~1.3 MB → 4 KB, game view bee 1–2 MB → 16 KB). Step 5 BUILT and browser-verified. Step 6 DONE 2026-09-22 — every domain in the build is atomized (batches 1–8); the self-registration allowlist holds six files, none of them a registering dependency inside the build. Step 4c (position-aware preloader) open. Decided by jwize: every game (and eventually
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

The tutor has the same lazy seam now (7251b17e1): its bee loads its shell
and study games on first study, and boot fetches 10 game atoms, not 28.

**4c BUILT 2026-09-23 — the preloader IS the tile walk** (jwize: "our
preloader should be the same as we already have for tiles for every
hierarchy and when the children are dependent it needs to expand when that
gets in range of the depth … we can preload any and everything"). No second
preloader: `HistoryService.preloadFromRoot` — breadth-first from where the
participant stands, usage-ordered, cancelled by the navigation generation —
now treats a tile's FACE as one more child. A tile within the code radius
that wears a view with a lazy seam (a game record, a tutor deck) has that
view's code loaded, opening nothing, so the first open is warm.
- *Within reach only.* Code radius 1 by default: the tile you stand on and
  the tiles you see. Going up to an ancestor spends it, a declared one-click
  destination counts as one away, the root walk warms none. A browser may
  ask for 0 (off), 1 or 2 through `hc:preload:code-depth` — a plain input,
  so a measurement (or Jev, later) sets a number, not code.
- *After the tiles, and nobody waits on it.* Faces warm as a tail once the
  pass's tiles are done; the way back and the proximity warm never queue
  behind code. The tail re-checks the generation before each face, one face
  per idle slot; a face it could not deal with (views not registered yet, a
  failed load) leaves its part of the stamp unset, so the next pass retries.
- *Each view warms itself.* One optional `prefetch` on the view's registry
  descriptor (the game view → `prefetchGameFace` → the game bee's
  `LazyOverlay.prefetch`; the tutor → its study shell); hidden or dormant
  faces are skipped as their open would refuse them. The walk names no
  feature.
- *A face is read at the tile's own head,* never the layer its parent
  recorded: that sig goes stale the moment the tile commits, and marking a
  face on it is exactly such a commit (the first live run found this).

*Measured* (web shell on 4264, a fixture with game and tutor faces at depth 3, the same package with the code radius 0 vs 1): at `/lab/arcade` the tail warms 3 faces in about 1.2 s after the tiles, and every warm open then fetches **0** seam atoms (19 Solomon, 10 Arkanoid, 18 tutor before). Open time on localhost at 1× barely moves (Solomon ~260 ms either way — its open is mounting and rendering, not fetching: installed modules come from the service worker in 2–3 ms each).

| At 4× CPU, medians of 2 | Code warm off | Code warm on | Seam atoms on the warm open |
|---|---|---|---|
| Solomon | 1169 ms | 1232 ms | 19 → 0 |
| Arkanoid | 281 ms | 285 ms | 10 → 0 |
| Tutor | 253 ms | 260 ms | 18 → 0 |

Both 4× arms ran while a second harness run (an earlier job left going) drove its own throttled browser against the same server, so the absolute times are inflated; the load was the same for off and on, and a third off-arm run from that job (Solomon warm 1278 ms) sits in the same range, so the comparison stands. Re-measure absolute 4× times alone before quoting them.

THE HONEST VERDICT: the code warm does what it says — nothing is fetched at the open — and it does NOT make the open faster on an installed hive, even at 4×: open time is mounting and rendering, and fetching plus evaluating these seams is a small part of it. What does make an open fast is the tile walk that was already there (a tiles-warm open beats a cold one: Arkanoid 281 vs 566 ms, tutor 253 vs 518 ms at 4×). The code warm is kept because it is correct, detached and cheap, and it is where a seam that is heavy or not yet local (increment 2 makes Solomon's 42 atoms across 9 import levels; a door's first visit) would pay — measure that before claiming it.

**Increment 2 — adopt the proper load (step 1 BUILT 2026-09-23).** The walk
warms what a face reaches; code that boot reaches only because something
imports it statically, and that is needed only when a word runs or a view
opens, belongs behind a seam. An audit of the build found 15 such edits
worth about 1.1 MB of the 7.0 MB boot (game view → the story word → Solomon
being the largest). Each is measured and kept only if it pays.
- *Step 1: the story word.* `games/story.queen.ts` loads Solomon's places,
  levels, add-ons and tiles with one cached `import()` when the word runs
  (arguments checked first; a failed load says so); only `solomon/place.js`
  stays static, because `refuse` answers synchronously.

| Web shell, 1× | Before | After |
|---|---|---|
| Boot modules / KB at `/plain` | 441 / 3,811 | **418 / 3,243** (−23, −568 KB) |
| Bees ready at `/plain` (median of 2) | 870 ms | 745 ms |
| Solomon's seam | 19 atoms, 4 levels | 42 atoms, 9 levels |
| Solomon cold open | 208–238 ms (earlier runs) | 225 ms |
| Solomon warm open (face within reach) | — | 256 ms, 0 atoms fetched |

The boot bytes left exactly as predicted, boot timing held or improved, and
the game's first open pays nothing measurable for carrying its own code.

- *Step 2: fourteen windows and words (BUILT 2026-09-24).* Each bee keeps
  its trigger and loads its view with one cached `import()` when it fires:
  the providers console, agent panel, skills window, trial changes panel,
  tile editor, tutorial overlay, link-drop card, brood panel, hosts
  directory, offers, vocabulary find, vocabulary, the website word's archive
  and list, and layout targets. A view the shell mounts by tag is registered
  at boot by its tag alone and DEFINED on its first open; the element already
  in the page upgrades in place and the bus replays the open. What the build
  audit's second review caught, and each bee now handles: a first load slower
  than an open's stamp window re-sends the open with a fresh stamp; an IoC key
  that ignores a second register gets a forwarding face, never a stub then a
  swap; a burst of offers keeps every notice; a link drop never awaits the
  card; replayed closes subscribe before the open, so an old close cannot put
  down the panel a press just opened; a failed load says so and can be tried
  again.

| Built package, from its layers | Before | After |
|---|---|---|
| Boot modules (262 bees + their static atoms) | 681 | **656** (−25) |
| Boot bytes | 6,307 KB | **5,801 KB** (−506 KB, −8.0%) |

Built from development alone in a clean worktree, both arms. Live on the web
shell (`inc2-views-live.cjs`, 25/25): none of the moved code is loaded after
boot, and every window opens on its word or effect (the agent panel is
covered by its spec: a fresh hive has no agent to open). Still ahead, each
needing a split first: `nostr-tools` (231 KB, all five importers or none),
the agent tiles rail, prune, the tutorial lessons, keyword suggestions, the
image editor.

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
- `sharing/sharing.boot.drone.ts` and `commands/commands.boot.drone.ts` —
  see batches 6 and 8.

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

**Batch 6 — BUILT and browser-verified 2026-09-22:** sharing. A third boot
bee, `sharing/sharing.boot.drone.ts`, registers the Nostr signer and the host
sync (and its runtime contract key `@HostSyncService`, which the store stages
reads through); it also loads the retired-push collector, which ran at boot
before. Services that start work when they load (the passive replication
queue, the update scout, spotlight and its scroll input, HostSync's drain)
keep that code and EXPORT their instance; the owner bee imports and registers
it, so the work starts when its owner loads. Owners: swarm-adopt (adopt
queue), content-broker (passive replication), hosts (update scout, package
attestation, the host directory's face and surface), swarm (filter), the
folder-sync word (its service and view), the offers word (its surface),
hive-visit (the visitor door's surface), spotlight (spotlight + scroll). Out
of bees into atoms: `peer-models-lending.ts`, `discover-effects.ts`.

**Found and fixed: UNREACHABLE ATOMS.** An atom that does something when it
loads — adds a shell surface, subscribes, declares a pool kind — used to run
because its namespace bundle loaded at boot. As a lazy atom it runs only if a
bee reaches it. Five views added their own shell surface (two vocabulary
views, the targets window, the visitor door, the host directory) and nothing
reached them, so in the web shell those windows were gone — in batches 2 and
5 as well as this one — and the IoC-key comparison could not see it, because a
surface is not an IoC key. Their bees now add their surfaces; the bee toggle
is loaded by the avatar swarm; the vocabulary ledger's pool kind loads with
the views that import it. The self-registration pattern now also catches a
`whenReady` that ADDS and a module-scope `name()?.register?.(`. Two checks
join the recipe:
- every atom with module-scope effects must be reachable from a bee or an
  eager bundle (barrels never count);
- the web-shell comparison covers shell surfaces as well as IoC keys.

On the web shell: every baseline key registered (the host directory's face
back), all 60 shell surfaces registered and the checked ones mounted, zero
breaks; 643 units linked; 402 atoms, 190 bees.

**Batch 7 — BUILT and browser-verified 2026-09-22:** assistant. No boot bee:
the chat window and the shell reach every assistant service through
`whenReady` or at use. Five words became bees (conversation, file, llm,
misses, module). Three new bees: `llm.drone.ts` (the provider registry, the
roster, the activation / model-choice / removal / hive-access / policy
stores, the router, the host's AI and the Providers console with its
`/providers` `/models` words), `chat.drone.ts` (threads, compaction, the
execution queue) and `jev.drone.ts` (decision, outcomes, replay). The
context bee took the anatomy, context groups, hive tree reader, tile context
and pictures and the context read half; the orchestrator the agent registry,
panel and rail factory; the bridge worker the skills window and `/skills`;
the misses word its record.

- **The roster is data.** The vendor descriptors stopped registering
  themselves; `builtin-providers.ts` lists them and `startBuiltinLlmProviders()`
  (called once, by the llm bee) registers them in the order the registry
  keeps, then the OpenRouter instances, the local model, the liveness watch
  and discovery — all of which used to start when a file was imported.
- **The ratchet counts the assistant's doors into the map**, at module scope:
  `publishService(`, `registerLlmProvider(`, and a `whenReady` that
  `addProvider`s a slash provider. A table a module keeps for itself
  (screensaver motions, bubble styles, published-pool handlers) is not the
  hive and is not counted. `llm-provider-registry.ts` stays on the allowlist:
  it holds the map door itself (`publishService` and the accessor's heal).
- **An import cycle the bundle forgave.** chat-thread → chat-route →
  chat-steps → chat-thread worked while one bundle held all three; the build
  refuses it for separately loaded atoms. The chat's IoC surface
  (`ChatThreads`, the standings) left the foot of chat-thread for its own
  atom, `chat-threads.ts`, above all three.
- Out of bees into an atom: `reshape.ts` (the organize threshold and the
  break-apart skip wording, which break-apart, expand and the slash drone
  imported from other bees).

On the web shell every baseline key registered plus the three new bees, all
60 shell surfaces, the roster in its old order, zero breaks, zero unreachable
atoms; 707 of 730 units linked (the rest need a DOM); 538 dependencies,
198 bees.

**Batch 8 — BUILT and browser-verified 2026-09-22:** commands. STEP 6 IS
DONE: every domain in the build is atomized.

- **A fourth boot bee**, `commands/commands.boot.drone.ts`, registers the
  `decorations` slot (LayerCommitter subscribes only to a registered slot's
  triggers, so a decoration written before the slot exists vanishes), the
  `website` slot (the preloader warms registered slots), DecorationService
  (the controls bar reads tile titles through it on its first render), the
  decoration index's overlap metrics and context index, and VisualBeeRegistry
  (every visual bee registers into it).
- 61 words became bees, and `view.bee.ts`. Owner words took the rest: the
  aliases drone its participant aliases, `/reference` the canonical
  reference service (the one write door for portals), `/mobile` the
  long-press that reveals the command line, `/keywords` its proposal surface
  and generator, the translate sweep its translation service, and the slash
  drone the utterance reader and spoken habits.
- **Twelve values left their words for atoms**, because other bees imported
  them: each view word's names (`brief-kind`, `postit-kind`,
  `publications-kind`, `lightbox-kind` with every picture a tile holds,
  `scroller-kind`, `square-tile-kind`, `view-library-kind`, `website-kind`),
  `template-catalog` (the layouts on offer and the door that starts a
  design), `remove-tiles` (what /remove and the tutorial's cleanup share),
  and the named forms of /keyword and /accent (`named-target`,
  `accent-target`). Types stayed with their words.

The self-registration allowlist is down to six: `llm-provider-registry.ts`
(the map door itself) and five `revolucionstyle.com` files, which are outside
the build. On the web shell every baseline key registered plus the new bees,
all 60 surfaces, both slots, zero breaks; the boot bees finished at +466 ms,
Angular's first paint at +511 ms; 817 of 840 units linked; 579 dependencies,
261 bees.

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

**Measured 2026-09-23, after step 6.** Headless Chromium against the web
shell at 4264, a fresh context per package (its own storage), one install
timed end to end, then three warm reloads (means). Three packages the web
content still held: before any atomization (21 Sept, 59 dependencies), games
only (22 Sept, 148), every domain (23 Sept, 579). Harness:
`measure-atoms.cjs` (resource-timing buffer raised before the page runs —
the default 250 entries hides most module fetches).

| | Before | Games only | Everything |
|---|---|---|---|
| Install: files fetched, time | 185, 2.8 s | 176, 2.2 s | 515, 4.5 s |
| Dependencies loaded | 367 ms | 318 ms | 282 ms |
| First paint | 436 ms | 374 ms | 440 ms |
| Bees ready for the first render (`first preloader.find`) | 1291 ms | 1014 ms | 830 ms |
| Modules fetched through the import map at boot | 11 | 21 | 414 |
| Last module arrives | 1.23 s | 1.01 s | 2.28 s |
| IoC keys, breaks | 433, 0 | 436, 0 | 454, 0 |

What it says:
- **Per-module cost does not hurt the paint or the first render.** First
  paint is flat; the bees the first render needs are ready 460 ms SOONER,
  because a bee is small now and its atoms load in parallel.
- **It costs a longer tail.** Every bee still loads at boot, so their static
  closures (414 atoms) keep arriving after the first render — about a second
  longer than before. Only the games and the tutor have lazy seams.
- **It costs the install.** 515 separate files instead of 185; locally about
  9 ms a file, and over a real network each file is a request.

So the two costs have two different answers. The install is what a transfer
pack removes (one file carrying many atoms, each re-verified on arrival). The
tail is what lazy seams remove (step 4c): a feature's atoms loading when the
feature is used, not when its bee boots. Merged modules are not indicated by
anything measured here.

**Found and fixed: npm code copied five times — vendor atoms.** Five atoms
(`nostr-signer`, `head-claim-signer`, `hive-pointer`, `pheromone-deposits`,
`vocabulary-signer`) each inlined `nostr-tools` and its `@noble` crypto, about
200 KB apiece — a quarter of what a boot loaded. The build now finds every npm
package two or more source files import (`VENDOR_PACKAGES`), builds it ONCE as
a dependency named by the package itself (`// nostr-tools`, a bare specifier
the way `pixi.js` is), and leaves it external everywhere else; the set is
folded into `BUILD_SHAPE` so every unit rebuilds when it changes. Atoms a boot
reaches: 3.93 MB → 3.17 MB. The update that shipped it fetched 16 files. On
the web shell the import map serves `nostr-tools` from the dependencies pool,
a sign-and-verify round trip passes, every key registered, zero breaks.

The tail did NOT move (last module about 2.4 s, as before): it is set by the
NUMBER of modules and their import chains, not their bytes. That settles the
order — lazy seams next; a transfer pack would not shorten it either.

**Found and fixed: the tail was two costs, and neither was the code.**
1. *Import chains.* The browser learns what an atom imports only after
   fetching it, so a chain is one round trip per level — up to eight or nine
   deep (substrate → comfy → published-pools → intake-filter → …). The
   install now derives each bee's whole STATIC atom closure from the admitted
   bytes (`hypercomb-runtime/src/bee-deps.ts`, the same hint map as `beeDeps`;
   eager namespace bundles stay out of it so their services still register at
   boot), and the preloader imports the closure all at once before the bee
   evaluates. Dynamic `import()` is never followed — seams stay lazy.
2. *The service worker's cache lookup.* Every module request did
   `cache.match(request, { ignoreSearch: true })`, which scans every cached
   entry. With about a thousand modules held: 200 lookups took 611 ms that
   way and 12 ms exactly. The worker now keys the cache on the URL without
   its query and matches exactly — the same answer, since every path it
   serves names its bytes (web, dev, shim and meadowverse workers;
   `service-worker.spec.ts` refuses `ignoreSearch` back).

| Everything atomized, same package | Before these two | After |
|---|---|---|
| One module fetch, median | about 490 ms | 2–3 ms |
| Last module arrives | 2.39 s | 0.98 s |
| Bees ready for the first render | 909 ms | 617 ms |
| First paint | 534 ms | 320 ms |

Against the package from before any atomization (last module 1.23 s, first
render 1291 ms) the atomized hive is now faster on every boot measure. The
remaining tail is bee scheduling and evaluation, not fetching. Lazy seams
(4c) still cut what loads at all; they are no longer needed for speed.

**Transfer packs — BUILT 2026-09-23.** The install's cost was the number of
files and their size on the wire (sig-named files travel uncompressed).
- *Format* (`hypercomb-runtime/src/transfer-pack.ts`, pure — the build and
  the reader share it): a magic line, a JSON line of `[signature, length]`,
  the members' bytes back to back, gzipped. A pack is an ordinary
  content-addressed file.
- *Discovery* is a derived record, not a reference: the `transfer:packs` pool
  (census `index` — wipe-safe, credits nothing to the collector) holds one
  member per package, named by the ROOT and holding the pack's signature. No
  layer names a pack; a reader derives the address.
- *The build* mints one per package (every layer, bee and dependency: 908
  files, 8.1 MB → 2.2 MB); `copy-content` merges the pool into its targets
  (it grows, so it is never skipped like a finished bag).
- *The install* (`installPackage`) walks the layers loose, then asks: are at
  least half the bees and dependencies — and at least 32 — missing here? Only
  then does it fetch the pointer and the pack, hash every member against its
  own name, and serve the walker from it; the walker hashes again at
  admission. Anything the pack lacks, or a member that fails, is fetched
  loose. An update that changes a handful of files never downloads a pack.

Measured with the same harness, the install step alone under DevTools
network emulation (523 files to fetch, 499 of them from the pack):

| Network | Loose files | Transfer pack |
|---|---|---|
| none (localhost) | 5.3–6.7 s | 5.5–5.9 s |
| 40 ms, 20 Mbps | 13.2 s | 6.5 s |
| 150 ms, 5 Mbps | 30.7 s | 11.3 s |

On localhost the install is hashing and OPFS writes, so a pack changes
nothing there; over a real network it halves the install or better. The dev
server is HTTP/1.1, so a real HTTP/2 host narrows the loose column somewhat;
the 3.7× smaller transfer does not change. Not yet: a pack for a slice
smaller than a whole package.

**The reader can never lose an install to a pack (562be4e46).** The first
reader could: a throw inside it rejected the install, a pointer to a huge
file or a gzip that inflates without end could take the tab, and the first
pack that decoded was used even when it carried nothing needed. It is now
wrapped whole (any failure → loose), downloads are capped in time and size,
the unzip stops at 256 MB, and a pack covering less than half of what is
missing is passed over for the next origin's.

**Packs from `module commit` — BUILT 2026-09-23** (jwize: the door answers
it, every commit, minted in memory). Only a sandbox door
(`try-<change>.<zone>`) installs a committed package cold, and no host takes
a pool member from a browser, so:
- *Minting* (`module-drafts.ts` `packFiles`, core's optional
  `ModuleDraftsProvider.pack`): every file of the committed package, read
  and hashed, packed in memory — never written into the hive. Complete or
  absent: one missing or mis-hashed file means no pack.
- *Publishing* (`module.queen.ts` `publishPack`): after the install stamp,
  the pack goes up through `publishAtoms` like any file, then
  `pack:try-<change>` is stamped in the publisher's signed index — awaited
  before the change, review and Jev stamps, because each stamp rewrites the
  index whole. Any failure warns (`module.nopack`) and never touches the
  commit or the install stamp.
- *Serving* (blossom worker `serveSandbox`): the door reads `pack:<lineage>`
  beside `install:`, `change:`, `review:` and `jev:`, and answers
  `/content/<sign('transfer:packs')>/<root>` for the root it serves and no
  other. Only the publisher's key moves it. Needs the worker deployed.
- *Reading* (`installPackage`): a hive holding fewer than 32 modules — a
  door's first visit — asks for the pack BEFORE the layer walk, so the
  layers come from it too.

Proven end to end on this machine (`verify-hive-publish.cjs` 60/60, then a
fresh browser at the follower's door): the door answered the pointer, the
install logged "transfer pack … 905 files carried", and installed the door's
package in 6.5 s with 7 content requests instead of about 909 — which is
what matters most on the Workers free plan's daily request cap.

## Non-goals
- No new pool, no new `__x__` folder. Atoms live in `sign('dependencies')`
  as today.
- No change to what a behaviour IS at runtime (Drone lifecycle, IoC key).
- No hive-side vocabulary decided here.

## Risks
- ~~**Every dependency loads twice.**~~ Resolved in step 4: atoms and barrels carry the `lazy` marker, the DependencyLoader skips them, and they load once, through the import map.
- ~~**Boot fetches ~100 game modules eagerly.**~~ Resolved in steps 4 and 4b: zero game dependencies load eagerly, and a game's atoms arrive when it opens.
- **Cycles** (step 3) — the one place inlining did real work for us.
- **Module-scope side effects in dependencies that are NOT registration**
  (a `const x = ioc.get(...)` at top level) now run once and at import
  order the import map decides. The audit's "split brain" is fixed by the
  same move, but each such file needs a look during step 2/6.
- **Build time**: hundreds of esbuild invocations instead of dozens.
  Mitigate with content-keyed cache (already the design).
