// diamondcoreprocessor.com/commands/arrange.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * /arrange — toggle icon arrangement mode on the tile overlay.
 *
 * When active, overlay icons become draggable — like rearranging apps on a
 * phone home screen. Drag icons to swap positions, drag to/from the pool
 * to add or remove icons from the active overlay. Order persists in the
 * root directory's properties file.
 */
export class ArrangeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'arrange'
  override description = 'Toggle icon arrangement mode on the tile overlay'

  #active = false

  protected execute(): void {
    this.#active = !this.#active
    EffectBus.emit('overlay:arrange-mode', { active: this.#active })
  }
}

const _arrange = new ArrangeQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ArrangeQueenBee', _arrange)
