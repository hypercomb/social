// presentation/tiles/hide.queen.ts
//
// `/hide` — take a tile out of view without taking it out of existence.
//
// HIDE FIRST, DELETE SECOND is standing doctrine here: the gentle verb is the
// one that should be easy to reach, and the destructive one should cost a
// confirmation. The overlay has honoured that for a long time — hide is an
// icon on the tile — but the icon was the ONLY door. There was no word, so the
// gentler half of the pair was missing from the grammar while `/remove`, the
// harsher half, was in it. A speaker who wanted the safe option had to ask for
// the dangerous one.
//
// Hiding is a PARTICIPANT-LOCAL lens, not a commit: it writes the hidden list
// this browser keeps and repaints. Nothing leaves the layer, nothing is
// published, and no peer sees a change. That is exactly why it is the right
// first reach for a model — the worst case is a view you can restore with the
// same word.
//
// Syntax:
//   /hide <tile>                 — hide one tile
//   /hide [<tile>, <tile>]       — hide several
//   /hide ~<tile>                — show it again
//   /hide ~[<tile>, <tile>]      — show several again
//
// The `~` prefix is the language's existing un-do-this mark (`/keyword ~urgent`
// drops a tag), so unhiding needed no second word.

import { QueenBee, EffectBus } from '@hypercomb/core'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

/** `[a, b, c]` or a single bare name — the same list shape `/remove` reads. */
const parseTargets = (raw: string): string[] => {
  const trimmed = raw.trim()
  const bracket = trimmed.match(/^\[(.*)\]$/s)
  const body = bracket ? bracket[1] : trimmed
  return body.split(bracket ? ',' : '\n')
    .map(part => part.trim())
    .filter(Boolean)
}

type Reading =
  | { readonly show: boolean; readonly targets: readonly string[] }
  | { readonly refuse: string }

/** ONE reading for both callers. The participant's parser and the machine's
 *  admission gate must never disagree about what a line means. */
const read = (args: string): Reading => {
  const raw = args.trim()
  if (!raw) return { refuse: '/hide needs a tile name' }
  const show = raw.startsWith('~')
  const targets = parseTargets(show ? raw.slice(1) : raw)
  if (!targets.length) return { refuse: '/hide needs at least one tile name' }
  if (targets.some(name => name.includes('/'))) {
    return { refuse: '/hide names tiles on this page; it does not reach through /' }
  }
  return { show, targets }
}

export class HideQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'hide'
  override description = 'Take tiles out of view here, keeping everything they hold'
  override descriptionKey = 'slash.hide'
  override options = ['<tile>', '[<tile>, <tile>, ...]', '~<tile>']
  override examples = [
    { input: '/hide drafts', result: 'The tile "drafts" stops drawing on this page' },
    { input: '/hide ~drafts', result: 'It draws again' },
  ]

  /** Offered to machines BEFORE `/remove` is reached for: it is reversible by
   *  the same word, local to this browser, and commits nothing. */
  override machine = {
    forms: '<tile> | [<tile>, <tile>, ...] | ~<tile>',
    example: '/hide drafts',
    reach: 'editing' as const,
    refuse: (args: string): string | undefined => {
      const reading = read(args)
      return 'refuse' in reading ? reading.refuse : undefined
    },
  }

  /** Tiles on this page, so the line completes what is actually here. */
  override slashComplete(args: string): readonly string[] {
    const raw = args.trim()
    const show = raw.startsWith('~')
    const query = (show ? raw.slice(1) : raw).toLowerCase()
    const names = this.#pageTiles()
    const matched = query ? names.filter(name => name.toLowerCase().startsWith(query)) : names
    return show ? matched.map(name => `~${name}`) : matched
  }

  protected async execute(args: string): Promise<void> {
    const reading = read(args)
    if ('refuse' in reading) { this.#log(`Hide — ${reading.refuse}`); return }

    // The tile-actions bee owns the hidden list and the repaint. Speaking to
    // it by its action name is the same door the icon uses, so there is one
    // implementation of hiding and this queen is only a way to say it.
    for (const label of reading.targets) {
      EffectBus.emit('tile:action', {
        action: reading.show ? 'unhide' : 'hide',
        label, q: 0, r: 0, index: 0,
      })
    }

    const count = reading.targets.length
    const noun = count === 1 ? `"${reading.targets[0]}"` : `${count} tiles`
    this.#log(reading.show ? `Hide — ${noun} drawing again` : `Hide — ${noun} out of view here`)
  }

  #pageTiles(): readonly string[] {
    const cells = get<{ suggestions(): string[] }>('@hypercomb.social/CellSuggestionProvider')
    return cells?.suggestions?.() ?? []
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◌' })
  }
}

const _hide = new HideQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HideQueenBee', _hide)
