# The swarm's host

**Status: DESIGNED 2026-10-04, building on `swarm-bulletproof`.** Owner
decisions (jwize, 2026-10-04): the meeting point hosts the meeting; a swarm's
host allows participants by default; connection and reconnect speed are never
traded for anything else; the tightest setup wins.

The relay you meet at is your swarm's host. Joining is enough to share. A
tile's name reaches the room at once, and its bytes follow as soon as the host
serves them. Nothing you shared disappears because you edited it, reloaded, or
the upload is slow.

## The rule

- **The meeting point hosts the meeting.** The relay a joined tab dials is
  also where it uploads. `wss://jwize.com` means `https://jwize.com/<sig>`.
- **Hosting stays the truth.** No signature is ever announced that no host
  serves. Taking a tile still needs hosted bytes.
- **Names before bytes.** Until the host serves a tile, its name goes out
  without signatures. Peers see a label tile they cannot take yet.
- **Never retract.** A shared name leaves the room only when you delete it,
  move it away, make it private, leave, or go silent past your 90 s slot.
- **Membership is per tab.** Only the tab you joined in shares. A second tab
  cannot silence it.
- **The socket says what it is.** A dead connection is found within seconds
  and replaced, and the status line shows the real state.

## What this amends

- **Sharing requires hosting (jwize, 2026-09-25)** —
  [resource-offload-relays.md](resource-offload-relays.md), "Availability
  gate". The rule stands: no signature is announced that no host serves. What
  changes is who hosts: the swarm's host does, so joining is enough. "No host,
  no share" narrows to "no host, no bytes". A tile's name goes out at once; its
  signatures go out when a host serves them.
- **Join offers what your host serves (2026-09-25)** —
  [deployment-stages.md](deployment-stages.md). Joining now offers every tile
  you make public while joined. `publish here` is not part of swarm sharing.
  It stays the act that publishes a creation, and it stays refused at root.
- **"Watching only — set a host in /hosts."** Gone. Watching needs nothing.
  Sharing needs a host that allows participants, and the meeting point is one.
- **"The relay no longer hosts other participants' bytes" (2026-06).** The
  relay's HTTP half now hosts allowed participants. Events stay memory-only.
  There is still no temp pool: bytes land flat at `/<sig>` in the same heap and
  are kept like any other atom.
- **The guest recipe of 2026-10-04** (`/join`, `>`, pick a host in the Publish
  panel, `publish here`). Retired. A guest taps the meeting link and presses
  Join.
- **Consent for swarms** — [consent-hosting.md](consent-hosting.md). For a
  swarm, consent is the host's standing allow plus the join sheet. No request
  or grant event is sent.

This is not the 2026-09-24 "sharer is a host while present" relaxation coming
back. That rule re-uploaded whole hives and announced bytes nobody served once
the sharer left. Here only signatures that carry a `.public` marker are
uploaded, and they go to the meeting point's disk, so they are still served
after the sharer leaves.

## Which host: derived, never picked

- `NostrMeshDrone.swarmHost()` returns `host[:port]` of the first relay the tab
  may dial. `wss://jwize.com` gives `jwize.com`; `ws://localhost:7801` gives
  `localhost:7801`. It is pure and synchronous: no fetch, no NIP-11 call. A
  loopback relay is the swarm's host only on a page that is itself local — a
  developer's `ws://localhost` override beside the live relay on a real origin
  is dialled, but the bytes go to the next relay, which peers can reach.
- While `isJoinedHere()` is true, `HostSyncService` adds it as a target,
  public-only and flagged `swarm`. There is no host pick, no `publish here`,
  and nothing stored.
- The target follows from two things that already survive a reload, a
  discarded tab and the Update pill: the saved relay list and this tab's
  `hc:mesh-session`. Receipts on disk (`sign('host-receipts')`,
  `{sig}.{hostHash}`) count again, so the first walk after a reload republishes
  the same full entries.
- It is the relay's own content heap, not the Cloudflare worker. Swarm sharing
  never writes to a worker, and `use-live-relay` no longer turns one on.
