# The ComfyUI desk

**Status: built 2026-11-01. The desk opens, generates and places on the dev shell against a stand-in ComfyUI. Not yet run against a real ComfyUI, and not yet on the web shell (needs `build:essentials`).**

jwize, 2026-11-01: "the comfy interface is very DRY I think we need a full screen interface and we just create assets that we can put on the screen later instead of this silly sidebar … model it how it looks compared to the editor … we should be following the hypercomb doctrine … we are breaking things apart, each time we do there are more extension points for others."

## What it is

`comfy` (or the control-bar button) opens a full-screen desk in the tile editor's shape: slim header, a list on the left, a labelled drawing in the middle. The drawing is the picture being made. The list is everything that has been made.

- **The drawing.** One picture, in the frame it was asked for. With nothing chosen it is the empty frame of the picture to come, at the size the knobs say. Labels stand either side, joined to the picture by leaders: prompt, and not, library, workflow, size and steps, machine, and put on a tile when a picture is on the stage. Hover or focus a label and the part lights. A label opens its card. Clicking the part on the picture opens the same card.
- **Generate** is the header's one filled control, and Ctrl+Enter from any words does the same. It makes assets and lands nowhere. A selected tile is never painted by the desk.
- **The shelf.** Newest first, with a find box. A row shows that picture on the stage. Double-click the picture, or its corner button, to see it up close.
- **Putting it on the screen, later.** With a picture on the stage, *put on a tile* offers the tiles selected in the hive, *choose a tile* (the list turns into the hive's tile list, on any level, until a row is chosen), or a typed name for a new tile. *use this recipe* puts what made the picture back into the form.

Escape unwinds one level: up close, then choosing a tile, then an open card, then the desk. In a field, Escape leaves the field.

The hive is covered while the desk is open, so nothing drags from the desk onto the hive. That gesture went with the sidebar.

## An asset is a signature

There is no asset store. A run already writes each picture as a resource and a member of `comfy:generations` named by the picture's signature. The shelf reads that pool, and a row holds the signature.

**A placement never stores the picture again.** `storeImageResources` re-encodes, so running it over a stored picture would mint a second picture of the same thing. `ComfyService.placeOn` and `placeNamed` read the large picture at its signature and derive only the two small pictures, which reach the signatures they already had. N tiles wearing one asset hold N references to one record (`feedback_share_resources_never_copy`).

Bytes still cross one way. A picture kept from ComfyUI's output folder enters the store once and is then an asset like any other, under the 24 MB cap. Looking through the folder copies nothing.

Hiding is the only way off the shelf: a row goes into the one `hidden:items` pool (scope `comfy-asset`, not deletable), and *put away* at the foot of the list brings it back (`hide-first-delete-second.md`).

## The parts

The desk is one behaviour and thirteen parts (`atomic-modules-plan.md`). Every piece that used to be a section of the sidebar was broken out into a folder holding one trait word's own version, and each break is an extension point: anything registered at `@diamondcoreprocessor.com/ComfyDesk/<word>` replaces that part and the rest never move.

| Trait | Folder | What a filler replaces |
|---|---|---|
| `form` | `form/` | The words and knobs in hand, and how they continue per model. |
| `assets` | `assets/` | Where made pictures are read from. A filler can read a followed host. |
| `recipe` | `recipe/` | Which labelled parts stand on the drawing, and where. |
| `frame` | `frame/` | The drawing in the middle. |
| `callouts` | `callouts/` | The labels, cards and leaders. |
| `shelf` | `shelf/` | The list on the left. |
| `prompt` | `prompt/` | The prompt card. |
| `negative` | `negative/` | The card for what the picture should not be. |
| `knobs` | `knobs/` | Size, steps, cfg, how many, seed. |
| `workflow` | `workflow/` | The recipes, pasting one in, and the models they load. |
| `machine` | `machine/` | The host and ComfyUI's folder. |
| `library` | `library/` | Kept prompts. |
| `place` | `place/` | How a picture goes on the screen. |

`comfy-desk.drone.ts` is the bee. It contributes the surface and brings the view with the first open. `desk/` pieces the parts together. The run, the host and the `comfy:render` payload stay with `comfy/comfy.drone.ts`, so the desk is one reading of them.

The same three rules as `keyboard-desk.md`:

1. **A part never imports another part.** `parts.ts` is the only file every part may read. Only `desk/` imports the parts.
2. **A part never registers.** It exports, and the bee wires.
3. **The own version stays.** With nothing at its key, a part's own version runs.

A desk reuses the editor's work instead of restating it: the tabs, cards, leaders and lit layer are `editor/diagram/diagram.styles.ts`, the placement pass is `editor/diagram/placement.ts`, the lighting is `editor/diagram/lit-state.ts`. When the editor's look moves, this desk moves with it. Only the box and the shelf are this desk's own material.

## Surface contract

Full screen is the desk contract: `view:keeps-controls`, then `view:active`, owner `comfy-desk`; `keymap:suppress` for the whole session; `InputGate` locked; `BackGesture` registered. Window id `comfy-desk`, launcher control `comfy`.

The drone holds the open state. A park emits `comfy:close`, an unpark `comfy:reopen`, and both are idempotent there, so `comfy` never toggles a desk the screen has already lost.

## Still open

- **Translations.** The desk's new words are in `en.json` only and fall back to English.
- **Assets from other hosts.** `comfy:generations` is personal truth, so the shelf shows this hive's pictures. The `assets` trait is where a followed host's pictures would come in.
- **Text sized for the desk.** The card widths are the editor's plus room for a sentence, not measured against 140% text.
