# Mobile Experience — Implementation Plan

**Status: IN PROGRESS — Phase 0 + the Phase 1 load gate landed. 2026-07-24.**

> **2026-07-28 — POSTURE SUPERSEDED.** The viewer-first premises of this plan (opt-in
> visibility gate with no fallback; "viewers type nothing") are revoked by
> `mobile-usable-first-plan.md`, written from a full code audit after the gate proved to
> blank unmarked hives on every phone. The machinery this doc built (mode service,
> pheromones, prompts, bar, sheets, §8 adoption design) carries forward unchanged; read
> the new plan first. 

This document is self-contained: it names every primitive it borrows with file paths,
states the doctrine constraints inline, and phases the work with acceptance criteria.
The implementing session should read this top to bottom before touching code.

### Build log

**Verified in the dev shell (2026-07-24, port 4253):** app boots clean;
`withPheromone('mobile:friendly')` → `['slides','website']`; gate OFF → both
genesis tiles render; gate ON → only the `mobile:friendly`-marked tile renders, the
unmarked one is excluded (never loaded); marks persist to the store across reload
(cold-load reads them via the store-authoritative reach scan); unmark reflects after
a rescan (mode toggle / `mobile:marks-changed`). Doctrine ratchets pass (81/81).

Two bugs found and fixed during verification: (1) children are stored as **layer
signatures**, not names — the reach scan and sweep now resolve each sig to its name
via `getLayerBySig` before recursing (mirroring `#scanTagsAcrossPages`); (2) a
programmatic mark deposit bypasses the painter's `tags:apply` invalidation, so the
sweep now emits `mobile:marks-changed` and show-cell restales the reach scan on it.

**Landed (2026-07-24, type-clean, wired into the side-effect barrel):**
- **PWA** — `hypercomb-web/public/manifest.webmanifest` + `icon.svg` (maskable
  hexagon mark); `index.html` manifest link + `theme-color` + apple-touch metas;
  `staticwebapp.config.json` gets a `.webmanifest` MIME mapping + fallback excludes.
- **MobileModeService** — `preferences/mobile-mode.service.ts`.
  Active when `(pointer: coarse)` AND `(max-width: 599px)`, unless overridden.
  Emits `mobile:mode {active}` (EffectBus, replayed). IoC `@diamondcoreprocessor.com/MobileMode`.
- **`/mobile` queen** — `commands/mobile.queen.ts`: `on|off|auto` override + `sweep`
  (walks the current subtree, deposits `mobile:friendly` on link/image tiles,
  skips `mobile:hold`, capped at 500, idempotent). i18n `slash.mobile` (en + ja).
- **Vocabulary constants** — `preferences/mobile-pheromones.ts` (`MOBILE_FRIENDLY`,
  `MOBILE_HOLD`, keys). Pure module, no side effects.
- **Registry pheromones** — `commands/visual-bee-registry.ts`: `pheromones?: string[]`
  field + `effectivePheromones(view)` / `withPheromone(name)` (declared ∪ add − remove,
  never seeded). Declared `['mobile:friendly']` on **home**, **slides**, **website**.
- **The load gate** — `presentation/tiles/show-cell.drone.ts`: `#mobileMode` seeded
  from the service + kept live by a `mobile:mode` subscription; a synchronous
  union-delete at the end of the filter chain keeps only cells that carry
  `mobile:friendly` directly OR lead to a marked descendant (`#scanMobileReach`,
  async cross-page corridor walk mirroring `#scanTagsAcrossPages`). Excluded names
  are dropped before ordering — never fetched. Emits `mobile:gate {active, shown}`.

**Landed (2026-07-24, session 2, type-clean, doctrine 81/81):**
- **Portrait control bar** (`hypercomb-shared/ui/controls-bar/controls-bar.component.{html,scss}`):
  `.mobile-nav` is now a `1fr auto 1fr` grid — two side groups (each its own
  `overflow-x:auto` scroll region) flank a fixed, centred, emphasized centre
  button; bigger touch targets (side 3.4rem, centre 4rem). Verified via computed
  styles (centre at viewport centre; 2 buttons each side). Screenshots N/A (pane hidden).
