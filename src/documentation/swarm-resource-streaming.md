# Swarm Resource Streaming

> **status: design — not built (as of 2026-06-18).** The kind-30201
> relay streaming path described here is the live swarm-preview transport;
> the primary resource transport is HTTP-direct to operator domains, and
> several fixes/gaps below remain unimplemented.

## What "share" means in the swarm

A share is a **bundle**: the layer payload plus every resource the
layer references (and every resource those resources reference, all
the way down). The bundle is the unit of sharing — the receiver
either gets the whole thing or has missing references and renders
blank.

Sharing makes the bytes **available**. It does not make them **run**:
- Tiles become visible (image bytes are in OPFS, renderer reads them)
  but the user has to explicitly adopt a peer-only tile before it
  becomes part of their own local tree.
- Drones (bee modules) are not automatically installed even if a
  share references their signatures — drone install is a separate
  decision the host makes, not a side-effect of receiving a share.

## Constraint (live-preview path only)

This document describes the **live swarm-preview** transport, where the
owner exposes a Nostr relay URL + (room, secret) credentials and image
bytes ride the same WebSocket connection to the relay as Nostr events
(kind 30201, base64, ≤256 KB).

It is **not** the primary resource transport. The primary resource path
is **HTTP-direct to operator domains** at `GET /<sig>`
(`ContentBroker.#fetchOverHttp` + `Store` host fallback + `HostSync` PUT),
sha256-verified and write-through; Cloudflare edge caching of immutable
`/<sig>` is embraced as a scale primitive. The relay kind-30201 path
described here remains for live preview, but resources, dependencies, and
bees are **forbidden on the broker mesh path** — the broker mesh carries
layer **sigs** only. On render, `Store.getResource` self-heals resources
(memory → OPFS → host, sha256-verified, 60 s negative cache); layers,
dependencies, and bees are OPFS-only on the render path and heal only via
adopt / install / sync.

## Event kinds

| Kind  | d-tag           | Content                          | TTL (NIP-40) | Notes                                  |
|-------|-----------------|----------------------------------|--------------|----------------------------------------|
| 30200 | composed sig    | JSON `{ children: [{name, index?, propsSig?, imageSig?}] }` | 90 s | One per (pubkey, lineage); heartbeat republish every 30 s. |
| 30201 | resource sig    | base64(bytes)                    | 1 day        | One per (pubkey, kind, sig); content-addressed. Cap 256 KB. |
| 30202 | composed sig    | JSON `{ hidden: [name, ...] }`   | 90 s | One per (pubkey, lineage); heartbeat republish keeps the filter alive. Mesh-stored hide list — the session (room + secret) is the boundary. |

`composed sig = sha256(lineageKey + '\0' + room + '\0' + secret)`. Two
peers in the same zone reach the same composed sig and so address the
same relay slot.

`resource sig = sha256(bytes)`. The store independently re-hashes on
receive and discards bytes whose hash doesn't match the d-tag —
defence against malicious peers publishing mismatched bytes.

## How an image gets from the publisher to the receiver

A publisher's substrate-applied tile holds its image ref **canonically**
in the layer's `properties` (decoration) slot — `properties[0]` is the
propsSig. `localStorage['hc:tile-props-index'][<locationSig>] = propsSig`
is a **derived render-side index**, not the source of truth:
show-cell's render path and the substrate's blank-detection both read
only this index, so adopt/fold must seed it FROM the canonical
`properties` slot (see "Receiver side, on adopt" below).

The propsSig points to an OPFS resource at `<propsSig>` containing:

    { small: { image: <smallImgSig> },
      flat:  { small: { image: <flatImgSig> } },
      substrate: true }

…and `<smallImgSig>` / `<flatImgSig>` are themselves OPFS resources
holding the actual ~150 KB image bytes.

### Publisher side, on layer publish

