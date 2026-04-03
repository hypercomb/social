# Command Line Reference

The command line is the primary command interface. All behaviors are pluggable via the `CommandLineBehavior` provider pattern — each behavior declares its own metadata (name, description, syntax, key, examples) so this reference can be generated from code.

> For a quick-reference table of all operations, see [command-line-operations.md](command-line-operations.md).

## Architecture

Behaviors are registered in the `#behaviors` array in `CommandLineComponent`. On each keydown, the command line iterates the array — **first match wins**. If no behavior matches, the built-in default handlers run.

**Interface**: `CommandLineBehavior` in `hypercomb-shared/ui/command-line/command-line-behavior.ts`

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

All metadata is introspectable at runtime via `CommandLineComponent.behaviorReference`.

---

## Pluggable Behaviors

### `!` Delete Cell
**File**: `delete-cell.behavior.ts`
**Key**: Enter
**Syntax**: `!name` | `!path/to/name` | `![name1,name2]`

Delete cells (folders) from the current directory. Supports path-based deletion and bracket syntax for deleting multiple cells at once.

| Input | Key | Result |
|-------|-----|--------|
| `!cellname` | Enter | Deletes cellname from current directory |
| `!parent/child` | Enter | Deletes child from parent (parent stays) |
| `![foo,bar]` | Enter | Deletes foo and bar from current directory |

---

### `[...]` Batch Create
**File**: `batch-create.behavior.ts`
**Key**: Enter
**Syntax**: `path/[name1,name2,...]` | `[name1,name2]`

Create multiple cells at once using bracket expansion. Brackets expand into all comma-separated variants. Brackets can appear at any position in the path — each variant is crossed with the rest.

| Input | Key | Result |
|-------|-----|--------|
| `abc/[123,456]` | Enter | Creates abc/123 and abc/456 |
| `[foo,bar,baz]` | Enter | Creates foo, bar, baz at current level |
| `parent/[a,b]/child` | Enter | Creates parent/a/child and parent/b/child |

---

### `/` + Shift+Enter Navigate
**File**: `shift-enter-navigate.behavior.ts`
**Key**: Shift+Enter
**Syntax**: `path/to/folder`

Create nested folders and navigate into the created path. Only triggers when the input contains `/` — without a slash, the default single-segment navigate behavior handles Shift+Enter.

| Input | Key | Result |
|-------|-----|--------|
| `hello/world` | Shift+Enter | Creates hello/world and navigates into hello/world |
| `a/b/c` | Shift+Enter | Creates a/b/c and navigates to a/b/c |

---

## Built-in Behaviors

These are hardcoded in `onKeyDown` and run after pluggable behaviors have been checked.

### Create Cell
**Key**: Enter
**Syntax**: `name` | `path/to/name`

Create a new cell at the current level. Supports nested paths with `/`.

| Input | Key | Result |
|-------|-----|--------|
| `hello` | Enter | Creates cell "hello" at current level |
| `a/b/c` | Enter | Creates nested folders a/b/c |

---

### Navigate
**Key**: Shift+Enter
**Syntax**: `name`

Navigate to an existing cell (without `/` in input).

| Input | Key | Result |
|-------|-----|--------|
| `hello` | Shift+Enter | Navigates into "hello" if it exists |

---

### Filter
**Key**: (live, on type)
**Syntax**: `>?keyword`

Live-filter visible tiles by keyword. Tiles that don't match are hidden.

| Input | Key | Result |
|-------|-----|--------|
| `>?cigar` | type | Filters tiles to those matching "cigar" |

---

### Open DCP
**Key**: Enter (or single press when locked)
**Syntax**: `#`

Open the Diamond Core Processor panel.

| Input | Key | Result |
|-------|-----|--------|
| `#` | Enter | Opens the DCP panel |

---

### `..` Go Parent
**File**: `go-parent.behavior.ts`
**Key**: Enter
**Syntax**: `..` | `../..` | `../../..`

Navigate up one or more levels. Clamps to root — never errors if you overshoot.

| Input | Key | Result |
|-------|-----|--------|
| `..` | Enter | Navigates up one level |
| `../..` | Enter | Navigates up two levels |

---

### `#` Hash Marker
**File**: `hash-marker.behavior.ts`
**Key**: Enter
**Syntax**: `cell#DroneName` | `cell#`

Bind a drone marker to a cell. The drone name is stored in the cell's zero-signature properties file under `markers: string[]`. Typing `cell#` (trailing hash, no name) lists available drones.

| Input | Key | Result |
|-------|-----|--------|
| `cigars#CigarJournal` | Enter | Binds CigarJournal marker to cigars cell |
| `photos#` | Enter | Lists available drones for binding |

---

### `[items]/path` Cut-Paste
**File**: `cut-paste.behavior.ts`
**Key**: Enter
**Syntax**: `[items]/destination` | `[items]/destination/`

Copy cells from the current directory to a destination path. Bracket-expanded items are copied into the destination. Trailing `/` navigates to the destination after pasting.

| Input | Key | Result |
|-------|-----|--------|
| `[cigars,whiskey]/interests` | Enter | Copies cigars and whiskey into interests/ |
| `[photos]/archive/` | Enter | Copies photos into archive/ and navigates there |

---

### `/command` Slash Commands (Queen Bees)

Queen bees register `/command` handlers. Type `/paste`, `/help`, etc. to invoke them directly — bypasses the processor pulse cycle.

---

## Behavior Priority Order

The `#behaviors` array determines match priority for pluggable behaviors:

1. **GoParentBehavior** — `..` parent navigation (fastest escape hatch)
2. **SlashBehaviourBehavior** — `/behaviour` queen bee dispatch
3. **RemoveCellBehavior** — `~` prefix (removes from visible hierarchy)
4. **CutPasteBehavior** — `[items]/path` bracket-path copy
5. **HashMarkerBehavior** — `cell#Drone` binding
6. **BatchCreateBehavior** — `[...]` bracket expansion
7. **ShiftEnterNavigateBehavior** — `/` with Shift+Enter

Built-in behaviors run after all pluggable behaviors have been checked.

---

## Adding New Behaviors

1. Create a new file: `your-behavior.behavior.ts`
2. Implement the `CommandLineBehavior` interface with all metadata fields
3. Import and add to the `#behaviors` array in `CommandLineComponent`
4. Position determines priority — more specific behaviors should come first
