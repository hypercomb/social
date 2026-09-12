# The tile editor

The panel where one tile is given its picture, its framing, its rim colour,
whether its name shows over the picture, its link, and answers to its open
questions. Opened by the pencil on a tile, `e` over a tile, a picture dropped
or pasted onto a tile, a link dropped while it is open, a `[Q]` note, and the
close-up's Edit face — all through one door, `tile:action { action: 'edit' }`.

## It fits into the view

The editor is never a popup. There is no scrim and the hive is never hidden,
because a crop, a rim colour and a name are judged against the tiles around
them.

| Screen | Surface |
|---|---|
| Desktop, laptop, tablet in either orientation | **Docked** to the right, in the right-hand lane like every tool window. It reserves its edge (`viewport:inset`, owner `tile-editor`), so `#pixi-host` shrinks and the hive re-fits beside it. |
| Phone (either axis phone-shaped), mobile mode, or a window too narrow to spare 360px of hive | **Page** — full height above the control bar, which stays tappable. Landscape splits into two columns. |

`editor/editor-surface.ts` holds the one rule. Crossing it while open (a window
narrowed, a phone rotated) rebuilds the view; nothing is lost, because the
session lives in the services.

**Seamless.** The pane has no border, no shadow and no frame. Its ground is the
page's own ground (`--md-surface`) laid translucent over a soft blur, so beside
the hive it reads as more of the same surface and a drawn backdrop carries
through. Regions are separated by tone, never by lines. Outside the tile's
hexagon the picture fades into that ground and is gone by the stage's corners.
Every colour is a role (`documentation/tool-window-colour-roles.md`); the
identity is the rim's gold, taken deep under a bright look.

## Anatomy

1. **The name** — the heading is the rename field (the tile's reading in the
   current locale; the tile itself never moves). Enter commits it.
2. **The stage** — the original picture under the tile's own look: rim, inner
   glow, vignette, bevel, name band and name, placed from the shader's numbers
   (`presentation/grid/tile-look.ts`, pinned to `hex-sdf.shader.ts` by a drift
   spec). Empty, it is the tile's own ground with Upload and Camera.
3. **Fill | Fit**, a logarithmic zoom (100% = exactly fills), reset.
4. **The two shapes** — point-top and flat-top as thumbnails of the exact bytes
   a save will write, with a link between them (frame both together, or each
   apart). **Sources** — upload (library on a phone), camera, image search,
   remove picture.
5. **Look** — rim colour (unset shows the default and never writes it), name
   shown over the picture, and — only for a picture set to Fit — a fill behind.
6. **Link**, checked by `LinkSafetyService` on blur; the verdict is text, not a
   tooltip.
7. **Questions** — `[Q]` notes with an answer field.
8. **Cancel · Save** (Done when nothing changed). On a phone, Save sits in the
   header.

## Gestures

| Input | Does |
|---|---|
| Drag | Pan. The pointer is captured, so releasing outside the stage ends it. |
| Two fingers | Zoom about their centroid and carry the picture; lifting one continues as a pan with no jump. |
| Wheel / trackpad pinch | Zoom about the cursor. |
| Double-click / double-tap | Toggle between filling and twice filling, about the point. |
| Arrows (Shift = ×10), `+` `-`, `0`, `F` | Pan, zoom, reset, Fit — while the stage has focus. |
| Ctrl/⌘+Enter, Enter on the stage | Save. Enter in a field commits the field. |
| Escape | One level at a time: camera → rename → link warning → field → the editor. |
| Right-click | Back out (the BackGesture service). |

Past a limit a gesture shows a share of the overshoot and settles back. In
**Fill** the picture always covers the hexagon, so no background can ever show
at an edge. **Fit** lets the whole picture sit inside.

While the editor holds focus the hive's keyboard shortcuts stand down
(`keymap:suppress`), so Enter never also pastes and an arrow never walks the
hive. The hive's own zoom and pan stay locked (`InputGate 'editor'`) while a
session is open.

## Purity — what a save writes, and what it never writes

