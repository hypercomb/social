# Inspect: drill into the code a tile needs to run

`inspect` opens a panel that starts at a tile and goes down, one press at a
time, into the running code behind it.

| Say | Opens |
|---|---|
| `inspect` | the selected tile, or the page you stand on |
| `inspect <tile>` | a tile on this page |
| `inspect /<path>/<tile>` | any tile, from the root |
| `inspect code <word>` | every line of running code that quotes a word |
| `inspect <sig> [src/path]` | a running module by signature, or one of its source files |

## How a tile leads to its code

A tile runs because code keys on something it carries. Each of these is a
word some running module quotes:

- **its name** — a behaviour keyed to one tile names it (`'solomon-maze-v1'`)
- **the kind of each decoration it wears** — `visual:website:page`
- **a behaviour bound where it stands** — the binding's kind
- **its own slots** — every layer slot except the structural ones
  (`name`, `children`, `cells`, `layers`, `decorations`)

The tile step lists each word with the lines of code that quote it. Pressing a
line opens that source file at that line.

## How code leads to the rest of the code

A section of code reaches the rest of the hive by words too:

- **effects** it emits and listens for (`tile:action`)
- **IoC keys** it asks for and registers (`@diamondcoreprocessor.com/…`)

The section step lists them beside the source. Pressing one shows every line
of running code that quotes it, marked emits, listens, registers or names, so
the reader follows a behaviour to every behaviour it talks to. The other source
files the module ships with are listed below the source.

## What it never does

It reads, and only reads. A module is read as bytes by signature through the
hive reader (`assistant/hive-tree-reader.ts`, `codeQuoting` and `moduleText`),
the same reads `/read <sig> <section>` makes, and is drawn as text — never run,
never drawn as markup. Following a word is a quoted search, so it finds what
the code says, not what it does: a word built at runtime is not followed.

The word is the participant's. A model already reads code with `/code <word>`
and `/read <sig> <section>`, so `inspect` declares no machine grammar.

Files: `assistant/inspect.queen.ts` (the word), `assistant/inspect-window.view.ts`
(the panel, loaded on first use), `assistant/tile-code.ts` (the pure word
extraction).

## What the tile holds, and the chat's code view (2026-11-16)

*jwize:* "we should be able to drill down to the files and resources" …
"and see the code for the behaviour on that tile as well" … "the code should
be in the main pane as a different view to the chat, so a different view of
the chat's target" … "and probably some view with the framework resources
that are used for the behaviour, so you can potentially author upgrades for
them as well."

### The tile step lists what the tile holds

Before the code that runs it, the tile step now lists four things, each row
pressable:

| Part | What it lists | A press opens |
|---|---|---|
| Tiles inside | the tile's children | that tile's own step |
| Files | the newest file of each name on the tile (a page in parts keeps its script and stylesheet here) | the file |
| Resources its records name | each decoration record's `…Sig` fields and what its `refs` add | the resource |
| The platform it runs on | the core, the shell, the host and the documents, as written (`code source`) | that source's files |

A file or a resource opens as what it is (`assistant/tile-holds.ts`):

- **Text**, with line numbers. JSON written on one line is indented. The
  signatures the text names are listed above it and are pressable, so a
  record leads to its page and a page to its parts.
- **A picture**, known by its first bytes, never by a name or a claimed type.
- **Bytes** that are neither: only the size.

A signature that turns out to be code opens as code. Everything is read, and
nothing is run or written.

### The chat's main pane has two views

The chat window's header has a code icon. It switches the main pane between
the conversation and the code of the tile the conversation is about. A
conversation about no tile shows the site the page manages, else the page in
hand. Changing conversation changes the code with it.

The chat window is the shell's and may not import the package, so the
contract is small and has no types in it:

- The window keeps an element `.chat-code-host` beside the conversation and
  puts `on` on it while the code is showing.
