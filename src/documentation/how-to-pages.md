# A how-to page for every word

jwize, 2026-10-25: *"every beehavior needs to have a how to page that can be
published for clarity."*

Every word the hive understands has a page that says what it does and how to
say it, and the pages are published as one site. They are **made from the
words themselves**, never written by hand, so a page cannot drift from the
word it explains.

## Making the site

Say `howto` in your hive.

```
howto               lay the site and walk into it
howto <word>        the same, then walk to that word's page
```

It lays one tile, `how`, at the root of the hive. Under it is a tile for every
word, each wearing its own page, and `how` itself wears the index (every word,
A to Z, each a link). Then publish it once, the way you publish anything:

```
publish /how on <domain>
```

`howto` refuses, and lays nothing, while you are looking at the past or a
preview is open (the hive keeps nothing written then), and while a saved root
is already named `how`. It counts the tiles that actually landed, never the
tiles it asked for, and says so when some did not.

Saying `howto` again later is safe. A tile that is already there is kept, and a
page whose bytes have not changed is not written again, so after a new build it
adds only the words that are new and refreshes only the pages that changed.

## Where a page comes from

`howto` reads the slash census (`SlashBehaviourDrone.entries()`), the same
list the palette and the help sheet read, and makes a page from what each word
declares about itself:

| On the page | Declared as |
|---|---|
| the title and the first sentence | `description` |
| *Say it* | `examples` (`input` and what happens) |
| *Forms* | `options`, each shown with the word in front |
| *When a model says it* | `machine` (forms, example, reach, scope, what it costs) — only for a word a model may say |
| a note that it is typed in full / still in the workshop | `slashHidden` / `prototype` |

`howto-page.ts` is pure: facts in, a self-contained HTML document out (inline
styles, no script, no request), with everything escaped. `howto.queen.ts` lays
the tiles and dresses them, the way `website page` does.

**Only the language the build ships.** A word that exists only because of this
machine (the model names of an agent CLI announced here) is marked `local` and
gets no page: publishing the site would otherwise tell the world what is
installed on one computer.

**Descriptions follow the hive's language.** The one-line summary is the
localized text the census returns, while the headings on a page are English. Build
the site with the hive set to English.

**Aliases never appear.** They are the participant's own to give, and a page
published for the world would leak one person's shortcuts.

## The rule: a word explains itself

A page can only be as good as what the word declares, so the rule is on the
word. Every word must declare:

- a **description** that is a sentence (at least 20 characters), and
- **something to try**: an `examples` entry (what to type, what happens), or a
  `machine` example.

`howto/howto.census.spec.ts` measures the language the way the site lists it: the
real slash drone, fed by a registry that behaves like the real one, over every
queen the build ships, the game and doctrine drones that register queens, and
the providers the drone and the assistant declare by hand. It fails the suite for
any word that declares less, naming the word and what it lacks. (A word the
shared package registers, `header`, is out of its reach, since essentials never
imports shared; its declaration is held by hand.) A word added without them does not pass, which is the
same one-to-one rule the windows keep with their tutorial lessons
(`tutorial-courses.md`).

Write an example that is true. Its `input` has to be a sentence the word's real
parser accepts today, on the route a person actually uses (a word that is typed
in full needs its leading slash). Its `result` has to say only what the code
does for it, and when that depends on state it names the state ("with host sync
on, …; with it off, it says so"). A page that tells someone to type something
that does not work, or promises an outcome it only sometimes gives, is worse
than no page.

The page numbers the examples as different things to try, so a word never lists
the same sentence twice: put a state-dependent outcome inside ONE result. The
census spec checks that too.

## Where it sits

- `hypercomb-essentials/src/howto/howto-page.ts` — facts, the missing-rule, the pages.
- `hypercomb-essentials/src/howto/howto.queen.ts` — the word.
- `hypercomb-essentials/src/howto/howto.census.spec.ts` — the ratchet over every word.
- The old hand-kept table, `slash-behaviour-reference.md`, is not the reference
  any more; the generated site is.
