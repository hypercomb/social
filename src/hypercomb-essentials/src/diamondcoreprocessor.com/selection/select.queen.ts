// diamondcoreprocessor.com/selection/select.queen.ts
//
// `/select` — arm the picking mode from the command line.
//
// The pill is the real interface on touch; this exists so the mode is
// reachable on a desktop with no pill, scriptable from the bridge, and
// nameable in a tutorial. `/select options` opens the same seven-hexagon
// ring the pill's Options button does.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { SelectModeDrone } from './select-mode.drone.js'

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

type SelectionLike = { selected: ReadonlySet<string>; clear(): void }

export class SelectQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'select'
  override readonly aliases = ['pick']
  override description = 'Pick tiles by tapping them, then act on the set'
  override descriptionKey = 'slash.select'
  override options = ['on', 'off', 'all', 'none', 'options']
  override examples = [
    { input: '/select', result: 'Arms picking — tapping a tile picks it instead of entering it' },
    { input: '/select all', result: 'Picks every tile on this page' },
    { input: '/select options', result: 'Opens the selection ring over the picked set' },
    { input: '/select off', result: 'Clears the picked set and hands taps back to navigation' },
  ]

  override slashComplete(args: string): readonly string[] {
    const query = args.trim().toLowerCase()
    return this.options!.filter(option => option.startsWith(query))
  }

  protected async execute(args: string): Promise<void> {
    const drone = get<SelectModeDrone>('@diamondcoreprocessor.com/SelectModeDrone')
    if (!drone) { this.#log('Select mode unavailable'); return }

    switch (args.trim().toLowerCase()) {
      case 'off':
      case 'none':
        get<SelectionLike>('@diamondcoreprocessor.com/SelectionService')?.clear()
        drone.disarm()
        this.#log('Picking off')
        return
      case 'all':
        EffectBus.emit('select:all', {})
        this.#log('Picked every tile on this page', '⬡')
        return
      case 'options':
      case 'menu': {
        const count = get<SelectionLike>('@diamondcoreprocessor.com/SelectionService')?.selected.size ?? 0
        if (count === 0) { this.#log('Nothing picked yet — tap some tiles first'); return }
        if (!drone.openOptions()) { this.#log('Selection ring could not open'); return }
        this.#log(`${count} picked — flick a direction, Escape to dismiss`, '⬡')
        return
      }
      case 'on':
        drone.arm()
        this.#log('Tap the tiles you want', '⬡')
        return
      default:
        drone.toggle()
        this.#log(drone.armed ? 'Tap the tiles you want' : 'Picking off', '⬡')
    }
  }

  #log(message: string, icon = '⬡'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _select = new SelectQueenBee()
window.ioc.register('@diamondcoreprocessor.com/SelectQueenBee', _select)