- It emits `chat:code` with `{ open, segments }` on every switch.
- The package (`assistant/chat-code.ts`) hears that in the chat's rail and
  draws the inspect view into the element with `mount(host, frame)`;
  `unmount()` hands it back. The view's own styles place it and hide the
  conversation beside it.

Inside the chat, Escape climbs one step and stops at the first: the key is
the chat's after that.

### Not built

- **Authoring.** This reads. Changing a file is still a write block in the
  chat; changing a module is the module draft path; the platform sources
  cannot be changed from the hive yet.
- **Links from an answer.** A file or signature named in a chat answer is not
  pressable yet.
- **Without the rail.** The view is heard by the chat's rail, so a window
  drawn without one does not show it.

### A file's TypeScript, on a press (2026-11-17)

jwize, 2026-11-16: "Host the package's TypeScript without installing it,
fetched only when a file is opened." 2026-11-17: "Yes, build it."

A package module is shown as shipped: compiled JavaScript under its source
paths. The TypeScript it was compiled from is hosted with the package and is
not installed (`knowledge-atoms.md`, "The package's own TypeScript"). On a
`.ts` file of a package module the section's top row carries a **TypeScript**
button when the package layer on that file's path names a source atom.

- **Whether to offer it asks no host.** The reader's `typescriptFor(module,
  section)` reads the selection that runs here and the layers it is made of,
  all held on the device (`assistant/package-typescript.ts`: the deepest
  layer on the path that carries a `typescript` slot answers; a picked layer
  without one answers nothing; there is no atom for the root). No button is
  drawn where no TypeScript can exist:
  - a file that is not `.ts`, and a file the atoms never carry: one directly
    in `src/`, a generated `index.ts`, a keys file, a spec, a declaration, an
    entry, anything under `types/`. `typescriptCarries` is the device's copy
    of the name rule the build carries files by
    (`scripts/source-filters.ts`); `source-filters.spec.ts` holds the two to
    one answer over every file in the tree;
  - a module the running selection does not name among its bees and
    dependencies. Code held from somewhere else can carry a
    `// src/<folder>/x.ts` header; it is not this package's file;
  - the platform sources (`@hypercomb/source/…`, already as written), a
    shell with no installed package, and a package published before its
    layers carried the slot.
- **Only the press asks.** `typescriptText(atom, section)` asks for that one
  atom, the whole folder's TypeScript, as `<base>/<signature>?held`
  (`assistant/hive-typescript-read.ts`). It asks only the hosts this device
  already asks for the package (`sharing/update-sources.ts` `packageHosts`):
  the hosts the participant carries and the ones the install follows; on a
  managed site door, the door's zone and the followed hosts. Each host is
  asked at the base its package pool answered on, then bare. What answers is
  used only when it hashes to the signature. A redirect is an error, so a
  listed host cannot pass the ask to a host that is not listed. The answer
  is counted as it arrives and dropped past 32 MB, whatever length the host
  declared, and one base gets sixty seconds for headers and body together.
- **A person's press keeps nothing on the device.** The text is held in
  memory, three atoms at most, so a second file of the same folder makes no
  request. It is not written to the store, to history or to any pool, and
  the request stays out of the browser's cache. A reload asks again on the
  next press.
- **No other path reaches an atom through the store.** A store read of a
  signature fetches what the device lacks and writes it there. The reader
  asks one question first, `typescriptAtom(sig)`: is this a source atom the
  running package names? Every store read in the reader passes through it
  (a tile's child pointer, a site file, a model's read), and the code view
  asks it before opening a signature as a resource; an atom is then answered
  from memory or not at all. Where no selection can be read (no install
  port, one without `selection()`, one that throws) nothing can say which
  signatures are atoms, so text whose first line is an atom's name
  (`// @hypercomb/typescript/…`) is refused instead of being handed on. In
  that one case the store has already been asked: the refusal keeps the text
  out of the answer, it cannot undo the store's own write.
