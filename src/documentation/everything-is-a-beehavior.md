# Everything is a Beehavior — the shrink plan

**The question:** what would it take for everything to be a beehavior, right down
to the slimmest shim to the hypercomb core processor?

**The answer, measured (2026-08-25):** ~95,000 LOC of shell-side code
(hypercomb-shared + both shells) sits above the 62,230 LOC that is already
behavior-shaped. The processor itself is a 57-line file in core
(`hypercomb-core/src/core/hypercomb.ts`), rendering is already fully
behavior-side (every Pixi import lives in essentials), essentials has **zero**
compile-time imports from shared, and 72% of the shell UI is already
registry-fed and therefore positionally free. The shrink is large but it is
almost entirely *moves and rewrites of things that are already decoupled* —
not an untangling.

This is a living document. Chip an item, check its box, remove its ratchet
line, run (or queue) its mirror pass.

---

## The end state: the shim, defined

**Domain deploy everything.** The deployment model is one resolution
contract: `<origin>/<sig>` serves content bytes, flat and sig-named — which
is exactly what `deploy:essentials` already uploads, and exactly what the
service worker's "opfs resolution by signature" route already serves locally
(`hypercomb-web/public/hypercomb.worker.js`, `handleOpfsRequest`). A domain
IS a deployment; the client's OPFS is a cache of the same address space; the
dev server serves dist under the same contract. No bundler in the loading
path, no name-addressed modules — and therefore **no import map**: once
Angular and Vite are out of the load path and bee dependencies are imported
by signature URL instead of by alias, `resolveImportMap()`, the `index.html`
localStorage replay, and the one-time `location.reload()` hack all retire
(Phase 4). The signature is the address; the URL is just the signature with
an origin in front of it.

**Deployments are artifacts.** Nothing is ever "running" at a domain — a
deployment is a static, signed artifact that clients import, and execution
happens only in clients. Two artifact kinds cover everything, both with the
same mechanics (flat sig files + a pin naming the roots):

- **Hives** — content trees: layers, resources, a lineage head. Imported by
  adoption — the visitor's walk, the wand, DCP install — into the
  participant's own tree via the merkle sharing pattern.
- **Packages** — code: bees, dependencies, a manifest. Imported into the
  OPFS pools and registered in IoC through the roster.

"Deploy" = mint the artifact (sign the bytes), place them at any origin,
move the pin. "Import" = resolve the pin, pull the sigs, verify, adopt.
The same artifact can be served by a domain, handed peer-to-peer over the
swarm, or copied on a USB stick — the signatures make all three identical.

**One shim, every domain.** Hosted websites on the hypercomb engine are not
separate deployments of the engine — they snap into the same shim and
harness. A domain on the engine publishes three things, all static: its
content at `<domain>/<sig>`, its pin (the manifest/bootstrap head), and any
behavior modules of its own. The visiting shim resolves the pin, pulls sigs
through the resolver, the domain's bees register in the same IoC, its
surfaces mount through the same registry, its config arrives through the
published-pools probe (`sign(<meaning>)` as one file). A website is content
plus beehaviors adopted into the harness — which is why one client can hold
many domains at once (the `dcp/<domain.com>/` scopes already model exactly
this), and why every domain the community stands up strengthens the same
engine instead of forking it.

**A door from everywhere.** Every page, domain, and artifact on the engine
is an entrance to the hypercomb — land anywhere, and the shim is already the
harness, one click from adoption. But the door only opens by being pulled
from the inside: entry is always the client resolving a signature it chose
and verifying the bytes itself, so nothing on the other side can push
through. Ubiquitous ingress for people, no ingress for code — that is the
property that makes "from everywhere" safe to want.

**Walking through the door: publish → adopt → hypercomb.io.** The published
files are a *subset of your hive* — exactly the tiles you marked public and
nothing else; publishing is per-tile consent. That subset then becomes the
source of its own adoption: visitors adopt from the artifact, never from
your live client. And the walk-in IS the onboarding: an "add to hypercomb"
gesture on any domain hands off to hypercomb.io with that hive staged — you
arrive, you accept the adopt, and you have it. An instant introduction to
hypercomb: the domain is the door, hypercomb.io is the hall. The adopt is
always *offered*, never auto-applied — accepting on arrival is the consent.

