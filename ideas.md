# Hypercomb Ideas

Ideas for making the experience more incredible. One is selected per iteration.

---

## Idea Pool

### 1. Silent Presence Gradient
Instead of binary "here / not here," represent presence as a thermal gradient on hex cells. A cell someone just left still glows warm, fading over seconds. No names, no avatars — just heat. You feel the hive without seeing individuals. Architecturally trivial: a single `lastPulse` timestamp per cell, rendered as an alpha ramp in the SDF shader. Universal because it works without language, accounts, or culture.

### 2. Acoustic Pheromones (Web Audio Effect Layer)
Map the effect bus to spatial audio. Each pheromone type gets a short, procedural tone — when a drone emits nearby, you hear it positioned in stereo relative to your viewport. No music, no voice — just tiny sonic cues that let you _hear_ the hive breathing. Uses Web Audio API (zero dependencies). Exposure: sound is the most universally understood human signal after light.

### 3. Ephemeral Ink (Time-Decaying Tile Content)
Tiles whose content fades over a configurable TTL — text becomes progressively transparent, then the cell empties. No delete button, no moderation. Content simply evaporates. Architecturally: a `born` timestamp on the tile + a shader uniform that drives opacity. Fits the live-only philosophy perfectly. Universal because impermanence needs no explanation.

### 4. Gravity Wells (Emergent Spatial Organization)
Let frequently-visited cells exert a subtle pull on neighboring tiles during layout. Over time, popular regions cluster organically — no folders, no tags, no curation by anyone. Implementation: a lightweight visit counter per cell that biases the hex offset during `LayoutService` placement. Resets on session end (live-only). Universal because it mirrors how physical spaces organize around foot traffic.

### 5. Scent Trails (Breadcrumb Pheromones)
As you navigate, leave invisible pheromone trails that _other_ present drones can faintly see — not your identity, just "someone passed through here recently." Renders as a faint directional arrow or flow line in the hex shader. Decays with time. Architecturally: a ring buffer of `(cell, timestamp, direction)` tuples broadcast via the effect bus. Universal because trails are the oldest wayfinding technology on earth.

### 6. Haptic Pulse (Vibration API for Mobile)
On mobile devices, map the processor's `synchronize` cycle to a subtle haptic tick via the Vibration API. When drones around you pulse, you feel it. No visual change needed — just a micro-vibration that makes the hive tangible. Zero dependencies, three lines of code. Universal because touch is pre-linguistic.

### 7. Content-Addressed QR Portal
Generate a QR code from any cell's content signature. Scanning it on another device navigates directly to that cell's lineage in the mesh. No URLs, no servers, no link shorteners — the signature _is_ the address. Uses the existing SHA-256 content addressing. Universal because QR readers are built into every phone camera on the planet.

---

## Selected This Iteration

### 7. Content-Addressed QR Portal

**Why now:** The 3-state shield button just landed, meaning the mesh modes (solo/public/secret) are in place. QR portals are the natural next step — they give people a way to _invite_ others into a shared space without exchanging URLs, accounts, or app store links. A hex cell's SHA-256 signature already uniquely identifies it. Encoding that into a QR code turns any phone camera into a portal. This has maximum planetary exposure: QR scanning works on every smartphone, requires no app install, and crosses every language barrier. Architecturally, it's a queen bee (`/qr` command) that reads the current selection's signature, generates a QR via a tiny canvas-based encoder (no library needed — QR spec is public domain), and overlays it on the hex grid as an ephemeral tile. Scanning navigates to `https://{domain}/#/{signature}` which the existing router resolves.

**Scope:** One queen bee, one canvas utility function, one route guard update. Minimal.
