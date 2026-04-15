// diamondcoreprocessor.com/assistant/expand.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * /expand — expand selected tiles into constituent parts via Claude Haiku.
 *
 * Syntax:
 *   /select[a,b]/expand   — expand selected tiles
 *   /expand               — expand currently selected tiles
 */
export class ExpandQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'expand'
  override readonly aliases = []
  override description = 'Expand selected tiles into constituent parts via Claude Haiku'
  override descriptionKey = 'slash.expand'

  protected async execute(_args: string): Promise<void> {
    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { selected: ReadonlySet<string> } | undefined
    const targets = selection ? Array.from(selection.selected) : []

    if (targets.length === 0) return

    for (const label of targets) {
      EffectBus.emit('tile:action', { action: 'expand', label, q: 0, r: 0, index: 0 })
    }
  }
}

const _expand = new ExpandQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ExpandQueenBee', _expand)
