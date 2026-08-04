# Hypercomb video presentation — chunked build

The full "What is Hypercomb / why you want it / roadmap" presentation, kept as
**chunks** so any piece can be changed without touching the rest — no monolithic
video file. 23 scenes, ~18 minutes, narrated.

## Chunks

| Piece | Where | Edit to change |
|---|---|---|
| Narration (23 scenes) | `scenes/scene-NN.json` (`say`) | the spoken script + captions |
| Scene layout / visuals | `template.html` (SCENES array) | headlines, diagrams, order |
| Live-capture clips | `media/*.mp4` | replace a clip, keep the filename |
| Narration audio | `audio-cache/<h16>.mp3` | never by hand — derived cache |
| Deliverable | `dist/hypercomb-presentation.html` | never by hand — build output |

The audio cache is keyed by `sha256(voice|rate|say)` — change a scene's `say`
and only that scene's audio is regenerated on the next build. Unchanged scenes
are cache hits. Visual-only edits cost no audio at all. (Derived cache, keyed by
content — the optimize-phase rule applied to a build.)

## Commands

```bash
cd scripts/presentation
npm install              # once — pulls msedge-tts (neural narration voice)
node sync-chunks.cjs     # after adding/removing/reordering scenes in template.html
node build.cjs           # assemble dist/hypercomb-presentation.html
node build.cjs --check   # list scenes whose audio is stale (no network)
node deploy-azure.cjs    # ship to Azure Static Web Apps
node mirror-to-hive.cjs  # (bridge live) push scene tiles + narration notes into the hive
```

## Deploy

Azure Static Web App `pbs-hypercomb-com` — resource group
`swa-hypercomb-prod-west-001`, West US 2, Free SKU, matching the other sites in
the subscription. Default host: `calm-hill-0e74a6a1e.7.azurestaticapps.net`.

**DNS for hypercomb.com** is at DreamHost, so the domain binding needs these
records added there once:

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

## The hive mirror

`presentation` (root tile) → `what is hypercomb` / `why hypercomb` / `roadmap`
→ one tile per scene, each carrying its narration as a note. The hive is the
editable surface: refine a scene's note there, copy it into its chunk (or edit
the chunk directly), rebuild.

## Voice

Narration is `en-US-AndrewMultilingualNeural` via `msedge-tts` (pin **2.0.7** —
1.x fails to connect). To use a human recording instead, drop the take at the
scene's cache path — the builder embeds whatever mp3 sits at the scene's hash.
A recorded-voice flow (one take per scene, re-seeded into the cache) is a
five-minute swap.

Watch what the voice does with the text: all-caps words get spelled out letter
by letter, so keep emphasis in the visual layer and write the `say` in normal
case.
