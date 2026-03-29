# Tile Overlay Architecture

The tile overlay is a Pixi.js-based contextual action system that appears when the user hovers over a hexagonal tile. It renders a neon-glow hex background with animated particles, positions action icons around the tile, and handles click interactions to dispatch actions.

## File Map

All files live under `hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/`:

| File | Responsibility |
|------|---------------|
| `tile-overlay.drone.ts` | Core overlay host: hover tracking, icon container lifecycle, hit-testing, visibility |
| `hex-icon-button.ts` | Renders a single icon as either an SVG sprite or a `hypercomb-icons` font character |
| `tile-actions.drone.ts` | Registers the default icon set and handles their click actions |
| `hex-overlay.shader.ts` | Animated neon hex background: directional bloom, breathe pulse, ember particles, ambient drift |
| `tile-selection.drone.ts` | Selection outlines with leader/follower distinction and pulsing animation |
| `move-preview.drone.ts` | Swap-indicator hexes showing where tiles will land during a drag-move |

Supporting geometry:

| File | Responsibility |
|------|---------------|
| `presentation/grid/hex-geometry.ts` | `HexGeometry` interface and `DEFAULT_HEX_GEOMETRY` (32px circumRadius, 6px gap) |
| `navigation/hex-detector.ts` | `pixelToAxial()` — converts screen pixels to hex axial coordinates |

## Coordinate System

The grid uses **hexagonal axial coordinates** (`q`, `r`). A third axis `s` is derived (`q + r + s = 0`).

```
HexGeometry {
  circumRadiusPx: 32    // hex outer radius in pixels
  gapPx: 6              // gap between adjacent hexes
  padPx: 10             // padding around the grid
  spacing: 38           // circumRadius + gap — center-to-center distance factor
}
```

Axial-to-pixel conversion (pointy-top, the default):

```
x = sqrt(3) * spacing * (q + r/2)
y = spacing * 1.5 * r
```

Flat-top variant:

```
x = 1.5 * spacing * q
y = sqrt(3) * spacing * (r + q/2)
```

Tiles are identified by their axial key string `"q,r"` and looked up in an occupied map (`Map<string, { index, label }>`).

## Overlay Lifecycle

```
User hovers over canvas
    |
    v
pointermove fires on document
    |
    v
clientToPixiGlobal() converts browser coords to Pixi global coords
    |
    v
renderContainer.toLocal() converts to mesh-local coords
    |
    v
detector.pixelToAxial() snaps to nearest hex (q, r)
    |
    v
If hex changed:
    - Update #currentAxial, #currentIndex
    - Resolve profile (private / public-own / public-external)
    - Rebuild icons if profile changed
    - positionOverlay() moves the Container to the hex center + mesh offset
    - updateSeedLabel() shows "index-label" debug text
    - updatePerTileVisibility() shows/hides conditional icons
    - Emit tile:hover effect
    |
    v
updateIconHover() checks pointer distance to each icon for hover tint
    |
    v
On click: hit-test visible buttons → emit tile:action or tile:click
```

### Visibility Rules

The overlay is visible when:
- The hovered hex is occupied (has a tile)
- The editor is not active
- No edit cooldown is in progress (300ms after editor closes)
- No tiles are selected (Ctrl/Meta+click mode)
- No touch drag is in progress

During image drag-over (`drop:dragging` or `drop:pending`), the overlay is visible but all action icons are hidden — it acts purely as a drop-target indicator.

## Icon System

### OverlayActionDescriptor

Icons are defined as descriptors and registered through the EffectBus:

```typescript
type OverlayActionDescriptor = {
  name: string                              // unique action identifier
  svgMarkup?: string                        // full SVG string (rendered as data URI texture)
  fontChar?: string                         // single char from 'hypercomb-icons' font
  x: number                                 // pixel offset from hex center (horizontal)
  y: number                                 // pixel offset from hex center (vertical)
  iconSize?: number                         // width and height in pixels (default: 8.75)
  hoverTint?: number                        // hex color applied on hover (e.g. 0xa8ffd8)
  profile: OverlayProfileKey                // which context this icon appears in
  visibleWhen?: (ctx: OverlayTileContext) => boolean  // per-tile conditional visibility
}
```

### HexIconButton

Each descriptor becomes a `HexIconButton` (extends Pixi `Container`):

- **SVG mode**: loads the markup as a `data:image/svg+xml` URI into a `Sprite`
- **Font mode**: renders the character using a `Text` with `fontFamily: 'hypercomb-icons'`
- **Hit-testing**: `containsPoint(localX, localY)` checks a simple bounding box (`0..width`, `0..height`)
- **Hover**: setting `button.hovered = true` applies `hoverTint`; `false` restores white

### Profiles

