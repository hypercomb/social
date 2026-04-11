# Meetings and Quorum

How a group of participants gathers on a honeycomb, reaches quorum, and transitions from "a few people standing around a tile" into a live WebRTC video meeting.

This document covers the **why** (the 1+6 Cascade and why it's the default), the **how** (tagging, quorum gathering, state machine, signaling), and the **where** (which drones and files implement each part).

---

## The 1+6 Cascade — the default standard

A Hypercomb meeting defaults to a **one-plus-six** shape: one tile at the centre and six tiles forming the ring around it. Seven participants total.

```
     ·  ·
    ·  L  ·     L = leader (centre tile, slot -1)
     ·  ·       · = ring-1 participant (slots 0–5)
```

**Why this number, and why it's the default**

- **One leader.** A meeting needs a host — the person whose tile is at the centre. They set the topic, hold the floor, and own the room's signature.
- **Six voices around them.** Six is small enough that everyone gets their points in edgewise. There is real airtime for each participant — nobody has to fight through a crowd of fifteen faces to be heard. It mirrors how a small working circle actually behaves: short turn-taking, visible body language, no back-channel rooms-within-rooms.
- **The hex grid already agrees.** A honeycomb cell has exactly six neighbours in ring-1. The topology is the convening circle. The default meeting template is not a UI decision layered on top — it's what the grid naturally gives you.

This template is called **`cascade`**. Larger variants exist (`cascade:19` is a two-ring 1+6+12 = 19-person room), but `cascade` is the canonical default because of the airtime principle: past ~7 people, turn-taking breaks down and the quietest voices drop out.

---

## The two halves of a meeting

There are two distinct things happening when a meeting runs, and they live in two different drones:

| Concern | What it does | Drone |
|---|---|---|
| **Room identity + signaling** | Derives a room signature from the cell, subscribes to the Nostr mesh for that sig, manages WebRTC offer/answer/ICE, assigns slots, handles spatial audio per-slot | [`HypercombMeetingDrone`](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/meeting.drone.ts) |
| **Quorum gathering** | Publishes "I'm available" heartbeats, tracks peer availability with TTL expiry, runs the state machine, decides *when* the meeting actually starts | [`HiveMeetingDrone`](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/hive-meeting.drone.ts) |

The user-facing entry point is the `/meeting` slash behaviour, handled by [`MeetingQueenBee`](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/meeting.queen.ts).

---

## Starting a meeting — the step-by-step

### 1. Tag the tile

Select a tile and type `/meeting`. The slash behaviour:

1. Resolves the current selection via `@diamondcoreprocessor.com/SelectionService`.
2. Writes the tag `cascade` into the tile's `0000` props file under OPFS.
3. Emits `tags:changed` on the effect bus so listeners react immediately.
4. Emits a `tile:action` of action `meeting` to toggle the join.
5. Pulses the processor (`new hypercomb().act()`) to coalesce visual updates.

The tag is the ground truth. Anyone with a tile tagged `cascade` is hosting a meeting room that can be joined.

Aliases:

- `/meeting` — toggle (tag + join if absent, join if already tagged)
- `/meeting join` — explicit join
- `/meeting leave` — leave the active room
- `/meeting cascade:19` — use a 2-ring template for a larger room (1+6+12)

### 2. Derive the room signature

The room has a deterministic, content-addressed identity:

```ts
roomSig = sha256(cell + '/meeting')
```

See `deriveRoomSig()` in [meeting.drone.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/meeting.drone.ts).

Because the signature is derived from the cell name, **every participant who opens the same tile computes the same room signature independently**. No server, no registration, no invite link — the cell name is the invite. Two people landing on tile `agenda` both compute the same sig and start listening on the same Nostr mesh topic.

### 3. Subscribe to the mesh

`HypercombMeetingDrone.#ensureRoomSubscription()` opens a subscription on the Nostr mesh for that `roomSig`. This happens *passively* as soon as the tag is seen — before the user clicks join — so the participant can hear joins announced by others even while still deciding whether to participate.

### 4. Gather quorum

This is where [`HiveMeetingDrone`](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/hive-meeting.drone.ts) takes over.

When a participant toggles availability (camera permission + "I'm in"), their drone starts publishing a `meeting-availability` heartbeat on the room signature every **5 seconds**:

```ts
AVAILABILITY_PUBLISH_MS = 5_000
AVAILABILITY_TTL_MS     = 30_000
DEFAULT_THRESHOLD       = 7   // leader + 6 ring-1 = the Cascade
```

Peers listening on the same signature collect these heartbeats into a `Map<publisherId, lastSeenMs>`. Entries older than 30 seconds are pruned — if you close your laptop, you fall out of the count.

**Quorum is met when:**

```ts
availability.size + (localAvailable ? 1 : 0) >= threshold
```

That is: the number of remote peers who've recently announced availability, plus yourself if you're available, meets or exceeds the threshold. The default threshold is 7 — matching the 1+6 Cascade exactly.

Threshold is tunable via `localStorage.setItem('hc:meeting:threshold', '3')` for smaller meetings during testing, but the production default stays at 7.

### 5. State machine

```
 idle  ─────────►  gathering  ─────────►  active  ─────────►  ended  ─────► idle
   │                   │                     │                    │
   │ (you toggle       │ (quorum reached     │ (you leave,         │ (reset)
   │  available +      │  while everyone     │  state drops        │
   │  cellCount ≥      │  is still           │  to ended,          │
   │  threshold)       │  available)         │  then idle)         │
```

See `#evaluateState()` in [hive-meeting.drone.ts:230](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/hive-meeting.drone.ts#L230).

Transitions emit `meeting:state` on the effect bus and a matching `window` CustomEvent so the Angular controls bar can update its UI.

### 6. Establish peer connections

Once state flips to `active`, `#startMeeting()` walks the availability map and calls `#createPeerConnection()` for each known peer. Offers are sent only by the peer with the **lower publisher id** (deterministic tie-breaking — `this.#publisherId < remoteId`), so both sides don't simultaneously offer and collide.

WebRTC signaling (offer / answer / ICE candidate) is transported over the **same Nostr mesh signature** as the availability heartbeats. Messages are addressed with a `from` / `to` publisher id pair, and the drone ignores anything not addressed to it.

ICE servers default to Google's public STUN:

```ts
{ urls: 'stun:stun.l.google.com:19302' }
{ urls: 'stun:stun1.l.google.com:19302' }
```

No TURN relay — pure peer-to-peer. If NAT traversal fails, the connection simply doesn't form. This is intentional: meetings are ephemeral presence, not a hosted service.

### 7. Slot assignment

`HypercombMeetingDrone` assigns each remote peer an incrementing slot index (0, 1, 2, …). Slot `-1` is reserved for the local participant — the centre hex. Slots 0–5 are the six ring-1 positions around the leader in a `cascade` room; slots 0–17 in a `cascade:19`.

The slot drives two things:

- **Video placement** — the overlay renderer uses the slot to position the remote video on the correct neighbour hex.
- **Spatial audio** — [`MeetingSpatialAudio`](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/meeting-audio.ts) uses the slot to pan and position each participant's audio in 3D space, so voices come from the direction their face is on the grid.

Slot assignment emits `meeting:slot-assigned` on the effect bus so overlays and audio can react independently.

### 8. Capacity enforcement

Both join and offer handlers enforce the maximum:

```ts
if (room.peers.size >= room.maxSlots) return
```

For `cascade`, `maxSlots = 6` (six remote peers plus yourself = seven participants). The 7th person to try to join a full cascade room is silently refused — their offer is dropped. This is the hard ceiling that preserves the airtime property: no matter how many people discover the room, only the Cascade's worth of people can actually speak in it.

If a meeting needs to grow, the host (or anyone) can re-tag the tile `cascade:19` and the drone will reload with `maxSlots = 18`.

---

## Leaving a meeting

`/meeting leave`, or toggling availability off, does three things:

1. **Announces leave** — publishes a `leave` signal on the room sig so peers can tear down their side of the connection immediately instead of waiting for ICE failure.
2. **Closes all peer connections** — calls `pc.close()` on every `RTCPeerConnection` and clears the slot map.
3. **Stops local media** — stops every track on the local `MediaStream`, which releases the camera and microphone. The browser's hardware indicator turns off.

Meetings leave no trace. There is no persisted participant list, no room history, no recording. When the last person leaves, the room signature falls silent on the mesh and the room effectively stops existing. Re-tagging the cell later creates a new, empty room with the same signature — peers who happen to be listening will just hear silence until someone new joins.

This is consistent with the Hypercomb [security model](security.md): presence-first, data expires when participants leave.

---

## Why quorum at all?

A simpler design would let any two people with cameras on start talking the moment they connect. Hypercomb instead gathers availability first and only flips to `active` when the threshold is met. This is deliberate:

1. **Protects the airtime property.** A meeting should feel like a meeting from the moment it starts — seven people, seven voices, everyone ready. Dribbling in one-by-one over five minutes burns the first speaker's energy on small-talk-with-latecomers.
2. **Removes the "first to join" penalty.** If the first person's camera goes live the instant they click, they're sitting on camera alone waiting for others. With quorum gathering, nobody is on camera until the room is ready. The transition from "waiting" to "meeting" is a single crisp moment for everyone at once.
3. **Uses the heartbeat itself as the readiness signal.** You don't need a separate "I'm ready" button. Publishing availability *is* the ready signal. Stop publishing (leave the tab, close the laptop, lose network) and you fall out of the count within 30 seconds. The system is self-healing.
4. **The mesh already knows the population.** Since every availability heartbeat carries a `publisherId` and lands on the same room signature, every participant independently arrives at the same count at roughly the same time. Quorum is reached simultaneously for all honest participants — no coordinator, no leader election.

---

## File map

| File | Role |
|---|---|
| [meeting.queen.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/meeting.queen.ts) | `/meeting` slash behaviour — tags tile, triggers join |
| [meeting.drone.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/meeting.drone.ts) | Per-cell room management, slot assignment, room sig derivation |
| [hive-meeting.drone.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/hive-meeting.drone.ts) | Availability heartbeats, quorum state machine, WebRTC orchestration |
| [meeting-signaling.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/meeting-signaling.ts) | Signal parsing, Nostr tag helpers, peer id generation |
| [meeting-peer.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/meeting-peer.ts) | `RTCPeerConnection` wrapper — offer, answer, ICE |
| [meeting-audio.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/meeting-audio.ts) | Slot-positioned spatial audio mixer |
| [meeting-video.drone.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/meeting-video.drone.ts) | Renders remote/local streams onto the correct ring-1 hex |
| [meeting-controls.worker.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/meeting/meeting-controls.worker.ts) | Camera toggle and availability UI |

---

## Related documentation

- [hive.md](hive.md) — How the hex grid and live session presence model works
- [security.md](security.md) — Presence-first security: why meetings leave no persistent trace
- [protocol-spec.md](protocol-spec.md) — Nostr relay transport used by the mesh
- [slash-behaviour-reference.md](slash-behaviour-reference.md) — Full `/meeting` command reference