1. Build the layer payload — each child carries `index`, `propsSig`
   (sha256 of the child's `0000` bytes), and `imageSig`. The
   imageSig has a three-tier source (canonical first, derived index
   as a fallback lookup):
   - the substrate-shaped propsBlob referenced by the child's
     canonical `properties` slot (mirrored at
     `localStorage['hc:tile-props-index'][<locationSig>]`), if it
     actually contains `small.image` / `flat.small.image` refs; OR
   - a freshly-synthesized `{small: {image: pickedSig}, substrate: true}`
     blob built from `substrate.pickImageForLabel(name)`, written
     to OPFS via `putResource`, sig forwarded. This catches the
     common case where the tile renders via the deterministic
     per-label picker at display time and has no persistent image
     ref anywhere; without synthesis those images would never cross
     the wire.
   - skip if neither yields anything.
2. **Publish resources first.** Walk every referenced sig
   (propsSig + imageSig per child). For each: fire kind 30201
   with `base64(bytes)`. Walk that blob's JSON for nested 64-hex
   strings and recurse — the small image bytes get streamed as
   their own kind 30201 event because they appear as nested refs
   inside the synthesized propsBlob.
3. **Then publish the layer event** (kind 30200) referencing those
   sigs. By the time a subscriber receives the layer and starts
   fetching the references, the relay already has them cached and
   serves them on the REQ.

Why resources first: the share is a bundle and the layer is its
manifest. Publishing the manifest before the contents creates a
window where a fast subscriber receives the manifest, fires fetches
for each sig, gets EOSE before the publisher's resource events have
arrived at the relay, and renders blank. Sequencing the writes
closes the window.

### Receiver side, on layer event

1. Walks `child.propsSig` and `child.imageSig` for every child.
2. For each sig not in local OPFS, opens `mesh.subscribe(sig, cb)` —
   a REQ on the relay with `#x: [sig]` filter.
3. Relay responds with the cached resource event for that sig
   (parameterized-replaceable means there's exactly one in cache per
   (pubkey, kind, sig)).
4. On resource event, decodes base64, writes to OPFS via
   `Store.putResource(blob)`, recurses into the JSON for nested sigs,
   closes the one-shot sub, emits `swarm:resource-arrived`.

### Receiver side, on adopt

Adopt does **not** snapshot the peer tile into a separate store. It folds
the peer's branch into the hive's own layer tree via the **same
`update({ children })` cascade** that create / paste / bulk-import use
(`swarm-adopt.drone.ts` → `committer.importTree` + parent
`update({ children })`), on explicit user click only.

1. Localize the peer's branch via `ContentBroker` (bytes already in OPFS
   from the streaming steps above, or pulled HTTP-direct), then re-home
   the subtree with `flattenLayerTree` so each adopted node carries the
   publisher's `properties` sig verbatim.
2. Seed the participant-local props index **FROM the canonical
   `properties` slot** of each folded node — the mirror of the
   substrate's `reconcileCanonicalImageStamps` (index → canonical), run
   here in the OTHER direction (canonical → index). Keyed by **location
   sig** (`cellLocationSig(parentSegs, name)`), the exact key show-cell +
   substrate resolve with. **Fill-if-empty** for fold; `sync` overwrites
   so the publisher's refreshed image wins. Without this seed the adopted
   tile looks blank to both render and blank-detection, and the substrate
   would clobber it with a random pool image.
3. Fold the name into the parent's `children[]` via
   `committer.update(at, { ...parent, children: [...existing, name] })` —
   the hive sigbag is the sole membership truth; no snapshot bridge.
4. Emits `substrate:applied` / `cell:added` → show-cell repaints.
5. Renderer reads index → substrate propsBlob → `small.image` →
   loads ~150 KB blob from OPFS → draws.

## Gaps (real reasons "still no images")

