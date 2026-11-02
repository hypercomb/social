# Recents and the quick tray — every tile you made, and the hand that carries one

> **Direction, jwize 2026-11-01. Not yet built.** This supersedes the model in
> `clipboard-sig-native.md` (cut / copy / paste as verbs, the clipboard window
> as the holding area). The codex carries the rules (`H7`–`H8`, `A7`–`A9`);
> this document carries the argument.

## One sentence

Every atom is one-to-many — one atom, many memberships — so *placing* is adding
an incidence, *cut* is dropping one, and *copy* does not exist. What remains is
a view that shows every atom a hive ever made, newest at the centre, and a
tray at the top of the screen that holds the signatures you are carrying.

## Why cut / copy / paste go

In a file system, copy duplicates bytes and cut moves them; the clipboard is
where bytes wait in between. None of that is true here. An atom is a
signature; a page lists signatures; the same signature can be listed by many
pages. `clipboard-sig-native.md` already proved the mechanics — a cut is one
`removeSig` on the source head, a paste is one `append` on the destination,
the bytes are never touched — but it kept the vocabulary and the window, and
with them a problem the vocabulary invented: once a tile is cut, its source
page no longer lists it, so the clipboard became "the only easy handle on it"
(`ClipboardEntry.cut` in `clipboard/clipboard.service.ts`). A safety flag for
a loss that only the verb created.

Say it in the hypergraph's terms and the problem is gone:

| The verb said | What it is |
|---|---|
| copy | nothing — placing a reference adds an incidence; no bytes move |
| cut | dropping one incidence; the atom, its bytes and its history are untouched |
| paste | adding one incidence, here |
| the clipboard | the set of signatures you are carrying |

An atom with no incidence is not lost. It is still an atom, still
sig-addressed, still in history (`H2`), and — the point of the next section —
still *in view*.

## The recents view: a hive's census of its own atoms

A full-screen view, opened from inside a hive, that shows **every atom that
hive ever created**, laid out by the date it came into being: the newest at
the centre, older ones further out. Filters are available while it is open
(by name, by mark, by date range, by whether it is placed anywhere); a filter
narrows what is *lit*, never what *exists*.

Three rules make it what it is:

1. **Never absent.** "We should always be able to view every tile we
   created." A tile that was hidden (`H4`) is shaded and pushed further out
   from the centre. A tile that was cut and never placed again is there too,
   at its date. A tile that is placed in six pages appears **once** — the
   census is of atoms, not of placements. Nothing a participant made can fall
   out of this view; the only way off it is the delete area, and that is
   already a deliberate, two-step act.

2. **Per hive.** The root is always a hive (below), so the census has an
   owner: it is *this hive's* atoms. Stand in a hive, open recents, see what
   that hive made. Visit someone's host and it is their hive's census. An
   "every hive" filter is available; a global pile is not the default,
   because a global pile would need a root to be the hive of, and roots are
   never implicit.

3. **Derived, never truth.** The census is a derived record keyed by the hive
   root's signature (`D1`, `D2`), minted in the optimize phase on miss and
   wipe-safe. A tile has no "created" field; its date is the first history
   marker that introduced its signature (`H1`, `H5`) — a cold client can
   rebuild the whole census from lineage bags alone, which is the litmus
   (`D3`). The wave view (`wave-view.md`) already paints a generation
   radially through show-cell's own shader and atlases; recents is a layout
   over a different set, drawn by the same code.

What recents is **not**: it is not Portals. Portals (`sets/`, the collections
source of the aggregate index) is the list of *roots you chose to keep* —
doors, places you go back to. Recents is one hive's atoms by date. They are
siblings in the aggregate index, two sources, and a participant can promote a
tile from recents to a portal with one deliberate mark — the same mark
`create` writes today. That promotion is never a side effect of anything.

## The root is always a hive, and hives are remembered

An atom is never its own root by accident. Every tile resolves upward to a
hive; a tile with no page still belongs to the hive it was made in, which is
why it still appears in that hive's census. The set of hives is itself kept —
the `sets/` index is that memory, one root lineage per row — so a root is
never silently made and never lost (`H8`).

This is what makes "hidden, shaded, further out" sufficient. A tile does not
need to be marked as a hive to stay findable; it needs a hive to belong to,
and it already has one.

## The quick tray: the hand

