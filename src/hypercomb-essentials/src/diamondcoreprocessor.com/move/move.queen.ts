// diamondcoreprocessor.com/move/move.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * /move — toggle move mode or commit a positional move.
 *
 * Syntax:
 *   /move              — toggle move mode for drag-reordering tiles
 *   /move(index)       — commit a move: place selected tiles at index
 *   /select[a,b]/move(3) — chained: select then move to position 3
 */
export class MoveQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'movement'
  readonly command = 'move'
  override readonly aliases = []
  override description = 'Toggle move mode for drag-reordering tiles'
  override descriptionKey = 'slash.move'

  protected async execute(args: string): Promise<void> {
    // /move(index) — commit a move using the current selection
    const indexMatch = args.match(/\((\d+)\)/) || args.match(/\((\d+)$/)
    if (indexMatch) {
      const targetIndex = parseInt(indexMatch[1], 10)
      const selection = get('@diamondcoreprocessor.com/SelectionService') as
        { selected: ReadonlySet<string> } | undefined
      const labels = selection ? Array.from(selection.selected) : []
      if (labels.length > 0) {
        const moveDrone = get('@diamondcoreprocessor.com/MoveDrone') as any
        if (moveDrone) {
          if (moveDrone.moveCommandActive) moveDrone.cancelCommandMove()
          moveDrone.beginCommandMove(labels)
          await moveDrone.commitCommandMoveAt(targetIndex)
        }
      }
      return
    }

    // /move — toggle move mode
    EffectBus.emit('controls:action', { action: 'move' })
  }
}

const _move = new MoveQueenBee()
window.ioc.register('@diamondcoreprocessor.com/MoveQueenBee', _move)
