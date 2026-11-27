# Open entry pools: posting from the leader's domain

**Status, 2026-11-25: DESIGN, fourth draft, approved to build. Nothing in this document is built yet.** Two
drafts were attacked by independent readers against the code, and every finding was checked by a second
reader; what each round changed is at the end. The changes made after the second round, and the owner's
changes below, have not themselves been attacked on paper: the build's own review covers them.

**The owner's answers, 2026-11-25** (jwize):
- *"the invitation please"*: the address is the invitation. Decided.
- *"maybe we need to have them expire"*: every pool ends by itself and its entries expire.
- *"is that a malicious behavior filling a pool? and we can filter by domain. and probably recycle per
  domain?"*: filling a pool is a nuisance from someone who was handed the code, not an attack. It is bounded
  to one page's pool, each poster is a node a reader can switch off, and a page has one pool that is
  recycled. The design keeps only the cheap protections.
- *"we can't recycle things that are referenced by others so it should be cascading"*: recycling walks down
  from the pool and stops at anything something else still names. See Recycling.
- *"deploy"*: build it; the deploy itself is confirmed with the owner when it is verified.

jwize, 2026-11-24: *"consider a scenario where we are sharing our contributions where there is only the one
leader as the host ... Everybody involved should have an easy time connecting ... then participants can go to
the domain and make posts to the swarm via the host."*

Companions: `recipe-templates.md` (what a recipe, a template and an entry are), `calendar-events.md` (the
one write a stranger may make today), `pools-as-relational-database.md` (codex `T9`).

## The problem, in the code's own terms

A person in the room scans a code and opens the leader's page on a phone. They have no host and never run
the full hive. Three facts decide the design.

1. **A host takes a write only from a key it admits.** On the Cloudflare host `putRoomMember` calls `admit`
   (the host's own people, tenants, or open grants). A key made for one page is none of those.
2. **The room's link carries the room's secret.** `#swarm=` unseals to `{ host, location, secret }` and
   `#meet=` spells it out. Every address in a room is derived from that secret (`roomPreimage`,
   `core/zone-text.ts`). A phone that only wants to post must not be handed it.
3. **There is one built exception, and it is the precedent.** For a meeting's sign-up list, a host person
   opens a pool by a key in their own signed index, and from then on `putRsvpMember` takes a small signed
   claim from anyone. No grant, no login. A site door takes that one write and refuses every other.

So the rule to add is the sign-up rule with a different payload, and with what the sign-up rule leaves open
closed: who can find the pool, when a stamp is believed, how a pool is shut, and how a post is hidden.

## The rule in seven lines

1. A **leader opens a pool** by one key in their own signed index, `entries:<H>`. Only one of the host's own
   people can: the host asks the leader's index each time someone posts, and keeps no list of its own.
2. The pool's **address `A` is the invitation**. The index names only `H`, a hash of `A` and the leader's
   key. Posting needs `A`, and `A` is only in the code the leader shows.
3. **Anyone holding the code may post** a small signed member. No grant, no login, no secret of the room.
4. A member **carries its words inline**: at most 4 KB for the whole event, and the reader refuses one that
   names a picture. The host bounds size, counts and the stamp, and never reads the words.
5. Every pool **ends by itself**, at a time set when it is opened: a day by default, 31 days at most. The end
   is part of `H`, so the host stops taking posts with nobody's help. The leader can close sooner, in one
   index write.
6. The leader **hides** a poster or one of their entries by a list named in the leader's own index. It works
   on a full pool and on a closed one, and it can be undone.
7. **Entries expire, and a page has one pool.** A pool stays readable for 30 days after its end; then the
   host drops its members. Opening the next pool for a page recycles the last one. Recycling removes only
   what nothing else names.

## The names, exactly

Every hash below is SHA-256 of UTF-8 text, written as 64 lowercase hex. `NUL` is one zero byte.

| Name | What it is |
|---|---|
| `P` | the key the leader's index is kept under on this host (the path key, not a device's signing key) |
| `O` | the signature of the opening record (an atom) |
| `nonce` | 16 random bytes, written as 32 lowercase hex |
| `A` | `sha256("entries" NUL O NUL nonce)`: the pool's address, the first part of every path |
| `until` | the pool's end: whole seconds since 1970, written in decimal |
| `H` | `sha256("entries:pool" NUL A NUL P NUL until)`: what the leader's index names |

