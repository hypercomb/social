# The swarm's host

**Status: DESIGNED 2026-10-04, building on `swarm-bulletproof`; WHICH HOST
amended 2026-10-07.** Owner decisions (jwize, 2026-10-04): a swarm's host
allows participants by default; connection and reconnect speed are never
traded for anything else; the tightest setup wins. And (jwize, 2026-10-07):
"I thought we only use pools but maybe if publish domains take precedence
over pools that would be fine too … but sure on your relay."

Your hosts host the meeting. Joining is enough to share. A tile's name reaches
the room at once, and its bytes follow as soon as its host serves them.
Nothing you shared disappears because you edited it, reloaded, or the upload
is slow.

## The rule

- **Your hosts host the meeting, per page.** The tiles a joined tab offers on
  a page are uploaded, in this order, to:
  1. **the page's publish domains** — the `host:<zone>` marks worn by the
     nearest branch at or above the page, every one of them, primary first:
     the same write doors a publish of that branch uses;
  2. **the meeting host** (2026-10-09) — the host a meeting link names
     (`&host=`), kept in this tab's `hc:mesh-zone.host`. It is the room's own
     choice, so it outranks your pool and is never passed over. Only a link
     that names one sets it: a meeting point typed in the selector names
     none (its domain was a guess, and a relay that takes no uploads would
     have stranded every tile as a name);
  3. **your hosts pool** — the PRIMARY of `community:hosts`: the host you
     added FIRST. A fresh install seeds `hypercomb.com` there, and nothing
     else. Adding a host to follow it never moves where your tiles go;
     removing the hosts ahead of one makes it the primary. A pool host that
     fails this session — it refuses (401/403), is full (429/507), or has
     never taken an upload and stays silent while your relay answers (a page
     where a heap should be, an upload blocked at its CORS preflight) — is
     passed over for the next one;
  4. **the relay you meet at** — only when 1–3 have nothing usable, and
     only when its `hc:host` card says participants `all` or `zones`. A
     relay that sends no card hosts nobody.

  The relay is never the host merely because it is where you meet: that made
  one person's relay everyone's host. Publish domains are never passed over:
  they are your choice for that branch, and the status line names their
  refusal instead.
- **A tile goes where its page goes; a branch's subtree goes where ITS pages
  go.** A tile offered on a page is uploaded to that page's hosts, and its
  children to the hosts of the page one step down, and so on. So a branch that
  wears its own publish domains keeps its subtree on them even when it is
  shared from the hive root: only the branch tile itself goes to the root
  page's host.
- **Hosting stays the truth.** No signature is ever announced that no host
  serves. Taking a tile still needs hosted bytes.
- **Names before bytes.** Until a tile's host serves it, its name goes out
  without signatures. Peers see a label tile they cannot take yet.
- **Never retract.** A shared name leaves the room only when you delete it,
  move it away, make it private, leave, or go silent past your 90 s slot.
- **Membership is per tab.** Only the tab you joined in shares. A second tab
  cannot silence it.
- **The socket says what it is.** A dead connection is found within seconds
  and replaced, and the status line shows the real state.

## What this amends

- **The meeting point hosts the meeting (2026-10-04)** — this document's own
  first rule. The relay a joined tab dialled was also where it uploaded
  (`wss://jwize.com` meant `https://jwize.com/<sig>`). Since 2026-10-07 the
  relay is the LAST resort (see the rule above): publish domains first, then
  your hosts pool. Everything else that rule brought stays — names before
  bytes, never retract, receipts per host, honest reasons, the 4-wide drain,
  per-host back-off.
- **Sharing requires hosting (jwize, 2026-09-25)** —
  [resource-offload-relays.md](resource-offload-relays.md), "Availability
  gate". The rule stands: no signature is announced that no host serves. What
  changes is who hosts: the page's hosts do, so joining is enough. "No host,
  no share" narrows to "no host, no bytes". A tile's name goes out at once; its
  signatures go out when a host serves them.
- **Join offers what your host serves (2026-09-25)** —
  [deployment-stages.md](deployment-stages.md). Joining now offers every tile
  you make public while joined. `publish here` is not part of swarm sharing.
  It stays the act that publishes a creation, and it stays refused at root.