**Factory defaults: content adopts, code stays dark.** A fresh participant
who has joined no communities gets factory defaults that prevent code
execution: hive content adopts freely, but packages arrive dormant. The
behavior roster ships dark for anything third-party, and turning a bee on is
the features panel's explicit opt-in — the standing doctrine (code never
enters via a props fold; third-party provider specs arrive held) stated as
onboarding policy. Joining a community is what relaxes the default, and only
deliberately.

The walk-in itself is new work (its own pass, not yet built):

- [ ] The hand-off: an "add to hypercomb" gesture on a hosting domain →
  hypercomb.io with the source pin staged; arrival offers the adopt (rides
  the example-hives first-boot offer pattern — the offer owns the choices)
- [ ] Factory-defaults audit: verify every package path lands dark for a
  community-less participant (roster, provider holds, features opt-in) while
  first-party cohorts stay seeded ON

The shim is everything that must exist **before the first bee can pulse** —
nothing more. Measured against today's boot path, that is:

| Piece | Today | LOC |
|---|---|---|
| The sig resolver | SW route `/<prefix>/<sig>` → OPFS, network fallback (`hypercomb.worker.js`) | (worker) |
| The IoC | `hypercomb-shared/core/ioc.web.ts` | 119 |
| OPFS read-by-signature | `hypercomb-shared/core/store.ts` | 2,011 |
| The BeeResolver | `hypercomb-shared/core/script-preloader.ts`, minus its alias/deps logic | < 680 |
| The boot kick | `new hypercomb().act('')` | 1 |

≈ **2,800 LOC of shim** plus the service worker, over the **3,493 LOC core
kernel** (which is already right: processor, bee hierarchy, IoC, EffectBus,
signatures, registries, types — no Angular, no external imports). Plus **one
pinned bootstrap signature** (Phase 4) through which everything else —
installer included — arrives as signed content.

Everything not in that table becomes a signature-addressed module, deployed
by putting it at `<domain>/<sig>`.

**The liability shape.** This is the ultimate deploy because the trust
surface and the hosting surface both collapse:

- **Auditable in an afternoon.** What you must read to trust the whole
  system is the shim + core — ~6,300 LOC of plain TS with no framework, no
  bundler magic, no server logic. Any developer can hold it in their head.
- **The host cannot lie.** Content is named by its hash and verified before
  it runs, so a domain serving wrong bytes for a sig is *rejected by the
  client*, not trusted. Hosting becomes commodity: any static host, any
  CDN, any mirror, any peer. The server is a resolver, never an authority
  (`read-only-deployment.md`).
- **Once known, permanently public.** A published signature is a permanent
  name — anyone holding it can verify, rehost, and fork the exact bytes
  forever. Old signatures never break. Deploys are reproducible by
  construction, and "taking it down" only ever removes a mirror, never the
  name. (This cuts both ways: nothing published by sig can be retracted —
  see knot 9.)
- **No direct connection to any hosted code.** The client never executes
  what a host sends; it executes what a *signature* names, after verifying
  the bytes locally. The connection to a domain is a cache-fill, not a code
  channel — no host can push code, a compromised CDN can only serve bytes
  the client rejects, and once OPFS is warm the app runs with the host gone
  entirely. (Web's one residue: the first visit trusts the origin for the
  shim bytes themselves — see knot 8. Native escapes even that: the shim
  ships in the installer and the desktop adopts its own bundle.)
- **Liability concentrates in one line.** The only mutable trust point left
  is the pinned bootstrap signature — whoever controls the domain controls
  the pin, and repinning changes the app. That is exactly where scrutiny
  belongs, and it is one line, in the open, instead of a build pipeline.

## The scoreboard

Progress is measured by three numbers, all of which may only shrink:

