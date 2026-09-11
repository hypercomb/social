# Mobile, one column — the phone reads a layer as a list, and every control has a word

Status: **PASS 5 BUILT, 2026-09-10** (Jaime: *"three rows of icons, the
second up from the bottom toggles. The lanes work exactly like they do now
and everything else does as well."*). The phone is three bands: the list
header on top, the page, and the controls bar's two rows at the bottom.
The **header** is ONE row on both faces — back · where I am · `⋯` (the
layer deck, *this page*). The **bottom row** is a flat band flush to the
bottom edge, always there, five labelled cells left→right: **Back · Face ·
Camera · Add · Tools**. **Face**
turns list ⇄ hexagons: it shows the face a tap turns to and asks through
`phone:face-set`; the list owns the face and replays `phone:face`.
**Tools** toggles the **tools row**, a second band directly above it —
**Share · Swarm/Solo · Tags · Pin · Fullscreen** — on the same five
columns, in flow, remembered (`hc:phone-tools-row`). In landscape both
bands turn into a flat rail flush to the left edge, Back at the bottom,
the tools column to its right. The bar's More disc is gone;
More is the header's `⋯`. **This reverses** pass 1's *five discs → three*
(Back · Add · More) and pass 4's list · hexagons switch in the header.
Restyled flat the same day (Jaime, 2026-09-10: *"The mobile icons are just
totally not modern and I feel like I don't really like border radius very
much"*): no borders, circles, drop shadows, press scaling or `pillZoom()`
on a phone — only the pressed/lit highlight behind a cell is rounded, at
`--hc-radius-control`.
Lanes, the Add sheet, the layer deck and its list/lanes plates,
swipe-back, hardware back and *no agents on a phone* are unchanged. Full
shape: §2.1; proof: §8.

Earlier: **PASSES 1 + 2 + 3 BUILT, 2026-09-09.** Pass 3 (live on dev-4254):
**hold → hexagon → swipe to a face** on the tile page — on a phone the
picture rests as a RECTANGLE (`RECT_CLIP`, the same six vertices) and
morphs to the hexagon under the finger in 250 ms (`#holdShape`,
`clip-path` transition, reduced-motion snaps) with the six face captions
fading in; letting go returns it; the swipe-to-face mechanics are the
existing `#bindHexGesture`. **Add inside** plate on the tile page (enters,
then the Add sheet rises). **Row ⋯** → the tile page. **Hold a row** (420
ms) lifts it: drag to reorder — the whole order goes to `MoveDrone
.reorderList` via `move:reorder-list`, the same dense-rank write a rail
drag makes — or let go still and it is the tile page. A sheet popping its
synthetic history entry fires `navigate` with the lineage unmoved: the
list compares segments before going stale. OWED from pass 3: the ROW's
hold-rise variant (thumbnail rising to a ~120 px hexagon with faces under
the finger) — a row hold is reorder-or-page for now.

Earlier: **PASSES 1 + 2 BUILT, 2026-09-09** (see §6 — live on dev-4254 at
375×812: the list, Back · Add · More (superseded by pass 5's two rows),
leaf tap → tile page, the toast,
share + swarm on the deck, first-boot lands inside the seeded hive; the
ADD SHEET with its five doors; More re-worded "this page"; and — pulled
forward from pass 3 at Jaime's ask — **list · hexagons as ONE selector**:
choosing the hexagons (the lanes) puts the list away, and the deck's
`list` plate is the way back; `hc:phone-face`, published as `phone:face`,
set through `phone:face-set` — since pass 5 the bar's Face cell asks the
same door). Pass 3 (hold → hexagon → swipe, reorder,
Add inside, row ⋯) designed, not built.

**Pass 2 lives in** `presentation/tiles/add-sheet.drone.ts`
(`hc-add-sheet`, order 710, z 100003, spec `add-sheet.spec.ts`): name it →
`command:create-cells` (the create queen's door — NOT the command line's
stance-dependent submit, where a bare word became `/word`), reserved
words refused in place; URL → `link:intake`; `/x` → `command:submit` (a
new command-line door that runs `#submitAsEnter`); camera →
`camera:capture-open`; library → `ImagePasteWorker.createTileFromImage`;
paste a link → the clipboard inside the tap; say it → `VoiceInputService`
with the interim words in the field. It reports `add:sheet-state` so the
bar's disc is lit while it is up, and closes the deck as it opens. Supersedes the phone's *reading surface*
in `mobile-rails-projection.md` (the rails). Everything else that doc
built — the sheets, the app-deck plate language, `link:intake`,
`deliver-link`, one definition of mobile, hardware BACK — stays and is
reused here.

**Where pass 1 lives:** `presentation/tiles/layer-list.drone.ts`
(`hc-layer-list`, shell surface order 300, z 59990 — level with the
close-up, over the Pixi host; spec `layer-list.spec.ts`);
`controls-bar` mobile block (three discs — two flat bands of five labelled cells since pass 5; the composer collapses in both
orientations, Add reveals it with focus, GO collapses it);
`_header-bar.scss` phone block (`.header-bar{display:none}` +
`.input-open`); `activity-log` (`isMobile` → newest-only, 4 s,
`:host-context([data-hc-mobile='on'])`); `layer-deck` (share + swarm
plates; `mesh:leave` is the shell's new effect-door toward private, in
`controls-bar`); `example-hives.worker` (phone → `goRaw([name])` after a
committed adopt). Pass 1's Add is the composer: naming only — the camera,
library and link doors stay on the deck until the Add sheet (pass 2).

## 0. The verdict on the hexagons

Jaime, 2026-09-09: *"our mobile experience is not usable. I'm not even sure
the hexagon view is usable on a mobile — maybe with the three lanes as the
default — but if it's not usable it's not usable, so it has to be usable."*

Three lanes IS the default today (rails, since 2026-09-01), and it is still
not usable. So the rails were not the fix. First screen of a fresh phone
after "Add +" on Honey Garden, seen live on dev-4254 at 375×812:

- **twelve interactive controls** — *share intent…*, Beehaviors, Chat,
  writing, pheromone panel, hold-to-speak, GO, back, views, camera, share,
  solo — around **one** tile;
- that tile is a lone hexagon floating in a beige void, its name in 10 px;
- an activity log of seven `+ added "…"  ×` rows lying across the hive;
- nothing on the screen says *tap this to go in*.

The hexagon grid is a **map**: its value is seeing many things at once and
where they sit. A phone is 375 px wide. Three across is the ceiling, and at
three across a hexagon has room for a picture OR a name, not both, and a
quarter of the width is lost to the points. One across is a list wearing
hexagonal frames — two tiles per screen. A sparse layer (the root, with its
one container tile) is a void with a logo in it. **The hex grid fails as a
directory on a phone, and a directory is what a layer mostly is.**

So: **the phone's default reading of a layer is a LIST.** The hexagon stays
as the tile's *thumbnail* (identity kept) and as an optional *grid* face
for picture-heavy layers, one tap away. This is the pattern every phone
user already has in their thumb — Files, Photos, Notes, Reddit: a list of
rows, tap to open, ‹ to go back, one + to add.

## 1. The one idea

**One column. Three verbs. Every control has a word.**

- **Open** — tap a row. A branch opens its list; a leaf opens its page.
- **Back** — the ‹ button, the hardware back, the left-edge swipe. All the
  same door (`BackGesture.resolve`).
- **Add** — one big `+ Add` button. Name it, photo, library, link, voice —
  one sheet, five doors, all of which already exist as seams.

Everything else — share, swarm, views, undo, pheromones, lanes, fullscreen,
pin, language — lives under ONE `⋯ More` on the title bar and ONE `⋯` on
each row. Nothing is hidden behind a hover, a hold, or a slash command on
the phone; a hold is a *shortcut* to the row's `⋯`, never the only door.
(Pass 5, 2026-09-10: the face and the camera have their own cells on the
bar, and share, swarm, tags, pin and fullscreen also stand on its tools
row, one Tools tap away — §2.1.)

## 2. The four screens

### 2.1 The layer (default)

```
┌──────────────────────────────────────┐
│ ‹           honey-garden           ⋯ │  title bar: back · where I am · more
├──────────────────────────────────────┤
│ ⬡ sunrise                          › │  row = the tile: hex thumbnail, name,
│   a warm one, taken…                 │  one-line note peek, › if it has children
│ ⬡ meadow                             │
│ ⬡ comb                             › │
│ ⬡ bloom                      ▶ video │  leaf rows say what they hold
│ ⬡ dusk                       🔗 link │
│ ⬡ pollen                             │
│                                      │
├──────────────────────────────────────┤
│ share   solo    tags  pin fullscreen │  tools row: Tools opened it, and it stays
│  back hexagons camera add    tools   │  bottom row, always there (Face says hexagons)
└──────────────────────────────────────┘
```

Rules: rows are ≥ 56 px tall, name ≥ 1 rem, 8–9 rows per screen, native
scroll (momentum, rubber-band, scrollbar), no pinch, no pan. **Every row
is two lines** — the name on the first, the note peek (or what the leaf
holds) on the second — vertically centred as a pair beside the thumbnail;
never name and note on one line (Jaime, 2026-09-09). Each line is ONE
line: overflow clips with an ellipsis (`text-overflow: ellipsis`), never
wraps, never runs under the ›. A layer with
zero tiles shows one sentence and the `+ Add` button — never a void. The
title is the tile's name; tapping it drops the *path* as a list (root →
here) — tap any ancestor to jump. The bar's **Face** cell swaps the same
rows for a 3-across grid of picture hexagons (the existing rails
projection, kept exactly as built) — for looking, not for finding.

**The header is the same on both faces** (Jaime, 2026-09-10: "in portrait
mode in hexagon view there's no way back unless you go into landscape…
always have the top and bottom in portrait"). The title bar — back · where
I am (tap → the path) · more — is ONE row, and it stays on screen whichever
face is showing. Since pass 5 the list · hexagons switch is not in it; that
is the bar's Face cell. On the hexagons face the list element IS that
header and nothing more, and it hands its strip to the canvas owner
(`viewport:inset`, owner `layer-list`, side `top`), so the hexagons are
laid out below it, never under it.

**The bar is two flat bands on one five-column grid** (pass 5, Jaime,
2026-09-10: *"five across the bottom and then there was a raised menu…
the bottom left most is the back button"*). The **bottom row** is a flat
band flush to the bottom edge — full width, the chrome glass, one hairline
on top, padded by the safe area — always there, five labelled cells
left→right: **Back · Face · Camera · Add · Tools**. *Face* shows the face
a tap turns to (it reads `hexagons` on the
list, `list` on the hexagons) and only asks, through `phone:face-set`;
the layer list owns the face and replays `phone:face`. *Camera* is the
centre cell — the viewfinder, whose shutter makes a tile here, one tap
again. *Add* is the Add sheet, unchanged (it keeps its own photo door).
*Tools* toggles the **tools row**, a second band directly above with one
hairline between — **Share ·
Swarm/Solo · Tags · Pin · Fullscreen**, where Tags is the pheromone panel
and Fullscreen stands only where the browser supports fullscreen (its
column stays empty otherwise). The choice is remembered
(`hc:phone-tools-row`) and no tap elsewhere closes it. Each tool stands
over a column of the row below, and every cell is a glyph over its word —
no border, circle, drop shadow or press scaling; the only rounded pixels
are the pressed/lit highlight behind a cell, at `--hc-radius-control`.
Both rows are IN FLOW in the bar, so `--hc-controls-bottom` grows with the
tools row and nothing is covered. The bar's More disc is gone; More is the
header's `⋯`.

**In landscape the bands turn into columns**: a flat rail flush to the
left edge. The edge
column reads top→bottom Tools · Add · Camera · Face · Back — Back in the
bottom-left corner — and the tools column stands to its right, slot for
slot; `--hc-controls-left` reserves both, so header and rows start to
their right. Words are capped to the column pitch (3.75rem) with an
ellipsis. While the command line is open on a landscape phone the words
stand down and the gaps close so the column fits under it — any landscape
viewport at least 296 px tall.

**One tap, one meaning, on both faces.** A tap on a branch HEXAGON goes
inside — the same door its row opens — and a leaf hexagon opens its tile
page; a branch's page is still one hold or its row's `⋯` away. "Add a
tile", wherever a phone offers it (the welcome card, an empty page), opens
the Add sheet — never the command line. **No agents on a phone:** no bees,
no agent icon on tiles, no agent window, no show/hide agents button.

### 2.2 The tile page (a leaf, or a branch's `⋯`)

The existing close-up (`tile:view-open`, `app-deck.ts`), unchanged in
language, promoted to be *what a leaf tap opens* — never an empty layer.

```
┌────────────────────────────┐
│ ‹  sunrise                 │
│ ┌────────────────────────┐ │
│ │      [ picture ]       │ │  big; tap = full screen (PhotoView)
│ └────────────────────────┘ │
│ note text, readable,       │
│ scrolls if long            │
│                            │
│ [ ▶ Play ] / [ 🔗 Open ]   │  the one thing this tile does, big
│                            │
│ ⬡ Add inside   ✎ Edit      │  plates, 4 across, the app-deck language
│ 🔗 Share       🗑 Delete   │
└────────────────────────────┘
```

`Add inside` is how a leaf becomes a branch. The "tap a leaf enters an
empty layer" dead end is gone.

### 2.3 The Add sheet (`+ Add`)

```
┌────────────────────────────┐
│ Add to honey-garden        │
│ [ name it… ______________ ]│  the composer (the command line, here)
│ 📷 Take a photo            │  hc-camera-capture
│ 🖼  Photo library           │  hidden multi-file input (layer deck's)
│ 🔗 Paste a link            │  link:intake — the full unfurl pipeline
│ 🎤 Say it                  │  the mic that lives in the command line
└────────────────────────────┘
```

Enter adds and keeps the sheet open (memory: ENTER = complete + send).
`/` still works in the field for anyone who knows the language; nothing on
the phone *requires* it.

### 2.4 The More sheet (title bar `⋯`)

Named for what it holds: **This page.**

```
│ Share this page            │  publish:view-toggle (the publish sheet)
│ Open as …  › slides feed…  │  view-toggles:changed (the layer deck's group)
│ Show as hexagons / list    │  the ▤/▦ toggle, worded — also the bar's Face cell
│ Swarm: off  ⟶ on           │  mesh public
│ Undo · Redo                │
│ Pheromones                 │
│ Language · Settings        │
```

This IS the layer deck (`hc-layer-deck`) with its three groups re-worded —
*add here* moves to the Add sheet; *open as* and *see* stay. Since pass 5
it opens only from the header's `⋯`; the bar's More disc is gone.

## 3. Gestures — the whole phone grammar

| Gesture | On a row | On the title bar | Word on screen |
|---|---|---|---|
| tap | open (branch → list; leaf → tile page) | name → path list | — (it is the row) |
| `⋯` / long-press | tile page | More sheet | `⋯` |
| long-press + drag | reorder (`MoveDrone` dense ranks) | — | — |
| `‹` / hardware back / edge swipe | — | up one layer; closes a sheet first | `back` |
| `+ Add` | — | Add sheet | `Add` |

That is the complete list. Pinch, pan, double-tap, two-finger anything: no
meaning on the phone. (They keep their meaning in the hex grid face.)

## 4. What leaves the phone's screen, and where it goes

| Today (12 controls) | Becomes |
|---|---|
| *share intent…* command line + GO, top of screen | the Add sheet's name field; `/` still parsed |
| Beehaviors · Chat · writing · pheromones · mic strip | More sheet (chat, writing, pheromones — pass 5: also *tags* on the tools row); mic → Add sheet; Beehaviors → tile page's plates |
| activity log rows over the hive | ONE toast: `added "sunrise" · undo`, gone in 4 s |
| bar: back · views · camera · share · solo | bar: two flat bands of five labelled cells — **Back · Face · Camera · Add · Tools**, and the tools row **Share · Swarm · Tags · Pin · Fullscreen** that Tools toggles (pass 5; pass 1 had made it Back · Add · More) |
| views disc → layer deck | `⋯ More` (same element, re-grouped) — the header's `⋯` |
| camera disc | inside Add — and, since pass 5, the bottom row's centre cell again |
| share disc | inside More (and on every tile page); pass 5: the tools row |
| solo/swarm disc | inside More, worded `Swarm: off / on`; pass 5: the tools row, worded `solo` / `swarm` |
| lanes rung, fullscreen, pin | More → only in the hex-grid face; pass 5: pin and fullscreen on the tools row |
| breadcrumb (faded on phones) | the title, and the path list under it |

## 5. Buildable from what exists

The list is a **DOM shell surface, phone-only, registry-fed** — a custom
element over IoC (`ShellSurfaceRegistry`), never a tag in `app.html`.

- **Rows** come from the replayed `render:cell-count` — it already carries
  `labels`, `branchLabels`, `linkLabels`, `noImageLabels`, `hiddenLabels`,
  `flatPaths`. Note peeks and pictures through the same seams
  `scroller-sections.ts` reads for the feed.
- **It is the phone's canvas, not a view.** It never enters `view:active`
  (BACK must go up a layer, not "leave the list"). When
  `MobileModeService.active` and the ▤ face is chosen (since pass 5, by the
  bar's Face cell), the Pixi stage is
  not painted for the layer (it still runs; `render:cell-count` is what
  feeds the rows). ▦ paints it — the rails, exactly as built.
- **Open** = the navigation door a hex tap already uses; **leaf → page** =
  `openTileMenu(label)` (the `usesTileCloseUp` branch, today's hold).
- **Add sheet** = the composer (`command-line` in its sheet posture) + the
  layer deck's camera/library plates + `link:intake` + the mic.
- **More** = `hc-layer-deck`, groups re-worded, opened by the header's `⋯`.
  **The bar** = the controls bar's mobile block: two flat bands of labelled
  cells on one five-column grid — Back · Face · Camera · Add · Tools, and
  the tools row
  (Share · Swarm · Tags · Pin · Fullscreen) that Tools toggles, both in
  flow (pass 5; pass 1 had taken it from five discs to three, Back · Add ·
  More).
- **Toast** = the activity log with a phone rule: one row, auto-dismiss,
  keep `↩`.

Nothing here writes truth by looking. The list reads `index` order the
same way the spiral and the rails do.

## 6. Build order

1. **The list + the three-button bar + leaf-tap-opens-page.** Rows, ›,
   note peek, thumbnail, empty-layer sentence, path list under the title.
   Activity log → toast. First-boot "Add +" lands *inside* the seeded
   hive, not at the root's lone tile. (This pass alone is the usability.)
   Pass 5 (2026-09-10) turned the three-button bar into two flat bands of
   five labelled cells —
   §2.1.
2. **Add sheet** (fold camera, library, link, mic and the composer into
   one) and **More** (re-word the deck; swarm and share move in).
3. **Hold → hexagon → swipe to a face** (Jaime, 2026-09-09): at rest a
   picture is a rectangle (every pixel to the picture, the text under it
   keeps its room). With a finger on it, it rises and its sides shade in to
   a hexagon over ~0.25 s (`clip-path` polygon transition, six points both
   shapes; `prefers-reduced-motion` snaps), and the SIX FACES light up
   around it with their words. Swipe toward a face and release = that
   face's action — same face on the same edge as the desktop close-up.
   Release without a swipe = nothing on the tile page, the tile page from a
   row. Tile page first (room for six labels); rows second — the small
   thumbnail rises to a ~120 px hexagon under the finger before the swipe.
   Never hexagon-by-default on the tile page.
   Then: **▤/▦ toggle** to the rails face (since pass 5, the bar's Face
   cell); long-press-drag reorder in the
   list; tile page's `Add inside`; row `⋯`.

## 7. Deliberate rejections

- **No second data model.** Rows are the layer's `index` order; the list is
  a third *reading* beside spiral and rails.
- **No hexagon-shaped rows.** The hex is the thumbnail. A one-lane hex
  column was tried by implication (rails at rung 1) and is a bad list.
- **No hidden-only gestures.** Every hold/swipe has a visible `⋯`/`‹`.
- **No desktop chrome on the phone.** The command line strip, the activity
  log, the solo disc do not appear on the default screen. (Pass 5 reverses
  this for the solo disc: Swarm/Solo stands on the tools row, one Tools tap
  away, remembered open or closed.)
- **No tablet change.** 600–1024 px keeps the hex canvas; the list is
  `data-hc-mobile='on'` only — one definition of mobile stands.
- **No new `__x__` dir, no per-lineage list state.** ▤/▦ (the bar's Face
  cell since pass 5) is a participant posture like `hc:rails`.

## 8. Proof (the harness must show)

`scripts/drive-mobile-list.cjs` (planned, never committed — the recorded walk-through below is the harness that exists), headed msedge, 375×812, inside
honey-garden: (1) six rows, names ≥ 16 px, `›` on branches only;
(2) tap `sunrise` → tile page, not a layer; (3) `‹` → the list;
(4) the bar's two flat bands — Back · Face · Camera · Add · Tools, and the
tools row Share · Swarm · Tags · Pin · Fullscreen over the same columns,
every cell labelled — with `elementFromPoint` hitting each cell at its
centre and the Add sheet overlapping neither row; (5) `+ Add` → type
`pollen-2` → Enter → seventh row, toast, `cell:reorder` 0×; (6) the Face
cell → rails [3,3], the Face cell again → rows; (7) root shows `honey-garden ›`, never
a void.

**The whole phone, recorded** — `scripts/drive-mobile-walkthrough.cjs
--port <own dev port> --out <scratch dir>` walks 29 steps in portrait
(375×812) and again in landscape (812×375), each in a fresh touch context
with mobile mode on and a fake camera, and writes a numbered PNG, a
`steps.json` row of measured facts and a `.webm` per orientation. The
facts cover the list header, the bar, the sheets, the tile page, the
command line, the canvas top and agents, and name the bar outright:
`faceBtn`, `cameraBtn`, `toolsBtn`, `toolsRow`, `toolsOpen`, `faceGlyph`;
`bottomOrder` (the bottom row's reading order — by x in portrait,
top→bottom in landscape); `toolsOver` (which bottom cell each tool lines
up with); `hits` (whether each visible cell is pressable at its centre — a
disabled cell reports `'disabled'`); `sheetClearsRows` (the Add sheet
overlaps neither row); and `viewfinder` (the camera video's size). Run it
BEFORE a phone change and AFTER; the step log is the pass/fail, the frames
and videos are the review. It must show: a top and a bottom on every list
and hexagons step; the Face cell turning the hexagons back to the list; a
branch hexagon tap landing inside; "Add a tile" opening the Add sheet; the
tools row opening and closing with the Add sheet clear of both rows; the
camera opening a viewfinder and closing; no agent icon and no agents
toggle on any step.
