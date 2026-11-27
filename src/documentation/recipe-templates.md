# Recipes: a desk, templates you leave in a pool, and entries your nodes offer

**Status, 2026-11-26.** Every section says **built**, **built, not run against a real host**, or **design**.
Built means it has specs and was driven in the dev shell. Nothing here has been run against a deployed
host: the dev shell names no home domain, so publishing and reading across hosts are proven by specs with
injected hosts only.

This is the first feature built directly on `pools-as-relational-database.md` (codex `T9`). The model there
is the reason for the shape here: a template is a schema, a recipe tile someone offers is a row, a domain or
a classmate is where rows come from, and nobody's host runs a query.

jwize, 2026-11-24: *"We need a nice recipe behavioral view ... the ingredients, the process and the story
and the experience for a nice read along ... they can leave behind templates in pools of meaning."*

## Three artifacts (built, `recipe/recipe-template.ts`)

Each is one JSON document with one signature (I1), complete alone (A1), read by a strict reader that refuses
what the format does not say and never strips (the rule of `mail/template.ts`). Nothing in any of them is
markup: every string reaches a page through `textContent`, a picture is a signature, a link is http or https
with no credentials.

| Artifact | Bytes | What it is |
|---|---|---|
| **template** `{ "recipe:template": 1, name, description?, sections }` | at most 64 KB | the layout: which sections a recipe has, in what order, what each is called and asks. The `layout` relation of N4 |
| **recipe** `{ "recipe": 1, template?, values }` | at most 512 KB | the fill. Every value says its own kind, so a recipe reads without its template |
| **entry** `{ "recipe:entry": 1, name, recipe, cover? }` | at most 2 KB | a recipe tile as a row someone offers: its name and the recipe it holds, by signature |

Section kinds: `text`, `ingredients`, `steps`, `pictures`, `links`, `facts`.

**Switching templates never loses anything.** `projectRecipe(template, recipe)` shows the template's sections
in its order, each with the recipe's value of the same key and kind, then every value the template has no
section for under "Also in this recipe". Keys are a convention the way a pool's meaning is: the three
templates every hive starts with (`recipe/recipe-defaults.ts`: Family recipe, Weeknight, Tasting journey)
share `story`, `facts`, `ingredients`, `steps`, `pictures` and `links` on purpose.

## A recipe on a tile (built, `recipe/recipe-store.ts`)

The tile's layer holds a `recipe` slot. The committer wraps what it is handed in a meta envelope
`{ meta: 1, resource: <recipe>, relation: 'recipe' }` and the slot holds the envelope's signature (L2), so the
slot's signature is a reference and never the recipe's own. `store.getResource` follows that one hop.
Every save is a new layer (H2): a recipe has history and undo like anything else on a tile. The first save
also puts the decoration `visual:recipe:card` on the tile, which is what lights the view's icon there.

Pictures are re-encoded before they are kept, so what a camera wrote into a file does not travel with a
recipe that may be offered.

## The desk (built, `recipe/recipe-page.ts`, `recipe-desk.ts`, `recipe-style.ts`)

The word is `recipe`: with one tile selected it opens that tile, otherwise the place you stand in.

The desk is modelled on the tile editor (`tile-editor.md`): a drawing of one thing with its parts labelled
around it, never a stacked form.

- **The plate** is in the middle. With no picture it is a drawn Japanese-style square plate that invites one;
  with a picture, the recipe's cover is shown on a white card. A picture dropped or pasted on the stage
  becomes the cover.
- **Every section is a tab** beside the plate, a label and a summary of what it holds, joined to the plate by
  a thin leader.
- **The ingredients are drawn as themselves**: one label each, with its own leader pointing into the dish.
  Past nine, the last label counts the rest.
- **Clicking a tab, or any ingredient, opens that one part as a card down the middle**, over the dimmed
  drawing: the ingredient list, the steps, a writing area. One card at a time. Done, Escape or a press on
  the stage returns to the drawing.
- **The tiles on the page are listed on the left**, to move between recipes without leaving the desk.
- **Arrange** makes the layout itself editable: rename a part, move it, remove it (what was written moves
  under "Also in this recipe"), add one. The result is a template of its own, held with the recipe; "Keep as
  a template" puts it on the hive's list.
- **Read along** is the other mode: one page at a time, the cover, each text, the ingredients as a checklist
  whose ticks are never saved, each step on its own page.

A pasted list of ingredients becomes rows, with a leading quantity split off. Pasted steps become steps with
their numbering removed. Links are never embedded and nothing is fetched to show one.

A picture that does not arrive, or has no address here, is drawn as the picture mark and the words it is
read by, never as a blank card. A recipe that does not read opens in the read-along only, saying that it
could not be opened and why, in place of the recipe; nothing is saved over it. While a card is open on the
wide desk, everything behind it is inert, and closing it puts focus back on its tab. Closing the template
picker puts focus back on the template button.

Under about 56em wide the same desk rearranges as the tile editor does: the plate stays at the top, the tabs
become rows that open in place, the list becomes a drawer.