1. **The shell IoC census** — IoC keys registered by shared/shell code.
   Today: 43 in `hypercomb-shared/core`, 4 in `hypercomb-shared/ui`
   (RuntimeMediator, ToolWindows, CommandLineBehaviors, the command-line
   atomizer target), 5-ish across the shells (LayerService, SignatureStore,
   bee-resolver, dev's routing trio).
2. **The shell-surfaces barrel** — 42 entries today → 0. Each entry that
   leaves becomes an `element:` registration from essentials.
3. **Shell-side LOC** — shared/core 15,615 + shared/ui 71,589 + web 3,734 +
   dev 937 → the shim table above.

---

## Phase 0 — Guardrails (make the shrink one-directional)

Before moving anything, make drift impossible — the doctrine-ratchet pattern
(`doctrine.spec.ts`), applied to the shrink itself.

- [x] **Ratchet the shell IoC census.** `doctrine.spec.ts` "shell-side IoC
  registrations may only shrink" — 54 frozen entries (literal keys, `*KEY`
  constants, and interpolated templates, each with its file). Every
  Phase 1–3 item deletes its line.
- [x] **Fix the two compile-time shared→essentials leaks.** Both utilities
  migrated DOWN to core (`core/link-utilities.ts`: `openExternalLink` +
  `parseYouTubeVideoId`; `core/shortcut-sheet.types.ts`: the sheet's data
  contract) with essentials re-exporting for existing call sites. Zero
  `@hypercomb/essentials` imports remain in shared.
- [x] **Put `#pixi-host` under doctrine.** `pixi-host.worker.ts` mints the
  node onto `<body>` when absent; the div is gone from both `app.html`
  files, and the template ratchet now asserts `id="pixi-host"` never
  returns. The renderer owns its DOM contract.
- [x] **Turn ScriptPreloader's render-critical key list into data.**
  Authored in `hypercomb-essentials/src/render-critical.json` → stamped by
  the module build into `manifest.renderCriticalKeys` → read from the
  cached install manifest. The sentinel resync carries the set forward;
  an empty answer un-gates first paint (dev) and never erases the
  learned-sig cache (legacy clients). The shim carries no module names.

## Phase 1 — shared/core data layer moves down (~9,000 LOC, mostly as-is)

84 of 91 files in `hypercomb-shared/core` are pure TS (`extends EventTarget`,
zero Angular). Consumers reach them by IoC key, so a move changes **no call
sites** — essentials' 217 `Store` lookups and 184 `Lineage` lookups don't
care where the implementation loaded from. Order: leaves first, heavyweights
last.

**The proven move pattern** (established by `icon-overrides`, first down):
contract → `hypercomb-core/src/core/<name>.types.ts` (interface + IoC KEY +
effect-name constants); implementation → essentials beside its heaviest
consumer, `window.ioc?.register?.` at module scope **plus** an
`ensure<X>Registered()` re-assert called on a post-boot path (the
llm-provider-registry live-map lesson); exactly ONE essentials entry imports
the file (two importers inline two instances — the dup-inlining trap);
shared consumers switch to lazy `window.ioc?.get?.(KEY)` with the author
default as fallback, and instance-free EffectBus subscriptions for change
events; the census ratchet line is deleted in the same commit.

- [ ] Leaf stores: ~~`icon-overrides.store`~~ ✓, ~~`room-store`~~ ✓,
  ~~`secret-store`~~ ✓ (took the loopback dev-secret seed with it — boot
  path shrank), ~~`secret-strength`~~ ✓, ~~`saved-locations-store`~~ ✓
  (mesh quartet → `sharing/`, announced on EffectBus: `mesh:room-changed` /
  `mesh:secret-changed` / `mesh:saved-locations-changed`), `note-marks.store`,
  `recent-portals.store`, `pinned-entrances.store`, `icon-pick`
- [ ] Registries: `tag-registry`, `bouquet-registry`, `name-registry`,
  `group-registry` + the group sources (`websites-group`, `help-group`,
  `games-group`, `launch-group*`), `tile-icon-provider-registry`,
  `proximity-registry`
