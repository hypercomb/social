# The showcase — what your address shows, and your community behind it

jwize, 2026-10-24: "The showcase is the only thing people see when they are at
your address. You see your whole network." This is the default we recommend
for every networking-style app ("all networking style applications follow this
pattern … as a default recommendation"), and every editable community comes
with undo/redo ("any editable community … should include undo/redo as a
recommendation").

## Two views of one domain

- **A domain's page is a hyperdex** (jwize, 2026-10-25: "in the domain on
  hypercomb.com or persons.com it is a list that is an accordion and the
  domains you follow are the source for published items belonging to your
  peers"). Under a lean header (a small brand row, then the search), one row
  per domain: **this domain first and open**, its tiles its **showcase**;
  then the domains the viewer follows (`community:hosts`, kept on that
  origin), closed, each opening onto what that peer publishes. One row is open
  at a time. A stranger follows nothing there, so they see only the showcase;
  you, following your peers, see your whole network. On a phone that is all
  there is, with the search fixed at the bottom; the desktop keeps the setup
  beneath it, because it is the dashboard and the hosting (jwize: "desktop
  gets everything"). The front door draws it
  (`hypercomb-shim/src/bootstrap/showcase.ts`).
- **You** see your whole **community**: your domains, each opening onto what it
  hosts, where you choose what joins your showcase.

"Community" is the word people read; underneath, a domain is a colony
([colony = domain](./domain-claim.md)).

## Your community: domains are tiles

Your community is a list you keep (the `community:hosts` pool). In your hive it
reads as your **hyperdex**: one tile per domain, drawn from that list. Nothing
is minted in your tree for it: add or remove a domain and its tile follows.

The tiles' **themes and properties are pools of meaning** (jwize, 2026-10-24:
"they update across domains and applications when people plug in new
pieces"). A domain tile's look and what it carries are never baked into it:
update the pool once and every domain and app that reads it follows, and a new
piece someone plugs in extends the pool.

- Open a domain's tile and the page beneath it is that domain's creations:
  what it hosts, from its ledger and its public pools. One domain is open at a
  time, because that is how a hive's pages work.
- A creation can be **visited** and tested, or **run as a sandbox** on that
  domain.
- **Manage**, on the open domain, turns clicks into switches. A single click
  turns a creation on or off for your showcase, like a behaviour's switch. A
  creation turned off **grays out** where it is and stays until you leave the
  page; come back and it is gone from your showcase, found again under its
  domain.
- **Show all**, on a domain, puts everything it hosts in your showcase, now
  and later.
- **Your community is a versioned view.** Another person's creation shows at
  a version you see and choose; you can never publish or push anything onto
  their domain or their creation (jwize, 2026-10-25: "your community should
  have a versioned view you can't push things on them").
- **Yours reflect your latest publish.** Wherever your own creations appear
  in your community, they show your hive's latest published version (jwize,
  2026-10-25: "for you they should all reflect your hive latest publish
  version").
- **Your own domain** is one of the tiles. Its creations can be turned off
  where they open (`setHiveDoors`, the front door's Off) or unpublished.

## The record

What you chose for a domain is one record:

```json
{ "kind": "host:showcase", "zone": "hypercomb.com",
  "items": [{ "pubkey": "<64 hex>", "lineage": "dylan" }],
  "domains": ["jwize.com"] }
```

- **In your hive** it is a resource, and its signature sits in a passive
  `showcase` layer slot on that domain's page, written with
  `LayerCommitter.commitSlotSet`. Each switch is one ordinary commit, so undo
  and redo are the hive's own: Ctrl+Z on that page brings back the showcase
  before the click. No second undo stack exists.
- **In public** the same bytes go to the domain and are named in your signed
  index as `showcase:<zone>`, the path a zone's card takes (`welcome:<zone>`).
  The page reads your index from the domain, checks its signature and the
  record's name, and draws exactly the items it names plus everything on the
  domains it shows in full (`hypercomb-shim/src/bootstrap/showcase-record.ts`).
  The owners whose record counts are the keys the domain's own root names in
  the ledger.
- A domain with no record yet shows what opens on it.

The front door holds no key and cannot tell you from a visitor, which is why
the choice is a signed public record and never a switch on the page itself.
Adoptions (`host:adoptions`) stay what they were: one browser's own.
