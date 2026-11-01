# The ComfyUI desk

**Status: built 2026-11-01. The desk opens, generates and places on the dev shell against a stand-in ComfyUI. Not yet run against a real ComfyUI, and not yet on the web shell (needs `build:essentials`).**

jwize, 2026-11-01: "the comfy interface is very DRY I think we need a full screen interface and we just create assets that we can put on the screen later instead of this silly sidebar … model it how it looks compared to the editor … we should be following the hypercomb doctrine … we are breaking things apart, each time we do there are more extension points for others."

## What it is

`comfy` (or the control-bar button) opens a full-screen desk in the tile editor's shape: slim header, a list on the left, a labelled drawing in the middle. The drawing is the picture being made. The list is everything that has been made.

- **The drawing.** One picture, in its own shape, as large as the room between the label columns allows. With nothing chosen it is the frame of the picture to come, at the size the knobs say, with the words in hand read inside it (the placeholder when there are none). The width is marked under it with the editor's own dimension bracket. Labels stand either side, joined to the picture by leaders: prompt, and not, library, workflow, size, machine, and put on a tile when a picture is on the stage. Hover or focus a label and its region of the picture lights, faintly; the size label lights the frame's edge. A label opens its card. Clicking the region on the picture opens the same card. An open card takes the gutter it finds and never moves the picture.
- **Generate** is the header's one filled control, and Ctrl+Enter from any words does the same. It makes assets and lands nowhere. A selected tile is never painted by the desk.
- **The shelf** is a contact sheet: two faces across, newest first, the name under each, a find box above, and *new picture* as the first cell. A face shows that picture on the stage. Double-click the picture, or its corner button, to see it up close. In the narrow arrangement the sheet is one strip of faces across the top that scrolls sideways.
- **Putting it on the screen, later.** With a picture on the stage, *put on a tile* offers the tiles selected in the hive, *choose a tile* (the list turns into the hive's tile list, on any level, until a row is chosen), or a typed name for a new tile. *use this recipe* puts what made the picture back into the form.

- **The size mark.** Hold the `width × height` under the picture and it becomes a field. Enter, or leaving it, keeps a valid `640x480` (any of `x`, `×`, `X`); anything else puts the old value back.

### Suggest: the prompt grows a piece at a time

jwize, 2026-11-01: "present a story with options … the tile view opens up inside where the editor is and you can hover and read the ideas and each time you choose the agents work with jev to create direction until the prompt is complete … tokenize the chunks so you can delete items from the always visible chat text while you are selecting from tiles … click the tile which brings up the quick menu … shuffle … adding description and visual objectives in the quick menu for each potential path."

Type words, then **Suggest** (the header, or the prompt card). Where the picture stood, a comb opens: the prompt so far at the centre and six directions it could take around it, each a tile. The directions are speculative on the prompt as it is now, and nothing else.

- **The pieces.** The typed words are split at their clauses and stand above the comb as pieces, each with a ×. The strip stays while the ideas are chosen; taking a piece out changes the prompt and asks for new ideas. The prompt the form holds is always the pieces joined.
- **Reading.** Rest on an idea and its sentence reads under the comb.
- **The quick menu.** Click an idea and it flies to the centre with the hive's six seats around it: *go this way* (east), *add a description* (south-east), *new ideas* (south-west, shuffle), *back* (west), *read it* (north-west), *add visual objectives* (north-east). Each of the three unfolding seats asks the agents for the next piece in that direction: reviewers (the prompt card's count) each write one, Jev picks when switched on, else the first reviewer's words. The piece is added, and new ideas are asked for on the longer prompt. This goes on until the prompt is complete; Generate is still the participant's own press.
- **No agent.** When no model answers, the ideas are common picture words (`rollDirections` in `comfy/comfy-roll.ts`), the comb says so under itself, and *go this way* adds the idea's words as they are.

Escape unwinds one level: up close, then choosing a tile, then the quick menu, then the ideas, then an open card, then the desk. In a field, Escape leaves the field.

The hive is covered while the desk is open, so nothing drags from the desk onto the hive. That gesture went with the sidebar.

## An asset is a signature

There is no asset store. A run already writes each picture as a resource and a member of `comfy:generations` named by the picture's signature. The shelf reads that pool, and a row holds the signature.

**A placement never stores the picture again.** `storeImageResources` re-encodes, so running it over a stored picture would mint a second picture of the same thing. `ComfyService.placeOn` and `placeNamed` read the large picture at its signature and derive only the two small pictures, which reach the signatures they already had. N tiles wearing one asset hold N references to one record (`feedback_share_resources_never_copy`).

Bytes still cross one way. A picture kept from ComfyUI's output folder enters the store once and is then an asset like any other, under the 24 MB cap. Looking through the folder copies nothing.

Hiding is the only way off the shelf: a row goes into the one `hidden:items` pool (scope `comfy-asset`, not deletable), and *put away* at the foot of the list brings it back (`hide-first-delete-second.md`).

## The parts

The desk is one behaviour and sixteen parts (`atomic-modules-plan.md`). Every piece that used to be a section of the sidebar was broken out into a folder holding one trait word's own version, and each break is an extension point: anything registered at `@diamondcoreprocessor.com/ComfyDesk/<word>` replaces that part and the rest never move.

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
| `chunks` | `chunks/` | The prompt in pieces: how words split, and the strip they stand in. |
| `ideas` | `ideas/` | The directions as tiles, and the quick menu round one. |
| `direction` | `direction/` | Who writes the ideas and the next piece: the agents and Jev, or the common words. |

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
