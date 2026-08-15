# Zoomable widgets

A participant-local "scale this panel" capability for floating UI. Hold **Shift**
while hovering a zoomable widget and a compact slider appears pinned to it; drag
it (or wheel over it) to rescale that widget. The scale is remembered per widget,
per participant — it lives in `localStorage`, never in the layer/lineage
signature (same rule as viewport and clipboard state).

## How to make a widget zoomable

Add the `hcWidget` directive to the widget's **outermost visible container** —
the element that is actually positioned/sized on screen, not the Angular host
(host elements are usually `display: contents`). Give it a stable id and a
position-balancing `anchor`:

```html
<div class="sheet-panel" hcWidget="shortcut-sheet" anchor="center" …>…</div>
```

Import the directive into the standalone component:

```ts
import { HcWidgetDirective } from '../widget-zoom/hc-widget.directive'
// …
imports: [/* … */, HcWidgetDirective],
```

That's the whole opt-in. The directive tags the element `[data-widget="<id>"]`,
applies the persisted scale, and reflects live changes.

## What opts in

Only **free-floating** content: overlays, dialogs, viewers, sidebars, toolbars,
strips. **Harness-fixed chrome does not** — the command line and header
indicators are anchored into the shell and stay at a fixed size. The directive
itself is neutral; this is a placement decision (where you add it), not a flag.

## How it works

| Piece | Where | Role |
|---|---|---|
| `HcWidgetDirective` | `hypercomb-shared/ui/widget-zoom/hc-widget.directive.ts` | Opt-in carrier. Stamps `[data-widget]`, applies scale as inline `zoom`, listens for live changes. |
| `WidgetZoomDrone` | `hypercomb-essentials/src/diamondcoreprocessor.com/widgets/widget-zoom.drone.ts` | The capability. Global Shift+hover detection, the imperative slider, persistence, broadcast. |

They never import each other (shared must not import essentials). They coordinate
purely through a small wire contract:

- **DOM:** `[data-widget="<id>"]`, `[data-widget-anchor]`
- **localStorage:** key `hc:widget-scale` → `{ [id]: number }`
- **EffectBus:** `widget:scale-changed` → `{ id, scale }`

The drone is registered via the side-effects barrel and self-registers in IoC at
`@diamondcoreprocessor.com/WidgetZoomDrone`. The slider is built imperatively
(like `HistorySliderDrone`) so there is no Angular shell-parity surface to keep
in sync between the web and dev shells.

## Design decisions

- **`zoom`, not `transform: scale`.** Inline `zoom` rescales the layout box, so a
  `translate(-50%,-50%)`-centred modal stays centred and scrollbars/hit-testing
  recompute correctly. It also doesn't fight the panels' enter-animation, which
  *fills* the `transform` property and would override an inline `transform`.
  (Verified empirically against the help sheet.)
- **Shift held while hovering** — not Shift+click. Shift+click already means
  "navigate up a level" on tiles; a hover-held modifier has no such collision.
- **Slider is `[data-consumes-wheel]`** so the wheel adjusts the slider, not the
  canvas behind it — the mousewheel-zoom handler already bails on that attribute.
- **Scale is participant-local.** It is a personal viewing preference, so it must
  not enter the layer or it would skew the lineage signature across peers.
- **HiDPI caveat.** `zoom` on an element that also has `backdrop-filter` promotes
  it to a compositing layer that can rasterize text at CSS-pixel density →
  slightly soft glyphs on HiDPI displays at scale > 1. Acceptable for the modal
  set. Where it isn't (the atomizer sidebar), the component scales via a
  `calc()`-multiplier custom property instead and deliberately does NOT opt in.

## Bounds

Scale clamps to `0.6`–`2.5` in `0.05` steps. Double-click the slider to reset to
100%.

## Rollout

**Opted in (11):** `shortcut-sheet` (reference) · `command-palette` ·
`mesh-modal` · `portal` · `instruction-catalog` · `swarm-adopt` · `contact-form`
· `notes-viewer` · `format-painter` (top-right drawer) · `layer-cycle-strip`
(bottom pill) · `atomizer-bar` (left toolbar). These are centered modals or
small, content-sized floating panels/toolbars — the shapes `zoom` handles
cleanly.

