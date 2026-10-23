# Did You Know — a meeting exercise of ideas shared without names

*jwize, 2026-10-22: "a did you know exercise for meeting participants that
allow them to share their did you know items anonymously … the host shows
text only and they get to read them, and then later we will reveal the name
at the end. We just share ideas we think the others might not know. Then the
participants can pull the items in to their collection of ideas so each can
have a resource to go back to later to help them learn." · "similar to the
q and a".*

**Status: built, proven.** `scripts/drive-didyouknow.cjs` runs three browsers
in one room through the words and the real notes desk. Module
`hypercomb-essentials/src/didyouknow/`. Like [Hypercomb Q and A](hypercomb-q-and-a.md),
it adds words to the swarm and the notes desk as they are; it builds no
store and no wire.

## The exercise in sentences

| Say | What happens |
|---|---|
| `start did you know` | The game's tile, `did you know`, appears on the page you stand on (or is found there) and the notes desk opens on it. Ask the room to stand on the same page. |
| `did-you-know <idea>` | Your idea is written as a note on that tile and shared with the room. If your page has no such tile yet, it is made first, so the room hears you. The desk opens, so you can read the others. |
| *read* | The desk shows everyone's ideas as plain words. **No name and no colour** is painted on any idea while the game runs, for the host and for every participant. |
| `collect` | Every idea you do not hold yet is taken onto your own `did you know` tile: the swarm's take, the same signature (shared, never copied). It is your list to go back to. Saying it again brings any that were still arriving. |
| `reveal` | The host writes one note on the tile listing every idea with its name. Every desk that finds it shows names again. |

`start` is the same word that starts [Hypercomb Q and A](hypercomb-q-and-a.md):
it asks each game for its own next-step sentence, so a game tells the
participant its own words.

## Why the tile is the game, and ideas are notes

- **The game is a tile named `did you know`.** `sign('did you know')` is the
  molecule, so one game is one word on every participant's hive. It folds the
  way every tile name folds: `Did You Know` and `did-you-know` are one tile.
- **An idea is a note on it**, not a tile. Notes already swarm: a peer's notes
  on a tile are the `notes` slot of their layer for it, read by signature, one
  colour per participant, with *Take* ([swarm-notes.md](swarm-notes.md)).
  Identical ideas are one row with a count. The desk reads them in the order
  they were written, the same for everyone.
- **Collecting is the take.** Nothing is copied: an idea thirty people collect
  is one file. After the meeting the ideas stay on your tile, in your hive,
  with the rest of your history. Move the tile anywhere with `into`; it is a
  tile like any other.
- **The reveal is a note.** Its first line begins `Revealed ·`. That is the
  whole signal: no second channel, no setting, no clock. It is read the way
  the Q and A tally is read — as a signed note on the tile — and it is hidden
  like any note (hiding it conceals the names again).

## Concealing the names

The rule lives in the pure module: **on the game's tile, authors are hidden
while no note beginning `Revealed ·` is among its notes** (yours or the
room's). It is handed to the notes service by the game's bee:

```ts
swarmNotes.concealAuthorsWhen((cell, texts) => concealsAuthors(cell, texts))
```

The desk asks `SwarmNotes.authorsHidden(cell, ownTexts)` before it paints a
name or a colour. When the answer is yes, a peer's idea shows as a plain row
with *Take*, and the name button — which would also have let you ignore a
person — is not drawn. The rule is generic (any game may register one) and
scoped by tile name; every other tile keeps its authors.

## Who brought what

The host's hive keeps a **ledger**: per note, its words and the first
participant seen holding it. It is fed by every swarm-notes read on the
game's tile and by a read a moment after the room or the page changes. It
exists because a participant who leaves takes their untaken notes with them:
the ledger still has the words and the name when the host says `reveal`.

`reveal` writes from the ledger plus the host's own notes, ordered as the
desk first saw them. It names what this hive has seen, never more. An idea
the host's own hive took before it had ever read the room is credited to the
host. In memory only, for the game being played.

## What "anonymous" means — and does not

This is an exercise among people in one room, and it is honest about that.

- **The name is hidden from the screen. It is not hidden from the wire.**
  Ideas travel as each participant's own signed notes, as every note does, so
  a participant who reads the swarm's data instead of the desk can see whose
  key holds which note. There is no mix-net here and none is claimed.
- **Anyone can say `reveal`.** The word is the host's by convention, not by
  gate; the reveal is one note, so a premature one is hidden like any note.
  A room that needs the gate enforced uses its host key (the room template,
  [swarm-pools.md](swarm-pools.md)) — a later step if a meeting ever wants it.
- **Everyone stands on the same page.** The swarm is read for the page in
  front of you, so the host and the participants play on one page — the
  room's page.
- **The first holder is the bringer.** If two participants write the same
  sentence it is one note, credited to whoever the host saw first.

## Pieces

| Piece | Role |
|---|---|
| `didyouknow/didyouknow.ts` | pure: the game's name, `concealsAuthors`, `isRevealNote`, `revealText`, `cleanIdea` |
| `didyouknow/didyouknow.service.ts` | `DidYouKnow` (`@diamondcoreprocessor.com/DidYouKnow`): start, share, reveal, collect, the ledger |
| `didyouknow/didyouknow.drone.ts` | the bee: registers the service, offers the game to `start`, teaches the notes service the concealment rule |
| `didyouknow/did-you-know.queen.ts` · `reveal.queen.ts` · `collect.queen.ts` | the three words |
| `notes/swarm-notes.service.ts` | `concealAuthorsWhen(rule)` and `authorsHidden(cell, own)` |
| `hypercomb-shared/ui/notes-strip/*` | the desk asks `authorsHidden` before it paints a name or a colour |
| `questions/start.queen.ts` | `register(name, start, say?)` — a game tells its own next words |
| `scripts/drive-didyouknow.cjs` | the three-browser proof |

All three words are pinned in `commands/machine-declarations.spec.ts` as
additive / network, and carry a `machine` grammar, so a participant's AI can
play too. `did-you-know` keeps everything after it verbatim (`rawArgs`), so an
idea's words are never read as other words; `reveal` and `collect` take no
arguments.

## Proof

```
node scripts/drive-didyouknow.cjs --url http://localhost:4253/ --relay ws://localhost:7777
```

Host Ana, participants Ben and Cy. It proves the start (tile and desk), the
room seeing the game, both participants sharing, the desk showing the host and
a participant the words with no name and no colour, the concealment scoped to
the game's tile, `collect` before the reveal, `reveal` naming each bringer,
a second `reveal` writing nothing, names returning on a participant's desk,
and `collect` after the reveal leaving the reveal behind.

## Not yet

- A projector view for the host: today the host reads the desk like everyone.
  A larger, text-only reading surface for a screen in the room is a view over
  the same notes.
- An enforced host: the reveal is the host's by convention.
- Studying the collection: collected ideas are notes on a tile, so the tutor
  view (the `tutor-build` skill) can turn them into recall cards; that is a
  separate step.