- **"Watching only — set a host in /hosts."** Gone. Watching needs nothing.
  Sharing needs a host that takes your bytes; a fresh install has one.
- **"The relay no longer hosts other participants' bytes" (2026-06).** A
  relay's HTTP half may host allowed participants, and is used when you name
  no host at all. Events stay memory-only. There is still no temp pool: bytes
  land flat at `/<sig>` in the same heap and are kept like any other atom.
- **The guest recipe of 2026-10-04** (`/join`, `>`, pick a host in the Publish
  panel, `publish here`). Retired. A guest taps the meeting link and presses
  Join.
- **Consent for swarms** — [consent-hosting.md](consent-hosting.md). For a
  swarm, consent is the hosts you already chose (or a relay's standing allow)
  plus the join sheet, which names the host. No request or grant event is
  sent.

This is not the 2026-09-24 "sharer is a host while present" relaxation coming
back. That rule re-uploaded whole hives and announced bytes nobody served once
the sharer left. Here only signatures that carry a `.public` marker are
uploaded, and they go to a host's disk, so they are still served after the
sharer leaves.

## Which host: resolved per page, never picked

- `hypercomb-essentials/src/sharing/swarm-hosts.ts` answers "where do this
  page's tiles go?" in the order of the rule above. It is **synchronous and
  reads caches only**: the pool list (refreshed on `hosts:render`, which the
  hosts drone emits after every read, add and remove), each branch's host
  marks (refreshed on `hosts:marks-changed`, which `setBranchHosts` emits
  once its marks have committed, and on `decorations:changed` for a branch
  it remembers), and the relay's card (refreshed on `mesh:host-card`). A miss
  kicks a local read and answers *pending* (no host yet); the read landing
  re-drains and walks the page again. Connect, join, resubscribe and announce
  never wait on a pool or layer read, and nothing here touches the network.
- An empty pool is believed only from a read the resolver made itself with
  the store open (the read waits for the store's OPFS root to open), and only
  once the hypercomb.com seed has landed: before it, empty is unknown. A
  branch's marks read cold (the store root still coming up on a reload) or
  with a decoration record this device does not hold yet are unknown too —
  read again on their own every second — never "no publish domains".
- `hosts:render` is a signal to read the pool again, not the answer (its list
  is alphabetical); returning to the tab re-reads the pool and the most
  recently used branches, so a change made in another tab takes effect.
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
  a second page with another host, a pool that changes, a branch given a
  publish domain, a pool host passed over for the relay — the offered roots'
  closures are walked again IN MEMORY over the recorded edges, and every sig
  that host lacks a receipt for, and that is no longer queued, is queued
  again from the local bytes (re-staging). A pair proven once is never asked
  again.
- The targets follow from things that already survive a reload, a discarded
  tab and the Update pill: the pool, the branch marks, the saved relay list
  and this tab's `hc:mesh-session`. Receipts on disk (`sign('host-receipts')`,
  `{sig}.{hostHash}`) count again, so the first walk after a reload
  republishes the same full entries. A pool or publish host also honours
  receipts earned on its zone's retired `content.` face; the relay's own heap
  has none.
- A write door is a zone root, never a `content.` face. A zone you named (a
  pool host, a publish domain) may carry a port, as `hostZone` keeps it; the
  relay's host may carry one only when it is loopback (the harness relay). A
  loopback host is skipped as an upload host on a page that is not itself
  loopback — nobody else can reach it — and the next source answers.
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
- The share gate judges each part of a closure where it is SHOWN
  (`isClosureAvailableAt`): the tile by the page's hosts, its subtree by the
  hosts of the pages below, plus your self-domain while its backup is on. So
  a receipt on some other target never announces a handle the receiver is not
  told where to fetch. A page on the way still being read is UNKNOWN, never
  "no": the walk says nothing for that page — the relay keeps the slot it
  had — and walks again when the answer lands, for at most 5 s.
- When the set of targets changes, cached "not available" answers are checked
  again.
- A tile made private while its upload waits out a backoff never reaches the
  host, and a leave ends the offer — `.public` markers on disk never carry
  bytes into the next room. The public CDN and publish nodes keep the plain
  marker rule (a swarm host that is also one of them is owed every marked
  sig).
- The publish gate asks the nodes it publishes to (`isClosureAvailableOn`),
  never a swarm host: a receipt there says nothing about the node whose index
  is about to name the branch.

### hypercomb.com as the default host: what it is today, and the Workers cap

A fresh install's pool holds only `hypercomb.com`, so unless a participant
adds a host, or the page wears publish domains, every newcomer's pictures are
offered there first.

**Today the apex is not an upload door.** `hypercomb.com` itself is still the
Azure static site (`A hypercomb.com → Azure`; its worker route is commented
out in `wrangler.pluginthematrix.toml`, `routed:false`): it answers every
`/<sig>` with a 200 HTML page and its CORS preflight allows only GET, HEAD
and OPTIONS. Only `*.hypercomb.com` reaches the worker. So a newcomer's first
upload to it fails, the drain passes it over after its second silent wave
(about 2 s), and their tiles go to the relay they meet at — when its card
allows participants. Run the meeting relay with `--allow-participants` until
the apex is routed.

**When the apex is routed to the worker**, mind its free cap: the Workers
Free limit of **100,000 requests a day is per ACCOUNT**, shared by every zone
the `pluginthematrix-core` script serves — pluginthematrix.com,
realones.online, cafesociety.buzz (another publisher's site),
pointblanksolutions.ca, `*.hypercomb.com` and `*.jwize.com`. Past it every one
of those sites stops answering until UTC midnight, not only the meeting.
Each new sig costs the worker THREE requests to upload — the HEAD (does it
hold the sig already?), the CORS preflight (`OPTIONS`: a PUT carrying
`Authorization` is never a simple request, and every sig is a new URL) and the
PUT (the worker answers `201 stored <sig>`, so there is no read-back GET) —
plus one GET per receiver per sig. Ten people with 50 tiles of two sigs each
is about 3,000 upload requests and up to 9,000 reads: a handful of meetings
on top of normal traffic reaches the cap (automation alone hit 111k on
2026-08-28).

Before making hypercomb.com every newcomer's working upload host, do one of:

- move the account to Workers Paid (10 million requests a month, no daily
  cliff);
- seed a default host that is not on the shared worker;
- or keep the apex unrouted and run the meeting relay with
  `--allow-participants` — the pool host is passed over and the relay hosts
  the meeting, as it did before 2026-10-07.

For one meeting, give the meeting page a publish domain (`host:<zone>`) that
is a host you run — a machine running the relay with `--allow-participants`,
or `hypercomb-serve` — and its tiles go there instead.

Receipts keep the cost to one round of requests per sig per host: a sig the
host already serves is never sent again, and a reload re-asks nothing. Readers
ask a sig's advertised host alone first (above), so a meeting hosted elsewhere
costs the apex nothing.

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
- Joining is the participant's consent. The join sheet names the host the
  invited page's tiles go to ("…kept by hypercomb.com" on a fresh install).
  The `.public` marker gate is unchanged, so private tiles, the clipboard and
  settings never reach any host. In a joined tab, only signatures that carry
  a `.public` marker are queued for upload.
- A relay's policy matters to a participant only when they name no host at
  all (empty pool, no publish domains): then a relay that allows participants
  is their host, and one that does not leaves them names-only, said as "No
  host keeps your tiles yet".

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
(uploads in flight). Back-off resets on success, and on a socket that comes
back — the first open after a join, or the one `reopened` payload; a stall
answered late is not a return. A 409 answers only a PUT at a reserved address,
which a tile's bytes never are. Each receipt the swarm host earns is announced
at once as `host:receipt` {sig, host, swarm: true}, so a second, refusing
public-only target can never hold the room's tiles name-only. A reopened
socket resets the relay's pause when the relay is a swarm host, and any other
swarm host's only when it was `unreachable` or `not-live` — the path came
back; a refusal or a full host keeps its window. A POOL host that refused, is
full, or never took an upload and stayed silent while the relay answered is
also passed over for the session (see the rule): the next pool host, then a
relay that hosts participants, takes the page. A pool host passed over while
the socket itself was down gets its chance back with the socket; any other
only when the pool changes, `enable()` or `reDrain()` is called, or it serves
a receipt. `swarm:share-status` names the pool hosts passed over
(`passedOver`).

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
  host, hosts, hostSource, hostState, reason}: WHICH host this page's tiles go
  to, why that one (`publish`, `pool` or `relay`), and what it last said —
  `no-host` when nothing hosts them. `sync:state` carries the same `source`
  for every swarm host.
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
- The fragment never reaches a server. The shell moves it into
  `sessionStorage['hc:pending-meet']` and strips it from the address bar.
- Opening it shows one sheet: "Join the room 'meetup'? You'll see everyone
  here. Tiles you add while joined are shared with the room and kept by
  hypercomb.com." [Join] [Not now]. The host named is where the invited
  page's tiles will go for THIS guest (their publish domains, else their pool,
  else a relay that hosts participants). On a first visit those are still
  being read when the link opens, so the sheet waits for them — local reads
  only, at most 1.5 s; with none known by then, it names no host. A pool host
  that turns out not to take uploads is passed over afterwards, so the bytes
  may end up on the relay the sheet did not name.
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
   stamped `install:essentials` root;
