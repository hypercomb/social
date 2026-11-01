// guide/guide.queen.ts
//
// /guide — the bee becomes the cursor. The bare word turns that on, or off
// when it is already on. /guide stop always puts the bee down. The drone
// owns the cursor and the ideas; this queen only says the word.

import { EffectBus, QueenBee } from '@hypercomb/core'

export class GuideQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'guide'
  override description = 'The bee becomes the cursor. Stay on a tile and it dances, then the tile flies to the middle with every idea for it, as tiles or as a list. Pick what you want and accept, and an agent goes out for each'
  override examples = [
    { input: '/guide', result: 'The cursor becomes the bee. Stay on a tile and it dances, then the tile flies to the middle with every idea for it. Pick what you want and accept, and an agent goes out for each' },
    { input: '/guide stop', result: 'Puts the bee down' },
  ]
  override options = ['stop']

  override slashComplete(args: string): readonly string[] {
    const query = args.toLowerCase().trim()
    const all = ['stop', 'start']
    return query ? all.filter(option => option.startsWith(query)) : all
  }

  protected execute(args: string): void {
    const arg = args.trim().toLowerCase()
    if (arg === 'stop' || arg === 'off') {
      EffectBus.emit('guide:stop', {})
      return
    }
    if (!arg || arg === 'start' || arg === 'on') {
      EffectBus.emit('guide:toggle', {})
      return
    }
    EffectBus.emit('activity:log', {
      message: `Guide — no such word "${arg}". /guide turns the bee on, /guide stop puts it down.`,
      icon: '🐝',
    })
  }
}

const _guide = new GuideQueenBee()
window.ioc.register('@diamondcoreprocessor.com/GuideQueenBee', _guide)
