# The lift view

*The page lifted off the grid into 3D, with its other layers stacked behind it
like a slide deck. Look at every version at once, and pick the parts.*

`/lift` toggles it. The renderer is `hypercomb-essentials/src/presentation/tiles/lift-view.drone.ts`;
what the deck *means* is `lift-deck.ts` (pure, specced); the pixels are
`lift-scene.ts`.

---

## What it rests on

[Superimposition](superimposition.md): two trees at the same address **are the
same tree**. A participant's version of a page is not a second page. It is a
LAYER over yours, and so is every earlier version of your own. The 2D hive
already reads this one tile at a time: the participant stack (`tile-stack.ts`)
and the spotlight roll. Lifted, the whole deck is in view at once:

1. **the page as drawn** at the front: the page's one answer
   (`page-cells.ts`), at the grid coordinates the 2D page drew each tile at;
2. **each participant's version**, in the stack order the spotlight cycle uses.
   Their tiles sit at their *own* seats, so rolling onto a participant shows
   their arrangement and not yours with their pictures in it;
3. **the page's history**, newest first, at most twelve, the head left out
   because the front already is the head. These are read only:
   `listLayers` + `getLayerBySig`, never `latestMarkerSigFor`, which writes.

Every prism sits at its tile's true centre at its true size (the same
axial → pixel numbers show-cell draws with), and the top face carries the
tile's hex capture (`small.image`, or `flat.small.image` flat-top). That
capture already bakes in the participant's pan and zoom, so the picture lands
exactly as the grid draws it. A tile whose layer names no picture (a fresh
tile is just `{ name }`) gets the same stand-in the grid paints: its reference
face, else the substrate's deterministic pick for its label. It is the same
signature in every layer, so it marks as the same picture, and it is never
written. The camera opens face-on, fitted to the front
layer, so for a moment it reads as the 2D page. Then it tilts and the stack
shows.

## The marks

Diffed **by name, never by signature**. A tile's layer sig changes with every
edit beneath it, so a sig on its own says nothing. What the eye compares is
the picture.

| Mark | Colour | Means |
|---|---|---|
| same | teal / cyan | every layer holds the tile, with the same picture |
| differs | amber | every layer holds it, and the picture differs somewhere |
| missing | rose / magenta | at least one layer lacks it |
| staged | violet | you have picked a version of this tile from another layer |

Deviation is content, and absence must say why. Where a deeper layer lacks a
tile the front has, that layer shows a faint **ghost outline** in its place.

## The gestures

- **Wheel over empty space** flips the whole deck. The layers in front of the
  one you choose are dealt off toward you, and the chosen one settles where
  the page was. The deck stops at its first and last layer instead of wrapping.
- **Wheel over a tile** rolls *that tile* through its versions across the
  deck and stages the one you stop on. This is how you change parts. A tile the
  front does not hold rolls through "not taken" too, so you can adopt it.
- **Ctrl/⌘ + wheel** or a pinch zooms. **Left-drag** pans. **Right-drag**,
  **shift + left-drag** or **alt + wheel** tilts and turns. A plain right-click
  is still the way out, as everywhere (`back-gesture.service.ts`).
- On touch, one finger pans, two fingers pinch, and a two-finger vertical
  swipe flips.

Hovering a tile says whose version you are looking at: "you · 1 of 3",
"history · 2 h ago", or a participant's short key. Names are DOM text over
the scene, never canvas text.

## What Apply writes, and through which door

Nothing is written while you look. Hovering, flipping and rolling are all
in memory. Apply (or Enter) carries the choice through doors the hive already
has:

| You chose | Apply does | The same door as |
|---|---|---|
| a participant's whole layer | `SpotlightService.set(pubkey)`: a **view**, not a write | the 2D stack roll |
| a history layer | `HistoryService.promoteToHead(pageLocSig, layerSig)` | the rewind window's Save (`edit-actions.component.ts`) |
| a participant's tile | `SwarmAdoptDrone.adoptResolvedBranch({ layerSig, at, label }, { silent: true })` | the adopt gesture |
| a history version of a tile | `promoteToHead(cellLocationSig(parent, name), layerSig)` | the rewind window's Save |

After a write it runs the same settle as Save: `cursor.load`,
`cursor.jumpToLatest`, `fs:changed`. Then the deck rebuilds.

**Every write is refused while the hive is showing the past**
(`cursor.state.rewound` or `history.previewActive`). The view says so and
does nothing. Reset clears what you staged and flips back to the front.
Escape leaves and writes nothing.

## The guards

- **Pixi's 3D loads lazily.** The renderer is `@pixi/3d` (three.js is retired
  here). The drone runs `await import('@pixi/3d')` on mount and nowhere else,
  and `lift-scene.ts` takes the module as an argument. No other lane pays for
  it. The drone sleeps (`readonly renders = ['lift']`) until the mode enters
  `lift`, and the queen never asks for it by key.
- **The scene has a Pixi application of its own.** `@pixi/3d` joins a renderer
  when the renderer is MADE: it registers a backend loader that Pixi runs in
  `autoDetectRenderer`. The hive's renderer exists long before the lift view
  opens, so a lazily loaded `@pixi/3d` cannot draw on the hive's stage. Putting
  3D on that stage means loading the package before `PixiHostWorker` makes its
  application, which is a boot-lane cost and a separate decision.
- **A Pixi that may not eval is bridged.** The web shell and the hosts run the
  `pixi.js/unsafe-eval` build, whose polyfill keeps one function per uniform
  parser, found by index. `@pixi/3d` 0.1.0 brings four parsers as code strings
  only, and without their functions the first 3D draw throws
  `functionMap[i] is not a function`. `pixi3d-no-eval.ts` supplies the four
  functions; both vendor builds export the polyfill's tables for it
  (`hypercomb-web/scripts/build-pixi-vendor.ts`,
  `hypercomb-shim/scripts/build-vendor.mjs`). A parser the bridge does not know
  makes the scene decline to draw, and `pixi3d-no-eval.spec.ts` fails first.
- **No third-party request.** `@pixi/3d` names Google's CDN for the Draco
  decoder. The vendor step in `build-module.ts` rewrites both URLs to
  `/vendor/draco/` and counts them, as the Pixi vendor does for its
  transcoders. Nothing loads a Draco model today.
- **WebGL is probed first.** `LiftScene.create` asks a canvas for a `webgl2`
  context before it makes the application: Pixi's 3D has no WebGL1 path. A hive
  without one gets the notice "needs WebGL" and the way out, not a blank page.
  No renderer is ever made at module scope or in a constructor.
- **Render on demand.** A frame is drawn only when something changed or is
  animating, never while the tab is hidden. Flip and tilt motion honour
  `prefers-reduced-motion`.
- **Leaving never repaints the hive.** ShowCell does that on the flip back to
  `hexagons`. The mode is transient (`view-mode.service.ts`) because it covers
  the canvas.
