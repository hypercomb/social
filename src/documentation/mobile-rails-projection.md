# Mobile rails — the phone reads the hive as a strip, and never writes it

**Status: BUILT 2026-09-01.** §1–§3 in `ef26fca02` (proof
`scripts/drive-mobile-rails.cjs` 23/23); §4–§9 in the commit after it (proofs
`drive-layer-deck.cjs` 15/15, `drive-mobile-scroller.cjs` 16/16,
`drive-view-back.cjs` 10/10, the sheets harness 38/38, `drive-mobile-deck.cjs`
both orientations). Still owed, blocked on files another session holds:
share publishes the tapped tile (`host-gesture.ts`), publish's copy-link
through the share sheet (`publish-status.drone.ts`), the hosts sheet's
hover-only remove (`hosts-panel.component.scss`), the pin plate (no door
outside the bar). Supersedes the lane half of
`mobile-grand-master-plan.md` (P1/P1b are kept as pure geometry; the
"lanes are an explicit act that commits" doctrine is retired for the phone).
Jaime's brief, 2026-09-01:

> Three rails, and they always go one direction. Stock up twenty tiles and
> they run long one way. Landscape: you can only move side to side. Portrait:
> it rotates, the rows point up and down, and you can only move up and down.
> Right now the user experience is broken. I want icons that open views. I
> want a scroller so a hive full of videos and pictures can be flicked
> through. Community sharing, replication, behaviour adoption all have to fit
> on the phone. User experience is number one.

---

## 1. The one idea

**On a phone the rails are a PROJECTION of the layer, not an arrangement.**

Today lane mode is an arrangement commit: `/lanes` re-packs the tiles,
writes every tile's `index`, and `#dropLaneModeOutsideOwner` throws the
whole posture away the moment you tap into a child. That is why the phone
"sometimes has rails" and mostly has a free map. It was designed that way
on purpose — *an arrangement moves tiles, and moving tiles is truth* — and
that doctrine still holds. The fix is not to auto-commit; it is to stop
treating the phone's posture as an arrangement at all.

The layer already carries everything the strip needs: an ORDER (the
`index` property of each tile). The desktop reads that order into a
spiral; the phone reads the same order into three rails. Neither reading
is truth. The renderer's slot grid (`AxialService.items`, slot → hex
coordinate) is the single place both readings meet, so that is where the
projection lives:

```
                     slot i  ──►  spiral coordinate   (desktop, today)
   index order ──►
                     slot i  ──►  rail coordinate     (phone, this plan)
```

Everything downstream — hit-testing, the overlay, drag-to-move,
`render:cell-count`, selection, fit — already goes through
`axial.items`, so swapping the matrix carries them all with no per-feature
branch. Nothing is written to any layer by looking.

### Consequences that fall out for free

- **Rails on every page, always.** There is no owner location and nothing to
  drop on navigation. Enter a child, come back, deep-link, reload: rails.
- **Rotation is a re-projection, not a re-arrangement.** Portrait projects
  point-top columns and locks the finger to ↕; landscape projects flat-top
  rows and locks it to ↔. No commit, no reflow retry ladder, no orientation
  written to the participant's standing `hc:hex-orientation` preference (the
  rail owns the orientation at render time and hands the preference back
  when it releases).
- **The rung (3 / 2 / 1) is a lens.** `/lanes 2`, the bar's rung button and
  a settled pinch change the projection and re-fit. No commit.
- **Twenty tiles run long one way.** Portrait: 3 columns × 7 rows. Landscape:
  the 3-2-3 flat-top rhythm, eight columns wide. The strip starts at the
  origin and grows in the +long direction, so the camera's start edge never
  moves as tiles arrive.
- **Feed order.** Slot *i* sits at row ⌊i/3⌋, lane i mod 3 in portrait (the
  next tile is beside you, not a strip-length away), and walks the 3/2
  columns left→right in landscape. The old `laneCoords` filled column-major
  and is kept only for its spec.

## 2. Dense ranks — the one place the projection touches truth

The slot array is SPARSE by `index`: removals leave holes, the desktop
allocator places new tiles at the free slot nearest the camera (index 30
while 0–9 are used), and flower/rectangle arrangements are gappy by design.
A feed with twenty empty slots between tile 9 and tile 10 is not a feed. So
on the phone the renderer walks the **dense ranks** of the occupied slots in
index order: rank r renders at rail slot r. That is a render-time
compaction; the layer keeps its sparse indices.