A full-screen view covers the destination. You can pick *from* it, but you
cannot walk to where you are going while it is open. Gathering five tiles
from three pages and placing them together needs something that stays visible
while you walk. That is the **quick tray**: a strip at the top of the
viewport that holds the signatures you are carrying.

- **Entered by the tile's drag handle.** Today the handle
  (`presentation/tiles/portal-carry.drone.ts`) carries a tile onto a row of
  the Portals window. It becomes the way *onto the tray*: use it and the
  tile's signature lands in the tray. The gesture is unchanged; only where it
  lands changes.
- **A reference, never a cut.** What travels is the signature. The source
  page is untouched. Nothing is written at pick-up — no `removeSig`, no
  `cut` flag, no marker. A tray full of signatures is a selection, not a
  transaction.
- **A set of signatures, no new pool.** Tile signatures or resource
  signatures. Participant-local, session state, the way the current selection
  is. No `sign('clipboard')` record is minted for it; no truth is written
  until a drop.
- **Visible while you walk.** Through a portal, into another hive, down a
  branch — the tray stays. It is the one piece of chrome that follows the
  participant across roots.

### The drop decides appearance or custody

Everything the verbs used to decide at pick-up is decided at the drop, which
is the only moment anything is written (`H5`):

| Drop as | Writes | The same pair as |
|---|---|---|
| **appearance** | `append(sig)` on the destination head — one new incidence | Portals' *add* |
| **custody** | `append(sig)` here, `removeSig(sig)` at the source — the incidence moves | Portals' *move* |

"Add is an appearance, move is custody" is the pair
`aggregate-index/sources/collections.source.ts` already names; the tray gives
it to every drop. Both ride `LayerCommitter.commitChildrenDeltas`, exactly as
`clipboard-sig-native.md` describes — the mechanics stay, the vocabulary goes.
A tile that was taken from a peer's branch (`fromPeer` today) is decided the
same way: the mark that says "these words are theirs" is written where it
lands, at the drop, and an adopted root is unsubscribed only when a custody
drop actually moves it — nothing changes until something happens.

## Trait groups: appearance belongs to the incidence

The same atom can legitimately look different in two hives. So a **trait
group** — a signature-addressed properties set — is a mark on the
*incidence*, not on the atom (`A4`, `A8`). Three things, three signatures:
the atom is the content; the incidence is where it is; the trait group is how
it looks *there*.

- The tray carries `{ atom, traitGroups[] }`. A tile picked up where it wore
  two groups arrives with both.
- The drop picks which group lands. Default: the one it wore at the source,
  so an ordinary move looks like a move. "Take the look of where it lands" —
  the destination hive's own default — is the other obvious pick. Both are
  chosen at the drop, never at pick-up.
- Nothing is copied. Trait groups are already resources by signature (`A6`);
  the drop writes a mark pointing at one. Two placements sharing a look share
  a signature.
- A second drop of the same atom on the same page with a different group is a
  **second incidence with its own look**, not a replacement. One atom, two
  appearances on one page is legitimate in a one-to-many model. "Replace the
  look" is a separate gesture on the tile itself.
- Recents shows the atom once, whatever it wears. Which groups it has can be
  read off the tile; the census is of atoms.

## What this retires (future work, not done)

| Retired | Replaced by |
|---|---|
| `ui/clipboard-panel/` (the clipboard window) | the quick tray (strip) + the recents view |
| `clipboard/clipboard.queen.ts` and the words `cut`, `copy`, `paste` | nothing at pick-up; *appearance* / *custody* at the drop |
| `ClipboardEntry.cut` and the "only handle" rule | recents, which never drops an atom |
| `PortalCarryDrone`'s meaning "drop on a Portals row" | the same handle sends the signature to the tray; the tray drops onto Portals rows as onto any page |
| the clipboard worker's exclusions and index-override re-mints | reconsidered once the tray exists; a prune is a derived collection either way |

The doctrine ratchets' allowlists shrink as each lands; none grows. Order of
work: the tray first (smallest change, and it is what lets the panel go), then
recents as a source of the aggregate index, then its full-screen layout, then
the retirements, then the trait-group pick at the drop — which only matters
once the tray carries more than one group.

## Open question

Whether the first-marker date can be read cheaply enough for a hive of tens
of thousands of atoms, or whether the census needs an incremental derivation
(each commit extending the previous census record under a new key). Either
way it stays derived (`D2`): the answer changes cost, not doctrine.
