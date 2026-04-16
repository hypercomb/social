# Authoring a Slash Command

This guide walks through adding a new `/command` to the slash registry. Slash commands are provider-based — any drone can register one at load time, and the command automatically surfaces in autocomplete, the help system, and the localization pipeline.

For the full catalogue of existing commands, see [slash-behaviour-reference.md](slash-behaviour-reference.md). For the command-line architecture, see [command-line-reference.md](command-line-reference.md).

---

## The provider pattern

Every slash command is declared by a `SlashBehaviourProvider` registered on `SlashBehaviourDrone`.

```ts
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

- **name** — the command name, without the leading slash (e.g. `'greet'` produces `/greet`).
- **description** — fallback English description shown in autocomplete.
- **descriptionKey** — i18n key (e.g. `slash.greet`). If set, descriptions are resolved via `I18nProvider.t()` at match time and update live when the locale changes.
- **aliases** — optional alternative names. `/g`, `/hello` could both route to `greet`.

---

## Minimal implementation

```ts
import type { SlashBehaviour, SlashBehaviourProvider } from '@hypercomb/core'

export class GreetProvider implements SlashBehaviourProvider {
  readonly name = 'my-module.com/GreetProvider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    {
      name: 'greet',
      description: 'Greet the current cell',
      descriptionKey: 'slash.greet',
      aliases: ['hello', 'hi'],
    },
  ]

  async execute(behaviourName: string, args: string): Promise<void> {
    if (behaviourName === 'greet') {
      console.log(`hello, ${args.trim() || 'cell'}`)
    }
  }
}
```

## Registration

Providers register on the drone at load time. No shell changes required:

```ts
const slashDrone = window.ioc.get('@diamondcoreprocessor.com/SlashBehaviourDrone')
slashDrone.addProvider(new GreetProvider())
```

Higher-priority providers are checked first. Built-in providers use priority 100.

## Localization

Register per-locale translations for your descriptions at the same load point:

```ts
import type { I18nProvider, I18N_IOC_KEY } from '@hypercomb/core'

window.ioc.whenReady(I18N_IOC_KEY, (i18n: I18nProvider) => {
  i18n.registerTranslations('my-module.com', 'en', { 'slash.greet': 'Greet the current cell' })
  i18n.registerTranslations('my-module.com', 'ja', { 'slash.greet': 'セルに挨拶する' })
})
```

Autocomplete will automatically show the localized description once the user switches locale via `/language ja`.

## Help integration

Because slash commands are introspectable (name, description, aliases, descriptionKey), the help system can enumerate them without hardcoding. Every registered command appears in `/help slash` drill-down without further work.

## Checklist

- [ ] Provider class implements `SlashBehaviourProvider`
- [ ] Each behaviour has a unique `name` (no collision with existing commands)
- [ ] `descriptionKey` uses the `slash.<name>` convention
- [ ] Translations registered for at least English; Japanese recommended
- [ ] Provider registered on `SlashBehaviourDrone` at module load
- [ ] Aliases kept short and unambiguous
- [ ] `execute()` is idempotent for safe repeat invocation

---

## See also

- [slash-behaviour-reference.md](slash-behaviour-reference.md) — current command catalogue
- [command-line-reference.md](command-line-reference.md) — broader command-line architecture
- [contributing.md](contributing.md) — general contribution guide