1. **Receiver-not-in-zone-when-published.** When mesh.subscribe sends
   a REQ to the relay, it filters `#x: [sig]` and the relay returns
   cached events. *This works for the layer (composed sig) because we
   ALWAYS subscribe on entering a lineage.* But for resource events
   (image bytes), we only subscribe AFTER receiving a layer event that
   references the sig. If the publisher's resource event was published
   and the receiver's subscribe arrives at the relay before the
   publisher's resource event does, the receiver gets `EOSE` with
   nothing.
2. **Resource events expire from the relay at 1 day, but the
   publisher's session-level `#publishedResources` Set blocks
   re-publish.** A long-running session will let its image events
   expire, and any new peer joining after that point sees the layer
   but can't fetch the image.
3. **Peer-only tiles render blank before adopt.** The image bytes are
   in OPFS the moment the layer event lands, but the renderer's
   peer-tile path doesn't read them. The user has to click adopt
   before they see the picture.

## Fixes

### Fix 1 — receiver pre-arms a resource subscription per layer event

Currently we wait for the layer event, then send a REQ for resources.
Two round trips. Worse: there's a tiny race window where the publisher
just sent the layer event but not the resource events yet, the
receiver fires REQ, the relay returns EOSE, the resource events arrive
moments later and never reach the receiver.

The fix: receiver's REQ asks for kind 30201 with `#x: [sig]` AND
includes `since` set to `0` so it picks up events at any point in the
relay's window. (Already true — kind 30201 is replaceable so there's
only the latest copy.) The real fix is to **leave the resource
subscription open** (not one-shot) so a delayed publish still reaches
the receiver. We re-arm subscribe on every layer event the receiver
processes, and only close when the bytes actually land.

### Fix 2 — resource heartbeat

Track per-resource publish time. When the next layer publish goes out
and any referenced resource's `lastPublishTime` is older than
`RESOURCE_TTL_SECS - RESOURCE_REPUBLISH_BUFFER`, republish it.
Mirrors the existing layer-event heartbeat exactly. Adds one Set →
Map change.

### Fix 3 — render peer-only tiles with the streamed image

In show-cell's peer-tile rendering path: when `entry.kind === 'peer'`
AND `entry.source.peerImageSig` is set AND `Store.getResource(sig)`
returns a blob, route the tile's image-load to that sig. The
receiver then sees the publisher's image on the preview tile, before
they decide to adopt. Adoption becomes "promote the preview to a
local copy," not "fetch the picture for the first time."

## Refreshing the mesh ("the canvas shows tiles I removed")

A peer's layer event sits in the relay's cache until either (a) NIP-40
expiration drops it (90 s after the publisher's last heartbeat), or
(b) the publisher re-publishes (replaceable slot evicts the prior
event). A peer who closes their tab disappears from active mesh
traffic but their last event lingers for ~90 s in the relay AND
forever in any receiver who already cached it — until something
flushes that receiver's in-memory bag.

Three flushes:

1. **Auto, time-based.** Every receiver runs a per-peer staleness
   sweep every 30 s. Any peer whose last layer event is older than
   `PEER_STALE_MS` (135 s, 1.5× the NIP-40 TTL to absorb jitter)
   gets evicted from `#peerLayersBySig`, and `swarm:peers-changed`
   fires so show-cell repaints without their tiles. So the worst-
   case lag between "publisher closed their tab" and "receivers stop
   showing their tiles" is `PEER_STALE_SWEEP_INTERVAL_MS + PEER_STALE_MS`
   = ~165 s.

2. **Auto, navigation-driven.** Navigating between lineages already
   flushes the previous lineage's subscription + cache (see
   `#syncForSig`). Going `/` → `/dolphin` clears `/`'s peer state.

