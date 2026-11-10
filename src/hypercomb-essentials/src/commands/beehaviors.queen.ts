// /beehaviors — open the Beehaviors window.
//
// The window had doors (the top rail's switch, a tile's features button, the
// joined toast) but no word, so a word that refused because it was switched
// off could say where its light was and give no word to get there. This is
// that word, and it cannot go dark itself (commands/word-enablement.ts): it
// is the way back to every other light.
//
//     /beehaviors            Everywhere — every behaviour, one light each
//     /beehaviors here       Here — what this layer carries
//     /beehaviors <word>     Everywhere, already searching for <word>

import { QueenBee, EffectBus } from '@hypercomb/core'

export class BeehaviorsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'beehaviors'
  override description = 'Open Beehaviors: switch any behaviour, word or desk on or off'
  override descriptionKey = 'slash.beehaviors'
  override options = ['here', '<word>']
  override examples = [
    { input: '/beehaviors', result: 'Opens Beehaviors on Everywhere — every behaviour, one light each' },
    { input: '/beehaviors here', result: 'Opens Beehaviors on Here — what this layer carries' },
    { input: '/beehaviors mail', result: 'Opens Everywhere searching for mail, so its light is the row in front of you' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return 'here'.startsWith(q) ? ['here'] : []
  }

  protected execute(args: string): void {
    const rest = args.trim()
    if (rest.toLowerCase() === 'here') { EffectBus.emit('features:context-open', {}); return }
    EffectBus.emit('features:roster-open', rest ? { query: rest.replace(/^\/+/, '') } : {})
  }
}

const _beehaviors = new BeehaviorsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/BeehaviorsQueenBee', _beehaviors)
