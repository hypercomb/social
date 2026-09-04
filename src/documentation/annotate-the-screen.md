# Annotate the screen

**Draw on what you are looking at, photograph it, and start a conversation
about the place you were standing.**

A question about a screen is nearly always a question about one part of it, and
describing which part in prose is the slowest, least reliable half of the
sentence. Annotating removes that half.

## The act

1. Open the sheet — the `draw` button in the bottom-right cluster, the word
   `/annotate`, or the `d` key.
2. Draw. Pen, arrow, box, numbered pins; six inks; `ctrl+z` undoes, Escape
   closes.
3. Choose a door.

Two doors, and the difference between them is the whole design:

| Door | What it means |
|---|---|
| **add to the open chat** | this belongs in what we are already talking about — the picture joins the open conversation's reference shelf |
| **start a conversation** | this *is* the thing to talk about — a new conversation on the location you were standing at, carrying the annotation and nothing else |

`ctrl+enter` takes the first door, `ctrl+shift+enter` the second.

## It knows where it was drawn

A screen is always a screen *of* somewhere. The sheet reads the current layer
from Lineage when it opens, shows it in the toolbar, and sends it with the
picture. There is no picker, because the address was never in doubt.

The location does two jobs:

- it **names the picture** — the shelf reads `annotation — /dolphin/site`, so a
  shelf of several shots is readable without opening them;
- it **binds a new conversation** — `start a conversation` mints
  `newTileConvoId(segments)`, so the thread is filed under that tile, its draft
  is that tile's draft, and an answer knows what it may change.

Starting a conversation empties the reference shelf first. A conversation
started from an annotation is about that annotation; references gathered for an
earlier question would ride along unread. Nothing is lost — the shelf is filled
*from* the clipboard, which this does not touch.

## Where the control lives, and why it survives a page

The opener sits in the bottom-right document cluster (`edit-actions`), where
the feedback button used to be. That corner takes its own gate per control
rather than one `display:none` on the box:

- **`view:active`** — a website page, a game, a document, a photo — hides
  rotate, undo, redo, save and the selection verbs. They belong to the hive you
  are standing in, not to the thing you are reading.
- **Annotate stays**, and lifts to `z-index: 100004` so it paints in the view's
  own stacking band. The moment you most want to draw on the screen and ask
  about it is when a page is what is on the screen.

The `d` key is the same act through another door — `view:active` does not
suppress the keymap, so it works on every page. It is a bare letter and
therefore deliberately does *not* fire while focus is in a text box; that is
the one case where the button is the only way in.

## Three decisions worth keeping

1. **The sheet never enters `view:active`.** That mode hides the stage and the
   chrome — exactly the pixels being photographed. It is a sheet on top of a
   live screen, not a view that replaces one.
2. **The ink rides in the frame.** The strokes are drawn into a canvas that is
   part of the page, so `getDisplayMedia`'s capture already contains them. No
   compositing, no scale arithmetic. Only the toolbar is removed for the shot,
   and removed from the DOM, not merely hidden.
3. **Permission first, hiding second.** The stream is awaited before the
   toolbar leaves, so a dismissed picker never strands the sheet without
   controls. The stream is kept while the sheet is open — a second shot costs
   no second prompt — and stopped on close.

The dock is one fixed column holding the hint above the bar. The hint used to
be positioned from the bottom of the screen, which silently assumed a one-row
bar; adding a control made the two overlap.

## What this replaced

- **The feedback window is retired** (2026-09-04). Filing an issue hands
  somebody a complaint; drawing on the screen and starting a conversation from
  it hands the assistant the thing itself, in the place it happened. The
  viewer, its shell surface, its lesson and its catalog entries are gone.
  The swarm's `feedback-reply` / `feedback-swarm` drones and the bridge's
  feedback channel are untouched — they are the peer-to-peer machinery, not the
  window.
- **The notes window is now Details.** Annotating is no longer a button in the
  corner of that desk; it is a standing act of its own. The `details.*` catalog
  keys replace `annotations.*`.

## Files

| What | Where |
|---|---|
| The sheet | `hypercomb-shared/ui/markup-overlay/` |
| The opener | `hypercomb-shared/ui/edit-actions/` |
| The word | `hypercomb-essentials/src/commands/annotate.queen.ts` |
| The key | `hypercomb-essentials/src/keyboard/default-keymap.ts` (`markup.open`) |
| The landing | `hypercomb-shared/ui/chat-window/` (`#attachPicture`, `#startAt`) |
