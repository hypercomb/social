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

- **A creation on a tile.** The card is a page worn by an ordinary tile
  (`visual:website:page`) with a `view:default` mark so the tile opens as the
  card. It stands alone and depends on no other artifact
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
   card in it. It cannot hand a card out.
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
| The page as one artifact of ~830 KB | not yet broken apart: the three.js dependency, the animation and the card data are owed as separate signed parts |
| Gestures and choosers as drone modules | design — the page carries a registry; nothing is a bee yet |
| The Hyperdex as a collection in the hive, synced across the participant's devices | design — a private `/hyperdex` collection of link tiles. The pieces are built: collections, link tiles, and the confirm step (`link:intake`). Nothing yet writes a scanned or pasted card address into it. |
| Reading a held address at its live head | built — opening a door resolves the signed index |
| "Updated" mark on a Hyperdex entry | not built — modelled on the update scout's one check per boot. Each host already answers its current heads in the signed `host:offerings` pool. |
| From a card's door to a hive, a host, a domain and a card, in that order | not built. The door shows nothing onward. Each step exists on its own: a hive by replication (`acquire`), a host (Serve This Hive in the desktop client, `hypercomb-serve`, or a Pages deploy), a domain (`domain claim`), and the card (`/publish`). Nothing leads a newcomer through them. The door's `?home=` button is a hosting step for people who already have a hive. |
| Becoming a host without a developer | not built. Serve This Hive opens a port on the participant's own machine. Reaching it from the internet needs a server, a forwarded port or a tunnel in front, which is a developer's job today. |
| No card without a host and a domain | not enforced. Today a guest with no host of their own can publish a branch to the shared hypercomb.com host, and it opens at a path on hypercomb.com. |
| Sending a contact through the mesh | not built. The nearest built channel is the follow-request consent toast. It carries no address yet, and it reaches a person only inside a shared room. |
| Consent-hosted cards | design ([consent-hosting.md](consent-hosting.md)) |
