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

**Status: built, pass two.** Proven two-browser 21/21
(`scripts/drive-questions-game.cjs --url http://localhost:4253/ --relay
ws://localhost:7777`: the words, the door, answers, takes, the tally, a
category materializing from the namer, a thinned category retracting, the
tree tally from the ledger) and the host's copy 15/15
(`scripts/drive-questions-host-copy.cjs --url http://localhost:4253/`: a
third browser arriving after host and guest left reads the game, its
category, its question, the answer and the tally from the room's host).
Module `hypercomb-essentials/src/questions/`. Played through the swarm and
the notes desk as they are; the game adds three words, one mark, one door,
one settle and one ledger.

## The game in sentences

| Say | What happens |
|---|---|
| `start hypercomb q and a` | The game's tile appears on the page you stand on (or is found there), you walk in, and your hive becomes the **organizer** of that page. |
| `question <your question>` | A tile named with the question appears here, marked as a question. In a swarm it is shared the moment it exists. |
| *click a question* | It **opens** instead of being walked into: the notes desk on that tile, composer ready. Your answer is a note. Everyone's answers show there, coloured by who gave them, with **Take**. Someone else's question is a peer tile, so the click is the swarm's wand — it takes the tile — and because it is a question in the game, it opens the moment the take lands. One click either way. |
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

The organizer runs one pass over the game's **whole tree** a few seconds
after the room changes (a peer tile appears, a tile is added), coalesced:

1. **Take** every peer tile on the page the organizer stands on, when that
   page is in the game — the room's questions become the organizer's to
   file. Peers' tiles are only ever read for the page in front of you, so
   this is the one step bound to where the organizer stands. A placeholder
   with no bytes yet waits for the next pass.
2. **Walk** the tree from the game's tile: its page, then every category (a
   non-question tile with tiles inside) beneath it, three levels deep.
3. **Place** each page's questions: Jev (when switched on and allowed to
   read the hive) files each into one of the page's categories — any
   non-question tile, including ones the host laid out beforehand; else the
   participant's own AI does. Questions no category fits go to **the
   namer** (`Questions.suggestNames`, the participant's AI; two-to-four-word
   names, each fitting at least two questions), then are filed among those.
   The namer is a method on the service on purpose: a harness, or a
   participant's own module, can stand another namer in.
4. **Plan** (`settlePlan`, pure, spec-covered): a label with at least
   `MIN_TO_MATERIALIZE` (2) questions **materializes** as a new tile and
   they move inside; an existing tile under the label receives even one;
   a category **the settle itself minted** that is left with fewer than two
   questions **retracts** — they come back up, and the tile goes if nothing
   else was inside it. A tile the host laid out is their structure: it
   keeps even one question and never retracts. (Minted categories are
   remembered for the game being played; after a reload nothing retracts
   that this hive did not materialize since.)
5. **Apply** with `MoveDrone.commitMoveInto`, the primitive drag-into,
   `/into` and organize already use: one marker per group, undoable, name
   collisions skipped.

Without Jev or an AI that may read the hive, nothing moves and the
organizer is told once. `Questions.lastSettle` holds the last pass, page by
page — what each page held, what the plan said, how many moved — for
anyone checking the game's state.

## The ledger — what this hive has seen

The swarm is read for the page you stand on: peers' answers to a question
reach this hive only while it stands where that question is. So the
organizer's hive keeps a **ledger** of the answers it has seen — per
question, each answer's words, who gave it, and everyone ever seen holding
it. It is fed by every swarm-notes read while standing on a page, and by
the reads the service asks for a moment after the page renders or the room
changes (the same moment taken questions get their mark back). Holders
accumulate: a take is not undone by leaving. In memory only, for the game
being played — never a pool, never persisted.

`tally` standing anywhere in the game walks the whole tree: each question
gets its `Tally ·` note from what this hive holds plus what the ledger saw,
and the game's tile gets one `Scoreboard ·`. The page in front of you is
read live first. Standing outside the game, `tally` counts the page you
stand on and writes the scoreboard on its tile.

## The host's copy

"There has to be a host that allows the answers to show for everybody." A
swarm is live — tiles go when their holders leave — and the room's host is
what stays: the host's shares are the room's **template** on its host
(RoomPool, [swarm-pools.md](swarm-pools.md) step three), one signed member
per page the host stood on, pulled by whoever arrives and never expiring.
So when the HOST plays the organizer — takes the room's questions, takes
the answers, tallies — a participant who arrives after everyone left still
gets the game tile at the root, the categories inside it, the questions
inside those, and each question's answers and tally. Nothing new was
built for this; the proof `scripts/drive-questions-host-copy.cjs` runs a
scratch relay that names the host browser as its `_` key and a third
browser that joins after host and guest have gone. An organizer who is not
the host key leaves no copy behind — their shares expire with them, as any
participant's do; a game meant to outlast its players is the host's to run.

## Pieces

| Piece | Role |
|---|---|
| `questions/questions.ts` | pure: the names and marks, `settlePlan`, `parseCategoryNames`, `parsePlacedIndexes`, `rankAnswers`, `scoreboard`, `tallyText`, `boardText` |
| `questions/questions.service.ts` | `Questions` (`@diamondcoreprocessor.com/Questions`): start, ask, open, settle (the tree), tally (the tree + the ledger), `seen`, `suggestNames` (the namer seam) |
| `scripts/drive-questions-game.cjs` · `drive-questions-host-copy.cjs` | the two-browser proof, and the host's-copy proof with a scratch relay |
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

- New category names from a real model: the proof stands the namer and Jev
  in (no model may read the hive on the dev machine); the materialize and
  retract steps are proven live with them.
- The ledger counts what this hive has seen. An answer given on a page the
  organizer never stood on while it was there is not counted — the tally
  says what the host saw, never more.