## Templates a hive keeps (built, `recipe/recipe-pool.ts`)

The pool `recipe:template` holds one current document, `{ "meaning": "recipe:template", "members": [sig] }`,
at most 64 members, written through the store's document writer as `mail/template-pool.ts` does. Listing
reads only this device. Taking a template off the list is hiding it (H4): its bytes stay and every recipe
that names it still reads.

The picker groups templates as **Built in**, **Yours**, then one group per domain switched on in the shelf.
Choosing a domain's template is the press that keeps it (T4), by its publisher's own bytes: another spelling
would be another signature.

The three built-in templates are shown in the participant's language, and only where they are shown
(`recipeDefaultTemplateShown`, `recipe/recipe-defaults.ts`). A template is a built-in when its bytes are a
built-in's, so its signature is one; its words come from `recipe.default.<template>.name|description`,
`recipe.default.<template>.<section>.label|prompt` and `.fields.<field>`. The bytes recipes name never change.
A template that borrows a built-in's keys but says anything else is shown in its author's words.

## Table sets (built, `recipe/recipe-setting.ts`, `recipe/recipe-setting-pool.ts`)

A table set is a photographed table the desk can sit on in place of the drawn plate. It is one document,
`{ "recipe:setting": 1, name, size, table, utensils?, plates }`, read as strictly as a template: the bare
table, each plate alone on transparency, and the utensils over everything are layer pictures named by
signature, each the full picture's size. A plate also says where its flat floor lands in the picture (four
corners, read into reading order so a card laid on it is upright) and its centre. Plates are only the
surface: no food is drawn on them, and a dish will be an artifact of its own.

- **The Table control** sits beside the template button. Its list holds the sets this hive keeps, each with
  its own remove press, then what the domains it follows offer, then "Add a table set" and "The drawn
  plate". The set in use is pressed. Opening the list asks the followed domains; only the set documents are
  fetched, and nothing is kept until one is chosen (T4).
- **The pool `recipe:setting`** holds the kept sets as one list document, at most 64 members, as the template
  pool does. Removing a set hides it (H4). Which set the desk sits on is one current document in
  `recipe:desk`. Choosing a domain's set first fetches each of its layers from the host that offered it,
  checks every one against its signature, and only then keeps and lays it. Publishing a lit hive leaves its
  kept sets in the pool with every layer travelling with them.
- **Add a table set** takes a render folder (`tableware/setting.py` writes `setting.json` and the layer
  pictures it names). Every named picture must be there, be a PNG or a WebP, and be within one layer's size.
  Everything is checked before anything is written, so a refusal leaves nothing behind.
- **On the desk** the set stands where the plate was, at its own aspect. The sections sit on its plates in
  order, each seated plate wearing a place card with the section's label and what it holds, and each tab's
  leader runs to its plate. Pressing a plate opens its card.
- **When the pictures do not arrive**, the drawn plate stands in, the status line says so, and the Table
  control is marked and says why. Choosing the same set again tries its pictures once more, and so does
  opening the desk on another recipe.

A set's refusals are coded (`recipe.setting.refusal.<code>`) and said in the participant's language.

## Pools mode (built, `pools/`)

The stage between private and the swarm, made plain. The lock in the header enters it.

- The canvas changes, every tile dims, and a bar says what this is.
- **A tap turns a tile on or off.** A lit tile is in full colour and wears a bulb. Shift and a tap, or a long
  press, lights the whole branch. Lit is the existing public mark (`presentation/tiles/tile-public.ts`):
  one state, not a second one.
- **Close** goes back. The second press of the globe goes back too: it no longer opens the swarm selector,
  which is now the bar's "Join the swarm".
- **Publish** leaves what the lit tiles carry in your pools at your own root domain. It is not staging: no
  site is placed on a subdomain. Nothing is published by entering the mode or by lighting a tile.
- The word is `pools`; `pools off` leaves, `pools publish` publishes.

What a lit tile leaves is declared by whoever owns that kind of tile (`pools/pool-contributions.ts`). A lit
recipe tile leaves two rows: its template in `recipe:template` and its entry in `recipe:entry`, with every
atom the entry names.

## Leaving a pool at your root domain (built, not run against a real host, `pools/offered-pool.ts`)

No change to the host. The publisher uploads the atoms and stamps one key in their own signed index:
`pool:<meaning>` naming a list document `{ meaning, members }`. With no lit member the key is cleared and
nothing is sent: bytes already on a host stay valid (H4).

A reader finds the publisher keys of a host it follows from that host's publication ledger, reads each key's
signed index, takes the list, and fetches each member, checking every hash. A listing is never the proof: a
member is trusted by its own bytes (M1, M2). An offer is only held; it is kept by a press (T4, T5).

**Known limit.** Keys come only from the ledger row for the zone itself, plus the reader's own key on their
own host. A participant who publishes to a shared zone without being one of its listed publishers is found
by nobody else.

## One host, many participants (built, not run against a real host, `pools/room-entries.ts`)

