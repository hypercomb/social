# Seed Rendering & Tile Materialization

How seeds become tiles on the honeycomb grid, and how marker files, the zero-signature properties file, and resource resolution compose a seed's runtime identity.

---

## Seeds

A **seed** is a folder in the OPFS content tree. Its name is its label. Seeds are discovered by iterating the entries of the current explorer directory and collecting all subdirectories that are not reserved (any `__*__` folder: `__bees__`, `__dependencies__`, `__layers__`, `__resources__`, `__location__`, etc.).

```
opfs://hypercomb.io/
  ├── Alice/            ← seed
  ├── Bob/              ← seed
  ├── Photos/           ← seed
  ├── __bees__/         ← reserved (not a seed)
  ├── __dependencies__/ ← reserved (not a seed)
  ├── __layers__/       ← reserved (not a seed)
  └── __resources__/    ← reserved (not a seed)
```

Each discovered seed folder name becomes one hexagonal tile on the honeycomb grid.

---

## Marker Files

Inside a seed folder, **marker files** are empty files whose filename is a 64-character hex signature (a SHA-256 hash). They act as pointers to executable drone modules stored elsewhere.

```
opfs://hypercomb.io/Alice/
  ├── a3f8...c9d1     ← marker file (64 hex chars, no extension)
  └── 7b02...e4f6     ← another marker file
```

### How markers are created

Markers are placed in two ways:

**At install time** — `ensureInstall()` calls `applyBeeMarkers()`, which writes an empty marker file in the hypercomb root (`hypercomb.io/`) for every bee signature in the install manifest. These root-level markers ensure that `ScriptPreloader.find()` discovers all installed bees globally — the same behavior as hypercomb-dev where bees are instantiated directly at startup.

**At layer application** — `LayerFilesystemApplier` creates a marker file for each drone signature declared in a layer, placing them inside the target seed folder:

```typescript
for (const droneSig of layer.drones) {
  await targetDir.getFileHandle(droneSig, { create: true })   // empty file, name IS the signature
}
```

### What markers reference

The filename is the SHA-256 hash of the compiled drone module's bytes. The actual executable code lives at:

```
opfs://__bees__/{same-signature}.js
```

When the system encounters a seed, it can scan for marker files and resolve them to runnable drone scripts. The marker file itself is empty — its entire purpose is the name.

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

This provides a single place to **collapse many properties** that would otherwise be scattered or computed during creation. Any file or process within the seed can look up properties here. When the seed is encountered at runtime (heartbeat), the zero-signature file is read and its properties are materialized into a runtime object.

### Seed folder with all pieces

```
opfs://hypercomb.io/Alice/
  ├── 0000000000000000000000000000000000000000000000000000000000000000   ← properties (JSON)
  ├── a3f8...c9d1     ← marker file → __bees__/a3f8...c9d1.js
  └── 7b02...e4f6     ← marker file → __bees__/7b02...e4f6.js
```

---

## Resource Resolution (Signature Dereferencing)

When the zero-signature properties file is **materialized** (parsed and loaded into memory), any value that is itself a signature triggers a lookup into the `__resources__` folder.

### How it works

1. The runtime reads the zero-signature JSON from the seed folder
2. For each value in the JSON, it checks whether the value is a 64-character hex string (a signature)
3. If it is, the runtime looks up `__resources__/{signature}` and reads the data stored there
4. JSON resources replace the signature value in the materialized object; binary resources (images) are handed to the rendering pipeline directly (e.g. `HexImageAtlas` for tile textures)

### Example

Given this zero-signature file:

```json
{
  "name": "Alice",
  "theme": "c4a1...8f02"
}
```

And this resource file at `__resources__/c4a1...8f02`:

```json
{
  "background": "#1a1a2e",
  "accent": "#e94560",
  "font": "monospace"
}
```

The materialized runtime object becomes:

```json
{
  "name": "Alice",
  "theme": {
    "background": "#1a1a2e",
    "accent": "#e94560",
    "font": "monospace"
  }
}
```

### Why this matters

This pattern enables **extreme modularization with signature verification**:

- **Deduplication**: Multiple seeds can reference the same theme/config resource by signature. The bytes are stored once.
- **Integrity**: The signature is the SHA-256 hash of the resource content. If the content is tampered with, the hash won't match.
- **Composability**: A seed's properties are a composed object at runtime — flat references in storage, rich objects in memory.
- **Shareability**: Resources are content-addressed. The community can share resources via the merkle tree pattern, and signatures ensure integrity across the network.
- **Binary resources**: Resources are not limited to JSON. Image blobs stored at `__resources__/{sig}` are loaded by `HexImageAtlas` and rendered as tile textures inside the hex grid.

---

## Tile Rendering Pipeline

### 1. Discovery

`ShowHoneycombWorker` listens for `synchronize` events and runs the render pipeline:

1. Get the current explorer directory from `Lineage`
2. List all seed folders (non-reserved subdirectories)
3. Union with mesh seeds (shared seeds from nostr relays)
4. Replay history operations — remove seeds whose last operation was `remove`

### 2. Coordinate mapping

Each surviving seed name is mapped to an axial hex coordinate via `AxialService`:

- Seed names are sorted alphabetically
- Seed at index 0 → center hex (q=0, r=0)
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

- Hover detection via `HexDetector` (pixel → axial coordinate)
- Right-click navigates into a child layer (`tile:navigate-in`)
- Left-click navigates back to the parent layer (`tile:navigate-back`)
- Action buttons on tiles (edit, remove)
- `TileSelectionDrone` subscribes to `tile:click` for drag-select over multiple tiles

---

## Heartbeat → Script Execution

When a bee's `pulse()` is called:

1. **Sense check** — `sense(grammar)` returns whether this drone should activate
2. **Heartbeat** — `heartbeat(grammar)` runs the drone's main logic
3. **State transition** — bee moves from Created/Registered → Active

For `ShowHoneycombWorker`, heartbeat:

1. Subscribes to `render:host-ready` (Pixi resources)
2. Refreshes mesh seeds from nostr relays
3. Queues a render pass

Marker files in seed folders reference bee scripts that can be loaded and pulsed in the same lifecycle. The marker's signature resolves to `__bees__/{sig}.js`, which self-registers in IoC and responds to future pulses.

---

## Summary

| Concept | What it is | Where it lives |
|---------|-----------|---------------|
| **Seed** | A folder = one tile on the grid | `opfs://domain/path/` |
| **Marker file** | Empty file, name is a drone signature | Inside seed folder |
| **Zero-sig file** | JSON properties, name is 64 zeros | Inside seed folder (first file created) |
| **Resource** | Data (JSON or binary) addressed by signature | `__resources__/{sig}` |
| **Drone module** | Compiled JS addressed by signature | `__bees__/{sig}.js` |

The zero-signature properties file is the seed's identity card. Marker files point to its behaviors. Resource resolution composes referenced signatures into a rich runtime object. Together they enable a fully modular, signature-verified, content-addressed system where every piece can be independently shared, verified, and composed.
