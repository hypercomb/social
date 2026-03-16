# Hypercomb Ideas

Ideas for making the experience more incredible. Each iteration picks one. Architecture-first, minimalist, universally accessible.

---

## Chosen This Iteration

### Sediment Layers

**What**: Every edit to a cell deposits a thin ring of color at its hexagonal border — like tree rings, geological strata, or growth bands in a seashell. The color of each ring is derived from the content's signature at that edit (same `sigToHSL` as Chromatic Identity). A cell edited once has a clean, single-color border. A cell edited fifty times develops a rich, layered band of color — a geological record of its creative evolution, always visible, never hidden behind a menu. You glance at a cell and *read its age* in the complexity of its rim.

**Why this is universal**: Every culture on Earth understands growth rings. Cut a tree, read its life. Split a rock, read the ages. Break a shell, count the bands. Sediment layers require no labels, no numbers, no language — the visual complexity IS the information. A child sees it: thick, colorful borders mean rich history. Thin borders mean new. Ancient cells look *wise*. The metaphor crosses every human boundary because it's not a metaphor — it's the same physics of accumulation that shaped every natural structure.

**Architecture fit**:
- History entry count per cell: `Store.editCount(lineageSig)` or count entries in the history bag / OPFS folder. Even without LayerV2, OPFS file count per seed folder serves as a proxy.
- Ring colors: each historical edit's content signature → `sigToHSL()` (reuses Chromatic Identity's function). If full history sigs aren't available yet, degrade gracefully: use edit count to modulate ring thickness with the current sig's color.
- One vertex attribute: `vEditCount` — integer [0, N] per cell, clamped to a max ring count (~20) for visual clarity
- Shader: concentric hex SDFs at decreasing radii. Each ring is `borderWidth / maxRings` thick. Color per ring from a small uniform array or a 1D texture lookup.
- ShowHoneycombWorker computes edit count when building tile geometry — same pipeline as heat, tidal, identity values
- Composes with Chromatic Identity: identity = current color; sediment = historical colors. Together they show both *what a cell is* and *what it has been*.
- Composes with Tidal Memory: tidal = breathing rhythm of recent activity; sediment = permanent geological record. Time at two scales.
- Composes with editor snapshots: the thumbnail shows current content; the border rings show depth of iteration.

**Minimal surface area**: One count query, one shared color function, one vertex attribute, one shader loop. No new drones, no new events, no new services. The history was always accumulating — this makes accumulation visible as beauty.

---

## Previously Chosen

### Tidal Memory (Iteration 3)

**Status**: Not yet implemented.

**What**: The honeycomb breathes. Cells edited recently expand slightly and glow warm — high tide. Cells untouched for days contract and cool — low tide. The grid rises and falls with the rhythm of creation. One timestamp query per visible cell, one exponential decay function, one vertex attribute (`vTidal`), one shader blend. The rhythm was always encoded in the history — waiting to become visible.

### Chromatic Identity (Iteration 2)

**Status**: Not yet implemented.

**What**: Every cell derives its ambient color from its own signature. The first 6 hex chars of the SHA-256 hash become the hue. Cells without custom content glow with their mathematical identity. The honeycomb becomes a stained glass window of deterministic color. One pure function `sigToHSL(sig)`, one vertex attribute `vIdentityHue`, one shader blend. The color was always latent in the signature.

### Seed Portals (Iteration 1)

**Status**: UI prep work exists (`PortalOverlayComponent` in shared/ui). No essentials drone yet.

**What**: A seed whose content is another seed's 64-char signature becomes a portal — a wormhole in hex space. Navigating into a portal teleports you to the target seed anywhere in the honeycomb. The topology transforms from a flat hex plane into a connected graph with long-range links.

**Why this is universal**: Portals require no language, no labels, no taxonomy. Anyone on any device can create one by writing a signature as content. Communities self-organize link networks without coordination. The signature IS the address — no DNS, no URLs, no breakable links. Physical-world QR codes (backlog idea) become portal creation tools. Portals compose: chains of portals form paths across the mesh.

