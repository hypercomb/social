// diamondcoreprocessor.com/games/roper/roper.queen.ts
//
// /roper — open / close the Roper game (same as the header icon).
//
//   /roper            — toggle the game overlay
//   /roper on | off   — open / close explicitly
//
// The header toggle and this command are two doors to the same RoperDrone.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { RoperDrone } from './roper.drone.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class RoperQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'roper'
  override readonly aliases = ['worms', 'rope']
  override description = 'Roper — turn-based Worms-style artillery with a ninja rope'
  override descriptionKey = 'slash.roper'
  override options = ['on', 'off']
  override examples = [{ input: '/roper on', result: 'Starts a Roper match' }]

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['on', 'off'].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const drone = get('@diamondcoreprocessor.com/RoperDrone') as RoperDrone | undefined
    if (!drone) { this.#log('Roper unavailable'); return }
    const a = args.trim().toLowerCase()
    if (a === 'on' || a === 'open') { drone.open(); this.#log('Roper — opened', '⟜'); return }
    if (a === 'off' || a === 'close') { drone.close(); this.#log('Roper — closed', '○'); return }
    const on = drone.toggle()
    this.#log(on ? 'Roper — opened' : 'Roper — closed', on ? '⟜' : '○')
  }

  #log(message: string, icon = '⟜'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _roper = new RoperQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RoperQueenBee', _roper)
