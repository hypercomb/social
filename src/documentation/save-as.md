# Save as, and use

Your home page is your root. `save as <name>` files the root under a name and
leaves you on an empty root; `use <name>` turns a saved root back on. There is
no "new hive" — only roots, one of them on at a time, the others filed under
names (jwize, 2026-10-10 and 2026-10-13).

| Word | What happens |
|---|---|
| `save as summer` | The root's tiles are filed under `summer`; the root is empty. A root that came from a name gives that name its latest state first. |
| `use summer` | `summer`'s tiles are the root again. The root you leave goes back under its name. |
| `use` | Lists your saved roots (in the activity log). |

## The rules

- **Save as comes first.** A root that has tiles and no name is never left by
  `use` — it says *save as \<name\> first*. An empty root has nothing to lose,
  so `use` leaves it freely; that is the root `save as` leaves you on.
- **Nothing is lost, nothing is deleted.** Every step is a forward commit:
  the root's own history keeps every earlier head, and a filed root is the
  same layer, by signature, that the root held — never a copy.
- **Pages are shared by name.** Under per-page history a page's truth is its
  own bag, named by the tile. Switching roots moves the ROOT PAGE only; the
  pages beneath keep their latest state whichever root lists them. A tile made
  on one root with the same name as a tile of another IS that tile.
- **The restore-point index is carried**, as `/restore` carries it: an empty
  root keeps it, and a root turned on takes the live one.

## Where it lives

- `hypercomb-essentials/src/history/saved-roots.ts` — the model, the record,
  and the moves (`readRootHead`, `fileUnder`, `setRoot`, `slateFrom`,
  `withLiveSnapshots`).
- `commands/save.queen.ts`, `commands/use.queen.ts` — the words.
- The record is one participant DOCUMENT, pool `roots:saved`, never
  replicated: `{ saved: [word…], active: word | null }`. Every write keeps a
  version, so the document's history is the log of saves and switches.
- A saved root is the head of its molecule bag, `sign(<word>)`.

## The guards

- **A saved name is never a tile name.** A tile called `summer` would open
  `sign('summer')` — the saved root itself. The naming gestures refuse it
  beside the reserved-word gate: the command line's create path, the create
  queen, the trait queen and the add sheet ("summer is a saved root — use
  summer turns it on").
- **`save as` refuses** a reserved word, a word the command line runs, a word
  already a tile of this hive (a bag with real content, or a root tile by that
  name), a name already saved, an empty root, and a rewound cursor or open
  preview.
- **Prune never offers a saved root's pages.** At the root, a tile a saved
  root lists left the head because the root was filed, not because it was
  thrown away. Prune fails closed when the record cannot be read.

## Both words are hidden

`save` is a sub-word of `layout save`, `template save` and `website save`;
`use` is a sub-word of `harness use`. The command line runs every behaviour
word on a line, so both are `slashHidden`: typed at the start of a line they
run, and prose never lights them. Neither appears in autocomplete.

## Limits (v1)

- Saved roots are reached only by `use` — never browsed in place at `/name`.
- A tile adopted, pasted or moved in under a saved root's name is not refused
  (only the naming gestures are guarded).
- Another tab already open when a root is switched keeps its cached root until
  it reloads.
