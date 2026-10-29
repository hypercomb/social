# ComfyUI — the behavior

`/comfy` makes a picture on the participant's own machine and puts it on a
tile. ComfyUI does the generating; Hypercomb holds the workflow, chooses the
tile, and keeps the record of what made the bytes.

Nothing about the integration copies a model, a LoRA or an output folder. One
picture crosses at a time, and only when a participant keeps it.

---

## The four pieces

| File | What it is |
|---|---|
| `essentials/comfy/comfy-workflow.ts` | The `comfy-workflow@1` spec and the **seam inference**. Pure — no network, no DOM, no store. |
| `essentials/comfy/comfy-workflows.ts` | The `comfy:workflows` pool: sweep, import, the built-in, which one is active. |
| `essentials/comfy/comfy-host.ts` | The machine. Endpoint, reachability, `/prompt`, `/history`, `/view`, `/upload`, the progress socket. |
| `essentials/comfy/comfy-folder.ts` | The **live folder** — ComfyUI's own directory, opened once from Windows Explorer. |
| `essentials/comfy/comfy.service.ts` | The run: apply → queue → wait → read back → store → attach → record. |
| `essentials/comfy/comfy.queen.ts` | `/comfy`, and the command object behind its dropdown. |
| `essentials/comfy/comfy-prompts.ts` | The `comfy:prompts` pool: one kept state per member. |
| `essentials/comfy/comfy-draft.ts` | The `comfy:drafts` pool: the form last left on each model and LoRA set. |
| `essentials/comfy/comfy.drone.ts` | The surface's data side: one `comfy:render` payload out, intents in. |
| `shared/ui/comfy-panel/` | The docked tool window. Angular, registry-fed, `hcDockedPanel`. |

---

## A workflow is content; its seams are inferred

ComfyUI's API format is a node graph. It says everything about how a picture
is made and nothing about which of its numbers a person would want to change.

So a graph is parsed into a **spec**: the graph plus **seams** — the handful
of `(node, input)` addresses that carry the prompt, the negative, the seed,
the size, the checkpoint.

The seams are read off the graph's own shape:

- the two prompts by **following the sampler's `positive` / `negative`
  links**, not by matching class names. Node order is insertion order in the
  editor, so "the first `CLIPTextEncode`" is the negative in most real
  workflows. The walk is breadth-first and survives `ConditioningCombine`,
  `ConditioningSetArea` and anything else in between;
- the size and batch from whatever made the latent the sampler was given;
- the seed from the sampler, under `seed` or `noise_seed`;
- the output from `SaveImage`, then `PreviewImage`, then the node nothing
  links to.

One encoder wired into both slots yields **no negative seam** — offering that
field would let a participant overwrite their own prompt with "blurry".

A spec may **declare** seams; declaration beats inference, and inference fills
only what was left out. A workflow with no seams at all still runs — exactly
as its author saved it.

Practical result: paste what ComfyUI's **Save (API Format)** wrote and it
works, with no mapping UI and no per-workflow code. An editor save (`{nodes,
links}`) is refused **by name**, because that shape is not what `/prompt`
accepts.

### The pool

`comfy:workflows` — colon-scoped per `known-location-pools.md`, sig-named
members, address derived via `Store.poolSignature`. Swept at boot; the sweep
**waits for the Store itself** rather than parking on `whenReady`, because
`window.ioc` is replaced after the early barrel modules register.

It also claims the meaning with `registerPublishedPool`, so a domain that
publishes an index at `sign('comfy:workflows')` offers its workflows to every
participant who learns that host — each member verified against its own
signature by the probe. A workflow can carry a recipe; it has nowhere to put
a host, a key, or code.

---

## The host is device-local, and never travels

ComfyUI is `127.0.0.1:8188` on one machine and `192.168.1.40:8818` on
another. The address is a fact about a device, so it lives in `localStorage`
(`hc:comfy:endpoint`) beside the LLM keys, for the same reason. `/comfy host
discover` tries 8188 and 8818 on both spellings of localhost — 8818 because
that is the port this project has pointed at since the first Angular build.

Two failures are told apart and named rather than reported as "unreachable":

**CORS.** ComfyUI sends no `Access-Control-Allow-Origin` unless started with
`--enable-cors-header "*"`. Without it every browser request fails at the
fetch, with no status and no body — indistinguishable from a dead server. The
window says the flag.

```bash
python main.py --enable-cors-header "*"
```

**Mixed content.** An https page may reach `http://localhost` and
`http://127.0.0.1` (potentially trustworthy per spec) but **not**
`http://192.168.x.x`. A LAN box needs a tunnel, a certificate, or the hive
opened over http. Checked before a request is even attempted.

---

## The live folder — and why nothing large is ever copied

A ComfyUI install is tens of gigabytes and an output folder that grows
forever. **None of it may enter the hive.** Everything in a hive is
content-addressed and everything travels — into a publish, into an adopter's
tree, into a deploy — so a copied model folder would be large *forever and in
every direction*.

