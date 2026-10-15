# The swarm's host

**Status: DESIGNED 2026-10-04, building on `swarm-bulletproof`; WHICH HOST
amended 2026-10-07; the LONG TAIL amended 2026-10-10; the OPEN DEFAULT
(`wss://hypercomb.com`, "The always-online meeting point") amended
2026-10-11.** Owner decisions
(jwize, 2026-10-04): a swarm's host allows participants by default;
connection and reconnect speed are never traded for anything else; the
tightest setup wins. And (jwize, 2026-10-07): "I thought we only use pools
but maybe if publish domains take precedence over pools that would be fine
too … but sure on your relay." And (jwize, 2026-10-10, "make it so it never
breaks", then "go with the recommendations"): TILE FIRST (D1), a dead
publish domain never holds the room (D2), the large copy of a photo is a
WebP (D3), the two words name the meeting point (D4), a tab with no meeting
of its own asks (D5), room text is canonical (D6), a beacon carried on the
upload is liveness (D7), the always-online point's deploy waits for its
eviction and door fixes (D8), publish and shell deploy before coded links
are handed out (D9), two tabs of one hive both keep writing (D10). And
(jwize, 2026-10-12): a room is its meeting point + room + secret — every
room address and its two words name the point. And (jwize, 2026-10-11, which
supersedes the 2026-10-12 round where they differ): the page's own domain is
never used — not in an address, not in the words, not to pick the host, not
beside the words; there is no default host (no host, no room — a new
install dials nothing until its participant names one; hypercomb.com is
offered in the selector, one tap, never filled; a host named before is
remembered and dialled at boot as ever); and the host is shown beside the
words ("marble cove · hypercomb.com") (`swarm-room-identity.md`). And (jwize, 2026-10-11, THE LIVE SWARM): "we
can't give hosting away for free"; "Let's just make sure that there isn't a
default host"; "The swarm is different than the public publish because tiles
go away when the people leave"; "Then we can share the host with our
friends" — with no host, or a host that refuses you, your tiles go out whole
from your own device while you are in the room.

Joining is enough to share, and a host is optional. With a host that takes
your bytes (a branch's publish domain, or the host you entered as the
meeting point), a tile's name reaches the room at once and its bytes follow
as soon as the host serves them — and stay after you leave. With none, or
one that refuses you, the tile goes out WHOLE at once — takeable, its
picture included — served from this device while you are here, and it
leaves the room's grid when you leave (a peer who took it keeps it).
Nothing you shared disappears because you edited it, reloaded, or the
upload is slow.

## The rule

- **Your hosts host the meeting, per page.** The tiles a joined tab offers on
  a page are uploaded, in this order, to:
  1. **the page's publish domains** — the `host:<zone>` marks worn by the
     nearest branch at or above the page, every one of them, primary first:
     the same write doors a publish of that branch uses;
  2. **the host field** (jwize, 2026-10-11) — the meeting point you entered
     (a link joined, the selector, your page's own list): the host of the
     relay this tab meets at, the mesh's `swarmHost()`. "All the user should
     have to do is put the host name in when entering a swarm, end of story";
     "the source of truth is the host field". Its `hc:host` card decides
     nothing: the host is asked, and its own answer decides — a host that
     keeps bytes only for its people (`HOST_FRIENDS`) refuses a stranger with
     its 403, and is passed over like any door (D2, below). A link's own
     `&host=` (`hc:mesh-zone.host`) is legacy and decides nothing;
  3. **nowhere** — no publish domain and no host field: no host.

  THERE IS NO DEFAULT HOST ("we can't give hosting away for free"; "Let's
  just make sure that there isn't a default host"). Nothing seeds your hosts
  pool, and the pool — the hosts you READ from — never picks where your bytes
  go. An install an older package seeded keeps that member, inert for
  writes: no member is removed and no key cleared. `hypercomb.com` stays a
  READ source (`DEFAULT_HOST_ZONES`, the update scout, example hives) and may
  be retired; nothing writes there by default. THIS TAB remembers a door
  passed over across a reload (an hour at most) only on positive evidence:
  the host's own 401/403.

  **A dead door never holds the room (D2, 2026-10-10).** A publish domain or
  the meeting host is passed over for the swarm once ITS OWN UPLOADS give a
  standing answer — it refuses (its 4xx, a CORS-blocked upload, or not-live
  past five retries while this tab meets elsewhere), it is full, or it never
  answered three uploads while the socket was open and another host answered
  (the `hyperccomb.com` typo). A web page at the door is not enough: the
  uploads decide. The page then goes by the next door down — the host
  field, else none — and the status line NAMES the passed-over domain
  (`passedOver`, on the branch's own page and on the page that offers the
  branch): "hyperccomb.com passed over — it isn't taking uploads". When no
  door below takes bytes either, the chosen door keeps the page, and the line
  and the branch's publish row name the branch, the host and why — "favorites:
  hyperccomb.com can't be reached — check the host name, and that the host is
  running" — rather than the branch reading as uploading for ever. `publish
  here` still needs the domain itself: publish nodes are never passed over.
- **A tile goes where its page goes; a branch's subtree goes where ITS pages
  go.** A tile offered on a page is uploaded to that page's hosts, and its
  children to the hosts of the page one step down, and so on. So a branch that
  wears its own publish domains keeps its subtree on them even when it is
  shared from the hive root: only the branch tile itself goes to the root
  page's host.
- **Where a host keeps the page, hosting stays the truth — for the tile
  itself.** No tile is announced takeable until its OWN atoms (its layer,
  properties, picture, notes, decorations and meta envelopes) are on its
  page's host. TILE FIRST (D1): a big branch is takeable as soon as its own
  atoms are there; its deeper pages keep uploading, and until they all are,
  its entry says `deep: 'owner'` — they are served from the sharer's device
  while the sharer is in the room — then `deep: 'hosted'`. Receivers are told
  ("Deeper pages open from Ana's device while they're here"). An atom of the
  tile's own that no host will ever take for its SIZE (a 9 MB picture
  answered 413) keeps the tile a name: no host and no broker answer (8 MB
  cap) could carry it.
- **Names before bytes — while a host is taking them.** Until a tile's host
  serves it, its name goes out without signatures. Peers see a label tile
  they cannot take yet.
- **THE LIVE SWARM: no host, or one that refuses you (jwize, 2026-10-11).**
  When the page names no host at all (no publish domain, no host field) — or
  every host it goes to gave a STANDING answer for the tile (it refused this
  key, is full, or never answered: host-sync's `ownerHeld`) — a public tile
  with a handle goes out FULL at once, marked `served: 'owner'` (and `deep:
  'owner'` for a takeable branch): this device serves it, through the content
  broker, while it is in the room. A page with no host asks host-sync
  nothing, and nothing is copied into the push queue while no host could
  take it. The tile
  leaves every peer's grid when you leave (a signed leave at once; a dead
  tab's slot within about two minutes), exactly like any tile. A peer who
  TOOK it keeps it: its pictures are fetched through the broker at the take,
  while you are still here. `publish` still needs a host — a publication
  must outlive you.
- **Never retract.** A shared name leaves the room only when you delete it,
  move it away, make it private, leave, or go silent past your 90 s slot.
- **Membership is per tab.** Only the tab you joined in shares. A second tab
  cannot silence it.
- **The socket says what it is.** A dead connection is found within seconds
  and replaced, and the status line shows the real state.

## What this amends

- **The meeting point hosts the meeting (2026-10-04)** — this document's own
  first rule. The relay a joined tab dialled was also where it uploaded
  (`wss://jwize.com` meant `https://jwize.com/<sig>`). 2026-10-07 put
  publish domains and a hosts pool ahead of it; 2026-10-11 removed the pool
  and the relay's card: publish domains, then the host field (the meeting
  point you entered), then none — live. Everything else that rule brought
  stays — names before bytes while a host takes them, never retract,
  receipts per host, honest reasons, the 4-wide drain, per-host back-off.
- **Sharing requires hosting (jwize, 2026-09-25)** —
  [resource-offload-relays.md](resource-offload-relays.md), "Availability
  gate". For the SWARM it no longer does (2026-10-11): with no host, or one
  that refuses you, the room gets your tiles whole from your device while
  you are here (the live swarm). Where a host does take the page, the gate
  stands: no signature is announced that its host does not serve yet.
  PUBLISHING still requires hosting.
- **Join offers what your host serves (2026-09-25)** —
  [deployment-stages.md](deployment-stages.md). Joining now offers every tile
  you make public while joined. `publish here` is not part of swarm sharing.
  It stays the act that publishes a creation, and it stays refused at root.
- **"Watching only — set a host in /hosts."** Gone. Watching needs nothing,
  and neither does sharing: with no host your tiles are live from your
  device. A host is what makes them stay after you leave.
- **"The relay no longer hosts other participants' bytes" (2026-06).** A
  relay's HTTP half may host allowed participants, and is asked like any
  host when it is the host field you entered — its own answer decides, never
  its card. Events stay memory-only. There is still no temp pool: bytes land
  flat at `/<sig>` in the same heap and are kept like any other atom.
- **The guest recipe of 2026-10-04** (`/join`, `>`, pick a host in the Publish
  panel, `publish here`). Retired. A guest taps the meeting link and presses
  Join.
- **Consent for swarms** — [consent-hosting.md](consent-hosting.md). For a
  swarm, consent is the hosts you already chose (a branch's publish domain,
  the host field) plus the join sheet, which names the host — or says that
  no host keeps your tiles and the room gets them from your device while you
  are here. No request or grant event is sent.

The live swarm is the 2026-09-24 "sharer is a host while present" idea come
back WITHOUT what sank it. That rule re-uploaded whole hives and announced
bytes nobody served once the sharer left. Here nothing is uploaded for a
live tile; only the public subset is offered (the `.public` marker gate is
unchanged); its bytes move only when a peer asks for them (the broker's
request/answer, sha256-verified, 8 MB per answer); and the tile leaves the
grid when the sharer leaves, so nothing points at bytes nobody serves —
except in the hive of a peer who TOOK it, who fetched its pictures at the
take.

## Which host: resolved per page, never picked

- `hypercomb-essentials/src/sharing/swarm-hosts.ts` answers "where do this
  page's tiles go?" in the order of the rule above. It is **synchronous and
  reads caches only**: each branch's host marks (refreshed on
  `hosts:marks-changed`, which `setBranchHosts` emits once its marks have
  committed, and on `decorations:changed` for a branch it remembers), and the
  host field — a synchronous read of the mesh, looked at again on
  `mesh:zone` and `mesh:connection`. A miss kicks a local read and answers
  *pending* (no host yet); the read landing re-drains and walks the page
  again. The hive root wears no marks, so its answer never waits. Connect,
  join, resubscribe and announce never wait on a layer read, and nothing here
  touches the network. It reads no hosts pool and no card (2026-10-11).
