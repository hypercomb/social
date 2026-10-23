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

## Categories: the ledger's tree

*jwize, 2026-10-18: "AI creates some categories and Jev sorts them to fit the
structure … a hierarchy of the notes in their categorical order … to the left
of the notes, a treeview of sorts."*

A tile's notes grow a hierarchy, shown as a tree in a column to the left of
the notes. Picking a label shows that branch (the label wears a check),
**Unsorted** shows what no category holds, and **All notes** shows everything.

- **The notes are never touched.** The tree is its own canonical JSON
  document, `{ categories: [{ name, notes: [noteSig], children }] }`, and the
  tile's layer points at it from the `categories` slot, beside `notes`. Filing
  a note puts its signature in a category, so the note keeps its bytes, its
  place in the list and its identity. That is why categories are not heading
  notes with notes nested under them, which the earlier plan proposed: a
  parent note embeds its children, so nesting would rewrite atoms and move
  every filed note onto the lists tab.
- **One place per note.** Filing a note again moves it. Removing a category
  unsorts its notes and loses none of them. Names fold the way tile names do,
  so `Energy` and `energy` are one category. The tree goes three levels deep
  at most.
- **AI suggests and only adds.** `auto_awesome` sends the tile's notes to the
  participant's own AI: a local model, or a provider they allowed to read the
  hive (`/providers`). It answers with an outline, which is laid onto the
  tree. Names already there, and everything already filed, stay as they are.
- **Jev sorts.** `sort` files each unsorted note with one Jev choice per note,
  all of them in one call (`assistant/jev-sort.ts`: the rubric, with
  confidence gated at 0.6). A note Jev is unsure of stays unsorted. Without
  Jev, the participant's AI does the same job.
- **By hand, always.** `+` names a category (Enter keeps naming), and a
  double-click renames one. With a note open in the pane, `sell` on a label
  files it there.
- **The room.** A peer's shared tile carries their layer, so their tree
  arrives with their notes (`SwarmNotes.peerCategoriesFor`). A label shows
  `×N` when N people hold a category of that name at that place. Categories
  only others hold are listed under **In the room**, and ✓ takes one into your
  own tree. The shared structure settles by numbers.

Pieces: `notes/note-categories.ts` (the pure tree, with its spec),
`notes/note-categories.service.ts` (`NoteCategories`, registered by
`note-categories.drone.ts`), `assistant/jev-sort.ts`, and in the desk
`notes-strip.cats.scss`. Proof, each against a running dev server:

- `drive-notes-categories.cjs` (15/15): by hand, branches, reload, rename,
  remove, and what the desk says with no AI set up.
- `drive-notes-categories-ai.cjs` (11/11): your AI, through the real `local`
  provider, against a stand-in model server. It names nested categories, a
  second suggestion adds nothing, and the notes are sorted with the unsure one
  left unsorted.
- `drive-notes-categories-jev.cjs` (11/11): Jev, with OpenRouter answered
  inside the script. It runs one decision for the tile, one choice per note,
  and the gate holds.
- `drive-swarm-notes-categories.cjs` (10/10): two browsers. A shared name
  counts every holder, and a name only one person holds is offered to the
  other and taken.

## How it is used

A lecture, a meeting or a class in which everyone takes notes into one shared
ledger.

**The host, before the session**

1. **Open a door, once per host.** Publish a revision under the name `swarm`
   (`npm run publish:revision -- swarm`). From then on `swarm.<host>` runs
   exactly that package for everyone who enters, so the whole room runs the
   same code.
2. **Make the room's tile.** Make the tile (`lecture`, say) on the page you
   will share, and write the agenda on it in the notes desk. Shared in the
   room, it becomes the template: anyone who arrives gets it, even after you
   leave.
3. **Say what the room asks.** Select the tile and type `room asks notes
   keep-alive`. Arrivals are offered those behaviours.
4. **Optionally, seed a structure.** Name a few categories with `+`, or press
   ✨ to let your AI suggest some.
5. **Hand out the link.** Use `invite`. When your host has a swarm door, the
   link lands there.

**A participant, in the room**

1. **Arrive.** Open the link. It asks before joining, then a toast says what
   the room asks, with a button for each behaviour, and points to the notes.
   Nothing opens or turns on by itself.
