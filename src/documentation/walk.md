# Walk and `start tutorial` — a page that walks itself

jwize, 2026-10-24: *"let's create an active tutorial for the follow session
then we just leave it on."*

`walk` makes the page you stand on walk itself: your hive goes into each page
beneath it, one stop at a time, and starts again when it reaches the end.
Anyone who follows you is carried along by the follow mechanism that is
already in every hive. So a hive left walking a branch is a tour that anyone
in the room can take. Nothing new travels on the wire.

## The word

| Say | What happens |
|---|---|
| `walk` | Walks this page and every page beneath it, one stop every 45 seconds, round and round. |
| `walk every <seconds>` | The same, with a stop every `<seconds>` seconds. A value below 10 or above 600 is moved inside that range. |
| `walk stop` | Stops walking. You stay where you are. |

- **A stop is a page.** The walk stops at the page you stood on when you
  said the word, then at each tile beneath it that holds tiles of its own.
  It goes depth first, in the order the tiles stand. A tile with nothing
  inside is never stopped in, because its page would be empty; it is read
  on the page around it.
- **The route is read again every round,** so a page you add while walking
  is visited on the next round. A page that will not read is still a stop.
  What is beneath it waits for the next round.
- **It writes nothing.** Each step replaces your place in the browser's
  history instead of adding one, so a walk left on for hours leaves Back as
  it found it.
- **It does not steer anyone.** You move. Each follower's hive moves itself
  because it follows you (`sharing/follow.drone.ts`, on
  `swarm:leader-moved`).

## Following, for a guest

To follow, open the people list (the caret at the end of the presence strip)
and tap **→** beside the person. To let go, tap it again. A Q and A's
**Join** follows its host the same way. Guests need nothing new to follow a
walk: only the hive that walks needs the `walk` word.

## `start tutorial`: the explanation plays itself, then the room plays

jwize, 2026-10-24: *"start q and a and then the member can join and then we
all go together … we need the full explanation auto play and then continue
from the completion, playing."*

`start tutorial` uses the `start <game name>` grammar that Hypercomb Q and A
and Did You Know already use.

- **Said where nobody leads one, it leads.** A Hypercomb Q and A begins where
  you stand, so the room joins with the **Join** button on the game's door
  (the follow the game already has).
- **It lays out the explanation.** The explanation goes on a `tutorial` tile
  on this page. Only what is missing is made; a tile already there is kept.
- **The walk plays it once.** `play` takes it page by page, 45 seconds a
  page. The first page waits 90 seconds, so the room can tap Join.
- **When the last page is done, the room plays.** You are walked back and
  into this page's questions, and everyone who follows you comes along. They
  ask, answer, take the answers they like, and `tally` scores them.
- **Said where someone else leads, it joins.** You follow them, so their
  tutorial carries you. A guest needs no new package to join: tapping Join
  on the door does the same.
- **`walk stop` ends the explanation early** and opens nothing.

The explanation is data (`questions/tutorial.ts`), not code. Each page is a
tile holding tiles, and each tile carries a **title**, the sentence the room
reads on the hexagon:

1. **Following**: you go where the host goes; a new page every 45 seconds;
   ask on any page; Leave stops following.
2. **The basics**: a tile holds one thing; tiles hold tiles; notes ride on a
   tile; take what you like.
3. **The idea**: people first, not a platform; an open protocol owned by no
   one; each thing has a fingerprint; your peers check it and everyone
   serves it; host your own domain and content.
4. **Playing**: ask, answer, take, and the most-taken answers win. Next, the
   questions open for everyone.

The page that says all this to people is questions.hypercomb.com.

## Pieces

- `hypercomb-essentials/src/navigation/walk.ts`: pure. The route
  (`walkRoute`) and the word (`parseWalk`).
- `hypercomb-essentials/src/navigation/walk.queen.ts`: the word. A timer
  and `Navigation.replaceRaw`. `walking()` says where the walk began and
  how long a stop lasts.
- `hypercomb-essentials/src/questions/tutorial.ts`: pure. What the
  explanation says, its stops and its tiles.
- `hypercomb-essentials/src/questions/tutorial.drone.ts`: `start tutorial`.
  It leads or joins the Q and A, lays the explanation out, plays it, then
  opens the questions.
- `scripts/drive-tutorial.cjs`: the proof, end to end. A host on a shell
  with the word says `start tutorial`. A guest on the live shell taps Join
  and is carried through all five pages, reading the host's titled tiles at
  each. Then both are walked into the questions, the guest asks, and the
  host's hive hears it. 14/14 on 2026-10-24, with the guest on
  hypercomb.io and the room on wss://hypercomb.com.

## Not yet

- Only the host needs the words. Until a revision carrying them is
  published, the host runs a local shell. Guests can be on any shell.
- The explanation is in English only. Titles are written under `en`, and
  other locales fall back to them.
- Nothing marks a hive as walking, so the room learns a tour is on only from
  the game's door.