- A branch's marks read cold (the store root still coming up on a reload) or
  with a decoration record this device does not hold yet are unknown —
  read again on their own every second — never "no publish domains".
- Returning to the tab re-reads the most recently used branches, so a
  change made in another tab takes effect.
- While `isJoinedHere()` is true, `HostSyncService` makes every write door
  the offered pages resolve to a target — public-only, flagged `swarm` — plus
  the hive root's own answer (where a root offered with no page, such as a
  publish or an invite, goes). There is no host pick, no `publish here`, and
  nothing stored.
- A swarm host is owed only what a root offered on a page needs **where it is
  shown**: the walk passes the page to `markPublic(sig, kind, closure, page)`,
  and each child-slot edge the marking walk records is one page step down
  (named by the parent layer). A sig shown on two pages with different hosts
  goes to both. A publish or a vocabulary claim passes `page: false`: it is
  not a room offer, and its bytes go only to the nodes that act names.
- When a host becomes owed what already went elsewhere — a picture shared on
  a second page with another host, a host field that changes, a branch
  given a publish domain, a publish domain passed over — the offered roots'
  closures are walked again IN MEMORY over the recorded edges, and every sig
  that host lacks a receipt for, and that is no longer queued, is queued
  again from the local bytes (re-staging). A pair proven once is never asked
  again.
- The targets follow from things that already survive a reload, a discarded
  tab and the Update pill: the branch marks, the saved relay list and this
  tab's `hc:mesh-session`. Receipts on disk (`sign('host-receipts')`,
  `{sig}.{hostHash}`) count again, so the first walk after a reload
  republishes the same full entries. A publish host also honours receipts
  earned on its zone's retired `content.` face; the host field's own heap
  (the meeting point) has none.
- A write door is a zone root, never a `content.` face. Every door is one
  you named (a publish domain, the host field), so it may carry a port, as
  `hostZone` keeps it (a self-hosted machine on :8443). A loopback host is
  skipped as an upload host on a page that is not itself loopback — nobody
  else can reach it — and the next source answers.
- Layer events advertise the page's hosts as `['domain', …]` tags, first —
  where that page's bytes actually went — then where the offered branches'
  subtrees went (`closureHostsOf`), then your self-domain while its backup is
  on. Never a loopback host from a non-loopback origin.
- Readers fetch in WAVES, each only when the one before missed: a sig's
  advertised hosts; then the hosts inferred from the layer that held it (the
  host that served it, and the hosts its publisher named for it); then their
  own swarm hosts, self-domain, community and the rest. A sig whose publisher
  said where it went is never first asked somewhere it is not — every extra
  probe is a request against some host's daily cap.
- The share gate judges each part of a closure where it is SHOWN: the tile by
  the page's hosts, its subtree by the hosts of the pages below, plus your
  self-domain while its backup is on. So a receipt on some other target never
  announces a handle the receiver is not told where to fetch. A page on the
  way still being read is UNKNOWN, never "no": the walk says nothing for that
  page — the relay keeps the slot it had — and walks again when the answer
  lands, for at most 5 s.
- The gate SAYS WHY (`closureVerdict(sig, kind, deep, page)`, and
  `closureVerdictOn` for named hosts; `isClosureAvailableAt` / `On` are its
  yes/no wrappers): `{ok, ownerHeld, unknown?, blocking?: {host, page, sig,
  kind, state, reason, why?, name?, bytes?}}`. `deep: false` asks for the
  tile's own atoms (the takeable question, D1), `deep: true` for the whole
  closure. `ownerHeld` means every host the atom's page has gave a STANDING
  answer for it — 413/409 for that entry, a refusal, full, never answered —
  so waiting changes nothing; `blocking.state` `unreachable` and `not-live`
  are transient and never owner-held. The walk keeps going past owner-held
  atoms, so anything still uploading is reported first. Its node memos are
  epoch-stamped: every standing change moves the epoch.
- A deep closure that verifies leaves a CLOSURE RECEIPT, `{sig}.{hostHash}.closure`
  in `sign('host-receipts')` (one shared writer; the storage-write counts do
  not move), so a reload answers the deep verdict from one lookup instead of
  walking thousands of layers (a 5,000-node branch: 415 s → 1.5 s, no host
  requests). It is keyed by the ROOT page's host.
- When the set of targets changes, cached "not available" answers are checked
  again.
- A tile made private while its upload waits out a backoff never reaches the
  host, and a leave ends the offer — `.public` markers on disk never carry
  bytes into the next room. The public CDN and publish nodes keep the plain
  marker rule (a swarm host that is also one of them is owed every marked
  sig).
- The publish gate asks the nodes it publishes to (`closureVerdictOn`),
  never a swarm host: a receipt there says nothing about the node whose index
  is about to name the branch. When every node REFUSES what it lacks, the
  publish stops at once — failure `not-available` with `refused: {host,
  state, reason}`, the index untouched — and both the host gesture and the
  publish panel say "{node} refused the upload ({reason}) — nothing was
  published" instead of "still uploading … it keeps retrying". A node's
  `sync:state` wakes the wait early, and an explicit publish clears that
  node's back-off: each press is one fresh attempt.

### hypercomb.com: a meeting point you may enter, never a default host

Until 2026-10-11 a fresh install's hosts pool was seeded with
`hypercomb.com`, so every newcomer's pictures were offered there first and,
behind it, the open meeting point's card said it hosted everyone. Both are
gone (no seed; the pool and the card pick nothing). `hypercomb.com` takes a
participant's bytes only when it is the host field they entered AND it takes
their key (its people — operators, bound publishers, `HOST_FRIENDS`); a
stranger it refuses is live from their own device instead. It stays a READ
source (install, updates, example hives) and is for testing: nothing may
depend on it, and it may be retired.

The words beside the swarm lost their default too. `profile` (a set),
`features publish`, `harness offer`, `language offer` and `language missing`,
`module`'s publishing words, `arrival`, the vocabulary claim and the Publish
panel's writes (an arrival plan, the participant-only set, an entrance) go
only to the host their words name, a branch's marks, or the public host the
participant NAMED (`hc:public-host:domain` — empty unless they set it; it no
longer falls back to `pluginthematrix.com`). With none they refuse and say
how to name one. The compiled `PUBLIC_CONTENT_HOSTS` is a READ source only —
a profile show, a module word that only reads a sandbox, the panel's read
door (`doctrine.spec.ts`, "no side word writes to a host nobody named").

Mind the Workers cap if a host on the shared worker is ever opened to more
people: the cap is per ACCOUNT, shared by every zone the
`pluginthematrix-core` script serves. Each new sig costs the worker THREE
requests to upload — the HEAD, the CORS preflight (a PUT carrying
`Authorization` is never a simple request) and the PUT (answered `201 stored
<sig>`, so no read-back GET) — plus one GET per receiver per sig. Receipts
keep the cost to one round per sig per host, and readers ask a sig's
advertised host alone first, so a meeting hosted elsewhere — or live — costs
it nothing.

## How a host allows participants

One relay flag, also read from the env `ALLOW_PARTICIPANTS`. It is off unless
given.

| Flag | Who may upload |
|---|---|
| `--allow-participants` (bare, or `=all`) | any key that sent a verified EVENT on this relay in the last 30 min |
| `--allow-participants=<lifecycleSig>,...` | only keys whose `{alive}` beacon (kind 30206) carried one of those `x` values |
| `--writers <keys>` | unchanged: named writers, uncapped |

