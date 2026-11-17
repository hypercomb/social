# Pictures a model reads

**Built 2026-11-16 (subdomain AI step 4, SEE; jwize 2026-11-13: "things like
images and other document resources that the ai can scrutinize").**

`read <signature>` of picture bytes used to answer "not text; only its type
and size can be shown". An agent on a site door built a card's back faces from
pictures it never saw, and both bugs in that work were found only by a person
looking.

## What a picture read answers

- **In the receipt, words only:** the picture's width and height and a short
  reading of its colours (`comfy-help.ts` `pictureReading`). The picture's
  bytes never go into the receipt's text.
- **Beside the receipt, a JPEG:** at most 1024 pixels on its longest edge
  (`assistant/picture-read.ts`, `PICTURE_SIDE`), made from the bytes for that
  one answer and never stored. The chat attaches it to the message that
  carries the receipt (`images`, sent as an `image_url` part by OpenAI-shaped
  providers, OpenRouter among them).
- **Only to a model that sees.** The router answers `seesPicturesForModel`
  from the OpenRouter catalogue (`architecture.input_modalities` includes
  `image`); unknown is no. A model that cannot see is told so, and gets the
  words alone.
- **Only the newest message carries pictures**, at most four, so a long leg
  does not send every picture again every round. The words stay.

A picture is known by its type, or by its first bytes when the store gave none
(PNG, JPEG, GIF, WebP). SVG is text and is read as text.

## A model that cannot see is told what one that can saw

**Built 2026-11-17 (jwize: "Yes, describe them").** When the conversation's
model is text-only, each picture a read returns (at most four) is described
by a model that sees, on the participant's own key
(`assistant/picture-describe.ts`, router `describePicture`), and the receipt
carries `description` and `describedBy`. The describing model is one of the
participant's own lines that sees, else the OpenRouter line's lightest
built-in model the catalogue says takes pictures (today
`google/gemini-2.5-flash-lite`). With no such model, the words alone stand. A
description is remembered by the picture's signature for the session, so
reading the same picture again costs nothing.

## Not built yet

- Pictures the participant pastes into the chat still reach only the loopback
  bridge.
- PDF and other documents: no text is extracted yet.
- Anthropic and Google direct providers drop images; they are folded into
  OpenRouter today, which carries them.

Code: `hypercomb-essentials/src/assistant/picture-read.ts`, `picture-describe.ts`, `hive-tree-reader.ts`
(`readBytesBySig`), `providers/openrouter-catalog.ts` (`vision`),
`llm-dispatch.ts` (`seesPicturesForModel`); `hypercomb-runtime/src/chat-window/ui/chat-window/hypercomb-observation.ts`
(`safePicture`, `picturesOf`, the receipt), `chat-window.ts` (`withPictures`).
