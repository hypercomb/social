// commands/create.queen.ts
//
// `/create` — the ONLY door onto tile creation from beehaviour mode.
//
// The two stances of the bar mean two different things, and the difference is
// the whole point:
//   • tiles stance (the chevron) — plain text LAYS TILES. Type a name, press
//     Enter, the tile exists. That is the stance's entire job.
//   • command stance (the slash) — plain text is READ as behaviour. Nothing
//     here mints a tile implicitly: an unread sentence offers its pathways,
//     an unknown command says it is unknown, and neither one quietly leaves a
//     tile behind. Creation in this stance is SAID, and this is the word.
//
// Before this queen, beehaviour mode had two silent creation leaks — the
// no-match pathway offered "make a tile named <the whole sentence>", and an
// unknown command fell through to the create-goto built-in. A participant
// exploring the language got junk tiles named after their own typos. Both are
// closed; this is what replaced them.
//
// Syntax:
//   create <name>              — a tile at the page you are standing on
//   create <parent>/<child>    — the nest, every level gained in one cascade
//
// The act itself is NOT reimplemented here. Tile creation lives in the command
// line's one create path (nested paths, name normalization, the armed-resource
// attach, the retained parent prefix), so this queen NAMES the act and the
// shell performs it — one implementation, two ways to say it.

import { QueenBee, EffectBus, isReservedPoolWord } from '@hypercomb/core'

const BACKSLASH = String.fromCharCode(92)

/** Names become path segments — drop control characters but KEEP '/', which
 *  is the nesting separator the create path itself splits on. */
const safeName = (raw: string): string =>
  [...raw].filter(ch => ch !== BACKSLASH && ch.charCodeAt(0) > 31).join('').trim()

export class CreateQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'create'
  override description = 'Make a tile here — the only way to create one in beehaviour mode'
  override descriptionKey = 'slash.create'
  override options = ['<name>', '<parent>/<child>']
  override examples = [
    { input: '/create groceries', result: 'A tile "groceries" appears on this page' },
    { input: 'make meals/breakfast', result: 'Creates "meals", then "breakfast" inside it' },
  ]

  /** A name is the tile's ADDRESS, so an empty or relative segment is not a
   *  weak name — it is a different tile, or none. Refuse rather than normalize. */
  override machine = {
    forms: '<name> | <parent>/<child>',
    example: '/create roadmap',
    reach: 'additive' as const,
    scope: 'page' as const,
    refuse: (args: string): string | undefined => {
      const parts = args.split('/').map(part => part.trim())
      if (args.includes(BACKSLASH) || parts.some(part => !part || part === '.' || part === '..')) {
        return '/create needs one or more explicit tile names separated by /'
      }
      // A reserved word is the address of a system pool (hypergraph-molecule-
      // lineage.md, step 5): the shell refuses it too, but the grammar should
      // hear a refusal, not a create that never happened.
      const reserved = parts.find(part => isReservedPoolWord(part))
      if (reserved) return `"${reserved}" is a reserved word — it is the address of a system pool; choose another name`
      return undefined
    },
  }

  protected async execute(args: string): Promise<void> {
    const name = safeName(args)
    if (!name) {
      EffectBus.emit('activity:log', { message: 'Create — say what to name it: create <name>', icon: '⬡' })
      return
    }
    // The shell owns the create path; this is the same commit the chevron
    // stance runs on Enter, reached by name instead of by stance.
    // A sequence must be able to await the actual create commit, not merely
    // event delivery. This acknowledgement is optional for older emitters and
    // listeners, while model-driven grammar receives strict ordering.
    let accepted = false
    let finish!: (error?: unknown) => void
    const completed = new Promise<void>((resolve, reject) => {
      finish = error => error === undefined ? resolve() : reject(error)
    })
    EffectBus.emitTransient('command:create-cells', {
      name,
      accept: () => { accepted = true },
      complete: finish,
    })
    if (!accepted) {
      EffectBus.emit('activity:log', { message: 'Create - the command line is unavailable', icon: '+' })
      throw new Error('Create command line is unavailable')
    }
    await completed
  }
}

const _create = new CreateQueenBee()
window.ioc.register('@diamondcoreprocessor.com/CreateQueenBee', _create)
