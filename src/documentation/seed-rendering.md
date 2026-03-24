# Seed Rendering & Tile Materialization

How seeds become tiles on the honeycomb grid — from OPFS folders to hexagonal cells rendered via Pixi.js.

---

## Seeds

A **seed** is a folder in the OPFS content tree under `hypercomb.io/`. Its name is its label. Seeds are discovered by iterating the entries of the current explorer directory and collecting all subdirectories that are not reserved (`__*__` folders).

```
opfs://hypercomb.io/
  ├── Alice/            ← seed
  ├── Bob/              ← seed
  ├── Photos/           ← seed
  ├── __bees__/         ← reserved (not a seed)
  ├── __dependencies__/ ← reserved (not a seed)
  ├── __history__/      ← reserved (not a seed)
  ├── __layers__/       ← reserved (not a seed)
  └── __resources__/    ← reserved (not a seed)
```

Each discovered seed folder name becomes one hexagonal tile on the honeycomb grid.

---

## Bee Discovery

Bees are discovered through the **install manifest**, not by scanning seed folders. The manifest (`install.manifest.json`) is cached in `localStorage` after installation and lists every bee signature in the release.

`ScriptPreloader.find()` reads the manifest to build the bee list. Each bee is loaded from `__bees__/{sig}.js`, verified against its signature, and self-registers in IoC. There is no per-seed marker placement — all installed bees are available globally.

A fallback path exists for development environments without a cached manifest: `ScriptPreloader` scans directories for files matching the 64-char hex signature pattern and loads them as bees. This is a safety net, not the primary architecture.

---

## The Zero-Signature Properties File

Every seed folder should contain a special file named with 64 zeros:

```
0000000000000000000000000000000000000000000000000000000000000000
```

This is the **properties file** — always the first file created when a seed is initialized.

### Why 64 zeros?

All signatures in hypercomb are SHA-256 hashes (64 hex characters). An all-zeros hash is cryptographically impossible to produce from real content, making it a safe reserved name that can never collide with a legitimate signature.

### What it contains

The zero-signature file is a JSON document holding all properties that can be applied to a seed at runtime:

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

A single place to **collapse many properties** that would otherwise be scattered or computed during creation. When the seed is encountered at runtime (heartbeat), the zero-signature file is read and its properties are materialized into a runtime object.

### Seed folder structure

```
opfs://hypercomb.io/Alice/
  └── 0000000000000000000000000000000000000000000000000000000000000000   ← properties (JSON)
```

---

## Resource Resolution (Signature Dereferencing)

When the zero-signature properties file is **materialized**, any value that is itself a 64-character hex string triggers a lookup into `__resources__/`.

1. The runtime reads the zero-signature JSON from the seed folder
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

This enables deduplication (multiple seeds reference the same resource by signature), integrity (SHA-256 verification), and composability (flat references in storage, rich objects in memory).

---

## Tile Rendering Pipeline

### 1. Discovery

`ShowCellDrone` listens for `synchronize` events and runs the render pipeline:

1. Get the current explorer directory from `Lineage`
2. List all seed folders (non-reserved subdirectories)
3. Union with mesh seeds (shared seeds from nostr relays)
4. Replay history operations — remove seeds whose last operation was `remove`

### 2. Coordinate mapping

Each surviving seed name is mapped to an axial hex coordinate via `AxialService`:

- Seed names are sorted alphabetically
- Seed at index 0 maps to center hex (q=0, r=0)
- Subsequent indices spiral outward in rings

### 3. Rendering

Each seed becomes a quad tile rendered with Pixi.js:

- `HexLabelAtlas` renders seed labels into a texture atlas
- `HexImageAtlas` renders seed images into a separate texture atlas — when a seed's properties file contains an image resource signature, the image blob is loaded from `__resources__/{sig}` and composited into an atlas slot
- `HexSdfTextureShader` draws hexagonal shapes with SDF (signed distance field) rendering, sampling from both atlases — the shader clips images to the hex boundary
- Local seeds and external (mesh) seeds get different textures
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
| **Seed** | A folder = one tile on the grid | `opfs://hypercomb.io/path/` |
| **Zero-sig file** | JSON properties, name is 64 zeros | Inside seed folder |
| **Resource** | Data (JSON or binary) addressed by signature | `__resources__/{sig}` |
| **Bee module** | Compiled JS addressed by signature | `__bees__/{sig}.js` |
| **Install manifest** | Lists all bee/dep/resource signatures | `localStorage` (cached from `install.manifest.json`) |

The zero-signature properties file is the seed's identity card. Resource resolution composes referenced signatures into a rich runtime object. Bees are discovered globally via the install manifest, not per-seed markers. Together these enable a fully modular, signature-verified, content-addressed system where every piece can be independently shared, verified, and composed.