The one gesture that WRITES order on the phone — drag-to-move — therefore
commits in rank space: when rails are active, `MoveDrone` extends its
placement map to every rendered tile so the committed indices are exactly
the dense rail order (index = rank). Partial writes would interleave wrongly
against untouched sparse indices (index 3 written between untouched 2 and 5
lands the moved tile where rank 2 was, not where the finger left it), so
the commit is whole or not at all. This is the same shape as
`SequenceCycleDrone.#persistPlacement` — one deliberate act, every tile
written once. New tiles keep the viewport-scored allocator: a rail slot near
where you are looking becomes the tile's index; compaction shows it there.

## 3. What is built

### 3.1 Rail grid — `presentation/grid/rail-grid.ts` (new, pure)

- `railCoord(slot, lanes, flatTop) → {q, r}` — portrait (point-top): row
  ⌊slot/lanes⌋, lane slot mod lanes, odd-r offset so the columns are
  straight; landscape (flat-top): columns alternate `lanes` / `lanes−1`
  slots, walked left→right, so consecutive slots are strip-neighbours.
- `buildRailMatrix(lanes, flatTop, capacity = 1200)` — slot → `AxialCoordinate`
  for the whole capacity, anchored so slot 0 is the strip's start.
- Specs pin: 20 tiles / 3 lanes portrait = 3 straight columns of 7,7,6 in
  row-major order; landscape 3/2 rhythm; 1 lane = one straight line; the
  start slot never moves as capacity grows.

### 3.2 `AxialService.project(matrix | null)`

Swaps `items` / `count` / `Adjacents` between the spiral matrix (kept) and
the rail matrix, re-registers `AxialCoordinate.setIndex` for the active
matrix, and emits `render:grid-changed`. `closestAxial` and every consumer
read `items` live, so nothing else changes.

### 3.3 `RailProjectionDrone` — `sequence/rail-projection.drone.ts` (new)

The owner of the phone posture. Replaces every lane responsibility that
`SequenceCycleDrone` carried (which loses `lanes:*`, `#laneLocation`,
`#reflowLanes`, `#alignOrientation`/`#restoreOrientation`,
`#dropLaneModeOutsideOwner`, `#publishLanes`, the mobile-only toast, and the
`three-lanes` cycle entry).

- `active = MobileMode.active && rails preference !== 'off'`
  (`hc:rails` localStorage; `/lanes off` = free map for this participant,
  `/lanes on|1|2|3` restores).
- On activation and on every change of rung or `laneStripHorizontal()`:
  `axial.project(buildRailMatrix(rung, horizontal))`, `setLaneViewport(true)`
  (the pan/zoom/wheel lock reads it), `render:set-orientation {flat:
  horizontal}` as a runtime override (never written to `hc:hex-orientation`),
  `lanes:changed {active:true, lanes}` for the chrome, and a deferred
  `zoomToFit` across the strip.
- Rotation: `resize` / `orientationchange` / `screen.orientation` → deferred
  160 ms → re-project if the long axis flipped. No retries needed — nothing
  has to be re-packed, the matrix is built from the device.
- Release (`/lanes off`, mobile mode off): `axial.project(null)`,
  `setLaneViewport(false)`, orientation restored from the standing
  preference, `lanes:changed {active:false}`.
- `lanes:set` / `lanes:step` / `lanes:off` / `lanes:on` handled here; the
  rung persists in `hc:lane-count` as before.

### 3.4 Renderer — `ShowCellDrone`

- `render:grid-changed` → clear the layer cache and re-render, exactly as
  `render:set-orientation` does.
- Dense ranks: when the projection is active and no move/arrange preview is
  up, the effective slot array is `names.filter(Boolean)`. `render:cell-count`
  therefore reports rail coordinates; every consumer that maps a rendered
  coordinate back to a slot (`buildCoordToIndex(axial.items)`) sees rank.

### 3.5 Move — `MoveDrone`

When the projection is active, `#commitPlacements` writes index = rail slot
for EVERY rendered tile (the dense order), not just the dragged ones.

### 3.6 Fit and axis

- `ZoomDrone.zoomToFit`: a `fitAxis` of `'both'` resolves to the cross axis
  of `getLaneScrollAxis()` when a lane axis is set. Every caller — the fit
  button, `/fit`, `0`/`r`, `applyCenter` on rotation, the first-visit refit,
  auto-fit — then fits ACROSS the strip and aligns its start edge to the
  safe area instead of shrinking the whole strip onto the screen.
