# Dubbing a presentation: a voice and words for a sentence, from a pool

jwize, 2026-11-11: "we can watch the presentation. However, if we are a host,
we have the ability to author pools of meaning. So we can leave artifacts
behind that can be shared by the community ... the hypercomb doctrine allows us
to use this data point in our presentations and fill them through the pools."

A presentation page shows one sentence at a time and plays its voice. Both the
voice and the words of a sentence can be replaced, in place, by whoever hosts:
the page asks a pool, and plays and shows what the pool answers.

## The sentence is the address

A dub belongs to a sentence, not to a page. A sentence's name is the SHA-256
of its words with spaces folded (`sentenceKey`, spelled the same in
`scripts/bridge/living-presentation/blocks/page.cjs` and in
`hypercomb-essentials/src/dub/dub-bank.ts`). The page builder bakes that name
into every step (`key`). One take therefore answers the sentence on every page
that says it.

## The pool

`presentation:dubs` holds one current record per sentence, keyed by the
sentence's name, earlier ones kept as versions:

```json
{ "kind": "presentation:dub", "v": 1, "say": "<sentence sig>",
  "text": "the words as said now", "reworded": true,
  "voice": "<resource sig or ''>", "type": "audio/webm", "seconds": 4.2, "at": 0 }
```

- `voice` is the take's bytes as a resource (stored once, by signature). An
  empty `voice` means the page plays what it was built with.
- `reworded` means `text` replaces the page's own words. A take belongs to the
  words it was read from, so saving new words drops any take in hand.
- A whole bank is one document (`presentation:soundbank`, `soundbankOf`): one
  member per dubber, so a published index never grows with the sentences.

## How the page is filled

The page and the hive agree on a face registered as
`@diamondcoreprocessor.com/DubBank` and on two DOM events:

| | |
|---|---|
| `urlOf(key)` | the take to play for a sentence, or `''` |
| `textOf(key)` | the sentence's edited words, or `''` |
| `want(keys)` | the sentences a page shows; read ahead of use |
| `canRecord` | whether a press may open the audio editor here |
| `hc-sentence` | the page says a sentence was pressed (bubbling) |
| `hc-dubs-changed` | the hive says the bank or the switch changed (window) |

A take outranks the baked voice for its sentence, start to end; the scene's one
voice picks up again at the next sentence's stretch. A page on its own, with no
hive, plays and shows what it was built with.

## The audio editor

Off until asked for, and never part of a published page (jwize: "the audio
editor is not for publish use and you have to turn it off by default"):

- `dub`, `dub on`, `dub off` switch it for the session. It is off again on the
  next load; nothing about the switch is stored.
- It is never on in a visitor's shell. Takes already kept play either way.

With it on, a press on the sentence under a playing presentation holds the
scene and opens the editor **centered above the viewer, never over it** (jwize:
"this is in the way of the presentation ... when a host is editing it should be
centered above the viewer"). It sits in the page's flow just before the scene
and is not a dialog.

- **Record** takes the microphone. A cursor walks the words at reading pace,
  karaoke style; a press on a word, or the arrow keys, moves the cursor.
- **Hear it**, **Keep this take**, **Record again**, **Use the original voice**.
- **Edit the words** swaps the line for a text box; saving shows the new words
  on the page at once.

## Not built yet

- Offering a bank to a host and reading the bank a host carries (the
  published-pool path the community translations and comfy workflows use), and
  choosing which host's bank is the default for a visitor.
- Letting a participant choose between banks for their own experience.
- The planted pages must be rebuilt and replanted to carry the page hooks.
