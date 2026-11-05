# glossary tiles

> Hypercomb's terms answered at once, from the hive, with no model asked.

## Why tiles, and not the anatomy

The anatomy is what every model is sent first. It carries the mechanics and the
doctrine, and it rides every request under a fixed budget: the doctrine
sections must stay under 12,000 characters (`codex.spec.ts`), with only a few
dozen to spare. `glossary.md` is many times that size. Putting it into the
anatomy would push it into every request whether the request needs it or not.

The codex already says where it goes instead:

- **C1** the hive is the AI's only context, and it is always current.
- **C2** a reader learns what the hive holds by reading signatures.
- **C3** pull, do not push: read what the task needs, on demand, within budget.

So the glossary goes into the hive as tiles. A model that needs a term reads its
tile like any other tile. A participant who needs one gets it from the tile
directly, before any model is asked.

## The words

| Say | What happens |
|---|---|
| `glossary` | says how many terms there are, and how to ask |
| `glossary <term>` | the term's definition, at once: from its tile, or from the glossary this build ships |
| `glossary tiles` | lays the glossary out as tiles on this page |

The whole line after `glossary` is the term (`rawArgs`). Some terms are behaviour
words of their own (`hive`, `clipboard`), and they must not run as one. The words
are the participant's own: laying tiles is a write, so the queen declares no
machine grammar.

## The tiles

`glossary tiles` lays out the same shape `doctrine tiles` does: a `glossary`
tile, one tile per section inside it, and one tile per term inside its section.

```
glossary/
  glossary-metaphor-layer/            note: the section's own prose
    glossary-hive                     note: "hive: a live session. …"
  glossary-foundational-terms/
    glossary-history-bag-sigbag       note: "history bag (sigbag): …"
  glossary-architecture-layer/
  glossary-cross-reference/           note: the cross-reference table
```

A term tile's note is the term as the glossary writes it, followed by its
definition. Every name begins with the glossary's own word because a tile's
notes are read by its word (**N1**: two tiles with the same name read the same
notes). A bare `hive` or `layer` would share its notes with every other `hive`
or `layer` tile in the hive. The bare `clipboard` is also a reserved pool word,
which the create path refuses. Names are unique across the whole glossary, and
the same glossary always produces the same tiles. Saying it twice adds nothing:
a tile that already exists is left alone, and a term that already carries a note
is not noted again.

## How a term is answered

1. The word is matched to its terms. A term answers to its whole heading, to
   its heading without the parentheses, to what the parentheses say, and to
   each side of a spaced slash: `sigbag`, `history bag` and `history bag sigbag`
   all name `history bag (sigbag)`. A plural names its singular (`layers`). A
   word may name more than one term: `bee` names the bee of the metaphor and
   the bee of the architecture.
2. For each term, its tile is looked for on this page, then on every page above
   it, then at the root. A read writes nothing. The first tile that carries
   notes answers with all of them, including any notes the participant added.
3. If no tile is found, the glossary this build ships answers instead, and the
   reply says so.
4. If no term is named by the word, the terms whose names contain it are
   offered instead (`capsule` offers `trail capsule`).

## Standard names, and a bee-story skin

The glossary's terms are the standard names. A bee-story naming will also be
available, as a skin (jwize, 2026-11-05). The tiles keep the standard words: a
tile's word is its grammar and the address its notes are read by (**N1**). A
skin changes how a term is said, not the tile that answers it.

## The source

`documentation/glossary.md` is the one source. `scripts/build-glossary.ts` runs
from `prepare`, after the anatomy, and writes it into
`hypercomb-essentials/src/assistant/glossary.generated.ts`. That module loads
only when the word is said, and it is never sent to a model. The build turns a
retired typed-folder spelling into a quoted name, so the typed-folder ratchet
stays tight. `glossary-tiles.spec.ts` checks that the generated module matches
the document.

Code: `assistant/glossary.ts` (reading and matching, with no imports),
`assistant/glossary-tiles.ts` (the plan, the maker, the answer) and
`assistant/glossary.queen.ts` (the word).
