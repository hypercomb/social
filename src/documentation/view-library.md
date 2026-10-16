# View library

**Retired 2026-10-16 (jwize): the three document views this page introduced**
— Living Brief (`/brief`), Evidence Atlas (`/atlas`) and Knowledge Studio
(`/studio`) — together with their contents picker. Each word now answers that
its view is retired. A tile that wore one keeps its mark
(`visual:document:living-brief`, `visual:document:evidence-atlas`,
`visual:document:knowledge-studio`) and every category, pheromone and note it
read; nothing renders the mark any more, and the Views window no longer lists
it. Their modes stay as tombstones in `view-mode.service.ts`, so a browser that
saved one cannot boot into a blank canvas.

What remains on this page is the Views window.

## Views toolwindow

Run `/views` to open the docked Views window. It follows the current category
and discovers render views from `VisualBeeRegistry`, so newly installed view
behaviours appear without another hardcoded catalogue.

The window **stays open while you look at a view**. Clicking a row shows that
view in the container beside the window; clicking the row that is already
showing puts the hexagons back. Only one view shows at a time — the view mode
is a single value, so choosing one stops the last, and flipping between two
views is two clicks with nothing to reopen in between. Every full-screen view
surface (website, tree, tutor, slides, workflow) reads `--hc-inset-left` /
`--hc-inset-right` — the CSS mirror of the `viewport:inset` contract every
docked toolwindow already emits — so an open panel is beside the view, never
over it. That is also why the **pheromone window works inside a full-screen
view**: the panels sit at the shared toolwindow layer above the view surfaces,
and the surface makes room.

Rows are ordered **on first, off at the bottom**, under **Active** and
**Inactive** headings, with All / Active / Inactive filters above the list.
Each row carries an ON/OFF pill (attach or remove the behaviour) and, once it
is on, a show / back-to-hexagons control. Turning one on writes its view
declaration onto the layer you are currently inside. Turning a view off
removes only the declaration. Categories, pheromones, notes, and child tiles
are never removed.

A view that declares both reaches (`sourceScopes: ['layer', 'hierarchy']`)
offers **Current layer** or **Hierarchy** on its row; the choice rides the
declaration as `payload.sourceScope`, so it is historical, adoptable, and
stable across reloads. No view declares both today — the three retired views
were the ones that did.

After a view is applied, return to the parent and click that tile: a view that
opens on tile click opens in place instead of navigating into the ordinary
child hexagons. Closing the view leaves you on the parent where you opened it.
Views that need an authoring flow instead of a simple attachment show their
slash command. Opening a view does not automatically open the Views window.

A view opened from anywhere else — a tile icon, a slash command — still reads
as **SHOWING** in this window, even where the behaviour is not attached at the
cell you are standing on. The window reports what is on the container, never
only what it wrote itself.

The implementation lives in:

- `hypercomb-essentials/src/commands/view-source-scope.ts`
- `hypercomb-essentials/src/commands/views.queen.ts`
- `hypercomb-shared/ui/views-viewer/`
