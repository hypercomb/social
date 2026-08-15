# Hypercomb video presentation — instructions, compiled

The full "What is Hypercomb / why you want it / roadmap" presentation. 23
scenes, ~18 minutes, narrated. It is **not** a video file: every scene is an
instruction, compiled into one self-playing page, so any piece can change
without touching the rest.

## How it is put together

| Piece | Where | Edit to change |
|---|---|---|
| Scene instructions | `scenes/scene-NN.json` | the whole scene — words, visual, narration |
| The recipe | `production.md`, mirrored onto the `presentation` tile | what a scene may contain |
| Shell (styles, chrome, player) | `template.html` | the look and the controls, never a scene |
| Live-capture clips | `media/*.mp4` | replace a clip, keep the filename |
| Pronunciation rules | `pronunciations.json` | how a word is said (`say`) and heard (`hear`) |
| Narration audio | `audio-cache/<h16>.mp3` | never by hand — `record.cjs` or `voice.cjs` |
| Deliverable | `dist/hypercomb-presentation.html` | never by hand — build output |

A scene instruction has these fields:

```
eyebrow    the small uppercase line above the headline
headline   the big line — wrap emphasised words in *asterisks*
sub        the calm sentence under it (optional)
visual     none | film:<clip> | hexes | stack | road | sig
visualData the rows that visual needs (optional)
link       an outbound call to action (optional)
say        what the voice says — this is also the caption
```

The audio cache is keyed by `sha256(voice|rate|spoken(say))`, so changing one
scene's words regenerates that scene alone; visual-only edits cost no audio at
all. (Derived cache, keyed by content — the optimize-phase rule applied to a
build.)

## Commands

```bash
cd scripts/presentation
npm install                # once — pulls msedge-tts 2.0.7 (neural narration voice)
node build.cjs             # compile instructions → dist/hypercomb-presentation.html
node build.cjs --check     # list scenes whose audio is stale (no network)
node instructions.cjs      # re-derive scene instructions + production.md
node instructions.cjs --push   # (bridge live) write instructions onto the hive tiles
node deploy-azure.cjs      # ship to Azure Static Web Apps
node verbs.cjs             # the three structural verbs in one short cut
```

`verbs.cjs` is the one cut whose product beats are **drawn** rather than
captured: what a verb does is a movement — children fanning out, a crowded
level folding into groups, a row spreading to make room — and a still of the
after-state shows none of it. Frames are shot in filmstrips, many panes to one
headless launch, then cut apart with ffmpeg `untile`; the launch, not the
drawing, is the cost. Narration comes from the same `audio-cache` the full
build fills, keyed by the same words.

```bash
node concepts.cjs          # media/concept-{vocabulary,integrity,time}.mp4
node concepts.cjs time --probe   # stills at each beat, to eyeball a world
```

`concepts.cjs` draws the in-deck concept clips the same way — scenes 8, 13 and
14 talk about things a capture cannot show (what the words mean, what
verification is, what time feels like), so each gets one continuous drawn
world with a camera travelling through it. The clips are **silent**: the deck
plays the scene's narration and the pane plays the clip muted from t=0, so the
beats are timed to the narration's own sentence boundaries — measured from the
cached mp3 with silencedetect, matched by word-count expectation. Editing a
scene's `say` re-times the clip on the next run; `film:vocabulary` /
`film:integrity` / `film:time` in the scene instruction is what mounts them.

## Narrating it yourself

Two ways, one destination. `record.cjs` takes scenes you read into a microphone;
`voice.cjs` clones a single take and speaks the lines you did not read. Both go
through the same mastering chain (`master.cjs`) and both seed the *same* cache
slot the neural narrator would have filled — so `build.cjs` and `teaser.cjs`
simply find the audio already there. Setup and caveats: `voice/README.md`.

```bash
node record.cjs --script   # a teleprompter, then drop takes in record/
node record.cjs            # master them and seed the cache
node voice.cjs --reference "…\Recording.m4a" --from 24.6 --to 43.6
node voice.cjs --teaser    # speak the teaser beats in that voice
```

## The hive is the authoring surface

