# Command Line Operations Reference

> Comprehensive guide to every operation available in the Hypercomb command line.
> Update this document as new behaviors are added.

---

## Quick Reference

| Operation | Syntax | Trigger | Type | Status |
|:---|:---|:---:|:---:|:---:|
| [create](#create) | `name` or `path/to/name` | Enter | built-in | done |
| [create-goto](#create-goto) | `/name` or `/path/to/name` | Enter | built-in | done |
| [create-sub-child](#create-sub-child) | `parent/child` | Enter | built-in | done |
| [navigate](#navigate) | `name` | Shift+Enter | built-in | done |
| [shift-enter-navigate](#shift-enter-navigate) | `path/to/folder` | Shift+Enter | pluggable | done |
| [filter](#filter) | `>?keyword` | type | built-in | done |
| [open-dcp](#open-dcp) | `#` | Enter | built-in | done |
| [go-parent](#go-parent) | `..` or `../..` | Enter | pluggable | done |
| [delete-cell](#delete-cell) | `!name` or `![a,b]` | Enter | pluggable | done |
| [batch-create](#batch-create) | `[a,b]` or `path/[a,b]` | Enter | pluggable | done |
| [cut-paste](#cut-paste) | `[items]/destination` | Enter | pluggable | done |
| [hash-marker](#hash-marker) | `cell#Drone` | Enter | pluggable | done |
| [slash-behaviour](#slash-behaviour) | `/behaviour args` | Enter | pluggable | done (21 behaviours) |

---

## Operations

### create

**Trigger** &mdash; Enter &ensp;|&ensp; **Type** &mdash; built-in

Plain Enter with a name. Creates a cell at the current level.
If the input contains `/`, creates the full nested path and retains the parent prefix in the bar so the user can keep adding children.

```
eggs           → creates "eggs" at current level
meals/dinner   → creates "meals/dinner", bar retains "meals/"
```

---

### create-goto

**Trigger** &mdash; Enter &ensp;|&ensp; **Type** &mdash; built-in

Prefix with `/` and press Enter. Creates the cell, then navigates into it.

```
/recipes       → creates "recipes" and navigates inside
/meals/dinner  → creates nested path, navigates to "dinner"
```

---

### create-sub-child

**Trigger** &mdash; Enter &ensp;|&ensp; **Type** &mdash; built-in

Type `parent/child` and press Enter. Creates the nested path. The parent prefix stays in the bar (e.g. `parent/`) so you can continue adding siblings under the same parent.

```
fruits/apple   → creates path, bar retains "fruits/"
fruits/banana  → next entry creates a sibling
```

---

### navigate

**Trigger** &mdash; Shift+Enter &ensp;|&ensp; **Type** &mdash; built-in

Shift+Enter with a single segment. Navigates into an existing cell without creating anything.

```
recipes        → navigates into "recipes" (must already exist)
```

---

### shift-enter-navigate

**Trigger** &mdash; Shift+Enter &ensp;|&ensp; **Type** &mdash; pluggable

Shift+Enter with a `/` path. Creates the full folder chain and navigates into the final segment.

```
meals/dinner   → creates chain if needed, navigates to "dinner"
```

Behavior file &mdash; `shift-enter-navigate.behavior.ts`

---

### filter

**Trigger** &mdash; type &ensp;|&ensp; **Type** &mdash; built-in

Type `>?keyword` to live-filter visible tiles. Emits `search:filter` effect. Results update as you type.

```
>?bread        → filters tiles matching "bread"
```

---

### open-dcp

**Trigger** &mdash; Enter &ensp;|&ensp; **Type** &mdash; built-in

Type `#` and press Enter (or just `#` when the bar is empty and locked). Opens the Diamond Core Processor panel. Fires only once per page load.

```
#              → opens DCP panel
```

---

### go-parent

**Trigger** &mdash; Enter &ensp;|&ensp; **Type** &mdash; pluggable

Type `..` to go up one level, `../..` to go up two levels, etc. Clamps to root — never errors if you overshoot.

```
..             → navigates up one level
../..          → navigates up two levels
../../..       → navigates up three levels
```

Behavior file &mdash; `go-parent.behavior.ts`

---

### delete-cell

**Trigger** &mdash; Enter &ensp;|&ensp; **Type** &mdash; pluggable

Prefix with `!` and press Enter. Supports path syntax and batch syntax.

```
!recipes       → deletes "recipes"
!meals/dinner  → deletes nested cell
![foo,bar]     → deletes "foo" and "bar"
```

Behavior file &mdash; `delete-cell.behavior.ts`

---

### batch-create

**Trigger** &mdash; Enter &ensp;|&ensp; **Type** &mdash; pluggable

Use bracket syntax and press Enter. Expands `[a,b]` into multiple cells. Supports mid-path brackets for combinatorial creation.

```
[a,b]          → creates "a" and "b"
path/[a,b]     → creates "path/a" and "path/b"
p/[a,b]/child  → creates "p/a/child" and "p/b/child"
```

Behavior file &mdash; `batch-create.behavior.ts`

---

### cut-paste

**Trigger** &mdash; Enter &ensp;|&ensp; **Type** &mdash; pluggable

Bracket-path syntax: copy items from current directory to a destination. Trailing `/` navigates to the destination after pasting.

```
[cigars,whiskey]/interests   → copies cigars and whiskey into interests/
[photos]/archive/            → copies photos into archive/ and navigates there
```

Behavior file &mdash; `cut-paste.behavior.ts`

---

### hash-marker

**Trigger** &mdash; Enter &ensp;|&ensp; **Type** &mdash; pluggable

Bind a drone marker to a cell via `#`. Markers are stored in the cell's zero-signature properties file.

```
cigars#CigarJournal   → binds CigarJournal marker to cigars
photos#               → lists available drones
```

Behavior file &mdash; `hash-marker.behavior.ts`

---

### slash-behaviour

**Trigger** &mdash; Enter &ensp;|&ensp; **Type** &mdash; pluggable

Invoke queen bees directly. Bypasses the processor pulse cycle. Slash behaviours are localized — descriptions update when the UI language changes.

```
/help                 → lists all available queen behaviours
/language ja          → switch UI to Japanese
/docs                 → browse project documentation
```

Behavior file &mdash; `slash-behaviour.behavior.ts`

---

## Slash Behaviour Registry

All slash behaviours are registered as `SlashBehaviourProvider` instances on `SlashBehaviourDrone`. Behaviours support `descriptionKey` for i18n — when a translation exists, the autocomplete dropdown shows the localized description.

| Behaviour | Aliases | Description |
|:----------|:--------|:------------|
| `/help` | `?` | Show keyboard shortcuts |
| `/clear` | | Clear active filter |
| `/keyword` | `kw`, `tag` | Add or remove keywords (tags) on selected tiles |
| `/meeting` | `meet`, `call` | Start or join a video meeting on the selected tile |
| `/debug` | `inspect`, `dbg` | Toggle the Pixi display-tree inspector |
| `/remove` | `rm`, `delete`, `del` | Remove tiles from the current directory |
| `/format` | `fmt`, `fp` | Copy visual formatting from the active tile |
| `/layout` | `lo` | Save, apply, list, or remove layout templates |
| `/accent` | `ac` | Set the hover accent color by name |
| `/move` | | Toggle move mode for drag-reordering tiles |
| `/revise` | `rev`, `history` | Toggle revision mode (history clock) |
| `/expand` | `atomize` | Expand selected tiles into constituent parts via Claude Haiku |
| `/chat` | `c`, `ask` | Multi-turn conversation with Claude |
| `/opus` | `o` | Send context to Claude Opus 4.6 |
| `/sonnet` | `s` | Send context to Claude Sonnet |
| `/haiku` | `h` | Send context to Claude Haiku |
| `/language` | `lang`, `locale` | Switch the UI language |
| `/arrange` | | Toggle icon arrangement mode on the tile overlay |
| `/voice` | | Toggle voice input (speech-to-text) |
| `/push-to-talk` | | Toggle push-to-talk mic button |
| `/instructions` | `instruct`, `labels` | Toggle instruction overlay |
| `/atomize-ui` | `au`, `atomizer` | Toggle the atomizer toolbar |
| `/docs` | `documentation`, `doc` | Browse project documentation |

**Built-in behaviours** (hardcoded in `CommandLineComponent`, not in `SlashBehaviourDrone`):

| Behaviour | Description |
|:----------|:------------|
| `/select` | Select tiles for cut/copy/move |
| `/remove` (builtin) | Remove selected tiles |

---

## Architecture

Behaviors implement the `CommandLineBehavior` interface from `command-line-behavior.ts`:

```typescript
interface CommandLineBehavior extends CommandLineBehaviorMeta {
  match(event: KeyboardEvent, input: string): boolean
  execute(input: string): Promise<void> | void
}
```

**Resolution order** &mdash; Pluggable behaviors are registered in `CommandLineComponent.#behaviors` and evaluated first-match-wins. Built-in behaviors are hardcoded in `onKeyDown` and listed in `CommandLineComponent.builtinBehaviors` for self-documentation.

**Runtime introspection** &mdash; All metadata is queryable via `CommandLineComponent.behaviorReference`.