| Field | Value |
|---|---|
| `large.image` | The original bytes, **byte for byte**. A desktop viewfinder shot is the full video frame, encoded once. |
| `large.{x,y,scale}`, `flat.large.{x,y,scale}` | The framing per orientation, clamped. |
| `small.image`, `flat.small.image` | Captured off screen from the original by `editor/hex-capture.ts`. |
| `border.color`, `background.color`, `hideText`, `link` | Only what the session holds. Nothing is stamped on open. |

**Never written:** a rim, glow, vignette, bevel, band or name; the outside fade;
a default colour; a strip of background along an edge. `hex-capture.ts` has no
stroke to draw, the capture box is whole pixels (346×400 / 400×346, not
346.41), the canvas is transparent until the picture lands, and the only other
paint it can apply is the participant's own fill behind a Fit picture. Large
photos are stepped down by halves before the final draw, so the small pictures
are not aliased. `hex-capture.spec.ts` records every canvas call and fails if a
capture ever strokes, fills or writes text.

The same capture is used by the heal pass (`substrate/tile-small-render.ts`) and
by dropped and pasted pictures (`editor/resource-thumbnail.ts`), so a tile looks
the same whichever door gave it its picture, and opening it in the editor and
saving without a touch changes nothing.

**A save that changes nothing writes nothing** — no layer, no history entry, no
`tile:saved`. A save re-captures from the original, so pressing Save on an older
tile whose small pictures had a rim baked in writes clean ones; nothing is
rewritten in the background.

**A tile with no original** (only small pictures) cannot be re-framed; the
editor says so and keeps them as they are.

## Live in the hive

While a tile is being edited, its hexagon in the hive shows the edit as it
happens — a new picture or none, the framing, the rim colour, whether the name
shows — beside the docked editor. Nothing is written.

- The view sends `tile:preview` with `EffectBus.emitTransient` (no replay):
  `{ label, page, point?, flat?, removed, border, hideText }`, or
  `{ label, clear: true }` when the editor closes. `point` / `flat` are the
  twins' captures — the exact small pictures a save would write — with their
  signatures.
- `ShowCellDrone` paints it onto that one tile with attribute writes
  (`aImageUV`, `aHasImage`, `aBorderColor`, `aLabelUV`), the same way a saved
  change is painted in place. It is **never written into a cache**: the caches
  keep describing what is stored, so ending a preview is a repaint from them,
  and a full render re-applies the preview on top. The preview's pictures are
  pinned in the atlas so nothing evicts them mid-edit.
- Tile names are DOM text: `nameHidden(label)` answers from the preview, and
  `render:name-visibility` tells `TileNameDrone` to re-ask.
- **No flash on Save.** The capture is deterministic, so the saved small
  pictures have the preview's signatures and are already on the GPU when the
  save's render asks for them. The preview's end is deferred one turn and
  skipped when `tile:saved` for that tile arrives in it.
- Framing reaches the hive when a gesture settles (the twins' capture, ~0.2s),
  not on every pointer move — the hive shows exactly what would be saved.

## Moving to another tile

Docked, the hive beside the editor stays live for one gesture: **click another
tile and the editor moves there**. The pointer is a hand over the tiles it can
move to; the tile being edited and empty hive do nothing. `e` over another tile
does the same, when the focus is in the hive. On a phone the page covers the
hive, so this never arises.

- **Nothing changed** — it just moves. It is the same window: its width, the
  hive's reserved edge and the hive's fit do not move, and nothing is rebuilt.
- **Unsaved changes** — the footer asks in place of Cancel and Save:
  *Save your changes before opening "name"?* **keep editing** · **don't save** ·
  **save and open**. Save and open holds the focus; Escape is keep editing.
  - *save and open* writes the tile first and moves only when the write lands;
    a failed save stays put with its error.
  - *don't save* keeps the draft exactly as a cancel keeps it, and reopening
    that tile offers **Restore**.

How it is wired:

- `TileOverlayDrone` answers a plain click while a session is docked
  (`editor:mode` with `surface: 'dock'`) by resolving the tile under the click
  and, when it is another tile, emitting `editor:switch-request { label }` with
  `emitTransient`. The press never navigated — it stands down while editing.
- The view decides: clean ⇒ `TileEditorDrone.switchTo(label)`; dirty ⇒ ask.
  `switchTo(label, { save })` writes (and announces `tile:saved`) before
  opening the next tile, and opens it **without** stashing a draft it just
  saved.
- The service is re-opened under the mounted panel; the view sees the target
  change and **retargets** — ends the last tile's preview, drops its twins,
  camera, link verdict, answer drafts and name, then syncs to the new tile.
  While a move is in flight the preview stands down, so neither tile is painted
  with the other's look.
- `ShowCellDrone` puts the tile that was left back from its caches unless a
  save for it just landed — a preview of a *different* tile arriving in the
  same turn no longer cancels that repaint, and the repaint keeps the next
  tile's preview pictures pinned. An earlier save stops protecting a tile once
  that tile is previewed again.
- Escape is heard first by the hive's keymap (window, capture — Escape pierces
  its suppression), which unwinds the editor one level through
  `dismissInner()`. The panel's own Escape handler stands down when the keymap
  has taken the press (`defaultPrevented`), or one press would unwind two
  levels and close the editor.

