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
  override description = 'Toggle three centered lanes for this viewport'
  override descriptionKey = 'slash.lanes'
  override options: string[] = []
  override examples = [{ input: '/lanes', result: 'Toggle three centered lanes' }]

  override slashComplete(): readonly string[] { return [] }

  protected execute(): void {
    EffectBus.emit('lanes:toggle', {})
  }
}

const _lanes = new LanesQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LanesQueenBee', _lanes)