**Deliberately skipped**, because whole-element `zoom` is the wrong tool for
their shape (each would need a different mechanism — width-resize or internal
font-scaling — not this directive):

| Widget | Why skipped |
|---|---|
| docs overlay | full-viewport (`inset: 0`) — zoom overflows the screen |
| history viewer | full-height left panel **with its own width-resize handle**; zoom fights the px-width math + overflows vertically |
| files viewer, features viewer | full-height right-docked panels — zoom overflows vertically |
| tile editor | internal image-edit surface has pixel-coordinate math `zoom` would distort |
| youtube viewer | full-screen media player that hides all chrome |
| activity log | ephemeral auto-dismissing log, `pointer-events: none` |
| controls bar | multi-root (breadcrumb + swipe + a **draggable** pill with persisted position) — needs a pill-only pass |
| notes strip | draggable/dockable, owns its `transform`-positioning + width-resize |
| sensitivity bar | transient gesture indicator, `pointer-events: none` |
| atomizer sidebar | full-height **and deliberately avoids `zoom`** (backdrop-filter blur) — already scales via a `calc()` multiplier |

Revisiting any of these means picking the right mechanism for its shape, not
forcing `zoom`.

## The docked tool windows: `--hc-panel-scale`, and the text-size setting

The right-hand mechanism for a full-height docked panel was always the `calc()`
multiplier — `hcDockedPanel` sets `--hc-panel-scale` on the panel's root and its
SCSS sizes the body off it (`font-size: calc(1rem * var(--hc-panel-scale, 1))`),
which scales the type without `zoom`'s glyph softening under a `backdrop-filter`.

What changed: the multiplier used to be *only* a function of the panel's width,
so widening a window to fit a long line also enlarged its type. Now it is a
**setting** — the gear in every tool window's header carries a **Text size**
section:

| Choice | Scale |
|---|---|
| Auto | the width-derived multiplier (the old behaviour, still the default) |
| Small · Normal · Large · Larger | pinned — the width no longer moves the type |

It is **one setting per group**: tool windows sharing a group text share their
width *and* their text size (`GroupAttrs.text` in
`hypercomb-shared/ui/docked-panel/panel-groups.ts`), so setting it in any member
sets it for all of them. A window in no group keeps its own, in
`hc:panel-text:<window>`.

Two rules for a window joining this:

- **`hcDockedPanel` is the only writer of `--hc-panel-scale`.** A panel that
  sizes itself hands the directive its width via `sizeOwner` and takes
  `[defaultWidth]`/`[minScale]`/`[maxScale]` — it must not compute the var
  itself, or a pinned size would be clobbered by the next resize. A window with
  a mode whose box is not its docked box (the notes strip's fullscreen desk)
  reports the **docked** width, or the group adopts a screen-wide one and Auto
  reads the desk.
- **A window typeset in fixed `rem`/`px` is made to scale, not excused.** The
  notes strip was the one holdout and had a `scalesText="false"` opt-out; both
  are gone. Its sheets multiply every text size through one Sass function
  (`scaled()` in `_notes-strip-shared.scss`, `calc(#{$size} * var(--hc-panel-scale, 1))`)
  — which works on `rem` and `px` alike and cannot compound the way `em` would
  inside its nested rows. Glyphs bound to a fixed-size box (hex marks, the
  26px rail buttons, the drag ghost) stay fixed; text scales.

A window may also declare **`[defaultText]`** — the size it opens at before the
participant has picked one. The notes strip declares `1`, because width-derived
type on a window you drag wide to read a long note is a change nobody asked
for. Picking Auto is a choice and it sticks: `writeTextScale` records `'auto'`
rather than erasing the key, so "never chose" and "chose Auto" stay distinct.

## Settings a single window has

The gear's rows are shared chrome, but a window can declare its own through
**`[ownSettings]`** — a thunk returning `SettingRow[]`, drawn in the "This
window" zone with their callbacks wrapped so a pick repaints the editor. It is
for settings that cannot be hoisted without lying: the notes window's **Note
face** (Mono · Sans · Serif) is typography for *prose*, and prose is not what a
files list holds. The face reaches the prose only — note text, the reading
pane, the composer, list lines — while the window's chrome stays mono
(`--hc-notes-face`, resolved on the component host, above the panel's own
mono remap of `--md-font-ui`/`--md-font-display`).