So the connection is **live**. The participant points Hypercomb at their
ComfyUI folder once, in the ordinary Windows picker (`showDirectoryPicker`,
the same door `/folder-sync` and the substrate use); the browser keeps the
handle in IndexedDB; from then on pictures are **read where they lie**.
Browsing the output folder costs one object URL per thumbnail. The files stay
on disk, owned by ComfyUI, deleted by ComfyUI, mirrored nowhere.

**Exactly one picture ever crosses**: the one kept. That one is copied through
`storeImageResources` — the same door a dropped image takes — because it must
travel with the tile. And even that is capped:

```
MAX_IMPORT_BYTES = 24 MB      // comfy-folder.ts
```

Far above any sane generation (a 2048² PNG is ~6 MB), far below the size at
which one picture starts to dominate a publish. Over it, the picture stays in
the folder it is already in and the window says so.

The folder is also the **faster** door: reading a finished picture off disk
needs no CORS header, no `/view` round trip and no second copy in ComfyUI's
memory. A participant who has linked the folder can generate even with a
server started without the CORS flag — the queue still needs HTTP, the
pictures no longer do.

### What the deploy carries

Nothing from ComfyUI. The behavior is seven source files bundled into the
essentials package; the built-in workflow is a ~40-line graph. No model, no
checkpoint list, no output, no sample image ships. The only bytes ComfyUI
contributes to a hive are tile faces a participant deliberately kept, each one
under the cap and indistinguishable from an image they dropped in by hand.

---

## The run

```
apply params at the seams → POST /prompt → wait → read /history
  → read the file (disk first, HTTP second) → size gate
  → storeImageResources → cell:attach-resource → record
```

**The socket is never the truth.** Progress comes over the WebSocket because
a progress bar should move; the *result* is read from `/history`, always. A
dropped socket costs a progress bar, never a picture.

**The checkpoint is resolved against the host.** A workflow saved elsewhere
names a model this machine may not have, and ComfyUI answers that with a
validation refusal rather than a substitution. If the named checkpoint is not
in `/object_info`, the first one that is gets used — and the record written
afterwards says which model actually ran.

**Attaching is the ordinary path.** Nothing here knows how a picture becomes a
tile's face; it emits `cell:attach-resource`, and `editor/resource-attach.drone`
does the rest. Undo, publish, substrate rules and the thumbnail pool already
work, because there is no second kind of picture to teach them about.

---

## What made a picture

`comfy:generations` holds one record **per image signature**, the member named
by that sig — so the lookup is "here are some bytes, what made them", with no
index and no scan.

```json
{ "kind": "comfy-generation@1", "workflow": "text-to-image",
  "positive": "a paper lantern in fog", "seed": 81920371,
  "steps": 20, "cfg": 8, "width": 512, "height": 512,
  "model": "sd15.safetensors", "at": 1756600000000 }
```

The same JSON is stored as a resource. When the picture lands on a tile, that
revision's properties name it (`generation`). The name on the record is the
one the participant typed for the tile. History shows that name. Opening the
row still shows the prompt. Opening it shows the seed, the size, the steps, the
cfg, the model and the workflow. Use loads those knobs into the Comfy window.
Generate stays a separate press. Seeking the row restores the picture.

The pool stays the lookup by image signature: reroll, a result that never
landed, and a picture attached before the revision carried the name. A Life
incidence on the picture unwraps to the raw image signature the pool file is
named by. The ComfyUI address is deliberately absent: a record that travels
must not name a host the reader does not have.

This is what makes `/comfy reroll` possible from a tile alone — read the
record off the picture the tile is wearing, run it again with a new seed.
"Nearly, but not that face" is the gesture people actually make.

---

## The command

```
/comfy                          open the window
/comfy a lantern in fog         make that, as its own tile
/comfy host                     where ComfyUI is, and whether it answers
/comfy host discover            try the usual addresses
/comfy host 127.0.0.1:8188      point somewhere else
/comfy folder                   link ComfyUI's folder (opens the window)
/comfy workflow                 the workflows this hive holds
/comfy workflow portrait        work with that one
/comfy models                   the checkpoints the host actually has
/comfy reroll                   this tile's picture again, new seed
/comfy cancel                   stop the run
```

**The argument is a sentence**, and that is the design. Every other command
object walks members with dots because its arguments are choices from a set. A
prompt is prose. So the words are read as a prompt *unless* the first one is a
verb this behaviour owns, and the rest of the line is then handed to that verb
**whole** — which is why `/comfy host 127.0.0.1:8188` works where a
dot-splitting walk would have made four segments of the address.

The dropdown still teaches the verbs: they are the members at depth 0.

---

## The window

`/comfy` opens a **right-docked tool window** — the same shell every other
docked panel takes, not a floating card:

- registry-fed (`registerShellSurface`, order 157, one line in
  `shell-surfaces.barrel.ts`) — never a tag in `app.html`;
- `hcDockedPanel` + `hcDockInset="right"`, so it takes a dock lane, resizes by
  drag, persists its width, reports its inset to the controls bar, and answers
  `--hc-panel-scale` with its body text;
