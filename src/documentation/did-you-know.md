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

**Status: built and driven.** `scripts/drive-didyouknow.cjs` runs three
browsers in one room (the root half through the words and the real notes desk,
the layer half at service level; see *Proof*), and the service, the pure half
and the drone each have a spec. What the code does not do yet, found by an
independent read, is listed under *What is not true yet*; the main gap is that
a layer's game has one round. Module
`hypercomb-essentials/src/didyouknow/`. Like [Hypercomb Q and A](hypercomb-q-and-a.md),
it adds words to the swarm and the notes desk as they are; it builds no
store and no wire.

## The exercise in sentences

| Say | What happens |
|---|---|
| `did-you-know on` · `off` · `everywhere` | The toggle: where the game may be played. `on` writes the mark on the layer you stand on unless a layer above already holds one (then it writes nothing and says where), and `off` removes the mark from exactly that layer; the game is on for that layer and everything beneath it because readers walk up. `everywhere` writes the mark on the root layer. The word alone flips this layer's own mark. See [The toggle](#the-toggle). |
| `start did you know` | Join the room first: a tile made before you join stays private and a later join never shows it. Then it switches the game on here unless a layer above already holds the mark (at the root that is everywhere; the reply says nothing of it), makes the game's tile for the page you stand on, named for that layer (or finds it), and opens the notes desk on it. Ask the room to stand on the same page. |
| `did-you-know <idea>` | Your idea is written as a note on that layer's game tile and shared with the room. If your page has no such tile yet, it is made first, so the room hears you. The desk opens, so you can read the others. |
| *read* | The desk shows everyone's ideas as plain words. **No name and no colour** is painted on any idea while the game runs, for the host and for every participant. |
| `collect` | Needs a joined tab. Every idea in the room you do not hold yet is taken onto your own game tile for that layer: the swarm's take, the same signature (shared, never copied). The reveal is left behind. Not taken: ideas by people you ignored, lines you dismissed, anything while the room is hidden, and ideas whose author has left. Saying it again brings any that were still arriving. |
| `reveal` | One note on the layer's tile listing every idea with its name; it works on one tile once, since a tile that already holds a reveal answers "already revealed". Every desk that finds the note shows names again, on that layer only. |

Words are said in the command line in **command stance**: type `/` first (it
turns into the prompt icon), then the word bare. In tiles stance, the default,
a plain line makes a tile, and opening a meeting link puts the line back to
tiles. A line typed into the notes desk's composer is written as a note on the
tile, so an idea typed there skips the word's 600-character cap and its
availability check.

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
- **`off` takes off the mark held by exactly this layer.** If this layer holds
  none and a layer above does, `off` changes nothing and says where it is held,
  so one layer never quietly switches off a branch it does not own. If this
  layer and a layer above both hold one, `off` removes this layer's and the
  game stays on through the one above. A room already playing here keeps the
  game playable whatever `off` said.
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

The **mark** is per layer, and so are the **ideas**, because the tile is named
for its layer.

A tile's notes are a *facet of its word* (`notes/notes-facet.ts`, decided
2026-09-04): on a device that holds an author key, every tile with one name, on
any layer, reads one notes list, and a commit writes that whole list into the
slot of the layer you are standing on. A game tile named `did-you-know` on every
layer therefore pooled every layer's ideas and carried the root's reveal note
into each new layer (the first build, `d73e66186`, did exactly that). So the
game does not use one name. It uses a name per layer, and a
different word is a different facet:

| Layer | The game's tile |
|---|---|
| the root | `did-you-know` |
| `/lecture` | `did-you-know-lecture` |
| `/lecture/biology` | `did-you-know-lecture-biology` |

- **Everyone on one page works out the same name** from the page's path, each
  segment spelled the way the lineage names a layer (NFC, every run of
  punctuation and space folded to one hyphen) and lower-cased without the
  device's locale, so the room finds one tile. `R&D` and `RD` are two layers
  (`did-you-know-r-d`, `did-you-know-rd`); `it's` and `it-s` are one. A segment
  of nothing but symbols or emoji is spelled `x` and a short hash.
  `gameTileName(page)` is pure and spec-covered.
- **Each layer keeps its own ideas, its own reveal and its own ledger.** A
  reveal on `/lecture` does not reveal the root's game, nor the reverse; the
  lecture's game starts concealed though the root's was revealed; `reveal`
  names only the ideas seen on the layer it is said on. Turning the game on
  *everywhere* pools nothing.
- **Only that name is the game.** The desk's concealment, the tile lookup, the
  peer-tile rule and the ledger all ask `isGameTile(name, page)`: the tile
  named for the layer you stand on. A `did-you-know` tile on another layer, or
  a tile of yours that merely starts with the words (`did-you-know-about-cats`),
  is an ordinary tile.