- `lifecycleSig` is `sha256('lifecycle\0' + room + '\0' + secret + '\0' + point)`,
  the channel the swarm already beacons on, `point` being the lowercase
  host[:port] of the meeting point the room MEETS at — the relay its
  participants named and dial (hypercomb.com for a room that named it; never
  the page's own domain), which is this relay only when the room meets here. A relay that only keeps a room's
  bytes (D7: the room meets elsewhere and uploads here) lists the sig of the
  point the room meets at, never its own host. The meeting point is part of
  every room address since 2026-10-12 (`swarm-room-identity.md`); a sig
  listed before then names no room any more. `scripts/swarm-preflight.cjs`
  prints the sig for the relay it is pointed at. Listing rooms needs a relay
  restart for each new room. jwize.com runs the bare form.
- "Live" means recently heard. The relay keeps an in-memory map from key to
  the time of its last verified EVENT and the zones it beaconed in. A restart
  empties it, and the reconnect beacon refills it within a second. The swarm
  beacons before its first upload, so a new joiner is live before its first
  PUT.
- NIP-11 shows the policy: `limitation.participant_uploads` is `"all"`,
  `"zones"` or `false`. Clients never ask first. The answer to the first PUT
  is the policy.
- Joining is the participant's consent. The join sheet names the host the
  invited page's tiles go to, or — with none — says they are shared with the
  room from this device while you're here. The `.public` marker gate is
  unchanged, so private tiles, the clipboard and settings never reach any
  host. In a joined tab, only signatures that carry a `.public` marker are
  queued for upload, and only while some host could take them.
- A relay's policy matters to a participant only when it is the host field
  they entered: its own answer to their first upload decides. One that does
  not take their key leaves their tiles live from their device, said as
  "{host} isn't taking uploads from guests — the room gets your tiles from
  this device while you're here".

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

For a swarm target, a 2xx answer whose body is exactly `stored <sig>` is the
receipt. No read-back GET follows. The relay and the Hypercomb worker
(`worker.js` `putSig`) both answer it. A host that answers anything else (a
Blossom-style host answering a descriptor) is read back, like every other
target.

That is enough here because the relay sends that body only after the bytes
hashed to the signature and were written to its heap. The read-back rule
(protocol-spec §21.11 and §21.12) exists because a fallback page or a proxy can
answer 200 without storing anything. Neither can produce `stored <sig>`. Every
other target keeps the read-back.

The drain (2026-10-10):

- runs FOUR WORKERS, each taking one entry and asking the host about it (a
  HEAD) and then sending it at once — no batch barrier, so the first byte
  leaves after one round trip (a 5,000-node branch used to send no byte for
  262 s while 11,000 HEADs went out). A signature the host already serves
  earns its receipt without a PUT;
- skips the HEAD for an atom under 16 KB to a swarm host that answers its PUT
  for itself (`stored <sig>` / `already held`): the PUT says "held" in the
  same round trip;
- sends a host's FIRST upload — the first ever, and the first after each
  failure — alone: its answer says how to treat the rest, so a host that
  refuses costs one PUT a wave, not four. The others wait on it at most 2 s:
  a big first picture on a slow uplink never idles them for its whole body;
- orders the queue by page DEPTH below the offered root, across every root,
  then by age — every offered tile's own atoms go before any tile's children
  (tile first);
- after a receipt, re-walks every page that is waiting, within 150 ms, not only
  the current page.

## Refusals

Every failure backs off per host and is shown with its reason. Names keep
going out whatever happens.

| Answer | `sync:state` | Back-off | Result |
|---|---|---|---|
| 401 `not-live…` | `not-live` | 1 s, up to 5 times | clears itself, because the beacon goes first. From then on each upload to that host carries this key's signed `{alive}` beacon (D7, below). Still not-live after 5 retries from a host this tab does not meet at: `refused` — "this host only takes uploads from people meeting on it" — and passed over |
| no answer to 3 uploads while the socket is open and another host answers | `unreachable`, why `unresolved` (`never-answered` in the gate) | the ladder | a publish domain or meeting host is passed over (D2); not remembered across a reload (silence is weak evidence) |
| 403 `participants-closed` | `refused` | 10 min | its tiles go LIVE from this device (also a live key whose only room is one a `--allow-participants=<rooms>` relay does not take) |
| 413 | `too-large` | the entry is dropped for this host | that tile stays name-only |
| 429 or 507 | `full` | Retry-After, at least 10 min | its tiles go LIVE from this device |
| no answer, or 5xx | `unreachable` | 2 s, doubling to 60 s | retried |
| no answer to a SECOND PUT from a swarm host that answered a HEAD and has taken no upload from this tab, while the tab is online with its socket open and the host answers a HEAD at that address right after (its CORS preflight) | `refused` | 2 s, doubling to 60 s — given back with a reopened socket | the host is passed over for this page only, and its tiles go live |
| no answer to a PUT over 100 MB from a swarm host (an edge's CORS-less 413) | `too-large` | the entry is dropped for this host | that tile stays name-only |

`sync:state` also reports `backed-up` (everything served) and `syncing`
(uploads in flight). Beside a failure it says `why`, as a person acts on it:
`page` (the host answers a web page where a heap answers bytes — until it
serves a receipt), `unresolved` (nothing at that name ever answered, fast,
while the tab was online with its socket open — a typo, a name that resolves
nowhere, or a machine host switched off behind its edge; the browser cannot
tell them apart, so the line asks for both; a timeout is never `unresolved`),
`refused`, `full`, or plain `unreachable`. `hostTrouble(host)` answers the
same from memory, for the publish rows. The drain's four workers each ask
about and send their own entry (above), so a reload that re-stages thousands
of entries for a host never holds the first upload, or the first failure
that passes a dead host over, behind all of them; `host-sync:progress` is up
from the first entry. A swarm host that has not answered yet gets ONE CANARY
— the first entry it is owed — at the front, and a target set that moves
mid-pass (checked every 32 entries: a branch given its publish domain, a
host passed over) starts the pass over, so a new host's first answer
never waits behind another host's backlog. The FIRST question this tab asks
a host goes alone: while it is in flight the rest wait on that one answer,
so a page host costs one HEAD (and the GET that checks what a 200 carries),
not one per worker; once it has settled, either way, the host is asked at
the full cap. Back-off resets on success, and on a
socket that comes back — the first open after a join, or the one `reopened` payload; a stall
answered late is not a return. A 409 answers only a PUT at a reserved address,
which a tile's bytes never are. Each receipt the swarm host earns is announced
at once as `host:receipt` {sig, host, swarm: true}, so a second, refusing
public-only target can never hold the room's tiles name-only. A reopened
socket resets the relay's pause when the relay is a swarm host, and any other
swarm host's only when it was `unreachable` or `not-live` or a refusal read
from the browser's side (uploads that never left) — the path came back; the
host's own refusal or a full host keeps its window. A publish domain that
refused, is full, or never answered is passed over (see the rule) for the host
field; a host field passed over keeps the page, named with why, and its
tiles go live from this device. A host passed over for what may have been
the path — anything while the socket itself was down, or uploads that never
left the browser — gets its chance back with the socket.
Only a page or the host's own 401/403 is remembered in THIS TAB's
sessionStorage (`hc:swarm-hosts:down`, the newest 8, an hour at most — never
localStorage) so a reload does not hand the room back to it; a full host (it
named its own wait) and plain silence are this page's only. A remembered one
gets its chance back only when `enable()` or `reDrain()` is called, or it
serves a receipt. `swarm:share-status` names the hosts passed
over (`passedOver`) — the page's own, and those of the branches it offers.

**LIVE HERE TOO: the beacon rides the upload (D7).** A relay.js host started
with `--allow-participants` takes a participant's upload only from a key live
on ITS socket, and a participant meeting at another point (the always-online
one, another relay) never speaks there. Once such a host has answered
`not-live`, each later PUT of the room's own drain to it carries this key's
newest signed `{alive}` beacon in the NIP-98 event — tag `['alive', <the
kind-30206 event as JSON>]`, `x` = the room's lifecycle sig, `d` = the key,
expiring 120 s on, signed at most once a minute — and the relay takes a
fresh one (same key, verified, `{alive: true}`, a 64-hex `x`, at most 120 s
old, at most 4096 characters) as the key being live, in that room (zones
mode still decides by room: 403 "this room is not hosted here"). No request
and no round trip is added; the first contact costs one 401. The beacon is
attached ONLY while this tab meets (`isJoinedHere`), only to the room's
drain (never a publish node or a package push, which must not learn the
room's lifecycle address), and its room is this tab's own zone, never the
stores' pre-fill. The relay records the key live only after the whole token
has held for that request (freshness, method, url), and **never on a relay
with an access code**: there live means "spoke on a socket admitted with the
current code", which a self-signed beacon cannot prove — a coded relay takes
uploads only from its own sockets.

## Names before bytes: the gate

Each walk builds the entry for each public child with one helper:

1. **Hosted.** The TILE's own closure (its layer, properties, picture, notes,
   decorations, meta envelopes — never its child pages) has a receipt on a
   current target (D1, tile first). Publish the full entry: name, layer
   signature, properties and titles. Remember it as this name's last hosted
   entry. A public BRANCH still marks its whole closure, so its deeper pages
   keep uploading; its entry carries `deep: 'owner'` until the whole closure
   verifies, then `deep: 'hosted'` (a receiver that does not know the field
   ignores it).
2. **Last hosted.** Not hosted yet, but this name has a last hosted entry.
   Publish that entry unchanged. Its old handle and picture are still served.
3. **Name only.** Neither. Publish a placeholder: the name, the titles and the
   scalar properties, with `layerSig`, `inviteSig` and every value that holds
   a 64-hex string removed. Receivers draw it as a label tile. It cannot be
   taken until the full entry lands.

**LIVE (the live swarm, 2026-10-11)** comes before 2 and 3: when the page
names no host at all — its hosts read, none, and your own backup off — or
the tile's verdict is `ownerHeld` for any reason but `too-large`, a child
with a handle goes out as the FULL entry with `served: 'owner'` (`deep:
'owner'` for a takeable branch). It is never remembered as hosted. A page
with no host asks host-sync nothing (faster than the hosted path: no
verdict, no wait). A refusal that lands after the walk's 250 ms walks the
page again. What stays a name: a child with no handle yet, a hole no store
here holds (`missing`), a too-large atom, a page whose hosts are still
being read, an answer still on its way, or an upload still running to a host
that has not refused it. A live tile is not "uploading", "waiting" or
"held" on the status line (`live` counts them), and a receipt does not walk
its page again for it.

- A page that used 2 or 3 is walked again when a receipt arrives.
- A branch's handle is history's merkle SEAL of its live subtree. A seal that
  refuses (a layer below held nowhere — GC'd, never fetched, a pasted bare
  leaf) settles on the raw handle, so the hole is named and the tile is
  takeable by its own atoms, and a late seal re-walks the page only if it
  lands on something other than what was offered. The walk's seal is a
  BACKGROUND seal (`sealSubtree(segments, undefined, { bypassMissWindow:
  false })`, as is the publish panel's status row): it trusts this epoch's
  refusal and leaves the store's host-miss window standing, so receipt
  re-walks never keep a GET-404 stream going against the hosts for the hole.
  Explicit snapshot, publish and paste still ask the hosts again.
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
  host, hosts, hostSource, hostState, reason, why?, passedOver?, blocked?,
  held, notQueued, deepOnDevice, taken, unackedMs}: WHICH host this page's
  tiles go to, why that one (`publish` or `meeting`; `pool` and `relay` are
  retired), and what it last said — `no-host` when nothing hosts them — and
  `live`, how many went out whole from this device. `sync:state` carries
  the same `source` for every swarm host. And (2026-10-10):
  - `held` — WHAT HOLDS EACH TILE BACK, grouped by host: `{host, state,
    reason, why?, count, names, deep?}`, from the gate's own `blocking` word,
    else every one of this page's hosts refusing, else a page below going to a
    host that takes none of a branch's bytes. `deep: true` on a group whose
    tiles CAN be taken and only their deeper pages stay on this device — the
    line says so ("dead-b.localhost isn't taking the deeper pages of 1 tile —
    they open from your device while you're here"), never "stays a name";
  - `uploading` counts only tiles a needed host still owes uploads for;
    `notQueued` the name-only rest nothing is uploading (a hole in the
    closure, a seal that never resolves): "N names only — not queued";
  - `deepOnDevice` — takeable tiles whose deeper pages are still only on
    this device, a host still taking them (D1). The sharer is told, in the
    warn tone: "Deeper pages of N tiles are still only on your device — stay
    a moment to leave them with the room" (BCL-3) — unless a host refusing
    those pages is named already (the `held` `deep` line above);
  - `taken` / `unackedMs` — whether the relay OK'd this page's newest word,
    and how long the oldest of this tab's own frames (this page's word, the
    beacon) has gone untaken (said again once at about 3 s while untaken).
    The line counts "Sending…" from the swarm's own age — a status said
    again never restarts the count (TS-7) — shows it past 3 s, and does not
    count you in "(N here)" while it shows;
  - `passedOver` — the hosts passed over, this page's and its offered
    branches' at ANY depth (D2; BCL-1: a publish domain worn on a page two
    levels below the offered tile is named too, via host-sync
    `closurePassedOverOf`), named whenever there is one, with "they aren't"
    for two or more.
- A hosted full entry's atoms are read over HTTP first: the receiver's
  broker is told every ref of a peer's hosted entries as `hosted` (never
  raced on the mesh). A LIVE entry's atoms (`served: 'owner'`) are claimed by
  the live peer instead — host and mesh raced — and its handle, like every
  `deep: 'owner'` root, goes as `owner`: everything read BENEATH such a root
  is asked of the mesh first (it is only on the sharer's device), and the
  subtree's miss windows re-open when the sharer announces again (at most
  once a minute) and the moment the root is named without the mark (its
  upload finished). The page's `['domain', …]` tags are never attributed to
  a live entry's atoms: no host kept them. `swarm:presence-changed` carries
  `deepOwners`, and the receiver's line names them: "Deeper pages open from
  Ana's device while they're here". An older receiver drops `served` and
  reads a live entry HTTP first, then the mesh — slower, and it works.