`A` commits to the record, and the record names `P` and `until`, so a code cannot be paired with another
record, another leader or a later end. `H` commits to `P`, so another person copying `entries:<H>` into
their own index opens nothing and closes nothing. `H` commits to `until`, so the end cannot be moved: a
longer pool is a new pool. **One shared test vector** pins `A`, `H` and one whole signed member (key, event,
exact body bytes, name) for the hive, the page and the host, with the bodies that must be refused.

**The opening record** (public, at most 1 KB):

```json
{ "entries:open": 1, "meaning": "recipe:entry", "title": "Tuesday class",
  "template": "<sig of the template to fill>", "by": "<P>", "until": 1764201600 }
```

**The code** is `https://<a page of the leader's>/#post=<O>~<nonce>`: 103 characters after the address. The
fragment is never sent in a request. What the host does see is `A`, in the path of every read and post: the
hidden address keeps out a stranger who reads the leader's index, not the host.

## Opening, in order

The leader's hive does these in this order and shows the code only after the last one succeeds.

1. **Picks the page and the end.** It offers the addresses the leader's own index gives (`doorsOfIndex`), the
   domain's bare address included when the leader's site opens there. A `host.` or `try-` address refuses
   every write and is never offered. With no published page the hive says so in one sentence and stops. The
   end is a day from now unless the leader picks another, 31 days at most. **A page has one pool:** when the
   page already has one, opening recycles it in the same index write (see Recycling), after saying how many
   of its entries have not been brought home.
2. **Checks that page can show the form.** It reads the page as a visitor would and requires three things: it
   is the visitor shell (some published addresses are a card, which is not); the shell says it takes `#post=`
   (one mark in the visitor page); and the package that page runs contains the post bee and is not one of the
   layers the leader keeps from visitors. Each failure has its own sentence, because one of them is the
   leader's to fix and the others are the operator's (see Who ships what).
3. **Puts the record and the template on the host** and reads both back as a stranger would.
4. **Names `entries:<H>` -> `O`** in its index.
5. **Asks the host** for the pool's listing, at the picked page's own address, and requires the answer to say
   *open* (see Reading). An index write is answered 200 whether or not it opened anything, so this is the
   only proof. The host may answer from a copy of the index up to five seconds old, so the hive asks with a
   fresh request and keeps asking for about ten seconds before it concludes the pool did not open.
6. **Posts the pool's first member itself**, a taken-back page that readers draw nothing from. From then on
   the address holds entry members, and nobody else can take it first (check 2).
7. **Remembers the pool.** `O`, `H`, the host, the page and the title go in the leader's own record. The
   nonce is the capability, and a pool is copied off the device by the folder backup, so the nonce is kept
   where the hive keeps its other secrets (`core/llm-keys.ts`), never in a pool.

| | Sign-up list today | An entry pool |
|---|---|---|
| who may open | a host person's index | the same |
| what the host keeps | a marker in `rsvp:pools` | nothing: it asks the leader's index when someone posts |
| what the index names | `rsvp:<event sig>`, public | `entries:<H>`, where `H` hides the address |
| who can find the pool | anyone who reads the index | only someone handed the code |
| how it is shut | it cannot be | it ends by itself; or rename the key |

## Ending, closing, recycling

**Ending** needs nobody. The end is part of `H` and travels with every post and every read, so the host
compares it with its own clock. A leader who forgets, or whose device is off, leaves nothing open.

**Closing** sooner is ONE index write that removes `entries:<H>` and adds `entries-closed:<H>` -> `O`. The
helpers that exist change one key a write, so this is a new helper over the whole-map write.

- If an index ever names both keys, **closed wins**.
- The host reads the leader's held index at each post (a copy up to five seconds old), so posting stops
  within seconds. The hive then asks the listing and requires *closed*, the mirror of opening.
