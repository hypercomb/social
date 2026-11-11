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

## A bank travels like a catalog

A host authors a pool; the community fills it (jwize: "publish to our host
pools our own dub so that people in the community can provide their own").

| word | does |
|---|---|
| `dub offer @host` | Puts your bank on the named host under your key: the bank document, every take it names, and `presentation:dubs` stamped in your signed index. A write always names its host. |
| `dub sync [@host]` | Reads the banks carried by the host named, the page's own host, the public hosts and your community hosts. Each bank is believed only when its bytes hash to the name the host listed. |
| `dub banks` | Lists the banks you have and which one plays. |
| `dub use <name>` | Plays a bank by its name, its host or its signature. `default` goes back to the page's own host; `none` plays only your own takes. |

The host lists every stamped bank at `<origin>/<sign('presentation:dubs')>`
(the worker's shared-record pools), once its operator lists the meaning:
`hosts list presentation:dubs`. A domain you learn can also offer banks through
the published-pool probe; placing the offer brings them in.

## Which bank fills a sentence

1. **Your own record** for the sentence: a take, edited words, or your choice
   of the original voice.
2. else **the bank you chose**, where it has the sentence.
3. else **the default**: a bank offered by the host the page is served from,
   newest first. Another host's bank is never the default; it plays only when
   chosen. This is what makes a host's own dub the presentation's soundbank
   for a visitor.
4. else what the page was built with.

A take from a bank is fetched by its own signature from the host that offered
the bank, and refused when the bytes are not it. What you remember between
sessions sits in the same pool: the sentences that are yours (`index`), the
banks offered (`banks`), and your choice (`choice`).

## Not verified, and not done

- None of this has been run in a browser: the recorder, the microphone, the
  editor's place above the scene, an offer to a real host.
- The planted pages must be rebuilt and replanted to carry the page hooks, and
  a host must deploy the worker change and list the meaning.
- A visitor only hears a host's bank if the dub bee is among the bees their
  shell loads; that has not been checked.
- There is no window for choosing a bank yet: it is the `dub` words.
