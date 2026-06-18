// diamondcoreprocessor.com/games/bubble/bubble.queen.ts
//
// /bubble — open / close the Bubble Bobble game (same as the header icon).
//
//   /bubble            — toggle the game overlay
//   /bubble on | off   — open / close explicitly
//
// The header toggle and this command are two doors to the same BubbleDrone.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { BubbleDrone } from './bubble.drone.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class BubbleQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'bubble'
  override readonly aliases = ['bobble']
  override description = 'Bubble Bobble — blow bubbles, trap foes, clear the screen'
  override descriptionKey = 'slash.bubble'

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['on', 'off', 'design'].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const drone = get('@diamondcoreprocessor.com/BubbleDrone') as BubbleDrone | undefined
    if (!drone) { this.#log('Bubble Bobble unavailable'); return }
    const a = args.trim().toLowerCase()

    if (a === 'on' || a === 'open') { drone.open(); this.#log('Bubble Bobble — opened', '🫧'); return }
    if (a === 'off' || a === 'close') { drone.close(); this.#log('Bubble Bobble — closed', '○'); return }
    if (a === 'design' || a === 'designer' || a === 'edit') {
      drone.openDesigner(); this.#log('Bubble Bobble — designer', '🫧'); return
    }
    const on = drone.toggle()
    this.#log(on ? 'Bubble Bobble — opened' : 'Bubble Bobble — closed', on ? '🫧' : '○')
  }

  #log(message: string, icon = '🫧'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _bubble = new BubbleQueenBee()
window.ioc.register('@diamondcoreprocessor.com/BubbleQueenBee', _bubble)
