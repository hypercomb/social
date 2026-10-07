# The business card — the founding creation

> **status: decided 2026-10-04 (jwize); one card built, the rest is discipline.**
> The first card lives on the `jaime-weise` tile and publishes to
> `jaime-weise.hypercomb.com`. The ledger at the end says what is true today.

A business card is the smallest creation that uses everything Hypercomb is for,
and the first one a person wants. One tile, one page, published to the
participant's own address, hosted by whoever serves it, read live by everyone
who holds the address. Two people scan each other and each now holds the
other's address. Nothing was signed up for, nothing was uploaded to anyone,
and the two cards — on two domains, maybe on two machines — are one
application. That is the model of Hypercomb in one object, so it is the
creation the concept is explained with.

## What the card is

- **A creation on a tile, in two parts.** An ordinary tile wears the card
  page (`visual:website:page`) and its own card (`card:data`, a record that
  names the card's JSON by signature), plus a `view:default` mark so the tile
  opens as the card. The page is shared: every card wears the same page
  signature, and the page reads the card from the tile it is mounted on. A
  second person's card is the same page and their own `card:data`, never a
  copy of the page with their name in it. Each part stands alone: the page
  without a card offers to make one, and the card is plain JSON
  ([website-artifact-paradigm.md](website-artifact-paradigm.md)).
- **The current you.** The card carries what is current in your life: your
  roles, your links, your lists. You change it by editing the tile; the
  lineage head is the card. There is no "profile" anywhere else to keep in
  step, and nothing to export.
- **At your own address.** The participant claims a domain
  ([domain-claim.md](domain-claim.md)) and publishes the tile to a name under
  it. The address is the promise ([address-syntax.md](address-syntax.md)):
  `jaime-weise.hypercomb.com` is where the card is, for as long as the
  participant says so.

## What makes it Hypercomb

**Your domain, anyone's machine.** The address is yours; the bytes are served
by whichever host you choose — your own computer serving the hive live
([hosting-from-a-machine.md](hosting-from-a-machine.md)), a Pages deployment,
or a participant who consented to host you
([consent-hosting.md](consent-hosting.md)). Sharing is hosting: the host is
the truth for the address, and switching hosts does not change the address.

**Publishing makes it live.** A publish advances the head that the address
answers with. A visitor who opens the address gets the card as it is now; a
visitor who opens it next year gets the card as it is then. The hive being
served is the application; there is no build of the card apart from the hive
([publishing.md](publishing.md)).

**Every card is compatible with every other.** A card is the same artifact
shape on every domain, so cards do not need to know about each other's hosts.
What one person hands another is an **address**, never a copy: the QR on the
back of the card is the card's address, and scanning it is how you receive a
card. You always arrive holding a reference.

**Publishing your node is joining.** There is no directory to be listed in.
Publishing your own card at your own address is the whole act of joining; the
community you are part of is the set of addresses you hold and the hosts you
follow ([pools-across-hosts.md](pools-across-hosts.md)).

## The Hyperdex

*jwize, 2026-10-05:* the rolodex is called the **Hyperdex**.

The Hyperdex is the participant's collection of the addresses they have been
handed. It is a collection of references, so:

- An entry is an address. Opening it reads the card at its head, so a contact
  who changed jobs last week shows the new job without anyone being told.
- It is the participant's own and private by default, as every collection is
  ([collections-sharing.md](collections-sharing.md)); handing a card to one
  person does not put it in front of a third.
- It keeps no copy. A card that goes dark goes dark in every Hyperdex that
  holds it, which is the owner's right.

The exchange is two scans: you scan their code, they scan yours. A one-scan
handshake through a relay is a meeting point, never a store, and is not built.

In the hive the Hyperdex is a private collection, `/hyperdex`, kept in the
collections index like any other. Each entry is a link tile whose link is the
card's address. The contact's name is the tile's name, one level down inside
the collection. The entry never holds the card's bytes or its head signature
as its key, because either would freeze the card. Publishing your card never
publishes your Hyperdex.

## Following is replication

*jwize, 2026-10-05:* "the replication [is] the interaction … you give them a
link and then [they] set up and follow your card. When you make an update or
you push another person's address they can look at it and add [it] to their
rolodex."

There is no follow server, no subscriber list and no message queue. Following
a card is holding its address and reading it, and reading it is replication:
the bytes come from the card's host to the reader when the reader asks. The
whole social layer of the card is that one act, seen from four sides.

1. **You give them a link; they become a host and take a domain; then they
   get a card.** *jwize, 2026-10-05:* "make them a host before they can get a
   card … they need their own domain so they can publicize the changes."
   The link opens your card on its door. A door is read-only: it may show,
   never author or install ([read-only-deployment.md](read-only-deployment.md)),
   so it can only point onward to a host's front door. From there the order is
   fixed:
   1. **A hive**, taken by replication (`replicate(root)`; there is no
      installer).
   2. **A host.** Their hive gets a node that serves it: their own machine
      (Hive ▸ Serve This Hive), a server (`hypercomb-serve`), or a deploy they
      run ([hosting-from-a-machine.md](hosting-from-a-machine.md)). A card is
      sharing, and sharing requires hosting: the host is the truth, and it
      keeps the card available whether or not its owner is online.
   3. **Their own domain**, claimed with `domain claim`
      ([domain-claim.md](domain-claim.md)). The domain is how their changes
      are publicized: each publish advances the signed head that their address
      answers, and every Hyperdex holding that address reads the change from
      there. An address on someone else's domain is theirs only on loan.
   4. **The card**, published from their host to their address. That publish
      is the whole of joining.

   A hive with no host and no domain can still keep a Hyperdex and read every
   card in it. It cannot publish a card. Until it can, the silo below is how
   its owner hands one out.
2. **They follow your card.** They keep your address as an entry in their
   `/hyperdex`, through the same confirm step as any dropped link, so nothing is
   written until they agree. Holding a card's address may also mean following
   its host, since the community is "the set of addresses you hold and the
   hosts you follow".
3. **You make an update; they see it.** You publish, and your door's signed
   head moves. Their hive notices on its own: once per boot it asks each held
   address's host for its current head (the host's signed `host:offerings`),
   compares it with the head it last saw, and marks the entry as updated.
   Opening the entry reads the live card. You never push, and you never learn
   who follows you: a host sees only anonymous reads, and keeping a follower
   list would be tracking.
