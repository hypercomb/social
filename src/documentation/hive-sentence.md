# The hive's language has one look

**Status: BUILT 2026-09-20.** Direction from jwize: *"instead of showing the
slash in front of the behaviors just change the colours in the language … a
standard every time we see them in text."*

A behaviour sentence — `copy drafts`, `list /`, `create jev-proof` — is drawn
the same way wherever it appears. The command line already reads text this
way (the common tongue: the slash lives in the icon, the words carry the
light). This carries that reading onto every other surface.

## The look

**Restyled 2026-09-21** (jwize: *"the underlines make it look unnatural … a
distinct sentence style and theme, stylistically perfect for reading"*).

| Part | Look |
|---|---|
| the whole sentence | a soft chip in the command line's own face, tinted by its behaviour's colour |
| behaviour word | heavier, in that colour |
| argument | ordinary ink |
| separator | a slash inside a path, or the dot between one step's sentences, recedes |
| filler | recedes |
| ambiguous word | violet with a dashed line: the one mark that keeps a line |

No slash in front, no underline. Colour is never the only signal: the weight
carries the behaviour word for anyone who cannot tell the hues apart. A lone
`/` means the root and stays in ink.

**Colour per behaviour.** A behaviour's colour is its behaviour tile's
category keyword, through the tag registry — exactly what the command line
paints. A behaviour the hive knows no category for takes the command
register's colour (`--hc-status-warn`).

## Where it shows

- chat messages: any code span whose first word is a behaviour or a read verb
- table questions: each row's sentences, and the answer options — one option
  per row, its sentences joined by the quiet dot, so a pick runs the whole
  step. At most three rows are offered, best first by Jev's fit, because the
  question format allows four options of eighty characters; a question that
  broke that was silently refused and fell through as raw code.
- the Execution column: every line waiting or run
- receipts: "Ran in the hive: …"

A code span that is not a sentence stays what it was. `/dolphin/site` is still
a navigation chip; `npm run build` is still code. A single slash-rooted word
that is also a behaviour, like `/find`, reads as the behaviour — before this,
it rendered as a chip that navigated to a tile called "find".

## One reader, one sheet

- **Reading:** `hypercomb-shared/ui/hive-sentence/hive-sentence.ts`. It asks
  the command line's own reader (`@diamondcoreprocessor.com/UtteranceReader`,
  essentials) to read each sentence, so the lexicon is the live census and the
  colours are the hive's. No list of words lives in the shell.
- **Look:** `hypercomb-shared/styles/_hive-sentence.scss`, loaded by every
  shell's global stylesheet. A new surface adds the classes; it never styles
  sentences on its own.

Only the display loses the slash. The line that runs, the stored turn text,
and the bridge's `do` grammar are unchanged; the slash remains the exactness
anchor in the register.
