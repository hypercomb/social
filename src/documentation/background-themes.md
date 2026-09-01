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
| `nature` (**default**) `photos` `minimal` `geometric` `abstract` `cosmos` `ink` `botanical` | tiles |
| `steel` `daylight` `indigo` `teal` `ember` | screen + tiles |
| `off` | clears the screen |

The generated sets share one art direction (2026-08-20 quality pass): film
grain over every plate, gaussian-blur atmospherics and glow, layered
silhouettes with real atmospheric perspective, seeded randomness so a re-run
reproduces the exact pictures — and a calm, mid-to-dark centre band, because
the white tile label lives there. `cosmos` (ten deep-space plates), `ink`
(eight sumi-e washes on paper), and `botanical` (eight foliage plates, leaves
at the edges only) joined in the same pass.

**Nature is the ship default** — twenty scenes (dawn ridges, alpine lake,
ocean, sunset cloudbank, desert night, forest light shafts, terraces, storm
light, aurora, misty pines, lavender, moon over water, autumn fog, cherry
bokeh, canyon beam, alpenglow, firefly meadow, waterfall mist, prairie
thunderhead, winter birches), the largest group by a distance, so a wall of tiles goes a long
way before a picture repeats. A scene has to sit *behind* a tile's own content,
so every plate keeps its centre band low-frequency and its values controlled —
detail lives toward the edges, and the label pill always has a calm field to
sit on. It leads the list, an unchosen `active` reads as
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
`scripts/backgrounds/gen-tile-themes.mjs` generates the seven image themes.

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

## The Backgrounds window

`/background` with nothing after it opens a tool window rather than printing
the list into the activity log — a list you cannot look at while you choose
from it, and whose lines could never show you what a look actually was.

It has TWO SECTIONS, because there are exactly two things being dressed, and
they are peer sections over one subject so exactly one is open at a time
(`ui/accordion.ts`):

- **SCREEN** — what is behind the hive. Your own picture first, then the drawn
  looks.
- **TILES** — the groups that fill blank tiles, and every picture in the live
  group with an eye beside it.

`/background screen` and `/background tiles` open the window ON that section,
so the command line and the surface land in the same place.

## A picture behind the hive

Until now the screen could only ever be a drawn pattern, so the answer to "how
do I set a backdrop image?" was, correctly, that you could not. Now you can:
choose a file, or press the wallpaper icon beside any picture in the tiles
pool.

It is held the way every other piece of content is held. **The preference
stores a SIGNATURE**; the bytes live at the content root; the object URL is a
session handle on them. A file you bring in is downscaled to 2560px on its long
edge and becomes a signed resource first, so the same picture behind the hive,
on a tile and in the references pool is one file with three references. Nothing
is copied into localStorage and nothing is written to a layer — a peer opening
the same hive sees their own screen.

**A picture stands in for the pattern.** Contour rings over a photograph are
two backdrops fighting for one screen, so while a picture is showing the
patterned half steps aside whole: the body carries the base colour, the lattice
layer is told there is nothing to draw, and the palette survives as the wash
the picture is read through. Remove the picture and the drawn look comes back.

**The opacity is the one number.** The picture arrives exactly as chosen —
**100% opacity is the default**, no wash taken up front. Anything less washes
it toward the palette, for when a white tile label needs a calmer field to sit
on — a slider in the window, 0–100, and `/background screen.opacity.60` from
the line (`screen.wash` still parses, unoffered: wash 60 = opacity 40). A
bright look washes toward white and a dark one toward its own deep: dimming a
photograph to black under cream panels reads as a hole.

**Saved backdrops sort into light and dark.** Below the slider sit two
shelves, Light and Dark. A picture says NOTHING by default — dragging the
active picture's chip onto a shelf IS the sorting, and a picture already on
the other shelf moves rather than copies. Click a saved one to wear it; the ×
takes it off its shelf (the bytes, as ever, are content and are left alone).

**The shelves live in a pool of meaning** — `backgrounds:saved`, one
content-addressed doc `{ light: [sigs], dark: [sigs] }` (seeded in
`pool-registry.ts`). Anything that should be queryable across the network
belongs in a pool — domains then become gates for discovering that content.
Shelf entries an interim build left in the pref are adopted into the pool once
and never written back.

**And so does the screen itself** — `backgrounds:screen`, one doc naming the
picture's signature plus how it is washed, zoomed and offset. What is showing
is still a participant-local CHOICE, but participant-local never meant
localStorage-only here (the viewport is participant-local and lives in a pool),
and keeping it there alone cost two things:

