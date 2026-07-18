// diamondcoreprocessor.com/tutorial/tutorial.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * /tutorial — AB the bee flies around the screen and teaches the basics:
 * going into and out of tiles, creating a tile from the command line,
 * giving it children, travelling between them, zoom, pan, and Home.
 *
 * Syntax:
 *   /tutorial          — start (or restart) the guided tour
 *   /tutorial stop     — end a running tour
 *   /tour              — alias
 */
export class TutorialQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'tutorial'
  override readonly aliases = ['tour']
  override description = 'Guided beginner tour — AB the bee shows you the basics'
  override descriptionKey = 'slash.tutorial'
  override options = ['stop']
  override examples = [
    { input: '/tutorial', result: 'AB flies in and walks you through the basics' },
    { input: '/tutorial stop', result: 'Ends the running tour' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    return q && !'stop'.startsWith(q) ? [] : ['stop']
  }

  protected execute(args: string): void {
    if (args.trim().toLowerCase() === 'stop') {
      EffectBus.emit('tutorial:stop', {})
    } else {
      EffectBus.emit('tutorial:start', {})
    }
  }
}

const _tutorial = new TutorialQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TutorialQueenBee', _tutorial)
