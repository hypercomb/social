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

---

## Editing & Content

| Command | Aliases | Description |
|---------|---------|-------------|
| `/remove` | `/rm`, `/delete`, `/del` | Remove tiles from the current directory |
| `/rename` | `/mv` | Rename the selected tile |
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
| `/expand` | `/atomize` | Expand selected tiles into constituent parts via Claude Haiku |

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

---

## UI & Help

| Command | Aliases | Description |
|---------|---------|-------------|
| `/help` | | Open the reference — all slash commands, command-line operations, and keyboard shortcuts, searchable |
| `/docs` | `/documentation`, `/doc` | Open the documentation reader for long-form white-paper pages |
| `/instructions` | `/instruct`, `/labels` | Toggle instruction overlay |
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
