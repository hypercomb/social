# A room is its host, its room and its secret

**Status: BUILT 2026-10-12; AMENDED 2026-10-11 (the owner's rules, which
supersede the 2026-10-12 round where they differ).** Owner decisions (jwize):

1. 2026-10-12: "hash or however we do it (host+location+secret) gen keywords
   from those".
2. 2026-10-12: "the only place the host comes from is the field we attached
   to … hosts are added to our portal for replication".
3. 2026-10-11: "the host needs to be part of the name generation so they meet
   at the same location and server".
4. 2026-10-11: "The domain on the other hand should not be used (current
   address in the browser)".
5. 2026-10-11: "Let's just make sure that there isn't a default host" — "all
   the user should have to do is put the host name in when entering a swarm,
   end of story"; "hypercomb.com should be available but not filled by
   default for new installs".

What was seen (2026-10-11): a `localhost:4250` tab met at `ws://localhost:7777`
(that page's old default) and read "faint dew"; a `hypercomb.io` tab on an
older package met at `wss://jwize.com` (that package's default) and read
"faded lynx". Both names reach one relay (a home PC), so the tabs met — "2 in
the room" — under two different pairs, and both status crumbs showed the
PAGE's domain ("public · localhost", "public · hypercomb.io") where people
looked for the meeting place.

## The invariant

**Same words ⇔ same host + room + secret ⇔ they meet. Different words ⇒ they
never meet.** Two names for one physical relay (`localhost:7777` and the
`jwize.com` tunnel to it, `localhost` and `127.0.0.1`, a host and its `www.`)
are two rooms, on purpose: nothing tells them apart but the name, so the name
is the room. Give everyone one URL.

## The rule

A swarm room is three things: the **host** the tab meets at (the relay it
dials — its "meeting point"), the **room** (the "location" — never the page
path) and the **secret**. Every address the swarm derives from the room, and
the room's two comparison words, come from ONE preimage tail
(`hypercomb-core/src/core/zone-text.ts`):

```
roomPreimage(room, secret, host)      = room \0 secret \0 meetingPointKey(host)   — '' with no host
lifecyclePreimage(room, secret, host) = lifecycle \0 roomPreimage(…)              — '' with no host
```

`meetingPointKey` is the host's lowercase `host[:port]` — `wss://HyperComb.com/`
and `hypercomb.com` are `hypercomb.com`, `ws://localhost:7777` is
`localhost:7777`. **An empty field, or one that is no address, is `''`: there is
no default host, so there is no room** — no address is derived, no words are
drawn, nothing is subscribed to or said at a room address. Every caller reads
`''` as "not in a room yet".

| Address | Preimage | Derived at |
|---|---|---|
| lifecycle roster (kind 30206) | `lifecycle \0 room \0 secret \0 host` | swarm.drone `#computeLifecycleSig` |
| a page's channel (kind 30200) | `lineageKey(segments) \0 room \0 secret \0 host` | swarm.drone `#signRoom` (sync, `composeSigForSegments`, the publish walk, the retract walk) |
| a member's personal / request / presence channels | `channel:<pubkey> \0 …`, `request:<pubkey> \0 …`, `presence:<pubkey> \0 …` | swarm.drone `#signRoom` |
| the room's ask channel (content broker) | `broker:fetch \0 room \0 secret \0 host` | content-broker.boot.drone `#roomAskChannel` |
| the room's client roster (client-presence, kind 30207) | `hc:clients \0 room \0 secret \0 host` | client-presence.drone `channel()` |
| lent models (peer-models: offer / request / reply) | `peer-models: \0 …`, `peer-model-request:<pubkey> \0 …`, `peer-model-reply:<pubkey> \0 …` | peer-models.drone `#channel` |
| the `{alive}` beacon carried on an upload (D7) | its `x` is the lifecycle address above — the host the room MEETS at, never the upload host's | host-sync asks `SwarmDrone.lifecycleSig()` |
| the "share tiles from before" ask memory (device-local) | `share-ask \0 room \0 secret \0 host \0 page` | share-ask.worker `#digest` |
| **the two words** | `secretTag(lifecyclePreimage(room, secret, host), 'en')` | presence-status `roomWords` (shell); use-live-relay toast (package) |

Each of them is re-derived when the room, the secret or the host moves. The
host every one of them reads is the mesh's `swarmHost()` — nothing else.

**The two words** are the readable form of the room's address — the English
list in every language, the reader's own pair beside it. Everyone in a room
reads one pair wherever they stand; the same room text at another host reads
another pair, because it is another room.

## The page's own domain is never used

The page a tab is on — `hypercomb.io`, `localhost:4250`, a published site —
is not part of any address, any pair, the choice of host, or what is shown
beside the words. Removed 2026-10-11:

- **The point picked by the page** (nostr-mesh `#meetingRelay`). It used to
  pass a loopback relay over on a real host (and only there) for a reachable
  one beside it, and to name the page's own list's relay when a joined tab's
  point was one this page may not dial. Now the point is the one the zone
  names while joined, else the first relay of the tab's own list — the same
  answer on every page. Whether THIS page may dial it is a separate answer:
  a loopback point a real host may not dial is still the point, refused
  `'unreachable'`, and the tab meets nowhere and says so — never at another
  relay under another room's name.
- **The relay appended because the page is real** (nostr-mesh `loadRelays`,
  the stale-dev-list guard). A loopback-only list on a real host used to get
  `wss://hypercomb.com` appended — a relay chosen from the page's domain. A
  list someone wrote is dialled as written, on every page.
- **The point pinned because the page is local** (mesh-session's
  `hc:mesh-point-crossing`). A resumed loopback tab was pinned to
  `ws://localhost:7777`, the dev relay an older mesh SEEDED there — a seed
  recorded as a choice, chosen by the page's domain. A tab's point is only
  what someone named: the selector, a meeting link, a server given to
  `/use-live-relay`, a relay list.
- **The selector's page check** (mesh-modal `ownMeetingPoint`). It mirrored the
  mesh's page-dependent pass-over; it reads the list as the mesh does now.
- **The room from the page's subdomain** (room-store `extractSubdomain`). A
  `<room>.hypercomb.io` subdomain used to pre-fill the room — the address bar
  deciding part of a room's identity. The room is only what someone typed or
  a link carried.
- **The page's domain beside the words.** The breadcrumb's root reads as home
  while the tab is in a swarm ("public · hypercomb.io" read as where the room
  met); while private it is still the page's own address, which is what it
  is there.

What still reads the page's domain, and why it is not the room: the mesh's
DIAL gate (`isLocalContext`, `#relayAllowed` — a real host never dials a
visitor's own machine unless the list was written to), the meeting link's
door URL (the page a guest opens; the room rides in the fragment), and the
upload/replication side (advertised hosts, the self-domain, the host
directory) — out of this rule's reach, pending its own decision.

## The host beside the words

Wherever the words show, the host they were drawn at shows beside them —
`wordsAtHost(words, host)` in presence-status: **"marble cove ·
hypercomb.com"**. The presence line, the breadcrumb, the selector's preview and
the `/use-live-relay` toast (`use-live-relay.joined-at`, all 14 catalogs) all
say it. Two tabs that named two hosts see two different hosts at once, even
before anyone compares words.

## Where the host comes from

Only from the field the tab attached to — the relay it actually dials
(`NostrMeshDrone.swarmHost()` / `meetingRelay()`):

- a joined tab's own meeting point (`hc:mesh-zone.relay` — the selector's
  host field, a meeting link's `&relay=`, `/use-live-relay … ws(s)://…`), read
  at once, before the mesh has moved its list;
- else the first relay of the page's own list (`hc:nostrmesh:relays` when one
  was written).

- else nothing: **there is no default host** (2026-10-11, landed). Nothing
  is seeded on any page (`loadRelays`), so a new install dials NOTHING until
  its participant names a host.

### No default host — the host field is the door

- **A new install** shows an EMPTY host field ("host you meet at") with
  **hypercomb.com offered** beside it as a chip: one tap fills it, nothing
  fills it for you. START (and the share button) refuse an empty field —
  the field says a host is needed and takes the focus. The field pre-fills
  only from what this participant chose: this tab's own point, else the
  point of the last meeting on this device (`mesh:meet-point`, never its
  code), else the relay their own list names as chosen. A zone that names
  no point names no host, so the remembered point is offered even to a tab
  with a room of its own (every door that opens the field for a missing
  host writes the room first).
- **Entering a swarm without a host** — the swarm control, the `join` word
  or the keymap toggle (runtime-initializer `tabHasHost`), a bare
  `/use-live-relay`, a meeting link or tile invite that names no host —
  opens the selector on its host field (`focus: 'point'`), the room and
  secret already in where a link or a typed word gave them. A hostless link
  first asks on its sheet (`invite.meet.join.message-no-host`) and then
  opens the selector; a tab that already meets at a host keeps it for the
  link's room (the host is the participant's choice; a room is not).
- **A join whose host is the page's own list** (the `join` word, the keymap
  toggle, with no point in the tab's zone) PINS that relay into the tab's
  zone before the join is announced (runtime-initializer `pinListedHost`),
  as the selector, a link and `/use-live-relay` already do — so a reload
  resumes at the host it joined at, never at whatever another tab's
  `/domain` has made the origin-wide list since. Same relay, same words.
- **A host let go is gone**: a not-joined tab's selector (or
  `/use-live-relay <server>`) points the mesh at the host it names before
  the join; when the zone stops naming any point (an emptied host field,
  `/use-live-relay clear`) the mesh puts the page's own list back
  (`#syncZone`), so the next join never dials a host the person removed.
  `clear` says where the tab meets now — the host its own list names, by
  name, or nowhere.
