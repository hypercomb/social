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

## The rolodex

The rolodex is the participant's collection of the addresses they have been
handed. It is a collection of references, so:

- An entry is an address. Opening it reads the card at its head, so a contact
  who changed jobs last week shows the new job without anyone being told.
- It is the participant's own and private by default, as every collection is
  ([collections-sharing.md](collections-sharing.md)); handing a card to one
  person does not put it in front of a third.
- It keeps no copy. A card that goes dark goes dark in every rolodex that
  holds it, which is the owner's right.

The exchange is two scans: you scan their code, they scan yours. A one-scan
handshake through a relay is a meeting point, never a store, and is not built.

## Why this is the founding creation

Each primitive the concept rests on is exercised by the card, and the card is
useful on day one, so it is the creation the concept is explained with:

| Primitive | Where the card uses it |
|---|---|
| A creation is a tile wearing marks | the page and the `view:default` mark |
| The participant's own address | `/domain claim`, then publish to `<name>.<zone>` |
| Hosting by a chosen host, live from the store | the machine that serves `jaime-weise.hypercomb.com` |
| The head is what the address answers | editing the tile and publishing again |
| References, never copies | the QR carries the address; the rolodex holds addresses |
| Collections are private, owned, cross-host | the rolodex |
| No central party | two cards on two domains are one application |

## Ledger — what is true today

| | Status |
|---|---|
| The card page on `jaime-weise`, opening by default, publishable with `/publish` | built |
| QR of the card's address on the back; scanning adds to the rolodex; rolodex kept on the device | built, in the page |
| The phone gesture (Quick Tap, shake) opening the card; a scribble choosing between cards | built for the local development build; the published site cannot yet be installed as an app |
| The page as one artifact of ~830 KB | not yet broken apart: the three.js dependency, the animation and the card data are owed as separate signed parts |
| Gestures and choosers as drone modules | design — the page carries a registry; nothing is a bee yet |
| The rolodex as a collection in the hive, synced across the participant's devices | design |
| Consent-hosted cards | design ([consent-hosting.md](consent-hosting.md)) |