- The record stays named by a current key, so it and the template stay served, also on a host that
  withdraws what an index no longer reaches (`HEAD_ONLY`).
- Members already there stay listed and readable (H2).
- **Any of the leader's devices can close**, from `H` and `O` in the index alone. The hive lists the open
  pools its own index names, and shows one it has no record of as "opened on another device".
- A leader who is no longer one of the host's people: their open pools read as *closed* from that moment,
  hidden list and all. Only *open* needs the host's standing.

### Recycling

A page has one pool. Its last one is recycled when the next is opened for that page, when the leader says
so, or by the hive on its next index write once the pool is 30 days past its end. Recycling is a walk down
from the pool that **stops at anything something else still names**:

| What | On recycling | Why that is safe |
|---|---|---|
| the pool's index keys (`entries:`, `entries-closed:`, `entries-hidden:`) | dropped, in one write | they are the leader's own, and an index is at most 64 KB: a page never holds more than one pool's three keys |
| the pool's members | dropped by the host, once the pool is 30 days past its end | nothing outside a pool ever points into it. A member is not reachable by its signature, only under the pool's address. What people name is the *recipe*, by the hash of its words, and whoever named it brought those bytes home as an atom of their own |
| the hidden list | no longer named | it is an atom of the leader's; the host's reach rule decides |
| the opening record and the template | no longer named *by this pool* | they are atoms, and other things name a template: the leader's tiles, anyone's recipe made from it. The host already keeps an atom served while any current head of any key reaches it, and never withdraws one another key shares. The walk stops there |

So nothing a person kept is lost, and nothing is dropped that anything else still names. Before a pool is
recycled the hive says how many of its entries were not brought home, and offers to bring them.

**How the host drops members.** A read or a post for a pool more than 30 days past its end is answered
"this one has expired", and the host removes that pool's members, a bounded number a request. The request
proves which pool: the members are marked with their `H`, and only `A`, `P` and `until` together hash to
it. The leader's hive asks once when it recycles. A pool nobody ever asks for again keeps its bytes until
the operator sweeps: the host has no clock of its own to act on.

**One limit, stated.** An index write from another of the leader's tabs that began before the close, and
whose own fresh read failed, can write the old keys back and reopen a closed pool. The hive closes it again
the next time it reads its index and says that it did. The host cannot tell a reopen from an open.

## The member

A signed event of a new kind, `30573` (30564 to 30572 are taken), at most **4096 bytes** in all:

```
kind     30573
tags     ["pool", H]                 the pool it is for: H, never the address
         ["page", <64 hex>]          which entry this is: a new one per entry, the same again to replace it
         ["name", "Ana"]             who is posting: one line, not blank, at most 48
         ["title", "Sunday soup"]    what the entry is called: one line, not blank, at most 120
         ["gone", "1"]               optional: takes that page back
content  the entry itself, as text. For a recipe: its canonical JSON (recipe-template.ts recipeBytes)
```

- **One event is one member, and the spelling is fixed.** The body is exactly the UTF-8 bytes that
  `JSON.stringify` gives for an object built with the keys `id, pubkey, created_at, kind, tags, content, sig`
  in that order. `id`, `pubkey` and `sig` are lowercase hex strings; `kind` and `created_at` are whole
  numbers. The host and the reader build that spelling from the parsed event and refuse a body whose raw
  bytes differ. Without this one signed event has any number of names (a space, an escape, one capital
  letter in the signature), and anyone could spend another key's count with copies of it. The poster writes
  the seven fields itself: the signing library returns them in another order.
- **The tags are exactly those:** one each of `pool`, `page`, `name`, `title`, at most one `gone`, no other.
- **`name` and `title` follow the reader's own rule** (`line()` in `recipe-template.ts`), so nothing the host
  stores is later refused for its title.
- **The member does not carry the invitation.** Its `pool` tag is `H`, which the index already shows.
- A recipe with a short story, eight ingredients, four steps and a few facts is about 1.2 KB of canonical
  JSON and about 2 KB as a whole member. Four kilobytes leaves about 2.9 KB of recipe.

