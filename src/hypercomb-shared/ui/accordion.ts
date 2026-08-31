// hypercomb-shared/ui/accordion.ts
//
// ONE SECTION OPEN AT A TIME.
//
// A window that lists things under headers is a window you are CHOOSING from,
// and choosing means seeing the choices. Let two headers stand open and the
// second one's rows push the third, fourth and fifth off the bottom of a
// panel that is 380px wide — so the list you opened in order to browse it is
// the one thing you can no longer browse. Open a header and the others close;
// the roster stays one screen tall however many sections it grows.
//
// It is a shared primitive rather than four signals in four components for the
// reason every shell rule here is: the tutorials window is simply the first
// list of this shape, and the next one must not have to re-decide what a
// header click means. A window adopts the behaviour by holding one of these,
// not by copying twenty lines.
//
//     readonly sections = accordion()
//     isOpen(key)  →  this.sections.isOpen(key)
//     (click)      →  this.sections.toggle(key)
//
// SIGNAL-BACKED ON PURPOSE. The shells run `provideZonelessChangeDetection()`,
// so a plain getter read from a template would never repaint — the header
// would flip its state and the section would not move. `window-session.ts`
// stays framework-free because the shim's runtime-initializer evaluates it;
// this is only ever reached from a component, so it takes the signal.
//
// WHAT IT DELIBERATELY IS NOT: a tree. An outline collapses its branches
// independently, because reading one paragraph while another stays open is
// the whole point of an outline (the notes strip's chevrons, the chat list's
// archive disclosure). This is for PEER SECTIONS — a flat set of headers over
// one list, where exactly one of them is the thing you are looking at.

import { signal, type Signal } from '@angular/core'

export interface Accordion {
  /** The one open section's key, or null when everything is closed. */
  readonly open: Signal<string | null>
  /** Is this the open one? The call a template makes per header. */
  isOpen(key: string): boolean
  /** A header click. Opens this section and closes whatever was open;
   *  clicking the one that IS open closes it, so a list can be all-closed. */
  toggle(key: string): void
  /** Open this one without toggling — for "show me where that is", where a
   *  second call must not close what the first one revealed. */
  reveal(key: string): void
  /** Everything closed. What a window opens on: nothing is chosen yet, and
   *  a section pre-opened by the shell is a choice you did not make. */
  closeAll(): void
  /** Did this press close something? The Escape rung a window can offer
   *  BEFORE closing itself — backing out of a section should not cost you
   *  the window. True = the press was consumed. */
  dismiss(): boolean
}

export function accordion(initial: string | null = null): Accordion {
  const open = signal<string | null>(initial)
  return {
    open,
    isOpen: (key: string): boolean => open() === key,
    toggle: (key: string): void => { open.set(open() === key ? null : key) },
    reveal: (key: string): void => { open.set(key) },
    closeAll: (): void => { open.set(null) },
    dismiss: (): boolean => {
      if (open() === null) return false
      open.set(null)
      return true
    },
  }
}