**Architecture fit**:
- Zero new protocols: a portal is just content that matches the 64-hex-char signature pattern
- Renderer detects signature-content seeds and applies a distinct visual (spiral/vortex hex shader variant)
- Navigation checks content on `encounter()` — if it's a valid signature, offer or auto-jump to target
- History already tracks every navigation, so portal jumps appear naturally in the history log
- ShowHoneycombWorker gets one new tile visual state (portal glow), similar to existing heat/selection states
- One small drone (`PortalDrone`) that intercepts navigation into portal seeds and redirects

**Minimal surface area**: One content pattern (64 hex chars), one visual state, one navigation intercept. No new storage, no new events, no new services. Everything reuses existing infrastructure.

---

## Backlog

### Stigmergic Trails

Extend ambient presence from point-in-time heat into directional flow. Mesh publishes lightweight `navigation-edge` events (two signatures + timestamp). Edges accumulate into visible trails — fading lines between cells showing where collective attention flows. Stigmergy: coordination without language, hierarchy, or profiles. One drone, one event kind, one vertex attribute, one effect. Builds on existing ambient presence + Nostr mesh.

### Seed Fossils

Content at a seed changes, but nothing truly disappears. Previous content leaves geological strata — visible layers beneath the current surface. Zoom in or toggle a mode to see time compressed into depth: newest on top, oldest at the bottom, like reading rock layers. The append-only history log already holds every version. No new storage. One visual mode, one history query, one layered render. Everyone understands geological time. Makes immutability tangible and beautiful — distinct from Temporal Replay (scrubbing a timeline) because fossils are always passively visible as depth.

### Temporal Replay

View the honeycomb at any point in its history. The append-only history log already captures every mutation. Add a time parameter to the render pipeline — filter history entries by timestamp, replay state up to that moment. A simple slider in the UI scrubs through time. Everyone can see how any location evolved. No new storage, no new protocols — just a lens on data that already exists.

### Murmuration

When multiple users are present in the same region simultaneously, their movements create a flocking visualization — like starlings in murmuration. Each presence becomes a particle that flows with the group. No identity, no chat, no interaction — just the beautiful emergent pattern of collective attention moving through space. Uses existing presence data + a particle system in the shader. One drone, one particle buffer, presence events as input. Deeply biophilic — the honeycomb becomes a living organism responding to collective behavior.

### Signature QR Bridges

Generate a QR code from any seed's signature. Scan it with a phone camera to navigate directly to that seed in the honeycomb. Bridges physical space and digital space — a sticker on a wall, a printout on a desk, a tattoo on an arm — all become entry points into the mesh. Content-addressed means the QR never expires, never breaks, never depends on DNS. Universal: anyone with a camera participates.

### Acoustic Presence

Map ambient presence heat to spatial audio instead of (or alongside) visual heat. More visitors at a seed = richer harmonic tone. Pan across the honeycomb and hear where activity clusters. Seeds nearby are louder, distant ones fade. The honeycomb becomes audible — useful for visually impaired users, useful as ambient awareness while multitasking. Uses Web Audio API with spatial panning. One drone, one audio context, presence heat as input.

### Resonance Links

Seeds that many people visit in sequence form implicit connections. If collective navigation patterns show A→B frequently, those seeds "resonate" — a subtle visual link appears between them. No explicit linking, no tagging, no categories. Connections emerge from behavior. The mesh already publishes navigation events (if stigmergic trails are implemented first). Resonance is just a threshold filter on trail edge frequency. Emergent taxonomy without any taxonomy.

### Gravity Wells

Seeds with high ambient presence exert gentle "gravitational pull" on viewport navigation. When panning near a hot area, the camera drifts slightly toward it — like orbital mechanics. Not forced, just a suggestion. Users can override by continuing their gesture. Makes high-activity areas naturally discoverable during exploration. Minimal: multiply pan delta by a weighted vector toward nearby heat sources. One modification to PanningDrone, presence heat as input.

### Content-Addressed Clipboard