7. the hosts pool's default host (`--pool-host`, hypercomb.com) takes a
   fresh key's upload from a browser: its CORS preflight allows a `PUT`
   carrying `Authorization`, a missing sig answers 404 (a heap, not a page),
   and one signed `PUT` is stored. These three are WARN, not FAIL: a pool
   host that cannot take uploads is passed over, and the relay (check 1)
   hosts the meeting instead. While the apex is unrouted they WARN.

If it fails:

| Check | Likely cause | Do |
|---|---|---|
| no answer at all | the relay or the tunnel is down | `Get-Service hypercomb-relay, cloudflared`; restart with `hypercomb-relay/fix-relay-elevated.ps1` or `hypercomb-relay/restart-tunnel.bat` |
| 1 shows `false` | the flag is missing | add `--allow-participants` ([hosting-from-a-machine.md](hosting-from-a-machine.md)) and restart |
| 2, time far off | the host's clock is wrong | set the host's time automatically |
| 6 | the apex is stale | fresh installs will run an older package; they tap Update at the door |
| 7 warns | the pool's default host cannot take uploads (today: the apex is Azure) | nothing, if 1 passes — fresh installs fall to the relay; otherwise give the meeting page a publish domain you run |

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
| Live · {room} · {words} · {n} in the room ({m} here) | connected. Badges: solid here, dim elsewhere, hollow away | nothing |
| Live · {room} · {words} — you're the first one here · Invite | nobody else is in the room yet | share the link |
| Connecting to {host}… | the first connect after a join | wait |
| Reconnecting… your tiles are safe | `stalled` or `retrying` after having been open; peers still see your tiles | wait |
| Can't reach jwize.com — check wifi or switch to mobile data. Still trying. | no socket for 30 s | change network; a captive portal may be blocking it |
| Sharing {n} | every public tile here is hosted | nothing |
| Sharing {n} · {k} uploading | {k} tiles are name-only while their bytes move | wait |
| {host} isn't taking uploads from guests — others see your tile names only | 401/403: the page's host does not take this key (a publish domain, or the last host left to try) | the host adds the flag or a grant; or make a host that takes your key the first in Hosts |
| {host} is full — others see your tile names only | 429 or 507 | the host frees disk; per-key and per-IP caps reset within 24 h |
| A picture is too large for {host} | 413: over the host's per-file limit | use a smaller picture |
| Can't upload to {host} right now — others see your tile names only | no answer or 5xx (also a Worker past its daily cap) | wait; it is retried |
| No host keeps your tiles yet — others see your tile names only | no publish domain, an empty pool, and a relay that does not host participants | add a host in Hosts |
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