- **Mobile signature pool** (`preferences/mobile-roots.ts`, `MOBILE_ROOTS_POOL='mobile:roots'`):
  participant-local registry of designated mobile hive roots — one content-addressed
  JSON doc `{roots:[locationSig]}` in the pool of meaning. `/mobile hive [name]`
  designates a hive: tags its container `mobile:friendly` (authoritative) AND records
  `sign([name])` in the pool. Verified via script (pool doc + tag). The tag stays the
  single source of truth for "what shows"; the pool is an index/curation layer (its
  edge: curating adopted hives you don't own onto your mobile home). Not yet a gate input.
- **Command-line-in-portrait finding:** the header is correctly `display:none` at
  ≤599px; the "always showing" symptom is most likely a portrait device >599px (tablet)
  on the desktop shell — needs device-width confirmation before changing the breakpoint.

**Landed (2026-07-24, session 4 — "professional pass" for the casual viewer):**
- **Chrome collisions removed on phones** (small-in-either-dimension query):
  the breadcrumb telemetry line (`display:none`; its `.faded` opacity was being
  overridden and it painted at the top) and the undo/redo/save cluster
  (`edit-actions`), whose old phone position landed exactly on the mobile bar's
  right end. Both are desktop chrome a viewer never needs.
- **Mobile empty state** (`presentation/tiles/mobile-empty-prompt.drone.ts`,
  mirroring collection-empty-prompt): the gate now emits
  `mobile:gate {active, shown, total}`; when tiles exist but none are marked and
  the render settles at zero, a quiet frosted prompt explains the state and — on
  the participant's own hive only (never while mesh-public; you don't write tags
  into a swarm you're browsing) — offers one-tap "Mark media tiles", which runs
  `MobileQueenBee.sweep()` (now public). A genuinely empty page stays silent.
  i18n: `mobile.empty.*` (en + ja).
- **Join dialog on phones** (`mesh-modal.component.scss`): the file already
  carried a phone bottom-sheet treatment (concurrent session) — kept it as the
  design and hardened it: rescoped from width-only `phone-only` to the
  small-in-either-dimension query (landscape phones were falling back to the
  centered desktop modal with sub-16px inputs → iOS zoom-on-focus), added
  `max-height` + scrollable body (long saved-rooms lists can't push the action
  row off-screen), and a **`prefers-reduced-motion` guard**: both enter
  animations park their `from` frame off-screen/transparent and rely on
  `forwards` to land the panel — with animations off (reduced motion, throttled
  renderer) that from-frame held forever and the dialog was invisible. Resting
  styles are now the truth; animation is additive.
- **Viewport meta** (both shells, parity): added
  `interactive-widget=resizes-content` so the Android keyboard shrinks the
  layout viewport and bottom-anchored chrome rides above it.
- **Video exit FAB** gets a safe-area bottom term (with `viewport-fit=cover` it
  sat on the home indicator on notched phones). The YouTube viewer was
  otherwise already viewer-grade: persistent exit FAB, backdrop/Escape close,
  auto-hiding chrome, edit-actions suppressed during the takeover.

**Not yet built (next increments):** test hive WITH media (needs the create/link tile
API — `/mobile hive` designates, doesn't mint content); pool→gate root integration;
gallery view (§6); "Make this yours" button + corridor dimming (§7 Phase 1.4, §9);
auto-deposit at authoring (§4.2.1); Phase 2 (deep link, join sheet, adopt/consent
sheets, Beehaviors sheet, minimal installer — §8); Phase 3 (snapshot→hex, touch scope,
share link); Phase 4. Corridor tiles currently render as normal navigable tiles (their
own image loads); "corridor content never fetched" is a documented refinement.

---

## 1. Mission

Someone shares a hive. The recipient opens the link on their phone and — with zero
concepts to learn — enjoys the visual content: videos, photo galleries, websites,
links. If they like it, one clear path lets them **adopt** the hive as their own.
Later they can create: snap a photo that becomes a hexagon, mark their own content
mobile-ready, share their own hive, join a swarm.

This is **not a separate app**. It is the existing web shell (`hypercomb-web`),
installable as a PWA, running the same Pixi hex canvas and the same drones — with a
**pheromone-gated content walk** and a **deliberately curated chrome**. A different
platform would replace the shell but load the same signed modules; the mobile
experience is the first proof of that posture without leaving the browser.

### Product shape per audience

| Audience | Experience |
|---|---|
| First-time recipient (Phase 1) | A viewer. Hex canvas of mobile-marked tiles only. Tap to watch/view. One "make this yours" button. Nothing else. |
| Convinced recipient (Phase 2) | Adopt the hive (headless fold), join its swarm, minimal mobile installer for behaviors. |
| Creator (Phase 3) | Camera snapshot → hexagon. Mark tiles mobile-friendly. Adjust visibility with the three-stage icon. Share. |
| Future | Chat, native wrapper (Capacitor), deposit-pool pheromones. Explicitly out of scope now. |

---

## 2. Non-negotiable principles

1. **Curated, not shrunk.** No desktop surface appears on mobile by default. Every
   control must argue its way in (see the Disposition Audit, §9). The starting point
   is an empty screen plus the canvas.
2. **Don't load what you won't show.** A tile without the mobile pheromone is
   excluded from the render walk **before** any resource fetch — not hidden after.
   §5 names the exact choke point.
3. **Behaviors self-declare.** Modules ship their own pheromones via their registry
   registration (§4.3). Nobody chases modules down to tag them.
4. **Borrow, never fork.** Every flow below reuses an existing headless primitive
   (tag decorations, `tile:action` events, the EffectBus join handshake, the adopt
   drone). New code is thin UI + one gate + one vocabulary.
5. **Web-simple.** The recipient experience must read like a polished media page,
   not a tool. Chrome is cold and clean, no flashy effects, no onboarding wall.

---

## 3. Grounding — what exists today (verified 2026-07-24)

All paths relative to `src/` unless noted. Line numbers are anchors, not gospel —
re-verify before editing.

### 3.1 Pheromones ARE tag decorations

- A pheromone today is a decoration `kind:'tag'`, payload `{ name }`, `appliesTo: []`
  → identical names hash to one content-addressed resource shared across cells.
  `hypercomb-essentials/src/commands/decoration.service.ts`
  (`addTag` ~L58, `removeTag`).
- Stored in the layer's `decorations` slot (array of record sigs) → **travels with
  adoption**, part of the layer signature.
  `commands/decoration-kind-index.ts` (`tagsForLabel` ~L112, `countLabelsWithTag` ~L236).
- Naming convention: colon-namespaced intent tags, e.g. `jwize.com:website`
  (`scripts/meaning-loop-phase1.ts` `WEBSITE_PHEROMONE`). Plain tags stay human labels.
- Painter flow (pick set → Paint → tap tiles):
  `hypercomb-shared/ui/tags-viewer/tags-viewer.component.ts` (`openPainter` ~L413,
  `startPaint` ~L442 emits `tags:apply-begin`) →
  `hypercomb-essentials/src/pheromones/pheromone-tiles.drone.ts`
  (handles `tags:apply-begin/toggle/end` ~L159, `pheromone:drop` ~L195, calls
  `DecorationService.addTag`) → on-tile chip card
  `hypercomb-shared/ui/pheromone-tiles/pheromone-tiles.component.ts`.
- A live tag-filter path already exists: `tags:filter {active, scope}` →
  `show-cell.drone.ts` `#scanTagsAcrossPages` (~L4011) flatten-override. That is a
  *search tool*, not the mobile experience — but it proves tags can drive rendering.
- The `pheromones:deposits` pool / intensity / decay model in
  `documentation/pheromones.md` is **spec-only, unbuilt**. This plan does not need it.

### 3.2 Touch, responsive, PWA

- Touch is essentially complete:
  `hypercomb-essentials/src/navigation/touch/touch-gesture.coordinator.ts`
  — one-finger pan, two-finger pinch (`navigation/zoom/pinch-zoom.input.ts`),
  sensitivity swipe with haptics, momentum coasting.
- Shell responsiveness is real: `hypercomb-shared/ui/controls-bar/controls-bar.component.ts`
  `isMobile` signal (`matchMedia('(max-width: 599px)')` ~L899), `isLandscape`,
  edge-swipe-back (~L1747). `hypercomb-shared/ui/_breakpoints.scss` phone/tablet/
  desktop + `@mixin touch { @media (pointer: coarse) }` used by ~48 stylesheets.
  `hypercomb-web/src/index.html:23` has the mobile viewport meta + safe-area insets.
- **PWA gap:** the service worker (`hypercomb-web/public/hypercomb.worker.js`,
  registered `hypercomb-web/src/main.ts:57`) is an OPFS module server only. There is
  **no `manifest.webmanifest`** — no standalone display, no install icons.

### 3.3 The load-gate choke point

`hypercomb-essentials/src/presentation/tiles/show-cell.drone.ts`,
inside `#renderFromSynchronizeInner` (~L2103): children resolve to a `union` name
set, then every hide/privacy source deletes from it **before ordering and before any
image fetch** (~L2985–3107): blocked tiles, `hc:hidden-tiles`, session hides,
`hc:hidden-lineages`, swarm privacy via `isCellPublic` (~L3100). Only the surviving
names reach `#resolveCellOrder` (~L3149) and eventually `loadCellImages` (~L6395) →
`store.getResource` (~L6420). **A name deleted from `union` is never ordered, never
painted, never fetched.** The mobile gate is one more delete in that block.

Supporting precedents: `sharing/feature-hidden.ts` (hidden features never activate,
draw, or stream), `presentation/tiles/site-view.drone.ts` ~L110 (unverified pages are
not mounted — no scripts run, no resources stream).

### 3.4 View behaviors and the registry

`hypercomb-essentials/src/commands/visual-bee-registry.ts` —
`VisualBeeRegistry.register({ view, slashCommand, iconName, decorationKind,
behavior:'render'|'navigation', slot?, opensOnTileClick?, adoptable?, cascades?,
adoptScope? })`, IoC key `@diamondcoreprocessor.com/VisualBeeRegistry`. Registered
views: home, tutor, slides (`commands/present.queen.ts` ~L197), website
(`commands/website.queen.ts` ~L583). A new view = one `register()` at module load +
a `*-view.drone.ts` renderer + (if it needs Angular chrome) `registerShellSurface`.

### 3.5 Content consumption paths (mostly built)

- **YouTube**: `link/youtube.ts` (id parse, oEmbed title, thumbnail), `link/media.ts`
  ~L53 (`youtube-nocookie.com/embed/<id>`), full-screen iframe overlay
  `hypercomb-shared/ui/youtube-viewer/youtube-viewer.component.ts` on EffectBus
  `viewer:open {kind:'youtube'}`, triggered from `link/link-open.worker.ts` ~L42.
- **Images**: single-image lightbox `link/photo.view.ts` via `link-open.worker.ts` ~L48.
  **No multi-image gallery/carousel exists** — closest is `slides-view.drone.ts`
  (`/present`) playing a cell's children via `media.ts` classification.
- **Websites**: `site-view.drone.ts` inline-mounts self-authored HTML from the
  website slot (with the verify-before-mount review gate). Third-party sites are
  never iframed; plain links open via `window.open(_blank, noopener)` after
  `safety/link-safety.service.ts` vets them.

### 3.6 The three-stage icon, per-tile scope, swarm join

- **Three-stage icon (global)**: `hypercomb-shared/ui/mesh-header/mesh-header.component.ts`
  — one glyph cycling `STAGE_PRIVATE` (lock) → `STAGE_WORLD` (public; the prep stage:
  canvas dims unshared tiles, per-tile scope controls appear) → `STAGE_HOST` (hub;
  opens the join modal via `mesh:open-modal {join:true}`). In a swarm it reads
  `groups`; click leaves. Emits `world:mode {active}`, persists `hc:world-mode`.
- **Per-tile scope (headless, reusable as-is)**:
  `presentation/tiles/tile-actions.drone.ts` — `make-public` (tile) and
  `make-branch-public` (subtree), mutually exclusive; storage `hc:public-tiles:/<loc>`
  + `hc:public-branches`; `isCellPublic` (~L133) is branch-aware. Pure localStorage,
  no DOM. The *presentation* of those toggles lives in the desktop **hover** overlay
  (`tile-overlay.drone.ts`, `world` profile ~L428) — hover does not exist on touch;
  mobile needs a different reveal (§7.3).
- **Join handshake is fully EffectBus-wired** (mobile can drive it without the
  desktop modal): `mesh-modal.component.ts` `save()` emits `mesh:room` /
  `mesh:secret` / `mesh:host` / `mesh:join` → web `core-adapter.ts:46` sets
  `hc:mesh-public` + `mesh:public-changed` → `sharing/swarm.drone.ts` ~L1032
  connects → `sharing/nostr-mesh.drone.ts` sockets. Wire format: kind 30200
  `{children:[{name, layerSig}]}` at a composed sig of `path\0room\0secret`;
  resources stream on demand by sig, sha256-re-verified. Only the public subset is
  ever published (`show-cell.drone.ts` ~L1350).

### 3.7 Adopt (the common case is already mobile-shaped)

`sharing/swarm-adopt.drone.ts` — "adoption is paste with a fetch in front."
Entry is one event: `tile:action {action:'adopt', label}` (~L219).

- Content-only, single publisher (the common case): `#adoptInline` →
  `#commitBranch` (~L902) pulls the layer closure, `importTree` folds it as ordinary
  children at the participant's current location, read-back verifies, pre-warms,
  `fs:changed` + processor act. **No panel involved.**
- Declared CODE: consent (`requestConfirm`) → **headless** DCP install
  (`portal:open {headless:true, stage:codeSigs}`) → Beehaviors toggles.
- Uninspectable code (fail-closed): routes to the **visible** DCP iframe installer
  (`hypercomb-shared/ui/portal/portal-overlay.component.ts`) — the one genuinely
  desktop-heavy surface.
- Disambiguation panel appears only when 2+ publishers share a name.

---

## 4. The mobile pheromone vocabulary

### 4.1 Tile-level: `mobile:friendly`

One canonical gate tag, colon-namespaced per convention: **`mobile:friendly`**.
It is an ordinary `kind:'tag'` decoration — deposited via the existing
`DecorationService.addTag`, painted via the existing painter, removed via the
existing chip card, deduped by content addressing, and **it travels with adoption**
(in-layer), so a recipient's mobile view works the moment the fold completes.

Namespace note: `mobile:` is a capability axis, not a domain vocabulary — do not
use `jwize.com:` (that namespace belongs to AI-intent sweep tags). The `mobile:`
namespace leaves room for future refinements (`mobile:landscape`, …) — do **not**
mint any of those now.

### 4.2 How tiles get the tag (three routes, no chasing)

1. **Auto-deposit at authoring time** (commit path, NOT the optimize phase — tags
   are truth and truth is never minted in the optimize phase, see
   `documentation/optimize-phase.md`): when a tile is created/edited and its content
   is inherently mobile-fit, deposit `mobile:friendly` in the same commit:
   - link resolves to YouTube (`parseYouTubeVideoId`) or a direct image/video/audio
     (`media.ts` classification);
   - the tile's image IS its content (photo tiles, incl. Phase-3 camera snapshots);
   - a website cell whose stored page HTML contains `<meta name="viewport"` —
     self-authored pages live in the website slot, so this is a cheap string check
     at page-save time (this satisfies "mobile-friendly websites get the pheromone").
   Auto-deposit fires only when the qualifying property is introduced or changed —
   never on unrelated edits.
2. **`/mobile` sweep behaviour** (new slash behaviour, Phase 1): walks the current
   subtree applying rule 1 retroactively, reports counts ("marked 14 of 63 tiles"),
   never removes marks. Idempotent.
3. **Manual painter** — the existing pheromone painter already handles arbitrary
   tags; `mobile:friendly` needs no new UI, only a suggested entry in the panel.

**The negation tag `mobile:hold` (anti-clobber for stamped tags).** Auto-deposited
tags are in-layer truth, so automation must never fight a human who removed one.
Borrow the existing negation precedent (`jwize.com:hold` suppresses meaning-loop
proposals): when the user removes `mobile:friendly` from a tile via the chip card
or painter, the same commit deposits **`mobile:hold`**. Every automatic route
(auto-deposit AND the sweep) skips any tile carrying `mobile:hold`, permanently.
The load gate treats a held tile as not-friendly. Because `mobile:hold` is in-layer,
the author's "this is not mobile content, despite appearances" judgment travels
with adoption exactly like the positive mark. Manual re-add of `mobile:friendly`
removes the hold in the same commit. These are the ONLY two tags in the `mobile:`
namespace (§12).

### 4.3 Behavior-level: registry pheromones

Add an optional field to the `VisualBeeRegistry` registration shape
(`commands/visual-bee-registry.ts`):

```typescript
pheromones?: string[]   // capability self-declaration, e.g. ['mobile:friendly']
```

- Ship `['mobile:friendly']` on: **home**, **slides**, **website**, and the new
  **gallery** view (§6). Ship nothing on tutor/wave for now (desktop-first
  interactions; they can earn it later).
- Add a registry query `withPheromone(name: string)` returning matching
  registrations. The mobile shell uses it to decide which views may activate and
  which tile-click behaviors are honored; everything else stays dormant on mobile
  (icons not shown, view modes not enterable, surfaces not mounted).
- Phase 4 propagates the same strings into module manifests so the installer can
  filter and `ScriptPreloader` can skip loading non-mobile modules entirely.

### 4.4 Prepackaged pheromone lifecycle: declared, never seeded

The elegant answer to "how do shipped pheromones materialize, and how can they
change later without re-stamping after first initialization" is: **they are never
materialized as stored state at all.**

- **Shipped pheromones are code-level declarations.** `register({ pheromones })`
  runs at every module load, so the declared set is re-asserted for free on every
  boot. There is no seeding step, no stored copy of the defaults — therefore
  nothing to go stale and nothing for an update to clobber.
- **User changes are participant-local overrides**, stored once in a small record
  (`hc:behavior-pheromones`, localStorage) keyed by the registration's **stable
  `view` name** — NOT by module signature, which by design changes on every
  update: `{ [view]: { add: string[], remove: string[] } }`.
- **Effective set = (declared ∪ add) − remove**, computed by the registry's
  `withPheromone()` query at read time. Never persisted.
- **Update semantics fall out for free**: a publisher who adds `mobile:friendly`
  to a behavior ships a new module version (new sig); the adopted update brings
  the new declaration; the user's `remove` override, if any, still wins locally.
  The default was never stamped — only computed — so "changed later" costs nothing.
- **No override UI in Phases 1–2.** The mechanism exists so updates can never
  fight users; editing overrides is a desktop affordance for later.
- **Contrast with tile tags** (§4.2): tile-level automarks ARE stamped (in-layer
  truth), and their anti-clobber is the `mobile:hold` negation. Two tiers, two
  mechanisms, one principle: automation writes a default at most once, and a
  human decision is never overwritten by re-initialization.

---

## 5. The load gate

New participant-local mode: **mobile mode**, owned by a small `MobileModeService`
(essentials, IoC-registered, EventTarget): active when
`matchMedia('(pointer: coarse)')` AND the phone breakpoint match, with a manual
override (`/mobile on|off`) so desktop can test. Persist the override in
localStorage (`hc:mobile-mode`); auto-detection wins when unset.

Gate implementation — one addition to the existing union-delete block in
`show-cell.drone.ts` `#renderFromSynchronizeInner` (~L2985–3107), exactly where
hide/block/private already filter:

```
if mobileMode:
  for each name in union:
    keep if tile carries mobile:friendly        (tagsForLabel — reads pooled layer bytes, sync)
    else keep AS CORRIDOR if any descendant carries it
    else union.delete(name)                     → never ordered, never painted, never fetched
```

- **Corridor rule**: an unmarked parent whose subtree contains marks stays visible
  as a navigation-only tile (rendered dimmed/label-forward, its own content never
  fetched — reuse the existing readiness-shade styling so it reads as "path, not
  content"). Without this, marked leaves would be unreachable through unmarked pages.
- **Reach memo**: descendant checks walk already-pooled layer bytes (names +
  decoration sigs — never image resources). Memoize per session in an in-memory
  `Map<layerSig, boolean>` — sig-keyed, so invalidation is automatic (new content =
  new sig). Do NOT persist this to OPFS in v1; only if profiling on a real hive
  demands it, mint it as a proper optimize-phase derived record (sig-keyed,
  complete-or-absent, never load-bearing) per `documentation/optimize-phase.md`.
- **Empty state**: a hive with zero marks renders a single quiet message
  ("Nothing here is marked for mobile yet") plus — on the owner's own hive only —
  a button that runs the `/mobile` sweep.
- The gate composes with (never replaces) the existing hide/block/public filters,
  and applies to peer tiles in a swarm identically (peer layers carry their tags,
  since tags are in-layer).

---

## 6. New view: gallery

The one missing consumption surface. Register `gallery` in `VisualBeeRegistry`
(decorationKind `visual:gallery`, slashCommand `/gallery`, behavior `'render'`,
`opensOnTileClick: true`, `pheromones: ['mobile:friendly']`) with a
`gallery-view.drone.ts` renderer that reuses the slides machinery
(`slides-view.drone.ts` + `media.ts` child classification) but presents a
touch-native, swipeable, full-screen carousel of the cell's children (images +
videos + YouTube embeds), with pinch-zoom on images. On desktop it is simply
another view behaviour; on mobile it is the flagship. Follow the existing pattern:
queen registers, drone renders, shell overlay (if any) goes through
`registerShellSurface` + the shell-surfaces barrel — **never** an `<hc-*>` tag in
`app.html` (doctrine ratchet enforces this).

---

## 7. Phases

### Phase 0 — PWA + mode foundation (small, unblock everything)

1. `hypercomb-web/public/manifest.webmanifest`: name, short_name, `display:
   standalone`, theme/background colors matching the dark boot theme, maskable
   icons (192/512). Link it from `index.html`; verify installability in Edge/Chrome
   mobile emulation. Do not touch the existing OPFS service worker's behavior —
   only ensure it doesn't block install criteria.
2. `MobileModeService` (§5) + `/mobile on|off` slash behaviour.
3. `pheromones?: string[]` field + `withPheromone()` query on `VisualBeeRegistry`;
   declare it on home/slides/website.

**Acceptance**: app installs to a phone home screen and launches standalone; `/mobile on`
on desktop flips the mode signal; registry answers `withPheromone('mobile:friendly')`.

### Phase 1 — The viewer (the product)

1. The load gate + corridor rule + reach memo + empty state (§5).
2. `mobile:friendly` vocabulary: auto-deposit at authoring (§4.2.1), `/mobile`
   sweep behaviour (§4.2.2), suggested entry in the painter panel.
3. Gallery view (§6).
4. Mobile chrome — the entire Phase-1 surface set (see audit §9): canvas,
   back affordance (edge-swipe-back already exists in controls-bar; keep it),
   the three-stage mesh glyph (display-only until Phase 2 wiring), and one
   context action button ("Make this yours" — inert until Phase 2, hidden if not
   viewing shared/peer content). Everything else hidden under mobile mode.
5. Touch pass over consumption: YouTube overlay, photo lightbox, gallery, website
   view, link click-through — verified on a real phone (LambdaTest VMs have no GPU;
   Pixi needs a real device or local emulation).
6. i18n: every new user-facing string in `hypercomb-shared/i18n/en.json` + `ja.json`.

**Acceptance**: open a hive on a phone → only marked tiles render (network tab
shows zero fetches for unmarked tiles' resources); corridors navigate; YouTube,
gallery, website, photo, link all consumable with touch only; desktop experience
completely unchanged when mobile mode is off.

### Phase 2 — Join & adopt (the loop closes)

1. **Deep link**: `#/join/<location>/<room>` fragment → prefilled mobile join
   sheet. The secret is **never** in the link — recipient types it (it arrives
   out-of-band). Drive the join headlessly via the existing EffectBus chain
   (`mesh:room`/`mesh:secret`/`mesh:host`/`mesh:join`) — no desktop modal.
2. **Mobile join sheet**: bottom sheet with room + secret + join button; advanced
   (host, label, saved rooms) collapsed. Reuse `mesh-header` glyph as the entry
   point — same three-stage cycle, same events.
3. **Adopt** — the full design, case by case, is §8 (Mobile adoption — deep
   design). It is the heart of this phase; implement it from that section.
4. **Beehaviors as a bottom sheet**: it is toggles-only by design — render the same
   data as a mobile sheet on `features:open` when mobile mode is active (§8.6).
5. **Minimal mobile installer** ("minimal requirements" per direction): a single
   sheet — hive name, publisher domain, tile count, behavior list with toggles,
   Accept. Gated on explicit accept; passive close discards (both already the
   drone's contract). This is NOT the DCP tree; it is the smallest honest surface
   over the existing headless flows (§8.4).

**Acceptance**: phone-only round trip — receive link, join, see peer tiles
(marked ones only), adopt content-only inline, adopt a declared-code hive through
the consent sheet, toggle a behavior in the sheet. Private content never leaves
the device (only the public subset publishes — existing filter, verify unchanged).

### Phase 3 — Create & share

1. **Snapshot → hexagon**: FAB (mobile mode, own hive only) → camera via
   `<input type="file" accept="image/*" capture="environment">` → blob → existing
   tile-create pipeline (image becomes the tile's sig-addressed resource) →
   auto-deposit `mobile:friendly` → hex appears at the current page. One commit,
   one history layer, screen stays still (no auto-fit).
2. **First-run**: creating a hive on a fresh phone must gracefully create the root
   layer ("No content found" = missing root layer — handle it, don't error).
3. **Scope on touch**: in world (prep) mode — entered via the same three-stage
   glyph — tap toggles tile public, long-press toggles branch public, both wired to
   the existing headless `tile:action` handlers in `tile-actions.drone.ts`. Dim
   preview and green tint carry over from the shared canvas as-is.
4. **Share**: generate the `#/join/...` link (room, no secret) via the native share
   sheet (`navigator.share`), secret communicated by the human.

**Acceptance**: on a phone, from empty: create hive → snap 3 photos → 3 marked
hexagons → world mode → mark one private → join room → second device sees exactly
the two public tiles.

### Phase 4 — Intelligence hardening

1. Propagate registry pheromones into module manifests; mobile installer filters
   on them; `ScriptPreloader` skips loading modules with no mobile-capable surface
   when mobile mode is active (true "don't even load it" at the module tier).
2. Performance budget on real data (verify on a real hive, not a toy): time-to-first
   -content on a mid-range phone, gate-walk cost, memo hit rate. Persist the reach
   memo as an optimize-phase derived record ONLY if this profiling demands it.
3. Disposition audit round 2: revisit every "absent" verdict with usage evidence.
4. Chat: spike note only — likely a swarm-native message stream; do not build.

---

## 8. Mobile adoption — deep design

Adoption is the moment a viewer becomes a participant. The flow is simple by
design — "adoption is paste with a fetch in front" (`sharing/swarm-adopt.drone.ts`
header) — and the mobile job is to keep it that simple while staying honest about
code, collisions, and failure. Everything below drives the EXISTING drone through
its EXISTING events; mobile contributes sheets, not logic.

### 8.1 Entry points

- **"Make this yours"** (the Phase-1 context button, visible only when viewing
  shared/peer/public content): resolves the shared root tile(s) at the top page.
  One root → `tile:action {action:'adopt', label}` directly. Several roots → a
  sheet lists them with an "Adopt all" option that emits sequential adopts.
- **Long-press a peer tile** (`kind:'peer'`): action sheet `[Adopt] [Cancel]` —
  the touch replacement for the desktop hover-overlay adopt icon
  (`tile-overlay.drone.ts` `public-external` profile, hover-only today).
- Adoption lands at the participant's **current location** — `#resolvePeerBranch`
  (~L349) sets `at` from current `explorerSegments`. Content lands where you are;
  do not add a target picker (the desktop adopt-to autocomplete was retired).

### 8.2 Case A — content-only, single publisher (the common case)

Existing pipeline, zero new logic: `#adoptInline` → `#resolvePeerBranch`
(validates `layerSig` as 64-hex merkle handle, learns publisher domain from the
broker) → `#branchCodeSigs` finds no code → `#commitBranch` (~L902):
closure pull (`broker.adopt {layersOnly:true}` — resources stream later, never
dumped wholesale), complete-or-defer retry ladder when pieces are missing,
`importTree` folds the subtree children-by-name (the SAME cascade as create/
paste), read-back verify, `markAdoptedRoot`, neighbourhood pre-warm, `fs:changed`
+ processor act.

Mobile UI over it: a progress toast **with counts** ("Adopting… 12 of 41 pieces" —
loaders always show counts) and a success toast ("Adopted 41 tiles"). Desktop
auto-routes to the Beehaviors panel afterwards; on mobile **suppress that** for
content-only adopts — there is nothing to toggle, and the viewer should simply see
the tiles are now theirs (marked ones render immediately: tags are in-layer, so
`mobile:friendly` arrived with the fold).

### 8.3 Case B — name collision (2+ publishers)

The drone already detects it and the desktop panel never fetches — selection is
pure. Mobile: an action sheet grouped by publisher domain (name, domain, tile
count per candidate) feeding the existing `adopt-selected` path. Rare; keep it
one tap.

### 8.4 Case C — declared code ("simple behaviors within the mobile scope")

This is the case the mobile installer sheet exists for. `#branchCodeSigs`
(~L593) walks root + children collecting `bees`/`dependencies` sigs, fail-closed.

**Consent sheet** (the minimal mobile installer):

- Header: hive name, publisher domain, tile count.
- Body: the behavior list. Resolve display names **without executing code**, in
  this order: (1) the publisher's manifest, fetched by the broker for the domain;
  (2) the first-line alias comment convention (`// @scope/name`) read from the
  already-pulled bytes as text; (3) fall back to short-sig + count. Never load a
  module to learn its name.
- Per-behavior chips: **mobile** (declares `mobile:friendly` per its registration
  metadata, when known) or **desktop** (installs fine, activates elsewhere).
- Buttons: `[Adopt with behaviors]` (default — adopted code defaults ON) ·
  `[Content only]` · `[Cancel]`.

**Adopt with behaviors** → satisfies the drone's consent gate → the existing
**headless** DCP install (`portal:open {headless:true, stage:codeSigs}`) writes
code sigs into the `sign('bees')` / `sign('dependencies')` pools → content fold →
Beehaviors sheet opens (§8.6). The DCP iframe never appears; headless install is
an already-built path, not a mobile fork.

**Content only** → skip the code stage and `#commitBranch` directly. Verify the
drone supports a content-only fold when code was declared; if it currently
doesn't, extend `adoptResolvedBranch` with a skip-code flag — a parameter, not a
parallel path.

Doctrine that binds here: install is **gated on the accept gesture**; passive
sheet dismissal discards everything (the drone already discards `dcp:embed-closed`
and never auto-folds `RegistrySnapshot`); update never enables content
(adopt-intent gate); behaviors surface as **toggles only**.

### 8.5 Case D — uninspectable code (fail-closed `null`)

Desktop routes to the visible DCP iframe installer. Mobile refuses to fake it:
sheet — "This hive's behaviors can't be inspected here." with
`[Adopt content only]` · `[Finish on desktop]` · `[Cancel]`. "Finish on desktop"
is advice, not state — persist nothing. Fail-closed stays fail-closed.

### 8.6 After adoption: behaviors on a phone

- Installed behaviors self-register in `VisualBeeRegistry` when their module
  loads. Activation on mobile = effective pheromone set contains
  `mobile:friendly` (§4.4: declared ∪ overrides). A hive shipping the gallery
  behavior is fully alive on the phone the moment it folds.
- Non-mobile behaviors install and stay **dormant on mobile, not hidden as
  facts**: the Beehaviors bottom sheet lists every adopted behavior with its
  enable toggle (toggles are truth about *enablement*), and desktop-only ones
  carry a `desktop` chip — the toggle still works; activation simply waits for a
  desktop session. The sheet honors the hidden-features pool like the desktop
  panel does.
- The sheet is the mobile rendering of `features:open` — same data source as
  `show-features.drone.ts`, different chrome. It follows navigation like the
  desktop panel.

### 8.7 Failure and idempotency

- **Partial closure / offline mid-adopt**: `#commitBranch` is complete-or-defer —
  it never folds a partial tree. Surface the truth: "Waiting for 3 of 41 pieces…"
  and let the retry ladder work; a backgrounded/killed PWA resumes cleanly
  because nothing was folded and the pulled pieces are already content-addressed
  in the pool (re-adopt re-uses them — dedup is free).
- **Integrity**: every fetched piece is sha256-re-verified against its sig by the
  broker; the fold read-back verifies; the publisher's sig is authoritative.
- **Re-adopt / update**: sync receipts (`hc:synced-publisher-roots`) +
  `importTree`'s children-by-name semantics make repeat adoption a sync, not a
  duplicate. Never expose the word "sync" in mobile UI — it's always "adopt".
- **What mobile adoption never does**: auto-adopt, publish anything during the
  fold, enable content on update, show the DCP tree, or fold on a dismissed sheet.

### 8.8 Acceptance (phone-only, two devices)

1. Content-only hive: link → join → "Make this yours" → progress counts → tiles
   render as owned; layer sigs identical to a desktop adopt of the same branch.
2. Hive shipping one mobile behavior (gallery) + one desktop behavior: consent
   sheet names both with correct chips; adopt-with-behaviors → gallery works
   immediately on the phone; desktop behavior visible in the Beehaviors sheet
   with `desktop` chip, toggleable.
3. Same hive, `[Content only]`: tiles fold, no code sigs written to the
   `sign('bees')` pool (verify by signature comparison — never wipe OPFS).
4. Airplane mode mid-adopt: honest count stall, no partial fold; reconnect →
   completes; final tree byte-identical.
5. Adopt, then adopt again: no duplicates; receipts show sync semantics.

## 9. Disposition audit — every surface earns its place

Verdicts for mobile mode. Desktop is untouched. "Absent" means not mounted/not
activatable in mobile mode — not deleted.

| Surface | Verdict (phase) | Why |
|---|---|---|
| Hex canvas + touch nav | **Native** (1) | The product. Touch stack already complete. |
| YouTube viewer overlay | **Native** (1) | Core consumption; already an overlay. |
| Photo lightbox / Gallery view | **Native** (1) | Core consumption; gallery is the flagship. |
| Website view | **Native** (1) | Self-authored pages; viewport-meta pages get the pheromone. |
| Slides (`/present`) | **Adapted** (1) | Reused as gallery's engine; direct entry deferred. |
| Link click-through | **Native** (1) | `window.open` + safety vetting, unchanged. |
| Edge-swipe back | **Native** (1) | Already built in controls-bar. |
| Three-stage mesh glyph | **Adapted** (2) | Same cycle/events; join modal → bottom sheet. |
| Adopt | **Adapted** (2) | Headless drone + consent/action sheets (§8). |
| Beehaviors panel | **Adapted** (2) | Toggles-only → bottom sheet. |
| DCP iframe installer | **Absent** (2; revisit 4) | Desktop-heavy tree; mobile gets the minimal sheet; uninspectable code defers to desktop. |
| Pheromone painter / tags panel | **Absent** (1) → creator-only (3) | Viewer never tags; creator paints on desktop first; sweep covers mobile. |
| Command shell / palette, slash input | **Absent** (1) | Viewers type nothing. Revisit for creators in 4. |
| Header icon rail, docked panels, file explorer, notes, clipboard, history UI, feedback viewer (inbox + Q&A), collections landing | **Absent** (1) | Desktop working surfaces; none serve a viewer. Each may re-argue entry in Phase 4 with evidence. |
| Move/reorder, editor | **Absent** (1) → minimal (3+) | Creation tier; snapshot-create ships first, editing later. |
| Tutor, wave view (Alt+hover) | **Absent** | Interaction models are keyboard/hover-native; they earn `mobile:friendly` only after redesign. |
| Meetings / WebRTC | **Absent** | Out of scope. |

The standing rule for future surfaces: **a surface appears on mobile only when its
registration (or shell-surface metadata) declares `mobile:friendly` AND a written
verdict in this table says why.** Update the table in the same PR as the change.

---

## 10. Doctrine guardrails (binding on the implementer)

- **Signatures compose everything.** New structured data = sig-addressed resources
  referenced by signature, never inline. No hardcoded 64-hex signatures.
- **No typed `__x__` folders, ever.** New groupings are pools of meaning with a
  **colon** in the meaning string, derived via `Store.poolSignature` — but this plan
  intentionally mints **no new pool** (the reach memo is in-memory; tags are in-layer).
- **`synchronize` is dispatched only by the processor** (`hypercomb.act()`); the gate
  lives inside the render pass and must not add dispatches.
- **Optimize phase mints derived caches only, never truth.** Auto-deposit of tags
  happens on the commit path. The reach memo, if ever persisted, is sig-keyed,
  complete-or-absent, never load-bearing.
- **Doctrine ratchets** (`src/doctrine.spec.ts`): never extend an allowlist. No
  `<hc-*>` tags in either `app.html` — `registerShellSurface` + the barrel
  (`hypercomb-shared/ui/shell-surfaces/shell-surfaces.barrel.ts`).
- **Dependency direction**: essentials never imports from shared/web/dev. The join
  sheet and installer sheet are shell UI; the gate, vocabulary, sweep, gallery
  drone, and MobileModeService are essentials. If something in shared is needed by
  a module, migrate the primitive down to core — don't reach up.
- **Conventions**: `#field` never `private`; EventTarget + EffectBus, no new state
  libraries; ESM with `.js` relative extensions; `*.drone.ts` / `*.service.ts` /
  `*.component.ts`; "tiles" in user-facing text, "cells" in code.
- **UI language**: cold/clean chrome, no flashy effects; render never awaits the
  network (content streams in, placeholders never block); tiles never render
  imageless; screen stays still on add/remove; every string through i18n (en + ja).
- **Never wipe OPFS to test.** Verify essentials changes by signature comparison
  (new bee sigs in the manifest + `sign('bees')` pool). User data is sacred.
- **Adopt is adopt**: behaviors surface as toggles only; update never enables
  content; folds happen only on explicit accept gestures.

## 11. Verification playbook

- Build order: `npm run build:core` → `npm run build:essentials` → shells hot-reload
  shared. Never rebuild essentials while the dev server is running.
- Test on the dev shell first (port 4250, MAIN branch origin), desktop with
  `/mobile on` + browser device emulation for iteration; **real phone on LAN for
  anything Pixi/touch/PWA** (cloud VMs lack GPU).
- Gate proof: with mobile mode on, the network/OPFS access log shows zero resource
  reads for unmarked tiles; toggling mobile mode off restores the full hive with no
  data loss (the gate filters, never deletes).
- Swarm proof: two devices, one room — the phone sees only marked+public peer
  tiles; adoption on the phone produces the identical folded subtree a desktop
  adopt produces (compare layer sigs).

## 12. Explicit non-goals (do not build now)

Chat; native wrappers; the `pheromones:deposits` pool (intensity/decay/trust);
generic third-party iframing; the full DCP tree on mobile; per-tile mobile
*editing* surfaces; new pool meanings; pheromone-override editing UI; any
`mobile:*` tag beyond exactly `mobile:friendly` and `mobile:hold`.