### What the host checks

A post is `PUT /<A>/<member>?by=<P>&until=<until>`. The `by` is what routes it: the same path without it is
a room member or a sign-up, exactly as today. Nothing below needs a login, and every refusal is answered in
words, with the same headers as any other answer.

1. **The pool is open.** `until` is ahead of the host's clock and no more than 31 days ahead. `P` is one of
   the host's own people, and `P`'s held index, read with its signature and signer checked, names
   `entries:<H>` for this `A`, `P` and `until`, and does not name `entries-closed:<H>`. Past its end or
   closed is answered "this one is closed"; 30 days past its end "this one has expired"; anything else "no
   pool is open at this address". This is decided from the path alone, before the body is read.
2. **The address is free for it.** `A` is not a listed pool, a private pool, one the host writes, or an
   opened sign-up list, and what is already kept under `A`, if anything, is entry members.
3. The body is read with a hard cap: more than 4096 bytes is refused before it is held.
4. The bytes hash to the member's name.
5. Already held: answered as held, nothing written, whatever its stamp says now.
6. It is the seven fields in the fixed spelling, kind 30573, with the tags above.
7. Its `pool` tag is this `H`.
8. `created_at` is within **ten minutes** of the host's clock, either way.
9. `name`, `title` and `page` keep their rules.
10. The event's signature is valid for its key.
11. This pool holds fewer than **256** members, and this key fewer than **8** in it.
12. Written, marked as an entry member of this `H`.

A room pool refuses an entry member and an entry pool refuses a room member, so one address is never both.
Members are marked with their `H`, so a second person who opens the same address under their own key
neither spends this pool's count nor shows in its listing.

The host does **not** read `content`. It stays one rule for any meaning: recipes today, something else
later, with no host change.

**The two counts are a brake, not a bound, and the listing is the bound.** The host's store has no
transaction: posts that arrive in the same instant can each see a count under the limit and all be written.
So what is *stored* can pass 256 by the size of one burst. What is *listed* cannot: the listing gives the 256
members the host wrote first, by the store's own time, which a poster cannot choose. Entries posted before a
flood therefore stay in sight, and the flood is what fails to appear.

### What only the reader checks

- Each member again, by its own bytes: the hash, the fixed spelling, the signature, the kind, the tags, `H`.
- **The whole listing before anything is drawn.** It is at most 256 names. A longer one means a host that is
  not keeping the rule: the reader takes the first 256 and says the pool is over its limit.
- **At most 8 members a key**, the newest. Then one per key and page: the newest stands, a stamp ahead of
  the clock counts as now, and `gone` removes the page.
- **The leader's hidden list.** When the host names one and it cannot be read and verified, the reader draws
  nothing from the pool and says so. It never draws around a missing list.
- **The words, and only words.** A recipe is read by the same strict reader as any other (`parseRecipe`). A
  posted recipe that names any signature other than the pool's template is refused: a poster cannot upload a
  picture, and must not be able to make every phone fetch one the host already holds.
- Rows sit under the person who signed them, by the name they typed. A name is what someone typed, not
  proof of who they are; two people with one name are two nodes. Stamps never decide who is shown first.

**The row's key.** The reader takes the recipe's signature as the hash of `content`, and builds the same
entry document every other row has (`{ name: <title>, recipe: <that signature> }`). The row is keyed by that
entry's signature, as every other row is.

**Opening a row.** An offer made from a posted member carries the member's own bytes and the pool's host.
The recipe is answered from those bytes; the template is read from the pool's host or the leader's own
store. Neither is asked of the room. "Bring it to my hive" stores the recipe's bytes as an ordinary atom, so
every later reference is by signature.

A reader with the code and their own tools can fetch every member and ignore the hidden list. Hiding is what
honest readers show, not what the host withholds.

## Hiding

A hide is not a member. It is a list the leader names in their own index: `entries-hidden:<H>` -> the
signature of

```json
{ "entries:hidden": 1, "keys": ["k:<a poster's key>"], "pages": ["<key>:<page>"] }
```