- **A joined tab with no host** (one resumed from an older package that met
  at its seeded default) meets nowhere and says so at once: the mesh
  refuses `no-host`, the presence line reads "No host named — this tab
  meets nowhere yet" with a "Name the host" button that opens the host
  field, and the header glyph is down. It meets the moment a host is named.
- **A host named before is remembered and warmed exactly as today**: a
  joined tab's point rides its zone, so a reload dials it at boot, first
  flight, with its code; a new tab's field is pre-filled with the last
  meeting's point — one tap on START. No round trip was added anywhere.
- `/use-live-relay` with no server meets at the host this tab already meets
  at (whatever room it names), else the relay its own list names (made the
  tab's point), else opens the selector on the host field — it no longer
  forces the shipped relay ('hc:nostrmesh:use-live-relay'='1' picks no relay
  now: the runtime writes that flag as a one-time seed on every deployed
  origin, so it can never be told from a person's; it steers only the byte
  mirrors).

### What an older package stored is read as seed or choice (R4)

From the git history of `hc:nostrmesh:relays` (the only durable relay
record before the zone): two code paths ever stored a package's OWN default
there —

1. 2026-02-26 → 03-19, the mesh wrote its hard relay at every boot
   (`forceHardRelay`): exactly `['wss://nos.lol']`, later
   `['wss://relay.snort.social']`;
2. 2026-04-03 → today, `/domain <url>` saves `[...the list it was dialling,
   url]` — with nothing saved, that list WAS the seed, so the saved list
   begins with the package's default (the dev relay `ws://localhost:7777` on
   a loopback page; on a real host the live relay — the home machine until
   2026-10-11, hypercomb.com since — or the live relay the retired
   stale-dev-list guard appended to a loopback list) and ends with what was
   typed.