Copy a seed's signature to clipboard. Paste it anywhere — another browser, a text file, a chat message. The recipient pastes it into any hypercomb instance and navigates directly there. The signature IS the link. No URLs, no servers, no link shorteners. Works offline (if the content is in local OPFS). Works across mesh instances. Works forever. Just a clipboard integration drone — read/write `navigator.clipboard`, resolve signatures via store.

### Pulse Resonance

Every navigation event triggers a subtle ripple animation outward from the visited cell. When multiple users are present, their pulses create wave interference patterns — constructive and destructive — visible as shimmer across the surface. Like stones dropped in a pond. Zero data model: local animation triggered by existing presence events. One shader uniform (`uPulseTime` per active source), one modification to ShowHoneycombWorker's fragment shader. Beautiful, biophilic, zero storage overhead.

### Ephemeral Ink

Long-press any seed to leave a mark. The mark is a single Nostr event: seed signature + timestamp. Nothing else — no text, no identity, no content. Marks accumulate as ink density (darker = more marks). Decays over time like presence heat. The simplest possible human gesture in spatial medium. Cave paintings before language. One event kind, one vertex attribute, one drone. Complementary to presence (presence = "someone is here now"; ink = "someone lingered here recently").

### Spore Propagation

A cell's snapshot would be a self-contained, signed description: lineage + bees + deps + resources + children — all as signature references. Publish any snapshot as a single Nostr event. Anyone receiving the spore can plant it in their own mesh. Missing referenced content is fetched from the mesh on demand. Cells spread organically between instances — not through "sharing" (a platform concept) but through biological propagation. Seeds on the wind. Each spore carries DNA (the snapshot) and grows in whatever soil it lands on. Requires a snapshot/history primitive (LayerV2 was explored and reverted). One event kind, one publish action, one plant action.

### Constellation View

At maximum zoom-out, the hex grid transforms into a star map. Each star represents a top-level lineage (root children). Size = descendant count. Brightness = recent activity. Color = signature-derived (Chromatic Identity). Click a star to zoom into the hexagonal grid beneath. Smooth transition — hexagons crystallize from starlight as you approach. Gives the mesh cosmic scale: zoom out for the universe, zoom in for the cell. One zoom threshold, one render mode, one aggregate query per root child. The seed folder hierarchy provides natural clustering.

### Depth Rings

As you navigate deeper (more path segments), each depth level adds a concentric ring inside the current cell's hex frame. Depth 0 = plain. Depth 3 = three nested hex rings getting smaller toward center. Instant depth perception — you FEEL how deep you are without breadcrumb UI. The depth is `lineage.segments.length`, computable from navigation state. One vertex attribute (`vDepth`), one shader modification (nested hex SDFs at decreasing radii). Zero new drones or storage.

### Living Thumbnails

Editor snapshots already render on grid cells. Extend this: when a cell's content changes anywhere on the mesh (via Nostr event), its thumbnail pulses once — a single heartbeat flash. You're looking at a region and you SEE edits happening in real time as thumbnail flickers across the grid. No notification badge, no inbox — the content itself shows it's alive. Architecture: one Nostr subscription filtered by visible-cell signatures, one animation trigger (`uPulseTime` uniform per cell) on ShowHoneycombWorker, zero new storage. Composes with Tidal Memory (breathing = recent activity rhythm) and Ambient Presence (heat = who's here). Living Thumbnails adds the missing real-time heartbeat — the moment of creation made visible.

### Negative Space Navigation

Instead of navigating INTO cells, navigate into the spaces BETWEEN them. The gaps between hexagons become pathways — click the negative space to slide along the interstice. At each junction, three cells meet — you see all three simultaneously from the crack between them. The honeycomb becomes navigable as both cells (content) and gaps (relationships). Universal: paths between things are as meaningful as things themselves — rivers between lands, streets between buildings, synapses between neurons. Architecture: the hex grid already computes gap geometry. One click-target layer for inter-cell regions, one camera transition mode, one viewport composition showing adjacent cell previews. Zero new storage, zero new events.

---

*Last updated: 2026-03-11*