Icons are partitioned into three profiles based on mesh context:

| Profile | When Active | Purpose |
|---------|------------|---------|
| `'private'` | Default (not in public mesh) | Full edit control: add, edit, remove, search, toggle |
| `'public-own'` | In public mesh, hovering own tile | Limited: hide from public view |
| `'public-external'` | In public mesh, hovering external tile | Social: adopt into own mesh, block |

When the user hovers a tile, the overlay resolves the profile:
1. If not in public mesh: `'private'`
2. If in public mesh and tile is external: `'public-external'`
3. If in public mesh and tile is own: `'public-own'`

If the profile changes (e.g. moving from own tile to external tile in public mesh), all icons are torn down and rebuilt from the registered descriptors matching the new profile.

### Per-Tile Visibility

Some icons only appear on certain tiles. The `visibleWhen` callback receives:

```typescript
type OverlayTileContext = {
  label: string      // tile's seed label
  q: number          // axial q
  r: number          // axial r
  index: number      // position in cell array
  noImage: boolean   // true if tile has no image assigned
}
```

Example: the "search" icon only appears on tiles without an image (`ctx.noImage === true`), while the "toggle-visibility" icon only appears on tiles that have an image.

## Default Icons

Registered by `TileActionsDrone` when `render:host-ready` fires:

### Private Profile

| Name | Render | Position | Hover Tint | Visibility | Action |
|------|--------|----------|-----------|------------|--------|
| `add-sub` | Font `~` | x:-14, y:5 | Green `0xa8ffd8` | Always | Prefills search with `label/` |
| `edit` | Font `2` | x:-2, y:5 | Blue `0xc8d8ff` | Always | Emits `tile:action` (editor listens) |
| `remove` | SVG (trash can) | x:7.9375, y:5 | Red `0xffc8c8` | Always | Emits `seed:removed` |
| `search` | SVG (magnifier) | x:19.25, y:5 | Green `0xc8ffc8` | `noImage` only | Prefills search with label |
| `toggle-text` | Font `J` | x:8.625, y:5 | Yellow `0xfff0c8` | Always | Emits `tile:toggle-text` |
| `toggle-visibility` | SVG (eye) | x:19.25, y:5 | Cyan `0xc8e8ff` | Has image only | Toggles hidden state in localStorage |

### Public-Own Profile

| Name | Render | Position | Hover Tint | Action |
|------|--------|----------|-----------|--------|
| `hide` | SVG (slashed eye) | x:8.625, y:5 | Orange `0xffd8a8` | Adds to `hc:hidden-tiles:{location}` in localStorage |

### Public-External Profile

| Name | Render | Position | Hover Tint | Action |
|------|--------|----------|-----------|--------|
| `adopt` | SVG (plus) | x:8.625, y:5 | Green `0xa8ffd8` | Emits `seed:added`, runs processor |
| `block` | SVG (circle-slash) | x:-2, y:5 | Red `0xffc8c8` | Adds to `hc:blocked-tiles:{location}` in localStorage |

## How to Add a New Icon

### Step 1: Define the Descriptor

Create an `OverlayActionDescriptor` with either SVG markup or a font character:

```typescript
const MY_ICON: OverlayActionDescriptor = {
  name: 'my-action',
  svgMarkup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
    <path fill="white" d="..."/>
  </svg>`,
  x: 14,            // pixels right of hex center
  y: 5,             // pixels below hex center
  hoverTint: 0xaaffcc,
  profile: 'private',
  visibleWhen: (ctx) => ctx.noImage,  // optional
}
```

**SVG guidelines**: use `viewBox="0 0 96 96"` with `fill="white"` paths. The overlay applies tint at runtime.

**Font character**: use `fontChar` instead of `svgMarkup` with a character from the `hypercomb-icons` font.

### Step 2: Register via EffectBus

Register from any drone's heartbeat after `render:host-ready`:

```typescript
this.onEffect('render:host-ready', () => {
  this.emitEffect('overlay:register-action', MY_ICON)
})
```

Or register a batch:

```typescript
this.emitEffect('overlay:register-action', [icon1, icon2, icon3])
```

### Step 3: Handle the Action

Listen for `tile:action` and filter by your action name:

```typescript
this.onEffect<{ action: string; label: string; q: number; r: number; index: number }>('tile:action', (payload) => {
  if (payload.action !== 'my-action') return
  // handle it
})
```

### Step 4: Unregister (Optional)

To remove an icon at runtime:

```typescript
this.emitEffect('overlay:unregister-action', { name: 'my-action' })
```

## How to Reposition Icons

Icon positions are pixel offsets from the hex center. All default icons use `y: 5` (slightly below center) and vary `x` to space them horizontally.

To reposition:
1. Change the `x` and `y` values in the descriptor
2. Re-register the icon (or unregister + register with new values)
3. The overlay calls `#rebuildActiveProfile()` which destroys all buttons and recreates them from the current descriptors

