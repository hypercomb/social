# Mobile Usable-First — Recovery & Upgrade Plan

**Status: PLAN — written 2026-07-28 from a 7-dimension code audit (gate, typing, swarm-join,
touch, boot/PWA, prior plan, stranded branches). Supersedes the viewer-first POSTURE of
`mobile-experience-plan.md` where the two conflict; that doc's machinery (mode service,
pheromones, empty prompts, bottom sheets, mobile bar) is all reused here.**

The complaint this answers: *"you can't even see a hive or join a swarm or type anything
in on mobile."* The audit's verdict: mobile is broken by a mix of **decisions working as
designed** and **real bugs**, roughly half and half. The viewer-first plan explicitly
ruled "Viewers type nothing" (§9 disposition, line 668) and shipped an opt-in visibility
gate with no fallback — so two of the three complaints are the shipped spec, not defects.
The third leg is genuine iOS/boot breakage. This plan pivots the posture (mobile is a
**participant surface**, not a brochure) and fixes the breakage. 

---

## 1. Root-cause map (audited, file:line evidence)

### "Can't see a hive" — five stacked causes

| # | Cause | Evidence | Kind |
|---|-------|----------|------|
| S1 | The mobile gate is strictly opt-in with NO fallback: in mobile mode every cell without `mobile:friendly` (or a marked descendant) is union-deleted before fetch. Zero marks ⇒ zero tiles, on every phone, own hive or visited. | `show-cell.drone.ts:3279-3295`; `mobile-pheromones.ts:13-19` | Design |
| S2 | No auto-deposit at authoring exists (doc claims it; code has only `/mobile sweep`\|`hive` + the empty-prompt button, which marks link/image tiles only — a text hive stays at zero even after sweep). | grep: only `mobile.queen.ts:213,264` deposit; `:151-165` link/imageSig filter | Gap |
| S3 | In a swarm the gate deletes ALL peer tiles: `mobile:friendly` is a tag DECORATION riding the layer's `decorations` slot, and decoration content never travels in the swarm visuals payload — the phone can never see a peer mark. Not a one-line fix; a protocol change. | `show-cell.drone.ts:3279-3296, 4206-4218`; `swarm.drone.ts:2369-2379` (visuals inline 0000-props only) | Design+Gap |
| S4 | iOS 15.2–18.3: all 57 OPFS writes use `createWritable` (Safari 18.4+, zero feature detection, zero worker fallback) while `getDirectory` exists ⇒ install writes throw, receipt-verify never advances, welcome-card **Start loop forever**. | `ensure-install.ts:827-832, 756-793, 106-137`; grep: 57 sites, 0 guards | Bug |
| S5 | iOS GPU kill: Pixi inits at `resolution: devicePixelRatio` (3 on iPhone) with antialias on a full-viewport canvas ⇒ WKWebView "A problem repeatedly occurred". Dylan's DPR-1.5 + 30fps + ticker-pause fix (8a018a1c) is STRANDED on `origin/playground-dylan`. | `pixi-host.worker.ts:192-204` (uncapped on development) | Bug |

Adjacent defect: on a gated-to-zero page BOTH empty cards stack (collection-empty-prompt
has no gate awareness, same `render:cell-count {0, settled}` signal, same
`fixed inset:0 z-index:1200`) — "No tiles yet" lies on top of "Nothing marked for mobile
yet" (`collection-empty-prompt.drone.ts:56,108-131,175-176`).

### "Can't join a swarm" — the front door works; everything after it is broken

- WORKS: mobile bar mesh button → join modal (`controls-bar.component.ts:1865-1875`),
  phone bottom sheet with 16px inputs (`mesh-modal.component.scss:325-366`), fully
  headless join chain with compiled-in live relay, and the `/​<sig>` meeting-invite deep
  link end-to-end (`invite-capture.ts`, `meeting-invite.worker.ts`).
