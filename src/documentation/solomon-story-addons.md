# Solomon's Key — story add-ons

A story add-on is a participant's piece of the world: places they made — walked
worlds, overhead chambers, side-view caverns — and the **seats** that plug them
into the story. A seat is one relation, `"place P sits in entrance E"`. Anything
in a place can be an entrance: a door, a signpost, a tablet, a chest, a stone in
a room's wall, a patch of open air. What becomes an entrance is decided by the
seat, never by what kind of thing it is.

Code: `hypercomb-essentials/src/games/solomon/story-addons.ts` (reading and
seating), `mossback.story.ts` (the worked example), `tile-surface.ts` (where the
tiles live).

## Where an add-on lives

Under the game's own branch in the hive, beside its rooms and its menu:

```
solomon-maze-v1/
├── <room tiles>…
├── menu/               one tile per menu option
└── stories/            one tile per story add-on
    └── mossback        solomonStory: { version: 1, bundle: { … } }
```

The first time the game opens it seeds `stories/` with the worked example. After
that **the tiles are the add-ons**. The word for plugging one in is `story`
(`games/story.queen.ts`):

- `story plug <sig>` — reads the JSON bundle stored under that signature,
  refuses it whole with the reason when anything is wrong, and otherwise writes
  it as the tile `stories/<bundle id>` (over any tile of that name).
- `story unplug <id>` — puts an add-on away: HIDE FIRST, DELETE SECOND. The
  tile stands; the story is not seated until it is plugged again. It is
  concealed in the hive's one hidden pool (`hidden:items`, scope
  `solomon-story`) by the signature of its bytes, and is never deletable.
- `story plug <id>` — takes a put-away add-on back.
- `story list` — what the game holds: each add-on's places and seats, and
  which are unplugged.

Making the tile by hand — a tile under `stories/` whose layer carries
`solomonStory.bundle` — is the same act; editing the tile edits the add-on.

The game reads the tiles when it opens (before it continues a save, so a save
made inside an add-on's place can resume there). An add-on already seated this
session keeps its first reading; a reload picks up edits.

## The bundle

Plain data, JSON-shaped:

```json
{
  "version": 1,
  "id": "mossback",
  "name": "The Mossback",
  "worlds":   [ … WorldDefinition-shaped … ],
  "chambers": [ … ChamberDefinition-shaped … ],
  "caverns":  [ … { id, name, subtitle, theme, meters, art, finds } … ],
  "seats":    [ { "entrance": "greenwood/grove-gate-sign", "place": "mossback" } ]
}
```

- `id`, and every place id: `^[a-z0-9-]{1,64}$`. A place id must be **new** —
  nothing that already stands can be redefined.
- `worlds` read through `sanitizeWorld` (worlds.ts): ground, people, signs,
  caches, doors, groves — no shrines, riddles or sealed caverns, which belong to
  the valley's own story.
- `chambers` read through the same build every authored chamber goes through
  (`buildChamber`) and must be arrivable; the map's glyphs are the chamber
  legend's; a chamber may carry `foes`.
- `caverns` are ASCII plans drawn exactly like the game's own (`drawCavern`):
  `art` lines of equal width with one `<` mouth, optional `>` deeper, `:` deep
  finds; `finds` a second layer of item glyphs.
- `seats`: `entrance` is `"<host place>/<entrance id>"`; the host may be a
  built-in place or one in this bundle; the entrance must be something the host
  really has; nothing may be seated behind it yet; `arrive` names one of the
  seated place's arrivals when it has several.
- The whole bundle may weigh at most 256 KB serialized.

Anything wrong anywhere refuses the **whole** add-on; the game says why, once,
and goes on without it. Refusals: unreadable bundle; a place name that already
stands; a seat behind a taken entrance; an entrance the host does not have; a
place nobody knows; and a story that would put a place inside itself (the seats
are checked with `validateStory` together with the built-in story).

## The worked example

`mossback.story.ts`: one world, **The Mossback** — the ridge the Greenwood's
signpost names — seated behind that very signpost (`greenwood/grove-gate-sign`).
It carries a shepherd, a cairn, a kite's nest and a shut mine (`old-mine`) that
nothing is seated behind: an invitation for the next add-on, exactly as the
Greenwood's own unseated doors were.

## What an add-on cannot do (yet)

- Redefine or reseat a built-in place, or an entrance the story already uses.
- Add labyrinth rooms (rooms hydrate from their own tiles; a room add-on is a
  different act).
- Carry attainment rows or guide steps; its places show in crumbs, saves and
  the found-set only.
