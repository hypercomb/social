# Behavior usage docs — the authoring standard

Every behavior documents its own usage **at creation, in structured fields on
the authoring contract**. Reference surfaces (the help page's study cards, the
`/help` sheet, autocomplete detail panes) read these fields directly — nothing
is ever parsed out of a description string, and there is no separate docs file
to drift.

## Queens (slash behaviours)

A `QueenBee` supplies, next to its `command`:

| Field | What it is | Example |
|---|---|---|
| `description` | One sentence: what it does. English fallback. | `'Idle screensaver: toggle on/off, pick the look'` |
| `descriptionKey` | i18n key (`slash.<command>`) for the localized description. | `'slash.screensaver'` |
| `aliases` | Alternate typed names. | `['bounce', 'bubbles']` |
| `options` | **Accepted parameter values or forms** — literals (`'on'`, `'off'`) or placeholders (`'<color name>'`). | `['on', 'off', 'now', 'hexagon']` |
| `examples` | **Worked examples** — what to type, what happens. One or two well-chosen ones beat an exhaustive list. | `[{ input: '/screensaver now', result: 'Starts the screensaver immediately' }]` |
| `slashComplete(args)` | Live autocomplete (may be dynamic — cell names, colors). | — |
| `slashHidden` | Invokable but never suggested (destructive / dev-only). | — |

The slash drone auto-wraps every registered queen (`slash-behaviour.drone.ts`),
so `options`/`examples` flow to every surface with **no mirror class and no
extra registration**. Manual `SlashBehaviourProvider`s carry the same fields on
their `behaviours` entries.

```ts
export class ScreensaverQueenBee extends QueenBee {
  readonly command = 'screensaver'
  override readonly aliases = ['bounce', 'bubbles']
  override description = 'Idle screensaver: toggle on/off, pick the look'
  override descriptionKey = 'slash.screensaver'
  override options = ['on', 'off', 'now', 'hexagon', 'circle', 'thought']
  override examples = [
    { input: '/screensaver now', result: 'Starts the screensaver immediately' },
  ]
}
```

## Command-line input behaviors

Already standard: `CommandLineBehavior` declares `operations`, each with
`trigger`, `pattern`, `description`, and `examples` (`{ input, key, result }`).
The help page and the sheet render them as-is. Author the examples with the
operation — they are the documentation.

## Keymap actions

`KeyBinding` carries `description`, `descriptionKey`, and `category`; the
binding's `sequence` **is** its usage. Nothing further to author.

## Migration / backfill

Legacy queens embedded options in the description tail (`"…; on | off"`).
During migration the help card still parses that tail as a **fallback** and
always strips it from the shown description — so a migrated queen whose
translations still carry a tail never shows it twice. Backfill = add
`options` + `examples` to the queen; translations can drop their tails at
leisure. Backfilled so far (wave 1): border, screensaver, language, accent,
tutor, arkanoid, bubble, roper, solomon.

**Rule for new behaviors: `options` and `examples` ship with the queen, in the
same commit that creates it.**
