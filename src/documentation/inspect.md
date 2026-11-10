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