- A port is accepted only for a loopback host (the harness relay). A loopback
  host is never advertised from a page that is not itself loopback.
- Layer events advertise `['domain', <swarm host>]` first. Older receivers
  already turn domain tags into fetch candidates. While joined, reads try the
  swarm host first.
- When the set of targets changes, cached "not available" answers are checked
  again.
- The swarm host is owed only what the room is offered NOW: a sig in the
  closure of a tile the walk (or a publish) named through `markPublic` during
  this join, and has not since pruned as private. A tile made private while
  its upload waits out a backoff never reaches the host, and a leave ends the
  offer — `.public` markers on disk never carry bytes into the next room. The
  public CDN and publish nodes keep the plain marker rule.
- The publish gate asks the nodes it publishes to (`isClosureAvailableOn`),
  never the meeting's host: a receipt there says nothing about the node whose
  index is about to name the branch.

## How a host allows participants

One relay flag, also read from the env `ALLOW_PARTICIPANTS`. It is off unless
given.

| Flag | Who may upload |
|---|---|
| `--allow-participants` (bare, or `=all`) | any key that sent a verified EVENT on this relay in the last 30 min |
| `--allow-participants=<lifecycleSig>,...` | only keys whose `{alive}` beacon (kind 30206) carried one of those `x` values |
| `--writers <keys>` | unchanged: named writers, uncapped |

- `lifecycleSig` is `sha256('lifecycle\0' + room + '\0' + secret)`, the
  channel the swarm already beacons on. Listing rooms needs a relay restart for
  each new room. jwize.com runs the bare form.
- "Live" means recently heard. The relay keeps an in-memory map from key to
  the time of its last verified EVENT and the zones it beaconed in. A restart
  empties it, and the reconnect beacon refills it within a second. The swarm
  beacons before its first upload, so a new joiner is live before its first
  PUT.
- NIP-11 shows the policy: `limitation.participant_uploads` is `"all"`,
  `"zones"` or `false`. Clients never ask first. The answer to the first PUT
  is the policy.
- Joining is the participant's consent. The join sheet names the host
  ("…kept by jwize.com"). The `.public` marker gate is unchanged, so private
  tiles, the clipboard and settings never reach any host. In a joined tab,
  only signatures that carry a `.public` marker are queued for upload.

## Bounds

Participant uploads are capped. Writers stay uncapped, as before.

| Bound | Answer |
|---|---|
| more than 8 MB in one blob | 413 |
| more than 256 MB per key in 24 h | 429 with Retry-After |
| more than 2 GB per IP in 24 h | 429 with Retry-After |
| more than 4 GB across all participants in 24 h | 507 `host full` |
| less than 10 GB free on the host's disk | 507 `host full` |

- Only newly written bytes count. Sending a signature the host already holds
  is free.
- The IP is `CF-Connecting-IP` when the socket peer is loopback (cloudflared),
  otherwise the socket address. The first `X-Forwarded-For` hop, which a client
  can forge, is never used.
- Pool addresses are reserved. A PUT at any public pool address, at
  `sign('host:packages')`, at `sign('hive:indexes')`, or at a path that is an
  existing directory gets 409.
- Unchanged: NIP-98 with method and URL bound; `sha256(body) === sig`, else
  422; flat `/<sig>` only.
- NIP-98 freshness is ±600 s for flat atom PUT and HEAD only. Those writes are
  idempotent and hash-checked, so a replayed token can only store the same
  bytes again. Every other write route stays at 60 s.
- The body is hashed chunk by chunk and written asynchronously. An upload
  never blocks the frames of the meeting.
- Retention: participant blobs are kept, with no GC for now. The receipt index
  keeps its sig-to-writer record for a later GC.
- Logs: counts only. There is no line per participant write, and no IPs or
  keys anywhere.
- A 404 for a signature path carries `Cache-Control: no-store`, so a Cloudflare
  cache rule in front would be safe. None is set (decided 2026-10-04).

## The receipt: `201 stored <sig>`

