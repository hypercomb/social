# Object intellisense

*A proposal. Nothing here is built except the first citizen, `/background`.*

## The problem

The command line answers one question — **what can come next here?** — and it
answers it ten different ways. There are ten parsing modes (`slash`, `tag`,
`marker`, `feature`, `select`, `filter`, `action`, `remove`, `note-capture`,
`none`), twenty-three separate suggestion sources, and 3,926 lines holding them
apart. Thirty-three behaviours implement their own `slashComplete`, each
inventing its own argument grammar out of spaces.

The cost is not the line count, it is that **a word's meaning depends on where
you are rather than on what it is**. In `/canvas indigo dots`, nothing in the
line said whether `dots` was a pattern, a palette or a flag — you had to know.
That is what made it confusing, and it is the same defect in every mode.

## The shape

Everything the command line completes is an **object**. An object has
**members**. A member may itself be an object. You walk in with dots and the
dropdown completes the segment after the last one — the way member completion
works in every editor anyone has ever used.

```
/background ember.dots.force
            ^      ^    ^
            |      |    the reach
            |      a member of the Ember group
            an object: a theme
```

Position is meaning. `dots` is a picture because of where it sits, not because
of what the parser was doing when it saw it.

### One protocol

```ts
interface CommandObject {
  /** What can come next, given the path walked so far. */
  members(path: readonly string[]): Promise<readonly Member[]>
  /** Do the thing. Absent when the object is only navigable. */
  invoke?(path: readonly string[]): Promise<string | void>
}

interface Member {
  name: string
  description?: string
  icon?: string
  /** The chip already rendered for /background — a CSS background. */
  swatch?: string
  /** No members below this one. */
  leaf?: boolean
}
```

Roots register in IoC, exactly as drones already do. The command line's job
shrinks to: read the dotted path, walk it root → member → member, render what
comes back. It stops knowing anything about themes, tags, or markers.

### The sigils stay, and stop meaning parsers

The leading character keeps being the fast way in — it just selects a **root**
instead of switching on a bespoke parser:

| Sigil | Root |
|---|---|
| `/` | behaviours |
| `#` | markers |
| `:` | tags |
| `[` | selection |
| *(none)* | cells |

Ten modes become one walk with five entry points.

## Where pools of meaning come in

Two different jobs, and conflating them is the trap.

**Membership — yes, this is what pools are for.** For anything the participant
authors, the members of an object *are* a pool's contents or the tiles carrying
a mark. `:` walks the tag pool. `#` walks the marker vocabulary. A collection's
members are the tiles marked for it. None of that needs code: an object can be
declared as *"my members are the tiles marked X"*, and painting that mark on a
new tile grows the object. The hive is the vocabulary.

**Invocation — no, a pool cannot answer this.** A pool gives you a *set*, not an
action; `sign('themes')` can tell you Ember exists but not what applying it
does. The honest split:

> **Members come from pools and marks. Invocation stays in code — but which code
> runs is resolved from the member's mark, never from a per-feature branch.**

So a member carries a mark saying what kind of thing it is, and a handler
registers for that mark. Adding a new kind of completable thing means painting a
mark and registering a handler, not editing the command line. That is the same
rule the render path already follows: *resolve from the mark, not from code.*

## Why not one big rewrite

The parser is 3,926 lines because ten grammars grew into each other; replacing
it in one pass would be a rewrite of the most-used surface in the app with no
way to tell which mode broke. The migration is incremental and each step deletes
something:

1. **The protocol** — `CommandObject`, the walk, the renderer. Additive; no mode
   changes.
2. **`/background` becomes the first citizen.** It already dot-walks with its
   own code; it drops that and implements `members()`. One behaviour proves the
   protocol carries swatches, descriptions and refusals (`force-global` vanishes
   from the list once a picture is pinned — that is a `members()` decision).
3. **One root per pass**, each deleting its mode branch and its bespoke
   suggestion computeds: tags, then markers, then features, then select.
4. **A ratchet freezes the mode list so it can only shrink** — the same
   mechanism as the existing doctrine ratchets in `doctrine.spec.ts`. A mode
   that comes back fails the suite.

The end state is a command line that knows how to walk objects and nothing else,
and thirty-three behaviours that describe their shape instead of parsing strings.

## What is already true

`/background` dot-walks today, and the dropdown already renders per-suggestion
swatches, descriptions and a detail pane. The protocol is mostly a matter of
naming what that surface already does and pointing the other nine modes at it.

## Every beehaviour walks with dots

`/background` was the first citizen of this protocol and for a while the only
one, which made the dot a feature of ONE behaviour rather than of the language.
Everything else still answered a flat string it split on spaces, so the same
question — WHAT CAN COME NEXT HERE? — was answered one way in one place and its
own way everywhere else.

A behaviour already declares what may follow it, twice over: `slashComplete`
(what it offers as you type, in context) and `options` (the forms it
documents). That IS membership, already written down. So every behaviour the
slash drone wraps gets a command object **derived from what it already says**,
and walks with dots for free:

```bash
/substrate set.photos
/theme dark
/background tiles.ember.force.global
```

The derivation lives at the one seam where behaviours register
(`commands/slash-behaviour.drone.ts`): `deriveCommandRoot()` builds the object,
`derivedMembers()` answers each depth from the behaviour's own completer first
and its documented forms second. A `<placeholder>` is never offered as a member
— it stands for something you supply, and putting the angle brackets into the
line is not a completion.

A behaviour that registered its **own** root keeps it. A hand-written object
knows things a derivation cannot — that a reach stops being a member once a
picture is pinned — and a derivation must never overwrite that.

### The dot has to survive the trip

Completion is only half of it. The dropdown can complete `substrate.set.steel`
all day; if the string handed to the behaviour still has dots in it, the
command fails on arrival. So the wrapper normalises dots back to the spaces the
behaviour's own parser expects — **but only when every segment is a word that
behaviour actually offers.**

That check is the whole safety argument. A dot is load-bearing in the arguments
people really pass — `susan.hypercomb.com`, `1.5`, `notes.md` — and a blanket
replacement would break every one of them. Segments are walked against the
object; a string with even one segment the behaviour does not offer is passed
through exactly as typed.

The derived root is registered only for behaviours the drone also wraps.
Completion and execution have to move together: a behaviour whose execution
still goes through a hand-written provider would be offered dotted paths its
own space-splitting parser cannot read.
