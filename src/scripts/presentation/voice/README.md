# Speaking in your own voice

`record.cjs` is you at a microphone, one scene at a time. This is the other
half: read **one** passage, and the reel can speak the rest in your voice —
including lines you have never said. Everything here runs on your own machine
and costs nothing.

The clone is not allowed to skip anything a real take goes through. Each line is
sampled several times, and every take is judged twice, because takes fail in two
unrelated ways: the voice **drifts** off yours, or the diction is **wrong** — it
says "hypercone". A speaker encoder catches the first and is completely blind to
the second, so each take is also transcribed and scored against the words it was
given. Right comes first and it is a **ranking, not a threshold**: a take that
says every word beats one that says all but one, however much closer the
near-miss sounds, and likeness only breaks ties between takes that are equally
correct. If no take said the line at all, the best is kept and **flagged** —
re-roll it with more takes rather than let it through.

The winner then goes through the **same** mastering chain (`master.cjs`) as a
recorded take, and lands in the exact cache slot a recorded take would occupy,
so `teaser.cjs` and `build.cjs` need no flag and no branch — the audio is simply
already there.

## One-time setup

Python 3.12 and ffmpeg on PATH, then:

```bash
python -m venv "%USERPROFILE%\.hcvoice\venv"
"%USERPROFILE%\.hcvoice\venv\Scripts\python" -m pip install chatterbox-tts "setuptools<81"
```

- **Chatterbox** (Resemble AI, MIT) is the zero-shot cloner and **Whisper**
  (`whisper-base.en`, via transformers) is the ear that checks it. First run
  downloads ~1.2 GB of weights from Hugging Face and caches them.
- `setuptools<81` is only there because the watermarker still imports
  `pkg_resources`, which setuptools 81 dropped.
- Keep the venv on a **short path**. Torch's header tree busts Windows'
  260-character path limit from anywhere deep. `HYPERCOMB_VOICE_HOME` overrides
  the default `~/.hcvoice`.
- `clone.py` forces UTF-8 on its own stdout. Windows consoles still default to
  cp1252, and a single arrow in a progress line raises `UnicodeEncodeError`
  mid-run — throwing away every take generated up to that point. A status
  message must never be able to lose work.
- `shim/numba/` is a stand-in for numba, whose unsigned native extension is
  blocked outright by some Windows Application Control policies — which takes
  librosa, and therefore Chatterbox, down with it. Nothing on the speech path
  needs numba to be fast; it needs librosa to import. The one thing that cannot
  be faked, `guvectorize`, raises rather than returning something quietly wrong.
  If your machine imports the real numba, the shim never loads.

No GPU is needed — on a CPU this speaks about one second of audio per nine.

## Use

```bash
node voice.cjs --reference "…\Recording.m4a" --from 24.6 --to 43.6
node voice.cjs --teaser
node voice.cjs --scenes 1,4,7
node voice.cjs --teaser --only open --takes 8    # re-roll one weak line
node voice.cjs --check
```

Give the reference **7–40 seconds** of your cleanest continuous speech — one
unbroken run, no false starts. `--from`/`--to` cut it out of a longer recording.
It is prepared with a light clean rather than the mastering chain: conditioning
wants your voice with its dynamics intact.

`spoken.json` is the ledger of which slots are spoken rather than read. It is
the one place that distinction is recorded, so keep it honest.

## When every take is "wrong"

`pronunciations.json` carries two kinds of rule. `say` is for the mouth — how a
word should be read, used by `build.cjs`. `hear` is for the ear — spellings
transcription is allowed to come back with.

A coined noun has no correct spelling as far as an ASR model is concerned.
"Hypercomb" comes back as *Hypercom*, and it does so from the neural narration
already on the published presentation, not just from the clone. Without a `hear`
rule every take of every line carrying the name scores as wrong — and worse, the
one take that dropped the word **entirely** then wins, because it is the only one
whose error the encoder cannot see. If a whole line flags with nothing obviously
wrong in what it heard, that is the shape of the problem: add the spellings, do
not lower the threshold. They are spellings accepted back, not pronunciations
endorsed — Whisper is weak on short clips, so `hear` should stay a short,
deliberate list rather than a catch-all.

## What is not committed

`reference/` and `spoken/` are ignored. A reference recording is enough to
clone the voice it holds, so publishing one hands that to anyone with this
repository — that is your call to make deliberately, not a side effect of a
commit. The mastered result is committed, because that is the presentation.