- A peer who TAKES a live tile (the wand, `swarm-adopt` `#foldPageTile`)
  fetches every picture its visual names through the broker the moment the
  take lands — written through to its own store — so the taken tile still
  paints after the sharer leaves.
- Once the relay has taken the page this tab stands on, the swarm emits
  `swarm:page-announced` {location, segments} — the page's address only,
  never a count or a name. "Taken" is the relay's OK, reported by the mesh's
  `publish(…, onTaken)`: `publish` itself resolves `true` as soon as the
  event is sent or queued, and on a fresh join the socket is still connecting
  then, so the promise is not the room (measured 2026-10-10: the event left
  ~20-115 ms after `publish` resolved). A walk of the current page that finds
  its word unchanged (the relay took this meeting's very word for the slot
  within the refresh window) emits it too, so arriving back on a page counts
  as arriving.
  The share ask (`share-ask.worker.ts`) waits for it and then for idle time,
  so it never adds anything before a join's first announce; it reads the
  count with `privateToOfferHere()` (the same names `offerPrivateHere()` would
  flip — never a collection item or a tile the participant hid — read
  locally, nothing sealed). It takes its line down on the Lineage's `change`,
  the moment the participant navigates.

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
quota, a target is missing, or the tab reloaded. A LIVE tile leaves the same
way — so when its sharer leaves, it leaves the grid (it was only ever on
their device), except in the hive of a peer who took it.

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
- **The tab's meeting, whole, is the tab's too** (2026-10-09):
  `sessionStorage['hc:mesh-zone']` = `{ room, secret, relay?, host?, code? }`,
  written at join beside `hc:mesh-session`. A reload resumes in the tab's own
  room at the tab's own meeting point; the origin-wide `hc:room` / `hc:secret`
  only pre-fill a NEW tab. A joined tab dials only `relay` (with `code`, see
  "The access code" below), so another tab's list, or a `/domain` change,
  never moves it (`/domain` edits the page's own list, saved for every tab,
  and never that tab's meeting point). A meeting point this page may not dial
  (a loopback one opened from a real host) is not swapped for the default
  relay: the tab meets nowhere and the connection says `refused:
  'unreachable'`. A room store `set()` with an unchanged value is a no-op —
  no write and no `change` — so nothing announces a spurious `{left}`.
- **The {left} goes out on the socket it came in on.** A join into another
  room at another meeting point moves the socket while the old room's `{left}`
  is still being signed; the old socket stays open, deaf, for 2 s and carries
  it there (nostr-mesh `#drain`), instead of the new point where nobody in the
  old room listens. The outbound queue keys a replaceable event by its slot
  AND its address, so the next room's `{alive}` never replaces it.
- A page's first walk after a reload waits (at most 600 ms, beside its other
  reads) for the relay to replay what this tab said there, so a full entry is
  never re-said as a bare name. A join made in this page has said nothing
  there and waits on no replay at all: nothing is added to a join.
- Visited pages are not persisted, because where a person went is not
  recorded. After a reload the current page republishes at once. Other pages
  refresh when revisited, or lapse at their 90 s TTL.
- Listeners are armed when the drones are constructed, not at first paint, so
  nothing created in the first seconds is missed.
- **A tab with no meeting of its own asks (D5, 2026-10-10).** A bare
  `use-live-relay`, the `join` word, ctrl+shift+P and every keymap join need
  THIS tab's own room and secret in `hc:mesh-zone`; without them they open
  the selector pre-filled, and never silently join last week's pair from the
  origin-wide pre-fill or the world-shared `hive/hive`. A named
  `use-live-relay <room> <secret>` records the pair as the tab's zone first,
  so it still joins at once; with the same pair as the tab's zone and no
  server it keeps the tab's meeting point and code. A reload resumes without
  asking. Double-quoted words (straight or curly) are one word. The secret is
  never seeded from the address bar, and the room only on
  `<room>.hypercomb.io` (`www` excluded).
- **One text, one zone (D6).** A room or secret ENTERED (the selector,
  `use-live-relay`) is folded by core's `canonicalZoneText`: NFKC, invisible
  characters dropped, curly quotes and dashes straightened (an em dash is
  `--`, as iOS types a doubled hyphen), spaces collapsed; case is kept. Plain
  ASCII hashes exactly as before (`downtown/rose` is still `166d0590ac44`). A
  value the store already holds is kept as recorded, so a tab resuming a
  pre-fold pair keeps it; and a MEETING LINK's room and secret are an exact
  zone, recorded as carried (`set(text, exact)`), so a guest always lands
  where the inviter is. The selector's two words preview what START will
  store.
- **The meeting point is pre-filled too (ZI-1).** A new tab's selector is
  pre-filled with the point this device last met at — never its code. It is
  a participant DOCUMENT (pool `mesh:meet-point`, `participant-document.ts`),
  never a localStorage key: written when the selector sets a point and at a
  join (never at a reload's re-announcement, and never by a link's zone write
  before the guest said yes).
- **"(N here)" counts who STANDS here (TS-3).** Each member's newest drill
  request (kind 30203, d `drill:<pubkey>`, already sent on every arrival —
  now on every move to another page, `{away: true}` with no names on a
  private one) says where they stand. `swarm:presence-changed` carries
  `peers` (everyone whose tiles are here — the badge filter, the spotlight
  and the layer strip keep a member whose tiles stay while they walk on),
  `at` (the standing subset — the count) and `zonePeers` (here, elsewhere,
  away). A member never heard drilling counts where their slots are.
- On a move, the personal channel and presence (30204) wait a 300 ms settle
  and the channel says only a changed word; the late-joiner ask waits 1 s
  (a join or reconnect still asks at once); the sticky refresh skips pages
  where this participant holds nothing; the fast join retry is armed only by
  arrivals. Join, connect and reconnect frames are unchanged.

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
| `retrying` | no open socket; the reconnect ladder is running. After 30 s the line says "Can't reach {host}" (the shipped default: hypercomb.com) |
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
  (`bufferedAmount` going down). A buffer that has not gone down for 15 s is
  a dead path and is judged as usual.
- A tick more than 1.5 s late judges no deadline but still sends the idle or
  unacked probe. In a hidden tab, a late tick right after another late tick
  (Chrome runs a tab hidden 5 minutes on the minute) judges as usual, and an
  EVENT that has waited a whole such tick for its OK dials the replacement at
  once. The first tick after resume, visibilitychange or pageshow never
  judges. (A visible tab's consecutive late ticks are a busy main thread,
  which could be holding a handshake's open event: never judged.)
- A wake — `online`, `pageshow`, `resume`, the tab becoming visible, a change
  of network TYPE: probe an open socket with a 3 s deadline; otherwise
  connect now. Only a wake that means a NEW PATH — `online`, a type change,
  `resume`, a pageshow from the back-forward cache — cancels a handshake in
  flight for more than 500 ms and dials it again at once (a browser holds one
  handshake per host:port in flight, so one beside it would only wait), and
  not one the previous new-path wake dialled within 5 s. A tab shown again
  says nothing about the path, and an `effectiveType` re-estimate is never a
  wake: on cellular or a busy meeting point a healthy handshake takes over
  500 ms. `online` and a type change also reset the connect timeout to 8 s.

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
- On open, in order: the REQs — held subscriptions newest first (the page
  this tab stands on first), leases last (the same 900 s window) — then
  unacked and queued control frames, then bulk, then the beacon, then the
  current page, then the visited pages spread over 0-5 s.
- Refused events are sent again. `rate-limited:` is retried after 1, 2, 4, 8
  and 15 s, at most 5 times, unless a newer event replaced it. A refused
  subscription retries after 1 s·2ⁿ, capped at 30 s.
- LEASES. A bucket opened by `ensureStartedForSig` / `awaitReadyForSig` with no
  consumer is a lease: it closes at the relay's EOSE or its deadline (the
  wait, or 10 s), and its waiters are answered then. At the relay's
  subscription cap a held subscription takes the oldest lease's place and
  asks again at once; a lease the relay refuses is dropped, never retried.
  The swarm's own walks never open one for a page this tab is not on (a
  reloaded sharer used to hit the 200-subscription cap and go deaf).
- SEND PRIORITY. The relay's per-connection budget (400, refilled 10/s) is
  mirrored per socket, full at open. Beacons, layers, presence, drills,
  probes and held REQs go at once; broker asks, answers, cancels and resource
  bytes (kinds 30401, 30201, 20400, 20402) wait FIFO while fewer than 40
  tokens remain (superseded per slot, at most 512, gone after 60 s). A full
  outbound queue evicts the oldest bulk frame first; bulk never displaces a
  control frame. (The relays now keep two buckets, bulk and control; one
  mirror is conservative.)
- After a 4401, every later dial to that relay is announced only on its first
  frame (its card, on the same flight), so a tab without the current code
  climbs the access ladder and is never shown a reopen.
- THE CLOCK. The relay clock offset is kept per tab in sessionStorage
  `hc:mesh-clock`, so a reload stamps its first frames on the learned clock.
  `mesh:clock-corrected` {relay, offsetMs, prevOffsetMs} fires once when a
  card moves the offset by more than 2 s after EVENTs already went out on
  that socket, and the swarm re-says everything, as on a reopen.

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
  `{left}` for the same slot cancels it, and any verified EVENT on a
  connection that has itself beaconed that slot hands the will to that
  connection. A reopened socket's first word is its beacon, so a reload, a
  blip or a network change never tombstones.