Every other writer stored only what a person typed (`/use-live-relay
<server>`, 2026-08-20 → 10-09: exactly `[server]`), and no shipped package
ever wrote a default into a tab's zone or the `mesh:meet-point` pre-fill (the
loopback "point crossing" and the selector's hypercomb.com hold existed only
in the unshipped round-two branch). Every later `/domain` only APPENDED, so a
seed is only ever at the HEAD of a list an older package wrote. The mesh
reads such a list as chosen (`chosenRelays`, nostr-mesh):

- a single-entry boot write (nos.lol, relay.snort.social) is the seed;
- in a longer list, its FIRST entry when it is one of those defaults, and
  the live default sitting right after a leading loopback run (the retired
  guard's shape) — both only when more entries follow;
- nothing after a typed entry, and never the last entry: `[jwize.com,
  hypercomb.com, y]` reads `[hypercomb.com, y]`, and `[x, hypercomb.com, y]`
  is kept whole.

A default typed alone (`/use-live-relay wss://hypercomb.com`, a list left as
one entry) is theirs and kept — the shapes cannot be told apart, and a
person's word wins. Nothing stored is ever rewritten or deleted for this.

**This package seeds nothing, so a list it saves is the person's whole**:
`saveRelays` writes it behind the mark `hc:chosen` (`CHOSEN_MARK`) at the
same single write site, and a marked list is read back untouched — typing
`/domain wss://hypercomb.com` and then `/domain wss://other.example` keeps
both, and the meeting point (hypercomb.com, the first) is the same before
and after a reload. The mark is not a ws(s) URL, so every reader of the list
— this package's and every older one's, which has always kept only ws(s)
entries — passes over it. The only place a recognised seed leaves storage
is the participant's own `/domain` edit of an unmarked legacy list, which
saves the list as they now read it (marked).

**Replication hosts are never part of a room**: the hosts pool
(`community:hosts`), a branch's publish domains, the upload host and your own
host (`hc:nostrmesh:self-domain`) keep bytes; they do not decide who meets.
The selector shows only what defines a meeting — **host, room, secret**, and
the **access code** only when a host other than the open hypercomb.com is
typed (or a code is held, or the opener asks for it); the code is always
masked. Your own host lives in the host directory (the hosts window).

## The host moves, the room moves

A tab whose host changes while its room and secret stay — the selector,
`use-live-relay <room> <secret> wss://…`, a relay list changed under it — is
in another room. The swarm (`#onMeetingPointMoved`) tears the old room down
and meets at the new host's addresses; the content broker moves its ask
channel (on `mesh:zone`, and on `mesh:connection` for a list that moved with
no announcement — a tab that only serves follows too); client-presence and
peer-models re-derive. A host that goes away (no host any more) leaves the
room: nothing is derived until one is named again. Nothing is asked and
nothing is waited on: the host is read synchronously, and the move is the
same teardown-and-resync a room change always was. The selector writes the
host BEFORE the room and the secret, so the swarm's first address after the
move is already at the new host.

**No `{left}` is carried to another host.** By the time the swarm tears the
old room down the mesh's list has already moved, so a tombstone would go to
the NEW relay: the old room would never hear it, and that relay's operator
would be handed the old room's roster address without its secret. So a move
to another host says nothing; the old socket drains and closes, and the old
room hears the meeting point's will after its 15 s grace. A room or secret
change at the SAME host still says `{left}` there at once.

## Old and new versions do not meet

Every room has a new address since 2026-10-12. A package from before then
hashes `lifecycle \0 room \0 secret` (and its page channels without the
host), so it and a current package typing the same room and secret **at the
same host** are in **two rooms** — their words differ, they cannot see each
other, and a current tab cannot even tell an older one is there (it beacons
on an address the current one never hears). **Update to meet:** everyone in a
meeting updates before the guests arrive. A relay started with
`--allow-participants=<lifecycleSig>,…` needs the new sigs, at the host the
room meets at (`scripts/swarm-preflight.cjs` prints the current derivation
for the relay it is pointed at).

**The words follow the package.** The shell and the package update apart (a
shell deploy reaches every web profile on reload; a package only when its
participant presses Update), so the shell draws the words the way the LOADED
package addresses the room: `SwarmDrone.roomIdentity` (2) is read in-page,
synchronously (`presence-status loadedRoomIdentity`), and a package without
it gets the pre-2026-10-12 pair (`lifecycle \0 room \0 secret`, the host
folded in only off hypercomb.com — D4). Two tabs whose pairs differ are in two
rooms, whatever their shells are.

The core helpers are exports (`meetingPointKey`, `roomPreimage`,
`lifecyclePreimage`, `SHIPPED_MEETING_POINT`): a package that uses them needs
a shell whose core has them — the core-surface gate refuses the install by
name otherwise. Ship the shell with the package. Their behaviour for an empty
host changed on 2026-10-11 (`''`, never the hypercomb.com default); a package
built against the round-two core read an empty field as hypercomb.com.

## What did not change, and what did

- The meeting link (`#meet=room/secret/page&relay=…&code=…`) now carries the
  host ALWAYS (hypercomb.com included) — the tab's own point, or the point its
  own list meets at, never a loopback one — so a guest joins the room the
  facilitator is in, whatever their own package would pick.
- A tile-borne invite bundle's `secretCheck`
  (`sha256('hypercomb:invite' \0 room \0 secret)`) is a check on the secret,
  never an address, and the bundle names no host.
- `hc:current-zone` (the swarm's local per-zone scope key for hide lists) is a
  device-local key, not an address.

## Case never splits a room (2026-10-12)

jwize: "case ignore or it would be confusing" and "It has to be deterministic
for everyone". A room's location and secret enter its preimage as
`roomText` (core `zone-text.ts`): the canonical entry text, case-folded with
core's locale-independent `fold` (never `toLocaleLowerCase`). `MyNewRoom` and
`mynewroom` are one room; `DownTown`/`DOWNTOWN` at `wss://HyperComb.com/` read
the same words as `downtown`/`downtown` at `hypercomb.com` ("marble cove").
Location and secret are not pools of meaning: punctuation is kept. The
golden vectors in `zone-text.spec.ts` are frozen — changing one is a protocol
change that splits every room.
