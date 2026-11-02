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
meeting                 start the meeting, or join it — your video not shared
meeting camera          share your video, or stop sharing it
```

**Video is off by default** (jwize, 2026-11-02: "if we are showing video we
need it to be off by default"; "even off you need to see your video on your
screen so you can see it works"). You join sending your voice only. Your
camera still runs for you: your own hexagon shows your face, marked "only
you see this", so you can see it works. The others see it once you share
it — `meeting camera`, or the participants' hive's "share my video". A person
who has not shared keeps their seat number on everyone else's screen, and
their voice still plays.

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

## The meeting icon and the participants' hive

A camera icon sits among the tools at the top right:

- **quiet**: no meeting in your swarm; pressing it starts one;
- **pulsing very slightly**: a meeting is live in your swarm and you are not
  in it; pressing it joins;
- **coloured**: you are in the meeting; pressing it shows or hides the
  participants' hive.

The participants' hive is a hive of just the people in the meeting: one
hexagon each, the leader in the middle and the others around them in seat
order, each with their video once it arrives (their seat number until then).
It opens when you join, sits just below the command line (which stays on top
and usable), and has share my video, copy link, leave, and back to the hive.
Its videos are muted; the sound plays once, elsewhere.

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

## Video: through Cloudflare's SFU

**Built 2026-11-02** (jwize: "lets go on sfu only"). Each person keeps ONE
peer connection, to Cloudflare's Realtime SFU, through the meeting point the
swarm already meets at (`hypercomb-relay/meet-worker/sfu.js`): they publish
their camera and microphone once and subscribe to everyone else's. Nobody
connects to anybody else, so **no participant learns another's address** —
only Cloudflare sees it. A 7-person meeting costs each person one upload, not
six.

**Turning it on (the owner, once):**

1. Cloudflare dashboard → Realtime → SFU: create an app; note its App ID and
   App token.
2. In `hypercomb-relay/meet-worker`: `npm run video:setup`. It asks for the
   App ID and the App token (not shown), puts both on each meet worker
   (`wrangler.meet.toml`, `wrangler.meet-open.toml`) and deploys both.
   `--no-deploy` sets the secrets only.
3. The shell's outgoing firewall must let a peer connection name Cloudflare's
   STUN — see below.

Without the secrets the meeting point answers `501` and the meeting goes on
with no video between people (each person still sees themselves).

**The routes** (under `/.well-known/hc-meet/sfu/`, the path family the front
worker already forwards to the meeting point): `session`,
`session/:id/tracks`, `…/renegotiate`, `…/tracks/close`, `…/beat`. Not a
pass-through: bodies are size-capped and shape-checked; a session names its
meeting (`X-Hc-Meeting`, the 64-hex address only the swarm can derive) and,
on a coded host, the access code (`X-Hc-Access`); a remote track must come
from a session of the same meeting; seven publishers fill a meeting; one
address may open 20 sessions in ten minutes.

**The budget.** Cloudflare bills what it sends out ($0.05/GB past 1,000 GB a
month, shared by SFU and TURN). The meeting point estimates it from what each
session subscribes to (remote video × time × the Auto picture's ~1.55 Mbps)
and refuses new sessions and subscriptions once its month reaches
`SFU_MONTHLY_GB` — 500 on each of the two meet scripts, so the account stays
inside the free 1,000 GB. A session that stops beating for 90 s has its
subscriptions closed. A 7-person meeting on Auto is ~29 GB an hour; Saver
~10 GB.

**The firewall (decision owed).** `hypercomb-dev/src/index.html` pins
`RTCPeerConnection` to a function that always throws, so the browser cannot
open the SFU connection yet. The change: allow a peer connection only when the
ICE servers it names are Cloudflare's STUN (`stun:`/`stuns:` on
`stun.cloudflare.com`) or none, guard `setConfiguration` the same way, refuse
everything else (any other STUN, any TURN). It loosens a security control, so
it is the owner's to make or to permit.

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
- `hypercomb-essentials/src/meeting/sfu-client.ts`: the browser's half of the
  video — one request at a time
- `hypercomb-relay/meet-worker/sfu.js`: the meeting point's half — the
  routes, the app token, the month's budget
- `hypercomb-relay/meet-worker/scripts/video-setup.mjs`: `npm run
  video:setup`, turning video on for both meet workers
- `hypercomb-essentials/src/meeting/meeting-hive.drone.ts` and
  `meeting/hive/meeting-hive.view.ts`: the participants' hive, opened on join
  and toggled by the meeting icon (`meeting:view-toggle`, `meeting:view`)
- `hypercomb-shared/ui/command-shell/`: the meeting icon (`meetingState`,
  `meetingOpen`, `meetingToggle`)
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
