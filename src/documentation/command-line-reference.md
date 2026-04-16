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
| [navigate](#navigate) | `name` | Shift+Enter | built-in |
| [shift-enter-navigate](#shift-enter-navigate) | `path/to/folder` | Shift+Enter | pluggable |
| [filter](#filter) | `>?keyword` | type | built-in |
| [open-dcp](#open-dcp) | `#` | Enter | built-in |
| [go-parent](#go-parent) | `..` or `../..` | Enter | pluggable |
| [delete-cell](#delete-cell) | `~name` or `~[a,b]` | Enter | pluggable |
| [batch-create](#batch-create) | `[a,b]` or `path/[a,b]` | Enter | pluggable |
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

**Trigger** — Shift+Enter · **Type** — built-in

Shift+Enter with a single segment. Navigates into an existing cell without creating anything.

```
recipes        → navigates into "recipes" (must already exist)
```

---

### shift-enter-navigate

**Trigger** — Shift+Enter · **Type** — pluggable · **File** — `shift-enter-navigate.behavior.ts`

Shift+Enter with a `/` path. Creates the full folder chain and navigates into the final segment.

```
meals/dinner   → creates chain if needed, navigates to "dinner"
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

### batch-create

**Trigger** — Enter · **Type** — pluggable · **File** — `batch-create.behavior.ts`

Use bracket syntax and press Enter. Expands `[a,b]` into multiple cells. Supports mid-path brackets for combinatorial creation.

```
[a,b]          → creates "a" and "b"
path/[a,b]     → creates "path/a" and "path/b"
p/[a,b]/child  → creates "p/a/child" and "p/b/child"
```

---

### cut-paste

**Trigger** — Enter · **Type** — pluggable · **File** — `cut-paste.behavior.ts`

Bracket-path syntax: copy items from the current directory to a destination. Trailing `/` navigates to the destination after pasting.

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

Pluggable behaviours are checked in this order; first match wins. Built-ins run only if no pluggable matches.

1. **GoParentBehavior** — `..` parent navigation (fastest escape hatch)
2. **SlashBehaviourBehavior** — `/behaviour` slash dispatch
3. **RemoveCellBehavior** — `~` prefix
4. **CutPasteBehavior** — `[items]/path` bracket-path copy
5. **HashMarkerBehavior** — `cell#Drone` binding
6. **BatchCreateBehavior** — `[...]` bracket expansion
7. **ShiftEnterNavigateBehavior** — `/` with Shift+Enter

---

## Adding a new behaviour

1. Create `your-behavior.behavior.ts` implementing `CommandLineBehavior` with all metadata fields.
2. Import and add it to the `#behaviors` array in `CommandLineComponent`.
3. Position determines priority — more specific behaviours should come first.
4. Behaviour metadata automatically surfaces in this reference and in runtime introspection.
