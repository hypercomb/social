# The notes reader

One tile's notes, read as hexagons.

The **notes strip** authors: a dense tree you edit in place, with a mark rail,
a search box and a tile navigator. The **reader** does the other half of the
job — it shows one note at a time, large enough to actually read, with its
place in the tree drawn around it. Open it from the book button in the strip's
header (`notes.read`), or emit `notes:open` directly.

`hypercomb-shared/ui/notes-viewer/` · registry-fed shell surface
(`hc-notes-viewer`, order 100).

## Three moves

**Side tabs pick the hierarchy.** A *hierarchy* is one root note plus
everything nested under it. A tile with four root notes therefore reads as four
small documents rather than one long list. Each tab carries that root's
hexagon, its opening words, and how many notes the hierarchy holds. With only
one hierarchy the rail does not render — a chooser of one is just lost width.

**Prev / next walk the notes inside that hierarchy**, depth-first, and **wrap
at both ends**. There is no first note and no last one; the cycle closes.
Running off the end is how you get back to the top. Consequently *neither
button is ever disabled* — a dead button would be a lie about the behaviour.
Arrow keys do the same thing (nothing in this surface takes text, so the arrows
are free).

**Clicking a row in the outline** jumps the focus straight there.

## The hexagon is the point item

Rail tab, big focus, outline bullet — one shape at three sizes (16px, 16px,
72px), with the note's mark icon riding **on top of** the clipped face rather
than inside the clip, because clipping a glyph shaves its corners off.

Notes written before marks existed carry a `shape` instead. Those swap the
face's `clip-path` rather than being redrawn as hexagons: a note must not
silently change shape because the surface it is read in changed.

## Pheromones on notes

Notes carry their own pheromones, in a `tags` slot on the note layer.

The gesture is a drag. The reader's header has a pheromone button that opens
the **Pheromones panel** beside it (the card slides left of the 320px dock so
neither surface covers the other); drag a keyword out of the panel and drop it
on any row. Each chip's `×` on the focused note takes it back off.

Two contracts make that work:

- Every droppable row carries **`data-pheromone-note`** (the note's id) and
  **`data-pheromone-note-cell`** (its tile). The panel's existing drag-out
  gesture looks for that pair on release, *before* it falls through to the hex
  map — otherwise a drop over the reader would tag whatever tile happened to
  sit behind the card.
- The reader's backdrop is **pointer-transparent**, and must stay that way. A
  click-blocking backdrop would make the drag impossible.

### Why the slot lives on the note

A note's id **is** its content signature (see `notes.drone.ts`). A side pool
keyed by note id would be orphaned the instant the note was edited, so the
pheromones live on the note itself — the same place `mark` and `shape` already
live — and an edit carries them forward. Re-typing a note's text is not a
request to strip what you put on it.

### The dedup invariant

`tags` is **optional on the layer and omitted entirely when empty**.

That is load-bearing. Every nest, mark and delete re-materializes the tree from
the leaves up and relies on untouched subtrees deduping back to their existing
signatures. If an untagged note serialized `"tags": []`, every one of those
operations would re-sign the whole tree instead.

The guard is `normalizeTags` in `note-tags.ts`: it returns an empty array for
anything that isn't a real keyword list, and the drone spreads the slot in only
when the result is non-empty. It also **sorts**, so two notes carrying the same
set materialize to the same bytes.

Verified live: tagging a note mints a new signature, untagging it returns the
note to *exactly* its original signature.

## Effects

| Effect | Direction | Meaning |
|---|---|---|
| `notes:open { cellLabel, noteId? }` | → reader | Open on a tile. With a `noteId`, land on that note — selecting the hierarchy containing it and focusing its row. |
| `notes:viewer { active }` | reader → | Visibility, so the escape cascade can close the reader ahead of clearing selection. |
| `notes:viewer-close` | → reader | The cascade's close. |
| `note:tag { cellLabel, noteId, tag, add }` | → notes drone | Put a pheromone on a note, or take it off. `add` omitted means put on. |
| `tags:view-open` / `tags:view-close` | reader → | Open or close the Pheromones panel alongside. |
| `tags:view-state { open }` | → reader | Whether to step the card clear of the dock. |

`note:tag` rewrites **one node at any depth** and re-materializes from the
leaves up, exactly as `note:mark` does, so a tagged parent keeps its children
and its position. Re-dropping a keyword a note already carries is a **no-op** —
no new revision. Direction is the caller's to decide, so a second drop never
silently un-tags.

## Focus is held by position, not by id

Deliberate, and it is what makes tagging feel steady. Because a tag write mints
a new note id, a reader holding the old id would strand itself on a note that
no longer exists. Holding *row 3* means the note at row 3 is still the note at
row 3 after the write.

## Where the logic is tested

Pure decisions live in siblings so they can be tested without an Angular
harness or a `window.ioc` (the `wave-layout.ts` / `stage-centering.ts` idiom):

- `notes-viewer/note-cycle.ts` — `flattenHierarchy` (depth-first) and
  `stepIndex` (the wrap). The double modulo in `stepIndex` is not decoration:
  JavaScript keeps the sign of the left operand, so `-1 % 5` is `-1`. A single
  modulo would land on a negative index stepping backwards off the front.
- `notes/note-tags.ts` — `normalizeTags` and `setTagInTree`.

## Known limitation (predates this work)

Editing a note through `note:commit` writes a **childless** layer into the
top-level slot, so an edited note loses its children. That is the same
limitation `note:mark` was built to route around, and it is unchanged here —
pheromones survive an edit, children still do not.
