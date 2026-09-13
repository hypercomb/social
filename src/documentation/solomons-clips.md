# Solomon's Clips

**Status:** story + plan, nothing built (2026-09-12). Shelved until picked up.

Track the critical moments of a run while it is played, and when the run
ends, cut them into a montage. This document is the story of how that
works in Hypercomb, why it is feasible, and the order to build it in.

## The story

Dana drops into Sunseed Porch. Three rooms later he dispels the block under
a goblin at the last sliver of life meter, the goblin falls, the meter
refills from an hourglass he was standing on. Nobody saw it. The game did.

When the run ends, win or death, the screen does not go to a score table.
It goes dark, a title card names the run, and the run plays itself back:
the near-death drop in slow motion with the camera tight on Dana, the tenth
bell and the fairy that made an extra life, the key grab, the door, and
finally the moment the run ended. Forty seconds. Then the score table.

Below the montage is a row of tiles. Each tile is one clip. The participant
can drag them to reorder, hide the ones that bore them, drop one on a note,
share the montage as a signature, or export a WebM to post elsewhere. A
visitor who follows the signature watches the same montage, re-simulated on
their own machine, in whatever resolution their screen has.

## The big idea: a clip is a replay, not a video

`games/solomon/engine.ts` is a pure engine. Framework-free, fixed timestep
(`SIM_DT = 1/60`), and it contains zero calls to `Math.random`. Given the
same level and the same inputs on the same ticks, it produces the same
state, frame for frame.

That makes a clip almost free:

| Approach | Size of a 40s clip | Can re-render | Can slow-mo / re-frame | Cross-host share |
|---|---|---|---|---|
| Replay atom (level sig + per-tick inputs) | a few KB | yes | yes, at any resolution | yes, as one signature |
| Live canvas capture (`captureStream` + `MediaRecorder`) | 5–20 MB | no | no | as a blob only |
| Frame-exact offline encode (`WebCodecs`) | 5–20 MB | n/a (it is the output) | inherits from replay | as a blob only |

The replay atom is the primary artifact. Video is a **derived cache** of a
replay: recomputable, wipe-safe, never load-bearing, exactly what the
optimize phase exists for. A montage keeps working with the video absent.

This is also why it is more than feasible, it is better than screen
recording. Because the montage is re-rendered from state, the cut can do
things a screen capture cannot:

- **Slow motion** by rendering more frames per sim tick (the engine is
  stepped in `SIM_DT`, the renderer can interpolate or repeat).
- **A camera** that zooms to Dana at the drop, then pulls back for the door.
- **Ghosts**: the earlier failed attempt at the same room drawn translucent
  under the winning one.
- **Any resolution**: phone montage at 720p, desktop at 4K, from the same
  few kilobytes.
- **No dropped frames**, no jank from the live session, no chrome in shot.

## What a moment is

The engine already knows the moments. It has `KillCause`
(`crush | drop | fire | expire | blade | spell`), `BattleEnd`, the life
meter with `LIFE_HALF`, `fairyCount`, `sealCount`, `doorOpen`, `GameState`.
Today these are state. The first change is to make them a **moment stream**:
the engine appends `{ tick, kind, weight, focus }` to a list the overlay
drains every frame and forwards as an effect (`game:moment`).

Proposed weights (tunable, data not code once they live on a tile):

| Moment | Weight | Pre-roll | Post-roll |
|---|---|---|---|
| Run ended (win, death, game over) | 100 | 4s | 2s |
| Kill by drop or crush at life < `LIFE_HALF` | 90 | 3s | 1.5s |
| Battle won | 70 | 2s | 1.5s |
| Tenth fairy (extra Dana) | 65 | 2s | 2s |
| Door reached | 60 | 3s | 1s |
| Any kill | 50 | 2s | 1s |
| Key taken | 40 | 2s | 1s |
| Seal, zodiac panel, wings | 40 | 1.5s | 1.5s |
| Hourglass with life < 10% | 45 | 2s | 1s |
| Death (mid-run, lives remain) | 55 | 3s | 1.5s |

