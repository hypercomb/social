# Meetings — start one where you are, and people follow you

**Status: built 2026-11-02.** Owner (jwize, 2026-11-02): "meeting starts
meeting", "just make it easy to connect", "let's just make the leader the
middle and then people follow you where ever you go in the hive", "there is no
relationship between a tile and a meeting", "you could give up leadership and
take it back if you are the originator", "we are just sending small paths that
get executed locally", "they can allow or disallow the behaviors allowed in the
swarm".

A meeting is your swarm's: one per swarm (host + room + secret, the place an
`invite` link shares). It belongs to no tile. Whoever starts it leads; their
face is the middle hex, and the people who join follow them around the hive.
What the leader says comes through to the people following, and each person
allows or disallows the words it uses. No code is sent: only directions.

## Starting and joining

```
meeting                 start the meeting, or join it — on camera at once
```

The link is copied for you (or shared, or shown to copy, as your device
allows) — send it to bring someone in. They open it, join the swarm, and type
`meeting`. Not in a swarm yet? `meeting` says so and offers to start one.

While a meeting is on, a chip sits on the command line: `meeting · 2`. Its
roll-down lists the seats, who leads, whom you follow and what the room asks.
Click it to copy the link again; × leaves. People in the swarm who have not
joined see `meeting live · 2` (click to join) and a mark on the tile where the
leader stands.

`meeting lobby` checks your camera, microphone and picture first, and shows
the room's rules before you join.

## Following

The leader's every move reaches the people following as a path (`go`), which
each of them walks in their own hive. A follower who looks around is brought
back at the leader's next step, not before.

```
meeting lead 2          hand the lead to seat 2 (only whoever started it)
meeting lead me         take it back
meeting follow 3        follow seat 3 instead of the leader
meeting follow leader   follow the leader again
meeting leave           leave
```

Seat 1 is the leader, in the middle; the ring fills in order of arrival.

## The room's behaviours

The room states the words its leader uses — `go` (follow) by default; the
leader names more with `meeting rules go create trait`. Each person allows or
disallows each one (in the lobby; the chip shows ✓ and ✗). When the person you
follow says a line on their own command line:

- its word is **allowed** → it runs for you too, through the machine door,
  judged against your `grant` like any outside line;
- its word is one the room asks for but you **disallowed** → it is dropped;
- its word is one the room **never stated** → it waits on your `$` line, Enter
  or Esc ([command-line-reference.md](command-line-reference.md)).

Only the lines of someone being followed are sent: typing in a meeting is not
broadcast to people who are not following you. A line carrying an access code
is never sent. This is a way to step through sharing: someone shows the way,
and each person decides what they let run.

## Video: blocked by the outgoing firewall (decision owed)

The shell's outgoing firewall (`hypercomb-dev/src/index.html`,
`hypercomb-web` setup, `outgoing-firewall.spec.ts`) replaces
`RTCPeerConnection` with a function that throws "peer connections are
refused". So the faces of other people never connect: each person sees only
their own face in the middle. Everything above — the swarm meeting, seats,
following, handing the lead over, relayed lines — works without video, over
the mesh. To have video, choose one:

1. **Peer connections with no outside ICE server** — the firewall lets
   `RTCPeerConnection` through, the meeting passes `iceServers: []`. Works on a
   local network only; no third party is asked anything.
2. **An owned STUN/TURN** on a host you run (Cloudflare's TURN service, or one
   beside the relay) — works across the internet, no third party.
3. **A public STUN server** (the code names Google's today) — works across most
   networks, but every call asks a third party for your address, which the
   firewall exists to refuse.

## Subdomains (design, not built)

A published subdomain (`presentation.hypercomb.com`) runs the read-only
visitor shell: no WebSocket, no cross-origin request, and the worker sends
`Permissions-Policy: camera=(), microphone=()`. A visitor there cannot reach
the mesh or a camera, by design. Proposal:

- **The meeting stays the swarm's.** A subdomain's meeting is the meeting of
  the swarm its zone hosts (`room host <zone>`, host-welcome.ts), joined in the
  participant shell at `swarm.<zone>` — the visitor page offers "join the
  meeting" as a link there, carrying the path the visitor was reading, so they
  arrive where they were.
- **The worker change it needs:** `swarm.<zone>` sends
  `camera=(self), microphone=(self)` instead of `()` (worker.js
  serveSandboxShell), and the video decision above.
- **A room per subdomain** needs a card per subdomain: today a card is read
  only at `host.<zone>`, and `room host presentation.hypercomb.com` would sign
  `welcome:presentation.hypercomb.com`, a card nothing reads. Either the front
  door reads a subdomain's own card, or a subdomain carries its room in its
  published tree.

## Files

- `hypercomb-essentials/src/meeting/hive-meeting.drone.ts`: the swarm's
  meeting — room, heartbeat, seats, following, relayed lines, the chip and the
  tile mark
- `hypercomb-essentials/src/meeting/meeting-seats.ts`: the address, the
  originator and leader, seat order, whom a person follows, when to walk
- `hypercomb-essentials/src/meeting/meeting.queen.ts`: the `meeting` word
- `hypercomb-essentials/src/meeting/lobby/meeting-lobby.view.ts`: the lobby —
  camera, microphone, picture, the room's behaviours, copy link, join
- `hypercomb-shared/ui/command-line/command-line.component.ts`:
  `command-line:said`, the participant's own lines, for relaying
- `hypercomb-essentials/src/meeting/meeting-quality.ts`: Saver, Auto, Sharp

## Related

- [meetings-and-quorum.md](meetings-and-quorum.md): the earlier tile-tagged
  cascade and quorum model this replaces for `meeting`
- [swarm-room-identity.md](swarm-room-identity.md): what a swarm is
- [hive-say.md](hive-say.md): the `$` gate the undeclared lines wait at