For the swarm target, a 2xx answer whose body is exactly `stored <sig>` is the
receipt. No read-back GET follows.

That is enough here because the relay sends that body only after the bytes
hashed to the signature and were written to its heap. The read-back rule
(protocol-spec §21.11 and §21.12) exists because a fallback page or a proxy can
answer 200 without storing anything. Neither can produce `stored <sig>`. Every
other target keeps the read-back.

The drain:

- asks the host first: HEAD, four at a time. A signature the host already
  serves earns its receipt without a PUT;
- PUTs what is missing, four at a time;
- after a receipt, re-walks every page that is waiting, within 150 ms, not only
  the current page.

## Refusals

Every failure backs off per host and is shown with its reason. Names keep
going out whatever happens.

| Answer | `sync:state` | Back-off | Result |
|---|---|---|---|
| 401 `not-live…` | `not-live` | 1 s, up to 5 times | clears itself, because the beacon goes first |
| 403 `participants-closed` | `refused` | 10 min | names only (also a live key whose only room is one a `--allow-participants=<rooms>` relay does not take) |
| 413 | `too-large` | the entry is dropped for this host | that tile stays name-only |
| 429 or 507 | `full` | Retry-After, at least 10 min | names only |
| no answer, or 5xx | `unreachable` | 2 s, doubling to 60 s | retried |

`sync:state` also reports `backed-up` (everything served) and `syncing`
(uploads in flight). Back-off resets on success, and the SWARM host's (not a
'full' one) when the socket comes back — the first open after a join, or the
one `reopened` payload; a stall answered late is not a return, and no other
host's pause is touched. A 409 answers only a PUT at a reserved address,
which a tile's bytes never are. Each receipt the swarm host earns is announced
at once as `host:receipt` {sig, host, swarm: true}, so a second, refusing
public-only target can never hold the room's tiles name-only.

## Names before bytes: the gate

Each walk builds the entry for each public child with one helper:

1. **Hosted.** The closure has a receipt on a current target. Publish the full
   entry: name, layer signature, properties and titles. Remember it as this
   name's last hosted entry.
2. **Last hosted.** Not hosted yet, but this name has a last hosted entry.
   Publish that entry unchanged. Its old handle and picture are still served.
3. **Name only.** Neither. Publish a placeholder: the name, the titles and the
   scalar properties, with `layerSig`, `inviteSig` and every value that holds
   a 64-hex string removed. Receivers draw it as a label tile. It cannot be
   taken until the full entry lands.

- A page that used 2 or 3 is walked again when a receipt arrives.
- The remembered entry is used only for children that are still public. Making
  a tile private drops it at once.
- The remembered entry goes out only while the current targets still serve
  it (a memoized yes, cheap): a relay switch that kept the zone, or a host
  that lost the bytes, never sends handles nothing reachable serves. A child
  that disappears from the page (deleted, renamed away) takes its memory with
  it, so a later tile of the same name is never offered the deleted one.
- When an earlier version can go out, the walk waits at most 250 ms on the
  newest version's answer (a HEAD to a slow host must not hold every name on
  the page); a late yes walks the page again.
- The memory is cleared on a zone change and on leave.
- The `swarm:availability-hold` effect, the held list, and the "Watching only"
  and "Uploading before sharing" toasts are gone. After each walk the swarm
  emits `swarm:share-status` {location, offered, uploading, nameOnly, private,
  hostState, reason}.

Timing on venue wifi:

| From | To | Typical | Budget (p95, live) |
|---|---|---|---|
| create | peers see the name | 0.3-0.5 s | 1.0 s |
| create | peers see the picture and can take it | 0.8-1.3 s plus picture upload | 2.0 s |
| edit | gap seen by peers | 0 s | 0 s |

### When a name leaves the room

Only when:

- it is deleted or moved away;
- it is made private;
- its sharer signs a leave or changes zone;
- its sharer's 90 s slot expires with no refresh.

Never because it is new or edited, its upload is pending, refused or over
quota, a target is missing, or the tab reloaded.

## Membership is per tab

