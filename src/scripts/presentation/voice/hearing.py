"""The ear both halves share: what was said, and how wrong it was.

pronunciations.json is the one place the project's odd words are declared. `say`
is for the mouth (used by the build); `hear` is for the ear — spellings
transcription is allowed to come back with. A coined noun has no correct
spelling as far as an ASR model is concerned, so without this every take of a
line carrying the name scores as wrong.
"""
import json
import os
import re

RULES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "pronunciations.json")
RULES = json.load(open(RULES_PATH, encoding="utf-8")) if os.path.exists(RULES_PATH) else []

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
