# Search Bar Operations

All operations available in the search bar. Update this file as new behaviors are added.

## Operations

| Operation | Syntax | Trigger | Type | Status |
|-----------|--------|---------|------|--------|
| **create** | `name` or `path/to/name` | `Enter` | built-in | done |
| **create-goto** | `/name` or `/path/to/name` | `Enter` | built-in | done |
| **create-sub-child** | `parent/child` | `Enter` | built-in | done |
| **navigate** | `name` | `Shift+Enter` | built-in | done |
| **shift-enter-navigate** | `path/to/folder` | `Shift+Enter` | pluggable | done |
| **filter** | `>?keyword` | type | built-in | done |
| **open-dcp** | `#` | `Enter` | built-in | done |
| **delete-cell** | `!name` or `![a,b]` | `Enter` | pluggable | done |
| **batch-create** | `[a,b]` or `path/[a,b]` | `Enter` | pluggable | done |

## Details

### create
Plain `Enter` with a name. Creates a cell at the current level. If the input contains `/`, creates the full nested path and retains the parent prefix in the bar so the user can keep adding children.

### create-goto
Prefix with `/` and press `Enter`. Creates the cell then navigates into it.

### create-sub-child
Type `parent/child` and press `Enter`. Creates the nested path. The parent prefix stays in the bar (e.g. `parent/`) so you can continue adding siblings.

### navigate
`Shift+Enter` with a single segment. Navigates into an existing cell without creating anything.

### shift-enter-navigate
`Shift+Enter` with a `/` path. Creates the full folder chain and navigates into the final segment. Pluggable behavior file: `shift-enter-navigate.behavior.ts`.

### filter
Type `>?keyword` to live-filter visible tiles. Emits `search:filter` effect.

### open-dcp
Type `#` and press `Enter` (or just `#` when the bar is empty and locked). Opens the Diamond Core Processor panel. Only fires once per page load.

### delete-cell
Prefix with `!` and press `Enter`. Supports path syntax (`!parent/child`) and batch syntax (`![foo,bar]`). Pluggable behavior file: `delete-cell.behavior.ts`.

### batch-create
Use bracket syntax and press `Enter`. Expands `[a,b]` into multiple cells. Supports mid-path brackets: `parent/[a,b]/child` creates `parent/a/child` and `parent/b/child`. Pluggable behavior file: `batch-create.behavior.ts`.

## Architecture

Behaviors implement the `SearchBarBehavior` interface from `search-bar-behavior.ts`:

```typescript
interface SearchBarBehavior extends SearchBarBehaviorMeta {
  match(event: KeyboardEvent, input: string): boolean
  execute(input: string): Promise<void> | void
}
```

Pluggable behaviors are registered in `SearchBarComponent.#behaviors` (first match wins). Built-in behaviors are hardcoded in `onKeyDown` and listed in `SearchBarComponent.builtinBehaviors` for self-documentation.

All metadata is queryable at runtime via `SearchBarComponent.behaviorReference`.
