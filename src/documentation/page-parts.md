# A page in parts

*jwize, 2026-11-15, on business-card.jwize.com:* "if we don't break it apart
into its hive we will have to create a lot of bloat because we have to update
the 1 MB file every change. Can we break it apart into web parts and be able
to version the pieces?" … "we are breaking it up into the html card parts so
they have a structure as well and can be reused." … "remember to use traits
where interface needs to land, those are your component's extension point." …
"any part can have its own traits of course to further refine."

## What was wrong

A website page that grew up as one document carries its stylesheet, its
scripts and often a whole library inline. The business card is 998 KB: 704 KB
of it one library kept as text, 181 KB the card's own script, 82 KB the
animation, 19 KB of styles, 6.5 KB of markup.

A model could not work on it. Reading it a page at a time filled the model's
room before it reached the line it was asked to change, and three
conversations ended there. A write of the page was refused for its size, so
even a model that found the line could not change it.

## The rule

A page is **broken apart** ([website-artifact-paradigm.md](website-artifact-paradigm.md),
[atomic-chain.md](atomic-chain.md)). One block at a time leaves the page for a
file of its own on a tile of its own:

```
/card                  wears the page, as served: one document
                       holds page.shell.html
                       wears the trait "animation"
/card/animation        holds animation.js
```

- **The part** is the block's text, a file on a child tile. It has its own
  history, and it is changed by itself.
- **The shell** (`page.shell.html`, on the page's tile) is the page with that
  block emptied and a reference left on its tag:
  `<script data-hc-part="resource:<signature>/animation.js"></script>`. The
  reference is a name and a signature. The signature is the version in use
  and never moves on its own.
- **A part is a trait of the page** ([traits.md](traits.md)). The name a block
  moves out under is a trait word. The page's tile wears `trait:want` for it,
  as a trait the creation fills itself, and the child tile of that name is
  what fills it: the child rung. So a part is an extension point. It can be
  filled by something else, offered across hosts, and its own tile can wear
  traits of its own.
- **The page that is served stays one document**
  ([template-addressing.md](template-addressing.md), Rule 3: resolution
  happens before anything leaves the hive). A card's door answers with the
  page's own bytes and refuses a page that loads a script from elsewhere. A
  managed door frames the page with no network. So the page of record is the
  shell **assembled**: every reference filled with its part's text.

## Three guarantees

1. **Moving a block out changes nothing that is served.** Before anything is
   filed, the new shell is assembled and compared with the page byte for
   byte. If it does not come back exactly, the block is not moved.
2. **A part that would break the page is refused before it is written.** A
   part's text cannot hold its own closing tag, and a part that is not on the
   device stops the assembly with its name.
3. **The page is the truth.** A page written whole after it was broken apart
   wins. Its old shell no longer stands, and the next break starts again from
   the page as it is.

## How it is used

Reading (`read <signature>` of a page):

- A page that fits in one read is its text, as before.
- A longer page answers with its **outline**: each `<style>` and `<script>`
  block, its size, how it begins, and the path that opens it alone.
- `read <signature> src/page/script-3.js` opens that block alone.
  `src/page/markup.html` is the document with every block's text left out.

Breaking apart:

```
part /card script-3 animation
```

moves the third script into `animation.js` on `/card/animation`. The tile is
made when it is not there.

Changing a part: a write block for the file
(`file /card/animation animation.js`, SEARCH/REPLACE edits). The hive moves
the shell to the new signature, assembles the page and commits it. The
markup is changed the same way, in `page.shell.html`. A write of the whole
page is refused while its shell stands, and names the files to change.

Finding a part (2026-11-15). A conversation that did not make the parts has
to find them. `read /card` lists the files the tile holds, each with the
signature that opens it; when `page.shell.html` is among them, the read says
the page is in parts and that each part is a file on the child tile of its
name. `read /card/style` then lists `style.css`. Before this a tile's files
were a count among its records, and a fresh conversation took thirteen rounds
to add one line to the stylesheet. A write to a part's file counts as the
page written: the chat used to answer it with "the page was read and not
written" and spend another leg on finished work.

## Where it lives

All of it is in the essentials package:

- `files/page-parts.ts`: the text rules. Blocks, outline, moving out,
  assembling.
- `files/page-parts-commit.ts`: the tiles, files and the trait.
- `files/part.queen.ts`: the word.
- `files/tile-files.drone.ts`: a file write rebuilds the page that stands on it.
- `assistant/hive-tree-reader.ts`: the outline and the read by part.

## Not built yet

- **Storage.** The assembled page is still stored whole on every change, so a
  change to one part still mints one page-sized resource. The saving so far is
  in what a model and a person must read and write. Serving a shell that
  names its parts, with the door assembling or linking them, is the step that
  removes it.
- **Markup parts.** Only `<style>` and `<script>` blocks move out. Sections of
  markup are the holes of [website-artifact-paradigm.md](website-artifact-paradigm.md).
- **A part's own traits, filled into its text.** A part's tile can wear traits
  now. Filling a hole inside a part's own text from its children is not built.
- **Another filler.** A `trait:fill` for a part's word does not yet move the
  shell to that filler.
- **Putting a block back.**