The classroom: one leader's host, everyone else with no host of their own.

- **Joining** is what already existed: `/invite` copies the room's link, `/invite qr` draws it as a large code
  for a room of people to point their phones at (`sharing/room-qr.view.ts`), and the room selector has "show
  code". Opening the link shows one sheet, "Join the room".
- **A lit recipe in a room is an entry.** After a save on a lit tile while joined, the entry and what it
  names go to the room's host, and a small signed member (kind 30567) is put at an address derived from the
  meaning and the room. The address carries the room's secret, so it is never registered and never logged.
- **The member is signed by the participant's own key**, and carries the name they go by in the room, so a
  node has a name after its maker has left.
- **Taking it back** writes a newer member that says so. The host deletes nothing (M3).
- **The desk says where a recipe is**: "Only you", "On: left in your pools when you publish", "Shared with
  {room} at {host}", or that the host keeps entries only for its own people and the recipe is shared live.

**The constraint that decides whether entries stay.** A host run from a machine with `--allow-participants`
admits whoever is live in the room, so the classroom works with no further step. A Cloudflare host keeps
bytes only for its own people: there a participant's entry is shared live and is gone when they leave,
unless the operator admits their key. This feature does not change who a host admits.

## Nodes (built, `pools/pool-node.ts`, `pools/domain-shelf.element.ts`)

A node is where entries come from: a domain you follow, or a participant in the room you joined. To a reader
the two are one thing.

The shelf's second strip carries them as chips: a square plate for a domain, a round one for a participant,
showing initials. Hovering or focusing a chip says the whole name: `jwize.com`, or the participant's full
name, or a short form of their key when they gave none. A click switches a node off and on. Domains switched
off are remembered (`pools:sources`); participants are switched for the session only, because nothing about
a room is written to the store.

## The catalogue (built, not run on a published door, `recipe/recipe-catalogue*.ts`)

One page that answers "what is here?", listing entries grouped by node. The word is `catalogue`, and the
desk's "Browse" opens it.

- **In a hive** it lists what the nodes switched on in the shelf offer. Opening a row shows the recipe to
  read along. "Bring it to my hive" is the press that keeps it: the recipe, its template and its pictures
  are stored by their own signatures and a tile is made for it.
- **On a published door** it lists what its publisher has left in the pool on that host, and it is the
  face a visitor lands on when the place has no view and no tiles of its own. Publishing is enough: there
  is no menu entry to add and no community entry to switch on. A place that has tiles keeps them as its
  face, and the word still opens the catalogue there.

It never lists what a server merely holds. Only what a publisher chose to publish appears, to a reader
that already knows the kind (`pools-across-hosts.md`, "Not this").

**Known limit.** The published list is per publisher and per host, not per address: a publisher's rows
show on every door of theirs on that host. Listing only what was published at one address needs the
address in what is signed, which is not built.

## Known limits

Found by review and left, each because the right fix is outside this change. Say them before someone
relies on the opposite.

- **A room's read can be starved by its host's growth.** One read takes at most 256 members it has not seen,
  and remembers at most 4,096 per address. A participant can no longer crowd others out by stamping members
  in the future or by writing many pages (the cut is taken a signer at a time, and a stamp ahead of the
  room's clock counts as now), but a pool that grows past those numbers needs the host to cap members per
  key. That is a host change.
- **A take-back needs the tab to be in the room.** A recipe is taken back when its tile is unlit while the
  tab is joined, on the desk or from the grid, before or after a reload. A tile unlit after the tab left the
  room, or in another tab, keeps its entry on the room's host until it is unlit again while joined.
- **Publish holds when a lit tile cannot be read.** A lit tile whose layer is not here yet is never taken for
  "nothing to offer": the publish is refused with the tile's name and what the host holds is left as it is.
- **The strict readers' refusals are coded.** A template, recipe, entry or table set that does not read is
  refused with a code and what fills its holes (`recipe.template.refusal.<code>`,
  `recipe.setting.refusal.<code>`), said in the participant's language when the catalogue holds the key and
  in English when it does not, inside a translated sentence.
- **On a package from before pools mode** the globe's second press still opens the swarm selector, because
  that package has no bar to offer the way on. Its tooltip there says "click to go back".

## What is not built

- **Posting from the leader's domain.** A participant who only scans the code and lands on the host's page
  cannot yet leave an entry there. That needs a host rule like the one event sign-ups have: a pool the
  leader opened takes small signed members from anyone, with no grant. It decides who may write to a
  server, so it is its own change.
- **Covers in the catalogue list** show as initials until a row has been opened.
- **A published door** shows recipes only once a revision that contains the recipe view has been published
  to that host, because a door runs the package its host signed.
- **The other catalogues.** Every word is in `en.json`, and `ja.json` is complete. The other catalogues are
  being translated in this change; until a word reaches one it falls back to English. Two reworded header
  tooltips (`controls.stage-private`, `controls.stage-world`) still carry their old meaning
  in them.