The relay goes first. Essentials without it would get 401 on every upload
from a participant whose pool has nothing usable: names only, which is honest
but not shared. Since 2026-10-07 most participants offer their uploads to
their pool's host first (hypercomb.com on a fresh install). Until the apex is
routed to the worker it cannot take them, and they fall to the relay — so the
relay's `--allow-participants` is still what hosts a fresh install's meeting.
Once it is routed, check that it takes a fresh key's signed PUT
(`node scripts/swarm-preflight.cjs --pool-host hypercomb.com`), and mind the
Workers daily cap (above).

Rollback:

- Relay: remove the flag and restart. Participants with an empty pool fall
  back to names only, with "No host keeps your tiles yet".
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
  where all of the above holds, and the content broker copies its asks onto
  the word for older builds only where every relay the tab dials says it
  (`relaysAddressed()`); on a relay without it, only after an older build has
  been heard asking in the room. NIP-11 `limitation` names `max_addresses`,
  `restricted_writes` and `access_code`.
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
  upgrade, and closes any session admitted under a hash no longer listed —
  no restart, no redeploy. A missing file admits nobody.
- Without `--access-codes` the relay echoes the offered subprotocol (a
  browser needs that to finish the handshake) and ignores the code — the
  home relay stays open as it always was.

## The always-online meeting point

