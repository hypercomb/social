// diamondcoreprocessor.com/games/arkanoid/arkanoid.queen.ts
//
// /arkanoid — open / close the Arkanoid game (same as the header icon).
//
//   /arkanoid            — toggle the game overlay
//   /arkanoid on | off   — open / close explicitly
//   /arkanoid design     — open straight into the level designer
//
// The header toggle and this command are two doors to the same ArkanoidDrone.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { ArkanoidDrone } from './arkanoid.drone.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class ArkanoidQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'arkanoid'
  override readonly aliases = ['breakout', 'bricks']
  override description = 'Arkanoid — bounce the ball off the paddle to break every brick'
  override descriptionKey = 'slash.arkanoid'

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['on', 'off', 'design'].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const drone = get('@diamondcoreprocessor.com/ArkanoidDrone') as ArkanoidDrone | undefined
    if (!drone) { this.#log('Arkanoid unavailable'); return }
    const a = args.trim().toLowerCase()
    if (a === 'on' || a === 'open') { drone.open(); this.#log('Arkanoid — opened', '◗'); return }
    if (a === 'off' || a === 'close') { drone.close(); this.#log('Arkanoid — closed', '○'); return }
    if (a === 'design' || a === 'designer' || a === 'edit') { drone.openDesigner(); this.#log('Arkanoid — designer', '◗'); return }
    const on = drone.toggle()
    this.#log(on ? 'Arkanoid — opened' : 'Arkanoid — closed', on ? '◗' : '○')
  }

  #log(message: string, icon = '◗'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _arkanoid = new ArkanoidQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ArkanoidQueenBee', _arkanoid)