Moments within 2s of each other merge into one clip with the max weight
and a `+` of their kinds ("drop kill, then hourglass"). Every moment carries
a `focus` cell so the montage camera knows where to look.

## Artifacts, per the signature doctrine

Everything is a tile. Clips are artifacts broken off the run, not fields on
it (see `website-artifact-paradigm.md`).

- **Run** — a tile the game view creates when a run starts. It holds the
  **replay atom** as a resource: `{ levelSig | levelIndex, startSnapshotSig,
  ticks, inputs }` where `inputs` is run-length encoded per-tick input
  state (`left, right, up, down, jump, cast, fire` as a bitfield). Recording
  per-tick state, not DOM events, is what makes it deterministic.
- **Clip** — a child tile of the run: `{ replaySig, fromTick, toTick,
  kinds, weight, focus }`. Its picture is a hex capture of the peak frame
  (`editor/hex-capture.ts`, the one capture). Hidden clips are just hidden
  tiles (hide first, delete second).
- **Montage** — a tile whose children are clips. Order lives in the META
  atom, as everywhere else. The cut style (`crescendo`, `chronological`,
  `highlights`) is a pheromone on the montage tile, so a new style needs no
  code path.
- **Rendered video** — a record in a derived-cache pool keyed by the
  montage signature. Minted only in the optimize phase. Complete or absent.

Replays are tiny, so sharing is the signature. Visitors who follow it
resolve the replay against their own OPFS or pull it from a host through
the existing pool replication. They never receive a video.

## Assembling the montage

Inputs: the run's clips, a time budget (default 40s, a pheromone), a style.

1. Sort clips by weight, take greedily until the budget is spent, always
   keeping the run-ended clip.
2. Diversity rule: never two clips of the same single kind back to back.
3. Reorder by style. `crescendo` is the default: chronological, but the
   ending is always the run-ended clip, and the highest-weight remaining
   clip sits second to last.
4. Per clip, apply grammar: 0.5s title card naming the room on a room
   change, slow motion at 0.25x for the 0.5s around the peak tick of any
   kill or death, camera eased to `focus`, a 6-frame cross dissolve.
5. Audio comes from re-triggering `games/audio.ts` during re-render into
   an `AudioContext`, mixed to a `MediaStreamAudioDestinationNode` when
   exporting.

The assembly is a pure function `montage(clips, budget, style) → cut list`,
so it gets a spec beside `chamber-playthrough.spec.ts`.

## Playback and export

**In-game playback** (the end screen) needs no video at all: seek the
engine to the clip's start snapshot, step `SIM_DT` ticks feeding the
recorded inputs, draw with the normal renderer plus the montage camera.
Seeking is cheap because the replay atom stores a start snapshot per clip
(`EngineSnapshot` already exists).

**Export to WebM**, no third-party code, all self-hosted:

- Re-render at real time onto an `OffscreenCanvas`, `captureStream(60)`,
  feed `MediaRecorder` with `video/webm;codecs=vp9` plus the audio track.
  Simplest path, gives a muxed file directly, export takes as long as the
  montage is long.
- Later, faster than real time: `WebCodecs` `VideoEncoder` per frame. That
  needs a container muxer; a minimal WebM writer is a few hundred lines and
  would live in essentials as a resource. Only worth it if 40s exports feel
  slow.

**Live capture** (`captureStream` on the Pixi canvas with a rolling ring
buffer of encoded chunks) is the fallback for games that cannot be made
deterministic. Solomon does not need it. Keep it out of phase one.

## Risks, and what each one costs

- **Determinism leaks.** Any future `Math.random` in the engine breaks
  replay. Rule: the engine takes a seeded PRNG from the replay atom; a
  doctrine ratchet greps the games engines for `Math.random`. Floating
  point is stable within one JS engine and effectively stable across
  modern engines for this arithmetic, but the spec must assert
  replay-equals-live on the recorded snapshots, not assume it.
