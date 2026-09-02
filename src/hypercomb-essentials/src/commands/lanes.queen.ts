// commands/lanes.queen.ts
//
// /lanes — the phone's reading rung, and the one opt-out.
//
// On a phone the tiles ALWAYS sit in rails (RailProjectionDrone): three to
// scan, two to browse, one to read. This command steps that rung, and turns
// the rails off for a participant who wants the free map back on their phone.
// Nothing here arranges or commits anything — the rails are a projection of
// the layer's order, never tile truth.
//
//   /lanes          rails on, at the remembered rung
//   /lanes 1|2|3    that many rails
//   /lanes off      the free map on this phone (remembered)
//   /lanes on       rails again

import { EffectBus, QueenBee } from '@hypercomb/core'

export class LanesQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'lanes'
  override description =
    'On a phone, read the hive in rails: 3 to scan, 2 to browse, 1 to read; off for the free map'
  override descriptionKey = 'slash.lanes'
  override options = ['1', '2', '3', 'off', 'on']
  override examples = [
    { input: '/lanes', result: 'Rails on, at the rung you last read at' },
    { input: '/lanes 1', result: 'One rail — the widest hexagons, for reading' },
    { input: '/lanes off', result: 'The free map on this phone; pan and zoom go back to free' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    return q ? this.options.filter(o => o.startsWith(q)) : this.options
  }

  protected execute(args: string): void {
    const arg = (args ?? '').trim().toLowerCase()
    if (arg === 'off' || arg === 'free') {
      EffectBus.emit('lanes:off', {})
      return
    }
    const n = Number(arg)
    if (Number.isFinite(n) && n > 0) {
      EffectBus.emit('lanes:set', { lanes: n })
      return
    }
    EffectBus.emit('lanes:on', {})
  }
}

const _lanes = new LanesQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LanesQueenBee', _lanes)
