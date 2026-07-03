// diamondcoreprocessor.com/commands/player.queen.ts

import { QueenBee } from '@hypercomb/core'

const EBOOK_URL = 'https://inspiredbyhumans.org'

/**
 * /ebook — open the standalone audiobook in a new tab.
 *
 * The in-app track player has been retired from hypercomb.io. The
 * audiobook lives at its own domain so this queen just opens that
 * URL in a fresh tab and gets out of the way. No assets, no overlay,
 * no audio elements in the main app — keeping the surface lean.
 */
export class PlayerQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'ebook'
  override description = 'Open the audiobook (inspiredbyhumans.org) in a new tab'
  override examples = [
    { input: '/ebook', result: 'Opens inspiredbyhumans.org in a new tab' },
  ]

  protected execute(_args: string): void {
    try {
      window.open(EBOOK_URL, '_blank', 'noopener,noreferrer')
    } catch {
      // Pop-up blocked or window.open unavailable — fall back to
      // a same-tab navigation so the user still reaches the page.
      window.location.href = EBOOK_URL
    }
  }
}

const _player = new PlayerQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PlayerQueenBee', _player)