- `hypercomb-essentials/src/sharing/membership.ts` exports `isJoinedHere()`.
  It reads this tab's `sessionStorage['hc:mesh-session']` and follows
  `mesh:public-changed`.
- Essentials never read the origin-wide `hc:mesh-public` flag. A doctrine
  ratchet with an empty allowlist forbids that literal in
  `hypercomb-essentials/src`.
- Every tab keeps a WARM relay socket from boot, silent until it joins, so
  joining never waits on a handshake (connection first, jwize 2026-10-05). A
  second tab that has not joined sends nothing to the swarm and has no swarm
  target. It cannot silence the joined tab: a will belongs only to the
  connection that beaconed the slot, so the same key in an unjoined tab can
  neither fire nor cancel the joined tab's will.
- A reload, a discarded tab and the Update pill keep the join. Closing the tab
  leaves. iOS may drop session storage when it kills a tab; tap the link again.
- Visited pages are not persisted, because where a person went is not
  recorded. After a reload the current page republishes at once. Other pages
  refresh when revisited, or lapse at their 90 s TTL.
- Listeners are armed when the drones are constructed, not at first paint, so
  nothing created in the first seconds is missed.

## The socket says what it is

`mesh:connection` {state, reopened, since, attempt, clockOffsetMs, refused?} is
emitted on every change, with last-value replay. `reopened` is an EDGE: it is
true on exactly one payload, the one a socket's open sends after an earlier
socket had been open, and the next payload carries false — a slow probe
answered on the same socket is a plain `open`, never a reopen. `mesh:rejected`
{id, kind, reason, d?} reports a final refusal; `d` names the replaceable slot
so the swarm forgets it had sent it.

| State | Meaning |
|---|---|
| `connecting` | a socket is opening |
| `open` | a socket is open and answering |
| `stalled` | a probe went unanswered for 1.5 s; past its deadline a replacement dials while this socket keeps its place |
| `retrying` | no open socket; the reconnect ladder is running. After 30 s the line says "Can't reach jwize.com" |
| `offline` | nothing is being dialled: this tab has not joined, or it has no relay |

### Detection

- A watchdog ticks every 1 s while the tab is visible and every 5 s while it is
  hidden.
- After 10 s with no inbound frame it sends one probe:
  `['REQ', 'hc-live', {'#x': ['hc:live'], limit: 0}]`. The subscription id is
  always the same, so the probe replaces itself. The relay answers EOSE at once
  without scanning.