- BROKEN after join: S3 blanks every peer tile ⇒ "inside" the swarm staring at an empty
  canvas. Membership never survives a relaunch (`hc:mesh-public` force-written `false` at
  module load, `core-adapter.ts:12-17`) — routine on mobile where tab eviction is normal.
  Adopt has NO touch entry (hover-only overlay; "Make this yours" is doc-only). The
  modal's Share button mints a dead link (`parseAddress` has zero call sites,
  `address-record.ts:96-137`). Invite minting is slash-command-only. A phone participant
  can never change publish scope (WORLD stage skipped on the mobile bar; share toggles
  are hover-only). On iOS the keyboard likely covers the bottom-sheet inputs — the only
  avoidance mechanism is the Android-only `interactive-widget=resizes-content` meta;
  zero `visualViewport` usage exists anywhere.

### "Can't type anything in" — excluded by decision, then buried by bugs

- The command line lives in the header bar, `display:none` ≤599px wide and ≤449px tall
  (`_header-bar.scss:265-309`). The mobile bar's five buttons (back / mic / fit /
  pheromones / mesh) include NO keyboard button; `toggleInput()` exists on controls-bar
  and is referenced by **no template** — dead code (`controls-bar.component.ts:272-276`).
- The only reveals: an undiscoverable 500ms long-press on an EMPTY hex; the mic button
  (rendered only when SpeechRecognition exists — absent on Firefox/WebViews); the
  empty-collection prompt.
- The tile editor is already phone-ready (fullscreen ≤599px, 16px fields,
  `tile-editor.component.scss:661-673`) but unreachable by touch: its only openers are
  the hover band (hover-derived visibility, `tile-overlay.drone.ts:2796-2810`), the `e`
  key, and desktop paste. Touch-hold on a tile belongs to drag-to-move.
- The quick menu's centre "command" slot is a dead end: `command:focus` never emits
  `mobile:input-visible`, so it focuses an input inside a `display:none` header
  (`quick-menu-registry.service.ts:57`; `command-line.component.ts:1351-1357`).
- Three un-arbitrated hold timers race on one still touch: 300ms drag-move, 380ms quick
  menu, 500ms input reveal — neither TouchMoveInput nor EmptyLongPressInput claims the
  InputGate, so multiple fire together.

### Cross-cutting

- Four divergent "phone" predicates coexist (599w/449h with coarse; 599w/599h; width-only
  mixin; 599w/449h without coarse) — typing, gate, and join surfaces disagree about the
  same device.
- No `navigator.storage.persist()`/`estimate()` anywhere ⇒ OPFS **user data** and the
  auto-minted nostr identity are exposed to Safari's 7-day ITP eviction and Android
  best-effort eviction. The quota cap was already hit once (cccfed8d).
- PWA is installable-but-online-only: the SW is an OPFS module server, not an app-shell
  cache; fonts + ALL Material icon glyphs load from Google CDN at runtime; icons are
  SVG-only (iOS home screen degraded); `staticwebapp.config.json` navigationFallback has
  no `/opfs/*` exclude, so an uncontrolled page's dep imports can 404-to-HTML.
- Selection is impossible on touch (`selection-input.drone.ts:177` hard-returns for
  touch), and touch pointerdown on a branch tile navigates INSTANTLY before pan
  classification (`tile-overlay.drone.ts:2067-2186`) — panning from atop a branch tile
  enters it. The deferred-entry pattern from abf7a9f2 is the model fix.

---

## 2. The pivot — three decisions (recommended defaults; veto anytime)

**D1 — SETTLED STRONGER, and BUILT (Jaime, 2026-07-28): TILES ARE UNIVERSAL.**
"Tiles don't need to be marked for web — those are universal… or marked for mobile.
Tiles are resources to create stuff. You just don't pass the behaviors — or the
non-mobile behaviors. The beehaviors would have to be marked as mobile or mobile and
desktop." Content is NEVER filtered by platform; the tile-level gate is not a lens, it
is GONE (union-delete, corridor scan, `mobile:mode`/`mobile:gate` plumbing removed from
show-cell.drone.ts — doctrine 10/10). Platform capability lives on **behaviors**: a
bee/view declares `platform:mobile`, `platform:desktop`, or both via the registry pheromones
(visual-bee-registry `pheromones`/`withPheromone`), and the shell activates only what
the platform supports. `mobile:friendly` tile marks remain harmless curation data
(`/mobile sweep|hive`, roots pool) for future gallery/lens features that must never
gate rendering. This dissolves S1, S2, and S3-for-visibility outright. Root cause of
"a new tile doesn't get created" was this gate: the tile committed, the gate deleted it
from render (verified live: gate payload total:1/shown:0 → after removal the swallowed
tile reappeared alongside the new one). The mobile-empty-prompt drone is now dormant
(nothing emits `mobile:gate`) — remove it in the Phase 1 cleanup pass.

