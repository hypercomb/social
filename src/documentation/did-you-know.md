# Did You Know — a meeting exercise of ideas shared without names

*jwize, 2026-10-22: "a did you know exercise for meeting participants that
allow them to share their did you know items anonymously … the host shows
text only and they get to read them, and then later we will reveal the name
at the end. We just share ideas we think the others might not know. Then the
participants can pull the items in to their collection of ideas so each can
have a resource to go back to later to help them learn." · "similar to the
q and a".*

*jwize, the same day, after the first build: "did you know is a toggle so the
game is accessible everywhere or to a specific branch. The game is tile layer
specific for data."*

**Status: built, proven.** `scripts/drive-didyouknow.cjs` runs three browsers
in one room through the words and the real notes desk. Module
`hypercomb-essentials/src/didyouknow/`. Like [Hypercomb Q and A](hypercomb-q-and-a.md),
it adds words to the swarm and the notes desk as they are; it builds no
store and no wire.

## The exercise in sentences

| Say | What happens |
|---|---|
| `did-you-know on` · `off` · `everywhere` | The toggle: where the game may be played. `on` and `off` act on the layer you stand on and everything beneath it; `everywhere` acts on the whole hive. The word alone flips the layer. See [The toggle](#the-toggle). |
| `start did you know` | Switches the game on here (unless a layer above already has), makes the game's tile on the page you stand on (or finds it) and opens the notes desk on it. Ask the room to stand on the same page. |
| `did-you-know <idea>` | Your idea is written as a note on that layer's game tile and shared with the room. If your page has no such tile yet, it is made first, so the room hears you. The desk opens, so you can read the others. |
| *read* | The desk shows everyone's ideas as plain words. **No name and no colour** is painted on any idea while the game runs, for the host and for every participant. |
| `collect` | Every idea you do not hold yet is taken onto your own `did you know` tile: the swarm's take, the same signature (shared, never copied). It is your list to go back to. Saying it again brings any that were still arriving. |
| `reveal` | The host writes one note on the tile listing every idea with its name. Every desk that finds it shows names again. |

`start` is the same word that starts [Hypercomb Q and A](hypercomb-q-and-a.md):
it asks each game for its own next-step sentence, so a game tells the
participant its own words.

## The toggle

*Accessible everywhere, or to a specific branch.* Did You Know is a behaviour a
**layer declares**, the same shape as the contact and dropbox behaviours: the
application-scope primitive of *what, where, scope*
(`visual:didyouknow:enabled`, a payload-free decoration on a layer).

- **One mark, read upward.** A word asks "is the game on here?" by walking up
  from the layer it was said on: this layer, then each ancestor, the root
  included. The nearest declaration answers. Nothing is stamped on
  descendants, so a layer made tomorrow inherits at once.
- **Everywhere is the root.** A mark on the root layer holds for every layer.
  `did-you-know everywhere` writes it from wherever you stand; `did-you-know
  on` at the root does the same.
- **A branch is a layer.** `did-you-know on` inside `/lecture` opens
  `/lecture` and everything beneath it, and nothing beside it.
- **`off` takes off the mark on this layer.** If the mark is held by a layer
  above, `off` changes nothing and says where it is held, so one layer never
  quietly switches off a branch it does not own.
- **The mark holds no ideas.** It says where the game may be played, nothing
  more. Switching it off never deletes a shared idea.
- **A word said where the game is off answers.** A typed word is a gesture;
  swallowing it reads as a broken game, so the refusal names the way in.
- **A room that is already playing here is enough.** A participant who arrives
  into a room never has to switch anything on: while a peer holds the game's
  tile on the page you stand on, the words work. The host's `start` switches
  the game on; the participants just join.
- **The roster's own switch is honoured.** The kind appears in the Beehaviors
  panel (a capability row that cascades, and that the panel can add or remove
  on a layer). Switching it off there closes the game everywhere, the one
  switch with the one meaning. A hive that simply never lit it still plays.

### Where the data lives

The data is **tile-layer specific**. An idea is a note on the `did you know`
tile of the layer where it was shared, so every layer keeps its own set and
moving to another layer shows that layer's ideas. Turning the game on
*everywhere* does not pool anything: an idea shared on `/lecture/biology` is
on that layer's tile, not on the root's. `collect` takes the room's ideas onto
your own tile on the same layer.

## Why the tile is the game, and ideas are notes

- **The game is a tile named `did you know`** on each layer that plays it. `sign('did you know')` is the
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
| `didyouknow/didyouknow.ts` | pure: the game's name, the toggle's mark and words (`parseToggle`), `concealsAuthors`, `isRevealNote`, `revealText`, `cleanIdea` |
| `didyouknow/scope.ts` | the toggle's record: `declaredAt` (walks up, root included), `enableAt`, `disableAt` |
| `didyouknow/didyouknow.service.ts` | `DidYouKnow` (`@diamondcoreprocessor.com/DidYouKnow`): toggle, availability, start, share, reveal, collect, the ledger |
| `didyouknow/unavailable.ts` | the one sentence a refused word says |
| `presentation/tiles/show-features.drone.ts` | the Beehaviors capability row for `visual:didyouknow:enabled` |
| `didyouknow/didyouknow.drone.ts` | the bee: registers the service, offers the game to `start`, teaches the notes service the concealment rule |
| `didyouknow/did-you-know.queen.ts` · `reveal.queen.ts` · `collect.queen.ts` | the three words |
| `notes/swarm-notes.service.ts` | `concealAuthorsWhen(rule)` and `authorsHidden(cell, own)` |
| `hypercomb-shared/ui/notes-strip/*` | the desk asks `authorsHidden` before it paints a name or a colour |
| `questions/start.queen.ts` | `register(name, start, say?)` — a game tells its own next words |
| `scripts/drive-didyouknow.cjs` | the three-browser proof |

The three words are pinned in `commands/machine-declarations.spec.ts` and carry
a `machine` grammar, so a participant's AI can play too: `reveal` and
`collect` as additive / network, `did-you-know` as editing / network because
`off` takes a mark off a layer (undoable). `did-you-know` keeps everything
after it verbatim (`rawArgs`), so an idea's words are never read as other
words. Only the exact words `on`, `off` and `everywhere` toggle: an idea that
merely starts with one (`on Mars a day is longer than its year`) is an idea.

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

Then the toggle: a participant plays a room without switching anything on;
`start` at the root opened every layer; an idea belongs to the layer it was
shared on; `off` on a layer that only inherits the mark changes nothing; `off`
at the root closes the layers beneath and the word is refused, writing
nothing; `on` on a branch opens that layer and what is beneath it but not a
sibling; `everywhere` opens the sibling; the word alone flips.

## Not yet

- A projector view for the host: today the host reads the desk like everyone.
  A larger, text-only reading surface for a screen in the room is a view over
  the same notes.
- An enforced host: the reveal is the host's by convention.
- A per-layer opt-out under an `everywhere` mark (the hidden-pool shape the
  other behaviours use). Today a layer is closed by taking the mark off where
  it is held.
- The toggle is not carried by a take: a mark is a decoration, and a take
  carries no decoration records. A participant who wants the game on their own
  layers declares it in their own hive; a room that is playing needs nothing.
- Studying the collection: collected ideas are notes on a tile, so the tutor
  view (the `tutor-build` skill) can turn them into recall cards; that is a
  separate step.
