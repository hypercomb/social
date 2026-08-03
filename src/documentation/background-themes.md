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

**A force resets every DEFAULT and leaves every EXPLICIT picture.** A default is
one the substrate placed. An explicit one is a picture you put there — attached,
pasted, edited in. The difference cannot be recovered by looking at the picture
afterwards: both end up as a signature in the same index, and the pool that
supplied a default is gone the moment the theme changes. So provenance is
**recorded at the moment of assignment** — every signature the substrate writes
onto a tile is remembered, across themes and across sessions. A force replaces
exactly that set.

This means a picture placed by a theme you used *last month* is still a default
and is reset; only what you chose yourself survives. Losing the ledger (cleared
storage, a new browser) fails in the one safe direction: forgotten defaults are
treated as explicit and survive. It never grows the set force may destroy.

**`<picture>.force-global` is refused.** One picture stamped across an entire
hive is not a look, and it is the one combination rerolling cannot undo. Pin a
picture for a layer; never for the whole tree.

### Ownership is a mark in the bytes, not a local ledger

The ledger above is participant-local and forgettable, so the decisive test is a
mark carried in the tile's own canonical properties:

| Mark | Meaning |
|---|---|
| `substrate: true` | placed from a theme's pool — themes may move it |
| `participant: true` | a person put it there — nothing automatic touches it, ever |

The mark is written on the one canonical write path (`writeTilePropertiesAt`),
not by the twenty-odd callers that can set a picture. A caller that means *this
is a default* passes `substrate: true`; every other write that sets a picture is
a person doing it, so it earns `participant: true` **and clears the substrate
mark in the same merge**. The two can never both be true.

A tile also reads as the participant's when it holds a `large` original (only
the editor writes one) or when it has a picture and is not marked as a default —
so a hive edited before the mark existed is still read correctly.

**The regression this closes.** Properties are written by merging over what is
already there, so a tile that had once worn a default carried `substrate: true`
forward into every later edit. The participant's own picture then looked like a
default, and `force-global` re-dressed hand-made tiles across the whole tree.

### `/heal` — putting back what a default took

A re-dress only ever replaces the two small hex renders; the full-resolution
original and its framing are untouched, which is why the edit screen still shows
the right picture on a tile whose hexagon shows a default.

| | |
|---|---|
| `/heal` | redraw every overwritten picture from its original, hive-wide |
| `/heal check` | the same walk, reporting only — nothing is written |

**The repair also runs by itself, once.** Hives were already online when the
re-dress took their pictures, and most participants will never learn there is a
word for getting them back — so the same pass is armed for everyone
(`hc:picture-heal-v`), runs on idle well past first paint, and reports what it
restored. It is ordered ahead of the one-time re-dress (which awaits it), and
the marker is written only when a pass completes, so an unready boot leaves it
armed for next time. Bump `HEAL_VERSION` to re-arm everyone.

The pass repairs only tiles marked as defaults that hold a participant original
underneath, re-renders both orientations at the saved framing
(`substrate/tile-small-render.ts` restates the editor's own capture geometry),
and marks each healed tile as the participant's. Idempotent — a healed tile
stops matching. Tiles that keep no original are named in the report rather than
guessed at.

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
| `nature` (**default**) `photos` `minimal` `geometric` `abstract` | tiles |
| `steel` `daylight` `indigo` `teal` `ember` | screen + tiles |
| `off` | clears the screen |

**Nature is the ship default** — twenty scenes (hills, waves, sunset, mountains,
dunes, night sky, pine forest, birch woods, autumn maples, waterfall, lake,
meadow, aurora, beach, canyon, winter pines, bamboo, misty valley, wheat,
cherry blossom), the largest group by a distance, so a wall of tiles goes a long
way before a picture repeats. It leads the list, an unchosen `active` reads as
`nature`, and its picture set is the substrate's default tile fill. Anyone who
had never chosen a set — the earlier Steel and Photos ship defaults — is moved
onto it once, by the `hc:substrate-sets-v` marker; a deliberate choice is left
alone.

**The tiles move with the default.** Advancing the source only decides what a
*blank* tile will be given, so the one-time advance also **re-dresses every tile
wearing an old default** — each gets its own Nature picture, so the wall stays
varied. What moves is exactly what `force` moves: the provenance ledger plus the
live pool — **and the `substrate: true` mark written into every props record the
service mints**, which is the only test that recognises a picture placed before
the ledger existed. (Without it the move found nothing on a real hive: once the
source switches, the old pool is gone and a later ledger never saw those
pictures.) A picture you attached, pasted or edited in carries no mark and is
never touched; an unreadable record is not a default either. A hive-wide
re-dress walks **places**, not names — index entries are keyed by full lineage,
so a flat list of labels only ever resolves the page you are standing on. And a
re-dress **replaces in place**: it does not clear the tile and hand it to the
blank path, which refuses any tile whose canonical slot holds an image — a
default placed earlier is exactly such an image, so the cleared entry was never
refilled and the reconciler healed the old picture straight back. Canonical is
restamped alongside the index whenever what it holds is a default of ours. It runs at idle on its own marker (`hc:substrate-redress-v`),
because re-dressing needs history and the new pool, which are not ready when the
registry loads; a boot that finds them unready leaves the pass armed and it runs
again next time. Someone who had chosen Nature themselves is never armed and
never re-rolled. To do the same by hand at any time: `/background nature.force-global`.

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