- It is written the way the leader writes anything: as one of the host's people. So it does not meet the
  pool's limits, it works when the pool is full, and it works after closing.
- It names a **key**, or one page of a key. A hidden poster who posts again with the same key stays hidden.
  One with a new key needs a new line, which is why a flood is answered by closing and a rude post by hiding.
- **No line is a bare signature.** A `HEAD_ONLY` host follows every 64-hex string in what an index reaches
  and keeps it served. A page is a string the poster chose, so written bare it could bring back something
  its owner had withdrawn.
- At most 64 KB. A newer list without a line shows it again (H4: a hide is reversible).
- A change reads the list the index names now, edits the line, and writes expecting that list still to be
  the one named, trying again when it moved. Two of the leader's tabs cannot silently undo each other.
- The host hands the list's signature to whoever lists the pool. That gives the host no power it lacked: a
  host can already leave a member out of a listing.

## Reading

`GET /<A>/?by=<P>&until=<until>` lists the pool: the 256 members written first, and three headers of the
host's own: whether the pool is `open`, `closed` (by the leader or by its end) or `expired`, the signature
of the hidden list if there is one, and the host's time. For an address `P` opened it answers 200 even when
nothing is there yet. No state means this host does not know the pool: not opened, recycled, a wrong code,
or a host that does not take posts yet. That is how
the leader's hive proves an opening and a closing took, and how the page knows what to draw before anyone
types a word.

Each member is then read by its name, as a sign-up claim is. A listing is never the proof: each member is
trusted by its own signature and bytes (M1).

In the leader's hive an opened pool is one more **source** in the catalogue, beside the domains they follow
and the room: the same list, the same cards, read along the same way, with Hide beside each node.

## The page a phone sees

1. **The shell takes the code.** `invite-capture.ts` recognises `#post=` and announces it. The fragment stays
   in the address bar, so a phone that reloads the tab comes back to the form. Two things touch a fragment
   today and both are taught to leave this one alone: the selection reader (it reads any fragment as a tile's
   name) and the site view (it strips every fragment in website mode, which is the mode a published page
   opens in). The bee takes the code from the announcement, never from the address bar, and the same code
   announced again is nothing new.
2. **The post bee wakes on that announcement.** On a page with an arrival plan only the planned bees load, so
   the bee is declared asleep and woken by the announcement, not by the plan. A spec holds it to that: the
   build files a bee as awake without a word if its file breaks the sleeper's shape.
3. **It asks the host first** (the listing above). Not known: "This host is not taking posts for this code."
   Closed or past its end: "This one is closed", with what was posted. Expired: "This one has expired."
   Open: the form, and when it ends.
4. **The form is drawn from the template's sections**: the name the person goes by, the entry's title, then
   one part per section (text, ingredients, steps, facts, links). Pictures are left out and the page says so.
5. **Before the press the page says, in plain words:** what you post is kept by this host and can be read by
   anyone with this code; you can change it or take it back until this tab closes or reloads, or the leader
   closes this, or it fills up; after that only the leader can hide it.
6. **It signs with a key of its own**, made in memory for this page load and never stored. It does not use
   the shell's signer, which would sign with a browser extension's standing key when there is one.
7. **It shows how much room is left**, and how many changes: every change and take-back is one of the 8, and
   the page keeps the last for a take-back.
8. **One press** puts the member on the page's own origin with `fetch`, the one write a visitor page may make
   (`readonly-network.ts` allows exactly that path). The stamp is the host's time: the page keeps the
   difference from its own clock when it reads the listing, stamps at the press, and asks once more if the
   host refuses the stamp. A phone with a wrong clock is not refused.
9. **It says where it went**: "Posted to Tuesday class at example.com", or the host's own words.
10. **Under the form: what the class has posted**, read with the same reader, with the read-along.

The page never joins the room, opens no socket, and holds no secret but the code.

## What one hostile person can do, at most

