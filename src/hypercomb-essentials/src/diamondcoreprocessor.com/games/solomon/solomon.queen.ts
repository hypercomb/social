// diamondcoreprocessor.com/games/solomon/solomon.queen.ts
//
// /solomon — open / close the Solomon's Key game (same as the header icon).
//
//   /solomon            — toggle the game overlay
//   /solomon on | off   — open / close explicitly
//   /solomon design     — open straight into the level designer
//
// The header toggle and this command are two doors to the same SolomonDrone.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { SolomonDrone } from './solomon.drone.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class SolomonQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'solomon'
  override readonly aliases = ['game', 'dana']
  override description = "Solomon's Key — block-conjuring puzzle-platformer with a level designer"
  override descriptionKey = 'slash.solomon'
  override options = ['on', 'off', 'design']
  override examples = [{ input: '/solomon design', result: 'Opens the level designer' }]

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['on', 'off', 'design'].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const drone = get('@diamondcoreprocessor.com/SolomonDrone') as SolomonDrone | undefined
    if (!drone) { this.#log("Solomon's Key unavailable"); return }
    const a = args.trim().toLowerCase()

    if (a === 'on' || a === 'open') { drone.open(); this.#log("Solomon's Key — opened", '✦'); return }
    if (a === 'off' || a === 'close') { drone.close(); this.#log("Solomon's Key — closed", '○'); return }
    if (a === 'design' || a === 'designer' || a === 'edit') {
      drone.openDesigner()
      this.#log("Solomon's Key — designer", '✦'); return
    }
    const on = drone.toggle()
    this.#log(on ? "Solomon's Key — opened" : "Solomon's Key — closed", on ? '✦' : '○')
  }

  #log(message: string, icon = '✦'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _solomon = new SolomonQueenBee()
window.ioc.register('@diamondcoreprocessor.com/SolomonQueenBee', _solomon)