- No inbound frame within 4 s of the probe: the socket is suspect. MAKE
  BEFORE BREAK: a replacement dials (at the ladder's next step) while the
  suspect keeps its place. The replacement's open retires the suspect; any
  frame on the suspect first drops the replacement — a live socket whose
  probe sat behind our own uploads on a slow uplink is never torn down. A
  suspect still silent 12 s past its deadline is retired regardless.
- An EVENT unacked for 5 s, with nothing heard since, triggers a probe. It
  never kills the socket outright.
- Nothing is judged while bytes queued on the device are still draining
  (`bufferedAmount` going down), or on a tick that runs more than 1 s late. A
  buffer that has not gone down for 15 s is a dead path and is judged as
  usual.
- `online`, `pageshow` and the tab becoming visible: probe with a 3 s deadline
  if a socket is open; otherwise connect now.

### Reconnect

- The ladder is 0, 250 ms, 500 ms, 1 s, 2 s, 4 s, with 0-30% jitter. The cap is
  4 s while visible and 15 s while hidden. It resets once a socket proves
  itself — answers a probe, or stays open 30 s — and on online and visible;
  never on a bare open, so a path that opens and then goes silent climbs the
  ladder instead of redialling at once forever.
- The connect timeout is 8 s, then 12 s, then 20 s. A slow phone handshake gets
  more time, not less.
- A retired socket's handlers are cut before it closes, so a stale close can
  never delete the live socket.
- On open, in order: the REQs for every bucket (the same 900 s window), then
  unacked and queued frames, then the beacon, then the current page, then the
  visited pages spread over 0-5 s.
- Refused events are sent again. `rate-limited:` is retried after 1, 2, 4, 8
  and 15 s, at most 5 times, unless a newer event replaced it. A refused
  subscription retries after 1 s·2ⁿ, capped at 30 s.

### Liveness numbers

| What | Time |
|---|---|
| Detection, idle | 15 s or less |
| Detection, after a publish | 9 s or less |
| Detection, after wake or the network returning | 3 s or less |
| Reconnect after the network returns | 0-4 s plus the handshake |
| Reassert after open | 1 round trip |
| Recovery from a relay restart | 5 s or less |
| Will grace | 15 s |
| Probe cost | 6 frames a minute or fewer, idle only |

A hidden tab probes after 30 s of silence and caps its back-off at 15 s.

Nothing here is awaited on connect, join, resubscribe or receive. The only new
frames are the relay's one NOTICE and the idle-only probes.

## Soft wills

- The relay holds a disconnected key's last will for 15 s. An `{alive}` or
  `{left}` for the same slot cancels it, and so does any verified EVENT on a
  connection that has itself beaconed that slot. A reopened socket's first word
  is its beacon, so a reload, a blip or a network change never tombstones.
- A will belongs to the connections that beaconed the slot, not to every
  connection the key has spoken on. Another open connection that beaconed it
  (a second joined tab) inherits the will. A same-key tab that never joined
  neither inherits nor cancels it, so closing the joined tab still marks it
  away after 15 s.
- A tombstone the relay made (empty `sig`) marks the peer **away**. The roster
  shows them hollow, and their tiles stay.
- Each tile lives until its own expiration tag plus 30 s, which is the 90 s
  relay slot. Every receiver sees the same, late joiners included. The tag is
  the publisher's word, so it is never trusted past created_at + 90 s, nor
  past 90 s from the moment it was heard.
- Only a signed `{left: true}` removes tiles at once. There is no leave on
  pagehide.
- LEAVE FIRST, THEN THE NETWORK. The shells only announce the leave
  (`mesh:public-changed` {public: false}); the swarm hands its signed `{left}`
  to the socket and only then turns the mesh off. A frame queued for a socket
  that never opened is dropped with the network, never carried into the next
  join. After a leave nothing more is announced into the room: no receipt
  re-walk, no props republish, no hide refresh.
- A sweep that runs more than twice late is skipped, and sweeping waits 15 s
  after a tab becomes visible again, so a waking phone never wipes the room.
- Away peers are kept for their 90 s slot, not longer (decided 2026-10-04).
  The relay is a meeting point, not a store.

## The relay's clock and budgets

- The relay's first frame on connect is
  `['NOTICE', 'hc:host {"v":1,"time":<unix seconds>,"participants":"all"}']`
  (`participants` is `"all"`, `"zones"` or `false`). It costs no extra round
  trip, and old clients ignore it.
- The client corrects its clock when the offset is more than 2 s. `now()` and
  `nowSec()` give relay time. `created_at` only rises per slot (the larger of
  now and the last value plus 1), so a same-second update is never dropped.
  NIP-98 uses relay time too. Freshness checks allow 30 s.
- Rate: per connection, a burst of 400 and a refill of 10 a second. Per IP, a
  burst of 12000 and a refill of 200 a second, keyed on `CF-Connecting-IP`.
  CLOSE and AUTH are never charged. Twenty phones on one venue IP use about a
  quarter of the IP ceiling.
- The relay prints one counts-only line a minute when anything happened: open
  connections, refused EVENTs and REQs, wills fired and cancelled, participant
  PUTs and bytes, and alive participants per zone (a 6-hex prefix). No IPs, no
  keys.

## The meeting link

`https://hypercomb.io/#meet=<room>/<secret>/<page>/...`

- The facilitator makes it: joined, nothing selected, type `/invite`, or tap
  Invite on the status line. The link is copied. With a selection, `invite`
  still makes the bundle link as before.
- The page segments are the ones the swarm actually hashes, so a pinned Home
  cannot split the room.
- The fragment never reaches a server. The shell moves it into
  `sessionStorage['hc:pending-meet']` and strips it from the address bar.
- Opening it shows one sheet: "Join the room 'meetup'? You'll see everyone
  here. Tiles you add while joined are shared with the room and kept by
  jwize.com." [Join] [Not now].
- Join sets the exact room and secret, goes to the page, switches the command
  line to tiles (so a typed name never becomes a command), and connects.
- The link carries the secret. Anyone holding it can join and upload within
  the caps. Post it where the room is, and nowhere else.
- The room words come from the room and secret only, not the page. Everyone in
  a room sees the same two words on any page. Compare them out loud.

Typed fallback: the swarm control, then the room and secret, then Start. The
fields no longer autocapitalize or autocorrect. Room names are not
case-folded, so `Meetup` and `meetup` are two rooms.

## Meeting runbook

### The day before

- No `publish:revision` stamps, no worker deploys and no relay restarts within
  24 h of the meeting. A stamp puts the Update pill on every hive mid-meeting.
  A restart empties the relay's memory; clients recover in seconds, but do not
  spend that on meeting day.
- The relay host:
  - Use Ethernet, not Wi-Fi. On 2026-10-04 a Wi-Fi re-key dropped the tunnel
    for 4-8 s.
  - Do not shut it down the night before. It was powered off from the Start
    menu most nights.
  - In an elevated prompt, turn off sleep and hibernate on mains power:

    ```powershell
    powercfg /change standby-timeout-ac 0
    powercfg /change hibernate-timeout-ac 0
    ```

  - Pause Windows Update (Settings ▸ Windows Update ▸ Pause updates), so it
    does not restart the machine during the meeting.
  - If it must use Wi-Fi: Device Manager ▸ the adapter ▸ Power Management ▸
    untick "Allow the computer to turn off this device to save power".
  - Both services start on boot: `hypercomb-relay` and `cloudflared`. After an
    unplanned reboot clients reconnect by themselves, and the bytes are on
    disk.

### One hour before

From `src/`, run `node scripts/swarm-preflight.cjs`. It touches only a
throwaway key and zone, and stores one 16-byte atom. It checks that:

1. NIP-11 shows `participant_uploads: "all"`;
2. the `hc:host` card is the first frame, and its time is close to the local
   clock;
3. a beacon followed by a PUT gets `201 stored <sig>`;
4. an unsigned PUT gets 401;
5. a PUT at `sign('hive:indexes')` gets 409;
6. the head of the hypercomb.com apex `sign('host:packages')` pool equals the
   stamped `install:essentials` root.

If it fails:

| Check | Likely cause | Do |
|---|---|---|
| no answer at all | the relay or the tunnel is down | `Get-Service hypercomb-relay, cloudflared`; restart with `hypercomb-relay/fix-relay-elevated.ps1` or `hypercomb-relay/restart-tunnel.bat` |
| 1 shows `false` | the flag is missing | add `--allow-participants` ([hosting-from-a-machine.md](hosting-from-a-machine.md)) and restart |
| 2, time far off | the host's clock is wrong | set the host's time automatically |
| 6 | the apex is stale | fresh installs will run an older package; they tap Update at the door |

### Ten minutes before (the facilitator)

1. Open hypercomb.io. Tap the swarm control, type the room and secret (for
   example `meetup` / `4417`) and press Start.
2. Make a page for the meeting and walk into it. A fresh name is empty in
   everyone's hive, so nobody's seeded tiles collide there.
3. Type `/invite`. Paste the link in the group chat and show it on screen.
   Type `>` to go back to making tiles.
4. The line reads "Live · meetup · {words} — you're the first one here ·
   Invite".

### At the door

- Tap the link. A first visit installs as usual.
- If the Update pill shows, tap it. It reloads, and you stay joined in the
  same room.
- Press Join. Compare the two words out loud.
- "{n} people need to tap Update to share" counts peers whose beacon is older
  than this design. Ask them to tap Update.

### During

- Create: type a name and press Enter. Others see the name in under a second,
  and the picture about a second later.
- Take a peer's tile with the wand gesture (ctrl/⌘ + press). Its bytes come
  from jwize.com, so this works after the author has left.
- Tiles you had before the meeting stay private. "Share" on the status line
  offers the ones on this page, tile by tile, after one confirmation; their
  contents stay private. The globe on your own tiles does the same for one
  tile.
- Wifi drop, phone lock, app switch or reload: nothing to press.

### After

Nothing to delete. The relay keeps the bytes, and its events expire by
themselves.

## What each status line means

The English wording is shown; the catalogs in `hypercomb-shared/i18n/` hold
the exact text in every language.

| Line | Meaning | Do |
|---|---|---|
| Live · {room} · {words} · {n} in the room ({m} here) | connected. Badges: solid here, dim elsewhere, hollow away | nothing |
| Live · {room} · {words} — you're the first one here · Invite | nobody else is in the room yet | share the link |
| Connecting to {host}… | the first connect after a join | wait |
| Reconnecting… your tiles are safe | `stalled` or `retrying` after having been open; peers still see your tiles | wait |
| Can't reach jwize.com — check wifi or switch to mobile data. Still trying. | no socket for 30 s | change network; a captive portal may be blocking it |
| Sharing {n} | every public tile here is hosted | nothing |
| Sharing {n} · {k} uploading | {k} tiles are name-only while their bytes move | wait |
| jwize.com isn't taking uploads from guests — others see your tile names only | 403: the relay does not allow participants | the host adds the flag |
| jwize.com is full — others see your tile names only | 429 or 507 | the host frees disk; per-key and per-IP caps reset within 24 h |
| A picture is too large for jwize.com | 413: over 8 MB | use a smaller picture |
| {k} tiles include content this device doesn't hold | taken content that is neither here nor on the host | nothing; those tiles stay name-only |
| {k} of your tiles here are private · Share | tiles from before the meeting | tap Share to offer them |
| Your device clock is far off — set it automatically | the relay refused the clock | turn on automatic time |
| {n} people need to tap Update to share | peers on an older package | tell them |
| Only {name}'s tiles · Show everyone | a badge was tapped, so the canvas is filtered | tap Show everyone |
| "{text}" isn't a command — say "create {text}" to add it as a tile, or type > on an empty line to make tiles | a command line with no action; the text is kept | type `create {text}`, or `>` alone on the line |

## Rolling it out

Order: relay, then shell, then the essentials stamp, then apex staging.

1. **Relay**, at least 24 h before a meeting: add `--allow-participants`
   ([hosting-from-a-machine.md](hosting-from-a-machine.md)), restart cleanly,
   check NIP-11, run the preflight.
2. **Shell**: the LIVE workflow deploys hypercomb.io from main. It tolerates
   old essentials: the status line falls back until it sees `mesh:connection`.
3. **Essentials**: `npm run publish:revision -- essentials` from a clean
   worktree ([publishing-a-revision.md](publishing-a-revision.md)). Confirm the
   stamp was written.
4. **Apex**: `node scripts/presentation/deploy-azure.cjs`, then the preflight's
   check 6.

The relay goes first. Essentials without it would get 401 on every upload:
names only, which is honest but not shared.

Rollback:

- Relay: remove the flag and restart. Clients fall back to names only, with
  "isn't taking uploads".
- Essentials: re-stamp the previous package, then re-stage the apex.
- Shell: revert on main.

## Related

- [resource-offload-relays.md](resource-offload-relays.md) — the availability
  gate and the 2026-09-25 rule this amends
- [deployment-stages.md](deployment-stages.md) — stages, and `publish here`
- [consent-hosting.md](consent-hosting.md) — hosting outside a meeting
- [hosting-from-a-machine.md](hosting-from-a-machine.md) — the NSSM line and
  the NIP-11 check
- [swarm-participant-filter.md](swarm-participant-filter.md) — what tapping a
  badge does
- [network-architecture.md](network-architecture.md) — participants, hosts and
  content flow