- `@include tw.panel($accent, right)` and `@include tw.header`, so its title
  bar is the shared 46px band and lines up with Backgrounds, Publish and
  Hosts. Measured: top/right/bottom/header identical to the Backgrounds
  window, only the width differs (it is per-panel and drag-persisted);
- `signalSession`, so the one-window-at-a-time rule parks and restores it.

**The session announces in both directions.** The drone holds the open state
(`/comfy` toggles it), so a park that only set `visible` would leave the two
disagreeing — panel gone, drone still believing it is up, and the next
`/comfy` toggling it *closed*. The gesture would do nothing, twice. Park emits
`comfy:close`, unpark emits `comfy:reopen`, and both are idempotent on the
drone's side — neither is a toggle.

**No colour is named in the SCSS** beyond the panel's authored accent.
Everything asks for a role — the ink ladder for weight, `--acc` for identity —
so the panel reads on honey and sherbet as well as on dark. The two exceptions
earn it and go through `tw.ink()`: the green host dot (it *means* answering)
and the amber caution.

Four stacked sections, in the order a person needs them:

1. **Host** — status dot, address, `find`. The named failure sits under it.
2. **ComfyUI folder** — link / change / browse, and the sentence that says
   nothing is copied until you keep something.
3. **Workflow** — picker plus a paste box for `Save (API Format)` JSON.
4. **The form** — **one control per seam**. A workflow with no negative prompt
   shows no negative field; a participant is never given a knob that turns
   nothing.

Then Generate, a progress bar, and the results strip. With tiles selected,
Generate makes one picture for each of them and puts it on that tile. A tile
leaves the selection when its picture lands. Tiles still waiting stay
selected. With nothing selected, each picture waits for a name. The name field under
the picture is the prompt. Enter puts that picture on the hive under the
name they typed. A blank name makes nothing. Click a picture and it opens
large in the middle of the screen. Escape closes that picture and leaves the
window open.
`/comfy <prompt>` does the same.

**From the tile.** A switch under the prompt, and a reviewer count from 1 to
8. When it is on and tiles are selected, each tile's picture and its
properties are read first. That many reviewers each write a prompt that keeps
the participant's own words. Jev picks one. When Jev is not switched on, the
first reviewer's prompt is the one that runs, and the participant's words
still stay in it. When Jev declines, the participant's own words run as
written. Nothing selected keeps the ordinary prompt: there is no tile to
read. The switch lasts for the visit. Reroll does not ask the reviewers
again.

**A new prompt.** Two buttons under the prompt fill the box and do not start
a picture. New from tile writes a prompt from the selected tile's name and
properties, plus a random light, manner, and ground. Nothing selected says
to select a tile and leaves the words as they are. Common words writes a
prompt from common picture words and does not need a tile. Each press is a
new roll.

**Continuing.** The words and the knobs stay with the model and the LoRAs
that were loaded. Moving to another model, or another set of LoRAs, puts
this form aside and brings back the one last used there. The first visit
uses that workflow's own defaults. Klein tile and Klein background share
one continuation: they load the same model and no LoRA. The two SDXL rich
workflows share, because they load the same checkpoint and the same LoRAs.
SDXL icon is its own, because its LoRA is different. That record lives in
`comfy:drafts`, one current copy per combination. Keep is still the library.

**The prompt library.** Library and Keep are in the window whenever it is
open. Keep writes the words and the knobs — workflow, size, steps, cfg, seed,
negative, and whether the tile is helping — into `comfy:prompts`. One state
is one member, named by its own bytes, so keeping the same state again does
not add a second row. The list shows only the words. A row opens the rest.
Use puts that state back into the form, including its workflow, and does not
start a picture. Generate is still the participant's own press.

Under the workflow, the window lists every model and LoRA these recipes use.
The selected workflow's files are marked active, and that mark moves as soon
as the workflow changes. The next Generate times each loader: the row shows
how many seconds ComfyUI spent loading it, or cached when it did not reload.

**Icons.** SDXL icon is its own workflow for a square interface mark. It
loads SDXL base and Icons Redmond at strength 0.8, and it samples a 1024
square in 24 steps. The words `icredm, icons, app icon` stay on their own
text node and combine with the subject, so a new prompt keeps the trigger.
A visit starts on Klein tile when those files are present.

**The form is local to the panel.** A textarea whose value round-trips through
the bus on every keystroke fights the typist and loses the caret. What crosses
is the *seed* — what the active workflow's seams currently hold, plus which
knobs exist at all. The panel uses that seed the first time a model and its
LoRAs are on screen, and after that it continues from the form it kept for
them. The whole set goes back once, with `comfy:generate`.

---

## Verifying

```bash
npx vitest run hypercomb-essentials/src/comfy/comfy-workflow.spec.ts
```

25 tests, all pure: seam inference (including the reversed-encoder case that
defeats class-name matching), the conditioning-chain walk, the shared-encoder
refusal, `applyParams` not mutating the spec, endpoint normalising, the
mixed-content rule, and the import cap.

Against a real server, start ComfyUI with `--enable-cors-header "*"`, then
`/comfy host discover` → `/comfy a paper lantern in fog` with a tile selected.
