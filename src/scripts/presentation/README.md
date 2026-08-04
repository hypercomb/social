# Hypercomb video presentation — chunked build

The full "What is Hypercomb / why you want it / roadmap" presentation, kept as
**chunks** so any piece can be changed without touching the rest — no monolithic
video file.

## Chunks

| Piece | Where | Edit to change |
|---|---|---|
| Narration (19 scenes) | `scenes/scene-NN.json` (`say`) | the spoken script + captions |
| Scene layout / visuals | `template.html` (SCENES array) | headlines, diagrams, order |
| Live-capture clips | `media/*.mp4` | replace a clip, keep the filename |
| Narration audio | `audio-cache/<h16>.mp3` | never by hand — derived cache |
| Deliverable | `dist/hypercomb-presentation.html` | never by hand — build output |

The audio cache is keyed by `sha256(voice|rate|say)` — change a scene's `say`
and only that scene's audio is regenerated on the next build. Unchanged scenes
are cache hits. (Derived cache, keyed by content — the optimize-phase rule
applied to a build.)

## Commands

```bash
cd scripts/presentation
npm install            # once — pulls msedge-tts (neural narration voice)
node build.cjs         # assemble dist/hypercomb-presentation.html
node build.cjs --check # list scenes whose audio is stale (no network)
node mirror-to-hive.cjs  # (bridge live) push scene tiles + narration notes into the hive
```

## The hive mirror

`presentation` (root tile) → `what is hypercomb` / `why hypercomb` / `roadmap`
→ one tile per scene, each carrying its narration as a note. The hive is the
editable surface: refine a scene's note there, copy it into its chunk (or edit
the chunk directly), rebuild.

## Voice

Narration is `en-US-AndrewMultilingualNeural` via `msedge-tts`. To use a human
recording instead, drop the take at the scene's cache path (print it with
`node -e "..."` or just run `--check` after clearing) — the builder embeds
whatever mp3 sits at the scene's hash. A recorded-voice flow (one take per
scene, named `narr-NN.mp3`, re-seeded into the cache) is a five-minute swap.