- **What is drawn.** The file as written, under a line saying which host it
  was read from and that it is the published text: a change made in this hive
  (a module draft, a commit) is not in it. The button then reads **As
  shipped** and puts the compiled code back with no request. Every other step
  opens as shipped. When no host holds the atom the view says so and draws
  the compiled code; that answer is not remembered, so the next press asks
  again.
- **A model's read is a read like any other, and is not memory only.** A
  layer's JSON shows its `typescript` signature, so a model can ask
  `read <signature>`, whole or one file of it. The reader answers that from
  the same in-memory read, by file like any module, and never through
  history or the store. What it returns then belongs to that conversation,
  as any read does (`chat-window.ts`, `hypercomb-observation.ts`):
  - the text of the file goes into the request and is sent to the model's
    provider;
  - the turn keeps the read's line and the atom's signature, not the text,
    so a later message can open it again by signature;
  - when the change gate judges a step, what it was shown, the reads
    included with their text, is written to this device's store by
    signature so the judgement can be replayed (`hypercomb-jev.ts`
    `persistJevInput`, `persistJevVerify`).

  So "nothing is kept on the device" is true of a person's press, and not of
  a file a model read.

Not built: the pressed line is not carried from the compiled text to the
TypeScript; `.json` and other non-`.ts` sections have no TypeScript; a file
directly in `src/` has none; a model is not taught to look for the slot; the
code tree does not list atoms; a signature that is an atom, opened as a
resource, says where to press and reads nothing.

## The code as a tree of files (2026-11-16)

jwize, 2026-11-15: "Let's have a normal tree view with actual typescript
files." 2026-11-16: "can we please have a third icon at the top of this and
have the logical code view", then "we can read code in the main window as
well to explore the structure."

The chat's left column has a third icon beside the conversations and the
search. With it open the column is a tree, in two parts
(`assistant/code-tree.view.ts`):

- **What this chat is about.** The tile the conversation is on, the tiles
  inside it and the files each holds, the newest of each name. A tile is
  read when it is unfolded. The small button on a tile's row opens the tile
  itself: what it holds and the code that runs it.
- **The running code.** Every module the hive runs, as folders and files.
  Nothing keeps a list: a module's name is already a path
  (`@hypercomb/essentials/assistant/chat-thread`), and each `/` is a folder
  (`assistant/code-tree.ts` `moduleTree`). A lone chain of folders reads as
  one row. A platform source (`@hypercomb/source/core`) is a folder filled,
  when it is unfolded, from the source files it ships, by the header line
  each carries (`sectionTree`).

Pressing a file opens it in the chat's main pane (`chat-code.ts`
`openChatCode`): the tree finds, the pane reads. While the pane shows the
conversation the window is asked to switch by its own switch, so its state
and its button stay true. A module that ships one source file opens as that
file at once.

Typing in the column's search while the tree is open lists the modules whose
name holds every word. The reader's `codeIndex()` gives the tree every name
(`listCode` answers a question and stops at two hundred).

A package module is the compiled JavaScript of its TypeScript source, shown
under the module's name; only the platform sources carry their real `.ts`
files in the tree. A package file's TypeScript is one press away once the
file is open ("A file's TypeScript, on a press", above). Not built: nothing
can be edited from the tree.

## Editing a file on a tile (2026-11-16)

jwize, of the code view: "so you can potentially author upgrades." A file
on a tile, opened from the tile's Files list or from the code tree, has an
Edit button. It swaps the reading view for the file's own text (never the
indented copy JSON is read as), with Save and Cancel; Ctrl+S saves, Escape
leaves, Tab is two spaces.

Save writes at once through the tile's files door
(`files/tile-files.drone.ts`), the same door the chat's writes use. It is
the participant's own hand, so nothing waits in Execution, and the file it
replaces stays in the tile's history. On a managed site door the view then
shows what the page did when it ran with the saved file
(`history/frame-watch.ts`): the same report a model is handed after its own
write.

Only a file on a tile can be edited: a resource a record names, a module
and a platform source are read-only here. Editing code the hive runs is a
draft and a review, which is the chat's `write` and not this view.

