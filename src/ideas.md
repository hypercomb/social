# Hypercomb Ideas

Ideas for making the experience more incredible. Each iteration picks one. Architecture-first, minimalist, universally accessible.

---

## Chosen This Iteration

### Seed Portals

**What**: A seed whose content is another seed's 64-char signature becomes a portal — a wormhole in hex space. Navigating into a portal teleports you to the target seed anywhere in the honeycomb. The topology transforms from a flat hex plane into a connected graph with long-range links.

**Why this is universal**: Portals require no language, no labels, no taxonomy. Anyone on any device can create one by writing a signature as content. Communities self-organize link networks without coordination. The signature IS the address — no DNS, no URLs, no breakable links. Physical-world QR codes (backlog idea) become portal creation tools. Portals compose: chains of portals form paths across the mesh.

**Architecture fit**:
- Zero new protocols: a portal is just content that matches the 64-hex-char signature pattern
- Renderer detects signature-content seeds and applies a distinct visual (spiral/vortex hex shader variant)
- Navigation checks content on `encounter()` — if it's a valid signature, offer or auto-jump to target
- History already tracks every navigation, so portal jumps appear naturally in the history log
- ShowHoneycombDrone gets one new tile visual state (portal glow), similar to existing heat/selection states
- One small drone (`PortalDrone`) that intercepts navigation into portal seeds and redirects

**Minimal surface area**: One content pattern (64 hex chars), one visual state, one navigation intercept. No new storage, no new events, no new services. Everything reuses existing infrastructure.

---

## Backlog

### Stigmergic Trails

Extend ambient presence from point-in-time heat into directional flow. Mesh publishes lightweight `navigation-edge` events (two signatures + timestamp). Edges accumulate into visible trails — fading lines between cells showing where collective attention flows. Stigmergy: coordination without language, hierarchy, or profiles. One drone, one event kind, one vertex attribute, one effect. Builds on existing ambient presence + Nostr mesh.

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

### Pulse Resonance

Every navigation event triggers a subtle ripple animation outward from the visited cell. When multiple users are present, their pulses create wave interference patterns — constructive and destructive — visible as shimmer across the surface. Like stones dropped in a pond. Zero data model: local animation triggered by existing presence events. One shader uniform (`uPulseTime` per active source), one modification to ShowHoneycombDrone's fragment shader. Beautiful, biophilic, zero storage overhead.

### Ephemeral Ink

Long-press any seed to leave a mark. The mark is a single Nostr event: seed signature + timestamp. Nothing else — no text, no identity, no content. Marks accumulate as ink density (darker = more marks). Decays over time like presence heat. The simplest possible human gesture in spatial medium. Cave paintings before language. One event kind, one vertex attribute, one drone. Complementary to presence (presence = "someone is here now"; ink = "someone lingered here recently").

---

*Last updated: 2026-03-08*
