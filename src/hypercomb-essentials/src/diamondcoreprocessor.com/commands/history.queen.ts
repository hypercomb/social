// diamondcoreprocessor.com/commands/history.queen.ts

import { QueenBee } from '@hypercomb/core'

/**
 * /history — toggle the history panel.
 *
 * The panel is hidden by default; this command is the (only) way to
 * pop it open. Typing `/history` while it's visible hides it again.
 * Undo / redo keystrokes still operate on history regardless of
 * panel visibility — they just don't open the surface any more.
 *
 * The pack lives in `hypercomb-shared` and registers itself in IoC
 * under `@hypercomb.social/HistoryMenuPack` at install time, exposing
 * a `{ toggle, visible }` handle. Resolving by key keeps the
 * essentials → shared dependency direction unviolated.
 */
type HistoryMenuPackHandle = {
  visible: { (): boolean }
  toggle: () => void
}

export class HistoryQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'history'
  override readonly aliases = []
  override description = 'Toggle the history panel'
  override descriptionKey = 'slash.history'

  protected execute(_args: string): void {
    const pack = get('@hypercomb.social/HistoryMenuPack') as HistoryMenuPackHandle | undefined
    if (!pack) {
      console.warn('[/history] HistoryMenuPack not registered')
      return
    }
    pack.toggle()
  }
}

const _history = new HistoryQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HistoryQueenBee', _history)
