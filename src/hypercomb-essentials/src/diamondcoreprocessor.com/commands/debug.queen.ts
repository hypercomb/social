// diamondcoreprocessor.com/commands/debug.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * debug — toggles the Pixi display-tree inspector.
 *
 * Type `debug` in the command line to toggle the overlay on/off.
 * When active, hover over the canvas to inspect Pixi display objects.
 * Use `window.__pixiDebug` in the console for direct object access.
 */
export class DebugQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'debug'
  override readonly aliases = ['inspect', 'dbg']

  override description = 'Toggle the Pixi display-tree inspector'

  protected execute(_args: string): void {
    const dbg = (window as any).__pixiDebug

    if (dbg && typeof dbg.toggle === 'function') {
      dbg.toggle()
      const state = dbg.active ? 'ON' : 'OFF'
      console.log(`%c[debug] Pixi inspector ${state}`, `color: ${dbg.active ? '#0f0' : '#f55'}; font-weight: bold`)
      EffectBus.emit('queen:debug', { active: dbg.active })
    } else {
      console.warn('[debug] PixiDebugDrone not loaded — no __pixiDebug on window')
      EffectBus.emit('queen:debug', { active: false, error: 'not-loaded' })
    }
  }
}

const _debug = new DebugQueenBee()
window.ioc.register('@diamondcoreprocessor.com/DebugQueenBee', _debug)