- [ ] Services: `theme.service`, `view-mode.service`, `trust-service`,
  `usage-tracker`, `movement.service`, `voice-input.service`,
  `cell-suggestion.provider` + `completion-utility` +
  `resource-completion.service` + `suggestion-provider`, `icon-edit.service`
- [ ] `navigation.ts` (275)
- [ ] Heavyweights: `lineage.ts` (485 — 184 call sites but key-addressed, so
  it is a move, not a refactor; its `synchronize` listener moves with it),
  `aggregation-layer` (281), `mixed-group-bag` (551)
- [ ] i18n: `i18n.service` down + split the 2.2 MB en/ja catalogs along
  module lines via `registerTranslations` (each module carries its own
  strings — the community-module pattern, applied to ourselves)
- [ ] Delete the Angular DI bridge as its consumers vanish: `tokens.ts`,
  `shared-providers.ts`, `from-runtime.ts`, `i18n.pipe`, `i18n.signal` —
  ~140 LOC of glue that exists only so `inject(Lineage)` returns what
  `ioc.get` returns. It deletes itself.

## Phase 2 — the 42 registry-fed panels become `element:` drones (~50,000 LOC)

These are rewrites, not moves — every panel is a standalone Angular component.
But each is independent: delete its barrel line, register a custom element
from essentials in the same order band, done. The working proof is
`hypercomb-essentials/src/diamondcoreprocessor.com/tutorial/tutorial-overlay.view.ts`
(672 LOC, zero Angular, registry `element:` shape), and 47 essentials files
already build imperative DOM — the muscle exists.

- [ ] **Gate first: framework-free panel primitives.** `docked-panel` (2,324),
  `pinnable`, `dock-inset`, `hint-bar`, `icon`, `widget-zoom` are Angular
  components every panel leans on. Build custom-element equivalents that
  preserve the docked-panel contracts (sole writer of `--hc-panel-scale`,
  the width + text-size ladder, the reading face, controls-bar anchoring).
  Nothing else in this phase moves until this lands.
- [ ] Prove the pattern on the small ones: `website-nav` (67),
  `sequence-viewer` (120), `sensitivity-bar` (136), `landing-badge` (186),
  `preview-banner` (191)
- [ ] Utility band: `toast`, `confirm-dialog`, `trust-prompt`, `action-card`,
  `camera-capture`, `format-painter`, `icon-picker`, `shortcut-sheet`,
  `activity-log`, `layer-cycle-strip`, `command-palette`, `context-window`
- [ ] Viewer band: `files-viewer`, `observe-viewer`, `notes-viewer`,
  `youtube-viewer`, `docs-overlay`, `pools-of-meaning`, `pheromone-tiles`,
  `example-hives`, `presence-banner`, `contact-card`, `mesh-modal`,
  `rewind-window`, `atomizer-bar`, `workflow-designer`
- [ ] Heavy band — one campaign each: `clipboard-panel` (1,103), `portal`
  (1,047), `publish-panel` (1,033), `tile-editor` (1,719), `feedback-viewer`
  (1,920), `history-viewer` (2,274), `tags-viewer` (2,569), `features-viewer`
  (3,860), `aggregate-index` (3,942), `chat-window` (5,245), `notes-strip`
  (7,672)
- [ ] Non-barrel stragglers: `file-explorer` (1,137), `pinned-entrances`
  (513), `file-teaser` (223), `history-component` (54)

**Roster rule for every panel that moves:** once a surface is
module-delivered it becomes roster-gated. Seed its cohort ON — a migration
must never turn off what already worked (the games-cohort lesson). And a
moved view must still declare surface takeover / force the repaint on close.

## Phase 3 — structural chrome unbinds and moves down (~9,300 LOC)

The template-mounted set stays in the templates today because of live Angular
signal bindings (`meshPublic()`, `viewActive()`, `viewMode()`, `inputOpen()`).
The EffectBus window events behind them already exist (`mesh:public-changed`,
`actions:available`, …) — convert bindings to event subscriptions and each
tag becomes an ordinary element surface.

