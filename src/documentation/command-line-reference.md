# Command Line Reference

The command line is the primary interface for creating, navigating, and manipulating cells. Behaviours are pluggable via the `CommandLineBehavior` provider pattern — each declares its own metadata (name, description, syntax, key, examples) so this reference is generated from code.

For slash commands (`/help`, `/docs`, `/chat`, etc.), see [slash-behaviour-reference.md](slash-behaviour-reference.md).

---

## Quick reference

| Operation | Syntax | Trigger | Type |
|:---|:---|:---:|:---:|
| [create](#create) | `name` or `path/to/name` | Enter | built-in |
| [create-goto](#create-goto) | `/name` or `/path/to/name` | Enter | built-in |
| [create-sub-child](#create-sub-child) | `parent/child` | Enter | built-in |
| [navigate](#navigate) | `name` or `path/to/folder` | Shift+Enter | pluggable |
| [filter](#filter) | `>?keyword` | type | built-in |
| [open-dcp](#open-dcp) | `#` | Enter | built-in |
| [go-parent](#go-parent) | `..` or `../..` | Enter | pluggable |
| [delete-cell](#delete-cell) | `~name` or `~[a,b]` | Enter | pluggable |
| [bracket-select](#bracket-select) | `[a,b]` | Enter | built-in |
| [bracket-item-ops](#bracket-item-ops) | `[+new, ~old, keep]` | Enter | built-in |
| [select-op](#select-op) | `[a,b]/cut` etc. | Enter | built-in |
| [cut-paste](#cut-paste) | `[items]/destination` | Enter | pluggable |
| [hash-marker](#hash-marker) | `cell#Drone` | Enter | pluggable |
| [slash-behaviour](#slash-behaviour) | `/behaviour args` | Enter | pluggable |

---

## Operations

### create

**Trigger** — Enter · **Type** — built-in

Plain Enter with a name. Creates a cell at the current level. If the input contains `/`, creates the full nested path and retains the parent prefix in the bar so you can keep adding children.

```
eggs           → creates "eggs" at current level
meals/dinner   → creates "meals/dinner", bar retains "meals/"
```

---

### create-goto

**Trigger** — Enter · **Type** — built-in

Prefix with `/` and press Enter. Creates the cell, then navigates into it.

```
/recipes       → creates "recipes" and navigates inside
/meals/dinner  → creates nested path, navigates to "dinner"
```

---

### create-sub-child

**Trigger** — Enter · **Type** — built-in

Type `parent/child` and press Enter. Creates the nested path. The parent prefix stays in the bar so you can continue adding siblings under the same parent.

```
fruits/apple   → creates path, bar retains "fruits/"
fruits/banana  → next entry creates a sibling
```

---

### navigate

**Trigger** — Shift+Enter · **Type** — pluggable · **File** — `shift-enter-navigate.behavior.ts`

Shift+Enter with a name or `/` path. Navigates only — never creates. If the
path doesn't exist, nothing happens.

```
recipes        → navigates into "recipes" (must already exist)
meals/dinner   → navigates to meals/dinner (must already exist)
```

---

### filter

**Trigger** — type · **Type** — built-in

Type `>?keyword` to live-filter visible tiles. Emits the `search:filter` effect. Results update as you type.

```
>?bread        → filters tiles matching "bread"
```

---

### open-dcp

**Trigger** — Enter · **Type** — built-in

Type `#` and press Enter (or just `#` when the bar is empty and locked). Opens the Diamond Core Processor panel. Fires only once per page load.

```
#              → opens DCP panel
```

---

### go-parent

**Trigger** — Enter · **Type** — pluggable · **File** — `go-parent.behavior.ts`

Type `..` to go up one level, `../..` to go up two levels. Clamps to root — never errors on overshoot.

```
..             → navigates up one level
../..          → navigates up two levels
../../..       → navigates up three levels
```

---

### delete-cell

**Trigger** — Enter · **Type** — pluggable · **File** — `remove-cell.behavior.ts`

Prefix with `~` and press Enter. Supports path syntax and batch syntax. Removes from the visible hierarchy; data persists in OPFS.

```
~recipes       → deletes "recipes"
~meals/dinner  → deletes nested cell
~[foo,bar]     → deletes "foo" and "bar"
```

---

### bracket-select

**Trigger** — Enter · **Type** — built-in (`BracketBehavior` + select dispatcher)

Bare bracket syntax SELECTS tiles in the current layer (it no longer batch-creates —
see [bracket-item-ops](#bracket-item-ops) for creation). The selection is echoed in
the bar and in the URL as a path-tail bracket so it survives sharing/refresh.

```
[a,b]          → selects "a" and "b"
```

---

### bracket-item-ops

**Trigger** — Enter · **Type** — built-in

Per-item operators inside a bracket: `+name` creates, `~name` removes, bare
items select. Mix freely in one bracket.

```
[+t1,+t2,+t3]      → creates t1, t2, t3
[+new, ~old, keep] → creates "new", removes "old", selects "keep"
```

---

### select-op

**Trigger** — Enter · **Type** — built-in

A known operation after the bracket executes it on the selection. Known ops:
`cut`, `copy`, `move(N)`/`move[swapTile]`, `remove`/`rm`/`delete`/`del`,
`keyword`/`kw`/`tag`, `format`/`fmt`/`fp`, `opus`/`o`, `sonnet`/`s`,
`haiku`/`h`; `:tag` tags the selection. Anything else after `/` is a
cut-paste destination (below).

```
[a,b]/cut       → cuts a and b to the clipboard
[a,b]/remove    → removes a and b
[a,b]:urgent    → tags a and b with "urgent"
[a]/move(3)     → moves a to index 3
```

---

### cut-paste

**Trigger** — Enter · **Type** — pluggable · **File** — `cut-paste.behavior.ts`

Bracket-path syntax with a destination that is NOT a known select op: copy
items from the current directory to that destination. Trailing `/` navigates
to the destination after pasting.

```
[cigars,whiskey]/interests   → copies cigars and whiskey into interests/
[photos]/archive/            → copies photos into archive/ and navigates there
```

---

### hash-marker

**Trigger** — Enter · **Type** — pluggable · **File** — `hash-marker.behavior.ts`

Bind a drone marker to a cell via `#`. Markers are stored in the cell's zero-signature properties file under `markers: string[]`. Typing `cell#` (trailing hash, no name) lists available drones.

```
cigars#CigarJournal   → binds CigarJournal marker to cigars
photos#               → lists available drones
```

---

### slash-behaviour

**Trigger** — Enter · **Type** — pluggable · **File** — `slash-behaviour.behavior.ts`

Invoke slash commands registered by `SlashBehaviourProvider` instances. Bypasses the processor pulse cycle. See [slash-behaviour-reference.md](slash-behaviour-reference.md) for the full catalogue.

```
/help                 → show keyboard shortcuts
/language ja          → switch UI to Japanese
/docs                 → browse project documentation
```

---

## Architecture

Behaviours implement the `CommandLineBehavior` interface from `command-line-behavior.ts`:

```typescript
interface CommandLineBehavior {
  readonly name: string
  readonly description: string
  readonly syntax: string
  readonly key: string                              // trigger key(s)
  readonly examples: readonly CommandLineBehaviorExample[]
  match(event: KeyboardEvent, input: string): boolean
  execute(input: string): Promise<void> | void
}
```

Pluggable behaviours are registered in `CommandLineComponent.#behaviors` and evaluated first-match-wins. Built-in behaviours are hardcoded in `onKeyDown` and listed in `CommandLineComponent.builtinBehaviors` for self-documentation. All metadata is introspectable at runtime via `CommandLineComponent.behaviorReference`.

### Resolution order

On plain Enter, the component first routes bracket selects/ops (`[a,b]`,
`[a,b]/knownOp`, `:tag`) and known `/slash` behaviours; an UNKNOWN `/name`
falls back to create-goto (create + navigate). Then pluggable behaviours are
checked in this order; first match wins. Built-ins (create) run only if no
pluggable matches. Shift+Enter runs the same pluggable list with the real
event so Shift-gated behaviours can match.

1. **GoParentBehavior** — `..` parent navigation (fastest escape hatch)
2. **SlashBehaviourBehavior** — `/behaviour` slash dispatch
3. **RemoveCellBehavior** — `~` prefix
4. **CutPasteBehavior** — `[items]/path` bracket-path copy (non-select-op destinations)
5. **HashMarkerBehavior** — `cell#Drone` binding
6. **PasteUrlNavigateBehavior** — pasted URL navigation
7. **BracketBehavior** — bare `[...]` selection
8. **ShiftEnterNavigateBehavior** — navigate-only with Shift+Enter

---

## Adding a new behaviour

1. Create `your-behavior.behavior.ts` implementing `CommandLineBehavior` with all metadata fields.
2. Import and add it to the `#behaviors` array in `CommandLineComponent`.
3. Position determines priority — more specific behaviours should come first.
4. Behaviour metadata automatically surfaces in this reference and in runtime introspection.
