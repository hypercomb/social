# Background themes

One command, one list, one word.

```bash
/background ember
```

`/background` with nothing after it prints the current theme and the whole list.
`/background off` is bare surface.

## The grammar

```
/background <theme>[.<picture>][.force | .force-global]
/background <theme>.items
/background off
```

A theme is a **group of pictures**, and by default each tile draws its own from
the group — a wall of tiles reads varied but coherent. Name a picture and that
one goes on every tile instead:

```bash
/background ember.dots
```

Pinning a picture is session-only: nothing is persisted, written to a layer, or
seen by peers, and a reload returns the whole group.

**Seeing the group.** `/background ember.items` lists the group's pictures and
opens the substrate organizer, where they are laid out as thumbnails. A group is
only listable once it is the active one — a pool is warmed when it is in use —
so `items` makes the theme active before showing it.

## Force — overwriting what is already dressed

By default a theme change dresses tiles that have **no picture yet** and leaves
dressed tiles alone. To restyle tiles that already have one:

| | Reach |
|---|---|
| `/background ember.force` | every tile on the layer you are looking at |
| `/background ember.force-global` | every tile in the hive |

**A force never touches a picture the participant attached.** The test is
whether the tile is wearing something a substrate pool put there: the outgoing
group's signatures are captured *before* the switch (after it, they are no
longer in the pool and could not be told apart from your own pictures) and
unioned with the incoming group's. Anything outside that set is yours and is
left exactly as it is, at any reach.

The safe direction is the default one: a picture from a theme *older* than the
one currently active is not recognised as theme-owned, so it survives a force.
Nothing custom is ever destroyed; at worst a stale theme picture stays.

**`<picture>.force-global` is refused.** One picture stamped across an entire
hive is not a look, and it is the one combination rerolling cannot undo. Pin a
picture for a layer; never for the whole tree.

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
