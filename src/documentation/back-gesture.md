# The back gesture — left click goes in, right click comes back out

One gesture, one meaning, on every surface the hive draws.

Walking **in** has never been ambiguous: you left-click a tile, a plate, a row,
a sticky, and you are inside it. Coming **out** used to depend on what you
happened to be standing on. The hexagon canvas answered the right button
(`tile-overlay.drone.ts` → `#navigateBack`); everything else let the browser
answer it, so a right-click on a welcome page, a website page, a post-it or a
side panel raised *Reload / View page source* — a menu about the document, in a
shell whose whole point is that there is no document to think about.

`diamondcoreprocessor.com/navigation/back-gesture.service.ts` is now the ONE
place that decides what the right button means. IoC key
`@diamondcoreprocessor.com/BackGesture`.

## The ladder

A right-click is resolved top-down; the first rung that answers wins.

1. **A hovered scope** — a surface that registered `within` and has the pointer
   inside it. Innermost wins, so a panel nested in a view backs out of the
   panel, not the view.
2. **The top open view** — read from `ModeRegistry.ownersOf('view:active')`,
   last owner in is top of the stack. A registration is keyed by the SAME owner
   string the view enters that mode with, which is what makes it live exactly
   while the view is on screen.
3. **A page-covering mode that is not a view** — an entry whose own `active()`
   says it is holding the surface. Clipboard mode is the first of these.
4. **The lineage** — `Navigation.back()`, the same TRUE BACK the canvas does:
   it retraces pages actually visited, so a root-hop into a collection returns
   to the page it was opened from rather than to the structural parent. At the
   hive root it is a no-op.

Inside a **website** the gesture walks the site's own pages up to its root,
and at the root it leaves the site — one gesture, one meaning: right-click
always comes back out of where you are, and at the root of a site the thing
you are inside IS the site. Leaving lands on the page that spawned it, in the
view that spawned it (`documentation/embedded-sites.md` → *Coming back out*).

Leaving a view you **stepped into** from a tile icon — the tree is the first —
lands the same way: on the page the icon was clicked from, in the view that was
up (`documentation/stepping-into-a-view.md`). The icon's walk to the branch
entrance is undone on the way out, so coming back out lands where you came in.

Rung 4 is why **hierarchical menus need no wiring at all**: their rows walk the
lineage in, so the gesture walks the lineage out. Only a surface that drills
WITHOUT moving the lineage needs to register.

## What the browser keeps

Two, deliberately: a right-click on an **editable field**, and a right-click on
**selected text**. Paste, copy and spellcheck are the only context menus in this
shell anyone wants, and neither of them is a navigation. Everything else on the
shell's own surfaces belongs to the shell — the gesture is claimed even when it
resolves to a no-op, so the browser menu never flickers into view.

Ctrl / Cmd is the selection modifier here, so a modified right-click is left
alone as well.

## Composing with what is already there

The listener is on `window` in the **bubble** phase and stands down on
`event.defaultPrevented`. Every per-surface capture handler that predates the
registry (the canvas, `tile-view`, `tree-view`, `slides-view`, `site-view`, the
game overlays, `InputGate`'s claim guard) therefore keeps its meaning and runs
first; the registry only answers what nobody closer to the event claimed.

**New surfaces register — they do not bind another listener.** Two window
listeners for one gesture is how you get a right-click that both closes a panel
AND navigates the hive out from under it.

```ts
import type { BackGesture } from '../../navigation/back-gesture.service.js'

this.#backOff = window.ioc?.get<BackGesture>('@diamondcoreprocessor.com/BackGesture')
  ?.register({ owner: 'welcome-view', back: () => this.#vm()?.setMode('hexagons') }) ?? null
```

`register` returns the unregister; call it in `dispose`. Shell UI in
`hypercomb-shared` resolves the same key through `window.ioc` at call time —
never a static import.

Where a view already has an Escape handler, `back` should be the same call
Escape makes: one way out, two ways to ask for it.

## Verifying

`node scripts/drive-back-gesture.cjs --url http://localhost:4251` drives real
right-clicks (never synthetic events — the point is that the browser menu no
longer wins) over shell chrome, a mounted post-it, and website mode at the site
root. `back-gesture.spec.ts` pins the ladder and the carve-outs.
