# Cell Rendering & Tile Materialization

How cells become tiles on the honeycomb grid — from signature-addressed layers to hexagonal cells rendered via Pixi.js.

---

## Cells

A **cell** is content inside a signature-addressed *layer* (`__layers__/<sig>`), **not a folder**. The current navigation location (lineage, §4 of protocol-spec) computes a signature that resolves to the layer for that location; that layer's **child-layer signatures** are the cells rendered as tiles. Each child sig resolves to a child layer holding the cell's name and content.

```
location /cigars  →  sig = SHA-256("hypercomb.io/cigars/cell")  →  __layers__/<sig>
   layer {
     name:     "cigars",
     children: ["<sig-brands>", "<sig-reviews>", ...]    ← each child sig = one hex tile
   }
```

Child layers resolve by signature from the flat `__layers__/<sig>` pool (or the derived `__manifests__/<parent-sig>` inline cache, which pre-resolves them so cold load skips per-child lookups). There is **no folder iteration** — the hierarchy lives in the layer's child-sig references, not in OPFS directories.

---

## Bee Discovery

Bees are discovered through the **install manifest**, not by scanning cell folders. The manifest (`install.manifest.json`) is cached in `localStorage` after installation and lists every bee signature in the release.

`ScriptPreloader.find()` reads the manifest to build the bee list. Each bee is loaded from `__bees__/{sig}.js`, verified against its signature, and self-registers in IoC. There is no per-cell marker placement — all installed bees are available globally.

A fallback path exists for development environments without a cached manifest: `ScriptPreloader` scans directories for files matching the 64-char hex signature pattern and loads them as bees. This is a safety net, not the primary architecture.

---

## The Zero-Signature Properties File

Each cell's properties are held in a record named with 64 zeros (the zero-signature), referenced from the cell's layer:

```
0000000000000000000000000000000000000000000000000000000000000000
```

This is the **properties file** — always the first file created when a cell is initialized.

### Why 64 zeros?

All signatures in hypercomb are SHA-256 hashes (64 hex characters). An all-zeros hash is cryptographically impossible to produce from real content, making it a safe reserved name that can never collide with a legitimate signature.

### What it contains

The zero-signature file is a JSON document holding all properties that can be applied to a cell at runtime:

```json
{
  "name": "Alice",
  "color": "#ff6b35",
  "icon": "bee",
  "drone": "a3f8...c9d1",
  "avatar": "9e1a...b7c3"
}
```

### Purpose

A single place to **collapse many properties** that would otherwise be scattered or computed during creation. When the cell is encountered at runtime (heartbeat), the zero-signature file is read and its properties are materialized into a runtime object.

### Where it lives

The cell's layer (`__layers__/<sig>`) references the zero-signature properties record; the runtime resolves it like any signature reference. There is no per-cell folder — the layer is the container.

---

## Resource Resolution (Signature Dereferencing)

When the zero-signature properties file is **materialized**, any value that is itself a 64-character hex string triggers a lookup into `__resources__/`.

1. The runtime reads the zero-signature properties (resolved from the cell's layer)
2. For each value, it checks whether the value is a signature
3. If so, the runtime reads `__resources__/{signature}` — JSON resources replace the signature value in the materialized object; binary resources (images) are handed to the rendering pipeline (e.g., `HexImageAtlas` for tile textures)

### Example

Given properties `{ "name": "Alice", "theme": "c4a1...8f02" }` and a resource at `__resources__/c4a1...8f02` containing `{ "background": "#1a1a2e", "accent": "#e94560" }`, the materialized object becomes:

```json
{
  "name": "Alice",
  "theme": { "background": "#1a1a2e", "accent": "#e94560" }
}
```

This enables deduplication (multiple cells reference the same resource by signature), integrity (SHA-256 verification), and composability (flat references in storage, rich objects in memory).

---

## Tile Rendering Pipeline

### 1. Discovery

`ShowCellDrone` listens for `synchronize` events and runs the render pipeline:

1. Compute the current location's layer signature from `Lineage` (§4)
2. Read that layer's child-layer signatures — each child is one cell
3. Union with mesh cells (shared cells from nostr relays)
4. Replay history operations — remove cells whose last operation was `remove`

### 2. Coordinate mapping

Each surviving cell name is mapped to an axial hex coordinate via `AxialService`:

- Cell names are sorted alphabetically
- Cell at index 0 maps to center hex (q=0, r=0)
- Subsequent indices spiral outward in rings

### 3. Rendering

Each cell becomes a quad tile rendered with Pixi.js:

- `HexLabelAtlas` renders cell labels into a texture atlas
- `HexImageAtlas` renders cell images into a separate texture atlas — when a cell's properties file contains an image resource signature, the image blob is loaded from `__resources__/{sig}` and composited into an atlas slot
- `HexSdfTextureShader` draws hexagonal shapes with SDF (signed distance field) rendering, sampling from both atlases — the shader clips images to the hex boundary
- Local cells and external (mesh) cells get different textures
- The mesh is centered in the viewport

### 4. Interaction

`TileOverlayDrone` adds interactive overlays:

- Hover detection via `HexDetector` (pixel to axial coordinate)
- Right-click navigates into a child layer (`tile:navigate-in`)
- Left-click navigates back to the parent layer (`tile:navigate-back`)
- Action buttons on tiles (edit, remove)
- `TileSelectionDrone` subscribes to `tile:click` for drag-select over multiple tiles

---

## Summary

| Concept | What it is | Where it lives |
|---------|-----------|---------------|
| **Cell** | Layer content = one tile on the grid | `__layers__/<sig>` |
| **Zero-sig file** | JSON properties, name is 64 zeros | Referenced from the layer |
| **Resource** | Data (JSON or binary) addressed by signature | `__resources__/{sig}` |
| **Bee module** | Compiled JS addressed by signature | `__bees__/{sig}.js` |
| **Install manifest** | Lists all bee/dep/resource signatures | `localStorage` (cached from `install.manifest.json`) |

The zero-signature properties file is the cell's identity card. Resource resolution composes referenced signatures into a rich runtime object. Bees are discovered globally via the install manifest, not per-cell markers. Together these enable a fully modular, signature-verified, content-addressed system where every piece can be independently shared, verified, and composed.
