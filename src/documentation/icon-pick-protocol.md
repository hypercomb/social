# Icon-pick protocol

How any window asks the shell for a Material icon.

The chooser is one shell component (`hypercomb-shared/ui/icon-picker`), but the
way you reach it is a **first-class EffectBus contract**, not an import — so
Angular panels, framework-free custom elements and drone modules all plug into
the same chooser. Contract types live in `@hypercomb/core`
(`icon-pick.types.ts`), which modules may import; the chooser's implementation
lives in shared, which they may not.

## The exchange

```
emit  icon:pick-request   { id, token?, store?, filter?, title? }
→     icon:pick-result    { id, token?, name }      name === null ⇒ cancelled
```

One request, **exactly one result**. Choosing settles it, closing the chooser
settles it as `null`, and a request that supersedes an open one settles the
superseded one as `null`. A caller never has to watch `icon:picker-open` to
work out whether the user walked away.

`icon:picker-open { open }` still exists, and still means only "the chooser is
on screen" — for surfaces that need to get out of the way (z-index, focus,
suppressing their own Escape). It is **not** a completion signal.

## Two modes

| `store` | Behaviour | Who uses it |
|---|---|---|
| omitted / `true` | **Write-through.** The pick is saved as that element's icon override (`IconOverrideStore`) and every surface re-resolves live. `id` is a real element id. | The universal icon protocol: `IconEditMode.requestPick`, tile-overlay icons, control-bar controls |
| `false` | **Borrow.** Nothing is written; the name comes back on the result and the caller decides what it means. `id` is just a correlation token. | Surfaces that keep icons in their own content: the notes mark palette, docked-panel group icons |

## Calling it

**From shared / Angular** — use the promise helper, never raw events:

```ts
import { requestIconPick } from '../../core/icon-pick'

const icon = await requestIconPick({
  id: 'notes:mark-palette',
  store: false,
  title: i18n?.t('notes.addMark'),   // names what you are choosing an icon FOR
  filter: 'arrow',                   // optional: pre-seed the search box
})
if (!icon) return                    // null ⇒ cancelled
```

The helper mints the per-call `token` for you, subscribes before it emits, and
unsubscribes when it settles.

**From a drone module** (which cannot import from shared) — emit the events;
the behaviour is identical:

```ts
import { ICON_PICK_REQUEST, type IconPickRequest } from '@hypercomb/core'

this.emitEffect(ICON_PICK_REQUEST, { id: 'overlay:' + action.name } satisfies IconPickRequest)
```

Write-through callers that only want the side effect can ignore the result
entirely, as the overlay drone does.

## Two rules the wiring depends on

**The result is emitted transiently.** `EffectBus.emit` stores a last value and
replays it to late subscribers; a completion signal that replays would settle
the *next* request before the chooser even opened. `#settle` uses
`emitTransient`. Corollary: **subscribe before you emit the request.**

**Match on `token`, not `id`.** A window that reuses one id — a palette's "add
an icon" button pressed twice — can have a second request supersede the first
while both awaiters are listening. Matching on `id` alone resolves both from
one result. The helper always sends a token; fire-and-forget emitters may omit
it.

## What this replaced

The docked-panel group icon used to write an override for `panel-group:<id>`
that nothing ever read, purely so it could read the glyph back off
`icon:override-changed`, plus a second listener on `icon:picker-open` to notice
a cancel, plus manual teardown of both. It is now one awaited call.
