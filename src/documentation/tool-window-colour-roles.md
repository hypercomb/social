# Tool-window colour roles

**A tool window never names a colour. It names a role.**

This is the vocabulary every docked panel, floating panel and overlay paints
from, and the reason the panels stay readable when the theme changes. It
replaced 625 hand-picked colour literals across 60 stylesheets.

## The complaint, and what was actually wrong

> "The portals window is unreadable when honey, light, sherbet. The text needs
> to contrast more." — and it went for every light tool window.

Measured rather than eyeballed, with
[`scripts/drive-toolwindow-contrast.cjs`](../scripts/drive-toolwindow-contrast.cjs):
the Portals title was **1.09:1** on a honey pane. Present in the DOM,
invisible on screen. 82 text runs under target in honey alone.

Three causes, stacked:

1. **Panels painted their labels from literals.** `#eaf3f9` for a title,
   `rgba(207, 226, 238, 0.62)` for a lede, `$steel` for an icon — every one
   chosen against a dark pane. The pane went cream; the text did not move.
2. **The alphas encoded a weight in DARK terms.** `rgba(ink, 0.38)` is a
   legible "faint" on near-black and a 2.3:1 smudge on cream. The same alpha
   is not the same weight — a bright ground gives a translucent mark far less
   to subtract from.
3. **The accent deepening had never run.** See below. This is the one that
   made the other two unfixable in practice.

## The root cause: view encapsulation ate the theme selector

`ui/_panel-identity.scss` takes each panel's pastel accent and, under a bright
look, emits a DEEP version of the same hue. It did that with

```scss
@at-root :is([data-theme="honey"], …) & { --acc: <deepened>; }
```

Angular's emulated view encapsulation rewrites every compound selector in a
component stylesheet by stamping `[_ngcontent-xyz]` onto it — and that rewrite
does not stop at the component's own classes:

```css
:is([data-theme="honey"][_ngcontent-xyz]) .sequence-panel[_ngcontent-xyz]
```

`<html>` carries no `_ngcontent` attribute, because it is not inside any
component. **The rule was in the stylesheet, valid, and could never match.**
Every pastel accent stayed pastel, in every panel, in every bright theme,
since the day the deepening was written.

The fix is `:host-context()` — the one selector Angular deliberately does not
stamp, because reaching state ABOVE the component is its whole job. The plain
`:is()` form is emitted alongside it for any non-component consumer; a global
sheet drops the `:host-context` rule as an unknown pseudo-class, an
encapsulated one is unharmed by the `:is()` rule that cannot match. One of the
two always applies and neither can misfire.

**Watch for this anywhere a component stylesheet tries to read `<html>` or
`<body>` state.** A `@media` query is safe; a selector is not.

## The vocabulary

### Ink — weight

On `:root`, so any surface can reach them, panel or not. Each is the panel's
own ink at the alpha *this theme* says that weight costs (`--hc-ink-a-*`).

| Role | For |
|---|---|
| `--hc-window-ink-loud` | the one thing in the group that is selected |
| `--hc-window-ink-plain` | labels and icons doing actual work |
| `--hc-window-ink-quiet` | secondary labels — **the floor for anything that must be READ** |
| `--hc-window-ink-faint` | resting state of a control that lifts on hover |
| `--hc-window-ink-ghost` | separators, decorative glyphs — presence, not information |

Text never rests below `quiet`. `faint` and `ghost` are for marks that carry
no information.

### Accent — identity

Emitted by `tw.panel()` / `tw.floating-panel()` from `--acc`, which deepens
under bright looks.

| Role | For |
|---|---|
| `--hc-window-accent` | the identity as TEXT |
| `--hc-window-accent-quiet` | a secondary label or resting glyph in the identity |
| `--hc-window-on-accent` | text ON an accent ground — resolves to the PANE, correct at both ends |
| `--hc-window-wash` / `-strong` | the identity as a GROUND (hover, selected) |
| `--hc-window-edge` / `-firm` | the identity as a HAIRLINE |

Never `rgba($accent, …)`. The SCSS variable is the authored pastel and never
deepens; only `var(--acc)` does.

`--hc-window-on-accent: rgb(var(--hc-panel-pane))` is not a trick: the accent
is a pale pastel on a dark theme (so its text must be dark, and dark is what
the pane is) and a deep tone on a bright one (so its text must be light, and
light is what the pane is).

### Ground — neutral

| Role | For |
|---|---|
| `--hc-window-tint` / `-strong` | a row, a field, a raised chip |
| `--hc-window-line` / `-firm` | a divider |

A dark literal ground (`#17201e`, `rgba(0, 0, 0, 0.25)`) is "a step darker
than the pane" written for a pane that was already dark. On cream it makes a
genuinely dark field, and then even correct ink fails on it.

**A modal scrim is not a ground.** `rgba(0, 0, 0, 0.6)` behind a dialog is
correct in both themes; dimming the app is what black is for.

### Colour on purpose — the deepen knob

A green "ready", an amber caution, a panel's decorative second hue. These
cannot go on the ladder (they would stop being green) and are too varied to
enumerate. One knob instead:

```scss
color: tw.ink(#70d59a);
// → color-mix(in srgb, #70d59a, rgb(var(--hc-panel-ink)) var(--hc-deepen))
```

`--hc-deepen` is 46% on bright grounds and **0% on dark**, so the authored
colour passes through untouched there. Hue survives; value moves.

Use it only where the colour is the point. Weight belongs on the ink ladder
and identity on the accent roles; reaching for `ink()` to dodge either is how
a panel drifts back out of the system.

## Proof

```bash
node scripts/drive-toolwindow-contrast.cjs --themes honey,light,sherbet,dark
```

Opens each tool window in each theme, walks every visible text node,
composites the real colour over the real ground (alpha included, ancestors
walked) and reports the WCAG ratio. A panel passes when every run clears
4.5:1, or 3:1 for large text.

| | before | after |
|---|---|---|
| honey / light / sherbet / dark | 107 runs under target | **0** |

Adding a window costs one line in that script's `WINDOWS` list.

## The ratchet

`doctrine.spec.ts` → *"no tool-window stylesheet paints text from a light
literal"*. Empty allowlist, and it stays empty. It flags any `color`, `fill`
or `stroke` set to a literal above 0.28 relative luminance in
`hypercomb-shared/ui/**`.

0.28 is the floor because the band from there to 0.35 is where the semantic
violets and reds sit (`#b48ad8` is 0.33) — light enough to measure ~3.5:1 on
cream while looking safe in the source.

Dark literals are left alone: they read correctly on the bright panes, and the
dark themes measure clean.

## Deployment note

The chat rail (`hypercomb-essentials/.../agent-tiles-rail.ts`) is a drone that
renders its own CSS and reads the `:root` ink rungs. The dev shell imports it
directly; **the web shell needs `npm run build:essentials`** for that one file
to reach it. Everything else here is `hypercomb-shared`, which both shells
consume as raw source.
