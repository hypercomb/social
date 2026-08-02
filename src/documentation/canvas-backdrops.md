# Backdrops, palettes and themes

Three different things colour the screen, and they are easy to confuse because
they all look like "the theme". They are separate switches, each with its own
slash behaviour.

| What | Behaviour | What it changes | Where it is stored |
|---|---|---|---|
| **Colour theme** | `/theme` | The *chrome* — every `--md-*` design token: panels, text, borders, buttons | localStorage, participant-local |
| **Backdrop** | `/canvas` | The *screen behind the hive* — the pattern and its colours | localStorage, participant-local |
| **Substrate images** | `/backgrounds` | Which default *pictures* fill blank tiles | in memory, session only |

None of the three is ever written to a layer. They are participant-local, like
locale, viewport and clipboard — a peer opening the same hive sees their own.

## The backdrop has two halves

`/canvas` is the one people find confusing, because a backdrop is a **pair**:

```
/canvas  <archetype>  <palette>
            shape        colours
```

**Archetype** — the shape of the pattern. Seven of them:

| Archetype | Look | Aliases |
|---|---|---|
| `contour` | concentric rings (the default) | `rings` |
| `dots` | a hex-dot lattice | `hexdots`, `hex-dots` |
| `grid` | a fine carbon grid | `carbon`, `carbon-grid` |
| `honeycomb` | a hex-cell lattice | `comb`, `hive` |
| `depth` | no pattern — a plain lit gradient | |
| `sheen` | one soft diagonal brushed band | `brushed` |
| `mesh` | slow drifting aurora blooms (animated) | `aurora` |

**Palette** — the colours the archetype is drawn in. Five of them: `steel`
(dark blue-grey), `daylight` (light/paper), `indigo`, `teal`, `ember`.

Plus two words that are neither: `auto` (let the palette follow the colour
theme — dark → steel, light → daylight; this is the default) and `off` (no
backdrop at all).

## Changing it

Each token is independent, and you can give either or both:

```bash
/canvas dots
```

That changes only the shape and keeps whatever palette you had. To change only
the colours:

```bash
/canvas indigo
```

Both at once, in either order:

```bash
/canvas indigo dots
```

Back to following the theme:

```bash
/canvas auto
```

And `/canvas` with nothing after it prints what is showing now plus the two
lists. So: **`/theme` picks the light/dark world; `/canvas` picks the picture
behind the hive; `auto` is the wire between them.**

## The swatches in autocomplete

Typing `/canvas ` opens the dropdown with a small **picture of each option**
rather than a colour dot — the archetype rendered in the palette you would
actually get. That means an archetype's swatch is drawn in your *current*
palette, and a palette's swatch is drawn in your *current* archetype, so what
you see is the result of pressing Tab, not an abstract sample.

The swatch is produced by `CanvasBackgroundService.swatch(tokens)`, which
accepts exactly the tokens `set()` accepts and applies nothing. It cannot reuse
the live backdrop CSS, because a backdrop is painted across three surfaces:

- **body CSS** — the base colour, the vignette, and gradient-only archetypes
- **`#hc-glow` / `#hc-aurora`** — the fixed, gently animated lighting layers
- **the Pixi zoom container** (`GridLinesDrone`) — the `grid` / `dots` /
  `honeycomb` lattices, which live in *content* space so they pan and scale
  with the hive rather than sticking to the screen

`swatch()` folds all three back into one `background` shorthand at chip scale.
If you add a new archetype, add its case there too, or its dropdown entry will
show the base gradient with no pattern.

## Adding a palette or an archetype

Both live in `canvas-background.service.ts`:

- a palette is one row in `PAL` (base, base2, deep, accent, accent2 — the last
  three as `r,g,b` triples so alpha can be tuned inline) plus its name in
  `CANVAS_BG_PALETTES`
- an archetype is a name in `CANVAS_BG_ARCHETYPES`, its aliases in
  `ARCH_ALIASES`, a case in `cssFor` (the live look), and a case in
  `swatchFor` (the dropdown chip). If it is a lattice, add it to `LINE_KINDS`
  and give it an alpha in `lineAlpha` so `GridLinesDrone` draws it in content
  space

The `/canvas` queen needs no edit — it reads `svc.archetypes` and
`svc.palettes`, so a new entry appears in autocomplete on its own.