```
presentation                      ← the production; holds the recipe as a note
├── what-is-hypercomb             ← chapter
│   ├── welcome                   ← one tile per scene, instruction as a note
│   └── …
├── why-hypercomb
└── roadmap
```

The recipe is declared **once on the parent** and covers every child; a scene
tile carries only its own filling. Work one tile at a time, then recompile.

Two things that will bite when reading back over the bridge:

- Tile names are **slugified** for addressing — `what is hypercomb` is
  `what-is-hypercomb`. Paths built from display names fail to resolve.
- `note-list` returns the notes of the tile at `segments` and **ignores the
  `cell` field**. Read a tile's notes with `segments` = its full path. Writes
  (`note-add`) resolve `cell` within `segments` normally, so a read that looks
  wrong does not mean the write went astray.

## Annotations — highlight, then say what's wrong

Watch it and **highlight any text** — narration in the caption or anything on
screen. A `⌁ annotate` chip appears; choose a kind, write the fix, save. The
reel pauses while you type. The bar's `⌁ N` button opens the list, where you can
remove entries, **copy json**, or **download** them.

Kinds: `pronunciation` · `wording` · `accuracy` · `pacing` · `visual` · `note`.
Each records the scene, its name, the exact quote, whether it came from the
narration or the screen, and how far into the narration you were.

Annotations live in the viewer's own browser (`localStorage`) until exported —
nothing is sent anywhere, so the page stays a static file with no backend.

Feed an export back into the next revision:

```bash
node ingest-annotations.cjs ~/Downloads/presentation-annotations.json
```

- **pronunciation** annotations become rules in `pronunciations.json`. The build
  applies them to what the *voice* reads while the caption keeps the real text —
  and since the cache is keyed by the **spoken** form, only the scenes that
  actually say the phrase regenerate. (Seeded with "A G P L" → "ay gee pee ell";
  adding it regenerated scene 15 alone.)
- **everything else** lands in `notes/annotations.md`, grouped by scene. Add
  `--to-hive` to also file each as a note on that scene's tile.

## Deploy

Azure Static Web App `pbs-hypercomb-com` — resource group
`swa-hypercomb-prod-west-001`, West US 2, Free SKU, matching the other sites in
the subscription. Default host: `calm-hill-0e74a6a1e.7.azurestaticapps.net`.

**DNS for hypercomb.com** is at DreamHost, so the binding needs these records
added there once:

| Type | Host | Value |
|---|---|---|
| TXT | `hypercomb.com` (apex) | `_cebnglku2tdwzjk561x16ak3tcu78ji` |
| ALIAS / ANAME (or A) | `hypercomb.com` | `calm-hill-0e74a6a1e.7.azurestaticapps.net` |
| CNAME | `www.hypercomb.com` | `calm-hill-0e74a6a1e.7.azurestaticapps.net` |

Then finish the binding:

```bash
az staticwebapp hostname set -n pbs-hypercomb-com -g swa-hypercomb-prod-west-001 --hostname hypercomb.com --validation-method dns-txt-token
```

```bash
az staticwebapp hostname set -n pbs-hypercomb-com -g swa-hypercomb-prod-west-001 --hostname www.hypercomb.com
```

The page links out to **hypercomb.io** from the splash ("skip the tour") and the
closing scene ("start your hive") — hypercomb.com is the pitch, hypercomb.io is
the app.

## Voice

Narration is `en-US-AndrewMultilingualNeural` via `msedge-tts` (pin **2.0.7** —
1.x fails to connect). Watch what the voice does with the text: all-caps words
get spelled out letter by letter, so keep emphasis in the headline and write
`say` in normal case.

To use a human voice instead, drop a take at the scene's cache path — the
builder embeds whatever mp3 sits at the scene's hash.

A local voice clone is prepared but not wired: `voice/.venv` has Python 3.11 and
PyTorch 2.11+cu128, verified against the RTX 5060 (`sm_120`, CUDA live). The
intended model is **Chatterbox** (Resemble AI) — MIT weights, so commercially
usable, unlike XTTS-v2 or F5-TTS. It needs 10–30 seconds of reference audio.