- **Reachability.** Nothing in the hive referenced the backdrop's bytes. A
  resource no marker and no pool member names is, to every collector in this
  system, litter from an abandoned gesture — indistinguishable from a paste
  that was escaped. A pool member naming the signature makes it referenced
  content, which is what it always was.
- **Travel.** A replicated hive, a second origin, a browser that dropped its
  storage — each arrived with the picture present in the store and no idea it
  was the backdrop.

`hc:canvas-bg` (carrying `v: 2`) stays as the instant read, because the first
paint cannot wait for OPFS; the pool is the durable half. The pref WINS
whenever it names a picture, or says the backdrop is off — the pool only
speaks where nothing local does.

Three traps this cost, all worth keeping written down:

- **The boot read was TIMED rather than waited for.** The picture resolved on
  a fixed eight-second ladder, and on a large hive the store settles after
  that: the read gave up, the screen fell back to a pattern, and the
  preference went on naming a picture that was sitting right there. That is
  what "I keep losing my background" was. The wait is exact now — the
  registration is polled (a service locator cannot announce a registration
  that already happened, which is why `whenReady` never settles here) and
  readiness is the store's own idempotent `initialize()`. A signature that
  resolves to nothing is KEPT and said out loud once, never cleared.

- It was briefly its own fixed element so the blur could be live CSS. That
  element measured **0×0** on the shell's real page — a `position: fixed` box
  whose containing block is not the viewport is a whole class of bug this file
  had already avoided by never leaving the body. It is body background layers
  now, like every other backdrop here.
- **The store answers before it is ready.** It registers in IoC while OPFS is
  still opening, so one read at boot came back null for a picture that was
  plainly there, and the backdrop stayed a pattern until the next change. The
  boot resolve now asks again on a short ladder (`RESOLVE_LADDER`, six tries
  over about eight seconds).

## The light and dark worlds

A wall of deep-space plates under cream panels is not a choice anyone makes on
purpose, and neither is a set of paper washes under near-black chrome. **The
list follows the chrome**: under a bright theme you are offered the looks that
go with a bright theme, and under a dark one the dark ones.

- A **screen** look never declares which world it is in — its palette already
  knows, and `mood()` reads it from there. Asking twice is a second source of
  truth that can only drift.
- A **tile** group has no palette, so it says so in its own entry:
  `mood: 'light' | 'dark'`. A group that says nothing suits BOTH, which is the
  honest answer for a mixed collection like `photos` rather than a coin toss.

Two rules keep the filter from becoming a cage:

- **The look you are wearing is always on its own list.** Nature is the ship
  default and is a dark group, so under a bright chrome the filter took the
  active group off the list — leaving six groups, none of them marked, above
  the twenty pictures the seventh was actually handing out.
- **`half(which, all)` has an escape hatch**, and the window draws it as a
  checkbox that only appears when something is actually being held back.
  Typing a name still applies it either way: the filter is about what is
  OFFERED, never about what is allowed.

One rule, asked of one service, so the window and the command dropdown cannot
drift into offering different lists.

## Hiding a picture

A group of twenty scenes will always contain two you do not want on your wall.
The eye beside each picture takes it out of the rotation — it is never handed
to a blank tile again — and `/background tiles.hidden` lists what you have
taken out, `tiles.hidden.clear` puts them all back.

The hidden set is **persisted** now (`hc:substrate-hidden`). It used to live
only in memory and came back on every reload, which made "hide the ones I don't
want" a thing you did again every morning. Participant-local, never a layer,
never a peer's — the same rule the colour theme and the screen backdrop keep.

## The grammar

```
/background                          — open the window
/background screen                   — the screen half, in the window
/background screen.<look>            — dress the screen
/background screen.picture           — choose a picture of your own
/background screen.picture.remove    — back to a drawn look
/background screen.opacity.<0-100>   — how much of the picture shows
/background screen.off               — bare surface
/background tiles                    — the tiles half, in the window
/background tiles.<group>            — fill blank tiles from that group
/background tiles.<group>.items      — show the group's pictures
/background tiles.<group>.<picture>  — pin ONE picture onto every tile
/background tiles.<group>.force      — also re-dress this layer's tiles
/background tiles.<group>.force.global — … every tile in the hive
/background tiles.hidden             — the pictures you have taken out
/background tiles.hidden.clear       — put them all back
```

**The two halves are the first fork now.** Until this pass the only place the
screen/tiles distinction appeared was a description string in the dropdown, so
someone looking for a backdrop image found a flat list of theme names with no
way to tell which of them was even about the screen.

A bare theme name still applies — `/background ember` lands exactly as it
always did. It is simply not what the dropdown teaches any more.