| Who | Can | Bounded by |
|---|---|---|
| a stranger who reads the leader's index | nothing | the index names only `H`; posting and reading need `A` |
| another of the host's people | nothing to this pool | `H` commits to the leader's key; members are marked with their `H` |
| someone handed the code, one key | 8 members, 32 KB | the reader keeps 8 a key; the host's count is the brake |
| the same, making new keys | fill this page's pool: 256 listed, about 1 MB, and one burst more stored | a nuisance from someone in the room, not an attack: the pool ends by itself, each poster is a node a reader can switch off, and the leader can show a new code |
| the same, to push others out of sight | nothing to entries already posted; later ones do not appear | the listing is the first 256 by the host's own time |
| the same, with rude words | be seen until hidden | the leader's list, which works full or closed |
| the same, replaying someone's member | nothing | one event is one member; the `pool` tag is `H` |
| the same, with an admitted key, taking the address first | nothing | the leader's own first member, posted before the code is shown |
| the same, naming a picture the host holds | nothing | the reader refuses a posted recipe that names one |
| a leaked code | post until the pool ends or is closed; read until it expires | the end is in the code itself; 30 days later the members are dropped |

Compared with sign-ups: twice the size (4 KB against 2 KB), a quarter of the pool (256 against 1,000), and
five things sign-ups do not have: the hidden address, the stamp window, one event one member, closing, hiding.

**What it does not stop.**
- Someone in the room who makes keys can fill a pool in seconds, and then nobody else's new entry appears
  until the leader shows a new code. That is one person in the room being a nuisance to one page. There is
  no rate limit on the Cloudflare host for any unauthenticated write today, and this adds none.
- What was typed stays on the host until the pool expires. Until then a hide is the leader's list, a
  take-back is the poster's while their tab lives and the pool is open and not full, and a reader with the
  code and their own tools sees all of it.
- A pool nobody asks for again after it expires keeps its bytes until the operator sweeps.
- A closed pool can be reopened by a stale index write from another of the leader's tabs, until the hive
  next reads its index.
- The host and its request logs see `A`.

## The host change

One host, the Cloudflare one (`blossom-worker/worker.js`):

- `entryPoolState(A, P, until)`: `open`, `closed`, `expired` or nothing, from the host's clock,
  `isHostPerson(P)` and `P`'s index read through `verifiedIndex` (the five-second copy, with the signature
  and signer checked as the page gate checks them). No index hook, no marker, no new pool on the host.
- Dropping an expired pool's members: on a read or a post 30 days past the end, a bounded number a request,
  only members marked with that `H`.
- `putEntryMember`: the twelve checks, in one place that always answers. It reads the body with the capped
  reader; the two precedents buffer the whole body first and must not be copied.
- Routing: `PUT /<A>/<member>?by=<P>&until=<until>` goes to it on a site door and at the zone root, before
  the read-only refusal. A host door still refuses. Without `by` nothing changes.
- The listing with `by`: the first 256 members of this `H` by upload time, the three headers, the empty 200,
  and the headers exposed to pages.
- `putRoomMember`: refuses an address that holds entry members.
- The spec's fake store learns `limit`, `cursor`, `truncated` and the upload time, so the counts and the
  listing can be tested as they run.

Each check gets a spec that fails without it.

### The machine host is not in this change

`relay.js` serves no page a phone can post from: with no shell it answers a page that runs no script, with
a shell it is the full hive, and the program that does open a visitor door on a machine (`hypercomb-serve`)
has no write path at all. So the rule there would have nothing to use it. It would also need work this draft
does not design: a listing and a member read for this kind (the relay lists only room members), an address
that cannot be taken first by a small atom at `/<A>`, and openness read from the writers' indexes.

A class on a machine host shares today through the room (`--allow-participants`, `recipe-templates.md`).
Phones posting from a page is, for now, the Cloudflare host.

## What changes in the app