**Capability ratchet (2026-07-29): BUILT.** `VisualBeeRegistry.register()` now
rejects a behaviour that declares neither platform capability, and
`forPlatform('mobile'|'desktop')` resolves the effective set after participant
overrides. Existing views are explicit: home, slides, website, and lightbox
declare both; tutor, tree, and workflow declare desktop until their touch affordances are ready.
Platform support is therefore a decision every new behaviour makes at birth.

**D2 — Typing is first-class on mobile. PARTIALLY BUILT (2026-07-28).** The "Viewers
type nothing" verdict (§9 line 668 of the old plan) is revoked. Landed and verified
(both orientations, dev-main-4253): PORTRAIT PINS THE COMMAND LINE permanently as the
top prompt surface (no reveal dance); LANDSCAPE docks the button column on the LEFT
edge — top→bottom pheromones · mesh · fit (fixed centre) · mic · keyboard · BACK
(bottom-left thumb corner, arrow facing the edge it exits through) — with a new
keyboard toggle that reveals the command line with focus so the native keyboard rises;
the mic is a pure voice control (tap toggles listening, hold is push-to-talk, 450ms
boundary) that can never hide the bar — hiding on mic release + visibility re-syncs on
soft-keyboard viewport blips were the "command line flashes and disappears" bug; GO
submits and collapses only in landscape; syncs never steal focus (`focus:false` on the
effect) and never collapse a focused input; the quick-menu centre slot now opens the
bar before focusing; `controls.keyboard` in all 14 catalogs. **Per-tile actions reachable on touch — BUILT 2026-07-28 as a FULLSCREEN TILE
VIEW, not the tap-reveal band originally planned** (Jaime: "would it be a good
idea to have the first half open it up to full screen?" — yes, and better: the
hover band's icons are cursor-scale, a fullscreen surface gives real thumb
targets, the tile's picture, its name and its notes). `tile-view.drone.ts`
mounts a `position:fixed` host with an action row (make-this-yours / edit /
share), takes an owner-counted turn in `view:active`, and holds NO ViewMode
mode — deliberately, so no hand-kept TRANSIENT_MODES edit can strand a boot and
a finishing adopt cannot tear the view down mid-action. Exits: button, backdrop,
Escape, right-click, and the BACK button (the one a phone reaches for first and
no other takeover answers). Wired at the leaf terminus in `tile-overlay.drone.ts`
— which now consults the takeover rank FIRST, so a childless tile carrying a
deck or gallery opens its own view, a gap that predated this work. Mouse
behaviour is unchanged (gated on a recorded touch press or MobileMode).
Still open from the Phase 2 list: hold-timer arbitration, visualViewport
keyboard inset, and selection on touch (`SelectionInputDrone` still hard-returns
for touch, so multi-tile operations remain desktop-only). NOT device-verified: live rotation and
real iOS keyboard (the Browser pane dispatches no MediaQueryList change events under
emulated resize).

**D2b — The tutorial is reachable and speaks to a finger. BUILT 2026-07-28.**
The tour's only starter button sits on the desktop left rail, doubly gated off
phones — so `/tutorial` was the sole way in, i.e. you had to already know how to
type to learn how to type. The empty HIVE ROOT (previously skipped in favour of
"the onboarding path", which was never built) is now that path:
`collection-empty-prompt.drone.ts` gained a root variant — what a tile is, plus
*Add a tile* / *Show me how*. Narration adapts through the tutorial's single
`#t` funnel, which prefers a `<key>.touch` variant when MobileMode is active:
"left-click it" → "tap it", "Shift+click to come back out" → the Back button,
"hold the Space bar and drag" → one finger. Zero lessons edited. Starter-course
wordings shipped (en+ja); the beginner course's keyboard lessons (Ctrl+C,
Delete, Ctrl+Z) keep their desktop wording because those gestures genuinely have
no touch equivalent yet — they should be gated by `requires()` rather than
reworded, which is not yet done.

