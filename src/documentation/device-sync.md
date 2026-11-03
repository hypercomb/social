# Device sync — one participant, many devices

A participant's second device (a laptop, the desktop app) should hold a full
copy of their hive without anyone copying a private key. Sync between a
participant's own devices is **replication between two of their own replicas**
(`install-by-replication.md`), authenticated by a delegation instead of a shared
secret.

## Why not share the key

The key lives only in a device's own storage — "never a pool, resource, event or
export" (`security.md`) — and with a NIP-07 extension it never reaches the page.
Exporting it once to a second device is the riskiest moment in the design and a
leak exposes everything it can sign. So each device keeps **its own key** and the
master vouches for it.

## The two pieces (built)

`sharing/device-delegation.ts` — a **delegation** is one nostr event, kind
`30571`, signed by the master through the ordinary `signEvent` door:
`d = p = <device pubkey>`, `scope = sync`, optional `expiration`. Parameterized
replaceable on the device, so grant, renew and **revoke are the same shape and
the newest wins** — there is no revocation list. A delegation says "this device
belongs to M"; it never lets the device sign *as* M.

`sharing/device-handshake.ts` — a live proof before any atom moves. The verifier
sends a fresh challenge; the prover answers with a kind `30572` event signed by
its own key, bound to the verifier's key and to that challenge, carrying its
delegation (the master device carries none). Never published, never stored. It
cannot be replayed to another verifier, for another question, or later than 60 s.
Run in both directions, a pair is mutually authenticated.

Verification checks a **clean copy** of the event: `nostr-tools` caches its
verdict under a symbol key that `{ ...event }` copies, so a tampered in-memory
copy would otherwise inherit "verified".

## Pairing (built)

`sharing/device-pairing.ts` + `sharing/pair.queen.ts` — the `pair` word. The new
device runs `pair` and reads out its key; the master runs `pair add <key> name`
and copies a token; the new device runs `pair accept <token>` (it shows whose
word it is taking and asks). A token holds only master-signed events, nothing
secret. `pair remove <key>` mints a revocation token for the master's other
devices: a device can only turn away a revoked device it has been told about
(`known` in the handshake). The record lives in the pool `device:pairing`.

## Transport (built)

Three layers, each testable without the one below it.

- `sharing/device-link.ts` — the conversation over any `LinkChannel`: both ends
  say `hello`, answer each other's challenge with a `proof`, say `ok`; only then
  does `get <sig>` get an `atom` (12 KB chunks, 16 MB ceiling) or `none`. A
  `get` before the peer has proved itself is answered with `deny` and the pipe
  closes. There is no push — a device only asks for what it lacks. `peerIo`
  wraps a link as a `ReplicationIo`, so `replicate(root)` pulls from the peer and
  the walker still hashes every atom against its name.
- `sharing/device-signal.ts` — how the two find each other: offer, answer and
  candidates over the relay the mesh already speaks to, as EPHEMERAL events
  (kind 20573 — a relay forwards and keeps nothing) sealed with NIP-44 to the
  peer, at the rendezvous address `sha256('device-sync:' + master)`. The relay
  sees that two keys exchanged something, never the addresses inside. Who sent a
  message is decided by the cipher, not by the event's own pubkey field.
- `sharing/device-rtc.ts` — the WebRTC data channel as a `LinkChannel`. The only
  host besides the peer a connection may reach is `stun.cloudflare.com`, the one
  STUN server the web shell's firewall admits. No TURN: two devices behind NATs a
  STUN server cannot cross will not connect, and say so (`dial` returns null)
  rather than relay the participant's bytes through someone's server.

Two races the first run found and the code now handles: a candidate is found
the moment the local description is set — before the offer carrying it has been
sealed and sent — so outgoing candidates wait for the offer/answer and early
candidates for a session not yet started are held a few at a time; and a data
channel is open before anyone has attached to it while the other end already
speaks, so a channel holds early frames and hands them over when a handler is
attached.

Verified two ways: 36 specs over fakes, and the same code between two REAL
`RTCPeerConnection`s in headless Chromium (110 KB atom, ten chunks, byte-identical,
~200 ms, no network request besides the page).

## The walk (built)

`sharing/device-sync.ts` — **any device can be the source and any device the
backup; the one that asks walks.** Two more link frames carry it: `heads?` (the
head of every lineage bag the peer holds, in pages of 200) and `marker?` (which
layer one marker names). The tree is the set of lineage bags, one per node; a
bag's highest marker is the node's current layer and the earlier ones are its
history. Per bag:

| the peer | the walk |
|---|---|
| has a bag this device lacks | pulls markers 0 … n |
| is ahead | pulls mine+1 … n |
| is level | nothing |
| is behind | nothing — its own walk fetches from here |
| went its own way from the same point | **a fork**: recorded, neither side touched |

Each marker is taken only AFTER the layer it names is wholly here (the closure
is pulled first through the replication walker, which hashes every atom against
its name; the marker is appended after). A walk cut off halfway leaves a shorter
history, never a broken one; a bag that fails stops there and the rest carry on;
pressing again resumes — there is no state to repair. Nothing is replaced or
deleted.

**What travels, deliberately.** Lineage bags only. Pools of meaning are left out
on purpose: a pool can be this machine's own setting (`device:pairing`,
`swarm:keep-alive`), the pool registry has no "machine-local" flag, and "never
widen what a backup copies" is the standing rule for anything carrying private
bytes (`folder-sync` is the precedent). A pool joins the walk when it is decided,
pool by pool, that it travels.

## Wired (built)

- `sharing/device-sync.store.ts` — the real store's side. A root directory is a
  lineage bag only when the pool registry does not know it, every entry in it
  is a marker, and its newest marker reads `{ layer }`; anything else (a pool,
  a molecule, a stray) is skipped. Markers go in through core's one
  `writeLayerMarker`, forward only, never into a pool, never naming a layer not
  held; atoms through `putResource`. No raw storage write.
- `sharing/device-sync.service.ts` — a paired device ANSWERS (listens at the
  rendezvous address, serves heads and atoms to the participant's other devices
  that pass the proof); an unpaired device opens nothing. `device-sync:run`
  DIALS every other device and walks each that answers. It runs only when
  asked — no timer, no boot sync. One state, `device-sync:state` (last-value
  replayed), is all the shell reads.
- The runtime registers the ONE replication walker on the shell registry
  (`@hypercomb.social/ReplicationWalker`) so a module can pull a closure from a
  device instead of a host.
- **The Sync button** sits beside Save in `edit-actions` and shows only on a
  paired device; it dims to "syncing…" while a walk runs.

Verified: 57 specs, including two whole devices (own store, own service, fake
relay and WebRTC) where one presses sync and ends level with the other; the
button, the service and the walker in the running dev app, where a press on an
unpaired device answers "No paired device to sync with".

## What is not built yet

1. **Two real devices.** Never run across two real browsers over a real relay:
   pair two profiles, open both, press sync. Also unverified in a live session:
   that the page repaints the arrived nodes without a reload (the history
   service's head cache validates against the bag on first use, and sync emits
   `fs:changed`, but this is not proven).
2. **Revocation that spreads on its own.** Today the master hands the token over.
3. **Pools.** Excluded on purpose, until each is decided to travel.
4. **Forks.** Recorded and reported, not yet joined.
5. **The desktop app as a peer** — to be proven.