4. **You send someone a contact.** You hand them another person's address,
   never their card. In person or out of band it is a link or a QR. Through the
   mesh it is a signed offer to that one person that expires within minutes, in
   the shape of the existing consent toast: they accept, and the address lands
   in their `/hyperdex` through the same confirm step, or they decline, and
   nothing is kept. If they are not there when it arrives, it is gone. The
   relay is a meeting point, never an inbox.

## A card before a host: a silo on someone else's domain

*jwize, 2026-10-05:* "a path for them to locally have their own card at your
domain … with you or any contacts they send you or you create by domain
pointing at them … basically you can use local domain as a silo for your apps
but you must trust them or they might disappear."

Before someone is a host with a domain, they can still have a card of their
own. They make it on their own device, in the card page at someone else's
address, and that address becomes their silo:

- **Kept on their device, under that domain.** Their card and their Hyperdex
  live in their browser's storage for that domain, and nowhere else.
- **Shared with the people around them.** They can swap cards with the
  domain's owner, keep the contacts people send them, and add contacts by
  address, a domain that points at a person.
- **The card travels inside its link.** The QR is `<domain>/#c=…`, and that
  domain's card page draws whatever card the link carries. The part after `#`
  never reaches the domain's host, so its owner never sees a guest's card
  unless the guest shows it to them.
- **A snapshot, not an address.** Changing the card means handing out a new
  code, and nobody holding the old one sees the change. Live updates need
  their own host and domain.
- **Trust is the price.** If the domain goes away, or its page stops offering
  cards, the silo and everything in it disappear with it.

When they become a host with a domain and publish, their QR carries their own
address, and the card is theirs.

## Templates and themes

*jwize, 2026-10-05:* "make some other themes for the business cards so people
who want something to start with can apply their own information, get ai to add
the middle card imagery, and share their templates across public domains
(indexed) or just by swarming. Then we break the atom of jaime-weise be
jaime-weise/business-card/template (name slots embedded)."

### The rule underneath: break a creation along its program

*jwize, 2026-10-05:* "we're basically reaching for the simplest construct. But
expresses the program efficiently and simply and to follow that pattern as
doctrine, the spoils go to the code reusability when you follow this pattern."

A creation is broken apart the way its program is built, and each part is a
tile. The route names the parts: `jaime-weise/business-card/template` reads as
the person, the creation, and the creation's template. Behaviours ride on
those tiles as decorations, so they stay swappable. Meaning comes from the
pools a part belongs to, never from where it sits. A part is one atom,
referenced from every pool it means and never copied into a second place. Reuse
is what this buys: a template every card can wear is written once.

This is not the retired mirror paradigm. Nothing is kept beside the code: the
tiles are the creation, broken apart.

### How the words map onto pools

Two address rules shape the spelling:

- **A bare word is singular** ([address-syntax.md](address-syntax.md)). The set
  of every template of any kind is the molecule `template`. A tile joins it by
  being named `template`; no list has to be kept.
