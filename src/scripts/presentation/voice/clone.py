"""Speak lines in a cloned voice, and keep the take that is both right and yours.

  python clone.py <reference.wav> <lines.json> <outdir> [takes]

Sampling is stochastic, so takes differ — and they fail in two unrelated ways.
One is drift: the voice wanders off yours. The other is diction: it says
"hypercone". Speaker similarity catches the first and is blind to the second,
which is why every take is also transcribed and scored against the words it was
given. A take must first be *right*; among the right ones, the closest to you
wins. If none are right we keep the closest anyway and say so — a flagged take
is a re-roll with more takes, not a silent pass.

Writes <outdir>/<id>.wav plus a scores.json ledger.
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "shim"))

# A progress line must never be able to lose a take. Windows consoles still
# default to cp1252, where one arrow in a status message raises mid-run and
# throws away every take generated up to that point.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import librosa
import numpy as np
import torch
import torchaudio as ta
from chatterbox.tts import ChatterboxTTS
from transformers import pipeline

ref, lines_path, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
tries = int(sys.argv[4]) if len(sys.argv) > 4 else 4
lines = json.load(open(lines_path, encoding="utf-8"))
os.makedirs(outdir, exist_ok=True)

VE_SR = 16000
WER_OK = 0.08          # a take may miss about one word in twelve before it is wrong

device = "cuda" if torch.cuda.is_available() else "cpu"
model = ChatterboxTTS.from_pretrained(device=device)
listen = pipeline("automatic-speech-recognition", model="openai/whisper-base.en", device=device)
print(f"device={device} sr={model.sr} takes={tries}", flush=True)


def at16k(wav_np, sr):
    return wav_np if sr == VE_SR else librosa.resample(wav_np, orig_sr=sr, target_sr=VE_SR)


def embed(wav_np, sr):
    v = model.ve.embeds_from_wavs([at16k(wav_np, sr)], sample_rate=VE_SR)[0]
    return v / np.linalg.norm(v)


# pronunciations.json is the one place the project's odd words are declared.
# `say` is for the mouth (used by the build); `hear` is for the ear — spellings
# transcription is allowed to come back with. A coined noun has no correct
# spelling as far as an ASR model is concerned, so without this every take of a
# line carrying the name scores as wrong, and the take that dropped the word
# entirely wins on likeness alone.
RULES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "pronunciations.json")
RULES = json.load(open(RULES_PATH, encoding="utf-8")) if os.path.exists(RULES_PATH) else []
#
# One pass, longest spelling first, on whole words only. Anything else cascades:
# "hypercom" is a substring of "hypercomb", so a second pass rewrites the word it
# just produced.
HEARD_AS = {h.lower(): r["match"].lower()
            for r in RULES if r.get("match") and r.get("hear") for h in r["hear"]}
HEARD_RE = (re.compile(r"\b(" + "|".join(re.escape(h) for h in
                       sorted(HEARD_AS, key=len, reverse=True)) + r")\b")
            if HEARD_AS else None)


def words(text):
    flat = re.sub(r"[^a-z0-9' ]+", " ", text.lower())
    if HEARD_RE:
        flat = HEARD_RE.sub(lambda m: HEARD_AS[m.group(0)], flat)
    return flat.split()


def wer(want, got):
    """Word error rate — insert/delete/substitute, normalised by the script."""
    d = [[0] * (len(got) + 1) for _ in range(len(want) + 1)]
    for i in range(len(want) + 1):
        d[i][0] = i
    for j in range(len(got) + 1):
        d[0][j] = j
    for i in range(1, len(want) + 1):
        for j in range(1, len(got) + 1):
            d[i][j] = (d[i - 1][j - 1] if want[i - 1] == got[j - 1]
                       else 1 + min(d[i - 1][j - 1], d[i - 1][j], d[i][j - 1]))
    return d[len(want)][len(got)] / max(1, len(want))


ref_embed = embed(librosa.load(ref, sr=VE_SR)[0], VE_SR)

ledger = {}
for item in lines:
    t0 = time.time()
    want = words(item["text"])
    takes = []
    for k in range(tries):
        wav = model.generate(
            item["text"],
            audio_prompt_path=ref,
            exaggeration=item.get("exaggeration", 0.45),
            cfg_weight=item.get("cfg_weight", 0.45),
            temperature=item.get("temperature", 0.7),
        )
        cand = wav.squeeze(0).cpu().numpy()
        sim = float(np.dot(embed(cand, model.sr), ref_embed))
        heard = listen(at16k(cand, model.sr))["text"].strip()
        rate = wer(want, words(heard))
        takes.append({"wav": wav, "sim": sim, "wer": rate, "heard": heard})
        print(f"    {item['id']} take {k + 1}: likeness {sim:.3f}  WER {rate * 100:5.1f}%"
              f"{'' if rate <= WER_OK else '  ← ' + heard}", flush=True)

    # Right first, then close — and "right" is a ranking, not a threshold. A
    # take that says every word beats one that says all but one, however much
    # closer the near-miss sounds; likeness only breaks ties between takes that
    # are equally correct. WER_OK decides whether ANY take was usable at all.
    right = [t for t in takes if t["wer"] <= WER_OK]
    best = min(takes, key=lambda t: (round(t["wer"], 3), -t["sim"]))
    ta.save(f"{outdir}/{item['id']}.wav", best["wav"], model.sr)
    ledger[item["id"]] = {
        "similarity": round(best["sim"], 4),
        "wer": round(best["wer"], 4),
        "seconds": round(best["wav"].shape[-1] / model.sr, 2),
        "text": item["text"],
        **({} if right else {"flagged": "no take said the line — re-roll with more takes",
                             "heard": best["heard"]}),
    }
    print(f"  {item['id']:<20} kept likeness {best['sim']:.3f}  WER {best['wer'] * 100:.1f}%"
          f"  ({len(right)}/{len(takes)} usable, {time.time() - t0:.0f}s)"
          f"{'' if right else '  ⚠ NONE said the line'}", flush=True)

json.dump(ledger, open(f"{outdir}/scores.json", "w", encoding="utf-8"), indent=2)
print("done", flush=True)
