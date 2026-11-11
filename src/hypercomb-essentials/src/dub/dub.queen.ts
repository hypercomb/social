// dub/dub.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * dub — turn the audio editor on or off.
 *
 * THE AUDIO EDITOR IS OFF UNTIL IT IS ASKED FOR (jwize, 2026-11-11: "the audio
 * editor is not for publish use and you have to turn it off by default"). It
 * is an authoring tool, never part of a published page: a press on a sentence
 * does nothing until this word turns the editor on, it is never on in a
 * visitor's shell, and it is off again on the next load. Takes already kept
 * play whether it is on or off.
 *
 *   dub        toggle the audio editor
 *   dub on     turn it on for this session
 *   dub off    turn it off
 */
export class DubQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  readonly command = 'dub'
  override description = 'Turn the audio editor on or off: press a sentence under a presentation to record your own voice for it or edit its words'
  override descriptionKey = 'slash.dub'
  override options = ['on', 'off']
  override examples = [
    { input: '/dub', result: 'Toggles the audio editor' },
    { input: '/dub on', result: 'A press on a sentence opens the recorder' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    return ['on', 'off'].filter(option => option.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const word = args.trim().toLowerCase()
    if (word && word !== 'on' && word !== 'off') return
    EffectBus.emit('dub:editing', word ? { on: word === 'on' } : { toggle: true })
  }
}

// THE BEE WIRES (atomic-modules-plan.md): the word is registered by the dub
// bee (dub.drone.ts), never here.