**D2c — SELECTION IS THE SUBSTRATE; verbs act on it. BUILT 2026-07-28.**
The elegant answer to "select tiles in a swarm, then adopt" is not a bespoke
adopt gesture — it is giving touch the selection it never had, and letting
every verb read it. A pointer says "pick this too" by holding ctrl; a finger
has no modifiers, so sampling mode says it with an explicit `toggle` intent on
`tile:click` (without it a plain tap REPLACES the set — the reason picks could
never accumulate). Picks land in the ordinary `SelectionService`, so they ring
with the selection visuals that already exist and every selection-reading verb
sees the same set:

- **Keep** (`sample-swarm.drone.ts`) — a pill that appears only where there are
  peer tiles, so it costs no permanent chrome. Arm, tap what you want, keep it.
  Routes to the existing `adopt-selected`; a name offered by two publishers
  hands off to the disambiguation panel, which is the surface built to ask.
- **Mark** (`tags-viewer.onRowClick` → `applyToSelection`) — with tiles picked,
  tapping a pheromone puts it on all of them, in one transaction. Drag-to-paint
  stays off: on touch a drag IS the scroll gesture, and select-then-tap
  sidesteps that conflict instead of reopening it.
- **After adopt, features** — a bulk adopt used to re-target the Beehaviors
  panel once per tile and wipe the one before it; it now folds silently and
  lands once. The panel itself was a ~351px right-docked slab on a 375px phone
  (94% of the screen, the hive squeezed into the strip beside it); it is now a
  bottom sheet with real toggle rows.

Not built: picking ACROSS pages. Navigation clears the selection by design, and
peer tiles are branches, so a multi-level pick needs its own staged set (the
pheromone brush's `#staged` is the precedent).

**D3 — iOS is a supported floor, verified on device.** Minimum: iOS Safari 16.4+ boots
to a visible hive; 15.2–18.3 gets an HONEST unsupported/degraded card, never a silent
Start loop. A real-device pass (iOS Safari + Android Chrome, against production) opens
every phase's acceptance.

---

## 3. Phases

Ordering: SEE → TYPE → JOIN → DURABLE. Each phase lands with its **mirror pass in the
hive** (tiles for the parts, a collection, pheromones from the declared vocabulary,
notes) in the same PR — per the mirror doctrine, not after the fact.

### Phase 0 — Ground truth (half a day, before any code)

1. Device matrix vs production: iOS Safari (note the exact version) + Android Chrome.
   One screenshot disambiguates four root causes — welcome-card Start loop = S4;
   "Nothing marked for mobile yet" card = S1; black canvas/repeated-crash = S5; tiles
   exist but off-frustum = fit/camera.
2. Confirm when production hypercomb-web was last deployed relative to the gate commit
   038aebd2 (2026-07-24) — decides whether the gate is even live for real users yet.
3. Salvage read: Dylan's `postmortem-ios-install-drift.md` (stranded on
   `origin/playground-dylan`, f3f22e0b) → copy into `src/documentation/`.

### Phase 1 — SEE: every hive visible on every phone

1. **Gate inversion (D1)** in `show-cell.drone.ts`: compute marks as today; if the
   surviving set is empty ⇒ skip deletion entirely (render ungated). Keep corridor logic
   for the curated case. `/mobile on|off|auto` untouched. The mobile-empty-prompt's
   trigger condition inverts with it (it becomes the CURATED-page affordance, not the
   default screen). De-stack the two empty cards: collection-empty-prompt must consult
   the gate outcome before claiming "No tiles yet".
2. **iOS survival kit** (re-implemented under current doctrine — never merged from the
   246–440-commits-behind branches):
   - DPR cap 1.5 + `antialias:false` + `maxFPS 30` + visibilitychange ticker pause in
     `pixi-host.worker.ts`, mobile-conditioned (port of Dylan 8a018a1c, ~7 lines).
   - `createWritable` feature-detect at boot; unsupported ⇒ honest capability card
     (reuse the existing storageBlocked card path, `app.ts:45-51`) instead of the Start
     loop. Full write-path fallback (worker + `createSyncAccessHandle`) is a stretch
     goal, not a blocker — detection alone ends the deceptive loop.
   - `navigator.storage.persist()` at boot + `estimate()` telemetry surfaced in the
     existing pill/indicator conventions. Protects user OPFS **and** the nostr identity
     from ITP eviction.
   - Real-iOS first-boot import-map verification (Dylan's postmortem says the runtime-
     injected map is a no-op on iOS; development's `hc:importmap` replay, 83b28a34,
     covers warm boots — the COLD first visit is the open question).
