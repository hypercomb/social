# The tile editor

The desk where one tile (or several together) is given its picture, its
framing, its border colour, the fill behind the picture, whether its name shows
over the picture, its name, its link, and answers to its open questions.
Opened by the pencil on a tile, `e` over a tile, a picture dropped or pasted
onto a tile, a link dropped while it is open, a `[Q]` note, and the close-up's
Edit face — all through one door, `tile:action { action: 'edit' }`.

The editor is a technical drawing of ONE tile. The tile is drawn large in the
middle; every editable part has a quiet label (its **tab**) joined to the part
by a thin leader; the tile list is on the left. There is no stacked form and no
permanent column of fields. Hover or focus a part and the part, its leader and
its tab light together.

> Status. The editor is being rebuilt to this shape in a worktree. Where a line
> below says **owed**, the design fixes it but the code has not landed it yet;
> where it says **decision**, it is jwize's to make. Everything else is either
> landed or specified to the signature.

## One surface: the full desktop

There is one surface, laid out like Notes and Chat. The old docked pane and the
phone page are gone (`editor-surface.ts`, `viewport:inset`, the dock grip and
footer, the surface rebuild on resize).

| Edge | Value |
|---|---|
| top | `--hc-safe-top` (the desk has its own header) |
| left | `--hc-controls-left` — the shell rail stays outside the desk |
| right | the larger of `--hc-inset-right` and `--hc-controls-right` |
| bottom | the controls and safe-area insets, plus the mobile row lift — the tools row stays outside |
| ground | `--md-surface`, opaque. No scrim to explain, no blur, no border, no shadow |
| stacking | `z-index: 60001` (the Notes value; the old 100002 hid the command palette) |

The hive is covered while the desk is open, so a change is judged on the tile
itself and in the hive-scale chip beside it, and the hive underneath still
shows the edit live (see *Live in the hive*).

The desk claims `view:keeps-controls` and then `view:active` through
`ModeRegistry` (owner `tile-editor`; release in reverse, `releaseOwner` on
dispose). It never emits `view:active` raw. `BackGesture` is registered under
the same owner. Whether the app header stays over the desk (`view:keeps-shell`)
is a **decision** for jwize; the default is the desk's own slim header.

Everything inside the desk is sized in `em` of its own text size, so larger
text flips the arrangement earlier, by design.

### Wide arrangement

Used when the desk is at least 56.25em wide and the stage can be at least 320
(em-scaled) pixels across.

- **Header**: the tile's **stored** reading, the quiet address, the word *edits
  the original* when the edit goes through a Portal, *unsaved* (a hollow dot and
  *saved* for a moment after a save), close, and Save — the only filled control
  (Done when nothing changed, *saving…* and disabled while a name is pending).
- **List** on the left: wide (full names), mid, or faces only, by the desk's
  width.
- **Centre**: the tile (the **stage**, a square), tabs and cards in columns
  either side, leaders between, the picture toolbar under the tile, the hive
  chip bottom-left, the model tag top-left, notices as an overlay at the top.

The stage size is one number shared by the art, the lit layer, the name input
and the camera, computed in `diagram/layout.ts` from the viewport (minus the
card gutters, the toolbar and a margin above and below, capped at 440
em-pixels). The cap is what keeps the hexagon a specimen: a larger desk gets
margin, not a larger tile, so the labels, the toolbar and the floating tools
row stay on screen. An open card never changes it: cards float over the gutter,
so the tile does not shrink when one opens. The tab columns sit beside the
widest the tile can be (the union of its variants), so tabs never move when
the variant turns.

### Narrow arrangement

Used when the desk is narrower than 56.25em or the stage would be under 320.
It is the **same DOM**, rearranged:

- The list becomes a **drawer** (a rung of the Escape ladder; choosing a row
  closes it). The header gains the drawer toggle.
- The tile is **sticky at the top** (200–280 px, about 30% of the window) so
  the rows under it stay on the screen, and a pinned part stays visible while
  a lower field is edited.
- Tabs become full-width rows of at least 44px, one open at a time, expanding in
  place into their card. The picture toolbar moves into the Picture row's card
  (the same node, moved).
- Leaders, the chip, the model tag and the dimension label are hidden.

