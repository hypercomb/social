# A room is its meeting point, its room and its secret

**Status: BUILT 2026-10-12.** Owner decisions (jwize, 2026-10-12):

1. "hash or however we do it (host+location+secret) gen keywords from those"
2. "the only place the host comes from is the field we attached to … hosts
   are added to our portal for replication"
3. "yes make localhost default to hypercomb.com"

## The rule

A swarm room is three things: the **meeting point** the tab attaches to, the
**room** (the "location" — never the page path), and the **secret**. Every
address the swarm derives from the room, and the room's two comparison words,
come from one preimage tail:

```
roomPreimage(room, secret, point) = room \0 secret \0 meetingPointKey(point)
```

(`hypercomb-core/src/core/zone-text.ts`.) `meetingPointKey` is the point's
lowercase `host[:port]` — `wss://HyperComb.com/` and `hypercomb.com` are
`hypercomb.com`, `ws://localhost:7777` is `localhost:7777`. An **empty
meeting-point field is the shipped default** (`wss://hypercomb.com`), so an
empty field and `hypercomb.com` are the same room. The point is **always** part
of the preimage — the default included. There is no shipped-default
exception: "the host field isn't filled by default; we have to connect to it
ourselves".

| Address | Preimage |
|---|---|
| lifecycle roster (kind 30206) | `lifecycle \0 room \0 secret \0 point` (`lifecyclePreimage`) |
| a page's channel (kind 30200) | `lineageKey(segments) \0 room \0 secret \0 point` |
| a member's personal / request / presence channels | `channel:<pubkey> \0 …`, `request:<pubkey> \0 …`, `presence:<pubkey> \0 …` |
| the room's ask channel (content broker) | `broker:fetch \0 room \0 secret \0 point` |
| the room's client roster (client-presence, kind 30207) | `hc:clients \0 room \0 secret \0 point` |
| lent models (peer-models: offer / request / reply) | `peer-models: \0 …`, `peer-model-request:<pubkey> \0 …`, `peer-model-reply:<pubkey> \0 …` |
| the `{alive}` beacon carried on an upload (D7) | its `x` is the lifecycle address above — at the point the room MEETS at, never the upload host's |
| the "share tiles from before" ask memory | `share-ask \0 room \0 secret \0 point \0 page` |

Each of them is re-derived when the room, the secret or the point moves.

**The two words** are the readable form of the room's address:
`secretTag(lifecyclePreimage(room, secret, point), 'en')` — the English list
in every language, the reader's own pair beside it. Everyone in a room reads
one pair wherever they stand; the same room text at another meeting point
reads another pair, because it is another room.

**One meeting point per meeting.** Two halves of a group on two relays are two
rooms; nothing bridges them. **One relay, one name**: the room is keyed by the
name the tab dials, so one relay reached under two names (`localhost:7777` and
`127.0.0.1:7777`, a host and its `www.`, a tunnel name for a home relay, a
proxy port in a harness) is two rooms. Nothing tells them apart but the words —
give everyone one URL. (Keying by the relay's own card would need the card
before the first address, a wait on every join; it is not done.)

## Where the point comes from

Only from the field the tab attached to — the relay it actually dials
(`NostrMeshDrone.swarmHost()` / `meetingRelay()`):

- a joined tab's own meeting point (`hc:mesh-zone.relay` — the selector's
  meeting-point field, a meeting link's `&relay=`, `/use-live-relay … ws(s)://…`),
  read at once, before the mesh has moved its list;
- else the page's own relay list — `hc:nostrmesh:relays` when one was chosen,
  else the shipped default. A loopback relay on a public page is passed over
  for a reachable one beside it, but when it is ALL the page dials (allowed
  explicitly) it is the point.

**Never a hidden point.** The selector shows the point an empty field would
meet at when the page's own list meets anywhere but the default (it is
pre-filled), and an **empty field at Start is the shipped default** — the
selector names `wss://hypercomb.com` as the tab's point rather than falling
back to a list nobody sees. `/use-live-relay <room> <secret>` with no server
points the tab at the live relay for the session on every origin, whatever
list the page holds (it keeps the list, it does not obey it).

**Replication hosts are never part of a room**: the hosts pool
(`community:hosts`), a branch's publish domains, the upload host and your own
host (`hc:nostrmesh:self-domain`) keep bytes; they do not decide who meets.
The swarm selector therefore shows only what defines a meeting — **meeting
point, room, secret**, and the **access code** only when a point other than
the open default is typed (or a code is held, or the opener asks for it); the
code is always masked — the secret's eye never reveals it. Your own host moved
to the host directory (the hosts window): "Your own host", handed by the hosts
drone (`hosts:own-host`) to host-sync's `setOwnHost`, the key's one writer.
Naming it never switches backup on. Your name is renamed on the presence line.

