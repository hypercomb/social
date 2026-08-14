# Selection & tool windows

**The rule: selection is a notification; every tool window that can act on it
plugs in and implements its own response, inside itself. There is no central
selection surface.**

The floating vertical selection menu (`hc-selection-context-menu`) is retired.
It was a fixed strip of icons floating over the canvas — cramped, a closed set
of hardcoded actions, and no way for a behavior to contribute its own
selection functionality. Its replacement is not another surface: it is a
pattern.

## The pattern

1. **Selection truth** lives in `@diamondcoreprocessor.com/SelectionService`
   (essentials): a set of tile **labels** plus one `active` leader. Canonical
   persistence is the URL bracket form (`/parent/[a,b,c]`).
2. **The notification** is the `selection:changed` effect —
   `{ selected: string[], active: string | null }`, last-value replayed, so a
   window opened after the selection was made is still correct.
3. **Tool windows subscribe** via `hypercomb-shared/core/selection-context.ts`:
   - `onSelection(cb)` — normalized change stream (two publishers share the
     event name; the helper strips the pixi drone's richer accidental payload).
   - `withSelectionService(cb)` — late-registration-safe IoC resolve, for
     windows that need the service itself (`clear()` etc.).
   Drones skip the helper — they already take SelectionService as an IoC dep.
4. **Each window implements its own response.** The clipboard window offers
   cut/copy of the selection; the files window opens the selection's
   documents; the features window opens the selection's features; the tags
   window stages the armed keywords onto the selection; notes follows the
   active cell. No shared section component, no generic "selection tools"
   registry — a window's selection affordance is that window's own code.

## Contracts that keep it coherent

- **One-shot verbs stay on the `controls:action` bus** (`cut`, `copy`,
  `remove`, `paste`, `view-documents`, `features`, `promote-to-parent`,
  `make-public`, `make-branch-public`). The essentials drones that answer them
  are unchanged; a window (or the controls bar) just emits.
- **Behavior-side selectivity**: a drone that can say whether the selection is
  relevant to it broadcasts a replayed boolean effect —
  `selection:has-documents` / `selection:has-features` are the precedent — and
  the window gates its affordance on that, not on re-deriving the answer.
- **Gestures that start in a panel** resolve their drop from **release
  coordinates** via `TileOverlayDrone.labelAtClient(x, y)` — never a
  remembered `tile:hover`, which nulls the moment the pointer crosses chrome.
- **Armed canvas-takeover modes** (painting, removal staging) follow the
  painter doctrine: the owning drone re-broadcasts ONE sticky
  `<feature>:pending { active, …, cells }` from a single chokepoint; consumers
  latch their own boolean off it. For mutual exclusivity between takeovers,
  claim through `@diamondcoreprocessor.com/ModeRegistry` (owner-counted) —
  do not hand-wire pairwise exclusion between windows.
- **Escape** has ONE owner: the cascade (`keyboard/escape-cascade.ts`), and it
  is gated on FOCUS. A window never registers its own Escape listener. It
  declares `dismiss()` (unwind one level of its own state — field, armed mode,
  drill) and `close()` on its `WindowSession`, and the cascade calls them only
  while the focus is inside that window. Focus out on the canvas means the press
  belongs to the cascade's own rungs, so a live selection or a stuck InputGate
  can always be cleared with a panel open. The order is: window dismiss
  (priority 2e) → clear selection (3) → window close (3b). The selection clear
  sits BETWEEN the two deliberately: backing out of a panel's inner state must
  not cost a selection, and a window must not close while one is still up.

## Adding a selection response to a new window

```ts
import { onSelection } from '../../core/selection-context'

#selectionUnsub: (() => void) | null = null
constructor() {
  this.#selectionUnsub = onSelection(({ selected, active }) => {
    this.selectionCount.set(selected.length)   // then respond YOUR way
  })
}
ngOnDestroy(): void { this.#selectionUnsub?.() }
```

A drone contributing a whole window does the same thing with its IoC dep and a
custom element registered on `@hypercomb.social/ShellSurfaceRegistry`
(`element:` shape) — see `shell-surfaces.md`.