- `applyCenter` (rotation): zero the CROSS-axis pan before recentring so a
  portrait scroll offset never becomes a landscape offset the finger cannot
  correct.
- Momentum: the coordinator zeroes the cross-axis velocity under a lane
  axis, so a sideways flick in portrait does not hold the input gate while
  nothing moves.
- Right-edge swipe-back in the controls bar is off while the lane axis is
  `'x'` (a leftward drag IS the strip scroll in landscape); the Back disc
  and the hardware button remain.
- The rotate button leaves the phone view row (rails own the orientation);
  `arrange` leaves it too (a pattern order is meaningless in a feed).

## 4. Icons that open views

Two doors, both registry-fed, no hand-listed views anywhere:

1. **A tile that carries a view opens it on tap.** `TileOverlayDrone`
   consults `viewsFor(label)` before `#navigateInto` on a phone: one view →
   `openView`; several → the close-up on its *open as* page; none → enter.
   A decorated tile on a phone IS an icon that opens a view.
2. **The layer deck.** The bottom bar's chevron row becomes a **Views**
   disc that opens a bottom sheet of big plates (the close-up's
   `APP_PLATE` language, extracted into `presentation/tiles/app-deck.ts` and
   shared by both surfaces): *open as* — the current layer's available
   views from `view-toggles:changed` (default view accented); *add here* —
   the creations `VisualBeeRegistry.forPlatform('mobile')` offers for this
   layer, including the scroller; *see* — the rung (3/2/1), fullscreen,
   pheromones, pin. It is a drone-contributed shell surface (custom element
   via `@hypercomb.social/ShellSurfaceRegistry`), never a tag in `app.html`.

The *see* group also carries **undo · redo** (keymap `edit.undo` /
`edit.redo`) — every phone gesture writes truth (camera, editor, hold-drag,
remove) and the phone had no way back at all — and **library**: a hidden
`<input type=file accept="image/*,video/*" multiple>` that feeds every
picked file through the camera's `createTileFromImage` seam, so a feed can
be FILLED from the phone's photo library, not only from the live camera. The
fullscreen plate is offered only where `document.fullscreenEnabled` is true
(iPhone has no element fullscreen; the button was inert there).

Close-up deck fixes that ride along: creation plates attach the kind to the
tapped tile through `feature:apply` (today they hand the tile NAME to a
slash parser and flip the whole layer into slides mode); a bee may declare
`offersFor(ctx)` so an undecorated branch is OFFERED the scroller under
*open as*; the landscape layout draws one row of plates beside a smaller
hexagon so the dock is never below the fold; the dock plates are named and
the exit glyph is `arrow_back`; page dots and arrows get thumb-sized hit
boxes; the deck page survives a suspend/resume.

## 5. The scroller

A third surface of the slides engine, not a new drone: `scroller`, gated by
the attachable kind `visual:scroller:feed`, registered by
`commands/scroller.queen.ts` (`/scroller`, `opensOnTileClick`,
`offersFor: ctx => ctx.isBranch`, both platforms). It ALWAYS mounts the
native snap scroller (the feed is the point, phone or not), sources the
branch's children with pictures allowed, and gives every child a section:
video links play in place (`playsinline`), images paint, YouTube/Vimeo embed
on tap, and anything else becomes a card (name, tile picture, *open*). The
scroller chrome respects safe areas; a top-left back plate and the hardware
BACK button leave it (see §7).

## 6. Sheets — every tool window fits the phone

One rule set, no template edits, nothing written into the co-agent's
in-flight panel primitive:

- `_toolwindow.scss` `tw.panel` gains a phone block: any docked panel becomes
  a **bottom sheet** — full width, `max-height: min(62vh, 30rem)`, radius on
  the top corners, the grip hidden, `font-size: 1rem` (the width-derived
  `--hc-panel-scale` shrank text exactly when it should grow), thumb-sized
  controls, and `bottom: calc(var(--hc-controls-bottom) + safe)` so the
  bar's discs stay tappable. Panels that should be full pages (chat,
  behaviours review) opt in with `data-hc-sheet="full"`.