## The point moves, the room moves

A tab whose meeting point changes while its room and secret stay — the
selector, `use-live-relay <room> <secret> wss://…`, a relay list changed under
it — is in another room. The swarm (`#onMeetingPointMoved`) tears the old room
down and meets at the new point's addresses; the content broker moves its ask
channel (on `mesh:zone`, and on `mesh:connection` for a list that moved with no
announcement — a tab that only serves follows too); client-presence and
peer-models re-derive. Nothing is asked and nothing is waited on: the point is
read synchronously, and the move is the same teardown-and-resync a room change
always was. The selector writes the point BEFORE the room and the secret, so
the swarm's first address after the move is already at the new point.

**No `{left}` is carried to another point.** By the time the swarm tears the
old room down the mesh's list has already moved, so a tombstone would go to
the NEW relay: the old room would never hear it, and that relay's operator
would be handed the old room's roster address (its pubkeys and paths) without
its secret. So a move to another point says nothing; the old socket drains
and closes, and the old room hears the meeting point's will after its 15 s
grace (on a plain relay, when the beacon expires). A room or secret change at
the SAME point still says `{left}` there at once.

## A loopback page meets where every install meets

`localhost:4250` (the dev shell, any loopback origin) seeds
`wss://hypercomb.com` like every install (`nostr-mesh loadRelays`), and
resolves bytes from the same mirrors (`content-broker #liveRelayActive` is
`flag !== '0'` on every origin). The local dev relay `ws://localhost:7777` is
dialled only when CHOSEN: the meeting-point field, a server named to
`/use-live-relay`, or a relay list (`hc:nostrmesh:relays`). `use-live-relay=0`
still opts out — no relay at all, never a loopback fallback.

**No dev secret.** A loopback page used to pre-fill the secret with a word in
the public source; at the public point that would put a dev hive in a room
anyone can compute, so it is gone — type one (two tabs of one origin still
share it once typed). **No silent move**: a loopback tab joined before this
shell met at the dev relay its mesh seeded and recorded no point; on its first
load of this shell (`hc:mesh-point-crossing`, once per tab) the shell pins
that point (`ws://localhost:7777`) into its zone, so it resumes where it was
instead of in a public room it never chose.

Harnesses that leaned on the loopback default now name the dev relay
explicitly (`scripts/drive-swarm-connectivity.cjs` `LOCAL_RELAY`, the legacy
`drive-*-test.cjs` probes, `drive-incognito-sync-test.cjs`,
`drive-agent-swarm-hiding.cjs`). A harness that splits peers across ports or
proxies puts them in different rooms (one relay, one name): give every peer
one URL and shape traffic behind it.

## Old and new versions do not meet

Every room has a new address. A package from before 2026-10-12 hashes
`lifecycle \0 room \0 secret` (and its page channels without the point), so it
and a current package typing the same room, secret and point are in **two
rooms** — they cannot see each other, and a current tab cannot even tell an
older one is there (it beacons on an address the current one never hears).
Everyone in a meeting updates before the guests arrive. A relay started with
`--allow-participants=<lifecycleSig>,…` needs the new sigs, at the point the
room meets at (`scripts/swarm-preflight.cjs` prints the current derivation for
the relay it is pointed at).

**The words follow the package.** The shell and the package update apart (a
shell deploy reaches every web profile on reload; a package only when its
participant presses Update), so the shell draws the words the way the LOADED
package addresses the room: `SwarmDrone.roomIdentity` (2) is read in-page,
synchronously (`presence-status loadedRoomIdentity`), and a package without
it gets the pre-2026-10-12 pair (`lifecycle \0 room \0 secret`, the point
folded in only off the default — D4). Two tabs whose pairs differ are in two
rooms, whatever their shells are.

The core helpers are new exports (`meetingPointKey`, `roomPreimage`,
`lifecyclePreimage`, `SHIPPED_MEETING_POINT`): a package that uses them needs a
shell whose core has them — the core-surface gate refuses the install by name
otherwise. Ship the shell with the package.

## What did not change

- The meeting link (`#meet=room/secret/page&relay=…&code=…`) carries the point
  when it is not the default — the tab's own point, or the point its own list
  meets at (never a loopback one) — so a guest joins the room the facilitator
  is in.
- A tile-borne invite bundle's `secretCheck`
  (`sha256('hypercomb:invite' \0 room \0 secret)`) is a check on the secret,
  never an address, and the bundle names no point: a guest joining from a
  bundle meets at their own default.
- `hc:current-zone` (the swarm's local per-zone scope key for hide lists) is a
  device-local key, not an address.
