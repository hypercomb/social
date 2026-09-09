# Mobile, one column — the phone reads a layer as a list, and does three things

Status: DESIGN, 2026-09-09. Supersedes the phone's *reading surface* in
`mobile-rails-projection.md` (the rails). Everything else that doc built —
the sheets, the app-deck plate language, `link:intake`, `deliver-link`,
one definition of mobile, hardware BACK — stays and is reused here.

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

## 2. The four screens

### 2.1 The layer (default)

```
┌────────────────────────────┐
│ ‹      honey-garden      ⋯ │  title bar: back · where I am · more
│                    ▤ ▦     │  list ⇄ grid toggle (list default)
├────────────────────────────┤
│ ⬡ sunrise                › │  row = the tile: hex thumbnail, name,
│   a warm one, taken…       │  one-line note peek, › if it has children
│ ⬡ meadow                   │
│ ⬡ comb                   › │
│ ⬡ bloom            ▶ video │  leaf rows say what they hold
│ ⬡ dusk             🔗 link │
│ ⬡ pollen                   │
│                            │
├────────────────────────────┤
│           [ + Add ]        │  one primary action, dead centre
└────────────────────────────┘
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
here) — tap any ancestor to jump. The ▤/▦ toggle swaps the same rows for
a 3-across grid of picture hexagons (the existing rails projection, kept
exactly as built) — for looking, not for finding.

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
│ Show as hexagons / list    │  the ▤/▦ toggle, worded
│ Swarm: off  ⟶ on           │  mesh public
│ Undo · Redo                │
│ Pheromones                 │
│ Language · Settings        │
```

This IS the layer deck (`hc-layer-deck`) with its three groups re-worded —
*add here* moves to the Add sheet; *open as* and *see* stay.

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
| Beehaviors · Chat · writing · pheromones · mic strip | More sheet (chat, writing, pheromones); mic → Add sheet; Beehaviors → tile page's plates |
| activity log rows over the hive | ONE toast: `added "sunrise" · undo`, gone in 4 s |
| bar: back · views · camera · share · solo | bar: **Back · Add · More** (three, labelled) |
| views disc → layer deck | `⋯ More` (same element, re-grouped) |
| camera disc | inside Add |
| share disc | inside More (and on every tile page) |
| solo/swarm disc | inside More, worded `Swarm: off / on` |
| lanes rung, fullscreen, pin | More → only in the hex-grid face |
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
  `MobileModeService.active` and the ▤ face is chosen, the Pixi stage is
  not painted for the layer (it still runs; `render:cell-count` is what
  feeds the rows). ▦ paints it — the rails, exactly as built.
- **Open** = the navigation door a hex tap already uses; **leaf → page** =
  `openTileMenu(label)` (the `usesTileCloseUp` branch, today's hold).
- **Add sheet** = the composer (`command-line` in its sheet posture) + the
  layer deck's camera/library plates + `link:intake` + the mic.
- **More** = `hc-layer-deck`, groups re-worded; **Back · Add · More** =
  the bar's mobile block, five discs → three.
- **Toast** = the activity log with a phone rule: one row, auto-dismiss,
  keep `↩`.

Nothing here writes truth by looking. The list reads `index` order the
same way the spiral and the rails do.

## 6. Build order

1. **The list + the three-button bar + leaf-tap-opens-page.** Rows, ›,
   note peek, thumbnail, empty-layer sentence, path list under the title.
   Activity log → toast. First-boot "Add +" lands *inside* the seeded
   hive, not at the root's lone tile. (This pass alone is the usability.)
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
   Then: **▤/▦ toggle** to the rails face; long-press-drag reorder in the
   list; tile page's `Add inside`; row `⋯`.

## 7. Deliberate rejections

- **No second data model.** Rows are the layer's `index` order; the list is
  a third *reading* beside spiral and rails.
- **No hexagon-shaped rows.** The hex is the thumbnail. A one-lane hex
  column was tried by implication (rails at rung 1) and is a bad list.
- **No hidden-only gestures.** Every hold/swipe has a visible `⋯`/`‹`.
- **No desktop chrome on the phone.** The command line strip, the activity
  log, the solo disc do not appear on the default screen.
- **No tablet change.** 600–1024 px keeps the hex canvas; the list is
  `data-hc-mobile='on'` only — one definition of mobile stands.
- **No new `__x__` dir, no per-lineage list state.** ▤/▦ is a participant
  posture like `hc:rails`.

## 8. Proof (the harness must show)

`scripts/drive-mobile-list.cjs`, headed msedge, 375×812, inside
honey-garden: (1) six rows, names ≥ 16 px, `›` on branches only;
(2) tap `sunrise` → tile page, not a layer; (3) `‹` → the list;
(4) three labelled bar buttons, `elementFromPoint` hits each with the Add
sheet open; (5) `+ Add` → type `pollen-2` → Enter → seventh row, toast,
`cell:reorder` 0×; (6) ▦ → rails [3,3], ▤ → rows again; (7) root shows
`honey-garden ›`, never a void.
