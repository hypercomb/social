# The summary gutter — select text, keep a summary in the margin, read compact

Status: DESIGN, 2026-09-09 (Jaime). Not built. Build after
`mobile-one-column.md` pass 1.

Jaime: *"put the gutter to the left, and potentially on the right … select
any text, create a summary of it … don't show the whole summary except
when you mouse over, and you can scroll it down the left … section out our
text, and perhaps create our own version of compact."*

## 1. The model — a summary is a note that wears a mark

Not a side-table, not a per-window blob. A note's `id` IS its signature
(`notes/note-tree.ts`, `Note`). A summary is a **child note** of the note
it summarizes, and it carries:

- the `summary` **role** on the marks palette (`sign('notes:marks')`, the
  same mechanism that gives an icon the heading/list role — re-styling
  every summary is one palette edit);
- an **anchor**: the character span in the parent's text (`span:120-340`)
  for speed, plus the exact quoted text as a resource signature
  (`quote:<sig>`) for re-anchoring — the parent's edit mints a new sig and
  may move the offsets, and the quote finds the span again (miss → the
  marker shows *unanchored*, never a wrong span).

This is the W3C annotation shape (target = source + selector, body = the
summary) in the hive's own primitives: signature-addressed, sharable,
undoable, in history like every other note. **Summaries hide from the
note tree** (classified by role, exactly as the lists tab classifies) —
they live in the gutter, never as nested rows.

## 2. The gutter

- The reader (`notes-viewer`) already has a left rail: the hexdot + mark
  icon per row. The gutter **extends that rail**. Each summary is a small
  marker aligned to the first line of its span.
- **Nothing shows at rest.** Hover the marker → the summary card pops
  beside the rail; the span gets a faint underline while the marker is
  hovered, so *what* it summarizes is always visible. Leave → gone.
- The rail lives **inside the same scroll container** as the prose, so it
  scrolls with the text.
- **Right gutter** = the same rail mirrored; a per-window setting
  (`hc:panel-gutter:<window>` = `left | right`), same plumbing as the
  reading-face choice.
- Pending (asked, not answered): hollow marker. Unanchored: dashed marker.

## 3. The selection bar

Select text in the prose → a small floating bar at the selection's end:

- **Summarize** — mints an `ask` record (`kind:'ask'`, `mode:'summarize'`,
  prompt = the selection, target = the note's tile) through the
  mediator: the local model if it probes live, else the bridge session,
  else it opens the *Write* field. The button never dead-ends. The answer
  becomes the child note with the anchor; the marker fills.
- **Write a summary** — a one-line field; Enter mints the child note.

Selection offsets: in the reader, `window.getSelection()` → a Range →
offsets relative to the row's `<p>` text; in the desk's textarea,
`selectionStart/End` directly.

## 4. Compact — the payoff

A toggle in the reader header: **compact**. Every summarized span is
swapped for its summary, in place; click a summary to expand its span
back. A long note reads as its summaries. Later door, same data: the
mediator receives the compacted text as context instead of the full note
— `/compact` with the participant choosing the sections.

## 5. Where, in order

1. The reader (`hypercomb-shared/ui/notes-viewer`) — prose at rest, rail
   already there.
2. The desk's textarea (`notes-strip`) — offsets come free.
3. Chat transcripts (`chat-window`) — same bar, same gutter.
4. Phone: tap instead of hover, in the tile page's note.

## 6. Deliberate rejections

- No always-open gutter; hover reveals only.
- No summaries as nested rows in the tree.
- No new pool for anchors — the anchor rides on the summary note's
  pheromones (`span:`, `quote:`); the quote text is a resource by sig.
- No model hardwired: Summarize asks whatever is live.
