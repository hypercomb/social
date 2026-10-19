# Hypercomb Q and A — a swarm game of questions and answers

*jwize, 2026-10-18: "a questions and answers swarm game where people can ask
questions and they all show up, people can give answers and see who can get
the best answers" · "the questions can be tiles, you click the tile and it
expands into a pane where you submit your answer and see other people's
answers" · "in our pools of meaning sort of way" · "much like the notes game,
a categorization based on the content of the questions — you end up in the
same layer with others as they get created; the layers materialize as a
category expands or retracts, organized in a tree" · "you can take the
answers to the questions just like the notes; then the host can tally the
results" · "the name of the game is important so we can say `start hypercomb
q and a`".*

**Status: built, pass one, proven two-browser 16/16**
(`hypercomb-essentials/src/questions/`, proof `scripts/drive-questions-game.cjs
--url http://localhost:4253/ --relay ws://localhost:7777`). Played through the
swarm and the notes desk as they are; the game adds three words, one mark,
one door and one settle.

## The game in sentences

| Say | What happens |
|---|---|
| `start hypercomb q and a` | The game's tile appears on the page you stand on (or is found there), you walk in, and your hive becomes the **organizer** of that page. |
| `question <your question>` | A tile named with the question appears here, marked as a question. In a swarm it is shared the moment it exists. |
| *click a question* | It **opens** instead of being walked into: the notes desk on that tile, composer ready. Your answer is a note. Everyone's answers show there, coloured by who gave them, with **Take**. |
| *take an answer* | The swarm notes take — the same signature onto your tile. How many participants hold an answer is its score. |
| `tally` | On the page you stand on: each question gets a note ranking its answers by takes, and the page's own tile gets the scoreboard — who gave the most-taken answers. |

`start` is the natural-language door: in the common tongue "please start
hypercomb q and a" lights `start`, and the rest is the game's name. A name
nothing answers to makes the word say which games this build can start,
never guess. The `game` word is a different thing — it makes a cell an
arcade game.

## Pools of meaning, not a new store

- **The game is a tile named `hypercomb q and a`.** Every page beneath it is
  in the game; `sign('hypercomb q and a')` is the molecule, so one game is
  one word on every participant's hive. Nothing else marks the game.
- **A question is a tile.** Its name is the question in the hive's spelling
  (`what-is-a-bag`, as the create commit names every tile); its **title** is
  the question as asked, question mark and all. Its molecule is `sign(name)`,
  so the same question asked in two rooms is one word.
- **An answer is a note** — a signed atom in the question tile's `notes`
  slot. Everyone's answers reach the desk the way swarm notes already do:
  a peer's notes on a tile are the `notes` slot of their layer for it
  ([swarm-notes.md](swarm-notes.md)). No new wire.
- **A category is a layer.** Questions that belong together end up on the
  same page; the category tile's name is the category. Nothing is a parent
  that holds them against their will: the organizer's hive files its own
  copies, and anyone may take a category or a question.
- **The mark** `visual:question` is a decoration on the question's layer in
  the hive that holds it; the door and the settle read it through the
  decoration index. **A take carries no marks** — taking a peer's tile folds
  its admitted projection (name, titles, picture, properties), never its
  decoration records — so inside the game a tile whose title asks (ends in
  a question mark) and wears no mark yet is given the mark by the hive that
  took it, a moment after the page shows it. Outside the game nothing is
  inferred from a title.
- **Who gave an answer** is remembered from the swarm notes as they are
  read (note id → participant), so an answer the host takes still counts for
  the participant who gave it.
- **The host keeps it.** The host's shared tiles are the room's template on
  its host (RoomPool, [swarm-pools.md](swarm-pools.md)); a host that takes
  the questions and answers holds the room's copy, and the tally notes it
  writes stay with the room when everyone has left.

## The settle — layers materialize and retract

The organizer runs one pass a few seconds after the room changes (a peer
tile appears, a tile is added), coalesced, and only while standing on the
page it organizes:

1. **Take** every peer tile on the page not already held — the room's
   questions become the organizer's to file. A placeholder with no bytes
   yet waits for the next pass.
2. **Place** each question: Jev (when switched on and allowed to read the
   hive) files it into one of the page's categories — any non-question
   tile, including ones the host laid out beforehand; else the
   participant's own AI does. Questions no category fits are shown to the
   AI for new names (two to four words, each fitting at least two
   questions), then filed among those.
3. **Plan** (`settlePlan`, pure, spec-covered): a label with at least
   `MIN_TO_MATERIALIZE` (2) questions **materializes** as a new tile and
   they move inside; an existing tile under the label receives even one;
   a category left with fewer than two questions **retracts** — they come
   back up, and the tile goes if nothing else was inside it.
4. **Apply** with `MoveDrone.commitMoveInto`, the primitive drag-into,
   `/into` and organize already use: one marker per group, undoable, name
   collisions skipped.

Without Jev or an AI that may read the hive, nothing moves and the
organizer is told once. Categories inside categories (the tree) settle the
same way when the organizer stands inside one.

## Pieces

| Piece | Role |
|---|---|
| `questions/questions.ts` | pure: the names and marks, `settlePlan`, `parseCategoryNames`, `parsePlacedIndexes`, `rankAnswers`, `scoreboard`, `tallyText`, `boardText` |
| `questions/questions.service.ts` | `Questions` (`@diamondcoreprocessor.com/Questions`): start, ask, open, settle, tally |
| `questions/questions.drone.ts` | the bee: registers the service, claims entry for question tiles, offers the game to `start` |
| `questions/start.queen.ts` · `question.queen.ts` · `tally.queen.ts` | the three words |
| `commands/decoration-kind-index.ts` | `claimEntry(kind)` / `entryClaimFor(label)` — kinds that open instead of entering |
| `presentation/tiles/tile-overlay.drone.ts` | the one entry choke point says `tile:open { label, kind }` for a claimed tile |

## Scoring

An answer's **takes** = the participants holding it other than its author.
A participant's standing = takes gathered across their answers, questions
won (their answer ranked first with at least one take), answers given. The
tally writes `Tally · n answers` on each question and `Scoreboard · n
participants` on the page's tile; a later tally never counts those notes as
answers.

## Not yet

- The organizer settles only the page it stands on; walking into a category
  settles inside it. A pass over the whole tree is owed.
- A peer's question is recognised as one once taken. Before that it is a
  peer tile like any other — clicking it takes it, as in any swarm.
- New category names need an AI that may read the hive (Jev only files into
  categories that exist). The proof stands Jev in on the organizer's page and
  has the host lay the categories out beforehand; the materialize step is
  spec-covered, not yet seen live with a model.
- A pass over the whole tree for `tally`, and a tally that reads what the
  room's host holds after everyone left.
- Retract (a category thinning below two questions) is spec-covered, not
  yet seen live.