## The framing numbers

Unchanged from every framing already stored (`editor/crop-math.ts`):

- the **frame** is a square of `side × 2` units (400);
- `x`, `y` are the picture centre's offset from the frame centre;
- `scale` is how many frame units one pixel of the original covers.

Absent framing means the default: centred, covering the frame square (which
covers both orientations). The attach doors used to write `{ x: 0, y: 0,
scale: 1 }` as a placeholder; `readFraming` reads that exact triple as "never
framed" instead of "native pixel size", and the doors no longer write it.

A **new picture** resets both orientations' framing — keeping the previous
picture's numbers is how a replaced picture came to be saved as a postage stamp
in whichever orientation nobody was looking at. **Only the latest load lands**:
each decode carries a generation number and a stale one is dropped and closed.

## Files

| File | Role |
|---|---|
| `editor/tile-editor.view.ts` | The `hc-tile-editor` element: dock/page, fields, keys, window session, edge reservation, camera, restore. |
| `editor/tile-editor.styles.ts` | The material, as roles. |
| `editor/crop-stage.ts` | The stage and its gestures. |
| `editor/tile-look-overlay.ts` | The tile's look over the picture (display only). |
| `editor/crop-math.ts` | Pure framing maths, shared by the stage and the capture. |
| `editor/hex-capture.ts` | The one capture. |
| `editor/image-editor.service.ts` | The picture model: original, framing per orientation, Fill/Fit, linking. No Pixi. |
| `editor/tile-editor.service.ts` | The session: properties, baseline, saving state, a one-slot stash of a discarded draft. |
| `editor/tile-editor.drone.ts` | Opening, saving, and moving to another tile. |
| `editor/editor-surface.ts` | Dock or page. |
| `presentation/grid/tile-look.ts` | The shader's look constants. |

The Angular `hc-tile-editor` component in `hypercomb-shared` is gone; the
element is contributed through the ShellSurfaceRegistry (`element:` shape,
order 220). An older shell that still registers the Angular component keeps it
— the element stands down.

## Contracts kept

- IoC keys and method shapes of `TileEditorService`, `ImageEditorService`,
  `TileEditorDrone`; `tile:saved { cell, segments }` only after a write.
- `editor:mode` still fires on open and close; it now carries
  `{ surface, label, segments }`. Only a payload **without** `surface` (an old
  modal) hides the hive or paints the editor wash.
- The close-up stays suspended while a session is open.
- A discarded changed draft (Escape, close, a sweep, another tile opening, a
  move with *don't save*) is kept once, in memory; reopening that tile offers
  **Restore**.
- Window id `tile-editor`: its text size is `hc:panel-text:tile-editor`, set
  from the docked-panel gear.

## Proving it

```bash
npx vitest run hypercomb-essentials/src/editor hypercomb-essentials/src/presentation/grid/tile-look.spec.ts
# tile-editor.switch.spec.ts covers moving: clean, asked, each answer, Escape, a failed move
node scripts/drive-toolwindow-contrast.cjs --url http://localhost:4251 --engine msedge --themes honey,light,sherbet,dark
node scripts/drive-text-size.cjs
```

Phone and tablet work is proven by a recorded walk-through, before and after,
in portrait and landscape (see `feedback-mobile-walkthrough-proof`).