The decision is made from the root width **with** the shell strip (so it cannot
flip-flop at its own threshold) and sets `data-layout` only. A flip, a rotation
or a soft keyboard rebuilds nothing: callouts are built once per (model, group),
so a half-typed answer survives. The phone view of the hive is set aside, so
narrow is an arrangement, not a product surface.

## The model in the middle

The hexagon might not be a hexagon forever. The centre renders a **model**, and
the hexagon is the first one. The shell, the lighting, the tab and leader
generation, the group filter, the placement pass, the lists and the name chain
know **parts** and **field kinds** only. They never know a vertex, an apothem,
an angle or the 346×400 box.

A model is one descriptor, a `TileModel` (`editor/models/tile-model.ts`, types
only):

- `geometry(size, variant)` returns a `ModelGeometry`: the outline path, the
  picture mask, whether the picture fades outside the mask, the picture box,
  the outline's horizontal extent, rim and glow widths, where a name sits, what
  size a save writes (`capture`), pure `inside` / `edgeDistance` tests, an
  `offset(by)` path, the other variant's outline (`ghostPath`), and whether the
  ground behind the picture shows (`groundShows`, `groundPath`).
- `variants`: the discrete ways the same model can be turned (point-top and
  flat-top). None, or one, means no Shape part.
- `parts`: the editable regions, in Tab order.
- `neighbours`: lattice offsets for the hive chip; absent means the lone
  silhouette.

### Parts and field kinds

A **part** has an id of the model's own choosing (`name`, `rim`, `fill`,
`picture`, `link`, `shape` for the hexagon), a label key, the **fields** it
edits (the first is the primary), a preferred side, a hit priority `z`, and
three pure functions of the geometry: `anchor` (where its leader ends), `hit`
(the only hit-testing there is) and `lit` (what lights, as data).

Behaviour comes from the **kind of the primary field**, never from a part id or
a model id. The shell's table (`diagram/fields.ts`) maps each field key to a
kind:

| Field | Kind | Group-editable | A click on the drawn part |
|---|---|---|---|
| `border.color` | colour | yes | opens the native colour input |
| `background.color` | colour | yes | opens the native colour input |
| `hideText` | toggle | yes (tri-state) | secondary field of the name part |
| `title` | text | no | focuses and selects the in-place name |
| `link` | link | yes | opens the card, focuses the url |
| `picture` | image | no | pins and focuses the pan surface |
| `orientation` | variant | no | switches to the next variant |

The table is the shell's, so a model cannot widen group mode.

The hexagon's six parts (`name`, `rim`, `fill`, `picture`, `link`, `shape`)
and the Questions callout (no part, no leader) keep the same
vertical order in both variants, so leaders do not cross and tabs do not move
when the variant turns.

### Lighting vocabulary

One attribute, `data-lit`, is `soft` (hover with a mouse or pen) or `strong`
(keyboard focus, an open card, a touch pin). Strong reads stronger than soft.
Gold is the **current** part only. The stylesheet reads nothing else, and
everything is stroke, fill and ink — no filter, blur, blend, keyframes, canvas
or SVG text; 150ms on colour properties only; reduced motion shows the same
state statically.

The lit shapes a part supplies are data, of five kinds: `band` (a wash stroke),
`edge` (a line), `halo` (the surface under a line, so a line reads over any
colour the user gave the rim), `fill` (a wash) and `hatch` (where the ground
shows). In the hexagon:

- **Border** lights a wash band centred on the edge with two edge lines.
- **Fill behind** hatches exactly where the ground shows, and nothing at all
  when a picture covers it (hatching a covered ground would lie).
- **Picture** washes the picture rect, shows its dashed edge, the capture box
  with its size (*346 × 400 px, as saved*), and lifts the outside fade so a
  crop can be judged against what is cut off.
- **Name** tints the band between two hairlines.
- **Shape** draws the other variant's whole outline dashed, its ears washed.
- At rest the tile is the real tile look and nothing else.

### Adding a model

1. One file, `editor/models/<id>.model.ts`, exporting a `TileModel`.
2. One line in `editor/models/models.ts` (`[MODEL.id]: MODEL`; `modelFor` and
   `allModels` are a plain lookup — no registry, no events). The folder's
   `index.ts` is generated and does not hold this.
3. Its label keys in the catalogs. The hexagon reuses `editor.name`,
   `editor.border`, `editor.fill-behind`, `editor.picture`, `editor.link`,
   `editor.shape`, `editor.point-top`, `editor.flat-top`; another model adds
   `editor.model.<id>.<part>`.
