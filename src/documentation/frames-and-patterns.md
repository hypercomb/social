# Frames and patterns

A **pattern** is a shape. A **frame** is a place read through one. They are two
artifacts, deliberately kept apart: patterns are authored, saved and shared on
their own; frames merely point at one. Any pattern can be applied to any frame,
and one pattern can be applied to as many as you like.

## The two things

### Pattern — `{ kind: 'pattern', name, coords, step }`

An ordered set of axial slots plus the rigid translation one scroll step
applies. Nothing about tiles, lineages or cameras is in it. Stored as a
content-addressed resource at the OPFS root, so identical patterns dedup to one
sig and a peer can resolve one the same way they resolve an image.

`src/hypercomb-essentials/src/sequence/pattern.ts`

Built-ins seeded into every palette (ordinary patterns — nothing in the frame
path knows they are built in):

| name | shape | capacity | rows | tiles per step |
|---|---|---|---|---|
| `honeycomb` | 4 / 5 / 4 | 13 | 3 | 3 |
| `honeycomb-wide` | 6 / 7 / 6 | 19 | 3 | 3 |
| `hexagon` | 3 / 4 / 5 / 4 / 3 | 19 | 5 | 5 |

### Frame — the `layout:frame` decoration

Binds a pattern to a branch. It rides the `decorations` slot exactly like
`sequence:target` and resolves by walking the lineage UPWARD, so **every
descendant inherits it** — mark a parent and the whole branch below reads
through the same shape, until a descendant declares its own and nearest-ancestor
resolution hands it the win.

`payload.patternSig` points at the pattern resource. Never inline: N frames on a
pattern are N references, so editing the pattern moves every frame bound to it.

`sequence/frame-target.ts` · `sequence/frame.service.ts`

## What a frame does

**Positions are the pattern's.** Every tile at the location is placed by the
pattern, in the tiles' own relative order. Nothing is persisted by the framed
render — a frame is a way of READING the layer, and each tile's own `index`
survives underneath untouched, so releasing the frame returns the page exactly
as it was arranged.

**Size and framing are the pattern's.** The viewport fits the pattern's
rectangle, not the content's — a half-full frame fits the same rectangle a full
one does, so tiles never resize as the page fills. Pan and zoom stand down while
a frame is bound: free travel would undo the promise within one gesture.

**There is no cap.** A framed layer holds as many tiles as you like. Tiles past
the frame are WAITING, not refused.

**The tiles travel, the camera does not.** Space-drag and the wheel walk the
ordered tile list through the fixed slots. One step is one rigid `step`
translation: `stride` tiles leave the trailing edge, `stride` arrive at the
leading one, and every tile still on-frame moves by exactly one hex. Drag right
and the tiles follow your hand.

The scroll offset is a VIEWING position, like zoom — participant-local, per
location, uncommitted, and never inherited by a peer walking into your tile.

## Why stride is derived, never authored

One scroll step translates the pattern by `step`. The slots with no neighbour
one `step` further along are the trailing edge that empties; their count IS the
stride. On the 4/5/4 block that is 3 — one middle-row tile and one interlocking
pair — which is exactly the count that makes the shift land back on the lattice.
Any pattern scrolls rigidly by construction, whatever shape it is, because the
number comes from the shape rather than from a guess.

## Commands

```
/pattern               the patterns you have, and what each holds
/pattern grid          draw (or redraw) the shape called "grid"
/pattern honeycomb     open a built-in and make it yours

/frame                 what frames this branch, and the patterns available
/frame honeycomb       frame it — 4/5/4, three rows, fit to the window
/frame off             release the frame declared here
```

Two verbs, because they are two things: `/pattern` draws a shape and binds it
to nothing; `/frame` is what puts one somewhere. The same pattern can be framed
in as many places as you like.

## Drawing one

`/pattern <name>` opens the hex editor `/sequence` already uses — a blank
hidden layer, a ghost hex on the cursor, click to place, click a placed hex to
remove — and differs only in what Done writes. A sequence saves ordered spiral
indexes and BINDS them to the branch it was launched from; a pattern saves the
same hexes as relative axial coords and binds nothing.

Coords are saved exactly where they were drawn: the editor's grid origin is the
grid origin, so what you drew is where the frame sits.

The click ORDER is meaningful for a sequence and not for a pattern. A frame
derives its fill order from the shape's own geometry (`scrollOrder` — along the
scroll axis, then across it), because that is the only order in which a step
translates the block rigidly. In pattern mode the numbers are a count and a
click-to-remove handle, nothing more.

Opening a built-in by name loads it for editing; saving under that name puts
your copy in the palette, where it wins from then on.

## Where it hooks in

| File | Change |
|---|---|
| `sequence/sequence-editor.bee.ts` | Two modes, one editor — `openPatternEditor` and the pattern branch of `#done`, plus the spiral-index ⇄ axial-coord mapping. |
| `presentation/tiles/show-cell.drone.ts` | `#applyFrame` re-packs the sparse slot array at the end of `#orderByIndexPinned` — the one placement chokepoint. Framed pages also skip the incremental paths: adding one tile can move any of the others, so the slot machine's "put it in a free slot" is the wrong answer. |
| `navigation/pan/panning.drone.ts` | `panBy` is inert while framed. |
| `navigation/pan/spacebar-pan.input.ts` | Space-drag walks the tiles instead of the canvas. |
| `navigation/zoom/zoom.drone.ts` | User zoom inert; the fit measures the frame; refits when the frame or the canvas changes. |
| `navigation/zoom/mousewheel-zoom.input.ts` | The wheel walks the tiles — one notch, one step. |
| `navigation/zoom/pinch-zoom.input.ts` | Pinch inert. |

### Two lattices, five times apart

`AxialCoordinate.getLocation` scales by `Settings.hexagonSide` (200); the mesh
lays hexes out on `HexGeometry.spacing` (38) and draws each one larger than its
cell by `padPx`. Measuring a frame in the wrong space shrinks the fit by that
factor. `expandToFrame` sidesteps both the origin and the rim by anchoring to
the bounds the renderer actually reports and adding only the lattice DISTANCE
from the occupied slots out to the frame's edge. When the frame is full the two
rectangles coincide.

## Not a view

A frame is placement, not a takeover. It does not trap navigation, does not
replace the surface, and composes with whatever view the layer opens as. It is
the sibling of `sequence:target`, not of `view:default`.
