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
import soundfile as sf
from chatterbox.tts import ChatterboxTTS
from transformers import pipeline

# The ear is shared with convert.py — same rules, same scoring, one place.
from hearing import words, wer

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
    sf.write(f"{outdir}/{item['id']}.wav", best["wav"].squeeze(0).cpu().numpy(), model.sr)
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
