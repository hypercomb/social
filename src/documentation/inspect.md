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
- **Real TypeScript for the package's modules.** They are shown as shipped:
  compiled JavaScript under their source paths. The platform sources are as
  written.
- **Links from an answer.** A file or signature named in a chat answer is not
  pressable yet.
- **Without the rail.** The view is heard by the chat's rail, so a window
  drawn without one does not show it.
