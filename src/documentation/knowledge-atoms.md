# Knowledge atoms — the platform's own source, readable by a model

jwize, 2026-11-13: "The ai needs full ability to get at all the information in
the core of the architecture and then determine its needs and use the hive to
build stuff. ... If it can't understand how hypercomb works or it can't get the
relevant data like explore across domains including shared community creations
then we are not done."

## What was missing

A model in the hive reads the code the hive runs by signature: `code <words>`
lists every module and dependency the installed package names and searches
their lines, and `read <signature> <src/… path>` opens one source file. That
reached every package module and nothing beneath them:

- `hypercomb-core` is mapped to a path, not a signature, so IoC, the bee
  bases, signatures, layers, the machine door and the lesson a model is taught
  could not be opened.
- The shell (store, navigation, lineage, install, module drafts, the chat
  window) is compiled into the host.
- The codex's Build and Paint tiers are held back from the taught doctrine,
  and the documents each tier cites were not in the package at all.

## What the package carries now

Four **knowledge atoms**, built by `hypercomb-essentials/scripts/knowledge-atoms.ts`
and added to the package by `build-module.ts`:

| Alias | Holds |
|---|---|
| `@hypercomb/source/core` | every source file of `hypercomb-core/src` |
| `@hypercomb/source/runtime` | every source file of `hypercomb-runtime/src` |
| `@hypercomb/source/shim` | every source file of `hypercomb-shim/src` |
| `@hypercomb/source/documentation` | `doctrine.codex` whole, each document a tier cites, `glossary.md` |

Each is a dependency like any other, named by signature, a member of the root
layer's dependencies. Inside, every file sits **as written** (types and
comments included, which a bundle strips) under the same `// src/…` section
header a bundled module has, so the reader needed no change: the atoms are in
the manifest, `code` searches them and `read` opens them by file. The anatomy
tells the model they are there ("Where knowledge lives").

## An atom is never run

- Line 2 is the lazy marker, so the dependency loader leaves it alone, and
  nothing imports its alias.
- Its body is one block comment and `export {}`: valid JavaScript whatever the
  source inside says. Only `*/` is rewritten inside it, as `*\/`. The minified
  derivation of a package reduces it to nothing.
- The build's class index skips the atoms, or every class core declares would
  point at a comment.

## They are inputs

A change to core, the shell, the host or a cited document is a different
package: the atoms' signature is part of the build's shape and of the build
stamp (`build-determinism.ts`), so a warm cache cannot ship the old source.

## Cost, and what is next

About 3.8 MB of text, 1.1 MB compressed, installed with the package today.
That is more than the minimal-first goal wants on a subdomain (jwize: "the
ideal thing is to have the minimum amount of code on the sub domain feeding
from the protocol on the root domain"). They are already lazy, so when a site
declares what it runs, they can be left on the root domain and fetched by
signature the first time a model reads one.

Not done here: a bee's own description is still not returned with a code
listing, and the rest of `documentation/` (the documents no tier cites) is not
carried.