- [ ] Small chrome: `mesh-header` (201), `sync-indicator` (377),
  `upgrade-indicator` (374)
- [ ] `edit-actions` (460)
- [ ] `controls-bar` (5,851) — the edge-reservation layout box that panels
  anchor to must survive the rewrite intact
- [ ] Pure-TS window plumbing moves down as-is: `tool-windows.ts` (the Escape
  cascade's single owner), `runtime-mediator`, `window-rule`,
  `window-session`, `breakpoints`
- [ ] `command-line` + `command-shell` (9,117 combined) — the largest single
  rewrite in the whole plan; also owns `CommandLineBehaviors` and the
  atomizer target. Goes last in this phase.
- [ ] Web's install prompt — folds into the Phase 4 installer story
- [ ] End of phase: both `app.html` files contain `<hc-shell-surfaces>` and
  nothing else; the "structural chrome" ratchet allowlist reaches zero.

## Phase 4 — modules resolve by signature; acquisition becomes the pinned bootstrap bee (~5,900 LOC)

Two halves of the same move: retire name-addressed module loading, and make
the installer itself signed content.

**Retire the import map.** The map exists only because bee bundles import
dependencies by alias (`// @scope/name` first-line comments). The build
already knows each bee's dependency closure *and* the dep signatures — stamp
them into the specifiers and the ESM graph resolves itself through the sig
resolver:

- [ ] Module build emits `import … from '/<prefix>/<sig>'` instead of bare
  aliases (alias comments survive as human metadata only)
- [ ] SW resolver gains network fallback: OPFS miss → `<origin>/<sig>` fetch
  → **verify the bytes hash to the requested sig** (published-pools already
  does this for specs; the module path must too — forged bytes are dropped,
  never cached, never executed) → write back to OPFS. Install becomes
  cache-warming, not a precondition — `ensure-install` shrinks to
  sentinel/pinning
- [ ] Retire `resolve-import-map.ts` (203), `apply-import-map.ts`,
  `dependency-loader.ts` (170), the `index.html` localStorage replay, and
  the one-time `location.reload()`; `ScriptPreloader.#ensureDeps` collapses
- [ ] Pixi stops being a special `public/vendor/pixi.runtime.js` bundle —
  just another sig-addressed dependency

**The chicken-and-egg**: the installer can't be loaded from OPFS when OPFS is
empty. Resolution: **the shim knows exactly one signature.** Boot becomes:
SW control → ioc → Store → fetch the pinned bootstrap bundle (OPFS first,
network fallback when cold) → run it. That bundle is a privileged bee that
owns everything acquisition:

- [ ] Carve `ensure-install.ts` (1,103) + `sentinel-bridge.ts` (561) out of
  the web shell into one sig-addressed bootstrap bundle
- [ ] Move `layer-installer` (302), the three `layer-install-sources`,
  `install-monitor` into it
- [ ] The install prompt UI (from Phase 3) becomes this bee's surface
- [ ] Shim keeps only: SW registration/control, the pinned-sig fetch path,
  and the packed-store one-way-door gate (it must run before any Store use —
  keep it to the smallest possible check)
- [ ] Updating the bootstrap = repinning one signature (content-addressed,
  verifiable, shareable — the installer becomes forkable like everything else)

## Phase 5 — one framework-free shim

- [ ] Replace `bootstrapApplication` with a plain TS boot — by now all chrome
  is element-shaped, so Angular has nothing left to render. `router-outlet`
  collapses (hash = tile selection; no view navigates the document).
- [ ] Collapse web + dev into **one shim, two configs**: web = OPFS/domain
  delivery; dev = the dev server serving essentials dist under the same
  `/<sig>` contract with watch-rebuild (no Vite in the load path — the
  direct `side-effects` import survives only as long as the dev shell does).
- [ ] The shell-surfaces host itself sheds Angular (its registry is already
  type-only on `Type<unknown>`): a ~150-LOC custom-element reconciler in the
  shim, keyed by name, order-sorted, survivors never recreated.
- [ ] Retire `@hypercomb/shared` — nothing imports it; the path alias goes.
- [ ] **Stretch:** split `store.ts` (2,011) into a kernel read side
  (read-by-sig, pool addressing, sigbag max-marker resolution) and a
  behavior-side write/history half delivered as a module — could roughly
  halve the shim.

---

## Hard knots (the honest list)

1. **Panels are rewrites.** 50,000 LOC of Angular components → custom
   elements. The docked-panel primitive set gates all of it; budget that
   first, and expect the heavy band (notes-strip, chat-window,
   aggregate-index) to each take a full campaign.
2. **Bound chrome needs its events.** Phase 3 cannot start on a surface until
   its signal bindings have event-shaped equivalents. Most already exist;
   audit per surface, don't assume.
3. **Store in the shim.** The shim can't pulse without read-by-sig, so Store
   (or its read half) stays shim-side forever. The Phase 5 split is the only
   way to shrink it — and write-path behaviors (commitLayer, history) must
   never sneak back into the shim.
4. **Roster darkness.** Every surface that becomes module-delivered gains an
   off-switch. Cohort-seed every migration ON, and verify the takeover /
   repaint-on-close / Escape-capture triple for every migrated view.
5. **The dev loop.** hypercomb-dev's value is direct import + hot reload.
   The one-shim collapse must preserve that (config flag, not a separate
   shell) or the iteration speed regresses.
6. **i18n catalog split.** 14 locale catalogs drift silently already;
   splitting them per-module multiplies the surfaces. The split must come
   with a drift check.
7. **The alias was an upgrade seam.** Today, swapping dependency bytes under
   the same alias upgrades every bee at once. Sig-stamped imports make a dep
   upgrade a merkle cascade — new dep sig → rebuild dependents → new bee
   sigs. That is the signature doctrine applied consistently (dedup,
   integrity, forkability), but it moves upgrade cost to build time; the
   manifest/pinning story has to carry it.
8. **Sig-URL imports need a resolver controlling the page.** The SW must be
   in control before the first bee import (native gets this from the
   `hive://` scheme; a real server gets it for free). First-visit-before-SW
   is the one boot ordering that still needs the same care `ensureSwControl`
   gets today — and it is why the pinned bootstrap fetch, not the module
   graph, is the first thing the shim does. On web, the first visit also
   trusts the origin for the shim bytes themselves (`index.html`, the
   worker) — keep that artifact tiny, stable, and rarely changing, because
   SW updates are the one code channel left to watch.
9. **Permanence is irreversible.** "Once known, permanently public" means
   exactly that: a signature that circulates can never be retracted, and
   dedup guarantees the bytes are recognizable everywhere. Anything
   accidentally published — a secret in a bundle, personal data in a
   resource — is public forever. The publish path needs the scrutiny the
   server no longer does.

## Bookkeeping (every chip, every time)

- The chip's mirror pass runs in the same pass, or its entry lands in the
  mirror queue — run or queued, never neither.
- The chip's ratchet line (IoC census, barrel entry, structural allowlist) is
  removed in the same commit, so the ratchet clicks tight behind it.
- New pool meanings minted along the way carry a colon and register through
  `Store.poolSignature` / `registerPoolMeaning` — never a local list.

## Fact base

Inventory sweep, 2026-08-25 (counts are approximate and will drift — the
scoreboard numbers above are the living measure): core 55 files / 3,493 LOC;
essentials 608 files / 62,230 LOC / 225 dist entries / 195 bee classes;
shared/core 91 files / 15,615 LOC (84 Angular-free); shared/ui 229 files /
71,589 LOC (58 components, 42 barrel-registered); web 3,734 LOC; dev 937 LOC.
Essentials → shared compile-time imports: zero. Shared/ui → essentials IoC
consumption: 58 distinct keys (shared is already a *client* of the modules,
not a layer beneath them).