jwize, 2026-10-09: "we need a host to use that is always online", and "just
allow an access code that can be recycled". `wss://pluginthematrix.com` is a
meeting point with no machine under it. The meeting link names it; no install
defaults to it.

- **What it is.** A memory-only relay in ONE Durable Object, in its own script
  `hypercomb-meet` (`hypercomb-relay/meet-worker/`). It speaks what the swarm
  speaks to relay.js: the `hc:host` card first, NIP-01/33 slots, NIP-40
  expiry, ephemeral kinds, the per-connection budget, soft wills with their
  15 s grace, and the address gate ("Reads name an address" above: the same
  caps, write rule, room rule and ask hold, and the card says `addressed`).
  Reads name a 64-hex `#x` and nothing else, so an `ids`-only filter is
  refused here. `pluginthematrix-core` forwards it
  three things at `MEET_HOSTS` through its `MEET` service binding: a WebSocket
  upgrade on any path, the NIP-11 answer at `/`, and `/.well-known/hc-meet/*`.
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
- **A reset is a relay restart.** While anyone is connected, a sweep timer
  keeps the object in memory. It runs expiry, the 120 s idle reap (a Worker
  cannot ping) and the minute line. If the object is evicted or redeployed,
  every socket closes (or gets 1012 if the object wakes without its memory).
  The client's reconnect ladder brings the room back, and heartbeats refill
  the slots. Wills pending at the reset are lost, and NIP-40 expiry covers
  them.

**Deploy, in this order** (not yet run; deploy from a clean copy once this
work is merged):

1. `cd hypercomb-relay/meet-worker && npm ci && npx wrangler deploy --config wrangler.meet.toml`
   creates the script, the `MeetingPoint` class and its SQLite migration. It
   has no route and no workers.dev address.
2. Make a recycle-only key, put its PUBLIC half in `OPERATOR_KEYS` in
   `wrangler.meet.toml`, and deploy step 1 again (or set the var on the
   script).
3. In `blossom-worker/wrangler.pluginthematrix.toml`, uncomment the three
   `[[services]] MEET` lines (`MEET_HOSTS = "pluginthematrix.com"` is
   already there, inert without them), then
   `cd ../blossom-worker && npm run deploy:pluginthematrix`. The binding
   ships commented out on purpose: a deploy naming a script that does not
   exist yet is refused whole — every site change and every
   `npm run connect` with it.
4. `node scripts/recycle-code.mjs` (in `meet-worker/`) sets the first code.
   Until then the door stays shut.
5. Check it: `curl -H 'Accept: application/nostr+json' https://pluginthematrix.com/`
   should name `hypercomb-meet` with `access_code: true`. A dial with a made-up
   code should close with 4401.

To roll back, comment the three binding lines out again and redeploy
`pluginthematrix-core`. A dial at the apex then gets the site, as before.

**Cost on Workers Paid ($5 a month).** These are list prices as the
investigation knew them, not fetched; check the pricing page.

| Item | Included each month | This meeting point |
|---|---|---|
| Durable Object duration | 400k GB-s | About 10,800 GB-s a day, at most 324k a month: one 128 MB object resident around the clock. Nothing is billed while the room is empty and the object is evicted. |
| Durable Object requests | 1M | One per upgrade, plus one per 20 incoming frames (outgoing frames are free). Clients send 9–150 frames a minute, so ten people for eight hours is under 40k a day. |
| Storage | — | One row written per recycle, and nothing else. |
| Worker requests | 10M | One per dial or recycle at `pluginthematrix-core`. |

So the expected bill is the flat $5. Observability stays off on both scripts,
because a dial's `Sec-WebSocket-Protocol` header carries the code.

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