| File | Change |
|---|---|
| `hypercomb-core` `nostr-kinds.ts` | the kind, named once (the kinds spec fails without the row) |
| `hypercomb-core` `pool-registry.ts`, `pool-kinds.ts` | seed `entries:opened` as a document: the leader's record, without the nonce |
| `hypercomb-core` `llm-keys.ts`, `hypercomb-runtime` `store.ts` | the nonce, beside the hive's other secrets, and refused by the pool write path like them |
| `sharing/hive-pointer.ts` | one write that renames a key, and one that drops two |
| `pools/open-entries.ts` (new) | the names above, open, close, recycle, hide, the code, post, read: for any meaning |
| `recipe/recipe-post.*` (new) | the form built from a template, and the bee that wakes on the code |
| `recipe/recipe-entries.ts` | a posted member is one more source of `RecipeEntryOffer`, carrying its own bytes |
| `recipe/recipe-catalogue-view.drone.ts` | rows from opened pools; Hide and Show again for the leader |
| `pools/pools-mode.drone.ts`, `pools-bar.ts` | "Open for posts": the page's pool, when it ends, the code, the count, Close, Recycle |
| `presentation/tiles/site-view.drone.ts` | its two fragment strips leave `#post=` alone |
| `hypercomb-shared` `core/invite-capture.ts` | recognise `#post=` and announce it |
| `hypercomb-runtime` `navigation.ts` | the selection reader ignores a `#post=` fragment |
| `hypercomb-web` `index.visitor.html` | one mark that this shell takes `#post=` |

`A` is computed with the signature service directly and never registered as a pool meaning: it is a
capability, and the registry is a public census.

## Who ships what

A code works on a phone only when four things are true of the page it opens. Opening checks them and says
which one is missing.

| What | Whose |
|---|---|
| the host takes the post (the worker) | the operator's |
| the visitor shell takes `#post=` | the operator's |
| the package the page runs contains the post bee | the operator's, unless the leader's site was promoted with its own package: then the leader promotes one that has it |
| the bee is not in a layer the leader keeps from visitors | the leader's |

## Two rules of the doctrine this bends, named

- **I2** (a field that holds content holds a signature, never the content). A member carries its recipe in
  `content`, because a key the host does not admit cannot upload an atom to point at. The exception is
  bounded: 4 KB, text, and the reader names the recipe by the hash of those bytes, so everything downstream
  is by signature again. The hosts say the same of today's claims ("a claim is not content"); this is the one
  claim that is content, and it is the owner's call.
- **T9** (insert is leaving a member in the pool on your own host). Here the row is left on the leader's
  host, as a sign-up is left on the organizer's.

## The decisions, as they stand

1. **The address is the invitation.** Decided by the owner, 2026-11-25.
2. **Words inline in the member**, the exception to I2 above. Without it there is no way for a phone with no
   host to post at all. Not objected to; it stands unless the owner says otherwise.
3. **The numbers**: 4096 bytes a member, 256 listed a pool, 8 a key, ten minutes on the stamp, a day by
   default and 31 days at most for a pool, 30 days readable after its end. The host's two counts are a
   brake and the listing is the bound. These are constants in one place and are the owner's to change.
4. **They expire.** The owner's change, 2026-11-25: a pool ends by itself, its members are dropped 30 days
   after, a page has one pool, and recycling stops at anything something else still names. A poster cannot
   take an entry back after the end, a close, or once the pool is full.
5. **Cloudflare only.** The machine host waits until there is a page it can serve to a phone.
6. **Who ships what**, the table above. The owner said to deploy; what ships is confirmed with them when the
   build is verified, and until it is shipped opening says so and shows no code.

## Not in this change

- The machine host (above).
- A hive in the full app being handed someone else's code. The leader's hive reads the pools it opened; a
  classmate without the leader's hive reads them on the page.
- A rate limit on the Cloudflare host.
- Pictures from a poster the host does not admit.
- A poster's take-back after their tab is gone.
- A sweep of expired pools nobody asks for again.

## What the two reviews changed

**Round one.** Five readers attacked the first draft against the code, each from one side (the capability,
the Cloudflare host, the machine host, the phone, the reader and the doctrine), and a second reader checked
every finding against the source. Thirty-seven findings: twenty-seven confirmed, ten partly, none refuted.