3. **One mobile predicate.** `MobileModeService` is the single source of truth
   (pointer:coarse + 599w/449h); controls-bar, empty-long-press, collection-empty-prompt,
   confirm-dialog, mesh-modal all consume it (service in TS, one shared mixin in SCSS).
   Kills the landscape-phone and 500-599px inconsistencies.
4. **Fit at 375px**: verify first render frames tiles on a phone viewport (fit
   regressions are a repeat offender; none re-verified at phone dims).

Acceptance: a fresh phone (Android Chrome; iOS Safari ≥16.4) opens the production URL and
sees the hive's tiles with no marking prerequisite. A visited/public unmarked hive is
fully visible. iOS <18.4 shows the honest card, never the loop. Desktop unchanged.

### Phase 2 — TYPE: the keyboard is a first-class citizen

1. **Keyboard button on the mobile bar** — wire the dead `toggleInput()` as a sixth
   slot (or replace fit's inert-spacer case). Tap ⇒ `mobile:input-visible` emitted
   INSIDE the user gesture, focus synchronously after the class lands (iOS requires
   gesture-context focus for the soft keyboard).
2. **Fix the quick-menu centre slot**: `command:focus` handler emits
   `mobile:input-visible` when mobile mode is active.
3. **Keyboard avoidance**: one `visualViewport` listener in the shell publishing a
   `--hc-keyboard-inset` CSS var; bottom bar, sheets (mesh modal, pheromone sheet,
   editor) and the revealed command line consume it. Android keeps
   `interactive-widget=resizes-content`; iOS finally gets parity.
4. **Editor reachable by touch**: tap on a tile = select + reveal the action band
   (tap-reveal replaces hover-reveal on touch; second tap on a band icon acts). This
   also un-deadends selection (drop the `pointerType==='touch'` hard-return) and gives
   childless non-link tiles an inspect path.
5. **One hold arbiter**: 300/380/500ms timers claim through InputGate; exactly one owner
   fires per hold (move on occupied, quick menu as the deliberate long-hold, input
   reveal only on empty). Deferred tile entry on touch (pointerup after pan
   classification, mirroring abf7a9f2) fixes pan-from-branch-tile navigation.
6. Small parities: GO button in the landscape reveal; mic remains the voice path where
   supported (it is a full command path already).

Acceptance: phone-only — reveal the command line from the bar, soft keyboard rises above
the input on iOS and Android, create a tile by typing, open an existing tile's editor by
touch, edit its text, save. Tutorial startable without typing `/tutorial` (circularity
fixed by the bar button).

### Phase 3 — JOIN: the swarm round-trip

1. Peer visibility arrives free with D1 (gate no longer deletes peer tiles). The
   decoration-on-the-wire protocol (peer curation marks) is explicitly DEFERRED.
2. **Membership survives relaunch**: keep boot-private doctrine, add a one-tap "Rejoin
   <room>?" prompt from the persisted RoomStore/SecretStore on next launch (two stores
   already prefill the modal — this is a toast + one tap, not new state).
3. **Share/invite from a phone**: mint the meeting-place invite (the ONE proven deep
   link) from a button in the mesh modal, replacing the dead `copyShareLink`
   (`parseAddress` consumer path: either wire it at boot or delete the dead code —
   prefer delete, the invite bundle already does this job). `navigator.share` where
   available.
4. **Adopt on touch**: "Make this yours" on the tap-revealed band (Phase 2.4 gives the
   surface) for the content-only single-publisher case — already headless underneath.
   Consent-sheet installer for declared code stays Phase-2-of-old-plan scope, unchanged.
