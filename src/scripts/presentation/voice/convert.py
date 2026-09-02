"""Your performance, another voice.

  python convert.py <target-voice.wav> <jobs.json> <outdir>

Conversion is not synthesis. The words, the timing, the emphasis and the
breaths are the ones in your take — only the voice is exchanged. That is the
whole reason to reach for it: a model guessing intonation from text will never
put the stress where you would, and here it does not have to guess.

So there is nothing to re-roll. A clone samples, and sampling means takes
differ, which is why clone.py generates several and ranks them. A conversion
carries the performance it was given; if it came out wrong it came out wrong at
the microphone, and the fix is another read, not another seed.

What IS checked is that the words survived. Conversion garbles before it
drifts — a mumbled or clipped source can come back missing a word — so every
result is transcribed and scored against the script with the same `hear` rules
the clone uses. Treat a flag as "go and listen", not as a verdict: the ear is
also hearing a voice it has never heard, and it mishears cleanly-converted
speech more often than it mishears the narrator. Length is reported beside it,
and that one IS a verdict — conversion preserves timing, so a result far off
its source is a bad convert however clean it sounds.

Writes <outdir>/<id>.wav plus a scores.json ledger.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "shim"))

# A progress line must never be able to lose work. Windows consoles still
# default to cp1252, where one arrow in a status message raises mid-run.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import librosa
import torch
import soundfile as sf
from chatterbox.vc import ChatterboxVC
from transformers import pipeline

from hearing import words, wer

target, jobs_path, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
jobs = json.load(open(jobs_path, encoding="utf-8"))
os.makedirs(outdir, exist_ok=True)

ASR_SR = 16000
WER_OK = 0.08          # about one word in twelve may go missing before it is wrong

device = "cuda" if torch.cuda.is_available() else "cpu"
model = ChatterboxVC.from_pretrained(device=device)
# Only the first ten seconds of the target condition the decoder, so a long
# reference is not a better one — a clean ten is.
model.set_target_voice(target)
listen = pipeline("automatic-speech-recognition", model="openai/whisper-base.en", device=device)
print(f"device={device} sr={model.sr} target={os.path.basename(target)}", flush=True)

ledger = {}
for item in jobs:
    t0 = time.time()
    wav = model.generate(item["source"])
    sf.write(f"{outdir}/{item['id']}.wav", wav.squeeze(0).cpu().numpy(), model.sr)

    got = wav.squeeze(0).cpu().numpy()
    heard = listen(librosa.resample(got, orig_sr=model.sr, target_sr=ASR_SR))["text"].strip()
    rate = wer(words(item["text"]), words(heard))
    was = librosa.get_duration(path=item["source"])
    now = len(got) / model.sr
    ledger[item["id"]] = {
        "wer": round(rate, 4),
        "seconds": round(now, 2),
        "source_seconds": round(was, 2),
        "text": item["text"],
        **({} if rate <= WER_OK else {"flagged": "the words did not come back clean — listen, then read it again",
                                      "heard": heard}),
    }
    print(f"  {item['id']:<20} {now:5.1f}s (read {was:.1f}s)  WER {rate * 100:.1f}%"
          f"  ({time.time() - t0:.0f}s)"
          f"{'' if rate <= WER_OK else '  ⚠ heard: ' + heard}", flush=True)

json.dump(ledger, open(f"{outdir}/scores.json", "w", encoding="utf-8"), indent=2)
print("done", flush=True)
