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

A creation has two halves, and they are treated differently:

- **What you read is live.** A card you follow, a page you visit, a friend's
  offering: opening it reads its head, so you always see what its owner
  publishes now. That is the point of holding an address.
- **What you run is chosen.** The application your own data lives in — the
  page, the bees, the template — changes only when you accept a new version.
  A newer one is a notice, never a swap under you. Content-addressing makes
  this cheap: a version is a signature, the old bytes are never deleted, so the
  version you use keeps working for as long as you choose it.

The hive already keeps this promise for its own code: it boots from what is
installed, and a new package is "one check per boot, no push channel … the
consumer asks; the icon is the answer; the human decides"
(`sharing/update-scout.service.ts`). An adopted peer's creation keeps the head
you accepted until you take a newer one. The gap is the third place below:
someone using a creation on another person's domain gets whatever that person
published last.

## Three places to use a creation

| | Where your data lives | Who decides when it changes | |
|---|---|---|---|
| **On someone's domain** (`jaime-weise.hypercomb.com`, or any host) | your browser, at that address: the silo | today the domain's owner; by this promise, you | no install, no host of your own; you trust the owner to keep the domain |
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

## Ledger — what is true today

| | Status |
|---|---|
| The hive's own code changes only when you accept (notice, never a swap) | built |
| An adopted peer's creation stays at the head you accepted | built |
| A creation used on someone else's domain stays at the version you use | not built. The page would record the signature it runs, keep serving it, and show a notice when the domain publishes a newer one; the visitor shell would need to open a creation by signature |
| The list as the phone's root, people first, the default at the top, "create your own" at the bottom | built in the card page |
| Making yourself the default on someone's domain | built in the card page ("Open this site with") |
| Carrying your cards and Hyperdex to another address | built as a file (save, bring back) |
| Bringing a silo into your own hive by replication | not built |
| Offerings of a followed domain in your list | not built |
| A front page other than a card for a person in the list | not built: every row opens a card today |
