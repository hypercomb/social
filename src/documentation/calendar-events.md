# The calendar — meetings across communities, and who is coming

*jwize, 2026-10-18: "the meetups page must be fully working so we can see the
results and who is attending. This must be done in the hypercomb way." · "we
need a post process for the rsvp registration that retains results in the
hypercomb way." · "join the meeting and calendar. The calendar is just a
scroller for now with the meetings and dates, not an organizer." · "we're
trying to enroll communities … integrate calendars across different communities
… look in pools of meaning across their servers and then pick up the events, so
that's the data source for the calendar."*

**Status: built 2026-10-18** — host (`blossom-worker/worker.js`), hive
(`hypercomb-essentials/src/calendar/`), visitor (`readonly-network.ts`), page
(`scripts/bridge/_meetups-site/`). Not yet promoted to the live worker.

Companions: `pools-across-hosts.md` (one word, one address, every host),
`swarm-pools.md` (a pool member is a signed claim named by its own hash),
`derivations.md` (`attest:<record>` — the index-opens-a-pool pattern this
generalises), `read-only-deployment.md` (what a visitor may do).

## The question it answers

A meetup page is public and its readers are visitors: no account, no key they
keep, a door that is read-only three ways. Yet two things have to be true on
that page: **you can say you are coming**, and **everyone can see who is**. And
a community is not one host — meetups happen in many places, and the calendar
should show all of them.

The answer is a pool of meaning for each question, at a derived address every
host answers, with nothing named and nothing looked up.

## Three records

| What | Where | Member |
|---|---|---|
| **A meeting** | `sign('calendar:events')` on the host that lists it, and on every host that picked it up | the meeting record, named by its own signature: `{ v, kind:'event', title, date, time?, where, series, host, at }` |
| **Who is coming to one meeting** | `sign('rsvp:<meeting sig>')` on the meeting's own host (`record.host`, the door) | one signed claim per person (nostr kind `30568`, tags `pool`, `event`, `name`, `going`), named by the claim's own hash |
| **Which lists are open** | `sign('rsvp:pools')` on that host | the addresses of the lists an organizer opened — so the write and listing routes know one when asked |

`series` is the tile the meeting belongs to (`meetups`); `host` is where its
list lives, which is where to join. The record carries both so a meeting picked
up by another host still says where to join it.

## How a meeting gets on the calendar

The organizer stands on the tile and says one sentence:

```
event 2026-10-24 19:00 at Yaletown, Vancouver on hypercomb.com
```

The `event` word (`calendar/event.queen.ts`) mints the canonical record, holds
it in the hive as a resource, sends the atom to the host, and writes two keys
into the organizer's **own signed index** there:

- `event:<sig>` → `<sig>` — the host adds the record's signature to
  `sign('calendar:events')` (`noteEvents`, the same move as `attest:`).
- `rsvp:<sig>` → `<sig>` — the host adds `sign('rsvp:<sig>')` to
  `sign('rsvp:pools')`: **the list is open.**

A note on the tile says so, so the hive's own history carries the act. The
door for the list is `<tile>.<host>` when the host is a zone
(`meetups.hypercomb.com`), or the host as said.

The calendar is **listed** where its operator lists it, like every other pool
(`hosts list calendar:events @hypercomb.com`). A host that does not list it
answers 404 — "not held", indistinguishable from nothing, as every pool is.

## How a calendar spans communities

A reader's calendar is the union of **one derived address** across the hosts
they carry:

```
for host in [this host, ...community:hosts]:
  GET https://<host>/<sign('calendar:events')>/     → the meetings it lists
  GET https://<host>/<sig>                          → each record, believed only
                                                      when it hashes to its name
union by signature
```

In a hive that is `event list on <host>` (`event-read.ts` `readEvents`): the
host said plus `listCommunityHosts()`, deduplicated by signature — the same
bytes are the same meeting wherever they came from.

A **visitor** may read only the door's own origin. So the door **picks up**
what its community lists (`pickUpEvents`): when its calendar is asked, at most
once a minute, it asks every zone in its own `community:hosts` pool for the
same address, fetches each record it lacks, keeps it in its heap only when it
hashes to its name and is an event, and adds the name to its own pool. The
visitor then reads everyone's meetings from one origin. This is replication by
signature, nothing more: a host that is slow or gone costs its timeout and
never fails the listing. Adding a community to the door's `community:hosts` is
what makes its meetings appear.

## How someone joins

**From the page.** "Join the meeting" asks for a name and dispatches `hc:rsvp`
on the document with the meeting's signature, its host and the name. The
`RsvpDrone` bee (`calendar/rsvp.drone.ts`) hears it, signs the claim with the
shell's own key, and writes `PUT /<sign('rsvp:<event>')>/<claim hash>` to the
meeting's host. It answers `hc:rsvp:done` with the receipt or `hc:rsvp:error`
with the reason. The page keeps its own look; the bee has none.