4. The contract spec runs on `allModels()` by itself.

No shell file changes.

**The honest limit.** This proves the *editor*, not the *save*. Capture
(`hex-capture.ts`), the framing maths in `crop-math.ts`, orientation in
`ImageEditorService` and the hive shader's mask are hexagon-bound. A second
model that must be saved needs its own capture and render path. Where the model
id lives (per hive, per tile, per type) is a **decision** before a second model
ships; today `modelFor(undefined)` is the hexagon.

## The name

The tile's "name" is its per-language **title**, a decoration — never the
address. The **address** (the folder name) never changes and is shown quietly
beside the reading. The words on screen are *name* and *title*; the editor does
not "rename" a tile.

The name is typed on the tile itself, in one always-mounted input on the name
band (its box comes from the model; a dotted underline says *type here*). It is
also reachable from the Name tab and *edit on tile*. A tile with no title shows
its address as the placeholder; clearing the text clears the title and the
reading returns to the address. A tile whose name is hidden over its picture
still shows the field, between dashed hairlines.

`editor/tile-title.ts` (`TileTitle`) is the name's memory. It is bound to the
tile it was loaded for; a commit is a promise; writes to one tile are chained
and each writes the latest text; a name not yet written is `dirty`.

| State | Name card says | Notes |
|---|---|---|
| idle | `reads "Harbour dusk" in en` | the stored reading |
| typing (dirty) | `not saved yet` | header shows *unsaved* |
| saving | `saving the name…` | Save reads *saving…* and is disabled |
| saved | `name saved` | for a moment, then idle; the list takes the new reading |
| refused | `"Salt flats" is taken. The tile salt-flats already reads that way here.` and the word *undo* | the typed text is kept, never dropped; alert tone on band, leader, tab and card; the sibling's row is marked *same name* |
| failed | `Could not save the name.` | Save retries |
| cut | `the tile shows "Harbour dusk…"` | an extra line when the band would truncate it |

**Commit points:** Enter, blur, Save (awaited — `flush()`), switching tile
(awaited), close, and park (synchronous `detach()`; a refusal that arrives after
the editor is gone is said in a `toast:show` warning, with the key
`editor.name-refused`). **A refusal keeps the editor open** for Save,
save-and-open and a tile switch; *keep editing* and *don't save* are still
offered, and *don't save* drops only the typed text. A pending or refused name
counts as a draft and is named in the *Draft kept* toast. Escape in the field
and *undo* revert to the stored reading. The header always shows the **stored**
reading, never the typed text. The language chip shows the active title locale
(`activeTitleLocale()`, the same key titles are stored under); a menu of other
readings is proposed, not built.

A title is a decoration written at commit: it is **not** part of the session's
Save or Cancel payload. Landed under this: `TileTitle` (+ spec),
`DecorationService.setTitle` serialised per page, `readingAt`, the index-first
sibling check, `activeTitleLocale()`, and `title.queen` keeping case. **Owed:**
`refused` carrying `siblingAddress`, and `duplicateTitle` returning
`{ reading, address }` — the card line above needs the address.

## Editing a group

The left list is the shared `AgentTilesRail`, created per open through the IoC
key `@diamondcoreprocessor.com/AgentTilesRailFactory` (never imported — it drags
in the chat chain) and disposed on teardown. A row shows the tile's reading;
its address is in the tooltip and the find box matches both.

