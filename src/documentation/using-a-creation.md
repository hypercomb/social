# Using a creation: three places, one promise

> **status: decided 2026-10-07 (jwize).** Every creation Hypercomb deploys —
> the business card first ([business-card.md](business-card.md)) — answers the
> same three questions: how someone without a host uses it, in perpetuity; how
> they bring their data along once they are a host; and how they take control
> with a domain of their own. The ledger at the end says what is true today.

## The promise: your version is yours

*jwize, 2026-10-07:* "when you're creating your hosts and somebody installs
something on it even if you update it it shouldn't affect other people who are
using a particular version. At most maybe a notification for a new version."

### Holding a published item: the head you took, and the update you're offered

*jwize, 2026-10-07:* "if there is no root you should get the latest head but if
you already have a head in a published item you should get an update notifier
that you can leave alone the same way you normally do your local. You should be
able to skip and leave the entry as the next entry in the list (ie. the current
is at the top). Then you either upgrade or skip; you can delete items if they
are inactive if you like but they don't delete source signature files."

The same rule holds for everything you take from someone's published site: a
card in your Hyperdex, a creation you adopted, the application you run, a
package you follow.

- **The first read takes the head.** If you hold nothing of an item yet,
  opening it takes its current head, and that becomes the version you hold.
- **Once you hold a head, a newer one is an update notice.** Nothing changes
  under you. You can leave the notice alone, the same way your own hive's
  update notice waits.
- **Upgrade or skip.** Each item keeps a list of its versions, with the current
  one at the top. Upgrading makes the newer head current. Skipping leaves it as
  the next entry under the current one, still there to take later.
- **Versions turn on and off.** One is on, the current one. The others are
  history items.
- **Deleting is a local forget.** You can delete an inactive version from the
  list. The entry goes, but the signature files it pointed to stay, and they
  remain valid everywhere else.
- **Outsiders read only the head.** From outside, a host shows an item's head
  and what that head holds. Your history of an item is the heads you took or
  were offered, kept on your side.

Content-addressing makes this cheap: a version is a signature, and the bytes
are never deleted, so the version you hold keeps working for as long as you
choose it. A package, an adopted creation or a card you hold all follow this
rule. The page you are on and the hive itself do too.

The hive already keeps this promise for its own code: it boots from what is
installed, and a new package is "one check per boot, no push channel … the
consumer asks; the icon is the answer; the human decides"
(`sharing/update-scout.service.ts`). An adopted peer's creation keeps the head
you accepted until you take a newer one. There are two gaps:
- **The third place below:** someone using a creation on another person's
  domain gets whatever that person published last.
- **The card page's Hyperdex:** it keeps a copy of each card, not its address
  and the head you took.

## Three places to use a creation

| | Where your data lives | Who decides when it changes | |
|---|---|---|---|
| **On someone's domain** (`jaime-weise.hypercomb.com`, or any host) | your browser, at that address: the silo | today the domain's owner; by this promise, you | no install, no host of your own; you trust the owner to keep the domain, and not to serve a backdoor: whoever runs the host decides what code that address serves |
| **On hypercomb.io** | your own hive, in your browser | you: a new version is a notice | the whole application; you cannot publish until you have a host and a domain |
| **On your own domain** (the best choice) | your host | you, entirely | nobody else's upgrade at the root reaches you |

## The path for someone without a host