**From a hive.** `event join 2026-10-24 as Jaime on hypercomb.com` does the
same through the same bee, from your own hive to the meeting's own host.

**On the host** (`putRsvpMember`) this is the one write a stranger may make: no
NIP-98, no grant consumed. The claim's signature is the proof; the pool was
opened by a key the host keeps bytes for; a claim is a few hundred bytes
(≤ 2 KB), the name ≤ 48 characters, `going` is `yes` or `no`, the `event` tag
must derive to this pool, and the pool holds at most 1000 claims. The same
bytes again are already held (200). Everything else is refused by name.

**On the visitor** `readonly-network.ts` admits exactly this shape — `PUT
/<64-hex>/<64-hex>` at the page's own origin — and nothing else: not a bare
atom, not a listing, not another origin, not another verb. The visitor still
keeps nothing between visits; the **receipt** is the claim's own signature,
readable by anyone at `/<pool>/<member>`, and the page offers it as a link to
hold (`?event=<sig>&rsvp=<member>`). That is jwize's "pseudo swarm": you send
your claim to one node of the colony, and you check your result by asking that
node for the thing you sent.

**Who is coming** is read from the pool: every name listed, each claim fetched
and verified (`readRsvp` — hash, kind, pool, event, name, answer, signature),
and each key's **newest claim stands** (`standingRsvps`). Changing your mind is
a new claim with `going: no` from the same key; history never heals, readers
take the newest. On the visitor the key lives for the page, so a change of mind
is for the same visit; the organizer's roll shows the rest.

## The post process: keeping the roll in the hive

The pool on the host is live state. The hive keeps the **result**:

```
event roll 2026-10-24 on hypercomb.com
```

reads the standing claims, writes a roll record (`kind: 'rsvp-roll'` — the
meeting, its host, when it was read, who is coming with their receipts, who
declined) as a resource by its own signature, makes the tile wear it as a
`calendar:roll` decoration (one per meeting on that tile; the newest replaces
its own kind for the same meeting), and files a note: *Roll 2026-10-24 Hypercomb
Meetup: 12 coming — …*. The roll is a layer commit, so history holds every
roll ever taken and undo puts it back. The tile carries the roll with it when
it is published or shared — the attendance travels with the creation, not with
a server.

## The page

`scripts/bridge/_meetups-site/meetups-home.src.html`, built by `build.cjs`
(fills `resource:{file}` with each file's signature) and said into the hive
with `website page {meetups-home.html}`. The page carries no meeting data. It
reads the calendar from its own origin (and, standing in a hive, from
`meetups.hypercomb.com`), shows the next meeting's facts, a **calendar
scroller** — every meeting with its date, place and how many are coming;
upcoming first, past greyed — and a **join** panel. A meeting hosted elsewhere
shows "join at <host>" on a visitor door, since a visitor writes only to its
own origin; from a hive, joining it works through the bee.

The door loads the bee with its first view when the organizer says so:

```
arrival meetups ViewBee WebsiteQueenBee SiteViewDrone RsvpDrone @hypercomb.com
```

## What is deliberately not here

- **No organizer.** The calendar is a scroller of meetings and dates (jwize).
  No recurrence rules, no reminders, no .ics; a meeting is one record.
- **No admission for joining.** Anyone with the link may say they are coming,
  by name, under a key they mint. Spam is bounded by size, count and the fact
  that only an opened list takes a claim; the roll is the organizer's to read
  and keep.
- **No second list anywhere.** No roster file, no registry of meetings, no
  per-community endpoint. One meaning, one address, every host.

## Order of work, done and open

1. Host: `noteEvents`, `pickUpEvents`, `putRsvpMember`, rsvp pools listed at
   their address — **done**, `worker.spec.js`.
2. Hive: `event.ts`, `event-read.ts`, `event.queen.ts`, `rsvp.drone.ts` —
   **done**, `event.spec.ts`.
3. Visitor: the one admitted write — **done**, `readonly-network.spec.ts`.
4. Page: join + calendar scroller — **done**.
5. Live: promote the worker, say `hosts list calendar:events`, the `event`
   lines, the `arrival`, `website page` and `publish` — **the organizer's acts**.
6. The relay (`hypercomb-relay/relay.js`, machine hosts) does not yet take
   `event:`/`rsvp:` keys or the stranger's claim — same shape, **open**.
7. How a hive's `community:hosts` reaches its door's pool, so the pick-up has
   sources — **open** (today the live door's pool is empty).