| Input on a row | Does |
|---|---|
| Click, or Enter | Opens that tile: `editor:switch-request`. A clean tile moves at once; a dirty one asks *Save your changes before opening "X"?* (keep editing · don't save · save and open). A plain click on a member of a group collapses the group onto that tile. |
| Ctrl / Cmd / Shift-click, or Space | Toggles it into the group: `editor:group-toggle`. |

Toggling the open tile is a no-op. Marks come from the session's `group`, not
the rail's own set (the drone can refuse a toggle). **A group is one page** —
cross-level groups are not supported (a **decision**, default: unsupported).
Picking a row on another level uses `drone.switchTo(label, { save, parent })`;
closing returns to the page the editor was opened from (`#returnToOrigin`, also
a **decision**, default: yes).

In a group the same model is drawn as a **template**: a dotted *as is* ground
(never a hatch — hatch means *the ground shows here*), a dashed neutral rim
until a border is set, faint outlines stacked behind, and the band reading
*{n} tiles* in its **own** element — a group has no name field, and a single
tile's typed text never leaks into it. No picture, no pan, no toolbar, no
Shape, no Questions, no layer chips; drop, paste and camera are disarmed.

**Editable, and only these:** border colour, fill colour, name visibility
(tri-state), link. Each starts *as is*; only the fields the person sets are
written, per tile, through `groupWritesFor` / `writeTilePropertiesAt`; the word
*leave as is* returns one to untouched. Once something is set one line says
what will happen: *Set on all 3 tiles: border, name.* Entering a group seeds
the form from the open tile's changed fields and stashes a changed picture;
leaving carries the form back to the one tile.

## Gestures and keys

| Input | Does |
|---|---|
| Drag the tile | Pan the picture. The pointer is captured only after a slop (6px mouse, 10px touch); without movement it is a click on the part under it, and after a drag no part acts. |
| Two fingers | Zoom about their centroid and carry the picture. |
| Wheel / trackpad pinch | Zoom about the cursor. |
| Double-click / double-tap | Toggle Fill / Fit about the point. |
| Arrows (Shift = ×10), `+` `-`, `0`, `F` | Pan, zoom, reset, Fit — while the stage has focus. |
| Ctrl/⌘+Enter, Enter on the bare stage | Save. |
| Click a tab | Open its card (one at a time). |
| Touch: first tap on a part | Pins it (strong); a second tap on the same part acts; a tap on a tab acts at once. |

Past a limit a gesture shows a share of the overshoot and settles back. In
**Fill** the picture always covers the tile, so no background can show at an
edge. **Fit** lets the whole picture sit inside.

Tab order: the skip link, the list, the stage (one stop), the toolbar, the tabs
in the model's part order, Questions last. The drawn parts and the SVG are
never tab stops; the tab is the part's keyboard twin, and nothing is operable
only by hovering a drawn part.

While the editor holds focus the hive's keyboard shortcuts stand down
(`keymap:suppress`, held for the **whole** session — not per focus), and the
hive's own zoom and pan stay locked (`InputGate 'editor'`).

### The Escape ladder

One rung per press (`dismissInner()` runs first, from `escape-cascade.ts`
priority 1; fields that own Escape carry `data-escape-local`):

1. the leave prompt
2. the camera
3. an open menu (layer chip, locale, the gear popover)
4. name edit (reverts to the stored reading)
5. the link verdict
6. a field's focus
7. an open card
8. a pinned part
9. the drawer (narrow)
10. cancel the editor — the draft is stashed and *Draft kept* is toasted

Right-click and hardware Back are the same ladder (`BackGesture`,
`dismissInner() || cancel()`). Rung 3 (an open menu) is **owed**: today
Escape with a menu open cancels the whole editor.

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
photos are stepped down by halves before the final draw. `hex-capture.spec.ts`
records every canvas call and fails if a capture ever strokes, fills or writes
text. Everything the editor draws over the tile — the lit shapes, ghost, capture
box, hatch — is display only.

The same capture is used by the heal pass (`substrate/tile-small-render.ts`) and
by dropped and pasted pictures (`editor/resource-thumbnail.ts`), so opening a
tile and saving without a touch changes nothing.

**A save that changes nothing writes nothing** — no layer, no history entry, no
`tile:saved`. A tile with no original (only small pictures) cannot be
re-framed; the editor says so and keeps them as they are.

## Live in the hive

While a tile is being edited, its hexagon in the hive shows the edit as it
happens — a new picture or none, the framing, the rim colour, whether the name
shows. Nothing is written. The desk covers the hive, but `tile:preview` keeps
being emitted so Save never flashes the old picture.

- The view sends `tile:preview` with `EffectBus.emitTransient` (no replay):
  `{ label, page, point?, flat?, removed, border, hideText }`, or
  `{ label, clear: true }` when the editor closes. `point` / `flat` are the
  twins' captures — the exact small pictures a save would write — with their
  signatures.
- `ShowCellDrone` paints it onto that one tile with attribute writes, the same
  way a saved change is painted in place. It is **never written into a cache**.
  The preview's pictures are pinned in the atlas so nothing evicts them.
- Tile names are DOM text: `nameHidden(label)` answers from the preview, and
  `render:name-visibility` tells `TileNameDrone` to re-ask.
- **No flash on Save.** The capture is deterministic, so the saved small
  pictures have the preview's signatures and are already on the GPU. The
  preview's end is deferred one turn and skipped when `tile:saved` for that tile
  arrives in it.
- Framing reaches the hive when a gesture settles, not on every pointer move.

## Moving to another tile

Through the list (above), not by clicking the hive — the desk covers it.

- **Nothing changed** — it just moves; nothing is rebuilt.
- **Unsaved changes** — a prompt in the header: **keep editing** · **don't
  save** · **save and open**. Save and open holds focus; Escape is keep editing.
  *save and open* writes first and moves only when the write lands; a failed or
  refused save stays put with its message. *Don't save* keeps the draft exactly
  as a cancel keeps it, and reopening that tile offers **Restore**.
- `TileEditorDrone.switchTo(label, { save, parent })` writes (and announces
  `tile:saved`) before opening the next tile, and opens it **without** stashing a
  draft it just saved. The view retargets: ends the last tile's preview, drops
  its twins, camera, link verdict, answer drafts and name, then syncs to the new
  tile. While a move is in flight the preview stands down.
- `ShowCellDrone` puts the tile that was left back from its caches unless a save
  for it just landed.
- Escape is heard first by the hive's keymap (window, capture), which unwinds
  one rung through `dismissInner()`. The panel's own Escape handler stands down
  when the keymap has taken the press (`defaultPrevented`).

## The framing numbers

Unchanged from every framing already stored (`editor/crop-math.ts`):

- the **frame** is a square of `side × 2` units (400);
- `x`, `y` are the picture centre's offset from the frame centre;
- `scale` is how many frame units one pixel of the original covers.

Absent framing means the default: centred, covering the frame square (which
covers both orientations). `readFraming` reads the old placeholder triple
`{ x: 0, y: 0, scale: 1 }` as "never framed", and the doors no longer write it.
A **new picture** resets both orientations' framing, and **only the latest load
lands**: each decode carries a generation number and a stale one is dropped.

## Files

Under `hypercomb-essentials/src/`. All of it is lazy, reached only through the
drone's `import('./tile-editor.view.js')`; the tag `hc-tile-editor`, its
exports and every IoC key are unchanged.

| File | Role |
|---|---|
| `editor/models/tile-model.ts` | The interfaces: `TileModel`, `ModelGeometry`, `ModelPart`, `FieldKey`, `FieldKind`, lit items. Types only, no shape word in it. |
| `editor/models/model-kit.ts` | Shape-free helpers: polygon maths, hit and lit builders. |
| `editor/models/hexagon.model.ts` | All hexagon maths and look. Reads `presentation/grid/tile-look.ts` so the shader stays pinned. |
| `editor/models/models.ts` | `modelFor`, `allModels`. |
| `editor/diagram/fields.ts` | The shell's `FIELDS` table, kinds, group filter, click-by-kind. |
| `editor/diagram/layout.ts` | Pure: stage size, wide or narrow, list mode, columns. |
| `editor/diagram/placement.ts` | Pure: packing each column, leader polylines, crossings. |
| `editor/diagram/lit-state.ts` | Pure reducer: hover grace, strong over soft, alert tone, pin, lift. |
| `editor/diagram/controls.ts` | DOM builders for the field kinds, Questions, layer chips. |
| `editor/diagram/tile-diagram.ts` | The DOM orchestrator: lit layer, leaders, tabs and cards, chip, tag. |
| `editor/diagram/diagram.styles.ts` | Tabs, cards, leaders, lit states, narrow rows, coarse pointer, forced colours. |
| `editor/tile-editor.view.ts` | The `hc-tile-editor` element: the desk shell, session, header, notices, leave prompt, the list, the name, the port over the services. |
| `editor/tile-editor.styles.ts` | Roles on the root, desk, header, notices, list host. |
| `editor/crop-stage.ts` | The picture's pan surface; takes its shape from the model's geometry. |
| `editor/tile-look-overlay.ts` | The tile's look over the picture, drawn from geometry (display only). |
| `editor/crop-math.ts`, `editor/hex-capture.ts` | Pure framing maths and the one capture (hexagon-bound). |
| `editor/image-editor.service.ts` | The picture model: original, framing per orientation, Fill/Fit, linking. No Pixi. |
| `editor/tile-editor.service.ts` | The session: properties, baseline, saving state, a one-slot stash of a discarded draft. |
| `editor/tile-editor.drone.ts` | Opening, saving, moving to another tile, returning to the origin page. |
| `editor/tile-title.ts` | The name's memory. |
| `presentation/grid/tile-look.ts` | The shader's look constants. |

Deleted with the old surfaces: `editor/editor-surface.ts` (`isPhoneViewport`
moves to `breakpoints.ts`), `dockWidthFor`, the dock footer and grip, the
inset reservation. Which of the new files exist yet follows the rebuild; the
landed ones are `tile-title.ts`, the `commands/` and `selection/` changes under
*The name* and *Editing a group*, and the rail's `toggle`, `labelOf`,
`showSelection`, `showCurrent` (**owed** on the rail: `markSibling`, and a
right-click at the root level that does not `preventDefault`).

## Contracts kept

- IoC keys and method shapes of `TileEditorService`, `ImageEditorService`,
  `TileEditorDrone`; `tile:saved { cell, segments }` only after a write.
- `tile:preview` and its clear, unchanged.
- `editor:mode` still fires on open and close, carrying
  `{ active, surface: 'screen', label, segments }`. `surface` stays defined:
  only a payload **without** `surface` (an old modal) hides the hive or paints
  the editor wash. **Owed:** the drone still derives the surface from
  `editorSurface()`.
- The close-up stays suspended while a session is open.
- A discarded changed draft (Escape, close, a sweep, another tile opening, a
  move with *don't save*) is kept once, in memory; reopening offers **Restore**.
  Dismissing the strip drops it (`dropStash`).
- Window id `tile-editor`: its text size is `hc:panel-text:tile-editor`, set
  from the docked-panel gear; the desk passes `defaultText: 1` so text does not
  auto-scale at full width.
- Hooks the specs and drivers use: `hc-tile-editor`, `.te-panel` (the desk),
  `[data-hc-tile-editor]`, `.te-title`,
  `.te-actions button[data-action=cancel|save|leave-stay|leave-save|leave-discard]`,
  `.te-leave[hidden]`, style id `hc-tile-editor-style`.

## Words

Every word on the editor is a catalog key (`editor.*` in
`hypercomb-shared/i18n/`). The words *rename* and *pheromone* never appear.
`editor-i18n.spec.ts` is the ratchet: it scans the editor's non-spec sources for
`t('editor.…')` and `labelKey: 'editor.…'` and fails on a key `en.json` does not
hold. The name-flow keys and the keys once used in code but in no catalog are
translated in all fourteen catalogs; the rest of the new keys are English until
translated, and the runtime falls back to English. The old `editor.group-hint`
paragraph is gone from the design (replaced by the *Set on all* line, the
header count and a live-region announcement); the key was never in a catalog.

## Proving it

```bash
npx vitest run hypercomb-essentials/src/editor hypercomb-essentials/src/presentation/grid/tile-look.spec.ts
npx vitest run hypercomb-shared/i18n hypercomb-essentials/src/commands
node scripts/drive-toolwindow-contrast.cjs --url http://localhost:4251 --engine msedge --themes honey,light,sherbet,dark
node scripts/drive-text-size.cjs
```

Specs by area: `tile-title.spec.ts` (the name's memory), `tile-editor.levels.spec.ts`
(rows on other levels), `tile-editor.switch.spec.ts` (moving: clean, asked, each
answer, Escape, a failed move), `tile-editor.group.spec.ts` and
`tile-properties.group.spec.ts` (group writes), `selection.replace.spec.ts`,
`decoration.title.spec.ts`, `crop-math`, `hex-capture`, `tile-look`,
`editor-i18n.spec.ts`. Specified, to land with the code: a contract spec run over
`allModels()` (unique part ids, known field keys, anchors inside the geometry,
`hit` agreeing with `lit`, label keys in `en.json`), a ratchet that the shell
and diagram sources contain no shape word and compare no quoted part id, and
pure specs for layout, placement (zero leader crossings over the forced-state
matrix) and the lighting reducer.

Not yet checked against the real services: WebKit and Firefox, real touch
hardware, screen readers, Windows forced-colours, the native colour popup's
position in a side column, the real pan surface beside a sibling lit layer, and
text at 140% on the real shell. Drive the real app at 1440×900 and 390×844,
dark and light, and include a leg that really opens the lazy view — the text-size
driver's editor leg has silently skipped before, a false green.
