# Domain links — the copy is the navigation

*jwize, 2026-10-15. Built the same day.*

Any copy inside a website the hive hosts that says the **name** of a
published creation becomes a link to that creation, at its own address.
Nobody writes the links. When a new domain goes live, every page that
already mentioned it starts linking to it; when a creation is unpublished,
its name goes back to being plain text. The copy is how a reader moves
around the domains.

## The list is not authored

The names come from the **running list of publish and unpublish results**:
the `publish:results` pool of meaning (`sharing/publish-results.ts`), one
document holding every outcome in order, written by the one publish routine
(`publish-branch.ts`) and nowhere else. Folding the list — the *last* result
per creation decides, and only a publish with an address is a door — yields
the doors open right now: a name, its segments, the zone it is on, and the
address it opens at.

It is a truth pool. "I published this here" and "I took it down" are remote
acts no cold client could rebuild from layers, so it is never minted from
the optimize phase. The software writes it on its own, so it mints no kept
version. The list is bounded; the oldest results fall off the far end.

A reader without the pool gets the same doors from the publisher's **signed
index** (`doorsOfIndex`): roots, doors and addresses are the same facts,
signed. A visitor on a hosted page reads the publisher named by the page's
door record (`#hc-door`), from the zone the page is served on. The pool is
the fast local source; the index is the public one.

## The rule

`sharing/domain-links.ts`, pure, proven on a detached DOM:

- A name matches as a **phrase**, case-blind, with any run of non-letters
  between its words. `point blank solutions`, `Point-Blank Solutions` and
  `POINT  BLANK  SOLUTIONS` all say the creation named *Point Blank
  Solutions*. Whole words only: `card` never links inside `cardigan`. The
  longest name wins where two overlap.
- A match becomes an `<a>` at the door's address. **No underline.** The link
  wears the **colour of its domain** — one hue per zone, derived from the
  zone's name, so every page on every host agrees without a palette to ship.
  A link whose zone differs from the page's own carries `data-cross`.
- Copy that is already a link, code, a form control or editable text is left
  alone. A page never links to itself. Running the rule twice changes nothing.

## Where it runs

`sharing/domain-links.drone.ts` watches the site view host
(`#hc-site-view-host`, mounted by `presentation/tiles/site-view.drone.ts`)
and applies the rule as the page mounts and as it changes, one pass per
frame. Every `publish:result` effect drops the compiled table, so the next
pass sees the new domain.

Clicking a link to one of **your own** creations, in your own hive, moves
inside the hive — no reload; the site view reconciles on the navigation.
Any other link is an ordinary web link to another host.

## What this makes possible

Every mention is an incidence: copy on one domain naming a creation on
another is a mark that content wears. Collected across hosts, those marks
are a graph of who talks about whom — clusters across domains — and they
are a derivation of signed content, so they can be minted in the optimize
phase and rebuilt by any cold client. Not built yet; the doors and the
marks are here.