- A will belongs to the connections that beaconed the slot, not to every
  connection the key has spoken on. Another open connection that beaconed it
  (a second joined tab) inherits the will — but only one still THERE: heard
  from since the dying connection's newest beacon for the slot (MS6). A phone
  that locked twice leaves a zombie socket of the first lock that must not
  hold the will until the reap. relay.js pings the quiet candidates when the
  will is armed and asks again when the grace ends; the always-online
  meeting point cannot ping (a Worker cannot), so it ASKS instead: each
  quiet candidate is sent, on its own lifecycle subscription only, the
  tombstone the room would hear (never stored, never fanned out); a live tab
  beacons again about 1 s later (`#reassertAfterStaleTombstone`) and takes
  the will, and a zombie says nothing, so the room hears the leave when the
  15 s grace ends (MS6 — it was 90 s). A tab that cannot run (frozen,
  suspended) is marked away until its next beacon. A connection of the slot that speaks DURING the
  grace takes the will (it does not merely cancel it), so its own later death
  is still heard. A same-key tab that never joined neither inherits nor
  cancels it, so closing the joined tab still marks it away after 15 s.
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
- Rate: per connection, TWO buckets, each a burst of 400 and a refill of 10
  a second — bulk (the broker's kinds 30401, 30201, 20400, 20402) and
  control (everything else, every REQ) — so a sharer whose pictures are in
  demand never has its own beacon or page refused for answering. Per IP, a
  burst of 12000 and a refill of 200 a second, keyed on `CF-Connecting-IP`,
  shared by both. CLOSE and AUTH are never charged. Twenty phones on one
  venue IP use about a quarter of the IP ceiling.
- BROKER ANSWERS ARE A REPLAY WINDOW, NOT A STORE (relay.js and the meeting
  point alike). A 30401 answer is kept only for the readers' window —
  created_at + 15 min, whatever its tag says (the client stamps 900 s now) —
  and ONE holder's WHOLE run per address and type is kept: the asker
  assembles a chunked answer from one key's chunks, so a mix never
  completes. Once a holder's run is whole, other holders' copies are dropped
  and later ones are fanned out live but not kept. Only a run a reader can
  assemble is kept (d = x, or d = x#i with c = i/n, n ≤ 64), at most 128 per
  address and type, never one dated more than 60 s ahead, kept as running
  counts (a store never rescans the address); and a run of BYTES becomes the
  run only once it hashes to its address — a forged answer is dropped, so it
  can never pin a popular picture's replay. Every answer is still fanned out
  live. Answers are paced by the sender too (a burst of 8, then 6 a second;
  a run cut short gives its unused turns back), one answer per sig at a
  time, and a tab answers at once for sigs its own page names.
- The relay prints one counts-only line a minute when anything happened: open
  connections, refused EVENTs and REQs, wills fired and cancelled, participant
  PUTs and bytes, and alive participants per zone (a 6-hex prefix). No IPs, no
  keys.

## The meeting link

`https://hypercomb.io/#meet=<room>/<secret>[/<page>…][&relay=…][&host=…][&code=…]`

- Every part is percent-encoded. The meeting point rides after the place as
  `&key=value` pairs, only when the meeting is somewhere other than the
  default relay (meeting-invite.ts `meetFragment` / `parseMeet`):
  - `relay` — the meeting point, written as its FULL `wss://…` URL (a path
    such as `/io` kept; `ws://` only to a loopback host). A bare
    `pluginthematrix.com` is read as `wss://pluginthematrix.com`, never
    written that way.
  - `host` — the meeting host (the rule above), written `https://name.tld`.
  - `code` — the meeting point's access code, an RFC 7230 token of at most
    128 characters, and only beside a `relay`: a code with no meeting point
    is dropped, never sent to the default relay.
  - A pair that is not valid makes the whole link no link — never a quiet
    join at the default. A link with no pairs reads exactly as it always did.
- **An older package refuses a link with a meeting point.** Its parser splits
  on `/` alone and refuses a part that decodes to a `/`; the full `wss://`
  relay and the `https://` host guarantee one, so it does nothing — rather
  than fold `&relay=…&code=…` into the secret and join another zone with the
  code in a page name. meeting-link.spec.ts runs the published parser on
  every shape this writes.
- **The code goes nowhere but its meeting point.** It is in the link's
  fragment (which never reaches a server), this tab's `hc:mesh-zone`, and
  the dial's subprotocol to that one relay. No sheet, toast, log or effect
  carries it, it never enters an invite bundle (a resource a host serves),
  and the command line never records a line carrying one (`invite code <x>`,
  a pasted link with `code=`) in its recall.
- The facilitator makes it: joined, nothing selected, type `/invite`, or tap
  Invite on the status line. The link is copied, with this tab's meeting
  point, host and code. `invite wss://…` opens the selector on that point
  with the cursor on the code; `invite code` opens the code field (a code
  is never taken from the command line). With a selection, `invite` still
  makes the bundle link as before (and that carries no meeting point).
- **Already in that room at that meeting point** (a re-opened link, the
  owner tapping their own invite): no sheet, just the walk to the page. But
  a link that would CHANGE something asks first — a new meeting host (the
  sheet names it), or a new code while the meeting point still lets this
  tab in. A new code is taken quietly only while the meeting point is
  refusing the tab's code (a recycle), and it is dialled at once.
- The stash is kept until the sheet is answered, so a reload before the
  answer keeps the link. A shell running a package from before the meeting
  link answers it itself after a grace: the selector opens pre-filled with
  the link's room, secret and meeting point — never its code
  (`invite-capture.ts` `watchPendingMeet`).
- The page segments are the ones the swarm actually hashes, so a pinned Home
  cannot split the room.
- **A link survives being pasted (2026-10-10).** Every part is minted
  strictly: `! ' ( ) * . _ ~ -` are `%XX` too (every older reader decodes
  them to the same text), so a link never ends in raw punctuation; and a
  stray trailing `. , ; : ! ? ' " ) ] } >` (an unbalanced `)`) a chat app
  glued on is trimmed on read — never `_ * ~`, which end base64url codes.
  The room and the secret may hold `/` (only a page segment may not); a link
  that would not read back the same is never handed out ("A meeting link to
  this page would not open for anyone…").
- The fragment never reaches a server. The shell moves it into
  `sessionStorage['hc:pending-meet']` and strips it from the address bar —
  only once the stash write succeeded. Where storage is blocked (a private
  window that refuses it, an in-app browser) the link is put back in the
  address bar and the blocked-storage card shows it with a "Copy meeting
  link" button.
- A link opened in the SAME tab (a second tap, a pasted URL) is caught on
  `hashchange`/`popstate` before navigation reads it: stashed, stripped, and
  announced as the transient `meet:pending`, which the meeting-invite worker
  takes; a newer link that arrives while a sheet is up is kept.
- A package from before meeting points (or one that refuses a slash in the
  room or secret) gets the UPDATE DOOR, never the selector: the shell keeps
  its own copy of the link, writes it back to the stash, opens the packages
  panel and says "This meeting needs the newer Hypercomb — update and the
  link opens itself". Where the selector is still the fallback (no worker at
  all), the link's point is put in this tab's zone first (never the next
  tab's pre-fill — that waits for the guest's START) and restored on cancel.
- Opening it shows one sheet: "Join the room 'meetup'? You'll see everyone
  here. Tiles you add while joined are shared with the room and kept by
  hypercomb.com." [Join] [Not now]. The host named is where the invited
  page's tiles will go for THIS guest (their publish domains, else the host
  field). On a first visit those are still being read when the link opens, so
  the sheet waits for them — local reads only, at most 1.5 s; with none known
  by then, it names no host and says the tiles are shared with the room from
  this device while you're here. A host that turns out not to take this
  guest's uploads leaves their tiles live from their device.
- Join sets the exact room and secret — as carried, never folded like typed
  text (D6) — goes to the page, switches the command line to tiles (so a
  typed name never becomes a command), and connects.
- The link carries the secret. Anyone holding it can join and upload within
  the caps. Post it where the room is, and nowhere else.
- **THE TWO WORDS (D4; the room identity, 2026-10-12; the host beside them,
  2026-10-11).** They are the readable form of the room's address: the HOST,
  the room and the secret (`lifecycle \0 room \0 secret \0 host`, core
  `lifecyclePreimage`). Same host + room + secret ⇔ the same words ⇔ they
  meet; different words ⇒ they never meet. The host is ALWAYS in it, so
  EVERY pair changed on 2026-10-12, hypercomb.com rooms included: last
  week's pair is not this week's, and a package from before then does not
  meet one from after at the same host — their words differ; update to
  meet. **No host, no words:** there is no default host, and with none named
  there is no room. **Never the page:** the page's own domain
  (`hypercomb.io`, `localhost:4250`, a published site) is in no address, no
  pair, picks no host and is shown beside no words. **The host shows beside
  the words** wherever they show — the presence line, the breadcrumb, the
  selector, the `/use-live-relay` toast: "marble cove · hypercomb.com"; the
  breadcrumb's root reads as home while you are in a swarm, never the page's
  domain ("public · hypercomb.io" read as where the room met). Everyone in a
  room sees the same two words on any page, and half a room at another host
  is another room and reads another pair and another host. The words follow
  the package that addresses the room (`SwarmDrone.roomIdentity`, read
  in-page by the shell): a shell newer than its package reads that package's
  pair (the D4 one before the update), so a pair always names the address
  the tab meets at. The pair is always from the ONE English list, in every
  language; a reader of another language sees their own pair beside it
  ("light moss (うるわしい しま) · hypercomb.com"), so a mixed room compares the
  same English words out loud. One relay reached under two names (a host
  and its `www.`, a proxy port, `localhost` and `127.0.0.1`, `localhost:7777`
  and the `jwize.com` tunnel to it) is two rooms, on purpose; real links
  carry one URL (`swarm-room-identity.md`).
- **THE WORDS DURING THE MOVE TO hypercomb.com (2026-10-11 — history: the
  room identity of 2026-10-12 replaced the shell-side `SHIPPED_POINT` fold
  below; the words now follow the loaded package).** Which point
  counts as the shipped default is the SHELL's (`SHIPPED_POINT`), and the
  relay a tab dials is its ESSENTIALS' (`LIVE_RELAY`). Every web profile takes
  a new shell on reload; essentials arrive only when its participant presses
  Update (installs are push-only). So from the shell deploy until each
  participant updates, a tab on the new shell and old essentials still meets
  at `wss://jwize.com` but reads a jwize-folded pair: a NEW pair, unlike the
  one it always read, matching only other new-shell peers at jwize.com. A
  native app on its old bundled shell in the same jwize.com meeting reads the
  plain pair. That is not a short deploy gap — it lasts until everyone has
  taken the update. **Have a group take the update before it compares
  words.** jwize.com is deliberately NOT also counted as shipped: then the
  old-essentials (jwize.com) and new-essentials (hypercomb.com) halves of one
  room name — two meetings — would read the same pair, which is the worse
  failure.

Typed fallback: the swarm control, then the room and secret, then Start. The
fields — and the command line — never autocapitalize or autocorrect. Room
names are not case-folded, so `Meetup` and `meetup` are two rooms; but what
LOOKS the same is the same (D6, "One text, one zone" above).

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
   stamped `install:essentials` root;
7. the host the room's tiles go to (`--pool-host`, the host field you hand
   out) takes a fresh key's upload from a browser: its CORS preflight allows
   a `PUT` carrying `Authorization`, a missing sig answers 404 (a heap, not a
   page), and one signed `PUT` is stored. These three are WARN, not FAIL: a
   host that does not take a guest's key leaves their tiles live, from their
   own device, while they are in the room.

