"""Audit the narration the deck ships: what the ear hears versus what the script says.

    ~/.hcvoice/venv/Scripts/python.exe voice/audit.py [--model openai/whisper-small.en] [--scenes 1,5,8] [--out audit.json]

For every scene it transcribes the cached mp3 the build would embed (the same
sha256(voice|rate|spoken(say)) slot build.cjs reads) and aligns the heard words
against the caption's words. Every substitution, drop and insertion is a place
the voice may have said something wrong — a pronunciation to fix in
pronunciations.json (`say`), or an ASR spelling to accept (`hear`).

Read the misses as leads, not verdicts: an ASR model also mishears a correct
voice. A miss that repeats across scenes for the same word is the strong signal.
"""
import argparse
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, os.pardir)
sys.path.insert(0, os.path.join(HERE, "shim"))

import librosa  # noqa: E402
import torch  # noqa: E402
from transformers import pipeline  # noqa: E402

from hearing import words, wer, RULES  # noqa: E402

VOICE = "en-US-AndrewMultilingualNeural"
RATE = "+2%"
PAUSE = re.compile(r"\[pause(?::(\d+))?\]")


def spoken_of(say):
    for r in RULES:
        if r and r.get("match") and r.get("say"):
            say = say.replace(r["match"], r["say"])
    return say


def caption_of(say):
    t = PAUSE.sub(" ", say)
    t = re.sub(r"\s{2,}", " ", t)
    return re.sub(r"\s+([.,;:!?])", r"\1", t).strip()


def cache_path(say):
    h = hashlib.sha256(f"{VOICE}|{RATE}|{spoken_of(say)}".encode("utf-8")).hexdigest()[:16]
    return os.path.join(ROOT, "audio-cache", h + ".mp3")


def align(want, got):
    """Levenshtein alignment → list of (op, want_words, got_words) for non-matches."""
    n, m = len(want), len(got)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j - 1] + (0 if want[i - 1] == got[j - 1] else 1),
                          d[i - 1][j] + 1, d[i][j - 1] + 1)
    ops, i, j = [], n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (0 if want[i - 1] == got[j - 1] else 1):
            ops.append(("=" if want[i - 1] == got[j - 1] else "sub", i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            ops.append(("del", i - 1, None))
            i -= 1
        else:
            ops.append(("ins", None, j - 1))
            j -= 1
    ops.reverse()
    # merge runs of non-matches into one miss with context
    misses, run = [], None
    for op, a, b in ops:
        if op == "=":
            if run:
                misses.append(run)
                run = None
            continue
        if not run:
            run = {"at": a if a is not None else (b if b is not None else 0), "want": [], "got": []}
        if a is not None:
            run["want"].append(want[a])
        if b is not None:
            run["got"].append(got[b])
    if run:
        misses.append(run)
    return misses


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="openai/whisper-small.en")
    ap.add_argument("--scenes", default="")
    ap.add_argument("--out", default=os.path.join(HERE, "audit.json"))
    a = ap.parse_args()

    only = {int(s) for s in a.scenes.split(",") if s.strip()}
    scene_dir = os.path.join(ROOT, "scenes")
    scenes = [json.load(open(os.path.join(scene_dir, f), encoding="utf-8"))
              for f in sorted(os.listdir(scene_dir)) if f.endswith(".json")]
    device = 0 if torch.cuda.is_available() else -1
    ear = pipeline("automatic-speech-recognition", model=a.model, device=device, chunk_length_s=30)

    report = []
    for s in scenes:
        if only and s["n"] not in only:
            continue
        mp3 = cache_path(s["say"])
        if not os.path.exists(mp3):
            print(f"scene {s['n']:2}: no cached audio")
            continue
        audio, sr = librosa.load(mp3, sr=16000, mono=True)
        heard = ear({"raw": audio, "sampling_rate": sr}, batch_size=4)["text"].strip()
        want, got = words(caption_of(s["say"])), words(heard)
        misses = align(want, got)
        for m in misses:
            lo = max(0, m["at"] - 4)
            m["context"] = " ".join(want[lo:m["at"] + len(m["want"]) + 4])
        report.append({"n": s["n"], "name": s["name"], "wer": round(wer(want, got), 3),
                       "heard": heard, "misses": misses})
        print(f"scene {s['n']:2} wer {wer(want, got):.3f}  {len(misses)} miss(es)")
        for m in misses:
            print(f"    said {' '.join(m['want']) or '∅':30} heard {' '.join(m['got']) or '∅':30} | {m['context']}")
    json.dump(report, open(a.out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
