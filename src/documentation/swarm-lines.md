# Swarm lines — the room as note lines

*jwize, 2026-10-13: "a swarm with a note interface instead of hexagons."*

A swarm room can be read as **lines** instead of hexagons. It is the same swarm
with the same acts. Only the surface changes.

- **Share.** Everyone in the room shares the notes they hold on the page they stand on.
- **Take.** Taking collects a line.
- **Leave.** Leaving takes your untaken lines with you. Lines someone took stay with them.

The word is `lines` (`lines`, `lines on`, `lines off`), and the view mode is `lines`.

## What a note is here

A note is a **file**: a signed note atom whose signature is its identity. The
page's notes are **references** to it, kept by the notes service (the tile's
`notes` slot plus its facet). A note is never a pool.

- **Identical notes are one line.** Thirty participants holding one note is one
  line with thirty holders (`×30`), never thirty copies.
- **Taking appends the same signature.** It adds the signature to your own page.
  It is shared, never copied.

## On the wire

The participant's page event (kind 30200, `SwarmLayerPayload`) gained one
optional field:

```json
{ "label": "Ana", "visuals": [ … ], "notes": ["<noteSig>", "…"] }
```

- **What it carries.** The page tile's own notes, the ones written there or
  taken, as signatures only, capped at 400. It is said only at the page itself
  (depth 0).
- **Only on a public page.** It is said only when the page tile is public. A
  public tile's notes already travel with its closure on a take, so nothing
  new leaves the device.
- **Older clients.** A client that doesn't know the field ignores it.
- **How bytes move.** The bytes are fetched by signature through the content
  broker. The receiver claims the references as live, owner-held atoms, so
  the fetch goes mesh-first to the author's device while they are in the room.
- **Leaving.** A participant who leaves stops being said. When their slot
  expires, their untaken lines go with them.

`SwarmDrone.peerNotesAtCurrentSig()` reads it, one row per (note, holder), with
the same self and expiry gates as `peerTilesAtSig`.

## The view

`notes/note-lines-view.drone.ts`, a full-surface view like the tree.

- **Top.** The page name and the room in counts: people · lines · yours · to take.
- **Lines.** Shown in arrival order, and a line never moves once placed. Each
  wears the colour of the participant who brought it (`participantColor`, the
  layer-cycle strip's algorithm, so a participant is one colour everywhere).
  The view shows who brought the line, how many hold it, and a Take.
- **Bottom.** One field. Enter writes and shares, and the field stays open.
- **Sharing a page.** In the swarm, your **first** note on a page shares that
  page (write and share by default). Nothing private rides along, because you
  had no notes there. A page that already holds your notes keeps your choice,
  and the hint offers *Share notes here*.

## Proof

`scripts/drive-swarm-lines.cjs` runs two browsers in one room:

```
node scripts/drive-swarm-lines.cjs --url http://localhost:4251/ --relay ws://localhost:7777
```

It proves both directions, colour, counts, take, two holders, and that leaving
removes untaken lines while taken ones stay.

## Next

The AI organizer is an ordinary participant, the host by default. It takes
lines as they arrive and groups them into **sections**. A section is a meaning,
`sign(sectionName)`, and the notes in it wear its mark. A section is never a
parent the notes are moved into. Only the organizer needs an AI.