If it fails:

| Check | Likely cause | Do |
|---|---|---|
| no answer at all | the relay or the tunnel is down | `Get-Service hypercomb-relay, cloudflared`; restart with `hypercomb-relay/fix-relay-elevated.ps1` or `hypercomb-relay/restart-tunnel.bat` |
| 1 shows `false` | the flag is missing | add `--allow-participants` ([hosting-from-a-machine.md](hosting-from-a-machine.md)) and restart |
| 2, time far off | the host's clock is wrong | set the host's time automatically |
| 6 | the apex is stale | fresh installs will run an older package; they tap Update at the door |
| 7 warns | the host does not take a fresh key (not one of its people: operators, bound publishers, `HOST_FRIENDS`) | nothing, if the room may be live — guests' tiles come from their devices while they are here; to keep them after the meeting, add the guests to the host's people, or give the meeting page a publish domain you run |

### Ten minutes before (the facilitator)

1. Open hypercomb.io. Tap the swarm control, type the room and secret (for
   example `meetup` / `4417`) and press Start.
2. Make a page for the meeting and walk into it. A fresh name is empty in
   everyone's hive, so nobody's seeded tiles collide there.
3. Type `/invite`. Paste the link in the group chat and show it on screen.
   Type `>` to go back to making tiles.
   **Facilitating from a loopback hive** (`http://localhost:4250`): the page
   you are on never picks the host (2026-10-11) — a loopback page meets at
   exactly the host a hypercomb.io page would with the same field or list.
   Name the host everyone meets at; the dev relay `ws://localhost:7777` is
   dialled only when you name it (the meeting-point field, `/use-live-relay
   <room> <secret> ws://localhost:7777`, a relay list), and a room there is
   another room — even when `jwize.com` tunnels to the same relay. There is
   no pre-filled dev secret any more: type one.
4. The line reads "Live · meetup · {words} · {host} — you're the first one
   here · Invite". Everyone in the room reads the same words AND the same
   host; a different host beside the same-looking room is a different room.

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
  from the author's host (named on their layer events; hypercomb.com on a
  fresh install), so this works after the author has left.
- Tiles you had before the meeting stay private. Each page you arrive on in
  the meeting asks once, after the page has been announced: "Share the 12
  tiles on this page with downtown?" [Share] [Not now] (jwize 2026-10-10,
  `sharing/share-ask.worker.ts`). Share offers exactly those tiles, tile by
  tile; their contents stay private. Not now, closing the line or letting it
  time out changes nothing, and that page is not asked again in this meeting,
  a reload included (the tab's sessionStorage holds digests of meeting and
  page, never the secret or a name). Another meeting asks again. A line taken
  down before it was answered — you walked to another page, left, or the tab
  went to the background — uses nothing up: the page asks again when you are
  back, and no line is ever shown to a tab nobody is looking at. Pages with
  nothing private, the sets page, collection items and tiles you hid are
  never asked about.
  "Share" on the status line still offers the page's private tiles after one
  confirmation, and the globe on your own tiles does the same for one tile.
- Wifi drop, phone lock, app switch or reload: nothing to press.

### After

Nothing to delete. The pages' hosts keep the bytes, and the relay's events
expire by themselves.

## What each status line means

The English wording is shown; the catalogs in `hypercomb-shared/i18n/` hold
the exact text in every language. The upload lines name `{host}`, the host
THIS page's tiles go to (the share status's `host`); the connection lines
name the relay.

| Line | Meaning | Do |
|---|---|---|
| Live · {room} · {words} · {meeting host} · {n} in the room ({m} here) | connected. Badges: solid here, dim elsewhere, hollow away. The host beside the words is where the room meets (never the page's domain) | nothing |
| Live · {room} · {words} · {meeting host} — you're the first one here · Invite | nobody else is in the room yet | share the link |
| Connecting to {host}… | the first connect after a join | wait |
| Reconnecting… your tiles are safe | `stalled` or `retrying` after having been open; peers still see your tiles | wait |
| Can't reach hypercomb.com — check wifi or switch to mobile data. Still trying. | no socket for 30 s (the line names the meeting point's host) | change network; a captive portal may be blocking it |
| Sharing {n} | every public tile here is hosted | nothing |
| Sharing {n} · {k} uploading | {k} tiles are name-only while their bytes move | wait |
| {host} isn't taking uploads from guests — the room gets your tiles from this device while you're here | 401/403: the page's host does not take this key (a publish domain, or the host field) — the tiles are LIVE | nothing, for the meeting; to keep them after it, the host adds you to its people (`HOST_FRIENDS`) or a grant |
| {host} is full — the room gets your tiles from this device while you're here | 429 or 507 — the tiles are LIVE | nothing, for the meeting; the host frees disk; per-key and per-IP caps reset within 24 h |
| A picture is too large for {host} | 413: over the host's per-file limit | use a smaller picture |
| Can't upload to {host} right now — others see your tile names only | no answer or 5xx (also a Worker past its daily cap) | wait; it is retried |
| No host keeps your tiles — the room gets them from this device while you're here | no publish domain and no host field: the LIVE swarm — your tiles are whole and takeable, and leave with you | nothing; to keep them after you leave, enter a host that takes your key |
| {k} tiles include content this device doesn't hold | taken content that is neither here nor on the host | nothing; those tiles stay name-only |
| {k} of your tiles here are private · Share | tiles from before the meeting | tap Share to offer them |
| Your device clock is far off — set it automatically | the relay refused the clock | turn on automatic time |
| Live · slow connection | the open socket is answering late (under 2.5 s of a stalled probe) | nothing; past the probe deadline it reads Reconnecting |
| Sending… | this page's newest word has gone 3 s without the relay's OK; you are not counted "here" until it is taken | wait |
| {host} needs the current meeting link — ask for the newest one · Enter the new code | 4401: the meeting point's access code was recycled (down tone at once, never "check wifi") | get the newest link, or type the new code |
| This link meets at {relay}, a computer's own relay — this page can't reach it | a loopback meeting point opened from a real host | open the link on that computer, or ask for a link to a public meeting point |
| The meeting point stopped taking more listeners — reload this tab | the relay's subscription cap | reload |
| {host} isn't taking uploads — {n} tiles stay names (· did you mean {other}?) | the gate's `held`: the host in the way of these tiles, refused / never answered / too large / full | a typo: fix the branch's publish domain; otherwise another host |
| {host} isn't taking the deeper pages of {n} tiles — they open from your device while you're here | `held` with `deep`: the tiles can be taken, their deeper pages stay here | stay in the room until they upload, or give the branch a host that takes them |
| {n} names only — not queued | name-only tiles nothing is uploading (a hole, a seal that never resolves) | nothing to wait for; the content is not held here |
| {host} passed over — it isn't taking uploads | the host field or a branch's publish domain gave a standing answer (D2); the tiles went to the next door, or live | check the domain's spelling, or remove it |
| Deeper pages open from {name}'s device while they're here | a receiver: a branch here is takeable, its deeper pages only on its sharer's device (still uploading, or live) | open them while {name} is here |
| {node} refused the upload ({reason}) — nothing was published | a publish whose nodes all refuse what they lack | the node adds the flag or a grant; or publish elsewhere |
| {n} people need to tap Update to share | peers on an older package | tell them |
| Only {name}'s tiles · Show everyone | a badge was tapped, so the canvas is filtered | tap Show everyone |
| "{text}" isn't a command — say "create {text}" to add it as a tile, or type > on an empty line to make tiles | a command line with no action; the text is kept | type `create {text}`, or `>` alone on the line |

## Two tabs of one hive (D10)

Two tabs of one hive both keep writing; neither silently loses a change.

- core `writeLayerMarker` refuses a marker name that exists with a named
  `MarkerExistsError`. `commitLayer` refuses with `StaleHeadError` — after
  re-reading the head from disk — when its marker name is taken, when a cold
  name scan finds a bag max past the head it built on, or when the caller's
  base marker (the optional `{ marker }`, from `history.headMarkerOf(loc)`)
  has moved.
