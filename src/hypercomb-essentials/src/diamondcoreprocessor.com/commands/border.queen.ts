// diamondcoreprocessor.com/commands/border.queen.ts
//
// /border — tile border style. Currently the one style is the neon glow:
// every tile's border lights up with an additive bloom (the screensaver's
// neon edge, applied to the live grid). Off restores the plain border.
//
//   /border              — toggle the neon glow on/off
//   /border neon | on    — turn the glow on
//   /border off | none   — turn the glow off
//
// Border mode is participant-local view state, so this queen owns no layer
// state — it drives the same `neon:mode` effect + `hc:neon-mode` preference
// the control-bar toggle uses, keeping a single source of truth. The renderer
// (ShowCellDrone → hex SDF shader) listens for `neon:mode`; the control bar
// listens too, so its icon stays in sync however the mode was flipped.
//
// Colour is a separate concern owned by `/accent` (the neon palette).

import { QueenBee, EffectBus } from '@hypercomb/core'

const STORAGE_KEY = 'hc:neon-mode'

const ON_WORDS = new Set(['neon', 'on', 'glow', 'glowing', '1'])
const OFF_WORDS = new Set(['off', 'none', 'plain', 'flat', '0'])

export class BorderQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'border'
  override readonly aliases = ['edge']
  override description = 'Tile border style — neon glow on/off'
  override descriptionKey = 'slash.border'

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['neon', 'off'].filter(o => o.startsWith(q))
  }

  protected execute(args: string): void {
    const a = args.trim().toLowerCase()

    let active: boolean
    if (ON_WORDS.has(a)) active = true
    else if (OFF_WORDS.has(a)) active = false
    else if (a === '' || a === 'toggle') active = localStorage.getItem(STORAGE_KEY) !== '1'
    else {
      this.#log('border: try "neon" or "off"')
      return
    }

    localStorage.setItem(STORAGE_KEY, active ? '1' : '0')
    EffectBus.emit('neon:mode', { active })
    this.#log(active ? 'border → neon glow' : 'border → off', active ? '●' : '○')
  }

  #log(message: string, icon = '◈'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _border = new BorderQueenBee()
window.ioc.register('@diamondcoreprocessor.com/BorderQueenBee', _border)