- **Input timing.** Inputs must be sampled per sim tick by the overlay's
  fixed-timestep loop, never by DOM event timestamps. The overlay already
  runs a fixed-timestep update, so this is a small change in one place.
- **Hidden tab.** `requestAnimationFrame` never fires in a hidden tab, so
  export must drive its loop with `setTimeout` or a `MessageChannel`, and
  `MediaRecorder` still needs real-time pacing. Warn if the tab hides
  during export.
- **Save games.** `adventure-save.ts` snapshots must stay compatible with
  `startSnapshotSig`; a replay from a loaded save records from that
  snapshot, which is fine, because the snapshot is the start.
- **Storage.** Replays are kilobytes. Videos are derived and GC-able. No
  new pressure on OPFS.
- **Other games.** Bubble and Arkanoid need an audit for `Math.random` and
  fixed-timestep before they get clips. Same pattern, seeded PRNG in the
  atom.

## Build order

0. **Determinism harness.** Record inputs during `chamber-playthrough.spec`
   and `labyrinth-playthrough.spec`, replay them, assert snapshot equality
   at every tick. This costs a day and de-risks everything else. If it
   fails, the rest of the plan changes; if it passes, the rest is assembly.
1. **Moment stream** in the engine and the `game:moment` effect from the
   overlay. Weights on a tile, not in code.
2. **Replay atom + run tile + clip tiles.** The game view writes them as
   the run ends. Clip pictures via hex capture.
3. **End screen montage.** In-game re-render, crescendo style, camera and
   slow motion. This is the first thing a participant sees and needs no
   video pipeline.
4. **Montage tile and the hive as the editor.** Reorder by dragging, hide
   clips, style pheromone, time budget pheromone.
5. **WebM export** via `MediaRecorder`, video as a derived record in the
   optimize phase.
6. **Share and visit.** Signature share, visitor playback by re-simulation,
   pool replication across hosts.
7. **Bubble and Arkanoid** after their determinism audit.

## Open questions

- Should the montage play automatically at the end of every run, or only
  when at least one clip beats a weight threshold? Default: play when the
  cut has three or more clips, otherwise show a single "best moment" card.
- Does a replay atom belong under the game tile or under the participant's
  own tree? Proposal: under the game tile, since the run is a thing the
  game made, and the participant can move it.
- Ghost rendering of earlier attempts is cheap once replays exist. In
  scope for the montage, or a separate behaviour? Proposal: separate,
  it is a play feature more than a clip feature.

## Doctrine: replay, not recording (2026-09-12)

Everything that runs in the hive should follow these patterns eventually.
That is not a deadline, it is the direction. The rule, stated once:

**If a thing can be re-derived from a small artifact plus deterministic
code, store the artifact and derive the rest.** Video from replays. Pictures
from hex captures. Manifests from layers. Never the other way round.

Adoption is by discovery. When a session notices a feature that stores a
result where it could store a replay, it adds a line below and stops. The
participant answers yes or no. No line is worked without a yes.

### Candidates

| Candidate | What the small artifact would be | Answer |
|---|---|---|
| Solomon clips and montage (this doc) | replay atom: level sig + per-tick inputs | |
| Bubble replays | seed + per-tick inputs, needs a seeded PRNG first | |
| Arkanoid replays | seed + per-tick inputs, needs a seeded PRNG first | |
| Roper replays | seed + per-tick inputs, needs a determinism audit | |
| Tutor session replays (which cards, which answers, when) | ordered answer ledger keyed by deck sig | |
| Agent run montage (a `run ledger` cut into the moments that mattered) | the ledger already exists; moments and weights are new | |
| Bee chatter replays (what the bees said during a session, as a scrubbable strip) | chatter ledger keyed by session sig | |
