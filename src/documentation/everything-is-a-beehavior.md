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

**The live gate**: `node scripts/drive-shrink-phase1.cjs --url
http://localhost:4350` (the worktree's dev server) — proves every moved key
registers, every value-announce replays, the loopback secret seed and
note-marks pool seed work from module land, and the console stays clean.
Extend its MOVED_KEYS / ANNOUNCED lists with every chip.

> **RESTART THE DEV SERVER AFTER AN ESSENTIALS EDIT, OR THE GATE LIES.**
> The dev watcher does not pick up essentials changes (the standing
> `dev-watcher-misses-essentials` trap). A gate run against a stale bundle
> reports PASS for code that is not running — which is worse than a failure,
> because it launders an untested change as verified. This bit the second
> conversion batch: two fixes were live in source, absent from the browser,
> and the only reason it surfaced was a check that could distinguish old
> behaviour from new. **Every check you add should be able to fail** — if a
> check would pass against the pre-change build, it is not proving the
> change. Kill the server (`netstat -ano | grep :4350`, `taskkill //PID <p>
> //F`) and restart before trusting a run.

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

- [x] Leaf stores — ALL DOWN: ~~`icon-overrides.store`~~, ~~`room-store`~~,
  ~~`secret-store`~~ (took the loopback dev-secret seed with it — boot path
  shrank), ~~`secret-strength`~~, ~~`saved-locations-store`~~ (mesh quartet
  → `sharing/`, announced on EffectBus: `mesh:room-changed` /
  `mesh:secret-changed` / `mesh:saved-locations-changed`),
  ~~`note-marks.store`~~ (→ `notes/`, announces `notes:marks-changed`),
  ~~`icon-pick`~~ (pure EffectBus sugar over core's own contract — went to
  CORE, so modules share the helper), ~~`recent-portals.store`~~ (→
  `presentation/tiles/` beside its walk-signal emitter; rev-trigger via the
  existing `portals:recent-changed`). One deliberate exception:
  `pinned-entrances.store` goes with Phase 2 (never IoC-registered, one
  component consumer — store + component move together as a custom element).
- [x] Registries — ALL ACCOUNTED FOR: ~~`bouquet-registry`~~ ✓, ~~`name-registry`~~ ✓,
  ~~`tag-registry`~~ ✓ (all three → `commands/`, ride slash-behaviour.drone;
  tag-registry now warms ITSELF on module load — the shell's ngAfterViewInit
  warm call is gone, and `tags:registry` replay fills the intellisense),
  ~~`group-registry` + sources + `mixed-group-bag` + `aggregation-layer` +
  `websites-pool`~~ ✓ (the whole launch-group cluster → `groups/` as ONE
  pass, ten files; contracts in core group-launcher.types.ts; registry
  announces `groups:changed`, aggregation layer registers as
  `@hypercomb.social/AggregationLayer`); ~~`tile-icon-provider-registry`~~ ✓
  — went to CORE (providers add() at construction with plain lookups, so it
  must precede every bee in every order: a kernel primitive beside
  pool-registry). Both shell boot anchors deleted; `ioc.web` re-asserts
  kernel registries right after installing the map (core can evaluate before
  the map exists — the llm-provider-registry lesson, now handled at the
  kernel seam). `proximity-registry` RE-SCOPED: import-wired
  into runtime-initializer's warm handler and never IoC-registered — it
  moves with the boot machinery (Phase 4), not as census debt.
- [x] Services — ALL DOWN: ~~`theme.service`~~ ✓ (→ `preferences/`),
  ~~`view-mode.service`~~ ✓ (→ `commands/` beside the visual-bee registry;
  `isTransientMode` became a PROVIDER METHOD so no shell carries the
  transient set — both shells now ask the instance), ~~`trust-service`~~ ✓
  (→ `sharing/`), ~~`completion-utility`~~ ✓ (pure normalize — went to CORE,
  kernel-seam re-assert), ~~`resource-completion.service`~~ ✓ (→
  `commands/`); ~~`movement.service`~~ ✓ (→ `navigation/`, announces
  `movement:changed`), ~~`voice-input.service`~~ ✓ (→ `commands/`; the
  static `supported()` became core's pure `voiceInputSupported()`),
  ~~`cell-suggestion.provider`~~ ✓ + ~~`suggestion-provider`~~ ✓ (contract
  → core `suggestion.types.ts`; provider → `commands/`, announces
  `cells:suggestions-changed`), ~~`icon-edit.service`~~ ✓ (→ CORE —
  completes the icon-protocol family), ~~`usage-tracker`~~ ✓ (→
  `presentation/tiles/` beside its ranker consumer).
- [x] `navigation.ts` — went to CORE (imports only core, extends the
  processor class, and boot-side lineage reads it lazily during first paint:
  it must precede everything, which is the kernel's definition). Fourth
  kernel-seam re-assert; the NAVIGATION DI token retired uninjected.
- [x] Heavyweights: ~~`lineage.ts`~~ ✓ — went to CORE with `home-root` (the
  current location IS the platform's address state; boot machinery reads it
  at first paint; navigation, its sibling, was already there). Fifth
  kernel-seam re-assert; browser wiring guarded for node contexts; the
  Navigation lookup keeps its IoC seam (specs mock through it) with the core
  singleton as fallback. ~~`aggregation-layer`~~ ✓ and ~~`mixed-group-bag`~~
  ✓ went with the group cluster above.
- [x] i18n: `i18n.service` → CORE (the I18nProvider contract always lived
  there; every surface needs t() from first paint — sixth kernel-seam
  re-assert; constructor guarded for partial-window node stubs). The
  CATALOG SPLIT is re-scoped onto Phase 2 by design: each panel converted
  to a custom element carries its own keys via `registerTranslations`
  (strings move with their surfaces), with the drift check attached to that
  process. PHASE 1 COMPLETE.
- [x] Delete the Angular DI bridge: `tokens.ts` + `shared-providers.ts` are
  GONE — an inject() census proved no shared service was ever
  Angular-injected (only framework types: ElementRef, ChangeDetectorRef…),
  so the whole bridge was vestigial and both shells dropped
  `...sharedProviders`. `from-runtime.ts` and `i18n.pipe`/`i18n.signal`
  survive — they are real Angular adapters (EventTarget→signal, the `| t`
  pipe), and they retire with their components in Phase 2/the i18n split.

## Phase 2 — the 42 registry-fed panels become `element:` drones (~50,000 LOC)

These are rewrites, not moves — every panel is a standalone Angular component.
But each is independent: delete its barrel line, register a custom element
from essentials in the same order band, done. The working proof is
`hypercomb-essentials/src/diamondcoreprocessor.com/tutorial/tutorial-overlay.view.ts`
(672 LOC, zero Angular, registry `element:` shape), and 47 essentials files
already build imperative DOM — the muscle exists.

- [x] **Gate first: framework-free panel primitives.** `docked-panel` (2,324),
  `pinnable`, `dock-inset`, `hint-bar`, `icon`, `widget-zoom` are Angular
  components every panel leans on. Build custom-element equivalents that
  preserve the docked-panel contracts (sole writer of `--hc-panel-scale`,
  the width + text-size ladder, the reading face, controls-bar anchoring).
  Primitive status: ~~`docked-panel`~~ ✓ (DockedPanelElement, step B),
  ~~`dock-inset`~~ ✓ (folded into that base — a converted panel needs one
  class), ~~`widget-zoom`~~ ✓ (was never Angular-shaped: ~30 lines that tag
  an element, read a persisted scale and follow one effect. Now
  `attachWidgetZoom(el, id, anchor)` in core/panels; the Angular directive
  is the thin adapter over it, so both kits zoom through the SAME code and
  the same persisted scale for the whole transition), ~~`hint-bar`~~ ✓ (now a
  framework-free custom element embedded by command-line). ~~`pinnable`~~ and
  ~~`icon`~~ retired after reachability proved their final consumers had
  already moved or disappeared. Gate complete. Findings so far: the
  panel SUPPORT MODEL (panel-groups, panel-settings, dock-lanes,
  window-session/rule) is already pure TS — it moves to core so the Angular
  directive and the new element share ONE model during the transition (the
  sole-writer rule survives); only the 1,318-line directive is Angular, and
  it already builds its DOM imperatively.
  **NO RECONCILER IN THE KIT** (settled 2026-08-26): a generic
  keyed-reconcile helper would be the first brick of a framework — outside
  the architecture. The house answers instead: rebuild-on-change (state
  lives in services, never DOM, so rebuilding is safe — the shipping
  `.view.ts` pattern); explicit `focusSnapshot`/`restoreFocus` for what
  must survive a rebuild (precedent already in panel-settings); and for
  genuinely live rows, a per-panel `Map<key, element>` re-appended in data
  order — `appendChild` MOVES an existing node, so the platform is the
  reconciler. `shell-surfaces` keeps its own keyed host because its
  invariant (live panels never recreated) is unique — special case, never
  generalized. A panel that "needs" more than this is rendering too much
  in DOM and should draw from state like the hive does.
- [x] Prove the pattern on the small ones — ALL FIVE OUT:
  ~~`sequence-viewer`~~ (the first, on DockedPanelElement; its 7 keys the
  catalog split's first slice), ~~`website-nav`~~ (→ `commands/`; headless —
  the capture-phase Escape that always leaves website mode),
  ~~`sensitivity-bar`~~ (→ `navigation/touch/`, beside the coordinator that
  feeds it), ~~`landing-badge`~~ (→ `presentation/tiles/`, beside the
  show-cell drone whose held repaint it releases), ~~`preview-banner`~~ (→
  `sharing/`, beside the hive-visit drone that owns the preview). The four
  non-docked ones extend `HTMLElement` directly — only a DOCKED panel needs
  `DockedPanelElement`.

**THE IMPURE-PIPE RULE — every converted panel owes this.** Angular's `t`
pipe is declared `pure: false`, so every change-detection tick re-resolved
every string: `/language ja` re-labelled OPEN panels on the spot. An element
renders when it decides to, so **a converted panel must subscribe to
`locale:changed` and re-render**, or an open panel freezes in the previous
language — including its buttons, which on the preview banner are the only
two exits. Strings written once at build time need a `#relabel()` that
re-resolves them (rows re-resolve theirs on every rebuild). Found by the
adversarial pass, and it had already slipped into the first conversion.

**`keydown.escape` IS NOT `event.key === 'Escape'`.** Angular's
KeyEventsPlugin composes a binding name from the pressed modifiers, so
`@HostListener('document:keydown.escape')` matched ONLY an unmodified press —
Ctrl-Escape produced `control.escape` and fell straight through. The obvious
port (`if (event.key !== 'Escape') return`) therefore fires on chords the
original ignored, quietly taking a shortcut away from whoever owns it. A
panel ported from that binding must guard
`event.ctrlKey || event.altKey || event.shiftKey || event.metaKey`. **Check
the ORIGINAL's spelling before adding the guard**: a component that bound a
raw `document.addEventListener('keydown', …)` never had those semantics, and
adding the guard there would itself be the regression. Of the thirteen panels
converted so far exactly one — `youtube-viewer` — used the HostListener form.

**BUILD EVERY APP IN `build:all`, NOT JUST THE TWO SHELLS.** `diamond-core-
processor` and `hypercomb-avatars` are Angular apps of their own that import
from `hypercomb-shared` — DCP mounted `<hc-trust-prompt>` and imported the
trust service; avatars imported the DI bridge. A gate that builds only core,
essentials, web and dev cannot see them, so **both were broken for three
chips before anything noticed** (the DI-bridge deletion took avatars; the
trust-service move took DCP). Nothing failed, because nothing looked. The
per-chip build list is now core → essentials → web → dev → **dcp → avatars →
meadowverse**.

**`customElements.define` GOES AT MODULE SCOPE; only `registry.add` waits.**
DCP has no ShellSurfaceRegistry at all — it mounts the tag directly in its
own template. An element whose `define` sits inside
`whenReady('ShellSurfaceRegistry')` is never defined in such a host, so the
tag stays an inert unknown element and the surface silently does nothing.
Define at module scope (guarded by `customElements.get`), add to the registry
when one appears. Applied to all nine converted views.

**ONE CATALOG PER SURFACE.** Three ports in this batch inlined their own copy
of the locale table while the extracted `.i18n.ts` sibling — the one the
drift spec guards — sat unused beside them. Byte-identical today, so nothing
looked wrong; but a spec guarding a file nobody imports passes forever while
the real strings drift. The view must import the sibling. And when a split
lifts a key out of the shell catalogs, the surface MUST register the
replacement: the confirm dialog's two default labels were extracted and never
re-registered, which would have un-translated both buttons in all 14 locales.

**AN EFFECT THAT IS A STATE ASSERTION NEEDS AN IDEMPOTENT SUBSCRIBER.**
`cell:added` / `cell:removed` are delivered at least twice for one gesture —
the gesture's eager emit, then the commit's post-commit reconcile
re-announcing the same difference. Twenty-six of twenty-eight subscribers
absorb the repeat for free because their handler is a set write or a cache
poke; the house convention is idempotence AT THE SUBSCRIBER, not filtering at
the source. The activity feed was the one subscriber that APPENDS TO A
LEDGER, which is the shape the convention does not cover, so it double-logged
every add and remove — halving a ten-entry feed to five real actions.

Two lessons, both bought expensively:

**Filtering the flag is the wrong fix, and it is the one that suggests
itself.** `fromCascade` is not noise — it is the reconcile channel, and for
write paths that eager-emit nothing at all (adopting a swarm hive, an
aggregation layer's children write, a group bag's membership) it is the ONLY
announcement there is. Filtering it trades a duplicate row for a MISSING one,
and silences the mutation ROLLBACK that tells a participant their add did not
stick. Verify a flag's meaning before filtering it: `viaUpdate` is not a
quieter `fromCascade`, it means commit OWNERSHIP.

**A wildcard that is READ but never CONSUMED poisons its key.** The first
version matched an unnamed payload against any known place but only ever
wrote back to the wildcard slot, so one segment-less `removed` left the
feed permanently deaf to that name — a second tile of the same name could
then be deleted with no row and therefore no undo. Read-without-consume is
the trap; a wildcard must be resolved onto the real address the moment
something names it.

**THE HARVEST IS NOT THE AUTHORITY — THE RECONCILIATION IS.** Keys are found
in the Angular original by pattern (`'key' | t`, `t('key')`), and a pattern
can only see a key spelled next to its use. It cannot see a key CHOSEN AT
RUNTIME: `p.public ? 'activity.mesh-public' : 'activity.mesh-private'`, or
`(kind === 'gesture' ? 'action.hover.gesture' : 'action.hover.shortcut') | t`
— four keys in one batch, invisible to every regex, and each one would have
been left in the shell catalogs while its surface walked away. So after the
ports land, **diff what each view actually passes to `t()` against what its
catalog carries, in both directions**: rendered-but-not-carried draws the raw
key, and carried-but-not-rendered is dead weight the drift spec would make
permanent. The scripts are in the session scratchpad
(`harvest-…` → `extract-…` → `reconcile-…`); the reconcile step is the one
that must pass, and it is what caught all four. Earlier the same class cost
us `viewer.watchOnYouTube` to a lowercase-only character class — a harvest
fails quietly, and only a comparison against real usage is loud.

**A key TWO surfaces render belongs in BOTH catalogs.** `shortcuts.chord-sep`
— the separator between the keys of a chord — is rendered by the shortcut
sheet and by the action card. "One catalog per surface" is not a claim that
every key has exactly one owner; it is a rule that **a surface must carry
everything it renders**, so that loading it alone is enough. Duplicating the
entry is therefore correct, and safe: `registerTranslations` merges with
`Object.assign` rather than replacing, which is also why thirteen panels can
all register under `app` without clobbering each other. The tempting
alternative — leave the shared key in the shell catalogs — is the failure
mode this campaign is trying to end: it resolves because the SHELL happens to
be loaded, not because the module carries it, and it stops resolving the day
the surface is loaded anywhere else. Each drift spec names the shared key and
says which sibling it is shared with.

**The other trap the adversarial pass caught: PRESERVE THE PREDICATE'S
POLARITY.** `visible = count > 0` is not the same as `if (count <= 0) hide`
— both are false for `NaN`, so the negated form falls THROUGH and paints
"NaN changes are waiting" where Angular showed nothing. Copy the original
condition; do not re-derive it. And where Angular used `@if`, the element
must genuinely leave the DOM (detach the node, keep the reference) — a
surface that is merely `display:none` still answers `querySelector`, which
is a DOM contract the feature's own acceptance driver may assert on.
- [x] Utility band: ~~`toast`~~, ~~`confirm-dialog`~~, ~~`trust-prompt`~~,
  ~~`action-card`~~ (→ `commands/`, beside its own drone),
  ~~`camera-capture`~~ (→ `editor/`, beside the image-drop drone — the other
  way a picture reaches a tile), ~~`format-painter`~~ (→ `editor/`, beside
  the drone whose visual properties it copies), ~~`icon-picker`~~ (→
  `presentation/tiles/`, beside the override store it writes through),
  ~~`shortcut-sheet`~~ (→ `commands/`, beside its own drone),
  ~~`activity-log`~~ (→ `history/`, the domain that owns what happened),
  ~~`layer-cycle-strip`~~, ~~`command-palette`~~,
  ~~`context-window`~~ (→ `commands/`, beside the queen that opens it — the
  first DOCKED panel of the campaign, on `DockedPanelElement`)
- [x] Viewer band: ~~`files-viewer`~~, ~~`observe-viewer`~~, ~~`notes-viewer`~~,
  ~~`youtube-viewer`~~ (→ `link/`, beside the link action that opens it),
  ~~`docs-overlay`~~, ~~`pools-of-meaning`~~ (its hover-card and `pools-icon`
  lost their last mount when the controls-bar `/sets` entrance replaced them),
  ~~`pheromone-tiles`~~ (→ `pheromones/`, beside its own drone),
  ~~`example-hives`~~, ~~`presence-banner`~~ (→ `sharing/`, beside the drone
  publishing the presence it names), ~~`contact-card`~~ (two registered
  surfaces), ~~`mesh-modal`~~, ~~`rewind-window`~~, ~~`atomizer-bar`~~ (two
  registered surfaces), ~~`workflow-designer`~~
- [x] Heavy band — one campaign each: ~~`clipboard-panel`~~ (1,103), ~~`portal`~~
  (1,047), ~~`publish-panel`~~ (1,033), ~~`tile-editor`~~ (1,719), ~~`feedback-viewer`~~
  (1,920), ~~`history-viewer`~~ (2,274), ~~`tags-viewer`~~ (2,569), ~~`features-viewer`~~
  (3,860), ~~`aggregate-index`~~ (3,942), ~~`chat-window`~~ (5,245), ~~`notes-strip`~~
  (7,672). The formerly omitted ~~`host-panel`~~ moved in the same final
  registry-fed batch. The shell-surfaces barrel is now empty: 42 → 0.
- [x] Non-barrel stragglers: ~~`file-explorer`~~ (1,137; unreachable export),
  ~~`pinned-entrances`~~ (513; now module-owned and embedded in command-line),
  ~~`file-teaser`~~ (223; never mounted, and its request bus had no producer).
  ~~`history-component`~~ (54) was unreachable orphan code — no import, route,
  template tag or barrel export — and retired rather than preserving a dead UI.

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

- [x] Small chrome: ~~`mesh-header`~~ (201), ~~`sync-indicator`~~ (377),
  ~~`upgrade-indicator`~~ (374)
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

## Running beside development (the collision course)

This campaign deletes from `hypercomb-shared/ui` while development keeps
working in it. That is survivable, but only deliberately.

**Measured 2026-08-26.** Development made **64 commits touching
`hypercomb-shared/ui` in 14 days**, and its hottest files are almost exactly
the panels this campaign has left: `chat-window` (68 file-touches),
`notes-strip` (39), `features-viewer` (32), `command-shell` (32),
`command-line` (31), `docked-panel` (29), `tags-viewer` (14),
`clipboard-panel` (13), `aggregate-index` (8). Nothing has been lost so far —
every converted panel was verified to have been ported from current bytes —
but that is because the campaign converted the QUIET panels first. The
remaining ones are the live ones, so the risk rises from here rather than
falling.

**The failure mode is silent, which is why it needs a machine.** When
development edits a panel already retired here, git reports a modify/delete
conflict, and the obvious resolution — "we deleted it, take the deletion" —
discards their fix without a trace. No test goes red. The bug they fixed
quietly returns inside our port. `scripts/check-conversion-drift.cjs` walks
it: for every retired panel directory it finds the commit that removed it and
asks whether the base branch has any commit touching that directory which the
retirement does not already contain. **Run it after every merge and before
every batch.** It is self-tested — a synthetic post-retirement commit makes it
fail and name the panel — so a CLEAN result means something.

**Merge small and merge often.** Every merge so far has been cheap because the
campaign ADDS to essentials and DELETES from shared, which rarely overlaps
development's edits in place. The recurring conflict is `mirror-queue.json`,
and it is always append/append: keep BOTH sides, unioned by id, never choose.

**Sequence against the heat, not just the size.** For a panel development is
actively working in, converting it is a race whatever the guard says — the
port can be correct at the moment it is written and stale by the time it
merges. Convert it while it is quiet, or agree a short freeze on that one
panel and land the conversion inside it. Size is why the heavy panels are hard
to convert; heat is why they are hard to convert *safely*, and the two are not
the same problem.

## Bookkeeping (every chip, every time)

- The chip's mirror pass runs in the same pass, or its entry lands in the
  mirror queue — run or queued, never neither.
- After a merge from development, `node scripts/check-conversion-drift.cjs`
  is CLEAN — no retired panel changed on the base after being retired here.
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
