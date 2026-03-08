# Hypercomb Ideas

Ideas for making the experience more incredible. Each iteration picks one. Architecture-first, minimalist, universally accessible.

---

## Chosen This Iteration

### Stigmergic Trails

**What**: Extend ambient presence from point-in-time heat into directional flow. When users navigate from seed A to seed B, the mesh publishes a lightweight `navigation-edge` event (just two signatures + timestamp). Over time, these edges accumulate into visible trails on the honeycomb — fading lines between cells showing where collective attention flows.

**Why this is universal**: Stigmergy is how ants coordinate without language, hierarchy, or profiles. No recommendation algorithm, no curation, no user accounts needed. Every person on the planet navigating the honeycomb contributes to and benefits from the trails. Language-independent, culture-independent, zero onboarding.

**Architecture fit**:
- Builds directly on existing ambient presence + Nostr mesh infrastructure
- One new Nostr event kind (navigation edge: `{from: sig, to: sig}`)
- One new effect: `render:trail-edges` emitting edge list with decay weights
- ShowHoneycombWorker already has per-vertex attributes — add `aTrailIntensity` for edge glow between connected cells
- Trails decay via the same TTL mechanism presence uses — no timers, no cleanup
- A new `StigmergyDrone` subscribes to mesh navigation events, accumulates edges, emits the render effect

**Minimal surface area**: One drone, one event kind, one vertex attribute, one effect. Everything else reuses existing infrastructure.

---

## Backlog

### Temporal Replay

View the honeycomb at any point in its history. The append-only history log already captures every mutation. Add a time parameter to the render pipeline — filter history entries by timestamp, replay state up to that moment. A simple slider in the UI scrubs through time. Everyone can see how any location evolved. No new storage, no new protocols — just a lens on data that already exists.

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

---

*Last updated: 2026-03-07*