1. **Use it where you found it, in perpetuity.** Open a creation on someone's
   domain and keep your own things there: on a card site, your own card and
   your Hyperdex. You may make yourself the default there ("Open this site
   with": your card instead of the owner's), so the site opens as yours on
   your device. Nothing you keep there is overwritten by the owner's next
   publish.
2. **Bring your data when you become a host.** Today the card page saves your
   cards and Hyperdex to a file and brings them back from one, at any address.
   Next, replication: your hive reads the silo the way it reads anything,
   and the file step disappears.
3. **Take control with your own domain.** A host and a domain of your own
   ([business-card.md](business-card.md), "a host and a domain before a card"):
   your address, your schedule, your versions.

## The minimal build

*jwize, 2026-10-07:* "we should be able to create any build we like without
having to change any of the architecture … make available the card and have it
be the default … a different pathway to a different experience."

A build is which behaviours are on. The phone build is everything off except
the card, and the card opens by default. That needs no new architecture: a
published door already is that build, a read-only shell that switches off every
authoring feature and opens one creation. The full hive is the same modules
with more of them on. Builds are phased up from the minimal one, never forked
from it.

### The thin layer is the way to your own host

*jwize, 2026-10-07:* "We can install larger builds later but for now it is
about hosting, replication and running a thin layer of Hypercomb to share an
experience that can be done in ways that guide the user to become their own
host and take back social control of their data. Obviously that is the final:
your domain, your server setup. That way you can bring these apps in after they
are feeling safe and you want to lock them down completely." And: "the whole
purpose is to have the mobile experience to be about your community."

- **On a phone, Hypercomb is a thin layer:** hosting, replication, and one
  shared experience. Your card and your community come first.
- **The layer guides.** Each step it offers leads toward the final setup: your
  own domain on your own server, where you take back control of your social
  data.
- **Larger builds come later.** The full hive, and apps beyond the card, arrive
  once someone feels safe and wants to lock things down on a host of their own.
  They are never the first thing a newcomer meets.
- **Your root domain is your first point of contact.** It opens your card and
  your Hyperdex. Its QR code and the links you share are the domain root
  (jwize's is `jwize.com`).

### Your root, your entrances, and the community farm

*jwize, 2026-10-07:* "we make the root page a lighter build and then the shares
are available through our card or page … your entrance over your root, meaning
let's just manage one for your mobile and one for your other devices. I say the
aggregate pool is the other participants and nothing holds you back. The
hosting is supposed to be shared within your community so we can take
advantage by signature the information. A signature is a right to use the
content, meaning someone published it publicly and shared the bytesig." And:
"You can move the hosting role over to pluginthematrix.io/com … you can have
the redundancy and start a little farm."

- **Two entrances at your root, and you manage both.** One opens on phones:
  the light build, your card and your Hyperdex. One opens on your other
  devices, whatever you choose. There is no aggregate page at the root.
- **What you share is reached through your card and your list:** people first,
  then their offerings. The aggregate is the community pool, the other
  participants, and nothing holds you back from it.
- **A signature is a right to use.** Content that someone published publicly,
  with its byte signature shared, may be used by anyone who holds that
  signature. That is how hosting is shared within a community.
- **Hosting is a farm, not a place.** The same bytes, held by signature on
  several hosts, give redundancy. jwize's hosting role moves from the
  `jwize.com` root to `pluginthematrix.com` and `pluginthematrix.io`, which
  frees his root to be his entrance.

### Powers are off by default, and the participant turns them on

*jwize, 2026-10-07:* "This must be participant driven … You can't get
dangerous stuff by default, so it needs to be off by default." And: "If someone
has an update you should preview in their hive … turn it on from there and
receive or be notified of updates if you follow them (ie. in your domains)."

- **Off by default.** No page on any domain keeps visitors' data, uses the
  camera, or reads other hosts until that domain's participant turns it on.
  A host's list of voices never turns it on by itself.
- **Turned on from your hive, for one version you previewed.** You preview a
  card page in your own hive and turn it on there for your domains. Your
  domains then serve that version with those powers, and no other.
- **Updates are followed, never taken for you.** When the page you follow has
  a newer version, your hive tells you. You preview it and turn it on, and only
  then do your domains change. This is the held-item rule ("Holding a published
  item" above) applied to the page your domain runs.
- **Scents inform the choice.** The community's scents on a version
  ([read-only-deployment.md](read-only-deployment.md), "Discovered security")
  are what you read before turning it on. They never turn it on for you.

## On a phone, the root is people

*jwize, 2026-10-07:* "this is a collaboration software so the first thing we
do is see a list of contacts — that's the root of Hypercomb on mobile. It's not
hexagons … first before the offerings the people and it starts with you."
And: "the card doesn't have to be a card but it should be a directory of
people … mine just happens to be a business card … we can give templates."

- The first screen is a **directory of people**: you at the top, then everyone
  you hold, then a way to make your own if you have none.
- **Tapping a person opens their front page**, whatever they chose. A business
  card is one kind, and a popular one; templates are offered for the rest.
- **Offerings come after people.** Following a person's domain shows what they
  offer (their host's signed offerings), and you can add those to your list:
  a friend's project beside their card.
- Mobile is for using creations; the hive at hypercomb.io is where they are
  made. The phone app is the published page; there is no separate native app.
- **Pulling up to the list is the phone's way back**, from any front page
  (*jwize, 2026-10-07:* "bake the scroll up to community list as the default
  mobile behavior"). The list is where other front pages and ways in are
  offered, never a menu laid over a creation.
- **The phone gesture opens a front page full screen.**

### Keeping a phone on one creation

A phone can be held to the one page without anything built here. The phone
does it itself, and the menu names vary by maker:
- **Android:** turn on App pinning (in Security settings), open the page, then
  pin it from the recent apps screen.
- **iPhone:** turn on Guided Access (in Accessibility settings), open the page,
  then triple-click the side button.

A device that should never leave the page, such as a kiosk on a counter, is
set up as a dedicated device by whoever manages it (Android's device owner
mode, or Single App Mode on a supervised iPhone).

## Ledger — what is true today

| | Status |
|---|---|
| The hive's own code changes only when you accept (notice, never a swap) | built |
| An adopted peer's creation stays at the head you accepted | built |
| Keeping your cards and scanning on a card door (someone without a host) | not built. A door keeps nothing: the read-only visitor shell gives the page storage that lasts one load, and the host's headers block the camera. It waits on a community standard that allows a verified card page to keep the visitor's data and use the camera ([read-only-deployment.md](read-only-deployment.md), "Trust is an allowance, never a tap"). Until then, keeping and scanning work in your hive |
| Held cards read and updated by address in the hive | built: essentials `CardReader` (`sharing/published-address.ts`, `commands/card-read.ts`) and the card page. An address's head is read from its door record and taken only when the publisher's signed index names it, binds that address to the lineage and opens a door there; an older head is never offered; a version from a file counts once its head is seen to carry its card. It reaches your hive with an essentials rebuild, and hypercomb.io with a revision publish. On a door, or with a root-path address (`hypercomb.com/<name>`), a held card waits unread |
| A held item keeps the head you took: a newer head is an update notice; upgrade or skip; the item's versions in a list with the current one on top; deleting an inactive version is a local forget | built for the hive's own packages and adopted creations. Not built in the card page, whose Hyperdex keeps a copy of each card rather than its address and head |
| A creation used on someone else's domain stays at the version you use | not built. The page would record the signature it runs, keep serving it, and show a notice when the domain publishes a newer one; the visitor shell would need to open a creation by signature |
| The list as the phone's root, people first, the default at the top, "create your own" at the bottom | built in the card page |
| Making yourself the default on someone's domain | built in the card page ("Open this site with") |
| Carrying your cards and Hyperdex to another address | built as a file (save, bring back) |
| Bringing a silo into your own hive by replication | not built |
| Offerings of a followed domain in your list | not built |
| A front page other than a card for a person in the list | not built: every row opens a card today |
| Pulling up from a front page to the list | built in the card page |
| A How-to the first time you reach the Hyperdex (jwize: "mobile is all about connecting people with our creations"): a menu down the middle, each section a popup you read and close, the three ways to set up with pros and cons | built in the card page. It opens by itself only where the page can remember it showed it once (not on a published door); a "How it works" row at the end of the list opens it again |
| Other front pages and ways in, offered from the list | not built |
| Editing your own front page in place, nothing kept until you accept | built in the card page ([business-card.md](business-card.md), "Editing a card in place") |
