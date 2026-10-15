# Notes in the swarm

*jwize, 2026-10-13: "we should just integrate this into our notes … streamline
them and make them possible to swarm with."*

Notes are one thing, and the swarm is a property of them. In a swarm the notes
desk (notes | lists, hierarchical, with its composer) shows **everyone's**
notes on a tile you share, in the one tree. It is the same swarm with the same
acts as tiles.

- **Share.** Everyone in the room shares what they hold on a tile.
- **Take.** Taking collects a note.
- **Leave.** Leaving takes your untaken notes with you. Notes someone took stay
  with them.

An earlier `lines` view, a separate app for the same thing, was folded in here
and removed.

## No new wire

A tile's notes live in its layer's `notes` slot, and every tile a participant
shares already crosses the room as a visual carrying its `layerSig`. So **a
peer's notes on a tile are the `notes` slot of their layer for that tile.**

1. **Read the peer's layer.** It is read by signature through the content
   broker, mesh-first from the peer's device while they are in the room.
2. **Resolve the slot.** The notes service resolves the slot's entries (note
   sigs or the meta envelopes naming them) exactly as it resolves this hive's
   own, using `NotesService.notesOfEntries`.
3. **Fetch missing bytes.** Note bytes not yet here are fetched by signature,
   with each tree walked whole.

One listener keeps it live. When a tile's notes change on the page you stand on
(written or taken), the swarm re-announces the page, because the tile's
`layerSig` changed with its notes.

## A note is a file

A note is a signed atom, and its signature is its identity. Notes are never a
pool and never a tile.

- **Identical notes are one row.** Thirty participants holding one note is one
  row with `×30`.
- **Taking appends the same signature.** `NotesService.takeAtSegments` adds it
  to your tile in one commit however many notes are taken. It is shared, never
  copied.

## In the desk

- **Colour.** A note someone else holds wears their colour down its left edge
  (`participantColor`, the layer-cycle strip's algorithm, so a participant is
  one colour everywhere).
- **Row labels.** A peer's note names who brought it and offers **Take**. Your
  own note that others took shows `×count`.
- **Read-only.** A peer's note can't be edited, dragged or nested. Take it
  first, and then it is yours.
- **Footer.** The footer counts the room: *here · notes · yours · to take*,
  with **Take all**.

## Sharing your notes

In the swarm, your **first** note on a tile the room shares makes your tile
shared (write and share by default):

- **Tile not on your page yet.** It is created through the same create commit
  the `create` word runs. A tile made in the swarm is shared.
- **Tile on your page but private.** It is marked shared.

Nothing private rides along, because you had no notes there. A tile that already
holds your notes keeps whatever you chose for it.

## Pieces

| Piece | Role |
|---|---|
| `notes/swarm-notes.ts` | pure: `foldPeerRoots`, `participantColor`, the shapes |
| `notes/swarm-notes.service.ts` | `SwarmNotes`: reads peers' layers, `rootsFor`, `holdersOfMine`, `counts`, `take` |
| `notes/swarm-notes.drone.ts` | the bee that registers it (`@diamondcoreprocessor.com/SwarmNotes`) |
| `hypercomb-shared/ui/notes-strip/*` | the desk: peer roots in the tree, take, counts (`notes-strip.swarm.scss`) |

## Proof

`scripts/drive-swarm-notes.cjs` runs two browsers in one room through the real
desk:

```
node scripts/drive-swarm-notes.cjs --url http://localhost:4251/ --relay ws://localhost:7777
```

It proves both directions, colour and author, counts, take, two holders, and
that leaving removes untaken notes while taken ones stay.

## Next: categories that settle by count

A **category** is a heading root in the notes tree, and organizing is nesting
notes under it, which the desk already does by hand.

- **Peers' categories show as optional roots.** They are counted by how many
  participants hold a category of that name. The name folds to one molecule, so
  the shared structure settles by numbers.
- **Each participant organizes in their own tree.** They file notes by hand, or
  their own AI (their provider, their key) suggests a filing that they apply.
  Both write the same nests, and neither is a parent that someone else's notes
  are moved into.