| The first draft said | What was wrong | Now |
|---|---|---|
| the host keeps a set of open pools and removes one on close | a close computed by comparing with the previous index is lost after one failed write; any other host person could copy `H` and hold the pool open or shut it | the host keeps nothing and asks the leader's index at each post; `H` commits to the leader's key |
| close by dropping the key | on a `HEAD_ONLY` host the record and template stop being served ten minutes later | close by renaming the key |
| the leader hides with a member of their own | it met the pool's limits and the close, so it failed exactly when needed; it named a member, so a re-post walked around it; no way to undo it was given | a list in the leader's index, naming keys |
| the bytes hash to the name | one signed event could be stored under any number of names and spend another key's count | one event is one member |
| 500 a pool, 8 a key, as bounds | not atomic on this host | a brake, and said so |
| the reader's cut, a key at a time | the cut (256) was smaller than the pool (500): fresh keys hid every honest entry | see round two |
| only `sha256(A)` in `entries:pools` tests the pool | a host person could open a pool over any address, including the host's own | the address is checked to be free; one address is never both kinds |
| reads need nothing new | an open, empty pool answered 404, the same as a wrong code or a host not yet upgraded | the listing says the state |
| the member's tag is `A` | a member's bytes carried the invitation (a hardening; no leak was found) | the tag is `H` |
| a key that lives for the page | the shell's signer uses a browser extension's standing key when there is one | the bee makes and uses its own |
| the link lands on a door that runs the recipe module | nothing takes `#post=`; under an arrival plan the bee never loads; the fragment is read as a tile's name; "the door" was undefined | the capture, the wake, the kept fragment, the page picked and checked at opening |
| both hosts | the machine host has no page for a phone, cannot read the kind back, and its address can be taken first | Cloudflare only, with the reasons |
| a hive handed the code remembers it | the code opens the leader's page, never a hive, and no place was named to keep it | not in this change |
| the encodings were not stated | three codebases would have to guess the same bytes | the table of names, and the test vector |
| inline words, with no rule named | it is an exception to I2 and the owner was not told | named, and a decision |

**Round two.** Four readers attacked the second draft: three on what was new in it, one checking that every
round-one finding had been answered. Thirty-two findings: twenty-six confirmed, six partly, none refuted, no
blockers. Several were the same fault seen from two sides.

| The second draft said | What was wrong | Now |
|---|---|---|
| the seven fields in that order | the spelling was never defined: an escape, or one capital letter in the signature or the id, still gave one event many names | the spelling is the bytes one function gives, compared raw, lowercase hex, in the test vector |
| the reader reads the whole pool, up to 512 names | one burst passes 512, the listing is in name order, and a poster chooses a member's name | the host lists the first 256 by its own time |
| the hidden list holds keys and `[key, page]` pairs | a `HEAD_ONLY` host follows every bare signature in what an index reaches; a poster-chosen page could bring back something withdrawn | no line is a bare signature |
| closing renames the key | the helpers change one key a write: two writes, and either order fails badly halfway; open was tested first | one write, closed wins, and the hive requires the host to say closed |
| a local record that never leaves the device | a pool is copied off the device by the folder backup, and the store's own rule is that a secret never enters one | the nonce is kept with the hive's other secrets |
| the same list, the same cards | the functions that open a row and bring it home ask the room or a domain for bytes that exist only in the member | the offer carries its own bytes |
| the fragment stays in the address bar | the site view strips every fragment on exactly the page opening picks | the site view leaves this one |
| opening proves the host takes posts | it did not prove the picked page can show the form: a card address, an old shell, a package without the bee | opening checks the page, and says whose it is to fix |
| a domain's bare address is never used | a leader's site can open there | offered when the index gives it |
| the address is checked to be free | an admitted key could put one room member at the empty address first | the leader posts the first member |
| the stamp is taken from the host's clock | no source and no moment were named | the listing carries the time; the page stamps at the press |
| there are no pictures | nothing stopped a posted recipe naming one the host already holds | the reader refuses it |
| the hive never renames it back | a kept pool costs index space for good; only the opening device could close | Forget, a count, and Close from any device |
| a leader no longer one of the host's people has no pools | the closed state and the hidden list went with them | their pools read as closed |
