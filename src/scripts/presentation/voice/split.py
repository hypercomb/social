"""Cut cloned passages into their sentences, at the word timestamps.

  python split.py <jobs.json> <dir>

A clone keeps a voice best across a long passage (a 28-second take of the
protocol tile scored 0.953 likeness; the same voice a sentence at a time,
0.89 to 0.92, and drifted in accent). So passages are cloned whole and cut
here: each job names a passage wav in <dir> and the sentences it holds, in
order, with their word counts. Whisper's word timestamps place each sentence
end by count (snapped to a heard word ending in . ! ? within two words), the
cut falls midway between the last word of one sentence and the first of the
next, and each sentence is written to <dir>/<key>.wav.

jobs.json: [{"wav": "<passage>.wav", "sentences": [{"key": "...", "words": 9}, ...]}]
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "shim"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import librosa
import soundfile as sf
import torch
from transformers import pipeline

import numpy as np

jobs_path, folder = sys.argv[1], sys.argv[2]
BEFORE, AFTER = 0.10, 0.15   # seconds kept before a sentence's first word and after its last
# ALMOST NO INHALE (jwize 2026-11-27: "Almost no inhale volume please"): every
# pause between two heard words longer than GAP_MIN, inside a sentence or
# between two, is turned down to DUCK (about -30 dB). The pause keeps its
# length, so the rhythm stays; only the breath in it goes quiet. TAIL and HEAD
# keep a margin either side, so a word's last sound and next onset are untouched.
DUCK, GAP_MIN, TAIL, HEAD, RAMP = 0.03, 0.18, 0.06, 0.04, 0.02
jobs = json.load(open(jobs_path, encoding="utf-8"))
device = "cuda" if torch.cuda.is_available() else "cpu"
asr = pipeline("automatic-speech-recognition", model="openai/whisper-base.en", device=device)

for job in jobs:
    src = os.path.join(folder, job["wav"])
    y, sr = librosa.load(src, sr=None)
    sentences = job["sentences"]
    out = asr(librosa.resample(y, orig_sr=sr, target_sr=16000), return_timestamps="word", chunk_length_s=30)
    words = [(c["text"].strip(), c["timestamp"][0], c["timestamp"][1]) for c in out["chunks"]]
    heard, want = len(words), sum(s["words"] for s in sentences)
    gain, ramp, ducked = np.ones(len(y), dtype=np.float32), int(RAMP * sr), 0
    for (_, _, end), (_, start, _) in zip(words, words[1:]):
        if end is None or start is None or start - end < GAP_MIN:
            continue
        a, b = int((end + TAIL) * sr), min(len(y), int((start - HEAD) * sr))
        if b - a <= 2 * ramp:
            continue
        gain[a:b] = DUCK
        gain[a:a + ramp] = np.linspace(1, DUCK, ramp)
        gain[b - ramp:b] = np.linspace(DUCK, 1, ramp)
        ducked += 1
    y = (y * gain).astype(y.dtype)
    cuts, cum = [], 0
    for s in sentences[:-1]:
        cum += s["words"]
        i = max(1, min(heard - 1, round(cum * heard / want)))
        best = i
        for k in [i, i - 1, i + 1, i - 2, i + 2]:
            if 1 <= k <= heard - 1 and re.search(r"[.!?]$", words[k - 1][0]):
                best = k
                break
        end_prev, start_next = words[best - 1][2], words[best][1]
        at = (end_prev + start_next) / 2 if end_prev is not None and start_next is not None and start_next >= end_prev else (end_prev or start_next)
        cuts.append(at)
    edges = [0] + [int(c * sr) for c in cuts] + [len(y)]
    # Each sentence is kept from just before its first word to just after its
    # last: the breath a clone takes between sentences falls outside, and the
    # join puts clean silence there instead (jwize, 2026-11-26: "the
    # breathwork is a little too loud"). Clamped to the sentence's own cut.
    firsts, lasts, cum = [], [], 0
    for s in sentences:
        lo = round(cum * heard / want)
        cum += s["words"]
        hi = max(lo, round(cum * heard / want) - 1)
        firsts.append(words[min(lo, heard - 1)][1])
        lasts.append(words[min(hi, heard - 1)][2])
    for k, s in enumerate(sentences):
        a, b = edges[k], edges[k + 1]
        if firsts[k] is not None:
            a = max(a, int((firsts[k] - BEFORE) * sr))
        if lasts[k] is not None:
            b = min(b, int((lasts[k] + AFTER) * sr))
        if b - a < int(0.2 * sr):
            a, b = edges[k], edges[k + 1]
        sf.write(os.path.join(folder, f"{s['key']}.wav"), y[a:b], sr)
    print(f"  {job['wav']}: {len(sentences)} sentences, heard {heard} of {want} words, {ducked} breath(s) turned down", flush=True)
print("split done", flush=True)