## The tree follows what a tile is composed of (2026-11-16)

jwize, of the code view: "This should be an alternate view to the tile tree
then the requires attention and then code view where we can look at what the
ai has created. It follows the hierarchy of composed parts."

The first part of the tree, what the chat is about, no longer lists a tile
as its tiles and its files. It lists what the tile is composed of, and a
part that is a tile unfolds into its own parts the same way. One tile's
records make one level (`assistant/composed-parts.ts`, pure, proven with a
reader made of maps):

| Row | What is under it | A press opens |
|---|---|---|
| Page | the shell and each file the shell names, in shell order; the traits the page states; the resources the page names by signature (at most 64, then how many more) | the page |
| Card | each resource the card record names, in the record's order | the resource |
| A trait the page does not state | nothing; it unfolds when a tile fills it | the tile that fills it, or the chosen layer |
| Also here | the tiles and the files no row above already is | the tile's step, the file |

A page and a card arrive open. A row that unfolds a tile is read when its
chevron is pressed, and keeps the tile's own button beside it. A row's tail
says its size, or how it stands:

- **A part of a page in parts** is the file on the tile that holds it, so
  the pane can edit it and a save rebuilds the page. It is that file only
  while the file has the signature the shell names; otherwise the row opens
  the shell's signature, read only.
- **A shell the page no longer comes from** (the page was written whole
  since) is set aside under Also here as "older than the page", read only.
  A shell is in parts when it assembles to exactly the page, or when that
  cannot be checked because the page or a part is not on this device.
- **A trait** says filled, chosen version, several offered, the page's own,
  or empty. The answer is the trait provider's, the one the website view
  fills a page from. A trait stated inside another one that a tile's page
  fills is not a row of the page: the drawn page never asks for it. If the
  tile has that trait it is a row of the tile instead.
- **No tile unfolds under itself.** Two tiles can each fill a trait of the
  other. A row that would unfold a tile already open above it keeps the
  tile's button and has no chevron.
- **A row whose filler moved** is read again from the tile that fills it
  now, so a file is never shown on the tile that used to fill the trait.
- **Tiles and files are cut apart.** A level lists four hundred of each,
  then says how many are not listed.
- **A resource not on this device** says so. Only this device is asked:
  listing what a page names never fetches it from a host.

The view only draws and unfolds (`assistant/code-tree.view.ts`). Every
answer is asked of the service that owns it
(`assistant/composed-parts-reader.ts`): the hive tree reader, the website
view's page resolver, the trait provider, the card record, the store. A
moment after a write lands, every tile already read is composed again and
the tree repaints only if one changed. A tile's own layer signature is not
used to skip that: history is per page, so a file written on a child tile
commits the child alone.

Not built:

- **Inline blocks of a whole page.** A page that was never broken apart
  shows whole; its `<style>` and `<script>` blocks are not rows.
- **Numbered holes and group members.** They are found only by walking the
  hive (set aside 2026-11-15), so they are not parts here.
- **What a sheet names.** A stylesheet's own `url(resource:…)` names, and a
  card's `refs`, are not followed.
- **A template's shell.** A tile that wears a template's page by reference
  shows the page whole: no record leads to the template's shell.
- **A chosen version that is not a tile here.** `fill` keeps the filler's
  layer signature, not a route. The row unfolds only while a tile directly
  inside still has that head. A filler chosen from elsewhere in the hive or
  by signature, or a child changed since it was chosen, is a row that says
  "chosen version", does not unfold, and opens that layer read only. Its
  page and files are not rows: a layer is not read by its signature here.
  For the same reason a trait stated inside such a chosen one is still
  listed under the page, though the drawn page may not ask for it.
- **Editing a card.** A card's details and theme are read only here; the
  pane writes files only.
- **Caps the tree does not say.** A tile read lists sixty files and a
  record twenty-four names; past that, rows are missing without a note.
- **The cost of traits.** A trait with no version of its own searches the
  hive each time its tile is composed. It has not been measured.