- The controls bar publishes `--hc-controls-bottom` (portrait) and stops
  forcing `--hc-controls-left` to 0 in landscape (sheets dock beside the
  rail). It also publishes `--hc-keyboard-inset` from `visualViewport` (no
  listener existed; the iOS keyboard simply covered the bar, GO and every
  sheet). Toasts, the select pill and the preview banner read the same two
  variables instead of guessing a `4rem` / `6.2rem` bar height.
- **Back closes the sheet first.** The Back disc calls
  `@hypercomb.social/ToolWindows.putAwayAll()` (Escape's sweep, parked so
  the put-back still works) before it walks the lineage.
- Per-panel copies of the sheet rule (tags, publish, features geometry)
  are deleted.

## 7. Leaving a view on a phone

`tile-view`'s history trap is generalised into `navigation/view-back.ts`:
when `view:active` goes 0 → 1 a synthetic history entry is pushed, and
`popstate` routes to `BackGesture.backOutOfView()` for the top owner. Every
view — slides, scroller, postit, square-tile, publications, brief, game,
lounge, document, website — answers the hardware BACK button, and the bar
is hidden under a view on touch too (today `.faded` is overridden back to
opacity 1, so the bar paints over takeovers with its buttons live).

## 8. Sharing, replication, adoption on the phone

- **Share shares the tile you tapped.** `share-link.drone` hands
  `[...page, label]` to `hostBranch(segments)`; the stale "run /host again"
  copy goes.
- **Publish's copy-link uses the share sheet** (`deliverLink`), and the
  swarm sheet's share button mints an invite bundle a cold stranger can
  open instead of an address link nothing decodes.
- **The preview banner (Adopt / Dismiss) becomes a bottom sheet** above the
  bar with two full-width buttons.
- **The Share disc** on the bar opens the publish sheet (per-page publish,
  links, community hosts via `/hosts` which is now a sheet by §6); the Swarm
  disc keeps the join sheet.
- Hosts, observe, presence expand as sheets through §6.
- Out of scope, recorded: links that carry code still refuse to fold until
  install-by-replication steps 3/4 land; the WORLD privacy stage stays
  desktop-only for now.

## 9. One definition of "mobile"

`MobileModeService` stamps `data-hc-mobile="on|off"` on `<html>`; the
controls bar and the command line read the service (and its `mobile:mode`
replay) instead of their own media queries, so `/mobile on|off` drives the
whole shell and the bar, the pill, the rails and the deck can never
disagree. `share-link.drone`'s private copy of the predicate (which ignored
the override) reads the service too. `isPhoneViewport()` stays what it is: a
sheet-vs-dock geometry question. Header rail buttons on phones go to 2.75 rem (they were 41.6 px
portrait and 25.6 px landscape); the stale `--hc-header-bottom` left behind
by the hidden landscape header is removed so the landscape rail starts at
the top.

## 10. Proof

`scripts/drive-mobile-rails.cjs` — headed `msedge` (headless has no GPU for
Pixi), 390×844, `hc:mobile-mode=on`, seeds the example hives:

1. Rails by default: `lanes:changed {active:true, lanes:3}` and
   `lanes:viewport {active:true}` with NO `lanes:set`; rendered cells form
   exactly three x-clusters; `PanningDrone.panBy` is LOCKED to Y.
2. A real CDP touch drag (`Input.dispatchTouchEvent`) on the canvas: a
   vertical drag moves `stage.position.y` and not x; a horizontal drag moves
   nothing.
3. Rotate (`setViewportSize` + `orientationchange`): three y-clusters,
   locked to X, the bar on the left; rotate back.
4. Navigate into a child and back: rails persist; the layer's tile `index`
   properties are byte-identical before and after (no commit).
5. `/scroller` on a branch seeded with image and video links through
   `link:intake`: N full-height sections, one flick advances exactly one.
6. A sheet (`tags:view-open`) leaves every bar disc under
   `elementFromPoint`; the Back disc closes it.

Plus vitest: `rail-grid.spec.ts`, `rail-projection.spec.ts`, the existing
lane/arrangement specs, and the doctrine ratchets.

## 11. Deliberate rejections

- **No auto-commit of lanes.** The doctrine stands; the projection makes it
  unnecessary.
- **No per-lineage or per-location rails state.** Rails are a participant
  posture (`hc:rails`, `hc:lane-count`), never tile truth.
- **No second renderer for the phone.** Same hexes, same drones, same
  `axial.items` contract — a different matrix.
- **No `<hc-*>` tags in `app.html`, no hand-listed views** — the deck and the
  Views sheet read the registries.
