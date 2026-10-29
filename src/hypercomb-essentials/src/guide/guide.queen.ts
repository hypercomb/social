// guide/guide.queen.ts
//
// /guide — the bee becomes the cursor. The bare word turns that on, or off
// when it is already on. /guide stop always puts the bee down. The drone
// owns the cursor and the dialog; this queen only says the word.

import { EffectBus, QueenBee } from '@hypercomb/core'

export class GuideQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'guide'
  override description = 'The bee becomes the cursor. Over a tile it names the beehaviors. Stay and it reads what is attached and where the same beehavior shows. Press and the tile comes to center for a choice. Letting go flies the view home and the cursor returns'
  override examples = [
    { input: '/guide', result: 'The cursor becomes the bee. Over a tile it names the beehaviors. Stay and it reads what is attached and where the same beehavior shows. Press and the tile comes to center for a choice. Letting go flies the view home and the cursor returns' },
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