- **A pool never holds a pool.** The business card's own templates are a
  facet, a collection about one subject, at the root beside every other pool:
  `templates:<sign('business-card')>`. A facet is the one place the plural is
  right.

So "business-card/[templates, other references]" is the facet
`templates:<business-card>` plus reference cells for the rest. "/templates/[…]"
is the molecule `template`. One template is referenced from both and never
copied. Pools list members; marks on the members name their pools.

### The parts of a card

| Part | What it is | Where it lives |
|---|---|---|
| Template | the shared page: the scene, the layout, and the name slots the card fills (name, up to four roles, up to three contact lines) | `visual:website:page`, one signature every card can wear |
| Theme | a JSON object of colours: metal, light, plate, type, middle art, chrome. It names only what it changes; every value it leaves out stays Honeycomb Edge | a starter theme the page carries (the card names it with `h`), or the tile's own (`card:data` → `themeSig`) |
| Card | the person's own fields | `card:data` → `dataSig` |
| Middle picture | an image for the open area, drawn where the comb would be, inside the borders and clear of the type, the icons and the cube | `card:data` → `artSig` |

Every signature a card names sits in the `card:data` payload, so the record's
references carry the theme and the picture to every host and adopter. A
signature inside the card's JSON would never be followed.

The starter themes are Honeycomb Edge (the card as it was made), Graphite,
Graphite Red and Emerald. A card with no theme is Honeycomb Edge exactly: the
themed scene with no theme was checked byte for byte against the scene before
themes.

### The tree as it stands in the hive

*jwize, 2026-10-05:* "It should be easy to read from hive and represent its
structure."

```
jaime-weise              the card: its page and its own card:data; opens as the card
└─ business-card         opens as hexagons: the card's parts
   └─ template           the shared, themed page and a card of name slots; opens as the card
      ├─ honeycomb-edge  the template in each starter theme: the same page and card,
      ├─ emerald         with card:data naming that theme's JSON by signature;
      ├─ graphite        each opens as the card, so walking in is the preview
      └─ graphite-red
```

Each tile is one part, and every part is readable from the hive: the page is
the `visual:website:page` record, the slots are the template's card, each
theme is its own JSON atom. `jaime-weise` wears `view:default=website`, so it
keeps opening as its card now that it has children, for visitors and, in the
authoring hive, on arrival. `business-card` wears `hexagons`, which stops that
mark cascading onto a tile with no page.

### Making your own from a template, and changing it

The word is `card wear <template>` (`commands/card.queen.ts`). Standing on your
card's tile:

```
card                                        what this card wears
card wear business-card/template/graphite   wear the Graphite template
card wear /jaime-weise/business-card/template/honeycomb-edge
```

Wearing is two references and never a copy: the tile's page becomes the
template's page, and its card keeps its own details and picture and takes the
template's theme. A tile with no card yet starts from the template's card, the
name slots to fill in. Routes are relative to where you stand, or from the
hive root with a leading `/`. Both writes are ordinary commits, so they undo
like any other. Change it in your hive first; visitors see it after the next
publish.

