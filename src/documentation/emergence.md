# Emergence — The Rendering of the Hive

The visual rendering of the hive follows a lifecycle borrowed from the colony itself. Tiles do not simply appear — they are **brooded** (prepared), and then they **eclose** (emerge onto the screen). Together, these phases form the **Emergence**: the organic process by which data becomes a living honeycomb.

| Term | Meaning | Analogy |
|------|---------|---------|
| **Emergence** | The full rendering lifecycle | The colony's reproductive cycle |
| **Brood** | Preparation — gathering cells, mapping coordinates, loading atlases | Larvae incubating in capped cells |
| **Eclosion** | Birth onto screen — geometry built, mesh created, stage populated | Adult bee chewing through the wax cap |

## Current Model

All tiles render as a **single mesh** — one geometry, one draw call, one SDF shader. There is no per-tile scene graph. When any cell changes, the entire mesh is rebuilt. This is fast (sub-5ms for typical hives) and keeps the GPU happy with a single draw call.

---

## Brood Phase

The brood phase gathers everything the mesh will need before any vertices are written.

### 1. Cell Discovery

`renderFromSynchronize()` in `ShowCellDrone` is the entry point, triggered by the `synchronize` window event (dispatched solely by the processor).

- Lists cell folders from the OPFS explorer directory
- Unions with mesh cells (Nostr relay items)
- Filters out deleted cells via history
- Orders by `OrderProjection` or persisted index

### 2. Coordinate Mapping

Each cell gets an axial coordinate `(q, r)` via `AxialService`. Index 0 sits at the center; subsequent cells spiral outward in concentric rings.

```
axial.items.get(index) → { q, r }
```

Axial coordinates convert to pixel positions via `axialToPixel(q, r, spacing, flat)`.

### 3. Cell Building

`buildCellsFromAxial()` maps the ordered cell names to their axial coordinates and decorates each with metadata:

- `external` — mesh (Nostr) vs local
- `hasBranch` — cell has child layers
- `borderColor` — from cell properties
- `heat` — activity indicator

Returns `Cell[]` — the canonical cell array that drives geometry.

### 4. Atlas Loading

Two texture atlases are prepared:

| Atlas | Class | Purpose |
|-------|-------|---------|
| **Label** | `HexLabelAtlas` | Renders cell names as text into a shared texture |
| **Image** | `HexImageAtlas` | Loads cell thumbnail blobs from `__resources__/` into a shared texture |

`loadCellImages()` reads each cell's `0000` properties file, extracts the image signature, and loads the blob into the image atlas. Signatures that are already in the atlas are skipped.

---

## Eclosion Phase

With all data brooded, the tiles eclose — geometry is built and the mesh appears on stage.

### 5. Geometry Building

`buildFillQuadGeometry()` packs every cell into typed arrays. Each cell is a **quad** (4 vertices, 2 triangles):

```
(x0,y0) ──── (x1,y0)
   │              │
   │    cell      │
   │              │
(x0,y1) ──── (x1,y1)
```

Vertex attributes per cell:

| Attribute | Floats/Cell | Content |
|-----------|-------------|---------|
| `aPosition` | 8 | Quad corner positions |
| `aUV` | 8 | Standard [0,0]→[1,1] UVs |
| `aLabelUV` | 16 | Label atlas region (u0, v0, u1, v1 × 4 corners) |
| `aImageUV` | 16 | Image atlas region |
| `aHasImage` | 4 | Flag (1.0 if image present) |
| `aHeat` | 4 | Activity heat value |
| `aIdentityColor` | 12 | RGB from `labelToRgb()` hash |
| `aHasBranch` | 4 | Branch flag |
| `aBorderColor` | 12 | RGB border color |
| `aCellIndex` | 4 | Cell index for hit detection |

Index buffer: 6 indices per cell (2 triangles).

### 6. Mesh Creation

`applyGeometry()` creates a Pixi `Mesh` with:

- The geometry from step 5
- The SDF hex shader (`hex-sdf.shader.ts`) — clips quads to hexagon shape, samples both atlases
- `Texture.WHITE` as the base texture (shader does the real work)

The mesh is centered in the viewport and added to the Pixi container.

### 7. Emergence Signals