- `LayerCommitter` runs each task through a rebase: on `StaleHeadError` it
  runs the change once more on the fresh head; a second refusal shows one
  toast ("Another tab of this hive changed this page at the same moment —
  your change was not saved. Try it again.") and rejects.
- Every marker write is announced on `BroadcastChannel('hc:history')`. Other
  tabs re-read that head (`revalidateHead`, one directory read), emit
  `history:head-external`, and reconcile the page on screen through the
  `cell:added` / `cell:removed` diff. A tab coming back into view revalidates
  its current page. Deletes and archives are not announced; another tab meets
  them at its next commit there.

## Pictures: the large copy (D3)

A dropped, pasted or captured photo's LARGE copy is never the raw file: it is
re-encoded as WebP with its long edge at most 2560 px (a 12 MB photo stores
at most about 2 MB), and the small hex pictures are taken from it. The
re-encode is also what strips the photo's EXIF — the GPS of where it was
taken — so a picture this engine can draw is ALWAYS stored re-encoded, even
one already within the edge whose re-encode is no smaller. Kept as it came
only: a picture the engine cannot decode or draw, and a GIF within the edge
(its animation). Safari cannot encode WebP: a photo becomes a JPEG and
anything that may carry transparency the shrunk PNG. The tile editor stores
the large copy of a new picture and divides its framing scale by the shrink
ratio, so the crop on screen is the crop saved. A device out of space says so
once ("This device is out of space — the last change was not saved"); a
picture that cannot be added says so too.

## Rolling it out

Order: relay, then shell, then the essentials stamp, then apex staging.

**The 2026-10-10 long tail (D9):** publish the essentials revision AND deploy
the shell before anyone hands out a meeting-point or coded link — essentials
built from it import core's `canonicalZoneText`, which a shell with an older
`/core` refuses by name, and the update-door fallback for older packages, the
blocked-storage card and the canonical zone text reach nobody until both are
out. relay.js changes (two buckets, verified answer runs, carried beacons,
the access-file read, the heir rule) are a restart, by the owner, outside a
meeting; an un-upgraded relay ignores the beacon tag, and a PUT without it
behaves as before. Never put an access code on a shipped default relay
(D8): packages from before the access ladder (87383624, 75007af2) redial it
13 times a minute. Since 2026-10-11 the shipped default is the OPEN
always-online meeting point `wss://hypercomb.com` (below); packages from
before that keep dialing `wss://jwize.com`, uncoded, until they update.

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

The relay goes first. Since 2026-10-11 a participant whose host does not take
their key is LIVE — their tiles are whole, from their device, while they are
here — so a relay without the flag no longer leaves anyone names-only; the
flag (or the host's people) is what keeps a guest's tiles after the meeting.
Packages from before 2026-10-11 still seed the hosts pool and still upload to
it until they update. Check that the host you hand out takes a fresh key's
signed PUT when it should (`node scripts/swarm-preflight.cjs --pool-host
<host>`), and mind the Workers daily cap (above).

Rollback:

- Relay: remove the flag and restart. Guests' tiles go live from their
  devices, with "{host} isn't taking uploads from guests — the room gets
  your tiles from this device while you're here".
- Essentials: re-stamp the previous package, then re-stage the apex.
- Shell: revert on main.

## Reads name an address

THE SIGNATURES ARE THE ONLY THING THAT CAN BE QUERIED. relay.js and the
always-online meeting point (below) answer the same way:

- **A read names its addresses.** Every REQ filter names `#x` 64-hex
  signatures (relay.js also takes exact `ids`); anything else — kinds only,
  authors only, `{}`, a word, a malformed filter — is `CLOSED restricted:` or
  `invalid:`, with nothing replayed and nothing heard live. A read costs the
  index at its address, never a walk over the store. Caps: 10 filters and 16
  addresses per REQ, 256 live addresses per connection. The mesh refuses to
  read or write at anything but a signature itself (one warning per word),
  and a doctrine ratchet forbids a word written into essentials as a mesh
  address.
- **A write names a signature too.** An event whose `x` is not 64-hex is
  refused `restricted:` — bar the drained word below, for the broker's ask
  and cancel (kinds 20400, 20402) only.
- **`hc:live`**, the liveness probe, is answered EOSE and is never stored or
  routed.
- **`broker:fetch`**, the content broker's ask word on builds before the
  room-scoped channel, is ROOM-SCOPED while those builds drain: an event on it
  reaches a subscriber only when both connections are in one room, and
  nothing on it is replayed. A connection is in the room of its own newest
  unexpired `{alive}`, published on THAT connection — one room at a time, and
  nothing else places it there: not a key that spoke on it (anyone can replay
  a member's signed note, and that once put a stranger in the member's room)
  and never a subscription. An ask sent before the connection's first beacon
  (a first join, or an older build flushing its queue on a reopen) is held,
  16 per connection for 3 s, and routed the moment it beacons.
- **The card says so.** The `hc:host` card carries `addressed: true` only
  where all of the above holds. The content broker copies its asks onto the
  word for older builds only while an older build has been heard asking in
  the room (2026-10-10: being on an addressed relay no longer copies every
  ask, which doubled a picture-heavy page's frames). NIP-11 `limitation`
  names `max_addresses`, `restricted_writes` and `access_code`.
- **HTTP reads have one spelling.** relay.js serves a path only as written
  in its canonical form: no `.`/`..`/`//`/`%2e`, no dotfile at any depth, a
  signature segment only in lowercase, no `:` (a Windows stream such as
  `<dir>::$INDEX_ALLOCATION`), no `~` (an 8.3 short name such as
  `RECEIP~1`), no trailing dot or space — and the file the OS opened must
  have exactly the asked path as its real, case-exact long path. Anything
  under a directory that is not a listed pool answers exactly as an absent
  path, so a 404 tells nobody which bags a host holds.

### The access code on relay.js

relay.js can be a meeting point behind a code too (the always-online one is
below). Only `sha256(code)` is ever on disk:

```bash
node relay.js --new-access-code ./access-codes   # prints a fresh code ONCE, writes only its hash
node relay.js --port 7777 … --access-codes ./access-codes
node relay.js --destroy-access-codes ./access-codes   # empties the file: nobody is admitted
```

- `--access-codes <file>` (or env `ACCESS_CODES`) names a file of
  `sha256(code)` lines. A dial carries the code as the subprotocol
  `hc-access.<code>`; one without a listed code is accepted and closed
  **4401** before any frame, the card included.
- **Recycling** is `--new-access-code` again: the new code in, the old one
  out. The running relay re-reads the file every second and on every
  upgrade, and closes any session admitted under a hash no longer listed
  within a second or two — no restart, no redeploy. A missing file admits
  nobody. A read that FAILS (the file held by another process, a sync tool
  mid-write) changes nothing and is retried the next second; a hash is added
  at once, but leaves only when the file says so twice, at least 500 ms
  apart (an editor that truncates before it writes never closes the room).
- A coded relay takes uploads only from keys live on its OWN admitted
  sockets: a beacon carried on a PUT (D7) is never accepted there.
- Without `--access-codes` the relay echoes the offered subprotocol (a
  browser needs that to finish the handshake) and ignores the code — the
  home relay stays open as it always was.

## The always-online meeting point

jwize, 2026-10-09: "we need a host to use that is always online", and "just
allow an access code that can be recycled". Then, 2026-10-11: "we can't rely
on my computer being on that is ridiculous for my setup" → "yes, open default
on hypercomb.com, go ahead". One worker, two kinds of host, each in a
script of its own, no machine under either:

- **`wss://hypercomb.com` — THE SHIPPED DEFAULT, OPEN.** Every install dials
  it (nostr-mesh `LIVE_RELAY`; the public install names only hypercomb.com).
  No access code, ever (D8). An offered `hc-access.*` subprotocol is echoed
  and ignored, so a tab still carrying a code from an old link joins. It
  keeps every other rule: the address gate, the per-connection budgets, the
  address caps, a store that evicts rather than refuses presence — and what
  one stranger may hold is bounded (below). Its byte host is the
  hypercomb.com apex's worker: entered as the host field, `wss://hypercomb.com`
  uploads to `https://hypercomb.com`, which keeps bytes only for its people;
  a stranger's tiles there are live from their own device (2026-10-11 — the
  card decides nothing, and no pool is seeded). Packages from before 2026-10-11 keep
  dialing `wss://jwize.com` until they update; an operator can still name any
  relay (their own list, `/domain`, a meeting link).
- **`wss://pluginthematrix.com` — CODED, for private meetings.** A meeting
  link names it; behind the recyclable access code below, unchanged.
- **Never one script.** The same `worker.js` is deployed twice:
  `hypercomb-meet-open` (`wrangler.meet-open.toml`, `MEET_OPEN_HOSTS =
  "hypercomb.com"`) and `hypercomb-meet` (`wrangler.meet.toml`, no open host).
  `pluginthematrix-core` sends a host in its `MEET_OPEN_HOSTS` to the
  `MEET_OPEN` binding and nowhere else, and a host in `MEET_HOSTS` to `MEET`.
  Durable Objects of one class in one script may share an isolate — one event
  loop, one 128 MB — so two object names alone could not stop an open herd
  slowing a private meeting's frames, or an open object pushed past the
  isolate's memory taking the private meeting down with it. Two scripts never
  share an isolate. Inside each script the router still asks the host: a host
  is open only when that script's `MEET_OPEN_HOSTS` names it exactly, open
  hosts go to `idFromName('open')` and coded ones to the object they always
  had (`idFromName('meet')`, so its stored code survives) — so even a crossed
  binding could not put an open dial in a coded meeting. The recycle path is
  the coded host's alone: at an open host it is 404 before any object.
- **The card page stays Azure's.** hypercomb.com is an `ORIGIN_HOSTS` apex:
  `pluginthematrix-core` hands the meeting point only the upgrade, the NIP-11
  answer (`Accept: application/nostr+json` at `/`) and
  `/.well-known/hc-meet/*`. A browser asking for `/` still gets the host card
  from the origin, and writes stay the worker's.

- **What it is.** A memory-only relay in ONE Durable Object per script —
  `hypercomb-meet-open` and `hypercomb-meet` (`hypercomb-relay/meet-worker/`).
  It speaks what the swarm
  speaks to relay.js: the `hc:host` card first, NIP-01/33 slots, NIP-40
  expiry, ephemeral kinds, the per-connection budget, soft wills with their
  15 s grace, and the address gate ("Reads name an address" above: the same
  caps, write rule, room rule and ask hold, and the card says `addressed`).
  Reads name a 64-hex `#x` and nothing else, so an `ids`-only filter is
  refused here. `pluginthematrix-core` forwards it
  three things at a meeting host through that host's service binding
  (`MEET_OPEN` or `MEET`): a WebSocket upgrade on any path, the NIP-11 answer
  at `/`, and `/.well-known/hc-meet/*`.
  The bytes stay on that worker: `PUT /<sig>` → R2, under `AUTO_GRANT`. It now
  answers `stored <sig>` for an atom it already holds too, so that is a
  receipt (above).
- **The access code.** A dial carries it as the subprotocol
  `hc-access.<code>`, which costs no extra round trip. The object keeps only
  `sha256(code)`, in its own storage. A wrong, missing or retired code is
  accepted and then closed with **4401** before a single frame. A browser can
  read that close code; it cannot read the status of a refused upgrade. A
  fresh object has no code, so it refuses everyone until its operator sets
  one.
- **The door stands in front of the object.** The one object carries every
  room, and anyone can dial without a code, so the stateless front refuses
  whatever it can before the object hears of it: a dial with no well-formed
  code never reaches it, and a code is checked against the front's own copy
  of the hash in force, asked of the object at most once a second per
  isolate. A flood of dials costs the meeting one question a second. The
  object still checks every dial it is handed (the copy may be a second
  behind a recycle).
- **Recycling** (becoming-a-host.md, "Keys are recycled"). Run
  `node scripts/recycle-code.mjs` from `meet-worker/`:
  - It makes a 192-bit code locally.
  - It takes an operator key (nsec or hex) at a hidden prompt or on stdin,
    signs once, and keeps the key nowhere.
  - It posts only the hash, NIP-98 signed with the method, URL and body hash
    bound. Only keys listed in `OPERATOR_KEYS` are accepted, and each recycle
    must be newer than the one in force.
  - It prints the code and a meeting link (the relay written as its full
    `wss://` URL, so an older package refuses the link instead of joining
    the wrong place).

  **`OPERATOR_KEYS` is a key made for recycling alone, never the
  publisher's.** A recycle key is typed or piped in every time, so it lands
  where routine things land (shell history, a clipboard manager), and the
  publisher key signs `install:essentials` — what every fresh install and
  every floor move runs. `wrangler.meet.toml` ships it empty (every recycle
  refused, the door shut), and `recycle-code.mjs` refuses the publisher key
  outright.

  The new code works the moment it is stored. Every socket that came in on
  the old code is closed with 4401, and each of those participants' wills
  waits out its grace like any dropped socket. There is no restart and no
  redeploy. `--close` destroys the code with no successor.
- **The store makes room; it never refuses presence (2026-10-10).** The
  object counts each event as its JSON plus 600 bytes (what it really costs
  the heap) within 64 MB. Full, it EVICTS instead of refusing: broker answers
  first, oldest first; then other kinds, soonest-ending first (to the
  minute — a full sort per event cost 75 ms at 50k entries); presence slots
  last and only to make room for presence. Presence (30206, 30200, 30204,
  30208) is never refused while anything can be evicted, and the last 1/16
  of the store (4 MB) is theirs alone. The minute line counts `evicted N`.
  Broker answers are kept as relay.js keeps them (above): 15 minutes, one
  holder's verified whole run per address. Each connection has a bulk and a
  control bucket, and a broadcast serializes its event once.
- **What one stranger can hold (2026-10-11, the open default).** With no
  code in front of it, nothing one sender does — from one address, on one
  connection, inside its own budget — may fill the store, pin it, outlast a
  real beacon or hold the isolate's memory (`meeting.js`). Both scripts run
  the same rules; the code was never the barrier for these, since every guest
  of a coded meeting shares one.
  - **Nothing is kept for good.** Every kept event's stored life has a
    ceiling, whatever expiration it carries or lacks: presence 5 minutes (the
    swarm beacons a 90–120 s life; a will's tombstone lives 300 s), any other
    kind 7 days (the longest a shipped client asks: feedback items and the
    install roster; resource bytes ask a day). So every event is evictable,
    and a far-future beacon outlasts a real one by minutes at most.
  - **One source's share.** Each kept event is charged to its source — the
    sender's IP, IPv6 by its /64. One source holds at most 1/8 of the store
    (8 MB): past it, its OWN oldest events make room (its answers and other
    kinds first; its presence only for its presence), never anyone else's.
    One machine can never make another participant's beacon come back full.
  - **Too large to keep.** A non-bulk event over 128 KB is fanned out live and
    never kept (and the publisher's older copy in that slot goes). Bytes ride
    the bulk kinds, which may be up to the 512 KB frame.
  - **Sockets.** One source holds at most 32 sockets at once; the object at
    most 2,500, routing at most 50,000 subscribed addresses in all (about 350
    bytes of heap each). Past a ceiling a dial is accepted and closed **1013**
    (busy) before a frame — the client's ordinary ladder redials, never the
    access ladder — and a REQ is `CLOSED error: the meeting point is full`.
    The minute line counts `dials N`. Refused, never the isolate's 128 MB,
    which would drop every room at once.
  - **Only a frame that pays is hearing.** A `CLOSE`, a malformed frame or a
    refused one never keeps a socket from the 120 s idle reap; the liveness
    probe every client already sends (a REQ) does. A connection keeps the
    wills of its 16 newest lifecycle slots at most.
  - **In front of it, at the edge:** a Cloudflare rate-limiting rule on
    WebSocket upgrades at `hypercomb.com` (deploy step 4) caps how fast any one
    address can dial, before a request reaches either worker.
- **A failed door question never shuts the door.** When the front's question
  to the object fails (a rejected fetch, a non-OK status, non-JSON), the
  answer is `unknown` and the dial is forwarded to the object, which checks
  the code itself; 4401 at the front only on a hash the front actually holds.
- **D8: the deploy waits on these (code gate met in this branch).** The
  `hypercomb-meet-open` and `hypercomb-meet` deploys and their bindings below
  are the owner's act; until then the always-online point does not exist.
- **A reset is a relay restart.** While anyone is connected, a sweep timer
  keeps the object in memory. It runs expiry, the 120 s idle reap (a Worker
  cannot ping) and the minute line. If the object is evicted or redeployed,
  every socket closes (or gets 1012 if the object wakes without its memory).
  The client's reconnect ladder brings the room back, and heartbeats refill
  the slots. Wills pending at the reset are lost, and NIP-40 expiry covers
  them.

**Deploy, in this order** (not yet run; deploy from a clean copy once this
work is merged). The open default (2026-10-11) raises the stakes of the
order: an essentials revision naming `wss://hypercomb.com` must not be
published until step 5 checks out, or its installs meet nobody.

1. `cd hypercomb-relay/meet-worker && npm ci && npm run deploy:open`
   (`wrangler deploy --config wrangler.meet-open.toml`) creates
   `hypercomb-meet-open`: the `MeetingPoint` class, its SQLite migration and
   `MEET_OPEN_HOSTS = "hypercomb.com"`. No route, no workers.dev address, no
   key — the open default has no code.
2. For private meetings: make a recycle-only key, put its PUBLIC half in
   `OPERATOR_KEYS` in `wrangler.meet.toml`, and `npm run deploy`
   (`wrangler deploy --config wrangler.meet.toml`) creates or updates
   `hypercomb-meet`, the coded point. It names no open host. Skip this step
   for an open-only launch; the coded binding then stays commented out.
3. In `blossom-worker/wrangler.pluginthematrix.toml`, uncomment the three
   `[[services]] MEET_OPEN` lines (and, after step 2, the three `MEET` lines).
   `MEET_OPEN_HOSTS = "hypercomb.com"` and `MEET_HOSTS =
   "pluginthematrix.com"` are already there, inert without their bindings.
   Then `cd ../blossom-worker && npm run deploy:pluginthematrix`. The bindings
   ship commented out on purpose: a deploy naming a script that does not
   exist yet is refused whole — every site change and every
   `npm run connect` with it. The hypercomb.com apex needs no new route or
   DNS record: its zone route `hypercomb.com/*` already reaches this worker
   over the proxied `A` record, and `/` runs the worker first. The zone's
   Network → WebSockets setting must be on (Cloudflare's default).
4. In the hypercomb.com zone (dashboard → Security → WAF → Rate limiting
   rules), add one rule that counts dials per IP: requests to `hypercomb.com`
   with the `Upgrade: websocket` header where the zone's plan can match a
   header, else requests for the path `/` (a browser asks for `/` once per
   page view), on the order of 10 per 10 seconds, action Block. A client
   redials at most every few seconds on its ladder, so no real tab comes near
   it; a dial flood then stops at the edge before either worker runs. Which
   fields and periods a rule may use depends on the zone's plan (from memory,
   not checked: the free plan has one rule with a 10 s period) — check the
   dashboard.
5. Check the open default: `curl -H 'Accept: application/nostr+json' https://hypercomb.com/`
   names `hypercomb-meet` (version 0.2.0) with `access_code: false`; a plain
   `curl https://hypercomb.com/` is still the host card; and
   `node scripts/swarm-preflight.cjs` (its default is now
   `--relay wss://hypercomb.com`) passes `ws`, `card`, `policy`, `probe`,
   `scan`, `unsigned`, `beacon`, `store`, `serve` and `reserved` (any 4xx
   here: the byte host refuses before auth or by content address), the
   `pool-*` checks and `apex`, and SKIPs `not-live` and `no-store` (relay.js
   rules) — "ready to host a meeting".
6. After step 2: `node scripts/recycle-code.mjs` (in `meet-worker/`) sets
   the coded point's first code; until then that door stays shut. Check it:
   `curl -H 'Accept: application/nostr+json' https://pluginthematrix.com/`
   names `hypercomb-meet` with `access_code: true`, and a dial with a
   made-up code closes with 4401.
7. Only now publish the essentials revision and deploy the shell that make
   `wss://hypercomb.com` the default, back to back. Comparing words across
   the move: see "THE WORDS DURING THE MOVE" above — a group should take the
   update before it compares words.

To roll back, re-stamp the previous essentials package FIRST (installs on the
new default meet nobody without the binding), then comment the binding lines
out again and redeploy `pluginthematrix-core`. A dial at either apex then
gets the site, as before. jwize.com's relay is untouched throughout: packages
from before the move keep dialing it.

**Cost on Workers Paid ($5 a month).** These are list prices as the
investigation knew them, not fetched; check the pricing page.

| Item | Included each month | This meeting point |
|---|---|---|
| Durable Object duration | 400k GB-s | About 10,800 GB-s a day per resident 128 MB object, at most 324k a month each. The open default is resident whenever any install is online, so expect it around the clock; the coded object only while a private meeting is on. Both together can pass the included amount (list price about $12.50 per extra million GB-s). Nothing is billed for an object while it is evicted. |
| Durable Object requests | 1M | One per upgrade, plus one per 20 incoming frames (outgoing frames are free). Clients send 9–150 frames a minute, so ten people for eight hours is under 40k a day. At the open default every online install counts, around the clock: about 15 always-on clients fill the included million; past it, about $0.15 per million. |
| Storage | — | One row written per recycle, and nothing else. |
| Worker requests | 10M | One per dial or recycle at `pluginthematrix-core`. |

So expect the flat $5 while the open default is quiet, and a few dollars more
a month once it carries installs around the clock or a private meeting runs
beside it. Observability stays off on both scripts, because a dial's
`Sec-WebSocket-Protocol` header carries the code. Past the socket and address
ceilings above, the next step is sharding the open point by room.

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