5. **Publish scope on touch**: per-tile public/private toggle rides the same tap-revealed
   band (per-tile-public dim=PREP convention); the mobile bar's mesh button gains the
   WORLD stage in its cycle instead of skipping it.
6. Confirm-dialog phone query widened to the shared predicate (today width-only — a
   landscape-phone invitee gets the desktop modal).

Acceptance (phone-only, two devices): receive an invite link cold → confirm sheet →
inside the swarm → peer tiles VISIBLE → adopt one tile → toggle one own tile public →
the other phone sees it. Relaunch → one tap → back in the room.

### Phase 4 — DURABLE: instant and offline

1. App-shell service worker (precache index/bundles/fonts) alongside the OPFS module
   server; offline home-screen launch into your own hive.
2. Self-host fonts + Material icon glyphs (today every icon is a network fetch with
   `display=block` — invisible until the CDN answers).
3. PNG icon set (192/512 + apple-touch-icon) for real home-screen presence.
4. `/opfs/*` navigationFallback exclude in `staticwebapp.config.json`.
5. Perf budget on real data on a real phone: corridor-scan cost when curated mode is
   active (the walk store-fetches every decoration in the subtree on the render path —
   bound or memoize), sequential-vs-parallel bee loading, camera memory.
6. Storage pressure: QuotaExceeded surfaced honestly (today swallowed by generic
   catches), estimate() in the indicator.

Acceptance: airplane-mode launch from home screen shows your hive; icons/fonts render
offline; Lighthouse PWA installable; a 7-day-idle Safari revisit still has identity and
content (persist() granted).

---

## 4. Stranded-branch salvage register (decide once, here)

| Item | Branch/commit | Verdict |
|------|--------------|---------|
| DPR cap + 30fps + ticker pause | playground-dylan 8a018a1c | **Port by re-implementation** (Phase 1.2) |
| iOS install postmortem doc | playground-dylan f3f22e0b | **Copy into documentation/** (Phase 0.3) |
| MAX_PHOTO_PX 1024 WebP cap | dylan/mobile cccfed8d | **Port** with Phase 4.5 camera work |
| Pulse race guard (worker.base re-check `#acted`) | dylan/mobile ac551a6d | Evaluate separately — core-wide, not mobile-specific |
| Auto-resync-on-drift + reload | 64e3fd2e | **Discard** — contradicts push-only notify-and-accept (`update:available`) |
| OPFS write worker w/ `__dependencies__` URLs | 6a0cbe47 | **Discard as-is** — typed-folder literals are ratchet-forbidden; the createWritable-fallback IDEA returns doctrine-clean if Phase 1.2 stretch goal is taken |
| `<hc-camera-capture>` app.html mount | ec5f741a | **Discard as-is** — shell-surface ratchet forbids template mounts; in-editor camera already exists on development; re-register via `registerShellSurface()` only if a standalone flow is ever wanted |
| Touch-on-input focus guard | f3f22e0b | Superseded by a61e6c32 on development |

Branches are 246–440 commits behind: cherry-pick nothing; re-implement under current
doctrine. After salvage, propose archiving the branches so they stop rotting ambiguously.

## 5. What survives from the viewer-first plan

The machinery: MobileModeService, `/mobile` queen, the two mobile:* pheromones +
declared-never-seeded registry pheromones, mobile-roots pool, empty prompts (retargeted),
the portrait/landscape bar, bottom-sheet pattern, reduced-motion doctrine, the
disposition-audit discipline (§9 table — now re-verdicted with D2), the §8 adoption
design (unchanged, feeds Phase 3.4), and the non-destructive verification playbook.
What dies: the opt-in-blackout default, "viewers type nothing", and the display-only
mesh glyph framing.

## 6. Guardrails (binding)

- OPFS user data is never wiped to test anything — signature comparison only.
- No new `__x__` dirs, no bare-word pool meanings, no allowlist extensions, no `<hc-*>`
  in app.html — the ratchets stay tight.
- Every phase's surfaces get i18n keys (en+ja) at land time, per the existing
  `mobile.empty.*` precedent.
- Resting styles describe final state; animations additive; reduced-motion guarded.
- Web/dev shell parity for every viewport-meta or template-adjacent change.
- Mirror pass ships in the same PR as the behaviour, every phase.
