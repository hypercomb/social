# Background themes

One command, one list, one word.

```bash
/background ember
```

`/background` with nothing after it prints the current theme and the whole list.
`/background off` is bare surface.

## What a theme is

A theme is a named look that declares what it dresses:

- **screen** — the backdrop behind the hive
- **tiles** — the pictures that fill blank tiles

A theme may declare either half or both. **A theme that names no screen leaves
the screen alone**, so an image theme lays over whatever backdrop is already
showing — `/background ember` then `/background nature` gives you Nature tiles on
the Ember screen.

| Theme | Dresses |
|---|---|
| `steel` `daylight` `indigo` `teal` `ember` | screen + tiles |
| `photos` `minimal` `geometric` `abstract` `nature` | tiles |
| `off` | clears the screen |

The autocomplete draws each one: a theme with a screen shows that backdrop
rendered at chip size; a tiles-only theme shows one of its own pictures. The
choice is made by eye, not by name.

## What this replaced

Four things used to change what you see, and none of them showed you anything:

- **`/canvas`** asked for an **archetype** (contour, dots, grid, honeycomb,
  depth, sheen, mesh) and a **palette** (steel, daylight, indigo, teal, ember)
  as two separate axes you had to hold in your head
- **`/backgrounds`** toggled individual default pictures one at a time
- **`/substrate set`** switched image collections
- several generated theme asset sets shipped wired to nothing at all

`/canvas` and `/backgrounds` are gone. The axes are folded into the themes: each
theme has its pattern already chosen. Curating *which pictures are in a set* is a
different job and still lives in the substrate organizer — `/substrate`.

## No aliases

Every word means exactly itself. There are no built-in synonyms — a second word
for a thing that already has a word is a vocabulary you have to learn instead of
read. Aliases are the participant's to mint, never shipped in a list in the
source.

## Adding a theme

The list is data. One entry in `BACKGROUND_THEMES`
(`presentation/background/background-theme.service.ts`):

```ts
{ id: 'ember', label: 'Ember',
  screen: { archetype: 'sheen', palette: 'ember' },
  tiles: 'builtin:ember',
  preview: '/substrate/ember/sheen.png' }
```

- `screen` names an archetype and palette the `CanvasBackgroundService` already
  knows how to draw. Omit it and the screen is left alone.
- `tiles` is a `SubstrateService` source id — any registered source, including a
  linked local folder or a hive. Omit it and the tiles are left alone.
- `preview` is one picture from the tiles set, used for the chip when the theme
  has no screen to draw. Named rather than discovered, because a manifest lookup
  would make the swatch asynchronous and the dropdown draws now.

A theme naming a tiles source that isn't registered dresses what it can rather
than failing the whole change. Nothing about a theme is special-cased anywhere,
so any number can be added — `register()` is the seam for a module (or a
participant's own module) to ship a look without editing this list.

Where the shipped assets come from: `scripts/backgrounds/gen-sets.mjs` generates
the five palette sets (tile rasters, screen rasters and SVG sources), and
`scripts/backgrounds/gen-tile-themes.mjs` generates the four image themes.

## Not to be confused with `/theme`

`/theme` is the **colour theme** — the chrome, every `--md-*` design token behind
panels, text, borders and buttons. `/background` is what is behind and beneath
the hive. Both are participant-local (localStorage) and neither is ever written
to a layer: a peer opening the same hive sees their own.

The screen backdrop still follows the colour theme when no theme has pinned a
palette — dark → steel, light → daylight.

## How the screen half is drawn

`CanvasBackgroundService` paints a backdrop across three surfaces, which is why
the dropdown swatch cannot simply reuse the live CSS:

- **body CSS** — the base colour, the vignette, and gradient-only archetypes
- **`#hc-glow` / `#hc-aurora`** — the fixed, gently animated lighting layers
- **the Pixi zoom container** (`GridLinesDrone`) — the `grid` / `dots` /
  `honeycomb` lattices, which live in *content* space so they pan and scale with
  the hive rather than sticking to the screen

`swatch()` folds all three into one `background` shorthand at chip scale, and
pushes the contrast well past the live values: the live alphas (0.06 … 0.18) are
tuned for a whole screen, where a whisper of a pattern is still thousands of
pixels of it. In a 36×18 chip the same numbers are a flat dark rectangle and
every option looks identical, so a swatch is a legible **miniature**, not a scale
model.

If you add an archetype, give it a case in both `cssFor` (the live look) and
`swatchFor` (the chip), and — if it is a lattice — an entry in `LINE_KINDS` and
an alpha in `lineAlpha` so `GridLinesDrone` draws it.