In the silo (a card kept on your device at someone else's domain) the card
editor's theme picker does the same, and the card's link carries the theme's
name.

### The middle picture by AI

The picture is made in the hive, never by the published page: `/comfy <prompt>`
with the card's tile selected stores the image by signature, and the card's
`card:data` names it as `artSig`. The generator runs only on the participant's
side. A published card serves only the stored image from its own host.

### Sharing templates

- **By swarming** this works today: a peer at the same route sees the template
  tile and adopting it brings its page and closure.
- **Indexed across public domains** is the `themes:card` meaning, offered from
  a host the way text themes are. It needs hive code and a host deploy, as the
  ledger says.

## On a phone: the list is the root

The card page opens on a phone as a directory of people
([using-a-creation.md](using-a-creation.md), "On a phone, the root is people"):
the default card at the top, then your own cards and the site's card, then
everyone in your Hyperdex, then "Create your own card" until you have one.
Each row is the card made small, its name and title. Pulling up from the
bottom of a card shrinks it into its row; past halfway it finishes on its own.
Tapping a row grows it back into the card. A dock along the bottom scans,
shows your code, shares, searches and opens your own card. Turning the card
over is one swipe, never a spin past the side you meant.

Someone using another person's card site can make their own card the default
there, and carry their cards and Hyperdex to another address in a file until
they have a host of their own.

## Why this is the founding creation

Each primitive the concept rests on is exercised by the card, and the card is
useful on day one, so it is the creation the concept is explained with:

| Primitive | Where the card uses it |
|---|---|
| A creation is a tile wearing marks | the page and the `view:default` mark |
| The participant's own address | `/domain claim`, then publish to `<name>.<zone>` |
| Hosting by a chosen host, live from the store | the machine that serves `jaime-weise.hypercomb.com` |
| The head is what the address answers | editing the tile and publishing again |
| References, never copies | the QR carries the address; the Hyperdex holds addresses |
| Collections are private, owned, cross-host | the Hyperdex |
| Replication is the only way bytes move | following a card is reading it; joining is taking a hive and publishing a card |
| No tracking | updates are read by the follower; the owner keeps no follower list |
| Consent before anything lands | a sent contact is an offer the receiver accepts or declines |
| No central party | two cards on two domains are one application |

## Ledger — what is true today

| | Status |
|---|---|
| The card page on `jaime-weise`, opening by default, publishable with `/publish` | built |
| QR of the card's address on the back; scanning adds to the Hyperdex; Hyperdex kept on the device | built, in the page |
| The phone gesture (Quick Tap, shake) opening the card; a scribble choosing between cards | built for the local development build; the published site cannot yet be installed as an app |
| One shared page plus each tile's own card | built. The page carries no card; it reads the `card:data` record on its tile through the hive's own services (and `card.json` beside it when it runs on its own). The cube is the card's own `logo`, so it appears only on cards that name it. The three.js dependency and the animation are still inside the shared page, owed as separate signed parts. |
| Themes | built in the page: Honeycomb Edge, Graphite, Graphite Red and Emerald; a theme from the tile (`themeSig`) or named by the card (`h`); the editor's picker; the page chrome follows the card's theme. `jaime-weise` still wears the page from before themes, by choice |
| The middle picture | built in the page (`artSig`). Making it is `/comfy` today; the hive's AI cannot start a picture on its own yet (`comfy:generate` is not a bridge intent) |
| `jaime-weise/business-card/template` and its theme tiles | built in the hive. The template wears the themed page and a card of name slots; each starter theme is a tile under it wearing the same page and naming its theme. `jaime-weise` keeps its own page and card and wears `view:default=website`; `business-card` wears `hexagons` |
| `templates:<business-card>` facet and `template` membership | membership in `template` is by name, today. The facet needs a writer in the hive (`facet-succession.ts` exists; no word or bridge op writes this facet) |
| Templates indexed across public domains (`themes:card`) | not built. It needs the meaning reserved in the pool registry, an offering handler, and the host worker to list it (today it lists `themes:text` only) |
| The list as the root on a phone; pull a card down into its row, tap a row to grow it; the dock | built in the card page |
| Making yourself the default on someone's card site; carrying cards and Hyperdex in a file | built in the card page |
| Staying on the page version you use when the site publishes a newer one | not built ([using-a-creation.md](using-a-creation.md)) |
| Gestures and choosers as drone modules | design — the page carries a registry; nothing is a bee yet |
| The Hyperdex as a collection in the hive, synced across the participant's devices | design — a private `/hyperdex` collection of link tiles. The pieces are built: collections, link tiles, and the confirm step (`link:intake`). Nothing yet writes a scanned or pasted card address into it. |
| Reading a held address at its live head | built — opening a door resolves the signed index |
| A local card at someone else's domain (the silo) | built, in the page. "New card" keeps it on the device, its QR carries the card in a link at that domain, and opening the link shows it with "Add to my Hyperdex". The hive clears a link's `#` part before a page mounts, so the page reads the link it was opened with from the browser's record of the visit, once per load. The card's extra links list does not travel in the link. |
| Moving a silo's card and Hyperdex into your own hive | not built |
| "Updated" mark on a Hyperdex entry | not built — modelled on the update scout's one check per boot. Each host already answers its current heads in the signed `host:offerings` pool. |
| From a card's door to a hive, a host, a domain and a card, in that order | not built. The door shows nothing onward. Each step exists on its own: a hive by replication (`acquire`), a host (Serve This Hive in the desktop client, `hypercomb-serve`, or a Pages deploy), a domain (`domain claim`), and the card (`/publish`). Nothing leads a newcomer through them. The door's `?home=` button is a hosting step for people who already have a hive. |
| Becoming a host without a developer | not built. Serve This Hive opens a port on the participant's own machine. Reaching it from the internet needs a server, a forwarded port or a tunnel in front, which is a developer's job today. |
| No card without a host and a domain | not enforced. Today a guest with no host of their own can publish a branch to the shared hypercomb.com host, and it opens at a path on hypercomb.com. |
| Sending a contact through the mesh | not built. The nearest built channel is the follow-request consent toast. It carries no address yet, and it reaches a person only inside a shared room. |
| Consent-hosted cards | design ([consent-hosting.md](consent-hosting.md)) |