- **A path too long for a tile's name** (64 characters) is cut and closed with
  a short hash of the whole path, so a deep layer is still one name.
- **Limits.**
  - Two layers whose paths differ only by where a hyphen falls (`/a-b` and
    `/a/b`) or by case (`/Lecture` and `/lecture`) get one name and so one
    list.
  - **The list belongs to the word, not the tile.** A new layer made later at
    an old path (after a rename, move or delete) reads the old layer's ideas
    and reveal at once, so it starts revealed. A tile spelled like any layer's
    game tile shares that game's list. Moving or renaming a layer renames the
    games of everything beneath it too; the old tile stays a plain tile that
    still holds its ideas.
  - **The root keeps the plain word `did-you-know`, the word every earlier
    build used on every layer.** On a device that played that build with an
    author key, the root game starts with the old pooled list, including any
    old `Revealed ·` note, so it starts revealed. Start the game on a fresh
    layer, or clear that tile's notes first. An earlier build's
    `did-you-know` tile on a deeper layer is now an ordinary tile that
    displays the root game's list.
  - **A nested game needs every participant on this build.** At the root the
    old and new names are the same word and the builds interoperate. Below the
    root an older build's guest cannot see a newer host's tile (they answer
    "off here"), and an older host's tile is not read by a newer guest. The
    room splits without an error.

## Why the tile is the game, and ideas are notes

- **The game is a tile named for its layer** (`did-you-know`, `did-you-know-lecture`,
  see *Where the data lives*), so one game on one layer is one word on every
  participant's hive. It folds the way every tile name folds: `Did You Know`
  and `did-you-know` are one tile.
- **An idea is a note on it**, not a tile. Notes already swarm: a peer's notes
  on a tile are the `notes` slot of their layer for it, read by signature, one
  colour per participant, with *Take* ([swarm-notes.md](swarm-notes.md)).
  Identical ideas are one row with a count. The desk reads them in the order
  they were written, the same for everyone.
- **Collecting is the take.** Nothing is copied: an idea thirty people collect
  is one file. After the meeting the ideas stay on your tile, in your hive,
  with the rest of your history. The tile is a tile like any other; moved to
  another layer it is no longer that layer's game, and stays a plain tile.
- **The reveal is a note.** Its first line begins `Revealed ·`. That is the
  whole signal: no second channel, no setting, no clock. It is read the way
  the Q and A tally is read — as a signed note on the tile. A reader can wave
  the note off for themselves: names go back for them when they press its ✕
  (for the session), press "Hide the room", or ignore its author; for everyone
  only when its author removes it. The host's own reveal has no ✕.

## Concealing the names

