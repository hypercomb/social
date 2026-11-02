// games/bubble/bubble.queen.ts
//
// /bubble — open / close the Bubble Bobble game (same as the header icon).
//
//   /bubble            — toggle the game overlay
//   /bubble on | off   — open / close explicitly
//   /bubble level <n>  — write round n as a level tile (map, flow, enemies) beside its cells
//
// The header toggle and this command are two doors to the same BubbleDrone.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { BubbleDrone } from './bubble.drone.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class BubbleQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'bubble'
  override description = 'Bubble Bobble — blow bubbles, trap foes, clear the screen'
  override descriptionKey = 'slash.bubble'
  override options = ['on', 'off', 'level <round>']
  override examples = [
    { input: '/bubble on', result: 'Starts Bubble Bobble' },
    { input: '/bubble level 1', result: 'Writes round 1 as a level tile people can read and edit' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['on', 'off', 'level'].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const drone = get('@diamondcoreprocessor.com/BubbleDrone') as BubbleDrone | undefined
    if (!drone) { this.#log('Bubble Bobble unavailable'); return }
    // SWITCHED OFF in the Beehaviors roster. This is the one place a
    // dormant behaviour ANSWERS instead of simply not being there: a
    // typed command is a gesture, and swallowing it reads as a broken
    // game. Say where the light lives, once, and stop.
    if (drone.gameDormant) {
      this.#log('Bubble Bobble is switched off — light it in Beehaviors', '○')
      return
    }
    const a = args.trim().toLowerCase()

    const level = /^level\s+(\d{1,3})$/.exec(a)
    if (level) { await this.#writeLevel(Number(level[1]) - 1); return }
    if (a === 'on' || a === 'open') { drone.open(); this.#log('Bubble Bobble — opened', '🫧'); return }
    if (a === 'off' || a === 'close') { drone.close(); this.#log('Bubble Bobble — closed', '○'); return }
    if (a === 'design' || a === 'designer' || a === 'edit') {
      this.#log('This Bubble Bobble version has the 100-round DOS campaign and no level designer.', '🫧'); return
    }
    const on = drone.toggle()
    this.#log(on ? 'Bubble Bobble — opened' : 'Bubble Bobble — closed', on ? '🫧' : '○')
  }

  /** Round n as a level tile: forward only, the native cells are left as they are. */
  async #writeLevel(index: number): Promise<void> {
    try {
      const { createBubbleTileSurface } = await import('./tile-surface.js')
      const surface = createBubbleTileSurface([])
      await surface.ensureRound(index)
      await surface.upgradeRound(index)
      this.#log(`Bubble Bobble round ${index + 1} — written as a level tile`, '🫧')
    } catch (error) {
      this.#log(`Bubble Bobble round ${index + 1} — not written: ${(error as Error)?.message ?? error}`, '○')
    }
  }

  #log(message: string, icon = '🫧'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

