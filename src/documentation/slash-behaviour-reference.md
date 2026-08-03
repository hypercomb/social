# Slash Behaviour Reference

Type `/` in the command line to access slash behaviours. These are pluggable commands registered by `SlashBehaviourProvider` instances on the `SlashBehaviourDrone`. Autocomplete shows matching commands as you type.

> For general command line behaviors (create, delete, navigate, filter), see [command-line-reference.md](command-line-reference.md).

---

## Navigation & Layout 

| Command | Aliases | Description |
|---------|---------|-------------|
| `/clear` | | Clear active filter |
| `/move` | | Toggle move mode for drag-reordering tiles |
| `/layout` | `/lo` | Save, apply, list, or remove layout templates |
| `/arrange` | | Toggle icon arrangement mode on the tile overlay |
| `/sequence [name]` | `/seq` | Open Tile arrangements, or edit a named drop/paste target sequence |

---

## Editing & Content

| Command | Aliases | Description |
|---------|---------|-------------|
| `/remove` | `/rm`, `/delete`, `/del` | Remove tiles from the current directory |
| `/keyword` | `/kw`, `/tag` | Add or remove keywords (tags) on selected tiles |
| `/format` | `/fmt`, `/fp` | Copy visual formatting from the active tile |
| `/accent` | `/ac` | Set the hover accent color by name |
| `/substrate` | `/sub` | Manage default background images for new tiles (uses current hive) |

---

## AI & Conversation

| Command | Aliases | Description |
|---------|---------|-------------|
| `/chat` | `/c`, `/ask` | Multi-turn conversation with Claude |
| `/opus` | `/o` | Send context to Claude Opus 4.6 |
| `/sonnet` | `/s` | Send context to Claude Sonnet |
| `/haiku` | `/h` | Send context to Claude Haiku |
| `/organize` | | **Insert a level.** Usually reached automatically — `/atomize` on a crowded layer routes here — but available explicitly to group a layer that is under the threshold. Mints no new meaning. Asks Claude Haiku **over the bridge** for a grouping plan for the current layer's tiles, then the hive re-homes them into the group tiles via `MoveDrone.commitMoveInto` (one marker per group, undoable). Only offers above 12 tiles; aims for 5–9 groups; anything Haiku can't place stays where it is. The responder never moves anything itself — a membership rewrite is the one op that can permanently lose a tile, so it returns a plan (`kind:'organize-plan'`) and the hive validates it against the live layer before applying. Organize holds the **whole layer**, so it is refused while any tile inside it has a pending atomize, and vice versa. |
| `/atomize` | `/expand` | **Break this up.** The one gesture — it decides which operation the page needs. On a **crowded layer** (more than 12 tiles) it routes to `/organize`, because what that page needs is a level inserted, not eighty leaves deepened; the groups then organize themselves recursively until every level is manageable, with no further input. Otherwise it goes deeper: breaks a tile into the pieces that compose it — asks Claude Haiku **over the bridge** (a `task:'atomize'` ask, no API key) and a bridge-connected session creates the parts as child tiles. The unit is a tile, applied foreach: with a selection, each selected tile; with nothing selected, each tile on the current layer that is still a leaf (tiles that already have children are skipped and reported). **One structural ask per branch:** siblings atomize concurrently, but a tile is refused while an ancestor is already being atomized or organized — that ancestor may move it out from under the responder. **Atomize does nothing to a tile that has children** — that tile has been broken down; deepening there means atomizing *its* leaves, and thinning a crowded level is `/organize`'s job. Not `/atomize-ui`, which toggles the atomizer toolbar. |
| `/expand` | | **Go wider.** The third structural verb next to `/atomize` (deeper) and `/organize` (shallower): grows the **current layer** with new sibling tiles that extend its subject. Asks Claude Haiku **over the bridge** (a `task:'expand'` ask, no API key); the ask carries what the layer already holds (`existing`), and a bridge-connected session looks at the tree — reading tile notes when names alone don't say enough — and creates at most 7 new tiles ON the layer covering the aspects the subject is still missing, never duplicating what's there. `/expand <focus>` steers the direction of interest. The unit is the layer, never a single tile — deepening one tile is `/atomize`. Refuses a crowded layer (more than 12 tiles) and points to `/organize` instead: a page that already has too much needs grouping, not growth. Zero new tiles is a valid answer when the subject is already well covered. Every tile the responder creates is stamped with the ask's `creationId`, so the batch is identifiable and undoable as one act. |

---

## History & Inspection

| Command | Aliases | Description |
|---------|---------|-------------|
| `/revise` | `/rev`, `/history` | Toggle revision mode (history clock) |
| `/debug` | `/inspect`, `/dbg` | Toggle the Pixi display-tree inspector |

---

## Voice & Input

| Command | Aliases | Description |
|---------|---------|-------------|
| `/voice` | | Toggle voice input (speech-to-text) |
| `/push-to-talk` | | Toggle push-to-talk mic button |

---

## Collaboration

| Command | Aliases | Description |
|---------|---------|-------------|
| `/meeting` | `/meet`, `/call` | Start or join a video meeting on the selected tile |
| `/repush` | | Re-push shared content to your host and report holes (never-pushed refs that 404 for recipients) |

---

## UI & Help

| Command | Aliases | Description |
|---------|---------|-------------|
| `/help` | | Open the reference — all slash commands, command-line operations, and keyboard shortcuts, searchable |
| `/docs` | `/documentation`, `/doc` | Open the documentation reader for long-form white-paper pages |
| `/atomize-ui` | `/au`, `/atomizer` | Toggle the atomizer toolbar |
| `/language` | `/lang`, `/locale` | Switch the UI language |

---

## Architecture

Slash behaviours use the provider pattern defined in `SlashBehaviourProvider`:

```typescript
interface SlashBehaviourProvider {
  readonly name: string
  readonly priority: number
  readonly behaviours: SlashBehaviour[]
  execute(behaviourName: string, args: string): Promise<void> | void
}

interface SlashBehaviour {
  readonly name: string
  readonly description: string
  readonly descriptionKey?: string
  readonly aliases?: readonly string[]
}
```

Providers register on the `SlashBehaviourDrone` via `addProvider()`. Higher `priority` providers are checked first (all built-in providers use priority 100). The drone is available at `window.ioc.get('@diamondcoreprocessor.com/SlashBehaviourDrone')`.

### Localization

Behaviours with a `descriptionKey` are automatically localized at match time via `I18nProvider.t()`. Keys follow the `slash.behaviourName` convention (e.g., `slash.help`, `slash.language`).

### Adding a new slash behaviour

1. Create a class implementing `SlashBehaviourProvider`
2. Define `behaviours` with `name`, `description`, `descriptionKey`, and optional `aliases`
3. Implement `execute(behaviourName, args)` with the command logic
4. Register with `slashBehaviourDrone.addProvider(new YourProvider())`

Community modules can register providers at load time — no changes to the shell needed.