Once eclosed, the mesh emits effects so other drones can react:

| Effect | Payload | Consumers |
|--------|---------|-----------|
| `render:cell-count` | `{ count, labels, branchLabels, externalLabels }` | Overlay, Selection, MovePreview |
| `render:mesh-offset` | `{ x, y }` | All overlay drones |
| `render:geometry-changed` | `{ circumRadiusPx, gapPx, padPx, spacing }` | All drones needing hex dimensions |

---

## Rendering Modes

### Whole Mesh (Default)

Full brood → eclosion cycle. The mesh is destroyed and rebuilt from scratch. Triggered by `synchronize`, `navigate`, `tile:saved`, `search:filter`, and others.

### Streaming (Layer Transition)

During layer changes, `streamCells()` ecloses tiles incrementally — batches of 8 cells with microtask delays between each. Each batch calls `applyGeometry()` with a partial cell array, so the hive fills in progressively rather than popping in all at once.

### Move Preview (Fast Path)

When tiles are dragged, `renderMovePreview()` takes a shortcut:

- Reuses cached `cellNames`, `localCellSet`, `branchSet`
- Reorders labels per the move's swap array
- Rebuilds geometry **without** re-reading OPFS or reloading images
- Still a full geometry rebuild, but skips all I/O

### Selective Eclosion (Not Yet Implemented)

Individual tile add/remove without full mesh rebuild. The geometry is monolithic typed arrays — surgical vertex updates cost nearly as much as a rebuild. Future direction: a tile placement approach with index/offset persistence and incremental geometry mutation.

---

## Interaction Layers (Post-Eclosion)

After the mesh ecloses, three overlay drones render on top of it using Pixi `Graphics`:

| Drone | Purpose | Trigger |
|-------|---------|---------|
| `TileOverlayDrone` | Hover action buttons (edit, delete, hide, add, search) | `tile:hover` |
| `TileSelectionDrone` | Leader tile highlight + selected tile shapes | Selection state change |
| `MovePreviewDrone` | Orange swap-target hexagons during drag | `move:preview` |

These are separate from the mesh — they draw programmatically over the correct hex positions using the `render:mesh-offset` and `render:geometry-changed` data.

---

## Trigger Map

Events and effects that cause re-emergence:

| Trigger | Source | Path |
|---------|--------|------|
| `synchronize` | Processor | Full brood → eclosion |
| `navigate` | URL change | Full brood → eclosion |
| `tile:saved` | TileEditorDrone | Invalidates image cache → full cycle |
| `search:filter` | SearchDrone | Filters cells → full cycle |
| `move:preview` | MoveDrone | Fast-path eclosion (no I/O) |
| `render:set-orientation` | SettingsDrone | Invalidates images → full cycle |
| `render:set-pivot` | SettingsDrone | Invalidates images → full cycle |
| `render:set-gap` | SettingsDrone | Recomputes spacing → full cycle |
| `cell:place-at` | PlacementDrone | Persists order → full cycle |
| `cell:reorder` | ReorderDrone | Applies order → full cycle |
| `mesh:items-updated` | NostrMeshDrone | Mesh cells changed → full cycle |

---

## Source Files

| File | Role |
|------|------|
| `presentation/tiles/show-cell.drone.ts` | Orchestrates the full emergence |
| `presentation/tiles/pixi-host.worker.ts` | Creates and manages the Pixi Application |
| `presentation/grid/hex-geometry.ts` | Hex dimension constants (circumRadius, gap, padding) |
| `presentation/grid/hex-sdf.shader.ts` | SDF shader — hex clipping + atlas sampling |
| `presentation/grid/hex-label.atlas.ts` | Text-to-texture atlas for cell labels |
| `presentation/grid/hex-image.atlas.ts` | Image blob atlas for cell thumbnails |
| `presentation/tiles/tile-overlay.drone.ts` | Hover button overlays |
| `presentation/tiles/tile-selection.drone.ts` | Selection highlight rendering |
| `presentation/tiles/move-preview.drone.ts` | Move swap indicator overlays |
| `navigation/hex-detector.ts` | Pixel → axial coordinate hit detection |

All paths relative to `hypercomb-essentials/src/diamondcoreprocessor.com/`.