2. **Write.** Write in the notes desk, which opens on the room's tile. Each
   line goes to the room in the order it was written, in your colour and
   under your name. Other people's lines arrive the same way.
3. **Collect.** ✓ takes a line (one note, two holders, never a copy) and ✕
   dismisses it. Clicking a name ignores that person for the session or for
   good.
4. **Organize, your own way.** By hand: name categories with `+` and file the
   note you are reading with the tag button. With your AI: ✨ suggests
   categories. With Jev: `sort` files every unsorted note it is sure of. The
   tree sits to the left of the notes, and a label shows its branch.
5. **Let the structure settle.** A category held by others counts them (×N).
   Once enough of the room holds it, it is settled (the `verified` mark).
   "Take the room's structure" brings in every settled category you lack.
6. **Take it home.** The first time, type `room home <your hive's address>`.
   Then type `room home` and press "Open my hive": the room's tile, with
   everything you collected and organized on it, is offered in your own hive.

**Starting a session.** When the session begins, the host (in the room) types
`room start`. Everyone who has ever joined that room by its link is told:
"The session in <room> is starting", with a Join button. They are told even
if they left, or are elsewhere in their own hive. Join asks the way the link
did. The host is not told of their own start, and anyone already in the room
is not told again.

- *Who hears it.* Every join remembers the room on that device: room, secret
  and meeting point, newest first, at most twelve rooms. The list holds the
  secret, so it is a credential. It stays in this device's localStorage
  (`hc:rooms`) and never goes into a pool, a resource or an event. For each
  remembered room, `room-notice.drone.ts` keeps one small socket to the
  room's meeting point and asks for one filter. A meeting point closes a
  socket it hears nothing from for two minutes, so every 45 seconds each
  socket renews its listen. That is still under two minutes in a hidden tab,
  whose timers wake only on whole minutes. The renewal reuses the same
  subscription. Once the stored notices have arrived it is live only
  (`limit: 0`), so nothing stored is sent again. A listen the meeting point
  refuses (full, rate-limited) closes and dials again later.
- *What is sent.* The notice is a nostr event of kind 30569, addressable (one
  per signer per room). It is posted at `sign('room:notice:' + the room's
  pool address)`. That address holds the secret, so only someone who was
  given the room can ask for its notice, or post one. Its content is
  `{ label, segments, startedAt }`, never the secret. It expires three hours
  after the start.
- *Kept alive while the session runs.* A meeting point keeps events in memory
  only, so a restart would lose the notice for anyone who opens their hive
  later. While the host stays in the room, their hive posts the notice again
  every five minutes. It is the same signed event every time (signed once at
  `room start`), so it is the same id, and no listener takes a re-post for a
  new start. That includes hives on the version before re-posting, which knew
  a notice by its id. A re-post goes out on the host's own mesh socket to the
  meeting point (`NostrMeshDrone.sendSigned`), so it opens no extra
  connection. A reload of the host's tab resumes it: the signed event, never
  the secret, is kept in that tab's sessionStorage. The re-posts stop when
  the host leaves the room or three hours have passed.
- *Pieces.* `sharing/room-notice.ts` (pure: the list, the address, reading a
  notice), `room-notice.drone.ts` (listens, toasts, joins through
  `joinMeetingPlace`; signs, posts and re-posts the host's notice),
  `room start` in `room.queen.ts`. The remembering happens in
  `meeting-invite.join.ts`, through that file's one raw write.
- *Proof.* `node scripts/drive-swarm-session-start.cjs --url
  http://localhost:4251/ --relay ws://localhost:7791` passes 11/11 with two
  browsers, and on live hypercomb.io and swarm.hypercomb.com.
  `node scripts/drive-swarm-session-repost.cjs --url http://localhost:4251/`
  passes 19/19. It runs its own relay and restarts it to wipe its memory. The
  checks cover: re-posts with one id and no second toast, listen renewals, a
  host reload resuming the same session, the notice coming back after the
  restart for a guest who opens their hive then, and the posts stopping when
  the host leaves.

**When people leave**, their untaken lines leave with them. What you took and
organized stays yours, here and, once taken home, in your own hive.