3. **Manual.** `SwarmDrone.refresh()` (public method) tears down the
   current lineage's sub, drops every cached peer at the current
   sig, and re-runs `#syncForCurrentLineage` — receives fresh events
   from whoever is still publishing. Wire to a slash command or UI
   button for a "refresh swarm" user action. Bytes already in OPFS
   stay (they're content-addressed, immutable, safe to keep).

Additionally, **renderer-side filtering** in
`peerTilesAtCurrentSig()` walks peers freshest-first and skips any
peer whose last-seen is older than `PEER_STALE_MS`. So even between
sweep ticks, a stale peer can't leak through to the tile renderer —
they just get filtered at read time.

## Hide list lives on the mesh

The user's per-lineage hide filter (the names of tiles dimmed/dropped
by the hide action) is mesh-stored as kind 30202 events, not in
localStorage alone. Storage shape:

- d-tag = composed lineage sig (per-pubkey-per-lineage scope)
- content = JSON `{ hidden: ["name1", "name2", ...] }`
- NIP-40 expiration + heartbeat republish (same cadence as layer
  events) so the filter stays alive across the session

Why mesh-stored:

- **Permanence across refresh**: when the user reloads, their hide
  event echoes back from the relay on subscribe. The filter is
  rehydrated from the relay's cache without any client-side
  storage that has to be managed.
- **Zone-boundaried**: switching room or secret changes the composed
  sig. The new sig has no hide event from this pubkey, so the
  filter is fresh-empty. The old zone's hides aren't lost — they're
  still in the relay against the old sig — they just don't bleed
  through into the new zone.
- **Easily destroyable**: close the tab → heartbeat stops → event
  expires from the relay within `EVENT_TTL_SECS`. No leftover bytes
  to clean up. Toggle public off → swarm tears down → next public
  session has a fresh filter (or rehydrates from relay if cached).
- **Multi-device sync (bonus)**: same pubkey on another device in
  the same zone receives the hide event on subscribe and renders
  with the same filter.

The renderer merges:

1. Zone-scoped `localStorage[hideStorageKey(location)]` — key shape
   is `hc:hidden-tiles:<location>:z<zoneKey>` while in public mode,
   and `hc:hidden-tiles:<location>` while private. `zoneKey` is
   base64url of `room\0secret`, written to `localStorage['hc:current-zone']`
   by SwarmDrone on every room/secret change (cleared when going
   private). Different zones use different keys, so switching zone
   reads an empty hide list without bleeding stale data through.
2. `SwarmDrone.hiddenAtCurrentSig()` (the mesh-restored filter)

Either source hiding a name drops it from the render. Removing
publishes an updated `{ hidden: [...] }` without that name (the
parameterized-replaceable slot evicts the prior event).

When the user changes room or secret, `#teardownAndResync`:
- Closes layer subs and clears every per-sig in-memory map
- Closes resource subs and clears the published-resource memo
- Calls `#updateZoneKey()` to write the new zone key to localStorage
  (or remove it if credentials are empty)
- Emits `swarm:peers-changed` so show-cell repaints — the next read
  uses the new zone key and so reads an empty filter at the new
  zone (until echo-back populates it for already-hidden tiles).

## What stays out of scope

- Full-resolution images larger than 256 KB. Substrate's downsampled
  variants fit; an unprocessed multi-MB photo would need chunking
  across multiple events or a different transport entirely.
- Encryption beyond the room/secret gate. The mesh is currently
  **plaintext JSON** — the x-tag composed sig is visible on the wire and
  anyone in the zone sees every event. AEAD / per-recipient encryption
  (NIP-44) is future work that would fit on top of the same kind/d-tag
  scheme; until then the build offers no confidentiality beyond the
  room/secret gate.

## Related

The resources streamed here are **Distributed Network Artifacts** — the
content-addressed, merkle-versioned bytes (layers, dependencies, bees,
resources, content) the signature names. They are immutable and safe to
keep once verified; see [dna.md](./dna.md). The route/navigation stream
that was once also called "DNA" is now the
[trail capsule](./trail-capsule.md) (synonym: waggle capsule) — a
distinct primitive, not a resource.
