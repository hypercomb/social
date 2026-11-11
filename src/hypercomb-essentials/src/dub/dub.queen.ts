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
 *
 * THE BANK IS A POOL OTHERS CAN FILL (jwize: "publish to our host pools our own
 * dub so that people in the community can provide their own ... later the
 * participants can change their experiences"):
 *
 *   dub offer @host     put your soundbank on a host, under your key
 *   dub sync [@host]    read the soundbanks the hosts you follow carry
 *   dub banks           list the soundbanks you have, and which one plays
 *   dub use <name>      play a bank you have: its name, its host, `default`
 *                       (the page's own host) or `none` (only your own takes)
 */
export class DubQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  readonly command = 'dub'
  override description = 'Turn the audio editor on or off: press a sentence under a presentation to record your own voice for it or edit its words'
  override descriptionKey = 'slash.dub'
  override options = ['on', 'off', 'offer @<host>', 'sync [@<host>]', 'banks', 'use <name|default|none>']
  override examples = [
    { input: '/dub', result: 'Toggles the audio editor' },
    { input: '/dub on', result: 'A press on a sentence opens the recorder' },
    { input: '/dub offer @example.com', result: 'Your takes and words become a soundbank on example.com' },
    { input: '/dub use none', result: 'Only your own takes play' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    return ['on', 'off', 'offer', 'sync', 'banks', 'use'].filter(option => option.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const parts = args.trim().split(/\s+/).filter(Boolean)
    const word = (parts[0] ?? '').toLowerCase()
    const host = parts.find(part => part.startsWith('@'))?.slice(1) ?? ''
    // The switch is state (replayed to a bee that loads later); the rest are
    // acts, sent once and never replayed.
    if (!word || word === 'on' || word === 'off') { EffectBus.emit('dub:editing', word ? { on: word === 'on' } : { toggle: true }); return }
    if (word === 'offer') { EffectBus.emitTransient('dub:offer', { host }); return }
    if (word === 'sync') { EffectBus.emitTransient('dub:sync', { host }); return }
    if (word === 'banks') { EffectBus.emitTransient('dub:banks', {}); return }
    if (word === 'use') EffectBus.emitTransient('dub:use', { bank: parts.slice(1).join(' ') })
  }
}

// THE BEE WIRES (atomic-modules-plan.md): the word is registered by the dub
// bee (dub.drone.ts), never here.