At runtime, you can also set `button.position.set(newX, newY)` directly on a `HexIconButton` instance if you have a reference to it, though this bypasses the descriptor system.

## Neon Overlay Animation

The hex background (`HexOverlayMesh`) renders entirely with Pixi `Graphics` (no shaders or textures):

### Static Layers (drawn once)
1. **Outermost bloom** — faint stroke at 1.27x radius
2. **Outer bloom** — slightly brighter stroke at 1.21x radius
3. **Dark fill** — hex interior at 1.07x radius, dark tinted
4. **Inner bloom (far)** — faint stroke at 1.03x radius
5. **Inner bloom (near)** — brighter stroke at 1.09x radius
6. **Primary neon edge** — saturated stroke at 1.15x radius
7. **Hot core edge** — bright narrow stroke at 1.15x radius

Each stroke uses directional lighting (top-left, 10 o'clock) to modulate alpha per edge.

### Per-Frame Animations
- **Breathe**: 4-second sine cycle modulating hex glow alpha (0.80 to 1.00)
- **Entry**: 0.18s scale-in (0.95 to 1.0) with cubic ease-out + fade-in
- **Embers**: 3 colored dots hopping along the hex perimeter. Each has a 6-second cycle: 3s moving (ease in-out cubic) + 3s dwelling, with a brief flash on arrival
- **Ambient**: 2 faint particles drifting inside the hex on Lissajous curves (8-second period)

### Color Palettes

Five neon presets (Cyan, Magenta, Green, Gold, Violet), each defining:
- `core`, `bright`, `mid`, `dim`, `white` — stroke colors at different intensities
- `fill` — dark interior color
- `embers[]` — glow/core colors and starting edge for each ember

Palette is persisted in `localStorage` under `hc:neon-color` and cycled via `overlay:neon-color` effect.

## Selection System

`TileSelectionDrone` renders selection overlays independently from the hover overlay:

- **zIndex 5000** (overlay is 9999, so selection renders beneath it)
- **Leader tile**: gold border (pulsing counter-phase), outer glow halo, vertex markers with rings
- **Follower tiles**: green border (pulsing in-phase), vertex accent dots
- **Animation**: 3-second sinusoidal pulse at 30 FPS cap
- **Keyboard navigation**: arrow keys move leader to adjacent occupied hex, scanning past empty cells
- **Move preview**: during drag-move, selection overlays follow tiles to preview positions

## Move Preview

`MovePreviewDrone` draws swap-indicator hexes for tiles displaced by a drag-move:

- Listens for `move:preview` with proposed layout
- Compares new positions against original positions
- Draws orange semi-transparent hexes on tiles that moved but aren't in the user's drag set

## EffectBus Event Reference

### Listened by TileOverlayDrone

| Effect | Payload | Purpose |
|--------|---------|---------|
| `render:host-ready` | `{ app, container, canvas, renderer }` | Initialize overlay after Pixi is ready |
| `render:mesh-offset` | `{ x, y }` | Track grid pan position |
| `render:cell-count` | `{ count, labels, coords, branchLabels, externalLabels, noImageLabels }` | Rebuild occupied map |
| `render:set-orientation` | `{ flat: boolean }` | Switch pointy-top / flat-top |
| `render:geometry-changed` | `HexGeometry` | Hex size/spacing changed |
| `overlay:register-action` | `OverlayActionDescriptor \| OverlayActionDescriptor[]` | Add icon(s) |
| `overlay:unregister-action` | `{ name }` | Remove an icon |
| `overlay:neon-color` | `{ index }` | Switch color palette |
| `mesh:public-changed` | `{ public: boolean }` | Toggle public mesh profile |
| `editor:mode` | `{ active: boolean }` | Hide overlay during editing |
| `selection:changed` | `{ selected: string[] }` | Hide overlay when tiles are selected |
| `drop:dragging` | `{ active: boolean }` | Image drag-over state |
| `drop:pending` | `{ active: boolean }` | Image drop pending state |

### Emitted by TileOverlayDrone

| Effect | Payload | Purpose |
|--------|---------|---------|
| `tile:hover` | `{ q, r }` | Currently hovered hex position |
| `tile:action` | `{ action, q, r, index, label }` | Icon clicked |
| `tile:click` | `{ q, r, label, index, ctrlKey, metaKey }` | Tile clicked (no icon hit) |
| `tile:navigate-in` | `{ label }` | Branch tile entered |
| `tile:navigate-back` | `{}` | Right-click navigated back |
| `drop:target` | `{ q, r, occupied, label, index, hasImage }` | Drop target info during drag |
