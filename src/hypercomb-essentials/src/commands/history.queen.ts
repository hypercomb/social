// commands/history.queen.ts

import { EffectBus, QueenBee } from '@hypercomb/core'

/**
 * /history — toggle the history panel.
 *
 * The panel is hidden by default; this command is the (only) way to
 * pop it open. Typing `/history` while it's visible hides it again.
 * Undo / redo keystrokes still operate on history regardless of
 * panel visibility — they just don't open the surface any more.
 *
 * The viewer (hypercomb-shared history-viewer) owns its own visibility
 * and listens on the bus — the old HistoryMenuPack IoC handle is gone
 * with the vertical selection menu (see
 * documentation/selection-tool-windows.md). The string contract keeps
 * the essentials → shared dependency direction unviolated.
 */
export class HistoryQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'history'
  override readonly aliases = []
  override description = 'Toggle the history panel'
  override descriptionKey = 'slash.history'
  override examples = [{ input: '/history', result: 'History panel opens; repeat to hide it' }]

  protected execute(_args: string): void {
    EffectBus.emit('history:view-toggle', {})
  }
}

const _history = new HistoryQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HistoryQueenBee', _history)
