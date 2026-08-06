# View library

The view library gives one tile hierarchy several human-readable forms without
creating another content model. Every view reads the same three authored
elements: 

| Hive element | Document meaning |
|---|---|
| Category tile | Section, subject, or scene |
| Pheromone/tag | Classification and presentation signal |
| Note | Authored body, question, answer, decision, evidence, or callout |

Views store only a trusted declaration on their root tile. They do not accept
HTML, JavaScript, CSS, templates, or executable embeds from participants. The
words remain ordinary notes and the renderer creates DOM with `textContent`.

## Living Brief

`/brief here` attaches the professional long-form document view to the current
category. `/brief` opens or closes it.

The brief provides a masthead, generated contents, numbered category sections,
pheromone chips, nested notes, semantic question/answer/decision callouts,
responsive reading, and print layout. Changes to the underlying children,
decorations, or notes appear on the next live reconciliation.

Decoration kind: `visual:document:living-brief`

## Evidence Atlas

`/atlas here` attaches the analytical view. `/atlas` opens or closes it.

The atlas flattens nested notes for analysis while preserving their source
category. Existing marks and pheromones classify observations into question,
answer, decision, risk, evidence, and context lanes. A note ending in `?` is
also recognized as a question. Counts at the top expose coverage and gaps; an
empty lane remains visible so missing evidence or answers are legible.

Decoration kind: `visual:document:evidence-atlas`

## Knowledge Studio

`/studio here` attaches the guided editorial view. `/studio` opens or closes it.

Each child category becomes a scene. The first note is treated as the scene's
lead and remaining notes become supporting material. A sticky scene rail
provides a curated reading path; alternating trusted compositions give the
sequence rhythm without storing layout code in participant content.

Decoration kind: `visual:document:knowledge-studio`

## Shared behaviour

All three views:

- offer the same source-reach choice:
  - **Current layer** uses the current category's direct child tiles;
  - **Hierarchy** walks every descendant depth-first, preserving layer order,
    depth, and the full source path;
- resolve participant-facing titles;
- read notes by explicit tile path;
- preserve nested note text;
- render participant values as text, never markup;
- attach and adopt with the whole hierarchy;
- support desktop and mobile;
- open in place and return to hexagons with Escape or the close control;
- respect the Beehaviors hidden-feature gate;
- expose print styles.

## Views toolwindow

Run `/views` to open the docked Views window. It follows the current category
and discovers render views from `VisualBeeRegistry`, so newly installed view
behaviours appear without another hardcoded catalogue.

The window **stays open while you look at a view**. Clicking a row shows that
view in the container beside the window; clicking the row that is already
showing puts the hexagons back. Only one view shows at a time — the view mode
is a single value, so choosing one stops the last, and flipping between two
views is two clicks with nothing to reopen in between. Every full-screen view
surface (website, tree, tutor, slides, living brief, evidence atlas, knowledge
studio, workflow) reads `--hc-inset-left` / `--hc-inset-right` — the CSS
mirror of the `viewport:inset` contract every docked toolwindow already emits —
so an open panel is beside the view, never over it. That is also why the
**pheromone window works inside a full-screen view**: the panels sit at the
shared toolwindow layer above the view surfaces, and the surface makes room.

Rows are ordered **on first, off at the bottom**, under **Active** and
**Inactive** headings, with All / Active / Inactive filters above the list.
Each row carries an ON/OFF pill (attach or remove the behaviour) and, once it
is on, a show / back-to-hexagons control. Turning one on writes its view
declaration onto the layer you are currently inside.
Choose **Current layer** for a concise view over direct children, or
**Hierarchy** for a detailed view composed from the entire descendant tree.
The choice rides the declaration as `payload.sourceScope`, so it is historical,
adoptable, and stable across reloads. Existing declarations default to Current
layer. Turning a view off removes only the declaration. Categories, pheromones,
notes, and child tiles are never removed.

Hierarchy views also expose **Choose contents** inside the rendered view. That
starts a deliberate curation phase without leaving view mode:

1. the picker starts at the view root;
2. open a branch to drill into its children;
3. include or exclude exact tiles at any depth;
4. use **Done** to commit the subset, or **Cancel** to discard the draft.

The saved `payload.includedPaths` are relative to the view root, so moving or
adopting the branch does not invalidate the selection. An absent selection
means “use the complete live hierarchy”; an explicit empty selection means the
participant deliberately included nothing. New descendants therefore appear
automatically until the first curated subset is committed, after which the
document remains intentionally bounded.

After a view is applied, return to the parent and click that tile: its applied
view opens in place instead of navigating into the ordinary child hexagons.
Closing the view leaves you on the parent where you opened it.

The first three rows are Living Brief, Evidence Atlas, and Knowledge Studio.
Other registered render views follow them. Views that need an authoring flow
instead of a simple attachment show their slash command.

Only one library view is on for a layer at a time. Turning on Living Brief,
Evidence Atlas, or Knowledge Studio turns the previous library view off
from that same layer, making comparison a simple choice in the Views window.
Unrelated behaviours such as websites, slides, and lightboxes are untouched.
Opening a view does not automatically open the Views window.

A view opened from anywhere else — a tile icon, a slash command — still reads
as **SHOWING** in this window, even where the behaviour is not attached at the
cell you are standing on. The window reports what is on the container, never
only what it wrote itself.

The implementation lives in:

- `hypercomb-essentials/src/diamondcoreprocessor.com/commands/brief.queen.ts`
- `hypercomb-essentials/src/diamondcoreprocessor.com/commands/view-library.queen.ts`
- `hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/living-brief-view.drone.ts`
- `hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/view-library.drone.ts`
- `hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/document-view-source.ts`
- `hypercomb-essentials/src/diamondcoreprocessor.com/commands/view-source-scope.ts`
- `hypercomb-essentials/src/diamondcoreprocessor.com/commands/views.queen.ts`
- `hypercomb-shared/ui/views-viewer/`