The rule lives in the pure module: **on the game's tile of the layer you stand
on, authors are hidden while no note beginning `Revealed ·` is among its notes**
(yours or the room's). It is handed to the notes service by the game's bee,
which supplies the page you stand on, because the tile is named for its layer:

```ts
swarmNotes.concealAuthorsWhen(concealsOnThisPage) // (cell, texts) => concealsAuthors(cell, texts, currentPage())
```

`concealsOnThisPage` is one named function that reads the lineage at the moment
the desk asks, so the page is never stale and a second registration is the same
rule (`didyouknow.drone.spec.ts`).

The desk asks `SwarmNotes.authorsHidden(cell, ownTexts)` before it paints a
name or a colour. When the answer is yes, a peer's idea shows as a plain row
with *Take*, and the name button — which would also have let you ignore a
person — is not drawn. The rule is generic (any game may register one) and
scoped by the layer's own tile name; every other tile keeps its authors.

## Who brought what

The host's hive keeps a **ledger per layer**: per note, its words and the first
participant seen holding it. It is fed by every swarm-notes read on the
game's tile and by a read a moment after the room or the page changes. It
exists because a participant who leaves takes their untaken notes with them:
the ledger still has the words and the name when the host says `reveal`.

`reveal` writes from the ledger plus the host's own notes, ordered as the
desk first saw them. It names what this hive has seen, never more. An idea
the host's own hive took before it had ever read the room is credited to the
host. In memory only, one book per layer in each tab (kept under the layer's
game word, so a layer reached by two spellings is one book); it is not scoped
to a round (see *What is not true yet*), and it is never pruned.

A word is finished on the layer it was said on. If the host moves to another
layer while `reveal` is reading the room, the reveal still lands on the layer
it was said on and names only that layer's ideas; a `collect` that finds the
host somewhere else takes nothing and answers that there is nothing here.

## What "anonymous" means — and does not

This is an exercise among people in one room, and it is honest about that.

- **The name is hidden from the screen. It is not hidden from the wire.**
  Ideas travel as each participant's own signed notes, as every note does, so
  a participant who reads the swarm's data instead of the desk can see whose
  key holds which note. There is no mix-net here and none is claimed.
- **Anyone can say `reveal`.** The word is the host's by convention, not by
  gate; a premature reveal ends that layer's one round (a reader can wave it
  off for themselves; only its author can remove it).
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
| `didyouknow/didyouknow.ts` | pure: the game's name, the tile's name for a layer (`gameTileName`, `isGameTile`), the toggle's mark and words (`parseToggle`), `concealsAuthors`, `isRevealNote`, `revealText`, `cleanIdea` |
| `didyouknow/scope.ts` | the toggle's record: `declaredAt` (walks up, root included), `enableAt`, `disableAt` |
| `didyouknow/didyouknow.service.ts` | `DidYouKnow` (`@diamondcoreprocessor.com/DidYouKnow`): toggle, availability, start, share, reveal, collect, the ledger |
| `didyouknow/unavailable.ts` | the one sentence a refused word says |
| `presentation/tiles/show-features.drone.ts` | the Beehaviors capability row for `visual:didyouknow:enabled` |
| `didyouknow/didyouknow.drone.ts` | the bee: registers the service, offers the game to `start`, teaches the notes service the concealment rule |
| `didyouknow/did-you-know.queen.ts` · `reveal.queen.ts` · `collect.queen.ts` | the three words |
| `notes/swarm-notes.service.ts` | `concealAuthorsWhen(rule)` and `authorsHidden(cell, own)`, with `notes/swarm-notes.conceal.spec.ts` |
| `hypercomb-shared/ui/notes-strip/*` | the desk asks `authorsHidden` before it paints a name or a colour |
| `questions/start.queen.ts` | `register(name, start, say?)` — a game tells its own next words |
| `didyouknow/didyouknow.spec.ts` · `scope.spec.ts` · `didyouknow.service.spec.ts` · `didyouknow.drone.spec.ts` | the pure half (names, boundaries, the lineage fold), the toggle's record, the service (tile per layer, peer clause, ledger per layer, reveal, a word in flight while the host moves) with its neighbours faked, and the rule the drone teaches the desk |
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

Then the layers, driven at **service level** for the sharing (`share`, through
Ana only) and through the word for the reveal (`/reveal`): the pure name
matches (`did-you-know`, `did-you-know-lecture`,
`did-you-know-lecture-biology`); an idea shared on a layer is on that layer's
own tile, which holds nothing of the root's game, and the root's tile does not
hold it; the layer's game starts concealed though the root's was revealed, on
the rule and on the desk the host reads; a reveal there names that layer's
ideas and none of the root's, brings the names back on that layer's desk, and
leaves the root's reveal alone; a deeper layer holds only its own idea. Ben and
Cy are not on the layer in this proof: the peer clause, the ledger per layer and
a word in flight while the host moves are pinned in
`didyouknow.service.spec.ts` with the room faked.

Then the toggle: a participant plays a room without switching anything on;
`start` at the root opened every layer; `off` on a layer that only inherits the
mark changes nothing; `off` at the root closes the layers that hold no mark of
their own and the word is refused, writing nothing; `on` on a branch opens that
layer and what is beneath it but not a sibling; `everywhere` opens the sibling;
the word alone flips.

## What is not true yet

Found by an independent read of the code on 2026-10-24; the words do not warn
of these.

- **A game has one round per layer.** A tile that already holds a reveal
  answers "already revealed" to every later `reveal`, and its desks are
  un-concealed from the start. There is no word to begin a second round on the
  same layer; the old ideas and the old reveal stay unless someone removes the
  notes. (Another layer is unaffected: its game is its own word.)
- **The ledger is kept per layer but never cleared**, so a second game on the
  same layer in one tab session could name ideas seen in the first.
- **Joining first matters and nothing says so.** `shared` is said when the tab
  is not joined; the room hears nothing, and a tile made before joining stays
  private. `collect` says "no Did You Know here to collect from" when the real
  cause is not having joined.
- **"Off here" sends a joiner on the wrong layer to start a private game.**
  A joiner standing on a different layer from the room has no mark and no peer
  tile there; the sentence tells them to say `did-you-know on`.
- **The desk's Take all takes the reveal too** (the word `collect` does not).
- **The reveal can name too little or too much.** An idea that left before the
  host's tab read it is not named; an idea its author later removed is.
  Counts read "1 ideas" and "1 people".

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
